import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PREFS, mergePrefs, scoreItem, computeAffinity, rankItems, pickTop, reasonParams
} from '../../assets/lib/rank.js';
import { addDays } from '../../assets/lib/dates.js';
import { TOPIC_IDS } from '../../assets/lib/topics.js';

const { today: TODAY, items: FIXTURE } = JSON.parse(readFileSync(new URL('../fixtures/lib-items.json', import.meta.url), 'utf8'));
const CTX = { today: TODAY, prefs: {}, affinity: {} };

const REASON_KEYS = new Set([
  'why.notEligible', 'why.openToYou', 'why.closesSoon', 'why.startsSoon', 'why.ongoing', 'why.topicMatch', 'why.strongFit',
  'why.prize', 'why.verified', 'why.inOman', 'why.online', 'why.nearby', 'why.farAway', 'why.outsideReach', 'why.needsCheck'
]);

function competition(over = {}) {
  return {
    id: 'c1', category: 'competition', region: 'oman', travel: 'local', eligibility: 'eligible', confidence: 'confirmed',
    fit: 70, topics: ['ai', 'software'], deadline: addDays(TODAY, 6), ...over
  };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

test('DEFAULT_PREFS matches the spec and cannot be changed by accident', () => {
  assert.deepEqual(DEFAULT_PREFS.interests, ['ai', 'software', 'data', 'cyber', 'startups', 'webmobile']);
  assert.deepEqual(DEFAULT_PREFS.typeWeights, { competition: 1.25, event: 1.0, funding: 0.95, competitor: 0.7 });
  assert.equal(DEFAULT_PREFS.reach, 'gcc');
  assert.equal(DEFAULT_PREFS.learn, true);
  assert.throws(() => DEFAULT_PREFS.interests.push('games'));
});

test('an ineligible item never scores above 15, whatever else is perfect', () => {
  const perfect = competition({ eligibility: 'ineligible', fit: 100, deadline: TODAY, verified: { dateOnPage: true, linkOk: true } });
  assert.ok(scoreItem(perfect, CTX).score <= 15);
  for (const item of FIXTURE.filter(i => i.eligibility === 'ineligible')) assert.ok(scoreItem(item, CTX).score <= 15, item.id);
  assert.ok(scoreItem(perfect, CTX).score > 0, 'still ranked, just low');
});

test('an eligible competition closing in 6 days with two matching topics scores at least 85', () => {
  const r = scoreItem(competition(), CTX);
  assert.ok(r.score >= 85, `score ${r.score}`);
});

test('a far in-person event under reach gcc scores lower than the same item online', () => {
  const far = { id: 'e', category: 'event', region: 'global', travel: 'far', mode: 'in-person', eligibility: 'eligible', confidence: 'confirmed', fit: 70, topics: ['ai'], start: addDays(TODAY, 30) };
  const online = { ...far, travel: 'online', mode: 'online' };
  assert.ok(scoreItem(far, CTX).score < scoreItem(online, CTX).score);
  const wide = { today: TODAY, prefs: { reach: 'far' } };
  assert.ok(scoreItem(far, wide).score > scoreItem(far, CTX).score, 'reach far forgives the distance');
  assert.ok(scoreItem(far, wide).score < scoreItem(online, wide).score, 'but online still wins');
});

test('reach values follow the spec', () => {
  const r = (travel, reach) => scoreItem({ id: 'x', travel }, { today: TODAY, prefs: { reach } }).parts.reach;
  assert.equal(r('local', 'local'), 1);
  assert.equal(r('online', 'gcc'), 1);
  assert.equal(r('gcc', 'gcc'), 0.8);
  assert.equal(r('gcc', 'far'), 0.8);
  assert.equal(r('gcc', 'local'), 0.35);
  assert.equal(r('far', 'far'), 0.9);
  assert.equal(r('far', 'gcc'), 0.15);
  assert.equal(r('far', 'local'), 0.15);
});

test('a past item scores 0', () => {
  assert.equal(scoreItem({ id: 'p', category: 'event', start: '2026-10-01', end: '2026-10-05', eligibility: 'eligible', fit: 100 }, CTX).score, 0);
  assert.equal(scoreItem({ id: 'p', category: 'event', start: addDays(TODAY, -1) }, CTX).score, 0);
  assert.equal(scoreItem({ id: 'p', category: 'competition', deadline: addDays(TODAY, -1) }, CTX).score, 0);
  assert.equal(scoreItem(FIXTURE.find(i => i.id === 'old-expo'), CTX).score, 0);
  assert.deepEqual(scoreItem(FIXTURE.find(i => i.id === 'old-expo'), CTX).reasons, []);
  assert.ok(scoreItem({ id: 'today', category: 'event', start: TODAY }, CTX).score > 0, 'today is not past');
});

test('a closer deadline never scores lower than a later one until it passes', () => {
  let previous = Infinity;
  for (let days = 0; days <= 400; days++) {
    const { score, parts } = scoreItem(competition({ deadline: addDays(TODAY, days), start: null }), CTX);
    assert.ok(score <= previous, `day ${days}: ${score} after ${previous}`);
    assert.ok(parts.timing <= 1 && parts.timing >= 0.3);
    previous = score;
  }
  assert.equal(scoreItem(competition({ deadline: addDays(TODAY, -1), start: null }), CTX).score, 0, 'passed');
});

test('timing follows the spec bands and is smooth between them', () => {
  const t = days => scoreItem(competition({ deadline: addDays(TODAY, days), start: null }), CTX).parts.timing;
  for (const days of [0, 1, 2, 3]) assert.ok(near(t(days), 1), `day ${days}`);
  assert.ok(near(t(7), 0.95));
  assert.ok(near(t(14), 0.85));
  assert.ok(near(t(30), 0.7));
  assert.ok(near(t(60), 0.55));
  assert.ok(near(t(120), 0.4));
  assert.ok(near(t(240), 0.3));
  assert.ok(near(t(1000), 0.3));
  for (let d = 1; d < 240; d++) assert.ok(Math.abs(t(d + 1) - t(d)) <= 0.015, `a day changes timing by at most 0.015 (day ${d})`);
  const undated = scoreItem({ id: 'u', category: 'competition' }, CTX).parts.timing;
  assert.equal(undated, 0.25);
});

test('an ongoing item counts as zero days away', () => {
  const ongoing = { id: 'o', category: 'event', start: addDays(TODAY, -3), end: addDays(TODAY, 4) };
  const r = scoreItem(ongoing, CTX);
  assert.equal(r.parts.timing, 1);
  assert.equal(r.reasons[0].key, 'why.ongoing');
});

test('for competitions the deadline wins over the start, for events the start does', () => {
  const comp = competition({ start: addDays(TODAY, 90), deadline: addDays(TODAY, 2) });
  assert.equal(scoreItem(comp, CTX).parts.timing, 1);
  const event = { ...comp, category: 'event' };
  assert.ok(near(scoreItem(event, CTX).parts.timing, 0.4 + (0.55 - 0.4) * (120 - 90) / 60));
});

test('with no interests chosen the topic component is exactly 0.5', () => {
  const prefs = { interests: [] };
  for (const item of FIXTURE) assert.equal(scoreItem(item, { today: TODAY, prefs }).parts.topic, 0.5, item.id);
  assert.equal(scoreItem(competition(), { today: TODAY, prefs, affinity: { ai: 0.3 } }).parts.topic, 0.5);
});

test('the topic component grows with overlapping interests and is nudged by affinity', () => {
  const topic = (topics, ctx = CTX) => scoreItem(competition({ topics }), ctx).parts.topic;
  assert.equal(topic([]), 0.15);
  assert.equal(topic(['games']), 0.15);
  assert.equal(topic(['ai']), 0.7);
  assert.ok(near(topic(['ai', 'software']), 0.85));
  assert.ok(near(topic(['ai', 'software', 'data']), 1));
  assert.equal(topic(['ai', 'software', 'data', 'cyber']), 1);
  assert.equal(topic(['ai', 'mystery', 'ai']), 0.7, 'unknown topics are ignored and duplicates count once');
  const boosted = { today: TODAY, prefs: {}, affinity: { ai: 0.3 } };
  assert.ok(near(topic(['ai'], boosted), 1));
  const mixed = { today: TODAY, prefs: {}, affinity: { ai: 0.2, games: -0.2 } };
  assert.ok(near(topic(['ai', 'games'], mixed), 0.7), 'affinity is the average over the item topics');
  const dampened = { today: TODAY, prefs: {}, affinity: { ai: -0.3 } };
  assert.ok(near(topic(['ai'], dampened), 0.4));
  const noLearning = { today: TODAY, prefs: { learn: false }, affinity: { ai: -0.3 } };
  assert.equal(topic(['ai'], noLearning), 0.7, 'learn off ignores affinity');
});

test('eligibility and confidence components follow the spec', () => {
  const e = eligibility => scoreItem({ id: 'x', eligibility }, CTX).parts.eligibility;
  assert.deepEqual(['eligible', 'likely', 'check', 'na', 'ineligible'].map(e), [1, 0.85, 0.55, 0.45, 0]);
  const c = (confidence, verified) => scoreItem({ id: 'x', confidence, verified }, CTX).parts.confidence;
  assert.deepEqual(['confirmed', 'likely', 'unverified'].map(x => c(x)), [1, 0.8, 0.5]);
  assert.ok(near(c('likely', { dateOnPage: true }), 0.85));
  assert.equal(c('confirmed', { dateOnPage: true }), 1);
  assert.ok(near(c('confirmed', { linkOk: false }), 0.8));
  assert.ok(near(c('unverified', { dateOnPage: true, linkOk: false }), 0.35));
  assert.equal(c('unverified', { linkOk: null, dateOnPage: null }), 0.5);
});

test('the type weight scales the score: competitions above events above competitor news', () => {
  const base = { id: 'x', region: 'oman', travel: 'local', eligibility: 'eligible', confidence: 'confirmed', fit: 70, topics: ['ai'], start: addDays(TODAY, 10) };
  const s = category => scoreItem({ ...base, category }, CTX).score;
  assert.ok(s('competition') > s('event'));
  assert.ok(s('event') > s('funding'));
  assert.ok(s('funding') > s('competitor'));
  const balanced = { today: TODAY, prefs: { typeWeights: { competition: 1, event: 1, funding: 1, competitor: 1 } } };
  assert.equal(scoreItem({ ...base, category: 'competition' }, balanced).score, scoreItem({ ...base, category: 'competitor' }, balanced).score);
});

test('the result has the documented shape', () => {
  const r = scoreItem(competition(), CTX);
  assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
  assert.deepEqual(Object.keys(r.parts).sort(), ['confidence', 'eligibility', 'fit', 'reach', 'timing', 'topic']);
  for (const v of Object.values(r.parts)) assert.ok(v >= 0 && v <= 1);
  assert.ok(r.reasons.length >= 1 && r.reasons.length <= 3);
  for (const reason of r.reasons) {
    assert.ok(REASON_KEYS.has(reason.key), reason.key);
    assert.equal(typeof reason.params, 'object');
  }
  assert.ok(r.typeFactor > 0 && r.typeFactor <= 1);
});

test('results are deterministic and the function is pure', () => {
  const items = FIXTURE.map(i => structuredClone(i));
  const ctx = { today: TODAY, prefs: { interests: ['ai', 'cyber'], reach: 'local' }, affinity: { ai: 0.1 } };
  const snapshot = JSON.stringify([items, ctx]);
  const first = JSON.stringify(items.map(i => scoreItem(i, ctx)));
  const second = JSON.stringify(items.map(i => scoreItem(i, ctx)));
  assert.equal(first, second);
  assert.equal(JSON.stringify([items, ctx]), snapshot, 'inputs unchanged');
  const frozen = deepFreeze({ items: structuredClone(FIXTURE), ctx: structuredClone(ctx) });
  assert.doesNotThrow(() => { rankItems(frozen.items, frozen.ctx); pickTop(frozen.items, frozen.ctx, 5); });
  assert.deepEqual(rankItems(items, ctx).map(r => r.item.id), rankItems([...items].reverse(), ctx).map(r => r.item.id), 'input order does not matter');
});

test('malformed items still score an integer from 0 to 100, never NaN, and never throw', () => {
  const junk = [
    null, undefined, 0, 'x', [], {}, { id: 1 }, { fit: NaN }, { fit: Infinity }, { fit: -50 }, { fit: 900 }, { fit: '80' }, { fit: 'high' },
    { start: 'bad' }, { start: 20261114 }, { deadline: '2026-02-30' }, { end: {} }, { topics: 'ai' }, { topics: [null, 7, {}, 'ai'] },
    { category: 'mystery', eligibility: 'weird', confidence: 5, travel: 'moon', region: 3, mode: [] },
    { verified: 'yes' }, { verified: { linkOk: 'no', dateOnPage: 1 } }, { sources: 'x', tags: 5, prize: 12, ar: 'x' },
    { __proto__: { fit: 99 } }, { category: 'constructor', eligibility: 'toString', confidence: 'hasOwnProperty' },
    { title: 5, deadline: new Date(), start: [] }
  ];
  const ctxs = [CTX, {}, undefined, null, { today: 'not a date' }, { today: TODAY, prefs: { interests: 'ai', typeWeights: { event: 'x', competition: NaN }, reach: 'mars', learn: 'yes' }, affinity: { ai: 'lots', cyber: Infinity } }];
  for (const item of junk) {
    for (const ctx of ctxs) {
      const r = scoreItem(item, ctx);
      assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100, `${JSON.stringify(item)} -> ${r.score}`);
      for (const v of Object.values(r.parts)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
      assert.ok(r.reasons.length <= 3);
    }
  }
  assert.equal(rankItems(junk, CTX).length, junk.filter(i => i && typeof i === 'object').length);
  assert.deepEqual(rankItems(null, CTX), []);
  assert.deepEqual(pickTop(undefined, CTX, 3), []);
});

test('randomised items keep every invariant', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = list => list[Math.floor(rnd() * list.length)];
  for (let i = 0; i < 400; i++) {
    const item = {
      id: `r${i}`,
      category: pick(['event', 'competition', 'competitor', 'funding']),
      region: pick(['oman', 'gcc', 'global']),
      travel: pick(['local', 'online', 'gcc', 'far', undefined]),
      eligibility: pick(['eligible', 'likely', 'check', 'na', 'ineligible', undefined]),
      confidence: pick(['confirmed', 'likely', 'unverified']),
      fit: pick([0, 10, 55, 100, undefined]),
      topics: TOPIC_IDS.filter(() => rnd() < 0.2),
      start: rnd() < 0.7 ? addDays(TODAY, Math.floor(rnd() * 500) - 100) : null,
      deadline: rnd() < 0.5 ? addDays(TODAY, Math.floor(rnd() * 200) - 30) : null
    };
    const r = scoreItem(item, CTX);
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
    if (item.eligibility === 'ineligible') assert.ok(r.score <= 15);
  }
});

test('pickTop returns no duplicates and respects n', () => {
  const dup = [...FIXTURE, ...FIXTURE.map(i => ({ ...i }))];
  for (const n of [0, 1, 3, 5, 50]) {
    const top = pickTop(dup, CTX, n);
    const ids = top.map(t => t.item.id);
    assert.equal(new Set(ids).size, ids.length, `n=${n}`);
    assert.ok(top.length <= n);
  }
  assert.equal(pickTop(dup, CTX, 5).length, 5);
  assert.equal(pickTop(dup, CTX, Infinity).length, 0, 'a non-finite count picks nothing');
  assert.equal(pickTop(dup, CTX).length, 5, 'default is five');
  assert.ok(!pickTop(FIXTURE, CTX, 50).some(t => t.item.id === 'old-expo'), 'past items are never picked');
  for (const t of pickTop(FIXTURE, CTX, 5)) assert.deepEqual(t.result, scoreItem(t.item, CTX));
});

test('pickTop diversifies: a lower-scored different item can beat a near copy', () => {
  const a1 = competition({ id: 'a1', topics: ['ai'], fit: 100 });
  const a2 = competition({ id: 'a2', topics: ['ai'], fit: 98 });
  const b = { id: 'b', category: 'event', region: 'oman', travel: 'local', eligibility: 'eligible', confidence: 'confirmed', fit: 60, topics: ['cyber'], start: addDays(TODAY, 5) };
  const s = x => scoreItem(x, CTX).score;
  assert.ok(s(a2) > s(b) && s(b) > s(a2) * 0.88 * 0.92, 'premise: adjusted score of a2 drops below b');
  assert.deepEqual(pickTop([a1, a2, b], CTX, 2).map(t => t.item.id), ['a1', 'b']);
  assert.deepEqual(pickTop([a1, a2, b], CTX, 2, { diversify: false }).map(t => t.item.id), ['a1', 'a2']);
  assert.deepEqual(pickTop([a1, a2, b], CTX, 3).map(t => t.item.id), ['a1', 'b', 'a2']);
});

test('rankItems sorts best first; ties go to the earlier date, then the title', () => {
  const same = { category: 'event', region: 'oman', travel: 'local', eligibility: 'eligible', confidence: 'confirmed', fit: 70, topics: ['ai'] };
  const items = [
    { ...same, id: 'late', title: 'A', start: addDays(TODAY, 3) },
    { ...same, id: 'b-title', title: 'B', start: addDays(TODAY, 2) },
    { ...same, id: 'a-title', title: 'a', start: addDays(TODAY, 2) },
    { ...same, id: 'undated', title: 'Z' }
  ];
  const ranked = rankItems(items, CTX);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].result.score >= ranked[i].result.score);
  const tied = rankItems(items.slice(0, 3), CTX);
  assert.equal(tied[0].result.score, tied[2].result.score, 'premise: equal scores');
  assert.deepEqual(tied.map(r => r.item.id), ['a-title', 'b-title', 'late']);
  assert.equal(ranked.at(-1).item.id, 'undated');
  assert.deepEqual(rankItems(items, CTX).map(r => r.item.id), rankItems(items, CTX).map(r => r.item.id), 'stable across runs');
});

test('the fixture ranks sensibly under default preferences', () => {
  const order = rankItems(FIXTURE, CTX).map(r => r.item.id);
  assert.ok(order.indexOf('cyber-ctf') < order.indexOf('web-summit-lisbon'));
  assert.ok(order.indexOf('ai-hackathon') < order.indexOf('ooredoo-datacentre'));
  assert.equal(order.at(-1), 'old-expo', 'the finished event is last');
  assert.ok(order.indexOf('ciso-summit') > order.indexOf('ongoing-expo'), 'ineligible sinks');
  assert.ok(order.indexOf('cyber-ctf') < 3, 'the verified, closing, matching competition is near the top');
});

test('computeAffinity stays within [-0.3, 0.3] and reflects saves and dismissals', () => {
  const items = [
    { id: 'a', topics: ['ai', 'cyber'] }, { id: 'b', topics: ['ai'] }, { id: 'c', topics: ['games'] },
    { id: 'd', topics: ['games', 'mystery'] }, { id: 'e', topics: ['green'] }, null, { id: 'f' }
  ];
  const aff = computeAffinity(items, ['a', 'b'], ['c', 'd']);
  assert.ok(aff.ai > aff.cyber && aff.cyber > 0);
  assert.ok(aff.games < 0);
  assert.equal(aff.green, undefined, 'untouched topics stay out');
  assert.equal(aff.mystery, undefined, 'unknown topics are ignored');
  for (const v of Object.values(aff)) assert.ok(v >= -0.3 && v <= 0.3);
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, topics: ['ai'] }));
  const up = computeAffinity(many, many.map(m => m.id), []).ai;
  const down = computeAffinity(many, [], many.map(m => m.id)).ai;
  assert.ok(up <= 0.3 && up > 0.29);
  assert.ok(down >= -0.3 && down < -0.29);
  assert.equal(computeAffinity(many, many.map(m => m.id), many.map(m => m.id)).ai, undefined, 'save and dismiss cancel');
});

test('computeAffinity accepts sets, arrays and plan objects and tolerates junk', () => {
  const items = [{ id: 'a', topics: ['ai'] }];
  const fromArray = computeAffinity(items, ['a'], []);
  assert.deepEqual(computeAffinity(items, new Set(['a']), new Set()), fromArray);
  assert.deepEqual(computeAffinity(items, { a: { status: 'interested' } }, undefined), fromArray);
  assert.deepEqual(computeAffinity(null, null, null), {});
  assert.deepEqual(computeAffinity(items, 'a', 7), {});
});

test('one save lifts a topic a little, ten lift it more', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, topics: ['cloud'] }));
  const one = computeAffinity(items, ['s0'], []).cloud;
  const ten = computeAffinity(items, items.map(i => i.id), []).cloud;
  assert.ok(one > 0 && one < 0.12);
  assert.ok(ten > one && ten <= 0.3);
});

test('reasons: closing soon, topic match, open to you for an eligible competition', () => {
  const r = scoreItem(competition(), CTX);
  const keys = r.reasons.map(x => x.key);
  assert.deepEqual(keys, ['why.closesSoon', 'why.topicMatch', 'why.openToYou']);
  assert.deepEqual(r.reasons[0].params, { days: 6 });
  assert.deepEqual(r.reasons[1].params, { topics: ['ai', 'software'] });
});

test('reasons name the negatives too', () => {
  const ineligible = scoreItem(FIXTURE.find(i => i.id === 'ciso-summit'), CTX);
  assert.equal(ineligible.reasons[0].key, 'why.notEligible');
  const far = scoreItem({ id: 'f', category: 'event', travel: 'far', start: addDays(TODAY, 40), topics: [] }, CTX);
  assert.ok(far.reasons.some(x => x.key === 'why.farAway'));
  const trip = scoreItem({ id: 'g', category: 'event', travel: 'gcc', start: addDays(TODAY, 40), topics: [] }, { today: TODAY, prefs: { reach: 'local' } });
  assert.ok(trip.reasons.some(x => x.key === 'why.outsideReach'));
  const gcc = scoreItem({ id: 'g', category: 'event', travel: 'gcc', start: addDays(TODAY, 40), topics: [] }, CTX);
  assert.ok(gcc.reasons.some(x => x.key === 'why.nearby'));
  const check = scoreItem({ id: 'h', category: 'event', eligibility: 'check', confidence: 'confirmed', start: addDays(TODAY, 40), topics: [] }, CTX);
  assert.ok(check.reasons.some(x => x.key === 'why.needsCheck'));
  const broken = scoreItem({ id: 'i', category: 'event', eligibility: 'eligible', confidence: 'confirmed', verified: { linkOk: false }, start: addDays(TODAY, 40) }, CTX);
  assert.ok(broken.reasons.some(x => x.key === 'why.needsCheck'));
});

test('reasons for place, prize and verification', () => {
  const keys = item => scoreItem(item, CTX).reasons.map(r => r.key);
  const quiet = { id: 'q', category: 'competition', start: addDays(TODAY, 100), topics: [], eligibility: 'na', confidence: 'likely', travel: 'local' };
  assert.deepEqual(keys(quiet), ['why.inOman']);
  assert.deepEqual(keys({ ...quiet, travel: 'online' }), ['why.online']);
  assert.deepEqual(keys({ ...quiet, prize: 'USD 5,000' }), ['why.prize', 'why.inOman']);
  assert.ok(!keys({ ...quiet, prize: 'Not specified' }).includes('why.prize'));
  assert.ok(!keys({ ...quiet, category: 'event', prize: 'USD 5,000' }).includes('why.prize'), 'prizes only matter for competitions and funding');
  assert.deepEqual(keys({ ...quiet, confidence: 'confirmed' }), ['why.inOman', 'why.verified']);
  assert.ok(keys({ ...quiet, fit: 90 }).includes('why.strongFit'));
  assert.ok(!keys({ ...quiet, confidence: 'confirmed', verified: { linkOk: false } }).includes('why.verified'));
});

test('reasons: at most three, only documented keys, across the fixture and random items', () => {
  for (const item of FIXTURE) {
    const r = scoreItem(item, CTX);
    assert.ok(r.reasons.length <= 3, item.id);
    for (const reason of r.reasons) assert.ok(REASON_KEYS.has(reason.key), `${item.id}: ${reason.key}`);
    assert.equal(new Set(r.reasons.map(x => x.key)).size, r.reasons.length, 'no repeated key');
  }
});

test('reasonParams turns topic ids into labels in the viewer language', () => {
  const reason = { key: 'why.topicMatch', params: { topics: ['ai', 'cyber'] } };
  assert.equal(reasonParams(reason, 'en').topics, 'AI & machine learning, Cybersecurity');
  assert.equal(reasonParams(reason, 'ar').topics, 'الذكاء الاصطناعي وتعلّم الآلة، الأمن السيبراني');
  assert.deepEqual(reasonParams({ key: 'why.closesSoon', params: { days: 3 } }, 'en'), { days: 3 });
  assert.deepEqual(reasonParams(undefined, 'en'), {});
  assert.deepEqual(reason.params.topics, ['ai', 'cyber'], 'the reason itself is not changed');
});

test('mergePrefs fills gaps, keeps valid choices and drops invalid ones', () => {
  assert.deepEqual(mergePrefs(undefined), DEFAULT_PREFS);
  assert.deepEqual(mergePrefs({}), DEFAULT_PREFS);
  const merged = mergePrefs({ interests: ['games', 'nope', 'games'], typeWeights: { event: 1.5, funding: 'x', mystery: 9 }, reach: 'far', learn: false });
  assert.deepEqual(merged.interests, ['games']);
  assert.deepEqual(merged.typeWeights, { competition: 1.25, event: 1.5, funding: 0.95, competitor: 0.7 });
  assert.equal(merged.reach, 'far');
  assert.equal(merged.learn, false);
  assert.deepEqual(mergePrefs({ interests: [] }).interests, []);
  assert.equal(mergePrefs({ reach: 'mars', learn: 'yes' }).reach, 'gcc');
  assert.equal(mergePrefs({ typeWeights: { event: 99 } }).typeWeights.event, 2);
  assert.notEqual(mergePrefs({}).interests, DEFAULT_PREFS.interests, 'a fresh copy, safe to edit');
});
