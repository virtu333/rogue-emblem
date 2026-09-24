// Dev: native | slot false-colour map for quick segmentation review.
// Usage: node tools/art/sprite-trace/dev/slotmap.mjs OUT.png 'file[:fig]|{"main":"blue","hair":"brown"}' ...
import { readRaster, writePng } from '../lib/io.mjs';
import { recoverGrid } from '../lib/grid.mjs';
import { splitFigures, largestComponent } from '../lib/figures.mjs';
import { segment } from '../lib/segment.mjs';
import { SLOT_DEBUG } from '../lib/slots.mjs';
import { Raster, hstack } from '../lib/raster.mjs';

const [out, ...specs] = process.argv.slice(2);
const cols = [];
for (const spec of specs) {
  const [src, json] = spec.split('|');
  const [file, fig] = src.split(':');
  const recipe = json ? JSON.parse(json) : {};
  const r = await readRaster(file);
  const box = fig != null ? splitFigures(r, 3)[+fig] : r.alphaBounds(64);
  const cut = largestComponent(r.crop(box.x, box.y, box.width, box.height), { alphaMin: 64 });
  const { native } = recoverGrid(cut);
  const seg = segment(native, recipe);
  const m = new Raster(native.w, native.h);
  for (let p = 0; p < native.w * native.h; p++) {
    const c = SLOT_DEBUG[seg.slot[p]];
    if (c) m.d.set([...c, 255], p * 4);
  }
  const [x0, y0, x1, y1] = seg.head;
  for (let x = x0; x < x1; x++) {
    m.set(x, y0, [255, 0, 0, 255]);
    m.set(x, y1 - 1, [255, 0, 0, 255]);
  }
  const bg = new Raster(native.w, native.h).fillRect(0, 0, native.w, native.h, [60, 70, 60, 255]);
  let a = bg.clone().draw(native, 0, 0),
    b = m;
  const Z = +(process.env.ZOOM || 3);
  if (process.env.HEAD) {
    const pad = 3;
    const box = [
      Math.max(0, x0 - pad),
      Math.max(0, y0 - pad),
      x1 - x0 + pad * 2,
      y1 - y0 + pad * 2,
    ];
    a = a.crop(...box);
    b = b.crop(...box);
  }
  cols.push(hstack([a.scale(Z), b.scale(Z)], 4));
}
await writePng(hstack(cols, 12, [20, 20, 24, 255]), out);
