// Notes and their add-ons, AI save, and Organize.
const express = require('express');
const { listAccounts } = require('../lib/accounts');
const { aiSaveNote } = require('../lib/aiSave');
const { suggestOrganizing } = require('../lib/organize');
const { listNotes, createNote, updateNote, deleteNote, addAddon, updateAddon, removeAddon } = require('../lib/notes');
const { noteProviderSuccess } = require('../lib/providerStatus');
const { UserError } = require('../lib/errors');
const { withUserErrors, sendProviderFailure } = require('../lib/http');

const router = express.Router();

// ---------- notes ----------
// A note is text; reminders, links to emails or other notes, and pins are
// add-ons attached to it. See lib/notes.js for the shapes returned.

router.get('/notes', async (req, res) => {
  res.json(await listNotes(req.userId));
});

// Body: { body, addons?: [{ kind, remindAt?, messageId?, noteId? }] }. Returns { id }.
// All or nothing: if any add-on is rejected, the new note is removed again, so
// the user can fix it and save once more without leaving a half-made note behind.
router.post('/notes', withUserErrors(async (req, res) => {
  const id = await createNote(req.userId, req.body?.body);
  try {
    for (const addon of Array.isArray(req.body?.addons) ? req.body.addons : []) {
      await addAddon(req.userId, id, addon);
    }
  } catch (err) {
    await deleteNote(req.userId, id).catch(() => {});
    throw err;
  }
  res.status(201).json({ id });
}));

// AI save. Body: { text, addons?: [...picked by hand], timeZone }. The AI
// rewrites the text and adds reminder, pin and links; returns { id, message, usage }.
// Declared before /notes/:noteId so "ai-save" isn't taken as an id.
router.post('/notes/ai-save', withUserErrors(async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 10000) : '';
  if (!text) throw new UserError('Write something first');

  const accounts = await listAccounts(req.userId);
  try {
    const saved = await aiSaveNote({
      userId: req.userId,
      accountIds: accounts.filter(a => a.show_in_inbox).map(a => a.id),
      ownAddresses: accounts.map(a => a.email_address.toLowerCase()),
      text,
      manualAddons: Array.isArray(req.body.addons) ? req.body.addons : [],
      timeZone: req.body.timeZone,
    });
    noteProviderSuccess('anthropic');
    res.status(201).json(saved);
  } catch (err) {
    sendProviderFailure(res, err, 'AI save', ' Your note was not saved; try again or use Save.');
  }
}));

// Organize. Body: { timeZone }. The AI suggests pins, unpins, links, finished
// reminders and a better order; nothing changes until the user applies them
// (through the ordinary note routes). Returns { changes, order, usage }.
router.post('/notes/organize', async (req, res) => {
  try {
    const suggestions = await suggestOrganizing({ userId: req.userId, timeZone: req.body?.timeZone });
    noteProviderSuccess('anthropic');
    res.json(suggestions);
  } catch (err) {
    sendProviderFailure(res, err, 'Organize');
  }
});

// Body: { body?, position? }
router.patch('/notes/:noteId', withUserErrors(async (req, res) => {
  const updated = await updateNote(req.userId, req.params.noteId, req.body || {});
  if (!updated) return res.status(404).send('Note not found');
  res.status(204).end();
}));

router.delete('/notes/:noteId', async (req, res) => {
  if (!await deleteNote(req.userId, req.params.noteId)) return res.status(404).send('Note not found');
  res.status(204).end();
});

// Body: { kind: 'reminder' | 'email_link' | 'note_link' | 'pin', remindAt?, messageId?, noteId? }
router.post('/notes/:noteId/addons', withUserErrors(async (req, res) => {
  const id = await addAddon(req.userId, req.params.noteId, req.body || {});
  if (id == null) return res.status(404).send('Note not found');
  res.status(201).json({ id });
}));

// Body: { remindAt?, done? } (reminders only)
router.patch('/note-addons/:addonId', withUserErrors(async (req, res) => {
  if (!await updateAddon(req.userId, req.params.addonId, req.body || {})) return res.status(404).send('Add-on not found');
  res.status(204).end();
}));

router.delete('/note-addons/:addonId', async (req, res) => {
  if (!await removeAddon(req.userId, req.params.addonId)) return res.status(404).send('Add-on not found');
  res.status(204).end();
});

module.exports = router;
