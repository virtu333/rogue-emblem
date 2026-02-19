// Split generated sprite sheets into individual 32x32 sprites
// Usage: node tools/split-sheets.js
// Uses grid-based slicing: each sheet declares its layout (rows × cols)

import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = 'C:/Users/davec/Documents/emblem-rogue';
const INPUT_DIR = join(ROOT, 'References/imagen-output/pixeltest');
const OUTPUT_DIR = join(INPUT_DIR, 'split2');
mkdirSync(OUTPUT_DIR, { recursive: true });

const TOLERANCE = 40; // white bg removal

// Sheet definitions: file → grid layout + expected sprite names (left-to-right, top-to-bottom)
const SHEETS = [
  {
    file: 'sheet1v2_base_infantry.png',
    names: ['lord', 'myrmidon', 'fighter', 'archer', 'thief', 'mercenary', 'dancer', 'tactician'],
    grid: { rows: 1, cols: 8 },
  },
  {
    file: 'sheet2v2_base_mounted.png',
    names: [
      'cavalier',
      'knight',
      'mage',
      'cleric',
      'light_sage',
      'ranger',
      'pegasus_knight',
      'wyvern_rider',
    ],
    grid: { rows: 1, cols: 8 },
  },
  {
    file: 'sheet3v2_promoted_infantry.png',
    names: [
      'great_lord',
      'swordmaster',
      'warrior',
      'sniper',
      'assassin',
      'hero',
      'bard',
      'grandmaster',
    ],
    grid: { rows: 2, cols: 4 },
  },
  {
    file: 'sheet4v2_promoted_mounted.png',
    names: [
      'paladin',
      'general',
      'sage',
      'bishop',
      'light_priestess',
      'vanguard',
      'falcon_knight',
      'wyvern_lord',
    ],
    grid: { rows: 2, cols: 4 },
  },
  {
    file: 'sheet5v2_lord_classes.png',
    names: ['chevalier', 'holy_knight', 'sky_lancer', 'seraph_knight', 'sentinel', 'champion'],
    grid: { rows: 2, cols: 3 },
  },
  {
    file: 'sheet6v2_lord_characters.png',
    names: ['edric', 'kira', 'voss', 'sera', 'rowan', 'astrid', 'cael'],
    grid: { rows: 1, cols: 7 },
  },
];

// Remove white/light background pixels (in-place on raw RGBA buffer)
function removeBackground(raw, tolerance) {
  const threshold = 255 - tolerance;
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i],
      g = raw[i + 1],
      b = raw[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      raw[i + 3] = 0;
    }
  }
}

async function processSheet(sheet) {
  console.log(`\n=== ${sheet.file} ===`);
  const inputPath = join(INPUT_DIR, sheet.file);

  const img = sharp(inputPath);
  const { width, height } = await img.metadata();
  console.log(`  Source: ${width}x${height}`);

  const raw = await img.ensureAlpha().raw().toBuffer();
  removeBackground(raw, TOLERANCE);
  console.log(`  Background removed (tolerance=${TOLERANCE})`);

  // Create transparent PNG buffer for extraction
  const transparentSheet = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  const { rows, cols } = sheet.grid;
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  console.log(`  Grid: ${rows}×${cols}, cell size: ${cellW}×${cellH}`);

  const results = [];
  let nameIdx = 0;

  for (let r = 0; r < rows && nameIdx < sheet.names.length; r++) {
    for (let c = 0; c < cols && nameIdx < sheet.names.length; c++) {
      const name = sheet.names[nameIdx];
      const left = c * cellW;
      const top = r * cellH;

      try {
        // Extract grid cell
        const extracted = await sharp(transparentSheet)
          .extract({ left, top, width: cellW, height: cellH })
          .png()
          .toBuffer();

        // Trim transparent edges, then resize to 32x32
        const outputPath = join(OUTPUT_DIR, `${name}.png`);
        await sharp(extracted)
          .trim()
          .resize(32, 32, {
            fit: 'contain',
            kernel: 'nearest',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toFile(outputPath);

        results.push({ name, ok: true });
        console.log(`  [${nameIdx}] ${name} → 32x32 ✓ (cell ${r},${c})`);
      } catch (err) {
        results.push({ name, ok: false, error: err.message });
        console.error(`  [${nameIdx}] ${name} FAILED: ${err.message}`);
      }
      nameIdx++;
    }
  }

  return results;
}

// Main
console.log('Sprite Sheet Splitter (Grid Mode)');
console.log('==================================');

const allResults = [];
for (const sheet of SHEETS) {
  const results = await processSheet(sheet);
  allResults.push(...results);
}

const ok = allResults.filter((r) => r.ok).length;
const fail = allResults.filter((r) => !r.ok).length;
console.log(`\n=== Summary ===`);
console.log(`  ✓ ${ok} sprites processed`);
if (fail > 0) console.log(`  ✗ ${fail} failures`);
console.log(`  Output: ${OUTPUT_DIR}`);
