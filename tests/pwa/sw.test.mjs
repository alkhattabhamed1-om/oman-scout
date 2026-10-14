// Loads sw.js into a sandbox with a fake Cache API and checks its caching decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function boot({ build, online = true }) {
  const stores = new Map();
  const norm = (req, ignoreSearch) => { const u = new URL(typeof req === 'string' ? req : req.url, 'https://x.test/oman-scout/'); if (ignoreSearch) u.search = ''; return u.href; };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(req, o = {}) { const r = m.get(norm(req, o.ignoreSearch)); return r ? r.clone() : undefined; },
        async put(req, res) { m.set(norm(req), res); },
        async add(req) { const res = await fetchImpl(norm(req)); if (!res.ok) throw new Error('bad'); m.set(norm(req), res); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); }
  };
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url.url || url)); if (!online) throw new Error('offline'); return new Response('net:' + String(url.url || url), { status: 200 }); };
  const listeners = {};
  const self = { location: new URL('https://x.test/oman-scout/sw.js'), addEventListener: (t, f) => { listeners[t] = f; }, clients: { claim: async () => {} }, skipWaiting() { self.skipped = true; } };
  const ctx = vm.createContext({ self, caches, fetch: fetchImpl, Response, Request, URL, setTimeout, clearTimeout, Promise, Error });
  vm.runInContext(build ? SOURCE.replaceAll('__BUILD__', build) : SOURCE, ctx);
  const run = async (type, init = {}) => {
    let p; const event = { ...init, waitUntil: x => { p = x; }, respondWith: x => { p = x; } };
    listeners[type](event);
    return { handled: !!p, value: p ? await p : undefined };
  };
  const get = (url, mode = 'cors') => ({ method: 'GET', url: new URL(url, 'https://x.test/oman-scout/').href, mode });
  return { run, stores, calls, get, self, listeners };
}

test('production worker precaches the shell and serves it offline', async () => {
  const sw = boot({ build: 'abc123' });
  await sw.run('install');
  assert.ok(sw.stores.has('shell-abc123'));
  assert.ok(sw.stores.get('shell-abc123').size > 20, 'shell files cached');
  const off = boot({ build: 'abc123', online: false });
  off.stores.set('shell-abc123', new Map([['https://x.test/oman-scout/index.html', new Response('INDEX')], ['https://x.test/oman-scout/assets/app.js', new Response('APP')]]));
  const nav = await off.run('fetch', { request: off.get('', 'navigate') });
  assert.equal(await nav.value.text(), 'INDEX');
  const js = await off.run('fetch', { request: off.get('assets/app.js?v=1') });
  assert.equal(await js.value.text(), 'APP');
});

test('data is network first and falls back to the last copy', async () => {
  const sw = boot({ build: 'abc123' });
  const first = await sw.run('fetch', { request: sw.get('data/scout.json?v=123') });
  assert.match(await first.value.text(), /^net:/);
  const off = boot({ build: 'abc123', online: false });
  off.stores.set('data-v1', new Map([['https://x.test/oman-scout/data/scout.json', new Response('CACHED')]]));
  const res = await off.run('fetch', { request: off.get('data/scout.json?v=999') });
  assert.equal(await res.value.text(), 'CACHED');
});

test('github api, other origins and non-GET requests are left alone', async () => {
  const sw = boot({ build: 'abc123' });
  assert.equal((await sw.run('fetch', { request: { method: 'GET', url: 'https://api.github.com/repos/x', mode: 'cors' } })).handled, false);
  assert.equal((await sw.run('fetch', { request: { method: 'POST', url: 'https://x.test/oman-scout/data/scout.json', mode: 'cors' } })).handled, false);
  assert.equal((await sw.run('fetch', { request: { method: 'GET', url: 'https://example.com/a.js', mode: 'cors' } })).handled, false);
  assert.equal((await sw.run('fetch', { request: { method: 'GET', url: 'https://fonts.gstatic.com/s/x.woff2', mode: 'cors' } })).handled, true);
});

test('activation removes old caches and keeps current ones', async () => {
  const sw = boot({ build: 'new1' });
  for (const n of ['shell-old', 'shell-new1', 'data-v1', 'fonts-v1', 'something-else']) sw.stores.set(n, new Map());
  await sw.run('activate');
  assert.deepEqual([...sw.stores.keys()].sort(), ['data-v1', 'fonts-v1', 'shell-new1']);
});

test('skipWaiting only on a message from the page', async () => {
  const sw = boot({ build: 'abc123' });
  await sw.run('install');
  assert.ok(!sw.self.skipped);
  sw.listeners.message({ data: 'skipWaiting' });
  assert.ok(sw.self.skipped);
});

test('the unstamped development worker caches nothing and passes requests through', async () => {
  const sw = boot({});
  await sw.run('install');
  assert.equal(sw.stores.size, 0);
  assert.equal((await sw.run('fetch', { request: sw.get('assets/app.js') })).handled, false);
});
