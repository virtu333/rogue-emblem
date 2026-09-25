#!/usr/bin/env node
// Direction A ("Forged in code"): render every catalog icon natively at each display size,
// plus one atlas per size (what the runtime would load) and a manifest.
//   node tools/art/icons/buildPixel.mjs [--out References/items-study/pixel]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { renderIcon } from './lib/pixelIcon.mjs';
import { MATERIALS } from './lib/palette.mjs';
import { catalog } from './lib/itemGrammar.mjs';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out')
  ? argv[argv.indexOf('--out') + 1]
  : 'References/items-study/pixel';
export const SIZES = [16, 24, 32, 48];
const read = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const data = {
  weapons: read('weapons'),
  consumables: read('consumables'),
  accessories: read('accessories'),
  whetstones: read('whetstones'),
  imbues: read('imbues'),
  blessings: read('blessings'),
  metaUpgrades: read('metaUpgrades'),
};
export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const groups = catalog(data);
const manifest = { sizes: SIZES, groups: [] };
const seen = new Set();
const t0 = Date.now();
for (const size of SIZES) fs.mkdirSync(path.join(OUT, String(size)), { recursive: true });
const all = [];
for (const g of groups) {
  const entry = { label: g.label, items: [] };
  for (const it of g.items) {
    let id = slug(it.name);
    while (seen.has(id)) id += '-x';
    seen.add(id);
    entry.items.push({ id, name: it.name });
    all.push({ id, spec: it.spec });
  }
  manifest.groups.push(entry);
}
for (const size of SIZES) {
  const cols = 16;
  const rows = Math.ceil(all.length / cols);
  const atlas = Buffer.alloc(cols * size * rows * size * 4);
  const frames = {};
  for (const [i, { id, spec }] of all.entries()) {
    const icon = renderIcon(spec, size, MATERIALS);
    await sharp(Buffer.from(icon.rgba.buffer), { raw: { width: size, height: size, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, String(size), `${id}.png`));
    const ox = (i % cols) * size;
    const oy = Math.floor(i / cols) * size;
    for (let y = 0; y < size; y++)
      Buffer.from(icon.rgba.buffer)
        .subarray(y * size * 4, (y + 1) * size * 4)
        .copy(atlas, ((oy + y) * cols * size + ox) * 4);
    frames[id] = { x: ox, y: oy, w: size, h: size };
  }
  const file = path.join(OUT, `atlas-${size}.png`);
  await sharp(atlas, { raw: { width: cols * size, height: rows * size, channels: 4 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(file);
  manifest[`atlas${size}`] = {
    file: path.basename(file),
    w: cols * size,
    h: rows * size,
    bytes: fs.statSync(file).size,
    frames,
  };
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(
  `${all.length} icons x ${SIZES.length} sizes in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
for (const s of SIZES)
  console.log(
    `atlas ${s}: ${manifest[`atlas${s}`].w}x${manifest[`atlas${s}`].h}, ${manifest[`atlas${s}`].bytes} bytes`,
  );
