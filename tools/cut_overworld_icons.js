// Cut node icon candidates from Winlu Overworld character sheets
// RPG Maker !$ format: 3-column × 4-row grid, cell = (width/3) × (height/4)
// Towers sheet: freeform layout with manual region definitions
// Usage: node tools/cut_overworld_icons.js

import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const SRC_DIR = resolve('References/Downloaded Packs/characters');
const OUT_DIR = resolve('References/node_icon_candidates');
mkdirSync(OUT_DIR, { recursive: true });

// --- Grid-based sheets (!$ format) ---
// Each entry: { file, prefix, cols, rows }
const gridSheets = [
  { file: '!$Overworld_Castle2.png', prefix: 'castle2', cols: 3, rows: 4 },
  { file: '!$Overworld_Village1.png', prefix: 'village1', cols: 3, rows: 4 },
  { file: '!$Overworld_Castle_magic.png', prefix: 'castle_magic', cols: 2, rows: 4 },
  { file: '!$Overworld_village_sea.png', prefix: 'village_sea', cols: 3, rows: 4 },
  { file: '!$Overworld_Castle1.png', prefix: 'castle1', cols: 3, rows: 4 },
  { file: '!$Overworld_Castle3.png', prefix: 'castle3', cols: 3, rows: 4 },
];

// --- Towers sheet: manual regions (freeform layout, 576x768) ---
// Row 1: tall stone towers (~48px wide, ~96px tall), various colors
// Row 3: dragon/monster towers (~72px wide, ~96px tall)
const towerRegions = [
  // Row 1 stone towers (top row)
  { name: 'tower_stone_gray', x: 0, y: 0, w: 48, h: 96 },
  { name: 'tower_stone_gray2', x: 48, y: 0, w: 48, h: 96 },
  { name: 'tower_blue', x: 144, y: 0, w: 48, h: 96 },
  { name: 'tower_orange', x: 192, y: 0, w: 48, h: 96 },
  { name: 'tower_ice', x: 240, y: 0, w: 48, h: 96 },
  { name: 'tower_sandstone', x: 432, y: 0, w: 48, h: 96 },
  // Row 2 broken/ruined towers
  { name: 'tower_ruined', x: 0, y: 96, w: 48, h: 96 },
  { name: 'tower_ruined2', x: 48, y: 96, w: 48, h: 96 },
  { name: 'tower_green_spire', x: 144, y: 96, w: 48, h: 96 },
  { name: 'tower_green_spire2', x: 192, y: 96, w: 48, h: 96 },
  { name: 'tower_ice_spire', x: 288, y: 96, w: 48, h: 96 },
  // Row 3 dragon towers (wider)
  { name: 'tower_dragon_brown', x: 0, y: 288, w: 72, h: 96 },
  { name: 'tower_dragon_ice', x: 72, y: 288, w: 72, h: 96 },
  // Row 3 fire/beacon towers (right side)
  { name: 'tower_fire_beacon', x: 384, y: 288, w: 48, h: 96 },
  { name: 'tower_fire_beacon2', x: 432, y: 288, w: 48, h: 96 },
  // Row 4 serpent towers
  { name: 'tower_serpent', x: 0, y: 384, w: 72, h: 96 },
  { name: 'tower_serpent2', x: 72, y: 384, w: 72, h: 96 },
];

// Check if a cell has any non-transparent content
async function hasContent(buffer, width, height) {
  const { data } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Check alpha channel (every 4th byte starting at index 3)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 10) return true;
  }
  return false;
}

let totalCut = 0;

// Process grid-based sheets
for (const sheet of gridSheets) {
  const srcPath = resolve(SRC_DIR, sheet.file);
  console.log(`\n--- ${sheet.file} ---`);

  let meta;
  try {
    meta = await sharp(srcPath).metadata();
  } catch (err) {
    console.error(`  SKIP: ${err.message}`);
    continue;
  }

  const cellW = Math.floor(meta.width / sheet.cols);
  const cellH = Math.floor(meta.height / sheet.rows);
  console.log(`  ${meta.width}x${meta.height} → ${sheet.cols}x${sheet.rows} grid, cell=${cellW}x${cellH}`);

  for (let row = 0; row < sheet.rows; row++) {
    for (let col = 0; col < sheet.cols; col++) {
      const x = col * cellW;
      const y = row * cellH;
      const name = `${sheet.prefix}_r${row}c${col}`;

      try {
        const cellBuffer = await sharp(srcPath)
          .extract({ left: x, top: y, width: cellW, height: cellH })
          .png()
          .toBuffer();

        // Skip empty cells
        if (!await hasContent(cellBuffer, cellW, cellH)) {
          console.log(`  ${name}: empty, skipping`);
          continue;
        }

        const outPath = resolve(OUT_DIR, `${name}.png`);
        await sharp(cellBuffer).toFile(outPath);
        console.log(`  ${name}: ${cellW}x${cellH} from (${x},${y})`);
        totalCut++;
      } catch (err) {
        console.error(`  FAIL ${name}: ${err.message}`);
      }
    }
  }
}

// Process towers sheet (manual regions)
console.log(`\n--- !Overworld_towers.png (manual regions) ---`);
const towerSrc = resolve(SRC_DIR, '!Overworld_towers.png');

for (const region of towerRegions) {
  try {
    await sharp(towerSrc)
      .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
      .png()
      .toFile(resolve(OUT_DIR, `${region.name}.png`));
    console.log(`  ${region.name}: ${region.w}x${region.h} from (${region.x},${region.y})`);
    totalCut++;
  } catch (err) {
    console.error(`  FAIL ${region.name}: ${err.message}`);
  }
}

console.log(`\nDone! Cut ${totalCut} candidates to: ${OUT_DIR}`);
