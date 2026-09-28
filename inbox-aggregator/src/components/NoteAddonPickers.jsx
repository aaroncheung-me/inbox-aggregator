import { useState } from 'react';
import { searchMessagesBasic } from '../api';
import { noteTitle, reminderQuickPicks, toDateTimeInput } from '../notes';

// Inline pickers shown under a note when adding an add-on. Each calls
// onPick(value) and the parent attaches it: an ISO time for reminders, the
// picked email or note object for links (so a label can be shown before saving).

export function ReminderPicker({ initial, onPick, onCancel }) {
  const [custom, setCustom] = useState(() => toDateTimeInput(initial ? new Date(initial) : nextHour()));

  return (
    <div className="addon-picker">
      <div className="addon-picker-title">Remind me</div>
      <div className="quick-picks">
        {reminderQuickPicks().map(([label, date]) => (
          <button type="button" key={label} className="btn btn-ghost btn-small" onClick={() => onPick(date.toISOString())}>
            {label}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <input type="datetime-local" value={custom} onChange={e => setCustom(e.target.value)} aria-label="Reminder date and time" />
        <button type="button" className="btn btn-small" disabled={!custom} onClick={() => onPick(new Date(custom).toISOString())}>Set</button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

// Finds an email with the same basic search as the Search box (from:, after:... work too).
export function EmailLinkPicker({ onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults((await searchMessagesBasic(query.trim(), { limit: 10 })).messages);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="addon-picker">
      <div className="addon-picker-title">Link an email</div>
      <form className="picker-row" onSubmit={handleSearch}>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search: words, from:name..." aria-label="Search emails to link" autoFocus />
        <button type="submit" className="btn btn-small" disabled={searching}>{searching ? '...' : 'Search'}</button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {results && (
        results.length === 0
          ? <p className="picker-empty">No emails match.</p>
          : (
            <ul className="picker-results">
              {results.map(m => (
                <li key={m.id}>
                  <button type="button" onClick={() => onPick(m)}>
                    <span className="picker-result-title">{m.subject || '(no subject)'}</span>
                    <span className="picker-result-meta">{m.sender} · {m.received_at ? new Date(m.received_at).toLocaleDateString() : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  );
}

// Filters the user's other notes as they type.
export function NoteLinkPicker({ notes, onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = notes.filter(note => !q || note.body.toLowerCase().includes(q)).slice(0, 10);

  return (
    <div className="addon-picker">
      <div className="addon-picker-title">Link a note</div>
      <div className="picker-row">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter notes..." aria-label="Filter notes to link" autoFocus />
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>
      </div>
      {matches.length === 0
        ? <p className="picker-empty">No other notes{q ? ' match' : ' yet'}.</p>
        : (
          <ul className="picker-results">
            {matches.map(note => (
              <li key={note.id}>
                <button type="button" onClick={() => onPick(note)}>
                  <span className="picker-result-title">{noteTitle(note.body)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
