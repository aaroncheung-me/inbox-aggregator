import { useEffect, useState } from 'react';
import { getMessageHtml } from '../api';

// The recently opened emails' formatted versions, so going back to one is instant.
const cache = new Map(); // messageId -> { status: 'ready', html, inlinePartIds }
const CACHE_SIZE = 20;

function remember(messageId, result) {
  cache.delete(messageId);
  cache.set(messageId, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value); // the oldest
}

// The open email's formatted version, fetched from the mail provider (about a
// second). Returns { status, html, inlinePartIds }: status 'loading', 'ready'
// or 'failed'. html is null for plain-text email and until it arrives.
export function useEmailHtml(messageId) {
  const [loaded, setLoaded] = useState(null); // { messageId, status, html, inlinePartIds }
  const cached = cache.get(messageId);

  useEffect(() => {
    if (messageId == null || cache.has(messageId)) return;
    let cancelled = false;
    getMessageHtml(messageId)
      .then(({ html, inlinePartIds }) => {
        const result = { status: 'ready', html, inlinePartIds };
        remember(messageId, result);
        if (!cancelled) setLoaded({ messageId, ...result });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ messageId, status: 'failed', html: null, inlinePartIds: [] });
      });
    return () => { cancelled = true; };
  }, [messageId]);

  if (cached) return cached;
  // a result for a different email counts as still loading
  if (loaded?.messageId !== messageId) return { status: 'loading', html: null, inlinePartIds: [] };
  return loaded;
}
