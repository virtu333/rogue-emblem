// Dev: the LCh colours of one slot's pixels inside a normalised box of a design, as a
// text map (L/10 digit, or '.') and a summary, to choose a person-fit `where` family.
//   node tools/art/sprite-trace/dev/colour-probe.mjs <roster id> <slot> x0 y0 x1 y1
import { traceId } from '../lib/pipeline.mjs';
import { SLOT } from '../lib/slots.mjs';
import { lch } from '../lib/color.mjs';

const [id, slot, ...box] = process.argv.slice(2);
const [x0, y0, x1, y1] = box.map(Number);
const { seg } = await traceId(id);
const b = seg.bounds;
const rows = [];
const all = [];
for (let y = Math.floor(b.y + y0 * b.height); y < Math.ceil(b.y + y1 * b.height); y++) {
  let line = '';
  for (let x = Math.floor(b.x + x0 * b.width); x < Math.ceil(b.x + x1 * b.width); x++) {
    const p = y * seg.w + x;
    if (seg.slot[p] !== SLOT[slot]) {
      line += '.';
      continue;
    }
    const [L, C, h] = lch([seg.lab[p * 3], seg.lab[p * 3 + 1], seg.lab[p * 3 + 2]]);
    all.push([L, C, h]);
    line += process.argv.includes('--light')
      ? String(Math.min(9, Math.floor(L / 10)))
      : C < 14
        ? 'g'
        : h > 270 || h < 30
          ? 'v'
          : h < 90
            ? 'w'
            : h < 200
              ? 'x'
              : 'b';
  }
  rows.push(line);
}
console.log(rows.join('\n'));
console.log('g grey (C<14), v violet/red, w warm, x green, b blue');
const q = (i) => all.map((v) => v[i]).sort((a, c) => a - c);
for (const [i, n] of [
  [0, 'L'],
  [1, 'C'],
  [2, 'h'],
]) {
  const s = q(i);
  console.log(
    n,
    [0.1, 0.5, 0.9].map((f) => s[Math.floor(f * (s.length - 1))]?.toFixed(0)).join(' '),
  );
}
