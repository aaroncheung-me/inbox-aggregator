import { useEffect, useState } from 'react';

// The current time in ms, refreshed every `intervalMs`, so things like "is this
// reminder due" update while the app stays open.
export function useNow(intervalMs = 60 * 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
