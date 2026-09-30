import { useRef, useState } from 'react';
import { getAccounts, updateAccount } from '../../api';

// The connected accounts, with their show-in-inbox checkboxes and colors.
// (They're loaded on open by useSync, which decides from them whether to sync.)
export function useAccounts({ onNotice, reloadMessages }) {
  const [accounts, setAccounts] = useState([]);
  const saveTimers = useRef(new Map()); // "accountId:field" -> pending save timer

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

  // Changes one setting on screen at once, then saves it once it stops
  // changing (a color picker fires on every step of a drag, a signature on
  // every key). On failure, reloads the accounts so they show what's saved.
  function changeSoon(accountId, field, value, delayMs, failText) {
    setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, [field]: value } : a)));

    const key = `${accountId}:${field}`;
    clearTimeout(saveTimers.current.get(key));
    saveTimers.current.set(key, setTimeout(async () => {
      saveTimers.current.delete(key);
      try {
        await updateAccount(accountId, { [field]: value });
      } catch (err) {
        console.error(err);
        onNotice({ type: 'error', text: failText });
        getAccounts().then(setAccounts).catch(() => {});
      }
    }, delayMs));
  }

  function changeColor(accountId, color) {
    changeSoon(accountId, 'color', color, 400, "Couldn't save that color, try again");
  }

  // plain text, added to emails written from this account
  function changeSignature(accountId, signature) {
    changeSoon(accountId, 'signature', signature, 800, "Couldn't save that signature, try again");
  }

  function refresh() {
    getAccounts().then(setAccounts).catch(() => {});
  }

  return { accounts, setAccounts, toggle, changeColor, changeSignature, refresh };
}
