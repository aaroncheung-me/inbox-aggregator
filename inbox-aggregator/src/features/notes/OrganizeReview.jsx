import { useState } from 'react';

const ACTION_LABELS = {
  pin: 'Pin',
  unpin: 'Unpin',
  mark_done: 'Mark done',
  link: 'Link',
};

// The AI's Organize suggestions, each with a checkbox (all ticked to start).
// Nothing changes until "Apply selected". onApply(changes, order) resolves when done.
function OrganizeReview({ suggestions, onApply, onClose }) {
  const { changes, order } = suggestions;
  const [selected, setSelected] = useState(() => new Set([...changes.map((_, i) => i), ...(order ? ['order'] : [])]));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  const toggle = key => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  async function handleApply() {
    setApplying(true);
    setError(null);
    try {
      await onApply(changes.filter((_, i) => selected.has(i)), selected.has('order') ? order : null);
      onClose();
    } catch (err) {
      setError(err.message);
      setApplying(false);
    }
  }

  if (!changes.length && !order) {
    return (
      <div className="organize-review">
        <p className="organize-empty">Your notes look organized already.</p>
        <div className="organize-actions">
          <button className="btn btn-ghost btn-small" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="organize-review">
      <div className="organize-title">Suggested changes</div>
      <ul className="organize-list">
        {changes.map((change, i) => (
          <li key={i}>
            <label>
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
              <span>
                <strong>{ACTION_LABELS[change.action]}</strong> "{change.title}"
                {change.action === 'link' && <> with "{change.otherTitle}"</>}
                {change.reason && <span className="organize-reason"> · {change.reason}</span>}
              </span>
            </label>
          </li>
        ))}
        {order && (
          <li>
            <label>
              <input type="checkbox" checked={selected.has('order')} onChange={() => toggle('order')} />
              <span>
                <strong>Reorder</strong>
                {order.reason && <span className="organize-reason"> · {order.reason}</span>}
                <ol className="organize-order">
                  {order.titles.map((title, i) => <li key={i}>{title}</li>)}
                </ol>
              </span>
            </label>
          </li>
        )}
      </ul>
      {error && <p className="form-error">{error}</p>}
      <div className="organize-actions">
        <button className="btn btn-ghost btn-small" onClick={onClose} disabled={applying}>Cancel</button>
        <button className="btn btn-small" onClick={handleApply} disabled={applying || selected.size === 0}>
          {applying ? 'Applying...' : 'Apply selected'}
        </button>
      </div>
    </div>
  );
}

export default OrganizeReview;
