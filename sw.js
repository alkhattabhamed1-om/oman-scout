// Oman Scout service worker: the app shell works offline, results are fetched fresh when online.
// __BUILD__ is replaced by the commit id at deploy time. While it is still the placeholder (local
// development) nothing is cached, so edits always show up.
const VERSION = '__BUILD__';
const DEV = VERSION.charAt(0) === '_';
const SHELL = 'shell-' + VERSION;
const DATA = 'data-v1';
const FONTS = 'fonts-v1';

// PRECACHE-START (deploy replaces nothing here; keep the list in step with the files in assets/)
const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/styles.css', 'assets/boot.js', 'assets/config.js', 'assets/favicon.svg',
  'assets/app.js', 'assets/i18n.js', 'assets/i18n-v2.js',
  'assets/ui/dom.js', 'assets/ui/drawer.js', 'assets/ui/plan.js', 'assets/ui/calendar.js', 'assets/ui/dialogs.js', 'assets/ui/refresh.js',
  'assets/lib/dates.js', 'assets/lib/topics.js', 'assets/lib/rank.js', 'assets/lib/search.js', 'assets/lib/store.js', 'assets/lib/ics.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png', 'assets/icons/favicon-32.png'
];
// PRECACHE-END

self.addEventListener('install', event => {
  if (DEV) return;
  event.waitUntil(caches.open(SHELL).then(cache => Promise.allSettled(PRECACHE.map(u => cache.add(u)))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, DATA, FONTS].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function networkFirst(request, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(request), ms);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fresh = fetch(request).then(res => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'api.github.com') return;
  if (url.origin !== self.location.origin) {
    if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) event.respondWith(staleWhileRevalidate(request, FONTS));
    return;
  }
  if (DEV) return;
  if (/\/data\/[^/]+\.(json|ics)$/.test(url.pathname)) { event.respondWith(networkFirst(request, DATA, 4000)); return; }
  if (request.mode === 'navigate') {
    event.respondWith(cacheFirst(new Request(new URL('index.html', self.location).href)).catch(() => fetch(request)));
    return;
  }
  event.respondWith(cacheFirst(request));
});
