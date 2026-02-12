#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULT_MANIFEST = path.resolve('tools/imagen-pipeline/manifest.json');
const DEFAULT_RAW = path.resolve('tools/imagen-pipeline/output/raw');
const DEFAULT_OUT = path.resolve('tools/imagen-pipeline/output/processed');

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    inputDir: DEFAULT_RAW,
    outDir: DEFAULT_OUT,
    category: null,
    targetSize: null,
    removeBg: false,
    paletteFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') args.manifest = path.resolve(argv[++i]);
    else if (a === '--input-dir') args.inputDir = path.resolve(argv[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (a === '--category') args.category = argv[++i];
    else if (a === '--target-size') args.targetSize = Number(argv[++i]);
    else if (a === '--remove-bg') args.removeBg = true;
    else if (a === '--palette') args.paletteFile = path.resolve(argv[++i]);
    else if (a === '--help') args.help = true;
  }
  return args;
}

function usage() {
  console.log([
    'Usage: node tools/imagen-pipeline/process.js [options]',
    '',
    'Options:',
    '  --manifest <path>     Manifest JSON path',
    '  --input-dir <path>    Raw input root (default: tools/imagen-pipeline/output/raw)',
    '  --out-dir <path>      Processed output root (default: tools/imagen-pipeline/output/processed)',
    '  --category <name>     Process one category only',
    '  --target-size <n>     Override category target size',
    '  --remove-bg           Force background removal',
    '  --palette <file>      Palette file (.json array or newline hex list)',
    '  --help                Show this message',
  ].join('\n'));
}

async function readManifest(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed?.categories) throw new Error(`Invalid manifest: ${filePath}`);
  return parsed;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function parseHexColor(input) {
  const s = input.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

async function readPalette(filePath) {
  if (!filePath) return null;
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      const out = arr.map((v) => parseHexColor(String(v))).filter(Boolean);
      if (out.length > 0) return out;
    }
  } catch (_) {
    // Fall back to line-based parsing.
  }
  const out = raw
    .split(/\r?\n/)
    .map((line) => parseHexColor(line))
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

function colorKey(r, g, b) {
  return `${r},${g},${b}`;
}

function dominantEdgeColor(data, width, height, channels) {
  const counts = new Map();
  const push = (x, y) => {
    const idx = (y * width + x) * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a === 0) return;
    const key = colorKey(r, g, b);
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
  if (!best) return null;
  return best.split(',').map(Number);
}

function removeBackgroundByEdgeColor(data, width, height, channels, tolerance = 24) {
  const edge = dominantEdgeColor(data, width, height, channels);
  if (!edge) return data;
  const [er, eg, eb] = edge;
  const out = Buffer.from(data);
  const tolSq = tolerance * tolerance;
  for (let i = 0; i < out.length; i += channels) {
    const dr = out[i] - er;
    const dg = out[i + 1] - eg;
    const db = out[i + 2] - eb;
    if ((dr * dr + dg * dg + db * db) <= tolSq) {
      out[i + 3] = 0;
    }
  }
  return out;
}

function nearestColor([r, g, b], palette) {
  let best = palette[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of palette) {
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

async function applyPalette(buffer, palette) {
  if (!palette || palette.length === 0) return buffer;
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += info.channels) {
    if (out[i + 3] === 0) continue;
    const mapped = nearestColor([out[i], out[i + 1], out[i + 2]], palette);
    out[i] = mapped[0];
    out[i + 1] = mapped[1];
    out[i + 2] = mapped[2];
  }
  return sharp(out, { raw: info }).png().toBuffer();
}

function stripVariant(fileName) {
  return fileName.replace(/_v\d+\.png$/i, '').replace(/\.png$/i, '');
}

async function pickRawFile(categoryDir, assetName) {
  const entries = await fs.readdir(categoryDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png') && e.name.startsWith(`${assetName}_v`))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (candidates.length === 0) return null;
  return path.join(categoryDir, candidates[0]); // v1 preferred
}

async function processOne(rawFile, outFile, targetSize, removeBg, palette) {
  let current = await fs.readFile(rawFile);

  if (removeBg) {
    const { data, info } = await sharp(current).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cut = removeBackgroundByEdgeColor(data, info.width, info.height, info.channels);
    current = await sharp(cut, { raw: info }).png().toBuffer();
  }

  current = await sharp(current)
    .resize({
      width: targetSize,
      height: targetSize,
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      withoutEnlargement: false,
    })
    .png({ palette: !palette, colours: 32 })
    .toBuffer();

  current = await applyPalette(current, palette);
  await fs.writeFile(outFile, current);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const manifest = await readManifest(args.manifest);
  const categories = Object.entries(manifest.categories);
  const filtered = args.category
    ? categories.filter(([name]) => name === args.category)
    : categories;

  if (filtered.length === 0) {
    throw new Error(args.category
      ? `No category '${args.category}' found in manifest`
      : 'No categories in manifest');
  }

  const palette = await readPalette(args.paletteFile);
  let processed = 0;
  let skipped = 0;

  for (const [categoryName, categoryCfg] of filtered) {
    const categoryIn = path.join(args.inputDir, categoryName);
    const categoryOut = path.join(args.outDir, categoryName);
    await ensureDir(categoryOut);

    const assets = Array.isArray(categoryCfg.assets) ? categoryCfg.assets : [];
    const targetSize = Number.isInteger(args.targetSize) ? args.targetSize : (categoryCfg.targetSize || 32);
    const removeBg = args.removeBg || Boolean(categoryCfg.removeBg);

    console.log(`\n[process] category=${categoryName} target=${targetSize} removeBg=${removeBg}`);
    for (const asset of assets) {
      const rawFile = await pickRawFile(categoryIn, asset.name);
      if (!rawFile) {
        console.warn(`[process] missing raw file for ${categoryName}/${asset.name}`);
        skipped++;
        continue;
      }
      const outFile = path.join(categoryOut, `${stripVariant(path.basename(rawFile))}.png`);
      await processOne(rawFile, outFile, targetSize, removeBg, palette);
      processed++;
      console.log(`[process] wrote ${outFile}`);
    }
  }

  console.log(`\n[process] done processed=${processed} skipped=${skipped}`);
}

main().catch((err) => {
  console.error('[process] fatal:', err?.message || err);
  process.exit(1);
});
