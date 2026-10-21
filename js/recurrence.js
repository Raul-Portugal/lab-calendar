/**
 * Recurrence rules (Google-Calendar-like): daily / weekly / monthly / yearly, "every N",
 * weekday selection, monthly "on day 21" or "on the 3rd Wednesday", end date or count.
 *
 * A rule is { freq, interval, byDay, monthMode }. The anchor date is the series' `from` date:
 * the day of month, the weekday and the week/month parity are all counted from it.
 * "Ends after N times" is stored as an `until` date (see untilForCount).
 */

import { parseDateKey, formatDateKey, shiftDateKey, dayNumber } from './utils.js';

export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const MONTH_MODES = ['day', 'nth', 'last'];
const MAX_SCAN_DAYS = 366 * 60;

// Fill in defaults so old rules ({ freq: 'WEEKLY', byDay }) and imported ones are always valid
export function normalizeRule(rule, fromKey) {
  const freq = FREQS.includes(rule?.freq) ? rule.freq : 'WEEKLY';
  const interval = Math.min(99, Math.max(1, Math.round(Number(rule?.interval)) || 1));
  const out = { freq, interval };
  if (freq === 'WEEKLY') {
    let byDay = Array.isArray(rule?.byDay) ? rule.byDay.filter((c) => DAY_CODES.includes(c)) : [];
    byDay = DAY_CODES.filter((c) => byDay.includes(c)); // sorted, unique
    if (!byDay.length) byDay = [DAY_CODES[parseDateKey(fromKey || formatDateKey(new Date())).getDay()]];
    out.byDay = byDay;
  } else if (freq === 'MONTHLY') {
    out.monthMode = MONTH_MODES.includes(rule?.monthMode) ? rule.monthMode : 'day';
  }
  return out;
}

function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Does the rule (anchored at fromKey) produce an occurrence on dateKey? Ignores `until`. */
export function ruleOccursOn(rawRule, fromKey, dateKey) {
  if (!fromKey || dateKey < fromKey) return false;
  const rule = normalizeRule(rawRule, fromKey);
  const date = parseDateKey(dateKey);
  const from = parseDateKey(fromKey);

  switch (rule.freq) {
    case 'DAILY':
      return (dayNumber(dateKey) - dayNumber(fromKey)) % rule.interval === 0;
    case 'WEEKLY': {
      if (!rule.byDay.includes(DAY_CODES[date.getDay()])) return false;
      // Weeks run Monday-Sunday, counted from the week that contains `from`
      const mondayOffset = (d) => (d.getDay() + 6) % 7;
      const weekIndex = Math.floor(
        (dayNumber(dateKey) - mondayOffset(date) - (dayNumber(fromKey) - mondayOffset(from))) / 7
      );
      return weekIndex % rule.interval === 0;
    }
    case 'MONTHLY': {
      const months = (date.getFullYear() - from.getFullYear()) * 12 + date.getMonth() - from.getMonth();
      if (months % rule.interval !== 0) return false;
      if (rule.monthMode === 'day') return date.getDate() === from.getDate();
      if (date.getDay() !== from.getDay()) return false;
      if (rule.monthMode === 'nth') return Math.ceil(date.getDate() / 7) === Math.ceil(from.getDate() / 7);
      // 'last': last such weekday of the month
      return date.getDate() + 7 > daysInMonth(date.getFullYear(), date.getMonth());
    }
    case 'YEARLY': {
      const years = date.getFullYear() - from.getFullYear();
      return years % rule.interval === 0 && date.getMonth() === from.getMonth() && date.getDate() === from.getDate();
    }
    default:
      return false;
  }
}

/** First date on/after fromKey that the rule produces (the series' real first occurrence). */
export function firstOccurrence(rule, fromKey) {
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const key = shiftDateKey(fromKey, i);
    if (ruleOccursOn(rule, fromKey, key)) return key;
  }
  return fromKey;
}

/** The date of the Nth occurrence: the `until` that makes a series end "after N times". */
export function untilForCount(rule, fromKey, count) {
  let found = 0;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const key = shiftDateKey(fromKey, i);
    if (ruleOccursOn(rule, fromKey, key) && ++found >= count) return key;
  }
  return null;
}

/** Number of occurrences up to and including the `until` date (for showing "after N times"). */
export function countUntil(rule, fromKey, untilKey) {
  if (!untilKey) return null;
  let found = 0;
  for (let key = fromKey; key <= untilKey && found < 1000; key = shiftDateKey(key, 1)) {
    if (ruleOccursOn(rule, fromKey, key)) found++;
  }
  return found;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

function monthlyLabel(rule, fromKey) {
  const from = parseDateKey(fromKey);
  if (rule.monthMode === 'nth') return `on the ${ORDINALS[Math.ceil(from.getDate() / 7) - 1]} ${DAY_NAMES[from.getDay()]}`;
  if (rule.monthMode === 'last') return `on the last ${DAY_NAMES[from.getDay()]}`;
  return `on day ${from.getDate()}`;
}

/** Plain-language summary, e.g. "Every 2 weeks on Tue, Thu". */
export function describeRule(rawRule, fromKey) {
  const rule = normalizeRule(rawRule, fromKey);
  const n = rule.interval;
  const from = parseDateKey(fromKey || formatDateKey(new Date()));
  switch (rule.freq) {
    case 'DAILY':
      return n === 1 ? 'Every day' : `Every ${n} days`;
    case 'WEEKLY': {
      const isWeekdays = rule.byDay.join() === WEEKDAY_CODES.join();
      const days = isWeekdays ? 'weekday' : rule.byDay.map((c) => DAY_NAMES[DAY_CODES.indexOf(c)].slice(0, 3)).join(', ');
      if (isWeekdays && n === 1) return 'Every weekday (Mon-Fri)';
      return `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${days}`;
    }
    case 'MONTHLY':
      return `${n === 1 ? 'Every month' : `Every ${n} months`} ${monthlyLabel(rule, fromKey)}`;
    case 'YEARLY':
      return `${n === 1 ? 'Every year' : `Every ${n} years`} on ${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    default:
      return 'Repeats';
  }
}

/** RRULE text (RFC 5545) without UNTIL; DTSTART must be the first occurrence. */
export function ruleToRRule(rawRule, fromKey) {
  const rule = normalizeRule(rawRule, fromKey);
  const first = parseDateKey(firstOccurrence(rule, fromKey));
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'WEEKLY') {
    parts.push(`BYDAY=${rule.byDay.join(',')}`, 'WKST=MO');
  } else if (rule.freq === 'MONTHLY') {
    if (rule.monthMode === 'day') parts.push(`BYMONTHDAY=${first.getDate()}`);
    else if (rule.monthMode === 'nth') parts.push(`BYDAY=${Math.ceil(first.getDate() / 7)}${DAY_CODES[first.getDay()]}`);
    else parts.push(`BYDAY=-1${DAY_CODES[first.getDay()]}`);
  }
  return parts.join(';');
}
