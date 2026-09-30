const supabase = require('./supabase');
const { getMessageAccess } = require('./accounts');
const { connectorFor } = require('../connectors');

// The other emails in an opened email's conversation, shown under it.
// Conversations are per account: Gmail's thread id, or for IMAP the first
// Message-ID in the References chain (see connectors).

const MAX_SHOWN = 50;
const COLUMNS = 'id, account_id, sender, to_recipients, subject, snippet, received_at, labels';

// Most of the oldest Gmail mail was synced before thread ids were stored. The
// first time one of those is opened, Gmail says which emails share its
// conversation, and the thread id is saved on every stored one of them.
async function fillGmailThread(message, access) {
  const connector = connectorFor(access.provider);
  if (!connector.getThread) return null;
  const { threadId, messageIds } = await connector.getThread({
    credentials: access.credentials,
    messageExternalId: message.external_id,
  });
  const { error } = await supabase
    .from('messages')
    .update({ thread_id: threadId })
    .eq('account_id', message.account_id)
    .in('external_id', messageIds)
    .is('thread_id', null);
  if (error) throw error;
  return threadId;
}

// [{ id, account_id, sender, to_recipients, subject, snippet, received_at, labels }],
// newest first, without the email itself, spam or trash. null if the email
// doesn't exist or isn't this user's.
async function getConversation(userId, messageId) {
  const { data: message, error } = await supabase
    .from('messages')
    .select('id, account_id, external_id, thread_id, accounts!inner(user_id)')
    .eq('id', messageId)
    .eq('accounts.user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!message) return null;

  let threadId = message.thread_id;
  if (!threadId) {
    const access = await getMessageAccess(userId, messageId);
    threadId = await fillGmailThread(message, access);
  }
  if (!threadId) return [];

  const { data, error: listError } = await supabase
    .from('messages')
    .select(COLUMNS)
    .eq('account_id', message.account_id)
    .eq('thread_id', threadId)
    .neq('id', message.id)
    .not('labels', 'ov', '{SPAM,TRASH}')
    .order('received_at', { ascending: false })
    .limit(MAX_SHOWN);
  if (listError) throw listError;
  return data;
}

module.exports = { getConversation };
