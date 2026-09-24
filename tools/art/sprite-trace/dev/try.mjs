// Dev: trace figures and show [native | traced D=1.5 | traced D=1 | nearest D=1] enlarged.
// Usage: node tools/art/sprite-trace/dev/try.mjs OUT.png ZOOM 'file[:fig]|{recipe json}' ...
import { readRaster, writePng } from '../lib/io.mjs';
import { splitFigures } from '../lib/figures.mjs';
import { recoverFigure, traceNative } from '../lib/trace.mjs';
import { render } from '../lib/render.mjs';
import { Raster, hstack } from '../lib/raster.mjs';

const [out, zoomArg, ...specs] = process.argv.slice(2);
const Z = +zoomArg || 4;
const cols = [];
for (const spec of specs) {
  const [src, json] = spec.split('|');
  const [file, fig] = src.split(':');
  const recipe = json ? JSON.parse(json) : {};
  const r = await readRaster(file);
  const box = fig != null ? splitFigures(r, 3)[+fig] : r.alphaBounds(64);
  const crop = r.crop(box.x, box.y, box.width, box.height);
  const { native } = recoverFigure(crop);
  const t15 = traceNative(native, recipe, { density: 1.5 });
  const t10 = traceNative(native, recipe, { density: 1.5, mode: 'area' });
  const pal = (t) => ({ ramps: t.ramps, eye: t.eye });
  const r15 = render(t15.sprite, pal(t15));
  const r10 = render(t10.sprite, pal(t10));
  // what the game does today: nearest-sample the source crop into the 64px placement
  const nb = crop.alphaBounds(10);
  const sc = Math.min(38 / nb.width, 34 / nb.height);
  const near = crop
    .crop(nb.x, nb.y, nb.width, nb.height)
    .resizeNearest(Math.round(nb.width * sc), Math.round(nb.height * sc));
  const n64 = new Raster(64, 64).draw(near, Math.round((64 - near.w) / 2), 44 - near.h);
  const bg = (img) =>
    new Raster(img.w, img.h).fillRect(0, 0, img.w, img.h, [92, 104, 84, 255]).draw(img, 0, 0);
  // show D=1.5 at Z, D=1 and nearest at Z*1.5 so world size matches
  cols.push(
    hstack(
      [
        bg(native).scale(Math.max(1, Math.round((Z * 64) / Math.max(native.h, 64) / 1.5))),
        bg(r15.crop(8, 0, 80, 96)).scale(Z),
        bg(r10.crop(8, 0, 80, 96)).scale(Z),
        bg(n64.crop(5, 0, 54, 64)).resizeNearest(54 * Z * 1.5, 64 * Z * 1.5),
      ],
      6,
      [24, 24, 28, 255],
    ),
  );
  console.log(src, JSON.stringify(t15.sprite.meta), 'colors', r15.colorCount());
}
const { vstack } = await import('../lib/raster.mjs');
await writePng(vstack(cols, 8, [24, 24, 28, 255]), out);
