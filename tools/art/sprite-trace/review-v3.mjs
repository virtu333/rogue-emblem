#!/usr/bin/env node
// Full-roster review sheets for docs/art-direction/sprites-v3 (offline, deterministic):
//   node tools/art/sprite-trace/review-v3.mjs [--out docs/art-direction/sprites-v3] [--only a,b]
//        [--classes a,b] [--zoom 2]
// sections:
//   roster   every generic class: six seeded people, enemy, corrupted, NPC (on grass)
//   extra    enemy-only creatures, lords (base / promoted), named bosses, the Entity
//   sources  lord candidates: class sheet vs rebuilt, with the choice marked
//   outliers the sprites listed in the README as "regenerate later" (source | traced)
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeWebp, writeGif, textRaster } from './lib/io.mjs';
import { Raster, hstack, vstack } from './lib/raster.mjs';
import { bakeFrames, allEntries, identities, traceId, loadNative } from './lib/pipeline.mjs';
import { swatch } from './lib/terrain.mjs';
import { render } from './lib/render.mjs';
import { paletteFor } from './lib/treat.mjs';
import { GENERIC_CLASSES, ENEMY_ONLY_CLASSES, LORDS, BOSSES } from './roster.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = flag('out', 'docs/art-direction/sprites-v3');
const only = flag('only', null)?.split(',');
const want = (s) => !only || only.includes(s);
const classFilter = flag('classes', null)?.split(',');
const Z = +flag('zoom', 2);
mkdirSync(OUT, { recursive: true });

const INK = [20, 20, 24, 255];
const PAPER = '#ddd0bd';
const label = (t, width, size = 11) => textRaster(t, { size, bg: '#16131e', color: PAPER, width });
const ALL = allEntries();
const entry = (k) => ALL.find((e) => e.key === k);
const grass = swatch('grass');
const ground = (img) => {
  if (img.w === grass.w && img.h === grass.h) return grass.clone().draw(img, 0, 0);
  const bg = new Raster(img.w, img.h);
  for (let y = 0; y < img.h; y += grass.h)
    for (let x = 0; x < img.w; x += grass.w) bg.draw(grass, x, y);
  return bg.draw(img, 0, 0);
};
// the sprite area of a 96 px cell (drop the empty rows under the feet)
const cellCrop = (img) => (img.w === 96 ? img.crop(0, 8, 96, 64) : img);
const still = async (k, zoom = Z) =>
  cellCrop(ground((await bakeFrames(entry(k))).still)).scale(zoom);

if (want('roster')) {
  const ids = identities();
  const heads = [
    '',
    ...ids.map((id, i) => `#${i} ${id.design ? 'B' : 'A'}`),
    'enemy',
    'corrupted',
    'NPC',
  ];
  const cw = 96 * Z;
  const classes = GENERIC_CLASSES.map(([c]) => c).filter(
    (c) => !classFilter || classFilter.includes(c),
  );
  // two sheets so each stays a readable size
  const half = Math.ceil(classes.length / 2);
  for (const [part, list] of [
    ['a', classes.slice(0, half)],
    ['b', classes.slice(half)],
  ]) {
    if (!list.length) continue;
    const rows = [hstack(await Promise.all(heads.map((h, i) => label(h, i ? cw : 130))), 4, INK)];
    for (const cls of list) {
      const keys = [
        ...ids.map((_, i) => `${cls}-${i}`),
        `enemy_${cls}`,
        `enemy_${cls}-corrupt`,
        `npc_${cls}`,
      ];
      const cells = [await label(cls, 130)];
      for (const k of keys) cells.push(await still(k));
      rows.push(hstack(cells, 4, INK));
    }
    await writeWebp(vstack(rows, 4, INK), `${OUT}/roster_${part}.webp`);
  }
  console.log('roster');
}

if (want('extra')) {
  const rows = [];
  const row = async (title, keys, zoom = Z) => {
    const cells = [await label(title, 130)];
    for (const k of keys) {
      const img = await still(k, zoom);
      cells.push(vstack([img, await label(k.replace(/^(lord|boss|enemy)_/, ''), img.w, 10)]));
    }
    rows.push(hstack(cells, 4, INK));
  };
  const enemyOnly = ENEMY_ONLY_CLASSES.map(([c]) => c);
  await row('enemy-only', [
    ...enemyOnly.map((c) => `enemy_${c}`),
    ...enemyOnly.map((c) => `enemy_${c}-corrupt`),
  ]);
  await row(
    'lords',
    LORDS.map(([n]) => `lord_${n}`),
  );
  await row(
    'promoted',
    LORDS.map(([n]) => `lord_${n}_promoted`),
  );
  const bossKeys = Object.keys(BOSSES).filter((k) => BOSSES[k] !== 'entity');
  await row('bosses', bossKeys.slice(0, 5));
  await row('', bossKeys.slice(5));
  rows.push(
    hstack(
      [
        await label('Entity (3x3)', 130),
        cellCrop(ground((await bakeFrames(entry('boss_the_entity'))).still)).scale(Z),
      ],
      4,
      INK,
    ),
  );
  await writeWebp(vstack(rows, 4, INK), `${OUT}/roster_lords_bosses.webp`);
  console.log('extra');
}

if (want('sources')) {
  // lord candidates: the class-sheet figure against the rebuilt art, both traced
  const pairs = [
    ['Edric+', 'edric_promoted_s', 'edric_promoted'],
    ['Sera+', 'sera_promoted_s', 'sera_promoted'],
    ['Kira', 'kira_s', 'kira'],
    ['Kira+', 'kira_promoted_s', 'kira_promoted'],
    ['Rowan', 'rowan_s', 'rowan'],
    ['Rowan+', 'rowan_promoted_s', 'rowan_promoted'],
    ['Astrid', 'astrid_s', 'astrid'],
    ['Astrid+', 'astrid_promoted_s', 'astrid_promoted'],
  ];
  const chosen = new Set(LORDS.flatMap(([, b, p]) => [b, p]));
  const rows = [
    hstack(
      await Promise.all(['', 'class sheet', 'rebuilt'].map((h, i) => label(h, i ? 288 : 90))),
      4,
      INK,
    ),
  ];
  for (const [name, a, b] of pairs) {
    const cells = [await label(name, 90)];
    for (const id of [a, b]) {
      const t = await traceId(id);
      const img = cellCrop(
        ground(render(t.sprite, paletteFor(t, { faction: 'player', keepMain: true }))),
      );
      cells.push(
        vstack([img.scale(3), await label(`${id}${chosen.has(id) ? '  (chosen)' : ''}`, 288, 10)]),
      );
    }
    rows.push(hstack(cells, 4, INK));
  }
  await writeWebp(vstack(rows, 4, INK), `${OUT}/lord_sources.webp`);
  console.log('sources');
}

if (want('motion')) {
  // every class line's first person (and the lords, bosses, creatures): the six frames
  const keys = flag('keys', null)?.split(',') || [
    ...GENERIC_CLASSES.map(([c]) => `${c}-0`),
    ...ENEMY_ONLY_CLASSES.map(([c]) => `enemy_${c}`),
    ...LORDS.flatMap(([n]) => [`lord_${n}`, `lord_${n}_promoted`]),
    ...Object.keys(BOSSES).filter((k) => BOSSES[k] !== 'entity'),
  ];
  const heads = ['', 'idle0', 'idle1', 'idle2', 'idle3', 'windup', 'strike'];
  const cw = 96 * Z;
  const sheets = [];
  const per = 30;
  for (let i = 0; i < keys.length; i += per) sheets.push(keys.slice(i, i + per));
  for (const [n, list] of sheets.entries()) {
    const rows = [hstack(await Promise.all(heads.map((h, i) => label(h, i ? cw : 170))), 4, INK)];
    for (const k of list) {
      const f = await bakeFrames(entry(k));
      const cells = [await label(`${k}\n${f.pose}`, 170)];
      for (const img of [...f.idle, ...f.attack]) cells.push(cellCrop(ground(img)).scale(Z));
      rows.push(hstack(cells, 4, INK));
    }
    await writeWebp(vstack(rows, 4, INK), `${OUT}/motion_${n + 1}.webp`);
  }
  // animated previews for a few, at 4x: idle loop then the attack
  mkdirSync(`${OUT}/anim`, { recursive: true });
  const gifKeys = flag('gifs', null)?.split(',') || [
    'myrmidon-0',
    'knight-1',
    'fighter-0',
    'archer-0',
    'mage-1',
    'cleric-0',
    'cavalier-0',
    'pegasus_knight-1',
    'wyvern_lord-0',
    'lord_edric',
    'lord_astrid_promoted',
    'enemy_berserker',
    'enemy_dragon',
    'boss_the_emperor',
  ];
  for (const k of gifKeys) {
    const f = await bakeFrames(entry(k));
    const idle = f.idle.map((img) => cellCrop(ground(img)).scale(4));
    const attack = f.attack.map((img) => cellCrop(ground(img)).scale(4));
    const seq = [...idle, ...idle, idle[0], attack[0], attack[1], attack[1], idle[0]];
    const delays = [...Array(8).fill(260), 260, 320, 180, 260, 400];
    await writeGif(`${OUT}/anim/${k}.gif`, seq, delays);
  }
  console.log('motion');
}

if (want('silhouettes')) {
  // the unlabeled class test: every class's first person as a flat silhouette at map
  // scale (2x), shuffled with a fixed seed; the answer key is written beside it
  const classes = [...GENERIC_CLASSES.map(([c]) => c), ...ENEMY_ONLY_CLASSES.map(([c]) => c)];
  const keys = classes.map((c) => (ALL.find((e) => e.key === `${c}-0`) ? `${c}-0` : `enemy_${c}`));
  // deterministic shuffle (LCG)
  let seed = 20260924;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const order = keys.map((k, i) => [rnd(), k, i]).sort((a, b) => a[0] - b[0]);
  const cells = [];
  const answers = [];
  for (const [n, [, k]] of order.entries()) {
    const f = await bakeFrames(entry(k));
    const flat = f.still.map(([, , , al]) => (al ? [16, 14, 20, 255] : [200, 196, 186, 255]));
    cells.push(vstack([cellCrop(flat).scale(2), await label(`${n + 1}`, 192, 12)]));
    answers.push(`${String(n + 1).padStart(2)}  ${k.replace(/-0$/, '').replace(/^enemy_/, '')}`);
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += 8) rows.push(hstack(cells.slice(i, i + 8), 4, INK));
  await writeWebp(vstack(rows, 4, INK), `${OUT}/silhouette_test.webp`);
  writeFileSync(`${OUT}/silhouette_test_key.txt`, `${answers.join('\n')}\n`);
  console.log('silhouettes');
}

/** Sprites still short of the bar (README table): source figure | traced at 3x. */
export const OUTLIERS = flag('outliers', '').split(',').filter(Boolean);
if (want('outliers') && OUTLIERS.length) {
  const rows = [];
  for (const id of OUTLIERS) {
    const n = await loadNative(id);
    const t = await traceId(id);
    const src = n.native;
    const scale = Math.max(1, Math.floor(192 / Math.max(src.w, src.h)));
    const img = cellCrop(
      ground(render(t.sprite, paletteFor(t, { faction: 'player', keepMain: true }))),
    );
    rows.push(
      hstack(
        [
          await label(`${id}\nscale ${t.sprite.meta.scale.toFixed(2)}`, 150),
          ground(src.scale(scale)),
          img.scale(3),
        ],
        4,
        INK,
      ),
    );
  }
  await writeWebp(vstack(rows, 4, INK), `${OUT}/outliers.webp`);
  console.log('outliers');
}
