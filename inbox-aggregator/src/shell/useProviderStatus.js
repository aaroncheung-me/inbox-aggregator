import { useEffect, useState } from 'react';
import { getStatus } from '../api';

// Out-of-credits problems with the AI providers, for the red banner. Checked on
// open and every few minutes, since background syncs can hit it too, and again
// (refresh) after anything that used AI.
export function useProviderStatus() {
  const [problems, setProblems] = useState([]);
  const [hidden, setHidden] = useState({}); // provider -> the `since` that was hidden

  useEffect(() => {
    let active = true;
    const load = () => getStatus().then(status => { if (active) setProblems(status.problems); }).catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  function refresh() {
    getStatus().then(status => setProblems(status.problems)).catch(() => {});
  }

  function hide(problem) {
    setHidden(prev => ({ ...prev, [problem.provider]: problem.since }));
  }

  return { problems, hidden, refresh, hide };
}
