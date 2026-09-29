import { useId } from 'react';
import { DRAFT_TITLES } from '../compose';
import PaneBar from './PaneBar';
import Linkify from './Linkify';

// The writing screen, in the main pane. Plain text only for now.
// draft: see newDraft in compose.js. onChange(changes) merges into it.
// Top bar: on a phone, "Assistant" switches to the email's assistant (whose own
// bar has "Back to email" in the same spot), and Discard sits far right, as on
// that screen. On desktop Discard is at the top of the sidebar instead.
// Only Send or Ctrl+Enter sends; Enter in a field doesn't.
function ComposeView({ draft, accounts, sending, onChange, onSend, onDiscard, onUndoAiDraft, onShowAssistant }) {
  const id = useId();
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
        left={<button className="btn btn-ghost btn-small phone-only" onClick={onShowAssistant}>Assistant</button>}
        title={DRAFT_TITLES[draft.mode]}
      >
        <button className="btn btn-small" onClick={onSend} disabled={sending}>{sending ? 'Sending...' : 'Send'}</button>
        <button className="btn btn-ghost btn-small phone-only" onClick={onDiscard}>Discard</button>
      </PaneBar>
      <div className="pane-body">
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
          {draft.attachmentsLeftOut > 0 && (
            <p className="compose-note">
              The original's {draft.attachmentsLeftOut === 1 ? 'attachment is' : `${draft.attachmentsLeftOut} attachments are`} not
              included: forwarding attachments isn't supported yet.
            </p>
          )}

          <p className="compose-hint desktop-only">Ctrl+Enter sends. After sending, you can undo for 15 seconds.</p>
        </div>
      </div>
    </>
  );
}

export default ComposeView;
