import { useEffect, useState } from 'react';
import { getMessage } from '../../api';
import { senderName, shortDate } from '../../format';
import { preloadEmailHtml, useEmailHtml } from './useEmailHtml';
import EmailContent from './EmailContent';

// One email of a conversation: a row (who it's from, the start of its text,
// when) that opens in place to show the whole email, and closes again.
// email: { id, sender, snippet, received_at, from_me } (from the conversation).
// main: the opened email (starts open; the others offer Open to become it).
// hideQuoted: leave out the copy of earlier emails it carries (all but the
// oldest, whose copy may hold what came before the conversation).
// onOpen(id, email): makes it the opened email (to reply to it, for instance).
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
        <ConversationEmail id={email.id} hideQuoted={hideQuoted} onOpen={main ? null : () => onOpen(email.id, email)} />
      )}
    </div>
  );
}

// The opened row: who it's between, its attachments, and the email itself.
function ConversationEmail({ id, hideQuoted, onOpen }) {
  const [details, setDetails] = useState(null); // the full email, or { error }
  const formatted = useEmailHtml(id);

  useEffect(() => {
    let cancelled = false;
    getMessage(id)
      .then(message => { if (!cancelled) setDetails(message); })
      .catch(err => { if (!cancelled) setDetails({ error: err.message }); });
    return () => { cancelled = true; };
  }, [id]);

  if (!details) return <div className="conversation-body"><div className="email-html-loading">Loading email...</div></div>;
  if (details.error) return <div className="conversation-body"><p className="form-error">{details.error}</p></div>;

  return (
    <div className="conversation-body">
      <EmailContent
        message={details}
        formatted={formatted}
        metaClassName="conversation-meta"
        metaAction={onOpen && <button type="button" className="btn btn-ghost btn-small" onClick={onOpen}>Open</button>}
        hideQuoted={hideQuoted}
      />
    </div>
  );
}

export default ConversationItem;
