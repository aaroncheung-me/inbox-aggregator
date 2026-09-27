import { useRef, useState } from 'react';
import { startSignInConnect } from '../api';
import { useDismiss } from '../hooks/useDismiss';
import ImapConnectDialog from './ImapConnectDialog';

// One entry per way of adding an account. `signIn` options leave the page for
// the provider's sign-in; `form` options open a connect form here.
const ACCOUNT_OPTIONS = [
  { provider: 'gmail', label: 'Gmail', hint: 'Sign in with Google', kind: 'signIn' },
  { provider: 'imap', label: 'Other email (IMAP)', hint: 'Your own domain, iCloud, Yahoo…', kind: 'form' },
];

function AddAccountMenu({ onAccountConnected }) {
  const [open, setOpen] = useState(false);
  const [imapDialogOpen, setImapDialogOpen] = useState(false);
  const [startingSignIn, setStartingSignIn] = useState(false);
  const [error, setError] = useState(null);
  const menuRef = useRef(null);
  useDismiss(menuRef, open, setOpen);

  async function handleChoose(option) {
    setError(null);
    if (option.kind === 'form') {
      setOpen(false);
      setImapDialogOpen(true);
      return;
    }
    // leaves the page for the provider's sign-in on success
    setStartingSignIn(true);
    try {
      await startSignInConnect(option.provider);
    } catch (err) {
      setError(err.message);
      setStartingSignIn(false);
    }
  }

  return (
    <div className="add-account" ref={menuRef}>
      <button
        className="btn btn-ghost btn-small"
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        + Add account
      </button>

      {open && (
        <div className="add-account-menu" role="menu">
          {ACCOUNT_OPTIONS.map(option => (
            <button
              key={option.provider}
              className="add-account-option"
              role="menuitem"
              onClick={() => handleChoose(option)}
              disabled={startingSignIn}
            >
              <span className="add-account-label">{option.label}</span>
              <span className="add-account-hint">{option.hint}</span>
            </button>
          ))}
          {error && <p className="add-account-error" role="alert">{error}</p>}
        </div>
      )}

      <ImapConnectDialog
        open={imapDialogOpen}
        onClose={() => setImapDialogOpen(false)}
        onConnected={emailAddress => {
          setImapDialogOpen(false);
          onAccountConnected(emailAddress);
        }}
      />
    </div>
  );
}

export default AddAccountMenu;
