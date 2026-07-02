#!/usr/bin/env node
/**
 * process-fx.js — turn Imagen 2x2-grid effect images into game spritesheets.
 *
 * Each raw image holds 4 animation frames in a 2x2 grid (reading order).
 * For every raw variant this slices the quadrants, trims outer grid margins,
 * resizes each frame to targetSize (nearest-neighbor), and assembles a
 * horizontal strip (4*targetSize x targetSize) suitable for
 * Phaser this.load.spritesheet(). Backgrounds stay black — the game renders
 * these with additive blending, so black pixels are invisible.
 *
 * Usage: node tools/imagen-pipeline/process-fx.js [options]
 *   --input-dir <path>   Raw input root (default: References/imagen-output/combat-fx/raw)
 *   --out-dir <path>     Strip output root (default: References/imagen-output/combat-fx/strips)
 *   --target-size <n>    Frame size in px (default: 48)
 *   --inset <pct>        Percent inset per quadrant edge to crop grid margins (default: 4)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULT_IN = path.resolve('References/imagen-output/combat-fx/raw');
const DEFAULT_OUT = path.resolve('References/imagen-output/combat-fx/strips');

function parseArgs(argv) {
  const args = { inputDir: DEFAULT_IN, outDir: DEFAULT_OUT, targetSize: 48, inset: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input-dir') args.inputDir = path.resolve(argv[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (a === '--target-size') args.targetSize = Number(argv[++i]);
    else if (a === '--inset') args.inset = Number(argv[++i]);
  }
  return args;
}

async function listPngs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      files.push(...(await listPngs(path.join(dir, e.name))));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) {
      files.push(path.join(dir, e.name));
    }
  }
  return files;
}

const LIT = 40; // max(r,g,b) at/above this counts as effect content

function isLit(data, channels, idx) {
  return Math.max(data[idx], data[idx + 1], data[idx + 2]) >= LIT;
}

/**
 * Zero out thin straight grid-line artifacts: a run of lit columns (or rows)
 * no wider than ~1.5% of the frame that spans >=60% of the other axis with
 * darkness on both sides is a grid line, not effect art (effect shapes are
 * thicker or have lit neighbors).
 */
function removeThinLines(data, width, height, channels) {
  const maxRun = Math.max(2, Math.round(width * 0.015));
  const litColFrac = new Array(width).fill(0);
  const litRowFrac = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isLit(data, channels, (y * width + x) * channels)) {
        litColFrac[x]++;
        litRowFrac[y]++;
      }
    }
  }
  for (let x = 0; x < width; x++) litColFrac[x] /= height;
  for (let y = 0; y < height; y++) litRowFrac[y] /= width;

  const zeroCol = (x) => {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * channels;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
    }
  };
  const zeroRow = (y) => {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
    }
  };

  const findRuns = (frac, length, threshold = 0.35) => {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= length; i++) {
      const hot = i < length && frac[i] >= threshold;
      if (hot && start < 0) start = i;
      else if (!hot && start >= 0) {
        runs.push([start, i - 1]);
        start = -1;
      }
    }
    return runs;
  };

  for (const [s, e] of findRuns(litColFrac, width)) {
    const before = s - 1 >= 0 ? litColFrac[s - 1] : 0;
    const after = e + 1 < width ? litColFrac[e + 1] : 0;
    if (e - s + 1 <= maxRun && before < 0.2 && after < 0.2) {
      for (let x = s; x <= e; x++) zeroCol(x);
    }
  }
  for (const [s, e] of findRuns(litRowFrac, height)) {
    const before = s - 1 >= 0 ? litRowFrac[s - 1] : 0;
    const after = e + 1 < height ? litRowFrac[e + 1] : 0;
    if (e - s + 1 <= maxRun && before < 0.2 && after < 0.2) {
      for (let y = s; y <= e; y++) zeroRow(y);
    }
  }
}

/** Bounding box of lit pixels, or null if the frame is empty. */
function contentBounds(data, width, height, channels) {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isLit(data, channels, (y * width + x) * channels)) {
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

/** Crush near-black noise to pure black so additive blending stays clean. */
function crushBlacks(data, channels, threshold = 16) {
  for (let i = 0; i < data.length; i += channels) {
    if (data[i] < threshold && data[i + 1] < threshold && data[i + 2] < threshold) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

async function processOne(rawFile, outFile, targetSize, insetPct) {
  const rawBuffer = await fs.readFile(rawFile);
  const meta = await sharp(rawBuffer).metadata();
  const halfW = Math.floor(meta.width / 2);
  const halfH = Math.floor(meta.height / 2);
  const insetX = Math.floor((halfW * insetPct) / 100);
  const insetY = Math.floor((halfH * insetPct) / 100);

  const quadrants = [
    { left: 0, top: 0 },
    { left: halfW, top: 0 },
    { left: 0, top: halfH },
    { left: halfW, top: halfH },
  ];

  // Pass 1: clean each quadrant and measure its content bounding box.
  const cleaned = [];
  for (const q of quadrants) {
    const { data, info } = await sharp(rawBuffer)
      .extract({
        left: q.left + insetX,
        top: q.top + insetY,
        width: halfW - insetX * 2,
        height: halfH - insetY * 2,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    removeThinLines(data, info.width, info.height, info.channels);
    crushBlacks(data, info.channels);
    cleaned.push({
      data,
      info,
      bounds: contentBounds(data, info.width, info.height, info.channels),
    });
  }

  // Common crop size across all frames (max content extent + padding) so the
  // appear/peak/dissipate size relationship is preserved; each frame is then
  // centered on its own content so playback doesn't jitter between corners.
  let maxExtent = 0;
  for (const f of cleaned) {
    if (!f.bounds) continue;
    const bw = f.bounds.maxX - f.bounds.minX + 1;
    const bh = f.bounds.maxY - f.bounds.minY + 1;
    maxExtent = Math.max(maxExtent, bw, bh);
  }

  const frames = [];
  for (const f of cleaned) {
    const { data, info, bounds } = f;
    let cropped = sharp(data, { raw: info });
    if (bounds && maxExtent > 0) {
      const side = Math.min(
        maxExtent + Math.round(maxExtent * 0.24),
        Math.min(info.width, info.height),
      );
      const cx = Math.round((bounds.minX + bounds.maxX) / 2);
      const cy = Math.round((bounds.minY + bounds.maxY) / 2);
      const left = Math.min(Math.max(0, cx - Math.floor(side / 2)), info.width - side);
      const top = Math.min(Math.max(0, cy - Math.floor(side / 2)), info.height - side);
      cropped = cropped.extract({ left, top, width: side, height: side });
    }
    const frame = await cropped
      .resize({
        width: targetSize,
        height: targetSize,
        fit: 'fill',
        kernel: sharp.kernel.nearest,
      })
      .png()
      .toBuffer();
    frames.push(frame);
  }

  const strip = sharp({
    create: {
      width: targetSize * 4,
      height: targetSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).composite(frames.map((input, i) => ({ input, left: i * targetSize, top: 0 })));
  await fs.writeFile(outFile, await strip.png().toBuffer());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.outDir, { recursive: true });
  const rawFiles = await listPngs(args.inputDir);
  if (rawFiles.length === 0) {
    console.error(`[process-fx] no PNGs under ${args.inputDir}`);
    process.exit(1);
  }
  for (const rawFile of rawFiles) {
    const outFile = path.join(args.outDir, path.basename(rawFile));
    await processOne(rawFile, outFile, args.targetSize, args.inset);
    console.log(`[process-fx] wrote ${outFile}`);
  }
  console.log(`[process-fx] done (${rawFiles.length} strips)`);
}

main().catch((err) => {
  console.error('[process-fx] fatal:', err?.message || err);
  process.exit(1);
});
