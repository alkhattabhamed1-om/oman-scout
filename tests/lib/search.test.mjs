import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeText, parseQuery, buildIndex, searchItems, highlightSegments, suggest } from '../../assets/lib/search.js';

const { items: FIXTURE } = JSON.parse(readFileSync(new URL('../fixtures/lib-items.json', import.meta.url), 'utf8'));
const index = buildIndex(FIXTURE);

const ids = q => {
  const r = searchItems(index, q);
  return r ? [...r.keys()] : null;
};
const score = (q, id) => searchItems(index, q).get(id);

const TATWEEL = String.fromCharCode(0x640);

// ---------------------------------------------------------------- normalizeText

test('normalizeText lower-cases and strips Latin diacritics', () => {
  assert.equal(normalizeText('Café Résumé Naïve'), 'cafe resume naive');
  assert.equal(normalizeText('Straße'), 'strasse');
  assert.equal(normalizeText('Øre Łódź'), 'ore lodz');
});

test('normalizeText strips Arabic tashkeel and tatweel', () => {
  assert.equal(normalizeText('مَسَابَقَةٌ'), 'مسابقه');
  assert.equal(normalizeText(['م', 'س', TATWEEL, TATWEEL, 'ا', 'ب', 'ق', 'ة'].join('')), 'مسابقه');
});

test('normalizeText folds alef forms, alef maksura and teh marbuta', () => {
  for (const form of ['أحمد', 'إحمد', 'آحمد', 'احمد']) assert.equal(normalizeText(form), 'احمد', form);
  assert.equal(normalizeText('على'), 'علي');
  assert.equal(normalizeText('مدرسة'), 'مدرسه');
  assert.equal(normalizeText('مسؤول'), 'مسوول');
});

test('normalizeText converts Arabic-Indic and Persian digits', () => {
  assert.equal(normalizeText('٢٠٢٦'), '2026');
  assert.equal(normalizeText('۲۰۲۶'), '2026');
  assert.equal(normalizeText('Imagine Cup ٢٠٢٧'), 'imagine cup 2027');
  assert.equal(normalizeText('٠١٢٣٤٥٦٧٨٩'), '0123456789');
});

test('normalizeText collapses punctuation to single spaces', () => {
  assert.equal(normalizeText('AI/ML, data-science!  (2026)'), 'ai ml data science 2026');
  assert.equal(normalizeText('  ...  '), '');
  assert.equal(normalizeText('مسابقة، الأمن؛ السيبراني؟'), 'مسابقه الامن السيبراني');
});

test('normalizeText joins apostrophes and accepts any input', () => {
  assert.equal(normalizeText("Women's Day"), 'womens day');
  assert.equal(normalizeText('Women’s Day'), 'womens day');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText(42), '42');
});

// ---------------------------------------------------------------- parseQuery

test('parseQuery reads tokens, phrases, exclusions and prefixes', () => {
  const q = parseQuery('"cyber security" -online hack* the AI in oman');
  assert.deepEqual(q.phrases, ['cyber security']);
  assert.deepEqual(q.excluded, ['online']);
  assert.deepEqual(q.prefix, ['hack']);
  assert.deepEqual(q.groups.map(g => g[0]), ['hack', 'ai', 'oman'], 'filler words are dropped');
  assert.equal(q.raw, '"cyber security" -online hack* the AI in oman');
});

test('parseQuery expands synonyms, with the typed word first', () => {
  const [hack] = parseQuery('hackathon').groups;
  assert.equal(hack[0], 'hackathon');
  assert.ok(hack.length > 3);
  const [ml] = parseQuery('ml').groups;
  assert.equal(ml[0], 'ml');
  assert.ok(ml.includes('ai') && ml.includes('machine learning'));
  assert.deepEqual(parseQuery('machine learning').groups.length, 1, 'a two-word synonym stays one token');
  assert.equal(parseQuery('machine learning').groups[0][0], 'machine learning');
  assert.ok(parseQuery('hackaton').groups[0].includes('hackathon'), 'a typo still finds the synonym group');
  assert.deepEqual(parseQuery('zebra').groups, [['zebra']]);
});

test('parseQuery does not expand quoted phrases or prefix tokens', () => {
  assert.deepEqual(parseQuery('hack*').groups, [['hack']]);
  assert.deepEqual(parseQuery('"hackathon"').groups, []);
});

test('parseQuery edge cases', () => {
  assert.deepEqual(parseQuery('the').groups, [['the']], 'a query of only filler words is kept');
  assert.deepEqual(parseQuery('').groups, []);
  assert.deepEqual(parseQuery('  - * " ').groups, []);
  assert.deepEqual(parseQuery(null).groups, []);
  assert.deepEqual(parseQuery(undefined).phrases, []);
  assert.equal(parseQuery(123).groups[0][0], '123');
  assert.deepEqual(parseQuery('"cyber sec').phrases, ['cyber sec'], 'an unfinished quote is a phrase');
  assert.deepEqual(parseQuery('“cyber security”').phrases, ['cyber security'], 'curly quotes work');
  assert.deepEqual(parseQuery('-"cyber security"').excluded, ['cyber security']);
  assert.deepEqual(parseQuery('full-stack').groups.map(g => g[0]), ['full', 'stack']);
  assert.deepEqual(parseQuery('oman oman').groups.length, 1, 'repeated words collapse');
});

// ---------------------------------------------------------------- search: basics

test('an empty query returns null; a query with no match returns an empty map', () => {
  assert.equal(searchItems(index, ''), null);
  assert.equal(searchItems(index, '   '), null);
  assert.equal(searchItems(index, '!!!'), null);
  assert.equal(searchItems(index, null), null);
  const none = searchItems(index, 'zxqwv');
  assert.ok(none instanceof Map);
  assert.equal(none.size, 0);
});

test('results are a Map of id to relevance, best first', () => {
  const r = searchItems(index, 'hackathon');
  assert.ok(r instanceof Map);
  const values = [...r.values()];
  for (const v of values) assert.ok(typeof v === 'number' && v > 0);
  for (let i = 1; i < values.length; i++) assert.ok(values[i - 1] >= values[i]);
  assert.deepEqual(ids('hackathon').slice(0, 2), ['ai-hackathon', 'cafe-hackathon']);
});

test('every token must match (AND); synonyms inside a token are OR', () => {
  const r = ids('cyber students');
  assert.ok(r.includes('cyber-ctf'));
  assert.ok(!r.includes('ciso-summit'), 'security summit without students is out');
  assert.ok(ids('cyber students oman muscat').includes('cyber-ctf'));
  assert.deepEqual(ids('hackathon dubai'), [], 'both tokens are required');
});

test('title hits beat summary hits', () => {
  assert.ok(score('robotics', 'robotics-title') > score('robotics', 'robotics-summary'));
  assert.ok(ids('robotics').indexOf('robotics-title') < ids('robotics').indexOf('robotics-summary'));
});

test('whole words beat prefixes, which beat substrings', () => {
  const whole = score('code', 'code-whole');
  const prefix = score('code', 'code-prefix');
  const substring = score('code', 'code-substring');
  assert.ok(whole > prefix, `${whole} > ${prefix}`);
  assert.ok(prefix > substring, `${prefix} > ${substring}`);
  assert.ok(substring > 0);
});

test('typing a word start finds the word', () => {
  assert.ok(ids('hacka').includes('ai-hackathon'));
  assert.ok(ids('cyb').includes('cyber-ctf'));
  assert.ok(ids('startu').includes('startup-weekend'));
});

test('tokens of one or two characters match whole words only', () => {
  const r = ids('ai');
  assert.ok(r.includes('ai-hackathon') && r.includes('dubai-ai-festival'));
  assert.ok(!r.includes('air-quality'), 'ai must not match air');
  assert.ok(ids('ai*').includes('air-quality'), 'an explicit star does');
  assert.ok(ids('cyb*').includes('cyber-ctf'));
  assert.ok(!ids('cyb*').includes('barcode'));
});

// ---------------------------------------------------------------- search: typos

test('a 5+ letter token forgives one typo', () => {
  assert.ok(ids('hackaton').includes('ai-hackathon'));
  assert.ok(ids('hackathn').includes('ai-hackathon'));
  assert.ok(ids('hackthon').includes('cafe-hackathon'));
  assert.ok(ids('cybersecurty').includes('cyber-ctf'));
  assert.ok(ids('compitition').includes('undated-contest'));
  assert.ok(ids('hackatohn').includes('ai-hackathon'), 'a swap counts as one edit');
  assert.ok(ids('startap').includes('startup-weekend'));
  assert.ok(ids('rbotics').includes('robotics-title'));
});

test('8+ letters forgive two typos, shorter words do not', () => {
  assert.ok(ids('hakcatohn').includes('ai-hackathon'), 'two swaps in nine letters');
  assert.equal(searchItems(index, 'hckthon').size, 0, 'two edits in seven letters is too far');
  assert.equal(searchItems(index, 'roboxxs').size, 0);
});

test('tokens shorter than 5 letters are never fuzzy', () => {
  assert.equal(searchItems(index, 'ctx').size, 0, 'ctx is not ctf');
  assert.equal(searchItems(index, 'cybr').size, 0);
  assert.equal(searchItems(index, 'webb').size, 0);
  assert.ok(searchItems(index, 'ctf').size > 0);
});

test('typo matches rank below exact matches', () => {
  const exact = score('hackathon', 'ai-hackathon');
  const typo = score('hackaton', 'ai-hackathon');
  assert.ok(typo < exact);
  assert.ok(typo > 0);
});

// ---------------------------------------------------------------- search: synonyms

test('English synonyms', () => {
  assert.ok(ids('incubator').includes('startup-weekend'), 'accelerator in the text');
  assert.ok(ids('contest').includes('cyber-ctf'));
  assert.ok(ids('competition').includes('ai-hackathon'), 'by category');
  assert.ok(ids('ml').includes('ai-hackathon'), 'machine learning in the text');
  assert.ok(ids('artificial intelligence').includes('dubai-ai-festival'));
  assert.ok(ids('coding').includes('code-whole'));
  assert.ok(ids('security').includes('cyber-ctf'));
  assert.ok(ids('students').includes('imagine-cup'));
  assert.ok(ids('free').includes('ai-hackathon'));
  assert.ok(ids('grant').includes('youth-fund'));
  assert.ok(ids('online').includes('imagine-cup'));
  assert.ok(ids('startups').includes('startup-weekend'));
  assert.ok(ids('scholarship').includes('youth-fund'), 'grant and scholarship are one group');
});

test('Arabic synonyms reach English text and the other way round', () => {
  assert.ok(ids('هاكاثون').includes('cafe-hackathon'), 'English-only hackathon found by its Arabic name');
  assert.ok(ids('hackathon').includes('ai-hackathon'));
  assert.ok(ids('مسابقة').includes('cyber-ctf'));
  assert.ok(ids('ذكاء اصطناعي').includes('dubai-ai-festival'));
  assert.ok(ids('الذكاء الاصطناعي').includes('ai-hackathon'));
  assert.ok(ids('طلبة').includes('imagine-cup'));
  assert.ok(ids('مجاني').includes('ai-hackathon'));
  assert.ok(ids('عن بعد').includes('imagine-cup'));
  assert.ok(ids('شركات ناشئة').includes('startup-weekend'));
  assert.ok(ids('أمن سيبراني').includes('cyber-ctf'));
  assert.ok(ids('مسقط').includes('cyber-ctf'), 'Muscat in English text');
  assert.ok(ids('تقنية مالية').includes('youth-fund') === false);
  assert.ok(ids('شباب').includes('youth-fund'), 'audience youth');
});

test('the topic labels find their items in both languages', () => {
  assert.ok(ids('cybersecurity').includes('ciso-summit'));
  assert.ok(ids('الأمن السيبراني').includes('ciso-summit'));
  assert.ok(ids('sustainability').includes('air-quality'));
  assert.ok(ids('الشركات الناشئة وريادة الأعمال').includes('startup-weekend'));
  assert.ok(ids('cloud').includes('long-title'));
});

// ---------------------------------------------------------------- search: Arabic

test('Arabic articles, plurals and feminine endings meet', () => {
  for (const q of ['مسابقة', 'مسابقات', 'المسابقات', 'المسابقة']) {
    assert.ok(ids(q).includes('cyber-ctf'), q);
  }
  assert.ok(ids('تطبيق').includes('arabic-workshop'));
  assert.ok(ids('تطبيقات').includes('arabic-workshop'));
  assert.ok(ids('للطلبة').includes('arabic-workshop'), 'prefix li-al');
});

test('Arabic diacritics and letter forms are ignored', () => {
  assert.ok(ids('مَسَابَقَة').includes('cyber-ctf'));
  assert.ok(ids('الامن').includes('cyber-ctf'), 'alef without hamza');
  assert.ok(ids('الأمن').includes('cyber-ctf'));
  assert.ok(ids('الإمن').includes('cyber-ctf'));
  assert.ok(ids('جامعه').includes('arabic-workshop'), 'heh for teh marbuta');
  assert.ok(ids('جامعة').includes('arabic-workshop'));
});

test('Arabic-Indic and Persian digits match ASCII digits and each other', () => {
  for (const q of ['2027', '٢٠٢٧', '۲۰۲۷']) {
    const r = ids(q);
    assert.ok(r.includes('imagine-cup'), q);
  }
  assert.ok(ids('Imagine Cup ٢٠٢٧').includes('imagine-cup'));
});

test('Arabic typos are forgiven in longer words', () => {
  assert.ok(ids('هاكاثوون').includes('ai-hackathon'));
  assert.ok(ids('سيبرانى').includes('cyber-ctf'), 'alef maksura for yeh');
});

test('Arabic prefix and exclusion work', () => {
  assert.ok(ids('مساب*').includes('cyber-ctf'));
  assert.ok(!ids('مسابقة -هاكاثون').includes('ai-hackathon'));
  assert.ok(ids('مسابقة -هاكاثون').includes('cyber-ctf'));
});

// ---------------------------------------------------------------- search: diacritics, phrases, exclusion

test('Latin diacritics are ignored in both directions', () => {
  assert.ok(ids('cafe').includes('cafe-hackathon'));
  assert.ok(ids('CAFÉ').includes('cafe-hackathon'));
  assert.ok(ids('resume').includes('cafe-hackathon'));
  assert.ok(ids('résumé parser').includes('cafe-hackathon'));
  assert.ok(ids('naive bayes').includes('cafe-hackathon'));
});

test('a quoted phrase must match as a phrase', () => {
  assert.deepEqual(ids('"capture the flag"'), ['cyber-ctf']);
  assert.deepEqual(ids('"flag the capture"'), []);
  assert.ok(ids('flag capture').includes('cyber-ctf'), 'unquoted words match in any order');
  assert.deepEqual(ids('"capture the fl"'), ['cyber-ctf'], 'the last word may still be typed');
  assert.ok(ids('"cyber security"').includes('cyber-ctf'));
  assert.ok(!ids('"cyber security"').includes('ciso-summit'), 'cyber and security apart are not the phrase');
  assert.ok(ids('"cyber security" students').includes('cyber-ctf'));
});

test('a phrase typed with Arabic marks or digits still matches', () => {
  assert.ok(ids('"مسابقة الأمن"').includes('cyber-ctf'));
  assert.ok(ids('"كأس إيماجين من مايكروسوفت ٢٠٢٧"').includes('imagine-cup'));
});

test('a leading minus excludes', () => {
  assert.deepEqual(ids('hackathon -cafe'), ['ai-hackathon']);
  assert.ok(ids('competition').includes('imagine-cup'));
  assert.ok(!ids('competition -online').includes('imagine-cup'));
  const noFree = ids('competition -free');
  for (const id of ['cyber-ctf', 'ai-hackathon', 'imagine-cup']) assert.ok(!noFree.includes(id), id);
  assert.ok(noFree.includes('undated-contest'));
  assert.ok(!ids('contest -"capture the flag"').includes('cyber-ctf'));
});

test('exclusion also removes synonyms of the excluded word', () => {
  assert.ok(!ids('event -startup').includes('startup-weekend'));
  assert.ok(!ids('competition -هاكاثون').includes('ai-hackathon'));
});

test('a query of only exclusions lists everything else', () => {
  const r = searchItems(index, '-hackathon');
  assert.equal(r.size, FIXTURE.length - 2);
  assert.ok(!r.has('ai-hackathon') && !r.has('cafe-hackathon'));
  assert.ok(r.has('minimal'));
  for (const v of r.values()) assert.equal(v, 0);
});

test('search finds items by location, organizer and tags', () => {
  assert.ok(ids('muscat').includes('ai-hackathon'));
  assert.ok(ids('lisbon').includes('web-summit-lisbon'));
  assert.ok(ids('omantel').includes('ai-hackathon'));
  assert.ok(ids('cybertalents').includes('cyber-ctf'));
  assert.ok(ids('pitch').includes('startup-weekend'));
  assert.ok(ids('جامعة السلطان قابوس').includes('arabic-workshop'));
});

// ---------------------------------------------------------------- search: robustness

test('hostile queries and items never throw', () => {
  const queries = ['(((', '\\', '[', '*', '"', '-', '--', "'", '%', '.*', '$1', '😀', 'a'.repeat(5000), '"'.repeat(50), '- - -', '\n\t', '\u0000x', '__proto__', 'constructor', '-__proto__', 'x*'.repeat(200)];
  for (const q of queries) assert.doesNotThrow(() => searchItems(index, q), q.slice(0, 20));
  const bad = [null, undefined, 5, 'x', [], {}, { id: null }, { id: 1, title: 5 }, { id: 'a', ar: 'str', tags: 'x', topics: 'ai' }, { id: 'b', title: {}, summary: [] }, { id: 'c', topics: [null, 3, {}] }];
  assert.doesNotThrow(() => {
    const i = buildIndex(bad);
    searchItems(i, 'a');
    suggest(i, 'a');
  });
  assert.doesNotThrow(() => buildIndex(null));
  assert.equal(searchItems(buildIndex([]), 'anything').size, 0);
  assert.equal(searchItems(undefined, 'x'), null);
  assert.deepEqual(suggest(undefined, 'x'), []);
});

test('prototype-like words are ordinary words', () => {
  const i = buildIndex([{ id: 'p', title: 'constructor toString __proto__ hasOwnProperty' }]);
  assert.ok(searchItems(i, 'constructor').has('p'));
  assert.ok(searchItems(i, 'hasOwnProperty').has('p'));
  assert.equal(searchItems(i, 'valueOf').size, 0);
});

test('numeric ids work and results are keyed by string', () => {
  const i = buildIndex([{ id: 7, title: 'Seven' }]);
  assert.ok(searchItems(i, 'seven').has('7'));
});

// ---------------------------------------------------------------- highlightSegments

const joined = segments => segments.map(s => s.t).join('');
const marked = segments => segments.filter(s => s.m).map(s => s.t);

test('segments always cover the whole text', () => {
  const texts = ['National Cyber Security CTF', 'مسابقة الأمن السيبراني الوطنية', 'Café Hackathon: Résumé Parser & Naïve Bayes', '  leading and trailing  ', 'a', '2027', 'Women\'s Day!', 'x'.repeat(300), 'مختلط mixed نص text'];
  const queries = ['cyber', 'مسابقة', 'hackathon -muscat', '"cyber security"', '', 'zzz', 'ai*', '٢٠٢٧', 'womens', '-', 'the'];
  for (const text of texts) {
    for (const q of queries) assert.equal(joined(highlightSegments(text, q)), text, `${text} / ${q}`);
  }
  assert.deepEqual(highlightSegments('', 'x'), []);
  assert.deepEqual(highlightSegments(null, 'x'), []);
});

test('segments alternate between matched and unmatched', () => {
  const segs = highlightSegments('National Cyber Security CTF in Muscat', 'cyber muscat');
  for (let i = 1; i < segs.length; i++) assert.notEqual(segs[i].m, segs[i - 1].m);
});

test('matched words are marked', () => {
  assert.deepEqual(marked(highlightSegments('National Cyber Security CTF', 'national')), ['National']);
  assert.deepEqual(marked(highlightSegments('National Cyber Security CTF', 'cyber')), ['Cyber Security', 'CTF'], 'a synonym phrase is marked as a run');
  assert.deepEqual(highlightSegments('Muscat AI Hackathon', 'hackathon'), [{ t: 'Muscat AI ', m: false }, { t: 'Hackathon', m: true }]);
});

test('typos, prefixes and synonyms are highlighted too', () => {
  assert.deepEqual(marked(highlightSegments('Muscat AI Hackathon', 'hackaton')), ['Hackathon']);
  assert.deepEqual(marked(highlightSegments('Hackathons and contests', 'hack*')), ['Hackathons']);
  assert.deepEqual(marked(highlightSegments('A friendly contest for students', 'competition')), ['contest']);
  assert.deepEqual(marked(highlightSegments('Machine learning prototype', 'ai')), ['Machine learning']);
});

test('Arabic words are highlighted through articles, plurals and marks', () => {
  assert.deepEqual(marked(highlightSegments('مسابقة الأمن السيبراني الوطنية', 'مسابقة')), ['مسابقة']);
  assert.deepEqual(marked(highlightSegments('مسابقة الأمن السيبراني الوطنية', 'المسابقات')), ['مسابقة']);
  assert.deepEqual(marked(highlightSegments('مسابقة الأمن السيبراني الوطنية', 'الامن')), ['الأمن']);
  assert.deepEqual(marked(highlightSegments('كأس إيماجين ٢٠٢٧', '2027')), ['٢٠٢٧']);
});

test('a quoted phrase is one marked segment', () => {
  assert.deepEqual(highlightSegments('A capture the flag contest', '"capture the flag"'), [
    { t: 'A ', m: false }, { t: 'capture the flag', m: true }, { t: ' contest', m: false }
  ]);
  assert.deepEqual(marked(highlightSegments('flag and capture', '"capture the flag"')), []);
});

test('excluded words and non-matches are not marked', () => {
  assert.deepEqual(highlightSegments('Muscat AI Hackathon', 'hackathon -muscat').filter(s => s.m).map(s => s.t), ['Hackathon']);
  assert.deepEqual(highlightSegments('Nothing here', 'zebra'), [{ t: 'Nothing here', m: false }]);
  assert.deepEqual(highlightSegments('Nothing here', ''), [{ t: 'Nothing here', m: false }]);
  assert.deepEqual(highlightSegments('Nothing here', undefined), [{ t: 'Nothing here', m: false }]);
});

test('diacritics and apostrophes do not hide a match', () => {
  assert.deepEqual(marked(highlightSegments('Café Hackathon', 'cafe')), ['Café']);
  assert.deepEqual(marked(highlightSegments("Women's Day", 'womens')), ["Women's"]);
});

test('the words the index matched are the words highlighted', () => {
  for (const item of FIXTURE.filter(i => i.title)) {
    for (const q of ['hackathon', 'cyber', 'مسابقة', 'startup', 'oman']) {
      const hit = searchItems(index, q).has(item.id);
      const inTitle = marked(highlightSegments(item.title, q)).length > 0 || (item.ar && marked(highlightSegments(item.ar.title || '', q)).length > 0);
      if (inTitle) assert.ok(hit, `${item.id} highlights ${q} but search misses it`);
    }
  }
});

// ---------------------------------------------------------------- suggest

test('suggest completes topic labels, organizers and title words', () => {
  const s = suggest(index, 'cy');
  assert.equal(s[0], 'Cybersecurity', 'topic labels come first');
  assert.ok(s.includes('CyberTalents'));
  assert.ok(s.length <= 6);
  assert.equal(new Set(s.map(x => x.toLowerCase())).size, s.length);
  assert.ok(suggest(index, 'om').includes('Omantel'));
  assert.ok(suggest(index, 'hacka').includes('Hackathon'));
});

test('suggest follows the script being typed and honours the limit', () => {
  const ar = suggest(index, 'مس');
  assert.ok(ar.length > 0);
  for (const s of ar) assert.match(s, /\p{Script=Arabic}/u);
  assert.ok(ar.includes('مسقط'));
  assert.ok(suggest(index, 'a', { limit: 2 }).length <= 2);
  assert.deepEqual(suggest(index, 'a', { limit: 0 }), []);
  assert.ok(suggest(index, 'c', { limit: 12 }).length <= 12);
});

test('suggest with nothing typed offers topic labels in the interface language', () => {
  const en = suggest(index, '', { lang: 'en' });
  const ar = suggest(index, '', { lang: 'ar' });
  assert.ok(en.length > 0 && en.length <= 6);
  assert.ok(en.includes('AI & machine learning'));
  assert.ok(ar.includes('الذكاء الاصطناعي وتعلّم الآلة'));
});

test('suggest returns nothing for unknown prefixes and does not repeat the typed word', () => {
  assert.deepEqual(suggest(index, 'zzzz'), []);
  assert.ok(!suggest(index, 'Cybersecurity').some(s => s.toLowerCase() === 'cybersecurity'));
  assert.ok(Array.isArray(suggest(index, null)));
});

// ---------------------------------------------------------------- performance guard

function cloneItems(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = FIXTURE[i % FIXTURE.length];
    const word = `w${(i * 7919 % 977).toString(36)}x${i}`;
    out.push({ ...src, id: `${src.id}-${i}`, title: `${src.title || ''} ${word}`, summary: `${src.summary || ''} ${word} extra${i % 101}` });
  }
  return out;
}

test('performance guard: 500 items index in under 150 ms and a search takes under 20 ms', () => {
  const items = cloneItems(500);
  let best = Infinity;
  let big;
  for (let round = 0; round < 3; round++) {
    const t0 = performance.now();
    big = buildIndex(items);
    best = Math.min(best, performance.now() - t0);
  }
  assert.ok(best < 150, `index build took ${best.toFixed(1)} ms`);

  for (const q of ['hackathon', 'cyber security students', 'مسابقة ذكاء اصطناعي', 'programing contest', 'startup*', 'hackaton oman -online', 'ai', '"capture the flag"']) {
    searchItems(big, q);
    let slowest = 0;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      searchItems(big, q);
      slowest = Math.max(slowest, performance.now() - t0);
    }
    assert.ok(slowest < 20, `"${q}" took ${slowest.toFixed(1)} ms`);
  }
  const t0 = performance.now();
  suggest(big, 'cy');
  assert.ok(performance.now() - t0 < 50);
});

test('performance guard: index cost grows about linearly with the data', () => {
  const time = n => {
    const items = cloneItems(n);
    buildIndex(items);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      buildIndex(items);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  const small = time(250);
  const large = time(1000);
  assert.ok(large < Math.max(small, 3) * 12, `250 items ${small.toFixed(1)} ms, 1000 items ${large.toFixed(1)} ms`);
});
