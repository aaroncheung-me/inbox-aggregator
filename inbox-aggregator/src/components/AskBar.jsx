import { useState } from 'react';

const MODES = {
  ai: {
    label: 'AI',
    placeholder: 'Ask your AI assistant...',
    button: 'Ask',
    ariaLabel: 'Ask AI about your inbox',
  },
  search: {
    label: 'Search',
    placeholder: 'Words, from:name, after:2025-01-01, has:attachment',
    button: 'Search',
    ariaLabel: 'Search your email',
  },
};

// One box, two modes: ask the AI assistant, or a plain search (free, instant)
// that lists matching emails in the sidebar.
function AskBar({ onAsk, onSearch, onFocusChat, asking }) {
  const [mode, setMode] = useState('ai');
  const [input, setInput] = useState('');
  const current = MODES[mode];

  function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    if (mode === 'ai') {
      if (asking) return;
      onAsk(text);
      setInput('');
    } else {
      onSearch(text); // search text stays in the box so it can be refined
    }
  }

  return (
    <div className="ask-bar">
      <div className="mode-toggle" role="group" aria-label="Search mode">
        {Object.entries(MODES).map(([key, m]) => (
          <button
            key={key}
            type="button"
            className={mode === key ? 'active' : ''}
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <form className="ask-bar-row" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={mode === 'ai' ? onFocusChat : undefined}
          placeholder={current.placeholder}
          aria-label={current.ariaLabel}
        />
        <button type="submit" className="btn" disabled={mode === 'ai' && asking}>
          {mode === 'ai' && asking ? '...' : current.button}
        </button>
      </form>
    </div>
  );
}

export default AskBar;
