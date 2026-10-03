const crypto = require('crypto');
const supabase = require('./supabase');
const { listAccounts, getCredentials, leastUsedColor, cleanColor } = require('./accounts');
const { cpanelConfigured, addForwarder, deleteForwarder } = require('./cpanel');
const { UserError } = require('./errors');
const { connectorFor } = require('../connectors');

// Temporary email addresses, like tempmail: each is a real forwarder on the
// mail host (TEMP_MAIL_DOMAIN, e.g. aaroncheung.me) into the connected IMAP
// mailbox on that domain. When one expires, the forwarder is removed (new mail
// bounces) and the emails it received are deleted from the app and the mailbox.

const LIFETIMES = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
};
const MAX_LABEL_CHARS = 60;
const MAX_ACTIVE = 50;

function tempDomain() {
  return (process.env.TEMP_MAIL_DOMAIN || '').trim().toLowerCase();
}

// The connected IMAP mailbox on the temp domain, which the addresses forward to
// (and which can delete their mail), or null.
function targetAccount(accounts) {
  const domain = tempDomain();
  if (!domain) return null;
  return accounts.find(a => a.provider === 'imap' && a.email_address.toLowerCase().endsWith(`@${domain}`)) || null;
}

// Why temp addresses can't be used right now, or null if they can.
function unavailableReason(accounts) {
  if (!cpanelConfigured() || !tempDomain()) return 'The server needs cPanel API details and TEMP_MAIL_DOMAIN to make temp addresses.';
  if (!targetAccount(accounts)) return `Connect a mailbox on ${tempDomain()} (Add account, Other) to use temp addresses.`;
  return null;
}

// 8 random characters, starting with a letter: k7x2m9qa
function randomLocalPart() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const chars = letters + '0123456789';
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b, i) => (i === 0 ? letters[b % letters.length] : chars[b % chars.length])).join('');
}

function lifetimeMs(lifetime) {
  const ms = LIFETIMES[lifetime];
  if (!ms) throw new UserError('Choose how long the address should last');
  return ms;
}

// Emails a temp address received: those sent to it (To or Cc) in its mailbox.
function receivedQuery(accountId, address, columns, options) {
  return supabase
    .from('messages')
    .select(columns, options)
    .eq('account_id', accountId)
    .or(`to_recipients.ilike.%${address}%,cc_recipients.ilike.%${address}%`);
}

// { available, reason, domain, addresses: [{ id, address, label, color, show_in_inbox, created_at, expires_at, received }] }
async function listTempAddresses(userId) {
  const reason = unavailableReason(await listAccounts(userId));
  const { data, error } = await supabase
    .from('temp_addresses')
    .select('id, account_id, address, label, color, show_in_inbox, created_at, expires_at')
    .eq('user_id', userId)
    .order('expires_at');
  if (error) throw error;

  const addresses = await Promise.all(data.map(async row => {
    const { count, error: countError } = await receivedQuery(row.account_id, row.address, 'id', { count: 'exact', head: true });
    if (countError) throw countError;
    const { account_id: accountId, ...rest } = row;
    return { ...rest, received: count || 0 };
  }));
  return { available: !reason, reason, domain: tempDomain(), addresses };
}

// Body: { lifetime: '1h' | '1d' | '1w' | '1m', label? }. Creates the forwarder,
// then remembers it; if remembering fails, the forwarder is removed again.
async function createTempAddress(userId, { lifetime, label }) {
  const expiresAt = new Date(Date.now() + lifetimeMs(lifetime)).toISOString();
  const accounts = await listAccounts(userId);
  const reason = unavailableReason(accounts);
  if (reason) throw new UserError(reason);
  const account = targetAccount(accounts);

  const { data: existing, error: existingError } = await supabase.from('temp_addresses').select('color').eq('user_id', userId);
  if (existingError) throw existingError;
  if (existing.length >= MAX_ACTIVE) throw new UserError(`You can have at most ${MAX_ACTIVE} temp addresses; delete some first`);

  const address = `${randomLocalPart()}@${tempDomain()}`;
  // the color used least so far, so its emails look different from the rest
  const color = leastUsedColor([...accounts, ...existing].map(item => item.color));
  await addForwarder(address, account.email_address);

  const { data, error } = await supabase
    .from('temp_addresses')
    .insert({
      user_id: userId,
      account_id: account.id,
      address,
      label: typeof label === 'string' ? label.trim().slice(0, MAX_LABEL_CHARS) : '',
      expires_at: expiresAt,
      color,
    })
    .select('id, address, label, color, show_in_inbox, created_at, expires_at')
    .single();
  if (error) {
    await deleteForwarder(address, account.email_address).catch(() => {});
    throw error;
  }
  return { ...data, received: 0 };
}

// Changes: { lifetime? (keeps it that long from now), color?, show_in_inbox? }.
// Returns { expires_at, color, show_in_inbox }, or null if not found.
async function updateTempAddress(userId, id, { lifetime, color, show_in_inbox: showInInbox }) {
  const changes = {};
  if (lifetime !== undefined) changes.expires_at = new Date(Date.now() + lifetimeMs(lifetime)).toISOString();
  const newColor = cleanColor(color);
  if (newColor) changes.color = newColor;
  if (typeof showInInbox === 'boolean') changes.show_in_inbox = showInInbox;
  if (!Object.keys(changes).length) throw new UserError('Nothing to change');

  const { data, error } = await supabase
    .from('temp_addresses')
    .update(changes)
    .eq('id', id)
    .eq('user_id', userId)
    .select('expires_at, color, show_in_inbox')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// The user's temp addresses whose emails are unchecked from the inbox.
async function hiddenTempAddresses(userId) {
  const { data, error } = await supabase
    .from('temp_addresses')
    .select('address')
    .eq('user_id', userId)
    .eq('show_in_inbox', false);
  if (error) {
    console.error('Looking up hidden temp addresses failed; showing all temp mail:', error.message);
    return [];
  }
  return data.map(row => row.address);
}

// Removes the forwarder first (so nothing new arrives), then deletes the
// emails it received from the mailbox and the app, then forgets the address.
// Any step failing leaves the row in place, so the next run tries again.
async function removeTempAddress(row) {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, provider, email_address')
    .eq('id', row.account_id)
    .maybeSingle();
  if (accountError) throw accountError;

  if (account) {
    if (cpanelConfigured()) await deleteForwarder(row.address, account.email_address);

    const { data: received, error } = await receivedQuery(account.id, row.address, 'id, external_id');
    if (error) throw error;
    if (received.length) {
      await connectorFor(account.provider).deleteMessages({
        credentials: await getCredentials(account),
        messageExternalIds: received.map(m => m.external_id),
      });
      const { error: deleteError } = await supabase.from('messages').delete().in('id', received.map(m => m.id));
      if (deleteError) throw deleteError;
    }
  }

  const { error: rowError } = await supabase.from('temp_addresses').delete().eq('id', row.id);
  if (rowError) throw rowError;
}

// "Delete now". Returns false if not found.
async function deleteTempAddress(userId, id) {
  const { data: row, error } = await supabase
    .from('temp_addresses')
    .select('id, account_id, address')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return false;
  await removeTempAddress(row);
  return true;
}

// Removes every expired address. Runs on each cron call and at startup.
async function expireTempAddresses() {
  const { data, error } = await supabase
    .from('temp_addresses')
    .select('id, account_id, address')
    .lte('expires_at', new Date().toISOString());
  if (error) throw error;

  for (const row of data) {
    try {
      await removeTempAddress(row);
      console.log(`Temp address ${row.address} expired and was removed`);
    } catch (err) {
      console.error(`Removing expired temp address ${row.address} failed; will retry:`, err.message);
    }
  }
}

// Adds temp_address: { address, label, color, expires_at } to each message sent to
// one of the user's temp addresses, so the app can mark it. The marks are
// extras: if they can't be looked up, the emails are returned unmarked.
async function markTempMail(userId, messages) {
  if (!messages.length) return messages;
  const { data, error } = await supabase
    .from('temp_addresses')
    .select('account_id, address, label, color, expires_at')
    .eq('user_id', userId);
  if (error) {
    console.error('Looking up temp addresses failed; emails shown without temp marks:', error.message);
    return messages;
  }
  if (!data.length) return messages;

  return messages.map(message => {
    const recipients = `${message.to_recipients || ''} ${message.cc_recipients || ''}`.toLowerCase();
    const temp = data.find(t => t.account_id === message.account_id && recipients.includes(t.address));
    return temp ? { ...message, temp_address: { address: temp.address, label: temp.label, color: temp.color, expires_at: temp.expires_at } } : message;
  });
}

module.exports = {
  listTempAddresses,
  createTempAddress,
  updateTempAddress,
  hiddenTempAddresses,
  deleteTempAddress,
  expireTempAddresses,
  markTempMail,
};
