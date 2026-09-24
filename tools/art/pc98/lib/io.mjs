// sharp-backed I/O for the PC-98 build (the only non-pure module).
import sharp from 'sharp';

export async function readRgba(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8Array(data), w: info.width, h: info.height };
}

/** Pad to a square canvas (transparent), anchoring the figure at the bottom. */
export function padSquare({ rgba, w, h }) {
  if (w === h) return { rgba, w, h };
  const s = Math.max(w, h);
  const out = new Uint8Array(s * s * 4);
  const ox = Math.floor((s - w) / 2);
  const oy = s - h;
  for (let y = 0; y < h; y++)
    out.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * s + ox) * 4);
  return { rgba: out, w: s, h: s };
}

export function crop({ rgba, w }, [left, top, right, bottom]) {
  const cw = w - left - right;
  const hh = rgba.length / 4 / w;
  const ch = hh - top - bottom;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    out.set(rgba.subarray(((y + top) * w + left) * 4, ((y + top) * w + left + cw) * 4), y * cw * 4);
  return { rgba: out, w: cw, h: ch };
}

/** Lanczos resample (premultiplied alpha) to size x size. */
export async function resample({ rgba, w, h }, size, { sharpen = 0 } = {}) {
  let img = sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } }).resize(
    size,
    size,
    { kernel: sharp.kernel.lanczos3, fit: 'fill' },
  );
  // Small thumbnails keep their features with a light unsharp mask.
  if (sharpen > 0) img = img.sharpen({ sigma: sharpen });
  const data = await img.raw().toBuffer();
  return new Uint8Array(data);
}

export async function writePng(file, { w, h, indices, palette, alpha }) {
  const { encodeIndexedPng } = await import('./png.mjs');
  const { writeFileSync } = await import('fs');
  writeFileSync(file, encodeIndexedPng(w, h, indices, palette, alpha));
}

/** Expand an indexed image to RGBA bytes (alpha from the tRNS list). */
export function toRgba({ w, h, indices, palette, alpha = [] }) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = palette[indices[i]];
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = alpha[indices[i]] ?? 255;
  }
  return out;
}

export async function writeRgbaPng(file, rgba, w, h) {
  await sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

export async function toWebp(file, rgba, w, h, scale = 1) {
  let img = sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } });
  if (scale !== 1) img = img.resize(w * scale, h * scale, { kernel: sharp.kernel.nearest });
  await img.webp({ lossless: true }).toFile(file);
}
