// Resize a sprite to target dimensions and remove white background
// Usage: node tools/process_sprite.js <input> <output> [size]

import sharp from 'sharp';
import { resolve } from 'path';

const [,, inputArg, outputArg, sizeArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('Usage: node tools/process_sprite.js <input> <output> [size=32]');
  process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const size = parseInt(sizeArg || '32', 10);
const TOLERANCE = 40; // how close to white counts as "background"

const img = sharp(input);
const { width, height } = await img.metadata();

// Get raw RGBA pixel data
const raw = await img.ensureAlpha().raw().toBuffer();

// Make near-white pixels transparent
for (let i = 0; i < raw.length; i += 4) {
  const r = raw[i], g = raw[i + 1], b = raw[i + 2];
  if (r >= 255 - TOLERANCE && g >= 255 - TOLERANCE && b >= 255 - TOLERANCE) {
    raw[i + 3] = 0; // set alpha to 0
  }
}

// Rebuild image, trim transparent edges, then resize to target
await sharp(raw, { raw: { width, height, channels: 4 } })
  .trim()  // crop to non-transparent content
  .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(output);

console.log(`Done: ${output} (${size}x${size}, transparent background)`);
