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

// '"IBM Talent" <talent@ibm.com>' -> 'IBM Talent'; a bare address stays as it is.
export function senderName(sender) {
  if (!sender) return 'Unknown';
  const match = sender.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : sender;
}

// "3:05 PM" for today, "Jun 3" for this year, "Jun 3, 2025" for older.
export function shortDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

// "3", or "2 of 3 shown" when some accounts are unchecked
export function accountsSummary(accounts) {
  const shownCount = accounts.filter(a => a.show_in_inbox).length;
  return shownCount === accounts.length ? `${accounts.length}` : `${shownCount} of ${accounts.length} shown`;
}

// "45m", "5h", "3d" until the given time; "now" once it's passed.
export function timeLeft(isoString, now = Date.now()) {
  const minutes = Math.floor((new Date(isoString).getTime() - now) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
