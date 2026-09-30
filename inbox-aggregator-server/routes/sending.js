// Sending email, with its 15-second undo (see lib/outbox.js).
const express = require('express');
const { queueEmail, cancelEmail, emailStatus } = require('../lib/outbox');
const { withUserErrors } = require('../lib/http');

const router = express.Router();

// ---------- sending ----------

// Body: { accountId, to, cc, bcc, subject, body, replyToMessageId? }, addresses
// comma-separated. The email waits 15 seconds (so it can be undone), then sends.
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
