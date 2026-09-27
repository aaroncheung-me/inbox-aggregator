import { useCallback, useSyncExternalStore } from 'react';

// True while the CSS media query matches; re-renders when that changes
// (rotating a phone, resizing a window).
export function useMediaQuery(query) {
  const subscribe = useCallback(onChange => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
