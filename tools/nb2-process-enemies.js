#!/usr/bin/env node
// Process NB2 enemy winners (all v0) + ballista → game-ready 32x32
// Pipeline: bg removal → trim → resize 32x32 + 64x64 + raw

import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const ENEMY_SRC = path.join(ROOT, 'References/imagen-output/nb2-enemy-full');
const BALLISTA_SRC = path.join(ROOT, 'References/imagen-output/nb2-enemy-test/terrain');
const OUTPUT_DIR = path.join(ROOT, 'References/imagen-output/nb2-enemy-full/processed');

const DRY_RUN = process.argv.includes('--dry-run');

// All 31 enemy classes — use v0 for all
const ENEMY_WINNERS = [
  'archer',
  'assassin',
  'battle_monk',
  'berserker',
  'bishop',
  'bow_knight',
  'cavalier',
  'cleric',
  'dark_knight',
  'duelist',
  'falcon_knight',
  'fighter',
  'general',
  'great_knight',
  'hero',
  'hunter',
  'knight',
  'mage',
  'mercenary',
  'myrmidon',
  'paladin',
  'pegasus_knight',
  'sage',
  'sniper',
  'swordmaster',
  'thief',
  'trickster',
  'warlock',
  'warrior',
  'wyvern_lord',
  'wyvern_rider',
];

// bg removal
function dominantEdgeColor(data, width, height, channels) {
  const counts = new Map();
  const push = (x, y) => {
    const idx = (y * width + x) * channels;
    if (data[idx + 3] === 0) return;
    const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    push(width - 1, y);
  }
  let best = null,
    bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best ? best.split(',').map(Number) : null;
}

async function removeBg(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const edge = dominantEdgeColor(data, info.width, info.height, info.channels);
  if (!edge) return sharp(data, { raw: info }).png().toBuffer();
  const [er, eg, eb] = edge;
  const out = Buffer.from(data);
  const tolSq = 24 * 24;
  for (let i = 0; i < out.length; i += info.channels) {
    const dr = out[i] - er,
      dg = out[i + 1] - eg,
      db = out[i + 2] - eb;
    if (dr * dr + dg * dg + db * db <= tolSq) out[i + 3] = 0;
  }
  return sharp(out, { raw: info }).png().toBuffer();
}

async function resizeTo(buffer, size) {
  return sharp(buffer)
    .trim()
    .resize({
      width: size,
      height: size,
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function processOne(srcPath, destName, destSubdir) {
  const raw = await fs.readFile(srcPath);
  const noBg = await removeBg(raw);

  // Raw (bg-removed full-res)
  const rawDir = path.join(OUTPUT_DIR, 'raw', destSubdir);
  await fs.mkdir(rawDir, { recursive: true });
  await fs.writeFile(path.join(rawDir, `${destName}_raw.png`), noBg);

  // 32x32
  const img32 = await resizeTo(noBg, 32);
  const dir32 = path.join(OUTPUT_DIR, '32', destSubdir);
  await fs.mkdir(dir32, { recursive: true });
  await fs.writeFile(path.join(dir32, `${destName}.png`), img32);

  // 64x64
  const img64 = await resizeTo(noBg, 64);
  const dir64 = path.join(OUTPUT_DIR, '64', destSubdir);
  await fs.mkdir(dir64, { recursive: true });
  await fs.writeFile(path.join(dir64, `${destName}.png`), img64);

  return { s32: img32.length, s64: img64.length };
}

// Main
console.log(`NB2 Enemy Processor${DRY_RUN ? ' [DRY RUN]' : ''}`);
console.log(`Enemies: ${ENEMY_WINNERS.length} + 1 ballista\n`);

// Validate sources
const missing = [];
for (const name of ENEMY_WINNERS) {
  if (!existsSync(path.join(ENEMY_SRC, `${name}_v0.png`))) missing.push(name);
}
if (!existsSync(path.join(BALLISTA_SRC, 'ballista_v0.png'))) missing.push('ballista');
if (missing.length > 0) {
  console.error(`FATAL: Missing sources: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('All sources found.\n');

if (DRY_RUN) {
  for (const name of ENEMY_WINNERS) {
    console.log(`  ${name}_v0.png → enemies/${name}.png`);
  }
  console.log(`  ballista_v0.png → tilesets/ballista.png`);
  console.log('\nDry run complete.');
  process.exit(0);
}

let processed = 0;
for (const name of ENEMY_WINNERS) {
  const srcPath = path.join(ENEMY_SRC, `${name}_v0.png`);
  const sizes = await processOne(srcPath, name, 'enemies');
  processed++;
  console.log(`[${processed}/32] enemies/${name}  (32: ${(sizes.s32 / 1024).toFixed(1)}KB)`);
}

// Ballista → tilesets
const bSizes = await processOne(path.join(BALLISTA_SRC, 'ballista_v0.png'), 'ballista', 'tilesets');
processed++;
console.log(`[${processed}/32] tilesets/ballista  (32: ${(bSizes.s32 / 1024).toFixed(1)}KB)`);

// Verify
let missingOut = 0;
for (const name of ENEMY_WINNERS) {
  if (!existsSync(path.join(OUTPUT_DIR, '32/enemies', `${name}.png`))) missingOut++;
}
if (!existsSync(path.join(OUTPUT_DIR, '32/tilesets', 'ballista.png'))) missingOut++;
if (missingOut > 0) {
  console.error(`FATAL: ${missingOut} outputs missing`);
  process.exit(1);
}

console.log(`\nDone! ${processed} sprites processed, all verified.`);
