// Stand-in for the `claude` command, used by the pipeline tests (SCOUT_CLAUDE_BIN=node, SCOUT_CLAUDE_PRE=this file).
// It answers each kind of prompt with plausible structured output. FAKE_FAIL=<text> makes prompts containing
// that text return "ran out of turns" without a result; FAKE_HARD makes the retry fail too.
import fs from 'node:fs';

const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, 'utf8');
const out = obj => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session', num_turns: 7, total_cost_usd: 0.42, ...obj }));

for (const flag of ['--json-schema', '--permission-mode', '--model']) {
  if (!args.includes(flag) && !(flag === '--json-schema' && prompt.includes('Translate'))) { console.error('missing flag ' + flag); process.exit(3); }
}

if (prompt.includes('Translate the fields')) {
  const items = JSON.parse(prompt.match(/Items \(JSON\):\n([\s\S]*)$/)[1]);
  out({ structured_output: { translations: items.map(i => ({ id: i.id, title: 'ع: ' + i.title, summary: 'ع: ' + i.summary, why: 'ع: ' + i.why, eligibilityNote: 'ع: ' + i.eligibilityNote, fitNote: 'ع: ' + i.fitNote })) } });
  process.exit(0);
}

const matches = process.env.FAKE_FAIL && prompt.includes(process.env.FAKE_FAIL);
const retry = args.includes('--resume');
if ((matches && !retry) || (process.env.FAKE_HARD && retry)) { out({ subtype: 'error_max_turns', is_error: true, result: '' }); process.exit(0); }

if (prompt.includes('You are the verifier')) {
  const batch = JSON.parse(prompt.match(/Items:\n([\s\S]*)$/)[1]);
  out({ structured_output: { results: batch.map((b, i) => ({
    id: b.id,
    verdict: b.title.includes('Cancelled') ? 'cancelled' : i === 0 ? 'adjusted' : 'confirmed',
    evidence: 'Fake page check.',
    fields: { start: null, end: null, deadline: i === 0 ? '2026-12-20' : null, applyUrl: null, cost: null, prize: null, teamSize: null, eligibility: null, eligibilityNote: null, confidence: null }
  })) } });
  process.exit(0);
}

const task = (prompt.match(/Assignment: ([^\n]+?)\.\n/) || prompt.match(/Assignment area: ([^\n]+?)\.\n/) || [])[1] || 'x';
const region = (prompt.match(/Regions to cover: (\w+)/) || [])[1] || 'oman';
const gap = prompt.includes('completeness critic');
const base = { region, category: 'competition', organizer: 'Org', start: '2026-11-20', end: '2026-11-21', deadline: '2026-11-10', approx: false, dateNote: null, location: 'Muscat', mode: 'in-person', cost: null, prize: 'Prize', teamSize: '1-4', travel: 'local', applyUrl: 'https://example.org/apply', topics: ['ai', 'software'], audience: 'students', fit: 80, fitNote: 'Good fit.', eligibility: 'eligible', eligibilityNote: 'Open to students.', confidence: 'likely', tags: ['a'] };
const mk = (title, extra) => ({ ...base, title, summary: 'A fake item.', why: 'Because testing.', sources: [{ label: 'x', url: 'https://example.org/' + encodeURIComponent(title) }], ...extra });
const items = gap
  ? [mk(`${task} Gap Find`, { category: 'event' })]
  : [
    mk(`${task} Hackathon 2026`),
    mk(`${task} Cancelled Contest`),
    mk(`${task} Old Thing`, { start: '2026-01-01', end: '2026-01-02', deadline: null }),
    mk(`${task} Bad Link`, { sources: [{ label: 'bad', url: 'javascript:alert(1)' }] }),
    mk(`${task} Undated Programme`, { category: 'funding', start: null, end: null, deadline: null, eligibility: 'na' }),
    mk(`${task} Closed Programme`, { category: 'funding', eligibility: 'ineligible', fit: 90 })
  ];
out({ structured_output: { items, gaps: [`fake gap for ${task}`] } });
