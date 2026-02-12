#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict';
const DEFAULT_MANIFEST = path.resolve('tools/imagen-pipeline/manifest.json');
const DEFAULT_OUT = path.resolve('tools/imagen-pipeline/output/raw');
const REQUEST_DELAY_MS = 2000;

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    outDir: DEFAULT_OUT,
    dryRun: false,
    category: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--manifest') args.manifest = path.resolve(argv[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (a === '--category') args.category = argv[++i];
    else if (a === '--help') args.help = true;
  }
  return args;
}

function usage() {
  console.log([
    'Usage: node tools/imagen-pipeline/generate.js [options]',
    '',
    'Options:',
    '  --manifest <path>   Manifest JSON path',
    '  --out-dir <path>    Raw output root (default: tools/imagen-pipeline/output/raw)',
    '  --category <name>   Generate only one category',
    '  --dry-run           Print prompts without API calls',
    '  --help              Show this message',
  ].join('\n'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(globalStyle, categoryCfg, asset) {
  return [
    globalStyle || '',
    categoryCfg.stylePrefix || '',
    asset.prompt || '',
  ].filter(Boolean).join('\n\n');
}

async function readManifest(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.categories) {
    throw new Error(`Invalid manifest: missing categories in ${filePath}`);
  }
  return parsed;
}

function extractBase64List(responseJson) {
  const preds = Array.isArray(responseJson?.predictions) ? responseJson.predictions : [];
  const out = [];
  for (const p of preds) {
    if (typeof p?.bytesBase64Encoded === 'string') out.push(p.bytesBase64Encoded);
    else if (typeof p?.image?.bytesBase64Encoded === 'string') out.push(p.image.bytesBase64Encoded);
  }
  return out;
}

async function callImagen(apiKey, promptText, categoryCfg) {
  const sampleCount = Number.isInteger(categoryCfg.sampleCount) ? categoryCfg.sampleCount : 4;
  const aspectRatio = categoryCfg.aspectRatio || '1:1';
  const body = {
    instances: [{ prompt: promptText }],
    parameters: { sampleCount, aspectRatio },
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Imagen API ${res.status}: ${text}`);
  }
  return res.json();
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function saveVariants(baseDir, categoryName, assetName, base64Images) {
  const categoryDir = path.join(baseDir, categoryName);
  await ensureDir(categoryDir);
  const saved = [];
  for (let i = 0; i < base64Images.length; i++) {
    const variant = i + 1;
    const fileName = `${assetName}_v${variant}.png`;
    const filePath = path.join(categoryDir, fileName);
    const buffer = Buffer.from(base64Images[i], 'base64');
    await fs.writeFile(filePath, buffer);
    saved.push(filePath);
  }
  return saved;
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!args.dryRun && !apiKey) {
    throw new Error('GEMINI_API_KEY is required unless --dry-run is used');
  }

  let totalAssets = 0;
  let successAssets = 0;
  let failedAssets = 0;

  for (const [categoryName, categoryCfg] of filtered) {
    const assets = Array.isArray(categoryCfg.assets) ? categoryCfg.assets : [];
    console.log(`\n[imagen] category=${categoryName} assets=${assets.length}`);
    for (const asset of assets) {
      totalAssets++;
      const promptText = buildPrompt(manifest.globalStyle, categoryCfg, asset);
      const id = `${categoryName}/${asset.name}`;
      if (args.dryRun) {
        console.log(`\n[dry-run] ${id}\n${promptText}`);
        successAssets++;
        continue;
      }

      try {
        console.log(`[imagen] generating ${id} ...`);
        const responseJson = await callImagen(apiKey, promptText, categoryCfg);
        const images = extractBase64List(responseJson);
        if (images.length === 0) {
          throw new Error('No image bytes returned');
        }
        const saved = await saveVariants(args.outDir, categoryName, asset.name, images);
        console.log(`[imagen] saved ${saved.length} variant(s) for ${id}`);
        successAssets++;
      } catch (err) {
        failedAssets++;
        console.error(`[imagen] failed ${id}:`, err?.message || err);
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log('\n[imagen] done');
  console.log(`[imagen] assets total=${totalAssets} success=${successAssets} failed=${failedAssets}`);
  if (failedAssets > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[imagen] fatal:', err?.message || err);
  process.exit(1);
});
