// Dev: review sheet — for each roster id: source native (scaled to match) | traced, enlarged.
// Usage: node tools/art/sprite-trace/dev/sheet.mjs OUT.png ZOOM id,id,... [density] [mode]
import { readRaster, writePng, textRaster } from '../lib/io.mjs';
import { splitFigures } from '../lib/figures.mjs';
import { recoverFigure, traceNative } from '../lib/trace.mjs';
import { render } from '../lib/render.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { ROSTER } from '../roster.mjs';

const [out, zoomArg, ids, dArg, mode] = process.argv.slice(2);
const Z = +zoomArg || 5;
const density = +dArg || 1.5;
const want = ids ? ids.split(',') : Object.keys(ROSTER.sources);
const tiles = [];
for (const id of want) {
  const e = ROSTER.sources[id];
  if (!e) throw new Error(`unknown id ${id}`);
  const r = await readRaster(e.src);
  const box = e.figure != null ? splitFigures(r, e.figures ?? 3)[e.figure] : r.alphaBounds(64);
  const { native } = recoverFigure(r.crop(box.x, box.y, box.width, box.height), e.recover || {});
  const t = traceNative(native, e, { density, mode: mode || 'area' });
  const img = render(t.sprite, { ramps: t.ramps, eye: t.eye });
  const size = img.w;
  const bg = (im) => new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, [92, 104, 84, 255]).draw(im, 0, 0);
  const nat = bg(native).resizeNearest(
    Math.round((native.w * size * Z * 0.72) / native.h),
    Math.round(size * Z * 0.72),
  );
  const label = await textRaster(`${id}  s=${t.sprite.meta.scale.toFixed(2)} n=${native.w}x${native.h} c=${img.colorCount()}`, {
    size: 11,
    bg: '#18181c',
    width: nat.w + size * Z + 6,
  });
  tiles.push(vstack([label, hstack([nat, bg(img).scale(Z)], 6, [24, 24, 28, 255])]));
}
const rows = [];
for (let i = 0; i < tiles.length; i += 3) rows.push(hstack(tiles.slice(i, i + 3), 10, [24, 24, 28, 255]));
await writePng(vstack(rows, 10, [24, 24, 28, 255]), out);
