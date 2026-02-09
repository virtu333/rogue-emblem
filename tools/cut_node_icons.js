// Cut node map icons from Winlu Fantasy_World_Buildings.png
// Usage: node tools/cut_node_icons.js
// Pass --final to output processed icons to assets/sprites/nodes/

import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const FINAL = process.argv.includes('--final');
const SOURCE = resolve('References/Downloaded Packs/tilesets/Fantasy_World_Buildings.png');
const OUT_DIR = FINAL
  ? resolve('assets/sprites/nodes')
  : resolve('References/node_icon_candidates');
mkdirSync(OUT_DIR, { recursive: true });

const T = 48; // tile size in source sheet (768x768 = 16x16 tiles)

// --- Round 2: precision cuts based on visual review ---
const candidates = [
  // REST — individual houses (colorful roofs)
  { name: 'rest_house_a', x: T * 2, y: T * 2, w: T * 2, h: T * 2 },
  { name: 'rest_house_b', x: 0, y: T * 2, w: T * 2, h: T * 2 },
  { name: 'rest_village_small', x: 0, y: 0, w: T * 3, h: T * 2 },

  // BATTLE — peaked tent camp
  { name: 'battle_tents', x: 0, y: T * 5, w: T * 2, h: T * 2 },
  { name: 'battle_tents_wide', x: 0, y: T * 5, w: T * 3, h: T * 2 },
  // Fortress gate
  { name: 'battle_gate', x: T * 7, y: 0, w: T * 2, h: T * 2 },

  // BOSS — cathedral with spires
  { name: 'boss_cathedral_tight', x: T * 7, y: T * 4, w: T * 2, h: T * 3 },
  { name: 'boss_cathedral_wide', x: T * 6, y: T * 4, w: T * 3, h: T * 3 },
  // Dark tower — the tall Sauron-like spire
  { name: 'boss_tower_col', x: T * 6, y: T * 11, w: T, h: T * 4 },
  { name: 'boss_tower_2col', x: T * 6, y: T * 11, w: T * 2, h: T * 4 },

  // SHOP — red-roofed building area
  { name: 'shop_building', x: T * 3, y: T * 8, w: T * 2, h: T * 2 },
  // Market stall from different area
  { name: 'shop_area2', x: T * 5, y: T * 8, w: T * 2, h: T * 2 },
];

console.log(`Cutting ${candidates.length} regions...`);

for (const c of candidates) {
  try {
    let pipeline = sharp(SOURCE)
      .extract({ left: c.x, top: c.y, width: c.w, height: c.h });

    if (FINAL) {
      // Trim transparent edges, resize to 48x48
      pipeline = pipeline
        .trim()
        .resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    await pipeline.png().toFile(resolve(OUT_DIR, `${c.name}.png`));
    console.log(`  ${c.name}: ${c.w}x${c.h} from (${c.x},${c.y})`);
  } catch (err) {
    console.error(`  FAIL ${c.name}: ${err.message}`);
  }
}

console.log(`\nDone! Review in: ${OUT_DIR}`);
