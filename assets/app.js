import { STR } from './i18n.js';

/* ============================================================
   Config and constants
   ============================================================ */
const CFG = Object.assign({ repo: '', workflow: 'scout.yml', branch: 'main', data: 'data/scout.json' }, window.SCOUT_CONFIG || {});
if (!CFG.repo && /\.github\.io$/.test(location.hostname)) {
  const owner = location.hostname.split('.')[0];
  const name = location.pathname.split('/').filter(Boolean)[0];
  if (owner && name) CFG.repo = owner + '/' + name;
}

const TZ = 'Asia/Muscat';
const REGIONS = ['oman', 'gcc', 'global'];
const CATS = ['event', 'competition', 'competitor', 'funding'];
const CAT_ICON = { event: 'calendar', competition: 'trophy', competitor: 'radar', funding: 'landmark' };
const ELIG_OPEN = new Set(['eligible', 'likely', 'na']);
const ELIG_PLUS = new Set(['eligible', 'likely', 'na', 'check']);
const ELIG_TONE = { eligible: 'green', likely: 'green', check: 'amber', na: 'grey', ineligible: 'red' };

/* ============================================================
   Tiny helpers
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5.5a1 1 0 0 0-1 1c0 2.2 1.6 3.6 3.9 3.8M16 6h2.5a1 1 0 0 1 1 1c0 2.2-1.6 3.6-3.9 3.8"/><path d="M12 13v3.5M8.5 20h7M9.5 16.5h5"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  landmark: '<path d="M3.5 9.5 12 4l8.5 5.5z"/><path d="M6 12v6M10 12v6M14 12v6M18 12v6M3.5 20.5h17"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s6.5-5.7 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.3 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.3"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20.5v-4h4v4"/>',
  plane: '<path d="M21 4 3 11l7 2.5L12.5 21z"/><path d="m10 13.5 11-9.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  calplus: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18v-2.5H3zM12 6.5V20M12 6.5c-1-3-5-3-5-.5 0 1.5 2 .5 5 .5zM12 6.5c1-3 5-3 5-.5 0 1.5-2 .5-5 .5z"/>'
};

function icon(name, extra) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico' + (extra ? ' ' + extra : ''));
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) n.style.setProperty(p, val);
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const store = {
  get(k, d = null) { try { const v = localStorage.getItem('scout.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('scout.' + k, v); } catch { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem('scout.' + k); } catch { /* storage blocked */ } },
  json(k, d) { try { const v = JSON.parse(store.get(k)); return v ?? d; } catch { return d; } }
};

function safeUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch { return null; }
}

/* ============================================================
   State
   ============================================================ */
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const state = {
  lang: store.get('lang') || ((navigator.language || '').slice(0, 2) === 'ar' ? 'ar' : 'en'),
  region: store.get('region', 'oman'),
  cats: new Set(store.json('cats', CATS)),
  elig: store.get('elig', 'plus'),
  range: store.get('range', 'all'),
  reach: store.get('reach') === '1',
  sort: store.get('sort', 'date'),
  view: store.get('view', 'list'),
  closing: false,
  showDismissed: false,
  q: '',
  month: null,
  saved: new Set(store.json('saved', [])),
  dismissed: new Set(store.json('dismissed', [])),
  open: new Set(),
  calMonth: null,
  calDay: null,
  data: null,
  today: todayStr()
};
if (!['oman', 'gcc', 'global', 'saved'].includes(state.region)) state.region = 'oman';
if (!['open', 'plus', 'all'].includes(state.elig)) state.elig = 'plus';
if (!['all', '30', '90', '180'].includes(state.range)) state.range = 'all';
if (!['date', 'deadline', 'new'].includes(state.sort)) state.sort = 'date';
if (!['list', 'cal'].includes(state.view)) state.view = 'list';
state.cats = new Set([...state.cats].filter(c => CATS.includes(c)));
if (!state.cats.size) state.cats = new Set(CATS);

const t = (k, v) => {
  let s = (STR[state.lang] && STR[state.lang][k]) ?? STR.en[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', String(b));
  return s;
};

/* ============================================================
   Dates
   ============================================================ */
const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const addDays = (s, n) => new Date(utc(s) + n * 86400000).toISOString().slice(0, 10);
const loc = () => (state.lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB');
const fmt = (s, o) => new Intl.DateTimeFormat(loc(), { timeZone: 'UTC', ...o }).format(new Date(utc(s)));
function hijri(s) {
  try {
    const l = state.lang === 'ar' ? 'ar-OM-u-ca-islamic-umalqura-nu-latn' : 'en-GB-u-ca-islamic-umalqura';
    return new Intl.DateTimeFormat(l, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(utc(s)));
  } catch { return ''; }
}
function relText(s) {
  const n = diffDays(state.today, s);
  if (n === 0) return t('date.today');
  if (n === 1) return t('date.tomorrow');
  if (n > 1 && n <= 60) return t('date.in', { n });
  if (n > 60) return t('date.months', { n: Math.round(n / 30) });
  return '';
}

/* ============================================================
   Item logic
   ============================================================ */
const lastDate = it => [it.end, it.start, it.deadline].filter(Boolean).sort().pop() || null;
const isUpcoming = it => { const l = lastDate(it); return !l || l >= state.today; };
const clampDate = d => (d && d < state.today ? state.today : d);

function anchor(it) {
  if (it.category === 'event' || it.category === 'competitor') return it.start || it.deadline || null;
  const future = [it.deadline, it.start].filter(d => d && d >= state.today).sort();
  return future[0] || it.start || it.deadline || null;
}
const isOngoing = it => !!(it.start && it.start < state.today && (it.end || it.start) >= state.today);
const isNew = it => !!(state.data && state.data.prevScanDate && it.firstSeen && it.firstSeen > state.data.prevScanDate);

function tx(it, k) {
  if (state.lang === 'ar' && it.ar && it.ar[k]) return { text: it.ar[k], lang: 'ar' };
  return { text: it[k] || '', lang: 'en' };
}

function eligOK(it) {
  if (state.elig === 'all') return true;
  return (state.elig === 'open' ? ELIG_OPEN : ELIG_PLUS).has(it.eligibility);
}
const reachable = it => it.travel !== 'far';

function haystack(it) {
  return [it.title, it.summary, it.organizer, it.location, (it.tags || []).join(' '), it.ar && it.ar.title, it.ar && it.ar.summary]
    .filter(Boolean).join(' ').toLowerCase();
}

function matches(it, skip = {}) {
  if (!isUpcoming(it)) return false;
  if (!skip.region) {
    if (state.region === 'saved') { if (!state.saved.has(it.id)) return false; }
    else if (it.region !== state.region) return false;
  }
  if (!skip.cats && !state.cats.has(it.category)) return false;
  if (!eligOK(it)) return false;
  if (!state.showDismissed && state.dismissed.has(it.id) && state.region !== 'saved') return false;
  if (state.reach && !reachable(it)) return false;
  if (state.closing && !(it.deadline && it.deadline >= state.today && diffDays(state.today, it.deadline) <= 14)) return false;
  if (state.range !== 'all') {
    const a = anchor(it);
    if (!a || clampDate(a) > addDays(state.today, Number(state.range))) return false;
  }
  if (state.month) {
    const a = clampDate(anchor(it));
    if (!a || a.slice(0, 7) !== state.month) return false;
  }
  if (state.q && !haystack(it).includes(state.q.toLowerCase())) return false;
  return true;
}
const filtered = skip => state.data.items.filter(it => matches(it, skip));

function sortItems(list) {
  const key = it => { const a = anchor(it); return a ? clampDate(a) : '9999-99-99'; };
  const arr = [...list];
  if (state.sort === 'deadline') {
    const dk = it => (it.deadline && it.deadline >= state.today ? it.deadline : '9999-99-99');
    arr.sort((p, q) => dk(p).localeCompare(dk(q)) || key(p).localeCompare(key(q)));
  } else if (state.sort === 'new') {
    arr.sort((p, q) => (q.firstSeen || '').localeCompare(p.firstSeen || '') || key(p).localeCompare(key(q)));
  } else {
    arr.sort((p, q) => key(p).localeCompare(key(q)) || (p.title || '').localeCompare(q.title || ''));
  }
  return arr;
}

/* ============================================================
   Static text and chrome
   ============================================================ */
function applyStatic() {
  const d = document.documentElement;
  d.lang = state.lang;
  d.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('title');
  $$('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(n => n.setAttribute('placeholder', t(n.dataset.i18nPh)));
  $$('[data-i18n-label]').forEach(n => n.setAttribute('aria-label', t(n.dataset.i18nLabel)));
  $('#btn-lang').textContent = t('lang.btn');
  $('#btn-lang').setAttribute('lang', state.lang === 'ar' ? 'en' : 'ar');
  const effDark = isDark();
  const th = $('#btn-theme');
  th.replaceChildren(icon(effDark ? 'sun' : 'moon'));
  const f = $('#f-close'); f.replaceChildren(icon('x'));
  const sv = $('.search .ico'); if (sv) sv.innerHTML = ICONS.search;
  const fb = $('#btn-filters'); fb.replaceChildren(icon('filter'), t('f.open'));
  buildViewSeg();
  buildSort();
  buildRail();
  renderRefreshButtons();
  const hasRepo = !!CFG.repo;
  const ls = $('#lnk-settings'), lr = $('#lnk-run');
  ls.textContent = t('foot.settings'); lr.textContent = t('foot.run');
  ls.hidden = lr.hidden = !hasRepo;
  if (hasRepo) {
    ls.href = `https://github.com/${CFG.repo}/edit/${CFG.branch}/agent/profile.md`;
    lr.href = `https://github.com/${CFG.repo}/actions/workflows/${CFG.workflow}`;
  }
}

function isDark() {
  const a = document.documentElement.getAttribute('data-theme');
  if (a) return a === 'dark';
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
}

function buildViewSeg() {
  const seg = $('#view-seg');
  seg.replaceChildren(
    ...[['list', 'list', 'view.list'], ['cal', 'grid', 'view.cal']].map(([v, ic, label]) =>
      el('button', { type: 'button', 'aria-pressed': String(state.view === v), 'data-view': v }, icon(ic), t(label)))
  );
}
function buildSort() {
  const s = $('#sort');
  s.replaceChildren(...['date', 'deadline', 'new'].map(v => el('option', { value: v, text: t('sort.' + v) })));
  s.value = state.sort;
}

function buildRail() {
  const opt = (type, name, value, labelNodes, nKey) =>
    el('label', { class: 'opt' },
      el('input', { type, name, value, 'data-k': nKey || value }),
      el('span', { class: 'cat-label' }, labelNodes),
      el('span', { class: 'n', 'data-n': nKey || value }));
  $('#f-cats').replaceChildren(...CATS.map(c => opt('checkbox', 'cat', c, [icon(CAT_ICON[c]), t('cat.' + c)])));
  $('#f-elig').replaceChildren(...['open', 'plus', 'all'].map(v => opt('radio', 'elig', v, t('f.elig.' + v), 'elig-' + v)));
  $('#f-when').replaceChildren(...['all', '30', '90', '180'].map(v => opt('radio', 'when', v, t('f.when.' + v), 'when-' + v)));
  $('#f-more').replaceChildren(
    opt('checkbox', 'closing', 'closing', t('f.closing'), 'closing'),
    opt('checkbox', 'reach', 'reach', t('f.reach'), 'reach'),
    opt('checkbox', 'dismissed', 'dismissed', t('f.dismissed', { n: 0 }), 'dismissed')
  );
  updateRail();
}

function updateRail() {
  if (!state.data) return;
  const base = filtered({ cats: true });
  CATS.forEach(c => {
    const i = $(`#f-cats input[value="${c}"]`); if (i) i.checked = state.cats.has(c);
    const n = $(`#f-cats [data-n="${c}"]`); if (n) n.textContent = base.filter(it => it.category === c).length;
  });
  $$('#f-elig input').forEach(i => { i.checked = i.value === state.elig; });
  $$('#f-when input').forEach(i => { i.checked = i.value === state.range; });
  $('#f-more input[value="closing"]').checked = state.closing;
  $('#f-more input[value="reach"]').checked = state.reach;
  const dis = $('#f-more input[value="dismissed"]');
  dis.checked = state.showDismissed;
  const nd = state.data.items.filter(it => state.dismissed.has(it.id) && isUpcoming(it)).length;
  dis.closest('.opt').querySelector('.cat-label').textContent = t('f.dismissed', { n: nd });
  dis.closest('.opt').hidden = nd === 0 && !state.showDismissed;
}

/* ============================================================
   Hero
   ============================================================ */
function drawContours() {
  const svg = $('#contours');
  svg.setAttribute('viewBox', '0 0 1440 640');
  const N = 16;
  for (let i = 0; i < N; i++) {
    const y0 = 40 + i * 38;
    let d = '';
    for (let x = 0; x <= 1440; x += 24) {
      const y = y0 + Math.sin(x * 0.0042 + i * 0.42) * 26 + Math.sin(x * 0.011 + i * 0.9) * 9 + Math.cos(x * 0.0019 - i * 0.3) * 18;
      d += (x === 0 ? 'M' : 'L') + x + ' ' + y.toFixed(1) + ' ';
    }
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('opacity', (0.05 + 0.14 * (1 - i / N)).toFixed(3));
    svg.append(p);
  }
}

function renderHero() {
  const data = state.data;
  const live = data.items.filter(isUpcoming);
  const mine = live.filter(it => it.eligibility !== 'ineligible' && !state.dismissed.has(it.id));
  const closing = mine.filter(it => it.deadline && it.deadline >= state.today && diffDays(state.today, it.deadline) <= 14);
  const fresh = data.prevScanDate ? mine.filter(isNew) : [];
  const excluded = live.filter(it => it.eligibility === 'ineligible');

  const stat = (n, label, opts = {}) => {
    const tag = opts.onclick ? 'button' : 'div';
    return el(tag, { class: 'stat' + (opts.hot ? ' hot' : ''), type: opts.onclick ? 'button' : null, onclick: opts.onclick }, el('b', { text: String(n) }), el('span', { text: label }));
  };
  const stats = [
    stat(mine.length, t('stat.upcoming')),
    stat(closing.length, t('stat.closing'), { hot: closing.length > 0, onclick: () => { state.closing = !state.closing; persist(); renderAll(); jumpToResults(); } }),
    data.prevScanDate ? stat(fresh.length, t('stat.new'), { onclick: () => { state.sort = 'new'; $('#sort').value = 'new'; persist(); renderAll(); jumpToResults(); } }) : null,
    stat(excluded.length, t('stat.excluded'), { onclick: () => { state.elig = 'all'; persist(); renderAll(); jumpToResults(); } })
  ];
  $('#stats').replaceChildren(...stats.filter(Boolean));

  // updated line
  const gen = data.generatedAt ? new Date(data.generatedAt) : null;
  if (gen && !isNaN(gen)) {
    const abs = new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(gen);
    const mins = Math.min(0, Math.round((gen - Date.now()) / 60000));
    const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
    const rel = Math.abs(mins) < 90 ? rtf.format(mins, 'minute') : Math.abs(mins) < 2880 ? rtf.format(Math.round(mins / 60), 'hour') : rtf.format(Math.round(mins / 1440), 'day');
    $('#hero-updated').textContent = t('hero.updated', { when: `${abs} · ${rel}` });
  } else $('#hero-updated').textContent = '';
  const pl = data.profileLabel || {};
  const label = pl[state.lang] || pl.en || '';
  $('#hero-profile').textContent = label ? t('hero.filtered', { label }) : '';

  renderNext(mine);
  renderMonths(mine);
}

function renderNext(mine) {
  const box = $('#next');
  const list = mine
    .filter(it => anchor(it) && lastDate(it) >= state.today && it.travel !== 'far' && it.eligibility !== 'na')
    .sort((a, b) => clampDate(anchor(a)).localeCompare(clampDate(anchor(b))))
    .slice(0, 4);
  box.replaceChildren(el('h2', { id: 'next-h', text: t('next.title') }));
  if (!list.length) { box.append(el('p', { class: 'next-meta', text: t('next.none') })); return; }
  const first = clampDate(anchor(list[0]));
  const n = diffDays(state.today, first);
  box.append(el('div', { class: 'next-lead' },
    el('b', { text: n === 0 ? '0' : String(n) }),
    el('span', { text: n === 0 ? t('next.today') : t('next.days') })));
  box.append(el('div', { class: 'next-list' }, list.map(it => {
    const a = clampDate(anchor(it));
    const title = tx(it, 'title');
    return el('button', { class: 'next-item', type: 'button', onclick: () => goToItem(it.id) },
      el('span', { class: 'next-date' }, el('b', { text: fmt(a, { day: 'numeric' }) }), fmt(a, { month: 'short' })),
      el('span', {},
        el('span', { class: 'next-title', lang: title.lang, dir: 'auto', text: title.text }),
        el('span', { class: 'next-meta' }, el('span', { class: 'dot ' + it.region }), t('region.' + it.region), ' · ', t('catS.' + it.category))));
  })));
}

function renderMonths(mine) {
  const box = $('#months');
  const keys = [];
  const [cy, cm] = state.today.split('-').map(Number);
  for (let i = 0; i < 6; i++) { const d = new Date(Date.UTC(cy, cm - 1 + i, 1)); keys.push(d.toISOString().slice(0, 7)); }
  const counts = Object.fromEntries(keys.map(k => [k, { oman: 0, gcc: 0, global: 0 }]));
  mine.forEach(it => {
    const a = clampDate(anchor(it));
    if (!a) return;
    const k = a.slice(0, 7);
    if (counts[k] && counts[k][it.region] != null) counts[k][it.region]++;
  });
  const max = Math.max(1, ...keys.map(k => counts[k].oman + counts[k].gcc + counts[k].global));
  const unit = 78 / max;
  box.replaceChildren(
    el('h2', { id: 'months-h', text: t('months.title') }),
    el('div', { class: 'bars' }, keys.map(k => {
      const c = counts[k];
      const total = c.oman + c.gcc + c.global;
      const segs = REGIONS.filter(r => c[r] > 0).map(r => el('span', { class: 'bar-seg ' + r, style: { height: Math.max(4, c[r] * unit) + 'px' } }));
      return el('button', { class: 'bar', type: 'button', 'aria-pressed': String(state.month === k), onclick: () => { state.month = state.month === k ? null : k; renderAll(); jumpToResults(); } },
        el('span', { class: 'bar-n', text: String(total) }),
        el('span', { class: 'bar-stack' }, segs.length ? segs : el('span', { class: 'bar-seg none' })),
        el('span', { class: 'bar-m', text: fmt(k + '-01', { month: 'short' }) }));
    })),
    el('div', { class: 'legend' }, REGIONS.map(r => el('span', {}, el('span', { class: 'dot ' + r }), t('region.' + r))))
  );
}

/* ============================================================
   Tabs, toolbar, chips
   ============================================================ */
function renderTabs() {
  const base = filtered({ region: true });
  const n = { oman: 0, gcc: 0, global: 0, saved: 0 };
  base.forEach(it => { n[it.region]++; });
  n.saved = state.data.items.filter(it => state.saved.has(it.id) && isUpcoming(it)).length;
  const tab = (id, label, dotCls) => el('button', {
    class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(state.region === id), 'data-region': id,
    onclick: () => { state.region = id; state.calDay = null; persist(); renderAll(); }
  }, dotCls ? el('span', { class: 'dot ' + dotCls }) : icon('bookmark'), label, el('span', { class: 'n', text: String(n[id]) }));
  $('#tabs').replaceChildren(
    tab('oman', t('region.oman'), 'oman'), tab('gcc', t('region.gcc'), 'gcc'), tab('global', t('region.global'), 'global'), tab('saved', t('region.saved'), null)
  );
}

function renderChips(count) {
  const chips = [];
  if (state.month) chips.push(el('button', { class: 'chip', type: 'button', onclick: () => { state.month = null; renderAll(); } }, t('chip.month', { m: fmt(state.month + '-01', { month: 'long', year: 'numeric' }) }), icon('x')));
  if (state.closing) chips.push(el('button', { class: 'chip', type: 'button', onclick: () => { state.closing = false; persist(); renderAll(); } }, t('chip.closing'), icon('x')));
  if (state.q) chips.push(el('button', { class: 'chip', type: 'button', onclick: () => { state.q = ''; $('#q').value = ''; renderAll(); } }, t('chip.search', { q: state.q }), icon('x')));
  $('#active-chips').replaceChildren(...chips);
  $('#count').textContent = count === 1 ? t('count1') : t('count', { n: count });
  $('#f-apply').textContent = t('f.apply', { n: count });
}

/* ============================================================
   Cards
   ============================================================ */
function stampEl(it) {
  const a = anchor(it);
  const apply = (it.category === 'competition' || it.category === 'funding') && it.deadline && a === it.deadline && it.deadline >= state.today;
  const box = el('div', { class: 'stamp' });
  if (!a) {
    box.append(el('span', { class: 'kick', text: t('stamp.tba') }), el('span', { class: 'big txt', text: shortNote(it) }));
    return box;
  }
  if (it.approx && !apply) {
    box.append(el('span', { class: 'kick', text: t('stamp.approx') }),
      el('span', { class: 'big txt', text: fmt(a, { month: 'short' }) }),
      el('span', { class: 'yr', text: fmt(a, { year: 'numeric' }) }));
    return box;
  }
  const multi = !apply && it.start && it.end && it.end !== it.start;
  const sameMonth = multi && it.start.slice(0, 7) === it.end.slice(0, 7);
  const kick = apply ? t('stamp.apply') : fmt(a, { weekday: 'short' });
  let big, mon;
  if (multi && sameMonth) { big = fmt(it.start, { day: 'numeric' }) + '–' + fmt(it.end, { day: 'numeric' }); mon = fmt(it.start, { month: 'short' }); }
  else if (multi) { big = fmt(it.start, { day: 'numeric' }) + '–' + fmt(it.end, { day: 'numeric' }); mon = fmt(it.start, { month: 'short' }) + '–' + fmt(it.end, { month: 'short' }); }
  else { big = fmt(a, { day: 'numeric' }); mon = fmt(a, { month: 'short' }); }
  const curYear = state.today.slice(0, 4);
  box.append(el('span', { class: 'kick', text: kick }), el('span', { class: 'big' + (multi ? ' range' : ''), text: big }), el('span', { class: 'mon', text: mon }));
  if (a.slice(0, 4) !== curYear) box.append(el('span', { class: 'yr', text: a.slice(0, 4) }));
  const rel = isOngoing(it) ? t('date.ongoing') : relText(a);
  if (rel) box.append(el('span', { class: 'rel', text: rel }));
  return box;
}
function shortNote(it) {
  const n = (it.dateNote || '').trim();
  if (!n) return t('stamp.tba');
  return n.length > 22 ? n.slice(0, 20).trimEnd() + '…' : n;
}

function deadlineEl(it) {
  if (!it.deadline) return null;
  const n = diffDays(state.today, it.deadline);
  if (n < 0) return el('span', { class: 'deadline closed' }, icon('calendar'), t('deadline.closed'));
  const tone = n <= 7 ? 'urgent' : n <= 14 ? 'soon' : '';
  const left = n === 0 ? t('deadline.today') : t('deadline.left', { n });
  return el('span', { class: 'deadline ' + tone }, icon('clock'), t('deadline.by', { d: fmt(it.deadline, { day: 'numeric', month: 'short' }) }), ' · ', left);
}

function badge(cls, ...kids) { return el('span', { class: 'badge ' + (cls || '') }, ...kids); }

function card(it) {
  const open = state.open.has(it.id);
  const dismissed = state.dismissed.has(it.id);
  const saved = state.saved.has(it.id);
  const title = tx(it, 'title');
  const sum = tx(it, 'summary');

  const badges = [
    badge('', icon(CAT_ICON[it.category] || 'calendar'), t('catS.' + it.category)),
    state.region === 'saved' ? badge('', el('span', { class: 'dot ' + it.region }), t('region.' + it.region)) : null,
    isNew(it) ? badge('new', t('card.new')) : null,
    badge(ELIG_TONE[it.eligibility] || 'grey', t('elig.' + it.eligibility)),
    it.travel === 'gcc' ? badge('', icon('plane'), t('travel.gcc')) : null,
    it.travel === 'far' ? badge('red', icon('plane'), t('travel.far')) : null,
    it.travel === 'online' ? badge('blue', t('travel.online')) : null,
    it.confidence === 'unverified' ? badge('amber', t('conf.unverified')) : null,
    dismissed ? badge('grey', t('card.dismissed')) : null
  ];

  const meta = [
    it.location ? el('li', {}, icon('pin'), it.location) : null,
    it.mode && !(it.location || '').toLowerCase().includes('online') ? el('li', {}, t('mode.' + it.mode)) : null,
    it.cost ? el('li', {}, icon('tag'), it.cost) : null,
    it.prize ? el('li', {}, icon('gift'), it.prize) : null,
    it.organizer ? el('li', {}, icon('building'), it.organizer) : null
  ].filter(Boolean);

  const src = (it.sources || []).map(s => ({ ...s, href: safeUrl(s.url) })).filter(s => s.href);
  const hasDate = !!(it.start || it.deadline);

  const actions = el('div', { class: 'actions' },
    src[0] ? el('a', { class: 'act', href: src[0].href, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), t('card.source')) : null,
    hasDate ? el('button', { class: 'act', type: 'button', 'data-act': 'ics' }, icon('calplus'), t('card.cal')) : null,
    el('button', { class: 'act', type: 'button', 'data-act': 'toggle', 'aria-expanded': String(open) }, t('card.details'), icon('chev', 'chev')),
    el('button', { class: 'act end', type: 'button', 'data-act': 'save', 'aria-pressed': String(saved) }, icon('bookmark'), saved ? t('card.saved') : t('card.save')),
    el('button', { class: 'act quiet', type: 'button', 'data-act': 'dismiss' }, dismissed ? t('card.restore') : t('card.dismiss'))
  );

  const body = el('div', { class: 'card-body' },
    el('div', { class: 'badges' }, badges),
    el('h3', { lang: title.lang, dir: 'auto', text: title.text }),
    sum.text ? el('p', { class: 'sum', lang: sum.lang, dir: 'auto', text: sum.text }) : null,
    meta.length ? el('ul', { class: 'meta' }, meta) : null,
    deadlineEl(it),
    actions,
    open ? detailsEl(it, src) : null
  );

  return el('article', { class: 'card' + (dismissed ? ' is-dismissed' : ''), 'data-id': it.id, 'data-cat': it.category }, stampEl(it), body);
}

function detailsEl(it, src) {
  const why = tx(it, 'why');
  const note = tx(it, 'eligibilityNote');
  const dates = [];
  if (it.start) dates.push([t('card.start'), fmt(it.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]);
  if (it.end && it.end !== it.start) dates.push([t('card.end'), fmt(it.end, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]);
  if (it.deadline) dates.push([t('card.deadline'), fmt(it.deadline, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]);
  const hj = it.start || it.deadline ? hijri(it.start || it.deadline) : '';
  const conf = it.confidence || 'unverified';
  const parts = [];
  if (why.text) parts.push(el('div', {}, el('dt', { text: t('card.why') }), el('dd', { lang: why.lang, dir: 'auto', text: why.text })));
  if (note.text || it.eligibility) {
    parts.push(el('div', {}, el('dt', { text: t('card.elig') }),
      el('dd', { lang: note.lang, dir: 'auto' }, el('strong', { text: t('elig.' + it.eligibility) }), note.text ? ' · ' + note.text : '')));
  }
  if (dates.length || it.dateNote || hj) {
    parts.push(el('div', {}, el('dt', { text: t('card.dates') }),
      el('div', { class: 'det-grid' },
        dates.map(([k, v]) => el('dd', {}, el('small', { text: k + ': ' }), v)),
        it.dateNote ? el('dd', { text: it.dateNote }) : null,
        hj ? el('dd', {}, el('small', { text: t('card.hijri') + ': ' }), hj) : null)));
  }
  if (src.length) {
    parts.push(el('div', {}, el('dt', { text: t('card.sources') }),
      el('dd', { class: 'srcs' }, src.map(s => el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), s.label || new URL(s.href).hostname)))));
  }
  parts.push(el('div', {}, el('dt', { text: t('card.confidence') }),
    el('dd', {}, el('span', { class: 'conf ' + conf }, el('i'), el('strong', { text: t('conf.' + conf) }), ' · ' + t('conf.' + conf + '.d')))));
  return el('div', { class: 'details' }, el('dl', {}, parts));
}

/* ============================================================
   Results (list + calendar)
   ============================================================ */
function monthKey(it) { const a = clampDate(anchor(it)); return a ? a.slice(0, 7) : 'none'; }

function renderResults() {
  const box = $('#results');
  const items = sortItems(filtered());
  renderChips(items.length);
  box.replaceChildren();
  if (state.view === 'cal') { renderCalendar(box, items); return; }
  if (!items.length) { box.append(emptyEl()); return; }
  const groups = new Map();
  items.forEach(it => { const k = monthKey(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  const keys = [...groups.keys()].sort((a, b) => (a === 'none') - (b === 'none') || a.localeCompare(b));
  if (state.sort === 'new' || state.sort === 'deadline') {
    box.append(el('section', { class: 'group' }, el('div', { class: 'cards' }, items.map(card))));
    return;
  }
  keys.forEach(k => {
    const label = k === 'none' ? t('group.nodate') : fmt(k + '-01', { month: 'long', year: 'numeric' });
    box.append(el('section', { class: 'group', 'aria-label': label },
      el('h2', { class: 'group-h' }, label, el('span', { class: 'n', text: String(groups.get(k).length) })),
      el('div', { class: 'cards' }, groups.get(k).map(card))));
  });
}

function emptyEl() {
  if (state.region === 'saved') return el('div', { class: 'empty' }, icon('bookmark'), el('p', { text: t('saved.empty') }));
  return el('div', { class: 'empty' },
    el('h3', { text: t('empty.title') }),
    el('p', { text: t('empty.body') }),
    el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: resetFilters, text: t('empty.reset') }));
}

function renderCalendar(box, items) {
  const [cy, cm] = (state.calMonth || state.today.slice(0, 7)).split('-').map(Number);
  const key = `${cy}-${String(cm).padStart(2, '0')}`;
  state.calMonth = key;
  const first = new Date(Date.UTC(cy, cm - 1, 1));
  const dim = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday
  const rows = Math.ceil((lead + dim) / 7);

  // map day -> markers
  const map = new Map();
  const put = (d, it, type) => { if (!map.has(d)) map.set(d, []); map.get(d).push({ it, type }); };
  items.forEach(it => {
    if (it.start) {
      const end = it.end && it.end >= it.start ? it.end : it.start;
      const span = Math.min(diffDays(it.start, end), 45);
      for (let i = 0; i <= span; i++) put(addDays(it.start, i), it, 'range');
    }
    if (it.deadline) put(it.deadline, it, 'dl');
  });

  const dows = [];
  const sunday = new Date(Date.UTC(2024, 0, 7)); // a Sunday
  for (let i = 0; i < 7; i++) dows.push(new Intl.DateTimeFormat(loc(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(sunday.getTime() + i * 86400000)));

  const cells = [];
  for (let i = 0; i < rows * 7; i++) {
    const dayNum = i - lead + 1;
    const date = new Date(Date.UTC(cy, cm - 1, dayNum)).toISOString().slice(0, 10);
    const inMonth = dayNum >= 1 && dayNum <= dim;
    const dow = i % 7; // 5 = Friday, 6 = Saturday
    const marks = map.get(date) || [];
    const dots = [];
    const seen = new Set();
    marks.forEach(m => { const k = m.it.region + m.type; if (!seen.has(k) && dots.length < 6) { seen.add(k); dots.push(el('i', { class: m.it.region + (m.type === 'dl' ? ' dl' : '') })); } });
    cells.push(el('button', {
      class: 'cal-cell' + (inMonth ? '' : ' out') + (dow >= 5 ? ' wk' : '') + (date === state.today ? ' today' : ''),
      type: 'button', 'aria-pressed': String(state.calDay === date), 'data-date': date,
      'aria-label': fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }) + (marks.length ? ' · ' + marks.length : ''),
      onclick: () => { state.calDay = state.calDay === date ? null : date; renderResults(); }
    }, el('span', { class: 'cal-n', text: fmt(date, { day: 'numeric' }) }), el('span', { class: 'cal-dots' }, dots)));
  }

  const nav = (dir) => { const d = new Date(Date.UTC(cy, cm - 1 + dir, 1)); state.calMonth = d.toISOString().slice(0, 7); state.calDay = null; renderResults(); };
  const cal = el('section', { class: 'cal', 'aria-label': fmt(key + '-01', { month: 'long', year: 'numeric' }) },
    el('div', { class: 'cal-head' },
      el('h2', { text: fmt(key + '-01', { month: 'long', year: 'numeric' }) }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cal.prev'), onclick: () => nav(-1) }, icon('left', 'flip')),
      el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => { state.calMonth = state.today.slice(0, 7); state.calDay = state.today; renderResults(); }, text: t('cal.today') }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cal.next'), onclick: () => nav(1) }, icon('right', 'flip'))),
    el('div', { class: 'cal-grid' }, dows.map((d, i) => el('div', { class: 'cal-dow' + (i >= 5 ? ' wk' : ''), text: d })), cells),
    el('div', { class: 'cal-legend' },
      el('span', {}, el('i'), t('cal.legend.range')), el('span', {}, el('i', { class: 'dl' }), t('cal.legend.deadline')),
      REGIONS.map(r => el('span', {}, el('span', { class: 'dot ' + r }), t('region.' + r)))));
  box.append(cal);

  // list under the calendar
  let list;
  if (state.calDay) {
    const seen = new Set();
    list = (map.get(state.calDay) || []).map(m => m.it).filter(it => (seen.has(it.id) ? false : seen.add(it.id)));
    box.append(el('h2', { class: 'group-h' }, fmt(state.calDay, { weekday: 'long', day: 'numeric', month: 'long' }), el('span', { class: 'n', text: String(list.length) })));
    box.append(list.length ? el('div', { class: 'cards' }, list.map(card)) : el('p', { class: 'sum', text: t('cal.none') }));
  } else {
    const inMonth = sortItems(items.filter(it => monthKey(it) === key));
    box.append(el('h2', { class: 'group-h' }, t('cal.hint'), el('span', { class: 'n', text: String(inMonth.length) })));
    if (inMonth.length) box.append(el('div', { class: 'cards' }, inMonth.map(card)));
  }
}

/* ============================================================
   Footer
   ============================================================ */
function renderFooter() {
  const tasks = state.data.tasks || {};
  const st = $('#foot-status');
  st.replaceChildren(el('h2', { text: t('foot.status') }), el('ul', {}, Object.entries(tasks).map(([id, info]) => {
    const stale = info.status !== 'ok';
    const when = info.updatedAt ? fmt(info.updatedAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return el('li', { class: 'st' + (stale ? ' stale' : '') }, el('i'), el('span', {}, t('task.' + id) === 'task.' + id ? id : t('task.' + id), ' ', el('small', { text: `${stale ? t('foot.status.stale') : t('foot.status.ok')} · ${when}` })));
  })));
  const gaps = state.data.gaps || [];
  const gp = $('#foot-gaps');
  gp.replaceChildren(el('h2', { text: t('foot.gaps') }), gaps.length ? el('ul', {}, gaps.slice(0, 8).map(g => el('li', { text: g }))) : el('p', { text: t('foot.gaps.none') }));
}

/* ============================================================
   Actions: save, dismiss, details, calendar file
   ============================================================ */
function persist() {
  store.set('region', state.region);
  store.set('cats', JSON.stringify([...state.cats]));
  store.set('elig', state.elig);
  store.set('range', state.range);
  store.set('reach', state.reach ? '1' : '0');
  store.set('sort', state.sort);
  store.set('view', state.view);
  store.set('saved', JSON.stringify([...state.saved]));
  store.set('dismissed', JSON.stringify([...state.dismissed]));
}

function resetFilters() {
  state.cats = new Set(CATS); state.elig = 'plus'; state.range = 'all'; state.reach = false; state.closing = false;
  state.showDismissed = false; state.q = ''; state.month = null; state.sort = 'date';
  $('#q').value = ''; $('#sort').value = 'date';
  persist(); renderAll();
}

function refreshCard(id, focusAct) {
  const old = $(`.card[data-id="${CSS.escape(id)}"]`);
  const it = state.data.items.find(x => x.id === id);
  if (!old || !it) { renderAll(); return; }
  const fresh = card(it);
  old.replaceWith(fresh);
  if (focusAct) { const b = fresh.querySelector(`[data-act="${focusAct}"]`); if (b) b.focus(); }
}

function onResultsClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const cardEl = btn.closest('.card');
  const id = cardEl && cardEl.dataset.id;
  const it = state.data.items.find(x => x.id === id);
  if (!it) return;
  const act = btn.dataset.act;
  if (act === 'toggle') {
    if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
    refreshCard(id, 'toggle');
  } else if (act === 'save') {
    if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
    persist(); renderTabs();
    if (state.region === 'saved') renderResults(); else refreshCard(id, 'save');
  } else if (act === 'dismiss') {
    if (state.dismissed.has(id)) state.dismissed.delete(id); else state.dismissed.add(id);
    persist(); renderAll();
  } else if (act === 'ics') {
    downloadIcs([it]);
  }
}

function foldIcs(line) {
  const out = [];
  let s = line;
  while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); }
  out.push(s);
  return out.join('\r\n');
}
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function downloadIcs(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Oman Scout//EN', 'CALSCALE:GREGORIAN'];
  items.forEach(it => {
    const title = it.title;
    const src = (it.sources || []).map(s => safeUrl(s.url)).filter(Boolean)[0] || '';
    const desc = [it.summary, it.eligibilityNote ? 'Eligibility: ' + it.eligibilityNote : '', src].filter(Boolean).join('\n');
    const ev = (uid, summary, from, to) => {
      lines.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + from.replaceAll('-', ''), 'DTEND;VALUE=DATE:' + to.replaceAll('-', ''),
        foldIcs('SUMMARY:' + icsEsc(summary)));
      if (it.location) lines.push(foldIcs('LOCATION:' + icsEsc(it.location)));
      if (desc) lines.push(foldIcs('DESCRIPTION:' + icsEsc(desc)));
      if (src) lines.push(foldIcs('URL:' + src));
      lines.push('END:VEVENT');
    };
    if (it.start) ev(it.id + '-start@oman-scout', title, it.start, addDays(it.end && it.end >= it.start ? it.end : it.start, 1));
    if (it.deadline) ev(it.id + '-deadline@oman-scout', 'Deadline: ' + title, it.deadline, addDays(it.deadline, 1));
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: (items.length === 1 ? items[0].id : 'oman-scout') + '.ics' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('toast.ics'));
}

function goToItem(id) {
  const it = state.data.items.find(x => x.id === id);
  if (!it) return;
  state.region = it.region; state.view = 'list'; state.q = ''; state.month = null; state.range = 'all'; state.closing = false; state.reach = false;
  state.cats = new Set(CATS);
  if (!eligOK(it)) state.elig = 'all';
  $('#q').value = '';
  persist(); renderAll();
  requestAnimationFrame(() => {
    const c = $(`.card[data-id="${CSS.escape(id)}"]`);
    if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); }
  });
}

function jumpToResults() { const tabs = $('#stickybar'); if (tabs) window.scrollTo({ top: Math.max(0, tabs.offsetTop - 4), behavior: 'smooth' }); }

/* ============================================================
   Toast
   ============================================================ */
let toastTimer;
function toast(msg) {
  const n = $('#toast');
  n.textContent = msg; n.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { n.hidden = true; }, 2800);
}

/* ============================================================
   Rendering orchestration
   ============================================================ */
function renderAll() {
  if (!state.data) return;
  renderHero();
  renderTabs();
  updateRail();
  buildViewSeg();
  renderResults();
  renderFooter();
}

function renderSkeleton() {
  $('#results').replaceChildren(el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }));
}

/* ============================================================
   Data loading
   ============================================================ */
async function loadData(bust) {
  const res = await fetch(CFG.data + (bust ? '?v=' + Date.now() : ''), { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return normalize(await res.json());
}

function normalize(j) {
  if (!j || !Array.isArray(j.items)) throw new Error('bad data');
  j.items = j.items.filter(it => it && it.id && it.title && REGIONS.includes(it.region)).map(it => ({
    ...it,
    category: CATS.includes(it.category) ? it.category : 'event',
    eligibility: ['eligible', 'likely', 'check', 'ineligible', 'na'].includes(it.eligibility) ? it.eligibility : 'check',
    confidence: ['confirmed', 'likely', 'unverified'].includes(it.confidence) ? it.confidence : 'unverified',
    sources: Array.isArray(it.sources) ? it.sources : [],
    tags: Array.isArray(it.tags) ? it.tags : []
  }));
  return j;
}

/* ============================================================
   Refresh (GitHub Actions)
   ============================================================ */
const GH = 'https://api.github.com';
const rf = { phase: 'idle', runId: null, runUrl: null, startedAt: 0, jobs: [], status: null, conclusion: null, error: null, timer: null, tick: null, prevGen: null };

async function gh(path, opts = {}) {
  const token = store.get('token');
  return fetch(GH + path, {
    ...opts, credentials: 'omit', cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) }
  });
}
const busy = () => ['starting', 'queued', 'running'].includes(rf.phase);

function renderRefreshButtons() {
  [$('#btn-refresh'), $('#btn-refresh2')].forEach(b => {
    if (!b) return;
    b.classList.toggle('is-busy', busy());
    b.replaceChildren(icon('refresh'), el('span', { text: busy() ? t('refresh.busy') : t('refresh') }));
    b.setAttribute('aria-label', busy() ? t('refresh.busy') : t('refresh'));
  });
}

function fmtElapsed(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function openRefresh() {
  const dlg = $('#dlg');
  renderDialog();
  if (!dlg.open) dlg.showModal();
}

function stepEl(state_, label, small) {
  return el('li', { class: 'step ' + state_ }, el('span', { class: 'mark' }, state_ === 'ok' ? icon('check') : null), el('span', { text: label }), el('small', { text: small || '' }));
}

function renderDialog() {
  const dlg = $('#dlg');
  const hasToken = !!store.get('token');
  const wfUrl = CFG.repo ? `https://github.com/${CFG.repo}/actions/workflows/${CFG.workflow}` : null;
  const parts = [el('div', { class: 'dlg-top' }, el('h2', { id: 'dlg-title', text: t('rf.title') }), el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('rf.close'), onclick: () => dlg.close() }, icon('x')))];

  if (!CFG.repo) {
    parts.push(el('p', { class: 'note', text: t('rf.norepo') }));
  } else if (busy() || rf.phase === 'done' || rf.phase === 'failed') {
    parts.push(el('p', { text: t('rf.intro') }));
    const steps = [];
    const scanJobs = rf.jobs.filter(j => /^scan/i.test(j.name));
    const otherJobs = rf.jobs.filter(j => !/^scan/i.test(j.name));
    const js = j => (j.status === 'completed' ? (j.conclusion === 'success' ? 'ok' : 'bad') : j.status === 'in_progress' ? 'run' : '');
    if (!scanJobs.length) steps.push(stepEl(rf.phase === 'failed' ? 'bad' : 'run', t('rf.step.queue')));
    scanJobs.forEach(j => {
      const id = (j.name.match(/\(([^)]+)\)/) || [])[1] || j.name;
      const label = t('task.' + id) === 'task.' + id ? id : t('task.' + id);
      steps.push(stepEl(js(j), label, j.status === 'queued' ? '…' : ''));
    });
    if (scanJobs.length) {
      const pubState = otherJobs.length ? (otherJobs.every(j => j.status === 'completed' && j.conclusion === 'success') ? 'ok' : otherJobs.some(j => j.status === 'in_progress') ? 'run' : otherJobs.some(j => j.conclusion === 'failure') ? 'bad' : '') : '';
      steps.push(stepEl(pubState, t('rf.step.publish')));
    }
    parts.push(el('ol', { class: 'steps' }, steps));
    if (rf.phase === 'running' || rf.phase === 'queued' || rf.phase === 'starting') parts.push(el('p', { class: 'note', id: 'rf-elapsed', text: t('rf.elapsed', { t: fmtElapsed(Date.now() - rf.startedAt) }) }));
    if (rf.phase === 'done') parts.push(el('p', { class: 'note good', text: t('rf.done') }));
    if (rf.phase === 'failed') parts.push(el('p', { class: 'note bad', text: t('rf.fail') + ' ' + t('rf.fail.hint') }));
    if (rf.runUrl) parts.push(el('div', { class: 'dlg-actions' }, el('a', { class: 'btn btn-soft btn-sm', href: rf.runUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), t('rf.openlog'))));
  } else {
    parts.push(el('p', { text: t('rf.intro') }));
    if (rf.error) parts.push(el('p', { class: 'note bad', text: rf.error }));
    if (hasToken) {
      parts.push(el('div', { class: 'dlg-actions' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: startScan }, icon('refresh'), t('rf.start')),
        el('button', { class: 'link-btn', type: 'button', onclick: () => { store.del('token'); toast(t('toast.tokenoff')); renderDialog(); }, text: t('rf.token.remove') })));
    } else {
      parts.push(tokenForm());
    }
    parts.push(el('p', {}, t('rf.alt') + ' ', wfUrl ? el('a', { href: wfUrl, target: '_blank', rel: 'noopener noreferrer', text: t('rf.alt.link') }) : null));
  }
  dlg.replaceChildren(el('div', { class: 'dlg' }, parts));
  dlg.setAttribute('aria-labelledby', 'dlg-title');
}

function tokenForm() {
  const input = el('input', { id: 'tok', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
  const create = 'https://github.com/settings/personal-access-tokens/new?name=' + encodeURIComponent('Oman Scout refresh') +
    '&description=' + encodeURIComponent('Starts the Oman Scout scan from my site') + '&actions=write&metadata=read';
  return el('div', { class: 'dlg', style: { padding: '0' } },
    el('h3', { text: t('rf.token.title'), style: { font: '600 1rem/1.3 var(--f-display)' } }),
    el('p', { text: t('rf.token.body') }),
    el('div', { class: 'field' }, el('label', { for: 'tok', text: t('rf.token.label') }), input),
    el('div', { class: 'dlg-actions' },
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => {
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        store.set('token', v); toast(t('toast.token')); renderDialog();
      }, text: t('rf.token.save') }),
      el('a', { class: 'btn btn-soft btn-sm', href: create, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), t('rf.token.create'))));
}

async function startScan() {
  rf.error = null; rf.runId = null; rf.runUrl = null; rf.jobs = []; rf.status = null; rf.conclusion = null;
  rf.phase = 'starting'; rf.startedAt = Date.now(); rf.prevGen = state.data && state.data.generatedAt;
  renderDialog(); renderRefreshButtons();
  try {
    const res = await gh(`/repos/${CFG.repo}/actions/workflows/${CFG.workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: CFG.branch }) });
    if (res.status === 204) { rf.phase = 'queued'; startTicker(); poll(); return; }
    rf.phase = 'idle';
    rf.error = res.status === 401 || res.status === 403 ? t('rf.err.auth') : res.status === 404 ? t('rf.err.404') : t('rf.err.other', { s: res.status });
  } catch { rf.phase = 'idle'; rf.error = t('rf.err.net'); }
  renderDialog(); renderRefreshButtons();
}

function startTicker() {
  clearInterval(rf.tick);
  rf.tick = setInterval(() => {
    const n = $('#rf-elapsed');
    if (n) n.textContent = t('rf.elapsed', { t: fmtElapsed(Date.now() - rf.startedAt) });
    if (!busy()) clearInterval(rf.tick);
  }, 1000);
}

async function poll() {
  clearTimeout(rf.timer);
  if (Date.now() - rf.startedAt > 75 * 60000) { rf.phase = 'failed'; renderDialog(); renderRefreshButtons(); return; }
  try {
    if (!rf.runId) {
      const r = await gh(`/repos/${CFG.repo}/actions/workflows/${CFG.workflow}/runs?event=workflow_dispatch&per_page=5`);
      if (r.ok) {
        const j = await r.json();
        const run = (j.workflow_runs || []).find(x => Date.parse(x.created_at) >= rf.startedAt - 90000);
        if (run) { rf.runId = run.id; rf.runUrl = run.html_url; }
      }
    }
    if (rf.runId) {
      const [rr, jr] = await Promise.all([gh(`/repos/${CFG.repo}/actions/runs/${rf.runId}`), gh(`/repos/${CFG.repo}/actions/runs/${rf.runId}/jobs?per_page=30`)]);
      if (rr.ok) { const run = await rr.json(); rf.status = run.status; rf.conclusion = run.conclusion; rf.runUrl = run.html_url; }
      if (jr.ok) rf.jobs = (await jr.json()).jobs || [];
      if (rf.status === 'completed') { await finishScan(rf.conclusion === 'success'); return; }
      rf.phase = rf.status === 'in_progress' ? 'running' : 'queued';
    }
  } catch { /* try again on the next tick */ }
  if ($('#dlg').open) renderDialog();
  renderRefreshButtons();
  rf.timer = setTimeout(poll, 8000);
}

async function finishScan(ok) {
  clearInterval(rf.tick);
  if (!ok) { rf.phase = 'failed'; if ($('#dlg').open) renderDialog(); renderRefreshButtons(); return; }
  rf.phase = 'done';
  if ($('#dlg').open) renderDialog();
  renderRefreshButtons();
  for (let i = 0; i < 24; i++) {
    try {
      const d = await loadData(true);
      if (!rf.prevGen || d.generatedAt !== rf.prevGen) { state.data = d; cacheData(d); renderAll(); toast(t('toast.updated')); return; }
    } catch { /* keep trying while the site redeploys */ }
    await new Promise(r => setTimeout(r, 6000));
  }
}

async function adoptRunningScan() {
  if (!CFG.repo) return;
  try {
    const r = await gh(`/repos/${CFG.repo}/actions/workflows/${CFG.workflow}/runs?per_page=1`);
    if (!r.ok) return;
    const run = ((await r.json()).workflow_runs || [])[0];
    if (run && run.status !== 'completed' && Date.now() - Date.parse(run.created_at) < 80 * 60000) {
      rf.runId = run.id; rf.runUrl = run.html_url; rf.startedAt = Date.parse(run.created_at); rf.phase = run.status === 'in_progress' ? 'running' : 'queued';
      rf.prevGen = state.data && state.data.generatedAt;
      renderRefreshButtons(); startTicker(); poll();
    }
  } catch { /* offline or rate limited: skip */ }
}

function cacheData(d) { try { store.set('cache', JSON.stringify(d)); } catch { /* too large or blocked */ } }

/* ============================================================
   Events
   ============================================================ */
function wire() {
  $('#btn-refresh').addEventListener('click', openRefresh);
  $('#btn-refresh2').addEventListener('click', openRefresh);
  $('#btn-lang').addEventListener('click', () => {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    store.set('lang', state.lang);
    applyStatic(); renderAll();
    if ($('#dlg').open) renderDialog();
  });
  $('#btn-theme').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    $('#btn-theme').replaceChildren(icon(isDark() ? 'sun' : 'moon'));
  });
  $('#results').addEventListener('click', onResultsClick);
  $('#view-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    state.view = b.dataset.view; persist(); renderAll();
  });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; persist(); renderResults(); });
  let qTimer;
  $('#q').addEventListener('input', e => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); state.calDay = null; renderTabs(); updateRail(); renderResults(); }, 120);
  });
  $('#rail').addEventListener('change', e => {
    const i = e.target; if (!(i instanceof HTMLInputElement)) return;
    if (i.name === 'cat') { if (i.checked) state.cats.add(i.value); else state.cats.delete(i.value); if (!state.cats.size) state.cats = new Set(CATS); }
    else if (i.name === 'elig') state.elig = i.value;
    else if (i.name === 'when') state.range = i.value;
    else if (i.name === 'closing') state.closing = i.checked;
    else if (i.name === 'reach') state.reach = i.checked;
    else if (i.name === 'dismissed') state.showDismissed = i.checked;
    persist(); renderAll();
  });
  $('#f-reset').addEventListener('click', resetFilters);
  $('#btn-filters').addEventListener('click', () => toggleSheet(true));
  $('#f-close').addEventListener('click', () => toggleSheet(false));
  $('#f-apply').addEventListener('click', () => toggleSheet(false));
  $('#rail-scrim').addEventListener('click', () => toggleSheet(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#rail').classList.contains('open')) toggleSheet(false); });
  $('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) $('#dlg').close(); });
}

function toggleSheet(open) {
  $('#rail').classList.toggle('open', open);
  $('#rail-scrim').hidden = !open;
  document.body.classList.toggle('lock', open);
  if (open) $('#f-close').focus(); else $('#btn-filters').focus();
}

/* ============================================================
   Boot
   ============================================================ */
async function init() {
  drawContours();
  wire();
  applyStatic();
  renderSkeleton();
  try {
    state.data = await loadData();
    cacheData(state.data);
  } catch {
    const c = store.json('cache', null);
    try { state.data = c ? normalize(c) : null; } catch { state.data = null; }
  }
  if (!state.data) {
    $('#results').replaceChildren(el('div', { class: 'empty' }, el('h3', { text: t('load.fail') }),
      el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => location.reload(), text: t('load.retry') })));
    return;
  }
  renderAll();
  adoptRunningScan();
}

init();
