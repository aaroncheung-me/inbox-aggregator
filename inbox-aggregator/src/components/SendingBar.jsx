import { useEffect, useState } from 'react';

// The bar shown after pressing Send: a countdown with Undo, then "Sent", or
// why it wasn't sent. outgoing: { sendAt, status, error, undoError }.
function SendingBar({ outgoing, onUndo, onOpenDraft, onDismiss }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (outgoing.status !== 'waiting') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [outgoing.status]);

  const secondsLeft = Math.ceil((new Date(outgoing.sendAt).getTime() - now) / 1000);

  let content;
  if (outgoing.status === 'failed') {
    content = (
      <>
        <span>Not sent: {outgoing.error || 'something went wrong'}</span>
        <button className="btn btn-small" onClick={onOpenDraft}>Open email</button>
        <button className="notice-dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
      </>
    );
  } else if (outgoing.status === 'sent') {
    content = <span>Sent</span>;
  } else if (outgoing.status === 'unknown') {
    content = (
      <>
        <span>Still sending. It will appear with your sent mail once it has gone.</span>
        <button className="notice-dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
      </>
    );
  } else if (secondsLeft > 0) {
    content = (
      <>
        <span>Sending in {secondsLeft}s</span>
        <button className="btn btn-small" onClick={onUndo}>Undo</button>
      </>
    );
  } else {
    content = <span>Sending...</span>;
  }

  return (
    <div className={`sending-bar${outgoing.status === 'failed' ? ' failed' : ''}`} role="status">
      {content}
      {outgoing.undoError && <span className="sending-bar-error">{outgoing.undoError}</span>}
    </div>
  );
}

export default SendingBar;
