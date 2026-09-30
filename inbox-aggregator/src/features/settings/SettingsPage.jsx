import { useState } from 'react';
import PaneBar from '../../ui/PaneBar';
import { getTheme, setTheme } from '../../shell/theme';
import { setLoadImages, useLoadImages } from './loadImages';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// Settings, in the main pane. Every change applies and saves straight away.
// Appearance and images are remembered on this device only; signatures are
// saved with the accounts, so every device uses them.
// back: the bar's back button(s), from MainPane. accounts: the sending
// addresses. onChangeSignature(accountId, text).
function SettingsPage({ back, accounts, onChangeSignature }) {
  const [theme, setThemeChoice] = useState(getTheme);
  const loadImages = useLoadImages();

  function chooseTheme(next) {
    setTheme(next);
    setThemeChoice(next);
  }

  return (
    <>
      <PaneBar left={back} title="Settings">
        <span className="pane-note">Changes save automatically</span>
      </PaneBar>
      <div className="pane-body">
        <div className="settings">
          <section className="settings-section" aria-labelledby="settings-appearance">
            <h2 id="settings-appearance">Appearance</h2>
            <div className="mode-toggle" role="group" aria-labelledby="settings-appearance">
              {THEMES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  className={theme === t.value ? 'active' : ''}
                  aria-pressed={theme === t.value}
                  onClick={() => chooseTheme(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="settings-hint">System follows your computer or phone. Remembered on each device separately.</p>
          </section>

          <section className="settings-section" aria-labelledby="settings-emails">
            <h2 id="settings-emails">Emails</h2>
            <label className="settings-check">
              <input type="checkbox" checked={loadImages} onChange={e => setLoadImages(e.target.checked)} />
              <span>
                Load images in emails
                <span className="settings-hint">
                  When off, images stay hidden until you click "Show images" on an email. This stops senders
                  seeing when you opened it. Remembered on each device separately.
                </span>
              </span>
            </label>
          </section>

          <section className="settings-section" aria-labelledby="settings-signatures">
            <h2 id="settings-signatures">Signatures</h2>
            <p className="settings-hint">
              Added to the end of new emails, replies and forwards from that address. You can edit or remove it in
              each email.
            </p>
            {accounts.length === 0 && <p className="settings-hint">Connect an email account first.</p>}
            {accounts.map(account => (
              <div key={account.id} className="settings-signature">
                <label htmlFor={`signature-${account.id}`}>
                  <span className="account-dot" style={{ background: account.color }} aria-hidden="true" />
                  {account.display_name || account.email_address}
                </label>
                <textarea
                  id={`signature-${account.id}`}
                  rows={3}
                  placeholder="No signature"
                  value={account.signature || ''}
                  onChange={e => onChangeSignature(account.id, e.target.value)}
                />
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}

export default SettingsPage;
