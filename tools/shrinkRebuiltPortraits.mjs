#!/usr/bin/env node
/**
 * shrinkRebuiltPortraits.mjs -- cap rebuilt portraits at 512x512.
 *
 * The rebuilt portraits were generated at 1254x1254 (~6.3 MB of texture memory
 * each, ~182 MB for the set on mobile) but are shown at most 88x104 CSS px
 * (dialogue), ~312 device px on a 3x phone. 512px keeps headroom for desktop
 * zoom while cutting decode memory ~6x. Idempotent: portraits already within
 * the cap are left untouched. The full-size originals live in
 * docs/art/rebuilt-portrait-sources/ (not shipped; tools/art/pc98 renders from them).
 *
 * Usage: node tools/shrinkRebuiltPortraits.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

export const MAX_PORTRAIT_SIZE = 512;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'assets/portraits/rebuilt');
const check = process.argv.includes('--check');

let oversized = 0;
for (const name of fs.readdirSync(DIR).filter((file) => file.endsWith('.png'))) {
  const file = path.join(DIR, name);
  const { width, height } = await sharp(file).metadata();
  if (width <= MAX_PORTRAIT_SIZE && height <= MAX_PORTRAIT_SIZE) continue;
  oversized++;
  if (check) {
    console.error(`[portraits] ${name} is ${width}x${height}`);
    continue;
  }
  const png = await sharp(file)
    .resize(MAX_PORTRAIT_SIZE, MAX_PORTRAIT_SIZE, { fit: 'inside', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(file, png);
}
if (check && oversized) {
  console.error(`[portraits] ${oversized} portrait(s) over ${MAX_PORTRAIT_SIZE}px`);
  process.exit(1);
}
console.log(
  check ? '[portraits] all within the cap.' : `[portraits] shrank ${oversized} portrait(s).`,
);
