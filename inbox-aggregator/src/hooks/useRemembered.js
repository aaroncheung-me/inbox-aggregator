import { useState } from 'react';

// A small choice remembered on this device (localStorage), such as which side
// the split goes on. Storage can be unavailable (private windows); the choice
// then lasts until the app is closed. allowed: the values accepted from storage.
export function useRemembered(key, fallback, allowed) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return allowed.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });

  function remember(next) {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // not remembered, but still used for now
    }
  }

  return [value, remember];
}
