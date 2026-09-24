#!/usr/bin/env node
// PC-98 portrait pass — production build (deterministic).
//
// Renders every portrait the game can show (rebuilt high-res references
// preferred, legacy 128px art otherwise) into the PC-98 house style:
// 12-bit colour, ~16 colours with ink, ordered dither between near colours,
// selective ink line art, faction backdrop plates.
//
//   node tools/art/pc98/build.mjs [--only id,id] [--no-sync]
//
// Outputs (committed):
//   assets/portraits/pc98/{192,96,64,48,40,32}/<id>.png  figure, transparent
//   assets/portraits/pc98/baked/<id>.png                 192 figure on its plate
//   assets/portraits/pc98/plates/<faction>-<size>.png    backdrop plates
//   assets/portraits/pc98/atlas/<size>.png               baked canvas atlases
//   assets/portraits/pc98/manifest.json                  provenance
//   src/ui/Pc98PortraitManifest.json                     runtime index
//   src/ui/ceremonyPortraitFraming.json                  (+ estimated framing)
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import sharp from 'sharp';
import { readRgba, padSquare, crop, resample, writePng, toRgba } from './lib/io.mjs';
import { renderFigure, bake } from './lib/pipeline.mjs';
import { segmentBackground, hasTransparency } from './lib/segment.mjs';
import { estimateGrid } from './lib/grid.mjs';
import { estimateFraming } from './lib/framing.mjs';
import { renderPlate, plateColours, FACTIONS } from './lib/plate.mjs';
import { hashString } from './lib/raster.mjs';
import { hex } from './lib/color.mjs';
import {
  SIZES,
  MASTER_SIZE,
  ATLAS_SIZES,
  ATLAS_COLUMNS,
  tierFor,
  smoothFor,
  defaultFaction,
  faceEllipse,
  thumbCrop,
  framingInCrop,
} from './lib/config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ONLY = opt('--only')?.split(',');
const OUT = join(ROOT, 'assets/portraits/pc98');
const LEGACY_DIR = join(ROOT, 'assets/portraits');
const REBUILT_DIR = join(ROOT, 'assets/portraits/rebuilt');
const FRAMING_FILE = join(ROOT, 'src/ui/ceremonyPortraitFraming.json');
const RUNTIME_MANIFEST = join(ROOT, 'src/ui/Pc98PortraitManifest.json');
const config = JSON.parse(readFileSync(join(ROOT, 'tools/art/pc98/portraits.config.json'), 'utf8'));
const rebuiltManifest = JSON.parse(
  readFileSync(join(ROOT, 'src/ui/RebuiltPortraitManifest.json'), 'utf8'),
);
const framingFile = JSON.parse(readFileSync(FRAMING_FILE, 'utf8'));

const legacyIds = readdirSync(LEGACY_DIR)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(0, -4));
const ids = [...new Set([...legacyIds, ...Object.keys(rebuiltManifest)])].sort();
const todo = ONLY ? ids.filter((id) => ONLY.includes(id)) : ids;

for (const dir of [...SIZES.map(String), 'baked', 'plates', 'atlas'])
  mkdirSync(join(OUT, dir), { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function loadSource(id) {
  const o = config.portraits?.[id] || {};
  const rebuiltFile = rebuiltManifest[id]?.file;
  const kind = rebuiltFile ? 'rebuilt' : 'legacy';
  const file = rebuiltFile ? join(REBUILT_DIR, rebuiltFile) : join(LEGACY_DIR, `${id}.png`);
  const bytes = readFileSync(file);
  let src = await readRgba(file);
  if (o.crop) src = crop(src, o.crop);
  src = padSquare(src);
  let native = src.w;
  let segmentation = null;
  if (kind === 'rebuilt') native = estimateGrid(src.rgba, src.w, src.h).native;
  if (o.keepBackground) {
    for (let i = 0; i < src.w * src.h; i++) src.rgba[i * 4 + 3] = 255;
    segmentation = 'kept';
  } else if (!hasTransparency(src.rgba, src.w, src.h)) {
    const seg = segmentBackground(src.rgba, src.w, src.h, o.segment || {});
    for (let i = 0; i < src.w * src.h; i++) src.rgba[i * 4 + 3] = seg.mask[i] ? 255 : 0;
    segmentation = Math.round(seg.background * 1000) / 1000;
  }
  return {
    src,
    kind,
    native,
    segmentation,
    file: file.slice(ROOT.length + 1),
    hash: sha(bytes),
    o,
  };
}

const atlasTiles = Object.fromEntries(ATLAS_SIZES.map((s) => [s, []]));
const provenance = { generator: 'tools/art/pc98/build.mjs', portraits: {} };
const runtime = { portraits: {} };
const previous = existsSync(RUNTIME_MANIFEST)
  ? JSON.parse(readFileSync(RUNTIME_MANIFEST, 'utf8'))
  : null;
const previousProvenance = existsSync(join(OUT, 'manifest.json'))
  ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'))
  : null;
let framingChanged = false;

for (const id of todo) {
  const t0 = Date.now();
  const s = await loadSource(id);
  const faction = s.o.faction || defaultFaction(id);
  const tones = plateColours(faction);
  let framing = s.o.framing || framingFile[id];
  if (!framing) {
    const probe = await resample(s.src, 128);
    const est = estimateFraming(probe, 128);
    framing = { eye: est.eye, cx: est.cx };
    framingFile[id] = framing;
    framingChanged = true;
  }
  const seed = hashString(id);
  let master = null;
  const sizes = {};
  for (const size of SIZES) {
    const tier = tierFor(size);
    const c = thumbCrop(size, framing);
    const px = (v) => Math.round(v * s.src.w);
    const region =
      c.side < 1
        ? crop(s.src, [
            px(c.left),
            px(c.top),
            s.src.w - px(c.left) - px(c.side),
            s.src.h - px(c.top) - px(c.side),
          ])
        : s.src;
    const rgba = await resample(region, size, { sharpen: size <= 64 ? 0.6 : 0 });
    const fig = renderFigure(rgba, size, {
      ...tier,
      keep: s.o.keep || [],
      palette: master ? master.figurePalette : null,
      keepPalette: master ? master.keepPalette : [],
      smooth: smoothFor(size, s.native * c.side),
      face: faceEllipse(framingInCrop(framing, c), size),
      seed,
      line: { ...tier.line, silhouetteLine: !s.o.keepBackground, ...(s.o.line || {}) },
    });
    if (!master) master = fig;
    await writePng(join(OUT, String(size), `${id}.png`), fig);
    const plate = renderPlate(size);
    const baked = bake(fig, plate, tones);
    if (size === MASTER_SIZE) await writePng(join(OUT, 'baked', `${id}.png`), baked);
    if (ATLAS_SIZES.includes(size)) atlasTiles[size].push(toRgba(baked));
    sizes[size] = { colours: fig.colours, palette: fig.palette.slice(1).map(hex) };
  }
  provenance.portraits[id] = {
    source: s.file,
    sourceSha256: s.hash,
    kind: s.kind,
    nativeGrid: s.native,
    segmentation: s.segmentation,
    faction,
    framing,
    sizes,
  };
  runtime.portraits[id] = { source: s.kind, faction };
  console.log(
    `${id.padEnd(26)} ${s.kind.padEnd(7)} native ${String(s.native).padStart(4)}  ` +
      `${faction.padEnd(9)} colours ${SIZES.map((z) => sizes[z].colours).join('/')}  ${Date.now() - t0}ms`,
  );
}

// Partial builds (--only) keep the other entries.
if (ONLY && previous) runtime.portraits = { ...previous.portraits, ...runtime.portraits };
if (ONLY && previousProvenance)
  provenance.portraits = { ...previousProvenance.portraits, ...provenance.portraits };
const order = Object.keys(runtime.portraits).sort();
order.forEach((id, i) => (runtime.portraits[id].frame = i));

// Plates.
for (const faction of FACTIONS) {
  const tones = plateColours(faction);
  for (const size of SIZES)
    await writePng(join(OUT, 'plates', `${faction}-${size}.png`), {
      w: size,
      h: size,
      indices: renderPlate(size),
      palette: [tones.top, tones.bottom],
    });
}

// Canvas atlases (full builds only: frames are indexed by sorted id).
if (!ONLY)
  for (const size of ATLAS_SIZES) {
    const rows = Math.ceil(order.length / ATLAS_COLUMNS);
    const composites = atlasTiles[size].map((rgba, i) => ({
      input: Buffer.from(rgba),
      raw: { width: size, height: size, channels: 4 },
      left: (i % ATLAS_COLUMNS) * size,
      top: Math.floor(i / ATLAS_COLUMNS) * size,
    }));
    await sharp({
      create: {
        width: ATLAS_COLUMNS * size,
        height: rows * size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(join(OUT, 'atlas', `${size}.png`));
  }

const runtimeManifest = {
  version: 1,
  generator: 'tools/art/pc98/build.mjs',
  sizes: SIZES,
  masterSize: MASTER_SIZE,
  factions: FACTIONS,
  atlas: { sizes: ATLAS_SIZES, columns: ATLAS_COLUMNS },
  portraits: Object.fromEntries(order.map((id) => [id, runtime.portraits[id]])),
};
provenance.portraits = Object.fromEntries(
  Object.keys(provenance.portraits)
    .sort()
    .map((id) => [id, provenance.portraits[id]]),
);
provenance.plates = Object.fromEntries(
  FACTIONS.map((f) => {
    const t = plateColours(f);
    return [f, { top: hex(t.top), bottom: hex(t.bottom) }];
  }),
);

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
writeJson(RUNTIME_MANIFEST, runtimeManifest);
writeJson(join(OUT, 'manifest.json'), provenance);
if (framingChanged) {
  // One compact line per portrait, as the hand-authored file is written.
  const lines = Object.keys(framingFile)
    .sort()
    .map((k) => `  "${k}": { "eye": ${framingFile[k].eye}, "cx": ${framingFile[k].cx} }`);
  writeFileSync(FRAMING_FILE, `{\n${lines.join(',\n')}\n}\n`);
}
// Keep the committed JSON in the repo's house format.
spawnSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/prettier/bin/prettier.cjs'),
    '--write',
    RUNTIME_MANIFEST,
    FRAMING_FILE,
    join(OUT, 'manifest.json'),
  ],
  { stdio: 'ignore' },
);
if (!args.includes('--no-sync'))
  spawnSync(process.execPath, [join(ROOT, 'tools/syncAssets.js')], { stdio: 'inherit' });
console.log(`PC-98 pass: ${todo.length} portraits, ${SIZES.length} sizes.`);
