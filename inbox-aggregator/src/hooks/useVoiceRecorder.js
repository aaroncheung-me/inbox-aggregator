import { useEffect, useRef, useState } from 'react';

const MAX_MS = 60 * 1000; // recordings stop by themselves after a minute
const MIN_MS = 600;       // shorter than this is taken as an accidental tap
// what to record in, best first: Chrome/Edge do webm, iPhone Safari does mp4
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

// Records from the microphone. toggle() starts, and stops again; when a
// recording ends, onRecorded(blob) runs, and state stays 'working' until it
// finishes. state: 'idle' | 'recording' | 'working'. elapsed: ms recorded so far.
export function useVoiceRecorder(onRecorded) {
  const [state, setState] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);

  const recorder = useRef(null);
  const timer = useRef(null);
  const handler = useRef(onRecorded);
  useEffect(() => { handler.current = onRecorded; });

  // leaving the screen mid-recording releases the microphone
  useEffect(() => () => {
    clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach(track => track.stop());
  }, []);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError("Voice recording isn't supported in this browser");
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access was blocked. Allow it in your browser or phone settings.');
      return;
    }

    const format = FORMATS.find(type => MediaRecorder.isTypeSupported(type));
    const rec = new MediaRecorder(stream, format ? { mimeType: format } : undefined);
    const chunks = [];
    const startedAt = Date.now();

    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearInterval(timer.current);
      stream.getTracks().forEach(track => track.stop());
      recorder.current = null;

      if (Date.now() - startedAt < MIN_MS) {
        setState('idle');
        setElapsed(0);
        setError('That was too short. Tap once to start, speak, then tap again to stop.');
        return;
      }

      setState('working');
      try {
        await handler.current(new Blob(chunks, { type: rec.mimeType || format || 'audio/webm' }));
      } catch (err) {
        setError(err.message);
      } finally {
        setState('idle');
        setElapsed(0);
      }
    };

    recorder.current = rec;
    rec.start();
    setState('recording');
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_MS && rec.state === 'recording') rec.stop();
    }, 250);
  }

  function toggle() {
    if (state === 'recording') recorder.current?.stop();
    else if (state === 'idle') start();
  }

  return { state, elapsed, error, toggle, clearError: () => setError(null) };
}
