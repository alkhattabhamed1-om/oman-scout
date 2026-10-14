// Local storage for everything personal: preferences, plan, dismissed items, seen ids, the
// interface settings, and the export/import code that moves them between devices.
//
// Purpose: one tolerant layer over localStorage (injected, so tests and the pipeline can pass a
// fake). Reads and writes never throw. When storage is missing, blocked or full, values live in
// memory for the session instead, so the interface keeps working and only persistence is lost.
//
// Keys under the `scout.` namespace:
//   prefs, plan, dismissed, seen, recent, ui   JSON, written by saveUser
//   lang, theme, textScale, density, motion    plain-text mirrors of ui.* so assets/boot.js can set
//                                              the page before first paint without parsing JSON
//                                              ('system' theme and an unset lang delete their key)
//   saved                                      v1 list of saved ids, migrated to `plan` once and removed
//   cache, token                               the data cache and the GitHub token: owned by the
//                                              interface, never exported, never touched here
//
// Invariants: loadUser always returns well-formed data whatever is stored; importUser never throws
// and never imports anything outside prefs, plan and dismissed; exportUser never includes the token,
// the cache, the seen ids or the interface settings.

import { mergePrefs } from './rank.js';

export const planStatuses = Object.freeze(['interested', 'preparing', 'applied', 'going', 'done']);

const CATEGORIES = ['event', 'competition', 'competitor', 'funding'];
const MIRRORED = ['lang', 'theme', 'textScale', 'density', 'motion'];
const LEGACY_UI = ['lang', 'theme', 'region', 'cats', 'elig', 'range', 'reach', 'sort', 'view'];
const OWN_KEYS = ['prefs', 'plan', 'dismissed', 'seen', 'recent', 'ui', 'saved', ...MIRRORED, ...LEGACY_UI];

const CODE_PREFIX = 'scout1.';
const MAX_CODE_LENGTH = 2000000;
const MAX_NOTE = 2000;
const MAX_PLAN = 2000;
const MAX_DISMISSED = 3000;
const MAX_SEEN = 1500;
const MAX_RECENT = 8;
const MAX_QUERY = 80;

const UI_DEFAULTS = {
  view: 'list',
  region: 'oman',
  sort: 'best',
  density: 'comfortable',
  textScale: 'm',
  theme: 'system',
  lang: null,
  motion: 'system',
  elig: 'plus',
  range: 'all',
  reach: 'far',
  cats: CATEGORIES,
  onboarded: false
};

const UI_CHOICES = {
  view: ['list', 'cal'],
  region: ['oman', 'gcc', 'global', 'plan'],
  sort: ['best', 'date', 'deadline', 'new'],
  density: ['comfortable', 'compact'],
  textScale: ['s', 'm', 'l'],
  theme: ['system', 'light', 'dark'],
  lang: ['en', 'ar', null],
  motion: ['system', 'reduce'],
  elig: ['open', 'plus', 'all'],
  range: ['all', '30', '90', '180'],
  reach: ['local', 'gcc', 'far']
};

// ---------------------------------------------------------------- storage

/** The page's localStorage, or null when the browser denies access to it. */
export function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * A tolerant key-value store over a Storage-like object (or none). Values are strings;
 * json and setJson wrap JSON. set and setJson return true when the value reached storage.
 */
export function createStore(storage, ns = 'scout.') {
  const memory = new Map();

  function get(key, fallback = null) {
    if (memory.has(key)) return memory.get(key);
    try {
      const v = storage.getItem(ns + key);
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function set(key, value) {
    const v = String(value);
    try {
      storage.setItem(ns + key, v);
      memory.delete(key);
      return true;
    } catch {
      memory.set(key, v);
      return false;
    }
  }

  function del(key) {
    memory.delete(key);
    try { storage.removeItem(ns + key); } catch { /* storage unavailable: nothing to remove */ }
  }

  function json(key, fallback) {
    try {
      const v = JSON.parse(get(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setJson(key, value) {
    try {
      return set(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  return { get, set, del, json, setJson };
}

// ---------------------------------------------------------------- cleaning

const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const ID = /^[^\s\x00-\x1f]{1,200}$/;
const validId = id => typeof id === 'string' && ID.test(id) && !RESERVED_IDS.has(id);
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

function isoOrNull(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null;
}

function nowIso(now) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return d.toISOString();
}

function cleanEntry(raw, stamp) {
  const e = isObject(raw) ? raw : {};
  return {
    status: planStatuses.includes(e.status) ? e.status : 'interested',
    note: typeof e.note === 'string' ? e.note.slice(0, MAX_NOTE) : '',
    updatedAt: isoOrNull(e.updatedAt) || stamp
  };
}

// A plan is { [id]: { status, note, updatedAt } }; a plain list of ids (or a Map) is accepted too.
function cleanPlan(raw, stamp) {
  const plan = {};
  let entries = [];
  if (raw instanceof Map) entries = [...raw];
  else if (Array.isArray(raw)) entries = raw.map(id => [id, null]);
  else if (isObject(raw)) entries = Object.entries(raw);
  for (const [id, entry] of entries) {
    if (!validId(id)) continue;
    plan[id] = cleanEntry(entry, stamp);
    if (Object.keys(plan).length >= MAX_PLAN) break;
  }
  return plan;
}

// Ids keep their order; when over the cap the oldest (first) are dropped.
function cleanIds(raw, cap) {
  const list = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  return new Set(list.filter(validId).slice(-cap));
}

function cleanRecent(raw) {
  const out = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    const s = typeof q === 'string' ? q.trim().slice(0, MAX_QUERY) : '';
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

function simpleValue(v) {
  if (typeof v === 'string') return v.length <= 100;
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  return Array.isArray(v) && v.length <= 50 && v.every(x => typeof x === 'string' && x.length <= 100);
}

// Known settings are validated against their choices; unknown keys pass if they are small plain values.
function cleanUi(raw) {
  const src = isObject(raw) ? raw : {};
  const ui = {};
  for (const [key, fallback] of Object.entries(UI_DEFAULTS)) {
    const v = src[key];
    if (key === 'cats') {
      const cats = Array.isArray(v) ? [...new Set(v.filter(c => CATEGORIES.includes(c)))] : [];
      ui.cats = cats.length ? cats : [...CATEGORIES];
    } else if (key === 'onboarded') {
      ui.onboarded = v === true;
    } else {
      const choice = key === 'range' && typeof v === 'number' ? String(v) : v;
      ui[key] = UI_CHOICES[key].includes(choice) ? choice : fallback;
    }
  }
  for (const [key, v] of Object.entries(src)) {
    if (!(key in UI_DEFAULTS) && !RESERVED_IDS.has(key) && simpleValue(v)) ui[key] = v;
  }
  return ui;
}

// ---------------------------------------------------------------- v1 migration

// v1 kept each setting under its own key. A v1 sort of 'date' was only the default, so it is not carried over.
function legacyUi(store) {
  const ui = {};
  const lang = store.get('lang');
  if (lang) ui.lang = lang;
  const theme = store.get('theme');
  if (theme) ui.theme = theme;
  const region = store.get('region');
  if (region) ui.region = region === 'saved' ? 'plan' : region;
  const cats = store.json('cats', null);
  if (Array.isArray(cats)) ui.cats = cats;
  for (const key of ['elig', 'range', 'view']) {
    const v = store.get(key);
    if (v) ui[key] = v;
  }
  if (store.get('reach') === '1') ui.reach = 'gcc';
  const sort = store.get('sort');
  if (sort === 'deadline' || sort === 'new') ui.sort = sort;
  return ui;
}

// v1 saved ids become plan entries (status interested); existing plan entries are kept.
function migrateSaved(store, stamp) {
  if (store.get('saved') === null) return;
  const saved = store.json('saved', []);
  const plan = cleanPlan(store.json('plan', null), stamp);
  for (const id of Array.isArray(saved) ? saved : []) {
    if (validId(id) && !Object.hasOwn(plan, id)) plan[id] = cleanEntry(null, stamp);
  }
  if (store.setJson('plan', plan)) store.del('saved');
}

function loadUi(store) {
  const stored = store.json('ui', null);
  return cleanUi(isObject(stored) ? stored : legacyUi(store));
}

// ---------------------------------------------------------------- user data

/** Read everything personal, migrating v1 keys first: { prefs, plan, dismissed:Set, seen:Set, recent:string[], ui }. */
export function loadUser(store, now = new Date()) {
  const stamp = nowIso(now);
  migrateSaved(store, stamp);
  return {
    prefs: mergePrefs(store.json('prefs', null)),
    plan: cleanPlan(store.json('plan', null), stamp),
    dismissed: cleanIds(store.json('dismissed', []), MAX_DISMISSED),
    seen: cleanIds(store.json('seen', []), MAX_SEEN),
    recent: cleanRecent(store.json('recent', [])),
    ui: loadUi(store)
  };
}

function mirror(store, ui, keys) {
  for (const key of keys) {
    if (!MIRRORED.includes(key)) continue;
    const v = ui[key];
    if ((key === 'lang' && v === null) || (key === 'theme' && v === 'system')) store.del(key);
    else store.set(key, v);
  }
}

/**
 * Save part of the user data. `prefs` and `ui` are merged into what is stored (keys you leave out
 * are kept); `plan`, `dismissed`, `seen` and `recent` replace what is stored. Returns true when
 * every write reached storage.
 */
export function saveUser(store, patch, now = new Date()) {
  if (!isObject(patch)) return false;
  const stamp = nowIso(now);
  let ok = true;
  const write = (key, value) => { ok = store.setJson(key, value) && ok; };
  if (isObject(patch.prefs)) write('prefs', mergePrefs({ ...mergePrefs(store.json('prefs', null)), ...patch.prefs }));
  if ('plan' in patch) write('plan', cleanPlan(patch.plan, stamp));
  if ('dismissed' in patch) write('dismissed', [...cleanIds(patch.dismissed, MAX_DISMISSED)]);
  if ('seen' in patch) write('seen', [...cleanIds(patch.seen, MAX_SEEN)]);
  if ('recent' in patch) write('recent', cleanRecent(patch.recent));
  if (isObject(patch.ui)) {
    const ui = cleanUi({ ...loadUi(store), ...patch.ui });
    write('ui', ui);
    mirror(store, ui, Object.keys(patch.ui));
  }
  return ok;
}

/** Forget all personal data and settings; the GitHub token and the data cache stay. */
export function resetUser(store) {
  for (const key of OWN_KEYS) store.del(key);
}

// ---------------------------------------------------------------- export and import

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const binary = atob(code.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** The "my data" code: 'scout1.' plus base64url JSON of preferences, plan and dismissed items. */
export function exportUser(store, now = new Date()) {
  const { prefs, plan, dismissed } = loadUser(store, now);
  return CODE_PREFIX + toBase64Url(JSON.stringify({ v: 1, exportedAt: nowIso(now), prefs, plan, dismissed: [...dismissed] }));
}

const failure = error => ({ ok: false, error, counts: { plan: 0, dismissed: 0, prefs: 0, skipped: 0 } });

/**
 * Merge a code from exportUser into the store. Plan entries win when newer, dismissed ids are
 * added, imported preferences replace the local ones. Returns { ok, error?, counts, persisted };
 * error is one of empty, too_large, format, decode, version, invalid. Never throws.
 */
export function importUser(store, text, now = new Date()) {
  try {
    const compact = typeof text === 'string' ? text.replace(/\s+/g, '') : '';
    if (!compact) return failure('empty');
    if (compact.length > MAX_CODE_LENGTH) return failure('too_large');
    const at = compact.indexOf(CODE_PREFIX);
    if (at < 0) return failure('format');

    let data;
    try {
      data = JSON.parse(fromBase64Url(compact.slice(at + CODE_PREFIX.length)));
    } catch {
      return failure('decode');
    }
    if (!isObject(data)) return failure('invalid');
    if (data.v !== 1) return failure('version');
    if (!isObject(data.plan) && !Array.isArray(data.dismissed) && !isObject(data.prefs)) return failure('invalid');

    const stamp = nowIso(now);
    const current = loadUser(store, now);
    const incoming = cleanPlan(data.plan, stamp);
    const counts = { plan: 0, dismissed: 0, prefs: 0, skipped: 0 };

    const plan = { ...current.plan };
    for (const [id, entry] of Object.entries(incoming)) {
      if (!Object.hasOwn(plan, id) || entry.updatedAt > plan[id].updatedAt) { plan[id] = entry; counts.plan++; } else counts.skipped++;
    }
    const dismissed = new Set(current.dismissed);
    for (const id of cleanIds(data.dismissed, MAX_DISMISSED)) {
      if (!dismissed.has(id)) { dismissed.add(id); counts.dismissed++; } else counts.skipped++;
    }
    const patch = { plan, dismissed };
    if (isObject(data.prefs)) {
      patch.prefs = mergePrefs(data.prefs);
      patch.ui = { onboarded: true };
      counts.prefs = 1;
    }
    const persisted = saveUser(store, patch, now);
    return { ok: true, counts, persisted };
  } catch {
    return failure('invalid');
  }
}
