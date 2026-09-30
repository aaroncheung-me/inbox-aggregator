import { formatReminder, noteTitle, reminderIsDue } from './notes';
import NoteComposer from './NoteComposer';

// The notes stuck to an email, shown as sticky-note cards above it, plus the
// form for a new one while `writing` ("+ Note" in the top bar opens it). The new
// note is saved already stuck to this email, and can get a reminder or other
// add-ons before saving. onCreate / onAiCreate(body, addons) save it (then it opens).
function EmailStickyNotes({ messageId, notes, allNotes, now, writing, onStopWriting, onOpenNote, onCreate, onAiCreate }) {
  if (!notes.length && !writing) return null;

  return (
    <div className="sticky-notes">
      {notes.map(note => (
        <button key={note.id} className="sticky-note" onClick={() => onOpenNote(note.id)}>
          <span className="sticky-note-title">{noteTitle(note.body)}</span>
          {note.reminder && (
            <span className={`mini-chip${reminderIsDue(note.reminder, now) ? ' due' : ''}${note.reminder.done_at ? ' done' : ''}`}>
              Remind: {formatReminder(note.reminder.remind_at)}
            </span>
          )}
        </button>
      ))}

      {writing && (
        <NoteComposer
          notes={allNotes}
          fixedAddons={[{ addon: { kind: 'email_link', messageId }, label: 'This email' }]}
          onSave={onCreate}
          onAiSave={onAiCreate}
          onCancel={onStopWriting}
          placeholder="Note about this email..."
          className="sticky-note-form"
          autoFocus
        />
      )}
    </div>
  );
}

export default EmailStickyNotes;
