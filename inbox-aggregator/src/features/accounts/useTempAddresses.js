import { useEffect, useRef, useState } from 'react';
import { getTempAddresses, createTempAddress, updateTempAddress, deleteTempAddress } from '../../api';

// Temp addresses: { available, reason, domain, addresses } (see TempAddresses),
// or null until loaded.
export function useTempAddresses({ onNotice, reloadMessages }) {
  const [temp, setTemp] = useState(null);
  const colorTimers = useRef(new Map());

  useEffect(() => {
    getTempAddresses().then(setTemp).catch(() => {});
  }, []);

  async function create(lifetime, label) {
    const created = await createTempAddress(lifetime, label);
    setTemp(await getTempAddresses());
    return created;
  }

  async function extend(id, lifetime) {
    await updateTempAddress(id, { lifetime });
    setTemp(await getTempAddresses());
  }

  function setLocally(id, changes) {
    setTemp(prev => prev && {
      ...prev,
      addresses: prev.addresses.map(a => (a.id === id ? { ...a, ...changes } : a)),
    });
  }

  // Like the account checkboxes: changes at once, then saves and reloads the
  // list; puts it back if saving fails.
  async function toggle(id, shown) {
    setLocally(id, { show_in_inbox: shown });
    try {
      await updateTempAddress(id, { show_in_inbox: shown });
      await reloadMessages();
    } catch (err) {
      console.error(err);
      setLocally(id, { show_in_inbox: !shown });
      onNotice({ type: 'error', text: "Couldn't update that temp address, try again" });
    }
  }

  // Like account colors: recolors at once (the list and open email read the
  // color from here), and saves once the picker stops changing.
  function changeColor(id, color) {
    setLocally(id, { color });
    clearTimeout(colorTimers.current.get(id));
    colorTimers.current.set(id, setTimeout(async () => {
      colorTimers.current.delete(id);
      try {
        await updateTempAddress(id, { color });
      } catch (err) {
        console.error(err);
        onNotice({ type: 'error', text: "Couldn't save that color, try again" });
        getTempAddresses().then(setTemp).catch(() => {});
      }
    }, 400));
  }

  // its emails are deleted too, so the list is reloaded
  async function remove(id) {
    await deleteTempAddress(id);
    setTemp(await getTempAddresses());
    await reloadMessages();
  }

  // temp address -> its current color, read by the list and the open email so recoloring shows at once
  const colors = new Map((temp?.addresses || []).map(a => [a.address, a.color]));

  return { temp, setTemp, colors, create, extend, toggle, changeColor, remove };
}
