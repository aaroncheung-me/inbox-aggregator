import { useState } from 'react';
import AddAccountMenu from './AddAccountMenu';
import AccountList from './AccountList';
import { accountsSummary } from '../format';

// Desktop: the collapsible accounts section above the message list.
function AccountsPanel({ accounts, onToggleAccount, onChangeColor, onAccountConnected }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="accounts-panel">
      <div className="accounts-header">
        <button
          className="accounts-heading"
          onClick={() => setExpanded(prev => !prev)}
          aria-expanded={expanded}
        >
          <span className="accounts-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          Accounts <span className="accounts-summary">({accountsSummary(accounts)})</span>
        </button>
        <AddAccountMenu onAccountConnected={onAccountConnected} />
      </div>

      {expanded && (
        <AccountList accounts={accounts} onToggleAccount={onToggleAccount} onChangeColor={onChangeColor} />
      )}
    </section>
  );
}

export default AccountsPanel;
