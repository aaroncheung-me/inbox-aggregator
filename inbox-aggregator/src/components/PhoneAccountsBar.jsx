import { useState } from 'react';
import AddAccountMenu from './AddAccountMenu';
import AccountList from './AccountList';
import { accountsSummary, timeAgo } from '../format';

// Phone layout: one bar under the message list, "Accounts (3) ... Sync now".
// Tapping Accounts opens a panel above it with the accounts, adding an
// account, the last sync time and sign-out.
function PhoneAccountsBar({
  accounts,
  onToggleAccount,
  onChangeColor,
  onAccountConnected,
  lastSyncedAt,
  onSync,
  syncing,
  userEmail,
  onSignOut,
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="phone-bar">
      {expanded && (
        <div className="phone-bar-panel">
          <AccountList accounts={accounts} onToggleAccount={onToggleAccount} onChangeColor={onChangeColor} />
          <div className="phone-bar-row">
            <AddAccountMenu onAccountConnected={onAccountConnected} />
            <span className="phone-bar-synced">{syncing ? 'Syncing...' : timeAgo(lastSyncedAt)}</span>
          </div>
          <div className="phone-bar-row">
            <span className="signed-in-as" title={userEmail}>{userEmail}</span>
            <button className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      )}

      <div className="phone-bar-main">
        <button className="accounts-heading" onClick={() => setExpanded(prev => !prev)} aria-expanded={expanded}>
          {/* the panel opens upward */}
          <span className="accounts-chevron" aria-hidden="true">{expanded ? '▾' : '▴'}</span>
          Accounts <span className="accounts-summary">({accountsSummary(accounts)})</span>
        </button>
        <button className="btn btn-ghost btn-small" onClick={onSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync now'}
        </button>
      </div>
    </div>
  );
}

export default PhoneAccountsBar;
