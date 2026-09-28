require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const supabase = require('./lib/supabase');
const { getKey } = require('./lib/crypto');
const { listAccounts, listAllAccounts, getAccount, saveConnectedAccount, updateAccountSettings } = require('./lib/accounts');
const { embedPending } = require('./lib/embeddings');
const { keywordSearch, parseSearchQuery } = require('./lib/search');
const { askAssistant } = require('./lib/assistant');
const { aiSaveNote } = require('./lib/aiSave');
const { suggestOrganizing } = require('./lib/organize');
const { transcribe, TRANSCRIBE_TYPES } = require('./lib/transcribe');
const { describeProviderError } = require('./lib/providerErrors');
const { noteProviderFailure, noteProviderSuccess, currentProblems } = require('./lib/providerStatus');
const {
  listNotes,
  notesForMessage,
  createNote,
  updateNote,
  deleteNote,
  addAddon,
  updateAddon,
  removeAddon,
} = require('./lib/notes');
const { syncAccount, backfillAccount } = require('./lib/sync');
const { UserError } = require('./lib/errors');
const { requireUser, createConnectState, readConnectState } = require('./lib/auth');
const gmail = require('./connectors/gmail');
const imap = require('./connectors/imap');

getKey(); // fail at startup, not mid-sync, if CREDENTIALS_KEY is missing or malformed

// The app's address(es): the only sites allowed to call this API. Comma-separated
// in .env to allow more than one (e.g. also a phone-testing address on your Wi-Fi).
// The first is where the browser is sent back to after connecting an account.
const FRONTEND_URLS = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(url => url.trim());
const FRONTEND_URL = FRONTEND_URLS[0];

const app = express();
app.use(cors({ origin: FRONTEND_URLS }));
app.use(express.json());

async function userAccountIds(userId) {
  return (await listAccounts(userId)).map(a => a.id);
}

// accounts left checked in the app's accounts panel
async function visibleAccountIds(userId) {
  return (await listAccounts(userId)).filter(a => a.show_in_inbox).map(a => a.id);
}

function redirectToApp(res, params) {
  res.redirect(`${FRONTEND_URL}/?${new URLSearchParams(params)}`);
}

// ---------- public routes (no sign-in) ----------

// for the host's health checks: answers as soon as the server is up
app.get('/health', (req, res) => {
  res.send('ok');
});

// ---------- background sync (called by a scheduler such as cron-job.org) ----------

// Protected by CRON_SECRET, sent in an "X-Cron-Secret" header; with no
// CRON_SECRET set, every call is refused. Replies straight away, since
// schedulers give up after ~30 seconds, then syncs every account in the
// background. Also keeps a free server from going to sleep.
let backgroundSyncRunning = false;

function cronSecretMatches(given) {
  const expected = process.env.CRON_SECRET;
  if (!expected || typeof given !== 'string') return false;
  // comparing fixed-length hashes takes the same time however much of the secret is right
  const hash = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(given), hash(expected));
}

async function runBackgroundSync() {
  const accounts = await listAllAccounts();
  let saved = 0;
  let embedded = 0;
  const failed = [];

  for (const account of accounts) {
    try {
      const result = await syncAccount(account);
      saved += result.saved;
      embedded += result.embedded;
    } catch (err) {
      failed.push(account.email_address);
      console.error(`Background sync failed for account ${account.id} (${account.email_address}):`, err.message);
    }
  }

  // quiet runs aren't logged, so the log shows only runs where something happened
  if (saved || failed.length) {
    console.log(`Background sync: ${saved} new messages, ${embedded} embedded` +
      (failed.length ? `, failed: ${failed.join(', ')}` : ''));
  }
}

app.post('/cron/sync', (req, res) => {
  if (!cronSecretMatches(req.get('x-cron-secret'))) return res.status(401).send('Unauthorized');
  // still a success for the scheduler: the previous run is doing the work
  if (backgroundSyncRunning) return res.status(202).json({ started: false, reason: 'previous run still going' });

  backgroundSyncRunning = true;
  res.status(202).json({ started: true });

  runBackgroundSync()
    .catch(err => console.error('Background sync failed:', err))
    .finally(() => { backgroundSyncRunning = false; });
});

// Google sends the browser here after sign-in, without the app's login, so the
// user comes from the signed `state` made in POST /connect/gmail. This exact
// URL is registered in Google Cloud as the redirect URI, so it can't be renamed.
app.get('/auth/callback', async (req, res) => {
  if (req.query.error) {
    // e.g. access_denied when the user backs out of Google's consent screen
    return redirectToApp(res, { connect_error: 'Google sign-in was cancelled' });
  }

  const userId = readConnectState(req.query.state);
  if (!userId) {
    return redirectToApp(res, { connect_error: 'That sign-in link expired, try adding the account again' });
  }

  try {
    const { emailAddress, credentials } = await gmail.handleCallback(req.query.code);
    await saveConnectedAccount(userId, { provider: 'gmail', emailAddress, credentials });
    redirectToApp(res, { connected: emailAddress });
  } catch (err) {
    console.error('Connecting Gmail account failed:', err);
    redirectToApp(res, { connect_error: 'Something went wrong, check the server terminal' });
  }
});

// ---------- everything below requires sign-in ----------

app.use(requireUser);

// ---------- connecting accounts ----------

// Returns the Google sign-in URL for the app to navigate to. A POST (not a
// plain link) so it carries the app's login, which goes into the signed state.
app.post('/connect/gmail', (req, res) => {
  res.json({ url: gmail.getAuthUrl(createConnectState(req.userId)) });
});

// Body: { email, password, host, port }. Logs in once to check the details
// before saving anything. 400 with { error } when the details don't work.
app.post('/connect/imap', async (req, res) => {
  try {
    const { emailAddress, credentials } = await imap.connectAccount(req.body || {});
    await saveConnectedAccount(req.userId, { provider: 'imap', emailAddress, credentials });
    res.json({ emailAddress });
  } catch (err) {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// ---------- accounts ----------

app.get('/accounts', async (req, res) => {
  res.json(await listAccounts(req.userId));
});

app.get('/accounts/:accountId', async (req, res) => {
  const account = await getAccount(req.userId, req.params.accountId);
  if (!account) return res.status(404).send('Account not found');
  res.json(account);
});

// Body: { show_in_inbox?: boolean, color?: "#RRGGBB" }
app.patch('/accounts/:accountId', async (req, res) => {
  const account = await updateAccountSettings(req.userId, req.params.accountId, req.body || {});
  if (!account) return res.status(404).send('Account not found');
  res.json(account);
});

// ---------- syncing ----------

// Syncs every account. One account failing doesn't stop the others.
app.post('/sync', async (req, res) => {
  const accounts = await listAccounts(req.userId);
  const results = [];

  for (const account of accounts) {
    try {
      results.push(await syncAccount(account));
    } catch (err) {
      console.error(`Sync failed for account ${account.id} (${account.email_address}):`, err);
      results.push({ accountId: account.id, emailAddress: account.email_address, error: err.message });
    }
  }

  res.json({
    saved: results.reduce((sum, r) => sum + (r.saved || 0), 0),
    embedded: results.reduce((sum, r) => sum + (r.embedded || 0), 0),
    results,
  });
});

app.post('/sync/:accountId', async (req, res) => {
  const account = await getAccount(req.userId, req.params.accountId);
  if (!account) return res.status(404).send('Account not found');
  res.json(await syncAccount(account));
});

// Occasional full-history pull, ~1000 messages per call at the default.
// Call again with ?pageToken=<returned nextPageToken> to keep going further back.
app.post('/backfill/:accountId', async (req, res) => {
  const account = await getAccount(req.userId, req.params.accountId);
  if (!account) return res.status(404).send('Account not found');

  const result = await backfillAccount(account, {
    pageToken: req.query.pageToken || undefined,
    maxPages: parseInt(req.query.maxPages) || 20,
  });

  let message;
  if (result.rateLimited) {
    message = `Hit the rate limit partway through. Saved ${result.saved}, embedded ${result.embedded} so far. Nothing lost, wait a minute and call again with the same page token.`;
  } else if (result.done) {
    message = `Backfill complete. Saved ${result.saved}, embedded ${result.embedded} for ${account.email_address}. Reached the end of the mailbox.`;
  } else {
    message = `Saved ${result.saved}, embedded ${result.embedded} for ${account.email_address}. More history remains.`;
  }

  res.json({ ...result, message });
});

app.post('/embed/:accountId', async (req, res) => {
  const account = await getAccount(req.userId, req.params.accountId);
  if (!account) return res.status(404).send('Account not found');

  const count = await embedPending(account.id);
  res.send(count ? `Embedded ${count} messages` : 'Nothing to embed');
});

// ---------- messages ----------

// Unified inbox across all shown accounts, or one of them with ?accountId=
app.get('/messages', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const offset = parseInt(req.query.offset) || 0;

  let accountIds = await visibleAccountIds(req.userId);
  if (req.query.accountId) accountIds = accountIds.filter(id => id === Number(req.query.accountId));
  if (!accountIds.length) return res.json({ messages: [], total: 0, limit, offset });

  const { data, error, count } = await supabase
    .from('messages')
    .select('id, account_id, sender, subject, snippet, received_at, is_read, has_attachments', { count: 'exact' })
    .in('account_id', accountIds)
    .order('received_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  res.json({ messages: data, total: count, limit, offset });
});

// Basic search, no AI: ?q= words plus Gmail-style operators
// (from:name, after:YYYY-MM-DD, before:YYYY-MM-DD, has:attachment), best matches first.
// Declared before /messages/:messageId so "search" isn't taken as an id.
app.get('/messages/search', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const offset = parseInt(req.query.offset) || 0;
  const { text, filters } = parseSearchQuery(req.query.q);

  const accountIds = await visibleAccountIds(req.userId);
  if (!accountIds.length || (!text && !Object.keys(filters).length)) {
    return res.json({ messages: [], hasMore: false, limit, offset });
  }

  // one extra row tells us whether there's another page
  const rows = await keywordSearch(req.userId, accountIds, text, { filters, limit: limit + 1, offset });
  res.json({
    messages: rows.slice(0, limit).map(({ body, score, ...message }) => message),
    hasMore: rows.length > limit,
    limit,
    offset,
  });
});

app.get('/messages/:messageId', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select(`
      id, account_id, thread_id, sender, to_recipients, cc_recipients, subject, body, snippet,
      received_at, labels, is_read, attachments(id, filename, mime_type, size_bytes)
    `)
    .eq('id', req.params.messageId)
    .maybeSingle();

  if (error) throw error;

  const accountIds = await userAccountIds(req.userId);
  if (!data || !accountIds.includes(data.account_id)) return res.status(404).send('Message not found');

  // the notes stuck to this email
  res.json({ ...data, notes: await notesForMessage(req.userId, data.id) });
});

// ---------- notes ----------
// A note is text; reminders, links to emails or other notes, and pins are
// add-ons attached to it. See lib/notes.js for the shapes returned.

// Runs a route, answering 400 with { error } for problems the user can fix.
function withUserErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof UserError) return res.status(400).json({ error: err.message });
      throw err;
    }
  };
}

app.get('/notes', async (req, res) => {
  res.json(await listNotes(req.userId));
});

// Body: { body, addons?: [{ kind, remindAt?, messageId?, noteId? }] }. Returns { id }.
// All or nothing: if any add-on is rejected, the new note is removed again, so
// the user can fix it and save once more without leaving a half-made note behind.
app.post('/notes', withUserErrors(async (req, res) => {
  const id = await createNote(req.userId, req.body?.body);
  try {
    for (const addon of Array.isArray(req.body?.addons) ? req.body.addons : []) {
      await addAddon(req.userId, id, addon);
    }
  } catch (err) {
    await deleteNote(req.userId, id).catch(() => {});
    throw err;
  }
  res.status(201).json({ id });
}));

// AI save. Body: { text, addons?: [...picked by hand], timeZone }. The AI
// rewrites the text and adds reminder, pin and links; returns { id, message, usage }.
// Declared before /notes/:noteId so "ai-save" isn't taken as an id.
app.post('/notes/ai-save', withUserErrors(async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 10000) : '';
  if (!text) throw new UserError('Write something first');

  const accounts = await listAccounts(req.userId);
  try {
    const saved = await aiSaveNote({
      userId: req.userId,
      accountIds: accounts.filter(a => a.show_in_inbox).map(a => a.id),
      ownAddresses: accounts.map(a => a.email_address.toLowerCase()),
      text,
      manualAddons: Array.isArray(req.body.addons) ? req.body.addons : [],
      timeZone: req.body.timeZone,
    });
    noteProviderSuccess('anthropic');
    res.status(201).json(saved);
  } catch (err) {
    noteProviderFailure(err);
    const problem = describeProviderError(err);
    if (!problem) throw err;
    console.error('AI save request failed:', err);
    res.status(502).json({ error: `${problem.message} Your note was not saved; try again or use Save.`, outOfCredits: problem.outOfCredits });
  }
}));

// Organize. Body: { timeZone }. The AI suggests pins, unpins, links, finished
// reminders and a better order; nothing changes until the user applies them
// (through the ordinary note routes). Returns { changes, order, usage }.
app.post('/notes/organize', async (req, res) => {
  try {
    const suggestions = await suggestOrganizing({ userId: req.userId, timeZone: req.body?.timeZone });
    noteProviderSuccess('anthropic');
    res.json(suggestions);
  } catch (err) {
    noteProviderFailure(err);
    const problem = describeProviderError(err);
    if (!problem) throw err;
    console.error('Organize request failed:', err);
    res.status(502).json({ error: problem.message, outOfCredits: problem.outOfCredits });
  }
});

// Body: { body?, position? }
app.patch('/notes/:noteId', withUserErrors(async (req, res) => {
  const updated = await updateNote(req.userId, req.params.noteId, req.body || {});
  if (!updated) return res.status(404).send('Note not found');
  res.status(204).end();
}));

app.delete('/notes/:noteId', async (req, res) => {
  if (!await deleteNote(req.userId, req.params.noteId)) return res.status(404).send('Note not found');
  res.status(204).end();
});

// Body: { kind: 'reminder' | 'email_link' | 'note_link' | 'pin', remindAt?, messageId?, noteId? }
app.post('/notes/:noteId/addons', withUserErrors(async (req, res) => {
  const id = await addAddon(req.userId, req.params.noteId, req.body || {});
  if (id == null) return res.status(404).send('Note not found');
  res.status(201).json({ id });
}));

// Body: { remindAt?, done? } (reminders only)
app.patch('/note-addons/:addonId', withUserErrors(async (req, res) => {
  if (!await updateAddon(req.userId, req.params.addonId, req.body || {})) return res.status(404).send('Add-on not found');
  res.status(204).end();
}));

app.delete('/note-addons/:addonId', async (req, res) => {
  if (!await removeAddon(req.userId, req.params.addonId)) return res.status(404).send('Add-on not found');
  res.status(204).end();
});

// ---------- AI assistant ----------

// Body: { question, history?: [{ question, answer }] (earlier exchanges in this chat, oldest first),
//         openMessageId? (the email open in the app, for "note this email"), timeZone? }
// Returns { answer, sources, steps, createdNotes, usage }; see lib/assistant.js.
app.post('/ask', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 1000) : '';
  if (!question) return res.status(400).json({ error: 'Ask a question first' });

  const history = (Array.isArray(req.body.history) ? req.body.history : [])
    .filter(turn => typeof turn?.question === 'string' && typeof turn?.answer === 'string')
    .map(turn => ({ question: turn.question.slice(0, 1000), answer: turn.answer.slice(0, 4000) }));

  // the assistant covers the same accounts the inbox shows; every connected
  // address counts as the user's own when spotting emails they sent
  const accounts = await listAccounts(req.userId);
  const accountIds = accounts.filter(a => a.show_in_inbox).map(a => a.id);
  const ownAddresses = accounts.map(a => a.email_address.toLowerCase());
  if (!accountIds.length) {
    return res.json({
      answer: 'All your accounts are hidden. Check one in the Accounts panel to search it.',
      sources: [],
      steps: [],
      createdNotes: [],
      usage: null,
    });
  }

  try {
    const answer = await askAssistant({
      userId: req.userId,
      accountIds,
      ownAddresses,
      question,
      history,
      openMessageId: Number(req.body.openMessageId) || null,
      timeZone: req.body.timeZone,
    });
    noteProviderSuccess('anthropic');
    res.json(answer);
  } catch (err) {
    noteProviderFailure(err);
    const problem = describeProviderError(err);
    if (!problem) throw err;
    console.error('Assistant request failed:', err);
    res.status(502).json({ error: problem.message, outOfCredits: problem.outOfCredits });
  }
});

// ---------- AI provider status ----------

// Out-of-credits problems with Anthropic or OpenAI seen recently, including in
// background syncs, for the app's banner: [{ provider, message, since }].
app.get('/status', (req, res) => {
  res.json({ problems: currentProblems() });
});

// ---------- voice ----------

// Body: the raw recording (Content-Type: audio/webm, audio/mp4, ...). Returns { text }.
// The audio is only held in memory while it's transcribed; it's never stored.
app.post('/transcribe', express.raw({ type: TRANSCRIBE_TYPES, limit: '10mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No recording was received' });

  try {
    const text = await transcribe(req.body, req.get('content-type'));
    noteProviderSuccess('openai');
    if (!text) return res.status(422).json({ error: "Couldn't hear anything in that recording" });
    res.json({ text });
  } catch (err) {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    noteProviderFailure(err);
    const problem = describeProviderError(err);
    if (!problem) throw err;
    console.error('Transcription failed:', err);
    res.status(502).json({ error: problem.message, outOfCredits: problem.outOfCredits });
  }
});

// Express 5 sends errors thrown in async routes here.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong, check the server terminal');
});

app.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
});
