// The email list, search, one email (with its formatted version, conversation and attachments), and pins.
const express = require('express');
const { listMessages, searchMessages, getMessage, setPinned, getReplyTo } = require('../lib/messages');
const { getEmailHtml } = require('../lib/emailHtml');
const { getConversation } = require('../lib/conversations');
const { downloadAttachmentFile } = require('../lib/attachments');
const { withUserErrors } = require('../lib/http');

const router = express.Router();

function pageOf(query) {
  return { limit: Math.min(parseInt(query.limit) || 25, 100), offset: parseInt(query.offset) || 0 };
}

// The inbox, or ?folder=sent; ?accountId= for one account. The first page
// (offset 0) also returns the pinned emails as `pinned` (see lib/messages.js).
router.get('/messages', async (req, res) => {
  const page = pageOf(req.query);
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  const result = await listMessages(req.userId, { accountId, sent: req.query.folder === 'sent', ...page });
  res.json({ ...result, ...page });
});

// ?q= words plus from:, after:, before:, has:attachment. Declared before
// /messages/:messageId so "search" isn't taken as an id.
router.get('/messages/search', async (req, res) => {
  const page = pageOf(req.query);
  res.json({ ...await searchMessages(req.userId, req.query.q, page), ...page });
});

// Includes the notes stuck to it.
router.get('/messages/:messageId', async (req, res) => {
  const message = await getMessage(req.userId, req.params.messageId);
  if (!message) return res.status(404).send('Message not found');
  res.json(message);
});

// Body: { pinned: boolean }. Returns { pinned_at }.
router.patch('/messages/:messageId', async (req, res) => {
  if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ error: 'Send { pinned: true | false }' });
  const pinnedAt = await setPinned(req.userId, req.params.messageId, req.body.pinned);
  if (pinnedAt === undefined) return res.status(404).send('Message not found');
  res.json({ pinned_at: pinnedAt });
});

// What replying needs that isn't stored: { replyTo }, null when unknown.
router.get('/messages/:messageId/reply-info', async (req, res) => {
  const replyTo = await getReplyTo(req.userId, req.params.messageId);
  if (replyTo === undefined) return res.status(404).send('Message not found');
  res.json({ replyTo });
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

// Every email of its conversation, itself included, newest first (see lib/conversations.js).
// On failure the email simply shows without them.
router.get('/messages/:messageId/conversation', async (req, res) => {
  try {
    const conversation = await getConversation(req.userId, req.params.messageId);
    if (!conversation) return res.status(404).send('Message not found');
    res.json(conversation);
  } catch (err) {
    console.error(`Loading the conversation of message ${req.params.messageId} failed:`, err.message);
    res.status(502).json({ error: "Couldn't load the conversation" });
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
