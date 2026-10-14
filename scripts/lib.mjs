// Shared helpers for the scan pipeline: schema, cleaning, prompt building, and the Claude Code runner.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REGIONS = ['oman', 'gcc', 'global'];
export const CATEGORIES = ['event', 'competition', 'competitor', 'funding'];
export const ELIGIBILITY = ['eligible', 'likely', 'check', 'ineligible', 'na'];
export const CONFIDENCE = ['confirmed', 'likely', 'unverified'];
export const TRAVEL = ['local', 'online', 'gcc', 'far'];
export const MODES = ['in-person', 'online', 'hybrid'];

/* ---------- small utilities ---------- */
export const muscatToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
export const textHash = it => sha1([it.title, it.summary, it.why, it.eligibilityNote].map(x => x || '').join('\u0001')).slice(0, 12);

export function makeId(title) {
  const slug = String(title).toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '') || 'item';
  return `${slug}-${sha1(String(title).toLowerCase().trim()).slice(0, 5)}`;
}

const validDate = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};
export const lastDate = it => [it.end, it.start, it.deadline].filter(Boolean).sort().pop() || null;

/* ---------- profile and prompt ---------- */
export function profileParts() {
  const md = fs.readFileSync(path.join(ROOT, 'agent/profile.md'), 'utf8');
  const label = { en: '', ar: '' };
  const lm = md.match(/## Short label[^\n]*\n([\s\S]*?)(?=\n## |$)/);
  if (lm) {
    const en = lm[1].match(/^en:\s*(.+)$/m); const ar = lm[1].match(/^ar:\s*(.+)$/m);
    if (en) label.en = en[1].trim();
    if (ar) label.ar = ar[1].trim();
  }
  const dm = md.match(/## Details for the agent\s*\n([\s\S]*)$/);
  return { label, details: (dm ? dm[1] : md).trim() };
}

export function buildPrompt({ task, today, known }) {
  let brief = fs.readFileSync(path.join(ROOT, 'agent/brief.md'), 'utf8');
  const { details } = profileParts();
  const taskText = [
    `Assignment: ${task.label}.`,
    `Regions to cover: ${task.region}. Categories to cover: ${task.categories.join(', ')}.`,
    `Return at most ${task.maxItems} items, most relevant and best verified first.`,
    '',
    task.focus
  ].join('\n');
  let knownText = '';
  if (known && known.length) {
    knownText = [
      '## Items found in the previous scan',
      'Re-check each one: has the date, price, deadline or status changed? Return it again, with updated details, if it is still upcoming. Drop it if it is over or cancelled. Then search for new items beyond this list.',
      ...known.map(k => `- ${k.title} | start ${k.start || 'none'} | deadline ${k.deadline || 'none'} | ${(k.sources && k.sources[0] && k.sources[0].url) || ''}`)
    ].join('\n');
  }
  brief = brief.replaceAll('{{TODAY}}', today).replaceAll('{{PROFILE}}', details).replaceAll('{{TASK}}', taskText).replaceAll('{{KNOWN}}', knownText);
  return brief;
}

/* ---------- output schema (what the scan agent must return) ---------- */
const nullableString = { type: ['string', 'null'] };
const dateOrNull = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['region', 'category', 'title', 'summary', 'why', 'organizer', 'start', 'end', 'deadline', 'approx', 'dateNote', 'location', 'mode', 'cost', 'prize', 'travel', 'eligibility', 'eligibilityNote', 'confidence', 'sources', 'tags'],
  properties: {
    region: { type: 'string', enum: REGIONS },
    category: { type: 'string', enum: CATEGORIES },
    title: { type: 'string', description: 'Official name, with the year or edition when there is one.' },
    summary: { type: 'string', description: 'What it is, at most 40 words.' },
    why: { type: 'string', description: 'Why it matters to this person, at most 28 words.' },
    organizer: nullableString,
    start: dateOrNull,
    end: dateOrNull,
    deadline: dateOrNull,
    approx: { type: 'boolean', description: 'True when start is only an approximate first day of a month or quarter.' },
    dateNote: { ...nullableString, description: 'Explains approximate, unconfirmed or missing dates.' },
    location: nullableString,
    mode: { enum: [...MODES, null] },
    cost: nullableString,
    prize: nullableString,
    travel: { type: 'string', enum: TRAVEL },
    eligibility: { type: 'string', enum: ELIGIBILITY },
    eligibilityNote: { type: 'string', description: 'The requirement in neutral terms, at most 28 words.' },
    confidence: { type: 'string', enum: CONFIDENCE },
    sources: {
      type: 'array', minItems: 1, maxItems: 4,
      items: { type: 'object', additionalProperties: false, required: ['label', 'url'], properties: { label: { type: 'string' }, url: { type: 'string' } } }
    },
    tags: { type: 'array', maxItems: 5, items: { type: 'string' } }
  }
};
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'gaps'],
  properties: {
    items: { type: 'array', items: ITEM_SCHEMA },
    gaps: { type: 'array', maxItems: 6, items: { type: 'string' } }
  }
};

/* ---------- cleaning ---------- */
const cut = (s, n) => {
  const v = String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v;
};
const cutNull = (s, n) => { const v = cut(s, n); return v || null; };

function cleanUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
    x.username = ''; x.password = '';
    return x.href;
  } catch { return null; }
}

export function sanitizeItem(raw, today) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  if (!REGIONS.includes(raw.region)) return { ok: false, reason: 'bad region' };
  if (!CATEGORIES.includes(raw.category)) return { ok: false, reason: 'bad category' };
  const title = cut(raw.title, 160);
  if (!title) return { ok: false, reason: 'no title' };

  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .map(s => ({ label: cut(s && s.label, 80) || 'Source', url: cleanUrl(s && s.url) }))
    .filter(s => s.url).slice(0, 4);
  if (!sources.length) return { ok: false, reason: 'no valid source' };

  let start = validDate(raw.start) ? raw.start : null;
  let end = validDate(raw.end) ? raw.end : null;
  const deadline = validDate(raw.deadline) ? raw.deadline : null;
  if (end && start && end < start) end = null;
  if (end && !start) { start = end; end = null; }

  const item = {
    region: raw.region,
    category: raw.category,
    title,
    summary: cut(raw.summary, 520),
    why: cut(raw.why, 360),
    organizer: cutNull(raw.organizer, 120),
    start, end, deadline,
    approx: !!raw.approx && !!start,
    dateNote: cutNull(raw.dateNote, 180),
    location: cutNull(raw.location, 140),
    mode: MODES.includes(raw.mode) ? raw.mode : null,
    cost: cutNull(raw.cost, 100),
    prize: cutNull(raw.prize, 140),
    travel: TRAVEL.includes(raw.travel) ? raw.travel : (raw.region === 'oman' ? 'local' : raw.region === 'gcc' ? 'gcc' : 'far'),
    eligibility: ELIGIBILITY.includes(raw.eligibility) ? raw.eligibility : 'check',
    eligibilityNote: cut(raw.eligibilityNote, 360),
    confidence: CONFIDENCE.includes(raw.confidence) ? raw.confidence : 'unverified',
    sources,
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map(t => cut(t, 30)).filter(Boolean).slice(0, 5)
  };
  if (!item.summary) return { ok: false, reason: 'no summary' };
  if (!item.start && !item.end && !item.deadline && !item.dateNote) item.dateNote = 'No date announced';

  const last = lastDate(item);
  if (last && last < today) return { ok: false, reason: 'already past' };
  item.id = makeId(title);
  return { ok: true, item };
}

/* ---------- Claude Code runner ---------- */
const SYSTEM_APPEND = [
  'You are running unattended inside an automated job with no human to answer questions.',
  'Only the tools you were given are available. Never ask a question: decide and continue.',
  'Your last message must be the structured result and nothing else.'
].join(' ');

export function runClaude({ prompt, schema, model = 'sonnet', maxTurns = 60, tools = 'WebSearch,WebFetch', resume = null, timeoutMs = 40 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--model', model, '--max-turns', String(maxTurns), '--permission-mode', 'dontAsk'];
    if (tools) args.push('--allowedTools', tools);
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    if (resume) args.push('--resume', resume);
    args.push('--append-system-prompt', SYSTEM_APPEND);
    // SCOUT_CLAUDE_BIN and SCOUT_CLAUDE_PRE exist so the pipeline can be tested with a stand-in program.
    const bin = process.env.SCOUT_CLAUDE_BIN || 'claude';
    const pre = process.env.SCOUT_CLAUDE_PRE ? [process.env.SCOUT_CLAUDE_PRE] : [];
    const child = spawn(bin, [...pre, ...args], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && !process.env.SCOUT_CLAUDE_BIN });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out); } catch { /* not JSON */ }
      if (Array.isArray(json)) json = json.filter(m => m && m.type === 'result').pop() || null;
      resolve({ code, json, stdout: out, stderr: err });
    });
    child.stdin.on('error', () => { /* process exited early */ });
    child.stdin.end(prompt);
  });
}

export function extractStructured(json) {
  if (!json) return null;
  if (json.structured_output && typeof json.structured_output === 'object') return json.structured_output;
  const text = typeof json.result === 'string' ? json.result : '';
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}
