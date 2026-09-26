#!/usr/bin/env node
// Chapter plates for the Historia (docs/lore/historia).
//   node docs/lore/historia/art.mjs generate [--only id,id] [--takes 2]
//   node docs/lore/historia/art.mjs treat
// generate: raw paintings from the Gemini image model, via the shared client
//   (tools/art/gen), into References/historia/ (gitignored).
// treat: the picks in plates.json become PC-98 plates in the game's palette
//   (tools/art/icons/lib/sceneTreat, the same treatment as the service vignettes),
//   written to docs/lore/historia/art/<id>.png for build.py to inline.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { runJobs } from '../../../tools/art/gen/quotaRunner.mjs';
import { WORLD } from '../../../tools/art/moments/prompts.mjs';
import { treatScene } from '../../../tools/art/icons/lib/sceneTreat.mjs';
import { encodeIndexed } from '../../../tools/art/icons/lib/png.mjs';

const RAW = 'References/historia';
const OUT = 'docs/lore/historia/art';
const PICKS = 'docs/lore/historia/plates.json';
export const SIZE = [640, 272];

const PLATE =
  `${WORLD} Wide cinematic establishing painting for a history book, 21:9, strong depth, ` +
  'one warm focal light, the rest in deep dusk. Where sky shows, a black eclipse sun with a thin ' +
  'gold corona (the Hollow Sun). Figures small in the scene, seen from behind or in silhouette.';

export const SUBJECTS = {
  spending:
    'mythic night: a luminous woman kneeling in a flat lowland marsh, her light pouring down into the ground, which opens into a perfectly still black pool; countless small golden lights falling from the sky like a shower of coins; great sleeping dragons lying down in a ring around the pool, their backs like standing stones',
  ford:
    'dusk at a wide shallow river ford in hill country: a handful of armoured barrow-lords standing knee-deep in the water, one raising a curved horn to his lips, torches on both banks, burial mounds on the far hills',
  hallow:
    'bleached pale fenland under a dark sky: a ring of tall weathered standing stones shaped faintly like the spines of sleeping dragons, around a black mirror-still pool; white dead reeds, a reed-thatched hall on stilts at the water edge, far bells on posts',
  hearth:
    'night: a broad smoking volcanic mountain with a crimson-bannered fortress city spilling down its shoulder, ash falling like snow, red lamps in the streets, glowing lava seams on the flanks, frozen passes behind',
  unsworn:
    'an underground hall of warm stone that glows faintly from within: an ancient worn throne cut into the rock, twelve robed mages standing in a circle around it reading from long red scrolls, one armoured man kneeling alone before the throne, listening',
  night_before:
    'dusk on a grassy hill above a river ford: a small warband sitting around a campfire, a furled teal banner planted beside it, a burned hall on a bluff in the distance, the river running slow and gold with firelight',
};

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);

async function generate() {
  const only = arg('only', null)?.split(',');
  const takes = Number(arg('takes', 2));
  const jobs = [];
  for (let take = 1; take <= takes; take += 1) {
    for (const [id, subject] of Object.entries(SUBJECTS)) {
      if (only && !only.includes(id)) continue;
      const variant = take > 1 ? ` Alternative composition ${take}.` : '';
      jobs.push({
        name: `${id}#${take}`,
        prompt: `${PLATE}\nSubject: ${subject}.${variant}`,
        aspectRatio: '21:9',
        imageSize: '2K',
        out: `${RAW}/${id}-t${take}`,
      });
    }
  }
  fs.mkdirSync(RAW, { recursive: true });
  const results = await runJobs(jobs, { model: 'pro', fallback: 'flash', log: `${RAW}/run.log` });
  const failed = results.filter((r) => r.error);
  console.log(`${results.length - failed.length}/${results.length} ok`);
  if (failed.length) process.exitCode = 1;
}

function rawFile(source) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const f = path.join(RAW, `${source}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  const hit = fs.readdirSync(RAW).find((f) => f.startsWith(source) && /\.(png|jpe?g|webp)$/.test(f));
  if (hit) return path.join(RAW, hit);
  throw new Error(`missing raw ${source}`);
}

async function treat() {
  const picks = JSON.parse(fs.readFileSync(PICKS, 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const [w, h] = SIZE;
  for (const [id, pick] of Object.entries(picks)) {
    const { data } = await sharp(rawFile(pick.source))
      .resize(w, h, { fit: 'cover', position: pick.position || 'centre', kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rgba = treatScene(new Uint8Array(data), w, h, { colours: pick.colours || 24 });
    fs.writeFileSync(path.join(OUT, `${id}.png`), encodeIndexed(rgba, w, h));
    console.log(`treated ${id} <- ${pick.source}`);
  }
}

if (argv[0] === 'generate') await generate();
else if (argv[0] === 'treat') await treat();
else console.log('usage: art.mjs generate|treat');
