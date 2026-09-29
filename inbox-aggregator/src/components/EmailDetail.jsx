import { useState } from 'react';
import EmailStickyNotes from './EmailStickyNotes';
import PaneBar from './PaneBar';
import ActionMenu from './ActionMenu';

// One email in the main pane. Its actions sit in the top bar: on a phone,
// Reply plus a More menu for the rest, since the full row doesn't fit.
// back: the bar's back button(s), from MainPane.
// onReply(kind): kind is 'reply', 'replyAll' or 'forward'. onTogglePin pins or unpins it.
function EmailDetail({ back, message, account, loading, error, now, allNotes, onOpenNote, onCreateNote, onAiCreateNote, onReply, onTogglePin }) {
  const [writingNote, setWritingNote] = useState(false);
  const ready = Boolean(message && !loading && !error);

  let body;
  if (loading) body = <div className="email-detail">Loading...</div>;
  else if (error) body = <div className="email-detail">Error: {error}</div>;
  else if (message) {
    body = (
      <div className="email-detail">
        <EmailStickyNotes
          messageId={message.id}
          notes={message.notes || []}
          allNotes={allNotes}
          now={now}
          writing={writingNote}
          onStopWriting={() => setWritingNote(false)}
          onOpenNote={onOpenNote}
          onCreate={onCreateNote}
          onAiCreate={onAiCreateNote}
        />
        {account && (
          <div className="received-by">
            <span className="account-dot" style={{ background: account.color }} aria-hidden="true" />
            {account.display_name || account.email_address}
          </div>
        )}
        <div className="subject">
          {message.pinned_at && <span className="pinned-tag">Pinned</span>}
          {message.subject || '(no subject)'}
        </div>
        <div className="meta">
          {message.sender} · {new Date(message.received_at).toLocaleString()}
          <div className="meta-recipients">To: {message.to_recipients || '(nobody)'}</div>
          {message.cc_recipients && <div className="meta-recipients">Cc: {message.cc_recipients}</div>}
        </div>
        {message.attachments?.length > 0 && (
          <ul className="attachments">
            {message.attachments.map(a => (
              <li key={a.id}>{a.filename || '(unnamed attachment)'}</li>
            ))}
          </ul>
        )}
        <div className="body">{message.body || message.snippet}</div>
      </div>
    );
  }

  return (
    <>
      <PaneBar left={back}>
        {ready && (
          <>
            <button className="btn btn-small" onClick={() => onReply('reply')}>Reply</button>
            <button className="btn btn-ghost btn-small desktop-only" onClick={() => onReply('replyAll')}>Reply all</button>
            <button className="btn btn-ghost btn-small desktop-only" onClick={() => onReply('forward')}>Forward</button>
            <button className="btn btn-ghost btn-small desktop-only" onClick={() => setWritingNote(true)}>+ Note</button>
            <button className="btn btn-ghost btn-small desktop-only" onClick={onTogglePin}>{message.pinned_at ? 'Unpin' : 'Pin'}</button>
            <ActionMenu
              className="phone-only"
              label="More"
              items={[
                { label: 'Reply all', onClick: () => onReply('replyAll') },
                { label: 'Forward', onClick: () => onReply('forward') },
                { label: '+ Note', onClick: () => setWritingNote(true) },
                { label: message.pinned_at ? 'Unpin' : 'Pin', onClick: onTogglePin },
              ]}
            />
          </>
        )}
      </PaneBar>
      <div className="pane-body">{body}</div>
    </>
  );
}

export default EmailDetail;
