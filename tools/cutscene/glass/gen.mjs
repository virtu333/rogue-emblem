#!/usr/bin/env node
// Generate the sources for "The Far Side of the Glass": a keyframe per shot (Gemini image), then a Veo
// clip from each keyframe. Outputs go to References/cutscene/glass/ (gitignored); both
// steps are cached by request hash, so re-runs only pay for what changed.
//
//   node tools/cutscene/glass/gen.mjs --keys [--only a,b]     keyframes
//   node tools/cutscene/glass/gen.mjs --clips [--only a,b]    Veo clips (needs keyframes)
//   add --force to regenerate the named shots

import fs from 'node:fs';
import path from 'node:path';
import { generateImage, generateVideo, MODELS } from '../../art/gen/geminiImage.mjs';
import { SHOTS, CAST, LOOK, MOTION, NEGATIVE } from './shots.mjs';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const arg = (k, d) => (has(k) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = 'References/cutscene/glass';
const only = arg('only') ? new Set(arg('only').split(',')) : null;
const force = has('force');
const pick = SHOTS.filter((s) => !only || only.has(s.id));

const keyPath = (id) => {
  const base = path.join(OUT, 'keys', id);
  return ['.png', '.jpg'].map((e) => base + e).find((f) => fs.existsSync(f));
};

function keyPrompt(shot) {
  let text = shot.key;
  for (const c of shot.cast || []) text = text.replaceAll(`{${c}}`, CAST[c].look);
  const cast = (shot.cast || []).length
    ? '\n\nThe attached pixel-art portraits show who the characters are: match their hair, ' +
      'colouring, costume and face, but draw them as anime characters in the style of the ' +
      'rest of the frame. ' +
      `${(shot.cast || []).map((c) => CAST[c].look).join('. ')}.`
    : '';
  return `${LOOK}\n\n${text}${cast}`;
}

async function keys() {
  // plain shots first, then edits of them
  const later = (s) => s.edit || s.refKey;
  const order = [...pick.filter((s) => !later(s)), ...pick.filter(later)];
  const one = async (shot) => {
    const out = path.join(OUT, 'keys', shot.id);
    const job = shot.edit
      ? {
          prompt: `${shot.key}\n\n${LOOK}`,
          refs: [keyPath(shot.edit)],
        }
      : {
          prompt: keyPrompt(shot),
          refs: [
            ...(shot.refKey ? [keyPath(shot.refKey)] : []),
            ...(shot.cast || []).map((c) => CAST[c].ref),
          ],
        };
    try {
      const r = await generateImage({
        ...job,
        model: MODELS.pro,
        aspectRatio: '16:9',
        imageSize: '2K',
        out,
        force,
      });
      console.log(`${shot.id}: ${r.files[0]}${r.cached ? ' (cached)' : ''}`);
    } catch (e) {
      console.error(`${shot.id}: ${e.message}`);
    }
  };
  // plain shots in parallel, then edits and continuity shots (they need the others)
  const pool = async (list) => {
    const q = [...list];
    await Promise.all(
      Array.from({ length: Number(arg('concurrency', 4)) }, async () => {
        while (q.length) await one(q.shift());
      }),
    );
  };
  await pool(order.filter((s) => !later(s)));
  await pool(order.filter(later));
}

async function clips() {
  const conc = Number(arg('concurrency', 4));
  const queue = [...pick];
  const worker = async () => {
    while (queue.length) {
      const shot = queue.shift();
      const image = keyPath(shot.id);
      if (!image) {
        console.error(`${shot.id}: no keyframe`);
        continue;
      }
      const t0 = Date.now();
      try {
        const file = await generateVideo({
          prompt: `${MOTION} ${shot.motion}`,
          image,
          model: MODELS[shot.model || 'veoFast'],
          durationSeconds: shot.dur,
          resolution: '720p',
          negativePrompt: NEGATIVE,
          out: path.join(OUT, 'clips', shot.id),
          force,
        });
        console.log(`${shot.id}: ${file} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      } catch (e) {
        console.error(`${shot.id}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
}

if (has('keys')) await keys();
else if (has('clips')) await clips();
else console.log('usage: gen.mjs --keys | --clips [--only a,b] [--force]');
