#!/usr/bin/env node
// Class crest references — generated series (study only; see README.md).
//
// Generates a consistent heraldic series with gemini-3-pro-image: the first
// crests (a base and a promoted crest) are generated from the style prompt
// alone, then every other crest uses them as references so the frame, field
// and line weight stay one family. Outputs are references, never shipped:
// raw images live under docs/art/crests-gen/ and go through treat.mjs.
//
//   node tools/art/crests/generate.mjs [--only Myrmidon,Paladin] [--concurrency 3]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImage, generateAll, MODELS } from '../gen/geminiImage.mjs';
import { CREST_LINES, crestSpecFor, crestIds } from './spec.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'docs/art/crests-gen/raw');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = opt('--only')?.split(',');
const concurrency = Number(opt('--concurrency') || 3);

const STYLE = [
  'A single heraldic class crest for a dark-fantasy tactics RPG, centred, front view, flat and symmetrical.',
  'Shape: a heater shield with cut (chamfered) upper corners, no rounded corners.',
  'Style: 1990s PC-98 / SNES era pixel art emblem, crisp hard pixel edges, no anti-aliasing, no gradients, ',
  'limited palette of about 12 colours: ink black #0e0c14 field with a faint lighter ink band, ',
  'ember gold #dca044 / #f3cb6c highlights, bone #ddd0bd, steel blue #4574a0 accents, deep crimson only as a thin inner line.',
  'Lit from the upper left, one-pixel dark outline around every shape. Plain solid black background outside the shield.',
  'No text, no letters, no numbers, no skulls, no spikes, no glowing runes, no drop shadow, no photo, no 3D.',
].join(' ');

function prompt(spec) {
  const frame =
    spec.tier === 'promoted'
      ? 'Frame: a gilded double rim in ember gold with a small five-point crown of notches above the shield (promoted tier).'
      : spec.tier === 'boss'
        ? 'Frame: a cracked violet-black rim (corrupted tier).'
        : 'Frame: a plain single rim of dark steel (base tier).';
  return `${STYLE}\n${frame}\nCharge (the picture on the shield): ${spec.charge}.`;
}

const ids = crestIds().filter((id) => !only || only.includes(id));
const anchors = ['Myrmidon', 'Swordmaster'];
const anchorOut = (id) => path.join(OUT, id.toLowerCase().replace(/ /g, '_'));

// Anchors first (no refs), then the series against them.
const refs = [];
for (const id of anchors) {
  const r = await generateImage({
    prompt: prompt(crestSpecFor(id)),
    model: MODELS.pro,
    aspectRatio: '1:1',
    imageSize: '1K',
    out: anchorOut(id),
  });
  console.log(id, r.cached ? 'cached' : 'new', r.files[0]);
  refs.push(r.files[0]);
}
const jobs = ids
  .filter((id) => !anchors.includes(id))
  .map((id) => ({
    prompt: `${prompt(crestSpecFor(id))}\nMatch the attached crests exactly in shape, rim, palette, pixel size and outline weight; only the charge and tier frame change.`,
    refs,
    model: MODELS.pro,
    aspectRatio: '1:1',
    imageSize: '1K',
    out: anchorOut(id),
  }));
await generateAll(jobs, {
  concurrency,
  onDone: (job, res) =>
    console.log(path.basename(job.out), res.error ? `ERROR ${res.error}` : res.files?.[0]),
});
console.log(`lines: ${CREST_LINES.length}`);
