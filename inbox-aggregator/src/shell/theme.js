// The color theme: 'system' (follow the device), 'light' or 'dark', remembered
// on this device only. The styles read data-theme on <html> (styles/base.scss);
// index.html applies a saved choice before the page first draws, so it never
// flashes the other theme.

const KEY = 'theme';
// the top of the sidebar in each theme: the phone's status bar and the installed
// app's title bar take this color (the theme-color tags in index.html)
const BAR_COLORS = { light: '#FFFFFF', dark: '#1C1E21' };

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system'; // storage blocked: follow the device
  }
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;

  // one tag per device setting; a chosen theme sets both to its own color
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const deviceTheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = BAR_COLORS[theme === 'system' ? deviceTheme : theme];
  }
}

export function setTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // not remembered, but still applied for now
  }
  applyTheme(theme);
}
