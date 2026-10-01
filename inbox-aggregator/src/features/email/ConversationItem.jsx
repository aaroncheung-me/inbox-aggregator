import { useEffect, useState } from 'react';
import { downloadAttachment, getMessage } from '../../api';
import { fileSize, senderName, shortDate } from '../../format';
import { preloadEmailHtml, useEmailHtml } from './useEmailHtml';
import { useLoadImages } from '../settings/loadImages';
import PlainBody from './PlainBody';
import EmailHtml from './EmailHtml';

// One other email of a conversation, under the opened one: a row that opens
// in place to show the whole email, and closes again.
// email: { id, sender, snippet, received_at, from_me } (from the conversation).
// onOpen(id): makes it the opened email (to reply to it, for instance).
function ConversationItem({ email, onOpen }) {
  const [open, setOpen] = useState(false);
  const mine = email.from_me;

  return (
    <div className={`conversation-item${open ? ' open' : ''}`}>
      <button
        type="button"
        className="conversation-row"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        onPointerEnter={e => { if (e.pointerType === 'mouse') preloadEmailHtml(email.id); }}
      >
        <span className="conversation-toggle" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="conversation-from">{mine ? 'Me' : senderName(email.sender)}</span>
        <span className="conversation-snippet">{open ? '' : email.snippet || email.subject || '(no text)'}</span>
        <span className="conversation-date">{shortDate(email.received_at)}</span>
      </button>
      {open && <ConversationEmail id={email.id} onOpen={() => onOpen(email.id)} />}
    </div>
  );
}

// The opened row: who it's between, its attachments, and the email itself.
function ConversationEmail({ id, onOpen }) {
  const [details, setDetails] = useState(null); // the full email, or { error }
  const formatted = useEmailHtml(id);
  const loadImages = useLoadImages();

  useEffect(() => {
    let cancelled = false;
    getMessage(id)
      .then(message => { if (!cancelled) setDetails(message); })
      .catch(err => { if (!cancelled) setDetails({ error: err.message }); });
    return () => { cancelled = true; };
  }, [id]);

  if (!details) return <div className="conversation-body"><div className="email-html-loading">Loading email...</div></div>;
  if (details.error) return <div className="conversation-body"><p className="form-error">{details.error}</p></div>;

  // images shown inside the email aren't listed again
  const attachments = (details.attachments || []).filter(a => !formatted.inlinePartIds.includes(a.external_id));

  return (
    <div className="conversation-body">
      <div className="conversation-meta">
        <div>
          {details.sender} · {new Date(details.received_at).toLocaleString()}
          <div className="meta-recipients">To: {details.to_recipients || '(nobody)'}</div>
          {details.cc_recipients && <div className="meta-recipients">Cc: {details.cc_recipients}</div>}
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={onOpen}>Open</button>
      </div>
      {attachments.length > 0 && (
        <ul className="attachments">
          {attachments.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => downloadAttachment(a).catch(err => window.alert(err.message))}>
                <span className="attachment-name">{a.filename || '(unnamed attachment)'}</span>
                <span className="attachment-size">{fileSize(a.size_bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {formatted.html ? (
        <EmailHtml html={formatted.html} loadImages={loadImages} hideQuoted />
      ) : formatted.status === 'loading' ? (
        <div className="email-html-loading">Loading email...</div>
      ) : (
        <PlainBody text={formatted.text || details.body || details.snippet} hideQuoted />
      )}
    </div>
  );
}

export default ConversationItem;
