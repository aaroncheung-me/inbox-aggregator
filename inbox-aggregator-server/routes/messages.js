// The email list, search, one email (with its formatted version and attachments), and pins.
const express = require('express');
const supabase = require('../lib/supabase');
const { listAccounts, getMessageAccess } = require('../lib/accounts');
const { keywordSearch, parseSearchQuery } = require('../lib/search');
const { getEmailHtml } = require('../lib/emailHtml');
const { downloadAttachmentFile } = require('../lib/attachments');
const { notesForMessage } = require('../lib/notes');
const { hiddenTempAddresses, markTempMail } = require('../lib/tempAddresses');
const { connectorFor } = require('../connectors');
const { withUserErrors } = require('../lib/http');

const router = express.Router();

async function userAccountIds(userId) {
  return (await listAccounts(userId)).map(a => a.id);
}

// accounts left checked in the app's accounts panel
async function visibleAccountIds(userId) {
  return (await listAccounts(userId)).filter(a => a.show_in_inbox).map(a => a.id);
}

// ---------- messages ----------

// Unified inbox across all shown accounts, or one of them with ?accountId=.
// ?folder=sent lists sent mail instead. The inbox is everything except spam,
// trash and mail that was only sent: archived Gmail mail stays in it, and an
// email between two of your own accounts shows under Sent from one and here,
// as received, in the other.
// Pinned emails are listed apart, above Received: its first page (offset 0)
// also returns them as `pinned`, and the list below leaves them out.
const LIST_COLUMNS = 'id, account_id, sender, to_recipients, subject, snippet, received_at, is_read, has_attachments, pinned_at';
const MAX_PINNED = 50;
// Images smaller than this are nearly always logos, banners or signature
// pictures shown inside the email: on real mail, most "attachment" emails had
// only these, up to 86 KB (IMAP counts the encoded size, about a third more
// than Gmail does). Photos people attach are usually far bigger.
const SMALL_IMAGE_BYTES = 100 * 1024;

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

router.get('/messages', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const offset = parseInt(req.query.offset) || 0;

  let accountIds = await visibleAccountIds(req.userId);
  if (req.query.accountId) accountIds = accountIds.filter(id => id === Number(req.query.accountId));
  const sent = req.query.folder === 'sent';
  if (!accountIds.length) return res.json({ messages: [], pinned: [], total: 0, limit, offset });

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
  if (!sent) {
    for (const address of await hiddenTempAddresses(req.userId)) {
      query = query.or(`to_recipients.is.null,to_recipients.not.ilike.%${address}%`);
    }
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
  res.json({
    messages: await markFiles(await markTempMail(req.userId, list.data)),
    pinned: await markFiles(await markTempMail(req.userId, pinned.data)),
    total: list.count,
    limit,
    offset,
  });
});

// Basic search, no AI: ?q= words plus Gmail-style operators
// (from:name, after:YYYY-MM-DD, before:YYYY-MM-DD, has:attachment), best matches first.
// Declared before /messages/:messageId so "search" isn't taken as an id.
router.get('/messages/search', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const offset = parseInt(req.query.offset) || 0;
  const { text, filters } = parseSearchQuery(req.query.q);

  const accountIds = await visibleAccountIds(req.userId);
  if (!accountIds.length || (!text && !Object.keys(filters).length)) {
    return res.json({ messages: [], hasMore: false, limit, offset });
  }

  // one extra row tells us whether there's another page
  const rows = await keywordSearch(req.userId, accountIds, text, { filters, limit: limit + 1, offset });
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
  const marked = await markTempMail(req.userId, found.map(m => ({ ...m, ...recipients.get(m.id) })));

  res.json({
    messages: await markFiles(marked),
    hasMore: rows.length > limit,
    limit,
    offset,
  });
});

router.get('/messages/:messageId', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select(`
      id, account_id, thread_id, sender, to_recipients, cc_recipients, subject, body, snippet,
      received_at, labels, is_read, pinned_at, attachments(id, external_id, filename, mime_type, size_bytes),
      accounts!inner(user_id)
    `)
    .eq('id', req.params.messageId)
    .eq('accounts.user_id', req.userId) // only the user's own email
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).send('Message not found');
  const message = { ...data };
  delete message.accounts;

  // which temp address it came to, if any, and the notes stuck to it, looked up side by side
  const [[marked], notes] = await Promise.all([
    markTempMail(req.userId, [message]),
    notesForMessage(req.userId, message.id),
  ]);
  res.json({ ...marked, notes });
});

// Body: { pinned: boolean }. Pins live only in the app. Returns { pinned_at }.
router.patch('/messages/:messageId', async (req, res) => {
  if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ error: 'Send { pinned: true | false }' });

  const { data: message, error } = await supabase
    .from('messages')
    .select('account_id')
    .eq('id', req.params.messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message || !(await userAccountIds(req.userId)).includes(message.account_id)) {
    return res.status(404).send('Message not found');
  }

  const pinnedAt = req.body.pinned ? new Date().toISOString() : null;
  const { error: updateError } = await supabase
    .from('messages')
    .update({ pinned_at: pinnedAt })
    .eq('id', req.params.messageId);
  if (updateError) throw updateError;
  res.json({ pinned_at: pinnedAt });
});

// What replying needs that isn't stored: { replyTo } (the address replies
// should go to, when the sender asked for a different one), or null when unknown.
router.get('/messages/:messageId/reply-info', async (req, res) => {
  const access = await getMessageAccess(req.userId, req.params.messageId);
  if (!access) return res.status(404).send('Message not found');

  try {
    const headers = await connectorFor(access.provider).getReplyHeaders({
      credentials: access.credentials,
      messageExternalId: access.externalId,
    });
    res.json({ replyTo: headers.replyTo });
  } catch (err) {
    // replying still works without it, to the sender
    console.error(`Looking up reply details for message ${req.params.messageId} failed:`, err.message);
    res.json({ replyTo: null });
  }
});

// The email's formatted version, fetched from the mail provider as it's opened:
// { html, inlinePartIds } (see lib/emailHtml.js). html is null for plain-text
// email, and on failure the app keeps showing the stored plain text.
router.get('/messages/:messageId/html', async (req, res) => {
  try {
    const result = await getEmailHtml(req.userId, req.params.messageId);
    if (!result) return res.status(404).send('Message not found');
    res.json(result);
  } catch (err) {
    console.error(`Fetching the formatted version of message ${req.params.messageId} failed:`, err.message);
    res.status(502).json({ error: "Couldn't load this email's formatting" });
  }
});

// The attachment's file, for saving.
router.get('/attachments/:attachmentId', withUserErrors(async (req, res) => {
  const file = await downloadAttachmentFile(req.userId, req.params.attachmentId);
  if (!file) return res.status(404).send('Attachment not found');

  const filename = file.filename || 'attachment';
  res.set({
    'Content-Type': file.mimeType || 'application/octet-stream',
    // the ASCII name for old clients, the exact one (RFC 5987) for everything else
    'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.send(file.buffer);
}));

module.exports = router;
