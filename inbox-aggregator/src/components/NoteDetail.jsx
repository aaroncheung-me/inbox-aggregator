import { useEffect, useRef, useState } from 'react';
import { formatReminder, noteTitle, reminderIsDue } from '../notes';
import { EmailLinkPicker, NoteLinkPicker, ReminderPicker } from './NoteAddonPickers';

const SAVE_DELAY_MS = 800;
const SAVE_LABELS = { saved: 'Saved', unsaved: 'Editing...', saving: 'Saving...', error: "Couldn't save, keep typing to retry" };

// Marks add-ons the AI attached, so it's always clear what it did.
function AiTag({ addedBy }) {
  return addedBy === 'ai' ? <span className="ai-tag" title="Added by the AI">AI</span> : null;
}

// One note in the main pane: its text (saved as you type) and its add-ons.
// The parent gives this component a key per note, so switching notes starts fresh.
function NoteDetail({ note, notes, now, onSaveBody, onDelete, onAddAddon, onUpdateAddon, onRemoveAddon, onOpenMessage, onOpenNote }) {
  const [draft, setDraft] = useState(note.body);
  const [saveState, setSaveState] = useState('saved');
  const [picker, setPicker] = useState(null); // 'reminder' | 'email' | 'note' | null
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState(null);

  // text typed but not yet sent; flushed on blur and when leaving the note
  const pendingText = useRef(null);
  const saveTimer = useRef(null);
  const saveBody = useRef(onSaveBody);
  useEffect(() => { saveBody.current = onSaveBody; });

  async function save(text) {
    clearTimeout(saveTimer.current);
    pendingText.current = null;
    setSaveState('saving');
    try {
      await saveBody.current(note.id, text);
      setSaveState(current => (current === 'saving' ? 'saved' : current));
    } catch {
      setSaveState('error');
    }
  }

  function handleChange(text) {
    setDraft(text);
    setSaveState('unsaved');
    pendingText.current = text;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(text), SAVE_DELAY_MS);
  }

  // leaving the note (or closing the app view) saves anything still pending
  useEffect(() => {
    const noteId = note.id;
    return () => {
      clearTimeout(saveTimer.current);
      if (pendingText.current !== null) saveBody.current(noteId, pendingText.current).catch(() => {});
    };
  }, [note.id]);

  // Runs an add-on change, closing any open picker and showing errors inline.
  async function run(action) {
    setError(null);
    try {
      await action();
      setPicker(null);
      setMenuOpen(false);
    } catch (err) {
      setError(err.message);
    }
  }

  function openPicker(kind) {
    setPicker(kind);
    setMenuOpen(false);
  }

  const reminder = note.reminder;
  const due = reminderIsDue(reminder, now);
  const linkedNoteIds = new Set(note.noteLinks.map(link => link.noteId));
  const linkableNotes = notes.filter(other => other.id !== note.id && !linkedNoteIds.has(other.id));
  const hasAddons = reminder || note.pin || note.emailLinks.length || note.noteLinks.length;

  return (
    <div className="note-detail">
      <textarea
        className="note-body"
        value={draft}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => { if (pendingText.current !== null) save(pendingText.current); }}
        placeholder="Write something..."
        aria-label="Note text"
        rows={8}
      />
      <div className={`save-state ${saveState}`}>{SAVE_LABELS[saveState]}</div>

      {hasAddons && (
        <div className="note-addons">
          {reminder && (
            <div className={`addon-chip reminder${due ? ' due' : ''}${reminder.done_at ? ' done' : ''}`}>
              <label className="reminder-done" title={reminder.done_at ? 'Mark as not done' : 'Mark as done'}>
                <input
                  type="checkbox"
                  checked={!!reminder.done_at}
                  onChange={e => run(() => onUpdateAddon(reminder.id, { done: e.target.checked }))}
                />
              </label>
              <button className="addon-chip-main" onClick={() => openPicker('reminder')} title="Change the time">
                ⏰ {formatReminder(reminder.remind_at)}{due ? ' · due' : ''}
              </button>
              <AiTag addedBy={reminder.added_by} />
              <button className="addon-remove" onClick={() => run(() => onRemoveAddon(reminder.id))} aria-label="Remove reminder">×</button>
            </div>
          )}

          {note.pin && (
            <div className="addon-chip">
              <span className="addon-chip-main">📌 Pinned</span>
              <AiTag addedBy={note.pin.added_by} />
              <button className="addon-remove" onClick={() => run(() => onRemoveAddon(note.pin.id))} aria-label="Unpin">×</button>
            </div>
          )}

          {note.emailLinks.map(link => (
            <div key={link.addonId} className="addon-chip">
              <button className="addon-chip-main" onClick={() => onOpenMessage(link.message.id)} title="Open this email">
                ✉ {link.message.subject || '(no subject)'}
              </button>
              <AiTag addedBy={link.added_by} />
              <button className="addon-remove" onClick={() => run(() => onRemoveAddon(link.addonId))} aria-label="Unlink email">×</button>
            </div>
          ))}

          {note.noteLinks.map(link => (
            <div key={link.addonId} className="addon-chip">
              <button className="addon-chip-main" onClick={() => onOpenNote(link.noteId)} title="Open this note">
                🗒 {link.preview}
              </button>
              <AiTag addedBy={link.added_by} />
              <button className="addon-remove" onClick={() => run(() => onRemoveAddon(link.addonId))} aria-label="Unlink note">×</button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {picker === 'reminder' && (
        <ReminderPicker
          initial={reminder?.remind_at}
          onPick={remindAt => run(() => onAddAddon(note.id, { kind: 'reminder', remindAt }))}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker === 'email' && (
        <EmailLinkPicker
          onPick={message => run(() => onAddAddon(note.id, { kind: 'email_link', messageId: message.id }))}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker === 'note' && (
        <NoteLinkPicker
          notes={linkableNotes}
          onPick={picked => run(() => onAddAddon(note.id, { kind: 'note_link', noteId: picked.id }))}
          onCancel={() => setPicker(null)}
        />
      )}

      {!picker && (
        <div className="note-actions">
          <div className="add-addon">
            <button className="btn btn-ghost btn-small" onClick={() => setMenuOpen(prev => !prev)} aria-expanded={menuOpen}>
              + Add
            </button>
            {menuOpen && (
              <div className="add-addon-options">
                <button onClick={() => openPicker('reminder')}>⏰ {reminder ? 'Change reminder' : 'Reminder'}</button>
                <button onClick={() => openPicker('email')}>✉ Link email</button>
                <button onClick={() => openPicker('note')}>🗒 Link note</button>
                {!note.pin && <button onClick={() => run(() => onAddAddon(note.id, { kind: 'pin' }))}>📌 Pin</button>}
              </div>
            )}
          </div>

          {confirmingDelete ? (
            <span className="confirm-delete">
              Delete "{noteTitle(draft).slice(0, 30)}"?
              <button className="btn btn-small btn-danger" onClick={() => onDelete(note.id)}>Delete</button>
              <button className="btn btn-ghost btn-small" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-small" onClick={() => setConfirmingDelete(true)}>Delete note</button>
          )}
        </div>
      )}
    </div>
  );
}

export default NoteDetail;
