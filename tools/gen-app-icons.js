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
//   android/app/src/main/res/mipmap-<density>/ — the Android launcher icons: the legacy
//                    square and round icons (before Android 8) and the adaptive icon's
//                    foreground layer (108dp, the same full-bleed art; launchers mask it
//                    to the center 72dp), and drawable-{port,land}-<density>/splash.png,
//                    the launch screen, cropped from the iOS launch image.
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

// Android densities: the icon's dp size times the density's scale.
const ANDROID_RES = join(root, 'android', 'app', 'src', 'main', 'res');
const ANDROID_DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// Capacitor's launch-screen sizes (portrait width x height at each density).
const ANDROID_SPLASH = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};
const IOS_SPLASH = join(
  root,
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'Splash.imageset',
  'splash-2732x2732.png',
);

async function renderAndroid() {
  for (const [density, scale] of Object.entries(ANDROID_DENSITIES)) {
    const dir = join(ANDROID_RES, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const legacy = Math.round(48 * scale);
    await sharp(src)
      .resize(legacy, legacy, { kernel: 'lanczos3' })
      .removeAlpha()
      .png(PNG_OPTS)
      .toFile(join(dir, 'ic_launcher.png'));
    const circle = Buffer.from(
      `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`,
    );
    await sharp(src)
      .resize(legacy, legacy, { kernel: 'lanczos3' })
      .ensureAlpha()
      .composite([{ input: circle, blend: 'dest-in' }])
      .png({ compressionLevel: 9 })
      .toFile(join(dir, 'ic_launcher_round.png'));
    const layer = Math.round(108 * scale);
    await sharp(src)
      .resize(layer, layer, { kernel: 'lanczos3' })
      .removeAlpha()
      .png(PNG_OPTS)
      .toFile(join(dir, 'ic_launcher_foreground.png'));
  }
  console.log('wrote android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png');
}

async function renderAndroidSplash() {
  const writes = [[join(ANDROID_RES, 'drawable', 'splash.png'), 480, 320]];
  for (const [density, [w, h]] of Object.entries(ANDROID_SPLASH)) {
    writes.push([join(ANDROID_RES, `drawable-port-${density}`, 'splash.png'), w, h]);
    writes.push([join(ANDROID_RES, `drawable-land-${density}`, 'splash.png'), h, w]);
  }
  for (const [out, w, h] of writes) {
    await mkdir(dirname(out), { recursive: true });
    // The launch image is a small eclipse on a flat field: a centered cover crop keeps it
    // in the middle at any aspect.
    await sharp(IOS_SPLASH)
      .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
      .removeAlpha()
      .png(PNG_OPTS)
      .toFile(out);
  }
  console.log('wrote android/app/src/main/res/drawable*/splash.png');
}

await render(180, 'apple-touch-icon-180.png');
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await renderMaskable(512, 'icon-512-maskable.png');
await renderIos();
await renderAndroid();
await renderAndroidSplash();

console.log('App icons generated.');
