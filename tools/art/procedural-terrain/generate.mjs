#!/usr/bin/env node
// Procedural terrain captures - drives the runtime renderer in
// src/art/terrain (single source of truth) from Node.
//
//   node tools/art/procedural-terrain/generate.mjs [--out DIR] [--maps river,castle]
//        [--no-weathered] [--no-sheet] [--no-closeup] [--no-metrics]
//
// Outputs (default DIR = docs/art-direction/build/terrain):
//   <map>_after.png           full map, 48px per cell (24 art px x2)
//   <map>_compare_phone.png   16x10 crop at exactly 34px per cell with units:
//                             study renderer (before) | runtime (after) | weathered atlases
//   <map>_overlay_phone.png   runtime crop with movement + danger overlays
//   terrain_sheet.png         all terrain types x3 variants + transitions
//   fit_closeup.png           objects vs their cells, with units, 3x
//   metrics.json              readability metrics per map and renderer
//
// "before" images are the study captures kept in <DIR>/before/
// (<map>_before.png at 48px per cell, closeup_<key>.png).
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { STUDY_MAPS, generateStudyMap, terrainSeed } from './lib/maps.mjs';
import { renderBattlefieldTerrain } from '../../../src/art/terrain/index.js';
import { readRgba, resultImage, writePng } from './lib/image.mjs';
import { phoneGround, drawUnits, drawOverlays, stageUnits, diamond } from './lib/phone.mjs';
import { loadWeatheredAtlases, renderWeathered } from './lib/weathered.mjs';
import { readabilityMetrics } from './lib/metrics.mjs';
import { buildSheet } from './lib/sheet.mjs';
import { buildCloseup } from './lib/closeup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = opt('--out', join(ROOT, 'docs/art-direction/build/terrain'));
const BEFORE = join(ROOT, 'docs/art-direction/build/terrain/before');
const only = opt('--maps', null)?.split(',');
const withWeathered = !args.includes('--no-weathered');
const withSheet = !args.includes('--no-sheet');
const withCloseup = !args.includes('--no-closeup');
const withMetrics = !args.includes('--no-metrics');
mkdirSync(OUT, { recursive: true });

async function labelBar(width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><rect width="100%" height="100%" fill="#16131e"/><text x="8" y="15" font-family="DejaVu Sans Mono, monospace" font-size="12" fill="#ddd0bd">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function panels(path, list) {
  const gap = 8;
  const W = list.reduce((a, p) => a + p.img.w, 0) + gap * (list.length - 1);
  const H = Math.max(...list.map((p) => p.img.h)) + 22;
  const comps = [];
  let x = 0;
  for (const { img, label } of list) {
    comps.push({ input: await labelBar(img.w, label), left: x, top: 0 });
    comps.push({
      input: await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
        .png()
        .toBuffer(),
      left: x,
      top: 22,
    });
    x += img.w + gap;
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: '#16131e' } })
    .composite(comps)
    .png({ compressionLevel: 9 })
    .toFile(path);
}

/** Phone view of a 48px/cell render: returns ground, composed image, mask. */
async function stagePhone(rgba48, map, units) {
  const ground = phoneGround(rgba48, map.cols, map.rows, map.crop);
  const composed = { ...ground, data: Buffer.from(ground.data) };
  const mask = await drawUnits(composed, ground.origin, units);
  return { ground, composed, mask };
}

const art = withWeathered ? await loadWeatheredAtlases() : null;
const metrics = {};
for (const spec of STUDY_MAPS.filter((s) => !only || only.includes(s.key))) {
  const map = generateStudyMap(spec);
  const t0 = performance.now();
  const res = renderBattlefieldTerrain({
    names: map.names,
    biome: map.biome,
    seed: terrainSeed(spec),
  });
  const ms = performance.now() - t0;
  const after = resultImage(res);
  await writePng(join(OUT, `${spec.key}_after.png`), after.data, after.w, after.h);
  const units = stageUnits(map, ...map.crop);
  const views = { after: await stagePhone(after.data, map, units) };
  const beforePath = join(BEFORE, `${spec.key}_before.png`);
  if (existsSync(beforePath)) {
    const b = await readRgba(beforePath);
    views.before = await stagePhone(b.data, map, units);
  }
  if (art) {
    const w = renderWeathered(map.names, map.biome, art);
    views.weathered = await stagePhone(w.data, map, units);
  }
  const list = [];
  if (views.before)
    list.push({ img: views.before.composed, label: `before: study  ${spec.key} (${map.biome})` });
  list.push({ img: views.after.composed, label: `after: runtime src/art/terrain  34px/cell` });
  if (views.weathered)
    list.push({ img: views.weathered.composed, label: 'weathered atlases  34px/cell' });
  await panels(join(OUT, `${spec.key}_compare_phone.png`), list);

  // Movement / danger overlays over the runtime terrain: do cells still read?
  const ov = phoneGround(after.data, map.cols, map.rows, map.crop);
  const players = units.filter((u) => u.faction === 'player');
  const enemies = units.filter((u) => u.faction === 'enemy');
  const move = players.length ? diamond(players[0].col, players[0].row, 4, map.cols, map.rows) : [];
  const danger = enemies.flatMap((u) => diamond(u.col, u.row, 5, map.cols, map.rows));
  drawOverlays(ov, ov.origin, { move, danger });
  await drawUnits(ov, ov.origin, units);
  await writePng(join(OUT, `${spec.key}_overlay_phone.png`), ov.data, ov.w, ov.h);

  if (withMetrics) {
    metrics[spec.key] = { template: map.templateId, biome: map.biome, units: units.length };
    for (const [k, v] of Object.entries(views))
      metrics[spec.key][k] = readabilityMetrics(
        v.ground,
        v.composed,
        v.mask,
        units,
        v.ground.origin,
      );
  }
  console.log(
    `${spec.key.padEnd(11)} ${map.templateId} ${map.cols}x${map.rows} biome=${map.biome} render=${ms.toFixed(0)}ms`,
  );
}
if (withMetrics && Object.keys(metrics).length) {
  const avg = {};
  for (const which of ['before', 'after', 'weathered']) {
    const rows = Object.values(metrics)
      .map((m) => m[which])
      .filter(Boolean);
    if (!rows.length) continue;
    avg[which] = {};
    for (const key of Object.keys(rows[0]))
      avg[which][key] =
        Math.round((rows.reduce((a, r) => a + r[key], 0) / rows.length) * 100) / 100;
  }
  writeFileSync(
    join(OUT, 'metrics.json'),
    JSON.stringify({ average: avg, maps: metrics }, null, 2) + '\n',
  );
  console.table(avg);
}
if (withSheet) {
  await buildSheet(join(OUT, 'terrain_sheet.png'));
  console.log('terrain_sheet.png');
}
if (withCloseup) {
  await buildCloseup(join(OUT, 'fit_closeup.png'), BEFORE);
  console.log('fit_closeup.png');
}
console.log(`-> ${OUT}`);
