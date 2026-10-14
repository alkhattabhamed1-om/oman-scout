// Refresh: starts the GitHub Actions scan from the page and follows it until the new data is live.
// The scan runs on GitHub; this file only dispatches the workflow, reads its progress and reloads data.
import { $, el, icon } from './dom.js';

const GH = 'https://api.github.com';
const rf = { phase: 'idle', runId: null, runUrl: null, startedAt: 0, jobs: [], status: null, error: null, timer: null, tick: null, before: null, prevGen: null, summary: null };
const busy = () => ['starting', 'queued', 'running'].includes(rf.phase);
let depth = 'thorough';

function gh(api, path, opts = {}) {
  const token = api.store.get('token');
  return fetch(GH + path, {
    ...opts, credentials: 'omit', cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) }
  });
}
const sig = it => [it.start, it.end, it.deadline, it.eligibility, it.confidence].join('|');
const snapshot = api => new Map(api.S.items.map(i => [i.id, sig(i)]));
const elapsed = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function stage(state, label, small) {
  return el('li', { class: 'step ' + state }, el('span', { class: 'mark' }, state === 'ok' ? icon('check') : null), el('span', { text: label }), el('small', { text: small || '' }));
}
const jobState = j => (j.status === 'completed' ? (j.conclusion === 'success' ? 'ok' : 'bad') : j.status === 'in_progress' ? 'run' : '');

function tokenForm(api) {
  const { t, store } = api;
  const input = el('input', { id: 'tok', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
  const create = 'https://github.com/settings/personal-access-tokens/new?name=' + encodeURIComponent('Oman Scout refresh') + '&description=' + encodeURIComponent('Starts the Oman Scout scan from my site') + '&actions=write&metadata=read';
  return el('div', { class: 'tok' },
    el('h3', { class: 'dlg-h', text: t('rf.token.title') }),
    el('p', { class: 'dlg-p', text: t('rf.token.body') }),
    el('div', { class: 'field' }, el('label', { for: 'tok', text: t('rf.token.label') }), input),
    el('div', { class: 'dlg-actions' },
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: t('rf.token.save'), onclick: () => { const v = input.value.trim(); if (!v) { input.focus(); return; } store.set('token', v); api.toast(t('toast.token')); render(api); } }),
      el('a', { class: 'btn btn-soft btn-sm', href: create, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), t('rf.token.create'))));
}

function render(api) {
  const { t, CFG, store } = api;
  const dlg = $('#dlg');
  const hasToken = !!store.get('token');
  const wf = CFG.repo ? `https://github.com/${CFG.repo}/actions/workflows/${CFG.workflow}` : null;
  const parts = [el('div', { class: 'dlg-top' }, el('h2', { id: 'dlg-title', text: t('rf.title') }), el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('rf.close'), onclick: () => dlg.close() }, icon('x')))];

  if (!CFG.repo) parts.push(el('p', { class: 'note', text: t('rf.norepo') }));
  else if (busy() || rf.phase === 'done' || rf.phase === 'failed') {
    const discover = rf.jobs.filter(j => /^discover/i.test(j.name));
    const rest = rf.jobs.filter(j => !/^discover/i.test(j.name));
    const rows = [];
    if (!discover.length) rows.push(stage(rf.phase === 'failed' ? 'bad' : 'run', t('rf.step.queue')));
    discover.forEach(j => {
      const id = (j.name.match(/\(([^)]+)\)/) || [])[1] || j.name;
      const label = t('task.' + id);
      rows.push(stage(jobState(j), label === 'task.' + id ? id : label));
    });
    if (discover.length) rows.push(stage(rest.length ? (rest.every(j => j.status === 'completed' && j.conclusion === 'success') ? 'ok' : rest.some(j => j.status === 'in_progress') ? 'run' : rest.some(j => j.conclusion === 'failure') ? 'bad' : '') : '', t('rf.stage.finalize')));
    parts.push(el('p', { class: 'dlg-p', text: t('rf.intro') }), el('ol', { class: 'steps' }, rows));
    if (busy()) parts.push(el('p', { class: 'note', id: 'rf-elapsed', text: t('rf.elapsed', { t: elapsed(Date.now() - rf.startedAt) }) }));
    if (rf.phase === 'done') parts.push(el('p', { class: 'note good', text: t('rf.done') + (rf.summary ? ' ' + rf.summary : '') }));
    if (rf.phase === 'failed') parts.push(el('p', { class: 'note bad', text: t('rf.fail') + ' ' + t('rf.fail.hint') }));
    if (rf.runUrl) parts.push(el('div', { class: 'dlg-actions' }, el('a', { class: 'btn btn-soft btn-sm', href: rf.runUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), t('rf.openlog'))));
  } else {
    parts.push(el('p', { class: 'dlg-p', text: t('rf.intro') }));
    if (rf.error) parts.push(el('p', { class: 'note bad', text: rf.error }));
    const pick = v => el('button', { type: 'button', class: 'depth' + (depth === v ? ' on' : ''), 'aria-pressed': String(depth === v), onclick: () => { depth = v; store.set('depth', v); render(api); } },
      el('strong', { text: t('rf.' + v) }), el('span', { text: t('rf.' + v + '.d') }));
    parts.push(el('div', { class: 'depths', role: 'group', 'aria-label': t('rf.depth') }, pick('quick'), pick('thorough')));
    if (hasToken) parts.push(el('div', { class: 'dlg-actions' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: () => start(api) }, icon('refresh'), t('rf.start')),
      el('button', { class: 'link-btn', type: 'button', onclick: () => { store.del('token'); api.toast(t('toast.tokenoff')); render(api); }, text: t('rf.token.remove') })));
    else parts.push(tokenForm(api));
    parts.push(el('p', { class: 'dlg-p' }, t('rf.alt') + ' ', wf ? el('a', { href: wf, target: '_blank', rel: 'noopener noreferrer', text: t('rf.alt.link') }) : null));
  }
  dlg.replaceChildren(el('div', { class: 'dlg' }, parts));
  dlg.setAttribute('aria-labelledby', 'dlg-title');
}

/** Open the refresh dialog. */
export function openRefresh(api) {
  depth = api.store.get('depth') === 'quick' ? 'quick' : 'thorough';
  render(api);
  const dlg = $('#dlg');
  if (!dlg.open) dlg.showModal();
}

async function start(api) {
  const { t, CFG } = api;
  Object.assign(rf, { error: null, runId: null, runUrl: null, jobs: [], status: null, summary: null, phase: 'starting', startedAt: Date.now(), before: snapshot(api), prevGen: api.S.data && api.S.data.generatedAt });
  api.setBusy(true); render(api);
  try {
    const res = await gh(api, `/repos/${CFG.repo}/actions/workflows/${CFG.workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: CFG.branch, inputs: { depth } }) });
    if (res.status === 204) { rf.phase = 'queued'; ticker(api); poll(api); return; }
    rf.phase = 'idle';
    rf.error = res.status === 401 || res.status === 403 ? t('rf.err.auth') : res.status === 404 ? t('rf.err.404') : res.status === 422 ? t('rf.err.input') : t('rf.err.other', { s: res.status });
  } catch { rf.phase = 'idle'; rf.error = t('rf.err.net'); }
  api.setBusy(false); render(api);
}

function ticker(api) {
  clearInterval(rf.tick);
  rf.tick = setInterval(() => {
    const n = $('#rf-elapsed');
    if (n) n.textContent = api.t('rf.elapsed', { t: elapsed(Date.now() - rf.startedAt) });
    if (!busy()) clearInterval(rf.tick);
  }, 1000);
}

async function poll(api) {
  const { CFG } = api;
  clearTimeout(rf.timer);
  if (Date.now() - rf.startedAt > 90 * 60000) { rf.phase = 'failed'; api.setBusy(false); if ($('#dlg').open) render(api); return; }
  try {
    if (!rf.runId) {
      const r = await gh(api, `/repos/${CFG.repo}/actions/workflows/${CFG.workflow}/runs?event=workflow_dispatch&per_page=5`);
      if (r.ok) {
        const run = ((await r.json()).workflow_runs || []).find(x => Date.parse(x.created_at) >= rf.startedAt - 90000);
        if (run) { rf.runId = run.id; rf.runUrl = run.html_url; }
      }
    }
    if (rf.runId) {
      const [rr, jr] = await Promise.all([gh(api, `/repos/${CFG.repo}/actions/runs/${rf.runId}`), gh(api, `/repos/${CFG.repo}/actions/runs/${rf.runId}/jobs?per_page=40`)]);
      if (rr.ok) { const run = await rr.json(); rf.status = run.status; rf.runUrl = run.html_url; rf.conclusion = run.conclusion; }
      if (jr.ok) rf.jobs = (await jr.json()).jobs || [];
      if (rf.status === 'completed') { await finish(api, rf.conclusion === 'success'); return; }
      rf.phase = rf.status === 'in_progress' ? 'running' : 'queued';
    }
  } catch { /* try again on the next tick */ }
  if ($('#dlg').open) render(api);
  rf.timer = setTimeout(() => poll(api), 8000);
}

function summarize(api, d) {
  const t = api.t;
  if (!rf.before) return '';
  const now = new Map(d.items.map(i => [i.id, sig(i)]));
  let n = 0, c = 0, r = 0;
  now.forEach((s, id) => { if (!rf.before.has(id)) n++; else if (rf.before.get(id) !== s) c++; });
  rf.before.forEach((_s, id) => { if (!now.has(id)) r++; });
  return n + c + r ? t('rf.summary', { n, c, r }) : t('rf.nodata');
}

async function finish(api, ok) {
  clearInterval(rf.tick);
  if (!ok) { rf.phase = 'failed'; api.setBusy(false); if ($('#dlg').open) render(api); return; }
  rf.phase = 'done'; api.setBusy(false); if ($('#dlg').open) render(api);
  for (let i = 0; i < 24; i++) {
    try {
      const d = await api.loadData(true);
      if (!rf.prevGen || d.generatedAt !== rf.prevGen) {
        rf.summary = summarize(api, d);
        api.cacheData(d); api.S.offline = false; api.setData(d); api.schedule({ all: true });
        api.toast(api.t('toast.updated') + ': ' + rf.summary);
        if ($('#dlg').open) render(api);
        return;
      }
    } catch { /* the site may still be redeploying */ }
    await new Promise(r => setTimeout(r, 6000));
  }
}

/** If a scan is already running (started elsewhere), follow it. */
export async function adopt(api) {
  const { CFG } = api;
  if (!CFG.repo || busy()) return;
  try {
    const r = await gh(api, `/repos/${CFG.repo}/actions/workflows/${CFG.workflow}/runs?per_page=1`);
    if (!r.ok) return;
    const run = ((await r.json()).workflow_runs || [])[0];
    if (run && run.status !== 'completed' && Date.now() - Date.parse(run.created_at) < 100 * 60000) {
      Object.assign(rf, { runId: run.id, runUrl: run.html_url, startedAt: Date.parse(run.created_at), phase: run.status === 'in_progress' ? 'running' : 'queued', before: snapshot(api), prevGen: api.S.data && api.S.data.generatedAt });
      api.setBusy(true); ticker(api); poll(api);
    }
  } catch { /* offline or rate limited */ }
}
