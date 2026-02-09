// Post-process selected Imagen variants into game-ready assets
// Usage: node tools/imagen-process.js [--category NAME]

import sharp from 'sharp';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve('C:/Users/davec/Documents/emblem-rogue');
const MANIFEST_PATH = join(ROOT, 'References/imagen-manifest.json');
const OUTPUT_DIR = join(ROOT, 'References/imagen-output');
const RAW_DIR = join(OUTPUT_DIR, 'raw');
const PROCESSED_DIR = join(OUTPUT_DIR, 'processed');
const SELECTIONS_PATH = join(OUTPUT_DIR, 'selections.json');
const TOLERANCE = 40;

// Parse CLI args
const args = process.argv.slice(2);
const categoryFilter = getArg('--category');

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

// Load manifest + selections
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
if (!existsSync(SELECTIONS_PATH)) {
  console.error('No selections.json found. Run imagen-compare.html first and save your selections.');
  process.exit(1);
}
const selections = JSON.parse(readFileSync(SELECTIONS_PATH, 'utf8'));

// Remove white background from raw RGBA buffer (in-place)
function removeWhiteBg(raw) {
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2];
    if (r >= 255 - TOLERANCE && g >= 255 - TOLERANCE && b >= 255 - TOLERANCE) {
      raw[i + 3] = 0;
    }
  }
}

async function processAsset(catName, category, asset) {
  const sel = selections[catName]?.[asset.name];
  if (sel === undefined) {
    console.log(`  [${asset.name}] No selection — skipping`);
    return;
  }

  const inputPath = join(RAW_DIR, catName, `${asset.name}_v${sel}.png`);
  if (!existsSync(inputPath)) {
    console.error(`  [${asset.name}] Missing: ${inputPath}`);
    return;
  }

  const outDir = join(PROCESSED_DIR, catName);
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `${asset.name}.png`);
  const size = category.targetSize;

  if (category.removeBg) {
    // White bg removal → trim → resize with transparent padding
    const img = sharp(inputPath);
    const { width, height } = await img.metadata();
    const raw = await img.ensureAlpha().raw().toBuffer();

    removeWhiteBg(raw);

    await sharp(raw, { raw: { width, height, channels: 4 } })
      .trim()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);

    console.log(`  [${asset.name}] → ${size}x${size}, transparent bg`);
  } else {
    // Portraits: just resize to target with cover crop
    await sharp(inputPath)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(outputPath);

    console.log(`  [${asset.name}] → ${size}x${size}, cover crop`);
  }
}

// Main
for (const [catName, category] of Object.entries(manifest.categories)) {
  if (categoryFilter && catName !== categoryFilter) continue;

  console.log(`\n=== ${catName} ===`);
  for (const asset of category.assets) {
    await processAsset(catName, category, asset);
  }
}

console.log(`\nDone! Processed assets in ${PROCESSED_DIR}`);
