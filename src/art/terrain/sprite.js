// A small sprite owned by one map cell. Pixels live in a fixed local frame
// (the cell plus a FRAME_PAD margin) so building and compositing are cheap
// typed-array work. Each sprite knows its ground line (baseY) so it can cast
// a low-sun shadow toward the bottom-right.
//
// Locality. A part's look may depend on some of the cells around its owner
// (its "deps", e.g. whether the neighbours are forest too). Every pixel it
// paints, sprite or shadow, must then land in a cell whose own 3x3
// neighbourhood contains all of those deps, so that `repaintCells` can keep
// recomputing only the 3x3 neighbourhood of a changed cell. `setDeps`
// records the deps and derives the cells the part may paint into (`allow`,
// offsets from the owner); `fitTo` / `shadowBox` turn that into pixel boxes.
import { down, up } from './palette.js';
import { ART_CELL as CELL } from './state.js';

export const FRAME_PAD = 4;
export const FRAME = CELL + 2 * FRAME_PAD;

/**
 * Cells (offsets from the owner) a part may paint into when its look depends
 * on the owner-relative cell rectangle [di0..di1] x [dj0..dj1]: exactly the
 * cells whose own 3x3 neighbourhood covers that rectangle.
 */
export function allowFromDeps(di0, di1, dj0, dj1) {
  return Object.freeze({ i0: di1 - 1, i1: di0 + 1, j0: dj1 - 1, j1: dj0 + 1 });
}
/** A part that depends on its own cell only may paint into every neighbour. */
export const ALLOW_ALL = allowFromDeps(0, 0, 0, 0);

export class Sprite {
  /**
   * @param {number} c  owning cell column
   * @param {number} r  owning cell row
   * @param {string} kind  tree | mountain | pillar | structure
   * @param {number} baseY world art-px ground line
   * @param {{a:number,b:number}|null} shadow  projection factors
   */
  constructor(c, r, kind, baseY, shadow = { a: 0.55, b: 0.3 }) {
    this.c = c;
    this.r = r;
    this.kind = kind;
    this.baseY = baseY;
    this.shadowK = shadow;
    this.ox = c * CELL - FRAME_PAD;
    this.oy = r * CELL - FRAME_PAD;
    this.px = new Uint8Array(FRAME * FRAME); // palette index + 1, 0 = empty
    this.clipped = 0;
    this.allow = ALLOW_ALL;
    this.order = 0; // tie-break for parts with the same ground line
  }
  /** Record which owner-relative cells this part's look depends on. */
  setDeps(di0, di1, dj0, dj1) {
    this.allow = allowFromDeps(di0, di1, dj0, dj1);
    return this;
  }
  /**
   * The world art-px box this part may occupy: its own cell, grown by the
   * given overhang only toward neighbours it is allowed to paint into.
   * @param {{left:number,right:number,top:number,bottom:number}} lim
   */
  allowedBox(lim) {
    const a = this.allow,
      x = this.c * CELL,
      y = this.r * CELL;
    return [
      x - (a.i0 < 0 ? lim.left : 0),
      y - (a.j0 < 0 ? lim.top : 0),
      x + CELL + (a.i1 > 0 ? lim.right : 0),
      y + CELL + (a.j1 > 0 ? lim.bottom : 0),
    ];
  }
  /** Shift into, then clip to, allowedBox(lim) (planning fit + safety net). */
  fitTo(lim) {
    const box = this.allowedBox(lim);
    this.shiftToFit(...box);
    this.clipTo(...box);
    return this;
  }
  /** World art-px box the part's cast shadow may fall into (whole allowed cells). */
  shadowBox() {
    const a = this.allow;
    return [
      (this.c + a.i0) * CELL,
      (this.r + a.j0) * CELL,
      (this.c + a.i1 + 1) * CELL,
      (this.r + a.j1 + 1) * CELL,
    ];
  }
  set(x, y, col) {
    const lx = x - this.ox,
      ly = y - this.oy;
    if (lx < 0 || ly < 0 || lx >= FRAME || ly >= FRAME) {
      this.clipped++;
      return;
    }
    this.px[ly * FRAME + lx] = col + 1;
  }
  has(x, y) {
    const lx = x - this.ox,
      ly = y - this.oy;
    return lx >= 0 && ly >= 0 && lx < FRAME && ly < FRAME && this.px[ly * FRAME + lx] !== 0;
  }
  get(x, y) {
    const lx = x - this.ox,
      ly = y - this.oy;
    if (lx < 0 || ly < 0 || lx >= FRAME || ly >= FRAME) return -1;
    return this.px[ly * FRAME + lx] - 1;
  }
  clear(x, y) {
    const lx = x - this.ox,
      ly = y - this.oy;
    if (lx >= 0 && ly >= 0 && lx < FRAME && ly < FRAME) this.px[ly * FRAME + lx] = 0;
  }
  /** Iterate opaque pixels in world coordinates. */
  forEach(fn) {
    const { px, ox, oy } = this;
    for (let ly = 0; ly < FRAME; ly++)
      for (let lx = 0; lx < FRAME; lx++) {
        const v = px[ly * FRAME + lx];
        if (v) fn(ox + lx, oy + ly, v - 1);
      }
  }
  /**
   * Selective outline: dark on the bottom / right silhouette edge (away
   * from the light), optional warm rim on the top / left edge.
   */
  outline({ dark = null, darkSteps = 2, rim = false, skipBottom = false } = {}) {
    const next = [];
    this.forEach((x, y, c) => {
      const openR = !this.has(x + 1, y),
        openD = !skipBottom && !this.has(x, y + 1);
      const openL = !this.has(x - 1, y),
        openU = !this.has(x, y - 1);
      if (openR || openD) next.push(x, y, dark ?? down(c, darkSteps));
      else if (rim && (openL || openU)) next.push(x, y, up(c, 1));
    });
    for (let k = 0; k < next.length; k += 3) this.set(next[k], next[k + 1], next[k + 2]);
  }
  /** Paint another sprite (same owner frame) over this one. */
  drawOver(other) {
    other.forEach((x, y, c) => this.set(x, y, c));
  }
  /** Count and drop pixels outside the allowed box [x0,x1)x[y0,y1) (world art px). */
  clipTo(x0, y0, x1, y1) {
    const { px, ox, oy } = this;
    for (let ly = 0; ly < FRAME; ly++)
      for (let lx = 0; lx < FRAME; lx++) {
        const k = ly * FRAME + lx;
        if (!px[k]) continue;
        const x = ox + lx,
          y = oy + ly;
        if (x < x0 || x >= x1 || y < y0 || y >= y1) {
          px[k] = 0;
          this.clipped++;
        }
      }
  }
  /** Opaque bounds in world art px, or null. */
  bounds() {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    this.forEach((x, y) => {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    });
    return x0 === Infinity ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }
  /**
   * Move the whole sprite by whole pixels so it fits the box
   * [x0,x1)x[y0,y1) when it can (planning-level fit; clipTo is the net).
   */
  shiftToFit(x0, y0, x1, y1) {
    const b = this.bounds();
    if (!b) return;
    let dx = 0,
      dy = 0;
    if (b.x0 < x0) dx = Math.min(x0 - b.x0, Math.max(0, x1 - b.x1));
    else if (b.x1 > x1) dx = -Math.min(b.x1 - x1, Math.max(0, b.x0 - x0));
    if (b.y0 < y0) dy = Math.min(y0 - b.y0, Math.max(0, y1 - b.y1));
    else if (b.y1 > y1) dy = -Math.min(b.y1 - y1, Math.max(0, b.y0 - y0));
    if (!dx && !dy) return;
    const src = this.px;
    this.px = new Uint8Array(FRAME * FRAME);
    for (let ly = 0; ly < FRAME; ly++)
      for (let lx = 0; lx < FRAME; lx++) {
        const v = src[ly * FRAME + lx];
        if (!v) continue;
        const nx = lx + dx,
          ny = ly + dy;
        if (nx < 0 || ny < 0 || nx >= FRAME || ny >= FRAME) this.clipped++;
        else this.px[ny * FRAME + nx] = v;
      }
    this.baseY += dy;
  }
  count() {
    let n = 0;
    for (let k = 0; k < this.px.length; k++) if (this.px[k]) n++;
    return n;
  }
}
