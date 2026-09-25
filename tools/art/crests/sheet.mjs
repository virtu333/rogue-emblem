#!/usr/bin/env node
// Crest contact sheets (review tooling, never shipped).
//
//   node tools/art/crests/sheet.mjs --out docs/art-direction/growth [--scale 3]
//
// Writes crests-contact.png: every class crest grouped by line (base then
// promoted), each drawn at the three display sizes it ships at — 24 (roster
// chip), 48 (path choice) and 112 (ceremony) CSS px — times --scale (device
// pixels, default 3 = a DPR-3 phone). Also crests-compare.png when the
// treated generated series exists (docs/art/crests-gen/treated/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CLASS_CREST_SPECS } from '../../../src/ui/classCrests.js';
import { crestSvg } from '../../../src/ui/crestArt.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = path.resolve(ROOT, opt('--out', 'docs/art-direction/growth'));
const K = Number(opt('--scale', 3));
fs.mkdirSync(OUT, { recursive: true });

const BG = '#0e0c14';
const SIZES = [24, 48, 112];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function crestPng(name, px) {
  return sharp(Buffer.from(crestSvg(name)), { density: Math.max(72, (72 * px) / 64) * 1.0 })
    .resize(px, px)
    .png()
    .toBuffer();
}

function label(text, w, h, size = 11, color = '#ddd0bd') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="0" y="${h - 4}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="${color}">${esc(text)}</text></svg>`,
  );
}

const lines = new Map();
for (const [name, spec] of Object.entries(CLASS_CREST_SPECS)) {
  if (!lines.has(spec.line)) lines.set(spec.line, []);
  lines.get(spec.line).push(name);
}

// One cell per class: 112 + 48 + 24 side by side, name under.
const cellW = (SIZES.reduce((a, b) => a + b, 0) + 24) * K;
const cellH = (SIZES[2] + 22) * K;
const cols = 4;
const cells = [];
for (const names of lines.values()) for (const n of names) cells.push(n);
const rows = Math.ceil(cells.length / cols);
const pad = 16 * K;
const W = cols * cellW + pad * 2;
const H = rows * cellH + pad * 2;
const composites = [];
for (let i = 0; i < cells.length; i++) {
  const name = cells[i];
  const x0 = pad + (i % cols) * cellW;
  const y0 = pad + Math.floor(i / cols) * cellH;
  let x = x0;
  for (const s of [...SIZES].reverse()) {
    const px = s * K;
    composites.push({ input: await crestPng(name, px), left: x, top: y0 + (SIZES[2] * K - px) });
    x += px + 8 * K;
  }
  composites.push({
    input: label(`${name} · ${CLASS_CREST_SPECS[name].tier}`, cellW, 18 * K, 10 * K),
    left: x0,
    top: y0 + SIZES[2] * K,
  });
}
await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
  .composite(composites)
  .png()
  .toFile(path.join(OUT, 'crests-contact.png'));
console.log(path.join(OUT, 'crests-contact.png'), W, H);

// Side-by-side study: treated generation vs code, at 24/48/112 CSS px.
const treatedDir = path.join(ROOT, 'docs/art/crests-gen/treated');
if (fs.existsSync(treatedDir)) {
  const pick = opt('--compare', 'Myrmidon,Swordmaster,Cavalier,Paladin,Pegasus Knight,Falcon Knight,Mage,Warlock,Cleric,Bishop,Lord,Great Lord').split(','); // prettier-ignore
  const rowH = (SIZES[2] + 30) * K;
  const half = (SIZES.reduce((a, b) => a + b, 0) + 40) * K;
  const cw = half * 2 + 40 * K;
  const comp = [];
  let y = pad;
  const heads = [
    { input: label('generated + treated (raster, 48 art px)', half, 20 * K, 11 * K), left: pad, top: y },
    { input: label('code-built (vector facets)', half, 20 * K, 11 * K), left: pad + half + 20 * K, top: y },
  ]; // prettier-ignore
  comp.push(...heads);
  y += 26 * K;
  for (const name of pick) {
    const id = name.toLowerCase().replace(/ /g, '_');
    const file = path.join(treatedDir, `${id}.png`);
    let x = pad;
    for (const s of [...SIZES].reverse()) {
      const px = s * K;
      if (fs.existsSync(file))
        comp.push({
          input: await sharp(file).resize(px, px, { kernel: 'nearest' }).png().toBuffer(),
          left: x,
          top: y + (SIZES[2] * K - px),
        });
      x += px + 8 * K;
    }
    x = pad + half + 20 * K;
    for (const s of [...SIZES].reverse()) {
      const px = s * K;
      comp.push({ input: await crestPng(name, px), left: x, top: y + (SIZES[2] * K - px) });
      x += px + 8 * K;
    }
    comp.push({ input: label(name, cw, 18 * K, 10 * K), left: pad, top: y + SIZES[2] * K });
    y += rowH;
  }
  await sharp({ create: { width: cw + pad * 2, height: y + pad, channels: 4, background: BG } })
    .composite(comp)
    .png()
    .toFile(path.join(OUT, 'crests-compare.png'));
  console.log(path.join(OUT, 'crests-compare.png'));
}
