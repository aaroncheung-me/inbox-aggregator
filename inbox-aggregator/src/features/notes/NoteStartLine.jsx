import VoiceButton from '../../ui/VoiceButton';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { transcribeRecording } from '../../api';

// The phone's Notes tab starts with this line instead of a cramped box:
// tapping it opens the full-screen new note (onStart). Voice skips the page:
// what's spoken is AI-saved at once (onAiSave(body, addons)), as in the box.
function NoteStartLine({ onStart, onAiSave }) {
  const voice = useVoiceRecorder(async recording => {
    await onAiSave(await transcribeRecording(recording), []);
  });

  return (
    <div className="note-start">
      <div className="note-start-row">
        <button type="button" className="note-start-button" onClick={onStart}>Write a note...</button>
        <VoiceButton recorder={voice} workingLabel="AI saving..." />
      </div>
      {voice.error && <p className="form-error">{voice.error}</p>}
    </div>
  );
}

export default NoteStartLine;
