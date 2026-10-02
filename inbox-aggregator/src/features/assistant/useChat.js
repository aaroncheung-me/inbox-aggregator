import { useState } from 'react';
import { askAssistant, deleteNote } from '../../api';

// The assistant's answer as it's being worked out, { question, steps, text },
// updated with each progress event from askAssistant (see api.js).
export function applyProgress(pending, event) {
  if (!pending) return pending;
  if (event.type === 'step') return { ...pending, steps: [...pending.steps, event.text] };
  if (event.type === 'text') return { ...pending, text: pending.text + event.delta };
  if (event.type === 'text_reset') return { ...pending, text: '' };
  return pending;
}

// Marks one note on one exchange's cards as undone.
export function markNoteUndone(history, exchangeIndex, noteId) {
  return history.map((exchange, i) => (i !== exchangeIndex ? exchange : {
    ...exchange,
    createdNotes: exchange.createdNotes.map(note => (note.id === noteId ? { ...note, undone: true } : note)),
  }));
}

// The assistant chat: the conversation so far, the answer in progress, and
// Undo on notes it created. refreshNotes reloads the notes after it makes or
// removes one; onNoteDeleted(noteId) lets the screen let go of a deleted note.
export function useChat({ refreshNotes, refreshStatus, onNoteDeleted }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null); // the answer in progress, see applyProgress
  const [error, setError] = useState(null);

  // openMessageId: the email on screen when asking, "this email" for the assistant
  async function ask(question, openMessageId) {
    setLoading(true);
    setError(null);
    setPending({ question, steps: [], text: '' });
    try {
      // earlier exchanges go along so follow-up questions make sense
      const earlier = history.map(({ question: q, answer }) => ({ question: q, answer }));
      const result = await askAssistant(question, earlier, {
        openMessageId,
        onProgress: event => setPending(prev => applyProgress(prev, event)),
      });
      setHistory(prev => [...prev, { question, ...result }]);
      if (result.createdNotes?.length) await refreshNotes();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPending(null);
      refreshStatus();
    }
  }

  // Undo on a note the assistant created: deletes it and marks its card as undone.
  async function undoCreatedNote(exchangeIndex, noteId) {
    await deleteNote(noteId);
    onNoteDeleted(noteId);
    setHistory(prev => markNoteUndone(prev, exchangeIndex, noteId));
    await refreshNotes();
  }

  // New chat: starts over, so the next question doesn't carry the earlier ones
  function newChat() {
    if (loading) return;
    setHistory([]);
    setError(null);
  }

  return { history, loading, pending, error, ask, undoCreatedNote, newChat };
}
