// Dev: show the colour clusters of a recovered native figure as masks + LCh labels.
// Usage: node tools/art/sprite-trace/dev/clusters.mjs OUT.png file[:figure] [K]
import { readRaster, writePng, textRaster } from '../lib/io.mjs';
import { recoverGrid } from '../lib/grid.mjs';
import { splitFigures, largestComponent } from '../lib/figures.mjs';
import { clusterRaster } from '../lib/cluster.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';

const [out, spec, K = '22'] = process.argv.slice(2);
const [file, fig] = spec.split(':');
const r = await readRaster(file);
const box = fig != null ? splitFigures(r, 3)[+fig] : r.alphaBounds(64);
const cut = largestComponent(r.crop(box.x, box.y, box.width, box.height), { alphaMin: 64 });
const { native } = recoverGrid(cut);
const { clusters } = clusterRaster(native, +K);
const z = 3;
const tiles = [];
for (const c of clusters) {
  const m = new Raster(native.w, native.h);
  m.fillRect(0, 0, native.w, native.h, [40, 44, 40, 255]);
  for (let i = 0; i < native.w * native.h; i++)
    if (native.d[i * 4 + 3]) m.d.set([70, 74, 70, 255], i * 4);
  for (const p of c.pixels) m.d.set([...native.d.subarray(p * 4, p * 4 + 3), 255], p * 4);
  const label = await textRaster(
    `${c.k} L${c.lch[0].toFixed(0)} C${c.lch[1].toFixed(0)} h${c.lch[2].toFixed(0)}\ny${c.cy.toFixed(2)} n${c.count}`,
    { size: 10, bg: '#1a1a20', width: native.w * z },
  );
  const sw = new Raster(native.w * z, 10).fillRect(0, 0, native.w * z, 10, [...c.rgb, 255]);
  tiles.push(vstack([m.scale(z), sw, label]));
}
const rows = [];
for (let i = 0; i < tiles.length; i += 8)
  rows.push(hstack(tiles.slice(i, i + 8), 4, [20, 20, 24, 255]));
await writePng(vstack([native.scale(z), ...rows], 4, [20, 20, 24, 255]), out);
console.log(
  clusters
    .map(
      (c) =>
        `${c.k}:${c.rgb} L${c.lch[0].toFixed(0)} C${c.lch[1].toFixed(0)} h${c.lch[2].toFixed(0)} cy${c.cy.toFixed(2)} n${c.count}`,
    )
    .join('\n'),
);
