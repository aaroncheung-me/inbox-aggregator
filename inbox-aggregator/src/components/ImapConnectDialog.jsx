import { useEffect, useRef, useState } from 'react';
import { connectImap } from '../api';

// Known providers whose IMAP server isn't mail.<domain>. Anything else gets
// mail.<domain>, which is right for cPanel hosts like HostGator.
const KNOWN_HOSTS = {
  'icloud.com': 'imap.mail.me.com',
  'me.com': 'imap.mail.me.com',
  'mac.com': 'imap.mail.me.com',
  'yahoo.com': 'imap.mail.yahoo.com',
  'aol.com': 'imap.aol.com',
};

function guessImapHost(email) {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return '';
  return KNOWN_HOSTS[domain] || `mail.${domain}`;
}

function ImapConnectDialog({ open, onClose, onConnected }) {
  const dialogRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hostOverride, setHostOverride] = useState(null); // null = follow the guess from the email
  const [port, setPort] = useState('993');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const host = hostOverride ?? guessImapHost(email);

  // <dialog> is opened and closed imperatively
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function reset() {
    setEmail('');
    setPassword('');
    setHostOverride(null);
    setPort('993');
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { emailAddress } = await connectImap({ email, password, host, port });
      reset();
      onConnected(emailAddress);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // onClose also fires for Escape; the password never outlives the dialog
    <dialog ref={dialogRef} className="connect-dialog" onClose={() => { setPassword(''); onClose(); }}>
      <form onSubmit={handleSubmit}>
        <h2>Connect an email account</h2>
        <p className="dialog-hint">
          For email on your own domain, iCloud, Yahoo and most other providers.
          iCloud and Yahoo need an app-specific password, not your normal one.
        </p>

        <label className="field">
          <span>Email address</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="off"
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="off"
            required
          />
        </label>

        <details className="server-settings">
          <summary>Server settings</summary>
          <div className="server-settings-fields">
            <label className="field">
              <span>IMAP server</span>
              <input
                type="text"
                value={host}
                onChange={e => setHostOverride(e.target.value)}
                placeholder="mail.example.com"
                autoComplete="off"
              />
            </label>
            <label className="field field-port">
              <span>Port</span>
              <input
                type="number"
                value={port}
                onChange={e => setPort(e.target.value)}
                min="1"
                max="65535"
              />
            </label>
          </div>
        </details>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Checking...' : 'Connect'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default ImapConnectDialog;
