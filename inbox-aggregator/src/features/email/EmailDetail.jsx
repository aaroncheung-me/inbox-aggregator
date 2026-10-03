import { useState } from 'react';
import EmailStickyNotes from '../notes/EmailStickyNotes';
import PaneBar from '../../ui/PaneBar';
import ActionMenu from '../../ui/ActionMenu';
import { timeLeft } from '../../format';
import { useEmailHtml } from './useEmailHtml';
import { useConversation } from './useConversation';
import ConversationItem from './ConversationItem';
import EmailContent from './EmailContent';

// One email in the main pane. Its actions sit in the top bar: on a phone,
// Reply plus a More menu for the rest, since the full row doesn't fit.
// back: the bar's back button(s), from MainPane. messageId: the email being
// opened, known before its details arrive, so its formatted version loads alongside.
// onReply(kind): kind is 'reply', 'replyAll' or 'forward'. onTogglePin pins or unpins it.
// tempColors: address -> color of the temp addresses as the app has them now.
// An email that's part of a conversation shows the whole conversation instead,
// newest first, Outlook style: each email a row that opens in place, this one
// open. onOpenMessage(id) makes another of them the opened email.
function EmailDetail({ back, messageId, message, account, tempColors, loading, error, now, allNotes, onOpenNote, onOpenMessage, onCreateNote, onAiCreateNote, onReply, onTogglePin }) {
  const [writingNote, setWritingNote] = useState(false);
  const ready = Boolean(message && !loading && !error);
  const formatted = useEmailHtml(messageId);
  // every email of its conversation, this one included; two or more means one is shown
  const conversation = useConversation(messageId);
  const inConversation = conversation.length > 1;
  // the oldest keeps its quoted copy: it may hold what came before the conversation
  const oldestId = inConversation ? conversation[conversation.length - 1].id : null;

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
        {message.temp_address ? (
          <div className="received-by">
            <span
              className="temp-dot"
              style={{ borderColor: tempColors?.get(message.temp_address.address) || message.temp_address.color || undefined }}
              aria-hidden="true"
            />
            Temp: {message.temp_address.address}
          </div>
        ) : account && (
          <div className="received-by">
            <span className="account-dot" style={{ background: account.color }} aria-hidden="true" />
            {account.display_name || account.email_address}
          </div>
        )}
        <div className="subject">
          {message.pinned_at && <span className="pinned-tag">Pinned</span>}
          {message.subject || '(no subject)'}
          {inConversation && <span className="conversation-count">{conversation.length} emails</span>}
        </div>
        {message.temp_address && (
          <div className="temp-notice">
            Sent to your temp address {message.temp_address.address}
            {message.temp_address.label && <> ({message.temp_address.label})</>}.
            {' '}It and this email are deleted in {timeLeft(message.temp_address.expires_at, now)}.
          </div>
        )}
        {inConversation ? (
          <section className="conversation" aria-label="Conversation">
            {conversation.map(m => (
              <ConversationItem key={m.id} email={m} main={m.id === message.id} hideQuoted={m.id !== oldestId} onOpen={onOpenMessage} />
            ))}
          </section>
        ) : (
          <EmailContent message={message} formatted={formatted} />
        )}
      </div>
    );
  }

  return (
    <>
      <PaneBar left={back} title="Email">
        {ready && (
          <>
            {/* no replying from beside the email being written: it would replace it */}
            {onReply && (
              <>
                <button className="btn btn-small" onClick={() => onReply('reply')}>Reply</button>
                <button className="btn btn-ghost btn-small desktop-only" onClick={() => onReply('replyAll')}>Reply all</button>
                <button className="btn btn-ghost btn-small desktop-only" onClick={() => onReply('forward')}>Forward</button>
              </>
            )}
            <button className="btn btn-ghost btn-small desktop-only" onClick={() => setWritingNote(true)}>+ Note</button>
            <button className="btn btn-ghost btn-small desktop-only" onClick={onTogglePin}>{message.pinned_at ? 'Unpin' : 'Pin'}</button>
            <ActionMenu
              className="phone-only"
              label="More"
              items={[
                onReply && { label: 'Reply all', onClick: () => onReply('replyAll') },
                onReply && { label: 'Forward', onClick: () => onReply('forward') },
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
