#!/usr/bin/env node
// Contact sheet for design review: every icon of the chosen groups at 16/32/48 on the
// UI panel colour, scaled up with nearest-neighbour so single pixels can be judged.
//   node tools/art/icons/preview.mjs [--groups Tome,Blessings] [--scale 3] [--out file.png]
import { renderIcon } from './lib/pixelIcon.mjs';
import { MATERIALS, PANELS } from './lib/palette.mjs';
import { blank, fillRect, put, save } from './lib/sheet.mjs';
import { iconEntries, loadData } from './lib/catalog.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const groups = arg('groups', null)?.split(',');
const ids = arg('ids', null)?.split(',');
const scale = Number(arg('scale', 3));
const out = arg('out', 'References/items-art/preview.png');
const sizes = (arg('sizes', '16,32,48') || '').split(',').map(Number);

const entries = iconEntries(loadData()).filter(
  (e) => (!groups || groups.includes(e.group)) && (!ids || ids.includes(e.id)),
);
const cell = Math.max(...sizes) + 8;
const cols = Math.min(12, entries.length);
const rowH = sizes.reduce((a, s) => a + s + 6, 0) + 4;
const img = blank(
  cols * (sizes.length ? cell : 0),
  Math.ceil(entries.length / cols) * rowH,
  PANELS.bg,
);
entries.forEach((e, i) => {
  const x = (i % cols) * cell;
  let y = Math.floor(i / cols) * rowH + 2;
  fillRect(img, x + 1, y, cell - 2, rowH - 4, PANELS.panel);
  for (const s of sizes) {
    put(img, renderIcon(e.spec, s, MATERIALS), x + Math.floor((cell - s) / 2), y + 2);
    y += s + 6;
  }
});
await save(img, out, { scale });
console.log(`${entries.length} icons -> ${out}`);
console.log(entries.map((e, i) => `${i}:${e.id}`).join(' '));
