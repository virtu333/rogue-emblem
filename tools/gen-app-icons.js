// Generate PWA app icons from hand-authored SVGs using sharp (already a devDependency).
// Outputs into public/icons/ so they serve at the site root (/icons/...), clear of the
// public/_redirects `/assets/* -> 404` rule. Run with: npm run gen:icons
//
// SVG is rasterized at high density then downscaled for crisp edges. The standard icon
// is full-bleed dark (iOS apple-touch-icon ignores transparency); the maskable variant
// keeps art inside Android's 80% safe circle.

import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

// Source SVGs live under tools/ (build inputs), NOT assets/ — assets/ is mirrored to
// public/assets/ by syncAssets, and these source files should not ship at runtime.
const iconSvg = await readFile(join(root, 'tools', 'icon-src', 'app-icon.svg'));
const maskSvg = await readFile(join(root, 'tools', 'icon-src', 'app-icon-maskable.svg'));

await mkdir(outDir, { recursive: true });

async function render(svg, size, outName) {
  // density >> target so libvips rasterizes the vector at high DPI before downscaling.
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, outName));
  console.log(`wrote public/icons/${outName} (${size}x${size})`);
}

await render(iconSvg, 180, 'apple-touch-icon-180.png');
await render(iconSvg, 192, 'icon-192.png');
await render(iconSvg, 512, 'icon-512.png');
await render(maskSvg, 512, 'icon-512-maskable.png');

console.log('App icons generated.');
