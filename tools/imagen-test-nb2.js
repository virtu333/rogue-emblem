// Nano Banana 2 (Gemini 3.1 Flash Image) test — compare with Imagen 4 results
// Usage: node tools/imagen-test-nb2.js [--variants N] [--size SIZE]

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

// --- Config ---
const ROOT = resolve('C:/Users/davec/Documents/emblem-rogue');
const envPath = join(ROOT, '.env');
const envContent = readFileSync(envPath, 'utf8');
const keyMatch = envContent.match(/^GOOGLE_API_KEY=(.+)$/m);
if (!keyMatch) {
  console.error('Missing GOOGLE_API_KEY in .env');
  process.exit(1);
}
const API_KEY = keyMatch[1].trim();

const MODEL = 'gemini-3.1-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const OUTPUT_DIR = resolve(join(ROOT, 'References/imagen-output/nb2-test'));
const RATE_LIMIT_MS = 2000;

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const VARIANTS = parseInt(getArg('--variants', '4'), 10);
const IMAGE_SIZE = getArg('--size', '1K'); // 512px, 1K, 2K, 4K

mkdirSync(OUTPUT_DIR, { recursive: true });

// Same prompts as imagen-test.js for direct comparison
const tests = [
  {
    name: 'terrain_grass',
    prompt:
      'SNES 16-bit pixel art, single top-down terrain tile, green grass plain with subtle texture variation, Fire Emblem style tileset, clean pixel edges, no text, no border',
  },
  {
    name: 'terrain_forest',
    prompt:
      'SNES 16-bit pixel art, single top-down terrain tile, dense forest with tree canopy viewed from above on grass, Fire Emblem style tileset, clean pixel edges, no text, no border',
  },
  {
    name: 'sprite_knight',
    prompt:
      'SNES 16-bit pixel art character sprite, top-down 3/4 view, armored knight with lance and shield, blue palette, Fire Emblem map sprite style, single character centered on plain white background, 32x32 pixel art, no text',
  },
  {
    name: 'sprite_mage',
    prompt:
      'SNES 16-bit pixel art character sprite, top-down 3/4 view, mage in purple robes holding glowing tome, Fire Emblem map sprite style, single character centered on plain white background, 32x32 pixel art, no text',
  },
  {
    name: 'portrait_lord',
    prompt:
      'SNES 16-bit pixel art character portrait, head and shoulders bust, young noble lord with short blue hair, determined expression, silver circlet, blue cape over light armor, Fire Emblem style dialogue portrait, detailed pixel art face, no text',
  },
  {
    name: 'icon_sword',
    prompt:
      'SNES 16-bit pixel art weapon icon, steel sword with brown leather grip, RPG inventory icon style, single item centered on plain white background, clean pixel edges, no text',
  },
];

// --- Generate a single image ---
async function generateOne(prompt) {
  const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: IMAGE_SIZE,
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) {
    throw new Error('No image in response');
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// --- Run all tests ---
console.log(`Nano Banana 2 Test (${MODEL})`);
console.log(`Variants per prompt: ${VARIANTS}, Image size: ${IMAGE_SIZE}`);
console.log(`Output: ${OUTPUT_DIR}\n`);

let totalSaved = 0;
let totalFailed = 0;
let requestCount = 0;

for (const test of tests) {
  console.log(`[${test.name}]`);
  console.log(`  Prompt: ${test.prompt.substring(0, 80)}...`);

  for (let i = 0; i < VARIANTS; i++) {
    if (requestCount > 0) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
    requestCount++;

    try {
      const imageBuffer = await generateOne(test.prompt);
      const outPath = join(OUTPUT_DIR, `${test.name}_v${i}.png`);
      writeFileSync(outPath, imageBuffer);
      console.log(`  v${i}: saved (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
      totalSaved++;
    } catch (err) {
      console.error(`  v${i}: FAILED — ${err.message}`);
      totalFailed++;
    }
  }
}

console.log(`\nDone! Saved ${totalSaved} images, ${totalFailed} failures.`);
console.log(`Output: ${OUTPUT_DIR}`);
