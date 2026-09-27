import { timeAgo } from '../format';

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