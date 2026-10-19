const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const KICKOFF = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DAY_HEADING = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const STAMP = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const userTimezone = TIMEZONE;

export function percent(probability, digits = 1) {
  return Number.isFinite(probability) ? `${(probability * 100).toFixed(digits)}%` : 'n/a';
}

export function signedPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

export function decimalOdds(odds) {
  return Number.isFinite(odds) && odds > 1 ? odds.toFixed(2) : 'n/a';
}

export function number(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

export function money(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

export function kickoffText(date) {
  return KICKOFF.format(date);
}

export function dayHeading(date) {
  return DAY_HEADING.format(date);
}

export function stampText(date) {
  return date && date.getTime() > 0 ? STAMP.format(date) : 'never';
}
