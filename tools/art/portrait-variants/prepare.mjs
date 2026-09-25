#!/usr/bin/env node
// Raw generation -> PC-98 source: cut out, framed like the approved set, 384 px.
//
//   node tools/art/portrait-variants/prepare.mjs [--only id,id] [--force]
//
// Reads References/portrait-variants/raw/<id>.(jpg|png), writes
// docs/art/portrait-variant-sources/<id>.png (not shipped; the PC-98 build
// renders assets/portraits/pc98/ from it) and records framing, grid and
// provenance in docs/art/portrait-variant-sources/sources.json.
// Face and eyes are located by a vision model (cached beside the raw), then
// the figure is placed so the eye line, face centre and face size match the
// approved rebuilt portraits (eye 0.36, face ~0.38 of the frame).
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { describeImage } from '../gen/geminiImage.mjs';
import { estimateGrid } from '../pc98/lib/grid.mjs';
import { buildPlan } from './plan.mjs';
import { cutout, framingTransform } from './lib/cutout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = join(ROOT, 'References/portrait-variants');
const RAW = join(WORK, 'raw');
export const SOURCES = join(ROOT, 'docs/art/portrait-variant-sources');
export const SOURCE_SIZE = 384;
const RAW_SIZE = 1024;
const DETECT_MODEL = 'gemini-3.5-flash';
const DETECT_PROMPT =
  'Detect the character\'s face (forehead to chin, ear to ear) and each visible eye. Return a JSON list of objects {"label": "face"|"eye", "box_2d": [ymin, xmin, ymax, xmax]} with coordinates normalized to 0-1000.';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const ONLY = opt('--only')?.split(',');
const FORCE = args.includes('--force');
const pc98 = JSON.parse(readFileSync(join(ROOT, 'src/ui/Pc98PortraitManifest.json'), 'utf8'));
const notesFile = join(ROOT, 'tools/art/portrait-variants/notes.json');
const notes = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, 'utf8')) : {};
const sourcesFile = join(SOURCES, 'sources.json');
const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, 'utf8')) : {};
mkdirSync(SOURCES, { recursive: true });

/** Written after every portrait, so an interrupted run keeps its work. */
function writeSources() {
  const sorted = Object.fromEntries(
    Object.keys(sources)
      .sort()
      .map((k) => [k, sources[k]]),
  );
  writeFileSync(sourcesFile, `${JSON.stringify(sorted, null, 2)}\n`);
}

const { jobs } = buildPlan(new Set(Object.keys(pc98.portraits)));
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const rawFile = (id) =>
  ['.png', '.jpg'].map((e) => join(RAW, id + e)).find((f) => existsSync(f)) || null;

/** Eye line, face centre and face height (fractions) from the vision model. */
async function locateFace(id, file) {
  const { json } = await describeImage({
    prompt: DETECT_PROMPT,
    images: [file],
    model: DETECT_MODEL,
    out: join(WORK, 'detect', id),
  });
  // Labels come back as "face", "the character's face", "visible eye"...
  const boxes = (Array.isArray(json) ? json : [])
    .map((b) => ({ label: String(b?.label || ''), box_2d: b?.box_2d || b?.box2d }))
    .filter((b) => Array.isArray(b.box_2d) && b.box_2d.length === 4);
  const face = boxes.find((b) => /face/i.test(b.label));
  const eyes = boxes.filter((b) => /\beyes?\b/i.test(b.label) && !/face/i.test(b.label));
  if (!face) throw new Error(`${id}: no face found`);
  const [fy0, fx0, fy1, fx1] = face.box_2d.map((v) => v / 1000);
  const eye = eyes.length
    ? eyes.reduce((s, b) => s + (b.box_2d[0] + b.box_2d[2]) / 2000, 0) / eyes.length
    : fy0 + (fy1 - fy0) * 0.45;
  return { eye, cx: (fx0 + fx1) / 2, faceH: fy1 - fy0, eyes: eyes.length };
}

let made = 0;
for (const job of jobs) {
  if (job.mode === 'keep' || (ONLY && !ONLY.includes(job.id))) continue;
  const file = rawFile(job.id);
  if (!file) continue;
  const bytes = readFileSync(file);
  const rawSha = sha(bytes);
  const o = notes[job.id]?.prepare || {};
  const out = join(SOURCES, `${job.id}.png`);
  const optionsKey = JSON.stringify(o);
  if (
    !FORCE &&
    sources[job.id]?.rawSha256 === rawSha &&
    sources[job.id]?.options === optionsKey &&
    existsSync(out)
  )
    continue;
  const { data, info } = await sharp(bytes)
    .resize(RAW_SIZE, RAW_SIZE, { kernel: 'lanczos3', fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = new Uint8Array(data);
  const rgba = new Uint8Array(RAW_SIZE * RAW_SIZE * 4);
  for (let i = 0; i < RAW_SIZE * RAW_SIZE; i++) {
    rgba[i * 4] = rgb[i * info.channels];
    rgba[i * 4 + 1] = rgb[i * info.channels + 1];
    rgba[i * 4 + 2] = rgb[i * info.channels + 2];
    rgba[i * 4 + 3] = 255;
  }
  const cut = cutout(rgba, RAW_SIZE, RAW_SIZE, o.cutout || {});
  for (let i = 0; i < RAW_SIZE * RAW_SIZE; i++) rgba[i * 4 + 3] = cut.mask[i] ? 255 : 0;
  const face = { ...(await locateFace(job.id, file)), ...(o.face || {}) };
  const grid = estimateGrid(rgba, RAW_SIZE, RAW_SIZE);
  const t = framingTransform(face, o.framing || {});
  // Place the cut-out figure: scale, then offset by (dx, dy) of the frame.
  const scaled = Math.round(RAW_SIZE * t.scale);
  const figure = await sharp(Buffer.from(rgba), {
    raw: { width: RAW_SIZE, height: RAW_SIZE, channels: 4 },
  })
    .resize(scaled, scaled, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const left = Math.round(t.dx * RAW_SIZE);
  const top = Math.round(t.dy * RAW_SIZE);
  // Crop the part of the scaled figure that lands inside the frame.
  const sx = Math.max(0, -left);
  const sy = Math.max(0, -top);
  const cw = Math.min(scaled - sx, RAW_SIZE - Math.max(0, left));
  const ch = Math.min(scaled - sy, RAW_SIZE - Math.max(0, top));
  const piece = await sharp(figure, { raw: { width: scaled, height: scaled, channels: 4 } })
    .extract({ left: sx, top: sy, width: cw, height: ch })
    .png()
    .toBuffer();
  const framed = await sharp({
    create: {
      width: RAW_SIZE,
      height: RAW_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }])
    .png()
    .toBuffer();
  // 256-colour PNG: lossless container, ~60 KB; the PC-98 pass keeps 13.
  await sharp(framed)
    .resize(SOURCE_SIZE, SOURCE_SIZE, { kernel: 'lanczos3' })
    .png({ palette: true, colours: 256, dither: 0, compressionLevel: 9, effort: 10 })
    .toFile(out);
  sources[job.id] = {
    raw: `References/portrait-variants/raw/${file.split('/').pop()}`,
    rawSha256: rawSha,
    options: optionsKey,
    side: job.side,
    className: job.className,
    person: job.person,
    mode: job.mode,
    // The frame shows 1/scale of the raw, so its pixel grid is native/scale.
    native: Math.round(grid.native / t.scale),
    detected: {
      eye: +face.eye.toFixed(3),
      cx: +face.cx.toFixed(3),
      faceH: +face.faceH.toFixed(3),
      eyes: face.eyes,
    },
    transform: { scale: t.scale, dx: t.dx, dy: t.dy },
    framing: { eye: Math.round(t.eye * 200) / 200, cx: Math.round(t.cx * 200) / 200 },
    background: +cut.background.toFixed(3),
    pockets: cut.pockets,
  };
  made++;
  writeSources();
  console.log(
    `${job.id.padEnd(40)} scale ${t.scale} eye ${t.eye} cx ${t.cx} native ${sources[job.id].native} pockets ${cut.pockets}`,
  );
}
writeSources();
console.log(`prepared ${made}; ${Object.keys(sources).length} sources`);
