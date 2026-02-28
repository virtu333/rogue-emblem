#!/usr/bin/env node
// Test palette-swap approaches for converting player (blue) sprites to enemy (red)
// Tries multiple techniques on a diverse sample and generates comparison HTML
//
// Usage: node tools/nb2-palette-swap-test.js

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const CHAR_DIR = path.join(ROOT, 'assets/sprites/characters');
const OUT_DIR = path.join(ROOT, 'References/imagen-output/nb2-palette-swap-test');

// Diverse sample: infantry, armored, mounted, flying, magic, ranged
const SAMPLES = [
  'myrmidon',
  'knight',
  'cavalier',
  'archer',
  'mage',
  'cleric',
  'pegasus_knight',
  'wyvern_rider',
  'fighter',
  'thief',
  'swordmaster',
  'paladin',
  'general',
  'sage',
  'falcon_knight',
];

// ── Technique 1: HSL hue rotation (blue→red = ~180° shift) ───────────────

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// Shift hue of blue-ish pixels toward red, leave non-blue pixels alone
function hueShiftBlueToRed(data, channels) {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] === 0) continue; // skip transparent
    const r = out[i],
      g = out[i + 1],
      b = out[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    // Blue hue range: roughly 0.5-0.75 (180°-270°)
    // Cyan-blue range: 0.45-0.75
    if (s > 0.1 && h >= 0.45 && h <= 0.8) {
      // Shift to red (0.0) — map blue range to red-orange range
      const newH = (h - 0.5 + 1.0) % 1.0; // ~180° rotation
      const [nr, ng, nb] = hslToRgb(newH, s, l);
      out[i] = nr;
      out[i + 1] = ng;
      out[i + 2] = nb;
    }
  }
  return out;
}

// ── Technique 2: Full hue rotation (shift everything ~180°) ──────────────

function fullHueRotate(data, channels, degrees = 180) {
  const out = Buffer.from(data);
  const shift = degrees / 360;
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(out[i], out[i + 1], out[i + 2]);
    if (s < 0.05) continue; // skip grays
    const newH = (h + shift) % 1.0;
    const [nr, ng, nb] = hslToRgb(newH, s, l);
    out[i] = nr;
    out[i + 1] = ng;
    out[i + 2] = nb;
  }
  return out;
}

// ── Technique 3: Channel swap (R↔B) — simple, sometimes works for pixel art

function channelSwapRB(data, channels) {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] === 0) continue;
    const r = out[i],
      b = out[i + 2];
    out[i] = b; // R ← B
    out[i + 2] = r; // B ← R
  }
  return out;
}

// ── Technique 4: Red tint overlay (multiply red channel, reduce blue) ────

function redTintOverlay(data, channels) {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] === 0) continue;
    const r = out[i],
      g = out[i + 1],
      b = out[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < 0.08) continue; // skip near-gray (armor, skin highlights)
    // Boost red, suppress blue
    out[i] = Math.min(255, Math.round(r * 1.3 + b * 0.3));
    out[i + 1] = Math.round(g * 0.7);
    out[i + 2] = Math.round(b * 0.3);
  }
  return out;
}

// ── Processing ───────────────────────────────────────────────────────────

const TECHNIQUES = [
  { name: 'hue_shift_blue', label: 'Blue→Red Hue Shift', fn: hueShiftBlueToRed },
  { name: 'hue_rotate_180', label: 'Full 180° Hue Rotate', fn: (d, c) => fullHueRotate(d, c, 180) },
  { name: 'channel_swap', label: 'R↔B Channel Swap', fn: channelSwapRB },
  { name: 'red_tint', label: 'Red Tint Overlay', fn: redTintOverlay },
];

async function processSprite(name) {
  const srcPath = path.join(CHAR_DIR, `${name}.png`);
  if (!fs.existsSync(srcPath)) {
    console.log(`  SKIP: ${name} not found`);
    return null;
  }

  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Copy original to output
  const origOut = path.join(OUT_DIR, `${name}_original.png`);
  fs.copyFileSync(srcPath, origOut);

  const results = [{ technique: 'original', file: `${name}_original.png` }];

  for (const tech of TECHNIQUES) {
    const modified = tech.fn(data, info.channels);
    const outBuf = await sharp(modified, { raw: info }).png().toBuffer();
    const outFile = `${name}_${tech.name}.png`;
    fs.writeFileSync(path.join(OUT_DIR, outFile), outBuf);
    results.push({ technique: tech.name, label: tech.label, file: outFile });
  }

  return { name, results };
}

// ── HTML generation ──────────────────────────────────────────────────────

function buildHtml(allResults) {
  const headers = ['Original', ...TECHNIQUES.map((t) => t.label)];
  const headerRow = headers.map((h) => `<th>${h}</th>`).join('');

  const rows = allResults
    .map(({ name, results }) => {
      const cells = results
        .map(
          (r) =>
            `<td><img src="${r.file}" style="width:192px;height:192px;image-rendering:pixelated"></td>`,
        )
        .join('');
      return `<tr><td class="label">${name}</td>${cells}</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html><head><title>NB2 Palette Swap Test</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: monospace; padding: 20px; }
  table { border-collapse: collapse; margin: 0 auto; }
  td { padding: 6px; border: 1px solid #333; text-align: center; vertical-align: middle; }
  td.label { font-weight: bold; white-space: nowrap; font-size: 11px; text-align: right; padding-right: 12px; }
  th { padding: 8px; font-size: 11px; border-bottom: 2px solid #555; }
  img { background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; display: block; margin: 0 auto; }
  h1 { text-align: center; }
  p { text-align: center; color: #aaa; font-size: 12px; }
</style></head>
<body>
<h1>NB2 Palette Swap Test — Blue→Red</h1>
<p>All sprites shown at 6x zoom (192px) with pixelated rendering. ${SAMPLES.length} samples &times; ${TECHNIQUES.length} techniques.</p>
<table>
<tr><th>Sprite</th>${headerRow}</tr>
${rows}
</table>
</body></html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`NB2 Palette Swap Test — ${SAMPLES.length} samples × ${TECHNIQUES.length} techniques`);
console.log(`Output: ${OUT_DIR}\n`);

const allResults = [];
for (const name of SAMPLES) {
  console.log(`Processing ${name}...`);
  const result = await processSprite(name);
  if (result) allResults.push(result);
}

fs.writeFileSync(path.join(OUT_DIR, 'compare.html'), buildHtml(allResults));
console.log(`\nDone! Open compare.html to review:`);
console.log(`  ${path.join(OUT_DIR, 'compare.html')}`);
