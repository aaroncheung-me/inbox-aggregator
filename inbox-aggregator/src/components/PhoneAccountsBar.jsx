import { useState } from 'react';
import AddAccountMenu from './AddAccountMenu';
import AccountList from './AccountList';
import { accountsSummary } from '../format';

// Phone layout: one bar under the message list, "Accounts (3)". Tapping it
// opens a panel above it with the accounts, adding an account and sign-out.
// (Sync now sits above the list, beside Received | Sent.)
function PhoneAccountsBar({
  accounts,
  onToggleAccount,
  onChangeColor,
  onAccountConnected,
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
      </div>
    </div>
  );
}

export default PhoneAccountsBar;
