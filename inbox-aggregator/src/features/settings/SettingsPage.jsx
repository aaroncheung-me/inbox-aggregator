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
// Appearance and images are remembered on this device only.
// back: the bar's back button(s), from MainPane.
function SettingsPage({ back }) {
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
        </div>
      </div>
    </>
  );
}

export default SettingsPage;
