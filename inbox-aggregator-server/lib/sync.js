const supabase = require('./supabase');
const { getCredentials, saveSyncState } = require('./accounts');
const { embedPending } = require('./embeddings');
const { connectorFor } = require('../connectors');

const LOOKUP_CHUNK = 100; // ids per `in (...)` query, to keep request URLs short

// Returns a function that filters a list of external ids down to the ones
// this account hasn't stored yet.
function filterUnknownFor(accountId) {
  return async (externalIds) => {
    const known = new Set();

    for (let i = 0; i < externalIds.length; i += LOOKUP_CHUNK) {
      const { data, error } = await supabase
        .from('messages')
        .select('external_id')
        .eq('account_id', accountId)
        .in('external_id', externalIds.slice(i, i + LOOKUP_CHUNK));

      if (error) throw error;
      for (const row of data) known.add(row.external_id);
    }

    return externalIds.filter(id => !known.has(id));
  };
}

// Upserts normalized messages and their attachment metadata. Safe to repeat.
async function saveMessages(accountId, messages) {
  if (!messages.length) return;

  const rows = messages.map(({ attachments, ...message }) => ({ ...message, account_id: accountId }));
  const { data: saved, error } = await supabase
    .from('messages')
    .upsert(rows, { onConflict: 'account_id,external_id' })
    .select('id, external_id');

  if (error) throw error;

  const idByExternalId = new Map(saved.map(row => [row.external_id, row.id]));
  const attachmentRows = messages.flatMap(message =>
    message.attachments.map(a => ({ ...a, message_id: idByExternalId.get(message.external_id) }))
  );

  if (attachmentRows.length) {
    const { error: attachmentError } = await supabase
      .from('attachments')
      .upsert(attachmentRows, { onConflict: 'message_id,external_id' });
    if (attachmentError) throw attachmentError;
  }
}

async function applyLabelUpdates(accountId, labelUpdates) {
  for (const { externalId, labels } of labelUpdates) {
    const { error } = await supabase
      .from('messages')
      .update({ labels, is_read: !labels.includes('UNREAD') })
      .eq('account_id', accountId)
      .eq('external_id', externalId);
    if (error) throw error;
  }
}

// Pulls everything new for one account, saves it, embeds it, and records
// the new sync position. The position is saved last, so a failure partway
// through just means the next sync redoes the same work.
// accountId -> the sync already running for it
const syncsInFlight = new Map();

// If this account is already syncing (e.g. the background sync and "Sync now"
// at the same moment), waits for that run instead of fetching and embedding
// the same mail twice.
function syncAccount(account) {
  if (!syncsInFlight.has(account.id)) {
    const run = runSync(account).finally(() => syncsInFlight.delete(account.id));
    syncsInFlight.set(account.id, run);
  }
  return syncsInFlight.get(account.id);
}

async function runSync(account) {
  const connector = connectorFor(account.provider);
  const credentials = await getCredentials(account);

  const result = await connector.fetchNew({
    credentials,
    syncState: account.sync_state || {},
    filterUnknown: filterUnknownFor(account.id),
  });

  await saveMessages(account.id, result.messages);
  await applyLabelUpdates(account.id, result.labelUpdates);

  // Indexing new mail for search needs OpenAI. If that fails (say credits ran
  // out) the mail is still saved and the sync still counts; the messages stay
  // unindexed and are picked up by a later sync once it works again.
  let embedded = 0;
  let indexingError = null;
  try {
    embedded = await embedPending(account.id);
  } catch (err) {
    indexingError = err.message;
    console.error(`Indexing new mail failed for account ${account.id}; will retry next sync:`, err.message);
  }

  const lastSyncedAt = await saveSyncState(account.id, result.syncState);

  return {
    accountId: account.id,
    emailAddress: account.email_address,
    saved: result.messages.length,
    embedded,
    indexingError,
    lastSyncedAt,
  };
}

// Pulls older history, up to maxPages per call. Doesn't touch the sync
// position. On a rate-limit wall it stops early and returns the page token
// to resume from — nothing is lost, since saving and embedding are both safe to redo.
async function backfillAccount(account, { pageToken, maxPages }) {
  const connector = connectorFor(account.provider);
  const credentials = await getCredentials(account);

  let saved = 0;
  let embedded = 0;
  let oldestDate = null;

  for (let page = 0; page < maxPages; page++) {
    const currentPageToken = pageToken; // the token that fetched THIS page — safe to retry with

    let result;
    try {
      result = await connector.fetchPage({ credentials, pageToken });
    } catch (err) {
      if (!connector.isRateLimitError(err)) throw err;
      return { done: false, rateLimited: true, saved, embedded, oldestDate, nextPageToken: currentPageToken };
    }

    await saveMessages(account.id, result.messages);
    saved += result.messages.length;
    embedded += await embedPending(account.id);

    for (const m of result.messages) {
      if (m.received_at && (!oldestDate || m.received_at < oldestDate)) oldestDate = m.received_at;
    }

    pageToken = result.nextPageToken;
    if (!pageToken) return { done: true, saved, embedded, oldestDate, nextPageToken: null };
  }

  return { done: false, saved, embedded, oldestDate, nextPageToken: pageToken };
}

module.exports = { syncAccount, backfillAccount };
