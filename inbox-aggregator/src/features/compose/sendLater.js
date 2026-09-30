// Send later: the preset times, and how a scheduled time reads.

function at(base, daysAhead, hour) {
  const date = new Date(base);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date;
}

// [{ label, when }] from now: tomorrow morning and afternoon, and Monday
// morning (left out when tomorrow is Monday, which would repeat it).
export function sendLaterOptions(now = new Date()) {
  const options = [
    { label: 'Tomorrow morning', when: at(now, 1, 8) },
    { label: 'Tomorrow afternoon', when: at(now, 1, 13) },
  ];
  const daysToMonday = ((8 - now.getDay()) % 7) || 7; // 1..7, never today
  if (daysToMonday > 1) options.push({ label: 'Monday morning', when: at(now, daysToMonday, 8) });
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

// A Date as the value of a datetime-local input (local time, to the minute).
export function toLocalInputValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
