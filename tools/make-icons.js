// Draws the app icon (three rising bars on blue) and writes PNGs to docs/icons.
// Run from budget-app: node tools/make-icons.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [42, 120, 214];
const FG = [255, 255, 255];
const BARS = [
  { x: 0.22, w: 0.15, top: 0.56 },
  { x: 0.425, w: 0.15, top: 0.4 },
  { x: 0.63, w: 0.15, top: 0.22 },
];
const BOTTOM = 0.78;
const RADIUS = 0.03;

function insideBar(u, v) {
  return BARS.some((b) => {
    if (u < b.x || u > b.x + b.w || v < b.top || v > BOTTOM) return false;
    const dx = Math.max(b.x + RADIUS - u, u - (b.x + b.w - RADIUS), 0);
    const dy = Math.max(b.top + RADIUS - v, 0);
    return dx * dx + dy * dy <= RADIUS * RADIUS;
  });
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size) {
  const SAMPLES = 4;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (insideBar((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size)) hits++;
        }
      }
      const t = hits / (SAMPLES * SAMPLES);
      for (let i = 0; i < 3; i++) raw[p++] = Math.round(BG[i] + (FG[i] - BG[i]) * t);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('docs/icons', { recursive: true });
for (const size of [180, 192, 512]) writeFileSync(`docs/icons/icon-${size}.png`, png(size));
