import { useSyncExternalStore } from 'react';

// "Load images in emails": on unless turned off in Settings, remembered on this
// device only. Off keeps images from the web out of emails (they tell senders
// when an email is opened); each email can still show them on request.

const KEY = 'loadImages';
const listeners = new Set();

function read() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true; // storage blocked: the default
  }
}

function subscribe(onChange) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange); // changed in another tab
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function setLoadImages(on) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // not remembered
  }
  listeners.forEach(onChange => onChange());
}

// true or false, updating wherever it's shown when Settings changes it
export function useLoadImages() {
  return useSyncExternalStore(subscribe, read);
}
