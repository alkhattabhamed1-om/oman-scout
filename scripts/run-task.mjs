// Runs one scan task with Claude Code and writes out/<task>.json.
// Usage: node scripts/run-task.mjs <task-id>
import path from 'node:path';
import { ROOT, OUTPUT_SCHEMA, buildPrompt, extractStructured, muscatToday, nowIso, readJson, runClaude, sanitizeItem, writeJson } from './lib.mjs';

const taskId = process.argv[2];
const tasks = readJson(path.join(ROOT, 'agent/tasks.json'), []);
const task = tasks.find(t => t.id === taskId);
if (!task) { console.error(`Unknown task "${taskId}". Known: ${tasks.map(t => t.id).join(', ')}`); process.exit(2); }

const model = process.env.SCOUT_MODEL || 'sonnet';
const today = muscatToday();
const prev = readJson(path.join(ROOT, 'data/scout.json'), { items: [] });
const known = (prev.items || []).filter(it => it.task === taskId).slice(0, 40);
const prompt = buildPrompt({ task, today, known });

console.log(`[${taskId}] model=${model} today=${today} known=${known.length}`);
const started = Date.now();

let res = await runClaude({ prompt, schema: OUTPUT_SCHEMA, model, maxTurns: 70 });
let data = extractStructured(res.json);
let turns = res.json && res.json.num_turns;
let cost = res.json && res.json.total_cost_usd;

if (!data && res.json && res.json.session_id) {
  console.log(`[${taskId}] no structured result (${res.json.subtype || 'unknown'}). Asking for the final answer.`);
  const again = await runClaude({
    prompt: 'Stop searching now. Return the final structured result using everything you have found so far.',
    schema: OUTPUT_SCHEMA, model, maxTurns: 6, resume: res.json.session_id
  });
  data = extractStructured(again.json);
  turns = (turns || 0) + ((again.json && again.json.num_turns) || 0);
  cost = (cost || 0) + ((again.json && again.json.total_cost_usd) || 0);
  if (!data) res = again;
}

if (!data) {
  console.error(`[${taskId}] FAILED: no usable result.`);
  console.error('exit code:', res.code);
  console.error('stderr:', (res.stderr || '').slice(0, 1500));
  console.error('stdout:', (res.stdout || '').slice(0, 1500));
  process.exit(1);
}

const items = [];
const dropped = [];
const seen = new Set();
for (const raw of data.items || []) {
  const r = sanitizeItem(raw, today);
  if (!r.ok) { dropped.push(`${r.reason}: ${raw && raw.title}`); continue; }
  if (seen.has(r.item.id)) continue;
  seen.add(r.item.id);
  items.push(r.item);
}

console.log(`[${taskId}] kept ${items.length}, dropped ${dropped.length}, turns ${turns ?? '?'}, cost $${cost ? cost.toFixed(2) : '?'} (subscription usage), ${Math.round((Date.now() - started) / 60000)} min`);
dropped.slice(0, 20).forEach(d => console.log(`  dropped ${d}`));

if (!items.length) { console.error(`[${taskId}] FAILED: the scan returned no usable items.`); process.exit(1); }

writeJson(path.join(ROOT, 'out', `${taskId}.json`), {
  task: taskId, status: 'ok', finishedAt: nowIso(), model, turns: turns ?? null,
  items, gaps: (data.gaps || []).map(String).slice(0, 6), dropped: dropped.length
});
