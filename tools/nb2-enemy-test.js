#!/usr/bin/env node
// NB2 Enemy Sprite Test — Generate red-themed enemy variants of player sprites
// Uses the player NB2 sprite as reference anchor to maintain style consistency
// Also generates a ballista terrain sprite
//
// Usage: node tools/nb2-enemy-test.js [--dry-run] [--variants N]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve('.');
const envContent = readFileSync(join(ROOT, '.env'), 'utf8');
const keyMatch =
  envContent.match(/^GOOGLE_API_KEY=(.+)$/m) || envContent.match(/^GEMINI_API_KEY=(.+)$/m);
if (!keyMatch) {
  console.error('Missing GOOGLE_API_KEY or GEMINI_API_KEY in .env');
  process.exit(1);
}
const API_KEY = keyMatch[1].trim();

const MODEL = 'gemini-3.1-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const CHAR_DIR = join(ROOT, 'References/imagen-output/nb2-roster-v2');
const OUTPUT_DIR = join(ROOT, 'References/imagen-output/nb2-enemy-test');
const RATE_LIMIT_MS = 2500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VARIANTS = parseInt(
  args.includes('--variants') ? args[args.indexOf('--variants') + 1] : '2',
  10,
);

const STYLE = `90s SNES 16-bit pixel art character sprite in the style of Fire Emblem Thracia 776 and Tactics Ogre, top-down tactical RPG map sprite, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted color palette, weathered and battle-worn details, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head, NOT cute, NOT modern, NOT cartoonish`;

// Enemy color directive injected into all enemy prompts
const ENEMY_COLOR = `IMPORTANT: This is an ENEMY unit. Replace all blue/teal color accents with deep crimson red and dark blood-red tones. Armor should have dark iron/gunmetal finish instead of silver-blue. Cape/cloth should be dark red or black-red. Overall color palette shifted heavily toward reds, dark purples, and blacks.`;

// Test sample: 6 diverse classes covering infantry, armor, mounted, flying, magic, ranged
// Each gets an "enemy flavor" twist on top of the color swap
const ENEMY_SAMPLES = [
  {
    name: 'myrmidon',
    srcTier: 'base',
    desc: 'imperial dark swordsman in flowing deep crimson-red cloth with minimal dark iron armor, single battered katana in one hand, tattered blood-red scarf, menacing aggressive stance, no helmet, scarred face, NOT blue, NOT teal',
  },
  {
    name: 'knight',
    srcTier: 'base',
    desc: 'heavy imperial knight in dented dark iron full plate with crimson-red trim and brass rivets, scratched kite shield with red crest, short sturdy spear, bulky imposing silhouette, closed helmet with visor, menacing stance, NOT blue, NOT silver',
  },
  {
    name: 'archer',
    srcTier: 'base',
    desc: 'raider bowman with longbow drawn, quiver on back, worn dark red-brown leather armor over black tunic, no helmet, cruel focused eyes, crouched aggressive stance, bandit mercenary look, NOT blue, NOT green',
  },
  {
    name: 'mage',
    srcTier: 'base',
    desc: 'dark empire mage in deep crimson-black robes with dark purple trim, hood down, clutching tome crackling with dark red energy, pale skin, sinister expression, no hat, no helmet, NOT blue, NOT emerald',
  },
  {
    name: 'cavalier',
    srcTier: 'base',
    desc: 'imperial mounted cavalry knight on dark warhorse, short combat spear held upright, dark red tunic under black iron plate cuirass and pauldrons with crimson trim, tattered dark cape, no helmet, menacing expression, dark barding, NOT blue, NOT silver',
  },
  {
    name: 'pegasus_knight',
    srcTier: 'base',
    desc: 'dark sky raider riding dark grey-black winged pegasus, short combat spear, crimson-red tunic under dark iron chest plate, wild hair, wings spread, no helmet, menacing presence, dark corrupted pegasus, NOT white pegasus, NOT blue',
  },
];

// Ballista — terrain sprite, no reference anchor
const BALLISTA = {
  name: 'ballista',
  desc: 'medieval wooden siege ballista crossbow weapon mounted on a wooden platform, top-down 3/4 view, large bolt loaded, wooden construction with iron reinforcements, war machine, NO operator, NO person, empty weapon emplacement ready to fire',
};

// --- API helpers ---
let requestCount = 0;

async function rateLimitWait() {
  if (requestCount > 0) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  requestCount++;
}

async function generateWithRef(prompt, refImagePath) {
  await rateLimitWait();
  const refBytes = readFileSync(refImagePath);
  const base64Ref = refBytes.toString('base64');

  const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ inline_data: { mime_type: 'image/png', data: base64Ref } }, { text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) throw new Error('No image in response');
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function generateTextOnly(prompt) {
  await rateLimitWait();
  const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) throw new Error('No image in response');
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// --- Main ---
mkdirSync(join(OUTPUT_DIR, 'enemies'), { recursive: true });
mkdirSync(join(OUTPUT_DIR, 'terrain'), { recursive: true });

console.log(`NB2 Enemy Sprite Test`);
console.log(`Samples: ${ENEMY_SAMPLES.length} enemy classes + 1 ballista`);
console.log(`Variants: ${VARIANTS} per class`);
console.log(`Output: ${OUTPUT_DIR}`);
if (DRY_RUN) console.log(`DRY RUN — no API calls`);
console.log();

let saved = 0,
  failed = 0;

// Generate enemy variants (reference-anchored from player sprite)
for (const sample of ENEMY_SAMPLES) {
  const refPath = join(CHAR_DIR, sample.srcTier, `${sample.name}.png`);
  if (!existsSync(refPath)) {
    console.log(`[SKIP] ${sample.name} — reference not found at ${refPath}`);
    continue;
  }

  const prompt = `Generate a new ENEMY version of this character sprite in EXACTLY the same art style, proportions, and pixel density as the reference image, but with a completely different color scheme. ${ENEMY_COLOR} ${STYLE}. Enemy character: ${sample.desc}`;

  console.log(`[enemy/${sample.name}]`);
  if (DRY_RUN) {
    console.log(`  REF: ${refPath}`);
    console.log(`  PROMPT: ${prompt.substring(0, 150)}...`);
    continue;
  }

  for (let i = 0; i < VARIANTS; i++) {
    try {
      const buf = await generateWithRef(prompt, refPath);
      const outPath = join(OUTPUT_DIR, 'enemies', `${sample.name}_v${i}.png`);
      writeFileSync(outPath, buf);
      console.log(`  v${i}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
      saved++;
    } catch (err) {
      console.error(`  v${i}: FAILED — ${err.message}`);
      failed++;
    }
  }
}

// Generate ballista (text-only, no reference)
console.log(`\n[terrain/ballista]`);
const ballistaPrompt = `${STYLE}, ${BALLISTA.desc}`;

if (DRY_RUN) {
  console.log(`  PROMPT: ${ballistaPrompt.substring(0, 150)}...`);
} else {
  for (let i = 0; i < VARIANTS; i++) {
    try {
      const buf = await generateTextOnly(ballistaPrompt);
      const outPath = join(OUTPUT_DIR, 'terrain', `ballista_v${i}.png`);
      writeFileSync(outPath, buf);
      console.log(`  v${i}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
      saved++;
    } catch (err) {
      console.error(`  v${i}: FAILED — ${err.message}`);
      failed++;
    }
  }
}

console.log(`\nDone! ${saved} saved, ${failed} failed. API calls: ${requestCount}`);
console.log(`Output: ${OUTPUT_DIR}`);
