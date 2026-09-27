const { google } = require('googleapis');
const { htmlToText } = require('../lib/text');

// Where Google sends the browser after sign-in: this server's /auth/callback.
// Must exactly match an "Authorized redirect URI" in Google Cloud.
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const PAGE_SIZE = 50;
const MAX_LIST_PAGES = 10; // cap for a full scan — older history comes from backfill
const FETCH_BATCH_SIZE = 3;
const FETCH_BATCH_PAUSE_MS = 800; // Gmail's quota is per-minute, so steady pacing beats burst speed
const MAX_BODY_CHARS = 5000;

// ---------- auth ----------

function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

function gmailClient(credentials) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: credentials.refresh_token });
  return google.gmail({ version: 'v1', auth: client });
}

// `state` comes back untouched on the callback (see createConnectState).
function getAuthUrl(state) {
  return oauthClient().generateAuthUrl({
    state,
    access_type: 'offline',
    // consent: forces Google to hand back a refresh token every time
    // select_account: always show the account picker instead of reusing whoever's signed in
    prompt: 'consent select_account',
    scope: SCOPES,
  });
}

// Exchanges the OAuth code for tokens. Returns the account's email and the credentials to store.
async function handleCallback(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token');

  const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
  return { emailAddress: data.email, credentials: { refresh_token: tokens.refresh_token } };
}

// ---------- parsing ----------

function extractBody(payload) {
  function findPart(part, mimeType) {
    if (part.mimeType === mimeType && part.body?.data) {
      return part.body.data;
    }
    if (part.parts) {
      for (const p of part.parts) {
        const found = findPart(p, mimeType);
        if (found) return found;
      }
    }
    return null;
  }

  const plainData = findPart(payload, 'text/plain') || (payload.mimeType === 'text/plain' ? payload.body?.data : null);
  if (plainData) {
    return Buffer.from(plainData, 'base64url').toString('utf-8');
  }

  // no plain-text part — fall back to HTML, converted to readable text
  const htmlData = findPart(payload, 'text/html') || payload.body?.data;
  if (!htmlData) return '';

  const html = Buffer.from(htmlData, 'base64url').toString('utf-8');
  return htmlToText(html);
}

function collectAttachments(part, found = []) {
  if (part.filename && part.body?.attachmentId) {
    found.push({
      external_id: part.partId,
      filename: part.filename,
      mime_type: part.mimeType,
      size_bytes: part.body.size ?? null,
    });
  }
  for (const p of part.parts || []) collectAttachments(p, found);
  return found;
}

// Turns a Gmail API message into the provider-neutral shape sync.js saves.
function normalizeMessage(full) {
  const headers = full.payload.headers || [];
  const header = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  // internalDate is Gmail's own received timestamp (epoch ms), always
  // present — more reliable than parsing the sender's Date header,
  // which is sometimes missing or malformed.
  const dateHeader = header('Date');
  const receivedAt = full.internalDate
    ? new Date(parseInt(full.internalDate)).toISOString()
    : (dateHeader ? new Date(dateHeader).toISOString() : null);

  const labels = full.labelIds || [];
  const attachments = collectAttachments(full.payload);

  return {
    external_id: full.id,
    thread_id: full.threadId,
    sender: header('From'),
    to_recipients: header('To'),
    cc_recipients: header('Cc'),
    subject: header('Subject'),
    snippet: full.snippet,
    body: extractBody(full.payload).slice(0, MAX_BODY_CHARS),
    received_at: receivedAt,
    labels,
    is_read: !labels.includes('UNREAD'),
    has_attachments: attachments.length > 0,
    attachments,
  };
}

// ---------- fetching ----------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  return err.code === 429 || (err.code === 403 && /quota|rate/i.test(err.message || ''));
}

// Fetches one message's full details, retrying with backoff if Gmail's
// per-user rate limit kicks in. Returns null if the message was deleted
// between being listed and being fetched.
async function getMessageWithRetry(gmail, id, attempt = 0) {
  try {
    const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    return data;
  } catch (err) {
    if (err.code === 404) return null;
    if (isRateLimitError(err) && attempt < 6) {
      // longer, steadily increasing waits: ~2s, 4s, 8s, 16s, 32s, 64s
      await sleep(2000 * Math.pow(2, attempt));
      return getMessageWithRetry(gmail, id, attempt + 1);
    }
    throw err;
  }
}

// Fetches and normalizes messages in small concurrent batches, with a pause
// between batches, to stay under Gmail's per-minute rate limit. Skips drafts.
async function fetchMessages(gmail, ids) {
  const results = [];

  for (let i = 0; i < ids.length; i += FETCH_BATCH_SIZE) {
    const batch = ids.slice(i, i + FETCH_BATCH_SIZE);
    const fetched = await Promise.all(batch.map(id => getMessageWithRetry(gmail, id)));

    for (const full of fetched) {
      if (full && !(full.labelIds || []).includes('DRAFT')) results.push(normalizeMessage(full));
    }

    if (i + FETCH_BATCH_SIZE < ids.length) await sleep(FETCH_BATCH_PAUSE_MS);
  }

  return results;
}

// Fast path: asks Gmail for only what changed since the stored history position.
async function fetchViaHistory(gmail, startHistoryId, filterUnknown) {
  const addedIds = new Set();
  const labelsById = new Map(); // latest known labels for messages whose labels changed
  let historyId = startHistoryId;
  let pageToken;

  do {
    const { data } = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
      pageToken,
    });

    for (const record of data.history || []) {
      for (const { message } of record.messagesAdded || []) addedIds.add(message.id);
      for (const { message } of [...(record.labelsAdded || []), ...(record.labelsRemoved || [])]) {
        if (Array.isArray(message.labelIds)) labelsById.set(message.id, message.labelIds);
      }
    }

    historyId = data.historyId;
    pageToken = data.nextPageToken;
  } while (pageToken);

  const newIds = await filterUnknown([...addedIds]);
  const newIdSet = new Set(newIds);

  return {
    messages: await fetchMessages(gmail, newIds),
    // new messages already carry their labels, so only report changes to stored ones
    labelUpdates: [...labelsById]
      .filter(([id]) => !newIdSet.has(id))
      .map(([externalId, labels]) => ({ externalId, labels })),
    syncState: { historyId },
  };
}

// Slow path, used on first sync or when the stored history position has
// expired: pages through the newest-first message list and stops at the
// first page containing an already-stored message.
async function fetchViaList(gmail, filterUnknown) {
  // read the history position *before* listing, so anything that arrives
  // mid-scan is picked up by the next history sync instead of skipped
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });

  const newIds = [];
  let pageToken;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data } = await gmail.users.messages.list({ userId: 'me', maxResults: PAGE_SIZE, pageToken });
    if (!data.messages) break;

    const ids = data.messages.map(m => m.id);
    const unknown = await filterUnknown(ids);
    newIds.push(...unknown);

    // this page had an already-stored message, so we've caught up
    if (unknown.length < ids.length) break;

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return {
    messages: await fetchMessages(gmail, newIds),
    labelUpdates: [],
    syncState: { historyId: profile.historyId },
  };
}

// ---------- connector interface ----------

// Returns messages that arrived since the last sync, label changes on
// already-stored messages, and the new sync position to save.
// `filterUnknown(ids)` returns the subset of ids not already stored.
async function fetchNew({ credentials, syncState, filterUnknown }) {
  const gmail = gmailClient(credentials);

  if (syncState.historyId) {
    try {
      return await fetchViaHistory(gmail, syncState.historyId, filterUnknown);
    } catch (err) {
      // 404 = history position too old for Gmail to replay; fall back to a scan
      if (err.code !== 404) throw err;
    }
  }

  return fetchViaList(gmail, filterUnknown);
}

// One page of history for backfill, newest first. Re-fetches messages that
// are already stored, which also fills in fields added after they were saved.
async function fetchPage({ credentials, pageToken }) {
  const gmail = gmailClient(credentials);
  const { data } = await gmail.users.messages.list({ userId: 'me', maxResults: PAGE_SIZE, pageToken });
  const ids = (data.messages || []).map(m => m.id);

  return {
    messages: await fetchMessages(gmail, ids),
    nextPageToken: data.nextPageToken || null,
  };
}

function findPartById(part, partId) {
  if (part.partId === partId) return part;
  for (const child of part.parts || []) {
    const found = findPartById(child, partId);
    if (found) return found;
  }
  return null;
}

// Downloads one attachment's bytes. Stored ids are the stable partId, so the
// current attachmentId (which Gmail changes between requests) is looked up first.
async function downloadAttachment({ credentials, messageExternalId, attachmentExternalId }) {
  const gmail = gmailClient(credentials);
  const { data: full } = await gmail.users.messages.get({ userId: 'me', id: messageExternalId, format: 'full' });

  const part = findPartById(full.payload, attachmentExternalId);
  if (!part?.body?.attachmentId) throw new Error(`Attachment ${attachmentExternalId} not found in message ${messageExternalId}`);

  const { data } = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: messageExternalId,
    id: part.body.attachmentId,
  });
  return Buffer.from(data.data, 'base64url');
}

module.exports = {
  provider: 'gmail',
  downloadAttachment,
  getAuthUrl,
  handleCallback,
  fetchNew,
  fetchPage,
  isRateLimitError,
};
