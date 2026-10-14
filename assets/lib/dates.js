// Date helpers shared by the interface, the ranking and the scan pipeline.
//
// Purpose: one place for "what day is it in Muscat", day arithmetic on
// YYYY-MM-DD strings, display formatting, and the item date rules that v1
// kept inside app.js (last date, upcoming, ongoing, anchor).
//
// Invariants:
// - Every date is a plain "YYYY-MM-DD" string; arithmetic runs in UTC so the
//   viewer's time zone never shifts a day.
// - Nothing here reads a global at import time and nothing throws on bad input.
//   utcMs and diffDays return NaN for a malformed date, addDays and monthKey
//   return null, fmtDate and hijriDate return ''.
// - Strings compare correctly with < and > because the format is fixed width.

export const TZ = 'Asia/Muscat';

const DAY_MS = 86400000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map();

function formatter(locale, opts) {
  const key = locale + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts });
    formatters.set(key, f);
  }
  return f;
}

/** True when the value is a real calendar date written as YYYY-MM-DD. */
export function isYmd(s) {
  if (typeof s !== 'string') return false;
  const m = YMD.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Today's date in Muscat as YYYY-MM-DD, whatever the viewer's own time zone is. */
export function muscatToday(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const date = new Date(Number.isFinite(ms) ? ms : Date.now());
  const parts = formatter('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Milliseconds at 00:00 UTC of a YYYY-MM-DD date, or NaN when it is not a real date. */
export function utcMs(ymd) {
  if (!isYmd(ymd)) return NaN;
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
}

/** Whole days from date a to date b (negative when b is earlier), NaN for a bad date. */
export function diffDays(a, b) {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** The date n days after (or before, when negative) a date, or null for a bad date. */
export function addDays(ymd, n) {
  const ms = utcMs(ymd);
  if (Number.isNaN(ms) || !Number.isFinite(n)) return null;
  return new Date(ms + Math.trunc(n) * DAY_MS).toISOString().slice(0, 10);
}

/** The YYYY-MM part of a date, or null for a bad date. */
export function monthKey(ymd) {
  return isYmd(ymd) ? ymd.slice(0, 7) : null;
}

/** Format a date for display in English (en-GB) or Arabic with Latin digits (ar-OM). */
export function fmtDate(ymd, lang, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const ms = utcMs(ymd);
  if (Number.isNaN(ms)) return '';
  try {
    return formatter(lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', opts).format(new Date(ms));
  } catch {
    return '';
  }
}

/** The Umm al-Qura (Hijri) form of a date, or '' where the runtime cannot produce it. */
export function hijriDate(ymd, lang) {
  const ms = utcMs(ymd);
  if (Number.isNaN(ms)) return '';
  try {
    const locale = lang === 'ar' ? 'ar-OM-u-ca-islamic-umalqura-nu-latn' : 'en-GB-u-ca-islamic-umalqura';
    const f = formatter(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    // Engines without the calendar silently fall back to Gregorian, which would mislabel the date.
    if (f.resolvedOptions().calendar !== 'islamic-umalqura') return '';
    return f.format(new Date(ms));
  } catch {
    return '';
  }
}

function valid(ymd) {
  return isYmd(ymd) ? ymd : null;
}

/** The latest of end, start and deadline, or null when the item has no usable date. */
export function lastDate(item) {
  let last = null;
  for (const d of [item && item.end, item && item.start, item && item.deadline]) {
    if (isYmd(d) && (!last || d > last)) last = d;
  }
  return last;
}

/** True when the item has not fully passed yet; an item without any date counts as upcoming. */
export function isUpcoming(item, today) {
  const last = lastDate(item);
  return !last || last >= today;
}

/** True when the item began before today and is still running today. */
export function isOngoing(item, today) {
  const start = valid(item && item.start);
  if (!start || start >= today) return false;
  return (valid(item.end) || start) >= today;
}

/** A date moved forward to today when it lies in the past; null stays null. */
export function clampToToday(ymd, today) {
  const d = valid(ymd);
  if (!d) return null;
  return d < today ? today : d;
}

/** The date the calendar and the month chart place an item on (the v1 anchor rule). */
export function anchorDate(item, today) {
  const start = valid(item && item.start);
  const deadline = valid(item && item.deadline);
  if (item && (item.category === 'event' || item.category === 'competitor')) return start || deadline;
  const ahead = [deadline, start].filter(d => d && d >= today).sort();
  return ahead[0] || start || deadline;
}

/**
 * The date to act on or turn up: a future deadline for competitions and funding,
 * otherwise the start. When only a deadline lies ahead (an event with no usable start)
 * that deadline is used, so the date never points at the past while something is still open.
 * Returns null for an item without dates; may return a past date when nothing lies ahead.
 */
export function actionDate(item, today) {
  const start = valid(item && item.start);
  const deadline = valid(item && item.deadline);
  const applies = item && (item.category === 'competition' || item.category === 'funding');
  if (applies && deadline && deadline >= today) return deadline;
  if (start && start >= today) return start;
  if (deadline && deadline >= today) return deadline;
  return start || deadline;
}
