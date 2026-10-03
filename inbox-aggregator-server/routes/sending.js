// Sending email, with its 15-second undo (see lib/outbox.js).
const express = require('express');
const { queueEmail, cancelEmail, listScheduled, sendNow, emailStatus } = require('../lib/outbox');
const { saveUpload } = require('../lib/outboxFiles');
const { withUserErrors } = require('../lib/http');

const router = express.Router();

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
// attachments?: [{ uploadId, filename, mimeType, size }], forwardedAttachmentIds?,
// sendAt? }, addresses comma-separated. The email waits 15 seconds (so it can be
// undone), then sends; with sendAt (Send later) it waits until then.
// Returns { id, sendAt, scheduled }; 400 with { error } when something needs fixing.
router.post('/send', withUserErrors(async (req, res) => {
  res.status(201).json(await queueEmail(req.userId, req.body || {}));
}));

// { status: 'waiting' | 'sending' | 'sent' | 'failed', error }
router.get('/send/:outboxId', async (req, res) => {
  const status = await emailStatus(req.userId, req.params.outboxId);
  if (!status) return res.status(404).send('Not found');
  res.json(status);
});

// Undo, or Cancel on a scheduled email. ?edit=1 (Edit on a scheduled email)
// keeps its uploaded files and returns the email to reopen, see listScheduled.
// 409 when it's too late (already sending or sent).
router.delete('/send/:outboxId', async (req, res) => {
  const edit = req.query.edit === '1';
  const email = await cancelEmail(req.userId, req.params.outboxId, { keepFiles: edit });
  if (!email) return res.status(409).json({ error: 'Too late, it has already been sent' });
  if (edit) return res.json(email);
  res.status(204).end();
});

// Scheduled emails (Send later) not yet sent, soonest first; failed ones carry
// failed: the reason. See listScheduled in lib/outbox.js for the shape.
router.get('/scheduled', async (req, res) => {
  res.json(await listScheduled(req.userId));
});

// "Send now" on a scheduled email. 409 when it's no longer waiting.
router.post('/send/:outboxId/now', async (req, res) => {
  if (!await sendNow(req.userId, req.params.outboxId)) {
    return res.status(409).json({ error: 'It has already been sent or cancelled' });
  }
  res.status(204).end();
});

module.exports = router;
