// Direction A boards: full catalog at 32px, and the size ladder on real backgrounds.
//   node tools/art/icons/study/pixelBoards.mjs [--src References/items-study/pixel] [--out dir]
import fs from 'node:fs';
import { BOARD_CSS, renderBoard, fileUrl } from './board.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const SRC = arg('src', 'References/items-study/pixel');
const OUT = arg('out', 'References/items-study/boards');
const m = JSON.parse(fs.readFileSync(`${SRC}/manifest.json`, 'utf8'));
const icon = (size, id, css = size) =>
  `<img class="px" src="${fileUrl(`${SRC}/${size}/${id}.png`)}" width="${css}" height="${css}" alt="">`;

// 1. Catalog.
{
  const groups = m.groups
    .map(
      (g) =>
        `<h2>${g.label} · ${g.items.length}</h2><div class="grid">${g.items
          .map((it) => `<figure>${icon(32, it.id, 32)}<figcaption>${it.name}</figcaption></figure>`)
          .join('')}</div>`,
    )
    .join('');
  const html = `<!doctype html><style>${BOARD_CSS}
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 92px); gap: 6px; }
  figure { background: var(--raised); border: 1px solid #2e293a; padding: 8px 4px 6px; display: grid; justify-items: center; gap: 5px;
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
  figcaption { font-size: 10px; color: var(--muted); text-align: center; line-height: 1.15; min-height: 23px; }
  </style><h1>Forged in code — full catalog</h1>
  <p class="sub">Direction A. Every item, stone, blessing and upgrade the game can show (${m.groups.reduce((n, g) => n + g.items.length, 0)} icons), drawn by one grammar from data/*.json at 32px native. Silhouette = family · metal = tier · accent colour = what it does.</p>${groups}`;
  await renderBoard(html, `${OUT}/pixel-catalog.png`, { width: 1320, dpr: 1 });
}

// 2. Size ladder on real surfaces.
{
  const pick = [
    'iron-sword',
    'silver-sword',
    'ragnarok',
    'killer-lance',
    'hand-axe',
    'hammer',
    'longbow',
    'bolganone',
    'shine',
    'physic',
    'warp-staff',
    'fire-breath',
    'skill-scroll',
    'weapon-art-scroll',
    'vulnerary',
    'elixir',
    'master-seal',
    'energy-drop',
    'speedwing',
    'power-ring',
    'gambler-s-coin',
    'phoenix-brooch',
    'silver-whetstone',
    'vampiric-imbuing-stone',
  ];
  const surfaces = [
    ['#0e0c14', 'ink bg'],
    ['#17141f', 'panel'],
    ['#201c29', 'raised'],
    ['#3a2c24', 'selected'],
  ];
  const rows = [16, 24, 32, 48]
    .map(
      (s) =>
        `<div class="row"><div class="lab">${s}px</div>${surfaces
          .map(
            ([c]) =>
              `<div class="surf" style="background:${c}">${pick
                .slice(0, s >= 48 ? 8 : s >= 32 ? 12 : 24)
                .map((id) => icon(s, id))
                .join('')}</div>`,
          )
          .join('')}</div>`,
    )
    .join('');
  const html = `<!doctype html><style>${BOARD_CSS}
  .row { display: grid; grid-template-columns: 50px repeat(4, 1fr); gap: 6px; margin-bottom: 6px; align-items: stretch; }
  .lab { font: 9px 'Press Start 2P'; color: var(--gold); align-self: center; }
  .surf { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; align-content: center; }
  .heads { display: grid; grid-template-columns: 50px repeat(4, 1fr); gap: 6px; }
  </style><h1>Forged in code — display sizes</h1><p class="sub">Rendered natively per size (no resampling). Captured at DPR 2, i.e. as on a phone.</p>
  <div class="heads"><span></span>${surfaces.map(([, l]) => `<span class="kicker">${l}</span>`).join('')}</div>${rows}`;
  await renderBoard(html, `${OUT}/pixel-sizes.png`, { width: 1280, dpr: 2 });
}
console.log('boards written to', OUT);
