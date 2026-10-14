// Ranking: how well an item fits one student today, as an integer 0-100 with reasons.
//
// Formula (every part is a number in [0, 1]):
//   base  = 0.25 fit + 0.25 topic + 0.18 eligibility + 0.14 timing + 0.12 confidence + 0.06 reach
//   final = round(100 * min(1, base * (0.88 + 0.12 * typeWeight / 1.25)))
// Weights sum to 1, so a perfect item of the favoured type reaches 100. An ineligible item is
// capped at 15, a past item (every date behind today) scores 0.
//
// Invariants:
// - Pure: the same item and context always give the same result; inputs are never changed.
// - Total: a malformed item (missing fields, unknown topics, bad dates, wrong types) still gets
//   an integer from 0 to 100. Nothing here throws and nothing is NaN.
// - Monotone in time: with everything else equal, a nearer action date never scores lower.
// - Explainable: `parts` shows each component and `reasons` the three most informative
//   statements, as { key, params } for the interface to translate.
//
// Reason keys and params (the interface owns the wording):
//   why.notEligible                       why.openToYou
//   why.closesSoon  { days }              why.startsSoon  { days }      why.ongoing
//   why.topicMatch  { topics: id[] }      (use reasonParams to get labels instead of ids)
//   why.strongFit                         why.prize        why.verified
//   why.inOman      why.online            why.nearby
//   why.farAway     why.outsideReach      why.needsCheck

import { TOPIC_IDS, topicLabel } from './topics.js';
import { actionDate, diffDays, isOngoing, isUpcoming, isYmd, muscatToday } from './dates.js';

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/** The default preferences: tech-student interests, competitions first, trips within the GCC. */
export const DEFAULT_PREFS = deepFreeze({
  interests: ['ai', 'software', 'data', 'cyber', 'startups', 'webmobile'],
  typeWeights: { competition: 1.25, event: 1.0, funding: 0.95, competitor: 0.7 },
  reach: 'gcc',
  learn: true
});

const WEIGHTS = { fit: 0.25, topic: 0.25, eligibility: 0.18, timing: 0.14, confidence: 0.12, reach: 0.06 };
const ELIGIBILITY = { eligible: 1, likely: 0.85, check: 0.55, na: 0.45, ineligible: 0 };
const CONFIDENCE = { confirmed: 1, likely: 0.8, unverified: 0.5 };
const REACHES = ['local', 'gcc', 'far'];
const TRAVELS = ['local', 'online', 'gcc', 'far'];
const KNOWN_TOPICS = new Set(TOPIC_IDS);
const MAX_AFFINITY = 0.3;
const INELIGIBLE_CAP = 15;
const MAX_REASONS = 3;

// Days until the action date and the timing value there; between knots the value is interpolated
// linearly so a day more never jumps the score by a whole step.
const TIMING_KNOTS = [[0, 1], [3, 1], [7, 0.95], [14, 0.85], [30, 0.7], [60, 0.55], [120, 0.4], [240, 0.3]];
const TIMING_UNDATED = 0.25;

const clamp01 = x => Math.min(1, Math.max(0, x));

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

function lookup(table, key, fallback) {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : fallback;
}

function knownTopics(topics) {
  return Array.isArray(topics) ? [...new Set(topics.filter(t => KNOWN_TOPICS.has(t)))] : [];
}

/** Fill a partial preferences object from DEFAULT_PREFS and drop anything invalid. */
export function mergePrefs(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const typeWeights = { ...DEFAULT_PREFS.typeWeights };
  if (p.typeWeights && typeof p.typeWeights === 'object') {
    for (const key of Object.keys(typeWeights)) {
      const w = num(p.typeWeights[key]);
      if (w !== null) typeWeights[key] = Math.min(2, Math.max(0, w));
    }
  }
  return {
    interests: Array.isArray(p.interests) ? knownTopics(p.interests) : [...DEFAULT_PREFS.interests],
    typeWeights,
    reach: REACHES.includes(p.reach) ? p.reach : DEFAULT_PREFS.reach,
    learn: typeof p.learn === 'boolean' ? p.learn : DEFAULT_PREFS.learn
  };
}

function resolve(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const prefs = mergePrefs(c.prefs);
  let affinity = null;
  if (prefs.learn && c.affinity && typeof c.affinity === 'object') {
    affinity = {};
    for (const id of TOPIC_IDS) {
      const a = num(c.affinity[id]);
      if (a) affinity[id] = Math.min(MAX_AFFINITY, Math.max(-MAX_AFFINITY, a));
    }
  }
  return { today: isYmd(c.today) ? c.today : muscatToday(), prefs, interests: new Set(prefs.interests), affinity };
}

function timingCurve(days) {
  for (let i = 1; i < TIMING_KNOTS.length; i++) {
    const [d1, v1] = TIMING_KNOTS[i];
    if (days <= d1) {
      const [d0, v0] = TIMING_KNOTS[i - 1];
      return v0 + (v1 - v0) * ((days - d0) / (d1 - d0));
    }
  }
  return TIMING_KNOTS[TIMING_KNOTS.length - 1][1];
}

const opensForApplication = it => it.category === 'competition' || it.category === 'funding';

// Which date the timing part looks at: { value, days, kind } with kind deadline | start | ongoing | none.
function timingOf(it, today) {
  const date = actionDate(it, today);
  if (date && date === it.deadline && date >= today && opensForApplication(it)) {
    const days = diffDays(today, date);
    return { value: timingCurve(days), days, kind: 'deadline' };
  }
  if (isOngoing(it, today)) return { value: 1, days: 0, kind: 'ongoing' };
  if (!date) return { value: TIMING_UNDATED, days: null, kind: 'none' };
  const days = Math.max(0, diffDays(today, date));
  return { value: timingCurve(days), days, kind: date === it.deadline ? 'deadline' : 'start' };
}

function travelOf(it) {
  if (TRAVELS.includes(it.travel)) return it.travel;
  if (it.mode === 'online') return 'online';
  if (it.region === 'oman') return 'local';
  if (it.region === 'global') return 'far';
  return 'gcc';
}

function reachOf(travel, reach) {
  if (travel === 'online' || travel === 'local') return 1;
  if (travel === 'gcc') return reach === 'local' ? 0.35 : 0.8;
  return reach === 'far' ? 0.9 : 0.15;
}

function topicOf(it, rc) {
  if (!rc.interests.size) return { value: 0.5, matched: [] };
  const own = knownTopics(it.topics);
  const matched = own.filter(id => rc.interests.has(id));
  let value = matched.length ? Math.min(1, 0.7 + 0.15 * (matched.length - 1)) : 0.15;
  if (rc.affinity && own.length) value += own.reduce((sum, id) => sum + (rc.affinity[id] || 0), 0) / own.length;
  return { value: clamp01(value), matched };
}

function confidenceOf(it) {
  const v = it.verified && typeof it.verified === 'object' ? it.verified : {};
  let value = lookup(CONFIDENCE, it.confidence, CONFIDENCE.unverified);
  if (v.dateOnPage === true) value = Math.min(1, value + 0.05);
  if (v.linkOk === false) value -= 0.2;
  return clamp01(value);
}

const NO_PRIZE = /not (specified|published|stated|announced)|unknown|n\/a|^none$|^tb[acd]$/i;
const hasPrize = it => typeof it.prize === 'string' && it.prize.trim().length > 2 && !NO_PRIZE.test(it.prize.trim());

function reasonsOf(it, parts, ctx) {
  const { timing, topic, travel, rc } = ctx;
  const verified = it.verified && typeof it.verified === 'object' ? it.verified : {};
  const out = [];
  const add = (key, priority, params) => out.push({ key, params: params || {}, priority });

  if (it.eligibility === 'ineligible') add('why.notEligible', 100);
  if (it.eligibility === 'eligible') add('why.openToYou', 72);
  if (timing.kind === 'deadline' && timing.days <= 14) add('why.closesSoon', timing.days <= 7 ? 95 : 80, { days: timing.days });
  if (timing.kind === 'start' && timing.days <= 14) add('why.startsSoon', timing.days <= 7 ? 85 : 66, { days: timing.days });
  if (timing.kind === 'ongoing') add('why.ongoing', 88);
  if (topic.matched.length) add('why.topicMatch', 60 + 12 * Math.min(3, topic.matched.length), { topics: topic.matched });
  const fit = num(it.fit);
  if (fit !== null && fit >= 80) add('why.strongFit', 50);
  if (opensForApplication(it) && hasPrize(it)) add('why.prize', 55);
  if (verified.linkOk !== false && (verified.agent === 'confirmed' || verified.dateOnPage === true || it.confidence === 'confirmed')) add('why.verified', 35);
  if (travel === 'local') add('why.inOman', 45);
  else if (travel === 'online') add('why.online', 45);
  else if (travel === 'gcc') add(rc.prefs.reach === 'local' ? 'why.outsideReach' : 'why.nearby', rc.prefs.reach === 'local' ? 65 : 40);
  else if (rc.prefs.reach !== 'far') add('why.farAway', 82);
  if (verified.linkOk === false) add('why.needsCheck', 75);
  else if (it.eligibility === 'check') add('why.needsCheck', 70);
  else if (it.confidence !== 'confirmed' && it.confidence !== 'likely') add('why.needsCheck', 60);

  out.sort((a, b) => b.priority - a.priority || (a.key < b.key ? -1 : 1));
  const seen = new Set();
  return out.filter(r => !seen.has(r.key) && seen.add(r.key)).slice(0, MAX_REASONS).map(({ key, params }) => ({ key, params }));
}

function scoreResolved(item, rc) {
  const it = item && typeof item === 'object' ? item : {};
  const travel = travelOf(it);
  const timing = timingOf(it, rc.today);
  const topic = topicOf(it, rc);
  const fit = num(it.fit);
  const parts = {
    fit: fit === null ? 0.5 : clamp01(fit / 100),
    topic: topic.value,
    eligibility: lookup(ELIGIBILITY, it.eligibility, ELIGIBILITY.check),
    timing: timing.value,
    confidence: confidenceOf(it),
    reach: reachOf(travel, rc.prefs.reach)
  };
  const typeWeight = lookup(rc.prefs.typeWeights, it.category, 1);
  const typeFactor = Math.min(1, 0.88 + (0.12 * typeWeight) / 1.25);

  if (!isUpcoming(it, rc.today)) return { score: 0, parts: { ...parts, timing: 0 }, reasons: [], typeFactor };

  let base = 0;
  for (const key of Object.keys(WEIGHTS)) base += WEIGHTS[key] * parts[key];
  let score = Math.round(Math.min(1, base * typeFactor) * 100);
  if (it.eligibility === 'ineligible') score = Math.min(score, INELIGIBLE_CAP);
  return { score, parts, reasons: reasonsOf(it, parts, { timing, topic, travel, rc }), typeFactor };
}

/** Score one item for a context { today, prefs, affinity }: { score, parts, reasons, typeFactor }. */
export function scoreItem(item, ctx) {
  return scoreResolved(item, resolve(ctx));
}

function idSet(ids) {
  if (ids instanceof Set) return ids;
  if (Array.isArray(ids)) return new Set(ids);
  if (ids && typeof ids === 'object') return new Set(Object.keys(ids));
  return new Set();
}

/** Learn a small per-topic nudge in [-0.3, 0.3] from the items the user saved and dismissed. */
export function computeAffinity(items, planIds, dismissedIds) {
  const saved = idSet(planIds);
  const dismissed = idSet(dismissedIds);
  const up = {};
  const down = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const topics = knownTopics(item.topics);
    if (saved.has(item.id)) for (const t of topics) up[t] = (up[t] || 0) + 1;
    if (dismissed.has(item.id)) for (const t of topics) down[t] = (down[t] || 0) + 1;
  }
  const out = {};
  for (const t of TOPIC_IDS) {
    const p = up[t] || 0;
    const n = down[t] || 0;
    // Two pseudo-votes keep a single save from swinging the feed; the limit is MAX_AFFINITY.
    const a = Math.round((MAX_AFFINITY * (p - n)) / (p + n + 2) * 1000) / 1000;
    if (a) out[t] = a;
  }
  return out;
}

const NO_DATE = '9999-12-31';

/** All items scored and sorted best first; ties go to the earlier action date, then the title. */
export function rankItems(items, ctx) {
  const rc = resolve(ctx);
  const rows = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    rows.push({
      item,
      result: scoreResolved(item, rc),
      date: actionDate(item, rc.today) || NO_DATE,
      title: String(item.title || '').toLowerCase()
    });
  }
  rows.sort((a, b) => b.result.score - a.result.score
    || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return rows.map(({ item, result }) => ({ item, result }));
}

// Penalty for choosing a candidate next to what is already picked: 12% per pick of the same
// category and 8% per topic it shares with a pick.
function crowding(item, picked) {
  const topics = knownTopics(item.topics);
  let factor = 1;
  for (const p of picked) {
    if (p.item.category === item.category) factor *= 0.88;
    for (const t of knownTopics(p.item.topics)) if (topics.includes(t)) factor *= 0.92;
  }
  return factor;
}

/** The n best entries ({ item, result }) without duplicates; diversified unless opts.diversify is false. */
export function pickTop(items, ctx, n = 5, opts = {}) {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const { diversify = true, minScore = 1 } = opts || {};
  const seen = new Set();
  const pool = rankItems(items, ctx).filter(({ item, result }) => {
    const key = item.id == null ? item : item.id;
    if (result.score < minScore || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!diversify) return pool.slice(0, count);

  const picked = [];
  while (picked.length < count && pool.length) {
    let best = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const value = pool[i].result.score * crowding(pool[i].item, picked);
      if (value > bestValue) { best = i; bestValue = value; }
    }
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

/** A reason's params ready for translation: topic ids become one localized, comma-joined label. */
export function reasonParams(reason, lang) {
  const params = { ...(reason && reason.params) };
  if (Array.isArray(params.topics)) {
    params.topics = params.topics.map(id => topicLabel(id, lang)).join(lang === 'ar' ? '، ' : ', ');
  }
  return params;
}
