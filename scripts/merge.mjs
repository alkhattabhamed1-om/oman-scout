// Merges the per-task results in out/ into data/scout.json and the calendar feed data/oman-scout.ics.
// A task that failed keeps its previous items and is marked "stale". Nothing is written when no task worked.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, lastDate, muscatToday, nowIso, profileParts, readJson, sameItem, textHash, writeJson } from './lib.mjs';
import { scoreItem, DEFAULT_PREFS } from '../assets/lib/rank.js';
import { buildIcs } from '../assets/lib/ics.js';

const today = muscatToday();
const depth = process.env.SCOUT_DEPTH === 'quick' ? 'quick' : 'thorough';
const dataPath = path.join(ROOT, 'data/scout.json');
const prev = readJson(dataPath, null);
const tasks = readJson(path.join(ROOT, 'agent/tasks.json'), []);
const prevItems = (prev && prev.items) || [];
const prevById = new Map(prevItems.map(it => [it.id, it]));
const now = nowIso();

const merged = [];
const taskInfo = {};
const gaps = [];
let okTasks = 0;

for (const task of tasks) {
  const res = readJson(path.join(ROOT, 'out', `${task.id}.json`), null);
  if (res && res.status === 'ok' && Array.isArray(res.items) && res.items.length) {
    okTasks++;
    taskInfo[task.id] = { status: 'ok', updatedAt: res.finishedAt || now, count: res.items.length };
    res.items.forEach(it => merged.push({ ...it, task: task.id }));
    (res.gaps || []).forEach(g => gaps.push(g));
  } else {
    const old = prevItems.filter(it => it.task === task.id);
    taskInfo[task.id] = { status: 'stale', updatedAt: (prev && prev.tasks && prev.tasks[task.id] && prev.tasks[task.id].updatedAt) || null, count: old.length };
    old.forEach(it => merged.push(it));
    gaps.push(`The latest scan for "${task.label}" did not finish, so the previous results for it are shown.`);
  }
}
if (!okTasks) { console.error('No scan produced usable results. Leaving data/scout.json unchanged.'); process.exit(1); }

// de-duplicate: the better-evidenced version wins and keeps the other's sources
const strength = it => ({ confirmed: 3, likely: 2, unverified: 1 }[it.confidence] || 0) * 10 + (it.sources || []).length
  + (it.verified && ['confirmed', 'adjusted'].includes(it.verified.agent) ? 6 : 0) + (it.verified && it.verified.dateOnPage ? 3 : 0) + (it.verified && it.verified.linkOk === false ? -8 : 0);
const out = [];
let duplicates = 0;
for (const it of merged) {
  const last = lastDate(it);
  if (last && last < today) continue;
  const at = out.findIndex(o => o.id === it.id || sameItem(o, it));
  if (at < 0) { out.push(it); continue; }
  duplicates++;
  const [win, lose] = strength(it) > strength(out[at]) ? [it, out[at]] : [out[at], it];
  const have = new Set(win.sources.map(s => s.url));
  const sources = [...win.sources, ...lose.sources.filter(s => !have.has(s.url))].slice(0, 4);
  out[at] = { ...win, sources, ar: win.ar || lose.ar, arHash: win.ar ? win.arHash : lose.arHash };
}

// an unverified item whose only page is dead is more likely stale than real
let dead = 0;
const kept = out.filter(it => {
  const gone = it.verified && it.verified.linkOk === false && it.confidence === 'unverified' && (it.sources || []).length <= 1 && !it.applyUrl;
  if (gone) dead++;
  return !gone;
});

const prefs = { today, prefs: DEFAULT_PREFS, affinity: {} };
const items = kept.map(it => {
  const old = prevById.get(it.id);
  const o = { ...it };
  o.firstSeen = (old && old.firstSeen) || o.firstSeen || today;
  o.lastSeen = taskInfo[it.task] && taskInfo[it.task].status === 'ok' ? today : (old && old.lastSeen) || it.lastSeen || today;
  const hash = textHash(o);
  if (old && old.ar && (old.arHash || textHash(old)) === hash) { o.ar = old.ar; o.arHash = hash; }
  else if (it.ar && it.arHash === hash) { o.arHash = hash; }
  else { delete o.ar; delete o.arHash; }
  o.score = scoreItem(o, prefs).score;
  return o;
}).sort((a, b) => b.score - a.score);

const count = f => items.filter(f).length;
const stats = {
  total: items.length,
  confirmed: count(i => i.confidence === 'confirmed'),
  linkChecked: count(i => i.verified && i.verified.linkOk !== null && i.verified.linkOk !== undefined),
  dateSeenOnPage: count(i => i.verified && i.verified.dateOnPage === true),
  verifiedByAgent: count(i => i.verified && ['confirmed', 'adjusted'].includes(i.verified.agent)),
  dropped: dead + duplicates
};
const stale = Object.values(taskInfo).filter(t => t.status !== 'ok').length;
const { label } = profileParts();
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

const data = {
  schemaVersion: 2,
  generatedAt: now,
  scanDate: today,
  prevScanDate: prev ? (prev.scanDate && prev.scanDate !== today ? prev.scanDate : prev.prevScanDate || null) : null,
  runUrl,
  depth,
  profileLabel: label,
  tasks: taskInfo,
  stages: { discover: stale ? 'partial' : 'ok', verify: depth === 'thorough' ? 'ok' : 'skipped', translate: 'pending' },
  stats,
  gaps: [...new Set(gaps)].slice(0, 10),
  items
};
writeJson(dataPath, data);

const feed = items.filter(i => ['eligible', 'likely', 'check'].includes(i.eligibility) && (i.start || i.deadline));
fs.writeFileSync(path.join(ROOT, 'data/oman-scout.ics'), buildIcs(feed, { lang: 'en', calName: 'Oman Scout', now: new Date(now) }));

console.log(`Merged ${items.length} items from ${okTasks}/${tasks.length} tasks (${duplicates} duplicates merged, ${dead} dead-link items dropped). ${items.filter(i => !i.ar).length} still need Arabic. Calendar feed: ${feed.length} items.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = Object.entries(taskInfo).map(([id, t]) => `| ${id} | ${t.status} | ${t.count} |`).join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Oman Scout scan (${depth})\n\n${items.length} items. Confirmed on an official page: ${stats.confirmed}. Links checked: ${stats.linkChecked}. Date seen on the page: ${stats.dateSeenOnPage}. Checked by the verifier: ${stats.verifiedByAgent}.\n\n| Task | Status | Items |\n|---|---|---|\n${rows}\n`);
}
