#!/usr/bin/env node
// Map-sprite references for the lord outfits (docs/specs/lord-outfits.md), in the traced
// sprites' grammar (tools/art/sprite-trace/gen-refs.mjs: the owner's on-map style board,
// a flat magenta backdrop, the figure about 56 art px tall). Image 2 is the lord's own
// shipped map sprite (its recovered pixel grid at 6x: pixel scale, build, pose, weapon and
// mount carry over); then the outfit's picked portrait for the costume. A promoted sprite
// adds the chosen base outfit sprite, so both tiers wear one design.
//
//   node tools/art/lord-outfits/sprites.mjs [--only ashen_crown,...] [--takes 3] [--from 0] [--promoted]
//        [--model pro|flash] [--concurrency 3]
//   node tools/art/lord-outfits/sprites.mjs --choose ashen_crown:1,field_marshal_promoted:2
//
// Raw generations go to References/lord-outfits/sprites/raw/ (gitignored, cached by the
// image client), keyed takes to References/lord-outfits/sprites/takes/<outfit>[_promoted]-<n>.png.
// --choose stores a take's recovered pixel grid at 6x in
// docs/art/sprite-candidates-2026-10-27/sources/<lord>[_promoted]__<outfit>.png (read by
// tools/art/sprite-trace/roster.mjs) with its provenance in prompts.json. Nothing here
// ships: `npm run bake:sprites` turns sources into the atlas.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateImage, MODELS } from '../gen/geminiImage.mjs';
import { BASE, SCALE, STYLE, keyMagenta } from '../sprite-trace/gen-refs.mjs';
import { LORDS } from '../sprite-trace/roster.mjs';
import { loadNative } from '../sprite-trace/lib/pipeline.mjs';
import { readRaster, writePng } from '../sprite-trace/lib/io.mjs';
import { recoverFigure } from '../sprite-trace/lib/trace.mjs';
import { LORD_OUTFITS, OUTFIT_BY_ID } from './outfits.mjs';
import { outfitPortraitId } from '../../../src/engine/LordOutfits.js';

const args = process.argv.slice(2);
const flag = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const WORK = 'References/lord-outfits/sprites';
const RAW = `${WORK}/raw`;
const TAKES = `${WORK}/takes`;
const EXEMPLARS = `${WORK}/exemplars`;
export const OUTFIT_SPRITE_SOURCES = 'docs/art/sprite-candidates-2026-10-27/sources';
const PORTRAIT_RAW = 'References/lord-outfits/raw';
const PICKS = JSON.parse(readFileSync('tools/art/lord-outfits/picks.json', 'utf8')).picks;
for (const d of [RAW, TAKES, EXEMPLARS, OUTFIT_SPRITE_SOURCES]) mkdirSync(d, { recursive: true });

/** The roster source id of an outfit sprite (`kira__field_marshal`, `kira_promoted__field_marshal`). */
export const outfitSpriteSource = (lord, outfitId, promoted = false) =>
  `${lord.toLowerCase()}${promoted ? '_promoted' : ''}__${outfitId}`;

const lordRow = (lord) => LORDS.find(([name]) => name === lord.toLowerCase());

/** The lord's shipped map sprite (base or promoted) as its recovered grid at 6x. */
async function lordSpriteExemplar(lord, promoted) {
  const source = lordRow(lord)[promoted ? 2 : 1];
  const file = `${EXEMPLARS}/${source}.png`;
  if (!existsSync(file)) await writePng((await loadNative(source)).native.scale(6), file);
  return file;
}

const rawOf = (name) =>
  ['.png', '.jpg'].map((e) => join(PORTRAIT_RAW, name + e)).find((f) => existsSync(f)) || null;

function outfitPortrait(outfit, promoted) {
  const take = PICKS[outfit.id]?.[promoted ? 'promoted' : 'base'];
  const file = take && rawOf(`${outfit.id}${promoted ? '_promoted' : ''}-t${take}`);
  if (!file)
    throw new Error(`no picked ${promoted ? 'promoted' : 'base'} portrait for ${outfit.id}`);
  return file;
}

const NOTE =
  "Image 2 IS this same person, an approved map sprite of them: keep exactly its pixel scale, framing, face, hair, build, stance, weapon (and mount, if any), and change ONLY the clothes and armour to the new outfit shown in image 3 (a portrait of this person wearing it). Keep the outfit's colours and main shapes, simplified into a few large map-size shapes.";
// Rowan and Astrid ride: without this the portrait (a bust) wins and the mount is lost.
const MOUNTS = {
  Rowan: 'a brown horse',
  Astrid: 'a white winged pegasus',
};
const mountNote = (lord) =>
  MOUNTS[lord]
    ? ` MOUNTED: this is a mounted unit. Draw the whole rider seated on ${MOUNTS[lord]} exactly as in image 2 (same mount, same size, facing right, all four legs visible), horse and rider together about 60 pixels tall; image 3 is only a bust of the rider for the outfit. Never draw the rider standing, and never crop the mount.`
    : '';
const PROMOTED_NOTE =
  ' Image 4 is the approved map sprite of this person in the base version of the outfit: the promoted sprite wears the same design made grander, as image 3 shows, on the promoted figure of image 2.';

function jobsFor(outfit, promoted, takes, model, from = 0) {
  return async () => {
    const exemplar = await lordSpriteExemplar(outfit.lord, promoted);
    const refs = [STYLE, exemplar, outfitPortrait(outfit, promoted)];
    if (promoted) {
      const base = `${OUTFIT_SPRITE_SOURCES}/${outfitSpriteSource(outfit.lord, outfit.id)}.png`;
      if (!existsSync(base)) throw new Error(`choose ${outfit.id}'s base sprite first`);
      refs.push(base);
    }
    const name = `${outfit.id}${promoted ? '_promoted' : ''}`;
    return Array.from({ length: takes }, (_, i) => i + from).map((n) => ({
      name: `${name}-${n + 1}`,
      run: () =>
        generateImage({
          prompt: `${BASE} ${SCALE} ${NOTE}${mountNote(outfit.lord)}${promoted ? PROMOTED_NOTE : ''} Subject: ${outfit.lord} in the "${outfit.name}" outfit: ${outfit.outfit}.${n % 2 ? ` (Variation ${n + 1}.)` : ''}`,
          refs,
          model,
          aspectRatio: '1:1',
          imageSize: '2K',
          out: `${RAW}/${name}-${n + 1}`,
        }),
    }));
  };
}

async function generate() {
  const only = flag('only')?.split(',');
  const promoted = args.includes('--promoted');
  const takes = +flag('takes', 3);
  const from = +flag('from', 0);
  const model = MODELS[flag('model', 'pro')] || MODELS.pro;
  const jobs = [];
  for (const outfit of LORD_OUTFITS)
    if (!only || only.includes(outfit.id))
      jobs.push(...(await jobsFor(outfit, promoted, takes, model, from)()));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const res = await job.run();
        await keyMagenta(res.files[0], `${TAKES}/${job.name}.png`);
        console.log(`${res.cached ? 'cached' : 'drawn '} ${job.name}`);
      } catch (e) {
        console.error(`FAILED ${job.name}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(+flag('concurrency', 3), jobs.length) }, worker));
}

async function choose() {
  const provFile = `${OUTFIT_SPRITE_SOURCES}/../prompts.json`;
  const prov = existsSync(provFile) ? JSON.parse(readFileSync(provFile, 'utf8')) : {};
  for (const pick of flag('choose').split(',')) {
    const [name, n] = pick.split(':');
    const promoted = name.endsWith('_promoted');
    const outfit = OUTFIT_BY_ID[name.replace(/_promoted$/, '')];
    if (!outfit) throw new Error(`unknown outfit ${name}`);
    const src = await readRaster(`${TAKES}/${name}-${n}.png`);
    const b = src.alphaBounds(64);
    const res = recoverFigure(src.crop(b.x, b.y, b.width, b.height));
    const id = outfitSpriteSource(outfit.lord, outfit.id, promoted);
    await writePng(res.native.scale(6), `${OUTFIT_SPRITE_SOURCES}/${id}.png`);
    const gen = JSON.parse(readFileSync(`${RAW}/${name}-${n}.gen.json`, 'utf8'));
    prov[id] = {
      take: `${name}-${n}`,
      portrait: outfitPortraitId(outfit.lord, outfit.id, { promoted }),
      model: gen.model,
      prompt: gen.prompt,
      refs: gen.refs,
      native: [res.native.w, res.native.h],
      pitch: +(+res.pitch?.x || 0).toFixed(2),
      at: gen.at,
    };
    console.log(`chose ${name}-${n} -> ${id}: native ${res.native.w}x${res.native.h}`);
  }
  const sorted = Object.fromEntries(
    Object.keys(prov)
      .sort()
      .map((k) => [k, prov[k]]),
  );
  writeFileSync(provFile, `${JSON.stringify(sorted, null, 2)}\n`);
}

if (process.argv[1]?.endsWith('sprites.mjs'))
  await (args.includes('--choose') ? choose() : generate());
