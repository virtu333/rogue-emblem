#!/usr/bin/env node
// A new class's map-sprite review sheet (the source the tracer reads), in the format of
// docs/art/class-sprite-review-2026-09-22/sheets/: three figures in one row — LEFT
// player A (a man), CENTER player B (a woman), RIGHT the enemy — on a transparent ground.
// That set was drawn with a chat image tool; a class added later is drawn here with the
// shared Gemini client, from the owner's on-map style board and two reviewed sheets of
// neighbouring classes (pixel scale and rendering), then keyed from magenta to alpha.
//
//   node tools/art/sprite-trace/gen-class-sheet.mjs --class Soldier [--takes 3] [--model pro]
//   node tools/art/sprite-trace/gen-class-sheet.mjs --class Soldier --choose 2
//
// Raw takes and keyed takes go to References/class-sheets/ (gitignored); --choose copies a
// keyed take to docs/art/class-sprite-review-2026-09-22/sheets/<id>.png and records its
// prompt in that folder's catalog.json. Nothing here ships: the tracer bakes the atlas.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateAll, MODELS } from '../gen/geminiImage.mjs';
import { keyMagenta } from './gen-refs.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const REVIEW = 'docs/art/class-sprite-review-2026-09-22';
const WORK = 'References/class-sheets';
const STYLE = 'docs/art/sprite-candidates-2026-09-22/reference.png';

/** Per-class brief: design text, move type, weapons and two neighbouring reviewed sheets. */
export const CLASS_SHEETS = {
  Soldier: {
    id: 'soldier',
    tier: 'base',
    move: 'Infantry',
    weapon: 'Lances (P)',
    refs: ['knight', 'mercenary'],
    design:
      'A levy FOOT SOLDIER: a padded gambeson under a simple kettle helmet or open iron cap, a short mail shirt, ' +
      'leather belt and pouches, plain boots, a round wooden shield on the arm and a long SPEAR held upright. ' +
      'Lighter than a knight (no plate, no cape), sturdier than a sellsword. NO sword. Player: blue padded ' +
      'coat; the helmet leaves the face and hair visible. Enemy: the imperial levy in crimson, face half ' +
      'hidden by the cap brim.',
  },
};

function promptFor(name, c) {
  return [
    `Generate a ${name.toUpperCase()} tactical MAP SPRITE review sheet. Exactly THREE isolated sprites in one`,
    'horizontal row, each centered in its own equal-width cell: LEFT Player A, CENTER Player B, RIGHT Enemy.',
    'Players are two distinct adult recruit appearances (different hair/face, one male and one female,',
    'equally practical gear), strong BLUE accents. Enemy uses CRIMSON accents.',
    "Image 1 is style: copy its SMALL on-map sprites' detailed late-16-bit craftsmanship, controlled dark",
    'contours, mature compact 4-head proportions and purposeful pixel clusters. Images 2 and 3 are review',
    'sheets of neighbouring classes from the same set: match their pixel scale, figure size, rendering, cell',
    "layout and three-quarter pose exactly, but draw this class's own costume and weapon.",
    'Full body with all equipment visible, three-quarter idle view slightly from above facing right. Common',
    'foot baseline and equal gameplay scale. Generous padding between cells; no overlap. Not smooth',
    'illustration, 3D render, giant battle portrait or tiny generic icon. Faction cloth keeps clear BLUE or RED',
    'accents, natural skin and hair. Intended final size about 34px infantry or 40px mounted; a big readable',
    'silhouette, no tiny ornamental noise.',
    'BACKGROUND: perfectly flat solid pure magenta (#FF00FF) filling the whole canvas: no floor, shadow,',
    'gradient, glow, text, label, ring or frame. Do not use magenta or pink anywhere on the figures.',
    `Class ${name}, tier ${c.tier}, movement ${c.move}, engine weapons ${c.weapon}. Specific design: ${c.design}`,
  ].join(' ');
}

const name = flag('class');
const c = CLASS_SHEETS[name];
if (process.argv[1]?.endsWith('gen-class-sheet.mjs')) {
  if (!c) throw new Error(`--class must be one of ${Object.keys(CLASS_SHEETS).join(', ')}`);
  mkdirSync(`${WORK}/raw`, { recursive: true });
  mkdirSync(`${WORK}/takes`, { recursive: true });
  const choose = flag('choose');
  if (choose) {
    const take = `${WORK}/takes/${c.id}-${choose}.png`;
    if (!existsSync(take)) throw new Error(`no take ${take}`);
    copyFileSync(take, `${REVIEW}/sheets/${c.id}.png`);
    const catalogFile = `${REVIEW}/catalog.json`;
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
    const entry = {
      name,
      tier: c.tier,
      weapon: c.weapon,
      move: c.move,
      id: c.id,
      count: 3,
      prompt: promptFor(name, c),
      refs: [STYLE, ...c.refs.map((r) => `${REVIEW}/sheets/${r}.png`)],
      generator: 'tools/art/sprite-trace/gen-class-sheet.mjs',
      take: Number(choose),
    };
    const i = catalog.findIndex((e) => e.name === name);
    if (i >= 0) catalog[i] = entry;
    else catalog.push(entry);
    writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`chose ${take} -> ${REVIEW}/sheets/${c.id}.png`);
  } else {
    const takes = Number(flag('takes', 3));
    const model = MODELS[flag('model', 'pro')] || MODELS.pro;
    const jobs = Array.from({ length: takes }, (_, k) => ({
      name: `${c.id}#${k + 1}`,
      prompt: `${promptFor(name, c)}${k ? ` Alternative take ${k + 1}.` : ''}`,
      refs: [STYLE, ...c.refs.map((r) => `${REVIEW}/sheets/${r}.png`)],
      aspectRatio: '21:9',
      imageSize: '2K',
      model,
      out: `${WORK}/raw/${c.id}-${k + 1}`,
    }));
    const results = await generateAll(jobs, { concurrency: 2 });
    for (const [k, r] of results.entries()) {
      const file = r?.files?.[0];
      if (!file) {
        console.log(`take ${k + 1}: failed ${r?.error || ''}`);
        continue;
      }
      await keyMagenta(file, `${WORK}/takes/${c.id}-${k + 1}.png`);
      console.log(`take ${k + 1}: ${WORK}/takes/${c.id}-${k + 1}.png`);
    }
  }
}
