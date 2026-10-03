import { useState } from 'react';
import { downloadAttachment } from '../../api';
import { fileSize } from '../../format';
import { useLoadImages } from '../settings/loadImages';
import EmailHtml from './EmailHtml';
import PlainBody from './PlainBody';

// Whether an email's HTML shows any images from the web (in img tags or its
// styles), for the "Images from the web are hidden" notice.
function hasWebImages(html) {
  return Boolean(html) && /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:|background\s*=\s*["']?https?:/i.test(html);
}

// An email's details and text, on the email page and in an opened
// conversation row: who it's between, its attachments (each saves to the
// device when clicked), and the email itself, formatted when it can be.
// message: the full email. formatted: useEmailHtml's result (the caller starts
// it early, so it loads alongside the details). metaClassName: how the header
// looks where it's shown; metaAction sits at its end (a row's Open button).
// hideQuoted: leave out the copy of earlier emails it carries (see quotes.js).
function EmailContent({ message, formatted, metaClassName = 'meta', metaAction = null, hideQuoted = false }) {
  const [download, setDownload] = useState(null); // { id, error? } of the attachment being saved
  // images from the web: per the setting, or shown for this email on request
  const loadImagesSetting = useLoadImages();
  const [showImages, setShowImages] = useState(false);
  const loadImages = loadImagesSetting || showImages;

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
  const attachments = (message.attachments || []).filter(a => !formatted.inlinePartIds.includes(a.external_id));
  const saving = id => download?.id === id && !download.error;

  return (
    <>
      <div className={metaClassName}>
        <div>
          {message.sender} · {new Date(message.received_at).toLocaleString()}
          <div className="meta-recipients">To: {message.to_recipients || '(nobody)'}</div>
          {message.cc_recipients && <div className="meta-recipients">Cc: {message.cc_recipients}</div>}
        </div>
        {metaAction}
      </div>
      {attachments.length > 0 && (
        <ul className="attachments">
          {attachments.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => save(a)} disabled={saving(a.id)}>
                <span className="attachment-name">{a.filename || '(unnamed attachment)'}</span>
                <span className="attachment-size">{saving(a.id) ? 'Saving...' : fileSize(a.size_bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {download?.error && <p className="form-error">{download.error}</p>}
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
        // a plain-text email, or the formatted version couldn't be loaded
        <PlainBody text={formatted.text || message.body || message.snippet} hideQuoted={hideQuoted} />
      )}
    </>
  );
}

export default EmailContent;
