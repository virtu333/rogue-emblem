#!/usr/bin/env node
// Procedural terrain art study — generator CLI.
//
//   node tools/art/procedural-terrain/generate.mjs [--out DIR] [--maps river,castle] [--no-weathered] [--no-sheet]
//
// Outputs (default DIR = docs/art-direction/board/terrain):
//   <map>_procedural.png       full map, 48px per cell (24 art px x2)
//   <map>_phone.png            16x10 cell crop at exactly 34px per cell, with units
//   <map>_weathered.png        same layout through the game's weathered atlases
//   <map>_weathered_phone.png  same crop / units, weathered
//   <map>_compare_phone.png    procedural vs weathered, side by side
//   terrain_sheet.png          all 19 terrain types x3 variants + transitions
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { STUDY_MAPS, generateStudyMap } from './lib/maps.mjs';
import { renderTerrain } from './lib/render.mjs';
import { indexToRgba, upscaleNearest, writePng } from './lib/image.mjs';
import { phoneView, stageUnits } from './lib/phone.mjs';
import { loadWeatheredAtlases, renderWeathered } from './lib/weathered.mjs';
import { buildSheet } from './lib/sheet.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = opt('--out', join(ROOT, 'docs/art-direction/board/terrain'));
const only = opt('--maps', null)?.split(',');
const withWeathered = !args.includes('--no-weathered');
const withSheet = !args.includes('--no-sheet');
const phoneMode = opt('--phone-mode', 'area');
mkdirSync(OUT, { recursive: true });

export function renderMapRgba48(names, biome, seed) {
  const r = renderTerrain(names, { biome, seed });
  return {
    data: upscaleNearest(indexToRgba(r.idx, r.w, r.h), r.w, r.h, 2),
    w: r.w * 2,
    h: r.h * 2,
  };
}

async function labelBar(width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><rect width="100%" height="100%" fill="#16131e"/><text x="8" y="15" font-family="DejaVu Sans Mono, monospace" font-size="12" fill="#ddd0bd">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function sideBySide(path, left, right, labels) {
  const gap = 8,
    W = left.w + right.w + gap,
    H = Math.max(left.h, right.h) + 22;
  const toPng = (img) =>
    sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
      .png()
      .toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4, background: '#16131e' } })
    .composite([
      { input: await labelBar(left.w, labels[0]), left: 0, top: 0 },
      { input: await labelBar(right.w, labels[1]), left: left.w + gap, top: 0 },
      { input: await toPng(left), left: 0, top: 22 },
      { input: await toPng(right), left: left.w + gap, top: 22 },
    ])
    .png()
    .toFile(path);
}

const art = withWeathered ? await loadWeatheredAtlases() : null;
const summary = [];
for (const spec of STUDY_MAPS.filter((s) => !only || only.includes(s.key))) {
  const map = generateStudyMap(spec);
  const seed = spec.seed * 1000 + 7;
  const t0 = performance.now();
  const proc = renderMapRgba48(map.names, map.biome, seed);
  const ms = performance.now() - t0;
  await writePng(join(OUT, `${spec.key}_procedural.png`), proc.data, proc.w, proc.h);
  const units = stageUnits(map, ...spec.crop);
  const phone = await phoneView(proc.data, map.cols, map.rows, spec.crop, units, {
    mode: phoneMode,
  });
  await writePng(join(OUT, `${spec.key}_phone.png`), phone.data, phone.w, phone.h);
  let line = `${spec.key.padEnd(11)} ${map.templateId} ${map.cols}x${map.rows} biome=${map.biome} render=${ms.toFixed(0)}ms`;
  if (art) {
    const w = renderWeathered(map.names, map.biome, art);
    await writePng(join(OUT, `${spec.key}_weathered.png`), w.data, w.w, w.h);
    const wp = await phoneView(w.data, map.cols, map.rows, spec.crop, units, { mode: phoneMode });
    await writePng(join(OUT, `${spec.key}_weathered_phone.png`), wp.data, wp.w, wp.h);
    await sideBySide(join(OUT, `${spec.key}_compare_phone.png`), phone, wp, [
      `procedural  ${spec.key} (${map.biome})  34px/cell`,
      'current weathered atlases  34px/cell',
    ]);
  }
  summary.push(line);
  console.log(line);
}
if (withSheet) {
  await buildSheet(join(OUT, 'terrain_sheet.png'));
  console.log('terrain_sheet.png');
}
console.log(`-> ${OUT}`);
