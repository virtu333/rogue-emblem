#!/usr/bin/env node
// Build comparison HTML for NB2 enemy test — player vs enemy variants + ballista
import { readdirSync, existsSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import sharp from 'sharp';

const ROOT = resolve('.');
const TEST_DIR = join(ROOT, 'References/imagen-output/nb2-enemy-test');
const PLAYER_DIR = join(ROOT, 'References/imagen-output/nb2-roster-v2');
const OUT_HTML = join(TEST_DIR, 'compare.html');

const SAMPLES = ['myrmidon', 'knight', 'archer', 'mage', 'cavalier', 'pegasus_knight'];

// Simple bg removal + downsize for preview thumbnails
async function removeWhiteBg(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  // Edge-color detection
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
  const noBg = await removeWhiteBg(raw);
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

// Generate thumbnails
const thumbDir = join(TEST_DIR, 'thumbs');
const { mkdirSync } = await import('fs');
mkdirSync(thumbDir, { recursive: true });

console.log('Generating thumbnails...');
for (const name of SAMPLES) {
  // Player thumb
  const playerSrc = join(PLAYER_DIR, 'base', `${name}.png`);
  if (existsSync(playerSrc)) {
    await makeThumb(playerSrc, join(thumbDir, `${name}_player.png`), 64);
  }
  // Enemy variant thumbs
  for (let i = 0; i < 4; i++) {
    const enemySrc = join(TEST_DIR, 'enemies', `${name}_v${i}.png`);
    if (existsSync(enemySrc)) {
      await makeThumb(enemySrc, join(thumbDir, `${name}_enemy_v${i}.png`), 64);
    }
  }
}
// Ballista thumbs
for (let i = 0; i < 4; i++) {
  const bSrc = join(TEST_DIR, 'terrain', `ballista_v${i}.png`);
  if (existsSync(bSrc)) {
    await makeThumb(bSrc, join(thumbDir, `ballista_v${i}.png`), 64);
  }
}

// Build HTML
function buildRows() {
  const rows = [];
  rows.push(
    '<tr class="section"><td colspan="6">Enemy Class Variants (player reference → enemy variants)</td></tr>',
  );

  for (const name of SAMPLES) {
    // Find variant files
    const variants = [];
    for (let i = 0; i < 4; i++) {
      if (existsSync(join(TEST_DIR, 'enemies', `${name}_v${i}.png`))) variants.push(i);
    }

    const playerThumb = existsSync(join(thumbDir, `${name}_player.png`))
      ? `<img src="thumbs/${name}_player.png" class="thumb">`
      : 'N/A';
    const playerRaw = existsSync(join(PLAYER_DIR, 'base', `${name}.png`))
      ? `<img src="../nb2-roster-v2/base/${name}.png" class="raw">`
      : '';

    const variantCells = variants
      .map(
        (i) => `
      <td>
        <img src="enemies/${name}_v${i}.png" class="raw">
        <br>
        <img src="thumbs/${name}_enemy_v${i}.png" class="thumb">
        <div class="label-small">v${i} (raw + 64px)</div>
      </td>
    `,
      )
      .join('');

    // Pad empty cells if fewer than 3 variants
    const emptyCells = '<td></td>'.repeat(Math.max(0, 3 - variants.length));

    rows.push(`<tr>
      <td class="label">${name}</td>
      <td>${playerRaw}<br>${playerThumb}<div class="label-small">Player (raw + 64px)</div></td>
      ${variantCells}${emptyCells}
    </tr>`);
  }

  // Ballista row
  rows.push('<tr class="section"><td colspan="6">Ballista Terrain Sprite</td></tr>');
  const bVariants = [];
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(TEST_DIR, 'terrain', `ballista_v${i}.png`))) bVariants.push(i);
  }
  const bCells = bVariants
    .map(
      (i) => `
    <td>
      <img src="terrain/ballista_v${i}.png" class="raw">
      <br>
      <img src="thumbs/ballista_v${i}.png" class="thumb">
      <div class="label-small">v${i} (raw + 64px)</div>
    </td>
  `,
    )
    .join('');
  rows.push(`<tr><td class="label">ballista</td><td></td>${bCells}</tr>`);

  return rows.join('\n');
}

const html = `<!DOCTYPE html>
<html><head><title>NB2 Enemy Sprite Test</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: monospace; padding: 20px; }
  table { border-collapse: collapse; margin: 0 auto; }
  td { padding: 8px; border: 1px solid #333; text-align: center; vertical-align: middle; }
  td.label { font-weight: bold; white-space: nowrap; font-size: 12px; text-align: right; padding-right: 12px; }
  th { padding: 10px; font-size: 13px; border-bottom: 2px solid #555; }
  tr.section td { background: #2a2a4e; font-size: 14px; font-weight: bold; text-align: left; padding: 12px; }
  img.raw { max-width: 160px; max-height: 160px; image-rendering: auto; background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; }
  img.thumb { width: 256px; height: 256px; image-rendering: pixelated; background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; margin-top: 4px; }
  .label-small { font-size: 10px; color: #888; margin-top: 4px; }
  h1 { text-align: center; }
  p { text-align: center; color: #aaa; font-size: 12px; }
</style></head>
<body>
<h1>NB2 Enemy Sprite Test — Red/Empire Variants</h1>
<p>Player reference shown alongside enemy variants. Raw images + 64px downsized thumbnails (4x zoom).</p>
<table>
<tr><th>Class</th><th>Player</th><th>Enemy v0</th><th>Enemy v1</th><th>Enemy v2</th></tr>
${buildRows()}
</table>
</body></html>`;

writeFileSync(OUT_HTML, html);
console.log(`\nComparison HTML: ${OUT_HTML}`);
