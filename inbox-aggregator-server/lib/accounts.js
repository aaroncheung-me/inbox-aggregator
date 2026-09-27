const supabase = require('./supabase');
const { encryptJson, decryptJson } = require('./crypto');

// never includes credentials — those are only read through getCredentials()
const ACCOUNT_COLUMNS =
  'id, user_id, provider, email_address, display_name, color, show_in_inbox, last_synced_at, sync_state';

// Pastel colors handed out to new accounts in order, arranged so neighbors
// look clearly different. Same list and order as the picker's swatches
// (src/accountColors.js in the frontend).
const ACCOUNT_COLORS = ['#93CDE6', '#F5BE8F', '#9FD8B0', '#CDA8EC', '#E9D17A', '#F2A7A7', '#A9B3EE', '#EFA7CC'];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// The first palette color none of the user's accounts use yet, or the
// least-used one once the palette runs out.
async function pickAccountColor(userId) {
  const uses = new Map(ACCOUNT_COLORS.map(c => [c, 0]));
  for (const account of await listAccounts(userId)) {
    if (uses.has(account.color)) uses.set(account.color, uses.get(account.color) + 1);
  }
  return [...uses].reduce((least, entry) => (entry[1] < least[1] ? entry : least))[0];
}

// Connects an account, or refreshes the credentials of one already connected
// (keeping its messages, color and sync position).
async function saveConnectedAccount(userId, { provider, emailAddress, credentials }) {
  const { data: account, error } = await supabase
    .from('accounts')
    .upsert(
      {
        user_id: userId,
        provider,
        email_address: emailAddress,
        credentials: encryptJson(credentials),
      },
      { onConflict: 'user_id,provider,email_address' }
    )
    .select('id, color')
    .single();

  if (error) throw error;
  if (account.color) return;

  const { error: colorError } = await supabase
    .from('accounts')
    .update({ color: await pickAccountColor(userId) })
    .eq('id', account.id);
  if (colorError) throw colorError;
}

// Only fields the app is allowed to change on its own; anything else is ignored.
async function updateAccountSettings(userId, accountId, { show_in_inbox, color }) {
  const changes = {};
  if (typeof show_in_inbox === 'boolean') changes.show_in_inbox = show_in_inbox;
  if (typeof color === 'string' && HEX_COLOR.test(color)) changes.color = color.toUpperCase();
  if (!Object.keys(changes).length) return getAccount(userId, accountId);

  const { data, error } = await supabase
    .from('accounts')
    .update(changes)
    .eq('id', accountId)
    .eq('user_id', userId)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function listAccounts(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .order('id');

  if (error) throw error;
  return data;
}

// Returns null if the account doesn't exist or belongs to someone else.
async function getAccount(userId, accountId) {
  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getCredentials(account) {
  const { data, error } = await supabase
    .from('accounts')
    .select('credentials')
    .eq('id', account.id)
    .single();

  if (error) throw error;
  if (!data.credentials) throw new Error(`Account ${account.id} has no stored credentials, reconnect it`);
  return decryptJson(data.credentials);
}

// Saves the connector's sync position and stamps last_synced_at. Returns that timestamp.
async function saveSyncState(accountId, syncState) {
  const lastSyncedAt = new Date().toISOString();
  const { error } = await supabase
    .from('accounts')
    .update({ sync_state: syncState, last_synced_at: lastSyncedAt })
    .eq('id', accountId);

  if (error) throw error;
  return lastSyncedAt;
}

module.exports = {
  listAccounts,
  getAccount,
  getCredentials,
  saveSyncState,
  saveConnectedAccount,
  updateAccountSettings,
};
