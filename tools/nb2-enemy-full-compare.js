#!/usr/bin/env node
// Build comparison HTML for full NB2 enemy roster — player ref vs 2 enemy variants
// Also includes ballista from the test run
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import sharp from 'sharp';

const ROOT = resolve('.');
const ENEMY_DIR = join(ROOT, 'References/imagen-output/nb2-enemy-full');
const NB2_DIR = join(ROOT, 'References/imagen-output/nb2-roster-v2');
const BALLISTA_DIR = join(ROOT, 'References/imagen-output/nb2-enemy-test/terrain');
const THUMB_DIR = join(ENEMY_DIR, 'thumbs');
const OUT_HTML = join(ENEMY_DIR, 'compare.html');

// bg removal + downsize
async function removeEdgeBg(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  const counts = new Map();
  const pushEdge = (x, y) => {
    const idx = (y * width + x) * channels;
    if (out[idx + 3] === 0) return;
    const key = `${out[idx]},${out[idx + 1]},${out[idx + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    pushEdge(x, 0);
    pushEdge(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    pushEdge(0, y);
    pushEdge(width - 1, y);
  }
  let best = null,
    bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (best) {
    const [er, eg, eb] = best.split(',').map(Number);
    const tolSq = 24 * 24;
    for (let i = 0; i < out.length; i += channels) {
      const dr = out[i] - er,
        dg = out[i + 1] - eg,
        db = out[i + 2] - eb;
      if (dr * dr + dg * dg + db * db <= tolSq) out[i + 3] = 0;
    }
  }
  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

async function makeThumb(srcPath, outPath, size) {
  const raw = await sharp(srcPath).png().toBuffer();
  const noBg = await removeEdgeBg(raw);
  const resized = await sharp(noBg)
    .trim()
    .resize({
      width: size,
      height: size,
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(outPath, resized);
}

const CLASSES = [
  // base
  { name: 'archer', tier: 'base' },
  { name: 'cavalier', tier: 'base' },
  { name: 'cleric', tier: 'base' },
  { name: 'fighter', tier: 'base' },
  { name: 'knight', tier: 'base' },
  { name: 'mage', tier: 'base' },
  { name: 'mercenary', tier: 'base' },
  { name: 'myrmidon', tier: 'base' },
  { name: 'pegasus_knight', tier: 'base' },
  { name: 'thief', tier: 'base' },
  { name: 'wyvern_rider', tier: 'base' },
  // promoted
  { name: 'assassin', tier: 'promoted' },
  { name: 'battle_monk', tier: 'promoted' },
  { name: 'berserker', tier: 'promoted' },
  { name: 'bishop', tier: 'promoted' },
  { name: 'bow_knight', tier: 'promoted' },
  { name: 'dark_knight', tier: 'promoted' },
  { name: 'duelist', tier: 'promoted' },
  { name: 'falcon_knight', tier: 'promoted' },
  { name: 'general', tier: 'promoted' },
  { name: 'great_knight', tier: 'promoted' },
  { name: 'hero', tier: 'promoted' },
  { name: 'hunter', tier: 'promoted' },
  { name: 'paladin', tier: 'promoted' },
  { name: 'sage', tier: 'promoted' },
  { name: 'sniper', tier: 'promoted' },
  { name: 'swordmaster', tier: 'promoted' },
  { name: 'trickster', tier: 'promoted' },
  { name: 'warlock', tier: 'promoted' },
  { name: 'warrior', tier: 'promoted' },
  { name: 'wyvern_lord', tier: 'promoted' },
];

mkdirSync(THUMB_DIR, { recursive: true });

console.log('Generating thumbnails for 31 classes + ballista...');

// Generate all thumbs
for (const cls of CLASSES) {
  // Player thumb
  const playerSrc = join(NB2_DIR, cls.tier, `${cls.name}.png`);
  if (existsSync(playerSrc)) {
    await makeThumb(playerSrc, join(THUMB_DIR, `${cls.name}_player.png`), 64);
  }
  // Enemy variant thumbs
  for (let i = 0; i < 3; i++) {
    const enemySrc = join(ENEMY_DIR, `${cls.name}_v${i}.png`);
    if (existsSync(enemySrc)) {
      await makeThumb(enemySrc, join(THUMB_DIR, `${cls.name}_v${i}.png`), 64);
    }
  }
  process.stdout.write('.');
}

// Ballista thumbs
for (let i = 0; i < 3; i++) {
  const bSrc = join(BALLISTA_DIR, `ballista_v${i}.png`);
  if (existsSync(bSrc)) {
    await makeThumb(bSrc, join(THUMB_DIR, `ballista_v${i}.png`), 64);
  }
}
console.log(' done');

// Build HTML
function buildRows() {
  const rows = [];
  let lastTier = '';

  for (const cls of CLASSES) {
    if (cls.tier !== lastTier) {
      lastTier = cls.tier;
      rows.push(
        `<tr class="section"><td colspan="7">${cls.tier.charAt(0).toUpperCase() + cls.tier.slice(1)} Classes</td></tr>`,
      );
    }

    const playerThumb = existsSync(join(THUMB_DIR, `${cls.name}_player.png`))
      ? `<img src="thumbs/${cls.name}_player.png" class="thumb">`
      : '';

    const variantCells = [0, 1]
      .map((i) => {
        const hasThumb = existsSync(join(THUMB_DIR, `${cls.name}_v${i}.png`));
        const hasRaw = existsSync(join(ENEMY_DIR, `${cls.name}_v${i}.png`));
        if (!hasRaw) return '<td></td>';
        return `<td>
        ${hasRaw ? `<img src="${cls.name}_v${i}.png" class="raw">` : ''}
        ${hasThumb ? `<br><img src="thumbs/${cls.name}_v${i}.png" class="thumb">` : ''}
        <div class="label-small">v${i}</div>
      </td>`;
      })
      .join('');

    rows.push(`<tr>
      <td class="label">${cls.name}</td>
      <td>${playerThumb}<div class="label-small">Player 64px</div></td>
      ${variantCells}
    </tr>`);
  }

  // Ballista
  rows.push('<tr class="section"><td colspan="7">Ballista (Terrain Sprite)</td></tr>');
  const bCells = [0, 1]
    .map((i) => {
      const hasRaw = existsSync(join(BALLISTA_DIR, `ballista_v${i}.png`));
      const hasThumb = existsSync(join(THUMB_DIR, `ballista_v${i}.png`));
      if (!hasRaw) return '<td></td>';
      return `<td>
      <img src="../nb2-enemy-test/terrain/ballista_v${i}.png" class="raw">
      ${hasThumb ? `<br><img src="thumbs/ballista_v${i}.png" class="thumb">` : ''}
      <div class="label-small">v${i}</div>
    </td>`;
    })
    .join('');
  rows.push(`<tr><td class="label">ballista</td><td></td>${bCells}</tr>`);

  return rows.join('\n');
}

const html = `<!DOCTYPE html>
<html><head><title>NB2 Enemy Roster — Full Comparison</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: monospace; padding: 20px; }
  table { border-collapse: collapse; margin: 0 auto; }
  td { padding: 6px; border: 1px solid #333; text-align: center; vertical-align: middle; }
  td.label { font-weight: bold; white-space: nowrap; font-size: 12px; text-align: right; padding-right: 12px; min-width: 120px; }
  th { padding: 8px; font-size: 12px; border-bottom: 2px solid #555; }
  tr.section td { background: #2a2a4e; font-size: 14px; font-weight: bold; text-align: left; padding: 10px; }
  img.raw { max-width: 140px; max-height: 140px; image-rendering: auto;
    background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; }
  img.thumb { width: 256px; height: 256px; image-rendering: pixelated;
    background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; margin-top: 4px; }
  .label-small { font-size: 10px; color: #888; margin-top: 2px; }
  h1 { text-align: center; }
  p { text-align: center; color: #aaa; font-size: 12px; max-width: 800px; margin: 8px auto; }
</style></head>
<body>
<h1>NB2 Enemy Roster — 31 Classes + Ballista</h1>
<p>Player sprite (64px, blue) shown alongside two enemy variants (raw + 64px downscale at 4x zoom).<br>
Pick the variant with the most consistently dark/red coloring for each class.</p>
<table>
<tr><th>Class</th><th>Player (64px)</th><th>Enemy v0</th><th>Enemy v1</th></tr>
${buildRows()}
</table>
</body></html>`;

writeFileSync(OUT_HTML, html);
console.log(`\nComparison HTML: ${OUT_HTML}`);
