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
// Sources: rebuilt references (assets/portraits/rebuilt), legacy 128 px art
// (assets/portraits), and generated portrait variants
// (docs/art/portrait-variant-sources, tools/art/portrait-variants), which also
// re-source the legacy generic/enemy defaults they remaster.
//
// Outputs (committed):
//   assets/portraits/pc98/{192,96,64,48,40,32}/<id>.png  figure, transparent
//   assets/portraits/pc98/baked/<id>.png                 192 figure on its plate (defaults)
//   assets/portraits/pc98/plates/<faction>-<size>.png    backdrop plates
//   assets/portraits/pc98/atlas/<size>.png               baked canvas atlases (defaults)
//   tools/art/pc98/provenance.json                       provenance (not shipped)
//   src/ui/Pc98PortraitManifest.json                     runtime index
//   src/data/portraitVariants.json                       who wears which face
//   src/ui/ceremonyPortraitFraming.json                  (+ estimated framing)
//
// Variants (<class>__<person>) are lazy: figures only, never in the boot
// atlases or baked textures, so more faces cost no texture memory up front.
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
import { buildPlan } from '../portrait-variants/plan.mjs';
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
// full-size rebuilt portrait sources (not shipped: the game's copies are capped at 512 px,
// docs/mobile-memory-budget.md); PC-98 renders are made from these originals
const REBUILT_DIR = join(ROOT, 'docs/art/rebuilt-portrait-sources');
const FRAMING_FILE = join(ROOT, 'src/ui/ceremonyPortraitFraming.json');
const RUNTIME_MANIFEST = join(ROOT, 'src/ui/Pc98PortraitManifest.json');
const VARIANT_TABLE = join(ROOT, 'src/data/portraitVariants.json');
const PROVENANCE = join(ROOT, 'tools/art/pc98/provenance.json');
const VARIANT_DIR = join(ROOT, 'docs/art/portrait-variant-sources');
const variantSources = existsSync(join(VARIANT_DIR, 'sources.json'))
  ? JSON.parse(readFileSync(join(VARIANT_DIR, 'sources.json'), 'utf8'))
  : {};
const config = JSON.parse(readFileSync(join(ROOT, 'tools/art/pc98/portraits.config.json'), 'utf8'));
const rebuiltManifest = JSON.parse(
  readFileSync(join(ROOT, 'src/ui/RebuiltPortraitManifest.json'), 'utf8'),
);
const framingFile = JSON.parse(readFileSync(FRAMING_FILE, 'utf8'));

const legacyIds = readdirSync(LEGACY_DIR)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(0, -4));
const baseIds = [...new Set([...legacyIds, ...Object.keys(rebuiltManifest)])].sort();
const baseSet = new Set(baseIds);
const plan = buildPlan(baseSet);
/** A generated source exists for this id (a variant or a remastered default). */
const generated = (id) => Boolean(variantSources[id]) && existsSync(join(VARIANT_DIR, `${id}.png`));
const variantIds = plan.jobs.map((j) => j.id).filter((id) => !baseSet.has(id) && generated(id));
const ids = [...baseIds, ...variantIds].sort();
const isVariant = (id) => !baseSet.has(id);
const todo = ONLY ? ids.filter((id) => ONLY.includes(id)) : ids;

for (const dir of [...SIZES.map(String), 'baked', 'plates', 'atlas'])
  mkdirSync(join(OUT, dir), { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function loadSource(id) {
  const o = config.portraits?.[id] || {};
  if (generated(id)) {
    // Already cut out and framed by tools/art/portrait-variants/prepare.mjs.
    const file = join(VARIANT_DIR, `${id}.png`);
    const src = padSquare(await readRgba(file));
    return {
      src,
      kind: 'generated',
      native: variantSources[id].native,
      segmentation: 'prepared',
      file: file.slice(ROOT.length + 1),
      hash: sha(readFileSync(file)),
      o: {},
      framing: variantSources[id].framing,
    };
  }
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
const previousProvenance = existsSync(PROVENANCE)
  ? JSON.parse(readFileSync(PROVENANCE, 'utf8'))
  : null;
let framingChanged = false;

for (const id of todo) {
  const t0 = Date.now();
  const s = await loadSource(id);
  const faction = s.o.faction || defaultFaction(id);
  const tones = plateColours(faction);
  let framing = s.framing || s.o.framing || framingFile[id];
  if (s.framing && JSON.stringify(framingFile[id]) !== JSON.stringify(s.framing)) {
    framingFile[id] = { eye: s.framing.eye, cx: s.framing.cx };
    framingChanged = true;
  }
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
    // Defaults only: variants load lazily as figures (no baked 192, no atlas).
    if (!isVariant(id)) {
      if (size === MASTER_SIZE) await writePng(join(OUT, 'baked', `${id}.png`), baked);
      if (ATLAS_SIZES.includes(size)) atlasTiles[size].push(toRgba(baked));
    }
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
  runtime.portraits[id] = isVariant(id)
    ? { source: s.kind, faction, variant: true }
    : { source: s.kind, faction };
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
// Atlas frames index the defaults only, in sorted order.
order
  .filter((id) => !runtime.portraits[id].variant)
  .forEach((id, i) => (runtime.portraits[id].frame = i));

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
    const rows = Math.ceil(atlasTiles[size].length / ATLAS_COLUMNS);
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
writeJson(PROVENANCE, provenance);
// Who wears which face: only renders that exist, so the runtime never
// points at a missing file while variants are still being produced.
const built = new Set(Object.keys(runtimeManifest.portraits));
const table = structuredClone(plan.runtime);
for (const person of Object.values(table.identities))
  for (const [cls, id] of Object.entries(person.renders))
    if (!built.has(id)) delete person.renders[cls];
for (const [cls, people] of Object.entries(table.classes))
  table.classes[cls] = people.filter((p) => table.identities[p].renders[cls]);
for (const [cls, list] of Object.entries(table.enemy))
  table.enemy[cls] = list.filter((id) => built.has(id));
writeJson(VARIANT_TABLE, table);
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
    PROVENANCE,
    VARIANT_TABLE,
  ],
  { stdio: 'ignore' },
);
if (!args.includes('--no-sync'))
  spawnSync(process.execPath, [join(ROOT, 'tools/syncAssets.js')], { stdio: 'inherit' });
console.log(`PC-98 pass: ${todo.length} portraits, ${SIZES.length} sizes.`);
