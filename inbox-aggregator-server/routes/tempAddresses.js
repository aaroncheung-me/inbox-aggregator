// Temp addresses (see lib/tempAddresses.js).
const express = require('express');
const { listTempAddresses, createTempAddress, updateTempAddress, deleteTempAddress } = require('../lib/tempAddresses');
const { withUserErrors } = require('../lib/http');

const router = express.Router();

// ---------- temp addresses ----------
// Throwaway addresses on the user's own domain, removed with their emails when
// they expire (see lib/tempAddresses.js).

// { available, reason, domain, addresses: [{ id, address, label, created_at, expires_at, received }] }
router.get('/temp-addresses', async (req, res) => {
  res.json(await listTempAddresses(req.userId));
});

// Body: { lifetime: '1h' | '1d' | '1w' | '1m', label? }. Returns the new address.
router.post('/temp-addresses', withUserErrors(async (req, res) => {
  res.status(201).json(await createTempAddress(req.userId, req.body || {}));
}));

// Body: { lifetime? (keeps it that long from now), color?, show_in_inbox? }.
// Returns { expires_at, color, show_in_inbox }.
router.patch('/temp-addresses/:id', withUserErrors(async (req, res) => {
  const updated = await updateTempAddress(req.userId, req.params.id, req.body || {});
  if (!updated) return res.status(404).send('Temp address not found');
  res.json(updated);
}));

// Deletes it now, with the emails it received.
router.delete('/temp-addresses/:id', withUserErrors(async (req, res) => {
  if (!await deleteTempAddress(req.userId, req.params.id)) return res.status(404).send('Temp address not found');
  res.status(204).end();
}));

module.exports = router;
