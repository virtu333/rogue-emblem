// Process node map icons from hand-picked source images
// Usage: node tools/process_node_icons_v2.js

import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, copyFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REF = resolve(ROOT, 'References');
const OUT_DIR = resolve(ROOT, 'assets/sprites/nodes');
const PUB_DIR = resolve(ROOT, 'public/assets/sprites/nodes');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PUB_DIR, { recursive: true });

const TARGET_SIZE = 48;
const DARK_THRESHOLD = 40; // default: R,G,B all below this → transparent

// Remove near-black pixels from raw RGBA buffer
function removeDarkBg(buf, threshold = DARK_THRESHOLD) {
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (r < threshold && g < threshold && b < threshold) {
      buf[i + 3] = 0;
    }
  }
  return buf;
}

// Process a single source image: optional dark bg removal → trim → resize → save
async function processSimple(srcPath, outName, needsDarkRemoval, threshold) {
  const img = sharp(srcPath);
  const { width, height } = await img.metadata();

  let pipeline;
  if (needsDarkRemoval) {
    const raw = await img.ensureAlpha().raw().toBuffer();
    removeDarkBg(raw, threshold);
    pipeline = sharp(raw, { raw: { width, height, channels: 4 } });
  } else {
    pipeline = img.ensureAlpha();
  }

  const outPath = resolve(OUT_DIR, outName);
  await pipeline
    .trim()
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outPath);

  copyFileSync(outPath, resolve(PUB_DIR, outName));
  console.log(`  ${outName} — done`);
}

// Build a composite icon: plains bg tile + character sprite overlay
async function processComposite(plainsSrc, charSrc, outName, tintGreen) {
  // Step 1: process plains tile — remove dark bg, trim, resize to 32x32
  const plainsImg = sharp(plainsSrc);
  const plainsMeta = await plainsImg.metadata();
  const plainsRaw = await plainsImg.ensureAlpha().raw().toBuffer();
  removeDarkBg(plainsRaw);

  const plainsTile = await sharp(plainsRaw, {
    raw: { width: plainsMeta.width, height: plainsMeta.height, channels: 4 },
  })
    .trim()
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Step 2: load character sprite, resize to ~22px
  let charPipeline = sharp(charSrc).ensureAlpha();
  if (tintGreen) {
    charPipeline = charPipeline.tint({ r: 80, g: 200, b: 100 });
  }
  const charSprite = await charPipeline
    .resize(22, 22, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Step 3: composite on a 48x48 transparent canvas
  // Plains tile centered (offset 8,8 in 48x48), character centered on top (offset 13,13)
  const outPath = resolve(OUT_DIR, outName);
  await sharp({
    create: { width: TARGET_SIZE, height: TARGET_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: plainsTile, left: 8, top: 8 },
      { input: charSprite, left: 13, top: 13 },
    ])
    .png()
    .toFile(outPath);

  copyFileSync(outPath, resolve(PUB_DIR, outName));
  console.log(`  ${outName} — done (composite)`);
}

// --- Main ---
console.log('Processing node icons...\n');

// Simple icons
const simpleIcons = [
  {
    src: resolve(REF, 'node_icon_dave/Rest Nodes/ChurchRest.png'),
    out: 'node_rest.png',
    darkBg: true,
    threshold: 70, // teal-ish bg (~46,61,63) needs higher threshold
  },
  {
    src: resolve(REF, 'node_icon_dave/Shop Nodes/rest_village_small.png'),
    out: 'node_shop.png',
    darkBg: false,
  },
  {
    src: resolve(REF, 'node_icon_dave/Boss Icons/castle1_r2c0.png'),
    out: 'node_boss.png',
    darkBg: false,
  },
  {
    src: resolve(REF, 'node_icon_candidates/castle3_r0c0.png'),
    out: 'node_boss_final.png',
    darkBg: false,
  },
  {
    src: resolve(REF, 'node_icon_dave/Battle Nodes/Dark Fortress.png'),
    out: 'node_elite.png',
    darkBg: true,
  },
];

for (const { src, out, darkBg, threshold } of simpleIcons) {
  await processSimple(src, out, darkBg, threshold);
}

// Composite icons
const plainsSrc = resolve(REF, 'node_icon_dave/Battle Nodes/Plains Node.png');
const fighterSrc = resolve(ROOT, 'assets/sprites/enemies/fighter.png');
const mercSrc = resolve(ROOT, 'assets/sprites/characters/mercenary.png');

await processComposite(plainsSrc, fighterSrc, 'node_battle.png', false);
await processComposite(plainsSrc, mercSrc, 'node_recruit.png', true);

console.log('\nAll 7 node icons processed.');
