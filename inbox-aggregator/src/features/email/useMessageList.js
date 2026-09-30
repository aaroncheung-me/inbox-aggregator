import { useEffect, useRef, useState } from 'react';
import { getMessages } from '../../api';

export const PAGE_SIZE = 25;

// The freshly fetched first page on top, then the rest of what's already listed
// (emails pushed down by new ones, and any pages added with "Load more").
function mergeFirstPage(listed, page) {
  const fresh = new Set(page.messages.map(m => m.id));
  return [...page.messages, ...listed.filter(m => !fresh.has(m.id))];
}

// The email list: Received or Sent (they share the one list), pinned emails in
// their own group above it, and "Load more". Every reload bumps `version`, so a
// slower, older response can be recognized and dropped.
export function useMessageList() {
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  // pinned emails, shown in their own group above Received (sent with the first page)
  const [pinned, setPinned] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // bumped whenever the list is reloaded, so slower, older responses can be ignored
  const version = useRef(0);
  // which mail the list holds: 'inbox' (received) or 'sent', chosen above the
  // list. The ref is for async code that must use the current one.
  const [folder, setFolder] = useState('inbox');
  const folderRef = useRef('inbox');

  useEffect(() => {
    getMessages({ limit: PAGE_SIZE, offset: 0 })
      .then(data => {
        setMessages(data.messages);
        setPinned(data.pinned || []);
        setTotal(data.total);
      })
      .catch(() => {});
  }, []);

  // Replaces the list with the first page. Returns false if a newer reload
  // started while this one was in flight (its result is then dropped).
  function showFirstPage(page, pageVersion) {
    if (pageVersion !== version.current) return false;
    setMessages(page.messages);
    setTotal(page.total);
    setPinned(page.pinned || []);
    return true;
  }

  // After a sync: adds newly arrived mail to the top without losing "Load more" progress.
  function showNewMail(page, pageVersion) {
    if (pageVersion !== version.current) return;
    setMessages(prev => mergeFirstPage(prev, page));
    setTotal(page.total);
    setPinned(page.pinned || []);
  }

  async function reload() {
    const reloadVersion = ++version.current;
    showFirstPage(await getMessages({ limit: PAGE_SIZE, offset: 0, folder: folderRef.current }), reloadVersion);
  }

  // Received and Sent share the one list: switching between them reloads it.
  function changeFolder(next) {
    if (next === folderRef.current) return;
    folderRef.current = next;
    setFolder(next);
    setMessages([]);
    setTotal(0);
    reload().catch(err => console.error(err));
  }

  async function loadMore() {
    const moreVersion = version.current;
    setLoadingMore(true);
    try {
      const data = await getMessages({ limit: PAGE_SIZE, offset: messages.length, folder: folderRef.current });
      // the list was reloaded mid-request (e.g. an account toggled), so this page no longer fits
      if (moreVersion === version.current) setMessages(prev => [...prev, ...data.messages]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    messages,
    total,
    pinned,
    loadingMore,
    folder,
    folderRef,
    // for a sync that reloads the list: startReload() before fetching, then
    // showNewMail(page, thatVersion); currentVersion() to only add to the list
    startReload: () => ++version.current,
    currentVersion: () => version.current,
    showNewMail,
    reload,
    changeFolder,
    loadMore,
  };
}
