const supabase = require('./supabase');
const { listAccounts, getMessageAccess } = require('./accounts');
const { keywordSearch, parseSearchQuery } = require('./search');
const { notesForMessage } = require('./notes');
const { hiddenTempAddresses, markTempMail } = require('./tempAddresses');
const { connectorFor } = require('../connectors');

// The email list, search, one email, pins and reply details.

const LIST_COLUMNS = 'id, account_id, sender, to_recipients, subject, snippet, received_at, is_read, has_attachments, pinned_at';
const MAX_PINNED = 50;
// Images smaller than this are nearly always logos, banners or signature
// pictures shown inside the email: on real mail, most "attachment" emails had
// only these, up to 86 KB (IMAP counts the encoded size, about a third more
// than Gmail does). Photos people attach are usually far bigger.
const SMALL_IMAGE_BYTES = 100 * 1024;

// accounts left checked in the app's accounts panel
async function visibleAccountIds(userId) {
  return (await listAccounts(userId)).filter(a => a.show_in_inbox).map(a => a.id);
}

// Adds has_files to listed emails: whether they carry a file worth a paperclip
// in the list, leaving out small images (see SMALL_IMAGE_BYTES).
async function markFiles(messages) {
  const ids = messages.filter(m => m.has_attachments).map(m => m.id);
  let withFiles = new Set();
  if (ids.length) {
    const { data, error } = await supabase
      .from('attachments')
      .select('message_id, mime_type, size_bytes')
      .in('message_id', ids);
    if (error) throw error;
    withFiles = new Set(data
      .filter(a => !(a.mime_type || '').startsWith('image/') || (a.size_bytes || 0) >= SMALL_IMAGE_BYTES)
      .map(a => a.message_id));
  }
  return messages.map(m => ({ ...m, has_files: withFiles.has(m.id) }));
}

// Unified inbox across all shown accounts, or just accountId. sent lists sent
// mail instead. The inbox is everything except spam, trash and mail that was
// only sent: archived Gmail mail stays in it, and an email between two of the
// user's own accounts shows under Sent from one and as received in the other.
// Pinned emails are listed apart, above Received: its first page (offset 0)
// also returns them as `pinned`, and the list leaves them out.
// Returns { messages, pinned, total }.
async function listMessages(userId, { accountId, sent, limit, offset }) {
  const [visibleIds, hiddenAddresses] = await Promise.all([
    visibleAccountIds(userId),
    sent ? [] : hiddenTempAddresses(userId),
  ]);
  const accountIds = accountId == null ? visibleIds : visibleIds.filter(id => id === accountId);
  if (!accountIds.length) return { messages: [], pinned: [], total: 0 };

  let query = supabase
    .from('messages')
    .select(LIST_COLUMNS, { count: 'exact' })
    .in('account_id', accountIds);
  query = sent
    ? query.contains('labels', ['SENT'])
    : query
      .or('labels.cs.{INBOX},labels.not.cs.{SENT}')
      .not('labels', 'ov', '{SPAM,TRASH}')
      .is('pinned_at', null);
  // emails to temp addresses unchecked in the accounts section (a missing To counts as not theirs)
  for (const address of hiddenAddresses) {
    query = query.or(`to_recipients.is.null,to_recipients.not.ilike.%${address}%`);
  }

  const [list, pinned] = await Promise.all([
    query
      .order('received_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1),
    sent || offset > 0
      ? { data: [] }
      : supabase
        .from('messages')
        .select(LIST_COLUMNS)
        .in('account_id', accountIds)
        .not('pinned_at', 'is', null)
        .order('pinned_at', { ascending: false })
        .limit(MAX_PINNED),
  ]);
  if (list.error) throw list.error;
  if (pinned.error) throw pinned.error;

  // marked together, so each mark is one lookup
  const marked = await markFiles(await markTempMail(userId, [...list.data, ...pinned.data]));
  return { messages: marked.slice(0, list.data.length), pinned: marked.slice(list.data.length), total: list.count };
}

// Basic search, no AI: words plus Gmail-style operators (see parseSearchQuery),
// best matches first. Returns { messages, hasMore }.
async function searchMessages(userId, q, { limit, offset }) {
  const { text, filters } = parseSearchQuery(q);
  const accountIds = await visibleAccountIds(userId);
  if (!accountIds.length || (!text && !Object.keys(filters).length)) return { messages: [], hasMore: false };

  // one extra row tells whether there's another page
  const rows = await keywordSearch(userId, accountIds, text, { filters, limit: limit + 1, offset });
  const found = rows.slice(0, limit).map(({ body, score, ...message }) => message);

  // search doesn't return recipients, which the Temp mark needs
  let recipients = new Map();
  if (found.length) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, to_recipients, cc_recipients')
      .in('id', found.map(m => m.id));
    if (error) throw error;
    recipients = new Map(data.map(m => [m.id, m]));
  }
  const marked = await markTempMail(userId, found.map(m => ({ ...m, ...recipients.get(m.id) })));
  return { messages: await markFiles(marked), hasMore: rows.length > limit };
}

// One email with its attachments, temp-address mark and the notes stuck to
// it, or null if it doesn't exist or isn't this user's.
async function getMessage(userId, messageId) {
  const { data, error } = await supabase
    .from('messages')
    .select(`
      id, account_id, thread_id, sender, to_recipients, cc_recipients, subject, body, snippet,
      received_at, labels, is_read, pinned_at, attachments(id, external_id, filename, mime_type, size_bytes),
      accounts!inner(user_id)
    `)
    .eq('id', messageId)
    .eq('accounts.user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { accounts, ...message } = data;
  const [[marked], notes] = await Promise.all([
    markTempMail(userId, [message]),
    notesForMessage(userId, message.id),
  ]);
  return { ...marked, notes };
}

// Pins live only in the app. Returns the new pinned_at, or undefined if the
// email isn't this user's.
async function setPinned(userId, messageId, pinned) {
  const { data: message, error } = await supabase
    .from('messages')
    .select('id, accounts!inner(user_id)')
    .eq('id', messageId)
    .eq('accounts.user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!message) return undefined;

  const pinnedAt = pinned ? new Date().toISOString() : null;
  const { error: updateError } = await supabase.from('messages').update({ pinned_at: pinnedAt }).eq('id', message.id);
  if (updateError) throw updateError;
  return pinnedAt;
}

// The address replies should go to, when the sender asked for a different one
// (Reply-To), else null; undefined if the email isn't this user's. Replying
// works without it, so a failed lookup is only logged.
async function getReplyTo(userId, messageId) {
  const access = await getMessageAccess(userId, messageId);
  if (!access) return undefined;
  try {
    const headers = await connectorFor(access.provider).getReplyHeaders({
      credentials: access.credentials,
      messageExternalId: access.externalId,
    });
    return headers.replyTo;
  } catch (err) {
    console.error(`Looking up reply details for message ${messageId} failed:`, err.message);
    return null;
  }
}

module.exports = { listMessages, searchMessages, getMessage, setPinned, getReplyTo };
