import { useEffect, useRef, useState } from 'react';
import { formatReminder, reminderIsDue } from './notes';
import { senderName, shortDate } from '../../format';
import { EmailLinkPicker, NoteLinkPicker, ReminderPicker } from './NoteAddonPickers';
import PaneBar from '../../ui/PaneBar';
import ActionMenu from '../../ui/ActionMenu';

const SAVE_DELAY_MS = 800;
const SAVE_LABELS = { saved: 'Saved', unsaved: 'Editing...', saving: 'Saving...', error: "Couldn't save, keep typing to retry" };

// Marks add-ons the AI attached, so it's always clear what it did.
function AiTag({ addedBy }) {
  return addedBy === 'ai' ? <span className="ai-tag" title="Added by the AI">AI</span> : null;
}

// A heading with a count over a list of linked items. Starts open with a few
// items and closed with many, so a note with lots attached stays readable.
function LinkedSection({ title, count, children }) {
  return (
    <details className="linked-section" open={count <= 3}>
      <summary>{title} ({count})</summary>
      <ul className="linked-list">{children}</ul>
    </details>
  );
}

// One note in the main pane: its text (saved as you type) and its add-ons.
// The parent gives this component a key per note, so switching notes starts fresh.
// headsUp: a message from the AI save that made this note (e.g. an email it couldn't find).
// back: the top bar's back button(s), from MainPane. The bar also holds the save
// state, "+ Add" and Delete.
function NoteDetail({
  back, note, notes, now, onSaveBody, onDelete, onAddAddon, onUpdateAddon, onRemoveAddon, onOpenMessage, onOpenNote,
  headsUp, onDismissHeadsUp,
}) {
  const [draft, setDraft] = useState(note.body);
  const [saveState, setSaveState] = useState('saved');
  const [picker, setPicker] = useState(null); // 'reminder' | 'email' | 'note' | null
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
    } catch (err) {
      setError(err.message);
    }
  }

  const reminder = note.reminder;
  const due = reminderIsDue(reminder, now);
  const linkedNoteIds = new Set(note.noteLinks.map(link => link.noteId));
  const linkableNotes = notes.filter(other => other.id !== note.id && !linkedNoteIds.has(other.id));
  // Boolean(): with no links, `a || b || 0` would be the number 0, which React shows on screen
  const hasAddons = Boolean(reminder || note.pin || note.emailLinks.length || note.noteLinks.length);
  const emailLinks = [...note.emailLinks].sort((a, b) => (b.message.received_at || '').localeCompare(a.message.received_at || ''));

  return (
    <>
      <PaneBar left={back} title="Note">
        {confirmingDelete ? (
          <span className="confirm-delete">
            Delete this note?
            <button className="btn btn-small btn-danger" onClick={() => onDelete(note.id)}>Delete</button>
            <button className="btn btn-ghost btn-small" onClick={() => setConfirmingDelete(false)}>Cancel</button>
          </span>
        ) : (
          <>
            {/* quiet, before the actions */}
            <span className={`save-state ${saveState}`} role="status">{SAVE_LABELS[saveState]}</span>
            <ActionMenu
              label="+ Add"
              items={[
                { label: reminder ? 'Change reminder' : 'Reminder', onClick: () => setPicker('reminder') },
                { label: 'Link email', onClick: () => setPicker('email') },
                { label: 'Link note', onClick: () => setPicker('note') },
                !note.pin && { label: 'Pin', onClick: () => run(() => onAddAddon(note.id, { kind: 'pin' })) },
              ]}
            />
            <button className="btn btn-ghost btn-small" onClick={() => setConfirmingDelete(true)}>Delete</button>
          </>
        )}
      </PaneBar>
      <div className="pane-body note-detail">
        {headsUp && (
          <div className="notice notice-success ai-heads-up" role="status">
            <span><span className="ai-tag">AI</span> {headsUp}</span>
            <button className="notice-dismiss" onClick={onDismissHeadsUp} aria-label="Dismiss">×</button>
          </div>
        )}
        {/* opened from "+ Add" in the bar (or a reminder chip), so shown near the top */}
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

        <textarea
          className="note-body"
          value={draft}
          onChange={e => handleChange(e.target.value)}
          onBlur={() => { if (pendingText.current !== null) save(pendingText.current); }}
          placeholder="Write something..."
          aria-label="Note text"
          rows={8}
        />

        {hasAddons && (
          <div className="note-addons">
            {/* always in this order: reminder and pin, then linked emails, then linked notes */}
            {(reminder || note.pin) && (
              <div className="addon-status-row">
                {reminder && (
                  <div className={`addon-chip reminder${due ? ' due' : ''}${reminder.done_at ? ' done' : ''}`}>
                    <label className="reminder-done" title={reminder.done_at ? 'Mark as not done' : 'Mark as done'}>
                      <input
                        type="checkbox"
                        checked={!!reminder.done_at}
                        onChange={e => run(() => onUpdateAddon(reminder.id, { done: e.target.checked }))}
                      />
                    </label>
                    <button className="addon-chip-main" onClick={() => setPicker('reminder')} title="Change the time">
                      Remind: {formatReminder(reminder.remind_at)}{due ? ' · due' : ''}
                    </button>
                    <AiTag addedBy={reminder.added_by} />
                    <button className="addon-remove" onClick={() => run(() => onRemoveAddon(reminder.id))} aria-label="Remove reminder">×</button>
                  </div>
                )}
                {note.pin && (
                  <div className="addon-chip">
                    <span className="addon-chip-main">Pinned</span>
                    <AiTag addedBy={note.pin.added_by} />
                    <button className="addon-remove" onClick={() => run(() => onRemoveAddon(note.pin.id))} aria-label="Unpin">×</button>
                  </div>
                )}
              </div>
            )}

            {emailLinks.length > 0 && (
              <LinkedSection title="Linked emails" count={emailLinks.length}>
                {emailLinks.map(link => (
                  <li key={link.addonId} className="linked-row">
                    <button className="linked-main" onClick={() => onOpenMessage(link.message.id, link.message)} title="Open this email">
                      <span className="linked-title">{link.message.subject || '(no subject)'}</span>
                      <span className="linked-meta">{senderName(link.message.sender)} · {shortDate(link.message.received_at)}</span>
                    </button>
                    <AiTag addedBy={link.added_by} />
                    <button className="addon-remove" onClick={() => run(() => onRemoveAddon(link.addonId))} aria-label="Unlink email">×</button>
                  </li>
                ))}
              </LinkedSection>
            )}

            {note.noteLinks.length > 0 && (
              <LinkedSection title="Linked notes" count={note.noteLinks.length}>
                {note.noteLinks.map(link => (
                  <li key={link.addonId} className="linked-row">
                    <button className="linked-main" onClick={() => onOpenNote(link.noteId)} title="Open this note">
                      <span className="linked-title">{link.preview}</span>
                    </button>
                    <AiTag addedBy={link.added_by} />
                    <button className="addon-remove" onClick={() => run(() => onRemoveAddon(link.addonId))} aria-label="Unlink note">×</button>
                  </li>
                ))}
              </LinkedSection>
            )}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
      </div>
    </>
  );
}

export default NoteDetail;
