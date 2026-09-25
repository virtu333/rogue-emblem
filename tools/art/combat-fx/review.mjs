#!/usr/bin/env node
// Combat v2 review sheets: every effect over the real procedural battlefield ground of
// several biomes, graded with the battle's own colour pipeline (lib/grade.mjs), by day
// and at night, before (the 22 generated strips) and after (this generator).
//
//   node tools/art/combat-fx/review.mjs [--out docs/art-direction/combat-v2] [--only sword,fire]
//
// Outputs
//   sheets/<family>_3x.webp       before / after per family at 3x (dusk, Iron Rain castle,
//                                 Ashfall night, Rime night), one column per frame
//   overview_1x.webp              every effect's frames at 1x on dusk ground and at night
//   anim/<family>.webp            animated loops at 3x (before | after), real frame timing
//   anim/<family>.gif             the same loop as GIF (with --gif)
// "Before" frames come from git (the commit before Combat v2) unless --before DIR is given.
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { renderAll } from './lib/atlas.mjs';
import { compositeFrame } from './lib/build.mjs';
import { moodFor, applyNight, applyGrade } from './lib/grade.mjs';
import { STUDY_MAPS, generateStudyMap, terrainSeed } from '../procedural-terrain/lib/maps.mjs';
import { renderBattlefieldTerrain } from '../../../src/art/terrain/index.js';
import { resultImage } from '../procedural-terrain/lib/image.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const tracedManifest = JSON.parse(
  readFileSync(join(ROOT, 'src/ui/TracedSpriteManifest.json'), 'utf8'),
);
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = opt('--out', join(ROOT, 'docs/art-direction/combat-v2'));
const BEFORE_DIR = opt('--before', null);
const BEFORE_REV = '3c247e6';
const only = opt('--only', null)?.split(',');
mkdirSync(join(OUT, 'sheets'), { recursive: true });
mkdirSync(join(OUT, 'anim'), { recursive: true });

// ---------------------------------------------------------------- grounds --------

const GROUNDS = [
  { id: 'dusk', label: 'grassland · Ember Dusk', map: 'river', act: 'act1' },
  { id: 'rain', label: 'castle · Iron Rain', map: 'castle', act: 'act2' },
  { id: 'ashfall', label: 'volcano · Ashfall (night)', map: 'caldera', act: 'act4' },
  { id: 'rime', label: 'tundra · Rime (night)', map: 'frozen', act: 'act4' },
];
const OPEN = new Set(['Plain', 'Floor', 'Sand', 'Ice']);
const CELL = 32; // world px per cell (effects are 1 art px per world px)
const VIEW = [112, 88]; // review window, world px (the target stands at its centre)

async function loadGround(g) {
  const spec = STUDY_MAPS.find((s) => s.key === g.map);
  const map = generateStudyMap(spec);
  const res = renderBattlefieldTerrain({
    names: map.names,
    biome: map.biome,
    seed: terrainSeed(spec),
  });
  const img = resultImage(res);
  const W = map.cols * CELL;
  const H = map.rows * CELL;
  const world = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .resize(W, H, { kernel: 'nearest' })
    .raw()
    .toBuffer();
  // An open cell with open ground around it (room for the striker on the left).
  // The most open cell (target and striker tiles must be open ground).
  let cell = null;
  let best = -1;
  for (let r = 2; r < map.rows - 2; r++)
    for (let c = 3; c < map.cols - 2; c++) {
      if (!OPEN.has(map.names[r][c]) || !OPEN.has(map.names[r][c - 1])) continue;
      let score = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -2; dc <= 1; dc++) if (OPEN.has(map.names[r + dr][c + dc])) score++;
      if (score > best) {
        best = score;
        cell = [c, r];
      }
    }
  cell ||= [Math.floor(map.cols / 2), Math.floor(map.rows / 2)];
  const cx = cell[0] * CELL + CELL / 2;
  const cy = cell[1] * CELL + CELL / 2;
  const x0 = cx - VIEW[0] / 2;
  const y0 = cy - VIEW[1] / 2 - 8;
  const crop = new Uint8ClampedArray(VIEW[0] * VIEW[1] * 4);
  for (let y = 0; y < VIEW[1]; y++)
    for (let x = 0; x < VIEW[0]; x++) {
      const s = ((y0 + y) * W + (x0 + x)) * 4;
      const d = (y * VIEW[0] + x) * 4;
      crop[d] = world[s];
      crop[d + 1] = world[s + 1];
      crop[d + 2] = world[s + 2];
      crop[d + 3] = 255;
    }
  return { ...g, crop, mood: moodFor({ act: g.act, biome: map.biome }), unit: [cx - x0, cy - y0] };
}

// ---------------------------------------------------------------- units ----------

async function tracedFrame(key) {
  const atlas = join(ROOT, 'assets/sprites/traced/traced-atlas.png');
  const entry = tracedManifest.sprites[key];
  const cell = tracedManifest.cell;
  const buf = await sharp(atlas)
    .extract({ left: entry.x, top: entry.y, width: cell, height: cell })
    .resize(64, 64, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return { data: buf, w: 64, h: 64 };
}

function blit(dst, dw, dh, src, ox, oy) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const X = ox + x;
      const Y = oy + y;
      if (X < 0 || Y < 0 || X >= dw || Y >= dh) continue;
      const s = (y * src.w + x) * 4;
      const a = src.data[s + 3] / 255;
      if (a <= 0) continue;
      const d = (Y * dw + X) * 4;
      for (let k = 0; k < 3; k++) dst[d + k] = dst[d + k] * (1 - a) + src.data[s + k] * a;
    }
}

/** Old strips were drawn with additive blending: rgb * alpha added. */
function blitAdd(dst, dw, dh, src, ox, oy) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const X = ox + x;
      const Y = oy + y;
      if (X < 0 || Y < 0 || X >= dw || Y >= dh) continue;
      const s = (y * src.w + x) * 4;
      const a = src.data[s + 3] / 255;
      if (a <= 0) continue;
      const d = (Y * dw + X) * 4;
      for (let k = 0; k < 3; k++) dst[d + k] = Math.min(255, dst[d + k] + src.data[s + k] * a);
    }
}

// ---------------------------------------------------------------- effects --------

const { palette, rendered } = renderAll();
const byKey = Object.fromEntries(rendered.map((r) => [r.def.key, r]));

async function beforeFrames(key) {
  if (!key) return null;
  let buf;
  if (BEFORE_DIR && existsSync(join(BEFORE_DIR, `${key}.png`)))
    buf = readFileSync(join(BEFORE_DIR, `${key}.png`));
  else {
    try {
      buf = execFileSync('git', ['show', `${BEFORE_REV}:assets/sprites/fx/${key}.png`], {
        cwd: ROOT,
        maxBuffer: 1 << 24,
      });
    } catch {
      return null;
    }
  }
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width / 48;
  return Array.from({ length: n }, (_, i) => {
    const out = Buffer.alloc(48 * 48 * 4);
    for (let y = 0; y < 48; y++)
      data.copy(out, y * 48 * 4, (y * info.width + i * 48) * 4, (y * info.width + i * 48 + 48) * 4);
    return { data: out, w: 48, h: 48 };
  });
}

/** One review cell: ground, (night), unit, effect frame, then the grade. */
function cell(ground, unitImg, draw) {
  const [w, h] = VIEW;
  const img = new Uint8ClampedArray(ground.crop);
  applyNight(img, w, h, ground.mood.night);
  const [ux, uy] = ground.unit;
  if (unitImg) blit(img, w, h, unitImg, Math.round(ux - 32), Math.round(uy - 32));
  draw(img, w, h, ux, uy - 6);
  applyGrade(img, w, h, ground.mood.uniforms);
  return img;
}

function drawAfter(key, i) {
  const r = byKey[key];
  const def = r.def;
  const [ax, ay] = def.anchor || [0.5, 0.5];
  return (img, w, h, bx, by) => {
    let px = bx;
    let py = by;
    if (def.role === 'dust') py = by + 19;
    if (def.role === 'projectile' || def.role === 'segment') px = bx - 20;
    compositeFrame(img, w, h, Math.round(px - r.w * ax), Math.round(py - r.h * ay), r, i, palette);
  };
}

function drawBefore(frame) {
  return (img, w, h, bx, by) => blitAdd(img, w, h, frame, Math.round(bx - 24), Math.round(by - 24));
}

async function labelSvg(width, height, text, size = 13) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#16131e"/><text x="8" y="${Math.round(height / 2 + size / 3)}" font-family="DejaVu Sans Mono, monospace" font-size="${size}" fill="#ddd0bd">${esc}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const toPng = (img, w, h, k = 1) =>
  sharp(Buffer.from(img.buffer, img.byteOffset, img.byteLength), {
    raw: { width: w, height: h, channels: 4 },
  })
    .resize(w * k, h * k, { kernel: 'nearest' })
    .png()
    .toBuffer();

// Families: the new effects, and the old strip each one replaces.
const FAMILIES = [
  ['sword', ['fx_slash'], 'fx_slash'],
  ['axe', ['fx_chop'], 'fx_chop'],
  ['lance', ['fx_thrust', 'fx_shock_small'], 'fx_thrust'],
  ['bow', ['fx_arrow', 'fx_proj_arrow'], 'fx_arrow'],
  ['fire', ['fx_magic', 'fx_proj_fire'], 'fx_magic'],
  ['thunder', ['fx_thunder', 'fx_bolt_seg'], 'fx_magic'],
  ['wind', ['fx_wind', 'fx_proj_wind'], 'fx_magic'],
  ['light', ['fx_light', 'fx_proj_light'], 'fx_light'],
  ['unlight', ['fx_dark', 'fx_proj_dark'], 'fx_magic'],
  ['breath', ['fx_breath', 'fx_breath_toxic', 'fx_breath_ancient'], 'fx_magic'],
  ['heal', ['fx_heal'], 'fx_heal'],
  ['crit', ['fx_crit', 'fx_shock'], 'fx_crit'],
  ['pierce', ['fx_pierce'], 'fx_pierce'],
  ['flurry', ['fx_flurry'], 'fx_flurry'],
  ['drain', ['fx_drain'], 'fx_drain'],
  ['shield', ['fx_shield'], 'fx_shield'],
  ['buff', ['fx_buff'], 'fx_buff'],
  [
    'status',
    ['fx_status', 'fx_status_sleep', 'fx_status_silence', 'fx_status_acid', 'fx_status_root'],
    'fx_status',
  ],
  ['ring', ['fx_ring'], 'fx_ring'],
  ['sig_sword', ['fx_sig_sword'], 'fx_sig_sword'],
  ['sig_lance', ['fx_sig_lance'], 'fx_sig_lance'],
  ['sig_axe', ['fx_sig_axe'], 'fx_sig_axe'],
  ['sig_bow', ['fx_sig_bow'], 'fx_sig_bow'],
  ['sig_magic', ['fx_sig_magic'], 'fx_sig_magic'],
  ['sig_entity', ['fx_sig_entity'], 'fx_sig_entity'],
  ['sig_enrage', ['fx_sig_enrage'], 'fx_sig_enrage'],
  [
    'ground',
    [
      'fx_dust',
      'fx_dust_sand',
      'fx_dust_snow',
      'fx_dust_ash',
      'fx_dust_stone',
      'fx_dust_leaves',
      'fx_dust_splash',
      'fx_dust_mire',
      'fx_dust_sparks',
    ],
    null,
  ],
  [
    'projectiles',
    ['fx_proj_javelin', 'fx_proj_axe', 'fx_proj_blade', 'fx_proj_bolt', 'fx_proj_breath'],
    null,
  ],
];

const grounds = [];
for (const g of GROUNDS) grounds.push(await loadGround(g));
const target = await tracedFrame('enemy_knight');
const boss = await tracedFrame('boss_iron_wall');

async function familySheet(name, keys, beforeKey) {
  const K = 3;
  const [w, h] = VIEW;
  const LW = 230;
  const rows = [];
  const before = await beforeFrames(beforeKey);
  const unitFor = (key) =>
    key.startsWith('fx_sig')
      ? boss
      : key.startsWith('fx_proj') || key === 'fx_bolt_seg'
        ? null
        : target;
  if (before)
    rows.push({
      label: `BEFORE ${beforeKey} · ${grounds[0].label}`,
      cells: before.map((f) => cell(grounds[0], unitFor(keys[0]), drawBefore(f))),
    });
  keys.forEach((key, n) => {
    const r = byKey[key];
    const which = n === 0 ? grounds : [grounds[0], grounds[2]];
    for (const g of which)
      rows.push({
        label: `${key} · ${g.label}`,
        cells: r.frames.map((_, i) => cell(g, unitFor(key), drawAfter(key, i))),
      });
  });
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const W = LW + cols * (w * K + 4);
  const H = rows.length * (h * K + 30);
  const comps = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const y = ri * (h * K + 30);
    comps.push({ input: await labelSvg(W, 26, rows[ri].label, 15), left: 0, top: y });
    for (let ci = 0; ci < rows[ri].cells.length; ci++)
      comps.push({
        input: await toPng(rows[ri].cells[ci], w, h, K),
        left: LW + ci * (w * K + 4),
        top: y + 28,
      });
  }
  const side = await labelSvg(LW - 8, 60, name.toUpperCase(), 22);
  comps.push({ input: side, left: 0, top: 30 });
  await sharp({ create: { width: W, height: H, channels: 4, background: '#0e0c14' } })
    .composite(comps)
    .webp({ lossless: true, effort: 5 })
    .toFile(join(OUT, 'sheets', `${name}_3x.webp`));
}

async function familyAnim(name, keys, beforeKey) {
  const K = 3;
  const [w, h] = VIEW;
  const key = keys[0];
  const r = byKey[key];
  const before = await beforeFrames(beforeKey);
  const afterMs = r.def.durations.reduce((a, b) => a + b, 0);
  const beforeMs = before ? before.length * 62.5 : 0;
  const total = Math.max(afterMs, beforeMs) + 360; // a beat of rest before the loop
  const step = 20;
  const frames = [];
  const delays = [];
  const unit = key.startsWith('fx_sig') ? boss : key.startsWith('fx_proj') ? null : target;
  const at = (durations, t) => {
    let acc = 0;
    for (let i = 0; i < durations.length; i++) {
      acc += durations[i];
      if (t < acc) return i;
    }
    return -1;
  };
  let last = null;
  for (let t = 0; t < total; t += step) {
    const ai = at(r.def.durations, t);
    const bi = before ? (t < beforeMs ? Math.floor(t / 62.5) : -1) : -2;
    const sig = `${ai}|${bi}`;
    if (sig === last) {
      delays[delays.length - 1] += step;
      continue;
    }
    last = sig;
    const after = cell(grounds[0], unit, ai >= 0 ? drawAfter(key, ai) : () => {});
    const panels = [];
    if (bi !== -2) panels.push(cell(grounds[0], unit, bi >= 0 ? drawBefore(before[bi]) : () => {}));
    panels.push(after);
    const W = panels.length * w + (panels.length - 1) * 2;
    const img = new Uint8ClampedArray(W * h * 4).fill(14);
    panels.forEach((p, n) => {
      for (let y = 0; y < h; y++)
        img.set(p.subarray(y * w * 4, (y + 1) * w * 4), (y * W + n * (w + 2)) * 4);
    });
    frames.push(await toPng(img, W, h, K));
    delays.push(step);
  }
  const make = (fmt) =>
    sharp(frames, { join: { animated: true } })
      [fmt]({
        loop: 0,
        delay: delays,
        ...(fmt === 'webp' ? { lossless: true, effort: 4 } : { effort: 7 }),
      })
      .toFile(join(OUT, 'anim', `${name}.${fmt}`));
  await make('webp');
  if (args.includes('--gif')) await make('gif');
}

async function overview() {
  const [w, h] = VIEW;
  const list = rendered.filter((r) => r.def.role !== 'mote');
  for (const [gi, suffix] of [
    [0, ''],
    [2, '_night'],
  ]) {
    const cols = Math.max(...list.map((r) => r.frames.length));
    const LW = 150;
    const W = LW + cols * (w + 2);
    const H = list.length * (h + 2);
    const comps = [];
    for (let ri = 0; ri < list.length; ri++) {
      const r = list[ri];
      comps.push({ input: await labelSvg(LW - 4, h, r.def.key, 11), left: 0, top: ri * (h + 2) });
      const unit = r.def.key.startsWith('fx_sig')
        ? boss
        : r.def.role === 'projectile' || r.def.role === 'segment'
          ? null
          : target;
      for (let i = 0; i < r.frames.length; i++)
        comps.push({
          input: await toPng(cell(grounds[gi], unit, drawAfter(r.def.key, i)), w, h, 1),
          left: LW + i * (w + 2),
          top: ri * (h + 2),
        });
    }
    await sharp({ create: { width: W, height: H, channels: 4, background: '#0e0c14' } })
      .composite(comps)
      .webp({ lossless: true, effort: 5 })
      .toFile(join(OUT, `overview_1x${suffix}.webp`));
  }
}

for (const [name, keys, beforeKey] of FAMILIES) {
  if (only && !only.includes(name)) continue;
  await familySheet(name, keys, beforeKey);
  await familyAnim(name, keys, beforeKey);
  console.log('review', name);
}
if (!only || only.includes('overview')) {
  await overview();
  console.log('review overview');
}
