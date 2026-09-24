// Pure RGBA raster (no I/O, no dependencies) shared by every tracer stage.
// Pixels are straight (non-premultiplied) RGBA bytes, row-major.

export class Raster {
  constructor(w, h, data = null) {
    this.w = w;
    this.h = h;
    this.d = data ? Uint8ClampedArray.from(data) : new Uint8ClampedArray(w * h * 4);
  }

  static from(w, h, data) {
    return new Raster(w, h, data);
  }

  clone() {
    return new Raster(this.w, this.h, this.d);
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x, y) {
    return (y * this.w + x) * 4;
  }

  get(x, y) {
    const i = this.idx(x, y);
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }

  alpha(x, y) {
    return this.inside(x, y) ? this.d[this.idx(x, y) + 3] : 0;
  }

  set(x, y, c) {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = c.length > 3 ? c[3] : 255;
  }

  crop(x0, y0, w, h) {
    const out = new Raster(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x0 + x,
          sy = y0 + y;
        if (!this.inside(sx, sy)) continue;
        const s = this.idx(sx, sy);
        out.d.set(this.d.subarray(s, s + 4), (y * w + x) * 4);
      }
    return out;
  }

  /** Alpha-over composite of `src` at integer (x, y). */
  draw(src, x, y, alphaMul = 1) {
    x = Math.round(x);
    y = Math.round(y);
    for (let sy = 0; sy < src.h; sy++) {
      const dy = y + sy;
      if (dy < 0 || dy >= this.h) continue;
      for (let sx = 0; sx < src.w; sx++) {
        const dx = x + sx;
        if (dx < 0 || dx >= this.w) continue;
        const si = (sy * src.w + sx) * 4;
        const a = (src.d[si + 3] / 255) * alphaMul;
        if (a <= 0) continue;
        const di = (dy * this.w + dx) * 4;
        const da = this.d[di + 3] / 255;
        const oa = a + da * (1 - a);
        for (let k = 0; k < 3; k++)
          this.d[di + k] = (src.d[si + k] * a + this.d[di + k] * da * (1 - a)) / (oa || 1);
        this.d[di + 3] = oa * 255;
      }
    }
    return this;
  }

  fillRect(x, y, w, h, c) {
    const a = (c[3] ?? 255) / 255;
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const i = (yy * this.w + xx) * 4;
        for (let k = 0; k < 3; k++) this.d[i + k] = c[k] * a + this.d[i + k] * (1 - a);
        this.d[i + 3] = Math.max(this.d[i + 3], c[3] ?? 255);
      }
    return this;
  }

  map(fn) {
    const out = this.clone();
    for (let i = 0; i < this.w * this.h; i++) {
      const o = i * 4;
      const px = fn([out.d[o], out.d[o + 1], out.d[o + 2], out.d[o + 3]], i);
      out.d[o] = px[0];
      out.d[o + 1] = px[1];
      out.d[o + 2] = px[2];
      out.d[o + 3] = px[3];
    }
    return out;
  }

  /** Integer nearest-neighbour enlargement. */
  scale(n) {
    const out = new Raster(this.w * n, this.h * n);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const s = (Math.floor(y / n) * this.w + Math.floor(x / n)) * 4;
        out.d.set(this.d.subarray(s, s + 4), (y * out.w + x) * 4);
      }
    return out;
  }

  /** Nearest-neighbour resize to an exact size (the game's sampling). */
  resizeNearest(W, H) {
    const out = new Raster(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = Math.min(this.w - 1, Math.floor(((x + 0.5) * this.w) / W));
        const sy = Math.min(this.h - 1, Math.floor(((y + 0.5) * this.h) / H));
        const s = (sy * this.w + sx) * 4;
        out.d.set(this.d.subarray(s, s + 4), (y * W + x) * 4);
      }
    return out;
  }

  /** Exact area-average resize (premultiplied): what a high-DPR panel effectively shows. */
  resizeArea(W, H) {
    const taps = (n, N) => {
      const sc = n / N;
      const list = [];
      for (let o = 0; o < N; o++) {
        const a = o * sc,
          b = (o + 1) * sc,
          t = [];
        for (let s = Math.floor(a); s < Math.ceil(b); s++) {
          const cover = Math.min(b, s + 1) - Math.max(a, s);
          if (cover > 1e-9) t.push([Math.min(n - 1, s), cover / sc]);
        }
        list.push(t);
      }
      return list;
    };
    const wx = taps(this.w, W),
      wy = taps(this.h, H);
    const out = new Raster(W, H);
    for (let Y = 0; Y < H; Y++)
      for (let X = 0; X < W; X++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0;
        for (const [sy, fy] of wy[Y])
          for (const [sx, fx] of wx[X]) {
            const i = (sy * this.w + sx) * 4;
            const al = (this.d[i + 3] / 255) * fx * fy;
            r += this.d[i] * al;
            g += this.d[i + 1] * al;
            b += this.d[i + 2] * al;
            a += al;
          }
        const o = (Y * W + X) * 4;
        if (a > 0) {
          out.d[o] = r / a;
          out.d[o + 1] = g / a;
          out.d[o + 2] = b / a;
          out.d[o + 3] = a * 255;
        }
      }
    return out;
  }

  flipX() {
    const out = new Raster(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const s = (y * this.w + x) * 4;
        out.d.set(this.d.subarray(s, s + 4), (y * this.w + (this.w - 1 - x)) * 4);
      }
    return out;
  }

  /** Bounding box of pixels with alpha > threshold, or null when empty. */
  alphaBounds(threshold = 10) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.d[(y * this.w + x) * 4 + 3] > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < x0) return null;
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  /** Count distinct opaque colours (for palette budgets). */
  colorCount() {
    const set = new Set();
    for (let i = 0; i < this.d.length; i += 4)
      if (this.d[i + 3]) set.add((this.d[i] << 16) | (this.d[i + 1] << 8) | this.d[i + 2]);
    return set.size;
  }
}

/** Stack rasters horizontally with a gap (review sheets). */
export function hstack(list, gap = 0, bg = [0, 0, 0, 0]) {
  const w = list.reduce((s, r) => s + r.w, 0) + gap * Math.max(0, list.length - 1);
  const h = Math.max(...list.map((r) => r.h));
  const out = new Raster(w, h);
  if (bg[3]) out.fillRect(0, 0, w, h, bg);
  let x = 0;
  for (const r of list) {
    out.draw(r, x, 0);
    x += r.w + gap;
  }
  return out;
}

export function vstack(list, gap = 0, bg = [0, 0, 0, 0]) {
  const w = Math.max(...list.map((r) => r.w));
  const h = list.reduce((s, r) => s + r.h, 0) + gap * Math.max(0, list.length - 1);
  const out = new Raster(w, h);
  if (bg[3]) out.fillRect(0, 0, w, h, bg);
  let y = 0;
  for (const r of list) {
    out.draw(r, 0, y);
    y += r.h + gap;
  }
  return out;
}
