// Connecting accounts, their settings, and syncing them.
const express = require('express');
const { listAccounts, getAccount, saveConnectedAccount, updateAccountSettings } = require('../lib/accounts');
const { createConnectState } = require('../lib/auth');
const { syncAccount, backfillAccount } = require('../lib/sync');
const { withUserErrors } = require('../lib/http');
const gmail = require('../connectors/gmail');
const imap = require('../connectors/imap');

const router = express.Router();

// ---------- connecting accounts ----------

// Returns the Google sign-in URL for the app to navigate to. A POST (not a
// plain link) so it carries the app's login, which goes into the signed state.
router.post('/connect/gmail', (req, res) => {
  res.json({ url: gmail.getAuthUrl(createConnectState(req.userId)) });
});

// Body: { email, password, host, port }. Logs in once to check the details
// before saving anything. 400 with { error } when the details don't work.
router.post('/connect/imap', withUserErrors(async (req, res) => {
  const { emailAddress, credentials } = await imap.connectAccount(req.body || {});
  await saveConnectedAccount(req.userId, { provider: 'imap', emailAddress, credentials });
  res.json({ emailAddress });
}));

// ---------- accounts ----------

router.get('/accounts', async (req, res) => {
  res.json(await listAccounts(req.userId));
});

// Body: { show_in_inbox?: boolean, color?: "#RRGGBB" }
router.patch('/accounts/:accountId', async (req, res) => {
  const account = await updateAccountSettings(req.userId, req.params.accountId, req.body || {});
  if (!account) return res.status(404).send('Account not found');
  res.json(account);
});

// ---------- syncing ----------

// Syncs every account. One account failing doesn't stop the others.
router.post('/sync', async (req, res) => {
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

// Occasional full-history pull, ~1000 messages per call at the default.
// Call again with ?pageToken=<returned nextPageToken> to keep going further back.
router.post('/backfill/:accountId', async (req, res) => {
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

module.exports = router;
