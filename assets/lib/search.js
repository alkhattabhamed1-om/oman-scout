// Search: find items the way a student types them, in English or Arabic, forgiving typos.
//
// Query language: space-separated tokens, AND across tokens; "quoted phrase" must match as a
// phrase; word* is a prefix match; -word or -"phrase" excludes. Each token also stands for its
// synonym group (hackathon / هاكاثون / hack, ...), so the group is OR-ed inside the AND.
//
// How a token matches a word of an item, best first (the literal token, not its synonyms):
//   whole word 1.0 | word starts with it 0.75 (3+ chars) | typo within 1 edit 0.55 (5+ letters,
//   2 edits 0.45 from 8) | word contains it 0.4 (4+ chars). Synonyms match whole words 0.85 or by
//   prefix 0.6 (4+ chars). Tokens of 1-2 characters match whole words only.
// Relevance of an item = sum over query tokens of (field weight x match quality), taking the
// best field per token. Field weights: title 6, organizer / tags / topics 3, location / cost /
// facets 2, summary / why / eligibility note 1; English and the Arabic `ar` fields both count.
//
// Normalisation (normalizeText) folds Latin accents, Arabic marks and letter forms and digits.
// Arabic words are also lightly stemmed (definite article, common plural and feminine endings) on
// both sides, so مسابقة, مسابقات and المسابقات meet. Fuzzy matching needs 5+ letters (4+ for Arabic).
//
// Cost: buildIndex is linear in the text. A search scans the vocabulary a few times, never the items.
// Invariants: pure, never throws on malformed items or queries.

import { TOPICS } from './topics.js';

// ---------------------------------------------------------------- normalisation

const NON_ASCII = /[^\x00-\x7f]/;
const APOSTROPHE_ASCII = /['`]/g;

// Character classes are written as code points so invisible marks stay readable in the source.
const char = code => String.fromCharCode(code);
const classBody = ranges => ranges.map(([a, b = a]) => char(a) + (b === a ? '' : '-' + char(b))).join('');
const charClass = (flags, ...ranges) => new RegExp('[' + classBody(ranges) + ']', flags);

const ARABIC = charClass('', [0x600, 0x6ff]);
const ACCENTED = charClass('', [0xc0, 0x24f], [0x1e00, 0x1eff]); // Latin letters that can carry accents
// Anything that is not a Latin letter, a digit or an Arabic letter separates words.
const NON_WORD = new RegExp('[^a-z0-9' + classBody([[0x621, 0x64a], [0x66e, 0x6d3]]) + ']+', 'g');

// What the single folding pass does to a character: '' deletes it, anything else replaces it.
const FOLD = new Map();
function fold(from, to, last = from) {
  for (let c = from; c <= last; c++) FOLD.set(char(c), typeof to === 'function' ? to(c) : to);
}
for (const c of [0x27, 0x60, 0x2bc, 0x2019]) fold(c, ''); // apostrophes join: women's -> womens
fold(0x300, '', 0x36f); // accents split off by NFD
fold(0xdf, 'ss'); fold(0xe6, 'ae'); fold(0x153, 'oe'); // sharp s, ae, oe
fold(0xf8, 'o'); fold(0x142, 'l'); fold(0x111, 'd'); fold(0x131, 'i'); // letters NFD leaves whole
fold(0x640, ''); // tatweel
fold(0x64b, '', 0x65f); // tashkeel and hamza marks
fold(0x670, ''); // superscript alef
fold(0x6d6, '', 0x6ed); // Quranic marks
for (const c of [0x622, 0x623, 0x625, 0x671]) fold(c, char(0x627)); // alef forms -> alef
fold(0x624, char(0x648)); // waw with hamza -> waw
for (const c of [0x626, 0x649, 0x6cc]) fold(c, char(0x64a)); // hamza on yeh, alef maksura, Persian yeh -> yeh
fold(0x629, char(0x647)); // teh marbuta -> heh
fold(0x6a9, char(0x643)); // Persian kaf -> kaf
fold(0x660, c => char(48 + c - 0x660), 0x669); // Arabic-Indic digits
fold(0x6f0, c => char(48 + c - 0x6f0), 0x6f9); // Persian digits
const FOLD_RE = charClass('g', ...[...FOLD.keys()].map(k => [k.charCodeAt(0)]));

/** Lower-case, strip Latin diacritics and Arabic marks, fold Arabic letter forms and digits, collapse punctuation. */
export function normalizeText(s) {
  if (s == null) return '';
  let x = (typeof s === 'string' ? s : String(s)).toLowerCase();
  if (NON_ASCII.test(x)) {
    if (ACCENTED.test(x)) x = x.normalize('NFD');
    x = x.replace(FOLD_RE, c => FOLD.get(c));
  } else {
    x = x.replace(APOSTROPHE_ASCII, '');
  }
  return x.replace(NON_WORD, ' ').trim();
}

const AR_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال'];
const AR_PLURALS = ['ات', 'ون', 'ين', 'ان'];

// Light Arabic stemmer: article prefix, one plural ending, then the feminine and relative endings.
function stem(w) {
  const c = w.charCodeAt(0);
  if (w.length < 4 || c < 0x600 || c > 0x6ff) return w;
  for (const p of AR_PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 3) { w = w.slice(p.length); break; }
  }
  for (const s of AR_PLURALS) {
    if (w.endsWith(s) && w.length - 2 >= 3) { w = w.slice(0, -2); break; }
  }
  if (w.length > 3 && w.endsWith('ه')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('ي')) w = w.slice(0, -1);
  return w;
}

// Normalised, stemmed words of a text: the terms the index and the matcher share.
function tokens(text) {
  const n = normalizeText(text);
  if (!n) return [];
  const words = n.split(' ');
  return ARABIC.test(n) ? words.map(stem) : words;
}

const STOP = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'for', 'to', 'and', 'or', 'with', 'by', 'from', 'is', 'are', 'me', 'my', 'i',
  'في', 'من', 'الي', 'علي', 'عن', 'و', 'مع', 'هل', 'ما', 'ماذا', 'هذا', 'هذه', 'او', 'كل'
]);

// ---------------------------------------------------------------- synonyms

// One array per concept. A term may be a phrase. Each term belongs to one group only.
const SYNONYMS = [
  ['hackathon', 'hackathons', 'hack', 'hackday', 'هاكاثون', 'هاكاثونات', 'هكاثون', 'هاكثون', 'هاكاتون'],
  ['competition', 'competitions', 'contest', 'contests', 'challenge', 'challenges', 'olympiad', 'olympiads', 'tournament', 'tournaments', 'championship', 'مسابقة', 'مسابقات', 'تحدي', 'تحديات', 'أولمبياد', 'بطولة', 'منافسة'],
  ['ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'genai', 'generative ai', 'llm', 'ذكاء اصطناعي', 'الذكاء الاصطناعي', 'تعلم الآلة', 'تعلّم الآلة', 'التعلم الآلي', 'تعلم عميق'],
  ['data science', 'analytics', 'data analytics', 'big data', 'علم البيانات', 'تحليل البيانات', 'تحليلات', 'البيانات الضخمة'],
  ['programming', 'coding', 'code', 'software', 'software engineering', 'developer', 'developers', 'برمجة', 'برمجيات', 'مبرمج', 'مبرمجين', 'مطور', 'مطورين', 'هندسة البرمجيات'],
  ['web', 'website', 'websites', 'mobile', 'web development', 'app development', 'mobile app', 'تطوير الويب', 'تطوير التطبيقات', 'تطبيقات', 'تطبيق', 'ويب', 'جوال'],
  ['cyber', 'cybersecurity', 'cyber security', 'security', 'infosec', 'ctf', 'capture the flag', 'pentest', 'penetration testing', 'أمن سيبراني', 'الأمن السيبراني', 'سيبراني', 'أمن المعلومات', 'الأمن المعلوماتي'],
  ['cloud', 'cloud computing', 'سحابة', 'السحابة', 'سحابي', 'الحوسبة السحابية', 'البنية التحتية'],
  ['startup', 'startups', 'start up', 'start ups', 'entrepreneurship', 'entrepreneur', 'entrepreneurs', 'accelerator', 'accelerators', 'incubator', 'incubators', 'ريادة', 'ريادة الأعمال', 'رواد الأعمال', 'شركات ناشئة', 'شركة ناشئة', 'حاضنة', 'حاضنات', 'مسرعة', 'مسرعات'],
  ['fintech', 'financial technology', 'تقنية مالية', 'التقنية المالية', 'تكنولوجيا مالية'],
  ['iot', 'internet of things', 'robotics', 'robot', 'robots', 'hardware', 'embedded', 'إنترنت الأشياء', 'روبوتات', 'روبوت', 'عتاد', 'إلكترونيات'],
  ['game', 'games', 'gaming', 'game development', 'esports', 'ألعاب', 'لعبة', 'تطوير الألعاب'],
  ['green', 'sustainability', 'sustainable', 'renewable', 'renewables', 'clean energy', 'climate', 'استدامة', 'مستدام', 'طاقة متجددة', 'الطاقة النظيفة', 'المناخ'],
  ['career', 'careers', 'job', 'jobs', 'recruitment', 'hiring', 'networking', 'career fair', 'وظيفة', 'وظائف', 'توظيف', 'مهنة', 'مسار مهني'],
  ['policy', 'policies', 'regulation', 'regulations', 'regulatory', 'legislation', 'سياسة', 'سياسات', 'تشريع', 'تشريعات', 'لوائح', 'تنظيم'],
  ['student', 'students', 'undergraduate', 'university', 'universities', 'college', 'طلبة', 'طلاب', 'طالب', 'طالبة', 'جامعة', 'جامعات', 'جامعي', 'كلية'],
  ['graduate', 'graduates', 'graduation', 'fresh graduate', 'خريج', 'خريجين', 'حديثي التخرج'],
  ['free', 'no cost', 'complimentary', 'مجاني', 'مجانا', 'مجانية', 'بدون رسوم', 'بلا مقابل'],
  ['scholarship', 'scholarships', 'grant', 'grants', 'bursary', 'fellowship', 'fellowships', 'منحة', 'منح', 'زمالة', 'زمالات'],
  ['funding', 'fund', 'funds', 'investment', 'investor', 'investors', 'venture capital', 'seed funding', 'تمويل', 'استثمار', 'مستثمر', 'رأس المال الجريء'],
  ['internship', 'internships', 'intern', 'interns', 'traineeship', 'trainee', 'training', 'تدريب', 'تدريب تعاوني', 'متدرب'],
  ['online', 'virtual', 'remote', 'عن بعد', 'أونلاين', 'افتراضي', 'عبر الإنترنت'],
  ['deadline', 'deadlines', 'closing', 'apply by', 'last date', 'آخر موعد', 'موعد التقديم', 'الموعد النهائي', 'إغلاق التسجيل'],
  ['event', 'events', 'conference', 'conferences', 'summit', 'summits', 'expo', 'expos', 'forum', 'forums', 'meetup', 'meetups', 'فعالية', 'فعاليات', 'مؤتمر', 'مؤتمرات', 'قمة', 'معرض', 'ملتقى', 'منتدى'],
  ['workshop', 'workshops', 'bootcamp', 'bootcamps', 'masterclass', 'ورشة', 'ورشة عمل', 'ورش عمل', 'معسكر', 'معسكرات'],
  ['oman', 'omani', 'sultanate of oman', 'عمان', 'عماني', 'سلطنة عمان'],
  ['muscat', 'مسقط'],
  ['gcc', 'gulf', 'الخليج', 'دول الخليج', 'مجلس التعاون'],
  ['uae', 'emirates', 'united arab emirates', 'الإمارات', 'الإمارات العربية المتحدة'],
  ['dubai', 'دبي'],
  ['abu dhabi', 'أبوظبي', 'أبو ظبي'],
  ['saudi', 'saudi arabia', 'ksa', 'السعودية', 'المملكة العربية السعودية'],
  ['riyadh', 'الرياض'],
  ['qatar', 'doha', 'قطر', 'الدوحة'],
  ['bahrain', 'manama', 'البحرين', 'المنامة'],
  ['kuwait', 'الكويت'],
  ['global', 'worldwide', 'international', 'عالمي', 'دولي']
];

const GROUPS = [];
const GROUP_OF = new Map();
const SYNONYM_WORDS = [];

for (const raw of SYNONYMS) {
  const group = [];
  for (const term of raw) {
    const t = tokens(term).join(' ');
    if (!t || GROUP_OF.has(t)) continue;
    GROUP_OF.set(t, GROUPS.length);
    group.push(t);
    if (!t.includes(' ')) SYNONYM_WORDS.push(t);
  }
  GROUPS.push(group);
}

// The synonym group of a single word or phrase: exact, then without a plural s, then within a typo.
function groupOf(t) {
  let g = GROUP_OF.get(t);
  if (g !== undefined) return GROUPS[g];
  if (!isFuzzyTerm(t) || t.length < (ARABIC.test(t) ? 5 : 6)) return null;
  if (t.endsWith('s')) {
    g = GROUP_OF.get(t.slice(0, -1)) ?? (t.endsWith('es') ? GROUP_OF.get(t.slice(0, -2)) : undefined);
    if (g !== undefined) return GROUPS[g];
  }
  const k = t.length >= 8 ? 2 : 1;
  let best = null;
  let bestDistance = k + 1;
  for (const word of SYNONYM_WORDS) {
    if (word.length < 4 || Math.abs(word.length - t.length) > k) continue;
    const d = editDistance(t, word, k);
    if (d < bestDistance) { best = word; bestDistance = d; }
  }
  return best === null ? null : GROUPS[GROUP_OF.get(best)];
}

// ---------------------------------------------------------------- edit distance

const ROWS = [new Int32Array(66), new Int32Array(66), new Int32Array(66)];

// Damerau-Levenshtein (optimal string alignment) distance, or k + 1 as soon as it must exceed k.
function editDistance(a, b, k) {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > k || m > 64) return k + 1;
  let prev2 = ROWS[0];
  let prev = ROWS[1];
  let cur = ROWS[2];
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === cb ? 0 : 1));
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return k + 1;
    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  return prev[m] <= k ? prev[m] : k + 1;
}

const LETTERS = /^\p{L}+$/u;

// Typos are only forgiven in whole words of letters: 5+ letters, 4+ in Arabic script.
function isFuzzyTerm(t) {
  return t.length >= (ARABIC.test(t) ? 4 : 5) && LETTERS.test(t);
}

const editsAllowed = t => (t.length >= 8 ? 2 : 1);

// ---------------------------------------------------------------- query

const TOKEN = /(-?)(?:["“«]([^"“”«»]*)["”»]?|(\S+))/gu;

/** Parse a query into synonym groups, quoted phrases, exclusions and prefix tokens. */
export function parseQuery(q) {
  const raw = q == null ? '' : String(q);
  const phrases = [];
  const excluded = [];
  const words = [];
  for (const m of raw.matchAll(TOKEN)) {
    const negated = m[1] === '-';
    if (m[2] !== undefined) {
      const phrase = tokens(m[2]).join(' ');
      if (phrase) (negated ? excluded : phrases).push(phrase);
      continue;
    }
    const parts = tokens(m[3]);
    if (!parts.length) continue;
    if (negated) { excluded.push(parts.join(' ')); continue; }
    parts.forEach((t, i) => words.push({ t, star: m[3].endsWith('*') && i === parts.length - 1 }));
  }

  const units = [];
  for (let i = 0; i < words.length;) {
    let n = 0;
    for (const len of [3, 2]) {
      const span = words.slice(i, i + len);
      if (span.length === len && span.every(w => !w.star) && GROUP_OF.has(span.map(w => w.t).join(' '))) { n = len; break; }
    }
    if (n) {
      const key = words.slice(i, i + n).map(w => w.t).join(' ');
      units.push({ terms: [key, ...GROUPS[GROUP_OF.get(key)].filter(t => t !== key)], star: false });
      i += n;
    } else {
      const { t, star } = words[i];
      const group = star ? null : groupOf(t);
      units.push({ terms: group ? [t, ...group.filter(x => x !== t)] : [t], star });
      i++;
    }
  }
  // "the hackathons in oman": drop filler words unless nothing else is left.
  const kept = units.filter(u => u.star || u.terms.length > 1 || !STOP.has(u.terms[0]));
  const used = kept.length ? kept : units;
  const groups = [];
  const prefix = [];
  for (const u of used) {
    if (groups.some(g => g[0] === u.terms[0])) continue;
    groups.push(u.terms);
    if (u.star) prefix.push(u.terms[0]);
  }
  return { groups, phrases, excluded, prefix, raw };
}

// ---------------------------------------------------------------- index

const TEXT_FIELDS = [['title', 6], ['organizer', 3], ['location', 2], ['summary', 1], ['why', 1], ['eligibilityNote', 1]];

// Words for the facets an item carries, so "online", "competition" or "students" find items by kind.
const FACETS = {
  category: { competition: 'competition contest مسابقة', event: 'event فعالية', funding: 'funding تمويل', competitor: 'competitor منافس' },
  region: { oman: 'oman عمان', gcc: 'gcc gulf الخليج', global: 'global worldwide عالمي' },
  mode: { 'in-person': 'in person حضوري', online: 'online عن بعد', hybrid: 'hybrid هجين' },
  audience: { students: 'students طلبة', youth: 'youth شباب', startups: 'startups شركات ناشئة', professionals: 'professionals محترفين', everyone: 'everyone الجميع', school: 'school مدارس', companies: 'companies شركات' }
};
const FACET_TOKENS = {};
for (const [name, table] of Object.entries(FACETS)) {
  FACET_TOKENS[name] = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, tokens(v)]));
}
const ONLINE_TOKENS = tokens('online عن بعد');
const TOPIC_TOKENS = new Map(TOPICS.map(t => [t.id, tokens(`${t.id} ${t.en} ${t.ar}`)]));

function facet(name, key) {
  return typeof key === 'string' && Object.hasOwn(FACET_TOKENS[name], key) ? FACET_TOKENS[name][key] : null;
}

// The [tokens, weight] pairs of one item.
function fieldsOf(it) {
  const out = [];
  const add = (toks, w) => { if (toks && toks.length) out.push([toks, w]); };
  const text = (value, w) => { if (typeof value === 'string') add(tokens(value), w); };
  const ar = it.ar && typeof it.ar === 'object' ? it.ar : null;
  for (const [name, w] of TEXT_FIELDS) {
    text(it[name], w);
    if (ar) text(ar[name], w);
  }
  for (const source of [it.tags, ar && ar.tags]) {
    if (Array.isArray(source)) text(source.filter(x => typeof x === 'string').join(' '), 3);
  }
  if (Array.isArray(it.topics)) {
    for (const id of it.topics) add(TOPIC_TOKENS.get(id) || (typeof id === 'string' ? tokens(id) : null), 3);
  }
  text(it.cost, 2);
  text(it.prize, 1);
  add(facet('category', it.category), 2);
  add(facet('region', it.region), 2);
  add(facet('mode', it.mode), 2);
  add(facet('audience', it.audience), 2);
  if (it.travel === 'online') add(ONLINE_TOKENS, 2);
  return out;
}

/** Build the search index for a list of items (linear in the text; skips entries without an id). */
export function buildIndex(items) {
  const index = { items: [], ids: [], vocab: [], post: [], term: new Map(), byChar: new Map(), fields: [], suggest: null };
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object' || (typeof it.id !== 'string' && typeof it.id !== 'number')) continue;
    const doc = index.ids.length;
    const kept = [];
    for (const [toks, w] of fieldsOf(it)) {
      kept.push([w, ' ' + toks.join(' ') + ' ']);
      for (const t of toks) {
        let id = index.term.get(t);
        if (id === undefined) {
          id = index.vocab.length;
          index.term.set(t, id);
          index.vocab.push(t);
          index.post.push([]);
          const bucket = index.byChar.get(t[0]);
          if (bucket) bucket.push(id); else index.byChar.set(t[0], [id]);
        }
        // Postings are flat [doc, weight, doc, weight, ...]; a repeat in the same item keeps the best weight.
        const list = index.post[id];
        const n = list.length;
        if (n && list[n - 2] === doc) { if (list[n - 1] < w) list[n - 1] = w; } else list.push(doc, w);
      }
    }
    index.items.push(it);
    index.ids.push(String(it.id));
    index.fields.push(kept);
  }
  return index;
}

// ---------------------------------------------------------------- matching

function addPostings(list, acc, quality) {
  for (let i = 0; i < list.length; i += 2) {
    const s = list[i + 1] * quality;
    if (s > (acc.get(list[i]) || 0)) acc.set(list[i], s);
  }
}

// Words starting with `t` (longer than it) in the vocabulary.
function addPrefix(index, acc, t, quality) {
  const bucket = index.byChar.get(t[0]);
  if (!bucket) return;
  for (const id of bucket) {
    const v = index.vocab[id];
    if (v.length > t.length && v.startsWith(t)) addPostings(index.post[id], acc, quality);
  }
}

function addExact(index, acc, t, quality) {
  const id = index.term.get(t);
  if (id !== undefined) addPostings(index.post[id], acc, quality);
}

// A phrase must start at a word boundary; ending at one scores higher than ending mid-word.
function addPhrase(index, acc, phrase, factor) {
  const space = phrase.indexOf(' ');
  const first = space < 0 ? phrase : phrase.slice(0, space);
  const bucket = index.byChar.get(first[0]);
  if (!bucket) return;
  const begin = ' ' + phrase;
  const whole = begin + ' ';
  const seen = new Set();
  for (const id of bucket) {
    if (!index.vocab[id].startsWith(first)) continue;
    const list = index.post[id];
    for (let i = 0; i < list.length; i += 2) {
      const doc = list[i];
      if (seen.has(doc)) continue;
      seen.add(doc);
      let best = 0;
      for (const [w, text] of index.fields[doc]) {
        const s = text.includes(whole) ? w : text.includes(begin) ? w * 0.75 : 0;
        if (s > best) best = s;
      }
      if (best && best * factor > (acc.get(doc) || 0)) acc.set(doc, best * factor);
    }
  }
}

// The literal token: whole word, prefix, substring, typo. One pass over the vocabulary.
function addLiteral(index, acc, t) {
  const L = t.length;
  addExact(index, acc, t, 1);
  if (L < 3) return;
  const substring = L >= 4;
  const fuzzy = isFuzzyTerm(t);
  const k = editsAllowed(t);
  const { vocab, post } = index;
  for (let id = 0; id < vocab.length; id++) {
    const v = vocab[id];
    let q = 0;
    if (v.length > L) {
      const at = substring ? v.indexOf(t) : (v.startsWith(t) ? 0 : -1);
      if (at === 0) q = 0.75; else if (at > 0) q = 0.4;
    }
    if (fuzzy && q < 0.55 && v !== t && Math.abs(v.length - L) <= k) {
      const d = editDistance(t, v, k);
      if (d <= k) q = Math.max(q, d === 1 ? 0.55 : 0.45);
    }
    if (q) addPostings(post[id], acc, q);
  }
}

// A synonym: whole word, or by prefix from 4 characters.
function addAlternative(index, acc, t) {
  addExact(index, acc, t, 0.85);
  if (t.length >= 4) addPrefix(index, acc, t, 0.6);
}

// Item index -> best score for one group of terms. `strict` (exclusions) skips substring and typo matching.
function matchGroup(index, group, star, strict) {
  const acc = new Map();
  group.forEach((t, j) => {
    if (t.includes(' ')) addPhrase(index, acc, t, j === 0 ? 1 : 0.9);
    else if (star) { addExact(index, acc, t, 1); addPrefix(index, acc, t, 0.9); }
    else if (j > 0) addAlternative(index, acc, t);
    else if (strict) { addExact(index, acc, t, 1); if (t.length >= 3) addPrefix(index, acc, t, 0.75); }
    else addLiteral(index, acc, t);
  });
  return acc;
}

/** Find items for a query: Map(id -> relevance) best first, or null when the query has no terms. */
export function searchItems(index, query) {
  if (!index || !Array.isArray(index.ids)) return null;
  const q = parseQuery(query);
  const required = [];
  for (const g of q.groups) required.push(matchGroup(index, g, q.prefix.includes(g[0]), false));
  for (const p of q.phrases) required.push(matchGroup(index, [p], false, true));
  if (!required.length && !q.excluded.length) return null;

  const out = new Set();
  for (const e of q.excluded) {
    const group = e.includes(' ') ? [e] : [e, ...(GROUP_OF.has(e) ? GROUPS[GROUP_OF.get(e)].filter(t => t !== e) : [])];
    for (const doc of matchGroup(index, group, false, true).keys()) out.add(doc);
  }

  const hits = [];
  if (!required.length) {
    for (let doc = 0; doc < index.ids.length; doc++) if (!out.has(doc)) hits.push([doc, 0]);
  } else {
    required.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = required;
    for (const [doc, s] of smallest) {
      if (out.has(doc)) continue;
      let total = s;
      for (const m of rest) {
        const v = m.get(doc);
        if (v === undefined) { total = -1; break; }
        total += v;
      }
      if (total >= 0) hits.push([doc, total]);
    }
  }
  hits.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return new Map(hits.map(([doc, s]) => [index.ids[doc], Math.round(s * 100) / 100]));
}

// ---------------------------------------------------------------- highlighting

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

// Does a text word (already a term) match one non-phrase term of a group?
function wordMatches(word, t, literal, star) {
  if (word === t) return true;
  if (star) return word.startsWith(t);
  if (!literal) return t.length >= 4 && word.startsWith(t);
  if (t.length >= 3 && word.startsWith(t)) return true;
  if (t.length >= 4 && word.includes(t)) return true;
  return isFuzzyTerm(t) && Math.abs(word.length - t.length) <= editsAllowed(t) && editDistance(t, word, editsAllowed(t)) <= editsAllowed(t);
}

/** Split text into segments that cover it whole; m marks the words the query matched. */
export function highlightSegments(text, query) {
  const s = text == null ? '' : String(text);
  if (!s) return [];
  const q = parseQuery(query);
  const words = [];
  for (const m of s.matchAll(WORD)) {
    const t = tokens(m[0])[0];
    if (t) words.push({ start: m.index, end: m.index + m[0].length, t });
  }
  const marks = new Array(words.length).fill(0);
  let run = 0;

  const sequences = [];
  for (const phrase of q.phrases) sequences.push(phrase.split(' '));
  q.groups.forEach(g => g.forEach(t => { if (t.includes(' ')) sequences.push(t.split(' ')); }));
  for (const seq of sequences) {
    for (let i = 0; i + seq.length <= words.length; i++) {
      let ok = true;
      for (let x = 0; x < seq.length && ok; x++) {
        const w = words[i + x].t;
        ok = x === seq.length - 1 ? w.startsWith(seq[x]) : w === seq[x];
      }
      if (!ok) continue;
      run++;
      for (let x = 0; x < seq.length; x++) marks[i + x] = run;
    }
  }
  for (const g of q.groups) {
    const star = q.prefix.includes(g[0]);
    g.forEach((t, j) => {
      if (t.includes(' ')) return;
      words.forEach((w, i) => { if (!marks[i] && wordMatches(w.t, t, j === 0, star && j === 0)) marks[i] = -1; });
    });
  }

  const segments = [];
  const push = (t, m) => {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && last.m === m) last.t += t; else segments.push({ t, m });
  };
  let pos = 0;
  words.forEach((w, i) => {
    const joined = i > 0 && marks[i] > 0 && marks[i] === marks[i - 1];
    push(s.slice(pos, w.start), joined);
    push(s.slice(w.start, w.end), marks[i] !== 0);
    pos = w.end;
  });
  push(s.slice(pos), false);
  return segments;
}

// ---------------------------------------------------------------- suggestions

// Titles' words, organizers and topic labels with the number of items that use them.
function suggestionPool(index) {
  if (index.suggest) return index.suggest;
  const topics = new Map();
  const organizers = new Map();
  const words = new Map();
  const bump = (map, display) => {
    const norm = normalizeText(display);
    if (!norm) return;
    const entry = map.get(norm);
    if (entry) entry.n++; else map.set(norm, { text: display, norm, n: 1 });
  };
  for (const it of index.items) {
    if (Array.isArray(it.topics)) for (const id of new Set(it.topics)) bump(topics, id);
    for (const o of [it.organizer, it.ar && it.ar.organizer]) if (typeof o === 'string' && o.trim()) bump(organizers, o.trim());
    for (const title of [it.title, it.ar && it.ar.title]) {
      if (typeof title !== 'string') continue;
      const seen = new Set();
      for (const m of title.matchAll(WORD)) {
        const norm = normalizeText(m[0]);
        if (norm.length < 3 || /^\d+$/.test(norm) || STOP.has(norm) || seen.has(norm)) continue;
        seen.add(norm);
        bump(words, m[0]);
      }
    }
  }
  const labels = new Map();
  for (const t of TOPICS) {
    const entry = topics.get(t.id);
    if (!entry) continue;
    labels.set(t.id, { en: { text: t.en, norm: normalizeText(t.en), n: entry.n }, ar: { text: t.ar, norm: normalizeText(t.ar), n: entry.n } });
  }
  index.suggest = { labels: [...labels.values()], organizers: [...organizers.values()], words: [...words.values()] };
  return index.suggest;
}

const byPopularity = (a, b) => b.n - a.n || (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0);

/** Up to opts.limit (default 6) completions for what is being typed: topic labels, organizers, title words. */
export function suggest(index, prefix, opts = {}) {
  if (!index || !Array.isArray(index.items)) return [];
  const limit = Number.isFinite(opts && opts.limit) ? Math.max(0, Math.floor(opts.limit)) : 6;
  if (!limit) return [];
  const typed = normalizeText(prefix);
  const pool = suggestionPool(index);
  const arabic = typed ? ARABIC.test(typed) : opts && opts.lang === 'ar';
  const labels = pool.labels.map(l => (arabic ? l.ar : l.en));
  const starts = e => (' ' + e.norm).includes(' ' + typed);
  if (!typed) return labels.sort(byPopularity).slice(0, limit).map(e => e.text);

  const pick = list => list.filter(e => ARABIC.test(e.norm) === arabic && e.norm !== typed && starts(e)).sort(byPopularity);
  const out = [];
  const used = new Set();
  for (const e of [...pick(labels), ...pick(pool.organizers), ...pick(pool.words)]) {
    if (used.has(e.norm)) continue;
    used.add(e.norm);
    out.push(e.text);
    if (out.length >= limit) break;
  }
  return out;
}
