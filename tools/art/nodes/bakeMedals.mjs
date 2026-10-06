#!/usr/bin/env node
// Bake the Event medal and its Dark Omen variant into the shipped sheet.
//   node tools/art/nodes/bakeMedals.mjs [--preview]
// Reads the picks in selections.json (raw generations under References/event-art/medal/),
// keys the flat white background out, trims, and fits both medals with one shared transform
// (so the swap at an Eclipse fall never jumps) into two 96 px square frames, drawn at 29-34
// CSS px on the route map (3x for a phone). Writes:
//   assets/sprites/nodes/event-nodes.png   192 x 96: frame 9 = Event, frame 10 = Dark Omen
//   assets/sprites/nodes/node_event.png    48 x 48: the canvas fallback texture `node_event`
// and the same files under public/assets (the repo's sync does the same copy).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const RAW = 'References/event-art/medal';
const SEL = JSON.parse(fs.readFileSync('tools/art/nodes/selections.json', 'utf8'));
const FRAME = 96;
const FIT = 92; // longest side of the shared bounds inside a frame (2 px margin)
const DIRS = ['assets/sprites/nodes', 'public/assets/sprites/nodes'];

function rawFile(source) {
  for (const ext of ['.jpg', '.png']) {
    const f = path.join(RAW, `${source}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`missing raw ${source}`);
}

const isPaper = (d, i) => Math.min(d[i], d[i + 1], d[i + 2]) >= 226;

/** Flood the flat white background from the borders to alpha 0, then eat the light halo. */
async function keyed(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const clear = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (!clear[p] && isPaper(data, p * 4)) {
      clear[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // Light, anti-aliased rim pixels next to the cleared field are paper bleed, not art.
  for (let pass = 0; pass < 2; pass++) {
    const next = clear.slice();
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (clear[p]) continue;
        const near =
          clear[p - 1] || clear[p + 1] || clear[p - w] || clear[p + w] || clear[p - w - 1];
        const i = p * 4;
        if (near && Math.min(data[i], data[i + 1], data[i + 2]) >= 190) next[p] = 1;
      }
    clear.set(next);
  }
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let p = 0; p < w * h; p++) {
    data[p * 4 + 3] = clear[p] ? 0 : 255;
    if (clear[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { data, w, h, box: [x0, y0, x1 + 1, y1 + 1] };
}

const medals = [];
for (const key of ['event', 'dark']) {
  const source = SEL[key].source;
  medals.push({ key, source, ...(await keyed(rawFile(source))) });
}
// One transform for both: the union of the two trimmed boxes, fitted to FIT px.
const ux0 = Math.min(...medals.map((m) => m.box[0]));
const uy0 = Math.min(...medals.map((m) => m.box[1]));
const ux1 = Math.max(...medals.map((m) => m.box[2]));
const uy1 = Math.max(...medals.map((m) => m.box[3]));
const scale = FIT / Math.max(ux1 - ux0, uy1 - uy0);
const outW = Math.round((ux1 - ux0) * scale);
const outH = Math.round((uy1 - uy0) * scale);
const left = Math.floor((FRAME - outW) / 2);
const top = FRAME - 2 - outH; // sit on the frame's floor, like the ground patch of the other medals

const tiles = [];
for (const m of medals) {
  const tile = await sharp(m.data, { raw: { width: m.w, height: m.h, channels: 4 } })
    .extract({ left: ux0, top: uy0, width: ux1 - ux0, height: uy1 - uy0 })
    .resize(outW, outH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  tiles.push({ input: tile, left: left + (m.key === 'dark' ? FRAME : 0), top });
}
const sheet = await sharp({
  create: {
    width: FRAME * 2,
    height: FRAME,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(tiles)
  .png({ palette: true, colours: 96, effort: 10, dither: 0 })
  .toBuffer();
const fallback = await sharp(sheet)
  .extract({ left: 0, top: 0, width: FRAME, height: FRAME })
  .resize(48, 48, { kernel: 'lanczos3' })
  .png({ palette: true, colours: 64, effort: 10, dither: 0 })
  .toBuffer();
for (const dir of DIRS) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'event-nodes.png'), sheet);
  fs.writeFileSync(path.join(dir, 'node_event.png'), fallback);
}
console.log(
  `event-nodes.png ${sheet.length} B (${FRAME * 2}x${FRAME}), node_event.png ${fallback.length} B; ` +
    `picks: ${medals.map((m) => `${m.key}=${m.source}`).join(', ')}`,
);

if (process.argv.includes('--preview')) {
  // The two medals on the loom's dark panel at 1x, 2x and 4x beside the Ruins medal.
  const sheetMain = 'assets/sprites/nodes/weathered-nodes.png';
  const ruins = await sharp(sheetMain)
    .extract({ left: 438, top: 472, width: 378, height: 334 })
    .resize(FRAME, FRAME, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 3 * FRAME * 2, height: FRAME * 2, channels: 4, background: '#16131e' },
  })
    .composite([
      {
        input: await sharp(ruins)
          .resize(FRAME * 2)
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
      {
        input: await sharp(sheet)
          .extract({ left: 0, top: 0, width: FRAME, height: FRAME })
          .resize(FRAME * 2, FRAME * 2, { kernel: 'nearest' })
          .png()
          .toBuffer(),
        left: FRAME * 2,
        top: 0,
      },
      {
        input: await sharp(sheet)
          .extract({ left: FRAME, top: 0, width: FRAME, height: FRAME })
          .resize(FRAME * 2, FRAME * 2, { kernel: 'nearest' })
          .png()
          .toBuffer(),
        left: FRAME * 4,
        top: 0,
      },
    ])
    .png()
    .toFile('References/event-art/medal-preview.png');
}
