import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import NoteListItem from './NoteListItem';
import NoteComposer from './NoteComposer';
import OrganizeReview from './OrganizeReview';
import { groupNotes, positionBetween } from '../notes';

// The sidebar's Notes view: a box for writing a note (with its add-ons), then
// the notes in the user's order. Pinned notes form their own group on top;
// ticked-off reminders are tucked into a collapsed Done group. Drag within a
// group to reorder. onCreate / onAiCreate(body, addons) save a new note.
// Organize asks the AI for tidying suggestions (onSuggestOrganizing), which are
// reviewed here and applied with onApplyOrganizing(changes, order).
function NotesPanel({ notes, now, selectedNoteId, onSelect, onCreate, onAiCreate, onMove, onSuggestOrganizing, onApplyOrganizing }) {
  const [showDone, setShowDone] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [organizeError, setOrganizeError] = useState(null);

  async function handleOrganize() {
    setOrganizing(true);
    setOrganizeError(null);
    try {
      setSuggestions(await onSuggestOrganizing());
    } catch (err) {
      setOrganizeError(err.message);
    } finally {
      setOrganizing(false);
    }
  }

  // A small movement (or, on touch, a press-and-hold) starts a drag, so taps
  // still open the note and swipes still scroll the list.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { pinned, other, done } = groupNotes(notes);

  // Works out the moved note's new position from its new neighbours in the
  // same group. Dropping onto another group does nothing.
  function handleDragEnd(group, { active, over }) {
    if (!over || active.id === over.id) return;
    const ids = group.map(note => note.id);
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from < 0 || to < 0) return;

    const reordered = arrayMove(group, from, to);
    onMove(active.id, positionBetween(reordered[to - 1]?.position, reordered[to + 1]?.position));
  }

  function renderGroup(title, group) {
    if (!group.length) return null;
    return (
      <section className="notes-group">
        {title && <h3 className="notes-group-title">{title}</h3>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event => handleDragEnd(group, event)}>
          <SortableContext items={group.map(note => note.id)} strategy={verticalListSortingStrategy}>
            {group.map(note => (
              <NoteListItem key={note.id} note={note} now={now} selected={note.id === selectedNoteId} onSelect={onSelect} />
            ))}
          </SortableContext>
        </DndContext>
      </section>
    );
  }

  return (
    <div className="notes-panel">
      <NoteComposer notes={notes} onSave={onCreate} onAiSave={onAiCreate} placeholder="Write a note..." className="note-capture" />

      {notes.length === 0 && <p className="notes-empty">No notes yet. Write one above.</p>}

      {notes.length >= 2 && !suggestions && (
        <div className="notes-toolbar">
          <button
            className="btn btn-ghost btn-small"
            onClick={handleOrganize}
            disabled={organizing}
            title="The AI suggests pins, links, finished reminders and a better order. Nothing changes until you apply."
          >
            {organizing ? 'Organizing...' : 'Organize'}
          </button>
          {organizeError && <span className="form-error">{organizeError}</span>}
        </div>
      )}
      {suggestions && (
        <OrganizeReview suggestions={suggestions} onApply={onApplyOrganizing} onClose={() => setSuggestions(null)} />
      )}

      {renderGroup(pinned.length ? 'Pinned' : null, pinned)}
      {renderGroup(pinned.length && other.length ? 'Notes' : null, other)}

      {done.length > 0 && (
        <section className="notes-group">
          <button className="notes-group-toggle" onClick={() => setShowDone(prev => !prev)} aria-expanded={showDone}>
            {showDone ? '▾' : '▸'} Done ({done.length})
          </button>
          {showDone && (
            <DndContext sensors={sensors}>
              <SortableContext items={done.map(note => note.id)}>
                {done.map(note => (
                  <NoteListItem key={note.id} note={note} now={now} selected={note.id === selectedNoteId} onSelect={onSelect} sortable={false} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </section>
      )}
    </div>
  );
}

export default NotesPanel;
