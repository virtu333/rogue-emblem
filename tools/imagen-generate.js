// Manifest-driven Imagen 4 asset generator
// Usage: node tools/imagen-generate.js [--dry-run] [--category NAME] [--asset NAME]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

// --- Config ---
const ROOT = resolve('C:/Users/davec/Documents/emblem-rogue');
const MANIFEST_PATH = join(ROOT, 'References/imagen-manifest.json');
const OUTPUT_DIR = join(ROOT, 'References/imagen-output');
const RAW_DIR = join(OUTPUT_DIR, 'raw');
const MODEL = 'imagen-4.0-generate-001';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict`;
const RATE_LIMIT_MS = 2000;
const SAMPLE_COUNT = 4;

// --- Load API key from .env ---
const envPath = join(ROOT, '.env');
const envLine = readFileSync(envPath, 'utf8').trim();
const API_KEY = envLine.split('=')[1];

// --- Parse CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const categoryFilter = getArg('--category');
const assetFilter = getArg('--asset');

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

// --- Load manifest ---
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const { globalStyle, categories } = manifest;

// --- Build prompt for an asset ---
function buildPrompt(category, asset) {
  return `${globalStyle}, ${category.stylePrefix}, ${asset.prompt}`;
}

// --- Generate images for one asset ---
async function generateAsset(catName, category, asset) {
  const prompt = buildPrompt(category, asset);
  console.log(`\n[${catName}/${asset.name}]`);
  console.log(`  Prompt: ${prompt.substring(0, 120)}...`);

  if (dryRun) {
    console.log('  (dry run — skipping API call)');
    return { name: asset.name, category: catName, prompt, variants: 0 };
  }

  const outDir = join(RAW_DIR, catName);
  mkdirSync(outDir, { recursive: true });

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: SAMPLE_COUNT,
          aspectRatio: category.aspectRatio || '1:1',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`  FAILED (${response.status}): ${err.substring(0, 200)}`);
      return { name: asset.name, category: catName, prompt, variants: 0, error: response.status };
    }

    const data = await response.json();
    const predictions = data.predictions || [];
    let saved = 0;

    for (let i = 0; i < predictions.length; i++) {
      const b64 = predictions[i].bytesBase64Encoded;
      if (!b64) continue;
      const outPath = join(outDir, `${asset.name}_v${i}.png`);
      writeFileSync(outPath, Buffer.from(b64, 'base64'));
      saved++;
    }

    console.log(`  Saved ${saved} variants`);
    return { name: asset.name, category: catName, prompt, variants: saved };
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    return { name: asset.name, category: catName, prompt, variants: 0, error: err.message };
  }
}

// --- Main ---
const index = { generatedAt: new Date().toISOString(), assets: [] };
let requestCount = 0;

for (const [catName, category] of Object.entries(categories)) {
  if (categoryFilter && catName !== categoryFilter) continue;

  console.log(`\n=== Category: ${catName} ===`);

  for (const asset of category.assets) {
    if (assetFilter && asset.name !== assetFilter) continue;

    // Rate limit (skip delay before first request)
    if (requestCount > 0 && !dryRun) {
      console.log('  (waiting 2s for rate limit...)');
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }

    const result = await generateAsset(catName, category, asset);
    index.assets.push(result);
    requestCount++;
  }
}

// Write index.json for compare.html
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

// Copy compare.html into output dir so it can be served alongside the images
const compareSource = join(ROOT, 'tools/imagen-compare.html');
if (existsSync(compareSource)) {
  writeFileSync(join(OUTPUT_DIR, 'compare.html'), readFileSync(compareSource));
}

const total = index.assets.reduce((sum, a) => sum + a.variants, 0);
console.log(`\nDone! Generated ${total} images across ${index.assets.length} assets.`);
console.log(`Index written to ${join(OUTPUT_DIR, 'index.json')}`);
console.log(`\nTo review: npx serve References/imagen-output → open compare.html`);
