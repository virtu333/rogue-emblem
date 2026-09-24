// Region fields: smooth, cell-scale "how much of this is around here" values
// that let the ground and the objects follow the shape of a region (the
// middle of a wood is shadier than its edge, open water is deeper away from
// the shore, moss gathers where walls meet the floor) without ever reading
// past the cell's own 3x3 neighbourhood.
//
// Each cell corner gets the share of the four cells around it that match a
// predicate. A pixel interpolates its own cell's four corners (smoothstep),
// so the field is continuous across cell borders: the two cells on either
// side of a border see the same two corners there.
import { ART_CELL as CELL } from './state.js';

const SMOOTH = Float32Array.from({ length: CELL }, (_, u) => {
  const t = (u + 0.5) / CELL;
  return t * t * (3 - 2 * t);
});

/**
 * Corner shares for cell (c, r): out[o..o+3] = top-left, top-right,
 * bottom-left, bottom-right. `test(c, r)` returns 0/1 (clamped at the map
 * edge by the caller's choice of accessor).
 */
export function cornerShares(test, c, r, out, o = 0) {
  const n = new Uint8Array(9);
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) n[(j + 1) * 3 + i + 1] = test(c + i, r + j);
  const at = (i, j) => n[(j + 1) * 3 + i + 1];
  const own = at(0, 0);
  out[o] = (own + at(-1, 0) + at(0, -1) + at(-1, -1)) / 4;
  out[o + 1] = (own + at(1, 0) + at(0, -1) + at(1, -1)) / 4;
  out[o + 2] = (own + at(-1, 0) + at(0, 1) + at(-1, 1)) / 4;
  out[o + 3] = (own + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
  return out;
}

/** Field value at cell-local art px (u, v) from corner shares at out[o..o+3]. */
export function fieldAt(cv, o, u, v) {
  const tx = SMOOTH[u],
    ty = SMOOTH[v];
  const top = cv[o] + (cv[o + 1] - cv[o]) * tx;
  const bot = cv[o + 2] + (cv[o + 3] - cv[o + 2]) * tx;
  return top + (bot - top) * ty;
}
