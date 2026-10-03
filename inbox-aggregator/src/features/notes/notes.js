import { atHour, daysUntilMonday } from '../../format';

// Helpers for notes shared by several components.

// The first non-empty line stands in for a title.
export function noteTitle(body) {
  return (body || '').split('\n').find(line => line.trim())?.trim() || 'Empty note';
}

// Everything after the first non-empty line, squashed to one line for previews.
export function notePreview(body) {
  const lines = (body || '').split('\n');
  const titleIndex = lines.findIndex(line => line.trim());
  return lines.slice(titleIndex + 1).join(' ').replace(/\s+/g, ' ').trim();
}

export function reminderIsDue(reminder, now) {
  return !!reminder && !reminder.done_at && new Date(reminder.remind_at).getTime() <= now;
}

// The number shown on the Notes switch.
export function dueReminderCount(notes, now) {
  return notes.filter(note => reminderIsDue(note.reminder, now)).length;
}

// "Today 6:00 PM", "Tomorrow 9:00 AM", "Fri, Oct 2, 9:00 AM"
export function formatReminder(isoString) {
  const date = new Date(isoString);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${day}, ${time}`;
}

// Quick picks offered when adding a reminder, as [label, Date].
export function reminderQuickPicks(now = new Date()) {
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);
  inAnHour.setSeconds(0, 0);

  const picks = [
    ['In 1 hour', inAnHour],
    ...(now.getHours() < 17 ? [['This evening, 6 PM', atHour(now, 0, 18)]] : []),
    ['Tomorrow, 9 AM', atHour(now, 1, 9)],
    ['Next Monday, 9 AM', atHour(now, daysUntilMonday(now), 9)],
  ];
  // on a Sunday, "next Monday" is tomorrow: keep only the first of any same-time picks
  return picks.filter(([, date], i) => picks.findIndex(([, other]) => other.getTime() === date.getTime()) === i);
}

// A position between two neighbours in the user's order (either may be missing).
export function positionBetween(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return after - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

// The three groups the notes list shows, each in the user's order.
export function groupNotes(notes) {
  const done = note => !!note.reminder?.done_at;
  return {
    pinned: notes.filter(note => note.pin && !done(note)),
    other: notes.filter(note => !note.pin && !done(note)),
    done: notes.filter(done),
  };
}

// Search on the Notes tab: the notes holding every word, in the list's order.
export function searchNotes(notes, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter(note => {
    const body = (note.body || '').toLowerCase();
    return words.every(word => body.includes(word));
  });
}
