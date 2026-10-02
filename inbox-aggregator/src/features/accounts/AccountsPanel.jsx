import { useState } from 'react';
import AddAccountMenu from './AddAccountMenu';
import AccountList from './AccountList';
import TempAddresses from './TempAddresses';
import { accountsSummary } from '../../format';

// Desktop: the collapsible accounts section above the message list, with the
// temp addresses as rows under the accounts.
// tempAddresses: { temp, now, onCreate, onExtend, onDelete } for TempAddresses.
function AccountsPanel({ accounts, onToggleAccount, onChangeColor, onAccountConnected, tempAddresses }) {
  const [expanded, setExpanded] = useState(false);
  const [creatingTemp, setCreatingTemp] = useState(false);
  const tempCount = tempAddresses?.temp?.addresses.length || 0;

  return (
    <section className="accounts-panel">
      <div className="accounts-header">
        <button
          className="accounts-heading"
          onClick={() => setExpanded(prev => !prev)}
          aria-expanded={expanded}
        >
          <span className="accounts-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          Accounts <span className="accounts-summary">({accountsSummary(accounts, tempCount)})</span>
        </button>
        <AddAccountMenu
          onAccountConnected={onAccountConnected}
          onNewTemp={tempAddresses ? () => { setExpanded(true); setCreatingTemp(true); } : undefined}
        />
      </div>

      {expanded && (
        <>
          <AccountList accounts={accounts} onToggleAccount={onToggleAccount} onChangeColor={onChangeColor} />
          {tempAddresses && (
            <TempAddresses {...tempAddresses} creating={creatingTemp} onCloseForm={() => setCreatingTemp(false)} />
          )}
        </>
      )}
    </section>
  );
}

export default AccountsPanel;
