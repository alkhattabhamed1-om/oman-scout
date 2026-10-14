// Adds Arabic text to items that do not have it yet. Failures are not fatal: the site falls back to English.
import path from 'node:path';
import { ROOT, extractStructured, readJson, runClaude, textHash, writeJson } from './lib.mjs';

const dataPath = path.join(ROOT, 'data/scout.json');
const data = readJson(dataPath, null);
if (!data || !Array.isArray(data.items)) { console.log('No data to translate.'); process.exit(0); }

const model = process.env.SCOUT_TRANSLATE_MODEL || 'sonnet';
const todo = data.items.filter(it => !it.ar || !it.ar.title || !it.ar.summary);
console.log(`${todo.length} items need Arabic.`);
if (!todo.length) process.exit(0);

const schema = {
  type: 'object', additionalProperties: false, required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'summary', 'why', 'eligibilityNote', 'fitNote'],
        properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, why: { type: 'string' }, eligibilityNote: { type: 'string' }, fitNote: { type: 'string' } }
      }
    }
  }
};

const instructions = [
  'Translate the fields of each item below from English into clear, natural Modern Standard Arabic for a university student in Oman.',
  'Keep the meaning exact. Keep dates, numbers, currencies (RO, OMR, USD, AED) and web addresses unchanged, using Western digits 0-9.',
  'Keep proper names of companies, products and events in their usual form: Latin letters for brands such as Microsoft or GITEX when that is how they are written, with an Arabic form only when one is in common use.',
  'Return one translation per item, with the same id. Do not add or drop items. Return only the structured result.'
].join('\n');

let done = 0;
for (let i = 0; i < todo.length; i += 10) {
  const batch = todo.slice(i, i + 10);
  const payload = batch.map(it => ({ id: it.id, title: it.title, summary: it.summary, why: it.why, eligibilityNote: it.eligibilityNote || '', fitNote: it.fitNote || '' }));
  const prompt = `${instructions}\n\nItems (JSON):\n${JSON.stringify(payload, null, 1)}`;
  try {
    const res = await runClaude({ prompt, schema, model, maxTurns: 4, tools: '', timeoutMs: 10 * 60 * 1000 });
    const out = extractStructured(res.json);
    const list = out && Array.isArray(out.translations) ? out.translations : [];
    for (const tr of list) {
      const it = batch.find(x => x.id === tr.id);
      if (!it || !tr.title || !tr.summary) continue;
      it.ar = { title: String(tr.title).trim(), summary: String(tr.summary).trim(), why: String(tr.why || '').trim(), eligibilityNote: String(tr.eligibilityNote || '').trim(), fitNote: String(tr.fitNote || '').trim() };
      it.arHash = textHash(it);
      done++;
    }
    if (!list.length) console.warn(`Batch ${i / 10 + 1}: no translations returned (exit ${res.code}).`);
  } catch (e) {
    console.warn(`Batch ${i / 10 + 1} failed: ${e.message}`);
  }
}
data.stages = { ...(data.stages || {}), translate: done === todo.length ? 'ok' : done ? 'partial' : 'failed' };
writeJson(dataPath, data);
console.log(`Translated ${done} of ${todo.length} items.`);
