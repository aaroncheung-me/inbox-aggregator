import { useEffect, useState } from 'react';
import { getMessage, pinMessage } from '../../api';

// The open email's full details, fetched whenever one is selected. A response
// for an email that's no longer selected (clicked away before it arrived) is
// dropped, and loading and errors are read off the last fetch, so a stale
// response can't show under a newer selection.
export function useOpenEmail(selectedMessageId, { reloadMessages, onNotice }) {
  // the last email fetched: { id, message, error }
  const [loaded, setLoaded] = useState(null);
  const current = loaded?.id === selectedMessageId ? loaded : null;
  const message = current?.message ?? null;

  useEffect(() => {
    if (selectedMessageId == null) return;
    let stale = false;
    getMessage(selectedMessageId)
      .then(fetched => { if (!stale) setLoaded({ id: selectedMessageId, message: fetched, error: null }); })
      .catch(err => { if (!stale) setLoaded({ id: selectedMessageId, message: null, error: err.message }); });
    return () => { stale = true; };
  }, [selectedMessageId]);

  // Pins or unpins the open email, then reloads the list so it moves in or out
  // of the Pinned group.
  async function togglePin() {
    if (!message) return;
    try {
      const { pinned_at } = await pinMessage(message.id, !message.pinned_at);
      setLoaded(prev => (prev?.id === message.id ? { ...prev, message: { ...prev.message, pinned_at } } : prev));
      await reloadMessages();
    } catch (err) {
      onNotice({ type: 'error', text: err.message });
    }
  }

  return {
    message,
    error: current?.error ?? null,
    loading: selectedMessageId != null && !current,
    togglePin,
  };
}
