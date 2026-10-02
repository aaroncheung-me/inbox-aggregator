import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import NoteListItem from './NoteListItem';
import NoteComposer from './NoteComposer';
import OrganizeReview from './OrganizeReview';
import NoteStartLine from './NoteStartLine';
import ResultsBar from '../../ui/ResultsBar';
import { resultsText } from '../../format';
import { groupNotes, positionBetween, searchNotes } from './notes';

// The sidebar's Notes view: a box for writing a note (with its add-ons), then
// the notes in the user's order. Pinned notes form their own group on top;
// ticked-off reminders are tucked into a collapsed Done group. Drag within a
// group to reorder. onCreate / onAiCreate(body, addons) save a new note.
// Organize asks the AI for tidying suggestions (onSuggestOrganizing), which are
// reviewed here and applied with onApplyOrganizing(changes, order); its button
// sits on the first group's header line.
// query: a search from the bar on this tab; the matching notes replace the
// list until onClearQuery. onStartNote (phone): the box becomes one line that
// opens the full-screen new note.
function NotesPanel({
  notes, now, selectedNoteId, onSelect, onCreate, onAiCreate, onMove, onSuggestOrganizing, onApplyOrganizing,
  autoFocusComposer = false, query = null, onClearQuery, onStartNote,
}) {
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

  // Dragging only starts from a note's grip, so it can begin right away (mouse
  // or finger); the rest of the list scrolls normally. The keyboard works too:
  // focus a grip, Space to pick up, arrows to move, Space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
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

  const canOrganize = notes.length >= 2 && !suggestions;
  const organizeButton = canOrganize && (
    <button
      className="btn btn-ghost btn-small"
      onClick={handleOrganize}
      disabled={organizing}
      title="The AI suggests pins, links, finished reminders and a better order. Nothing changes until you apply."
    >
      {organizing ? 'Organizing...' : 'Organize'}
    </button>
  );

  // first: the group whose header line carries Organize
  function renderGroup(title, group, first = false) {
    if (!group.length) return null;
    return (
      <section className="notes-group">
        {title && (
          <div className="notes-group-header">
            <h3 className="notes-group-title">{title}</h3>
            {first && organizeButton}
          </div>
        )}
        {first && organizeError && <p className="form-error notes-organize-error">{organizeError}</p>}
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

  if (query != null) {
    const found = searchNotes(notes, query);
    return (
      <div className="notes-panel">
        <ResultsBar backLabel="Notes" onBack={onClearQuery} text={resultsText(found.length, query)} />
        {found.length === 0 && <p className="notes-empty">No notes match.</p>}
        {found.map(note => (
          <NoteListItem key={note.id} note={note} now={now} selected={note.id === selectedNoteId} onSelect={onSelect} sortable={false} />
        ))}
      </div>
    );
  }

  return (
    <div className="notes-panel">
      {onStartNote ? (
        <NoteStartLine onStart={onStartNote} onAiSave={onAiCreate} />
      ) : (
        <NoteComposer
          notes={notes}
          onSave={onCreate}
          onAiSave={onAiCreate}
          placeholder="Write a note..."
          className="note-capture"
          autoFocus={autoFocusComposer}
        />
      )}

      {notes.length === 0 && <p className="notes-empty">No notes yet. Write one above.</p>}

      {suggestions && (
        <OrganizeReview suggestions={suggestions} onApply={onApplyOrganizing} onClose={() => setSuggestions(null)} />
      )}

      {renderGroup('Pinned', pinned, true)}
      {renderGroup(pinned.length || organizeButton ? 'Notes' : null, other, !pinned.length)}

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
