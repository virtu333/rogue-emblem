// Batch resize terrain tiles to 32x32 (no transparency — tiles fill entire cell)
// Usage: node tools/process_tiles.js

import sharp from 'sharp';
import { resolve, join } from 'path';

const TILE_SIZE = 32;
const DIR = resolve('assets/sprites/tilesets');
const PUBLIC_DIR = resolve('public/assets/sprites/tilesets');

const tiles = [
  'plain', 'forest', 'mountain', 'fort', 'throne',
  'wall', 'water', 'bridge', 'sand', 'village',
];

// Ensure public dir exists
import { mkdirSync } from 'fs';
mkdirSync(PUBLIC_DIR, { recursive: true });

for (const name of tiles) {
  const input = join(DIR, `${name}_raw.png`);
  const output = join(DIR, `${name}.png`);
  const publicOutput = join(PUBLIC_DIR, `${name}.png`);

  await sharp(input)
    .resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' })
    .png()
    .toFile(output);

  // Copy to public dir for Vite serving
  await sharp(output).toFile(publicOutput);

  console.log(`${name}: ${TILE_SIZE}x${TILE_SIZE} -> ${output}`);
}

console.log(`\nAll tiles processed and copied to public/`);
