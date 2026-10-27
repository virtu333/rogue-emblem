#!/usr/bin/env node
// Contact sheets of the outfit samples: one image per lord, the current portrait beside each
// take, labelled, for the owner to pick from.
//
//   node tools/art/lord-outfits/sheet.mjs [--promoted] [--out <dir>]
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { LORD_OUTFITS } from './outfits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = join(ROOT, 'References/lord-outfits/raw');
const args = process.argv.slice(2);
const PROMOTED = args.includes('--promoted');
const OUT = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join(ROOT, 'References/lord-outfits/sheets');
mkdirSync(OUT, { recursive: true });

const TILE = 360;
const LABEL = 44;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (text, w) =>
  Buffer.from(
    `<svg width="${w}" height="${LABEL}"><rect width="100%" height="100%" fill="#1c1a24"/>` +
      `<text x="${w / 2}" y="29" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#f2e6c9" text-anchor="middle">${esc(text)}</text></svg>`,
  );

const rawOf = (name) =>
  ['.png', '.jpg'].map((e) => join(RAW, name + e)).find((f) => existsSync(f)) || null;

for (const outfit of LORD_OUTFITS) {
  const suffix = PROMOTED ? '_promoted' : '';
  const lordId = `lord_${outfit.lord.toLowerCase()}${suffix}`;
  const tiles = [[join(ROOT, 'assets/portraits/rebuilt', `${lordId}.png`), 'Now']];
  for (let t = 1; t <= 8; t++) {
    const f = rawOf(`${outfit.id}${suffix}-t${t}`);
    if (f) tiles.push([f, `${t}`]);
  }
  if (tiles.length < 2) continue;
  const width = TILE * tiles.length;
  const parts = [];
  for (const [i, [file, text]] of tiles.entries()) {
    const img = await sharp(file)
      .resize(TILE, TILE, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    parts.push({ input: img, left: i * TILE, top: LABEL * 2 });
    parts.push({ input: label(text, TILE), left: i * TILE, top: LABEL * 2 + TILE });
  }
  parts.push({
    input: label(`${outfit.lord} · ${outfit.name}${PROMOTED ? ' (promoted)' : ''}`, width),
    left: 0,
    top: 0,
  });
  parts.push({ input: label('Current portrait, then the four takes', width), left: 0, top: LABEL });
  const file = join(OUT, `${outfit.id}${suffix}.png`);
  await sharp({
    create: { width, height: LABEL * 3 + TILE, channels: 3, background: '#1c1a24' },
  })
    .composite(parts)
    .png()
    .toFile(file);
  console.log(file);
}
