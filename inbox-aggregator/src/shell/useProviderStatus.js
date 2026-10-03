import { useEffect, useState } from 'react';
import { getStatus } from '../api';

const CHECK_EVERY_MS = 5 * 60 * 1000;

// Out-of-credits problems with the AI providers, for the red banner. Checked on
// open and every few minutes, since background syncs can hit it too, and again
// (refresh) after anything that used AI.
export function useProviderStatus() {
  const [problems, setProblems] = useState([]);
  const [hidden, setHidden] = useState({}); // provider -> the `since` that was hidden

  function refresh() {
    getStatus().then(status => setProblems(status.problems)).catch(() => {});
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  function hide(problem) {
    setHidden(prev => ({ ...prev, [problem.provider]: problem.since }));
  }

  return { problems, hidden, refresh, hide };
}
