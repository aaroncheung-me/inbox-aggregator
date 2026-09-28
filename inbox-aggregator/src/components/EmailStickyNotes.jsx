import { useState } from 'react';
import { formatReminder, noteTitle, reminderIsDue } from '../notes';
import NoteComposer from './NoteComposer';

// The notes stuck to an email, shown as sticky-note cards above it, plus
// "+ Note" to write a new one. It's saved already stuck to this email, and can
// get a reminder or other add-ons before saving.
// onCreate / onAiCreate(body, addons) save the new note (then it opens).
function EmailStickyNotes({ messageId, notes, allNotes, now, onOpenNote, onCreate, onAiCreate }) {
  const [writing, setWriting] = useState(false);

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

      {writing ? (
        <NoteComposer
          notes={allNotes}
          fixedAddons={[{ addon: { kind: 'email_link', messageId }, label: 'This email' }]}
          onSave={onCreate}
          onAiSave={onAiCreate}
          onCancel={() => setWriting(false)}
          placeholder="Note about this email..."
          className="sticky-note-form"
          autoFocus
        />
      ) : (
        <button className="btn btn-ghost btn-small add-sticky-note" onClick={() => setWriting(true)}>+ Note</button>
      )}
    </div>
  );
}

export default EmailStickyNotes;
