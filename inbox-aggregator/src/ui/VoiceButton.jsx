// The button for a useVoiceRecorder: "Voice" to start, "Stop 0:12" while
// recording, then a label for whatever happens next (e.g. "Saving...").
function VoiceButton({ recorder, workingLabel = 'Working...', disabled = false, className = '' }) {
  // the public demo has no server to transcribe with (see src/demo/)
  if (import.meta.env.MODE === 'demo') return null;
  const seconds = Math.floor(recorder.elapsed / 1000);
  const label = recorder.state === 'recording'
    ? `Stop ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : recorder.state === 'working' ? workingLabel : 'Voice';

  return (
    <button
      type="button"
      className={`btn btn-small voice-button ${recorder.state} ${className}`}
      onClick={recorder.toggle}
      disabled={disabled || recorder.state === 'working'}
      aria-label={recorder.state === 'recording' ? 'Stop recording' : 'Record voice'}
      title="Speak instead of typing (up to 1 minute)"
    >
      {recorder.state === 'recording' && <span className="recording-dot" aria-hidden="true" />}
      {label}
    </button>
  );
}

export default VoiceButton;
