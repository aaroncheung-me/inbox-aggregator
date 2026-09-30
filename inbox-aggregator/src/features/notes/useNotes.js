import { useEffect, useState } from 'react';
import {
  getNotes,
  createNote,
  aiSaveNote,
  suggestOrganizing,
  updateNote,
  deleteNote,
  addNoteAddon,
  updateNoteAddon,
  removeNoteAddon,
} from '../../api';

// The notes. Every change goes to the server, then the list is reloaded from
// it, so the app always shows what's saved (notes are few, so reloading is cheap).
// refreshStatus: re-checks the AI providers after an AI call.
export function useNotes({ onNotice, refreshStatus }) {
  const [notes, setNotes] = useState([]);
  // a heads-up from the last AI save, shown on the note it made: { noteId, message }
  const [aiHeadsUp, setAiHeadsUp] = useState(null);

  useEffect(() => {
    getNotes().then(setNotes).catch(() => {});
  }, []);

  async function refresh() {
    setNotes(await getNotes());
  }

  // Returns the new note's id.
  async function create(body, addons) {
    const { id } = await createNote(body, addons);
    await refresh();
    return id;
  }

  // AI save: the AI rewrites the text and adds more add-ons. Anything it wants
  // the user to know (e.g. an email it couldn't find) becomes the heads-up.
  // Returns the new note's id.
  async function aiSave(body, addons) {
    try {
      const { id, message } = await aiSaveNote(body, addons);
      await refresh();
      setAiHeadsUp(message ? { noteId: id, message } : null);
      return id;
    } finally {
      refreshStatus();
    }
  }

  async function saveBody(noteId, body) {
    await updateNote(noteId, { body });
    setNotes(prev => prev.map(note => (note.id === noteId ? { ...note, body } : note)));
  }

  // Dragging: moves the note on screen straight away, then saves the new position.
  async function move(noteId, position) {
    setNotes(prev => prev
      .map(note => (note.id === noteId ? { ...note, position } : note))
      .sort((a, b) => a.position - b.position));
    try {
      await updateNote(noteId, { position });
    } catch (err) {
      console.error(err);
      onNotice({ type: 'error', text: "Couldn't save the new order, try again" });
      refresh().catch(() => {});
    }
  }

  async function suggest() {
    try {
      return await suggestOrganizing();
    } finally {
      refreshStatus();
    }
  }

  // Applies the Organize suggestions the user kept, through the same routes as
  // doing each by hand. order: { noteIds } in their new order, or null.
  async function applyOrganizing(changes, order) {
    const byId = new Map(notes.map(note => [note.id, note]));
    try {
      for (const change of changes) {
        const note = byId.get(change.noteId);
        if (!note) continue;
        if (change.action === 'pin') await addNoteAddon(note.id, { kind: 'pin' });
        if (change.action === 'unpin' && note.pin) await removeNoteAddon(note.pin.id);
        if (change.action === 'mark_done' && note.reminder) await updateNoteAddon(note.reminder.id, { done: true });
        if (change.action === 'link') await addNoteAddon(note.id, { kind: 'note_link', noteId: change.otherNoteId });
      }
      if (order) {
        // positions 0, 1, 2... in the new order, saving only the ones that change
        for (const [index, noteId] of order.noteIds.entries()) {
          if (byId.get(noteId)?.position !== index) await updateNote(noteId, { position: index });
        }
      }
    } finally {
      await refresh();
    }
  }

  // onDeleted runs once it's gone, before the list reloads.
  async function remove(noteId, onDeleted) {
    await deleteNote(noteId);
    onDeleted?.();
    await refresh();
  }

  async function addAddon(noteId, addon) {
    await addNoteAddon(noteId, addon);
    await refresh();
  }

  async function updateAddon(addonId, changes) {
    await updateNoteAddon(addonId, changes);
    await refresh();
  }

  async function removeAddon(addonId) {
    await removeNoteAddon(addonId);
    await refresh();
  }

  return {
    notes,
    setNotes,
    aiHeadsUp,
    dismissAiHeadsUp: () => setAiHeadsUp(null),
    refresh,
    create,
    aiSave,
    saveBody,
    move,
    suggest,
    applyOrganizing,
    remove,
    addAddon,
    updateAddon,
    removeAddon,
  };
}
