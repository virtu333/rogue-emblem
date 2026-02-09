// Process selected node icon candidates into game-ready 48x48 PNGs
// Usage: node tools/process_node_icons.js [--dry-run]
// Reads: References/node_icon_candidates/selections.json
// Outputs: assets/sprites/nodes/node_{type}.png + public/ copy

import sharp from 'sharp';
import { readFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const CANDIDATES_DIR = resolve('References/node_icon_candidates');
const ASSETS_DIR = resolve('assets/sprites/nodes');
const PUBLIC_DIR = resolve('public/assets/sprites/nodes');
const SELECTIONS_FILE = resolve(CANDIDATES_DIR, 'selections.json');

// Load selections
let selections;
try {
  selections = JSON.parse(readFileSync(SELECTIONS_FILE, 'utf-8'));
} catch (err) {
  console.error(`Could not read ${SELECTIONS_FILE}`);
  console.error('Run compare.html first to generate selections.json');
  process.exit(1);
}

if (!selections.shop) {
  console.error('ERROR: Must select a shop icon (currently missing from game)');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('DRY RUN — no files will be written\n');
}

mkdirSync(ASSETS_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

const categories = Object.entries(selections);
console.log(`Processing ${categories.length} node icon(s)...\n`);

for (const [type, file] of categories) {
  const srcPath = resolve(CANDIDATES_DIR, file);
  const outName = `node_${type}.png`;
  const assetPath = resolve(ASSETS_DIR, outName);
  const publicPath = resolve(PUBLIC_DIR, outName);

  console.log(`  [${type}] ${file}`);

  if (DRY_RUN) {
    console.log(`    → would write ${assetPath}`);
    console.log(`    → would copy  ${publicPath}\n`);
    continue;
  }

  try {
    await sharp(srcPath)
      .trim()
      .resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(assetPath);

    copyFileSync(assetPath, publicPath);

    const meta = await sharp(assetPath).metadata();
    console.log(`    → ${meta.width}x${meta.height} saved + copied to public/\n`);
  } catch (err) {
    console.error(`    FAIL: ${err.message}\n`);
  }
}

console.log('Done!');
