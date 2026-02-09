// Quick Imagen API test — generate a few test assets to evaluate quality
// Usage: node tools/imagen-test.js

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

// Load API key from .env
const envPath = resolve('C:/Users/davec/Documents/emblem-rogue/.env');
const envLine = readFileSync(envPath, 'utf8').trim();
const API_KEY = envLine.split('=')[1];

const MODEL = 'imagen-4.0-generate-001';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict`;
const OUTPUT_DIR = resolve('C:/Users/davec/Documents/emblem-rogue/References/imagen-test');

mkdirSync(OUTPUT_DIR, { recursive: true });

// Test prompts — one per asset type we care about
const tests = [
  {
    name: 'terrain_grass',
    prompt: 'SNES 16-bit pixel art, single top-down terrain tile, green grass plain with subtle texture variation, Fire Emblem style tileset, clean pixel edges, no text, no border',
  },
  {
    name: 'terrain_forest',
    prompt: 'SNES 16-bit pixel art, single top-down terrain tile, dense forest with tree canopy viewed from above on grass, Fire Emblem style tileset, clean pixel edges, no text, no border',
  },
  {
    name: 'sprite_knight',
    prompt: 'SNES 16-bit pixel art character sprite, top-down 3/4 view, armored knight with lance and shield, blue palette, Fire Emblem map sprite style, single character centered on plain white background, 32x32 pixel art, no text',
  },
  {
    name: 'sprite_mage',
    prompt: 'SNES 16-bit pixel art character sprite, top-down 3/4 view, mage in purple robes holding glowing tome, Fire Emblem map sprite style, single character centered on plain white background, 32x32 pixel art, no text',
  },
  {
    name: 'portrait_lord',
    prompt: 'SNES 16-bit pixel art character portrait, head and shoulders bust, young noble lord with short blue hair, determined expression, silver circlet, blue cape over light armor, Fire Emblem style dialogue portrait, detailed pixel art face, no text',
  },
  {
    name: 'icon_sword',
    prompt: 'SNES 16-bit pixel art weapon icon, steel sword with brown leather grip, RPG inventory icon style, single item centered on plain white background, clean pixel edges, no text',
  },
];

async function generate(test) {
  console.log(`\nGenerating: ${test.name}...`);
  console.log(`  Prompt: ${test.prompt.substring(0, 80)}...`);

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [{ prompt: test.prompt }],
      parameters: {
        sampleCount: 4,
        aspectRatio: '1:1',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`  FAILED (${response.status}): ${err.substring(0, 200)}`);
    return;
  }

  const data = await response.json();
  const predictions = data.predictions || [];
  console.log(`  Got ${predictions.length} variants`);

  for (let i = 0; i < predictions.length; i++) {
    const b64 = predictions[i].bytesBase64Encoded;
    if (!b64) {
      console.log(`  Variant ${i}: no image data`);
      continue;
    }
    const outPath = join(OUTPUT_DIR, `${test.name}_v${i}.png`);
    writeFileSync(outPath, Buffer.from(b64, 'base64'));
    console.log(`  Saved: ${outPath}`);
  }
}

// Run sequentially with 2s delay between requests
for (let i = 0; i < tests.length; i++) {
  if (i > 0) {
    console.log('\n  (waiting 2s for rate limit...)');
    await new Promise(r => setTimeout(r, 2000));
  }
  await generate(tests[i]);
}

console.log(`\nDone! Check ${OUTPUT_DIR} for results.`);
