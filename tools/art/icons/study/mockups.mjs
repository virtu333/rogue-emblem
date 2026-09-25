// Mockups: the proposed art composited into the real game DOM (dev routes; presentation
// only, no game-code changes). Needs the dev server (see capture.mjs).
//   node tools/art/icons/study/mockups.mjs [--only shop,rewards] [--out dir] [--viewport phone|desktop|both]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCREENS, newStudyPage } from './screens.mjs';
import { renderIcon } from '../lib/pixelIcon.mjs';
import { MATERIALS, RAMPS, hexToRgb } from '../lib/palette.mjs';
import { blessingBoonSpec, haloed } from '../lib/itemGrammar.mjs';
import { sigilSvg } from '../lib/sigil.mjs';
import { SAMPLE, DATA } from './sample.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const base = arg('base', 'http://127.0.0.1:3161/');
const OUT = arg('out', 'References/items-study/mockups');
const only = arg('only', null)?.split(',');
const which = arg('viewport', 'both');
fs.mkdirSync(OUT, { recursive: true });
const PIX = 'References/items-study/pixel';
const MOM = 'References/items-study/moments';
const PAINT = 'References/items-study/painted';

const dataUrl = (file) =>
  fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : null;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Icons by group for each direction.
const manifest = JSON.parse(fs.readFileSync(`${PIX}/manifest.json`, 'utf8'));
const GROUP_OF = (label) =>
  ['Consumables', 'Accessories', 'Forge', 'Blessings', 'Upgrades'].includes(label)
    ? label
    : 'Weapons';
function pixelIcons() {
  const icons = {};
  for (const g of manifest.groups)
    for (const it of g.items) {
      const grp = (icons[GROUP_OF(g.label)] ||= {});
      grp[it.name] = {
        24: dataUrl(`${PIX}/24/${it.id}.png`),
        32: dataUrl(`${PIX}/32/${it.id}.png`),
        48: dataUrl(`${PIX}/48/${it.id}.png`),
      };
    }
  // Stones are named "<X> Imbuing Stone" in data but "<X> Stone" in the sample.
  return icons;
}
function sampleIcons(kind) {
  const icons = {
    Weapons: {},
    Consumables: {},
    Accessories: {},
    Forge: {},
    Upgrades: {},
    Blessings: {},
  };
  for (const [i, s] of SAMPLE.entries()) {
    let urls;
    if (kind === 'sigil') {
      const svg = sigilSvg(s.spec, { plaque: s.plaque, tier: s.tier, id: `m${i}` });
      const u = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      urls = { 24: u, 32: u, 48: u };
    } else {
      urls = {
        24: dataUrl(`${PAINT}/24/${slug(s.name)}.png`),
        32: dataUrl(`${PAINT}/32/${slug(s.name)}.png`),
        48: dataUrl(`${PAINT}/48/${slug(s.name)}.png`),
      };
      if (!urls[32]) continue;
    }
    for (const g of Object.keys(icons)) icons[g][s.name] = urls;
  }
  return icons;
}

// Item facts (tier, type, lore) by name, from data.
const items = {};
for (const w of DATA.weapons) items[w.name] = { tier: w.tier, type: w.type, lore: w.lore };
for (const c of DATA.consumables) items[c.name] = { type: 'Supply', lore: c.lore };
for (const a of DATA.accessories) items[a.name] = { type: 'Accessory', lore: a.lore };
for (const w of DATA.whetstones) items[w.name] = { type: 'Forge', lore: w.lore };
items.Gold = { type: 'Gold' };

// Procedural card faces (the no-generation alternative): dusk sky, Hollow Sun, the boon.
async function emblemCard(b) {
  const W = 192;
  const H = 288;
  const px = Buffer.alloc(W * H * 4);
  const bay = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const sky = [
    RAMPS.ink[1],
    RAMPS.ink[2],
    RAMPS.unlight[0],
    RAMPS.unlight[1],
    RAMPS.ember[0],
    RAMPS.ember[1],
  ].map(hexToRgb);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = Math.max(0, Math.min(0.999, (y / H) ** 1.3 * (sky.length - 1)));
      const k = Math.floor(t);
      const f = t - k;
      const c = f * 16 > bay[(y % 4) * 4 + (x % 4)] ? sky[Math.min(k + 1, sky.length - 1)] : sky[k];
      px.set([...c, 255], (y * W + x) * 4);
    }
  const icon = renderIcon(haloed(blessingBoonSpec(b), 4), 128, MATERIALS);
  const ox = (W - 128) / 2;
  const oy = 58;
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const a = icon.rgba[(y * 128 + x) * 4 + 3] / 255;
      if (!a) continue;
      const i = ((oy + y) * W + ox + x) * 4;
      for (let c = 0; c < 3; c++)
        px[i + c] = Math.round(icon.rgba[(y * 128 + x) * 4 + c] * a + px[i + c] * (1 - a));
    }
  const buf = await sharp(px, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
  fs.mkdirSync(`${MOM}/emblem`, { recursive: true });
  fs.writeFileSync(`${MOM}/emblem/${b.id}.png`, buf);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const art = {};
for (const f of fs.existsSync(MOM) ? fs.readdirSync(MOM) : []) {
  if (!f.endsWith('.png')) continue;
  const id = f.replace('.png', '');
  const isCard = DATA.blessings.blessings.some((b) => b.id === id);
  art[isCard ? `card-${id}` : id] = dataUrl(`${MOM}/${f}`);
}
for (const b of DATA.blessings.blessings) art[`emblem-${b.id}`] = await emblemCard(b);

const inject = fs.readFileSync(new URL('./inject.browser.js', import.meta.url), 'utf8');
async function decorate(page, payload, fn, opts) {
  await page.evaluate((p) => {
    window.__IA = p;
  }, payload);
  await page.addScriptTag({ content: inject });
  await page.evaluate(([fn, opts]) => window.__iaDecorate[fn](opts), [fn, opts]);
  await page.waitForTimeout(400);
}

const B = (id) => DATA.blessings.blessings.find((b) => b.id === id);
const cardOf = (id, cost) => ({
  id,
  name: B(id).name,
  tier: B(id).tier,
  description: B(id).description,
  cost,
});
const CARDS = [
  cardOf('coin_of_fate', null),
  cardOf('scholar_vow', '-10% XP gain from combat'),
  cardOf('forbidden_tome', '-30% battle gold'),
];

const pixel = { icons: pixelIcons(), art, items };
const MOCKS = {
  'shop-pixel': ['shop-buy', 'shop', { direction: 'pixel', vignetteId: 'shop' }, pixel],
  'shop-sigil': [
    'shop-buy',
    'shop',
    { direction: 'sigil', vignetteId: null },
    { icons: sampleIcons('sigil'), art, items },
  ],
  'shop-painted': [
    'shop-buy',
    'shop',
    { direction: 'painted', vignetteId: null },
    { icons: sampleIcons('painted'), art, items },
  ],
  'forge-pixel': ['shop-forge', 'shop', { direction: 'pixel', vignetteId: 'forge' }, pixel],
  'caravan-pixel': ['caravan', 'shop', { direction: 'pixel', vignetteId: 'caravan' }, pixel],
  'rewards-pixel': ['rewards-mixed', 'rewards', {}, pixel],
  'reveal-0': ['rewards-mixed', 'rewards', { hidden: true, reveal: -1 }, pixel],
  'reveal-1': ['rewards-mixed', 'rewards', { hidden: true, reveal: 0 }, pixel],
  'reveal-2': ['rewards-mixed', 'rewards', { hidden: true, reveal: 2 }, pixel],
  'upgrades-pixel': ['upgrades', 'upgrades', {}, pixel],
  'upgrades-skills-pixel': ['upgrades-skills', 'upgrades', {}, pixel],
  'upgrade-bought': ['upgrades-economy', 'upgrades', { stamp: 'TIER I' }, pixel],
  'blessing-painted': ['blessing', 'blessing', { cards: CARDS }, pixel],
  'blessing-emblem': [
    'blessing',
    'blessing',
    { cards: CARDS.map((c) => ({ ...c, id: `x-${c.id}` })) },
    {
      ...pixel,
      art: Object.fromEntries(
        Object.entries(art).map(([k, v]) => [k.replace('emblem-', 'emblem-x-'), v]),
      ),
    },
  ],
  'church-pixel': ['church', 'church', { id: 'church' }, pixel],
  'ruins-pixel': [
    'ruins',
    'church',
    { id: 'ruins', title: 'Ruins', kicker: 'Sanctuary · Wares' },
    pixel,
  ],
  'arena-pixel': ['arena', 'arena', {}, pixel],
};

const VIEWPORTS = {
  phone: { w: 844, h: 390, mobile: true },
  desktop: { w: 1280, h: 800, mobile: false },
};
const launch = () =>
  chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--disable-dev-shm-usage'],
  });
let browser = await launch();
for (const [vp, cfg] of Object.entries(VIEWPORTS)) {
  if (which !== 'both' && which !== vp) continue;
  for (const [name, [screen, fn, opts, payload]] of Object.entries(MOCKS)) {
    if (only && !only.some((o) => name.startsWith(o))) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!browser.isConnected()) browser = await launch();
      let page;
      try {
        page = await newStudyPage(browser, { dpr: vp === 'phone' ? 3 : 1, ...cfg });
        await SCREENS[screen](page, base);
        await decorate(page, payload, fn, { ...opts, mobile: cfg.mobile });
        const file = path.join(OUT, `${name}-${cfg.w}x${cfg.h}.png`);
        await page.screenshot({ path: file });
        console.log('mock', name, vp, page.errors.length ? page.errors.slice(0, 2) : '');
        await page.context().close();
        break;
      } catch (e) {
        console.log('FAILED', name, vp, `attempt ${attempt + 1}`, e.message.split('\n')[0]);
        await page
          ?.context()
          .close()
          .catch(() => {});
      }
    }
  }
}
await browser.close();
