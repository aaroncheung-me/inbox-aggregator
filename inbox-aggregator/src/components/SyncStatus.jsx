import { timeAgo } from '../format';

// "synced 5m ago  [Sync now]", at the right of the inbox's list header
function SyncStatus({ lastSyncedAt, onSync, syncing }) {
  return (
    <div className="sync-status">
      <span>{syncing ? 'Syncing...' : timeAgo(lastSyncedAt)}</span>
      <button className="btn btn-ghost btn-small" onClick={onSync} disabled={syncing}>
        {syncing ? '...' : 'Sync now'}
      </button>
    </div>
  );
}

export default SyncStatus;