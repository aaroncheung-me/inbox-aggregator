import { useRef, useState } from 'react';
import { askAssistant, deleteNote } from '../../api';

// The answer as it's being worked out, { question, steps, text }, updated
// with each progress event from askAssistant (see api.js).
function applyProgress(pending, event) {
  if (!pending) return pending;
  if (event.type === 'step') return { ...pending, steps: [...pending.steps, event.text] };
  if (event.type === 'text') return { ...pending, text: pending.text + event.delta };
  if (event.type === 'text_reset') return { ...pending, text: '' };
  return pending;
}

// A chat with the assistant: the conversation so far, the answer in progress,
// and Undo on notes it created. Used by the main assistant and by the one
// beside the writing screen. refreshNotes reloads the notes after it makes or
// removes one; onNoteDeleted(noteId) lets the screen let go of a deleted note.
export function useChat({ refreshNotes, refreshStatus, onNoteDeleted }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null); // the answer in progress, see applyProgress
  const [error, setError] = useState(null);
  // bumped when the chat starts over, so a late answer to the old one is dropped
  const session = useRef(0);

  // context: { openMessageId } (the email on screen, "this email" for the
  // assistant) or { draft } (the email being written), see askAssistant.
  async function ask(question, context = {}) {
    const askedIn = session.current;
    const current = () => askedIn === session.current;
    setLoading(true);
    setError(null);
    setPending({ question, steps: [], text: '' });
    try {
      // earlier exchanges go along so follow-up questions make sense
      const earlier = history.map(({ question: q, answer }) => ({ question: q, answer }));
      const result = await askAssistant(question, earlier, {
        ...context,
        onProgress: event => { if (current()) setPending(prev => applyProgress(prev, event)); },
      });
      if (!current()) return;
      setHistory(prev => [...prev, { question, ...result }]);
      if (result.createdNotes?.length) await refreshNotes();
    } catch (err) {
      if (current()) setError(err.message);
    } finally {
      if (current()) {
        setLoading(false);
        setPending(null);
      }
      refreshStatus();
    }
  }

  // Undo on a note the assistant created: deletes it and marks its card as undone.
  async function undoCreatedNote(exchangeIndex, noteId) {
    await deleteNote(noteId);
    onNoteDeleted(noteId);
    setHistory(prev => prev.map((exchange, i) => (i !== exchangeIndex ? exchange : {
      ...exchange,
      createdNotes: exchange.createdNotes.map(note => (note.id === noteId ? { ...note, undone: true } : note)),
    })));
    await refreshNotes();
  }

  // Starts over, from `withHistory` when bringing a conversation back.
  function reset(withHistory = []) {
    session.current++;
    setHistory(withHistory);
    setError(null);
    setLoading(false);
    setPending(null);
  }

  return { history, setHistory, loading, pending, error, ask, undoCreatedNote, reset };
}
