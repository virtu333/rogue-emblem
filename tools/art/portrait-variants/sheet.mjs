#!/usr/bin/env node
// Contact sheets for portrait variety -> docs/art-direction/portraits-variety/.
//
//   node tools/art/portrait-variants/sheet.mjs [--out DIR]
//
// contact-player.webp  every class line: people (rows) x classes (columns),
//                      96 px PC-98 renders on the steel plate at 1:1
// contact-enemy.webp   every enemy class: its four faces, 64 px on blood
// roster-strip.webp    the list faces as shipped (32 px) and the phone
//                      summary (40 px), at 3x like a DPR-3 phone
import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const OUT = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join(ROOT, 'docs/art-direction/portraits-variety');
const PC98 = join(ROOT, 'assets/portraits/pc98');
const table = JSON.parse(readFileSync(join(ROOT, 'src/data/portraitVariants.json'), 'utf8'));
const { LINES } = await import('./catalog.mjs');
mkdirSync(OUT, { recursive: true });
const BG = { r: 7, g: 6, b: 11, alpha: 1 };
const INK = '#ddd0bd';

const text = (s, width, size = 11, fill = INK) =>
  Buffer.from(
    `<svg width="${width}" height="${size + 6}"><text x="2" y="${size + 1}" font-size="${size}" fill="${fill}" font-family="sans-serif">${s}</text></svg>`,
  );

async function face(id, size, faction, zoom = 1) {
  const img = await sharp(join(PC98, 'plates', `${faction}-${size}.png`))
    .composite([{ input: join(PC98, String(size), `${id}.png`) }])
    .png()
    .toBuffer();
  return zoom === 1
    ? img
    : sharp(img)
        .resize(size * zoom, size * zoom, { kernel: 'nearest' })
        .png()
        .toBuffer();
}

async function canvas(width, height, composites, file) {
  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite(composites)
    .webp({ lossless: true, effort: 6 })
    .toFile(join(OUT, file));
  console.log(file, width, height);
}

// Player lines: one block per line.
{
  const S = 96;
  const GAP = 4;
  const LABEL = 32;
  const blocks = [];
  for (const [line, def] of Object.entries(LINES)) {
    const people = Object.keys(def.people);
    const w = def.classes.length * (S + GAP) + 70;
    const h = LABEL + people.length * (S + GAP) + 4;
    const comps = [{ input: text(`${line} line`, w, 12, '#f3cb6c'), left: 0, top: 0 }];
    for (const [ci, cls] of def.classes.entries())
      comps.push({ input: text(cls, S + GAP, 10), left: 70 + ci * (S + GAP), top: LABEL - 15 });
    for (const [pi, person] of people.entries()) {
      comps.push({
        input: text(`${person.split('_')[1]} · ${table.identities[person]?.gender || '?'}`, 68, 10),
        left: 0,
        top: LABEL + pi * (S + GAP) + 40,
      });
      for (const [ci, cls] of def.classes.entries()) {
        const id = table.identities[person]?.renders[cls];
        if (!id) continue;
        comps.push({
          input: await face(id, S, 'steel'),
          left: 70 + ci * (S + GAP),
          top: LABEL + pi * (S + GAP),
        });
      }
    }
    blocks.push({ w, h, comps });
  }
  const PER_ROW = 4;
  const colW = Math.max(...blocks.map((b) => b.w)) + 12;
  const rowH = Math.max(...blocks.map((b) => b.h)) + 12;
  const rows = Math.ceil(blocks.length / PER_ROW);
  const all = [];
  blocks.forEach((b, i) => {
    const ox = (i % PER_ROW) * colW;
    const oy = Math.floor(i / PER_ROW) * rowH;
    for (const c of b.comps) all.push({ ...c, left: c.left + ox, top: c.top + oy });
  });
  await canvas(PER_ROW * colW, rows * rowH, all, 'contact-player.webp');
}

// Enemy classes: four faces each.
{
  const S = 64;
  const GAP = 3;
  const entries = Object.entries(table.enemy);
  const PER_ROW = 4;
  const cellW = 90 + 4 * (S + GAP) + 12;
  const cellH = S + 8;
  const comps = [];
  for (const [i, [cls, ids]] of entries.entries()) {
    const ox = (i % PER_ROW) * cellW;
    const oy = Math.floor(i / PER_ROW) * cellH;
    comps.push({ input: text(cls, 88, 10), left: ox, top: oy + 24 });
    for (const [k, id] of ids.entries())
      comps.push({ input: await face(id, S, 'blood'), left: ox + 90 + k * (S + GAP), top: oy });
  }
  await canvas(
    PER_ROW * cellW,
    Math.ceil(entries.length / PER_ROW) * cellH,
    comps,
    'contact-enemy.webp',
  );
}

// Display sizes: the roster list (32) and phone summary (40) at 3x.
{
  const lines = ['fighter', 'myrmidon', 'mage', 'cleric', 'pegasus', 'mercenary'];
  const comps = [];
  const Z = 3;
  let y = 0;
  let width = 0;
  for (const line of lines) {
    const def = LINES[line];
    const cls = def.classes[0];
    comps.push({ input: text(cls, 110, 12), left: 0, top: y + 36 });
    let x = 112;
    for (const person of Object.keys(def.people)) {
      const id = table.identities[person]?.renders[cls];
      if (!id) continue;
      comps.push({ input: await face(id, 32, 'steel', Z), left: x, top: y });
      x += 32 * Z + 6;
    }
    x += 24;
    for (const person of Object.keys(def.people)) {
      const id = table.identities[person]?.renders[cls];
      if (!id) continue;
      comps.push({ input: await face(id, 40, 'steel', Z), left: x, top: y });
      x += 40 * Z + 6;
    }
    width = Math.max(width, x);
    y += 40 * Z + 8;
  }
  await canvas(width, y, comps, 'roster-strip.webp');
}
