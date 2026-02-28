#!/usr/bin/env node
// NB2 Sprite Roster Processor
// Processes all 58 NB2 winner sprites → game-ready 32x32 + 64x64 + bg-removed raw
//
// Usage:
//   node tools/nb2-process-roster.js           # full processing run
//   node tools/nb2-process-roster.js --dry-run # print file mapping, no writes

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const SOURCE_DIR = path.join(ROOT, 'References/imagen-output/nb2-roster-v2');
const OUTPUT_DIR = path.join(ROOT, 'References/imagen-output/nb2-roster-v2/processed');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Strict allowlist: 58 source files → 60 output files ──────────────────

const ALLOWLIST = {
  base: [
    'archer',
    'cavalier',
    'chevalier',
    'cleric',
    'dancer',
    'fighter',
    'knight',
    'light_sage',
    'lord',
    'mage',
    'mercenary',
    'myrmidon',
    'pegasus_knight',
    'ranger',
    'sentinel',
    'sky_lancer',
    'tactician',
    'thief',
    'wyvern_rider',
  ],
  promoted: [
    'assassin',
    'bard',
    'battle_monk',
    'berserker',
    'bishop',
    'bow_knight',
    'champion',
    'dark_knight',
    'duelist',
    'falcon_knight',
    'general',
    'grandmaster',
    'great_knight',
    'great_lord',
    'hero',
    'holy_knight',
    'hunter',
    'light_priestess',
    'paladin',
    'sage',
    'seraph_knight',
    'sniper',
    'swordmaster',
    'trickster',
    'vanguard',
    'warlock',
    'warrior',
    'wyvern_lord',
  ],
  lord: ['astrid', 'cael', 'edric', 'kira', 'rowan', 'sera', 'voss'],
  enemy: ['dragon', 'dragon_lord', 'revenant', 'zombie'],
};

// Total allowlisted source files
const TOTAL_SOURCES = Object.values(ALLOWLIST).flat().length; // 58

// ── Output mapping: source → { destDir, destName } ────────────────────────
// destDir is 'characters' or 'enemies'; destName is the output filename (no .png)

function buildOutputMap() {
  const map = []; // { tier, srcName, destDir, destName }[]

  // base/ → characters/{class}
  for (const name of ALLOWLIST.base) {
    map.push({ tier: 'base', srcName: name, destDir: 'characters', destName: name });
  }

  // promoted/ → characters/{class}
  for (const name of ALLOWLIST.promoted) {
    map.push({ tier: 'promoted', srcName: name, destDir: 'characters', destName: name });
  }

  // great_lord gets an alias: greatlordedric (Edric's promoted form)
  map.push({
    tier: 'promoted',
    srcName: 'great_lord',
    destDir: 'characters',
    destName: 'greatlordedric',
  });

  // lord/edric → characters/lordedric (special key)
  map.push({ tier: 'lord', srcName: 'edric', destDir: 'characters', destName: 'lordedric' });

  // lord/{other} → characters/{name}
  for (const name of ALLOWLIST.lord.filter((n) => n !== 'edric')) {
    map.push({ tier: 'lord', srcName: name, destDir: 'characters', destName: name });
  }

  // enemy/ → enemies/{name}
  for (const name of ALLOWLIST.enemy) {
    map.push({ tier: 'enemy', srcName: name, destDir: 'enemies', destName: name });
  }

  return map;
}

// ── Background removal (from imagen-pipeline/process.js) ──────────────────

function dominantEdgeColor(data, width, height, channels) {
  const counts = new Map();
  const push = (x, y) => {
    const idx = (y * width + x) * channels;
    const r = data[idx],
      g = data[idx + 1],
      b = data[idx + 2],
      a = data[idx + 3];
    if (a === 0) return;
    const key = `${r},${g},${b}`;
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

function removeBackgroundByEdgeColor(data, width, height, channels, tolerance = 24) {
  const edge = dominantEdgeColor(data, width, height, channels);
  if (!edge) return data;
  const [er, eg, eb] = edge;
  const out = Buffer.from(data);
  const tolSq = tolerance * tolerance;
  for (let i = 0; i < out.length; i += channels) {
    const dr = out[i] - er,
      dg = out[i + 1] - eg,
      db = out[i + 2] - eb;
    if (dr * dr + dg * dg + db * db <= tolSq) {
      out[i + 3] = 0;
    }
  }
  return out;
}

// ── Processing pipeline ───────────────────────────────────────────────────

async function removeBg(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cut = removeBackgroundByEdgeColor(data, info.width, info.height, info.channels);
  return sharp(cut, { raw: info }).png().toBuffer();
}

async function resizeTo(buffer, size) {
  return sharp(buffer)
    .trim() // trim transparent edges first
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

async function processSprite(srcPath, destName, destDir) {
  const raw = await fs.readFile(srcPath);

  // Step 1: Remove background
  const noBg = await removeBg(raw);

  // Step 2: Save bg-removed full-res as raw/
  const rawOutDir = path.join(OUTPUT_DIR, 'raw', destDir);
  await fs.mkdir(rawOutDir, { recursive: true });
  await fs.writeFile(path.join(rawOutDir, `${destName}_raw.png`), noBg);

  // Step 3: Resize to 32x32
  const img32 = await resizeTo(noBg, 32);
  const dir32 = path.join(OUTPUT_DIR, '32', destDir);
  await fs.mkdir(dir32, { recursive: true });
  await fs.writeFile(path.join(dir32, `${destName}.png`), img32);

  // Step 4: Resize to 64x64
  const img64 = await resizeTo(noBg, 64);
  const dir64 = path.join(OUTPUT_DIR, '64', destDir);
  await fs.mkdir(dir64, { recursive: true });
  await fs.writeFile(path.join(dir64, `${destName}.png`), img64);

  return { raw: noBg.length, s32: img32.length, s64: img64.length };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`NB2 Sprite Roster Processor${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  // Build mapping
  const outputMap = buildOutputMap();

  // Step 1: Validate all allowlisted source files exist
  console.log(`Validating ${TOTAL_SOURCES} allowlisted source files...`);
  const missing = [];
  const sourcePathCache = new Map(); // "tier/srcName" → absolute path

  for (const tier of Object.keys(ALLOWLIST)) {
    for (const name of ALLOWLIST[tier]) {
      const srcPath = path.join(SOURCE_DIR, tier, `${name}.png`);
      if (!existsSync(srcPath)) {
        missing.push(`${tier}/${name}.png`);
      } else {
        sourcePathCache.set(`${tier}/${name}`, srcPath);
      }
    }
  }

  if (missing.length > 0) {
    console.error(`\nFATAL: ${missing.length} allowlisted source files MISSING:`);
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`  All ${TOTAL_SOURCES} source files found.\n`);

  // Step 2: Print file mapping
  console.log(`Output mapping (${outputMap.length} outputs):`);
  console.log('─'.repeat(80));
  for (const entry of outputMap) {
    const src = `${entry.tier}/${entry.srcName}.png`;
    const dest32 = `32/${entry.destDir}/${entry.destName}.png`;
    const destRaw = `raw/${entry.destDir}/${entry.destName}_raw.png`;
    console.log(`  ${src.padEnd(35)} → ${dest32}`);
    console.log(`  ${''.padEnd(35)}   ${destRaw}`);
  }
  console.log('─'.repeat(80));
  console.log(
    `Total: ${outputMap.length} sprites → ${outputMap.length * 3} output files (32 + 64 + raw)\n`,
  );

  if (DRY_RUN) {
    console.log('Dry run complete. No files written.');
    return;
  }

  // Step 3: Process all sprites
  let processed = 0;
  let errors = 0;

  for (const entry of outputMap) {
    const srcPath = sourcePathCache.get(`${entry.tier}/${entry.srcName}`);
    const label = `${entry.tier}/${entry.srcName} → ${entry.destDir}/${entry.destName}`;
    try {
      const sizes = await processSprite(srcPath, entry.destName, entry.destDir);
      processed++;
      console.log(
        `[${processed}/${outputMap.length}] ${label}  (32: ${(sizes.s32 / 1024).toFixed(1)}KB, 64: ${(sizes.s64 / 1024).toFixed(1)}KB)`,
      );
    } catch (err) {
      errors++;
      console.error(`[ERROR] ${label}: ${err.message}`);
    }
  }

  // Step 4: Verify all outputs exist
  console.log(`\nVerifying outputs...`);
  const missingOutputs = [];
  for (const entry of outputMap) {
    const f32 = path.join(OUTPUT_DIR, '32', entry.destDir, `${entry.destName}.png`);
    const f64 = path.join(OUTPUT_DIR, '64', entry.destDir, `${entry.destName}.png`);
    const fRaw = path.join(OUTPUT_DIR, 'raw', entry.destDir, `${entry.destName}_raw.png`);
    if (!existsSync(f32)) missingOutputs.push(f32);
    if (!existsSync(f64)) missingOutputs.push(f64);
    if (!existsSync(fRaw)) missingOutputs.push(fRaw);
  }

  if (missingOutputs.length > 0) {
    console.error(`FATAL: ${missingOutputs.length} expected outputs MISSING:`);
    for (const m of missingOutputs) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log(`\nDone! Processed ${processed} sprites (${errors} errors).`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
