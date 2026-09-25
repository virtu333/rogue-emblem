#!/usr/bin/env node
// Compress the production captures (References/items-art/captures) into
// docs/art-direction/items/production/{before,after}/ as WebP, and report the total.
//   node tools/art/icons/exportProduction.mjs [--quality 72] [--only name,name]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const quality = Number(arg('quality', 72));
const only = arg('only', null)?.split(',');
const SRC = 'References/items-art/captures';
const OUT = 'docs/art-direction/items/production';

let total = 0;
for (const f of fs.readdirSync(SRC).sort()) {
  const m = f.match(/^(.+)-(before|after)-(\d+x\d+)\.png$/);
  if (!m) continue;
  const [, name, tag, view] = m;
  if (only && !only.includes(name)) continue;
  const dir = path.join(OUT, tag);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${name}-${view}.webp`);
  // Phone captures are DPR 2; keep them at 2x so pixel art stays legible.
  await sharp(path.join(SRC, f)).webp({ quality, effort: 6 }).toFile(out);
  const size = fs.statSync(out).size;
  total += size;
  console.log(`${out} ${(size / 1024).toFixed(0)} KB`);
}
let all = 0;
for (const tag of ['before', 'after'])
  for (const f of fs.existsSync(path.join(OUT, tag)) ? fs.readdirSync(path.join(OUT, tag)) : [])
    all += fs.statSync(path.join(OUT, tag, f)).size;
console.log(
  `written ${(total / 1024).toFixed(0)} KB; production folder ${(all / 1048576).toFixed(2)} MB`,
);
