// Time-zone helpers. The AI works in the user's local time ("Friday 9:00"),
// while the database stores exact moments (UTC).

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

// How far `timeZone` is ahead of UTC at the instant `ms`, in ms.
function offsetAt(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value])
  );
  return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
}

// "2026-10-02T09:00" as a wall-clock time in `timeZone` -> ISO UTC string, or null if malformed.
function localTimeToUtc(local, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return null;
  const asIfUtc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  // the offset depends on the date (daylight saving), so settle it with a second pass
  let ms = asIfUtc - offsetAt(asIfUtc, timeZone);
  ms = asIfUtc - offsetAt(ms, timeZone);
  return new Date(ms).toISOString();
}

// "Sunday, September 27, 2026, 3:30 PM" in `timeZone`, for telling the AI what "now" is.
function describeNow(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(now);
}

module.exports = { validTimeZone, localTimeToUtc, describeNow };
