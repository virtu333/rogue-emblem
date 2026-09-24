// Minimal RGBA raster helpers on top of sharp. No smoothing anywhere except
// the explicit area-average resampler used for the phone-scale previews.
import sharp from 'sharp';
import { PALETTE } from './palette.mjs';

export function indexToRgba(idx, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = PALETTE[idx[i]];
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function upscaleNearest(src, w, h, k) {
  const W = w * k,
    H = h * k,
    out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (((y / k) | 0) * w + ((x / k) | 0)) * 4,
        d = (y * W + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  return out;
}

/**
 * Exact area-average (box) resample. Each destination pixel is the
 * coverage-weighted mean of the source pixels under it. This is what a
 * high-DPI phone effectively shows when a 48px tile lands on ~34 CSS px.
 */
export function resampleArea(src, w, h, W, H) {
  const weights = (n, N) => {
    const scale = n / N,
      list = [];
    for (let o = 0; o < N; o++) {
      const a = o * scale,
        b = (o + 1) * scale,
        taps = [];
      for (let s = Math.floor(a); s < Math.ceil(b); s++) {
        const cover = Math.min(b, s + 1) - Math.max(a, s);
        if (cover > 1e-9) taps.push([Math.min(n - 1, s), cover / scale]);
      }
      list.push(taps);
    }
    return list;
  };
  const wx = weights(w, W),
    wy = weights(h, H);
  const tmp = new Float32Array(W * h * 4);
  for (let y = 0; y < h; y++)
    for (let X = 0; X < W; X++)
      for (const [s, f] of wx[X])
        for (let c = 0; c < 4; c++) tmp[(y * W + X) * 4 + c] += src[(y * w + s) * 4 + c] * f;
  const out = Buffer.alloc(W * H * 4);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const acc = [0, 0, 0, 0];
      for (const [s, f] of wy[Y])
        for (let c = 0; c < 4; c++) acc[c] += tmp[(s * W + X) * 4 + c] * f;
      for (let c = 0; c < 4; c++) out[(Y * W + X) * 4 + c] = Math.round(acc[c]);
    }
  return out;
}

export function resampleNearest(src, w, h, W, H) {
  const out = Buffer.alloc(W * H * 4);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const sx = Math.min(w - 1, Math.floor(((X + 0.5) * w) / W)),
        sy = Math.min(h - 1, Math.floor(((Y + 0.5) * h) / H));
      src.copy(out, (Y * W + X) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  return out;
}

export function crop(src, w, h, x, y, cw, ch) {
  const out = Buffer.alloc(cw * ch * 4);
  for (let j = 0; j < ch; j++) src.copy(out, j * cw * 4, ((y + j) * w + x) * 4, ((y + j) * w + x + cw) * 4);
  return out;
}

export async function writePng(path, rgba, w, h) {
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path);
}

export async function readRgba(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Source-over composite of an RGBA image (with its own alpha) at integer x,y. */
export function blit(dst, dw, dh, src, sw, sh, x, y, opacity = 1) {
  for (let j = 0; j < sh; j++) {
    const Y = y + j;
    if (Y < 0 || Y >= dh) continue;
    for (let i = 0; i < sw; i++) {
      const X = x + i;
      if (X < 0 || X >= dw) continue;
      const s = (j * sw + i) * 4,
        d = (Y * dw + X) * 4;
      const a = (src[s + 3] / 255) * opacity;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) dst[d + c] = Math.round(src[s + c] * a + dst[d + c] * (1 - a));
      dst[d + 3] = 255;
    }
  }
}

/** Anti-aliased ellipse outline (supersampled), like Phaser's stroked ellipse. */
export function strokeEllipse(dst, dw, dh, cx, cy, rx, ry, stroke, rgb, alpha) {
  const SS = 4;
  const x0 = Math.floor(cx - rx - stroke),
    x1 = Math.ceil(cx + rx + stroke);
  const y0 = Math.floor(cy - ry - stroke),
    y1 = Math.ceil(cy + ry + stroke);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= dw || y >= dh) continue;
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - cx,
            py = y + (sy + 0.5) / SS - cy;
          const outer = (px / (rx + stroke / 2)) ** 2 + (py / (ry + stroke / 2)) ** 2 <= 1;
          const inner = (px / (rx - stroke / 2)) ** 2 + (py / (ry - stroke / 2)) ** 2 <= 1;
          if (outer && !inner) hit++;
        }
      const a = (hit / (SS * SS)) * alpha;
      if (!a) continue;
      const d = (y * dw + x) * 4;
      for (let c = 0; c < 3; c++) dst[d + c] = Math.round(rgb[c] * a + dst[d + c] * (1 - a));
    }
}

/** Solid fill rectangle (used for sheet backgrounds). */
export function fillRect(dst, dw, dh, x, y, w, h, rgb) {
  for (let j = Math.max(0, y); j < Math.min(dh, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(dw, x + w); i++) {
      const d = (j * dw + i) * 4;
      dst[d] = rgb[0];
      dst[d + 1] = rgb[1];
      dst[d + 2] = rgb[2];
      dst[d + 3] = 255;
    }
}
