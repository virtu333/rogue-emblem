// Quick downsize test — compare NB2 sprites at 64x64 and 32x32
// Usage: node tools/nb2-downsize-test.js

import sharp from 'sharp';
import { readdirSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join, basename } from 'path';

const ROOT = resolve('C:/Users/davec/Documents/emblem-rogue');
const INPUT_DIR = join(ROOT, 'References/imagen-output/nb2-roster-v2');
const OUTPUT_DIR = join(ROOT, 'References/imagen-output/nb2-downsize-test');

// Pick a diverse sample: infantry, mounted, flying, large enemy, lord
const SAMPLES = [
  { tier: 'base', file: 'myrmidon.png' },
  { tier: 'base', file: 'knight.png' },
  { tier: 'base', file: 'cleric.png' },
  { tier: 'base', file: 'wyvern_rider.png' },
  { tier: 'base', file: 'cavalier.png' },
  { tier: 'lord', file: 'edric.png' },
  { tier: 'lord', file: 'astrid.png' },
  { tier: 'lord', file: 'cael.png' },
  { tier: 'promoted', file: 'great_lord.png' },
  { tier: 'promoted', file: 'seraph_knight.png' },
  { tier: 'promoted', file: 'duelist.png' },
  { tier: 'promoted', file: 'wyvern_lord.png' },
  { tier: 'enemy', file: 'dragon.png' },
  { tier: 'enemy', file: 'dragon_lord.png' },
];

const SIZES = [128, 64, 32];

async function removeWhiteBg(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.from(data);

  for (let i = 0; i < width * height; i++) {
    const off = i * channels;
    const r = out[off],
      g = out[off + 1],
      b = out[off + 2];
    // White-ish pixels → transparent
    if (r > 240 && g > 240 && b > 240) {
      out[off + 3] = 0;
    }
  }
  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

async function downsizeOne(inputPath, name, tier) {
  const tierDir = join(OUTPUT_DIR, tier);
  mkdirSync(tierDir, { recursive: true });

  const raw = await sharp(inputPath).png().toBuffer();
  const noBg = await removeWhiteBg(raw);

  const results = [];
  for (const size of SIZES) {
    const resized = await sharp(noBg)
      .resize({
        width: size,
        height: size,
        fit: 'contain',
        kernel: sharp.kernel.nearest,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const outName = `${name.replace('.png', '')}_${size}x${size}.png`;
    const outPath = join(tierDir, outName);
    writeFileSync(outPath, resized);
    results.push({ size, path: outPath, relPath: `${tier}/${outName}` });
    console.log(`  ${size}x${size}: ${(resized.length / 1024).toFixed(0)}KB`);
  }
  return results;
}

// Build comparison HTML
function buildHtml(allResults) {
  const rows = allResults
    .map(({ name, tier, sizes }) => {
      const cells = sizes
        .map(
          ({ size, relPath }) =>
            `<td><img src="${relPath}" style="width:${Math.max(size * 4, 128)}px;height:${Math.max(size * 4, 128)}px;image-rendering:pixelated"></td>`,
        )
        .join('\n');
      return `<tr><td class="label">${tier}/${name}</td>\n${cells}</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html><head><title>NB2 Downsize Test</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: monospace; padding: 20px; }
  table { border-collapse: collapse; }
  td { padding: 8px; border: 1px solid #333; text-align: center; vertical-align: bottom; }
  td.label { font-weight: bold; vertical-align: middle; white-space: nowrap; font-size: 12px; }
  th { padding: 8px; font-size: 14px; }
  img { background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; }
</style></head>
<body>
<h1>NB2 Downsize Comparison</h1>
<p>All images displayed at 4x zoom (or 128px min) with <code>image-rendering: pixelated</code>. Checkerboard = transparency.</p>
<table>
<tr><th>Sprite</th>${SIZES.map((s) => `<th>${s}x${s} (${s === 128 ? 'trimmed' : 'downscaled'})</th>`).join('')}</tr>
${rows}
</table>
</body></html>`;
}

// --- Main ---
console.log('NB2 Downsize Test');
console.log(`Samples: ${SAMPLES.length}, Sizes: ${SIZES.join(', ')}`);
console.log(`Output: ${OUTPUT_DIR}\n`);

mkdirSync(OUTPUT_DIR, { recursive: true });

const allResults = [];
for (const { tier, file } of SAMPLES) {
  // Find the _v0 file or plain name
  const inputPath = join(INPUT_DIR, tier, file.replace('.png', '_v0.png'));
  const fallback = join(INPUT_DIR, tier, file);
  const { existsSync } = await import('fs');
  const actualPath = existsSync(inputPath) ? inputPath : fallback;

  if (!existsSync(actualPath)) {
    console.log(`[SKIP] ${tier}/${file} — not found`);
    continue;
  }

  const name = file.replace('.png', '');
  console.log(`[${tier}/${name}]`);
  const sizes = await downsizeOne(actualPath, name, tier);
  allResults.push({ name, tier, sizes });
}

writeFileSync(join(OUTPUT_DIR, 'compare.html'), buildHtml(allResults));
console.log(`\nDone! Open compare.html to review.`);
console.log(`Output: ${OUTPUT_DIR}`);
