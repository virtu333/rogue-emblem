#!/usr/bin/env node
// Process generated enemy portraits → game-ready 128x128
//
// Pipeline:
//   1. Remove background (dominant edge-color method)
//   2. Resize to 128x128 (lanczos for smooth downscale)
//   3. Composite onto solid dark background (#1a1a2e)
//
// Usage:
//   node tools/process-enemy-portraits.js           # full run
//   node tools/process-enemy-portraits.js --dry-run # list files, no writes

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const SOURCE_DIR = path.join(ROOT, 'References/imagen-output/enemy-portraits');
const DEST_DIRS = [path.join(ROOT, 'assets/portraits'), path.join(ROOT, 'public/assets/portraits')];

const DRY_RUN = process.argv.includes('--dry-run');
const BG_COLOR = { r: 26, g: 26, b: 46, alpha: 255 }; // #1a1a2e — dark navy

// All 36 enemy portrait classes
const ENEMY_CLASSES = [
  'archer',
  'assassin',
  'battle_monk',
  'berserker',
  'bishop',
  'bow_knight',
  'cavalier',
  'cleric',
  'dancer',
  'dark_knight',
  'dragon',
  'dragon_lord',
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
  'revenant',
  'sage',
  'sniper',
  'swordmaster',
  'thief',
  'trickster',
  'warlock',
  'warrior',
  'wyvern_lord',
  'wyvern_rider',
  'zombie',
];

// ── Background removal (edge-color flood) ────────────────────────────────

function dominantEdgeColor(data, width, height, channels) {
  const counts = new Map();
  const push = (x, y) => {
    const idx = (y * width + x) * channels;
    const r = data[idx],
      g = data[idx + 1],
      b = data[idx + 2];
    const a = channels === 4 ? data[idx + 3] : 255;
    if (a === 0) return;
    // Quantize to reduce noise (bucket by 8)
    const key = `${r >> 3},${g >> 3},${b >> 3}`;
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
  if (!best) return null;
  // Convert quantized back to approximate center of bucket
  return best.split(',').map((v) => (Number(v) << 3) + 4);
}

function removeBackground(data, width, height, channels, tolerance = 30) {
  const edge = dominantEdgeColor(data, width, height, channels);
  if (!edge) return data;
  const [er, eg, eb] = edge;
  const out = Buffer.from(data);
  const tolSq = tolerance * tolerance;
  const stride = channels;
  for (let i = 0; i < out.length; i += stride) {
    const dr = out[i] - er,
      dg = out[i + 1] - eg,
      db = out[i + 2] - eb;
    if (dr * dr + dg * dg + db * db <= tolSq) {
      if (channels === 4) out[i + 3] = 0;
    }
  }
  return out;
}

// ── Processing pipeline ──────────────────────────────────────────────────

async function processPortrait(srcPath) {
  const raw = await fs.readFile(srcPath);

  // Step 1: Ensure alpha + get raw pixels
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // Step 2: Remove background
  const noBg = removeBackground(data, info.width, info.height, info.channels);

  // Step 3: Resize to 128x128 (trim first, then fit)
  const trimmed = await sharp(noBg, { raw: info }).png().toBuffer();

  const resized = await sharp(trimmed)
    .trim()
    .resize({
      width: 128,
      height: 128,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // Step 4: Composite onto dark background
  const final = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: BG_COLOR,
    },
  })
    .composite([{ input: resized, blend: 'over' }])
    .png()
    .toBuffer();

  return final;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Enemy Portrait Processor${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Destinations: ${DEST_DIRS.join(', ')}\n`);

  // Validate sources
  const missing = [];
  for (const cls of ENEMY_CLASSES) {
    const src = path.join(SOURCE_DIR, `enemy_${cls}.png`);
    if (!existsSync(src)) missing.push(`enemy_${cls}.png`);
  }
  if (missing.length > 0) {
    console.error(`FATAL: ${missing.length} source files missing:`);
    missing.forEach((m) => console.error(`  - ${m}`));
    process.exit(1);
  }
  console.log(`All ${ENEMY_CLASSES.length} source files found.\n`);

  if (DRY_RUN) {
    console.log('Output mapping:');
    for (const cls of ENEMY_CLASSES) {
      console.log(`  enemy_${cls}.png → enemy_${cls}.png (128x128)`);
    }
    console.log(
      `\nDry run complete. ${ENEMY_CLASSES.length} files would be written to ${DEST_DIRS.length} directories.`,
    );
    return;
  }

  // Ensure dest dirs exist
  for (const dir of DEST_DIRS) {
    await fs.mkdir(dir, { recursive: true });
  }

  let processed = 0;
  let errors = 0;

  for (const cls of ENEMY_CLASSES) {
    const srcPath = path.join(SOURCE_DIR, `enemy_${cls}.png`);
    try {
      const result = await processPortrait(srcPath);
      // Write to both asset directories
      for (const dir of DEST_DIRS) {
        await fs.writeFile(path.join(dir, `enemy_${cls}.png`), result);
      }
      processed++;
      console.log(
        `[${processed}/${ENEMY_CLASSES.length}] enemy_${cls}.png (${(result.length / 1024).toFixed(1)}KB)`,
      );
    } catch (err) {
      errors++;
      console.error(`[ERROR] enemy_${cls}: ${err.message}`);
    }
  }

  console.log(
    `\nDone! Processed ${processed}/${ENEMY_CLASSES.length} portraits (${errors} errors).`,
  );
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
