// Always dollars, so a fraction of a cent can't be misread: $0.0052, $0.031
function formatCost(usd) {
  if (usd == null) return null;
  return `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
}

function formatDate(isoString) {
  return isoString ? new Date(isoString).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

// Turns [#123] markers in the answer into numbered buttons that open the email.
function AnswerText({ text, sources, onOpenMessage }) {
  const numberById = new Map(sources.map((s, i) => [s.id, i + 1]));
  return text.split(/(\[#\d+\])/g).map((part, i) => {
    const match = /^\[#(\d+)\]$/.exec(part);
    if (!match) return <span key={i}>{part}</span>;

    const id = Number(match[1]);
    const number = numberById.get(id);
    if (!number) return null;
    return (
      <button key={i} className="citation" onClick={() => onOpenMessage(id)} title={sources[number - 1].subject || ''}>
        {number}
      </button>
    );
  });
}

function ChatPanel({ history, loading, error, onOpenMessage }) {
  if (history.length === 0 && !loading && !error) {
    return (
      <div className="chat-panel chat-empty">
        <p>Ask a question about your email, for example:</p>
        <p className="chat-example">"Find my glasses prescription"</p>
        <p className="chat-example">"Did I hear back from any of the companies I applied to?"</p>
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
            <AnswerText text={exchange.answer} sources={exchange.sources} onOpenMessage={onOpenMessage} />
          </div>

          {exchange.sources.length > 0 && (
            <ol className="chat-sources">
              {exchange.sources.map(source => (
                <li key={source.id}>
                  <button className="source-link" onClick={() => onOpenMessage(source.id)}>
                    <span className="source-subject">{source.subject || '(no subject)'}</span>
                    <span className="source-meta">{source.sender} · {formatDate(source.received_at)}</span>
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

      {loading && <div className="chat-thinking">Searching your email...</div>}
      {error && <div className="chat-error">Error: {error}</div>}
    </div>
  );
}

export default ChatPanel;
