// Bridge decks. Orientation follows the game's own rule (WeatheredTerrain):
// a bridge with an east/west bridge neighbour, or with water north/south and
// no north/south bridge neighbour, runs east-west; otherwise north-south.
// Spans merge, rails appear only on outer edges, posts mark the rails and
// each deck casts a short shadow onto the water inside its own cell.
//
// Everything is derived from the cell's own 3x3 neighbourhood: a
// neighbouring bridge's orientation is only needed when it touches this
// bridge, and then its answer depends on cells this cell can also see.
import { R } from './palette.js';
import { hash2 } from './noise.js';
import { G } from './biomes.js';
import { ART_CELL as CELL } from './state.js';

const isB = (S, c, r) => S.is(c, r, 'Bridge');
const isWater = (S, c, r) => S.is(c, r, 'Water') || S.is(c, r, 'River');

/** 1 = east-west deck, 2 = north-south deck. */
export function bridgeOrientation(S, c, r) {
  const lr = isB(S, c - 1, r) || isB(S, c + 1, r),
    ud = isB(S, c, r - 1) || isB(S, c, r + 1);
  if (lr) return 1;
  if (ud) return 2;
  return isWater(S, c, r - 1) || isWater(S, c, r + 1) ? 1 : 2;
}

/**
 * Deck rectangles of a bridge cell in cell-local art px, with the edges
 * that are open (get rails).
 */
export function deckRects(S, c, r) {
  const o = bridgeOrientation(S, c, r);
  const rects = [];
  if (o === 1) {
    // A north / south bridge neighbour of an east-west bridge is itself
    // east-west only when it has its own east / west bridge neighbour.
    const ewAt = (rr) => isB(S, c, rr) && (isB(S, c - 1, rr) || isB(S, c + 1, rr));
    const up = ewAt(r - 1),
      dn = ewAt(r + 1);
    const top = up ? 0 : 5,
      bottom = dn ? CELL : 19;
    rects.push({ x0: 0, y0: top, x1: CELL, y1: bottom, o, railTop: !up, railBottom: !dn });
    // connectors to a north-south deck above / below
    if (isB(S, c, r - 1) && !up)
      rects.push({ x0: 6, y0: 0, x1: 18, y1: top, o: 2, railLeft: true, railRight: true });
    if (isB(S, c, r + 1) && !dn)
      rects.push({ x0: 6, y0: bottom, x1: 18, y1: CELL, o: 2, railLeft: true, railRight: true });
  } else {
    rects.push({ x0: 6, y0: 0, x1: 18, y1: CELL, o, railLeft: true, railRight: true });
  }
  return rects;
}

function inRects(rects, u, v) {
  for (const k of rects) if (u >= k.x0 && u < k.x1 && v >= k.y0 && v < k.y1) return k;
  return null;
}

export function passBridges(S, x0, y0, x1, y1) {
  const { W, seed } = S;
  const S_ = (k) => R('soil', k);
  const c0 = (x0 / CELL) | 0,
    c1 = ((x1 - 1) / CELL) | 0,
    r0 = (y0 / CELL) | 0,
    r1 = ((y1 - 1) / CELL) | 0;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (!isB(S, c, r)) continue;
      const rects = deckRects(S, c, r);
      const landW = !isB(S, c - 1, r) && !isWater(S, c - 1, r) && S.inMap(c - 1, r);
      const landE = !isB(S, c + 1, r) && !isWater(S, c + 1, r) && S.inMap(c + 1, r);
      const landN = !isB(S, c, r - 1) && !isWater(S, c, r - 1) && S.inMap(c, r - 1);
      const landS = !isB(S, c, r + 1) && !isWater(S, c, r + 1) && S.inMap(c, r + 1);
      const ux0 = Math.max(0, x0 - c * CELL),
        ux1 = Math.min(CELL, x1 - c * CELL);
      const vy0 = Math.max(0, y0 - r * CELL),
        vy1 = Math.min(CELL, y1 - r * CELL);
      for (let v = vy0; v < vy1; v++)
        for (let u = ux0; u < ux1; u++) {
          const x = c * CELL + u,
            y = r * CELL + v,
            i = y * W + x;
          const k = inRects(rects, u, v);
          if (!k) {
            // Shadow of the deck on the water below / right, inside this cell.
            if (S.mat[i] === G.WATER) {
              for (const [dx, dy] of [
                [1, 1],
                [1, 2],
                [2, 2],
                [2, 3],
              ])
                if (u - dx >= 0 && v - dy >= 0 && inRects(rects, u - dx, v - dy)) {
                  S.shadow[i] = Math.max(S.shadow[i], 1);
                  break;
                }
            }
            continue;
          }
          let t;
          if (k.o === 1) {
            // planks run north-south, laid side by side along x
            const plank = Math.floor(x / 3);
            t =
              x % 3 === 2
                ? S_(3)
                : hash2(plank, Math.floor(y / CELL), seed + 601) % 4 === 0
                  ? S_(6)
                  : S_(5);
            const rt = k.railTop && v - k.y0 < 2,
              rb = k.railBottom && k.y1 - 1 - v < 2;
            if (rt) t = v === k.y0 ? S_(7) : S_(4);
            if (rb) t = v === k.y1 - 1 ? S_(1) : S_(3);
            // posts every 8 px along the rails
            if ((rt || rb) && x % 8 === 3) t = v === k.y0 ? S_(8) : S_(2);
            // end beams where the deck lands on a bank
            if ((u === 0 && landW) || (u === CELL - 1 && landE)) t = S_(2);
          } else {
            // planks run east-west, stacked along y
            const plank = Math.floor(y / 3);
            t =
              y % 3 === 2
                ? S_(3)
                : hash2(plank, Math.floor(x / CELL), seed + 602) % 4 === 0
                  ? S_(6)
                  : S_(5);
            const rl = k.railLeft && u - k.x0 < 2,
              rr = k.railRight && k.x1 - 1 - u < 2;
            if (rl) t = u === k.x0 ? S_(7) : S_(4);
            if (rr) t = u === k.x1 - 1 ? S_(1) : S_(3);
            if ((rl || rr) && y % 8 === 3) t = u === k.x0 ? S_(8) : S_(2);
            if ((v === 0 && landN) || (v === CELL - 1 && landS)) t = S_(2);
          }
          S.idx[i] = t;
          S.anim[i] = 0;
        }
    }
}
