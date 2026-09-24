// Dev: run grid recovery on sheets / rebuilt sprites and print pitch, confidence,
// native size and purity; writes enlarged natives for inspection.
// Usage: node tools/art/sprite-trace/dev/recover.mjs OUT_DIR file[:figureIndex] ...
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { readRaster, writePng } from '../lib/io.mjs';
import { recoverGrid } from '../lib/grid.mjs';
import { splitFigures, largestComponent } from '../lib/figures.mjs';

const [out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const spec of files) {
  const [file, fig] = spec.split(':');
  const r = await readRaster(file);
  const boxes = fig != null ? [splitFigures(r, 3)[+fig]] : [r.alphaBounds(64)];
  for (const [k, box] of boxes.entries()) {
    const t0 = performance.now();
    const cut = largestComponent(r.crop(box.x, box.y, box.width, box.height), { alphaMin: 64 });
    const res = recoverGrid(cut);
    const ms = performance.now() - t0;
    const nb = res.native.alphaBounds(0);
    console.log(
      `${basename(file)}${fig != null ? `:${fig}` : ''} pitch=${res.pitch.x.toFixed(3)}/${res.pitch.y.toFixed(3)} conf=${res.confidence.toFixed(2)} native=${res.native.w}x${res.native.h} body=${nb?.width}x${nb?.height} purity=${res.purity?.toFixed(1)} colors=${res.native.colorCount()} mode=${res.mode} ${ms.toFixed(0)}ms`,
    );
    await writePng(
      res.native.scale(6),
      `${out}/${basename(file, '.png')}${fig != null ? `-${fig}` : ''}${k ? `-${k}` : ''}.png`,
    );
  }
}
