// NB2 Sprite & Portrait Refresh — Experiment pipeline
// Tests batch sheets, reference anchoring, and portrait refresh/coherence
// Usage: node tools/nb2-sprite-refresh.js [options]
//   --experiment A|B|C|all   (default: all)
//   --variants N             (default: 2)
//   --size 512px|1K          (default: 1K)
//   --dry-run                Print prompts, skip API calls
//   --reference PATH         Override style anchor for Exp B

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';
import sharp from 'sharp';

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
const OUTPUT_BASE = resolve(join(ROOT, 'References/imagen-output/nb2-refresh'));
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

const EXPERIMENT = getArg('--experiment', 'all').toUpperCase();
const VARIANTS = parseInt(getArg('--variants', '2'), 10);
const IMAGE_SIZE = getArg('--size', '1K');
const DRY_RUN = hasFlag('--dry-run');
const REF_OVERRIDE = getArg('--reference', null);

// Default reference images
const DEFAULT_SPRITE_REF = join(
  ROOT,
  'References/imagen-output/nb2-refresh/expB-reference-anchor/myrmidon_v0.png',
);
const PORTRAIT_STYLE_REF = join(ROOT, 'assets/portraits/generic_swordmaster.png');

// --- Output directories ---
const DIRS = {
  expA: join(OUTPUT_BASE, 'expA-batch-sheets'),
  expA_batch1: join(OUTPUT_BASE, 'expA-batch-sheets/batch1_infantry'),
  expA_batch1_split: join(OUTPUT_BASE, 'expA-batch-sheets/batch1_infantry/split'),
  expA_batch2: join(OUTPUT_BASE, 'expA-batch-sheets/batch2_mounted'),
  expA_batch2_split: join(OUTPUT_BASE, 'expA-batch-sheets/batch2_mounted/split'),
  expB: join(OUTPUT_BASE, 'expB-reference-anchor'),
  expC_refresh: join(OUTPUT_BASE, 'expC-portraits/refresh'),
  expC_coherence: join(OUTPUT_BASE, 'expC-portraits/coherence'),
};

function ensureDirs() {
  for (const dir of Object.values(DIRS)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- API helpers ---
let requestCount = 0;

async function rateLimitWait() {
  if (requestCount > 0) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }
  requestCount++;
}

async function generateTextOnly(prompt, sizeOverride) {
  await rateLimitWait();
  const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: sizeOverride || IMAGE_SIZE },
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

async function generateWithRef(prompt, refImagePath, sizeOverride) {
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
        imageConfig: { aspectRatio: '1:1', imageSize: sizeOverride || IMAGE_SIZE },
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

// --- Sheet splitting (adapted from tools/split-sheets.js) ---
const BG_TOLERANCE = 40;

function removeBackground(raw, tolerance) {
  const threshold = 255 - tolerance;
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i],
      g = raw[i + 1],
      b = raw[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      raw[i + 3] = 0;
    }
  }
}

async function splitSheet(sheetBuffer, names, outputDir) {
  const img = sharp(sheetBuffer);
  const { width, height } = await img.metadata();
  const cols = names.length;
  const cellW = Math.floor(width / cols);

  const raw = await img.ensureAlpha().raw().toBuffer();
  removeBackground(raw, BG_TOLERANCE);

  const transparentSheet = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  const results = [];
  for (let i = 0; i < names.length; i++) {
    const left = i * cellW;
    try {
      const extracted = await sharp(transparentSheet)
        .extract({ left, top: 0, width: cellW, height })
        .png()
        .toBuffer();

      // Trim transparent edges but do NOT resize — keep raw splits
      const outPath = join(outputDir, `${names[i]}.png`);
      await sharp(extracted).trim().png().toFile(outPath);
      results.push({ name: names[i], ok: true });
      console.log(`    split: ${names[i]} ok`);
    } catch (err) {
      results.push({ name: names[i], ok: false, error: err.message });
      console.error(`    split: ${names[i]} FAILED — ${err.message}`);
    }
  }
  return results;
}

// =============================================================================
// EXPERIMENT A — Batch Sheets
// =============================================================================

const BATCH_STYLE = `90s SNES 16-bit pixel art sprite sheet in the style of Fire Emblem Thracia 776 and Tactics Ogre, top-down tactical RPG map sprites, small characters with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted color palette, weathered and battle-worn details, clean pixel edges, plain white background, no text, no border, no labels, exactly 3 characters in a row evenly spaced, NOT chibi, NOT super-deformed, NOT big head, NOT cute, NOT modern, NOT cartoonish`;

const BATCHES = [
  {
    id: 'batch1_infantry',
    names: ['myrmidon', 'knight', 'mage'],
    descs: [
      'LEFT: lean swordsman in worn leather and dull blue cloth, single battered katana in one hand, tattered scarf, wary stance, no helmet, visible face and hair',
      'CENTER: heavy armored knight in dented blue-steel full plate with brass rivets, scratched kite shield, short sturdy spear, bulky imposing silhouette, closed helmet with visor',
      'RIGHT: young adult mage in dark midnight-blue robes with subtle emerald-green trim, hood down, clutching weathered tome with faint arcane glow, messy dark hair, serious expression, no hat, no helmet, adult proportions',
    ],
  },
  {
    id: 'batch2_mounted',
    names: ['cavalier', 'wyvern_rider', 'edric'],
    descs: [
      'LEFT: mounted cavalry knight on battle-scarred brown horse, short combat spear held upright, dark blue tunic under light plate cuirass and pauldrons with silver trim, faded crimson cape, no helmet, visible face, ornate saddle cloth, dented barding',
      'CENTER: grim rider mounted on large dark green wyvern dragon that dwarfs the rider, short war spear, small dented plate pauldrons and cuirass over worn leather, no helmet, windswept short dark hair, the wyvern is much bigger than the rider',
      'RIGHT: slim teenage lord with messy teal-blue hair, thin silver circlet, flowing blue cape with silver trim over tunic and light chest plate, silver-trimmed bracers and shin guards, straight western longsword at hip, no helmet, full body visible, youthful face',
    ],
  },
];

async function runExperimentA(index) {
  console.log('\n========================================');
  console.log('EXPERIMENT A — Batch Sheet Generation');
  console.log('========================================\n');

  const results = [];

  for (const batch of BATCHES) {
    const prompt = `${BATCH_STYLE}:\n${batch.descs.join(',\n')}.\nAll three must be the same size and art style, side by side, equal spacing`;
    const outDir = batch.id === 'batch1_infantry' ? DIRS.expA_batch1 : DIRS.expA_batch2;
    const splitDir =
      batch.id === 'batch1_infantry' ? DIRS.expA_batch1_split : DIRS.expA_batch2_split;

    console.log(`[${batch.id}]`);

    if (DRY_RUN) {
      console.log(`  PROMPT: ${prompt.substring(0, 120)}...`);
      console.log(`  Would generate ${VARIANTS} variants`);
      for (let v = 0; v < VARIANTS; v++) {
        results.push({ experiment: 'A', batch: batch.id, variant: v, type: 'sheet', dryRun: true });
      }
      continue;
    }

    for (let v = 0; v < VARIANTS; v++) {
      try {
        const buf = await generateTextOnly(prompt);
        const sheetPath = join(outDir, `sheet_v${v}.png`);
        writeFileSync(sheetPath, buf);
        console.log(`  v${v}: sheet saved (${(buf.length / 1024).toFixed(0)}KB)`);

        // Split the sheet
        const splitResults = await splitSheet(buf, batch.names, splitDir);
        results.push({
          experiment: 'A',
          batch: batch.id,
          variant: v,
          type: 'sheet',
          sheetPath: sheetPath,
          splits: splitResults,
        });
      } catch (err) {
        console.error(`  v${v}: FAILED — ${err.message}`);
        results.push({
          experiment: 'A',
          batch: batch.id,
          variant: v,
          type: 'sheet',
          error: err.message,
        });
      }
    }
  }

  index.expA = results;
  return results;
}

// =============================================================================
// EXPERIMENT B — Reference Image Anchoring
// =============================================================================

const REF_CLASSES = [
  {
    name: 'myrmidon',
    desc: 'lean swordsman in worn leather and dull blue cloth, single battered katana in one hand, tattered scarf, wary stance, no helmet, visible face and hair',
  },
  {
    name: 'cavalier',
    desc: 'mounted cavalry knight on battle-scarred brown horse, short combat spear held upright, dark blue tunic under light plate cuirass and pauldrons with silver trim, faded crimson cape, no helmet, visible face, ornate saddle cloth, dented barding',
  },
  {
    name: 'wyvern_rider',
    desc: 'grim rider mounted on large dark green wyvern dragon that dwarfs the rider, short war spear, small dented plate pauldrons and cuirass over worn leather, no helmet, windswept short dark hair, the wyvern is much bigger than the rider',
  },
  {
    name: 'mage',
    desc: 'young adult mage in dark midnight-blue robes with subtle emerald-green trim, hood down, clutching weathered tome with faint arcane glow, messy dark hair, serious expression, no hat, no helmet, adult proportions',
  },
  {
    name: 'edric',
    desc: 'slim teenage lord with messy teal-blue hair, thin silver circlet, flowing blue cape with silver trim over tunic and light chest plate, silver-trimmed bracers and shin guards, straight western longsword at hip, no helmet, full body visible, youthful face, determined but melancholic',
  },
];

async function runExperimentB(index) {
  console.log('\n========================================');
  console.log('EXPERIMENT B — Reference Image Anchoring');
  console.log('========================================\n');

  const refPath = REF_OVERRIDE || DEFAULT_SPRITE_REF;
  if (!DRY_RUN && !existsSync(refPath)) {
    console.error(`  Reference image not found: ${refPath}`);
    return [];
  }

  // Copy anchor to output for comparison
  if (!DRY_RUN) {
    copyFileSync(refPath, join(DIRS.expB, 'anchor.png'));
    console.log(`  Anchor: ${basename(refPath)} -> expB/anchor.png`);
  }

  const results = [];

  for (const cls of REF_CLASSES) {
    const prompt = `Generate a new 90s SNES 16-bit pixel art character sprite in EXACTLY the same art style, proportions, and pixel density as the reference image. Top-down tactical RPG map sprite in the style of Fire Emblem and Tactics Ogre, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted colors, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head, NOT cute, NOT modern. New character: ${cls.desc}`;

    console.log(`[${cls.name}]`);

    if (DRY_RUN) {
      console.log(`  PROMPT: ${prompt.substring(0, 120)}...`);
      console.log(`  REF: ${refPath}`);
      console.log(`  Would generate ${VARIANTS} variants`);
      for (let v = 0; v < VARIANTS; v++) {
        results.push({ experiment: 'B', name: cls.name, variant: v, dryRun: true });
      }
      continue;
    }

    for (let v = 0; v < VARIANTS; v++) {
      try {
        const buf = await generateWithRef(prompt, refPath);
        const outPath = join(DIRS.expB, `${cls.name}_v${v}.png`);
        writeFileSync(outPath, buf);
        console.log(`  v${v}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
        results.push({ experiment: 'B', name: cls.name, variant: v, path: outPath });
      } catch (err) {
        console.error(`  v${v}: FAILED — ${err.message}`);
        results.push({ experiment: 'B', name: cls.name, variant: v, error: err.message });
      }
    }
  }

  index.expB = results;
  return results;
}

// =============================================================================
// EXPERIMENT C — Portrait Refresh + Coherence
// =============================================================================

const PORTRAIT_STYLE = `SNES 16-bit pixel art character portrait, 128x128 sprite portrait with visible individual pixels, in the style of Fire Emblem Echoes by Hidari, head and shoulders bust, 3/4 angle, asymmetric composition, dark background, limited color palette, clean pixel edges, NOT high resolution, NOT smooth gradients, NOT painterly, NOT dramatic rim lighting, NOT performing for viewer`;

// Mood-driven portrait prompts (legacy manifest style)
const PORTRAIT_REFRESH_TARGETS = [
  {
    name: 'hunter',
    prompt: `rugged male wilderness tracker, unkempt sandy hair with leaves caught in it, weathered face with sun-squint lines, one eye slightly narrower from years of aiming, forest-blue hooded cloak with frayed edges over worn leather vest, sage green and weathered earth brown tones, NOT clean, NOT posed`,
  },
  {
    name: 'battle_monk',
    prompt: `powerful male warrior-priest, shaved head with prayer beads wound around one wrist, thick jaw set with quiet discipline, calm focused dark eyes that have seen violence and chosen peace, blue-white combat robes reinforced with leather straps, muscular arms with old scars, warm grey and steel blue tones, strength tempered by faith, NOT ornate, NOT aggressive`,
  },
  {
    name: 'wyvern_rider',
    prompt: `battle-worn female wyvern rider, windswept dark hair cut short and practical, scarred cheek from a close call in flight, sharp defiant green eyes looking past the viewer, small dented plate pauldrons and cuirass over worn leather, high collar against the wind, dark steel and muted teal tones, commands a dragon but earns its respect, NOT pristine, NOT symmetrical`,
  },
  {
    name: 'wyvern_lord',
    prompt: `seasoned male wyvern lord in his thirties, dark hair pulled back tight, windburned face with a few scars from high-altitude flight, calm confident stare of someone who has survived what others haven't, ornate dark blue-black dragon-scale armor with old dents and scratches, high gorget and furred collar, dark iron and muted indigo tones, commanding demeanor born from experience not title, NOT old, NOT grey hair, NOT clean, NOT decorative`,
  },
  {
    name: 'sera',
    prompt: `serene young female priestess with long golden hair, hands clasped loosely, shoulders slightly turned away as if about to leave, gentle amber eyes looking past the viewer with quiet sorrow, simple white robes with small wooden pendant at neck, warm ivory and pale gold tones, quiet strength rather than dramatic power, character designed with empathy, NOT ornate, NOT glowing effects, NOT religious symbols, NOT crosses, NOT performing for viewer`,
  },
  {
    name: 'cleric',
    prompt: `kind female cleric with light brown braided hair, sleeves pushed up past elbows showing work-roughened hands, head slightly tilted listening, warm gentle smile with tired eyes, simple white hooded vestments with patched hem, wooden pendant, warm cream and muted gold tones, looks like she has been up all night tending to someone, NOT pristine, NOT ornate`,
  },
];

// Portrait-to-sprite coherence tests — feed good portrait as reference to generate matching map sprite
const COHERENCE_TESTS = [
  {
    name: 'myrmidon',
    portraitPath: join(ROOT, 'assets/portraits/generic_myrmidon.png'),
    spritePrompt: `Generate a 90s SNES 16-bit pixel art character sprite matching the character in the reference portrait. Top-down tactical RPG map sprite in the style of Fire Emblem Thracia 776, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted colors, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head. Character: sleek female swordsman with straight black hair and red ribbon, light eastern-inspired clothing, red and white sash, single katana at side, blue-tinted accents`,
  },
  {
    name: 'knight',
    portraitPath: join(ROOT, 'assets/portraits/generic_knight.png'),
    spritePrompt: `Generate a 90s SNES 16-bit pixel art character sprite matching the character in the reference portrait. Top-down tactical RPG map sprite in the style of Fire Emblem Thracia 776, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted colors, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head. Character: grizzled older male knight in dented blue-steel full plate with brass rivets, scratched kite shield, short sturdy spear, stoic expression, closed helmet with visor`,
  },
  {
    name: 'mage',
    portraitPath: join(ROOT, 'assets/portraits/generic_mage.png'),
    spritePrompt: `Generate a 90s SNES 16-bit pixel art character sprite matching the character in the reference portrait. Top-down tactical RPG map sprite in the style of Fire Emblem Thracia 776, small character with realistic adult proportions and a head-to-body ratio of 1:6, seen from above at 3/4 angle facing right, gritty muted colors, clean pixel edges, single character centered on plain white background, no text, no border, NOT chibi, NOT super-deformed, NOT big head. Character: young adult mage in dark midnight-blue robes with subtle emerald-green trim, hood down, clutching weathered tome with faint arcane glow, messy dark hair, serious expression, no hat, no helmet`,
  },
];

async function runExperimentC(index) {
  console.log('\n========================================');
  console.log('EXPERIMENT C — Portrait Refresh + Coherence');
  console.log('========================================\n');

  const results = { refresh: [], coherence: [] };

  // --- C1: Portrait Refresh ---
  console.log('--- C1: Portrait Refresh (6 targets x 2 methods) ---\n');

  for (const target of PORTRAIT_REFRESH_TARGETS) {
    const fullPrompt = `${PORTRAIT_STYLE}, ${target.prompt}`;

    console.log(`[${target.name}]`);

    if (DRY_RUN) {
      console.log(`  TEXT-ONLY PROMPT: ${fullPrompt.substring(0, 120)}...`);
      console.log(`  REF PROMPT: (same + swordmaster anchor)`);
      console.log(`  Would generate ${VARIANTS * 2} variants total`);
      for (let v = 0; v < VARIANTS; v++) {
        results.refresh.push({ name: target.name, method: 'textonly', variant: v, dryRun: true });
        results.refresh.push({ name: target.name, method: 'ref', variant: v, dryRun: true });
      }
      continue;
    }

    // Text-only variants
    for (let v = 0; v < VARIANTS; v++) {
      try {
        const buf = await generateTextOnly(fullPrompt, '512px');
        const outPath = join(DIRS.expC_refresh, `${target.name}_textonly_v${v}.png`);
        writeFileSync(outPath, buf);
        console.log(`  textonly v${v}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
        results.refresh.push({ name: target.name, method: 'textonly', variant: v, path: outPath });
      } catch (err) {
        console.error(`  textonly v${v}: FAILED — ${err.message}`);
        results.refresh.push({
          name: target.name,
          method: 'textonly',
          variant: v,
          error: err.message,
        });
      }
    }

    // Reference-anchored variants
    if (!existsSync(PORTRAIT_STYLE_REF)) {
      console.error(`  Skipping ref method — anchor not found: ${PORTRAIT_STYLE_REF}`);
      continue;
    }

    const refPrompt = `Generate a new pixel art character portrait in EXACTLY the same art style, pixel density, color treatment, and composition as the reference portrait. ${PORTRAIT_STYLE}, ${target.prompt}`;

    for (let v = 0; v < VARIANTS; v++) {
      try {
        const buf = await generateWithRef(refPrompt, PORTRAIT_STYLE_REF, '512px');
        const outPath = join(DIRS.expC_refresh, `${target.name}_ref_v${v}.png`);
        writeFileSync(outPath, buf);
        console.log(`  ref v${v}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
        results.refresh.push({ name: target.name, method: 'ref', variant: v, path: outPath });
      } catch (err) {
        console.error(`  ref v${v}: FAILED — ${err.message}`);
        results.refresh.push({ name: target.name, method: 'ref', variant: v, error: err.message });
      }
    }
  }

  // --- C2: Portrait-to-Sprite Coherence ---
  console.log('\n--- C2: Portrait-to-Sprite Coherence (3 tests) ---\n');

  for (const test of COHERENCE_TESTS) {
    console.log(`[${test.name}]`);

    if (DRY_RUN) {
      console.log(`  REF: ${test.portraitPath}`);
      console.log(`  PROMPT: ${test.spritePrompt.substring(0, 120)}...`);
      console.log(`  Would generate ${VARIANTS} variants`);
      for (let v = 0; v < VARIANTS; v++) {
        results.coherence.push({ name: test.name, variant: v, dryRun: true });
      }
      continue;
    }

    if (!existsSync(test.portraitPath)) {
      console.error(`  Portrait not found: ${test.portraitPath}`);
      continue;
    }

    for (let v = 0; v < VARIANTS; v++) {
      try {
        const buf = await generateWithRef(test.spritePrompt, test.portraitPath);
        const outPath = join(DIRS.expC_coherence, `${test.name}_from_portrait_v${v}.png`);
        writeFileSync(outPath, buf);
        console.log(`  v${v}: saved (${(buf.length / 1024).toFixed(0)}KB)`);
        results.coherence.push({ name: test.name, variant: v, path: outPath });
      } catch (err) {
        console.error(`  v${v}: FAILED — ${err.message}`);
        results.coherence.push({ name: test.name, variant: v, error: err.message });
      }
    }
  }

  index.expC = results;
  return results;
}

// =============================================================================
// compare.html generator
// =============================================================================

function generateCompareHtml(index) {
  const relPath = (absPath) => {
    if (!absPath) return '';
    return absPath.replace(/\\/g, '/').replace(OUTPUT_BASE.replace(/\\/g, '/') + '/', '');
  };

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NB2 Sprite Refresh — Comparison</title>
<style>
  body { background: #1a1a2e; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; padding: 20px; }
  h1 { color: #e94560; border-bottom: 2px solid #e94560; padding-bottom: 8px; }
  h2 { color: #0f3460; background: #e0e0e0; padding: 6px 12px; border-radius: 4px; margin-top: 30px; }
  h3 { color: #16c79a; }
  .group { display: flex; flex-wrap: wrap; gap: 16px; margin: 12px 0 24px; }
  .card { background: #16213e; border-radius: 8px; padding: 10px; text-align: center; }
  .card img { image-rendering: pixelated; width: 256px; height: 256px; border: 1px solid #333; background: #222; }
  .card .label { font-size: 12px; margin-top: 6px; color: #aaa; }
  .card .method { font-size: 11px; color: #16c79a; margin-top: 2px; }
  .ref-card img { border: 2px solid #e94560; }
  .sheet-card img { width: auto; max-width: 768px; height: auto; max-height: 256px; }
  .dry-run { color: #888; font-style: italic; padding: 8px; }
</style>
</head>
<body>
<h1>NB2 Sprite &amp; Portrait Refresh</h1>
<p>Generated: ${new Date().toISOString().slice(0, 19)} | Variants: ${VARIANTS} | Size: ${IMAGE_SIZE}</p>
`;

  // Experiment A
  if (index.expA) {
    html += `<h2>Experiment A — Batch Sheets</h2>\n`;
    const byBatch = {};
    for (const r of index.expA) {
      if (!byBatch[r.batch]) byBatch[r.batch] = [];
      byBatch[r.batch].push(r);
    }
    for (const [batchId, items] of Object.entries(byBatch)) {
      html += `<h3>${batchId}</h3>\n`;
      if (items[0]?.dryRun) {
        html += `<p class="dry-run">Dry run — no images generated</p>\n`;
        continue;
      }
      // Show sheets
      html += `<div class="group">\n`;
      for (const item of items) {
        if (item.sheetPath) {
          html += `<div class="card sheet-card"><img src="${relPath(item.sheetPath)}" /><div class="label">sheet v${item.variant}</div></div>\n`;
        }
      }
      html += `</div>\n`;
      // Show splits
      const splitDir =
        batchId === 'batch1_infantry'
          ? 'expA-batch-sheets/batch1_infantry/split'
          : 'expA-batch-sheets/batch2_mounted/split';
      const names =
        batchId === 'batch1_infantry'
          ? ['myrmidon', 'knight', 'mage']
          : ['cavalier', 'wyvern_rider', 'edric'];
      html += `<h3>${batchId} splits</h3>\n<div class="group">\n`;
      for (const name of names) {
        html += `<div class="card"><img src="${splitDir}/${name}.png" /><div class="label">${name}</div></div>\n`;
      }
      html += `</div>\n`;
    }
  }

  // Experiment B
  if (index.expB) {
    html += `<h2>Experiment B — Reference Image Anchoring</h2>\n`;
    if (index.expB[0]?.dryRun) {
      html += `<p class="dry-run">Dry run — no images generated</p>\n`;
    } else {
      html += `<div class="group">\n`;
      html += `<div class="card ref-card"><img src="expB-reference-anchor/anchor.png" /><div class="label">ANCHOR (reference)</div></div>\n`;
      for (const item of index.expB) {
        if (item.path) {
          html += `<div class="card"><img src="${relPath(item.path)}" /><div class="label">${item.name} v${item.variant}</div></div>\n`;
        }
      }
      html += `</div>\n`;
    }
  }

  // Experiment C
  if (index.expC) {
    html += `<h2>Experiment C — Portrait Refresh</h2>\n`;

    // C1: Refresh
    if (index.expC.refresh?.length > 0) {
      html += `<h3>C1: Portrait Refresh (text-only vs reference-anchored)</h3>\n`;
      if (index.expC.refresh[0]?.dryRun) {
        html += `<p class="dry-run">Dry run — no images generated</p>\n`;
      } else {
        const byName = {};
        for (const r of index.expC.refresh) {
          if (!byName[r.name]) byName[r.name] = [];
          byName[r.name].push(r);
        }
        for (const [name, items] of Object.entries(byName)) {
          html += `<h3>${name}</h3>\n<div class="group">\n`;
          for (const item of items) {
            if (item.path) {
              html += `<div class="card"><img src="${relPath(item.path)}" /><div class="label">${name} v${item.variant}</div><div class="method">${item.method}</div></div>\n`;
            }
          }
          html += `</div>\n`;
        }
      }
    }

    // C2: Coherence
    if (index.expC.coherence?.length > 0) {
      html += `<h3>C2: Portrait-to-Sprite Coherence</h3>\n`;
      if (index.expC.coherence[0]?.dryRun) {
        html += `<p class="dry-run">Dry run — no images generated</p>\n`;
      } else {
        html += `<div class="group">\n`;
        for (const item of index.expC.coherence) {
          if (item.path) {
            html += `<div class="card"><img src="${relPath(item.path)}" /><div class="label">${item.name} v${item.variant}</div><div class="method">from portrait</div></div>\n`;
          }
        }
        html += `</div>\n`;
      }
    }
  }

  html += `</body>\n</html>`;
  return html;
}

// =============================================================================
// Main
// =============================================================================

console.log('NB2 Sprite & Portrait Refresh Pipeline');
console.log('======================================');
console.log(
  `Experiment: ${EXPERIMENT} | Variants: ${VARIANTS} | Size: ${IMAGE_SIZE} | Dry-run: ${DRY_RUN}`,
);
console.log(`Output: ${OUTPUT_BASE}\n`);

ensureDirs();

const index = {
  timestamp: new Date().toISOString(),
  variants: VARIANTS,
  imageSize: IMAGE_SIZE,
  dryRun: DRY_RUN,
};

const runA = EXPERIMENT === 'ALL' || EXPERIMENT === 'A';
const runB = EXPERIMENT === 'ALL' || EXPERIMENT === 'B';
const runC = EXPERIMENT === 'ALL' || EXPERIMENT === 'C';

if (runA) await runExperimentA(index);
if (runB) await runExperimentB(index);
if (runC) await runExperimentC(index);

// Write compare.html
const compareHtml = generateCompareHtml(index);
writeFileSync(join(OUTPUT_BASE, 'compare.html'), compareHtml);
console.log(`\ncompare.html written`);

// Write index.json
writeFileSync(join(OUTPUT_BASE, 'index.json'), JSON.stringify(index, null, 2));
console.log('index.json written');

// Summary
const countCalls = DRY_RUN ? 0 : requestCount;
console.log(`\n=== Summary ===`);
console.log(`  API calls: ${countCalls}`);
if (runA) console.log(`  Exp A: ${(index.expA || []).length} results`);
if (runB) console.log(`  Exp B: ${(index.expB || []).length} results`);
if (runC) {
  const cr = index.expC?.refresh?.length || 0;
  const cc = index.expC?.coherence?.length || 0;
  console.log(`  Exp C: ${cr} refresh + ${cc} coherence = ${cr + cc} results`);
}
console.log(`  Output: ${OUTPUT_BASE}`);
