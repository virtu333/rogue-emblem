#!/usr/bin/env node
// Quick iteration preview: every frame of the selected effects at 4x over a dusk
// meadow tone and a night tone. Not a deliverable (see review.mjs).
//   node tools/art/combat-fx/preview.mjs [--only fx_slash,fx_chop] [--out FILE] [--scale 4]
import sharp from 'sharp';
import { Palette } from './lib/raster.mjs';
import { renderAnim, compositeFrame } from './lib/build.mjs';
import { ALL_ANIMS } from './lib/anims.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = opt('--only', null)?.split(',');
const out = opt('--out', '/tmp/combat-fx-preview.png');
const S = Number(opt('--scale', 4));
const GROUNDS = [
  [0x6a, 0x73, 0x46],
  [0x2a, 0x26, 0x2c],
];

const palette = new Palette();
const list = ALL_ANIMS.filter((d) => !only || only.some((k) => d.key.startsWith(k)));
const rendered = list.map((d) => renderAnim(d, palette));
const pad = 4;
const rowW = Math.max(...rendered.map((r) => r.frames.length * (r.w + pad)));
const W = rowW;
let H = 0;
for (const r of rendered) H += (r.h + pad) * GROUNDS.length;
const img = new Uint8ClampedArray(W * H * 4);
let y = 0;
for (const r of rendered) {
  for (const g of GROUNDS) {
    for (let yy = y; yy < y + r.h + pad; yy++)
      for (let x = 0; x < W; x++) {
        const d = (yy * W + x) * 4;
        img[d] = g[0];
        img[d + 1] = g[1];
        img[d + 2] = g[2];
        img[d + 3] = 255;
      }
    r.frames.forEach((_, i) => compositeFrame(img, W, H, i * (r.w + pad), y, r, i, palette));
    y += r.h + pad;
  }
}
await sharp(Buffer.from(img.buffer), { raw: { width: W, height: H, channels: 4 } })
  .resize(W * S, H * S, { kernel: 'nearest' })
  .png()
  .toFile(out);
console.log(`${out} ${W * S}x${H * S} (${list.map((d) => d.key).join(', ')})`);
