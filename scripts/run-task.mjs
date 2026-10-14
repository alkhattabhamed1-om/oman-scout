// Runs one scan task and writes out/<task>.json.
//   quick:     discover, then deterministic link and date checks
//   thorough:  discover, a second pass for what was missed, link checks, then a verifier that re-opens
//              the pages of the items that matter most and corrects them only with evidence
// Usage: node scripts/run-task.mjs <task-id>      (SCOUT_DEPTH=quick|thorough, SCOUT_MODEL=sonnet)
import path from 'node:path';
import {
  ROOT, OUTPUT_SCHEMA, VERIFY_SCHEMA, applyVerification, buildGapPrompt, buildPrompt, buildVerifyPrompt, describeRun, extractStructured,
  muscatToday, nowIso, readJson, runClaude, sameItem, sanitizeItem, writeJson
} from './lib.mjs';
import { checkItems } from './check-links.mjs';

const taskId = process.argv[2];
const tasks = readJson(path.join(ROOT, 'agent/tasks.json'), []);
const task = tasks.find(t => t.id === taskId);
if (!task) { console.error(`Unknown task "${taskId}". Known: ${tasks.map(t => t.id).join(', ')}`); process.exit(2); }

const model = process.env.SCOUT_MODEL || 'sonnet';
const depth = process.env.SCOUT_DEPTH === 'quick' ? 'quick' : 'thorough';
const today = muscatToday();
const prev = readJson(path.join(ROOT, 'data/scout.json'), { items: [] });
const known = (prev.items || []).filter(it => it.task === taskId).slice(0, 40);
const started = Date.now();
const log = m => console.log(`[${taskId}] ${m}`);
const minutes = () => Math.round((Date.now() - started) / 60000);

function collect(rawItems, into, dropped) {
  let kept = 0;
  for (const raw of rawItems || []) {
    const r = sanitizeItem(raw, today);
    if (!r.ok) { dropped.push(`${r.reason}: ${raw && raw.title}`); continue; }
    if (into.some(x => x.id === r.item.id || sameItem(x, r.item))) continue;
    into.push(r.item); kept++;
  }
  return kept;
}

async function ask(prompt, schema, maxTurns, label) {
  let res = await runClaude({ prompt, schema, model, maxTurns });
  let data = extractStructured(res.json);
  log(`${label}: ${describeRun(res)}`);
  if (!data && res.json && res.json.session_id) {
    log(`${label}: no structured result, asking for the final answer`);
    res = await runClaude({ prompt: 'Stop searching now. Return the final structured result using everything you have found so far.', schema, model, maxTurns: 6, resume: res.json.session_id });
    data = extractStructured(res.json);
    log(`${label} (final answer): ${describeRun(res)}`);
  }
  return { data, res };
}

log(`depth=${depth} model=${model} today=${today} known=${known.length}`);

// 1. discover
const first = await ask(buildPrompt({ task, today, known }), OUTPUT_SCHEMA, 70, 'discover');
if (!first.data) {
  console.error(`[${taskId}] FAILED: no usable result.`);
  console.error('exit code:', first.res.code);
  console.error('stderr:', (first.res.stderr || '').slice(0, 1500));
  console.error('stdout:', (first.res.stdout || '').slice(0, 1500));
  process.exit(1);
}
const items = [];
const dropped = [];
const gaps = (first.data.gaps || []).map(String);
log(`discover kept ${collect(first.data.items, items, dropped)}`);
if (!items.length) { console.error(`[${taskId}] FAILED: the scan returned no usable items.`); process.exit(1); }

// 2. second pass for what was missed (thorough only; failures never lose the first pass)
if (depth === 'thorough') {
  try {
    const gap = await ask(buildGapPrompt({ task, today, titles: items.map(i => i.title) }), OUTPUT_SCHEMA, 45, 'gap pass');
    if (gap.data) { log(`gap pass added ${collect(gap.data.items, items, dropped)}`); (gap.data.gaps || []).forEach(g => gaps.push(String(g))); }
  } catch (e) { log(`gap pass skipped: ${e.message}`); }
}

// 3. deterministic link and date checks
try {
  if (process.env.SCOUT_NO_LINKCHECK) throw new Error('disabled by SCOUT_NO_LINKCHECK');
  const s = await checkItems(items, { concurrency: 6 });
  log(`links: ${s.ok} ok, ${s.dead} dead, ${s.unknown} unknown, date seen on ${s.dateSeen} of ${s.checked}`);
} catch (e) { log(`link checks skipped: ${e.message}`); }

// 4. verifier on the items that matter most (thorough only)
let finalItems = items;
if (depth === 'thorough') {
  const needs = items
    .filter(i => i.eligibility !== 'ineligible')
    .sort((a, b) => ((b.category === 'competition') - (a.category === 'competition')) || (b.fit - a.fit))
    .filter(i => i.category === 'competition' || i.confidence !== 'confirmed' || (i.verified && (i.verified.linkOk === false || i.verified.dateOnPage === false)))
    .slice(0, 24);
  const byId = new Map(items.map(i => [i.id, i]));
  let changed = 0, removed = 0;
  for (let at = 0; at < needs.length; at += 6) {
    const batch = needs.slice(at, at + 6);
    try {
      const v = await ask(buildVerifyPrompt({ today, batch }), VERIFY_SCHEMA, 40, `verify ${at / 6 + 1}`);
      for (const r of (v.data && v.data.results) || []) {
        const cur = byId.get(r.id);
        if (!cur) continue;
        const upd = applyVerification(cur, r, today);
        if (!upd) { byId.delete(r.id); removed++; } else { byId.set(r.id, upd); if (upd !== cur) changed++; }
      }
    } catch (e) { log(`verify batch skipped: ${e.message}`); }
  }
  finalItems = items.filter(i => byId.has(i.id)).map(i => byId.get(i.id));
  log(`verifier: ${needs.length} checked, ${changed} updated, ${removed} removed`);
}

log(`done: ${finalItems.length} items, ${dropped.length} rejected by the cleaner, ${minutes()} min`);
dropped.slice(0, 15).forEach(d => log(`  rejected ${d}`));
writeJson(path.join(ROOT, 'out', `${taskId}.json`), {
  task: taskId, status: 'ok', finishedAt: nowIso(), model, depth, items: finalItems, gaps: gaps.slice(0, 6), dropped: dropped.length
});
