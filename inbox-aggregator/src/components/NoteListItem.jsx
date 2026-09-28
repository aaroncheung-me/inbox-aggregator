import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatReminder, notePreview, noteTitle, reminderIsDue } from '../notes';

// One row in the notes list. Rows in `sortable` groups can be dragged to reorder.
function NoteListItem({ note, now, selected, onSelect, sortable = true }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled: !sortable,
  });

  const due = reminderIsDue(note.reminder, now);
  const preview = notePreview(note.body);
  const classes = ['note-list-item', selected && 'selected', due && 'due', note.reminder?.done_at && 'done', isDragging && 'dragging']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      className={classes}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onSelect(note.id)}
      {...attributes}
      {...listeners}
    >
      <div className="note-title">{noteTitle(note.body)}</div>
      {preview && <div className="note-preview">{preview}</div>}
      {(note.reminder || note.emailLinks.length > 0 || note.noteLinks.length > 0) && (
        <div className="note-list-chips">
          {note.reminder && (
            <span className={`mini-chip${due ? ' due' : ''}`}>⏰ {formatReminder(note.reminder.remind_at)}</span>
          )}
          {note.emailLinks.length > 0 && <span className="mini-chip">✉ {note.emailLinks.length}</span>}
          {note.noteLinks.length > 0 && <span className="mini-chip">🗒 {note.noteLinks.length}</span>}
        </div>
      )}
    </div>
  );
}

export default NoteListItem;
