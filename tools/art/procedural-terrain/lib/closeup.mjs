// fit_closeup: proof that trees, columns, peaks and structures (mostly) fit
// their cells. Small layouts are rendered by the runtime renderer, resampled
// to phone scale (34 px per cell) with units standing on and next to the
// object cells, then shown 3x (nearest) with a faint cell grid. Reference
// columns (the study renderer, the previous runtime) come first when their
// renders exist; the rightmost column is the runtime.
import sharp from 'sharp';
import { existsSync } from 'fs';
import { renderBattlefieldTerrain } from '../../../../src/art/terrain/index.js';
import { layoutNames } from './sheet.mjs';
import {
  resultImage,
  resampleArea,
  upscaleNearest,
  readRgba,
  fillRectAlpha,
  saveImage,
} from './image.mjs';
import { drawUnits, playerSpritePath, PHONE_CELL } from './phone.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ZOOM = 3;
const enemy = (name) => join(ROOT, 'assets/sprites/enemies', `${name}.png`);

// [key, title, biome, layout, units [col,row,faction,spriteIndexOrName]]
export const CLOSEUPS = [
  [
    'forest',
    'Forest (grassland): units on, above, below and beside forest cells',
    'grassland',
    ['.......', '.FFF.F.', '.FFF...', '.......'],
    [
      [2, 1, 'player', 0],
      [2, 0, 'player', 1],
      [4, 2, 'enemy', 'fighter'],
      [5, 0, 'enemy', 'archer'],
      [2, 3, 'player', 3],
    ],
  ],
  [
    'pillars',
    'Pillars (castle): units on a column cell and directly above / below one',
    'castle',
    ['_______', '_I_I_I_', '_______', '_I_I___'],
    [
      [1, 0, 'player', 0],
      [3, 1, 'enemy', 'knight'],
      [1, 2, 'player', 2],
      [5, 2, 'enemy', 'mercenary'],
    ],
  ],
  [
    'mountains',
    'Mountains (grassland): a range and a lone peak, units above and on',
    'grassland',
    ['.......', '.MMM.M.', '..MM...', '.......'],
    [
      [2, 0, 'player', 0],
      [2, 1, 'player', 3],
      [5, 0, 'enemy', 'fighter'],
      [4, 2, 'enemy', 'archer'],
    ],
  ],
  [
    'structures',
    'Fort, village, ballista, throne: units above and on',
    'grassland',
    ['.......', '.f.V.B.', '.......', '.......'],
    [
      [1, 0, 'player', 0],
      [3, 1, 'player', 1],
      [5, 0, 'enemy', 'fighter'],
      [5, 2, 'enemy', 'archer'],
    ],
  ],
  [
    'pines',
    'Forest (tundra, pine + fir): units above and on',
    'tundra',
    ['.......', '.FFF.F.', '.FF....', '.......'],
    [
      [2, 0, 'player', 0],
      [1, 1, 'enemy', 'fighter'],
      [5, 2, 'enemy', 'archer'],
    ],
  ],
  [
    'woods',
    'Woods (grassland): a wood with an edge, a strip and lone cells, as the generator scatters them',
    'grassland',
    ['.........', '.FFFF..F.', '.FFFFF...', '..FF..F.F', '.........'],
    [
      [3, 2, 'player', 0],
      [5, 3, 'enemy', 'fighter'],
      [7, 0, 'enemy', 'archer'],
      [1, 4, 'player', 2],
    ],
  ],
  [
    'range',
    'Mountain range + lone peaks (grassland): ridges join neighbours, boulders face open ground',
    'grassland',
    ['.........', '.MMMM..M.', '.MMM.....', '..M...M.M', '.........'],
    [
      [2, 2, 'player', 3],
      [5, 2, 'enemy', 'fighter'],
      [6, 4, 'player', 0],
    ],
  ],
  [
    'marsh',
    'Swamp wood (willow + cypress) and a volcanic dead wood',
    'swamp',
    ['.........', '.FFF..FF.', '.FF.s.F..', '....ss...'],
    [
      [2, 2, 'player', 0],
      [6, 0, 'enemy', 'fighter'],
    ],
  ],
  [
    'ashwood',
    'Volcano: dead wood, peaks and a crater butte',
    'volcano',
    ['.........', '.FFF.MM..', '.FF..MMM.', '.....M...'],
    [
      [2, 0, 'player', 0],
      [4, 2, 'enemy', 'fighter'],
    ],
  ],
  [
    'throne',
    'Throne room (castle): throne cell with a boss on it',
    'castle',
    ['#######', '#__T__#', '#I___I#', '_______'],
    [
      [3, 1, 'enemy', 'general'],
      [3, 2, 'player', 0],
    ],
  ],
];

function unitsOf(list) {
  return list.map(([col, row, faction, s]) => ({
    col,
    row,
    faction,
    sprite:
      faction === 'player' ? playerSpritePath(s) : enemy(existsSync(enemy(s)) ? s : 'fighter'),
  }));
}

async function stage(rgba48, cols, rows, units) {
  const W = cols * PHONE_CELL,
    H = rows * PHONE_CELL;
  const img = { data: resampleArea(rgba48, cols * 48, rows * 48, W, H), w: W, h: H };
  // faint cell grid, like the game's grid overlay
  for (let c = 1; c < cols; c++)
    fillRectAlpha(img.data, W, H, c * PHONE_CELL - 0.5, 0, 1, H, [0xf4, 0xec, 0xdb], 0.22);
  for (let r = 1; r < rows; r++)
    fillRectAlpha(img.data, W, H, 0, r * PHONE_CELL - 0.5, W, 1, [0xf4, 0xec, 0xdb], 0.22);
  await drawUnits(img, [0, 0], units);
  return { data: upscaleNearest(img.data, W, H, ZOOM), w: W * ZOOM, h: H * ZOOM };
}

async function label(width, text, size = 14, fill = '#ddd0bd') {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="26"><text x="2" y="18" font-family="DejaVu Sans Mono, monospace" font-size="${size}" fill="${fill}">${esc}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const png = (img) =>
  sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .png()
    .toBuffer();

/** First existing `closeup_<key>.(png|webp)` in dir, or null. */
function refPath(dir, key) {
  for (const ext of ['png', 'webp']) {
    const p = join(dir, `closeup_${key}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * @param path  output file (.png or .webp)
 * @param refs  reference columns shown left of the runtime, each
 *   { dir, label }: a folder of `closeup_<key>.png|webp` renders at 48px/cell
 *   (e.g. the study renderer, the previous runtime). A missing render leaves
 *   its slot empty.
 */
export async function buildCloseup(path, refs = [], seed = 777) {
  if (typeof refs === 'string') refs = [{ dir: refs, label: 'study renderer (before)' }];
  refs = refs.filter((r) => r && r.dir && existsSync(r.dir));
  const comps = [];
  const pad = 14;
  let y = pad,
    maxW = 0;
  const columns = [...refs.map((r) => r.label), 'runtime src/art/terrain (now)'].join('  |  ');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="44"><text x="0" y="20" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#f4ecdb">Objects mostly fit their cells - phone scale (34 px per cell) shown ${ZOOM}x, faint cell grid</text><text x="0" y="40" font-family="DejaVu Sans Mono, monospace" font-size="13" fill="#978b94">${columns}</text></svg>`;
  comps.push({ input: await sharp(Buffer.from(head)).png().toBuffer(), left: pad, top: y });
  y += 54;
  for (const [key, title, biome, layout, list] of CLOSEUPS) {
    const fallback = biome === 'castle' || biome === 'void' ? 'Floor' : 'Plain';
    const names = layoutNames(layout, 'Plain', fallback);
    const cols = names[0].length,
      rows = names.length;
    const after = resultImage(renderBattlefieldTerrain({ names, biome, seed }));
    const units = unitsOf(list);
    const now = await stage(after.data, cols, rows, units);
    comps.push({ input: await label(1600, title), left: pad, top: y });
    y += 28;
    let x = pad;
    for (const ref of refs) {
      const p = refPath(ref.dir, key);
      if (p) {
        const b = await readRgba(p);
        if (b.w === cols * 48 && b.h === rows * 48)
          comps.push({ input: await png(await stage(b.data, cols, rows, units)), left: x, top: y });
      } else {
        comps.push({
          input: await label(now.w, `(no ${ref.label} render)`, 13, '#58505e'),
          left: x,
          top: y + now.h / 2 - 13,
        });
      }
      x += now.w + pad;
    }
    comps.push({ input: await png(now), left: x, top: y });
    maxW = Math.max(maxW, x + now.w + pad);
    y += now.h + pad;
  }
  await saveImage(
    sharp({
      create: {
        width: Math.max(maxW, 1600 + 2 * pad),
        height: y,
        channels: 4,
        background: '#0e0c14',
      },
    }).composite(comps),
    path,
  );
}
