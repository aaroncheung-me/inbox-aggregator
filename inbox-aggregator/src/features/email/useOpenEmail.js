import { useEffect, useState } from 'react';
import { getMessage, pinMessage } from '../../api';

const KEEP_LOADED = 20; // emails remembered, so going back to a tab shows at once

const remembering = entry => prev => [...prev.filter(e => e.id !== entry.id), entry].slice(-KEEP_LOADED);

// The open email's full details, fetched whenever one is selected. Emails
// fetched before stay remembered (a few), so switching back to one shows it
// straight away while it's fetched again (its sticky notes may have changed).
// A response for an email that's no longer selected still updates its memory,
// but can't show under a newer selection.
export function useOpenEmail(selectedMessageId, { reloadMessages, onNotice }) {
  // fetched emails, most recent last: [{ id, message, error }]
  const [loaded, setLoaded] = useState([]);
  const current = loaded.find(entry => entry.id === selectedMessageId) || null;
  const message = current?.message ?? null;

  useEffect(() => {
    if (selectedMessageId == null) return;
    getMessage(selectedMessageId)
      .then(fetched => setLoaded(remembering({ id: selectedMessageId, message: fetched, error: null })))
      // a failed refresh keeps what was already showing
      .catch(err => setLoaded(prev => (prev.some(e => e.id === selectedMessageId && e.message)
        ? prev
        : remembering({ id: selectedMessageId, message: null, error: err.message })(prev))));
  }, [selectedMessageId]);

  // Pins or unpins the open email, then reloads the list so it moves in or out
  // of the Pinned group.
  async function togglePin() {
    if (!message) return;
    try {
      const { pinned_at } = await pinMessage(message.id, !message.pinned_at);
      setLoaded(prev => prev.map(e => (e.id === message.id ? { ...e, message: { ...e.message, pinned_at } } : e)));
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
