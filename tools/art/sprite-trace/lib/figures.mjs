// Separate the figures of a review sheet (Player A / Player B / Enemy, left to right)
// using transparent column gutters, then tighten each to its alpha bounds. Pure.

/**
 * Split a sheet into `count` figures. Columns whose alpha mass is ~0 are gutters;
 * the widest gutters between the figures' mass become the cuts (so a sword tip that
 * pokes into the gap stays with its owner).
 * Returns [{ x, y, width, height }] sorted left to right.
 */
export function splitFigures(r, count = 3, { alphaMin = 64 } = {}) {
  const colMass = new Float64Array(r.w);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) if (r.d[(y * r.w + x) * 4 + 3] >= alphaMin) colMass[x]++;
  // runs of empty columns
  const gaps = [];
  let start = -1;
  for (let x = 0; x <= r.w; x++) {
    const empty = x < r.w && colMass[x] === 0;
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) {
      if (start > 0 && x < r.w) gaps.push({ a: start, b: x, width: x - start });
      start = -1;
    }
  }
  // choose the count-1 widest interior gaps
  const cuts = gaps
    .sort((p, q) => q.width - p.width)
    .slice(0, count - 1)
    .sort((p, q) => p.a - q.a)
    .map((g) => Math.round((g.a + g.b) / 2));
  const edges = [0, ...cuts, r.w];
  const out = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const x0 = edges[k],
      x1 = edges[k + 1];
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -1,
      by1 = -1;
    for (let y = 0; y < r.h; y++)
      for (let x = x0; x < x1; x++)
        if (r.d[(y * r.w + x) * 4 + 3] >= alphaMin) {
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
    if (bx1 >= 0) out.push({ x: bx0, y: by0, width: bx1 - bx0 + 1, height: by1 - by0 + 1 });
  }
  return out;
}

/** Keep only the largest 8-connected opaque component (+ components touching it within `join` px). */
export function largestComponent(r, { alphaMin = 128, join = 3 } = {}) {
  const n = r.w * r.h;
  const lab = new Int32Array(n).fill(-1);
  const sizes = [];
  const boxes = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] >= 0 || r.d[s * 4 + 3] < alphaMin) continue;
    const id = sizes.length;
    let size = 0;
    const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % r.w,
        y = (p / r.w) | 0;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx,
            Y = y + dy;
          if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
          const q = Y * r.w + X;
          if (lab[q] >= 0 || r.d[q * 4 + 3] < alphaMin) continue;
          lab[q] = id;
          stack.push(q);
        }
    }
    sizes.push(size);
    boxes.push(box);
  }
  if (!sizes.length) return r.clone();
  const main = sizes.indexOf(Math.max(...sizes));
  const keep = new Set([main]);
  // keep small satellites near the main body (sparkles of a tome, loose hair strands)
  const mb = boxes[main];
  boxes.forEach((b, id) => {
    if (id === main) return;
    const near =
      b.x1 >= mb.x0 - join && b.x0 <= mb.x1 + join && b.y1 >= mb.y0 - join && b.y0 <= mb.y1 + join;
    if (near && sizes[id] >= 2) keep.add(id);
  });
  const out = r.clone();
  for (let p = 0; p < n; p++) if (lab[p] >= 0 && !keep.has(lab[p])) out.d[p * 4 + 3] = 0;
  return out;
}
