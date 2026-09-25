// Export the study's review images (compressed WebP) into docs/art-direction/items/.
// Full-resolution sources stay in References/items-study (gitignored).
//   node tools/art/icons/study/export.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'References/items-study';
const OUT = 'docs/art-direction/items';
fs.mkdirSync(OUT, { recursive: true });
const written = [];

async function webp(input, file, { width, quality = 78 } = {}) {
  let s = sharp(input);
  if (width) s = s.resize({ width, kernel: 'lanczos3' });
  await s.webp({ quality, effort: 6 }).toFile(path.join(OUT, file));
  written.push(file);
}

const label = (text, w, h = 18) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#0e0c14"/><text x="6" y="${h - 5}" font-family="DejaVu Sans" font-size="12" fill="#dca044">${text}</text></svg>`,
  );

/** Grid contact sheet of files with captions. */
async function sheet(
  files,
  out,
  { cols = 3, tw, th, caption = (f) => path.basename(f), width, quality } = {},
) {
  const rows = Math.ceil(files.length / cols);
  const cellH = th + 18;
  const comps = [];
  for (const [i, f] of files.entries()) {
    const x = (i % cols) * (tw + 4);
    const y = Math.floor(i / cols) * (cellH + 4);
    comps.push({ input: label(caption(f), tw), left: x, top: y });
    comps.push({
      input: await sharp(f).resize(tw, th, { fit: 'contain', background: '#0e0c14' }).toBuffer(),
      left: x,
      top: y + 18,
    });
  }
  const img = sharp({
    create: {
      width: cols * (tw + 4) - 4,
      height: rows * (cellH + 4) - 4,
      channels: 3,
      background: '#221e2b',
    },
  }).composite(comps);
  await webp(await img.png().toBuffer(), out, { width, quality });
}

// 1. Audit.
const auditPhone = fs
  .readdirSync(`${SRC}/audit`)
  .filter((f) => f.endsWith('-844x390.png'))
  .sort()
  .map((f) => `${SRC}/audit/${f}`);
const auditDesk = fs
  .readdirSync(`${SRC}/audit-d`)
  .filter((f) => f.endsWith('-1280x800.png'))
  .sort()
  .map((f) => `${SRC}/audit-d/${f}`);
const cap = (f) => path.basename(f).replace(/-\d+x\d+\.png$/, '');
await sheet(auditPhone, 'audit-phone-844x390.webp', {
  tw: 422,
  th: 195,
  caption: cap,
  quality: 74,
});
await sheet(auditDesk, 'audit-desktop-1280x800.webp', {
  cols: 4,
  tw: 320,
  th: 200,
  caption: cap,
  quality: 74,
});
{
  const icons = fs
    .readdirSync('assets/sprites/ui')
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => `assets/sprites/ui/${f}`);
  await sheet(icons, 'audit-legacy-icons.webp', {
    cols: 10,
    tw: 64,
    th: 64,
    caption: (f) => path.basename(f, '.png').replace('icon_', '').slice(0, 10),
    quality: 82,
  });
}

// 2. Icon directions.
await webp(`${SRC}/boards/compare-abc.png`, 'icons-compare-abc.webp', { width: 1600, quality: 86 });
await webp(`${SRC}/boards/pixel-catalog.png`, 'icons-a-catalog.webp', { quality: 84 });
await webp(`${SRC}/boards/pixel-sizes.png`, 'icons-a-sizes.webp', { width: 1600, quality: 86 });
await webp(`${SRC}/boards/sigil-sizes.png`, 'icons-c-sigils.webp', { width: 1600, quality: 84 });

// 3. Generated art (raw vs treated).
{
  const M = `${SRC}/moments`;
  const cards = [
    'coin_of_fate',
    'steady_hands',
    'field_medic',
    'scholar_vow',
    'iron_oath',
    'pilgrim_coin',
    'forbidden_tome',
    'blood_forge',
  ];
  const comps = [];
  for (const [i, c] of cards.entries()) {
    comps.push({
      input: await sharp(`${M}/${c}-raw.jpg`).resize(192, 288).toBuffer(),
      left: i * 196,
      top: 0,
    });
    comps.push({
      input: await sharp(`${M}/${c}.png`).resize(192, 288, { kernel: 'nearest' }).toBuffer(),
      left: i * 196,
      top: 292,
    });
  }
  const img = sharp({
    create: { width: 8 * 196 - 4, height: 580, channels: 3, background: '#0e0c14' },
  }).composite(comps);
  await webp(await img.png().toBuffer(), 'moments-cards-raw-vs-treated.webp', { quality: 80 });
  const scenes = ['forge', 'church', 'shop', 'arena', 'ruins', 'caravan'];
  const sc = [];
  for (const [i, c] of scenes.entries())
    sc.push({
      input: await sharp(`${M}/${c}.png`).resize(480, 270, { kernel: 'nearest' }).toBuffer(),
      left: (i % 3) * 484,
      top: Math.floor(i / 3) * 274,
    });
  const simg = sharp({
    create: { width: 3 * 484 - 4, height: 2 * 274 - 4, channels: 3, background: '#0e0c14' },
  }).composite(sc);
  await webp(await simg.png().toBuffer(), 'moments-vignettes.webp', { quality: 80 });
}

// 4. Mockups (phone captures are DPR 3; exported at DPR 2).
const MK = `${SRC}/mockups`;
const mocks = [
  'shop-pixel',
  'shop-sigil',
  'shop-painted',
  'forge-pixel',
  'caravan-pixel',
  'rewards-pixel',
  'upgrades-pixel',
  'upgrades-skills-pixel',
  'upgrade-bought',
  'blessing-painted',
  'blessing-emblem',
  'church-pixel',
  'ruins-pixel',
  'arena-pixel',
];
for (const m of mocks) {
  const p = `${MK}/${m}-844x390.png`;
  if (fs.existsSync(p)) await webp(p, `mock-${m}-844x390.webp`, { width: 1688, quality: 76 });
}
for (const m of [
  'shop-pixel',
  'forge-pixel',
  'rewards-pixel',
  'blessing-painted',
  'church-pixel',
  'arena-pixel',
  'upgrades-pixel',
]) {
  const p = `${MK}/${m}-1280x800.png`;
  if (fs.existsSync(p)) await webp(p, `mock-${m}-1280x800.webp`, { quality: 74 });
}
// Reward reveal strip.
{
  const frames = ['reveal-0', 'reveal-1', 'reveal-2', 'rewards-pixel']
    .map((f) => `${MK}/${f}-844x390.png`)
    .filter(fs.existsSync);
  const comps = [];
  for (const [i, f] of frames.entries())
    comps.push({
      input: await sharp(f).resize(844, 390).toBuffer(),
      left: (i % 2) * 848,
      top: Math.floor(i / 2) * 394,
    });
  const img = sharp({
    create: { width: 2 * 848 - 4, height: 2 * 394 - 4, channels: 3, background: '#221e2b' },
  }).composite(comps);
  await webp(await img.png().toBuffer(), 'mock-reward-reveal-strip.webp', { quality: 76 });
}

let total = 0;
for (const f of fs.readdirSync(OUT))
  if (f.endsWith('.webp')) total += fs.statSync(path.join(OUT, f)).size;
console.log(`${written.length} images, total ${(total / 1024 / 1024).toFixed(2)} MB`);
for (const f of written)
  console.log(`${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0).padStart(5)} KB ${f}`);
