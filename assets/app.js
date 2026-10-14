// Oman Scout: application shell.
//
// Shape: one mutable state object (S), user data in the store (prefs, plan, dismissed, seen, ui),
// scores computed once per data/preference change, and a render step per area (hero, tabs, quick
// filters, list). Rarely used views load on demand from ./ui: drawer, plan, calendar, dialogs,
// refresh. They receive `api`, a small object of closures defined near the bottom of this file.

import { STR } from './i18n.js';
import { MORE } from './i18n-v2.js';
import { $, $$, el, icon, markText, safeUrl, downloadText, copyText } from './ui/dom.js';
import * as D from './lib/dates.js';
import { scoreItem, computeAffinity, pickTop, reasonParams } from './lib/rank.js';
import { buildIndex, searchItems, highlightSegments, suggest } from './lib/search.js';
import { createStore, browserStorage, loadUser, saveUser, planStatuses } from './lib/store.js';
import { TOPICS, topicLabel } from './lib/topics.js';
import { buildIcs, googleCalendarUrl, shareText, digestText } from './lib/ics.js';

Object.assign(STR.en, MORE.en);
Object.assign(STR.ar, MORE.ar);

/* ---------- config, store, state ---------- */
const CFG = Object.assign({ repo: '', workflow: 'scout.yml', branch: 'main', data: 'data/scout.json' }, window.SCOUT_CONFIG || {});
if (!CFG.repo && /\.github\.io$/.test(location.hostname)) {
  const owner = location.hostname.split('.')[0];
  const name = location.pathname.split('/').filter(Boolean)[0];
  if (owner && name) CFG.repo = owner + '/' + name;
}
const REGIONS = ['oman', 'gcc', 'global'];
const TYPES = ['competition', 'event', 'funding', 'competitor'];
const CAT_ICON = { event: 'calendar', competition: 'trophy', competitor: 'radar', funding: 'landmark' };
const ELIG_OPEN = new Set(['eligible', 'likely', 'na']);
const ELIG_PLUS = new Set(['eligible', 'likely', 'na', 'check']);
const ELIG_TONE = { eligible: 'green', likely: 'green', check: 'amber', na: 'grey', ineligible: 'red' };

const store = createStore(browserStorage());
const user = loadUser(store);
const ui = user.ui;

const S = {
  lang: ui.lang || ((navigator.language || '').slice(0, 2) === 'ar' ? 'ar' : 'en'),
  today: D.muscatToday(),
  data: null, items: [], byId: new Map(), index: null, rel: null,
  scores: new Map(), ctx: null, newIds: new Set(), offline: false,
  region: ui.region, type: 'all', topic: null, q: '', month: null, closing: false, students: false, showDismissed: false,
  scanBusy: false, order: [], renderTok: 0, chunkTok: 0, firstList: true
};

const t = (k, v) => {
  let s = (STR[S.lang] && STR[S.lang][k]) ?? STR.en[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', String(b));
  return s;
};
const fmt = (s, o) => D.fmtDate(s, S.lang, o);
const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 60));

function relText(s) {
  const n = D.diffDays(S.today, s);
  if (n === 0) return t('date.today');
  if (n === 1) return t('date.tomorrow');
  if (n > 1 && n <= 60) return t('date.in', { n });
  if (n > 60) return t('date.months', { n: Math.round(n / 30) });
  return '';
}

function tx(it, k) {
  if (S.lang === 'ar' && it.ar && it.ar[k]) return { text: it.ar[k], lang: 'ar' };
  return { text: it[k] || '', lang: 'en' };
}

const save = patch => saveUser(store, patch);
function setUi(patch) { Object.assign(ui, patch); save({ ui: patch }); }
function applyUi() {
  const d = document.documentElement;
  d.lang = S.lang; d.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  const set = (k, v, off) => (v === off ? d.removeAttribute(k) : d.setAttribute(k, v));
  set('data-theme', ui.theme, 'system');
  set('data-scale', ui.textScale, 'm');
  set('data-density', ui.density, 'comfortable');
  set('data-motion', ui.motion, 'system');
  document.title = t('title');
}
const isDark = () => (ui.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : ui.theme === 'dark');

/* ---------- data ---------- */
async function loadData(bust) {
  const res = await fetch(CFG.data + (bust ? '?v=' + Date.now() : ''), { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return normalize(await res.json());
}
function normalize(j) {
  if (!j || !Array.isArray(j.items)) throw new Error('bad data');
  j.items = j.items.filter(it => it && it.id && it.title && REGIONS.includes(it.region)).map(it => ({
    ...it,
    category: TYPES.includes(it.category) ? it.category : 'event',
    eligibility: ['eligible', 'likely', 'check', 'ineligible', 'na'].includes(it.eligibility) ? it.eligibility : 'check',
    confidence: ['confirmed', 'likely', 'unverified'].includes(it.confidence) ? it.confidence : 'unverified',
    sources: Array.isArray(it.sources) ? it.sources : [],
    topics: Array.isArray(it.topics) ? it.topics : [],
    tags: Array.isArray(it.tags) ? it.tags : []
  }));
  return j;
}
function cacheData(d) { store.set('cache', JSON.stringify(d)); }
function setData(j) {
  S.data = j; S.items = j.items; S.byId = new Map(j.items.map(i => [i.id, i]));
  S.index = buildIndex(S.items);
  S.newIds = user.seen.size ? new Set(S.items.filter(i => !user.seen.has(i.id)).map(i => i.id)) : new Set();
  recompute();
}
function recompute() {
  const affinity = user.prefs.learn ? computeAffinity(S.items, Object.keys(user.plan), user.dismissed) : {};
  S.ctx = { today: S.today, prefs: user.prefs, affinity };
  S.scores = new Map(S.items.map(it => [it.id, scoreItem(it, S.ctx)]));
}

/* ---------- filtering and ordering ---------- */
const live = it => D.isUpcoming(it, S.today);
const eligOk = it => ui.elig === 'all' || (ui.elig === 'open' ? ELIG_OPEN : ELIG_PLUS).has(it.eligibility);
const reachOk = it => (ui.reach === 'far' ? true : ui.reach === 'gcc' ? it.travel !== 'far' : it.travel === 'local' || it.travel === 'online');

function pass(it, skip = {}) {
  if (!live(it)) return false;
  if (!skip.region) { if (S.region === 'plan' ? !user.plan[it.id] : it.region !== S.region) return false; }
  if (!skip.type && S.type !== 'all' && it.category !== S.type) return false;
  if (!skip.topic && S.topic && !it.topics.includes(S.topic)) return false;
  if (S.region !== 'plan') {
    if (!eligOk(it)) return false;
    if (!S.showDismissed && user.dismissed.has(it.id)) return false;
    if (!reachOk(it)) return false;
  }
  if (S.students && !['students', 'youth'].includes(it.audience)) return false;
  if (S.closing && !(it.deadline && it.deadline >= S.today && D.diffDays(S.today, it.deadline) <= 14)) return false;
  if (ui.range !== 'all') {
    const a = D.anchorDate(it, S.today);
    if (!a || D.clampToToday(a, S.today) > D.addDays(S.today, Number(ui.range))) return false;
  }
  if (S.month) { const a = D.clampToToday(D.anchorDate(it, S.today), S.today); if (!a || a.slice(0, 7) !== S.month) return false; }
  if (S.rel && !S.rel.has(it.id)) return false;
  return true;
}
const visible = skip => S.items.filter(it => pass(it, skip));

function sorted(list) {
  const key = it => { const a = D.anchorDate(it, S.today); return a ? D.clampToToday(a, S.today) : '9999-99-99'; };
  const sc = it => (S.scores.get(it.id) || { score: 0 }).score;
  const arr = [...list];
  const by = ui.sort;
  if (S.rel && by === 'best') arr.sort((a, b) => (S.rel.get(b.id) - S.rel.get(a.id)) || (sc(b) - sc(a)));
  else if (by === 'best') arr.sort((a, b) => (sc(b) - sc(a)) || key(a).localeCompare(key(b)));
  else if (by === 'deadline') {
    const dk = it => (it.deadline && it.deadline >= S.today ? it.deadline : '9999-99-99');
    arr.sort((a, b) => dk(a).localeCompare(dk(b)) || key(a).localeCompare(key(b)));
  } else if (by === 'new') arr.sort((a, b) => (S.newIds.has(b.id) - S.newIds.has(a.id)) || (b.firstSeen || '').localeCompare(a.firstSeen || '') || key(a).localeCompare(key(b)));
  else arr.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
  return arr;
}

/* ---------- small UI pieces ---------- */
let toastTimer;
function toast(msg, opts = {}) {
  const n = $('#toast');
  n.replaceChildren(...[msg, opts.action && el('button', { type: 'button', class: 'toast-act', text: opts.action.label, onclick: () => { n.hidden = true; opts.action.fn(); } })].filter(Boolean));
  n.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { n.hidden = true; }, opts.action ? 6000 : 2800);
}

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(btn, entries) {
  closeMenu();
  const m = el('div', { class: 'menu', role: 'menu' }, entries.map(e => e.href
    ? el('a', { role: 'menuitem', href: e.href, target: '_blank', rel: 'noopener noreferrer', onclick: closeMenu }, icon(e.icon || 'ext'), e.label)
    : el('button', { role: 'menuitem', type: 'button', onclick: () => { closeMenu(); e.fn(); } }, icon(e.icon || 'chev'), e.label)));
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth;
  const left = S.lang === 'ar' ? r.right - w : r.left;
  m.style.setProperty('top', Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8) + 'px');
  m.style.setProperty('left', Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px');
  menuEl = m;
  (m.querySelector('a,button') || m).focus();
}
document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

const itemUrl = id => location.origin + location.pathname + '#/item/' + encodeURIComponent(id);

function downloadIcs(items, name) {
  downloadText(name || 'oman-scout.ics', buildIcs(items, { lang: S.lang, calName: 'Oman Scout' }), 'text/calendar;charset=utf-8');
  toast(t('toast.ics'));
}
function calendarMenu(btn, it) {
  const entries = [{ label: t('card.ics'), icon: 'download', fn: () => downloadIcs([it], it.id + '.ics') }];
  const g = googleCalendarUrl(it, { lang: S.lang });
  if (g) entries.push({ label: t('card.gcal'), icon: 'calendar', href: g });
  if (it.start && it.deadline) { const gd = googleCalendarUrl(it, { lang: S.lang, which: 'deadline' }); if (gd) entries.push({ label: t('card.gcal') + ' · ' + t('card.deadline'), icon: 'clock', href: gd }); }
  openMenu(btn, entries);
}
function shareMenu(btn, it) {
  const url = itemUrl(it.id);
  const text = shareText(it, { lang: S.lang, url });
  const entries = [
    { label: t('card.whatsapp'), icon: 'share', href: 'https://wa.me/?text=' + encodeURIComponent(text) },
    { label: t('card.copytext'), icon: 'copy', fn: async () => { toast((await copyText(text)) ? t('share.copied') : text); } },
    { label: t('card.copylink'), icon: 'ext', fn: async () => { toast((await copyText(url)) ? t('share.copied') : url); } }
  ];
  if (navigator.share) entries.unshift({ label: t('card.share'), icon: 'share', fn: () => navigator.share({ title: it.title, text, url }).catch(() => {}) });
  openMenu(btn, entries);
}

/* ---------- card ---------- */
function ring(res, size) {
  const n = res ? res.score : 0;
  const reasons = res ? res.reasons.map(r => t(r.key, reasonParams(r, S.lang))).join(' · ') : '';
  return el('span', { class: 'ring' + (size ? ' ' + size : '') + (n >= 80 ? ' hot' : n >= 60 ? ' mid' : ''), style: { '--p': String(n) }, title: t('card.match', { n }) + (reasons ? '. ' + reasons : ''), role: 'img', 'aria-label': t('card.match', { n }) },
    el('b', { text: String(n) }));
}

function shortNote(it) {
  const n = (it.dateNote || '').trim();
  if (!n) return t('stamp.tba');
  return n.length > 22 ? n.slice(0, 20).trimEnd() + '…' : n;
}
function stampEl(it) {
  const a = D.anchorDate(it, S.today);
  const apply = (it.category === 'competition' || it.category === 'funding') && it.deadline && a === it.deadline && it.deadline >= S.today;
  const box = el('div', { class: 'stamp' });
  if (!a) { box.append(el('span', { class: 'kick', text: t('stamp.tba') }), el('span', { class: 'big txt', text: shortNote(it) })); return box; }
  if (it.approx && !apply) {
    box.append(el('span', { class: 'kick', text: t('stamp.approx') }), el('span', { class: 'big txt', text: fmt(a, { month: 'short' }) }), el('span', { class: 'yr', text: fmt(a, { year: 'numeric' }) }));
    return box;
  }
  const multi = !apply && it.start && it.end && it.end !== it.start;
  const sameMonth = multi && it.start.slice(0, 7) === it.end.slice(0, 7);
  const kick = apply ? t('stamp.apply') : fmt(a, { weekday: 'short' });
  let big, mon;
  if (multi) {
    big = fmt(it.start, { day: 'numeric' }) + '–' + fmt(it.end, { day: 'numeric' });
    mon = sameMonth ? fmt(it.start, { month: 'short' }) : fmt(it.start, { month: 'short' }) + '–' + fmt(it.end, { month: 'short' });
  } else { big = fmt(a, { day: 'numeric' }); mon = fmt(a, { month: 'short' }); }
  box.append(el('span', { class: 'kick', text: kick }), el('span', { class: 'big' + (multi ? ' range' : ''), text: big }), el('span', { class: 'mon', text: mon }));
  if (a.slice(0, 4) !== S.today.slice(0, 4)) box.append(el('span', { class: 'yr', text: a.slice(0, 4) }));
  const rel = D.isOngoing(it, S.today) ? t('date.ongoing') : relText(a);
  if (rel) box.append(el('span', { class: 'rel', text: rel }));
  return box;
}
function deadlineEl(it) {
  if (!it.deadline) return null;
  const n = D.diffDays(S.today, it.deadline);
  if (n < 0) return el('span', { class: 'deadline closed' }, icon('calendar'), t('deadline.closed'));
  const tone = n <= 7 ? 'urgent' : n <= 14 ? 'soon' : '';
  return el('span', { class: 'deadline ' + tone }, icon('clock'), t('deadline.by', { d: fmt(it.deadline, { day: 'numeric', month: 'short' }) }), ' · ', n === 0 ? t('deadline.today') : t('deadline.left', { n }));
}
const badge = (cls, ...kids) => el('span', { class: 'badge ' + (cls || '') }, ...kids);

function card(it) {
  const res = S.scores.get(it.id);
  const title = tx(it, 'title');
  const sum = tx(it, 'summary');
  const inPlan = !!user.plan[it.id];
  const dismissed = user.dismissed.has(it.id);
  const q = S.q;
  const src = (it.sources || []).map(s => safeUrl(s.url)).filter(Boolean);
  const main = safeUrl(it.applyUrl) || src[0];
  const hasDate = !!(it.start || it.deadline);

  const badges = [
    badge('cat', icon(CAT_ICON[it.category]), t('catS.' + it.category)),
    S.region === 'plan' ? badge('', el('span', { class: 'dot ' + it.region }), t('region.' + it.region)) : null,
    S.newIds.has(it.id) ? badge('new', t('newbadge')) : null,
    badge(ELIG_TONE[it.eligibility] || 'grey', t('elig.' + it.eligibility)),
    it.travel === 'gcc' ? badge('', icon('plane'), t('travel.gcc')) : null,
    it.travel === 'far' ? badge('red', icon('plane'), t('travel.far')) : null,
    it.travel === 'online' ? badge('blue', t('travel.online')) : null,
    it.confidence === 'unverified' ? badge('amber', t('conf.unverified')) : null,
    dismissed ? badge('grey', t('card.dismissed')) : null
  ];
  const meta = [
    it.location ? el('li', {}, icon('pin'), it.location) : null,
    it.cost ? el('li', {}, icon('tag'), it.cost) : null,
    it.prize ? el('li', {}, icon('gift'), it.prize) : null,
    it.organizer ? el('li', {}, icon('building'), it.organizer) : null
  ].filter(Boolean);
  const topics = (it.topics || []).slice(0, 3).map(id => el('button', { type: 'button', class: 'topic-chip' + (S.topic === id ? ' on' : ''), 'data-act': 'topic', 'data-topic': id, text: topicLabel(id, S.lang) }));

  const actions = el('div', { class: 'actions' },
    main ? el('a', { class: 'act primary', href: main, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), safeUrl(it.applyUrl) ? t('card.apply') : t('card.source')) : null,
    hasDate ? el('button', { class: 'act', type: 'button', 'data-act': 'cal', 'data-menu': '', 'aria-haspopup': 'menu' }, icon('calplus'), t('card.cal')) : null,
    el('button', { class: 'act icon-only', type: 'button', 'data-act': 'share', 'data-menu': '', 'aria-haspopup': 'menu', 'aria-label': t('card.share'), title: t('card.share') }, icon('share')),
    el('button', { class: 'act end', type: 'button', 'data-act': 'plan', 'aria-pressed': String(inPlan) }, icon('bookmark'), inPlan ? t('card.inplan') : t('card.save')),
    el('button', { class: 'act quiet', type: 'button', 'data-act': 'dismiss' }, dismissed ? t('card.restore') : t('card.dismiss'))
  );

  const body = el('div', { class: 'card-body' },
    el('div', { class: 'badges' }, badges),
    el('div', { class: 'card-top' },
      el('h3', {}, el('button', { type: 'button', class: 'title-btn', 'data-act': 'open', lang: title.lang, dir: 'auto' }, q && title.lang === 'en' ? markText(highlightSegments(title.text, q)) : title.text)),
      ring(res)),
    sum.text ? el('p', { class: 'sum', lang: sum.lang, dir: 'auto' }, q && sum.lang === 'en' ? markText(highlightSegments(sum.text, q)) : sum.text) : null,
    meta.length ? el('ul', { class: 'meta' }, meta) : null,
    topics.length ? el('div', { class: 'topics' }, topics) : null,
    deadlineEl(it),
    actions);
  return el('article', { class: 'card' + (dismissed ? ' is-dismissed' : ''), 'data-id': it.id, 'data-cat': it.category }, stampEl(it), body);
}

/* ---------- hero ---------- */
function countUp(node, n) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || ui.motion === 'reduce' || n < 3) { node.textContent = String(n); return; }
  const t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / 650); node.textContent = String(Math.round(n * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function renderHero() {
  const data = S.data;
  const upcoming = S.items.filter(live);
  const mine = upcoming.filter(it => it.eligibility !== 'ineligible' && !user.dismissed.has(it.id));
  const closing = mine.filter(it => it.deadline && it.deadline >= S.today && D.diffDays(S.today, it.deadline) <= 14);
  const excluded = upcoming.filter(it => it.eligibility === 'ineligible');
  const h1 = $('#hero-h1');
  h1.textContent = closing.length >= 2 ? t('hero.h.closing', { n: closing.length }) : closing.length === 1 ? t('hero.h.one') : t('hero.title');

  const first = !$('#stats').children.length;
  const stat = (n, label, onclick, hot) => {
    const b = el(onclick ? 'button' : 'div', { class: 'stat' + (hot ? ' hot' : ''), type: onclick ? 'button' : null, onclick }, el('b', { text: first ? '0' : String(n) }), el('span', { text: label }));
    if (first) countUp(b.firstChild, n);
    return b;
  };
  $('#stats').replaceChildren(...[
    stat(mine.length, t('stat.upcoming')),
    stat(closing.length, t('stat.closing'), () => { S.closing = !S.closing; go('oman'); }, closing.length > 0),
    S.newIds.size ? stat(S.newIds.size, t('stat.new'), () => { setUi({ sort: 'new' }); go(S.region === 'plan' ? 'oman' : S.region); }) : null,
    stat(excluded.length, t('stat.excluded'), () => { setUi({ elig: 'all' }); go('oman'); })].filter(Boolean));

  const gen = data.generatedAt ? new Date(data.generatedAt) : null;
  if (gen && !isNaN(gen)) {
    const abs = new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: D.TZ }).format(gen);
    const mins = Math.min(0, Math.round((gen - Date.now()) / 60000));
    const rtf = new Intl.RelativeTimeFormat(S.lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { numeric: 'auto' });
    const rel = Math.abs(mins) < 90 ? rtf.format(mins, 'minute') : Math.abs(mins) < 2880 ? rtf.format(Math.round(mins / 60), 'hour') : rtf.format(Math.round(mins / 1440), 'day');
    $('#hero-updated').replaceChildren(...[t('hero.updated', { when: abs + ' · ' + rel }), S.offline && el('span', { class: 'chip-off' }, icon('wifioff'), t('offline.chip'))].filter(Boolean));
  }
  const pl = data.profileLabel || {};
  const label = pl[S.lang] || pl.en || '';
  $('#hero-profile').textContent = label ? t('hero.filtered', { label }) : '';

  // top picks
  const picks = pickTop(mine.filter(reachOk), S.ctx, 4);
  const box = $('#picks');
  box.replaceChildren(
    el('div', { class: 'panel-head' }, el('h2', { id: 'picks-h', text: t('picks.title') }), el('button', { type: 'button', class: 'link-btn light', onclick: () => openTune(), text: t('tune.btn') })),
    picks.length ? el('ol', { class: 'pick-list' }, picks.map(({ item, result }) => {
      const a = D.actionDate(item, S.today);
      const title = tx(item, 'title');
      const why = result.reasons[0] ? t(result.reasons[0].key, reasonParams(result.reasons[0], S.lang)) : '';
      return el('li', {}, el('button', { type: 'button', class: 'pick', onclick: () => openItem(item.id) },
        ring(result, 'sm'),
        el('span', { class: 'pick-t' },
          el('span', { class: 'pick-title', lang: title.lang, dir: 'auto', text: title.text }),
          el('span', { class: 'pick-meta' }, el('span', { class: 'dot ' + item.region }), t('catS.' + item.category), a ? ' · ' + (D.isOngoing(item, S.today) ? t('date.ongoing') : relText(a) || fmt(a, { day: 'numeric', month: 'short' })) : '', why ? ' · ' + why : ''))));
    })) : el('p', { class: 'pick-empty', text: t('picks.empty') }));
  renderMonths(mine);
}

function renderMonths(mine) {
  const box = $('#months');
  const keys = [];
  const [cy, cm] = S.today.split('-').map(Number);
  for (let i = 0; i < 6; i++) keys.push(new Date(Date.UTC(cy, cm - 1 + i, 1)).toISOString().slice(0, 7));
  const counts = Object.fromEntries(keys.map(k => [k, { oman: 0, gcc: 0, global: 0 }]));
  mine.forEach(it => {
    const a = D.clampToToday(D.anchorDate(it, S.today), S.today);
    if (a && counts[a.slice(0, 7)]) counts[a.slice(0, 7)][it.region]++;
  });
  const max = Math.max(1, ...keys.map(k => counts[k].oman + counts[k].gcc + counts[k].global));
  const unit = 78 / max;
  box.replaceChildren(
    el('h2', { id: 'months-h', text: t('months.title') }),
    el('div', { class: 'bars' }, keys.map(k => {
      const c = counts[k];
      const total = c.oman + c.gcc + c.global;
      const segs = REGIONS.filter(r => c[r] > 0).map(r => el('span', { class: 'bar-seg ' + r, style: { height: Math.max(4, c[r] * unit) + 'px' } }));
      return el('button', { class: 'bar', type: 'button', 'aria-pressed': String(S.month === k), onclick: () => { S.month = S.month === k ? null : k; if (S.region === 'plan') S.region = 'oman'; schedule(); jump(); } },
        el('span', { class: 'bar-n', text: String(total) }),
        el('span', { class: 'bar-stack' }, segs.length ? segs : el('span', { class: 'bar-seg none' })),
        el('span', { class: 'bar-m', text: fmt(k + '-01', { month: 'short' }) }));
    })),
    el('div', { class: 'legend' }, REGIONS.map(r => el('span', {}, el('span', { class: 'dot ' + r }), t('region.' + r)))));
}

function drawContours() {
  const svg = $('#contours');
  svg.setAttribute('viewBox', '0 0 1440 640');
  const NS = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < 14; i++) {
    const y0 = 40 + i * 42;
    let d = '';
    for (let x = 0; x <= 1440; x += 32) {
      const y = y0 + Math.sin(x * 0.0042 + i * 0.42) * 26 + Math.sin(x * 0.011 + i * 0.9) * 9 + Math.cos(x * 0.0019 - i * 0.3) * 18;
      d += (x === 0 ? 'M' : 'L') + x + ' ' + y.toFixed(1) + ' ';
    }
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('opacity', (0.05 + 0.14 * (1 - i / 14)).toFixed(3));
    svg.append(p);
  }
}

/* ---------- tabs, chips, rail ---------- */
function renderTabs() {
  const base = visible({ region: true });
  const n = { oman: 0, gcc: 0, global: 0, plan: S.items.filter(it => user.plan[it.id] && live(it)).length };
  base.forEach(it => { n[it.region]++; });
  const tab = (id, label, dot) => el('button', { class: 'tab', role: 'tab', type: 'button', id: 'tab-' + id, 'aria-selected': String(S.region === id), tabindex: S.region === id ? '0' : '-1', 'data-region': id },
    dot ? el('span', { class: 'dot ' + dot }) : icon('bookmark'), label, el('span', { class: 'n', text: String(n[id]) }));
  $('#tabs').replaceChildren(tab('oman', t('region.oman'), 'oman'), tab('gcc', t('region.gcc'), 'gcc'), tab('global', t('region.global'), 'global'), tab('plan', t('plan.title')));
}

function chip(label, on, attrs, nCount) {
  return el('button', { type: 'button', class: 'chip-btn' + (on ? ' on' : ''), 'aria-pressed': String(on), ...attrs }, label, nCount != null ? el('span', { class: 'n', text: String(nCount) }) : null);
}
function renderQuick() {
  const byType = visible({ type: true });
  const tc = { all: byType.length };
  TYPES.forEach(k => { tc[k] = byType.filter(i => i.category === k).length; });
  $('#type-chips').replaceChildren(chip(t('type.all'), S.type === 'all', { 'data-type': 'all' }, tc.all),
    ...TYPES.map(k => chip(t('cat.' + k), S.type === k, { 'data-type': k }, tc[k])));
  const byTopic = visible({ topic: true });
  const topicCount = {};
  byTopic.forEach(i => i.topics.forEach(x => { topicCount[x] = (topicCount[x] || 0) + 1; }));
  const mine = new Set(user.prefs.interests);
  const order = [...TOPICS].sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || ((topicCount[b.id] || 0) - (topicCount[a.id] || 0)));
  $('#topic-chips').replaceChildren(chip(t('topics.all'), !S.topic, { 'data-topic': '' }),
    ...order.filter(x => topicCount[x.id] || S.topic === x.id).map(x => chip(topicLabel(x.id, S.lang), S.topic === x.id, { 'data-topic': x.id, class: 'chip-btn' + (S.topic === x.id ? ' on' : '') + (mine.has(x.id) ? ' mine' : '') }, topicCount[x.id] || 0)));
}

function optRow(type, name, value, label) {
  return el('label', { class: 'opt' }, el('input', { type, name, value }), el('span', { class: 'cat-label' }, label), el('span', { class: 'n' }));
}
function buildRail() {
  $('#f-elig').replaceChildren(...['open', 'plus', 'all'].map(v => optRow('radio', 'elig', v, t('f.elig.' + v))));
  $('#f-when').replaceChildren(...['all', '30', '90', '180'].map(v => optRow('radio', 'when', v, t('f.when.' + v))));
  $('#f-reach').replaceChildren(...['far', 'gcc', 'local'].map(v => optRow('radio', 'reach', v, t('f.reach.' + v))));
  $('#f-more').replaceChildren(optRow('checkbox', 'students', 'students', t('f.students')), optRow('checkbox', 'closing', 'closing', t('f.closing')), optRow('checkbox', 'dismissed', 'dismissed', t('f.dismissed', { n: 0 })));
  updateRail();
}
function updateRail() {
  $$('#f-elig input').forEach(i => { i.checked = i.value === ui.elig; });
  $$('#f-when input').forEach(i => { i.checked = i.value === ui.range; });
  $$('#f-reach input').forEach(i => { i.checked = i.value === ui.reach; });
  $('#f-more input[value="students"]').checked = S.students;
  $('#f-more input[value="closing"]').checked = S.closing;
  const dis = $('#f-more input[value="dismissed"]');
  dis.checked = S.showDismissed;
  const nd = S.items.filter(it => user.dismissed.has(it.id) && live(it)).length;
  dis.closest('.opt').querySelector('.cat-label').textContent = t('f.dismissed', { n: nd });
  dis.closest('.opt').hidden = !nd && !S.showDismissed;
}

function renderChips(count) {
  const chips = [];
  const rm = (label, fn) => chips.push(el('button', { class: 'chip', type: 'button', onclick: fn }, label, icon('x')));
  if (S.month) rm(t('chip.month', { m: fmt(S.month + '-01', { month: 'long', year: 'numeric' }) }), () => { S.month = null; schedule(); });
  if (S.closing) rm(t('chip.closing'), () => { S.closing = false; schedule(); });
  if (S.q) rm(t('chip.search', { q: S.q }), () => { $('#q').value = ''; setQuery(''); });
  $('#active-chips').replaceChildren(...chips);
  $('#count').textContent = count === 1 ? t('count1') : t('count', { n: count });
  $('#f-apply').textContent = t('f.apply', { n: count });
}

function buildToolbar() {
  const seg = $('#view-seg');
  seg.replaceChildren(...[['list', 'list', 'view.list'], ['cal', 'grid', 'view.cal']].map(([v, ic, label]) =>
    el('button', { type: 'button', 'aria-pressed': String(ui.view === v), 'data-view': v, 'aria-label': t(label) }, icon(ic), el('span', { class: 'lbl', text: t(label) }))));
  const s = $('#sort');
  s.replaceChildren(...['best', 'date', 'deadline', 'new'].map(v => el('option', { value: v, text: t('sort.' + v) })));
  s.value = ui.sort;
  $('#btn-density').replaceChildren(icon(ui.density === 'compact' ? 'compact' : 'comfy'));
  $('#btn-tune').replaceChildren(icon('sliders'), el('span', { class: 'lbl', text: t('tune.btn') }));
  $('#btn-tune').setAttribute('aria-label', t('tune.btn'));
  $('#btn-filters').replaceChildren(icon('filter'), t('f.open'));
}

function renderBanner() {
  const b = $('#banner');
  if (ui.onboarded || !S.data) { b.replaceChildren(); return; }
  b.replaceChildren(el('div', { class: 'banner' }, icon('sparkle'),
    el('div', { class: 'banner-t' }, el('strong', { text: t('banner.title') }), el('span', { text: t('banner.body') })),
    el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => openTune(), text: t('banner.go') }),
    el('button', { class: 'link-btn', type: 'button', onclick: () => { setUi({ onboarded: true }); renderBanner(); }, text: t('banner.later') })));
}

/* ---------- list ---------- */
function emptyEl() {
  if (S.region === 'plan') return el('div', { class: 'empty' }, icon('bookmark'), el('h3', { text: t('plan.empty.title') }), el('p', { text: t('plan.empty.body') }));
  return el('div', { class: 'empty' }, icon('search'), el('h3', { text: t('empty.title') }), el('p', { text: S.q ? t('search.hint') : t('empty.body') }),
    el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: resetFilters, text: t('empty.reset') }));
}

async function renderList() {
  const box = $('#results');
  const tok = ++S.renderTok;
  ++S.chunkTok;
  const items = sorted(visible());
  S.order = items.map(i => i.id);
  renderChips(items.length);
  if (S.region === 'plan') {
    const m = await mod('plan'); if (tok !== S.renderTok) return;
    m.renderPlan(box, api, items); return;
  }
  if (ui.view === 'cal') {
    const m = await mod('calendar'); if (tok !== S.renderTok) return;
    m.renderCalendar(box, api, items); return;
  }
  if (!items.length) { box.replaceChildren(emptyEl()); return; }
  const units = [];
  if (ui.sort === 'date') {
    let cur = null;
    items.forEach(it => {
      const a = D.clampToToday(D.anchorDate(it, S.today), S.today);
      const k = a ? a.slice(0, 7) : 'none';
      if (k !== cur) { cur = k; units.push({ h: k === 'none' ? t('group.nodate') : fmt(k + '-01', { month: 'long', year: 'numeric' }) }); }
      units.push({ it });
    });
  } else items.forEach(it => units.push({ it }));
  const wrap = el('div', { class: 'cards' + (S.firstList ? ' reveal' : '') });
  box.replaceChildren(wrap);
  const put = (from, to) => {
    const frag = document.createDocumentFragment();
    for (let i = from; i < Math.min(to, units.length); i++) {
      const u = units[i];
      const node = u.h ? el('h2', { class: 'group-h', text: u.h }) : card(u.it);
      if (S.firstList && i < 8 && !u.h) node.style.setProperty('--i', String(i));
      frag.append(node);
    }
    wrap.append(frag);
  };
  put(0, 14);
  const myTok = S.chunkTok;
  let at = 14;
  const more = () => { if (myTok !== S.chunkTok || at >= units.length) return; put(at, at + 16); at += 16; idle(more); };
  if (units.length > 14) idle(more);
  S.firstList = false;
}

function jump() { const s = $('#stickybar'); if (s) window.scrollTo({ top: Math.max(0, s.offsetTop - 4), behavior: 'smooth' }); }

/* ---------- render scheduling ---------- */
let pending = null;
function schedule(parts) {
  pending = Object.assign(pending || {}, parts || {});
  if (schedule.raf) return;
  schedule.raf = requestAnimationFrame(() => {
    schedule.raf = 0;
    const p = pending; pending = null;
    if (!S.data) return;
    const all = !!p.all;
    if (all || p.hero) renderHero();
    renderTabs(); renderQuick(); updateRail(); buildToolbarState();
    renderList();
    if (all) renderFooter();
    renderBanner();
  });
}
function buildToolbarState() {
  $$('#view-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
  $('#sort').value = ui.sort;
  $('#btn-density').replaceChildren(icon(ui.density === 'compact' ? 'compact' : 'comfy'));
}

function renderFooter() {
  const tasks = S.data.tasks || {};
  $('#foot-status').replaceChildren(el('h2', { text: t('foot.status') }), el('ul', {}, Object.entries(tasks).map(([id, info]) => {
    const stale = info.status !== 'ok';
    const when = info.updatedAt ? fmt(info.updatedAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const name = t('task.' + id);
    return el('li', { class: 'st' + (stale ? ' stale' : '') }, el('i'), el('span', {}, name === 'task.' + id ? id : name, ' ', el('small', { text: (stale ? t('foot.status.stale') : t('foot.status.ok')) + ' · ' + when })));
  })));
  const gaps = S.data.gaps || [];
  $('#foot-gaps').replaceChildren(el('h2', { text: t('foot.gaps') }), gaps.length ? el('ul', {}, gaps.slice(0, 8).map(g => el('li', { text: g }))) : el('p', { text: t('foot.gaps.none') }));
}

/* ---------- actions ---------- */
function resetFilters() {
  S.type = 'all'; S.topic = null; S.closing = false; S.students = false; S.showDismissed = false; S.q = ''; S.rel = null; S.month = null;
  $('#q').value = '';
  setUi({ elig: 'plus', range: 'all', reach: 'far', sort: 'best' });
  schedule();
}
function setQuery(q) {
  S.q = q.trim();
  S.rel = S.q ? searchItems(S.index, S.q) : null;
  schedule({});
}
function go(region) {
  if (region !== S.region) { S.region = region; setUi({ region }); history.pushState(null, '', '#/' + region); }
  schedule();
  jump();
}
function setPlan(id, status) {
  if (status && planStatuses.includes(status)) user.plan[id] = { status, note: (user.plan[id] && user.plan[id].note) || '', updatedAt: new Date().toISOString() };
  else delete user.plan[id];
  save({ plan: user.plan });
}
function setNote(id, note) {
  const cur = user.plan[id] || { status: 'interested' };
  user.plan[id] = { ...cur, note: String(note).slice(0, 2000), updatedAt: new Date().toISOString() };
  save({ plan: user.plan });
}
function dismiss(id) {
  user.dismissed.add(id); save({ dismissed: user.dismissed }); recompute(); schedule({ hero: true });
  toast(t('card.dismissed'), { action: { label: t('card.restore'), fn: () => restore(id) } });
}
function restore(id) { user.dismissed.delete(id); save({ dismissed: user.dismissed }); recompute(); schedule({ hero: true }); }

function refreshCard(id) {
  const old = $(`.card[data-id="${CSS.escape(id)}"]`);
  const it = S.byId.get(id);
  if (old && it) old.replaceWith(card(it));
}

function onResultsClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const cardEl = btn.closest('.card');
  const id = cardEl && cardEl.dataset.id;
  const it = id && S.byId.get(id);
  const act = btn.dataset.act;
  if (act === 'topic') { S.topic = S.topic === btn.dataset.topic ? null : btn.dataset.topic; schedule(); return; }
  if (!it) return;
  if (act === 'open') openItem(id);
  else if (act === 'cal') calendarMenu(btn, it);
  else if (act === 'share') shareMenu(btn, it);
  else if (act === 'plan') {
    setPlan(id, user.plan[id] ? null : 'interested');
    if (S.region === 'plan') schedule(); else { refreshCard(id); renderTabs(); }
    toast(user.plan[id] ? t('card.saved') : t('plan.remove'));
  } else if (act === 'dismiss') { user.dismissed.has(id) ? restore(id) : dismiss(id); }
}

/* ---------- drawer, dialogs, lazy modules ---------- */
const lazy = {};
const mod = name => (lazy[name] = lazy[name] || import('./ui/' + name + '.js'));

async function openItem(id) {
  const m = await mod('drawer');
  m.openDrawer(api, id);
}
async function openTune() { (await mod('dialogs')).openTune(api); }
async function openSettings() { (await mod('dialogs')).openSettings(api); }
async function openRefresh() { (await mod('refresh')).openRefresh(api); }

function renderRefreshButtons() {
  [$('#btn-refresh'), $('#btn-refresh2')].forEach(b => {
    if (!b) return;
    b.classList.toggle('is-busy', S.scanBusy);
    b.replaceChildren(icon('refresh'), el('span', { text: S.scanBusy ? t('refresh.busy') : t('refresh') }));
    b.setAttribute('aria-label', S.scanBusy ? t('refresh.busy') : t('refresh'));
  });
}

function digest() {
  const mine = S.items.filter(it => live(it) && it.eligibility !== 'ineligible' && !user.dismissed.has(it.id) && reachOk(it));
  const weekEnd = D.addDays(S.today, 14);
  const soon = mine.filter(it => { const a = D.actionDate(it, S.today); return a && a <= weekEnd; });
  const picks = pickTop(soon.length >= 3 ? soon : mine, S.ctx, 6).map(p => p.item);
  return digestText(picks, { lang: S.lang, siteUrl: location.origin + location.pathname, title: t('digest.title') });
}

/* ---------- static text, language, theme ---------- */
function applyStatic() {
  applyUi();
  $$('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(n => n.setAttribute('placeholder', t(n.dataset.i18nPh)));
  $$('[data-i18n-label]').forEach(n => n.setAttribute('aria-label', t(n.dataset.i18nLabel)));
  $('#btn-lang').textContent = t('lang.btn');
  $('#btn-lang').setAttribute('lang', S.lang === 'ar' ? 'en' : 'ar');
  $('#btn-theme').replaceChildren(icon(isDark() ? 'sun' : 'moon'));
  $('#btn-settings').replaceChildren(icon('gear'));
  $('#f-close').replaceChildren(icon('x'));
  const sv = $('.search .ico'); if (sv) sv.innerHTML = '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>';
  buildToolbar(); buildRail(); renderRefreshButtons();
  const hasRepo = !!CFG.repo;
  const ls = $('#lnk-settings'), lr = $('#lnk-run');
  ls.textContent = t('foot.settings'); lr.textContent = t('foot.run');
  ls.hidden = lr.hidden = !hasRepo;
  if (hasRepo) {
    ls.href = `https://github.com/${CFG.repo}/edit/${CFG.branch}/agent/profile.md`;
    lr.href = `https://github.com/${CFG.repo}/actions/workflows/${CFG.workflow}`;
  }
}
function setLang(lang) { S.lang = lang; setUi({ lang }); applyStatic(); schedule({ all: true }); }

/* ---------- search box ---------- */
let suggRows = [];
let suggAt = -1;
function renderSugg() {
  const input = $('#q');
  const box = $('#sugg');
  const q = input.value;
  suggRows = [];
  if (!q.trim()) {
    (user.recent || []).forEach(r => suggRows.push({ text: r, kind: 'recent' }));
    user.prefs.interests.slice(0, 4).forEach(id => suggRows.push({ text: topicLabel(id, S.lang), kind: 'topic', id }));
  } else suggest(S.index, q, { lang: S.lang, limit: 6 }).forEach(s => suggRows.push({ text: s, kind: 'sugg' }));
  suggAt = -1;
  if (!suggRows.length) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  box.replaceChildren(...suggRows.map((r, i) => el('div', { class: 'sugg-row', role: 'option', id: 'sg' + i, 'data-i': String(i), 'aria-selected': 'false' },
    icon(r.kind === 'recent' ? 'clock' : r.kind === 'topic' ? 'sparkle' : 'search'), r.text)));
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function closeSugg() { $('#sugg').hidden = true; $('#q').setAttribute('aria-expanded', 'false'); }
function pickSugg(i) {
  const r = suggRows[i];
  if (!r) return;
  closeSugg();
  if (r.kind === 'topic') { S.topic = r.id; $('#q').value = ''; setQuery(''); return; }
  $('#q').value = r.text; setQuery(r.text); rememberQuery(r.text);
}
function rememberQuery(q) {
  const v = q.trim();
  if (v.length < 2) return;
  user.recent = [v, ...(user.recent || []).filter(x => x !== v)].slice(0, 8);
  save({ recent: user.recent });
}

/* ---------- events ---------- */
function wire() {
  $('#btn-refresh').addEventListener('click', openRefresh);
  $('#btn-refresh2').addEventListener('click', openRefresh);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-tune').addEventListener('click', () => openTune());
  $('#btn-lang').addEventListener('click', () => setLang(S.lang === 'ar' ? 'en' : 'ar'));
  $('#btn-theme').addEventListener('click', () => { setUi({ theme: isDark() ? 'light' : 'dark' }); applyUi(); $('#btn-theme').replaceChildren(icon(isDark() ? 'sun' : 'moon')); });
  $('#btn-density').addEventListener('click', () => { setUi({ density: ui.density === 'compact' ? 'comfortable' : 'compact' }); applyUi(); buildToolbarState(); });
  $('#results').addEventListener('click', onResultsClick);
  $('#view-seg').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { setUi({ view: b.dataset.view }); schedule(); } });
  $('#sort').addEventListener('change', e => { setUi({ sort: e.target.value }); schedule(); });
  $('#type-chips').addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (b) { S.type = b.dataset.type; schedule(); } });
  $('#topic-chips').addEventListener('click', e => { const b = e.target.closest('[data-topic]'); if (b) { S.topic = b.dataset.topic || null; schedule(); } });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-region]'); if (b) go(b.dataset.region); });
  $('#tabs').addEventListener('keydown', e => {
    const ids = ['oman', 'gcc', 'global', 'plan'];
    const i = ids.indexOf(S.region);
    const dir = (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * (S.lang === 'ar' ? -1 : 1);
    if (!dir) return;
    e.preventDefault(); go(ids[(i + dir + ids.length) % ids.length]);
    requestAnimationFrame(() => { const b = $('#tab-' + S.region); if (b) b.focus(); });
  });

  const q = $('#q');
  let qTimer;
  q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => setQuery(q.value), 110); renderSugg(); });
  q.addEventListener('focus', renderSugg);
  q.addEventListener('blur', () => setTimeout(closeSugg, 120));
  q.addEventListener('keydown', e => {
    const rows = suggRows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if ($('#sugg').hidden) renderSugg();
      if (!rows) return;
      e.preventDefault();
      suggAt = (suggAt + (e.key === 'ArrowDown' ? 1 : -1) + rows) % rows;
      $$('#sugg .sugg-row').forEach((r, i) => { r.setAttribute('aria-selected', String(i === suggAt)); if (i === suggAt) q.setAttribute('aria-activedescendant', r.id); });
    } else if (e.key === 'Enter') {
      if (suggAt >= 0) { e.preventDefault(); pickSugg(suggAt); } else { setQuery(q.value); rememberQuery(q.value); closeSugg(); }
    } else if (e.key === 'Escape') {
      if (!$('#sugg').hidden) closeSugg(); else if (q.value) { q.value = ''; setQuery(''); }
    }
  });
  $('#sugg').addEventListener('mousedown', e => { const r = e.target.closest('[data-i]'); if (r) { e.preventDefault(); pickSugg(Number(r.dataset.i)); } });

  $('#rail').addEventListener('change', e => {
    const i = e.target; if (!(i instanceof HTMLInputElement)) return;
    if (i.name === 'elig') setUi({ elig: i.value });
    else if (i.name === 'when') setUi({ range: i.value });
    else if (i.name === 'reach') setUi({ reach: i.value });
    else if (i.name === 'students') S.students = i.checked;
    else if (i.name === 'closing') S.closing = i.checked;
    else if (i.name === 'dismissed') S.showDismissed = i.checked;
    schedule();
  });
  $('#f-reset').addEventListener('click', resetFilters);
  $('#btn-filters').addEventListener('click', () => sheet(true));
  $('#f-close').addEventListener('click', () => sheet(false));
  $('#f-apply').addEventListener('click', () => sheet(false));
  $('#rail-scrim').addEventListener('click', () => sheet(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#rail').classList.contains('open')) sheet(false);
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName) || (document.activeElement && document.activeElement.isContentEditable);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); $('#q').focus(); }
  });
  $('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) $('#dlg').close(); });
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('online', () => { if (S.offline) reloadData(); });
}
function sheet(open) {
  $('#rail').classList.toggle('open', open);
  $('#rail-scrim').hidden = !open;
  document.body.classList.toggle('lock', open);
  (open ? $('#f-close') : $('#btn-filters')).focus();
}

/* ---------- routing ---------- */
function applyHash() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'item' && b) { openItem(decodeURIComponent(b)); return; }
  if (S.drawerOpen) mod('drawer').then(m => m.closeDrawer(api, { keepHash: true }));
  if (['oman', 'gcc', 'global', 'plan'].includes(a) && a !== S.region) { S.region = a; setUi({ region: a }); schedule(); }
  else if (a === 'competitions') { S.region = 'oman'; S.type = 'competition'; schedule(); }
}

/* ---------- boot ---------- */
async function reloadData() {
  try { const d = await loadData(true); cacheData(d); S.offline = false; setData(d); schedule({ all: true }); return d; } catch { return null; }
}

const api = {
  S, user, store, CFG, ui, t, fmt, relText, tx, card, ring, stampEl, deadlineEl, badge,
  item: id => S.byId.get(id), result: id => S.scores.get(id),
  order: () => S.order, items: () => S.items.filter(live),
  setPlan, setNote, dismiss, restore, setUi, applyUi, save, recompute, schedule, go, toast,
  openItem, openTune, openSettings, openMenu, closeMenu, calendarMenu, shareMenu, downloadIcs, itemUrl, digest,
  setLang, copyText, renderRefreshButtons, loadData, cacheData, setData, normalize,
  setBusy: b => { S.scanBusy = b; renderRefreshButtons(); },
  rerenderChrome: () => { applyStatic(); schedule({ all: true }); },
  mod
};

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

function registerSW() {
  const local = location.hostname === 'localhost';
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || (local && /[?&]sw=1/.test(location.search)))) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const ready = w => toast(t('update.ready'), { action: { label: t('update.reload'), fn: () => { w.postMessage('skipWaiting'); } } });
    if (reg.waiting && navigator.serviceWorker.controller) ready(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ready(w); });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

async function init() {
  drawContours();
  wire();
  applyStatic();
  $('#results').replaceChildren(el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }));
  let data = null;
  try { data = await loadData(); cacheData(data); } catch {
    try { const c = store.json('cache', null); data = c ? normalize(c) : null; S.offline = !!data; } catch { data = null; }
  }
  if (!data) {
    $('#results').replaceChildren(el('div', { class: 'empty' }, el('h3', { text: t('load.fail') }), el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => location.reload(), text: t('load.retry') })));
    return;
  }
  setData(data);
  const [a] = location.hash.replace(/^#\/?/, '').split('/');
  if (['oman', 'gcc', 'global', 'plan'].includes(a)) S.region = a;
  if (a === 'competitions') { S.region = 'oman'; S.type = 'competition'; }
  schedule({ all: true });
  applyHash();
  idle(() => {
    registerSW();
    mod('refresh').then(m => m.adopt(api));
    mod('drawer'); mod('dialogs');
  });
  setTimeout(() => { save({ seen: new Set([...user.seen, ...S.items.map(i => i.id)]) }); }, 4000);
}

init();
