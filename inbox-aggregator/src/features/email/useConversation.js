import { useEffect, useState } from 'react';
import { getConversation } from '../../api';

// The other emails in the open email's conversation (see GET
// /messages/:id/conversation), or [] until they arrive, when there are none,
// or if loading them fails (the email shows without them).
export function useConversation(messageId) {
  const [loaded, setLoaded] = useState(null); // { messageId, emails }

  useEffect(() => {
    if (messageId == null) return;
    let cancelled = false;
    getConversation(messageId)
      .then(emails => { if (!cancelled) setLoaded({ messageId, emails }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [messageId]);

  return loaded?.messageId === messageId ? loaded.emails : [];
}
