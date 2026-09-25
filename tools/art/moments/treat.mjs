#!/usr/bin/env node
// Moments: turn the curated raw paintings (selections.json) into display-size PC-98
// scenes — the ART_BIBLE palette, ordered dither, ink line (tools/art/icons/lib/sceneTreat)
// — and write them as palette PNGs the game lazy-loads:
//   assets/ui/moments/cards/<blessing id>.png      192 x 256 (shown 1x phone, 2x desktop)
//   assets/ui/moments/vignettes/<service>.png      640 x 360 (1x phone, 2x desktop band)
// plus src/ui/momentArtManifest.json (ids and content hashes for cache busting).
//   node tools/art/moments/treat.mjs [--sheet]   (--sheet: contact sheet for curation)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import prettier from 'prettier';
import { treatScene } from '../icons/lib/sceneTreat.mjs';
import { encodeIndexed } from '../icons/lib/png.mjs';

const RAW = 'References/items-art/moments';
const SEL = JSON.parse(fs.readFileSync('tools/art/moments/selections.json', 'utf8'));
const DIRS = ['assets/ui/moments', 'public/assets/ui/moments'];
const MANIFEST = 'src/ui/momentArtManifest.json';
export const CARD = [192, 256];
export const VIGNETTE = [640, 360];

function rawFile(kind, source) {
  for (const ext of ['.jpg', '.png']) {
    const f = path.join(RAW, kind, `${source}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`missing raw ${kind}/${source}`);
}

async function treat(kind, pick, [w, h], colours) {
  const file = rawFile(kind, pick.source);
  const meta = await sharp(file).metadata();
  const [l, t, r, b] = pick.crop || [0, 0, 0, 0];
  const region = {
    left: Math.round(meta.width * l),
    top: Math.round(meta.height * t),
    width: Math.round(meta.width * (1 - l - r)),
    height: Math.round(meta.height * (1 - t - b)),
  };
  const { data } = await sharp(file)
    .extract(region)
    .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = treatScene(new Uint8Array(data), w, h, { colours });
  return encodeIndexed(rgba, w, h);
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

const manifest = {
  version: 1,
  generator: 'tools/art/moments/treat.mjs',
  card: CARD,
  vignette: VIGNETTE,
  cards: {},
  vignettes: {},
};
const sheet = [];
for (const [kind, table, size, colours, sub] of [
  ['card', SEL.cards, CARD, 20, 'cards'],
  ['scene', SEL.vignettes, VIGNETTE, 24, 'vignettes'],
]) {
  for (const [id, pick] of Object.entries(table)) {
    const png = await treat(kind, pick, size, colours);
    for (const dir of DIRS) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
      fs.writeFileSync(path.join(dir, sub, `${id}.png`), png);
    }
    const record = JSON.parse(
      fs.readFileSync(path.join(RAW, kind, `${pick.source}.gen.json`), 'utf8'),
    );
    manifest[sub][id] = { v: sha(png), model: record.model };
    sheet.push({ id, png, size });
    console.log(`${sub}/${id}.png ${png.length} B (${record.model})`);
  }
}
fs.writeFileSync(
  MANIFEST,
  await prettier.format(JSON.stringify(manifest), {
    ...(await prettier.resolveConfig(MANIFEST)),
    parser: 'json',
  }),
);

if (process.argv.includes('--sheet')) {
  const cards = sheet.filter((s) => s.size === CARD);
  const scenes = sheet.filter((s) => s.size === VIGNETTE);
  const cols = 8;
  const W = cols * (CARD[0] + 8);
  const H =
    Math.ceil(cards.length / cols) * (CARD[1] + 8) +
    Math.ceil(scenes.length / 2) * (VIGNETTE[1] + 8);
  const comps = cards.map((c, i) => ({
    input: c.png,
    left: (i % cols) * (CARD[0] + 8),
    top: Math.floor(i / cols) * (CARD[1] + 8),
  }));
  const y0 = Math.ceil(cards.length / cols) * (CARD[1] + 8);
  scenes.forEach((s, i) =>
    comps.push({
      input: s.png,
      left: (i % 2) * (VIGNETTE[0] + 8),
      top: y0 + Math.floor(i / 2) * (VIGNETTE[1] + 8),
    }),
  );
  await sharp({ create: { width: W, height: H, channels: 4, background: '#0e0c14' } })
    .composite(comps)
    .png()
    .toFile('References/items-art/moments-treated.png');
  console.log('sheet -> References/items-art/moments-treated.png');
}
