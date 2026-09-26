// Dev: every generic class's two player designs (A | B) as recovered from their
// reference sheets, so the per-class design -> gender mapping (roster.mjs DESIGN_GENDER)
// can be checked by eye.   node tools/art/sprite-trace/dev/designs-sheet.mjs out.png [--zoom 2]
import { loadNative } from '../lib/pipeline.mjs';
import { GENERIC_CLASSES } from '../roster.mjs';
import { writePng, textRaster } from '../lib/io.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';

const out = process.argv[2];
const zi = process.argv.indexOf('--zoom');
const Z = zi > 0 ? +process.argv[zi + 1] : 2;
const only = process.argv.includes('--classes')
  ? process.argv[process.argv.indexOf('--classes') + 1].split(',')
  : null;
const bg = (im) =>
  new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, [92, 104, 84, 255]).draw(im, 0, 0);
const tiles = [];
for (const [cls] of GENERIC_CLASSES) {
  if (only && !only.includes(cls)) continue;
  const pair = [];
  for (const d of ['a', 'b']) {
    const { native } = await loadNative(`${cls}_${d}`);
    pair.push(bg(native).scale(Math.max(1, Math.round((Z * 70) / native.h))));
  }
  const label = await textRaster(cls, { size: 12, bg: '#18181c', width: 200 });
  tiles.push(vstack([hstack(pair, 6, [24, 24, 28, 255]), label]));
}
const rows = [];
for (let i = 0; i < tiles.length; i += 6)
  rows.push(hstack(tiles.slice(i, i + 6), 10, [24, 24, 28, 255]));
await writePng(vstack(rows, 10, [24, 24, 28, 255]), out);
