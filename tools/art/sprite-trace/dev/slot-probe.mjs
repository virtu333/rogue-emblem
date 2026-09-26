// Dev: a design's segmentation as text, to place person-fit boxes (normalised to the
// figure's bounds; the rulers are in tenths).
//   node tools/art/sprite-trace/dev/slot-probe.mjs <roster id> [y0 y1 [x0 x1]] [--raw]
//   --raw ignores the design's person fit (the bare colour rules)
// . empty  # ink  e eye  s skin  h hair  m main  u sub  l leather  x metal  a armor
// t trim  n linen  w wood  M mount  N mane  g glow  c accent
import { traceId } from '../lib/pipeline.mjs';
import { ROSTER } from '../roster.mjs';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const [id, a = '0', b = '0.4', c = '0', d = '1'] = args.filter((x) => x !== '--raw');
if (raw) {
  const e = ROSTER.sources[id];
  delete e.match;
  delete e.fitRects;
}
const { seg } = await traceId(id);
const CH = '.#eshmulxatnwMNgc';
const bb = seg.bounds;
const y0 = Math.floor(bb.y + +a * bb.height),
  y1 = Math.ceil(bb.y + +b * bb.height);
let ruler = '      ';
const xs0 = Math.floor(bb.x + +c * bb.width),
  xs1 = Math.ceil(bb.x + +d * bb.width);
for (let x = xs0; x < xs1; x++) {
  const t = Math.floor(((x - bb.x) / bb.width) * 10);
  const prev = Math.floor(((x - 1 - bb.x) / bb.width) * 10);
  ruler += x === xs0 || t !== prev ? String(t) : ' ';
}
console.log(`${id} ${bb.width}x${bb.height}`);
console.log(ruler);
for (let y = y0; y < y1; y++) {
  let line = ((y - bb.y) / bb.height).toFixed(2).padStart(5) + ' ';
  for (let x = xs0; x < xs1; x++) line += CH[seg.slot[y * seg.w + x]] ?? '?';
  console.log(line);
}
