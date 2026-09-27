// Small display helpers shared by several components.

// "synced 5m ago", "synced just now", "never synced"
export function timeAgo(isoString) {
  if (!isoString) return 'never synced';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'synced just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `synced ${days}d ago`;
}

// "3", or "2 of 3 shown" when some accounts are unchecked
export function accountsSummary(accounts) {
  const shownCount = accounts.filter(a => a.show_in_inbox).length;
  return shownCount === accounts.length ? `${accounts.length}` : `${shownCount} of ${accounts.length} shown`;
}
