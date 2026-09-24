// File I/O for the tracer (sharp). Everything else in lib/ is pure.
import sharp from 'sharp';
import { Raster } from './raster.mjs';

export async function readRaster(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Raster.from(info.width, info.height, data);
}

function toSharp(r) {
  return sharp(Buffer.from(r.d.buffer, r.d.byteOffset, r.d.byteLength), {
    raw: { width: r.w, height: r.h, channels: 4 },
  });
}

export async function writePng(r, file) {
  await toSharp(r).png({ compressionLevel: 9, palette: false }).toFile(file);
}

/** Lossless WebP (review captures: small and exact). */
export async function writeWebp(r, file, { lossless = true, quality = 90 } = {}) {
  await toSharp(r)
    .webp(lossless ? { lossless: true, effort: 6 } : { quality, effort: 6 })
    .toFile(file);
}

export async function writeGif(file, frames, delayMs) {
  const bufs = await Promise.all(frames.map((f) => toSharp(f).png().toBuffer()));
  const delays = Array.isArray(delayMs) ? delayMs : frames.map(() => delayMs);
  await sharp(bufs, { join: { animated: true } })
    .gif({ loop: 0, delay: delays, effort: 10 })
    .toFile(file);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Render a text label (DejaVu Sans Mono via librsvg). */
export async function textRaster(
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
  return Raster.from(info.width, info.height, data);
}
