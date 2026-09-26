#!/usr/bin/env node
// Painted heroes: key, crop and PC-98-treat every raw generation to a 96 px candidate,
// then (with --publish) copy the curated picks listed in selections.json into
// assets/ui/items/hero/ (and public/). Curate at display size with the contact sheets
// this writes to References/items-art/hero/.
//   node tools/art/icons/hero/treat.mjs [--only id,id]   treat raws -> candidates + sheet
//   node tools/art/icons/hero/treat.mjs --publish [--only id,id]   approved picks -> assets
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { renderFigure } from '../../pc98/lib/pipeline.mjs';
import { toRgba } from '../../pc98/lib/io.mjs';
import { rgbToOklab } from '../../pc98/lib/color.mjs';
import { RAMPS, hexToRgb, PANELS } from '../lib/palette.mjs';
import { encodeIndexed } from '../lib/png.mjs';

export const SIZE = 96;
const RAW = 'References/items-art/hero/raw';
const CAND = 'References/items-art/hero/cand';
const SELECTIONS = 'tools/art/icons/hero/selections.json';
const OUT_DIRS = ['assets/ui/items/hero', 'public/assets/ui/items/hero'];

const PALETTE = Object.values(RAMPS).flat().map(hexToRgb);
const PAL_LAB = PALETTE.map((c) => rgbToOklab(c[0], c[1], c[2]));
function nearestArt(c) {
  const l = rgbToOklab(c[0], c[1], c[2]);
  let best = 0;
  let bd = Infinity;
  PAL_LAB.forEach((p, i) => {
    const d = (p[0] - l[0]) ** 2 + (p[1] - l[1]) ** 2 * 1.4 + (p[2] - l[2]) ** 2 * 1.4;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return PALETTE[best];
}

/** Flood the flat ground away from the border; returns keyed RGBA + content box. */
export function keyGround(data, w, h) {
  const bgc = [0, 0, 0];
  const border = [];
  for (let x = 0; x < w; x += 4) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 4) border.push(y * w, y * w + w - 1);
  for (const p of border) for (let c = 0; c < 3; c++) bgc[c] += data[p * 4 + c] / border.length;
  const dist = (p) =>
    Math.hypot(data[p * 4] - bgc[0], data[p * 4 + 1] - bgc[1], data[p * 4 + 2] - bgc[2]);
  const bg = new Uint8Array(w * h);
  const stack = border.filter((p) => dist(p) < 80);
  for (const p of stack) bg[p] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= w * h || bg[q] || dist(q) >= 80) continue;
      bg[q] = 1;
      stack.push(q);
    }
  }
  // Enclosed pockets of ground (inside a ring, between bow and string) key out too.
  for (let p = 0; p < w * h; p++) if (!bg[p] && dist(p) < 34) bg[p] = 1;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) {
      data[p * 4 + 3] = 0;
      continue;
    }
    const x = p % w;
    const y = Math.floor(p / w);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    // Despill magenta fringes.
    if (dist(p) < 170) {
      const R = data[p * 4];
      const G = data[p * 4 + 1];
      const B = data[p * 4 + 2];
      const mag = Math.min(R, B) - G;
      if (mag > 24) {
        data[p * 4] = Math.round(R - mag * 0.7);
        data[p * 4 + 2] = Math.round(B - mag * 0.7);
      }
    }
  }
  return { data, box: [x0, y0, x1, y1] };
}

export async function treatHero(file, size = SIZE) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { box } = keyGround(data, info.width, info.height);
  const [x0, y0, x1, y1] = box;
  // Square crop around the content with a small margin; the socket gives the air.
  const side = Math.round(Math.max(x1 - x0, y1 - y0) * 1.06) + 4;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const sq = Buffer.alloc(side * side * 4);
  const ox = Math.round(cx - side / 2);
  const oy = Math.round(cy - side / 2);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const sx = x + ox;
      const sy = y + oy;
      if (sx < 0 || sy < 0 || sx >= info.width || sy >= info.height) continue;
      const s = (sy * info.width + sx) * 4;
      const d = (y * side + x) * 4;
      sq[d] = data[s];
      sq[d + 1] = data[s + 1];
      sq[d + 2] = data[s + 2];
      sq[d + 3] = data[s + 3];
    }
  const canvas = await sharp(sq, { raw: { width: side, height: side, channels: 4 } })
    .png()
    .toBuffer();
  const { data: small } = await sharp(canvas)
    .resize(size, size, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fig = renderFigure(new Uint8Array(small), size, {
    colours: 16,
    dither: 'full',
    cel: { sigmaS: 0.9, sigmaR: 0.05, iterations: 1 },
    gradeOptions: { shadowCool: 0.5, highlightWarm: 0.8, contrast: 1.08 },
    minIsland: 3,
    maxHole: 2,
  });
  fig.palette = fig.palette.map((c, k) => (k === 0 ? c : nearestArt(c)));
  return toRgba(fig);
}

async function sheet(entries, out) {
  // Each candidate at 1x and 2x on the raised panel colour (how the detail pane shows it).
  const cell = SIZE * 3 + 24;
  const cols = 4;
  const rows = Math.ceil(entries.length / cols);
  const comps = [];
  const labels = [];
  for (const [i, e] of entries.entries()) {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (SIZE * 2 + 30);
    const png = await sharp(Buffer.from(e.rgba), {
      raw: { width: SIZE, height: SIZE, channels: 4 },
    })
      .png()
      .toBuffer();
    comps.push({ input: png, left: x + 6, top: y + 6 + SIZE / 2 });
    comps.push({
      input: await sharp(png)
        .resize(SIZE * 2, SIZE * 2, { kernel: 'nearest' })
        .toBuffer(),
      left: x + SIZE + 12,
      top: y + 6,
    });
    labels.push(
      `<text x="${x + 6}" y="${y + SIZE * 2 + 22}" font-size="12" fill="#ddd" font-family="sans-serif">${e.name}</text>`,
    );
  }
  const W = cols * cell;
  const H = rows * (SIZE * 2 + 30);
  comps.push({
    input: Buffer.from(`<svg width="${W}" height="${H}">${labels.join('')}</svg>`),
    left: 0,
    top: 0,
  });
  await sharp({ create: { width: W, height: H, channels: 4, background: PANELS.raised } })
    .composite(comps)
    .png()
    .toFile(out);
}

async function treatAll(only) {
  fs.mkdirSync(CAND, { recursive: true });
  const raws = fs
    .readdirSync(RAW)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .filter((f) => !only || only.some((id) => f.startsWith(`${id}-`)))
    .sort();
  const entries = [];
  for (const f of raws) {
    const name = f.replace(/\.(png|jpe?g)$/i, '');
    const record = JSON.parse(fs.readFileSync(path.join(RAW, `${name}.gen.json`), 'utf8'));
    const rgba = await treatHero(path.join(RAW, f));
    fs.writeFileSync(path.join(CAND, `${name}.png`), encodeIndexed(rgba, SIZE, SIZE));
    entries.push({ name: `${name} (${record.model.includes('pro') ? 'pro' : 'flash'})`, rgba });
  }
  for (let i = 0; i < entries.length; i += 24)
    await sheet(
      entries.slice(i, i + 24),
      `References/items-art/hero/sheet-${String(i / 24 + 1).padStart(2, '0')}.png`,
    );
  console.log(`${entries.length} candidates -> ${CAND} (+ sheets)`);
}

function publish(only = null) {
  const sel = JSON.parse(fs.readFileSync(SELECTIONS, 'utf8'));
  let n = 0;
  const approved = new Set();
  for (const [id, pick] of Object.entries(sel.items)) {
    if (!pick.approved) continue;
    // --only republishes just those picks (a reroll), keeping every other hero as shipped.
    if (only && !only.includes(id)) {
      approved.add(`${id}.png`);
      continue;
    }
    const src = path.join(CAND, `${pick.source}.png`);
    if (!fs.existsSync(src)) throw new Error(`${id}: missing candidate ${src}`);
    for (const dir of OUT_DIRS) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, path.join(dir, `${id}.png`));
    }
    approved.add(`${id}.png`);
    n += 1;
  }
  // Drop heroes that are no longer approved.
  for (const dir of OUT_DIRS)
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      if (!approved.has(f)) fs.rmSync(path.join(dir, f));
  console.log(`published ${n} heroes`);
}

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
if (argv.includes('--publish')) publish(only);
else await treatAll(only);
