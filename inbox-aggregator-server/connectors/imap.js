const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { htmlToText, makeSnippet, referencedCids, normalizeCid } = require('../lib/text');
const { buildRawEmail } = require('../lib/mime');
const { UserError } = require('../lib/errors');
const { assertPublicHost } = require('../lib/hostCheck');

const CONNECT_TIMEOUT_MS = 15000;
const SOCKET_TIMEOUT_MS = 60000;
const FIRST_SYNC_LIMIT = 500; // newest messages per folder on first sync; older ones come from backfill
const PAGE_SIZE = 50;
// Only the start of each message is downloaded, which holds the text of
// nearly any email. Attachment details come from the message structure instead.
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_BODY_CHARS = 5000;

// ---------- connecting ----------

function createClient(credentials) {
  return new ImapFlow({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

async function withClient(credentials, fn) {
  const client = createClient(credentials);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// For opening emails one after another: logging in takes about half a second,
// so one connection per mailbox is kept open and reused, and logged out once
// it has been unused this long. (Syncing still uses its own connections.)
const KEPT_IDLE_MS = 45 * 1000;
const keptClients = new Map(); // "user@host:port" -> { client, ready, active, timer }

function keptClient(credentials, key) {
  const existing = keptClients.get(key);
  if (existing?.client.usable) return existing;

  const client = createClient(credentials);
  const entry = { client, ready: client.connect(), active: 0, timer: null };
  entry.forget = () => { if (keptClients.get(key) === entry) keptClients.delete(key); };
  keptClients.set(key, entry);
  // a dropped connection is forgotten, and the next email opens a new one;
  // the error listener also keeps a failure on an idle connection from crashing the server
  client.on('error', err => console.error(`Kept IMAP connection to ${credentials.host} failed:`, err.message));
  client.on('close', entry.forget);
  entry.ready.catch(entry.forget);
  return entry;
}

async function withKeptClient(credentials, fn, isRetry = false) {
  const key = `${credentials.user}@${credentials.host}:${credentials.port}`;
  const entry = keptClient(credentials, key);
  await entry.ready;
  entry.active++;
  clearTimeout(entry.timer);
  try {
    return await fn(entry.client);
  } catch (err) {
    // the connection died while it sat unused: try once more on a new one
    if (!entry.client.usable && !isRetry) {
      entry.forget();
      return withKeptClient(credentials, fn, true);
    }
    throw err;
  } finally {
    entry.active--;
    if (entry.active === 0) {
      entry.timer = setTimeout(() => {
        entry.forget();
        entry.client.logout().catch(() => entry.client.close());
      }, KEPT_IDLE_MS);
    }
  }
}

// Turns connection failures into messages the connect form can show.
function explainConnectError(err, { host, port }) {
  if (err.authenticationFailed) return new UserError('The server rejected that email/password');
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(err.code)) return new UserError(`Couldn't find a mail server at ${host}`);
  if (/^ERR_TLS|CERT|SELF_SIGNED/.test(err.code || '') || /certificate/i.test(err.message || '')) {
    return new UserError(`Couldn't make a secure connection to ${host} (certificate problem)`);
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(err.code) || /timeout/i.test(err.message || '')) {
    return new UserError(`Couldn't reach ${host} on port ${port}`);
  }
  return err;
}

// Validates the connect form, checks the login works, and returns what to store.
// Most mail hosts (HostGator/cPanel included) use the full address as the username.
async function connectAccount({ email, password, host, port }) {
  const emailAddress = (email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new UserError('Enter a valid email address');
  if (!password) throw new UserError('Enter the password for this mailbox');

  const serverHost = (host || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(serverHost)) throw new UserError('Enter a server name like mail.example.com');

  const serverPort = Number(port) || 993;
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) throw new UserError('Enter a valid port');

  const credentials = {
    host: serverHost,
    port: serverPort,
    secure: serverPort !== 143, // 993 is TLS from the start; 143 upgrades with STARTTLS
    user: emailAddress,
    password,
  };

  await assertPublicHost(serverHost);
  try {
    await withClient(credentials, async () => {});
  } catch (err) {
    throw explainConnectError(err, credentials);
  }

  return { emailAddress, credentials };
}

// ---------- parsing ----------

function addressText(field) {
  if (!field) return null;
  return [].concat(field).map(a => a.text).join(', ') || null;
}

// Attachment details from the message structure, so attachments never need downloading here.
function collectAttachments(node, found = []) {
  if (!node) return found;
  const filename = node.dispositionParameters?.filename || node.parameters?.name || null;
  if (!node.childNodes && (node.disposition === 'attachment' || filename)) {
    found.push({
      external_id: node.part || '1', // a single-part message has no part number
      filename,
      mime_type: node.type,
      size_bytes: node.size ?? null,
    });
  }
  for (const child of node.childNodes || []) collectAttachments(child, found);
  return found;
}

// Turns a fetched IMAP message into the provider-neutral shape sync.js saves.
async function normalizeMessage(message, folder, uidValidity) {
  const parsed = await simpleParser(message.source, {
    skipHtmlToText: true, // converted below with the same settings as Gmail
    skipTextToHtml: true,
    skipImageLinks: true,
  });

  const body = parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : '');
  const labels = [folder.label, ...(message.flags?.has('\\Seen') ? [] : ['UNREAD'])];
  const attachments = collectAttachments(message.bodyStructure);
  const receivedAt = message.internalDate || parsed.date;
  // the first message in the References chain identifies the conversation
  const references = [].concat(parsed.references || []);

  return {
    // UIDs are only unique within one folder and one UIDVALIDITY, so all three go in the id
    external_id: `${folder.path}:${uidValidity}:${message.uid}`,
    thread_id: references[0] || parsed.inReplyTo || parsed.messageId || null,
    sender: addressText(parsed.from),
    to_recipients: addressText(parsed.to),
    cc_recipients: addressText(parsed.cc),
    subject: parsed.subject || null,
    snippet: makeSnippet(body),
    body: body.slice(0, MAX_BODY_CHARS),
    received_at: receivedAt ? new Date(receivedAt).toISOString() : null,
    labels,
    is_read: !labels.includes('UNREAD'),
    has_attachments: attachments.length > 0,
    attachments,
  };
}

// ---------- fetching ----------

// INBOX plus the Sent folder, if the server marks one. Labels match Gmail's.
async function syncedFolders(client) {
  const sent = (await client.list()).find(f => f.specialUse === '\\Sent');
  return [{ path: 'INBOX', label: 'INBOX' }, ...(sent ? [{ path: sent.path, label: 'SENT' }] : [])];
}

// UIDs in the open folder, ascending. `range` like "120:*" limits the search.
async function searchUids(client, range) {
  const uids = await client.search(range ? { uid: range } : { all: true }, { uid: true });
  return (uids || []).sort((a, b) => a - b);
}

async function fetchByUids(client, folder, uidValidity, uids) {
  if (!uids.length) return [];

  const fetched = [];
  const query = { uid: true, flags: true, internalDate: true, bodyStructure: true, source: { maxLength: MAX_SOURCE_BYTES } };
  for await (const message of client.fetch(uids.join(','), query, { uid: true })) {
    fetched.push(message);
  }
  // parse after the fetch finishes, so the connection isn't held up
  return Promise.all(fetched.map(m => normalizeMessage(m, folder, uidValidity)));
}

// ---------- connector interface ----------

// Sync position per folder: { folders: { [path]: { uidValidity, lastUid } } }.
// New mail always gets a higher UID, so each sync asks for UIDs above the last one seen.
// Read/unread changes on already-stored messages aren't picked up yet.
async function fetchNew({ credentials, syncState }) {
  return withClient(credentials, async client => {
    const folders = await syncedFolders(client);
    const state = { folders: { ...(syncState.folders || {}) } };
    const messages = [];

    for (const folder of folders) {
      const lock = await client.getMailboxLock(folder.path);
      try {
        const uidValidity = String(client.mailbox.uidValidity);
        const saved = state.folders[folder.path];
        // a changed UIDVALIDITY means the server renumbered the folder, so start over
        const lastUid = saved?.uidValidity === uidValidity ? saved.lastUid : null;

        const uids = lastUid == null
          ? (await searchUids(client)).slice(-FIRST_SYNC_LIMIT)
          // "n:*" always includes the newest message, even when it's older than n
          : (await searchUids(client, `${lastUid + 1}:*`)).filter(uid => uid > lastUid);

        messages.push(...await fetchByUids(client, folder, uidValidity, uids));

        state.folders[folder.path] = {
          uidValidity,
          lastUid: uids.length ? uids[uids.length - 1] : (lastUid ?? Number(client.mailbox.uidNext) - 1),
        };
      } finally {
        lock.release();
      }
    }

    return { messages, labelUpdates: [], syncState: state };
  });
}

// One page of older history, newest first, working through INBOX then Sent.
// pageToken is JSON: { folder: index into syncedFolders, before: only UIDs below this }.
async function fetchPage({ credentials, pageToken }) {
  const cursor = pageToken ? JSON.parse(pageToken) : { folder: 0, before: null };

  return withClient(credentials, async client => {
    const folders = await syncedFolders(client);
    const folder = folders[cursor.folder];
    if (!folder) return { messages: [], nextPageToken: null };

    const lock = await client.getMailboxLock(folder.path);
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      let uids = await searchUids(client);
      if (cursor.before != null) uids = uids.filter(uid => uid < cursor.before);

      const pageUids = uids.slice(-PAGE_SIZE);
      const messages = await fetchByUids(client, folder, uidValidity, pageUids);

      let next = null;
      if (uids.length > PAGE_SIZE) next = { folder: cursor.folder, before: pageUids[0] };
      else if (cursor.folder + 1 < folders.length) next = { folder: cursor.folder + 1, before: null };

      return { messages, nextPageToken: next && JSON.stringify(next) };
    } finally {
      lock.release();
    }
  });
}

// A stored message's id is "<folder path>:<uidValidity>:<uid>". The folder path
// can itself contain ":", so the last two parts are split off from the right.
function parseExternalId(messageExternalId) {
  const parts = messageExternalId.split(':');
  const uid = parts.pop();
  const uidValidity = parts.pop();
  return { path: parts.join(':'), uidValidity, uid };
}

// Opens the folder holding one stored message and runs fn(client, uid), on the
// kept connection, since these run as emails are opened.
async function withStoredMessage(credentials, messageExternalId, fn) {
  const { path, uidValidity, uid } = parseExternalId(messageExternalId);

  return withKeptClient(credentials, async client => {
    const lock = await client.getMailboxLock(path);
    try {
      if (String(client.mailbox.uidValidity) !== uidValidity) {
        throw new Error(`Folder ${path} was renumbered on the server since this message was synced`);
      }
      return await fn(client, uid);
    } finally {
      lock.release();
    }
  });
}

// One part's bytes, decoded (text parts come out as UTF-8).
async function downloadPart(client, uid, part, maxBytes) {
  const { content } = await client.download(uid, part, { uid: true, maxBytes });
  const chunks = [];
  for await (const chunk of content) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadAttachment({ credentials, messageExternalId, attachmentExternalId, maxBytes }) {
  return withStoredMessage(credentials, messageExternalId, (client, uid) => downloadPart(client, uid, attachmentExternalId, maxBytes));
}

function findNodes(node, test, found = []) {
  if (!node) return found;
  if (!node.childNodes && test(node)) found.push(node);
  for (const child of node.childNodes || []) findNodes(child, test, found);
  return found;
}

// The email's HTML plus the images it shows from inside the email (cid: links),
// downloading only those parts, never the whole message with its attachments.
// A plain-text email has html null and all of its text in text.
async function getHtml({ credentials, messageExternalId, maxHtmlBytes, maxInlineBytes }) {
  return withStoredMessage(credentials, messageExternalId, async (client, uid) => {
    const message = await client.fetchOne(uid, { bodyStructure: true }, { uid: true });
    const [htmlNode] = findNodes(message?.bodyStructure, n => n.type === 'text/html' && n.disposition !== 'attachment');
    if (!htmlNode || htmlNode.size > maxHtmlBytes) {
      // a plain-text email: all of its text (the app stores only the start)
      const [textNode] = findNodes(message?.bodyStructure, n => n.type === 'text/plain' && n.disposition !== 'attachment');
      if (!textNode || textNode.size > maxHtmlBytes) return { html: null, text: null, inlineParts: [] };
      const text = (await downloadPart(client, uid, textNode.part || '1', maxHtmlBytes)).toString('utf-8');
      return { html: null, text, inlineParts: [] };
    }

    // a single-part message's body is part 1
    const html = (await downloadPart(client, uid, htmlNode.part || '1', maxHtmlBytes)).toString('utf-8');

    const wanted = referencedCids(html);
    let budget = maxInlineBytes;
    const images = findNodes(message.bodyStructure, n => {
      if (!n.type?.startsWith('image/') || !n.id || !wanted.has(normalizeCid(n.id))) return false;
      budget -= n.size ?? 0;
      return budget >= 0;
    });
    // one at a time: an IMAP connection handles one download at once anyway
    const inlineParts = [];
    for (const n of images) {
      inlineParts.push({ partId: n.part, cid: n.id, mimeType: n.type, content: await downloadPart(client, uid, n.part, maxInlineBytes) });
    }
    return { html, inlineParts };
  });
}

// Permanently deletes stored messages from the mailbox, e.g. the emails an
// expired temp address received. A folder renumbered since syncing is skipped
// rather than risk deleting the wrong mail. Returns how many were deleted.
async function deleteMessages({ credentials, messageExternalIds }) {
  const byFolder = new Map(); // "path:uidValidity" -> { path, uidValidity, uids }
  for (const externalId of messageExternalIds) {
    const { path, uidValidity, uid } = parseExternalId(externalId);
    const key = `${path}:${uidValidity}`;
    if (!byFolder.has(key)) byFolder.set(key, { path, uidValidity, uids: [] });
    byFolder.get(key).uids.push(uid);
  }
  if (!byFolder.size) return 0;

  let deleted = 0;
  await withClient(credentials, async client => {
    for (const { path, uidValidity, uids } of byFolder.values()) {
      const lock = await client.getMailboxLock(path);
      try {
        if (String(client.mailbox.uidValidity) !== uidValidity) {
          console.error(`Not deleting from ${path}: the folder was renumbered since these messages were synced`);
          continue;
        }
        if (await client.messageDelete(uids.join(','), { uid: true })) deleted += uids.length;
      } finally {
        lock.release();
      }
    }
  });
  return deleted;
}

// ---------- sending ----------

// The original's headers a reply needs: { messageId, references: [...], replyTo }.
async function getReplyHeaders({ credentials, messageExternalId }) {
  const headers = await withStoredMessage(credentials, messageExternalId, async (client, uid) => {
    const message = await client.fetchOne(uid, { headers: ['message-id', 'references', 'reply-to'] }, { uid: true });
    return message?.headers;
  });
  if (!headers) return { messageId: null, references: [], replyTo: null };

  const parsed = await simpleParser(Buffer.concat([headers, Buffer.from('\r\n')]));
  return {
    messageId: parsed.messageId || null,
    references: [].concat(parsed.references || []),
    replyTo: parsed.replyTo?.text || null,
  };
}

// Turns SMTP failures into messages the app can show.
function explainSendError(err, { host, port }) {
  if (err.code === 'EAUTH') return new UserError(`${host} rejected the password when sending. Connect the account again if it changed.`);
  if (err.code === 'EENVELOPE') return new UserError(`The mail server refused a recipient: ${err.response || err.message}`);
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(err.code)) {
    return new UserError(`Couldn't reach the mail server ${host} on port ${port} to send`);
  }
  return err;
}

// Sends over SMTP (same server and login as IMAP, port 465 unless the account
// says otherwise), then saves a copy to the Sent folder, which SMTP doesn't do
// by itself. The email has gone by then, so a failed copy is only logged.
async function send({ credentials, mail }) {
  const host = credentials.smtpHost || credentials.host;
  const port = credentials.smtpPort || 465;
  await assertPublicHost(host);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 is TLS from the start; 587 upgrades with STARTTLS
    auth: { user: credentials.user, pass: credentials.password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  try {
    await transport.sendMail(mail);
  } catch (err) {
    throw explainSendError(err, { host, port });
  } finally {
    transport.close();
  }

  try {
    const raw = await buildRawEmail(mail, { keepBcc: true });
    await withClient(credentials, async client => {
      const sent = (await client.list()).find(f => f.specialUse === '\\Sent');
      if (sent) await client.append(sent.path, raw, ['\\Seen']);
    });
  } catch (err) {
    console.error(`Sent from ${credentials.user}, but saving a copy to the Sent folder failed:`, err.message);
  }
}

// IMAP servers don't rate-limit the way Gmail's API does
function isRateLimitError() {
  return false;
}

module.exports = {
  provider: 'imap',
  connectAccount,
  fetchNew,
  fetchPage,
  downloadAttachment,
  getHtml,
  deleteMessages,
  getReplyHeaders,
  send,
  isRateLimitError,
};
