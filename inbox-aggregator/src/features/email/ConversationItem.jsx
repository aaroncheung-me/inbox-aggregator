import { useEffect, useState } from 'react';
import { downloadAttachment, getMessage } from '../../api';
import { fileSize, senderName, shortDate } from '../../format';
import { preloadEmailHtml, useEmailHtml } from './useEmailHtml';
import { useLoadImages } from '../settings/loadImages';
import { hasWebImages } from './webImages';
import PlainBody from './PlainBody';
import EmailHtml from './EmailHtml';

// One email of a conversation: a row (who it's from, the start of its text,
// when) that opens in place to show the whole email, and closes again.
// email: { id, sender, snippet, received_at, from_me } (from the conversation).
// main: the opened email (starts open; the others offer Open to become it).
// hideQuoted: leave out the copy of earlier emails it carries (all but the
// oldest, whose copy may hold what came before the conversation).
// onOpen(id): makes it the opened email (to reply to it, for instance).
function ConversationItem({ email, main = false, hideQuoted, onOpen }) {
  const [open, setOpen] = useState(main);

  return (
    <div className={`conversation-item${open ? ' open' : ''}${main ? ' main' : ''}`}>
      <button
        type="button"
        className="conversation-row"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        onPointerEnter={e => { if (e.pointerType === 'mouse') preloadEmailHtml(email.id); }}
      >
        <span className="conversation-toggle" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="conversation-from">{email.from_me ? 'Me' : senderName(email.sender)}</span>
        <span className="conversation-snippet">{open ? '' : email.snippet || email.subject || '(no text)'}</span>
        <span className="conversation-date">{shortDate(email.received_at)}</span>
      </button>
      {open && (
        <ConversationEmail id={email.id} hideQuoted={hideQuoted} onOpen={main ? null : () => onOpen(email.id)} />
      )}
    </div>
  );
}

// The opened row: who it's between, its attachments, and the email itself.
function ConversationEmail({ id, hideQuoted, onOpen }) {
  const [details, setDetails] = useState(null); // the full email, or { error }
  const formatted = useEmailHtml(id);
  const loadImagesSetting = useLoadImages();
  const [showImages, setShowImages] = useState(false);
  const loadImages = loadImagesSetting || showImages;

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
        {onOpen && <button type="button" className="btn btn-ghost btn-small" onClick={onOpen}>Open</button>}
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
      {!loadImages && hasWebImages(formatted.html) && (
        <div className="images-hidden">
          <span>Images from the web are hidden.</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowImages(true)}>Show images</button>
        </div>
      )}
      {formatted.html ? (
        <EmailHtml html={formatted.html} loadImages={loadImages} hideQuoted={hideQuoted} />
      ) : formatted.status === 'loading' ? (
        <div className="email-html-loading">Loading email...</div>
      ) : (
        <PlainBody text={formatted.text || details.body || details.snippet} hideQuoted={hideQuoted} />
      )}
    </div>
  );
}

export default ConversationItem;
