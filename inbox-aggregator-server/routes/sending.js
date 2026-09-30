// Sending email, with its 15-second undo (see lib/outbox.js).
const express = require('express');
const { queueEmail, cancelEmail, emailStatus } = require('../lib/outbox');
const { saveUpload } = require('../lib/outboxFiles');
const { withUserErrors } = require('../lib/http');

const router = express.Router();

// ---------- sending ----------

// One file to attach to an email about to be sent, as the raw request body
// (always sent as application/octet-stream, so no other parser touches it;
// its real type is in X-Content-Type). Returns { uploadId } for POST /send.
// The body is only read here, after sign-in has been checked.
router.post('/send/uploads', express.raw({ type: () => true, limit: '25mb' }), withUserErrors(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'The file was empty' });
  const uploadId = await saveUpload(req.userId, req.body, req.get('x-content-type'));
  res.status(201).json({ uploadId });
}));

// Body: { accountId, to, cc, bcc, subject, body, replyToMessageId?,
// attachments?: [{ uploadId, filename, mimeType, size }], forwardedAttachmentIds? },
// addresses comma-separated. The email waits 15 seconds (so it can be undone), then sends.
// Returns { id, sendAt }; 400 with { error } when something needs fixing.
router.post('/send', withUserErrors(async (req, res) => {
  res.status(201).json(await queueEmail(req.userId, req.body || {}));
}));

// { status: 'waiting' | 'sending' | 'sent' | 'failed', error }
router.get('/send/:outboxId', async (req, res) => {
  const status = await emailStatus(req.userId, req.params.outboxId);
  if (!status) return res.status(404).send('Not found');
  res.json(status);
});

// Undo. 409 when it's too late (already sending or sent).
router.delete('/send/:outboxId', async (req, res) => {
  if (!await cancelEmail(req.userId, req.params.outboxId)) {
    return res.status(409).json({ error: 'Too late to undo, it has already been sent' });
  }
  res.status(204).end();
});

module.exports = router;
