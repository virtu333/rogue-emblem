// Dev: one roster id, traced sprite cropped to its bounds and enlarged next to its native.
// Usage: node tools/art/sprite-trace/dev/one.mjs OUT.png id [density] [zoom] [crop x,y,w,h in sprite px]
import { readRaster, writePng } from '../lib/io.mjs';
import { splitFigures } from '../lib/figures.mjs';
import { recoverFigure, traceNative } from '../lib/trace.mjs';
import { render } from '../lib/render.mjs';
import { Raster, hstack } from '../lib/raster.mjs';
import { ROSTER } from '../roster.mjs';

const [out, id, dArg, zArg, cropArg] = process.argv.slice(2);
const density = +dArg || 1.5;
const Z = +zArg || 8;
const e = ROSTER.sources[id];
const r = await readRaster(e.src);
const box = e.figure != null ? splitFigures(r, e.figures ?? 3)[e.figure] : r.alphaBounds(64);
const { native } = recoverFigure(r.crop(box.x, box.y, box.width, box.height), e.recover || {});
const t = traceNative(native, e, { density });
const img = render(t.sprite, { ramps: t.ramps, eye: t.eye });
let b = img.alphaBounds(0);
if (cropArg) {
  const [x, y, w, h] = cropArg.split(',').map(Number);
  b = { x: b.x + x, y: b.y + y, width: w, height: h };
}
const bg = (im) => new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, [92, 104, 84, 255]).draw(im, 0, 0);
const tr = bg(img.crop(b.x - 1, b.y - 1, b.width + 2, b.height + 2)).scale(Z);
const nz = Math.max(1, Math.round((tr.h / native.h) * 1));
const nat = cropArg ? null : bg(native).scale(Math.max(1, Math.floor(tr.h / native.h)));
await writePng(nat ? hstack([nat, tr], 8, [24, 24, 28, 255]) : tr, out);
console.log(id, JSON.stringify(t.sprite.meta), 'bounds', JSON.stringify(b), nz);
