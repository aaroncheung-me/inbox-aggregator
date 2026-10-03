import { useState } from 'react';
import EmailStickyNotes from '../notes/EmailStickyNotes';
import PaneBar from '../../ui/PaneBar';
import ActionMenu from '../../ui/ActionMenu';
import { fileSize, timeLeft } from '../../format';
import { downloadAttachment } from '../../api';
import { useEmailHtml } from './useEmailHtml';
import { useConversation } from './useConversation';
import { useLoadImages } from '../settings/loadImages';
import EmailHtml from './EmailHtml';
import ConversationItem from './ConversationItem';
import PlainBody from './PlainBody';
import { hasWebImages } from './webImages';

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
  const [download, setDownload] = useState(null); // { id, error? } of the attachment being saved
  const ready = Boolean(message && !loading && !error);
  const formatted = useEmailHtml(messageId);
  // every email of its conversation, this one included; two or more means one is shown
  const conversation = useConversation(messageId);
  const inConversation = conversation.length > 1;
  // the oldest keeps its quoted copy: it may hold what came before the conversation
  const oldestId = inConversation ? conversation[conversation.length - 1].id : null;
  // images from the web: per the setting, or shown for this email on request
  const loadImagesSetting = useLoadImages();
  const [showImages, setShowImages] = useState(false);
  const loadImages = loadImagesSetting || showImages;
  const imagesHidden = !loadImages && hasWebImages(formatted.html);

  async function save(attachment) {
    setDownload({ id: attachment.id });
    try {
      await downloadAttachment(attachment);
      setDownload(null);
    } catch (err) {
      setDownload({ id: attachment.id, error: err.message });
    }
  }

  // images shown inside the email aren't listed again as attachments
  const attachments = (message?.attachments || []).filter(a => !formatted.inlinePartIds.includes(a.external_id));

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
          <>
            <div className="meta">
              {message.sender} · {new Date(message.received_at).toLocaleString()}
              <div className="meta-recipients">To: {message.to_recipients || '(nobody)'}</div>
              {message.cc_recipients && <div className="meta-recipients">Cc: {message.cc_recipients}</div>}
            </div>
            {attachments.length > 0 && (
              <ul className="attachments">
                {attachments.map(a => (
                  <li key={a.id}>
                    <button type="button" onClick={() => save(a)} disabled={download?.id === a.id && !download.error}>
                      <span className="attachment-name">{a.filename || '(unnamed attachment)'}</span>
                      <span className="attachment-size">{download?.id === a.id && !download.error ? 'Saving...' : fileSize(a.size_bytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {download?.error && <p className="form-error">{download.error}</p>}
            {imagesHidden && (
              <div className="images-hidden">
                <span>Images from the web are hidden.</span>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowImages(true)}>Show images</button>
              </div>
            )}
            {formatted.html ? (
              <EmailHtml html={formatted.html} loadImages={loadImages} />
            ) : formatted.status === 'loading' ? (
              <div className="email-html-loading">Loading email...</div>
            ) : (
              // a plain-text email, or the formatted version couldn't be loaded
              <PlainBody text={formatted.text || message.body || message.snippet} />
            )}
          </>
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
