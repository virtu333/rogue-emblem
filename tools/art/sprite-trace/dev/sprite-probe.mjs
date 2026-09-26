// Dev: a traced sprite's slot map and shades (the baked grid, before colour), top rows.
//   node tools/art/sprite-trace/dev/sprite-probe.mjs <roster id> [rows=30]
// Each pixel prints as its slot letter (see slot-probe.mjs) and shade digit.
import { traceId } from '../lib/pipeline.mjs';

const [id, rows = '30'] = process.argv.slice(2);
const { sprite: sp } = await traceId(id);
const CH = '.#eshmulxatnwMNgc';
const b = sp.bounds();
for (let y = b.y; y < Math.min(b.y + +rows, b.y + b.height); y++) {
  let line = String(y).padStart(3) + ' ';
  for (let x = b.x; x < b.x + b.width; x++) {
    const s = sp.at(x, y);
    line += s ? CH[s] + sp.shadeAt(x, y) : '  ';
  }
  console.log(line);
}
