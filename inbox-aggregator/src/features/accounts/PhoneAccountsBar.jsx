import { useState } from 'react';
import AddAccountMenu from './AddAccountMenu';
import AccountList from './AccountList';
import TempAddresses from './TempAddresses';
import { accountsSummary } from '../../format';

// Phone layout: one bar under the message list, "Accounts (3)" with
// "+ Add account" beside it. Tapping the heading opens a panel above it with the
// accounts, temp addresses, Settings and sign-out.
// (Sync now sits above the list, beside Received | Sent.)
function PhoneAccountsBar({
  accounts,
  onToggleAccount,
  onChangeColor,
  onAccountConnected,
  userEmail,
  tempAddresses = null,
  onSignOut,
  onOpenSettings,
}) {
  const [expanded, setExpanded] = useState(false);
  const [creatingTemp, setCreatingTemp] = useState(false);
  const tempCount = tempAddresses?.temp?.addresses.length || 0;

  return (
    <div className="phone-bar">
      {expanded && (
        <div className="phone-bar-panel">
          <AccountList accounts={accounts} onToggleAccount={onToggleAccount} onChangeColor={onChangeColor} />
          {tempAddresses && (
            <TempAddresses {...tempAddresses} creating={creatingTemp} onCloseForm={() => setCreatingTemp(false)} />
          )}
          <div className="phone-bar-row">
            <span className="signed-in-as" title={userEmail}>{userEmail}</span>
            <span className="sidebar-footer-actions">
              <button className="btn btn-ghost btn-small" onClick={() => { setExpanded(false); onOpenSettings(); }}>Settings</button>
              <button className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
            </span>
          </div>
        </div>
      )}

      <div className="phone-bar-main">
        <button className="accounts-heading" onClick={() => setExpanded(prev => !prev)} aria-expanded={expanded}>
          {/* the panel opens upward */}
          <span className="accounts-chevron" aria-hidden="true">{expanded ? '▾' : '▴'}</span>
          Accounts <span className="accounts-summary">({accountsSummary(accounts, tempCount)})</span>
        </button>
        {/* beside the heading, so it's reachable without opening the panel */}
        <AddAccountMenu
          onAccountConnected={onAccountConnected}
          onNewTemp={tempAddresses ? () => { setExpanded(true); setCreatingTemp(true); } : undefined}
        />
      </div>
    </div>
  );
}

export default PhoneAccountsBar;
