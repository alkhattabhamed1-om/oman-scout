// Calendar and sharing helpers: ICS files, calendar links, map links and copyable text.
//
// Purpose: turn items into things that leave the page (a calendar file, a Google Calendar
// link, a WhatsApp message, a weekly digest) without touching the DOM, so the browser and the
// scan pipeline use the same code.
//
// ICS rules (RFC 5545): CRLF line ends, lines folded at 75 octets counted in UTF-8 bytes (so
// Arabic folds correctly), TEXT values escaped, all-day events with an exclusive DTEND, and
// stable UIDs `<id>-start@oman-scout` and `<id>-deadline@oman-scout` so a re-imported file
// updates its events instead of duplicating them. Deadline events carry alarms.
//
// Invariants: pure (the only clock read is the default for `now`), never throws on a malformed
// item, and an item without a usable id or date produces no event.

import { addDays, fmtDate, isYmd } from './dates.js';

const UID_DOMAIN = 'oman-scout';
const FOLD_LIMIT = 75;
const DEFAULT_ALARMS = [{ daysBefore: 3, hour: 9 }, { daysBefore: 1, hour: 9 }];

const STRINGS = {
  en: {
    calName: 'Oman Scout',
    deadline: 'Deadline',
    eligibility: 'Eligibility',
    apply: 'Apply',
    source: 'Source',
    starts: 'Starts',
    applyBy: 'Apply by',
    cost: 'Cost',
    prize: 'Prize',
    approx: 'Dates are approximate.',
    digestTitle: 'Oman Scout: this week\u2019s picks',
    digestEmpty: 'Nothing upcoming right now.',
    category: { event: 'Event', competition: 'Competition', competitor: 'Competitor', funding: 'Funding' }
  },
  ar: {
    calName: 'رصد عُمان',
    deadline: 'آخر موعد',
    eligibility: 'الأهلية',
    apply: 'التقديم',
    source: 'المصدر',
    starts: 'البداية',
    applyBy: 'آخر موعد للتقديم',
    cost: 'التكلفة',
    prize: 'الجائزة',
    approx: 'المواعيد تقريبية.',
    digestTitle: 'اختيارات هذا الأسبوع من رصد عُمان',
    digestEmpty: 'لا يوجد شيء قادم الآن.',
    category: { event: 'فعالية', competition: 'مسابقة', competitor: 'منافس', funding: 'تمويل' }
  }
};

const strings = lang => (lang === 'ar' ? STRINGS.ar : STRINGS.en);

/** The URL as a normalised string when it is http or https, otherwise null. */
export function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
}

// Item text in the viewer's language, falling back to the English field.
function text(item, field, lang) {
  const ar = item.ar && typeof item.ar === 'object' ? item.ar[field] : null;
  const value = lang === 'ar' && typeof ar === 'string' && ar.trim() ? ar : item[field];
  return typeof value === 'string' ? value.trim() : '';
}

function primaryLink(item) {
  const apply = safeUrl(item.applyUrl);
  if (apply) return apply;
  for (const s of Array.isArray(item.sources) ? item.sources : []) {
    const u = s && safeUrl(s.url);
    if (u) return u;
  }
  return null;
}

// Plain-text lines that describe an item (the DESCRIPTION of an event, the details of a link).
function describe(item, lang) {
  const t = strings(lang);
  const lines = [text(item, 'summary', lang)];
  const note = text(item, 'eligibilityNote', lang);
  if (note) lines.push(`${t.eligibility}: ${note}`);
  if (item.approx) lines.push(t.approx);
  const dateNote = typeof item.dateNote === 'string' ? item.dateNote.trim() : '';
  if (dateNote) lines.push(dateNote);
  const apply = safeUrl(item.applyUrl);
  if (apply) lines.push(`${t.apply}: ${apply}`);
  const link = primaryLink(item);
  if (link && link !== apply) lines.push(`${t.source}: ${link}`);
  return lines.filter(Boolean);
}

// ---------------------------------------------------------------- ICS

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

// Escape a TEXT value: backslash, semicolon, comma and line breaks.
function esc(s) {
  return String(s).replace(CONTROL, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

function utf8Length(cp) {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

// Fold a content line so no physical line exceeds 75 octets; a continuation starts with one space.
function fold(line) {
  if (line.length * 3 <= FOLD_LIMIT) return line;
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = utf8Length(ch.codePointAt(0));
    if (bytes + n > FOLD_LIMIT) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n');
}

const compact = ymd => ymd.replaceAll('-', '');

function stamp(now) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// A relative alarm trigger for an all-day event: `hour` o'clock, `daysBefore` days before the date.
function trigger({ daysBefore, hour }) {
  const minutes = daysBefore * 1440 - hour * 60;
  if (minutes === 0) return 'PT0S';
  const m = Math.abs(minutes);
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const time = (hours ? `${hours}H` : '') + (mins ? `${mins}M` : '');
  return `${minutes > 0 ? '-' : ''}P${days ? `${days}D` : ''}${time ? `T${time}` : ''}`;
}

function validAlarms(alarms) {
  if (!Array.isArray(alarms)) return DEFAULT_ALARMS;
  return alarms.filter(a => a && Number.isInteger(a.daysBefore) && a.daysBefore >= 0 && Number.isInteger(a.hour) && a.hour >= 0 && a.hour <= 23);
}

function eventLines(item, kind, ctx) {
  const { lang, now, alarms } = ctx;
  const t = strings(lang);
  const title = text(item, 'title', lang) || String(item.id);
  const isDeadline = kind === 'deadline';
  const from = isDeadline ? item.deadline : item.start;
  const last = isDeadline ? item.deadline : (isYmd(item.end) && item.end >= item.start ? item.end : item.start);
  const summary = isDeadline ? `${t.deadline}: ${title}` : title;
  const uid = `${String(item.id).replace(/[^\w.-]+/g, '-')}-${kind}@${UID_DOMAIN}`;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compact(from)}`,
    `DTEND;VALUE=DATE:${compact(addDays(last, 1))}`,
    `SUMMARY:${esc(summary)}`
  ];
  const location = typeof item.location === 'string' ? item.location.trim() : '';
  if (location) lines.push(`LOCATION:${esc(location)}`);
  const description = describe(item, lang).join('\n');
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  const link = primaryLink(item);
  if (link) lines.push(`URL:${link}`);
  const category = t.category[item.category];
  if (category) lines.push(`CATEGORIES:${esc(category)}`);
  lines.push(`STATUS:${item.approx || item.confidence === 'unverified' ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:TRANSPARENT');
  if (isDeadline) {
    for (const alarm of alarms) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:${trigger(alarm)}`, 'END:VALARM');
    }
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Build an iCalendar file for items: one all-day event for the start (through the end) and one
 * for the deadline. Options: lang 'en'|'ar', calName, alarms [{ daysBefore, hour }] for deadline
 * events (default 3 days and 1 day before at 09:00; [] for none), now (Date for DTSTAMP).
 */
export function buildIcs(items, { lang = 'en', calName, alarms, now } = {}) {
  const ctx = { lang, now, alarms: validAlarms(alarms) };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Oman Scout//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName || strings(lang).calName)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H'
  ];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object' || item.id == null || item.id === '') continue;
    if (isYmd(item.start)) lines.push(...eventLines(item, 'start', ctx));
    if (isYmd(item.deadline)) lines.push(...eventLines(item, 'deadline', ctx));
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- links

/**
 * A Google Calendar "add event" link for one date of the item, or null when it has none.
 * opts.which chooses 'start' or 'deadline'; by default the start, else the deadline.
 */
export function googleCalendarUrl(item, { lang = 'en', which } = {}) {
  if (!item || typeof item !== 'object') return null;
  const kind = which === 'deadline' || (which !== 'start' && !isYmd(item.start)) ? 'deadline' : 'start';
  const from = kind === 'deadline' ? item.deadline : item.start;
  if (!isYmd(from)) return null;
  const last = kind === 'start' && isYmd(item.end) && item.end >= from ? item.end : from;
  const title = text(item, 'title', lang) || String(item.id || '');
  const summary = kind === 'deadline' ? `${strings(lang).deadline}: ${title}` : title;
  const params = [
    ['text', summary],
    ['details', describe(item, lang).join('\n')],
    ['location', typeof item.location === 'string' ? item.location.trim() : '']
  ].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${compact(from)}/${compact(addDays(last, 1))}&${params.join('&')}`;
}

const NO_PLACE = /^(online|virtual|remote|worldwide|global|various|anywhere|tba|tbd|tbc|n\/a|to be (announced|confirmed))\b|^(عن بعد|افتراضي|عبر الإنترنت)/i;

/** A Google Maps search link for the item's place, or null for online or unknown places. */
export function mapsUrl(item) {
  if (!item || typeof item !== 'object' || item.mode === 'online') return null;
  const place = typeof item.location === 'string' ? item.location.trim() : '';
  if (!place || NO_PLACE.test(place)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

// ---------------------------------------------------------------- copyable text

const DAY = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };

function dateLines(item, lang) {
  const t = strings(lang);
  const out = [];
  if (isYmd(item.start)) {
    const range = isYmd(item.end) && item.end > item.start ? ` \u2013 ${fmtDate(item.end, lang, DAY)}` : '';
    out.push(`${t.starts}: ${fmtDate(item.start, lang, DAY)}${range}`);
  }
  if (isYmd(item.deadline)) out.push(`${t.applyBy}: ${fmtDate(item.deadline, lang, DAY)}`);
  return out;
}

/** A short, WhatsApp-ready message for one item: title, kind and place, dates, cost and a link. */
export function shareText(item, { lang = 'en', url } = {}) {
  if (!item || typeof item !== 'object') return '';
  const t = strings(lang);
  const kind = [t.category[item.category], typeof item.location === 'string' ? item.location.trim() : ''].filter(Boolean).join(' \u00b7 ');
  const lines = [text(item, 'title', lang), kind, ...dateLines(item, lang)];
  if (typeof item.cost === 'string' && item.cost.trim()) lines.push(`${t.cost}: ${item.cost.trim()}`);
  const link = safeUrl(url) || primaryLink(item);
  if (link) lines.push(link);
  return lines.filter(Boolean).join('\n');
}

/** A "this week's picks" message listing items with dates and links, ready to paste. */
export function digestText(items, { lang = 'en', siteUrl, title } = {}) {
  const t = strings(lang);
  const lines = [title || t.digestTitle, ''];
  const list = (Array.isArray(items) ? items : []).filter(it => it && typeof it === 'object');
  if (!list.length) lines.push(t.digestEmpty);
  list.forEach((item, i) => {
    lines.push(`${i + 1}. ${text(item, 'title', lang)}`);
    const facts = [...dateLines(item, lang), typeof item.location === 'string' ? item.location.trim() : ''].filter(Boolean);
    if (facts.length) lines.push(`   ${facts.join(' \u00b7 ')}`);
    const link = primaryLink(item);
    if (link) lines.push(`   ${link}`);
  });
  const site = safeUrl(siteUrl);
  if (site) lines.push('', site);
  return lines.join('\n');
}
