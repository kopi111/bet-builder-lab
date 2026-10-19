const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
});

export const DAY_MS = 86400000;

export function parseUkKickoff(dateText, timeText) {
  const [day, month, year] = dateText.split('/').map(Number);
  const fullYear = year < 100 ? 2000 + year : year;
  const [hour, minute] = (timeText || '15:00').split(':').map(Number);
  if (!day || !month || !fullYear) throw new Error(`Unreadable match date "${dateText}"`);
  return londonWallTimeToDate(fullYear, month, day, hour, minute);
}

function londonWallTimeToDate(year, month, day, hour, minute) {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = wallAsUtc - londonOffsetMs(wallAsUtc);
  return new Date(wallAsUtc - londonOffsetMs(firstGuess));
}

function londonOffsetMs(timestamp) {
  const parts = Object.fromEntries(LONDON_PARTS.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value]));
  const londonAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return londonAsUtc - Math.floor(timestamp / 60000) * 60000;
}

export function daysBetween(earlier, later) {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
