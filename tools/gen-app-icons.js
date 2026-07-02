// Generate PWA app icons from the pixel-art source PNG using sharp (already a devDependency).
// Outputs into public/icons/ so they serve at the site root (/icons/...), clear of the
// public/_redirects `/assets/* -> 404` rule. Run with: npm run gen:icons
//
// Source: tools/icon-src/app-icon-pixel.png (1024x1024, Imagen pipeline, full-bleed dark).
// The standard icon is full-bleed (iOS apple-touch-icon ignores transparency); the maskable
// variant scales the art into Android's 80% safe circle over the art's own corner color.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
const src = join(root, 'tools', 'icon-src', 'app-icon-pixel.png');

await mkdir(outDir, { recursive: true });

// Palette PNG (256 colors) — the icons are precached by the service worker, and
// quantization is visually lossless for this pixel-art style at a fraction of the bytes.
const PNG_OPTS = { compressionLevel: 9, palette: true };

async function render(size, outName) {
  await sharp(src)
    .resize(size, size, { kernel: 'lanczos3' })
    .png(PNG_OPTS)
    .toFile(join(outDir, outName));
  console.log(`wrote public/icons/${outName} (${size}x${size})`);
}

async function renderMaskable(size, outName) {
  // Android crops maskable icons to a circle covering the center 80% — keep the
  // art inside that safe zone, padded with the art's own background color.
  const { data } = await sharp(src)
    .extract({ left: 2, top: 2, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2] };
  const inner = Math.round(size * 0.8);
  const art = await sharp(src).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: art, left: offset, top: offset }])
    .png(PNG_OPTS)
    .toFile(join(outDir, outName));
  console.log(`wrote public/icons/${outName} (${size}x${size} maskable)`);
}

await render(180, 'apple-touch-icon-180.png');
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await renderMaskable(512, 'icon-512-maskable.png');

console.log('App icons generated.');
