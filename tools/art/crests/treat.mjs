#!/usr/bin/env node
// Treatment for the generated crest study: raw generation → the game's
// palette and pixel grid (review only; the shipped crests are code-built,
// see README.md for the comparison).
//
//   node tools/art/crests/treat.mjs [--size 48]
//
// 1. Crop to the emblem (flood the corner-coloured background from the edges).
// 2. Area-downsample to --size art pixels.
// 3. Snap every pixel to the ART_BIBLE ramps (ink, ember, blood, steel,
//    unlight, stone); the flooded background becomes transparent.
// Writes docs/art/crests-gen/treated/<id>.png and raw-contact.png.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CREST_PALETTE } from '../../../src/ui/crestArt.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = path.join(ROOT, 'docs/art/crests-gen/raw');
const OUT = path.join(ROOT, 'docs/art/crests-gen/treated');
const args = process.argv.slice(2);
const SIZE = Number(args.includes('--size') ? args[args.indexOf('--size') + 1] : 48);
fs.mkdirSync(OUT, { recursive: true });

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PALETTE = Object.values(CREST_PALETTE).flat().map(hexRgb);
function nearest([r, g, b]) {
  let best = PALETTE[0];
  let d = Infinity;
  for (const p of PALETTE) {
    // Weighted RGB distance (cheap perceptual approximation).
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const e = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (e < d) {
      d = e;
      best = p;
    }
  }
  return best;
}

async function treat(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Flood the background: near-black pixels connected to the border.
  const bg = new Uint8Array(w * h);
  // Background = the corner colour (the model sometimes paints it white).
  const c0 = [data[0], data[1], data[2]];
  const dark = (i) =>
    Math.abs(data[i * 3] - c0[0]) +
      Math.abs(data[i * 3 + 1] - c0[1]) +
      Math.abs(data[i * 3 + 2] - c0[2]) <
    60;
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (bg[i] || !dark(i)) continue;
    bg[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < w * h; i++)
    if (!bg[i]) {
      const x = i % w;
      const y = (i / w) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const side = Math.max(x1 - x0, y1 - y0) + 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const left = Math.max(0, Math.round(cx - side / 2));
  const top = Math.max(0, Math.round(cy - side / 2));
  const cw = Math.min(side, w - left);
  const ch = Math.min(side, h - top);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = bg[i] ? 0 : 255;
  }
  const small = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: cw, height: ch })
    .resize(SIZE, SIZE, {
      kernel: 'mitchell',
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = small[i * 4 + 3];
    if (a < 128) {
      small[i * 4 + 3] = 0;
      continue;
    }
    const [r, g, b] = nearest([small[i * 4], small[i * 4 + 1], small[i * 4 + 2]]);
    small[i * 4] = r;
    small[i * 4 + 1] = g;
    small[i * 4 + 2] = b;
    small[i * 4 + 3] = 255;
  }
  return sharp(small, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png();
}

const files = fs.readdirSync(RAW).filter((f) => /\.(png|jpg)$/.test(f) && !/-\d+\./.test(f));
const tiles = [];
for (const f of files) {
  const id = f.replace(/\.\w+$/, '');
  const png = await treat(path.join(RAW, f));
  await png.toFile(path.join(OUT, `${id}.png`));
  tiles.push({ id, raw: path.join(RAW, f) });
}
// Raw contact (review): 8 columns of 160px thumbnails.
const T = 160;
const cols = 8;
const rows = Math.ceil(tiles.length / cols);
const comp = [];
for (let i = 0; i < tiles.length; i++)
  comp.push({
    input: await sharp(tiles[i].raw).resize(T, T).png().toBuffer(),
    left: (i % cols) * T,
    top: Math.floor(i / cols) * T,
  });
await sharp({ create: { width: cols * T, height: rows * T, channels: 4, background: '#000' } })
  .composite(comp)
  .png()
  .toFile(path.join(ROOT, 'docs/art/crests-gen/raw-contact.png'));
console.log(`treated ${tiles.length} → ${OUT}`);
