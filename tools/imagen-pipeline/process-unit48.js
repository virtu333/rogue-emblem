#!/usr/bin/env node
/**
 * process-unit48.js -- turn Imagen character raws into 48x48 unit sprites
 * that overhang the 32px battle tiles.
 *
 * The anchor is baked into the texture: the character's feet sit 8px above
 * the bottom edge (BOTTOM_PAD). A 48px sprite centered on a tile center then
 * puts feet at the tile's bottom edge and lets the head overhang the tile
 * above -- no positioning changes needed in the engine.
 *
 * Improvements over process.js for fidelity at small sizes:
 *  - background removal flood-fills from the borders instead of keying the
 *    edge color globally, so background-colored pixels inside the character
 *    (blue tunics on blue backgrounds) survive
 *  - tight bbox crop before resize so the figure fills the pixel budget
 *  - hard alpha threshold after resize for crisp pixel-art edges
 *
 * Usage:
 *   node tools/imagen-pipeline/process-unit48.js --input-dir <dir> --out-dir <dir>
 *     [--size 48] [--bottom-pad 8] [--tolerance 24]
 */

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

function parseArgs(argv) {
  const args = { size: 48, bottomPad: 8, tolerance: 24, kernel: 'nearest' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input-dir') args.inputDir = path.resolve(argv[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (a === '--size') args.size = Number(argv[++i]);
    else if (a === '--bottom-pad') args.bottomPad = Number(argv[++i]);
    else if (a === '--tolerance') args.tolerance = Number(argv[++i]);
    else if (a === '--kernel')
      args.kernel = argv[++i]; // nearest for flat art, lanczos3 for painterly raws
    else if (a === '--help') args.help = true;
  }
  return args;
}

function dominantEdgeColor(data, width, height, channels) {
  const counts = new Map();
  const push = (x, y) => {
    const idx = (y * width + x) * channels;
    if (data[idx + 3] === 0) return;
    const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    push(width - 1, y);
  }
  let best = null;
  let bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best ? best.split(',').map(Number) : null;
}

/** Flood-fill transparent from the borders through background-colored pixels. */
function removeBackgroundFlood(data, width, height, channels, tolerance) {
  const edge = dominantEdgeColor(data, width, height, channels);
  if (!edge) return data;
  const [er, eg, eb] = edge;
  const tolSq = tolerance * tolerance;
  const out = Buffer.from(data);
  const isBg = (idx) => {
    const dr = out[idx] - er;
    const dg = out[idx + 1] - eg;
    const db = out[idx + 2] - eb;
    return dr * dr + dg * dg + db * db <= tolSq;
  };
  const visited = new Uint8Array(width * height);
  const queue = [];
  const enqueue = (x, y) => {
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    if (isBg(p * channels)) queue.push(p);
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (queue.length > 0) {
    const p = queue.pop();
    out[p * channels + 3] = 0;
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
  }
  return out;
}

function contentBounds(data, width, height, channels) {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

async function processOne(rawFile, outFile, size, bottomPad, tolerance, kernel) {
  const { data, info } = await sharp(await fs.readFile(rawFile))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cut = removeBackgroundFlood(data, info.width, info.height, info.channels, tolerance);
  const bounds = contentBounds(cut, info.width, info.height, info.channels);
  if (!bounds) {
    console.warn(`[unit48] no content after bg removal: ${rawFile}`);
    return false;
  }

  const cropW = bounds.maxX - bounds.minX + 1;
  const cropH = bounds.maxY - bounds.minY + 1;
  const cropped = sharp(cut, { raw: info }).extract({
    left: bounds.minX,
    top: bounds.minY,
    width: cropW,
    height: cropH,
  });

  // Fit the figure into the content box: full width, height above the pad.
  const maxW = size - 2;
  const maxH = size - bottomPad;
  const scale = Math.min(maxW / cropW, maxH / cropH);
  const w = Math.max(1, Math.round(cropW * scale));
  const h = Math.max(1, Math.round(cropH * scale));

  let figure = await cropped
    .resize(w, h, { kernel: sharp.kernel[kernel] || sharp.kernel.nearest, fit: 'fill' })
    .png()
    .toBuffer();

  // Hard alpha threshold for crisp edges.
  const fig = await sharp(figure).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < fig.data.length; i += fig.info.channels) {
    fig.data[i] = fig.data[i] < 128 ? 0 : 255;
  }
  figure = await sharp(fig.data, { raw: fig.info }).png().toBuffer();

  // Feet at (size - bottomPad), horizontally centered.
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: figure, left: Math.round((size - w) / 2), top: size - bottomPad - h }])
    .png({ palette: true, colours: 32 })
    .toFile(outFile);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputDir || !args.outDir) {
    console.log(
      'Usage: node tools/imagen-pipeline/process-unit48.js --input-dir <dir> --out-dir <dir> [--size 48] [--bottom-pad 8] [--tolerance 24]',
    );
    return;
  }
  await fs.mkdir(args.outDir, { recursive: true });
  const entries = await fs.readdir(args.inputDir);
  const pngs = entries.filter((f) => f.toLowerCase().endsWith('.png'));
  let done = 0;
  for (const f of pngs) {
    const ok = await processOne(
      path.join(args.inputDir, f),
      path.join(args.outDir, f),
      args.size,
      args.bottomPad,
      args.tolerance,
      args.kernel,
    );
    if (ok) done++;
  }
  console.log(`[unit48] processed=${done}/${pngs.length} -> ${args.outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
