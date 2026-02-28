#!/usr/bin/env node
// Generate comparison HTML for the full NB2 processed roster
// Shows source (original), 64x64, and 32x32 side-by-side for all 58 classes
//
// Usage: node tools/nb2-compare-full.js

import { existsSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve('.');
const PROCESSED = join(ROOT, 'References/imagen-output/nb2-roster-v2/processed');
const OUT_HTML = join(PROCESSED, 'compare.html');

// Same tier groupings as the processor
const TIERS = {
  'Base Classes': {
    srcDir: 'base',
    destDir: 'characters',
    names: [
      'archer',
      'cavalier',
      'chevalier',
      'cleric',
      'dancer',
      'fighter',
      'knight',
      'light_sage',
      'lord',
      'mage',
      'mercenary',
      'myrmidon',
      'pegasus_knight',
      'ranger',
      'sentinel',
      'sky_lancer',
      'tactician',
      'thief',
      'wyvern_rider',
    ],
  },
  'Promoted Classes': {
    srcDir: 'promoted',
    destDir: 'characters',
    names: [
      'assassin',
      'bard',
      'battle_monk',
      'berserker',
      'bishop',
      'bow_knight',
      'champion',
      'dark_knight',
      'duelist',
      'falcon_knight',
      'general',
      'grandmaster',
      'great_knight',
      'great_lord',
      'hero',
      'holy_knight',
      'hunter',
      'light_priestess',
      'paladin',
      'sage',
      'seraph_knight',
      'sniper',
      'swordmaster',
      'trickster',
      'vanguard',
      'warlock',
      'warrior',
      'wyvern_lord',
    ],
  },
  Lords: {
    srcDir: 'lord',
    destDir: 'characters',
    names: ['edric', 'astrid', 'cael', 'kira', 'rowan', 'sera', 'voss'],
    // Special dest names for lords
    destMap: { edric: 'lordedric' },
  },
  Enemies: {
    srcDir: 'enemy',
    destDir: 'enemies',
    names: ['dragon', 'dragon_lord', 'revenant', 'zombie'],
  },
};

function buildRows() {
  const rows = [];
  for (const [tierLabel, cfg] of Object.entries(TIERS)) {
    // Section header
    rows.push(`<tr class="section"><td colspan="4">${tierLabel} (${cfg.names.length})</td></tr>`);

    for (const name of cfg.names) {
      const destName = cfg.destMap?.[name] || name;
      const srcPath = `../${cfg.srcDir}/${name}.png`;
      const path64 = `64/${cfg.destDir}/${destName}.png`;
      const path32 = `32/${cfg.destDir}/${destName}.png`;

      // Check files exist
      const has64 = existsSync(join(PROCESSED, path64));
      const has32 = existsSync(join(PROCESSED, path32));

      rows.push(`<tr>
  <td class="label">${cfg.srcDir}/${name}</td>
  <td><img src="${srcPath}" style="width:128px;height:128px;image-rendering:auto;object-fit:contain"></td>
  <td>${has64 ? `<img src="${path64}" style="width:256px;height:256px;image-rendering:pixelated">` : '<span class="miss">MISSING</span>'}</td>
  <td>${has32 ? `<img src="${path32}" style="width:256px;height:256px;image-rendering:pixelated">` : '<span class="miss">MISSING</span>'}</td>
</tr>`);
    }
  }
  return rows.join('\n');
}

const html = `<!DOCTYPE html>
<html><head><title>NB2 Full Roster Comparison</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: monospace; padding: 20px; }
  table { border-collapse: collapse; margin: 0 auto; }
  td { padding: 8px; border: 1px solid #333; text-align: center; vertical-align: middle; }
  td.label { font-weight: bold; white-space: nowrap; font-size: 11px; text-align: right; padding-right: 12px; }
  th { padding: 10px; font-size: 13px; border-bottom: 2px solid #555; }
  tr.section td { background: #2a2a4e; font-size: 14px; font-weight: bold; text-align: left; padding: 12px 8px; }
  img { background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px; display: block; margin: 0 auto; }
  .miss { color: #f44; font-weight: bold; }
  h1 { text-align: center; }
  p { text-align: center; color: #aaa; font-size: 12px; }
</style></head>
<body>
<h1>NB2 Full Roster — 58 Classes</h1>
<p>Source shown at 128px (smooth), processed shown at 256px (4x/8x zoom, pixelated). Checkerboard = transparency.</p>
<table>
<tr><th>Sprite</th><th>Source (128px)</th><th>64x64 (4x zoom)</th><th>32x32 (8x zoom)</th></tr>
${buildRows()}
</table>
</body></html>`;

writeFileSync(OUT_HTML, html);
console.log(`Comparison HTML written to: ${OUT_HTML}`);
console.log(`Open in browser to review all 58 classes.`);
