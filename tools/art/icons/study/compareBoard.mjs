// Side-by-side board: the same 24 items in the three icon directions at 24/32/48 px
// on a raised panel, plus Direction B's generated sources.
//   node tools/art/icons/study/compareBoard.mjs [--out dir]
import fs from 'node:fs';
import { sigilSvg } from '../lib/sigil.mjs';
import { SAMPLE } from './sample.mjs';
import { BOARD_CSS, renderBoard, fileUrl } from './board.mjs';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out')
  ? argv[argv.indexOf('--out') + 1]
  : 'References/items-study/boards';
const PIX = 'References/items-study/pixel';
const PAINT = 'References/items-study/painted';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const manifest = JSON.parse(fs.readFileSync(`${PIX}/manifest.json`, 'utf8'));
const ids = new Map();
for (const g of manifest.groups) for (const it of g.items) ids.set(it.name, it.id);
const pixId = (s) =>
  ({
    'Vampiric Stone': 'vampiric-imbuing-stone',
    'Forbidden Tome': 'forbidden-tome',
    'War Chest': 'war-chest',
    'Lord Might': 'lord-might',
  })[s.name] ||
  ids.get(s.name) ||
  slug(s.name);

const img = (src, px) =>
  src
    ? `<img class="px" src="${src}" width="${px}" height="${px}" alt="">`
    : `<span style="width:${px}px"></span>`;
const cellA = (s, px) => img(fileUrl(`${PIX}/${px}/${pixId(s)}.png`), px);
const cellB = (s, px) => {
  const f = `${PAINT}/${px}/${slug(s.name)}.png`;
  return fs.existsSync(f) ? img(fileUrl(f), px) : img(null, px);
};
const cellC = (s, px, i) =>
  sigilSvg(s.spec, { plaque: s.plaque, tier: s.tier, id: `c${px}${i}` }).replace(
    '<svg ',
    `<svg width="${px}" height="${px}" `,
  );

const DIRS = [
  ['A · Forged in code', 'procedural pixel icons, native per size', cellA],
  ['B · PC-98 painted', 'generated paintings, keyed + dithered to the art palette', cellB],
  ['C · Reliquary sigils', 'vector engravings on category plaques', cellC],
];
const block = DIRS.map(
  ([t, sub, cell]) => `<section><h2>${t}</h2><p class="kicker">${sub}</p>
  ${[24, 32, 48].map((px) => `<div class="strip" style="--px:${px}px"><b>${px}</b>${SAMPLE.map((s, i) => cell(s, px, i)).join('')}</div>`).join('')}</section>`,
).join('');
const srcs = SAMPLE.map((s) => {
  const f = `${PAINT}/src-${slug(s.name)}.png`;
  return fs.existsSync(f) ? `<img src="${fileUrl(f)}" width="64" height="64" alt="">` : '';
}).join('');
const html = `<!doctype html><style>${BOARD_CSS}
section { background: #17141f; padding: 6px 12px 10px; margin-bottom: 10px; }
.strip { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 6px; background: #201c29; padding: 4px 6px; }
.strip b { font: 8px 'Press Start 2P'; color: var(--muted); width: 26px; flex: none; }
.strip > img, .strip > svg, .strip > span { flex: none; }
.strip[style*="48"] > img, .strip[style*="48"] > svg { margin-right: 2px; }
.names { display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px 8px; font-size: 10px; color: var(--muted); margin: 6px 0 12px; }
.srcs { display: flex; flex-wrap: wrap; gap: 4px; }
</style><h1>Three icon directions · same 24 items</h1><p class="sub">Weapons (8 families incl. staff, tomes, scrolls), supplies, seals, boosters, accessories (incl. Gambler's Coin), whetstone, imbuing stone, a blessing and two upgrades. Order: ${SAMPLE.map((s) => s.name).join(' · ')}.</p>
${block}<h2>B · generated sources (before treatment)</h2><div class="srcs">${srcs}</div>`;
await renderBoard(html, `${OUT}/compare-abc.png`, { width: 1320, dpr: 2 });
console.log('ok');
