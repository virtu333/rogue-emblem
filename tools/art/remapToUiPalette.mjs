#!/usr/bin/env node
// One-shot codemod: move legacy dev-palette literals in canvas UI code onto the shared
// UI palette (src/ui/uiPalette.json → UI_PALETTE / UI_HEX in src/utils/uiStyles.js).
//
//   node tools/art/remapToUiPalette.mjs            rewrite src/ui + src/scenes in place
//   node tools/art/remapToUiPalette.mjs --check    list remaining legacy literals (exit 1 if any)
//   node tools/art/remapToUiPalette.mjs --tests    rewrite test expectations to the new hex values
//
// Literals become live token references, so later palette changes reach these screens.
// White/black fills are never touched (tint and overlay semantics). Art renderers
// (terrain, title backdrop, debug tools) are excluded: their colors are pigments, not UI.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const palette = JSON.parse(readFileSync(join(ROOT, 'src/ui/uiPalette.json'), 'utf8'));
const MODE = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--tests')
    ? 'tests'
    : 'write';

const TEXT_FAMILIES = {
  text: ['#e0e0e0', '#ffffff', '#dddddd', '#cccccc', '#d7dbe8', '#d0d7e8'],
  muted: ['#aaaaaa', '#888888', '#bbbbbb', '#a0a0b8', '#aaaacc', '#aabbcc', '#999999'],
  lineStrong: ['#777777', '#666666', '#555555', '#444444'],
  accentText: ['#ffdd44', '#ffdd88', '#ffdd66', '#ffd580', '#ffcc44', '#ffcc66', '#ffff00'],
  warn: ['#ff8844', '#ffaa55', '#ffaa66', '#ffbb77', '#ffcc88', '#ffb347', '#ffaa44', '#ff8800', '#cc8844'],
  bad: ['#ff8888', '#ff6666', '#ff4444', '#cc5555', '#cc3333', '#aa4444', '#cc6666', '#ff6a6a', '#cc8888'],
  good: ['#88ff88', '#66ff66', '#44ff44', '#44ff88', '#a6ffb0', '#aaffaa', '#88cc44', '#ccffcc', '#d8ffe1', '#cbffd5', '#88ffcc'],
  info: ['#88ccff', '#aaddff', '#88bbff', '#88ddff', '#9ed8ff', '#aaccff', '#a8cfff', '#88ffff', '#44ccbb'],
  rarityEpic: ['#cc88ff', '#ddaaff', '#cc99ff', '#cc66ff', '#cc66cc', '#aa66dd'],
};
// Text-style backgroundColor strings are surfaces, not ink.
const BACKGROUND_FAMILIES = {
  panel: ['#222222', '#111122', '#1a1a2e', '#121a2a'],
  raised: ['#333333', '#223344', '#222233', '#333355'],
  selected: ['#334433', '#443322', '#443300'],
  dangerBg: ['#330000', '#332222', '#442222'],
};
const FILL_FAMILIES = {
  line: [0x666666, 0x555555, 0x444444, 0x66aacc, 0x4466aa, 0x335566, 0x224488, 0x666688, 0x333355, 0x8888cc],
  lineStrong: [0x777777, 0x888888, 0x9c8b6b, 0xcccccc, 0x66ccff],
  panel: [0x111122, 0x222222, 0x222233, 0x121a2a, 0x222244, 0x1a1a2e],
  sunken: [0x000622, 0x0a0a14, 0x111111],
  raised: [0x333333],
  selected: [0x443322, 0x443300, 0x554433],
  accent: [0xffdd44, 0xddaa44, 0xddaa33, 0xffdd77, 0xffd966, 0xffcc33, 0xe8b849],
  hpHigh: [0x44ff44, 0x44ff88, 0x44ccaa, 0x1d5f2a, 0xaadd44, 0x44cc44],
  dangerLine: [0xcc3333, 0xff4444, 0xcc4444, 0xcc5555, 0xcc6666, 0xcc6633],
  warn: [0xff8844, 0xcc8844, 0xffaa44, 0xffb347, 0xffbb55, 0xff8800],
};

const invert = (families) => {
  const m = new Map();
  for (const [key, list] of Object.entries(families)) for (const v of list) m.set(v, key);
  return m;
};
const textMap = invert(TEXT_FAMILIES);
const bgMap = invert(BACKGROUND_FAMILIES);
const fillMap = invert(FILL_FAMILIES);

const EXCLUDE = new Set([
  'src/ui/WeatheredTerrain.js',
  'src/ui/BattleContrast.js',
  'src/ui/DebugOverlay.js',
  'src/scenes/TitleScene.js', // backdrop is being replaced by the Hollow Sun key art
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

function toHexInt(n) {
  return `0x${n.toString(16).padStart(6, '0')}`;
}

function rewriteSource(src, { literalValues }) {
  let usesPalette = false;
  let usesHex = false;
  let count = 0;
  let out = src.replace(
    /(backgroundColor\s*:\s*)?(['"])#([0-9a-fA-F]{6})\2/g,
    (m, bgPrefix, q, hex) => {
      const lower = `#${hex.toLowerCase()}`;
      const key = bgPrefix ? bgMap.get(lower) || textMap.get(lower) : textMap.get(lower);
      if (!key) return m;
      count += 1;
      if (literalValues) return `${bgPrefix || ''}${q}${palette[key]}${q}`;
      usesPalette = true;
      return `${bgPrefix || ''}UI_PALETTE.${key}`;
    },
  );
  out = out.replace(/\b0x([0-9a-fA-F]{6})\b(?![0-9a-fA-F])/g, (m, hex) => {
    const key = fillMap.get(parseInt(hex, 16));
    if (!key) return m;
    count += 1;
    if (literalValues) return toHexInt(parseInt(palette[key].slice(1), 16));
    usesHex = true;
    return `UI_HEX.${key}`;
  });
  return { out, count, usesPalette, usesHex };
}

function ensureImport(src, file, names) {
  const spec = relative(dirname(file), join(ROOT, 'src/utils/uiStyles.js')).split('\\').join('/');
  const path = spec.startsWith('.') ? spec : `./${spec}`;
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${path.replace(/[.]/g, '\\.')}['"];?`);
  const m = src.match(existing);
  if (m) {
    const have = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...have, ...names])];
    return src.replace(existing, `import { ${merged.join(', ')} } from '${path}';`);
  }
  const importRe = /^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm;
  let lastEnd = -1;
  let mm;
  while ((mm = importRe.exec(src))) lastEnd = mm.index + mm[0].length;
  const line = `import { ${names.join(', ')} } from '${path}';`;
  return lastEnd >= 0 ? `${src.slice(0, lastEnd)}\n${line}${src.slice(lastEnd)}` : `${line}\n${src}`;
}

if (MODE === 'tests') {
  let total = 0;
  for (const file of walk(join(ROOT, 'tests'))) {
    if (file.includes('/e2e/')) continue;
    const src = readFileSync(file, 'utf8');
    const { out, count } = rewriteSource(src, { literalValues: true });
    if (count) {
      writeFileSync(file, out);
      total += count;
    }
  }
  console.log(`Rewrote ${total} test literals to palette values.`);
  process.exit(0);
}

const files = [...walk(join(ROOT, 'src/ui')), ...walk(join(ROOT, 'src/scenes'))].filter(
  (f) => !EXCLUDE.has(relative(ROOT, f).split('\\').join('/')),
);
let total = 0;
const report = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const { out, count, usesPalette, usesHex } = rewriteSource(src, { literalValues: false });
  if (!count) continue;
  report.push(`${relative(ROOT, file)}: ${count}`);
  total += count;
  if (MODE === 'check') continue;
  const names = [...(usesPalette ? ['UI_PALETTE'] : []), ...(usesHex ? ['UI_HEX'] : [])];
  writeFileSync(file, ensureImport(out, file, names));
}
if (MODE === 'check') {
  if (total) {
    console.log(`Legacy UI literals remain (${total}):\n  ${report.join('\n  ')}`);
    process.exit(1);
  }
  console.log('No legacy UI literals remain.');
} else {
  console.log(`Remapped ${total} literals in ${report.length} files.`);
}
