// Dev: where a person's skin and hair land on every generic player design. Per design:
// the recovered reference and its segmentation (both cropped to the figure, with a 10 %
// grid: the unit of roster `rects` boxes), then the baked slot map (hair = green,
// skin = peach, leather = dark brown, main = blue, see SLOT_DEBUG).
//   node tools/art/sprite-trace/dev/slots-sheet.mjs <out.png> [--classes a,b] [--designs a,b]
//        [--zoom 3]
import { traceId, loadNative } from '../lib/pipeline.mjs';
import { GENERIC_CLASSES } from '../roster.mjs';
import { writePng, textRaster } from '../lib/io.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { render } from '../lib/render.mjs';
import { SLOT, SLOT_DEBUG } from '../lib/slots.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const Z = +flag('zoom', 3);
const only = flag('classes', null)?.split(',');
const designs = flag('designs', 'a,b').split(',');
const INK = [24, 24, 28, 255];
const BG = [92, 104, 84, 255];
const COLOURS = {
  ...SLOT_DEBUG,
  [SLOT.hair]: [0, 220, 0],
  [SLOT.skin]: [255, 200, 160],
  [SLOT.leather]: [110, 60, 30],
  [SLOT.accent]: [230, 60, 200],
  [SLOT.ink]: [0, 0, 0],
};
const ramps = Object.fromEntries(Object.entries(COLOURS).map(([s, c]) => [s, [c, c, c, c, c]]));
const bg = (im) => new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, BG).draw(im, 0, 0);

/** Crop to bounds, scale to `height`, draw the 10 % grid (bold at 50 %). */
function gridded(im, b, height) {
  const k = Math.max(1, Math.round(height / b.height));
  const out = bg(im.crop(b.x, b.y, b.width, b.height)).scale(k);
  for (let i = 1; i < 10; i++) {
    const c = i === 5 ? [255, 255, 0, 255] : [200, 200, 200, 255];
    const x = Math.round((i / 10) * b.width * k),
      y = Math.round((i / 10) * b.height * k);
    for (let yy = 0; yy < out.h; yy++) out.draw(new Raster(1, 1).fillRect(0, 0, 1, 1, c), x, yy);
    for (let xx = 0; xx < out.w; xx++) out.draw(new Raster(1, 1).fillRect(0, 0, 1, 1, c), xx, y);
  }
  return out;
}

const rows = [];
for (const [cls] of GENERIC_CLASSES) {
  if (only && !only.includes(cls)) continue;
  const cells = [await textRaster(cls, { size: 12, bg: '#18181c', width: 110 })];
  for (const d of designs) {
    const t = await traceId(`${cls}_${d}`);
    const { native } = await loadNative(`${cls}_${d}`);
    const seg = t.seg;
    const b = seg.bounds;
    const segIm = new Raster(seg.w, seg.h);
    for (let p = 0; p < seg.w * seg.h; p++)
      if (seg.slot[p]) segIm.set(p % seg.w, (p / seg.w) | 0, [...COLOURS[seg.slot[p]], 255]);
    const H = 70 * Z;
    const map = render(t.sprite, { ramps, eye: [255, 0, 255], outline: false });
    const mb = map.alphaBounds(0);
    cells.push(
      gridded(native, b, H),
      gridded(segIm, b, H),
      bg(map.crop(mb.x - 1, mb.y - 1, mb.width + 2, mb.height + 2)).scale(Z),
    );
  }
  rows.push(hstack(cells, 8, INK));
}
await writePng(vstack(rows, 8, INK), args[0]);
