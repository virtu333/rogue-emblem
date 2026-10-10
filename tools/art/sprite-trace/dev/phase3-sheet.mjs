// Review sheet for the Phase 3 art batch (docs/art-direction/phase3/): the enemy-only
// Necromancer and Skeleton as map sprites, every pose the game plays, at display size on the
// dusk and night grades, then the three portraits.
//
//   node tools/art/sprite-trace/dev/phase3-sheet.mjs OUT.webp [--keys enemy_necromancer,enemy_skeleton]
//
// Poses: idle0, idle2 (the idle loop's extremes), windup and strike are the baked frames;
// dodge and death are not baked: the game plays them on idle0 (CombatFxController.dodge is a
// perpendicular side-step that leaves a 50 % afterimage; deathFade is the pixel dissolve of
// src/art/combatFx/deathDissolve.js, shown here half way), so they are drawn here the same way.
//
// Scale: a 96 px texture is shown at 64 world px, which is 2 texture px per device px at
// DPR 3 (the phone's real rendering), so every tile here is 2x nearest over terrain painted by
// the game's own procedural terrain at the same lattice.
//
// Grades: an approximation of AtmosphereFX (src/art/atmosphereConfig.js `gradeToUniforms`
// split-tone, saturation, contrast, exposure) with the vignette left out; night is Ashfall
// plus BattleLightLayer's darkness over ash (enemies carry no light of their own).
import { writeWebp, textRaster, readRaster } from '../lib/io.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { swatch } from '../lib/terrain.mjs';
import { bakeFrames, allEntries } from '../lib/pipeline.mjs';
import { ATMOSPHERE_GRADES } from '../../../../src/art/atmosphereConfig.js';
import { buildDissolve, paintDissolve } from '../../../../src/art/combatFx/deathDissolve.js';
import { DEATH_STYLES } from '../../../../src/art/combatFx/fxFamilies.js';

const args = process.argv.slice(2);
const out = args[0];
const keysArg = args.includes('--keys') ? args[args.indexOf('--keys') + 1].split(',') : null;
const KEYS = keysArg || ['enemy_necromancer', 'enemy_skeleton'];
const Z = 2;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const clamp = (v) => Math.max(0, Math.min(255, v));

/** Split-tone grade (+ optional night darkness) over an RGBA raster. */
function grade(img, g, { darkness = 0, tint = [40, 40, 90] } = {}) {
  const sh = hex(g.shadow);
  const hi = hex(g.highlight);
  const split = (g.split ?? 0.5) * 0.35;
  return img.map(([r, gg, b, a]) => {
    if (!a) return [r, gg, b, a];
    let c = [r, gg, b].map((v) => v * g.exposure);
    const l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    c = c.map((v) => l * 255 + (v - l * 255) * g.sat);
    c = c.map((v) => (v - 128) * g.contrast + 128);
    c = c.map((v, i) => v + (sh[i] - 128) * split * (1 - l) + (hi[i] - 128) * split * l);
    if (darkness) c = c.map((v, i) => v * (1 - darkness) + tint[i] * darkness * 0.6);
    return [...c.map(clamp), a];
  });
}

const dusk = ATMOSPHERE_GRADES.act1;
const night = ATMOSPHERE_GRADES.act4;
const GROUNDS = {
  dusk: { ground: swatch('grass'), grade: (im) => grade(im, dusk) },
  night: { ground: swatch('lava'), grade: (im) => grade(im, night, { darkness: 0.55 }) },
};

const bg = (img, ground) => ground.clone().draw(img, 0, 0);

function shifted(img, dx, dy, alpha = 1) {
  const r = new Raster(img.w, img.h);
  return r.draw(img, dx, dy, alpha);
}

const edge = DEATH_STYLES.enemy?.edge ?? 0xec7a5c;
function dissolved(img, progress, seed) {
  const d = buildDissolve(img.d, img.w, img.h, { block: 3, seed });
  const o = new Raster(img.w, img.h);
  paintDissolve(d, img.d, o.d, progress, edge);
  return o;
}

const ENTRIES = allEntries();
const POSES = ['idle0', 'idle2', 'windup', 'strike', 'dodge', 'death'];

async function poseTiles(key) {
  const e = ENTRIES.find((x) => x.key === key);
  if (!e) throw new Error(`no bake entry ${key}`);
  const f = await bakeFrames(e);
  const frames = {
    idle0: f.idle[0],
    idle2: f.idle[2],
    windup: f.attack[0],
    strike: f.attack[1],
    // CombatFxController.dodge: a perpendicular side-step (DODGE_PX world px) + afterimage
    dodge: shifted(f.idle[0], 0, 0, 0.5).draw(shifted(f.idle[0], 5, 0), 0, 0),
    death: dissolved(f.idle[0], 0.5, key.length * 7 + 3),
  };
  return frames;
}

const rows = [];
const header = await textRaster(
  [
    'Phase 3 art: Necromancer and Skeleton map sprites, 2x (DPR 3), poses left to right: ',
    POSES.join(', '),
  ].join(''),
  { size: 13, bg: '#16131e', width: POSES.length * 96 * Z + (POSES.length - 1) * 4 },
);
rows.push(header);
for (const key of KEYS) {
  const frames = await poseTiles(key);
  for (const [mood, { ground, grade: gr }] of Object.entries(GROUNDS)) {
    const tiles = POSES.map((p) => gr(bg(frames[p], ground)).scale(Z));
    const label = await textRaster(
      `${key}   ${mood === 'dusk' ? `dusk (${dusk.label})` : `night (${night.label} + darkness)`}`,
      { size: 12, bg: '#16131e', width: tiles.length * 96 * Z + (tiles.length - 1) * 4 },
    );
    rows.push(vstack([label, hstack(tiles, 4, [20, 20, 24, 255])]));
  }
  // the corrupted (affixed) enemy on night ground
  const ck = `${key}-corrupt`;
  const cf = await poseTiles(ck);
  const tiles = POSES.map((p) => GROUNDS.night.grade(bg(cf[p], GROUNDS.night.ground)).scale(Z));
  const label = await textRaster(`${ck}   night`, {
    size: 12,
    bg: '#16131e',
    width: tiles.length * 96 * Z + (tiles.length - 1) * 4,
  });
  rows.push(vstack([label, hstack(tiles, 4, [20, 20, 24, 255])]));
}

// Readability against the shipped enemies: idle0 of each on both grades, then a close-up
// (6x, flat ground) of the new sprites' idle0, windup and strike, plain and corrupted.
const COMPARE = [
  'enemy_necromancer',
  'enemy_skeleton',
  'enemy_zombie',
  'enemy_revenant',
  'enemy_mage',
  'enemy_warlock',
  'enemy_dark_knight',
  'enemy_soldier',
];
{
  const idle0 = {};
  for (const k of COMPARE) idle0[k] = (await bakeFrames(ENTRIES.find((x) => x.key === k))).idle[0];
  for (const [mood, { ground, grade: gr }] of Object.entries(GROUNDS)) {
    const tiles = COMPARE.map((k) => gr(bg(idle0[k], ground)).scale(Z));
    const label = await textRaster(
      `${mood}: the new sprites beside shipped enemies (${COMPARE.map((k) => k.replace('enemy_', '')).join(', ')})`,
      { size: 12, bg: '#16131e', width: COMPARE.length * 96 * Z },
    );
    rows.push(vstack([label, hstack(tiles, 0, [20, 20, 24, 255])]));
  }
  const close = [];
  for (const key of KEYS.flatMap((k) => [k, `${k}-corrupt`])) {
    const f = await bakeFrames(ENTRIES.find((x) => x.key === key));
    for (const fr of [f.idle[0], f.attack[0], f.attack[1]]) {
      const b = fr.alphaBounds(0);
      close.push(
        new Raster(60, 64)
          .fillRect(0, 0, 60, 64, [74, 80, 66, 255])
          .draw(fr.crop(b.x - 4, b.y - 2, 60, 64), 0, 0)
          .scale(5),
      );
    }
  }
  const per = 6;
  const labelClose = await textRaster(
    'close-up 5x: idle0, windup, strike (necromancer, necromancer-corrupt, skeleton, skeleton-corrupt)',
    {
      size: 12,
      bg: '#16131e',
      width: per * 300,
    },
  );
  rows.push(labelClose);
  for (let i = 0; i < close.length; i += per)
    rows.push(hstack(close.slice(i, i + per), 0, [20, 20, 24, 255]));
}

// Portraits: the baked 192 (boss / cut-in size), then the 64 and 40 px figures on their plates
const P = 'assets/portraits/pc98';
const ids = [
  'generic_merchant',
  'enemy_necromancer',
  'enemy_skeleton',
  'enemy_zombie',
  'enemy_revenant',
];
const cells = [];
for (const id of ids) {
  const big = await readRaster(`${P}/baked/${id}.png`);
  const small = await readRaster(`${P}/64/${id}.png`);
  const tiny = await readRaster(`${P}/40/${id}.png`);
  const plate = (img, size) => {
    const fac = id === 'generic_merchant' ? 'verdigris' : 'unlight';
    return readRaster(`${P}/plates/${fac}-${size}.png`).then((pl) => pl.clone().draw(img, 0, 0));
  };
  const s64 = (await plate(small, 64)).scale(2);
  const s40 = (await plate(tiny, 40)).scale(2);
  const label = await textRaster(id, { size: 12, bg: '#16131e', width: 192 + 8 + 128 });
  cells.push(
    vstack([label, hstack([big, vstack([s64, s40], 4, [20, 20, 24, 255])], 8, [20, 20, 24, 255])]),
  );
}
rows.push(
  await textRaster(
    'Portraits: baked 192, then 64 and 40 px at 2x (plates: verdigris NPC, unlight enemy; Zombie and Revenant for comparison)',
    {
      size: 13,
      bg: '#16131e',
      width: POSES.length * 96 * Z + (POSES.length - 1) * 4,
    },
  ),
);
rows.push(hstack(cells, 8, [20, 20, 24, 255]));

const sheet = vstack(rows, 8, [20, 20, 24, 255]);
await writeWebp(sheet, out);
console.log(`${out} ${sheet.w}x${sheet.h}`);
