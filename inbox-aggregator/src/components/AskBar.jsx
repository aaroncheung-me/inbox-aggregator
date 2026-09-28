import { useState } from 'react';
import VoiceButton from './VoiceButton';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { transcribeRecording } from '../api';

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
// that lists matching emails in the sidebar. aiPlaceholder replaces the AI mode's
// hint (while writing an email, the box asks that email's assistant).
// topAction: { label, onClick, className? }, a button beside the mode switch (New email,
// or Discard while writing one).
function AskBar({ onAsk, onSearch, asking, autoFocus = false, aiPlaceholder, topAction }) {
  const [mode, setMode] = useState('ai');
  const [input, setInput] = useState('');
  const current = MODES[mode];

  // Voice acts at once: a spoken question is asked, a spoken search is run.
  const voice = useVoiceRecorder(async recording => {
    const spoken = await transcribeRecording(recording);
    if (mode === 'ai') {
      onAsk(spoken);
    } else {
      setInput(spoken);
      onSearch(spoken);
    }
  });

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
      <div className="ask-bar-top">
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
        {topAction && (
          <button type="button" className={`btn btn-small ${topAction.className || ''}`} onClick={topAction.onClick}>
            {topAction.label}
          </button>
        )}
      </div>
      <form className="ask-bar-row" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={(mode === 'ai' && aiPlaceholder) || current.placeholder}
          aria-label={current.ariaLabel}
          autoFocus={autoFocus}
        />
        <VoiceButton recorder={voice} workingLabel="..." disabled={mode === 'ai' && asking} />
        <button type="submit" className="btn" disabled={mode === 'ai' && asking}>
          {mode === 'ai' && asking ? '...' : current.button}
        </button>
      </form>
      {voice.error && <p className="form-error ask-bar-error">{voice.error}</p>}
    </div>
  );
}

export default AskBar;
