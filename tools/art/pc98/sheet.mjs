#!/usr/bin/env node
// Review sheets for the PC-98 portrait pass (before/after contact sheets,
// size ladders, outliers) -> docs/art-direction/build/portraits-pc98/.
//
//   node tools/art/pc98/sheet.mjs [--out DIR] [--scale 2]
import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { SIZES } from './lib/config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = opt('--out', join(ROOT, 'docs/art-direction/build/portraits-pc98'));
const PC98 = join(ROOT, 'assets/portraits/pc98');
mkdirSync(OUT, { recursive: true });
const runtime = JSON.parse(readFileSync(join(ROOT, 'src/ui/Pc98PortraitManifest.json'), 'utf8'));
const rebuilt = JSON.parse(readFileSync(join(ROOT, 'src/ui/RebuiltPortraitManifest.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(ROOT, 'tools/art/pc98/portraits.config.json'), 'utf8'));
const ids = Object.keys(runtime.portraits);
const BG = { r: 14, g: 12, b: 20, alpha: 1 };

const label = (text, width, size = 11) =>
  Buffer.from(
    `<svg width="${width}" height="${size + 5}"><rect width="100%" height="100%" fill="#07060b"/>` +
      `<text x="3" y="${size + 1}" font-size="${size}" fill="#ddd0bd" font-family="sans-serif">${text}</text></svg>`,
  );

/** Source portrait flattened on the old dialogue ink, at size px (smooth). */
async function before(id, size) {
  const file = rebuilt[id]
    ? join(ROOT, 'assets/portraits/rebuilt', rebuilt[id].file)
    : join(ROOT, 'assets/portraits', `${id}.png`);
  return sharp(file)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: '#16131e' })
    .png()
    .toBuffer();
}

/** PC-98 portrait (figure on its faction plate) at size, scaled by z. */
async function after(id, size, z = 1, faction = runtime.portraits[id].faction) {
  const plate = join(PC98, 'plates', `${faction}-${size}.png`);
  const fig = join(PC98, String(size), `${id}.png`);
  const img = await sharp(plate)
    .composite([{ input: fig }])
    .png()
    .toBuffer();
  return z === 1
    ? img
    : sharp(img)
        .resize(size * z, size * z, { kernel: 'nearest' })
        .png()
        .toBuffer();
}

async function grid(file, cells, cellW, cellH, cols) {
  const rows = Math.ceil(cells.length / cols);
  const comps = [];
  cells.forEach((cell, i) => {
    for (const part of cell)
      comps.push({
        input: part.input,
        left: (i % cols) * cellW + part.left,
        top: Math.floor(i / cols) * cellH + part.top,
      });
  });
  await sharp({
    create: { width: cols * cellW, height: rows * cellH, channels: 4, background: BG },
  })
    .composite(comps)
    .webp({ lossless: true })
    .toFile(join(OUT, file));
  console.log('wrote', file);
}

// 1. Before/after contact sheets (master 192 at 1x).
for (const [file, list] of [
  ['contact-rebuilt.webp', ids.filter((id) => rebuilt[id])],
  ['contact-legacy.webp', ids.filter((id) => !rebuilt[id])],
]) {
  const cells = [];
  for (const id of list)
    cells.push([
      { input: await before(id, 192), left: 0, top: 0 },
      { input: await after(id, 192), left: 194, top: 0 },
      { input: label(id, 386), left: 0, top: 192 },
    ]);
  await grid(file, cells, 392, 212, 5);
}

// 2. All portraits through the pass (after only), 1x.
{
  const cells = [];
  for (const id of ids)
    cells.push([
      { input: await after(id, 192), left: 0, top: 0 },
      { input: label(id, 192, 10), left: 0, top: 192 },
    ]);
  await grid('contact-all.webp', cells, 196, 210, 10);
}

// 3. Size ladders at 2x (display-true pixels, zoomed for review).
{
  const pick = [
    'lord_edric',
    'lord_sera',
    'lord_kira',
    'boss_the_lieutenant',
    'boss_dark_rider',
    'generic_fighter',
    'generic_cleric',
    'enemy_mage',
  ];
  const cells = [];
  for (const id of pick) {
    const parts = [];
    let x = 0;
    for (const size of SIZES) {
      parts.push({ input: await after(id, size, 2), left: x, top: 0 });
      x += size * 2 + 8;
    }
    parts.push({ input: label(id, 200), left: 0, top: 384 });
    cells.push(parts);
  }
  const width = SIZES.reduce((s, v) => s + v * 2 + 8, 0);
  await grid('sizes-2x.webp', cells, width, 404, 1);
}

// 4. Faction plates.
{
  const cells = [];
  for (const faction of runtime.factions)
    cells.push([
      { input: await after('generic_fighter', 96, 2, faction), left: 0, top: 0 },
      { input: label(faction, 192), left: 0, top: 192 },
    ]);
  await grid('factions.webp', cells, 196, 212, runtime.factions.length);
}

// 5. Legacy design outliers (flagged in portraits.config.json).
{
  const list = ids.filter((id) => config.portraits?.[id]?.outlier);
  const cells = [];
  for (const id of list)
    cells.push([
      { input: await before(id, 128), left: 0, top: 32 },
      { input: await after(id, 192), left: 130, top: 0 },
      { input: label(id, 322), left: 0, top: 192 },
      { input: label(config.portraits[id].outlier.slice(0, 60), 322, 9), left: 0, top: 208 },
    ]);
  if (cells.length) await grid('outliers.webp', cells, 326, 224, 4);
}
