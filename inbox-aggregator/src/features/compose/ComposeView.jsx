import { useEffect, useId, useRef, useState } from 'react';
import { DRAFT_TITLES, MAX_ATTACHMENTS_BYTES, attachmentsSize } from './compose';
import { fileSize } from '../../format';
import SendButton from './SendButton';
import PaneBar from '../../ui/PaneBar';
import Linkify from '../../ui/Linkify';

function hasFiles(e) {
  return [...(e.dataTransfer?.types || [])].includes('Files');
}

// The writing screen, in the main pane. Plain text only for now.
// draft: see newDraft in compose.js. onChange(changes) merges into it.
// Top bar: on a phone, "Assistant" switches to the email's assistant (whose own
// bar has "Back to email" in the same spot), and Discard sits far right, as on
// that screen. On desktop Discard is at the top of the sidebar instead.
// Only Send or Ctrl+Enter sends; Enter in a field doesn't.
// Files are attached with Attach or by dropping them anywhere on the page
// (onAddFiles), and listed as chips under the fields (onRemoveAttachment(key)).
// onSchedule(date): Send later, from the menu beside Send.
function ComposeView({ draft, accounts, sending, onChange, onSend, onSchedule, onDiscard, onUndoAiDraft, onShowAssistant, onAddFiles, onRemoveAttachment }) {
  const id = useId();
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0); // entering a child fires dragenter again before dragleave
  const total = attachmentsSize(draft);
  const tooBig = total > MAX_ATTACHMENTS_BYTES;

  // A file dropped outside the page would make the browser open it and leave
  // the email, so while writing, stray drops do nothing.
  useEffect(() => {
    const ignore = e => { if (hasFiles(e)) e.preventDefault(); };
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

  const dropTarget = {
    onDragEnter: e => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: e => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDragLeave: e => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      onAddFiles(e.dataTransfer.files);
    },
  };
  const field = name => ({
    id: `${id}-${name}`,
    value: draft[name],
    onChange: e => onChange({ [name]: e.target.value }),
  });

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <>
      <PaneBar
        // on a phone the title makes way for the buttons
        className="compose-bar"
        left={<button className="btn btn-ghost btn-small phone-only" onClick={onShowAssistant}>Assistant</button>}
        title={DRAFT_TITLES[draft.mode]}
      >
        <button className="btn btn-ghost btn-small" onClick={() => fileInput.current.click()} disabled={sending}>Attach</button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={e => {
            onAddFiles([...e.target.files]); // copied first: resetting the picker empties its list
            e.target.value = ''; // so the same file can be picked again after removing it
          }}
        />
        <SendButton sending={sending} onSend={onSend} onSchedule={onSchedule} />
        <button className="btn btn-ghost btn-small phone-only" onClick={onDiscard}>Discard</button>
      </PaneBar>
      <div className={`pane-body${dragging ? ' compose-dropping' : ''}`} {...dropTarget}>
        <div className="compose" onKeyDown={handleKeyDown}>
          {draft.error && <p className="form-error">{draft.error}</p>}

          <div className="compose-fields">
            <div className="compose-row">
              <label htmlFor={`${id}-from`}>From</label>
              <select
                id={`${id}-from`}
                value={draft.accountId ?? ''}
                onChange={e => onChange({ accountId: Number(e.target.value) })}
              >
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>{account.email_address}</option>
                ))}
              </select>
            </div>
            <div className="compose-row">
              <label htmlFor={`${id}-to`}>To</label>
              <input type="text" autoComplete="off" autoFocus={draft.mode !== 'reply'} {...field('to')} />
              {!draft.showCcBcc && (
                <button type="button" className="compose-ccbcc" onClick={() => onChange({ showCcBcc: true })}>Cc/Bcc</button>
              )}
            </div>
            {draft.showCcBcc && (
              <>
                <div className="compose-row">
                  <label htmlFor={`${id}-cc`}>Cc</label>
                  <input type="text" autoComplete="off" {...field('cc')} />
                </div>
                <div className="compose-row">
                  <label htmlFor={`${id}-bcc`}>Bcc</label>
                  <input type="text" autoComplete="off" {...field('bcc')} />
                </div>
              </>
            )}
            <div className="compose-row">
              <label htmlFor={`${id}-subject`}>Subject</label>
              <input type="text" {...field('subject')} />
            </div>
          </div>

          {draft.attachments.length > 0 && (
            <div className="compose-attachments">
              <ul>
                {draft.attachments.map(a => (
                  <li key={a.key}>
                    <span className="attachment-name">{a.name}</span>
                    <span className="attachment-size">{fileSize(a.size)}</span>
                    <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemoveAttachment(a.key)} disabled={sending}>×</button>
                  </li>
                ))}
              </ul>
              <span className={`compose-attachments-total${tooBig ? ' too-big' : ''}`}>
                {fileSize(total)} of 25 MB{tooBig && ': remove some to send'}
              </span>
            </div>
          )}

          {draft.aiPrevious && (
            <div className="compose-ai">
              <span><span className="ai-tag">AI</span> The assistant wrote this draft.</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={onUndoAiDraft}>Undo</button>
            </div>
          )}

          <textarea
            className="compose-body"
            aria-label="Email text"
            autoFocus={draft.mode === 'reply'}
            {...field('body')}
          />

          {draft.quoted && (draft.mode === 'forward' ? (
            <div className="compose-quoted"><Linkify text={draft.quoted} /></div>
          ) : (
            <details className="compose-quoted-toggle">
              <summary>Quoted text</summary>
              <div className="compose-quoted"><Linkify text={draft.quoted} /></div>
            </details>
          ))}

          <p className="compose-hint desktop-only">
            Ctrl+Enter sends. After sending, you can undo for 15 seconds. Drop files anywhere here to attach them.
          </p>
        </div>
      </div>
    </>
  );
}

export default ComposeView;
