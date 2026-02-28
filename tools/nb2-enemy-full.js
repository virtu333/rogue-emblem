#!/usr/bin/env node
// NB2 Enemy Roster — Full generation of red-themed enemy variants
// Reference-anchored from NB2 player sprites for style consistency
//
// Usage: node tools/nb2-enemy-full.js [--dry-run] [--variants N] [--filter NAME]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve('.');
const envContent = readFileSync(join(ROOT, '.env'), 'utf8');
const keyMatch =
  envContent.match(/^GOOGLE_API_KEY=(.+)$/m) || envContent.match(/^GEMINI_API_KEY=(.+)$/m);
if (!keyMatch) {
  console.error('Missing API key in .env');
  process.exit(1);
}
const API_KEY = keyMatch[1].trim();

const MODEL = 'gemini-3.1-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const NB2_DIR = join(ROOT, 'References/imagen-output/nb2-roster-v2');
const OUTPUT_DIR = join(ROOT, 'References/imagen-output/nb2-enemy-full');
const RATE_LIMIT_MS = 2500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VARIANTS = parseInt(
  args.includes('--variants') ? args[args.indexOf('--variants') + 1] : '2',
  10,
);
const FILTER = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;

const STYLE = `90s SNES 16-bit pixel art character sprite in the style of Fire Emblem Thracia 776 and Tactics Ogre, top-down tactical RPG map sprite, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted color palette, weathered and battle-worn details, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head, NOT cute, NOT modern, NOT cartoonish`;

const ENEMY_COLOR = `IMPORTANT: This is an ENEMY unit. Replace all blue/teal color accents with deep crimson red and dark blood-red tones. Armor should have dark iron/gunmetal finish instead of silver-blue. Cape/cloth should be dark red or black-red. Overall color palette shifted heavily toward reds, dark purples, and blacks. The darker and more menacing the better.`;

// ── All 31 shared enemy classes ──────────────────────────────────────────
// Each has: name, srcTier (where to find NB2 player ref), desc (enemy-flavored)

const ENEMY_CLASSES = [
  // --- BASE (11) ---
  {
    name: 'archer',
    srcTier: 'base',
    desc: 'raider bowman with longbow drawn, quiver on back, worn dark red-brown leather armor over black tunic, no helmet, cruel focused eyes, crouched aggressive stance, bandit mercenary look, NOT blue, NOT green',
  },
  {
    name: 'cavalier',
    srcTier: 'base',
    desc: 'imperial mounted cavalry knight on dark warhorse, short combat spear held upright, dark red tunic under black iron plate cuirass and pauldrons with crimson trim, tattered dark cape, no helmet, menacing expression, dark barding, NOT blue, NOT silver',
  },
  {
    name: 'cleric',
    srcTier: 'base',
    desc: 'dark empire healer in deep crimson-red robes with black trim, dark healing staff with blood-red crystal tip, stern cold expression, no helmet, NOT white, NOT blue',
  },
  {
    name: 'fighter',
    srcTier: 'base',
    desc: 'brutal raider axe fighter, leather straps across scarred chest, large worn battle axe, dark red bandana, black trousers, aggressive threatening stance, NOT blue',
  },
  {
    name: 'knight',
    srcTier: 'base',
    desc: 'heavy imperial knight in dented dark iron full plate with crimson-red trim and brass rivets, scratched kite shield with red crest, short sturdy spear, bulky imposing silhouette, closed helmet with visor, menacing stance, NOT blue, NOT silver',
  },
  {
    name: 'mage',
    srcTier: 'base',
    desc: 'dark empire mage in deep crimson-black robes with dark purple trim, hood down, clutching tome crackling with dark red energy, pale skin, sinister expression, no hat, no helmet, NOT blue, NOT emerald',
  },
  {
    name: 'mercenary',
    srcTier: 'base',
    desc: 'hostile sellsword in dark red-grey tunic with worn black leather armor, longsword ready, no helmet, scarred face, threatening stance, NOT blue',
  },
  {
    name: 'myrmidon',
    srcTier: 'base',
    desc: 'imperial dark swordsman in flowing deep crimson-red cloth with minimal dark iron armor, single battered katana, tattered blood-red scarf, menacing aggressive stance, no helmet, scarred face, NOT blue, NOT teal',
  },
  {
    name: 'pegasus_knight',
    srcTier: 'base',
    desc: 'dark sky raider riding dark grey-black winged pegasus, short combat spear, crimson-red tunic under dark iron chest plate, wild hair, wings spread, no helmet, menacing presence, dark corrupted pegasus, NOT white pegasus, NOT blue',
  },
  {
    name: 'thief',
    srcTier: 'base',
    desc: 'sinister enemy rogue in dark black-red cloak with crimson lining, twin daggers, hood covering face, crouched predatory pose, leather wraps on arms, NOT blue, NOT purple',
  },
  {
    name: 'wyvern_rider',
    srcTier: 'base',
    desc: 'dark rider mounted on large dark red-black wyvern dragon in flight with wings spread, short war spear, dented dark iron pauldrons and cuirass over worn leather, no helmet, menacing expression, wyvern larger than rider, airborne, NOT green, NOT blue',
  },

  // --- PROMOTED (20) ---
  {
    name: 'assassin',
    srcTier: 'promoted',
    desc: 'deadly enemy shadow assassin in black leather with deep crimson accents, single blade drawn, face mask, crouched low, sinister red eye glow, NOT purple, NOT blue',
  },
  {
    name: 'battle_monk',
    srcTier: 'promoted',
    desc: 'enemy warrior monk in dark red-black combat robes reinforced with dark iron, large axe and dark staff, muscular build, shaved head, menacing scars, NOT blue, NOT white',
  },
  {
    name: 'berserker',
    srcTier: 'promoted',
    desc: 'unhinged enemy berserker with massive double-bladed axe, wild unkempt hair, minimal armor showing old scars, dark red tribal markings on arms and chest, feral bloodthirsty stance, NOT blue',
  },
  {
    name: 'bishop',
    srcTier: 'promoted',
    desc: 'corrupt dark bishop in ornate deep crimson vestments with black embroidery, dark glowing staff, cold menacing aura, sinister expression, dark circlet, NOT white, NOT gold, NOT blue',
  },
  {
    name: 'bow_knight',
    srcTier: 'promoted',
    desc: 'enemy mounted archer on dark brown horse, longbow and sword, dark red tunic under black leather cavalry armor, no helmet, aggressive posture, dark barding, NOT blue, NOT green',
  },
  {
    name: 'dark_knight',
    srcTier: 'promoted',
    desc: 'enemy dark mounted knight on black horse, short combat spear and dark tome, deep crimson-black tunic under dark iron plate with red trim, shadowy dark aura, no helmet, NOT blue, NOT purple',
  },
  {
    name: 'duelist',
    srcTier: 'promoted',
    desc: 'enemy imperial fencer with single ornate sword, dark iron cuirass and bracers over crimson-red dueling tunic with black trim, flowing dark cape, aggressive stance, no helmet, NOT blue, NOT silver',
  },
  {
    name: 'falcon_knight',
    srcTier: 'promoted',
    desc: 'enemy sky commander on dark grey-black pegasus, short spear, dark crimson-red armor with black trim, wings spread wide, no helmet, aggressive and dangerous, dark corrupted pegasus, NOT white, NOT blue, NOT gold',
  },
  {
    name: 'general',
    srcTier: 'promoted',
    desc: 'enormous enemy general in fortress-like dark iron plate with crimson trim, massive dented shield with red crest, short heavy spear, towering imposing silhouette, closed great helm, NOT blue, NOT silver',
  },
  {
    name: 'great_knight',
    srcTier: 'promoted',
    desc: 'massive enemy mounted fortress knight on dark armored warhorse, sword and heavy spear, dark iron cavalry plate with crimson accents, closed great helm, enormous menacing silhouette, heavy dark barding, NOT blue',
  },
  {
    name: 'hero',
    srcTier: 'promoted',
    desc: 'veteran enemy champion with sword and hand axe, scarred dark red medium armor over black tunic, battle-hardened threatening stance, no helmet, NOT blue',
  },
  {
    name: 'hunter',
    srcTier: 'promoted',
    desc: 'enemy wilderness tracker with longbow and sword, dark red-brown cloak over worn black leather vest, animal pelts on shoulders, no helmet, hostile expression, NOT blue, NOT green',
  },
  {
    name: 'paladin',
    srcTier: 'promoted',
    desc: 'dark enemy mounted knight on black horse, sword and shield, deep crimson tunic under dark iron plate with red trim, tattered dark cape, no helmet, imposing menacing presence, dark barding, NOT white, NOT blue, NOT gold',
  },
  {
    name: 'sage',
    srcTier: 'promoted',
    desc: 'enemy dark mage in deep crimson robes with black embroidery, staff and open tome crackling dark energy, sinister aura, grey-streaked hair, NOT purple, NOT blue',
  },
  {
    name: 'sniper',
    srcTier: 'promoted',
    desc: 'enemy elite archer with ornate longbow, dark red-brown leather armor with black buckles, quiver of dark-fletched arrows, cruel watchful eyes, hooded, NOT blue, NOT green',
  },
  {
    name: 'swordmaster',
    srcTier: 'promoted',
    desc: 'enemy master swordsman in flowing crimson-black robes over dark leather, ornate katana with dark glow, intense deadly stance, tattered dark sash, no helmet, NOT blue, NOT white',
  },
  {
    name: 'trickster',
    srcTier: 'promoted',
    desc: 'cunning enemy rogue in dark red outfit with black accents, rapier and small dark staff, sinister smirk, quick-footed pose, no helmet, NOT blue',
  },
  {
    name: 'warlock',
    srcTier: 'promoted',
    desc: 'enemy dark sorcerer in black-crimson robes with dark runes, tome crackling with shadow energy, gaunt sinister expression, pale skin, NOT blue, NOT purple',
  },
  {
    name: 'warrior',
    srcTier: 'promoted',
    desc: 'powerful enemy warrior with great axe and shortbow, dark iron plate with one pauldron over scarred skin, dark red fur trim, dark helmet with nose guard, red war paint, fierce aggressive stance, NOT blue',
  },
  {
    name: 'wyvern_lord',
    srcTier: 'promoted',
    desc: 'fearsome enemy rider mounted on large armored dark red-black wyvern in flight, hand axe and war spear, dark iron dragon-scale armor with crimson accents, no helmet, commanding menacing presence, wyvern much larger than rider, airborne, NOT blue, NOT green',
  },
];

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
    throw new Error(`API ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) throw new Error('No image in response');
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// --- Main ---
const filtered = FILTER
  ? ENEMY_CLASSES.filter((e) => e.name.toLowerCase().includes(FILTER.toLowerCase()))
  : ENEMY_CLASSES;

mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`NB2 Enemy Roster — Full Generation`);
console.log(`Classes: ${filtered.length}, Variants: ${VARIANTS}`);
console.log(`API calls: ~${filtered.length * VARIANTS}`);
console.log(`Est. time: ~${Math.ceil((filtered.length * VARIANTS * RATE_LIMIT_MS) / 60000)} min`);
console.log(`Output: ${OUTPUT_DIR}`);
if (DRY_RUN) console.log(`DRY RUN — no API calls`);
console.log();

let saved = 0,
  failed = 0;

for (const entry of filtered) {
  const refPath = join(NB2_DIR, entry.srcTier, `${entry.name}.png`);
  if (!existsSync(refPath)) {
    console.log(`[SKIP] ${entry.name} — reference not found`);
    continue;
  }

  const prompt = `Generate a new ENEMY version of this character sprite in EXACTLY the same art style, proportions, and pixel density as the reference image, but with a completely different color scheme. ${ENEMY_COLOR} ${STYLE}. Enemy character: ${entry.desc}`;

  console.log(`[${entry.srcTier}/${entry.name}]`);

  if (DRY_RUN) {
    console.log(`  REF: ${entry.srcTier}/${entry.name}.png`);
    continue;
  }

  for (let i = 0; i < VARIANTS; i++) {
    try {
      const buf = await generateWithRef(prompt, refPath);
      const outPath = join(OUTPUT_DIR, `${entry.name}_v${i}.png`);
      writeFileSync(outPath, buf);
      console.log(`  v${i}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
      saved++;
    } catch (err) {
      console.error(`  v${i}: FAILED — ${err.message}`);
      failed++;
    }
  }
}

console.log(`\nDone! ${saved} saved, ${failed} failed.`);
console.log(`API calls: ${requestCount}`);
console.log(`Output: ${OUTPUT_DIR}`);
