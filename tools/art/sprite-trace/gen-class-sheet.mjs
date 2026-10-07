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
// Enemy-only creatures (Zombie, Revenant, and the Necromancer and Skeleton of Phase 3) have one
// design, so their briefs set `single: true`: ONE enemy figure on the magenta ground, the format
// of sheets/zombie.png and sheets/revenant.png (the roster entry reads the whole image).
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
  // Enemy-only, Phase 3 step 3I (docs/specs/phase3.md "The Necromancer and Skeletons", art).
  Necromancer: {
    id: 'necromancer',
    tier: 'promoted',
    move: 'Infantry',
    weapon: 'Tomes (M)',
    single: true,
    refs: ['zombie', 'mage'],
    design:
      "ONE enemy only. A gaunt robed DARK CASTER, the Empire's grave-priest: grim, menacing, funereal (not cheerful). " +
      'It is seen on dark night ground, so the robe must not sink into the dark: a deep but clearly VIOLET wool ' +
      '(plum, with visible lighter violet highlights on the shoulders, sleeves and fold edges, never near-black), a ' +
      'RAGGED, tattered hem, a crimson hood lining, and a narrow crimson tabard panel down the front of the robe, with ' +
      'a bone-white sash and bone-white cuffs. A deep pointed hood leaves the face in shadow with only a pale chin and ' +
      'a thin colourless mouth lit (a living man: NOT a skull, no bare bone), a tarnished silver clasp at the throat. ' +
      'One hand grips a thick black TOME bound in a chain, held open at chest height in front of the body; the other ' +
      'hand is raised with spread bony fingers. A compact upright hooded-column silhouette. No staff, no skeleton, no ' +
      'glowing runes, no particles, no objects on the ground.',
  },
  Skeleton: {
    id: 'skeleton',
    tier: 'base',
    move: 'Infantry',
    weapon: 'Swords (P), Lances (P), Bows (P)',
    single: true,
    refs: ['zombie', 'revenant'],
    design:
      'ONE enemy only. A walking human SKELETON that reads as clean bleached BONE, never as rotting flesh: an ivory ' +
      'and pale-grey skull with deep black eye sockets (a faint dull red point deep in each) and a cracked cranium, ' +
      'a visible spine, ribcage, pelvis, and bony arms and legs with clear joints. It holds a short rusted IRON ' +
      'SWORD in a bony hand. Only a few CRIMSON cloth rags: a tattered waist sash and one rag at a shoulder. NO ' +
      'skin, NO flesh, NO hair, NO armour plates, NO hooded cloak, NO green-grey colour (that is the Zombie). ' +
      'A loose-jointed forward shamble, lighter and more angular than the Zombie, so it is a different silhouette.',
  },
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
  if (c.single)
    return [
      `Generate a ${name.toUpperCase()} tactical MAP SPRITE review sheet. Exactly ONE isolated enemy sprite, centered`,
      'with generous padding.',
      "Image 1 is style: copy its SMALL on-map sprites' detailed late-16-bit craftsmanship, controlled dark",
      'contours, mature compact 4-head proportions and purposeful pixel clusters. Images 2 and 3 are review',
      'sheets of neighbouring creatures and classes from the same set: match their pixel scale, figure size,',
      "rendering and three-quarter pose exactly, but draw this creature's own anatomy, costume and weapon.",
      'Full body with all equipment visible, three-quarter idle view slightly from above facing right. Not smooth',
      'illustration, 3D render, giant battle portrait or tiny generic icon. Enemy uses CRIMSON accents. Intended',
      'final size about 34px infantry; a big readable silhouette, no tiny ornamental noise.',
      'BACKGROUND: perfectly flat solid pure magenta (#FF00FF) filling the whole canvas: no floor, shadow,',
      'gradient, glow, text, label, ring or frame. Do not use magenta or pink anywhere on the figure.',
      `Class ${name}, tier ${c.tier}, movement ${c.move}, engine weapons ${c.weapon}. Specific design: ${c.design}`,
    ].join(' ');
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
      count: c.single ? 1 : 3,
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
      aspectRatio: c.single ? '3:2' : '21:9',
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
