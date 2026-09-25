// Contact-sheet helpers (Node only): lay out RGBA icons on UI-coloured tiles.
import sharp from 'sharp';
import { composite } from './pixelIcon.mjs';
import { hexToRgb } from './palette.mjs';

export function blank(w, h, bg = '#0e0c14') {
  const [r, g, b] = hexToRgb(bg);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4);
  return { w, h, px };
}

export function fillRect(img, x, y, w, h, hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  for (let yy = Math.max(0, y); yy < Math.min(img.h, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(img.w, x + w); xx++) {
      const i = (yy * img.w + xx) * 4;
      img.px[i] = Math.round(r * alpha + img.px[i] * (1 - alpha));
      img.px[i + 1] = Math.round(g * alpha + img.px[i + 1] * (1 - alpha));
      img.px[i + 2] = Math.round(b * alpha + img.px[i + 2] * (1 - alpha));
    }
}

export function put(img, icon, x, y, scale = 1) {
  composite(img.px, img.w, icon.rgba, icon.size, icon.size, x, y, scale);
}

export async function save(img, file, { scale = 1, webp = false, quality = 90 } = {}) {
  let s = sharp(Buffer.from(img.px.buffer), { raw: { width: img.w, height: img.h, channels: 4 } });
  if (scale !== 1) s = s.resize(img.w * scale, img.h * scale, { kernel: 'nearest' });
  if (webp || file.endsWith('.webp'))
    await s.webp({ quality, lossless: quality >= 100 }).toFile(file);
  else await s.png({ compressionLevel: 9 }).toFile(file);
}

export async function iconPng(icon, file, scale = 1) {
  let s = sharp(Buffer.from(icon.rgba.buffer), {
    raw: { width: icon.size, height: icon.size, channels: 4 },
  });
  if (scale !== 1) s = s.resize(icon.size * scale, icon.size * scale, { kernel: 'nearest' });
  await s.png({ compressionLevel: 9 }).toFile(file);
}
