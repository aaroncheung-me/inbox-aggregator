import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatReminder, notePreview, noteTitle, reminderIsDue } from './notes';
import { dragItemProps, middleClickProps } from '../../ui/dragItem';

// One row in the notes list. In `sortable` groups, the grip on the left moves
// the note; the rest of the row opens it and scrolls the list as usual, so on a
// phone a swipe is never mistaken for a drag.
function NoteListItem({ note, now, selected, onSelect, sortable = true }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled: !sortable,
  });

  const due = reminderIsDue(note.reminder, now);
  const preview = notePreview(note.body);
  const classes = ['note-list-item', selected && 'selected', due && 'due', note.reminder?.done_at && 'done', isDragging && 'dragging']
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={setNodeRef} className={classes} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {sortable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="drag-handle"
          aria-label={`Move "${noteTitle(note.body)}"`}
          {...attributes}
          {...listeners}
        >
          <span className="drag-dots" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="note-list-main"
        // as with emails: Ctrl/Cmd-click or a middle click opens a new tab, and so
        // does dragging it onto the tab bar
        onClick={e => onSelect(note.id, e.ctrlKey || e.metaKey ? { newTab: true, focus: false } : undefined)}
        {...middleClickProps(() => onSelect(note.id, { newTab: true, focus: false }))}
        {...dragItemProps({ kind: 'note', id: note.id })}
      >
        <div className="note-title">{noteTitle(note.body)}</div>
        {preview && <div className="note-preview">{preview}</div>}
        {(note.reminder || note.emailLinks.length > 0 || note.noteLinks.length > 0) && (
          <div className="note-list-chips">
            {note.reminder && (
              <span className={`mini-chip${due ? ' due' : ''}`}>Remind: {formatReminder(note.reminder.remind_at)}</span>
            )}
            {note.emailLinks.length > 0 && <span className="mini-chip">{note.emailLinks.length} email{note.emailLinks.length === 1 ? '' : 's'}</span>}
            {note.noteLinks.length > 0 && <span className="mini-chip">{note.noteLinks.length} note{note.noteLinks.length === 1 ? '' : 's'}</span>}
          </div>
        )}
      </button>
    </div>
  );
}

export default NoteListItem;
