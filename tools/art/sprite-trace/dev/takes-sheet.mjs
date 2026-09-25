// Review sheet for generated reference takes (tools/art/sprite-trace/gen-refs.mjs):
// per roster id, the current traced sprite, then each take's recovered native and its
// trace (idle0, windup, strike), all on grass at 3x.
//   node tools/art/sprite-trace/dev/takes-sheet.mjs OUT.png [--ids a,b] [--dir References/sprite-refs-2026-09-25/takes]
import { readdirSync } from 'node:fs';
import { readRaster, writePng, textRaster } from '../lib/io.mjs';
import { recoverFigure, traceNative } from '../lib/trace.mjs';
import { render } from '../lib/render.mjs';
import { paletteFor } from '../lib/treat.mjs';
import { idleFrames, attackFrames } from '../lib/motion.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { swatch } from '../lib/terrain.mjs';
import { bakeFrames, allEntries } from '../lib/pipeline.mjs';
import { ROSTER, poseFor, LORDS, BOSSES } from '../roster.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = args[0];
const dir = flag('dir', 'References/sprite-refs-2026-09-25/takes');
const Z = +flag('zoom', 3);
const files = readdirSync(dir).filter((f) => /\.png$/.test(f));
const byId = new Map();
for (const f of files) {
  const m = f.match(/^(.*)-(\d+)\.png$/);
  if (!m) continue;
  if (!byId.has(m[1])) byId.set(m[1], []);
  byId.get(m[1]).push(f);
}
const ids = flag('ids')?.split(',') || [...byId.keys()].sort();
const grass = swatch('grass');
const ground = (img) => {
  const bg = new Raster(img.w, img.h);
  for (let y = 0; y < img.h; y += grass.h) for (let x = 0; x < img.w; x += grass.w) bg.draw(grass, x, y);
  return bg.draw(img, 0, 0);
};
const ALL = allEntries();
// the runtime key currently built from a roster id (lords / bosses), for the "now" column
const runtimeKey = (id) => {
  const lord = LORDS.find(([, b, p]) => b === id || p === id || b === `${id}_s` || p === `${id}_s`);
  if (lord) return id.includes('promoted') ? `lord_${lord[0]}_promoted` : `lord_${lord[0]}`;
  const boss = Object.entries(BOSSES).find(([, s]) => s === id);
  return boss ? boss[0] : null;
};
const faction = (id) => (id.startsWith('boss_') ? 'enemy' : 'player');
const rows = [];
for (const id of ids) {
  const recipe = ROSTER.sources[id] || ROSTER.sources[id.replace(/_g$/, '')];
  if (!recipe) continue;
  const cells = [];
  const key = runtimeKey(id.replace(/_g$/, ''));
  const now = key && ALL.find((e) => e.key === key);
  if (now) cells.push(ground((await bakeFrames(now)).still).scale(Z));
  for (const f of byId.get(id.replace(/_g$/, '')) || []) {
    const src = await readRaster(`${dir}/${f}`);
    const { native } = recoverFigure(src.crop(...Object.values(src.alphaBounds(64))));
    const t = traceNative(native, { ...recipe, src: undefined }, { density: 1.5 });
    const pal = paletteFor(t, { faction: faction(id), keepMain: true });
    const idle = idleFrames(t.sprite).map((s) => render(s, pal));
    const atk = attackFrames(t.sprite, { weapon: poseFor(id), hint: recipe.weaponAt }).map((s) =>
      render(s, pal),
    );
    const nat = native.scale(Math.max(1, Math.floor((96 * Z) / Math.max(native.w, native.h))));
    const label = await textRaster(`${f} s=${t.sprite.meta.scale.toFixed(2)}`, {
      size: 11,
      bg: '#16131e',
      width: 96 * Z,
    });
    cells.push(vstack([ground(nat), label]));
    cells.push(ground(idle[0]).scale(Z));
    if (!args.includes('--still')) cells.push(ground(atk[0]).scale(Z), ground(atk[1]).scale(Z));
  }
  const title = await textRaster(id, { size: 12, bg: '#16131e', width: 160 });
  rows.push(hstack([title, ...cells], 6, [22, 20, 28, 255]));
}
await writePng(vstack(rows, 6, [22, 20, 28, 255]), out);
console.log(`wrote ${out}`);
