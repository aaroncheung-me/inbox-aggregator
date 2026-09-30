require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const { getKey } = require('./lib/crypto');
const { listAllAccounts, saveConnectedAccount } = require('./lib/accounts');
const { syncAccount } = require('./lib/sync');
const { sendDue } = require('./lib/outbox');
const { removeLeftoverUploads } = require('./lib/outboxFiles');
const { expireTempAddresses } = require('./lib/tempAddresses');
const { requireUser, readConnectState } = require('./lib/auth');
const gmail = require('./connectors/gmail');

getKey(); // fail at startup, not mid-sync, if CREDENTIALS_KEY is missing or malformed

// The app's address(es): the only sites allowed to call this API. Comma-separated
// in .env to allow more than one (e.g. also a phone-testing address on your Wi-Fi).
// The first is where the browser is sent back to after connecting an account.
const FRONTEND_URLS = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(url => url.trim());
const FRONTEND_URL = FRONTEND_URLS[0];

const app = express();
app.use(cors({ origin: FRONTEND_URLS }));
app.use(express.json());

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
  // catches any email left waiting by a server restart
  sendDue().catch(err => console.error('Sending overdue email failed:', err));
  expireTempAddresses().catch(err => console.error('Expiring temp addresses failed:', err));
  removeLeftoverUploads().catch(err => console.error('Removing leftover attachment uploads failed:', err.message));
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
app.use(require('./routes/accounts'));
app.use(require('./routes/messages'));
app.use(require('./routes/tempAddresses'));
app.use(require('./routes/sending'));
app.use(require('./routes/notes'));
app.use(require('./routes/assistant'));

// Express 5 sends errors thrown in async routes here. It needs all four
// arguments, unused `next` included, to be treated as an error handler.
app.use((err, req, res, next) => {
  // a request body over its route's limit (an attachment over 25 MB)
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large, attachments can be 25 MB at most' });
  console.error(err);
  res.status(500).send('Something went wrong, check the server terminal');
});

app.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
  // email that was waiting when the server last stopped, and temp addresses that ran out meanwhile
  sendDue().catch(err => console.error('Sending overdue email failed:', err));
  expireTempAddresses().catch(err => console.error('Expiring temp addresses failed:', err));
});
