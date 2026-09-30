import { useEffect, useRef, useState } from 'react';
import { syncAll, getAccounts, getMessages, getNotes, getTempAddresses } from '../api';
import { PAGE_SIZE } from '../features/email/useMessageList';

const REFRESH_ON_RETURN_MS = 30 * 1000;
// Opening the app syncs if the least recently synced account is older than this.
// (On a free host the server sleeps, so nothing syncs in the background.)
const SYNC_ON_OPEN_AFTER_MS = 5 * 60 * 1000;
// StrictMode runs effects twice in development; this keeps the startup sync to one run
let startupSyncStarted = false;

// The least recently synced account decides the "synced Xm ago" label, so it
// never looks fresher than it is. Any never-synced account means "never synced".
export function oldestSyncTime(accounts) {
  if (!accounts.length) return null;
  const times = accounts.map(a => a.last_synced_at);
  if (times.some(t => !t)) return null;
  return times.reduce((oldest, t) => (t < oldest ? t : oldest));
}

// Syncs every account, then fetches what the sidebar needs to reflect it. The
// first page is fetched even when this sync found nothing: the background sync
// may already have saved mail the list doesn't show yet.
// folder: the list on screen, 'inbox' or 'sent'
async function syncAndReload(folder) {
  const result = await syncAll();
  for (const r of result.results) {
    if (r.error) console.error(`Sync failed for ${r.emailAddress}: ${r.error}`);
  }
  // temp addresses too, since their email counts may have changed
  const [accounts, page, temp] = await Promise.all([
    getAccounts(),
    getMessages({ limit: PAGE_SIZE, offset: 0, folder }),
    getTempAddresses().catch(() => null),
  ]);
  return { accounts, page, temp };
}

// Keeps the app's mail fresh: loads the accounts on open and syncs when their
// mail is stale (or right after connecting one: syncNow), "Sync now", and a
// quick reload when coming back to the app.
// list: useMessageList. setAccounts, setTemp, setNotes: where fresh data goes.
export function useSync({ syncNow, list, setAccounts, setTemp, setNotes, refreshStatus }) {
  const [syncing, setSyncing] = useState(syncNow);

  useEffect(() => {
    const accountsLoaded = getAccounts();
    accountsLoaded.then(setAccounts).catch(() => {});

    if (startupSyncStarted) return;
    startupSyncStarted = true;

    // Sync right after connecting an account, or when opening the app with stale
    // mail. The saved messages show immediately; new ones appear when this finishes.
    const syncNeeded = syncNow
      ? Promise.resolve(true)
      : accountsLoaded.then(accounts => {
          const oldest = oldestSyncTime(accounts);
          return accounts.length > 0 && (!oldest || Date.now() - new Date(oldest).getTime() > SYNC_ON_OPEN_AFTER_MS);
        });

    syncNeeded
      .then(needed => {
        if (!needed) return;
        setSyncing(true);
        const version = list.startReload();
        return syncAndReload(list.folderRef.current).then(({ accounts, page, temp }) => {
          setAccounts(accounts);
          if (temp) setTemp(temp);
          list.showNewMail(page, version);
        });
      })
      .catch(err => console.error(err))
      .finally(() => setSyncing(false));
  // only on opening the app
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const version = list.startReload();
      const { accounts, page, temp } = await syncAndReload(list.folderRef.current);
      setAccounts(accounts);
      if (temp) setTemp(temp);
      list.showNewMail(page, version);
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
      refreshStatus(); // indexing new mail may have hit a credits problem
    }
  }

  // Coming back to the app (its tab or window, or reopening the phone app)
  // picks up what the background sync saved meanwhile, and notes changed on
  // another device. Only reads the database, at most once per REFRESH_ON_RETURN_MS.
  const lastRefresh = useRef(0);
  const refreshOnReturn = useRef(null);
  useEffect(() => {
    lastRefresh.current = Date.now(); // opening the app just loaded everything
  }, []);
  useEffect(() => {
    refreshOnReturn.current = async () => {
      if (syncing || Date.now() - lastRefresh.current < REFRESH_ON_RETURN_MS) return;
      lastRefresh.current = Date.now();
      const version = list.currentVersion();
      try {
        const [page, freshAccounts, freshNotes, freshTemp] = await Promise.all([
          getMessages({ limit: PAGE_SIZE, offset: 0, folder: list.folderRef.current }),
          getAccounts(),
          getNotes(),
          getTempAddresses().catch(() => null),
        ]);
        list.showNewMail(page, version);
        setAccounts(freshAccounts);
        setNotes(freshNotes);
        if (freshTemp) setTemp(freshTemp);
      } catch (err) {
        console.error(err);
      }
    };
  });
  useEffect(() => {
    const handleReturn = () => {
      if (document.visibilityState === 'visible') refreshOnReturn.current?.();
    };
    document.addEventListener('visibilitychange', handleReturn);
    window.addEventListener('focus', handleReturn);
    return () => {
      document.removeEventListener('visibilitychange', handleReturn);
      window.removeEventListener('focus', handleReturn);
    };
  }, []);

  return { syncing, sync };
}
