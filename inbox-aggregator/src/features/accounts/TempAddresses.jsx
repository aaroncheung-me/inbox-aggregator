import { useState } from 'react';
import ActionMenu from '../../ui/ActionMenu';
import AccountColorPicker from './AccountColorPicker';
import { timeLeft } from '../../format';

const LIFETIMES = [
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
];

// Temp addresses, as rows under the accounts in the accounts section (made
// from "+ Add account", then "Temp address"). Each has its own color, drawn
// dashed, as are the stripes of the emails it receives. It forwards into your
// mailbox until it expires; then it stops working and its emails are deleted.
// temp: { available, reason, addresses } from the server; creating: show the form.
// Like accounts, each has a show-in-inbox checkbox and a color you can change.
// onCreate(lifetime, label) -> the new address; onExtend(id, lifetime);
// onToggle(id, shown); onChangeColor(id, color); onDelete(id).
function TempAddresses({ temp, now, creating, onCloseForm, onCreate, onExtend, onToggle, onChangeColor, onDelete }) {
  const [label, setLabel] = useState('');
  const [lifetime, setLifetime] = useState('1d');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  if (!temp) return null;

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copy(item) {
    try {
      await navigator.clipboard.writeText(item.address);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(current => (current === item.id ? null : current)), 2000);
    } catch {
      setError(`Couldn't copy; the address is ${item.address}`);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const created = await run(() => onCreate(lifetime, label));
    if (!created) return;
    onCloseForm();
    setLabel('');
    setLifetime('1d');
    copy(created); // ready to paste into the signup form
  }

  return (
    <div className="temp-addresses">
      {creating && (
        temp.available ? (
          <form className="temp-form" onSubmit={handleCreate}>
            <div className="temp-form-title">New temp address</div>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="What's it for? (optional)"
              aria-label="What the address is for"
              maxLength={60}
              autoFocus
            />
            <div className="temp-form-row">
              <select value={lifetime} onChange={e => setLifetime(e.target.value)} aria-label="How long it lasts">
                {LIFETIMES.map(l => <option key={l.value} value={l.value}>Lasts {l.label}</option>)}
              </select>
              <button type="submit" className="btn btn-small" disabled={busy}>{busy ? 'Making...' : 'Make address'}</button>
              <button type="button" className="btn btn-ghost btn-small" onClick={onCloseForm}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="temp-form">
            <p className="temp-hint">{temp.reason}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={onCloseForm}>Close</button>
          </div>
        )
      )}

      {error && <p className="form-error temp-error">{error}</p>}

      {temp.addresses.length > 0 && (
        <ul className="temp-list">
          {temp.addresses.map(item => (
            <li key={item.id} className={`temp-row${item.show_in_inbox === false ? ' hidden-account' : ''}`}>
              {/* the same row, checkbox and dot as an account's, so they line up and size alike */}
              <div className="account-row temp-row-top">
                <input
                  id={`temp-shown-${item.id}`}
                  type="checkbox"
                  checked={item.show_in_inbox !== false}
                  onChange={e => onToggle(item.id, e.target.checked)}
                />
                <AccountColorPicker
                  account={{ id: item.id, color: item.color, email_address: item.address }}
                  onChangeColor={onChangeColor}
                  dashed
                />
                <label htmlFor={`temp-shown-${item.id}`} className="account-name temp-address" title={item.address}>{item.address}</label>
                {confirmingId !== item.id && (
                  <>
                    <button
                      className="btn btn-ghost btn-small icon-button"
                      onClick={() => copy(item)}
                      aria-label="Copy address"
                      title="Copy address"
                    >
                      {copiedId === item.id ? 'Copied' : '⧉'}
                    </button>
                    <ActionMenu
                      label="⋯"
                      arrow={false}
                      ariaLabel="Options"
                      buttonClassName="icon-button"
                      items={[
                        ...LIFETIMES.map(l => ({ label: `Keep ${l.label} from now`, onClick: () => run(() => onExtend(item.id, l.value)) })),
                        { label: 'Delete', danger: true, onClick: () => setConfirmingId(item.id) },
                      ]}
                    />
                  </>
                )}
              </div>
              {confirmingId === item.id ? (
                <div className="temp-row-meta temp-confirm-row">
                  <span className="temp-confirm">
                    Delete it{item.received ? ` and its ${item.received} email${item.received === 1 ? '' : 's'}` : ''}?
                  </span>
                  <button
                    className="btn btn-small btn-danger"
                    disabled={busy}
                    onClick={() => run(() => onDelete(item.id)).then(() => setConfirmingId(null))}
                  >
                    Delete
                  </button>
                  <button className="btn btn-ghost btn-small" onClick={() => setConfirmingId(null)}>Cancel</button>
                </div>
              ) : (
                <div className="temp-row-meta">
                  Temp{item.label && <> · {item.label}</>} · {item.received} email{item.received === 1 ? '' : 's'} · expires in {timeLeft(item.expires_at, now)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TempAddresses;
