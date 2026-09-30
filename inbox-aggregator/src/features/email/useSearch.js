import { useState } from 'react';
import { searchMessagesBasic } from '../../api';

// Plain search. `search` is null while the list shows the inbox, otherwise
// { query, results, hasMore, loading, loadingMore, error }.
export function useSearch() {
  const [search, setSearch] = useState(null);

  // Results only apply if the search box still holds the same query when they arrive.
  function updateIfCurrent(query, changes) {
    setSearch(prev => (prev?.query === query ? { ...prev, ...changes } : prev));
  }

  async function run(query) {
    setSearch({ query, results: [], hasMore: false, loading: true, loadingMore: false, error: null });
    try {
      const data = await searchMessagesBasic(query);
      updateIfCurrent(query, { results: data.messages, hasMore: data.hasMore, loading: false });
    } catch (err) {
      updateIfCurrent(query, { loading: false, error: err.message });
    }
  }

  async function loadMore() {
    const { query, results } = search;
    updateIfCurrent(query, { loadingMore: true });
    try {
      const data = await searchMessagesBasic(query, { offset: results.length });
      setSearch(prev => (prev?.query === query
        ? { ...prev, results: [...prev.results, ...data.messages], hasMore: data.hasMore, loadingMore: false }
        : prev));
    } catch (err) {
      console.error(err);
      updateIfCurrent(query, { loadingMore: false });
    }
  }

  return { search, run, loadMore, clear: () => setSearch(null) };
}
