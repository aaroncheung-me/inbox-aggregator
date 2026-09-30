import { useEffect, useState } from 'react';
import { getMessageHtml } from '../../api';

// The recently opened (or preloaded) emails' formatted versions, so opening
// one is instant. A fetch still under way is shared rather than repeated.
const cache = new Map(); // messageId -> { status: 'ready', html, inlinePartIds }
const inFlight = new Map(); // messageId -> Promise of that result
const CACHE_SIZE = 20;

function remember(messageId, result) {
  cache.delete(messageId);
  cache.set(messageId, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value); // the oldest
}

// Fetches one email's formatted version into the cache (once, however often
// it's asked). A failure isn't kept, so opening the email tries again.
function load(messageId) {
  if (!inFlight.has(messageId)) {
    const request = getMessageHtml(messageId)
      .then(({ html, inlinePartIds }) => {
        const result = { status: 'ready', html, inlinePartIds };
        remember(messageId, result);
        return result;
      })
      .finally(() => inFlight.delete(messageId));
    inFlight.set(messageId, request);
  }
  return inFlight.get(messageId);
}

// Starts loading an email that's likely to be opened next (the mouse resting on
// it in the list, or a finger touching it).
export function preloadEmailHtml(messageId) {
  if (!cache.has(messageId)) load(messageId).catch(() => {});
}

// The open email's formatted version, fetched from the mail provider (a
// fraction of a second). Returns { status, html, inlinePartIds }: status
// 'loading', 'ready' or 'failed'. html is null for plain-text email and until it arrives.
export function useEmailHtml(messageId) {
  const [loaded, setLoaded] = useState(null); // { messageId, status, html, inlinePartIds }
  const cached = cache.get(messageId);

  useEffect(() => {
    if (messageId == null || cache.has(messageId)) return;
    let cancelled = false;
    load(messageId)
      .then(result => {
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
