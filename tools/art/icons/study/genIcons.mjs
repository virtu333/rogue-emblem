// Direction B ("PC-98 painted"): generated item paintings -> keyed -> the PC-98 treatment
// (tools/art/pc98: art-bible palette, ordered dither, ink line) at icon sizes.
//   node tools/art/icons/study/genIcons.mjs [--only name,name] [--model pro|flash]
// Raw generations + provenance stay in References/items-study/gen (gitignored).
import fs from 'node:fs';
import sharp from 'sharp';
import { MODELS } from '../../gen/geminiImage.mjs';
import { paced } from './paced.mjs';
import { renderFigure } from '../../pc98/lib/pipeline.mjs';
import { toRgba } from '../../pc98/lib/io.mjs';
import { rgbToOklab } from '../../pc98/lib/color.mjs';
import { RAMPS, hexToRgb } from '../lib/palette.mjs';
import { SAMPLE } from './sample.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const only = arg('only', null)?.split(',');
const model = MODELS[arg('model', 'pro')];
const RAW = 'References/items-study/gen/icons';
const OUT = 'References/items-study/painted';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const STYLE =
  'Single game item icon, 1990s Japanese PC-98 computer game art: hand-painted pixel art with a limited ' +
  'palette, clean dark ink outlines, flat cel shading with small ordered-dither texture, warm low key light ' +
  'from the upper left, cool violet-blue shadows, muted dusk colours (ink violet, ember gold, crimson, ' +
  'verdigris green, steel blue). The object is centred, seen at a slight three-quarter angle, fills about ' +
  '80% of the frame, fully visible, no text, no border, no frame, no hands. Background: perfectly flat ' +
  'solid pure magenta (#FF00FF) with no shadow, gradient or floor.';

const jobs = SAMPLE.filter((s) => !only || only.includes(slug(s.name))).map((s) => ({
  prompt: `${STYLE}\nThe item: ${s.prompt}.`,
  model,
  aspectRatio: '1:1',
  imageSize: '1K',
  out: `${RAW}/${slug(s.name)}`,
  name: s.name,
}));

const results = await paced(jobs);

// Key out the magenta ground, crop to content, treat at each icon size.
const PALETTE = Object.values(RAMPS).flat().map(hexToRgb);
const lab = (c) => rgbToOklab(c[0], c[1], c[2]);
const PAL_LAB = PALETTE.map(lab);
function nearestArt(c) {
  const l = lab(c);
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
fs.mkdirSync(OUT, { recursive: true });
for (const [i, r] of results.entries()) {
  if (r.error) continue;
  const id = slug(jobs[i].name);
  const { data, info } = await sharp(r.files[0])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  // Background = the border colour (asked for magenta; sometimes another flat colour).
  // Flood-fill from the border through pixels near it, so interior colours survive.
  const bgc = [0, 0, 0];
  const border = [];
  for (let x = 0; x < w; x += 8) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 8) border.push(y * w, y * w + w - 1);
  for (const p of border) for (let c = 0; c < 3; c++) bgc[c] += data[p * 4 + c] / border.length;
  const near = (p, t) =>
    Math.hypot(data[p * 4] - bgc[0], data[p * 4 + 1] - bgc[1], data[p * 4 + 2] - bgc[2]) < t;
  const bg = new Uint8Array(w * h);
  const stack = border.filter((p) => near(p, 70));
  for (const p of stack) bg[p] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= w * h || bg[q] || !near(q, 70)) continue;
      bg[q] = 1;
      stack.push(q);
    }
  }
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
    // Despill: fringe pixels next to the ground lose its tint.
    if (near(p, 150)) {
      const R = data[p * 4];
      const B = data[p * 4 + 2];
      const mag = Math.min(R, B) - data[p * 4 + 1];
      if (mag > 30) data[p * 4] = data[p * 4 + 2] = Math.round((R + B) / 2 - mag * 0.6);
    }
  }
  const side = Math.max(x1 - x0, y1 - y0) + 8;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const left = Math.max(0, Math.round(cx - side / 2));
  const top = Math.max(0, Math.round(cy - side / 2));
  const keyed = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: Math.min(side, w - left), height: Math.min(side, h - top) })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  for (const size of [16, 24, 32, 48, 64]) {
    const { data: small } = await sharp(keyed)
      .resize(size, size, { kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fig = renderFigure(new Uint8Array(small), size, {
      colours: size >= 48 ? 14 : size >= 32 ? 11 : 8,
      dither: size >= 32 ? 'full' : 'none',
      cel: { sigmaS: 0.8, sigmaR: 0.05, iterations: 1 },
      gradeOptions: { shadowCool: 0.5, highlightWarm: 0.8, contrast: 1.08 },
      minIsland: size >= 32 ? 3 : 1,
      maxHole: 2,
    });
    // Snap the figure's own palette onto the art-bible ramps (one light, one palette).
    fig.palette = fig.palette.map((c, k) => (k === 0 ? c : nearestArt(c)));
    const rgba = toRgba(fig);
    fs.mkdirSync(`${OUT}/${size}`, { recursive: true });
    await sharp(Buffer.from(rgba), { raw: { width: size, height: size, channels: 4 } })
      .png()
      .toFile(`${OUT}/${size}/${id}.png`);
  }
  await sharp(keyed).resize(128, 128).png().toFile(`${OUT}/src-${id}.png`);
}
console.log('treated ->', OUT);
