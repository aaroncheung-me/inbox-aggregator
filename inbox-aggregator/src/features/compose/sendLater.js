import { atHour, daysUntilMonday } from '../../format';

// Send later: the preset times, and how a scheduled time reads.

// [{ label, when }] from now: tomorrow morning and afternoon, and Monday
// morning (left out when tomorrow is Monday, which would repeat it).
export function sendLaterOptions(now = new Date()) {
  const options = [
    { label: 'Tomorrow morning', when: atHour(now, 1, 8) },
    { label: 'Tomorrow afternoon', when: atHour(now, 1, 13) },
  ];
  const toMonday = daysUntilMonday(now);
  if (toMonday > 1) options.push({ label: 'Monday morning', when: atHour(now, toMonday, 8) });
  return options;
}

// "Thu 8:00 AM" within the coming week, else "Oct 12, 8:00 AM"
export function scheduleLabel(value, now = new Date()) {
  const date = new Date(value);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const withinWeek = date - now < 6 * 24 * 60 * 60 * 1000;
  const day = withinWeek
    ? date.toLocaleDateString([], { weekday: 'short' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

// "Thursday, October 2 at 8:00 AM"
export function scheduleLabelLong(value) {
  const date = new Date(value);
  const day = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return `${day} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
