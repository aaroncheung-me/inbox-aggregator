import { useState } from 'react';
import PaneBar from '../../ui/PaneBar';
import ActionMenu from '../../ui/ActionMenu';
import Linkify from '../../ui/Linkify';
import { fileSize } from '../../format';
import { scheduleLabelLong } from './sendLater';

// A scheduled email (Send later), opened from the Scheduled group in Sent.
// Edit takes it back to the writing screen (sending it again schedules it
// anew), Send now sends it straight away, Cancel removes it. A failed one
// says why, and can be edited to try again.
// back: the bar's back button(s). item: see GET /scheduled. account: its sender.
// onEdit / onSendNow / onCancel return promises; errors show here.
function ScheduledView({ back, item, account, onEdit, onSendNow, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const cancel = () => {
    if (window.confirm('Cancel this scheduled email? It will not be sent.')) run(onCancel);
  };
  const files = [...item.attachments.map(a => ({ key: a.uploadId, name: a.filename, size: a.size })),
    ...item.forwarded.map(a => ({ key: `f${a.attachmentId}`, name: a.filename, size: a.size }))];

  return (
    <>
      <PaneBar left={back} title="Scheduled">
        <button className="btn btn-ghost btn-small desktop-only" onClick={() => run(onEdit)} disabled={busy}>Edit</button>
        {!item.failed && (
          <button className="btn btn-small" onClick={() => run(onSendNow)} disabled={busy}>Send now</button>
        )}
        <button className="btn btn-ghost btn-small desktop-only" onClick={cancel} disabled={busy}>Cancel</button>
        <ActionMenu
          className="phone-only"
          label="More"
          items={[
            { label: 'Edit', onClick: () => run(onEdit) },
            { label: 'Cancel email', onClick: cancel, danger: true },
          ]}
        />
      </PaneBar>
      <div className="pane-body">
        <div className="email-detail scheduled-detail">
          {error && <p className="form-error">{error}</p>}
          <div className={`scheduled-notice${item.failed ? ' failed' : ''}`}>
            {item.failed
              ? <>Not sent: {item.failed} Edit it to try again.</>
              : <>Sends <strong>{scheduleLabelLong(item.sendAt)}</strong> from {account?.email_address || 'your account'}.</>}
          </div>
          <div className="subject">{item.subject || '(no subject)'}</div>
          <div className="meta">
            <div className="meta-recipients">To: {item.to}</div>
            {item.cc && <div className="meta-recipients">Cc: {item.cc}</div>}
            {item.bcc && <div className="meta-recipients">Bcc: {item.bcc}</div>}
          </div>
          {files.length > 0 && (
            <ul className="attachments">
              {files.map(f => (
                <li key={f.key}>
                  <span className="scheduled-file">
                    <span className="attachment-name">{f.name}</span>
                    <span className="attachment-size">{fileSize(f.size)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="body"><Linkify text={item.body} /></div>
        </div>
      </div>
    </>
  );
}

export default ScheduledView;
