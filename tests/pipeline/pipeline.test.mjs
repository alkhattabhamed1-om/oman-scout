// Pipeline tests. No real network: link checks use a local server and the Claude command is a stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkItems, checkUrl, dateInText, isPrivateAddress } from '../../scripts/check-links.mjs';
import { applyVerification, sameItem, sanitizeItem } from '../../scripts/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ---------- date detection ---------- */
test('dateInText finds English, Arabic, numeric and range forms', () => {
  assert.ok(dateInText('Join us on 13 November 2026 at the OCEC', '2026-11-13'));
  assert.ok(dateInText('November 13, 2026', '2026-11-13'));
  assert.ok(dateInText('Nov 13', '2026-11-13'));
  assert.ok(dateInText('registration closes 2026-11-13', '2026-11-13'));
  assert.ok(dateInText('13/11/2026', '2026-11-13'));
  assert.ok(dateInText('from 13-15 November', '2026-11-13'));
  assert.ok(dateInText('11 to 13 November', '2026-11-13'));
  assert.ok(dateInText('13th of November', '2026-11-13'));
  assert.ok(dateInText('يوم 13 نوفمبر 2026', '2026-11-13'));
  assert.ok(dateInText('13 تشرين الثاني', '2026-11-13'));
  assert.ok(!dateInText('Join us on 14 November 2026', '2026-11-13'));
  assert.ok(!dateInText('113 November', '2026-11-13'));
  assert.ok(!dateInText('', '2026-11-13'));
});

test('private addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});

/* ---------- link checks against a local server ---------- */
function server() {
  const s = http.createServer((req, res) => {
    const pad = ' filler text '.repeat(60);
    if (req.url === '/ok') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<html><script>var d="14 November"</script><body>Event on 13 November 2026${pad}</body></html>`); }
    else if (req.url === '/nodate') { res.setHeader('content-type', 'text/html'); res.end(`<body>No dates here${pad}</body>`); }
    else if (req.url === '/gone') { res.statusCode = 404; res.end('gone'); }
    else if (req.url === '/blocked') { res.statusCode = 403; res.end('no bots'); }
    else if (req.url === '/hop') { res.statusCode = 302; res.setHeader('location', '/ok'); res.end(); }
    else if (req.url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); res.end(); }
    else { res.statusCode = 500; res.end(); }
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

test('checkUrl classifies pages and refuses loopback unless allowed', async () => {
  const s = await server();
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await checkUrl(base + '/ok', { allowLoopback: true })).linkOk, true);
    assert.equal((await checkUrl(base + '/hop', { allowLoopback: true })).linkOk, true);
    assert.equal((await checkUrl(base + '/gone', { allowLoopback: true })).linkOk, false);
    assert.equal((await checkUrl(base + '/blocked', { allowLoopback: true })).linkOk, null);
    assert.equal((await checkUrl(base + '/loop', { allowLoopback: true })).linkOk, null);
    assert.equal((await checkUrl(base + '/ok')).linkOk, null, 'loopback must be refused by default');
    assert.equal((await checkUrl('file:///etc/passwd', { allowLoopback: true })).linkOk, null);
  } finally { s.close(); }
});

test('checkItems records link status and whether the date is on the page', async () => {
  const s = await server();
  const base = `http://127.0.0.1:${s.address().port}`;
  const mk = (id, p, start) => ({ id, start, deadline: null, end: null, sources: [{ label: 'x', url: base + p }] });
  const items = [mk('a', '/ok', '2026-11-13'), mk('b', '/nodate', '2026-11-13'), mk('c', '/gone', '2026-11-13'), mk('d', '/blocked', '2026-11-13')];
  try {
    const stats = await checkItems(items, { allowLoopback: true });
    assert.deepEqual(items.map(i => [i.verified.linkOk, i.verified.dateOnPage]), [[true, true], [true, false], [false, null], [null, null]]);
    assert.equal(stats.ok, 2); assert.equal(stats.dead, 1); assert.equal(stats.unknown, 1); assert.equal(stats.dateSeen, 1);
  } finally { s.close(); }
});

/* ---------- sanitiser, duplicates, verification ---------- */
const raw = over => ({
  region: 'oman', category: 'competition', title: 'Test Hackathon 2026', summary: 'A test.', why: 'Because.', organizer: 'Org', start: '2026-11-20', end: null, deadline: '2026-11-10',
  approx: false, dateNote: null, location: 'Muscat', mode: 'in-person', cost: null, prize: null, teamSize: '1-4', travel: 'local', applyUrl: 'https://example.org/apply',
  topics: ['ai', 'nonsense'], audience: 'students', fit: 150, fitNote: 'ok', eligibility: 'eligible', eligibilityNote: 'Open.', confidence: 'likely',
  sources: [{ label: 'Page', url: 'https://example.org/page' }], tags: [], ...over
});

test('sanitizeItem accepts v2 items and fixes small problems', () => {
  const r = sanitizeItem(raw(), '2026-10-14');
  assert.ok(r.ok);
  assert.deepEqual(r.item.topics, ['ai']);
  assert.equal(r.item.fit, 100);
  assert.equal(r.item.applyUrl, 'https://example.org/apply');
  assert.match(r.item.id, /^test-hackathon-2026-[0-9a-f]{5}$/);
});

test('sanitizeItem rejects past items, hostile links and missing sources', () => {
  assert.equal(sanitizeItem(raw({ start: '2026-01-01', deadline: null }), '2026-10-14').reason, 'already past');
  assert.equal(sanitizeItem(raw({ sources: [{ label: 'x', url: 'javascript:alert(1)' }] }), '2026-10-14').reason, 'no valid source');
  assert.equal(sanitizeItem(raw({ region: 'mars' }), '2026-10-14').reason, 'bad region');
  assert.equal(sanitizeItem(raw({ applyUrl: 'javascript:alert(1)' }), '2026-10-14').item.applyUrl, null);
  assert.equal(sanitizeItem(raw({ eligibility: 'ineligible', fit: 90 }), '2026-10-14').item.fit, 15);
  assert.equal(sanitizeItem(raw({ start: null, deadline: null }), '2026-10-14').item.dateNote, 'No date announced');
});

test('sameItem merges renamed editions but keeps different editions apart', () => {
  const a = { region: 'oman', title: 'SAS Excellence Initiative (MTCIT)', sources: [{ url: 'https://sas.om/a' }] };
  const b = { region: 'oman', title: 'SAS Excellence Initiative', sources: [{ url: 'https://other.om/x' }] };
  assert.ok(sameItem(a, b));
  assert.ok(!sameItem({ ...a, region: 'gcc' }, b));
  assert.ok(!sameItem({ region: 'oman', title: 'Hackathon', sources: [] }, { region: 'oman', title: 'Oman Hackathon', sources: [] }), 'generic single words are not enough');
  assert.ok(!sameItem({ region: 'oman', title: 'Hadatha Hackathon Telecom', sources: [] }, { region: 'oman', title: 'Oman Collegiate Programming Contest', sources: [] }));
  assert.ok(sameItem({ region: 'oman', title: 'COMEX 2027 Global Technology Show', sources: [] }, { region: 'oman', title: 'COMEX 2027', sources: [] }));
});

test('applyVerification changes fields only on evidence and drops dead items', () => {
  const item = sanitizeItem(raw(), '2026-10-14').item;
  const none = { start: null, end: null, deadline: null, applyUrl: null, cost: null, prize: null, teamSize: null, eligibility: null, eligibilityNote: null, confidence: null };
  const adj = applyVerification(item, { id: item.id, verdict: 'adjusted', evidence: 'Seen on the organiser page.', fields: { ...none, deadline: '2026-12-01', cost: 'Free' } }, '2026-10-14');
  assert.equal(adj.deadline, '2026-12-01'); assert.equal(adj.cost, 'Free'); assert.equal(adj.start, item.start); assert.equal(adj.verified.agent, 'adjusted');
  assert.equal(applyVerification(item, { id: item.id, verdict: 'confirmed', evidence: 'ok', fields: none }, '2026-10-14').confidence, 'confirmed');
  assert.equal(applyVerification(item, { id: item.id, verdict: 'cancelled', evidence: 'x', fields: none }, '2026-10-14'), null);
  assert.equal(applyVerification(item, { id: item.id, verdict: 'unreachable', evidence: 'x', fields: none }, '2026-10-14').confidence, 'unverified');
  assert.equal(applyVerification(item, { id: item.id, verdict: 'adjusted', evidence: 'x', fields: { ...none, deadline: '2026-01-01', start: '2026-01-01' } }, '2026-10-14'), null, 'moved into the past');
});

/* ---------- end to end with a stand-in for the Claude command ---------- */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-'));
  for (const d of ['assets/lib', 'scripts', 'agent', 'data']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}
function run(dir, script, args, env = {}) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, SCOUT_CLAUDE_BIN: process.execPath, SCOUT_CLAUDE_PRE: path.join(ROOT, 'scripts/dev/fake-claude.mjs'), SCOUT_NO_LINKCHECK: '1', ...env }
  });
}
const readOut = (dir, task) => JSON.parse(fs.readFileSync(path.join(dir, 'out', task + '.json'), 'utf8'));

test('quick scan: discover only, bad items dropped', () => {
  const dir = sandbox();
  const r = run(dir, 'run-task.mjs', ['oman-competitions'], { SCOUT_DEPTH: 'quick' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const titles = readOut(dir, 'oman-competitions').items.map(i => i.title);
  assert.ok(titles.some(t => t.endsWith('Hackathon 2026')));
  assert.ok(!titles.some(t => t.includes('Old Thing')), 'past item dropped');
  assert.ok(!titles.some(t => t.includes('Bad Link')), 'hostile link dropped');
  assert.ok(titles.some(t => t.includes('Cancelled')), 'quick scan does not verify');
  assert.ok(!titles.some(t => t.includes('Gap Find')), 'quick scan has no gap pass');
});

test('thorough scan: gap pass adds items and the verifier corrects and removes', () => {
  const dir = sandbox();
  const r = run(dir, 'run-task.mjs', ['gcc-events'], { SCOUT_DEPTH: 'thorough' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const items = readOut(dir, 'gcc-events').items;
  assert.ok(items.some(i => i.title.includes('Gap Find')), 'gap pass item present');
  assert.ok(!items.some(i => i.title.includes('Cancelled')), 'cancelled item removed by the verifier');
  assert.ok(items.some(i => i.verified && i.verified.agent === 'adjusted' && i.deadline === '2026-12-20'), 'verifier correction applied');
});

test('a scan that returns nothing usable fails loudly', () => {
  const dir = sandbox();
  const r = run(dir, 'run-task.mjs', ['oman-events'], { FAKE_FAIL: 'Assignment:', FAKE_HARD: '1', SCOUT_DEPTH: 'quick' });
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'oman-events.json')));
});

test('merge keeps stale tasks, scores items, writes the calendar feed and translate adds Arabic', () => {
  const dir = sandbox();
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'data/scout.json'), 'utf8'));
  assert.equal(run(dir, 'run-task.mjs', ['oman-competitions'], { SCOUT_DEPTH: 'quick' }).status, 0);
  assert.equal(run(dir, 'run-task.mjs', ['gcc-events'], { SCOUT_DEPTH: 'thorough' }).status, 0);
  const m = run(dir, 'merge.mjs', [], { SCOUT_DEPTH: 'thorough' });
  assert.equal(m.status, 0, m.stderr + m.stdout);
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'data/scout.json'), 'utf8'));
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.tasks['oman-competitions'].status, 'ok');
  assert.equal(data.tasks['oman-events'].status, 'stale');
  assert.ok(data.items.some(i => i.task === 'oman-events'), 'stale items kept');
  assert.ok(data.items.every(i => Number.isInteger(i.score) && i.score >= 0 && i.score <= 100));
  assert.ok(data.items.every((i, k, a) => k === 0 || a[k - 1].score >= i.score), 'sorted by score');
  assert.ok(data.stats.total === data.items.length);
  const ics = fs.readFileSync(path.join(dir, 'data/oman-scout.ics'), 'utf8');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VALARM'), 'deadline reminders present');
  const t = run(dir, 'translate.mjs', []);
  assert.equal(t.status, 0, t.stderr + t.stdout);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'data/scout.json'), 'utf8'));
  assert.ok(after.items.every(i => i.ar && i.ar.title), 'every item has Arabic');
  assert.ok(before.items.length > 50);
});

test('merge refuses to write when no task produced results', () => {
  const dir = sandbox();
  const p = path.join(dir, 'data/scout.json');
  const before = fs.readFileSync(p, 'utf8');
  const m = run(dir, 'merge.mjs', []);
  assert.equal(m.status, 1);
  assert.equal(fs.readFileSync(p, 'utf8'), before);
});
