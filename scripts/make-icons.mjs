// Draws the Oman Scout mark (rings with an amber sweep) into PNG icons without any dependency.
// Usage: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/icons');
const BG = [13, 36, 48], INK = [234, 243, 241], AMBER = [227, 166, 60];

const dist = (x, y, a, b) => Math.hypot(x - a, y - b);
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return dist(x, y, ax + t * dx, ay + t * dy);
}

// Colour and alpha of the artwork at a point in 32-unit space (null = nothing there).
function art(x, y) {
  if (dist(x, y, 21.4, 11) <= 2) return [AMBER, 1];
  if (segDist(x, y, 16, 16, 23, 9.5) <= 1.1) return [AMBER, 1];
  if (Math.abs(dist(x, y, 16, 16) - 10) <= 0.8) return [INK, 1];
  if (Math.abs(dist(x, y, 16, 16) - 5.5) <= 0.65) return [INK, 0.55];
  return null;
}

function pixel(px, py, size, maskable, rounded) {
  const SS = 4;
  let r = 0, g = 0, b = 0, a = 0;
  const scale = (maskable ? 0.8 : 1) * size / 32;
  const off = (size - 32 * scale) / 2;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const X = px + (sx + 0.5) / SS, Y = py + (sy + 0.5) / SS;
    let inside = true;
    if (rounded) {
      const R = size * 0.25;
      const cx = Math.min(Math.max(X, R), size - R), cy = Math.min(Math.max(Y, R), size - R);
      inside = dist(X, Y, cx, cy) <= R;
    }
    if (!inside) continue;
    let c = BG, al = 1;
    const hit = art((X - off) / scale, (Y - off) / scale);
    if (hit) { const k = hit[1]; c = [0, 1, 2].map(i => BG[i] * (1 - k) + hit[0][i] * k); }
    r += c[0]; g += c[1]; b += c[2]; a += al;
  }
  const n = SS * SS;
  return a ? [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / n) * 255)] : [0, 0, 0, 0];
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = buf => { let c = 0xffffffff; for (const v of buf) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
function png(size, opts) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y, size, opts.maskable, opts.rounded), y * (size * 4 + 1) + 1 + x * 4);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: false }],
  ['favicon-32.png', 32, { rounded: true }]
];
for (const [name, size, opts] of jobs) {
  const buf = png(size, opts);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name, buf.length, 'bytes');
}
