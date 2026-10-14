import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, googleCalendarUrl, mapsUrl, shareText, digestText } from '../../assets/lib/ics.js';
import { createStore, loadUser, saveUser, exportUser, importUser, resetUser } from '../../assets/lib/store.js';

const item = {
  id: 'demo-1', title: 'Demo Hackathon, "Round 1"; كأس', summary: 'Line one\nline two, with commas; and semicolons.', start: '2026-11-13', end: '2026-11-15', deadline: '2026-11-01',
  location: 'Muscat, Oman', sources: [{ label: 'Page', url: 'https://example.org/demo' }], region: 'oman', category: 'competition', eligibility: 'eligible'
};
const fake = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };

test('buildIcs: CRLF, escaping, folding by bytes, exclusive end date, reminders', () => {
  const ics = buildIcs([item], { lang: 'en', calName: 'Oman Scout', now: new Date('2026-10-14T00:00:00Z') });
  assert.ok(ics.includes('\r\n') && !/[^\r]\n/.test(ics), 'CRLF line endings only');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261113'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261116'), 'all-day end is exclusive');
  assert.ok(ics.includes('UID:demo-1-start@oman-scout') && ics.includes('UID:demo-1-deadline@oman-scout'));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2, 'two reminders on the deadline');
  assert.ok(ics.includes('\\,') && ics.includes('\\;') && ics.includes('\\n'), 'text escaped');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'line within 75 bytes: ' + line.slice(0, 40));
});

test('links and share text', () => {
  const g = googleCalendarUrl(item, { lang: 'en' });
  assert.ok(g.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
  assert.ok(g.includes('dates=20261113/20261116'));
  assert.equal(googleCalendarUrl({ title: 'x' }, { lang: 'en' }), null);
  assert.ok(mapsUrl(item).startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.equal(mapsUrl({ location: 'Online' }), null);
  assert.ok(shareText(item, { lang: 'en', url: 'https://x.test/#/item/demo-1' }).includes('https://x.test/#/item/demo-1'));
  assert.ok(digestText([item], { lang: 'en', siteUrl: 'https://x.test/', title: 'Picks' }).includes('Demo Hackathon'));
});

test('store: defaults, migration of v1 saved ids, save and reload', () => {
  const st = createStore(fake({ 'scout.saved': '["a","b"]', 'scout.lang': 'ar' }));
  const u = loadUser(st);
  assert.deepEqual(Object.keys(u.plan).sort(), ['a', 'b']);
  assert.equal(u.plan.a.status, 'interested');
  assert.equal(u.ui.lang, 'ar');
  assert.equal(st.get('saved'), null, 'v1 key removed after migration');
  saveUser(st, { plan: { ...u.plan, c: { status: 'applied', note: 'team: Sara', updatedAt: '2026-10-14T00:00:00Z' } }, ui: { density: 'compact', theme: 'dark' } });
  const again = loadUser(st);
  assert.equal(again.plan.c.status, 'applied');
  assert.equal(again.ui.density, 'compact');
  assert.equal(st.get('theme'), 'dark', 'mirrored for boot.js');
});

test('store: export/import round trip, never leaks the token or cache, rejects garbage', () => {
  const a = createStore(fake({ 'scout.token': 'secret-token', 'scout.cache': '{"big":1}' }));
  saveUser(a, { plan: { x: { status: 'going', note: 'n', updatedAt: '2026-10-14T00:00:00Z' } }, dismissed: new Set(['y']), prefs: { interests: ['ai'] } });
  const code = exportUser(a);
  assert.ok(code.startsWith('scout1.'));
  assert.ok(!Buffer.from(code.slice(7).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().includes('secret-token'));
  const b = createStore(fake());
  const r = importUser(b, code);
  assert.ok(r.ok);
  const u = loadUser(b);
  assert.equal(u.plan.x.status, 'going');
  assert.ok(u.dismissed.has('y'));
  assert.deepEqual(u.prefs.interests, ['ai']);
  for (const bad of ['', 'garbage', 'scout1.%%%', 'scout1.' + Buffer.from('{"v":9}').toString('base64url'), null, 42]) assert.equal(importUser(b, bad).ok, false);
  resetUser(b);
  assert.deepEqual(loadUser(b).plan, {});
});

test('store works with no storage and with throwing storage', () => {
  for (const storage of [null, { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } }]) {
    const st = createStore(storage);
    assert.doesNotThrow(() => saveUser(st, { plan: { z: { status: 'done', note: '', updatedAt: '2026-10-14T00:00:00Z' } } }));
    assert.ok(loadUser(st).prefs.interests.length > 0);
  }
});
