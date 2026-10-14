// Deterministic checks on each item's main page: does the link open, and is the date written on it?
// No model is involved. A page that blocks bots (403, 429, 5xx, timeouts) counts as "unknown", never as dead.
// Private, loopback and link-local addresses are refused, also after redirects.
import dns from 'node:dns/promises';
import net from 'node:net';

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_AR = [['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'آذار'], ['أبريل', 'ابريل', 'نيسان'], ['مايو', 'أيار'], ['يونيو', 'حزيران'], ['يوليو', 'تموز'], ['أغسطس', 'اغسطس', 'آب'], ['سبتمبر', 'أيلول'], ['أكتوبر', 'اكتوبر', 'تشرين الأول'], ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الأول']];
const MAX_BYTES = 600_000;

function privateV4(a) {
  const [p, q] = a.split('.').map(Number);
  return p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
}
/** True for addresses a public web page should never resolve to. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateV4(mapped[1]) : false;
  }
  return true;
}

async function assertPublic(url, allowLoopback) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw Object.assign(new Error('scheme'), { code: 'BLOCKED' });
  if (allowLoopback) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) throw Object.assign(new Error('private address'), { code: 'BLOCKED' });
}

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;|&#8211;/g, '–').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/\s+/g, ' ');
}

/** Is the calendar date written somewhere in the text (ISO, numeric, English or Arabic month names, ranges)? */
export function dateInText(text, ymd) {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = text.toLowerCase();
  const dd = String(d).padStart(2, '0'), mm = String(m).padStart(2, '0');
  if (t.includes(`${y}-${mm}-${dd}`)) return true;
  if (new RegExp(`(^|\\D)0?${d}[/.\\-]0?${m}[/.\\-]${y}(\\D|$)`).test(t)) return true;
  const en = MONTHS_EN[m - 1];
  const names = [en, en.slice(0, 3), ...MONTHS_AR[m - 1]].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mon = `(?:${names.join('|')})\\.?`;
  const day = `0?${d}(?:st|nd|rd|th)?`;
  const patterns = [
    `(^|\\D)${day}\\s*(?:of\\s+)?${mon}`,
    `${mon}\\s+${day}(\\D|$)`,
    `(^|\\D)${day}\\s*(?:[-–—]|to|until|الى|إلى)\\s*\\d{1,2}\\s+${mon}`,
    `(^|\\D)\\d{1,2}\\s*(?:[-–—]|to|until|الى|إلى)\\s*${day}\\s+${mon}`
  ];
  return patterns.some(p => new RegExp(p, 'i').test(t));
}

async function fetchPage(url, { timeoutMs, allowLoopback, fetchImpl }) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current, allowLoopback);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(current, {
        redirect: 'manual', signal: ctl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmanScoutLinkCheck/1.0)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en,ar;q=0.8' }
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; continue; }
      let text = '';
      if (res.ok) {
        const type = res.headers.get('content-type') || '';
        if (!type || /text|html|xml|json/i.test(type)) {
          const reader = res.body.getReader();
          const chunks = []; let size = 0;
          while (size < MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
          try { reader.cancel(); } catch { /* done */ }
          text = visibleText(new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks)));
        }
      }
      return { status: res.status, text, url: current };
    } finally { clearTimeout(timer); }
  }
  return { status: 0, text: '', url: current, error: 'redirects' };
}

/** Check one URL: { linkOk: true|false|null, text }. Dead means 404, 410 or a name that does not resolve. */
export async function checkUrl(url, opts = {}) {
  const o = { timeoutMs: 12000, allowLoopback: false, fetchImpl: globalThis.fetch, ...opts };
  try {
    const r = await fetchPage(url, o);
    if (r.status >= 200 && r.status < 300) return { linkOk: true, text: r.text };
    if (r.status === 404 || r.status === 410) return { linkOk: false, text: '' };
    return { linkOk: null, text: '' };
  } catch (e) {
    if (e && (e.code === 'ENOTFOUND' || (e.cause && e.cause.code === 'ENOTFOUND'))) return { linkOk: false, text: '' };
    return { linkOk: null, text: '' };
  }
}

/**
 * Add item.verified = { checkedAt, linkOk, dateOnPage, agent, note } for every item, checking the apply page or
 * the first source. Returns counts. opts: concurrency, timeoutMs, allowLoopback, fetchImpl, now.
 */
export async function checkItems(items, opts = {}) {
  const concurrency = opts.concurrency || 6;
  const now = opts.now || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const stats = { checked: 0, ok: 0, dead: 0, unknown: 0, dateSeen: 0 };
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const it = items[next++];
      const url = it.applyUrl || (it.sources && it.sources[0] && it.sources[0].url);
      if (!url) continue;
      const r = await checkUrl(url, opts);
      stats.checked++;
      let dateOnPage = null;
      if (r.linkOk === true) {
        stats.ok++;
        const dates = [it.start, it.deadline, it.end].filter(Boolean);
        if (dates.length && r.text.length > 400) { dateOnPage = dates.some(d => dateInText(r.text, d)); if (dateOnPage) stats.dateSeen++; }
      } else if (r.linkOk === false) stats.dead++; else stats.unknown++;
      const prev = it.verified && typeof it.verified === 'object' ? it.verified : {};
      it.verified = { ...prev, checkedAt: now, linkOk: r.linkOk, dateOnPage, agent: prev.agent || null, note: prev.note || null };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return stats;
}
