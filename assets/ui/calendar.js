// Month calendar of the items currently shown. Oman's weekend (Friday and Saturday) is tinted,
// deadlines are rings, running events are dots in their region's colour.
import { el, icon } from './dom.js';
import * as D from '../lib/dates.js';

let month = null;
let day = null;

/** Render the calendar and the agenda under it into box. */
export function renderCalendar(box, api, items) {
  const { t, S, fmt } = api;
  const key = month || S.today.slice(0, 7);
  const [cy, cm] = key.split('-').map(Number);
  const dim = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const lead = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay();
  const rows = Math.ceil((lead + dim) / 7);

  const map = new Map();
  const put = (d, it, type) => { if (!map.has(d)) map.set(d, []); map.get(d).push({ it, type }); };
  items.forEach(it => {
    if (it.start) {
      const end = it.end && it.end >= it.start ? it.end : it.start;
      const span = Math.min(D.diffDays(it.start, end), 45);
      for (let i = 0; i <= span; i++) put(D.addDays(it.start, i), it, 'range');
    }
    if (it.deadline) put(it.deadline, it, 'dl');
  });

  const sunday = new Date(Date.UTC(2024, 0, 7));
  const dows = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(sunday.getTime() + i * 86400000)));

  const cells = [];
  for (let i = 0; i < rows * 7; i++) {
    const n = i - lead + 1;
    const date = new Date(Date.UTC(cy, cm - 1, n)).toISOString().slice(0, 10);
    const inMonth = n >= 1 && n <= dim;
    const marks = map.get(date) || [];
    const seen = new Set();
    const dots = [];
    marks.forEach(m => { const k = m.it.region + m.type; if (!seen.has(k) && dots.length < 6) { seen.add(k); dots.push(el('i', { class: m.it.region + (m.type === 'dl' ? ' dl' : '') })); } });
    cells.push(el('button', {
      class: 'cal-cell' + (inMonth ? '' : ' out') + (i % 7 >= 5 ? ' wk' : '') + (date === S.today ? ' today' : ''), type: 'button',
      'aria-pressed': String(day === date), 'data-date': date,
      'aria-label': fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }) + (marks.length ? ' · ' + marks.length : ''),
      onclick: () => { day = day === date ? null : date; renderCalendar(box, api, items); }
    }, el('span', { class: 'cal-n', text: fmt(date, { day: 'numeric' }) }), el('span', { class: 'cal-dots' }, dots)));
  }

  const nav = dir => { month = new Date(Date.UTC(cy, cm - 1 + dir, 1)).toISOString().slice(0, 7); day = null; renderCalendar(box, api, items); };
  const title = fmt(key + '-01', { month: 'long', year: 'numeric' });
  const cal = el('section', { class: 'cal', 'aria-label': title },
    el('div', { class: 'cal-head' },
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cal.prev'), onclick: () => nav(-1) }, icon('left', 'flip')),
      el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => { month = S.today.slice(0, 7); day = S.today; renderCalendar(box, api, items); }, text: t('cal.today') }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cal.next'), onclick: () => nav(1) }, icon('right', 'flip'))),
    el('div', { class: 'cal-grid' }, dows.map((d, i) => el('div', { class: 'cal-dow' + (i >= 5 ? ' wk' : ''), text: d })), cells),
    el('div', { class: 'cal-legend' },
      el('span', {}, el('i'), t('cal.legend.range')), el('span', {}, el('i', { class: 'dl' }), t('cal.legend.deadline')),
      ['oman', 'gcc', 'global'].map(r => el('span', {}, el('span', { class: 'dot ' + r }), t('region.' + r)))));

  const list = day
    ? [...new Map((map.get(day) || []).map(m => [m.it.id, m.it])).values()]
    : items.filter(it => { const a = D.clampToToday(D.anchorDate(it, S.today), S.today); return a && a.slice(0, 7) === key; });
  const head = day ? fmt(day, { weekday: 'long', day: 'numeric', month: 'long' }) : t('cal.agenda');
  box.replaceChildren(cal,
    el('h2', { class: 'group-h' }, head, el('span', { class: 'n', text: String(list.length) })),
    list.length ? el('div', { class: 'cards' }, list.map(api.card)) : el('p', { class: 'sum', text: day ? t('cal.none') : t('cal.hint') }));
}
