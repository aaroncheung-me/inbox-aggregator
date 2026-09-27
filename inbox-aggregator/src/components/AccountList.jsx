import AccountColorPicker from './AccountColorPicker';

// The connected accounts, each with its show-in-inbox checkbox and color dot.
// Shared by the desktop accounts panel and the phone accounts bar.
function AccountList({ accounts, onToggleAccount, onChangeColor }) {
  if (accounts.length === 0) return <p className="accounts-empty">No accounts connected yet.</p>;

  return (
    <ul className="accounts-list">
      {accounts.map(account => (
        <li key={account.id} className={`account-row${account.show_in_inbox ? '' : ' hidden-account'}`}>
          <input
            id={`account-shown-${account.id}`}
            type="checkbox"
            checked={account.show_in_inbox}
            onChange={e => onToggleAccount(account.id, e.target.checked)}
          />
          {/* outside the label, so clicking the dot opens the picker instead of toggling */}
          <AccountColorPicker account={account} onChangeColor={onChangeColor} />
          <label htmlFor={`account-shown-${account.id}`} className="account-name">
            {account.display_name || account.email_address}
          </label>
        </li>
      ))}
    </ul>
  );
}

export default AccountList;
