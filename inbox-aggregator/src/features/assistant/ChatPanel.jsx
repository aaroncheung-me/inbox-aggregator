import Linkify from '../../ui/Linkify';

// Always dollars, so a fraction of a cent can't be misread: $0.0052, $0.031
function formatCost(usd) {
  if (usd == null) return null;
  return `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
}

function formatDate(isoString) {
  return isoString ? new Date(isoString).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

// Sources are emails ({ kind: 'email', id, subject, sender, received_at })
// or notes ({ kind: 'note', id, title }).
const sourceKey = source => `${source.kind === 'note' ? 'note' : 'email'}:${source.id}`;

// Turns [#123] (email) and [note 12] markers in the answer into numbered
// buttons that open what they point at.
function AnswerText({ text, sources, onOpenSource }) {
  const numberByKey = new Map(sources.map((source, i) => [sourceKey(source), i + 1]));
  return text.split(/(\[(?:#|note )\d+\])/g).map((part, i) => {
    const match = /^\[(#|note )(\d+)\]$/.exec(part);
    if (!match) return <span key={i}><Linkify text={part} /></span>;

    const key = `${match[1] === '#' ? 'email' : 'note'}:${match[2]}`;
    const number = numberByKey.get(key);
    if (!number) return null;
    const source = sources[number - 1];
    return (
      <button key={i} className="citation" onClick={() => onOpenSource(source)} title={source.subject || source.title || ''}>
        {number}
      </button>
    );
  });
}

// Notes the assistant made in this answer, each with Open and Undo.
function CreatedNotes({ notes, onOpenNote, onUndo }) {
  return (
    <div className="created-notes">
      {notes.map(note => (
        <div key={note.id} className={`created-note${note.undone ? ' undone' : ''}`}>
          <span className="created-note-label">{note.undone ? 'Removed note:' : 'Created note:'}</span>
          <span className="created-note-title">{note.title}</span>
          {!note.undone && (
            <span className="created-note-actions">
              <button className="btn btn-ghost btn-small" onClick={() => onOpenNote(note.id)}>Open</button>
              <button className="btn btn-ghost btn-small" onClick={() => onUndo(note.id)}>Undo</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// The answer while it's being worked out: each search or lookup as it
// finishes, then the answer text as it's written. Citation markers like [#123]
// are hidden until the finished answer replaces this (they become buttons then).
function PendingAnswer({ pending, workingLabel }) {
  const text = pending.text
    .replace(/\[(?:#|note )\d+\]/g, '')
    .replace(/\[[^\]]*$/, ''); // a marker still being written
  return (
    <div className="chat-exchange pending">
      <div className="chat-question">{pending.question}</div>
      {pending.steps.length > 0 && (
        <ol className="chat-live-steps">
          {pending.steps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      )}
      {text.trim()
        ? <div className="chat-answer"><Linkify text={text} /></div>
        : <div className="chat-thinking">{workingLabel}</div>}
    </div>
  );
}

// A draft the assistant wrote for the email being written, with a button to put it in.
function DraftSuggestion({ draft, used, onUse }) {
  return (
    <div className="draft-suggestion">
      <div className="draft-suggestion-label">
        <span className="ai-tag">AI</span> Draft{draft.subject ? ` with the subject "${draft.subject}"` : ''}
      </div>
      <div className="draft-suggestion-text"><Linkify text={draft.body} /></div>
      {used
        ? <span className="draft-suggestion-used">In your email</span>
        : <button className="btn btn-small" onClick={onUse}>Use this draft</button>}
    </div>
  );
}

// emptyContent replaces the usual examples when there's nothing yet (the
// assistant beside the writing screen has its own). onUseDraft(exchangeIndex)
// is given there too, for drafts the assistant wrote.
// pending: the answer in progress, { question, steps, text } (see applyProgress in App.jsx).
function ChatPanel({
  history, loading, pending = null, error, onOpenMessage, onOpenNote, onUndoCreatedNote,
  emptyContent = null, onUseDraft = null, workingLabel = 'Searching your email and notes...',
}) {
  const openSource = source => (source.kind === 'note' ? onOpenNote(source.id) : onOpenMessage(source.id));

  if (history.length === 0 && !loading && !error && emptyContent) {
    return <div className="chat-panel chat-empty">{emptyContent}</div>;
  }

  if (history.length === 0 && !loading && !error) {
    return (
      <div className="chat-panel chat-empty">
        <p>Ask about your email and notes, for example:</p>
        <p className="chat-example">"Find my glasses prescription"</p>
        <p className="chat-example">"How are my job applications going?", then "save that as a note"</p>
        <p className="chat-example">With an email open: "note this email, remind me Friday"</p>
        <p className="chat-tip">Just looking for emails from someone? Switch the box to <strong>Search</strong>, it's instant and free.</p>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      {history.map((exchange, i) => (
        <div className="chat-exchange" key={i}>
          <div className="chat-question">{exchange.question}</div>
          <div className="chat-answer">
            <AnswerText text={exchange.answer} sources={exchange.sources} onOpenSource={openSource} />
          </div>

          {exchange.draft && onUseDraft && (
            <DraftSuggestion draft={exchange.draft} used={exchange.draftUsed} onUse={() => onUseDraft(i)} />
          )}

          {exchange.createdNotes?.length > 0 && (
            <CreatedNotes
              notes={exchange.createdNotes}
              onOpenNote={onOpenNote}
              onUndo={noteId => onUndoCreatedNote(i, noteId)}
            />
          )}

          {exchange.sources.length > 0 && (
            <ol className="chat-sources">
              {exchange.sources.map(source => (
                <li key={sourceKey(source)}>
                  <button className="source-link" onClick={() => openSource(source)}>
                    {source.kind === 'note' ? (
                      <>
                        <span className="source-subject">{source.title}</span>
                        <span className="source-meta">Your note</span>
                      </>
                    ) : (
                      <>
                        <span className="source-subject">{source.subject || '(no subject)'}</span>
                        <span className="source-meta">{source.sender} · {formatDate(source.received_at)}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="chat-footer">
            {exchange.steps.length > 0 && (
              <details className="chat-steps">
                <summary>How I searched ({exchange.steps.length} step{exchange.steps.length === 1 ? '' : 's'})</summary>
                <ol>
                  {exchange.steps.map((step, j) => <li key={j}>{step}</li>)}
                </ol>
              </details>
            )}
            {exchange.usage && (
              <span className="chat-cost">
                {[formatCost(exchange.usage.costUsd), exchange.usage.model].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </div>
      ))}

      {loading && (pending
        ? <PendingAnswer pending={pending} workingLabel={workingLabel} />
        : <div className="chat-thinking">{workingLabel}</div>)}
      {error && <div className="chat-error">Error: {error}</div>}
    </div>
  );
}

export default ChatPanel;
