// My plan: saved items grouped by status or by date, with a status switcher and the note under each.
import { el, icon } from './dom.js';
import * as D from '../lib/dates.js';
import { planStatuses } from '../lib/store.js';

let mode = 'status';

function planText(api, items) {
  const { t, user, S } = api;
  const lines = [t('plan.header'), ''];
  for (const it of items) {
    const a = D.actionDate(it, S.today) || it.start || it.deadline;
    const e = user.plan[it.id];
    lines.push('• ' + it.title + (a ? ' (' + api.fmt(a, { day: 'numeric', month: 'short' }) + ')' : '') + ' [' + t('plan.' + e.status) + ']');
    if (e.note) lines.push('  ' + e.note.replace(/\s+/g, ' ').slice(0, 160));
    lines.push('  ' + api.itemUrl(it.id));
  }
  return lines.join('\n');
}

function entry(api, it) {
  const { t, user } = api;
  const e = user.plan[it.id];
  const switcher = el('div', { class: 'chip-row flow plan-status', role: 'group', 'aria-label': t('dr.status') }, planStatuses.map(s =>
    el('button', { type: 'button', class: 'chip-btn small' + (e.status === s ? ' on' : ''), 'aria-pressed': String(e.status === s), onclick: () => { api.setPlan(it.id, s); api.schedule({}); } }, t('plan.' + s))));
  return el('div', { class: 'plan-item' }, api.card(it), switcher,
    e.note ? el('p', { class: 'plan-note', dir: 'auto' }, icon('note'), e.note) : null);
}

/** Render the plan view into box. items arrive filtered; the plan orders them itself. */
export function renderPlan(box, api, items) {
  const { t, user, S } = api;
  if (!items.length) {
    box.replaceChildren(el('div', { class: 'empty' }, icon('bookmark'), el('h3', { text: t('plan.empty.title') }), el('p', { text: t('plan.empty.body') })));
    return;
  }
  const dateKey = it => { const a = D.actionDate(it, S.today) || D.anchorDate(it, S.today); return a ? D.clampToToday(a, S.today) : '9999-99-99'; };
  const byDate = [...items].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  const tools = el('div', { class: 'plan-tools' },
    el('div', { class: 'seg', role: 'group' }, ['status', 'deadline'].map(m =>
      el('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: () => { mode = m; renderPlan(box, api, items); } }, t('plan.by.' + m)))),
    el('button', { class: 'btn btn-sm btn-soft', type: 'button', onclick: () => api.downloadIcs(byDate, 'my-plan.ics') }, icon('calplus'), t('plan.ics')),
    el('button', { class: 'btn btn-sm btn-soft', type: 'button', onclick: async () => { const ok = await api.copyText(planText(api, byDate)); api.toast(ok ? t('plan.copied') : t('share.copied')); } }, icon('copy'), t('plan.copy')));
  const wrap = el('div', { class: 'cards' });
  if (mode === 'status') {
    for (const s of planStatuses) {
      const group = byDate.filter(it => user.plan[it.id].status === s);
      if (!group.length) continue;
      wrap.append(el('h2', { class: 'group-h' }, t('plan.' + s), el('span', { class: 'n', text: String(group.length) })));
      group.forEach(it => wrap.append(entry(api, it)));
    }
  } else byDate.forEach(it => wrap.append(entry(api, it)));
  box.replaceChildren(tools, wrap);
}
