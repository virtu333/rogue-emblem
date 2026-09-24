// IndexedSprite: the traced map sprite before colour — every pixel is
// (slot, shade 0..4). Outline pixels are generated later (render), so `slot`
// holds only the fill. Pure.
import { SLOT } from './slots.mjs';

export class IndexedSprite {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.slot = new Uint8Array(w * h);
    this.shade = new Int8Array(w * h);
    // optional per-pixel colour kept from the source for 'eye' and 'glow' pixels
    this.meta = {};
  }

  clone() {
    const o = new IndexedSprite(this.w, this.h);
    o.slot.set(this.slot);
    o.shade.set(this.shade);
    o.meta = JSON.parse(JSON.stringify(this.meta));
    return o;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  at(x, y) {
    return this.inside(x, y) ? this.slot[y * this.w + x] : SLOT.empty;
  }

  shadeAt(x, y) {
    return this.inside(x, y) ? this.shade[y * this.w + x] : 0;
  }

  set(x, y, slot, shade) {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.slot[i] = slot;
    this.shade[i] = shade;
  }

  /** Opaque bounds (fill only). */
  bounds(filter = null) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const s = this.slot[y * this.w + x];
        if (!s || (filter && !filter(s))) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    if (x1 < 0) return null;
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  /** Copy into a larger canvas at (dx, dy). */
  placed(W, H, dx, dy) {
    const o = new IndexedSprite(W, H);
    o.meta = JSON.parse(JSON.stringify(this.meta));
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const s = this.slot[y * this.w + x];
        if (!s) continue;
        o.set(x + dx, y + dy, s, this.shade[y * this.w + x]);
      }
    return o;
  }

  toJSON() {
    return {
      w: this.w,
      h: this.h,
      slot: Array.from(this.slot),
      shade: Array.from(this.shade),
      meta: this.meta,
    };
  }

  static fromJSON(j) {
    const o = new IndexedSprite(j.w, j.h);
    o.slot.set(j.slot);
    o.shade.set(j.shade);
    o.meta = j.meta || {};
    return o;
  }
}
