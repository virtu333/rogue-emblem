// Dev: natives of roster ids with a 10% grid (normalised recipe coordinates) + slot map.
// Usage: node tools/art/sprite-trace/dev/grid.mjs OUT.png id,id,... [zoom]
import { writePng, textRaster } from '../lib/io.mjs';
import { loadNative } from '../lib/pipeline.mjs';
import { segment } from '../lib/segment.mjs';
import { SLOT_DEBUG } from '../lib/slots.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { ROSTER } from '../roster.mjs';

const [out, ids, zArg] = process.argv.slice(2);
const Z = +zArg || 4;
const tiles = [];
for (const id of ids.split(',')) {
  const { native } = await loadNative(id);
  const seg = segment(native, ROSTER.sources[id]);
  const bb = native.alphaBounds(0);
  const a = new Raster(native.w, native.h)
    .fillRect(0, 0, native.w, native.h, [60, 70, 60, 255])
    .draw(native, 0, 0)
    .scale(Z);
  const m = new Raster(native.w, native.h);
  for (let p = 0; p < native.w * native.h; p++) {
    const c = SLOT_DEBUG[seg.slot[p]];
    if (c) m.d.set([...c, 255], p * 4);
  }
  const b = m.scale(Z);
  for (const img of [a, b])
    for (let k = 1; k < 10; k++) {
      const gx = Math.round((bb.x + (bb.width * k) / 10) * Z),
        gy = Math.round((bb.y + (bb.height * k) / 10) * Z);
      const col = k === 5 ? [255, 255, 0, 200] : [255, 60, 60, 140];
      img.fillRect(gx, 0, 1, img.h, col);
      img.fillRect(0, gy, img.w, 1, col);
    }
  const label = await textRaster(`${id} ${native.w}x${native.h}`, {
    size: 11,
    bg: '#18181c',
    width: a.w * 2 + 4,
  });
  tiles.push(vstack([label, hstack([a, b], 4, [20, 20, 24, 255])]));
}
const rows = [];
for (let i = 0; i < tiles.length; i += 3)
  rows.push(hstack(tiles.slice(i, i + 3), 10, [20, 20, 24, 255]));
await writePng(vstack(rows, 10, [20, 20, 24, 255]), out);
