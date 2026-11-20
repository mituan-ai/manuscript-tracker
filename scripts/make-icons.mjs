// 把 mituan logo（ui/logo.svg 的同款图形）栅格化成扩展图标 icons/{16,32,48,128}.png。无依赖。
// 用法：node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
const STOPS = [[0, [0x1d, 0x4e, 0xd8]], [0.6, [0x0e, 0xa5, 0xe9]], [1, [0x22, 0xd3, 0xee]]];
const M = [[15, 46], [15, 19], [23.5, 19], [32, 31.5], [40.5, 19], [49, 19], [49, 46]];
const LEGS = [[[24, 46], [24, 37]], [[40, 46], [40, 37]]];

function grad(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i], [t0, c0] = STOPS[i - 1];
    if (t <= t1) return c0.map((v, k) => v + ((c1[k] - v) * (t - t0)) / (t1 - t0));
  }
  return STOPS.at(-1)[1];
}
function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function inRoundRect(x, y, s, r) {
  const qx = Math.max(Math.abs(x - s / 2) - (s / 2 - r), 0), qy = Math.max(Math.abs(y - s / 2) - (s / 2 - r), 0);
  return Math.hypot(qx, qy) <= r;
}
/** 在 64×64 的 SVG 坐标里取一个点的颜色（预乘前的 rgb + alpha）。 */
function shade(x, y) {
  if (!inRoundRect(x, y, 64, 16)) return [0, 0, 0, 0];
  let c = grad((x + y) / 128);
  const over = (a) => (c = c.map((v) => v + (255 - v) * a));
  let dm = Infinity;
  for (let i = 1; i < M.length; i++) dm = Math.min(dm, segDist(x, y, M[i - 1], M[i]));
  if (dm <= 2.5) over(1);
  else if (LEGS.some(([a, b]) => segDist(x, y, a, b) <= 1.6)) over(0.55);
  if (Math.hypot(x - 32, y - 44.5) <= 3.4) over(1);
  return [...c, 1];
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const S = 6, row = size * 4 + 1, raw = Buffer.alloc(size * row);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const p = shade(((x + (sx + 0.5) / S) * 64) / size, ((y + (sy + 0.5) / S) * 64) / size);
          r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
        }
      const o = y * row + 1 + x * 4;
      if (a) [raw[o], raw[o + 1], raw[o + 2]] = [r / a, g / a, b / a].map(Math.round);
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(`${OUT}${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('icons written to', OUT);
