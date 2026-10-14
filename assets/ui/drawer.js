// Detail drawer: everything about one item, why it ranks where it does, and the user's own
// plan status and notes. Side sheet on desktop, bottom sheet on phones. Deep link: #/item/<id>.
import { $, $$, el, icon, safeUrl } from './dom.js';
import * as D from '../lib/dates.js';
import { reasonParams } from '../lib/rank.js';
import { topicLabel } from '../lib/topics.js';
import { mapsUrl } from '../lib/ics.js';
import { planStatuses } from '../lib/store.js';

let wired = false;
let lastFocus = null;
let noteTimer;
let current = null;

const PARTS = ['fit', 'topic', 'eligibility', 'timing', 'confidence', 'reach'];

function section(title, ...kids) {
  return el('section', { class: 'dr-sec' }, el('h3', { text: title }), ...kids);
}
function row(label, value) {
  return value ? el('div', { class: 'dr-row' }, el('dt', { text: label }), el('dd', {}, value)) : null;
}

function verification(api, it) {
  const { t, fmt } = api;
  const v = it.verified;
  const lines = [];
  if (v && v.agent) lines.push(t('ver.agent.' + v.agent));
  if (v && v.linkOk === true) lines.push(t('ver.link.ok'));
  if (v && v.linkOk === false) lines.push(t('ver.link.bad'));
  if (v && v.dateOnPage === true) lines.push(t('ver.date.yes'));
  if (v && v.dateOnPage === false) lines.push(t('ver.date.no'));
  if (!lines.length) lines.push(t('ver.none'));
  const conf = it.confidence || 'unverified';
  return el('div', {},
    el('p', { class: 'conf ' + conf }, el('i'), el('strong', { text: t('conf.' + conf) }), ' · ' + t('conf.' + conf + '.d')),
    el('ul', { class: 'dr-list' }, lines.map(l => el('li', { text: l }))),
    v && v.checkedAt ? el('p', { class: 'dr-muted', text: fmt(v.checkedAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }) }) : null,
    v && v.note ? el('p', { class: 'dr-muted', lang: 'en', dir: 'auto', text: v.note }) : null);
}

function planBlock(api, it) {
  const { t, user } = api;
  const entry = user.plan[it.id];
  const status = entry && entry.status;
  const chips = planStatuses.map(s => el('button', { type: 'button', class: 'chip-btn' + (status === s ? ' on' : ''), 'aria-pressed': String(status === s), onclick: () => { api.setPlan(it.id, status === s ? null : s); api.schedule({}); render(api, it, { keepScroll: true }); } }, t('plan.' + s)));
  const note = el('textarea', { id: 'dr-note', rows: '3', maxlength: '2000', placeholder: t('dr.notes.ph'), 'aria-label': t('dr.notes') });
  note.value = (entry && entry.note) || '';
  note.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { api.setNote(it.id, note.value); api.schedule({}); }, 450);
  });
  return section(t('dr.status'), el('div', { class: 'chip-row flow' }, chips), el('label', { class: 'dr-label', for: 'dr-note', text: t('dr.notes') }), note);
}

function render(api, it, opts = {}) {
  const { t, fmt, tx, S } = api;
  current = it.id;
  const dr = $('#drawer');
  const res = api.result(it.id);
  const title = tx(it, 'title');
  const sum = tx(it, 'summary');
  const why = tx(it, 'why');
  const note = tx(it, 'eligibilityNote');
  const fitNote = tx(it, 'fitNote');
  const order = api.order();
  const at = order.indexOf(it.id);
  const prev = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const main = safeUrl(it.applyUrl) || (it.sources || []).map(s => safeUrl(s.url)).find(Boolean);
  const hasDate = !!(it.start || it.deadline);
  const long = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const hijri = it.start || it.deadline ? D.hijriDate(it.start || it.deadline, S.lang) : '';
  const maps = mapsUrl(it);
  const scroller = dr.querySelector('.dr-body');
  const top = opts.keepScroll && scroller ? scroller.scrollTop : 0;

  const head = el('header', { class: 'dr-head' },
    el('div', { class: 'dr-nav' },
      el('button', { type: 'button', class: 'icon-btn small', disabled: prev ? null : '', 'aria-label': t('dr.prev'), onclick: () => prev && openDrawer(api, prev) }, icon('left', 'flip')),
      el('button', { type: 'button', class: 'icon-btn small', disabled: next ? null : '', 'aria-label': t('dr.next'), onclick: () => next && openDrawer(api, next) }, icon('right', 'flip')),
      el('span', { class: 'dr-pos', text: at >= 0 ? (at + 1) + ' / ' + order.length : '' }),
      el('button', { type: 'button', class: 'icon-btn dr-close', 'aria-label': t('dr.close'), onclick: () => closeDrawer(api) }, icon('x'))),
    el('div', { class: 'badges' }, api.badge('cat', icon(it.category === 'competition' ? 'trophy' : it.category === 'event' ? 'calendar' : it.category === 'funding' ? 'landmark' : 'radar'), t('catS.' + it.category)),
      api.badge('', el('span', { class: 'dot ' + it.region }), t('region.' + it.region)),
      api.badge(({ eligible: 'green', likely: 'green', check: 'amber', na: 'grey', ineligible: 'red' })[it.eligibility], t('elig.' + it.eligibility))),
    el('div', { class: 'dr-title-row' }, el('h2', { id: 'dr-title', lang: title.lang, dir: 'auto', text: title.text }), api.ring(res)));

  const actions = el('div', { class: 'actions' },
    main ? el('a', { class: 'act primary', href: main, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), safeUrl(it.applyUrl) ? t('card.apply') : t('card.source')) : null,
    hasDate ? el('button', { class: 'act', type: 'button', 'data-menu': '', onclick: e => api.calendarMenu(e.currentTarget, it) }, icon('calplus'), t('card.cal')) : null,
    el('button', { class: 'act', type: 'button', 'data-menu': '', onclick: e => api.shareMenu(e.currentTarget, it) }, icon('share'), t('card.share')),
    el('button', { class: 'act quiet', type: 'button', onclick: () => { api.dismiss(it.id); closeDrawer(api); } }, t('card.dismiss')));

  const dates = el('dl', { class: 'dr-dl' },
    row(t('card.start'), it.start ? fmt(it.start, long) : null),
    row(t('card.end'), it.end && it.end !== it.start ? fmt(it.end, long) : null),
    row(t('card.deadline'), it.deadline ? fmt(it.deadline, long) : null),
    row(t('card.hijri'), hijri || null),
    row('', it.dateNote ? el('span', { lang: 'en', dir: 'auto', text: it.dateNote }) : null));

  const place = el('dl', { class: 'dr-dl' },
    row(t('dr.place'), it.location ? el('span', {}, it.location, maps ? [' · ', el('a', { href: maps, target: '_blank', rel: 'noopener noreferrer', text: t('dr.map') })] : '') : null),
    row(t('card.cost'), it.cost), row(t('card.prize'), it.prize), row(t('dr.team'), it.teamSize), row(t('card.organizer'), it.organizer));

  const bars = el('ul', { class: 'dr-bars' }, PARTS.map(k => el('li', {}, el('span', { text: t('part.' + k) }), el('span', { class: 'bar-track' }, el('i', { style: { '--w': Math.round(((res && res.parts[k]) || 0) * 100) + '%' } })))));
  const reasons = el('ul', { class: 'dr-list' }, (res ? res.reasons : []).map(r => el('li', { text: t(r.key, reasonParams(r, S.lang)) })));
  const topics = (it.topics || []).length ? el('div', { class: 'chip-row flow' }, it.topics.map(id => el('span', { class: 'topic-chip', text: topicLabel(id, S.lang) }))) : null;
  const sources = (it.sources || []).map(s => ({ ...s, href: safeUrl(s.url) })).filter(s => s.href);

  dr.replaceChildren(head, el('div', { class: 'dr-body' },
    actions,
    sum.text ? section(t('dr.summary'), el('p', { lang: sum.lang, dir: 'auto', text: sum.text }), topics) : null,
    why.text ? section(t('card.why'), el('p', { lang: why.lang, dir: 'auto', text: why.text })) : null,
    section(t('dr.rank'), fitNote.text ? el('p', { class: 'dr-muted', lang: fitNote.lang, dir: 'auto', text: fitNote.text }) : null, reasons, bars),
    section(t('card.elig'), el('p', { lang: note.lang, dir: 'auto' }, el('strong', { text: t('elig.' + it.eligibility) }), note.text ? ' · ' + note.text : '')),
    dates.children.length ? section(t('card.dates'), dates) : null,
    place.children.length ? section(t('dr.place'), place) : null,
    section(t('dr.verify'), verification(api, it)),
    sources.length ? section(t('card.sources'), el('ul', { class: 'srcs' }, sources.map(s => el('li', {}, el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), s.label || new URL(s.href).hostname))))) : null,
    planBlock(api, it)));
  const body = dr.querySelector('.dr-body');
  if (body) body.scrollTop = top;
}

function wire(api) {
  if (wired) return;
  wired = true;
  $('#drawer-scrim').addEventListener('click', () => closeDrawer(api));
  document.addEventListener('keydown', e => {
    if (!api.S.drawerOpen) return;
    if (e.key === 'Escape') { if (!document.querySelector('.menu')) closeDrawer(api); return; }
    if (e.key !== 'Tab') return;
    const f = $$('#drawer a[href], #drawer button:not([disabled]), #drawer textarea').filter(n => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/** Open (or move to) an item in the drawer and put its link in the address bar. */
export function openDrawer(api, id) {
  wire(api);
  const it = api.item(id);
  if (!it) { api.toast(api.t('dr.notfound')); history.replaceState(null, '', '#/' + (api.S.region || 'oman')); return; }
  const dr = $('#drawer');
  if (!api.S.drawerOpen) lastFocus = document.activeElement;
  render(api, it);
  dr.hidden = false; $('#drawer-scrim').hidden = false;
  requestAnimationFrame(() => dr.classList.add('open'));
  document.body.classList.add('lock');
  api.S.drawerOpen = id;
  const hash = '#/item/' + encodeURIComponent(id);
  if (location.hash !== hash) (location.hash.startsWith('#/item/') ? history.replaceState : history.pushState).call(history, null, '', hash);
  const c = dr.querySelector('.dr-close');
  if (c && !dr.contains(document.activeElement)) c.focus();
}

/** Close the drawer; clears the item from the address bar unless opts.keepHash. */
export function closeDrawer(api, opts = {}) {
  const dr = $('#drawer');
  if (!api.S.drawerOpen) return;
  clearTimeout(noteTimer);
  const ta = $('#dr-note');
  if (ta && current && (api.user.plan[current] || ta.value)) api.setNote(current, ta.value);
  api.S.drawerOpen = null; current = null;
  dr.classList.remove('open');
  setTimeout(() => { if (!api.S.drawerOpen) { dr.hidden = true; $('#drawer-scrim').hidden = true; dr.replaceChildren(); } }, 260);
  document.body.classList.remove('lock');
  if (!opts.keepHash && location.hash.startsWith('#/item/')) history.replaceState(null, '', '#/' + (api.S.region || 'oman'));
  api.schedule({});
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
