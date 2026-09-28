#!/usr/bin/env node
// Text-to-image with MiniMax image-01 (optional character subject reference) for the
// Unwritten Page engine.
//
//   node tools/cutscene/unwritten/motion/minimax_image.mjs <name> <n> <aspect> <cutout|-> <promptfile>
//     e.g. ... f_warden_poses 3 3:2 empire_soldier.webp prompt.txt
//
// The subject reference cut-out (from docs/art-direction/anime-op/cutouts/) is put on flat
// #00FF00 and sent as a JPEG data URL. Outputs: References/cutscene/unwritten/stills/
// <name>_<k>.jpeg; each request is logged in stills/spend.jsonl. Key: MINIMAX_API_KEY in
// .env, or none when a proxy adds it. Price (image-01) ~ $0.0035 per image.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../../..');
const OUT = path.join(ROOT, 'References/cutscene/unwritten/stills');
const CUTS = path.join(ROOT, 'docs/art-direction/anime-op/cutouts');
const PRICE_PER_IMAGE = 0.0035;

let KEY = process.env.MINIMAX_API_KEY;
try {
  const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^MINIMAX_API_KEY=(.*)$/m);
  if (!KEY && m) KEY = m[1].replace(/^["']|["']$/g, '');
} catch {
  /* no .env */
}
const H = { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) };

const [name, n, aspect, cutout, promptFile] = process.argv.slice(2);
if (!promptFile) {
  console.error('usage: minimax_image.mjs <name> <n> <aspect> <cutout|-> <promptfile>');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const prompt = fs.readFileSync(promptFile, 'utf8').trim().replace(/\s*\n\s*/g, ' ');
const body = {
  model: 'image-01',
  prompt,
  aspect_ratio: aspect,
  n: Number(n),
  response_format: 'base64',
  prompt_optimizer: false,
};
if (cutout !== '-') {
  const jpg = await sharp(path.join(CUTS, cutout))
    .flatten({ background: '#00ff00' })
    .resize({ width: 1024, height: 1024, fit: 'inside' })
    .jpeg({ quality: 90 })
    .toBuffer();
  body.subject_reference = [
    { type: 'character', image_file: `data:image/jpeg;base64,${jpg.toString('base64')}` },
  ];
}
const r = await fetch('https://api.minimax.io/v1/image_generation', {
  method: 'POST',
  headers: H,
  body: JSON.stringify(body),
});
const j = await r.json();
const imgs = j.data?.image_base64 || [];
if (!imgs.length) {
  console.error(`${name}: ${JSON.stringify(j).slice(0, 500)}`);
  process.exit(1);
}
const stamp = Date.now().toString(36);
imgs.forEach((b, k) => {
  const f = path.join(OUT, `${name}_${stamp}_${k}.jpeg`);
  fs.writeFileSync(f, Buffer.from(b, 'base64'));
  console.log(path.relative(ROOT, f));
});
fs.appendFileSync(
  path.join(OUT, 'spend.jsonl'),
  `${JSON.stringify({ at: new Date().toISOString(), job: name, model: 'image-01', n: imgs.length, cutout, usd: imgs.length * PRICE_PER_IMAGE })}\n`,
);
