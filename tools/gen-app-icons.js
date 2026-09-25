// Generate the app icons from the pixel-art source PNG using sharp (already a devDependency).
// Run with: npm run gen:icons
//
// Source: tools/icon-src/app-icon-pixel.png (1024x1024, full-bleed, opaque, no text).
// Outputs:
//   public/icons/  — PWA icons, served at the site root (/icons/...), clear of the
//                    public/_redirects `/assets/* -> 404` rule.
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png — the single-size
//                    1024 universal iOS icon (Xcode derives every size from it; App Store
//                    Connect takes the 1024 from the uploaded build).
//
// Swap to another candidate in one command (copies it over the source first):
//   npm run gen:icons -- --from docs/art-direction/app-icon/<id>.png
// Candidates, sheets and the ranking live in docs/art-direction/app-icon/README.md.
//
// The standard icons are full-bleed (iOS applies its own corner mask and ignores
// transparency); the maskable variant is the same full-bleed art, because its focal
// element sits inside Android's center-80% safe circle (see renderMaskable).

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
const src = join(root, 'tools', 'icon-src', 'app-icon-pixel.png');
const iosIcon = join(
  root,
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset',
  'AppIcon-512@2x.png',
);

// Opaque 24-bit RGB, no alpha channel: what App Store validation requires of the 1024.
const RGB_OPTS = { compressionLevel: 9, adaptiveFiltering: true };

async function adoptSource(from) {
  const input = resolve(root, from);
  const meta = await sharp(input).metadata();
  if (meta.width !== 1024 || meta.height !== 1024) {
    throw new Error(`--from ${from}: expected 1024x1024, got ${meta.width}x${meta.height}`);
  }
  const png = await sharp(input).removeAlpha().png(RGB_OPTS).toBuffer();
  await writeFile(src, png);
  console.log(`adopted ${from} -> tools/icon-src/app-icon-pixel.png`);
}

const fromIdx = process.argv.indexOf('--from');
if (fromIdx !== -1) {
  const from = process.argv[fromIdx + 1];
  if (!from) throw new Error('--from needs a path to a 1024x1024 PNG');
  await adoptSource(from);
}

await mkdir(outDir, { recursive: true });

// Palette PNG (256 colors) — the icons are precached by the service worker, and
// quantization is visually lossless for this pixel-art style at a fraction of the bytes.
const PNG_OPTS = { compressionLevel: 9, palette: true };

async function render(size, outName) {
  await sharp(src)
    .resize(size, size, { kernel: 'lanczos3' })
    .removeAlpha()
    .png(PNG_OPTS)
    .toFile(join(outDir, outName));
  console.log(`wrote public/icons/${outName} (${size}x${size})`);
}

async function renderMaskable(size, outName) {
  // Android crops maskable icons to (at least) a circle covering the center 80%. The
  // source art is full-bleed with its focal element inside that circle, so the maskable
  // icon is the same full-bleed art: launchers that crop less show more scene, never a
  // padded frame. (Keep any new source's key shapes inside the center-80% circle.)
  await render(size, outName);
}

async function renderIos() {
  const meta = await sharp(src).metadata();
  const img = sharp(src).removeAlpha();
  if (meta.width !== 1024 || meta.height !== 1024) img.resize(1024, 1024, { kernel: 'lanczos3' });
  await img.png(RGB_OPTS).toFile(iosIcon);
  console.log(
    'wrote ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png (1024x1024)',
  );
}

await render(180, 'apple-touch-icon-180.png');
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await renderMaskable(512, 'icon-512-maskable.png');
await renderIos();

console.log('App icons generated.');
