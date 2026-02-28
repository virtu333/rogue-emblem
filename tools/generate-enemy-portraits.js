#!/usr/bin/env node
// Generate enemy-faction portraits for all 36 enemy classes
// Uses existing player portraits as style references via Gemini image-to-image
//
// Usage:
//   node tools/generate-enemy-portraits.js             # full run
//   node tools/generate-enemy-portraits.js --dry-run   # print prompts only
//   node tools/generate-enemy-portraits.js --only knight,mage  # specific classes
//   node tools/generate-enemy-portraits.js --variants 2        # N variants per class

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

// --- Config ---
const ROOT = resolve(import.meta.dirname, '..');
const envContent = readFileSync(join(ROOT, '.env'), 'utf8');
const keyMatch = envContent.match(/^GOOGLE_API_KEY=(.+)$/m);
if (!keyMatch) {
  console.error('Missing GOOGLE_API_KEY in .env');
  process.exit(1);
}
const API_KEY = keyMatch[1].trim();

const MODEL = 'gemini-3.1-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const OUTPUT_DIR = join(ROOT, 'References/imagen-output/enemy-portraits');
const PORTRAITS_DIR = join(ROOT, 'assets/portraits');
const RATE_LIMIT_MS = 3000; // 3s between requests to stay under quota

// --- CLI ---
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const USE_REF = args.includes('--use-ref'); // opt-in: reference images are slow (~60s vs ~10s)
const ONLY = getArg('--only', null);
const VARIANTS = parseInt(getArg('--variants', '1'), 10);
const onlySet = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;

// --- Style base prompt ---
const STYLE_PREFIX =
  'SNES 16-bit pixel art character portrait, 128x128 pixel art with visible individual pixels, ' +
  'head and shoulders bust, 3/4 angle, solid black background. ';
const STYLE_SUFFIX =
  ' Fire Emblem style dialogue portrait, limited color palette emphasizing reds and dark tones, ' +
  'clean pixel edges. Enemy faction — corrupted soldier, human but hostile.';

// --- 36 enemy portrait definitions ---
// Each: { class, refPortrait (existing player portrait filename), description }
const ENEMY_PORTRAITS = [
  // --- Shared classes (32) - have existing generic_* player portraits ---
  {
    class: 'fighter',
    ref: 'generic_fighter.png',
    desc: 'Enemy fighter in dark red leather armor, brutish expression, thick arms, wielding a hand axe, battle-scarred and aggressive.',
  },
  {
    class: 'mage',
    ref: 'generic_mage.png',
    desc: 'Enemy dark mage in black and crimson robes, sinister expression, pale skin, holding a dark tome, corrupted scholar.',
  },
  {
    class: 'cleric',
    ref: 'generic_cleric.png',
    desc: 'Enemy dark cleric in black and red vestments, cold calculating expression, corrupted healer, dark staff, unholy aura.',
  },
  {
    class: 'archer',
    ref: 'generic_archer.png',
    desc: 'Enemy archer in dark red hooded cloak, sharp predatory eyes, longbow over shoulder, scarred hands, cold and precise.',
  },
  {
    class: 'cavalier',
    ref: 'generic_cavalier.png',
    desc: 'Enemy cavalier in dark red and black plate armor, mounted warrior, stern hostile face, lance at ready, disciplined but cruel.',
  },
  {
    class: 'knight',
    ref: 'generic_knight.png',
    desc: 'Enemy knight in heavy dark red and black full plate armor, menacing scarred face, glowing red eyes under visor, immovable wall.',
  },
  {
    class: 'myrmidon',
    ref: 'generic_myrmidon.png',
    desc: 'Enemy swordsman in dark red and black clothing, aggressive expression, wild hair, battle scars, katana, ruthless blade fighter.',
  },
  {
    class: 'thief',
    ref: 'generic_thief.png',
    desc: 'Enemy thief in dark red and black leather, hooded, cunning smirk, daggers visible, shadowy and untrustworthy, quick and lethal.',
  },
  {
    class: 'pegasus_knight',
    ref: 'generic_pegasus_knight.png',
    desc: 'Enemy pegasus knight in dark red and black light armor, windswept hair, fierce aerial warrior, lance in hand, dark wings behind.',
  },
  {
    class: 'mercenary',
    ref: 'generic_mercenary.png',
    desc: 'Enemy mercenary in dark red and grey armor, grizzled face, sword resting on shoulder, sellsword with no loyalty, cold professional.',
  },
  {
    class: 'dancer',
    ref: 'generic_dancer.png',
    desc: 'Enemy dancer in dark red and black flowing garments, mesmerizing but dangerous expression, dark enchantress, veiled threat.',
  },
  {
    class: 'wyvern_rider',
    ref: 'generic_wyvern_rider.png',
    desc: 'Enemy wyvern rider in dark red and black scale armor, fierce scowl, dragon-scale pauldrons, lance, draconic warrior from above.',
  },
  {
    class: 'swordmaster',
    ref: 'generic_swordmaster.png',
    desc: 'Enemy swordmaster in dark red and black traditional garb, calm deadly expression, perfect posture, katana drawn, lethal precision.',
  },
  {
    class: 'assassin',
    ref: 'generic_assassin.png',
    desc: 'Enemy assassin in dark red and black, face half-hidden by mask, cold emotionless eyes, twin blades, silent killer.',
  },
  {
    class: 'hero',
    ref: 'generic_hero.png',
    desc: 'Enemy hero in dark red and black heavy armor, battle-hardened face, sword and shield, fallen champion turned hostile, imposing presence.',
  },
  {
    class: 'sniper',
    ref: 'generic_sniper.png',
    desc: 'Enemy sniper in dark red and black coat, one eye narrowed, elite marksman, longbow, patient and deadly, never misses.',
  },
  {
    class: 'sage',
    ref: 'generic_sage.png',
    desc: 'Enemy sage in dark crimson and black robes, weathered face, ancient dark knowledge, tome and staff, corrupted wisdom.',
  },
  {
    class: 'bishop',
    ref: 'generic_bishop.png',
    desc: 'Enemy bishop in dark red and black holy vestments, fanatical expression, corrupted faith, dark mitre, zealous and dangerous.',
  },
  {
    class: 'falcon_knight',
    ref: 'generic_falcon_knight.png',
    desc: 'Enemy falcon knight in dark red and silver armor, fierce aerial warrior, windswept hair, lance and shield, dark wings spread.',
  },
  {
    class: 'general',
    ref: 'generic_general.png',
    desc: 'Enemy general in massive dark red and black full plate, immovable fortress, cold commanding eyes, greatshield, tower of dark steel.',
  },
  {
    class: 'warrior',
    ref: 'generic_warrior.png',
    desc: 'Enemy warrior in dark red and black war gear, massive build, battle axe, war paint, berserker rage barely contained.',
  },
  {
    class: 'paladin',
    ref: 'generic_paladin.png',
    desc: 'Enemy paladin in dark red and black ornate plate, fallen holy knight, stern judgmental face, lance, once noble now corrupted.',
  },
  {
    class: 'great_knight',
    ref: 'generic_great_knight.png',
    desc: 'Enemy great knight in enormous dark red and black plate, overwhelming presence, heavily armored, lance and axe, unstoppable force.',
  },
  {
    class: 'berserker',
    ref: 'generic_berserker.png',
    desc: 'Enemy berserker, bare-chested with dark red war paint, wild eyes, massive axe, feral and unhinged, bloodthirsty rage.',
  },
  {
    class: 'dark_knight',
    ref: 'generic_dark_knight.png',
    desc: 'Enemy dark knight in black and crimson plate, shadowy aura, glowing red eyes, sword wreathed in dark energy, dread champion.',
  },
  {
    class: 'bow_knight',
    ref: 'generic_bow_knight.png',
    desc: 'Enemy bow knight in dark red and black cavalry armor, sharp calculating eyes, bow drawn, mounted archer, swift and lethal.',
  },
  {
    class: 'warlock',
    ref: 'generic_warlock.png',
    desc: 'Enemy warlock in dark crimson and black robes, gaunt pale face, glowing dark energy, forbidden magic, twisted by dark arts.',
  },
  {
    class: 'battle_monk',
    ref: 'generic_battle_monk.png',
    desc: 'Enemy battle monk in dark red and black martial robes, scarred fists, disciplined but hostile, corrupted martial artist, iron will.',
  },
  {
    class: 'trickster',
    ref: 'generic_trickster.png',
    desc: 'Enemy trickster in dark red and black flashy attire, sly dangerous grin, daggers hidden, deceptive and unpredictable, entertainer turned killer.',
  },
  {
    class: 'hunter',
    ref: 'generic_hunter.png',
    desc: 'Enemy hunter in dark red and black ranger gear, weathered face, bow and quiver, wilderness tracker, patient stalker.',
  },
  {
    class: 'duelist',
    ref: 'generic_duelist.png',
    desc: 'Enemy duelist in dark red and black fencing attire, confident smirk, rapier at ready, elegant but deadly, loves the fight.',
  },
  {
    class: 'wyvern_lord',
    ref: 'generic_wyvern_lord.png',
    desc: 'Enemy wyvern lord in dark red and black dragon-scale armor, commanding presence, lance and axe, fearsome aerial commander.',
  },

  // --- Enemy-only classes (4) - no existing player portrait ---
  {
    class: 'dragon',
    ref: null,
    desc: 'Enemy dragon in humanoid form, dark red and black scales, reptilian eyes, fanged maw, ancient and terrifying, draconic power.',
  },
  {
    class: 'dragon_lord',
    ref: null,
    desc: 'Enemy dragon lord, imposing draconic humanoid in dark red and black ornate armor, crown of horns, supreme dragon commander, ancient evil.',
  },
  {
    class: 'revenant',
    ref: null,
    desc: 'Enemy revenant, undead warrior in tattered dark red and black armor, skeletal face with glowing red eyes, ghostly aura, risen from death.',
  },
  {
    class: 'zombie',
    ref: null,
    desc: 'Enemy zombie, undead soldier in rotting dark armor, decayed flesh, vacant glowing eyes, shambling horror, mindless but dangerous.',
  },
];

// --- API call ---
let requestCount = 0;

async function rateLimitWait() {
  if (requestCount > 0) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }
  requestCount++;
}

async function generatePortrait(prompt, refImagePath) {
  await rateLimitWait();

  const parts = [];

  // If reference image exists, include it for style anchoring
  if (refImagePath && existsSync(refImagePath)) {
    const refBytes = readFileSync(refImagePath);
    const base64Ref = refBytes.toString('base64');
    parts.push({ inline_data: { mime_type: 'image/png', data: base64Ref } });
    parts.push({
      text:
        'Use this portrait as a style reference for composition, pixel density, and framing. ' +
        'Generate a new enemy-faction version with the following description:\n\n' +
        prompt,
    });
  } else {
    parts.push({ text: prompt });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout

  try {
    const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts }],
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
    const respParts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = respParts.find((p) => p.inlineData);
    if (!imagePart) throw new Error('No image in response');
    return Buffer.from(imagePart.inlineData.data, 'base64');
  } finally {
    clearTimeout(timeout);
  }
}

// --- Main ---
async function main() {
  console.log(`Enemy Portrait Generator${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Variants: ${VARIANTS}`);
  if (onlySet) console.log(`Only: ${[...onlySet].join(', ')}`);
  console.log();

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Filter to requested classes
  const targets = onlySet ? ENEMY_PORTRAITS.filter((p) => onlySet.has(p.class)) : ENEMY_PORTRAITS;

  console.log(
    `Generating ${targets.length} portraits × ${VARIANTS} variant(s) = ${targets.length * VARIANTS} images\n`,
  );

  let completed = 0;
  let errors = 0;
  const total = targets.length * VARIANTS;

  for (const entry of targets) {
    const refPath = USE_REF && entry.ref ? join(PORTRAITS_DIR, entry.ref) : null;
    const hasRef = refPath && existsSync(refPath);
    const fullPrompt = STYLE_PREFIX + entry.desc + STYLE_SUFFIX;

    if (DRY_RUN) {
      console.log(`[${entry.class}] ref=${hasRef ? entry.ref : 'none'}`);
      console.log(`  prompt: ${fullPrompt.substring(0, 120)}...`);
      console.log();
      continue;
    }

    for (let v = 0; v < VARIANTS; v++) {
      const suffix = VARIANTS > 1 ? `_v${v}` : '';
      const outPath = join(OUTPUT_DIR, `enemy_${entry.class}${suffix}.png`);
      const label = `enemy_${entry.class}${suffix}`;

      if (SKIP_EXISTING && existsSync(outPath)) {
        completed++;
        console.log(`[${completed}/${total}] ${label} — skipped (exists)`);
        continue;
      }

      try {
        const buf = await generatePortrait(fullPrompt, hasRef ? refPath : null);
        writeFileSync(outPath, buf);
        completed++;
        console.log(`[${completed}/${total}] ${label} ✓ (${(buf.length / 1024).toFixed(1)}KB)`);
      } catch (err) {
        errors++;
        completed++;
        console.error(`[${completed}/${total}] ${label} ✗ ${err.message}`);
      }
    }
  }

  console.log(`\nDone! ${completed - errors}/${total} succeeded, ${errors} errors.`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
