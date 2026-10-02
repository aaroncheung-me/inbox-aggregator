import { useState } from 'react';
import VoiceButton from '../../ui/VoiceButton';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { transcribeRecording } from '../../api';

const MODES = {
  ai: {
    label: 'AI',
    placeholder: 'Ask your AI assistant...',
    button: 'Ask',
    ariaLabel: 'Ask AI about your inbox',
  },
  search: {
    label: 'Search',
    placeholder: 'Search email: words, from:name, has:attachment',
    button: 'Search',
    ariaLabel: 'Search',
  },
};

// One box, two modes: ask the AI assistant, or a plain search (free, instant)
// whose results replace the list below. AI mode tints the whole block, so it's
// clear at a glance which one a press of the button does; the block stays the
// same size either way.
// mode / onModeChange: kept by the app, so the sidebar's bar and the phone's
//   copy of it agree.
// placeholders: { ai?, search? } replace the defaults (while writing, the box
//   asks that email's assistant; on Notes, it searches notes).
// resetKey: when it changes, the box empties (another tab, or a search closed).
// topAction: { label, onClick }, a button beside the mode switch (New email).
function AskBar({ mode, onModeChange, onAsk, onSearch, asking, autoFocus = false, placeholders = {}, resetKey, topAction }) {
  const [input, setInput] = useState('');
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (resetKey !== seenResetKey) {
    setSeenResetKey(resetKey);
    setInput('');
  }
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
    <div className={`ask-bar ask-bar-${mode}`}>
      <div className="ask-bar-top">
        <div className="mode-toggle" role="group" aria-label="Ask or search">
          {Object.entries(MODES).map(([key, m]) => (
            <button
              key={key}
              type="button"
              className={mode === key ? 'active' : ''}
              aria-pressed={mode === key}
              onClick={() => onModeChange(key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {topAction && (
          <button type="button" className="btn btn-small" onClick={topAction.onClick}>
            {topAction.label}
          </button>
        )}
      </div>
      <form className="ask-bar-row" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={placeholders[mode] || current.placeholder}
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
