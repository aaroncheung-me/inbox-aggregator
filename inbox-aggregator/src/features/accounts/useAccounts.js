import { useRef, useState } from 'react';
import { getAccounts, updateAccount } from '../../api';

// The connected accounts, with their show-in-inbox checkboxes and colors.
// (They're loaded on open by useSync, which decides from them whether to sync.)
export function useAccounts({ onNotice, reloadMessages }) {
  const [accounts, setAccounts] = useState([]);
  const colorSaveTimers = useRef(new Map()); // accountId -> pending save timer

  // Updates the checkbox immediately, then saves; puts it back if saving fails.
  async function toggle(accountId, showInInbox) {
    const setShown = shown =>
      setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, show_in_inbox: shown } : a)));

    setShown(showInInbox);
    try {
      await updateAccount(accountId, { show_in_inbox: showInInbox });
      await reloadMessages();
    } catch (err) {
      console.error(err);
      setShown(!showInInbox);
      onNotice({ type: 'error', text: "Couldn't update that account, try again" });
    }
  }

  // Recolors immediately; saves once the color stops changing, since the
  // custom picker fires on every step of a drag. On failure, reloads the
  // accounts so the dot shows what's actually saved.
  function changeColor(accountId, color) {
    setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, color } : a)));

    clearTimeout(colorSaveTimers.current.get(accountId));
    colorSaveTimers.current.set(accountId, setTimeout(async () => {
      colorSaveTimers.current.delete(accountId);
      try {
        await updateAccount(accountId, { color });
      } catch (err) {
        console.error(err);
        onNotice({ type: 'error', text: "Couldn't save that color, try again" });
        getAccounts().then(setAccounts).catch(() => {});
      }
    }, 400));
  }

  function refresh() {
    getAccounts().then(setAccounts).catch(() => {});
  }

  return { accounts, setAccounts, toggle, changeColor, refresh };
}
