#!/usr/bin/env node
// A class added after the legacy portrait set has no 128 px base portraits
// (assets/portraits/generic_<class>.png, enemy_<class>.png). The PC-98 build treats those
// files as a class's default ids, and plan.mjs remasters them (the line's first person
// and the enemy's face a), so a new class gets a pair drawn here in the legacy style from
// two legacy portraits and the class's reviewed map-sprite sheet (its costume).
//
//   node tools/art/portrait-variants/gen-legacy-base.mjs --class Soldier [--takes 2]
//   node tools/art/portrait-variants/gen-legacy-base.mjs --class Soldier --choose player:1,enemy:2
//
// Raw takes go to References/portrait-variants/legacy-base/ (gitignored); --choose writes
// the 128 px portraits into assets/portraits/ and records the prompts in legacy-base.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateAll, MODELS } from '../gen/geminiImage.mjs';
import { LINES, PLAYER_CLASSES } from './catalog.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const WORK = 'References/portrait-variants/legacy-base';
const RECORD = 'tools/art/portrait-variants/legacy-base.json';
const slug = (n) => String(n).toLowerCase().replace(/ /g, '_');

const STYLE =
  'A 128 by 128 pixel art character portrait for a dark-fantasy tactics RPG, drawn exactly in the style of the first ' +
  'two reference images (the same game): crisp square pixels, a dark outline, three-tone cel shading lit from the ' +
  'upper left, a head-and-shoulders bust in three-quarter view facing right, the shoulders filling the bottom edge, ' +
  'on a flat dark navy (#1b1d33) background. One character, no text, no frame, no glow.';

function jobsFor(className) {
  const line = Object.values(LINES).find((l) => l.classes[0] === className);
  if (!line) throw new Error(`no portrait line starts with ${className}`);
  const first = Object.values(line.people)[0];
  const costume = PLAYER_CLASSES[className];
  const sheet = `docs/art/class-sprite-review-2026-09-22/sheets/${slug(className)}.png`;
  return {
    player: {
      prompt: `${STYLE} The character: a ${className}, ${first.look}. Outfit: ${costume}. The third reference image is the class's map sprite: follow its costume (left figure), in blue.`,
      refs: [
        'assets/portraits/generic_mercenary.png',
        'assets/portraits/generic_cavalier.png',
        sheet,
      ],
    },
    enemy: {
      prompt: `${STYLE} The character: an enemy ${className} of the Empire, an ordinary grim levy soldier (not a monster, no glowing eyes), face half shadowed by the helmet brim. Outfit: ${costume}, recoloured for the Empire's army: iron grey and crimson cloth. The third reference image is the class's map sprite: follow the enemy's costume (right figure).`,
      refs: ['assets/portraits/enemy_fighter.png', 'assets/portraits/enemy_mercenary.png', sheet],
    },
  };
}

const className = flag('class');
if (!className) throw new Error('--class is required');
const s = slug(className);
const jobs = jobsFor(className);
mkdirSync(WORK, { recursive: true });
const choose = flag('choose');
if (choose) {
  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
  for (const pick of choose.split(',')) {
    const [side, take] = pick.split(':');
    const raw = ['png', 'jpg'].map((e) => `${WORK}/${s}-${side}-${take}.${e}`).find(existsSync);
    if (!raw) throw new Error(`no take ${side}:${take}`);
    const id = side === 'enemy' ? `enemy_${s}` : `generic_${s}`;
    // The model paints on a ~1024 px canvas; the legacy set is 128 px pixel art.
    await sharp(raw)
      .resize(128, 128, { kernel: 'lanczos3' })
      .png()
      .toFile(`assets/portraits/${id}.png`);
    record[id] = { ...jobs[side], take: Number(take), generator: 'gen-legacy-base.mjs' };
    console.log(`${raw} -> assets/portraits/${id}.png`);
  }
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
} else {
  const takes = Number(flag('takes', 2));
  const list = [];
  for (const side of ['player', 'enemy'])
    for (let t = 1; t <= takes; t++)
      list.push({
        name: `${s}-${side}-${t}`,
        prompt: t > 1 ? `${jobs[side].prompt} Alternative take ${t}.` : jobs[side].prompt,
        refs: jobs[side].refs,
        aspectRatio: '1:1',
        imageSize: '1K',
        model: MODELS[flag('model', 'pro')] || MODELS.pro,
        out: `${WORK}/${s}-${side}-${t}`,
      });
  const results = await generateAll(list, { concurrency: 2 });
  results.forEach((r, i) => console.log(list[i].name, r?.files?.[0] || r?.error));
}
