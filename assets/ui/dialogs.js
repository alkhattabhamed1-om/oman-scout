// Two dialogs: "Tune your feed" (interests and priorities that drive the ranking) and Settings.
import { $, el, icon } from './dom.js';
import { pickTop, mergePrefs, DEFAULT_PREFS } from '../lib/rank.js';
import { TOPICS, topicLabel } from '../lib/topics.js';
import { exportUser, importUser, loadUser, resetUser } from '../lib/store.js';

function show(content) {
  const dlg = $('#dlg');
  dlg.replaceChildren(el('div', { class: 'dlg' }, content));
  if (!dlg.open) dlg.showModal();
  return dlg;
}
const closeBtn = (api, dlg) => el('button', { class: 'icon-btn', type: 'button', 'aria-label': api.t('rf.close'), onclick: () => dlg.close() }, icon('x'));
const top = (api, title, id) => el('div', { class: 'dlg-top' }, el('h2', { id: 'dlg-title', text: title }), closeBtn(api, $('#dlg')));

function seg(options, current, onPick, label) {
  const box = el('div', { class: 'seg wide', role: 'group', 'aria-label': label || '' });
  const paint = v => options.forEach((o, i) => box.children[i].setAttribute('aria-pressed', String(o.value === v)));
  options.forEach(o => box.append(el('button', { type: 'button', onclick: () => { paint(o.value); onPick(o.value); } }, o.label)));
  paint(current);
  return box;
}

/** Open the tune dialog; saving rewrites the user's preferences and re-ranks everything. */
export function openTune(api) {
  const { t, S, user } = api;
  const draft = { interests: [...user.prefs.interests], typeWeights: { ...user.prefs.typeWeights }, reach: user.prefs.reach, learn: user.prefs.learn };
  const preview = el('ol', { class: 'tune-picks' });
  const chips = el('div', { class: 'chip-row flow' });

  const paintPreview = () => {
    const mine = api.items().filter(it => it.eligibility !== 'ineligible' && !user.dismissed.has(it.id));
    const picks = pickTop(mine, { today: S.today, prefs: mergePrefs(draft), affinity: {} }, 3);
    preview.replaceChildren(...picks.map(({ item, result }) => el('li', {}, api.ring(result, 'sm'), el('span', { lang: S.lang === 'ar' && item.ar ? 'ar' : 'en', dir: 'auto', text: api.tx(item, 'title').text }))));
  };
  const paintChips = () => chips.replaceChildren(...TOPICS.map(x => {
    const on = draft.interests.includes(x.id);
    return el('button', { type: 'button', class: 'chip-btn' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => {
      draft.interests = on ? draft.interests.filter(i => i !== x.id) : [...draft.interests, x.id];
      paintChips(); paintPreview();
    } }, topicLabel(x.id, S.lang));
  }));
  paintChips(); paintPreview();

  const competitionsFirst = draft.typeWeights.competition >= 1.2;
  const dlg = show([
    top(api, t('tune.title')),
    el('p', { class: 'dlg-p', text: t('tune.intro') }),
    el('h3', { class: 'dlg-h', text: t('tune.topics') }), chips,
    el('h3', { class: 'dlg-h', text: t('tune.priority') }),
    seg([{ value: 'comp', label: t('tune.prio.comp') }, { value: 'bal', label: t('tune.prio.bal') }], competitionsFirst ? 'comp' : 'bal', v => {
      draft.typeWeights = v === 'comp' ? { ...DEFAULT_PREFS.typeWeights } : { competition: 1, event: 1, funding: 1, competitor: 0.8 };
      paintPreview();
    }, t('tune.priority')),
    el('h3', { class: 'dlg-h', text: t('tune.reach') }),
    seg(['local', 'gcc', 'far'].map(v => ({ value: v, label: t('tune.reach.' + v) })), draft.reach, v => { draft.reach = v; paintPreview(); }, t('tune.reach')),
    el('label', { class: 'opt tune-learn' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = draft.learn; c.addEventListener('change', () => { draft.learn = c.checked; }); return c; })(), el('span', { text: t('tune.learn') })),
    el('h3', { class: 'dlg-h', text: t('tune.preview') }), preview,
    el('div', { class: 'dlg-actions' },
      el('button', { class: 'btn btn-primary', type: 'button', text: t('tune.done'), onclick: () => {
        user.prefs = mergePrefs(draft);
        api.save({ prefs: user.prefs });
        api.setUi({ onboarded: true });
        api.recompute();
        api.rerenderChrome();
        $('#dlg').close();
        api.toast(t('toast.saved'));
      } }),
      el('button', { class: 'link-btn', type: 'button', text: t('tune.reset'), onclick: () => { user.prefs = mergePrefs(DEFAULT_PREFS); api.save({ prefs: user.prefs }); api.recompute(); api.rerenderChrome(); openTune(api); } }))
  ]);
  dlg.setAttribute('aria-labelledby', 'dlg-title');
}

/** Open settings: appearance, calendar feed, install, my data, refresh access, about. */
export function openSettings(api) {
  const { t, S, ui, store } = api;
  const section = (title, ...kids) => el('section', { class: 'set-sec' }, el('h3', { class: 'dlg-h', text: title }), ...kids);
  const feed = new URL('data/oman-scout.ics', location.href);
  const webcal = feed.href.replace(/^https?:/, 'webcal:');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const data = api.S.data;
  const confirmed = api.S.items.filter(i => i.confidence === 'confirmed').length;

  const appearance = section(t('set.lang'),
    seg([{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }], S.lang, v => { api.setLang(v); openSettings(api); }, t('set.lang')),
    el('h3', { class: 'dlg-h', text: t('set.theme') }),
    seg(['system', 'light', 'dark'].map(v => ({ value: v, label: t('theme.' + v) })), ui.theme, v => { api.setUi({ theme: v }); api.applyUi(); api.rerenderChrome(); }, t('set.theme')),
    el('h3', { class: 'dlg-h', text: t('set.size') }),
    seg(['s', 'm', 'l'].map(v => ({ value: v, label: t('size.' + v) })), ui.textScale, v => { api.setUi({ textScale: v }); api.applyUi(); }, t('set.size')),
    el('h3', { class: 'dlg-h', text: t('set.density') }),
    seg(['comfortable', 'compact'].map(v => ({ value: v, label: t('density.' + v) })), ui.density, v => { api.setUi({ density: v }); api.applyUi(); api.rerenderChrome(); }, t('set.density')),
    el('h3', { class: 'dlg-h', text: t('set.motion') }),
    seg(['system', 'reduce'].map(v => ({ value: v, label: t('motion.' + v) })), ui.motion, v => { api.setUi({ motion: v }); api.applyUi(); }, t('set.motion')));

  const calendar = section(t('set.calendar'), el('p', { class: 'dlg-p', text: t('set.calendar.body') }),
    el('div', { class: 'dlg-actions' },
      el('a', { class: 'btn btn-soft btn-sm', href: webcal }, icon('calplus'), t('set.calendar.sub')),
      el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: async () => { api.toast((await api.copyText(feed.href)) ? t('toast.copied') : feed.href); } }, icon('copy'), t('set.calendar.copy'))));

  let install = null;
  if (!standalone && S.installEvt) install = section(t('set.install'), el('p', { class: 'dlg-p', text: t('set.install.body') }),
    el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: t('set.install.btn'), onclick: async () => { S.installEvt.prompt(); S.installEvt = null; $('#dlg').close(); } }));
  else if (!standalone && ios) install = section(t('set.install'), el('p', { class: 'dlg-p', text: t('set.install.ios') }));

  const code = el('textarea', { rows: '3', 'aria-label': t('set.import.ph'), placeholder: t('set.import.ph'), spellcheck: 'false' });
  const msg = el('p', { class: 'dlg-p', role: 'status' });
  let armed = false;
  const mydata = section(t('set.data'), el('p', { class: 'dlg-p', text: t('set.data.body') }),
    el('div', { class: 'dlg-actions' }, el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: async () => { api.toast((await api.copyText(exportUser(store))) ? t('set.export.done') : t('set.import.bad')); } }, icon('copy'), t('set.export'))),
    code,
    el('div', { class: 'dlg-actions' }, el('button', { class: 'btn btn-soft btn-sm', type: 'button', text: t('set.import.go'), onclick: () => {
      const r = importUser(store, code.value);
      if (!r.ok) { msg.textContent = t('set.import.bad'); return; }
      const fresh = loadUser(store);
      api.user.prefs = fresh.prefs; api.user.plan = fresh.plan; api.user.dismissed = fresh.dismissed;
      api.recompute(); api.rerenderChrome();
      msg.textContent = t('set.import.ok', { plan: r.counts.plan, dismissed: r.counts.dismissed });
    } })), msg,
    el('div', { class: 'dlg-actions' }, (() => {
      const b = el('button', { class: 'link-btn danger', type: 'button', text: t('set.reset') });
      b.addEventListener('click', () => {
        if (!armed) { armed = true; b.textContent = t('set.reset.confirm'); return; }
        resetUser(store); location.reload();
      });
      return b;
    })()));

  const hasToken = !!store.get('token');
  const access = hasToken ? section(t('rf.token.title'), el('div', { class: 'dlg-actions' }, el('button', { class: 'link-btn', type: 'button', text: t('rf.token.remove'), onclick: () => { store.del('token'); api.toast(t('toast.tokenoff')); openSettings(api); } }))) : null;

  const about = section(t('set.about'), el('p', { class: 'dlg-p', text: t('set.about.body') }),
    el('p', { class: 'dlg-p muted', text: t('set.about.stats', { n: data.items.length, c: confirmed }) }));

  const dlg = show([top(api, t('set.title')), appearance, calendar, install, mydata, access, about]);
  dlg.setAttribute('aria-labelledby', 'dlg-title');
}
