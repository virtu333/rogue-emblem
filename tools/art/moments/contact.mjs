#!/usr/bin/env node
// Contact sheet of raw or treated moment images for curation.
//   node tools/art/moments/contact.mjs <glob-dir> <out.png> [--w 180] [--cols 8] [--match str]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [dir, out, ...rest] = process.argv.slice(2);
const arg = (k, d) => (rest.includes(`--${k}`) ? rest[rest.indexOf(`--${k}`) + 1] : d);
const w = Number(arg('w', 180));
const cols = Number(arg('cols', 8));
const match = arg('match', '');
const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(png|jpe?g)$/i.test(f) && f.includes(match))
  .sort();
const tiles = [];
let h = 0;
for (const f of files) {
  const buf = await sharp(path.join(dir, f)).resize({ width: w }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  h = Math.max(h, meta.height);
  tiles.push({ f, buf });
}
const labelH = 14;
const W = cols * (w + 6);
const H = Math.ceil(tiles.length / cols) * (h + labelH + 6);
const svgLabels = tiles
  .map((t, i) => {
    const x = (i % cols) * (w + 6) + 3;
    const y = Math.floor(i / cols) * (h + labelH + 6) + h + 14;
    return `<text x="${x}" y="${y}" font-size="11" fill="#ddd" font-family="sans-serif">${t.f.replace(/\.(png|jpe?g)$/i, '')}</text>`;
  })
  .join('');
const composites = tiles.map((t, i) => ({
  input: t.buf,
  left: (i % cols) * (w + 6) + 3,
  top: Math.floor(i / cols) * (h + labelH + 6) + 3,
}));
composites.push({
  input: Buffer.from(`<svg width="${W}" height="${H}">${svgLabels}</svg>`),
  left: 0,
  top: 0,
});
await sharp({ create: { width: W, height: H, channels: 4, background: '#0e0c14' } })
  .composite(composites)
  .png()
  .toFile(out);
console.log(`${tiles.length} -> ${out}`);
