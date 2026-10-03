import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { nextFullHour, toDateTimeInput } from '../../format';
import { sendLaterOptions, scheduleLabel } from './sendLater';

// Send, with a ▾ beside it for Send later: preset times, or any date and time.
// onSend() sends now; onSchedule(date) sends at that time.
function SendButton({ sending, onSend, onSchedule }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState('');
  const ref = useRef(null);
  useDismiss(ref, open, close);

  function close() {
    setOpen(false);
    setPicking(false);
  }

  function toggle() {
    if (open) return close();
    setPicked(toDateTimeInput(nextFullHour()));
    setOpen(true);
  }

  function schedule(date) {
    close();
    onSchedule(date);
  }

  const now = new Date();
  const pickedDate = picked ? new Date(picked) : null;
  const pickedOk = pickedDate && !Number.isNaN(pickedDate.getTime()) && pickedDate - now >= 60 * 1000;

  return (
    <span className="send-button" ref={ref}>
      <button className="btn btn-small send-button-main" onClick={onSend} disabled={sending}>
        {sending ? 'Sending...' : 'Send'}
      </button>
      <button
        className="btn btn-small send-button-more"
        onClick={toggle}
        disabled={sending}
        aria-expanded={open}
        aria-label="Send later"
        title="Send later"
      >
        ▾
      </button>
      {open && (
        <span className="send-later-menu" role="menu">
          <span className="send-later-heading">Send later</span>
          {sendLaterOptions(now).map(option => (
            <button key={option.label} type="button" role="menuitem" onClick={() => schedule(option.when)}>
              <span>{option.label}</span>
              <span className="send-later-when">{scheduleLabel(option.when, now)}</span>
            </button>
          ))}
          <span className="send-later-divider" />
          {picking ? (
            <span className="send-later-pick">
              <input
                type="datetime-local"
                aria-label="Date and time to send"
                value={picked}
                min={toDateTimeInput(now)}
                onChange={e => setPicked(e.target.value)}
              />
              <button type="button" className="btn btn-small" disabled={!pickedOk} onClick={() => schedule(pickedDate)}>
                Schedule
              </button>
            </span>
          ) : (
            <button type="button" role="menuitem" onClick={() => setPicking(true)}>Pick a date and time...</button>
          )}
        </span>
      )}
    </span>
  );
}

export default SendButton;
