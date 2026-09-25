// List every generated take's recovered grid and trace scale (see gen-refs.mjs).
//   node tools/art/sprite-trace/dev/takes-scales.mjs [id,id] [--dir References/sprite-refs-2026-09-25/takes]
import { readdirSync } from 'node:fs';
import { readRaster } from '../lib/io.mjs';
import { recoverFigure, traceNative } from '../lib/trace.mjs';
import { ROSTER } from '../roster.mjs';

const args = process.argv.slice(2);
const di = args.indexOf('--dir');
const dir = di >= 0 ? args[di + 1] : 'References/sprite-refs-2026-09-25/takes';
const only = args[0] && !args[0].startsWith('--') ? args[0].split(',') : null;
for (const f of readdirSync(dir).sort()) {
  const id = f.replace(/-\d+\.png$/, '');
  if (only && !only.includes(id)) continue;
  const src = await readRaster(`${dir}/${f}`);
  const b = src.alphaBounds(64);
  const r = recoverFigure(src.crop(b.x, b.y, b.width, b.height));
  const t = traceNative(r.native, { ...ROSTER.sources[id], src: undefined }, { density: 1.5 });
  console.log(
    [
      f,
      `${r.native.w}x${r.native.h}`,
      `pitch ${(+r.pitch?.x || 0).toFixed(1)}`,
      `conf ${(+r.confidence || 0).toFixed(2)}`,
      r.mode,
      `s ${t.sprite.meta.scale.toFixed(2)}`,
    ].join('\t'),
  );
}
