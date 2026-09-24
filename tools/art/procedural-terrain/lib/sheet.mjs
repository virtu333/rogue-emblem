// terrain_sheet.png: every terrain type (x3 variants in context, plus an
// isolated instance) and the key transitions, rendered through the exact same
// renderer as the maps. Displayed at 2x (each art pixel = 4x4 screen px).
import sharp from 'sharp';
import { renderTerrain } from './render.mjs';
import { indexToRgba, upscaleNearest } from './image.mjs';

const SHOW = 2; // display zoom on top of the 48px/cell texture

const CODE = {
  '.': null, // biome default ground
  P: 'Plain',
  F: 'Forest',
  M: 'Mountain',
  f: 'Fort',
  T: 'Throne',
  '#': 'Wall',
  '~': 'Water',
  '=': 'Bridge',
  ':': 'Sand',
  V: 'Village',
  i: 'Ice',
  L: 'Lava Crack',
  _: 'Floor',
  I: 'Pillar',
  B: 'Ballista',
  s: 'Swamp',
  b: 'Bog',
  A: 'Acidic Swamp',
  a: 'Acidic Bog',
};

function layoutNames(rows, fill) {
  return rows.map((row) => [...row].map((ch) => (ch === 'X' ? fill : CODE[ch] ?? 'Plain')));
}

const SURFACE = ['.XXX...', 'XXXXX.X', '.XXX...'];
const OBJECTS = ['.......', '.X.X.X.', '.......'];

// [title, terrain, biome, layout]
const PANELS = [
  ['Plain (grassland)', 'Plain', 'grassland', ['.XXXX..', 'XXXXXXX', '.XXX...']],
  ['Forest (grassland)', 'Forest', 'grassland', SURFACE],
  ['Mountain (grassland)', 'Mountain', 'grassland', SURFACE],
  ['Fort', 'Fort', 'grassland', OBJECTS],
  ['Throne (castle / field)', 'Throne', 'castle', ['.......', '.X...X.', '.......']],
  ['Wall (castle)', 'Wall', 'castle', ['XXX.X..', 'XXX.X.X', '.......']],
  ['Water', 'Water', 'grassland', SURFACE],
  ['Bridge', 'Bridge', 'grassland', ['.~~~.~.', '.XXX.X.', '.~~~.~.']],
  ['Sand', 'Sand', 'grassland', SURFACE],
  ['Village', 'Village', 'grassland', OBJECTS],
  ['Ice (tundra)', 'Ice', 'tundra', SURFACE],
  ['Lava Crack (volcano)', 'Lava Crack', 'volcano', SURFACE],
  ['Floor (on grass)', 'Floor', 'grassland', SURFACE],
  ['Pillar (castle)', 'Pillar', 'castle', OBJECTS],
  ['Ballista', 'Ballista', 'grassland', OBJECTS],
  ['Swamp', 'Swamp', 'swamp', SURFACE],
  ['Bog', 'Bog', 'swamp', SURFACE],
  ['Acidic Swamp', 'Acidic Swamp', 'swamp', SURFACE],
  ['Acidic Bog', 'Acidic Bog', 'swamp', SURFACE],
  // biome variants of the shared terrains
  ['Plain + Forest (tundra)', 'Forest', 'tundra', ['.XX....', 'XXX..X.', '.......']],
  ['Mountain (tundra)', 'Mountain', 'tundra', SURFACE],
  ['Plain + Mountain (volcano)', 'Mountain', 'volcano', ['.XX....', 'XXX..X.', '.......']],
  ['Plain + Forest (swamp)', 'Forest', 'swamp', ['.XX....', 'XXX..X.', '.......']],
  ['Wall + Pillar (void)', 'Wall', 'void', ['XXX....', 'XXX.I.I', '.......']],
  ['Fort + Pillar (castle)', 'Fort', 'castle', ['.......', '.X.I.X.', '.......']],
];

const TRANSITIONS = [
  ['Shoreline autotile: convex/concave corners, island, bank face + foam', 'grassland', ['..........', '..~~~~~...', '.~~~~~~~..', '.~~~..~~~.', '..~~~~~~..', '....~~....']],
  ['River bend, bridges both ways, sand bank', 'grassland', ['...~~.....', '...~~.....', '.:.==.FF..', '::.~~~~=~~', '...~~~~=~~', '.FF.....F.']],
  ['Castle room: wall faces, parapets, contact shadows, pillars, throne', 'castle', ['##########', '#________#', '#_I__T_I_#', '#________#', '####__####', '__I_____f_']],
  ['Forest canopy cluster + mountain range + village', 'grassland', ['..FFF..MM.', '.FFFFF.MMM', '.FFF...MM.', '..F..V....', '......f...', '::....FF..']],
  ['Swamp / bog / acid blending', 'swamp', ['..ssss....', '.sssAss.bb', '.ssAAsbbab', '..sss.bbb.', '.F....b...', 'FF........']],
  ['Lava field edge on ash (emissive spill)', 'volcano', ['...LLL..M.', '..LLLLL.MM', '.LLL.LLL..', '..LLLLL...', '...LL..f..', '.M........']],
  ['Ice sheet on snow, pines, fort', 'tundra', ['..iii.....', '.iiiii.FF.', '.ii.iii.FF', '..iiii....', '....f..M..', '.FF.......']],
];

function renderLayout(names, biome, seed) {
  const r = renderTerrain(names, { biome, seed });
  const rgba = upscaleNearest(indexToRgba(r.idx, r.w, r.h), r.w, r.h, 2 * SHOW);
  return { data: rgba, w: r.w * 2 * SHOW, h: r.h * 2 * SHOW };
}

async function label(width, text, size = 13) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24"><text x="2" y="17" font-family="DejaVu Sans Mono, monospace" font-size="${size}" fill="#ddd0bd">${esc}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function buildSheet(path, seed = 4242) {
  const comps = [];
  const pad = 12,
    lab = 24;
  let y = pad;
  const header = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="46"><text x="0" y="20" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#f4ecdb">Procedural terrain sheet - 24 art px per cell, shown at 48px/cell x${SHOW}</text><text x="0" y="40" font-family="DejaVu Sans Mono, monospace" font-size="13" fill="#978b94">Each panel: three variants in context (middle row, cols 2-4) + an isolated instance. Light: low sun from upper-left.</text></svg>`;
  comps.push({ input: await sharp(Buffer.from(header)).png().toBuffer(), left: pad, top: y });
  y += 56;
  const perRow = 3;
  let col = 0,
    rowH = 0,
    maxW = 0;
  for (const [k, [title, terrain, biome, layout]] of PANELS.entries()) {
    const img = renderLayout(layoutNames(layout, terrain), biome, seed + k * 17);
    const x = pad + col * (img.w + pad);
    comps.push({ input: await label(img.w, title), left: x, top: y });
    comps.push({ input: await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer(), left: x, top: y + lab });
    rowH = Math.max(rowH, img.h + lab);
    maxW = Math.max(maxW, x + img.w + pad);
    if (++col === perRow) {
      col = 0;
      y += rowH + pad;
      rowH = 0;
    }
  }
  if (col) y += rowH + pad;
  const sub = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="30"><text x="0" y="22" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#f4ecdb">Key transitions</text></svg>`;
  comps.push({ input: await sharp(Buffer.from(sub)).png().toBuffer(), left: pad, top: y });
  y += 36;
  col = 0;
  rowH = 0;
  for (const [k, [title, biome, layout]] of TRANSITIONS.entries()) {
    const img = renderLayout(layoutNames(layout, 'Plain'), biome, seed + 900 + k * 31);
    const x = pad + col * (img.w + pad);
    comps.push({ input: await label(img.w, title, 12), left: x, top: y });
    comps.push({ input: await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer(), left: x, top: y + lab });
    rowH = Math.max(rowH, img.h + lab);
    maxW = Math.max(maxW, x + img.w + pad);
    if (++col === 2) {
      col = 0;
      y += rowH + pad;
      rowH = 0;
    }
  }
  if (col) y += rowH + pad;
  await sharp({ create: { width: maxW, height: y, channels: 4, background: '#0e0c14' } })
    .composite(comps)
    .png({ compressionLevel: 9 })
    .toFile(path);
}
