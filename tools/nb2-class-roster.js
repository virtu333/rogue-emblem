// Nano Banana 2 — Full class roster sprite generation (reference-anchored)
// Usage: node tools/nb2-class-roster.js [--variants N] [--filter NAME] [--tier base|promoted|lord|enemy]
//        [--reference PATH] [--no-ref] [--size SIZE] [--dry-run]

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { resolve, join, basename } from 'path';

// --- Config ---
const ROOT = resolve('C:/Users/davec/Documents/emblem-rogue');
const envContent = readFileSync(join(ROOT, '.env'), 'utf8');
const keyMatch = envContent.match(/^GOOGLE_API_KEY=(.+)$/m);
if (!keyMatch) {
  console.error('Missing GOOGLE_API_KEY in .env');
  process.exit(1);
}
const API_KEY = keyMatch[1].trim();

const MODEL = 'gemini-3.1-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const OUTPUT_DIR = resolve(join(ROOT, 'References/imagen-output/nb2-roster-v2'));
const RATE_LIMIT_MS = 2000;

// --- CLI ---
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const VARIANTS = parseInt(getArg('--variants', '1'), 10);
const FILTER = getArg('--filter', null);
const TIER_FILTER = getArg('--tier', null);
const IMAGE_SIZE = getArg('--size', '1K');
const DRY_RUN = hasFlag('--dry-run');
const NO_REF = hasFlag('--no-ref');
const REF_PATH = getArg(
  '--reference',
  join(ROOT, 'References/imagen-output/nb2-refresh/expB-reference-anchor/myrmidon_v0.png'),
);

// --- Style prefix ---
const STYLE = `90s SNES 16-bit pixel art character sprite in the style of Fire Emblem Thracia 776 and Tactics Ogre, top-down tactical RPG map sprite, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted color palette, weathered and battle-worn details, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head, NOT cute, NOT modern, NOT cartoonish`;

// --- Class visual descriptions ---
// Each description focuses on silhouette, weapon, armor weight, and color accents.
// Armor philosophy: tunic/cloth base + selective plate for mobile classes, full plate for heavies.
// Silver trim (not gold). Specific weapon shapes (not generic "lance").

const BASE_CLASSES = [
  {
    name: 'Myrmidon',
    desc: 'lean swordsman in flowing dark blue cloth with minimal armor, single battered katana in one hand, tattered scarf, wary agile stance, no helmet, visible face and hair, cloth robes over light clothing, NOT leather armor, NOT heavy',
  },
  {
    name: 'Knight',
    desc: 'heavy armored knight in dented blue-steel full plate with brass rivets, scratched kite shield, short sturdy spear, bulky imposing silhouette, closed helmet with visor',
  },
  {
    name: 'Fighter',
    desc: 'muscular bare-armed axe fighter, leather straps across chest, large worn battle axe, rust-red bandana, blue-tinted trousers, scarred forearms, aggressive stance',
  },
  {
    name: 'Cavalier',
    desc: 'mounted cavalry knight on battle-scarred brown horse, short combat spear held upright, dark blue tunic under light plate cuirass and pauldrons with silver trim, faded crimson cape, no helmet, visible face, ornate saddle cloth, dented barding',
  },
  {
    name: 'Archer',
    desc: 'hooded bowman with longbow drawn, quiver on back, worn blue-green leather armor over dark tunic, no helmet, sharp focused eyes, crouched stance',
  },
  {
    name: 'Mage',
    desc: 'young adult mage in dark midnight-blue robes with subtle emerald-green trim, hood down, clutching weathered tome with faint arcane glow, messy dark hair, serious expression, no hat, no helmet, adult proportions',
  },
  {
    name: 'Cleric',
    desc: 'gentle healer in simple white-blue robes with patched hem, healing staff with crystal tip, wooden pendant, kind expression, no helmet, light brown hair, NOT cross, NOT religious symbols',
  },
  {
    name: 'Thief',
    desc: 'nimble rogue in dark blue-grey cloak with deep purple lining, twin daggers, hood half-covering face, crouched agile pose, leather wraps on arms, ready to dart',
  },
  {
    name: 'Dancer',
    desc: 'graceful dancer in flowing blue silk dress with silver thread, trailing ribbons, elegant mid-step pose, light slender build, no armor',
  },
  {
    name: 'Pegasus Knight',
    desc: 'female knight riding white winged pegasus, short combat spear, light blue tunic under silver-trimmed chest plate, flowing hair, wings spread, no helmet',
  },
  {
    name: 'Wyvern Rider',
    desc: 'grim rider mounted on large dark green wyvern dragon in flight with wings fully spread, short war spear, small dented plate pauldrons and cuirass over worn leather, no helmet, windswept short dark hair, wyvern much bigger than rider, airborne flying, NOT on ground',
  },
  {
    name: 'Mercenary',
    desc: 'balanced swordfighter in practical blue-grey tunic with worn leather armor, longsword ready at side, no helmet, short brown hair, confident relaxed stance',
  },
  {
    name: 'Lord',
    desc: 'young noble lord with messy teal-green hair, thin silver headband, teal scarf wrapped around neck, light plate pauldrons over dark tunic, silver-trimmed bracers, straight longsword, no helmet, regal determined bearing',
  },
  {
    name: 'Tactician',
    desc: 'hooded female tactician with short silver-white hair, purple-lavender coat with silver clasps, leather tome strap across chest, glowing tome in hand, analytical calculating pose, no heavy armor',
  },
  {
    name: 'Ranger',
    desc: 'tall rugged male frontiersman with long brown hair, sword at hip and bow on back, worn leather armor, fur-trimmed green-olive cloak with frayed edges, no helmet, stern weathered face',
  },
  {
    name: 'Light Sage',
    desc: 'gentle young female holy caster with long red-auburn hair, purple robes with pale accents, sacred tome radiating soft light, serene gentle expression, no hat, no helmet',
  },
  {
    name: 'Chevalier',
    desc: 'young male mounted charging knight with auburn-copper spiky hair on armored horse, short combat spear couched, silver plate armor over blue-grey tunic, confident expression, no helmet, ornate saddle cloth',
  },
  {
    name: 'Sky Lancer',
    desc: 'agile young female knight on sleek pegasus, short spear, blue armor with wing-shaped pauldrons, trailing blue scarf, long silver-white windswept hair, no helmet, silver-blue color scheme',
  },
  {
    name: 'Sentinel',
    desc: 'massive older male armored warrior with short grey-silver hair, enormous tower shield and heavy battle axe, heavy silver plate armor, immovable wide stance, no helmet, stern stoic face, extremely bulky silhouette',
  },
];

const PROMOTED_CLASSES = [
  {
    name: 'Swordmaster',
    desc: 'master swordsman in flowing blue-white robes over light leather, ornate katana with faint glow, intense focused stance, tattered sash, no helmet, long dark hair',
  },
  {
    name: 'General',
    desc: 'enormous heavily armored general in fortress-like blue-steel plate, massive dented shield, short heavy spear, towering imposing silhouette, closed great helm with crest',
  },
  {
    name: 'Warrior',
    desc: 'powerful warrior with great axe and shortbow strapped to back, asymmetric plate armor with one pauldron and chest plate over scarred skin, fur trim at shoulders, viking helmet with nose guard, battle scars, blue war paint on arms, fierce aggressive stance',
  },
  {
    name: 'Paladin',
    desc: 'holy mounted knight on white horse, sword and shield, blue-silver tunic under ornate plate with gold trim, flowing white cape, no helmet, noble expression, faint holy aura, ornate white barding',
  },
  {
    name: 'Sniper',
    desc: 'elite archer with ornate longbow, blue-green leather ranger armor with silver buckles, quiver of fletched arrows, keen watchful eyes, hooded, crouched stance',
  },
  {
    name: 'Sage',
    desc: 'master mage in elaborate deep purple robes with silver embroidery and emerald accents, staff in one hand and open tome in other, faint arcane circles, no hat, grey-streaked hair',
  },
  {
    name: 'Bishop',
    desc: 'radiant priest in ornate white vestments with gold-embroidered stole, glowing holy staff, soft warm aura, calm serene expression, gold circlet, more ornate and regal than cleric, no hat',
  },
  {
    name: 'Assassin',
    desc: 'deadly shadow warrior in black leather with deep purple accents, single blade drawn, face mask covering lower face, crouched low ready to strike, minimal armor, silent and lethal',
  },
  {
    name: 'Bard',
    desc: 'elegant war-poet with ornate lute slung on back and rapier at hip, flowing blue performance attire with silver thread, feathered cap, charismatic pose',
  },
  {
    name: 'Falcon Knight',
    desc: 'elite female sky commander on majestic white pegasus, short spear only, lighter blue-white armor with gold trim, wings spread wide, flowing hair, no helmet, graceful and agile, NOT heavily armored, NOT sword',
  },
  {
    name: 'Wyvern Lord',
    desc: 'fearsome rider mounted on large armored dark wyvern in flight with wings spread, hand axe and short war spear, dark blue-black dragon-scale armor with dents and scratches, no helmet, commanding presence, wyvern much larger than rider, airborne flying, NOT on ground',
  },
  {
    name: 'Hero',
    desc: 'veteran champion with sword in one hand and hand axe in other, scarred blue medium armor over dark tunic, experienced confident stance, no helmet, short cropped hair',
  },
  {
    name: 'Great Lord',
    desc: 'young crowned lord with messy teal-green hair, ornate teal cape with gold trim over silver plate armor with pauldrons and chest plate and dark tunic beneath, radiant sword in one hand and medium kite shield with gold crest held upright in other hand, thin gold crown over silver headband, commanding yet youthful regal presence, faint aura, no helmet, NOT spear, NOT staff, NOT scepter, NOT tome, NOT scroll',
  },
  {
    name: 'Grandmaster',
    desc: 'supreme female tactician with short silver-white hair, ornate purple-lavender coat with silver clasps and epaulettes, sword at hip and glowing tome, strategic calculating pose, no helmet, confident sharp eyes',
  },
  {
    name: 'Vanguard',
    desc: 'rugged male ranger-warrior with long brown hair tied back, light plate cuirass with silver trim over dark tunic, fur-trimmed green-olive cloak, sword at hip and shortbow on back, hand axe at belt, stern weathered face, no helmet, versatile capable fighter',
  },
  {
    name: 'Light Priestess',
    desc: 'divine young female oracle with long red-auburn hair, flowing ornate white and purple vestments with gold filigree, healing staff and glowing light orb, radiant golden aura, gentle serene expression, no hat, no helmet, most ornate of all healers',
  },
  {
    name: 'Holy Knight',
    desc: 'young male mounted holy cavalier with auburn-copper spiky hair on white steed, short combat spear and healing staff, silver plate armor with gold trim over blue-grey tunic, faint holy aura, confident expression, no helmet, ornate white barding',
  },
  {
    name: 'Seraph Knight',
    desc: 'radiant young female sky knight with long silver-white flowing hair mounted riding on luminous-winged white pegasus, short spear in hand, ornate blue-silver armor with gold wing motifs, faint holy aura, no helmet, most elegant of all pegasus riders, rider sitting on pegasus, plain white background, NOT clouds, NOT sky, NOT scroll, NOT tome, NOT book',
  },
  {
    name: 'Champion',
    desc: 'peerless massive older male champion with short grey-silver hair, heavy battle axe and short heavy spear, immense silver plate armor, unstoppable powerful presence, no helmet, stern weathered face, widest and most imposing silhouette of all characters',
  },
  {
    name: 'Duelist',
    desc: 'elegant fencer with single ornate sword, light plate cuirass and bracers over blue-silver dueling tunic with silver trim, flowing short cape, graceful defensive fencing stance, no helmet, sharp features, NOT scroll, NOT tome',
  },
  {
    name: 'Great Knight',
    desc: 'massive mounted fortress knight on armored warhorse, sword and hand axe and short heavy spear, blue-steel cavalry plate, closed great helm, enormous silhouette, heavy barding',
  },
  {
    name: 'Berserker',
    desc: 'unhinged berserker with massive double-bladed axe, wild unkempt hair, minimal armor showing old scars, blue tribal markings on arms and chest, feral stance',
  },
  {
    name: 'Dark Knight',
    desc: 'dark mounted knight on black horse, short combat spear and dark tome, dark blue-purple tunic under plate armor with silver trim, shadowy magical aura, no helmet',
  },
  {
    name: 'Bow Knight',
    desc: 'mounted archer on swift brown horse, longbow and sword, light blue-green tunic under leather cavalry armor, no helmet, quick agile silhouette, light barding',
  },
  {
    name: 'Warlock',
    desc: 'dark sorcerer in black-purple robes with blue trim and silver runes, dark tome crackling with shadow energy, gaunt intense expression, no hat, pale skin',
  },
  {
    name: 'Battle Monk',
    desc: 'warrior healer in blue-white combat robes reinforced with leather straps, large axe in one hand and staff in other, muscular build, shaved head, old scars',
  },
  {
    name: 'Trickster',
    desc: 'cunning rogue-healer in flashy blue outfit with silver accents, rapier and small staff, smirking expression, quick-footed pose, no helmet, messy hair',
  },
  {
    name: 'Hunter',
    desc: 'wilderness tracker with longbow and sword at hip, forest-blue cloak with frayed edges over worn leather vest, animal pelts on shoulders, no helmet, unkempt hair',
  },
];

const ENEMY_CLASSES = [
  {
    name: 'Zombie',
    desc: 'shambling undead warrior with rotting blue-grey flesh, tattered remnants of armor, rusty chipped axe, glowing hollow eyes, lurching pose',
  },
  {
    name: 'Revenant',
    desc: 'empowered undead in dark decayed armor with ghostly blue glow, glowing ethereal sword, menacing upright stance, spectral wisps trailing',
  },
  {
    name: 'Dragon',
    desc: 'large fearsome quadruped dragon with dark blue-green scales and spread wings, breath attack ready, powerful muscular build, tail curled, much larger than human-sized, airborne or rearing up, NOT standing on ground',
  },
  {
    name: 'Dragon Lord',
    desc: 'enormous ancient quadruped dragon with crown-like horns and glowing dark blue-black scales, heavy gold-trimmed war armor plates on body, immense muscular bulk, much larger than any other character, no rider, no weapon in hand, NOT standing upright, NOT humanoid, four legs on ground, royal menacing bearing, breath energy gathering in mouth, massive wingspan',
  },
];

const LORDS = [
  {
    name: 'Edric',
    desc: 'slim teenage lord with messy teal-green hair, thin silver headband, teal scarf wrapped around neck, light plate pauldrons and chest plate over dark tunic, silver-trimmed bracers, straight longsword at hip, no helmet, full body visible, youthful face, determined but melancholic',
  },
  {
    name: 'Kira',
    desc: 'young female tactician with short silver-white hair, hooded purple-lavender coat with silver clasps, leather tome strap across chest, glowing tome in hand, sharp calculating confident eyes, no helmet, light build',
  },
  {
    name: 'Voss',
    desc: 'tall rugged male ranger with long brown hair tied back, fur-trimmed green-olive cloak with frayed edges over worn leather armor, sword at hip and bow on back, stern weathered tough face, no helmet',
  },
  {
    name: 'Sera',
    desc: 'gentle young female light sage with long red-auburn hair, purple robes with pale accents, sacred tome in hand, radiant soft glow, kind gentle expression, no hat, no helmet',
  },
  {
    name: 'Rowan',
    desc: 'young male mounted chevalier on brown horse, short combat spear ready, silver plate armor over blue-grey tunic, confident charming expression, no helmet, auburn-copper spiky hair, ornate saddle cloth',
  },
  {
    name: 'Astrid',
    desc: 'young female sky lancer on white pegasus with long silver-white windswept hair, blue armor with wing-shaped pauldrons, trailing blue scarf, short spear, fierce determined look, no helmet, silver-blue color scheme',
  },
  {
    name: 'Cael',
    desc: 'massive middle-aged male sentinel with short grey-silver hair, enormous tower shield and heavy battle axe, heavy silver plate armor, stern stoic expression, no helmet, visible face, widest silhouette of any character',
  },
];

// --- Build all entries ---
const allEntries = [];
if (!TIER_FILTER || TIER_FILTER === 'base')
  allEntries.push(...BASE_CLASSES.map((c) => ({ ...c, tier: 'base' })));
if (!TIER_FILTER || TIER_FILTER === 'promoted')
  allEntries.push(...PROMOTED_CLASSES.map((c) => ({ ...c, tier: 'promoted' })));
if (!TIER_FILTER || TIER_FILTER === 'enemy')
  allEntries.push(...ENEMY_CLASSES.map((c) => ({ ...c, tier: 'enemy' })));
if (!TIER_FILTER || TIER_FILTER === 'lord')
  allEntries.push(...LORDS.map((c) => ({ ...c, tier: 'lord' })));

const filtered = FILTER
  ? allEntries.filter((e) => e.name.toLowerCase().includes(FILTER.toLowerCase()))
  : allEntries;

// --- API helpers ---
let requestCount = 0;

async function rateLimitWait() {
  if (requestCount > 0) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }
  requestCount++;
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
        imageConfig: { aspectRatio: '1:1', imageSize: IMAGE_SIZE },
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

async function generateWithRef(prompt, refImagePath) {
  await rateLimitWait();
  const refBytes = readFileSync(refImagePath);
  const base64Ref = refBytes.toString('base64');
  const mimeType = refImagePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png';

  const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ inline_data: { mime_type: mimeType, data: base64Ref } }, { text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: IMAGE_SIZE },
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
const useRef = !NO_REF && existsSync(REF_PATH);
const mode = useRef ? `reference-anchored (${basename(REF_PATH)})` : 'text-only';

console.log(`Nano Banana 2 — Full Class Roster v2`);
console.log(`Classes: ${filtered.length}, Variants: ${VARIANTS}, Size: ${IMAGE_SIZE}`);
console.log(`Mode: ${mode}`);
if (DRY_RUN) console.log(`DRY RUN — no API calls`);
console.log(`Output: ${OUTPUT_DIR}\n`);

// Create tier subdirectories
for (const tier of ['base', 'promoted', 'lord', 'enemy']) {
  mkdirSync(join(OUTPUT_DIR, tier), { recursive: true });
}

// Copy anchor for reference
if (useRef) {
  copyFileSync(REF_PATH, join(OUTPUT_DIR, 'anchor.png'));
  console.log(`Anchor copied: ${basename(REF_PATH)} -> anchor.png\n`);
}

let totalSaved = 0;
let totalFailed = 0;

for (const entry of filtered) {
  const safeName = entry.name.toLowerCase().replace(/\s+/g, '_');

  // Build prompt — reference-anchored for player classes, text-only for enemies
  const isEnemy = entry.tier === 'enemy';
  const useRefForThis = useRef && !isEnemy;
  let prompt;
  if (useRefForThis) {
    prompt = `Generate a new character sprite in EXACTLY the same art style, proportions, and pixel density as the reference image. ${STYLE}. New character: ${entry.desc}`;
  } else {
    prompt = `${STYLE}, ${entry.desc}`;
  }

  console.log(`[${entry.tier}/${entry.name}]`);

  if (DRY_RUN) {
    console.log(`  PROMPT: ${prompt.substring(0, 120)}...`);
    continue;
  }

  for (let i = 0; i < VARIANTS; i++) {
    try {
      const buf = useRefForThis
        ? await generateWithRef(prompt, REF_PATH)
        : await generateTextOnly(prompt);
      const suffix = VARIANTS > 1 ? `_v${i}` : '';
      const outPath = join(OUTPUT_DIR, entry.tier, `${safeName}${suffix}.png`);
      writeFileSync(outPath, buf);
      console.log(`  v${i}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
      totalSaved++;
    } catch (err) {
      console.error(`  v${i}: FAILED — ${err.message}`);
      totalFailed++;
    }
  }
}

console.log(`\nDone! ${totalSaved} saved, ${totalFailed} failed.`);
console.log(`API calls: ${requestCount}`);
console.log(`Output: ${OUTPUT_DIR}`);
