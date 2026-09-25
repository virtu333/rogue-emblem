// Small RGBA image helpers (nearest-neighbour only) + sharp I/O and labels.
import sharp from 'sharp';

export class Img {
  constructor(w, h, fill = [0, 0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
    if (fill[3] || fill[0] || fill[1] || fill[2])
      for (let i = 0; i < w * h; i++) this.d.set(fill, i * 4);
  }
  static from(w, h, data) {
    const img = new Img(w, h);
    img.d.set(data);
    return img;
  }
  static async read(file) {
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return Img.from(info.width, info.height, data);
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  // Alpha-over composite of `src` at (x, y).
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
  map(fn) {
    const out = Img.from(this.w, this.h, this.d);
    for (let i = 0; i < this.w * this.h; i++) {
      const px = fn([out.d[i * 4], out.d[i * 4 + 1], out.d[i * 4 + 2], out.d[i * 4 + 3]], i);
      out.d.set(px, i * 4);
    }
    return out;
  }
  fillRect(x, y, w, h, c) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const i = (yy * this.w + xx) * 4;
        const a = (c[3] ?? 255) / 255;
        for (let k = 0; k < 3; k++) this.d[i + k] = c[k] * a + this.d[i + k] * (1 - a);
        this.d[i + 3] = Math.max(this.d[i + 3], c[3] ?? 255);
      }
    return this;
  }
  crop(x, y, w, h) {
    const out = new Img(w, h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const sx = x + xx,
          sy = y + yy;
        if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
        out.d.set(
          this.d.subarray((sy * this.w + sx) * 4, (sy * this.w + sx) * 4 + 4),
          (yy * w + xx) * 4,
        );
      }
    return out;
  }
  scale(n) {
    const out = new Img(this.w * n, this.h * n);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const si = (Math.floor(y / n) * this.w + Math.floor(x / n)) * 4;
        out.d.set(this.d.subarray(si, si + 4), (y * out.w + x) * 4);
      }
    return out;
  }
  // Nearest-neighbour resize to an exact size.
  resizeNearest(W, H) {
    const out = new Img(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = Math.min(this.w - 1, Math.floor(((x + 0.5) * this.w) / W));
        const sy = Math.min(this.h - 1, Math.floor(((y + 0.5) * this.h) / H));
        out.d.set(
          this.d.subarray((sy * this.w + sx) * 4, (sy * this.w + sx) * 4 + 4),
          (y * W + x) * 4,
        );
      }
    return out;
  }
  // Exact area-average resize (premultiplied) — what a 3x DPR phone effectively shows.
  resizeArea(W, H) {
    const wts = (n, N) => {
      const sc = n / N;
      const list = [];
      for (let o = 0; o < N; o++) {
        const a = o * sc,
          b = (o + 1) * sc,
          taps = [];
        for (let s = Math.floor(a); s < Math.ceil(b); s++) {
          const cover = Math.min(b, s + 1) - Math.max(a, s);
          if (cover > 1e-9) taps.push([Math.min(n - 1, s), cover / sc]);
        }
        list.push(taps);
      }
      return list;
    };
    const wx = wts(this.w, W),
      wy = wts(this.h, H);
    const out = new Img(W, H);
    for (let Y = 0; Y < H; Y++)
      for (let X = 0; X < W; X++) {
        const acc = [0, 0, 0, 0];
        for (const [sy, fy] of wy[Y])
          for (const [sx, fx] of wx[X]) {
            const i = (sy * this.w + sx) * 4;
            const a = this.d[i + 3] / 255;
            const f = fx * fy;
            acc[0] += this.d[i] * a * f;
            acc[1] += this.d[i + 1] * a * f;
            acc[2] += this.d[i + 2] * a * f;
            acc[3] += a * f;
          }
        const o = (Y * W + X) * 4;
        if (acc[3] > 0) {
          out.d[o] = acc[0] / acc[3];
          out.d[o + 1] = acc[1] / acc[3];
          out.d[o + 2] = acc[2] / acc[3];
          out.d[o + 3] = acc[3] * 255;
        }
      }
    return out;
  }
  flipX() {
    const out = new Img(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        out.d.set(
          this.d.subarray((y * this.w + x) * 4, (y * this.w + x) * 4 + 4),
          (y * this.w + (this.w - 1 - x)) * 4,
        );
    return out;
  }
  alphaBounds(threshold = 10) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.d[(y * this.w + x) * 4 + 3] > threshold) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }
  async png(file) {
    await sharp(Buffer.from(this.d.buffer, this.d.byteOffset, this.d.byteLength), {
      raw: { width: this.w, height: this.h, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(file);
  }
}

export async function writeGif(file, frames, delayMs) {
  const bufs = await Promise.all(
    frames.map((f) =>
      sharp(Buffer.from(f.d.buffer, f.d.byteOffset, f.d.byteLength), {
        raw: { width: f.w, height: f.h, channels: 4 },
      })
        .png()
        .toBuffer(),
    ),
  );
  const delays = Array.isArray(delayMs) ? delayMs : frames.map(() => delayMs);
  await sharp(bufs, { join: { animated: true } })
    .gif({ loop: 0, delay: delays, effort: 10 })
    .toFile(file);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Render a text label to an Img (DejaVu Sans Mono via librsvg).
export async function textImg(
  text,
  { size = 12, color = '#ddd0bd', bg = null, width = null, bold = false } = {},
) {
  const lines = String(text).split('\n');
  const w = width ?? Math.ceil(Math.max(...lines.map((l) => l.length)) * size * 0.62) + 8;
  const h = Math.ceil(lines.length * size * 1.3) + 6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${
    bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''
  }${lines
    .map(
      (l, k) =>
        `<text x="4" y="${Math.round(size + 2 + k * size * 1.3)}" font-family="DejaVu Sans Mono, monospace" font-size="${size}" ${bold ? 'font-weight="bold"' : ''} fill="${color}">${esc(l)}</text>`,
    )
    .join('')}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Img.from(info.width, info.height, data);
}

export const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
