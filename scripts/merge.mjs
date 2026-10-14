// Merges the per-task results in out/ into data/scout.json.
// Tasks that failed keep their previous items and are marked "stale".
import path from 'node:path';
import { ROOT, lastDate, muscatToday, nowIso, profileParts, readJson, textHash, writeJson } from './lib.mjs';

const today = muscatToday();
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

if (!okTasks) {
  console.error('No scan produced usable results. Leaving data/scout.json unchanged.');
  process.exit(1);
}

const rank = it => ({ confirmed: 3, likely: 2, unverified: 1 }[it.confidence] || 0) * 10 + (it.sources ? it.sources.length : 0);
const byId = new Map();
for (const it of merged) {
  const last = lastDate(it);
  if (last && last < today) continue;
  const cur = byId.get(it.id);
  if (!cur || rank(it) > rank(cur)) byId.set(it.id, it);
}

const items = [...byId.values()].map(it => {
  const old = prevById.get(it.id);
  const out = { ...it };
  out.firstSeen = (old && old.firstSeen) || today;
  out.lastSeen = taskInfo[it.task] && taskInfo[it.task].status === 'ok' ? today : (old && old.lastSeen) || it.lastSeen || today;
  const hash = textHash(out);
  if (old && old.ar && (old.arHash || textHash(old)) === hash) { out.ar = old.ar; out.arHash = hash; }
  else if (it.ar && it.arHash === hash) { out.arHash = hash; }
  else { delete out.ar; delete out.arHash; }
  return out;
});

const { label } = profileParts();
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

const data = {
  schemaVersion: 1,
  generatedAt: now,
  scanDate: today,
  prevScanDate: prev ? (prev.scanDate && prev.scanDate !== today ? prev.scanDate : prev.prevScanDate || null) : null,
  runUrl,
  profileLabel: label,
  tasks: taskInfo,
  gaps: [...new Set(gaps)].slice(0, 10),
  items
};
writeJson(dataPath, data);
console.log(`Merged ${items.length} items from ${okTasks}/${tasks.length} tasks. ${items.filter(i => !i.ar).length} still need Arabic.`);
