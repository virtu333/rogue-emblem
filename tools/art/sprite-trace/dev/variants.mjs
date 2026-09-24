// Dev: compare recipe variants for roster ids side by side (traced sprites cropped to bounds).
// Usage: node tools/art/sprite-trace/dev/variants.mjs OUT.png ZOOM DENSITY ids 'json;json;...'
//   each json is merged over the roster recipe; add "mode":"area" to use the area reducer.
import { readRaster, writePng, textRaster } from '../lib/io.mjs';
import { splitFigures } from '../lib/figures.mjs';
import { recoverFigure, traceNative } from '../lib/trace.mjs';
import { render } from '../lib/render.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { ROSTER } from '../roster.mjs';

const [out, zArg, dArg, ids, variantsArg] = process.argv.slice(2);
const Z = +zArg || 6;
const density = +dArg || 1.5;
const variants = (variantsArg || '{}').split(';').map((v) => JSON.parse(v || '{}'));
const rows = [];
const bg = (im) =>
  new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, [92, 104, 84, 255]).draw(im, 0, 0);
for (const id of ids.split(',')) {
  const base = ROSTER.sources[id];
  const r = await readRaster(base.src);
  const box =
    base.figure != null ? splitFigures(r, base.figures ?? 3)[base.figure] : r.alphaBounds(64);
  const { native, pitch } = recoverFigure(
    r.crop(box.x, box.y, box.width, box.height),
    base.recover || {},
  );
  const aspect = pitch.y / pitch.x;
  const cells = [];
  let H = 0;
  const imgs = [];
  for (const v of variants) {
    const e = { ...base, ...v };
    const t = traceNative(native, e, {
      density: v.density || density,
      mode: v.mode || null,
      aspect,
    });
    const img = render(t.sprite, { ramps: t.ramps, eye: t.eye, outline: e.peel !== false });
    const b = img.alphaBounds(0);
    const c = bg(img.crop(b.x - 1, b.y - 1, b.width + 2, b.height + 2)).scale(Z);
    imgs.push([c, v]);
    H = Math.max(H, c.h);
  }
  cells.push(bg(native).resizeNearest(Math.round((native.w * H) / native.h), H));
  for (const [c, v] of imgs) {
    const label = await textRaster(JSON.stringify(v).slice(0, 60), {
      size: 10,
      bg: '#18181c',
      width: c.w,
    });
    cells.push(vstack([c, label]));
  }
  rows.push(hstack(cells, 8, [24, 24, 28, 255]));
}
await writePng(vstack(rows, 8, [24, 24, 28, 255]), out);
