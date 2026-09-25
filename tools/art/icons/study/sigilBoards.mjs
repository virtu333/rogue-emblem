// Direction C boards: the 24-icon sample as reliquary sigils at 16/24/32/48 on real
// surfaces (inline SVG, as the runtime would draw them).
//   node tools/art/icons/study/sigilBoards.mjs [--out dir]
import fs from 'node:fs';
import { sigilSvg } from '../lib/sigil.mjs';
import { SAMPLE } from './sample.mjs';
import { BOARD_CSS, renderBoard } from './board.mjs';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out')
  ? argv[argv.indexOf('--out') + 1]
  : 'References/items-study/boards';
const SVG_OUT = 'References/items-study/sigil';
fs.mkdirSync(SVG_OUT, { recursive: true });
const svgs = SAMPLE.map((s, i) => {
  const svg = sigilSvg(s.spec, { plaque: s.plaque, tier: s.tier, id: `g${i}` });
  fs.writeFileSync(`${SVG_OUT}/${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`, svg);
  return svg;
});
const sized = (svg, px) => svg.replace('<svg ', `<svg width="${px}" height="${px}" `);
const surfaces = ['#0e0c14', '#17141f', '#201c29', '#3a2c24'];
const rows = [16, 24, 32, 48]
  .map(
    (px) =>
      `<div class="row"><div class="lab">${px}px</div>${surfaces
        .map(
          (c) =>
            `<div class="surf" style="background:${c}">${svgs
              .slice(0, px >= 48 ? 8 : px >= 32 ? 12 : 24)
              .map((s) => sized(s, px))
              .join('')}</div>`,
        )
        .join('')}</div>`,
  )
  .join('');
const big = SAMPLE.map(
  (s, i) =>
    `<figure>${sized(svgs[i], 64)}<figcaption>${s.name}<br><span>${s.cat}</span></figcaption></figure>`,
).join('');
const html = `<!doctype html><style>${BOARD_CSS}
.row { display: grid; grid-template-columns: 50px repeat(4, 1fr); gap: 6px; margin-bottom: 6px; }
.lab { font: 9px 'Press Start 2P'; color: var(--gold); align-self: center; }
.surf { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; align-content: center; }
.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; margin-top: 12px; }
figure { background: var(--raised); padding: 8px 4px; display: grid; justify-items: center; gap: 4px; }
figcaption { font-size: 10px; color: var(--muted); text-align: center; } figcaption span { color: #766b77; }
</style><h1>Reliquary sigils</h1><p class="sub">Direction C. Vector engravings on category plaques (weapon = heater, supply = roundel, accessory = lozenge, forge = octagon, blessing = sun disc, upgrade = pennant). Tier is the rim; one engraving metal plus a single accent colour. Crisp at any DPR, ~1–2 KB each as SVG.</p>${rows}<div class="grid">${big}</div>`;
await renderBoard(html, `${OUT}/sigil-sizes.png`, { width: 1280, dpr: 2 });
console.log('ok');
