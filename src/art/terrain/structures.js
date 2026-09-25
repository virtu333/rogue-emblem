// Landmark structures: hand-authored pixel masks (one character per art
// pixel) shaded procedurally from the Ink & Ember ramps, varied per cell
// (roof material, lit window, broken column, clutter side). Every mask fits
// inside its 24 x 24 cell; only a column capital may rise PILLAR_CAP px above.
import { R } from './palette.js';
import { rand2, hash2 } from './noise.js';
import { Sprite } from './sprite.js';
import { ART_CELL as CELL } from './state.js';

export const PILLAR_CAP = 1;

function drawMask(s, ox, oy, rows, colorAt) {
  for (let v = 0; v < rows.length; v++) {
    const row = rows[v];
    for (let u = 0; u < row.length; u++) {
      const ch = row[u];
      if (ch === '.' || ch === ' ') continue;
      const col = colorAt(ch, u, v);
      if (col != null) s.set(ox + u, oy + v, col);
    }
  }
}

function stoneFor(S) {
  if (S.biome === 'void') return (k) => R('ink', [1, 2, 3, 4, 5, 6][Math.max(0, Math.min(5, k))]);
  if (S.biome === 'volcano')
    return (k) => [R('ash', 1), R('ash', 2), R('ash', 3), R('ash', 5), R('ash', 6), R('ash', 7)][k];
  return (k) => R('stone', Math.max(0, Math.min(5, k)));
}

// ------------------------------------------------------------------ fort
// Two flanking towers, a crenellated curtain wall, an arched gate and a
// banner on the gatehouse - all inside the cell (the study's banner poked
// six pixels into the cell above).
const FORT = [
  '............pff.........',
  '............pfff........',
  '............pFF.........',
  '............p...........',
  '.m.m.m......p.....m.m.m.',
  '.tttttt..mmmpmm..tttttt.',
  '.tbbbbb..ttttttt.bbbbbt.',
  '.bbbbbb..bbbbbbb.bbbbbb.',
  '.bbwwbbccbbbbbbbccbbwwbb',
  '.bbwwbbccbbbbbbbccbbwwbb',
  '.bbbbbbccbbbbbbbccbbbbbb',
  '.bbbbbbccbbAAAbbccbbbbbb',
  '.bbbbbbccbAgggAbccbbbbbb',
  '.bbbbbbccbAgggAbccbbbbbb',
  '.bbbbbbccbAgggAbccbbbbbb',
  '.bbbbbbccbAgggAbccbbbbbb',
  '.bbbbbbccbAgggAbccbbbbbb',
  '.zzzzzzzzzzzzzzzzzzzzzzz',
];

function fort(S, c, r) {
  const ox = c * CELL,
    oy = r * CELL + 4;
  const s = new Sprite(c, r, 'structure', oy + FORT.length - 1, { a: 0.5, b: 0.25 });
  const St = stoneFor(S);
  const lit = rand2(c, r, S.seed + 510) < 0.7;
  drawMask(s, ox, oy, FORT, (ch, u, v) => {
    const tower = u <= 7 || u >= 17;
    const tu = u <= 7 ? u - 1 : u - 17; // 0..5 inside a tower
    switch (ch) {
      case 'p':
        return R('soil', 2);
      case 'f':
        return v === 0 && u === 13 ? R('ember', 5) : R('ember', 4);
      case 'F':
        return R('ember', 2);
      case 'm':
        return St(5);
      case 't':
        return St(4);
      case 'c': {
        // curtain wall between the towers (a notch deeper than the towers)
        const course = Math.floor(v / 2);
        return (v + u) % 5 === 0 || (u + course) % 4 === 0 ? St(2) : St(3);
      }
      case 'b': {
        if (tower) {
          if (tu === 0) return St(5);
          if (tu >= 5) return St(2);
          const course = Math.floor(v / 3);
          if (v % 3 === 0 && (tu + course) % 2 === 0) return St(3);
          return tu >= 4 ? St(3) : St(4);
        }
        // gatehouse front
        if (u === 9) return St(5);
        if (u === 15) return St(2);
        const course = Math.floor(v / 3);
        if (v % 3 === 1 && (u + course) % 3 === 0) return St(3);
        return u >= 13 ? St(3) : St(4);
      }
      case 'w':
        return lit && u % 2 === 1 && v === 9 ? R('ember', 4) : R('ink', 2);
      case 'A':
        return v === 11 ? St(5) : u < 12 ? St(4) : St(2);
      case 'g':
        return u === 11 ? R('ink', 1) : (v + u) % 2 ? R('soil', 2) : R('soil', 3);
      case 'z':
        return R('ink', 3);
    }
    return null;
  });
  s.outline({ dark: R('ink', 2) });
  return s;
}

// --------------------------------------------------------------- village
// A 3/4-view cottage: shingled hip roof with a chimney, timber-framed
// plaster walls, a door and a warm window with a flower box.
const HOUSE = [
  '...............SS.......',
  '...............Ss.......',
  '.....KKKKKKKKKKSsKK.....',
  '....RRRRRRRRRRRRRRRR....',
  '...RRRRRRRRRRRRRRRRRR...',
  '..RRRRRRRRRRRRRRRRRRRR..',
  '.RRRRRRRRRRRRRRRRRRRRRR.',
  'RRRRRRRRRRRRRRRRRRRRRRRR',
  '.EEEEEEEEEEEEEEEEEEEEEE.',
  '.TWWWWWWTWWWWWWWWWWWWWT.',
  '.TWDDDDWTWWFFFFFFWWWWWT.',
  '.TWDDDDWTWWFGGGGFWWWWWT.',
  '.TTDDDDTTTTFgggGFTTTTTT.',
  '.TWDDdDWTWWFFFFFFWWWWWT.',
  '.TWDDDDWTWWPPPPPPWWWWWT.',
  '.TWDDDDWTWWWWWWWWWWWWWT.',
  '.BBDDDDBBBBBBBBBBBBBBBB.',
];

function village(S, c, r) {
  const ox = c * CELL,
    oy = r * CELL + 5;
  const s = new Sprite(c, r, 'structure', oy + HOUSE.length - 1, { a: 0.5, b: 0.25 });
  const roll = rand2(c, r, S.seed + 520);
  // roof material: terracotta, thatch or slate
  const roof =
    S.biome === 'tundra'
      ? [R('snow', 3), R('snow', 5), R('snow', 6), R('snow', 7)]
      : roll < 0.5
        ? [R('ember', 1), R('ember', 2), R('ember', 3), R('ember', 4)]
        : roll < 0.82
          ? [R('earth', 2), R('earth', 3), R('earth', 4), R('earth', 5)]
          : [R('stone', 1), R('stone', 2), R('stone', 3), R('stone', 4)];
  const lit = rand2(c, r, S.seed + 521) < 0.8;
  const flip = rand2(c, r, S.seed + 522) < 0.5;
  const rows = flip
    ? HOUSE.map((row) => [...row].reverse().join('')).map(
        (row) =>
          // keep the door on the left edge of the wall when mirrored: only
          // mirror the roof / chimney rows
          row,
      )
    : HOUSE;
  drawMask(s, ox, oy, rows, (ch, u, v) => {
    const row = rows[v];
    switch (ch) {
      case 'K':
        return roof[3];
      case 'R': {
        const first = row.indexOf('R'),
          last = row.lastIndexOf('R');
        if (u - first < 2) return roof[2]; // lit hip end
        if (last - u < 2) return roof[0]; // shaded hip end
        if (v % 2 === 0) return roof[0]; // shingle course line
        return (u + (v % 4 === 1 ? 0 : 2)) % 4 === 0 ? roof[0] : u < 12 ? roof[2] : roof[1];
      }
      case 'E':
        return R('ink', 3);
      case 'W':
        return v === 9 ? R('ink', 8) : u < 12 ? R('ink', 10) : R('ink', 9);
      case 'T':
        return R('soil', 2);
      case 'D':
        return u === 3 ? R('soil', 4) : R('soil', 3);
      case 'd':
        return R('ember', 4);
      case 'F':
        return R('soil', 1);
      case 'G':
        return lit ? R('ember', 5) : R('tide', 3);
      case 'g':
        return lit ? R('ember', 4) : R('tide', 2);
      case 'P':
        return (u + v) % 2 ? R('blood', 4) : R('foliage', 6);
      case 'S':
        return v === 0 ? R('stone', 5) : R('stone', 4);
      case 's':
        return R('stone', 2);
      case 'B':
        return u % 3 === 0 ? R('stone', 2) : R('stone', 3);
    }
    return null;
  });
  // clutter: a barrel on one side of the door
  const bx = ox + (hash2(c, r, S.seed + 523) % 2 ? 0 : 21);
  const by = oy + HOUSE.length - 4;
  if (bx === ox + 21)
    for (let v = 0; v < 4; v++)
      for (let u = 0; u < 3; u++)
        s.set(bx + u, by + v, v === 1 ? R('soil', 1) : u === 0 ? R('soil', 6) : R('soil', 4));
  s.outline({ dark: R('ink', 2) });
  return s;
}

// ---------------------------------------------------------------- throne
// A gilt high-backed chair (the Hollow Sun set in its velvet back) on a
// low two-step dais with a carpet running down to the cell edge.
const THRONE = [
  '.......GG.......',
  '......GggG......',
  '.....GgrrgG.....',
  '....GgrRRrgG....',
  '....GrRRRRrG....',
  '....GrRoooRG....',
  '....GrRokoRG....',
  '....GrRoooRG....',
  '....GrRRRRrG....',
  '....GrRRRRrG....',
  '..AAGrRRRRrGAA..',
  '..AagssssssgaA..',
  '..AaGSSSSSSGaA..',
  '..ll.l....l.ll..',
];

function throne(S, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(c, r, 'structure', oy + 22, { a: 0.35, b: 0.18 });
  const St = stoneFor(S);
  // dais: top plate, lip, two steps
  for (let y = 14; y < 23; y++)
    for (let x = 2; x < 22; x++) {
      let col;
      if (y < 17) col = y === 14 ? St(5) : x === 2 ? St(5) : x === 21 ? St(2) : St(4);
      else if (y === 17) col = St(2);
      else if (y < 20) col = y === 18 ? St(4) : x < 4 ? St(4) : St(3);
      else col = y === 20 ? St(3) : y === 22 ? St(1) : St(2);
      if (y >= 18 && (x === 2 || x === 21)) continue; // steps are narrower
      s.set(ox + x, oy + y, col);
    }
  // carpet from the chair down the steps to the cell edge, gold-trimmed
  for (let y = 15; y < 24; y++)
    for (let x = 9; x < 15; x++)
      s.set(
        ox + x,
        oy + y,
        x === 9 || x === 14
          ? R('ember', 3)
          : y === 17 || y === 20
            ? R('blood', 1)
            : x < 12
              ? R('blood', 3)
              : R('blood', 2),
      );
  drawMask(s, ox + 4, oy, THRONE, (ch, u) => {
    const left = u < 8;
    switch (ch) {
      case 'G':
        return left ? R('ember', 4) : R('ember', 3);
      case 'g':
        return R('ember', 5);
      case 'r':
        return left ? R('blood', 4) : R('blood', 3);
      case 'R':
        return left ? R('blood', 3) : R('blood', 2);
      case 'o':
        return R('ember', 5);
      case 'k':
        return R('ink', 1);
      case 's':
        return R('blood', 4);
      case 'S':
        return R('blood', 2);
      case 'A':
        return left ? R('ember', 3) : R('soil', 4);
      case 'a':
        return R('soil', 2);
      case 'l':
        return R('soil', 1);
    }
    return null;
  });
  s.outline({ dark: R('ink', 2) });
  return s;
}

// -------------------------------------------------------------- ballista
// A siege crossbow on a wheeled carriage, bolt aimed up-field.
const BALLISTA = [
  '..........HH..........',
  '.........HhhH.........',
  '.........bbbb.........',
  'LL.......bbbb.......LL',
  'LLAA.....bbbb.....AALL',
  '.aAAAA...bbbb...AAAAa.',
  '..aaAAAA.bbbb.AAAAaa..',
  '....aaAAAXXXXAAAaa....',
  '......ssAXXXXAss......',
  '........ssXXss........',
  '...PPPPPPPXXPPPPPPP...',
  '..pPPPPPPPXXPPPPPPPp..',
  '..OoO.....XX.....OoO..',
  '.OoooO...QXXQ...OoooO.',
  '..OoO...QqqqqQ...OoO..',
];

function ballista(S, c, r) {
  const ox = c * CELL + 1,
    oy = r * CELL + 6;
  const s = new Sprite(c, r, 'structure', oy + BALLISTA.length - 1, { a: 0.45, b: 0.22 });
  drawMask(s, ox, oy, BALLISTA, (ch, u, v) => {
    switch (ch) {
      case 'H':
        return R('steel', 5);
      case 'h':
        return R('steel', 3);
      case 'b':
        return u === 9 ? R('soil', 7) : u === 12 ? R('soil', 3) : R('soil', 5);
      case 'L':
        return R('stone', 5);
      case 'A':
        return v < 5 ? R('soil', 6) : R('soil', 5);
      case 'a':
        return R('soil', 2);
      case 'X':
        return u <= 10 ? R('stone', 4) : R('stone', 2);
      case 's':
        return R('ink', 9);
      case 'P':
        return v === 10 ? R('soil', 6) : R('soil', 4);
      case 'p':
        return R('soil', 2);
      case 'O':
        return R('soil', 2);
      case 'o':
        return u % 2 ? R('soil', 5) : R('stone', 3);
      case 'Q':
        return R('soil', 3);
      case 'q':
        return R('soil', 1);
    }
    return null;
  });
  s.outline({ dark: R('ink', 2) });
  return s;
}

// ---------------------------------------------------------------- pillar
// Columns stay inside their cell (only the capital may rise PILLAR_CAP px
// above it) but vary: intact, cracked, broken off or a bare stump with its
// fallen drum beside it; fluted or plain; square or stepped plinth; ivy and
// moss in green biomes, snow in the tundra, soot and embers in the volcano.
function pillar(S, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const h = (k) => rand2(c * 7 + k, r * 3 - k, S.seed + 500);
  const s = new Sprite(c, r, 'pillar', oy + 22, { a: 0.55, b: 0.3 });
  const St = stoneFor(S);
  const roll = h(0);
  const state = roll < 0.5 ? 'intact' : roll < 0.7 ? 'cracked' : roll < 0.89 ? 'broken' : 'stump';
  const snapped = state === 'broken' || state === 'stump';
  const fluted = h(1) < 0.7;
  const stepped = h(2) < 0.35;
  const sx = 8 + (h(3) < 0.25 ? (h(4) < 0.5 ? -1 : 1) : 0); // shaft's left column
  // cylinder shading across the 8-px shaft: rim, highlight, body, core shadow
  const shaft = [St(3), St(5), St(5), St(4), St(4), St(3), St(2), St(1)];
  const top =
    state === 'broken'
      ? 4 + (hash2(c, r, S.seed) % 5)
      : state === 'stump'
        ? 11 + (hash2(c, r, S.seed) % 3)
        : 3;
  const green = S.biome === 'grassland' || S.biome === 'swamp' || S.biome === 'castle';

  // plinth (square, or stepped with a lower course)
  const px0 = sx - 3,
    px1 = sx + 11;
  for (let y = 19; y < 23; y++)
    for (let x = px0; x < px1; x++) {
      if (!stepped && y === 22 && (x === px0 || x === px1 - 1) && h(5) < 0.5) continue; // chipped
      const col =
        y === 19
          ? x < sx + 4
            ? St(5)
            : St(4)
          : y === 22
            ? St(1)
            : x < px0 + 2
              ? St(4)
              : x > px1 - 3
                ? St(2)
                : St(3);
      s.set(ox + x, oy + y, col);
    }
  if (stepped)
    for (let x = px0 - 1; x <= px1; x++) {
      s.set(ox + x, oy + 22, x < sx + 2 ? St(4) : St(2));
      s.set(ox + x, oy + 23, St(1));
    }
  // shaft with fluting and drum joints
  const joint = 5 + (hash2(c, r, S.seed + 501) % 3);
  const slant = h(12) < 0.5;
  for (let y = top; y < 19; y++)
    for (let u = 0; u < 8; u++) {
      // a slanted, ragged fracture (not a crenellation)
      if (
        snapped &&
        y <
          top +
            Math.min(3, Math.round((slant ? u : 7 - u) * 0.4) + (hash2(u, c + r, S.seed + 505) % 2))
      )
        continue;
      let col = shaft[u];
      if (fluted && (u === 3 || u === 5) && y > top + 1) col = shaft[u + 1];
      if ((y - top) % joint === joint - 1) col = St(Math.max(1, [3, 4, 4, 3, 3, 2, 1, 1][u] - 1));
      s.set(ox + sx + u, oy + y, col);
    }
  if (snapped) {
    // broken face: the lit top of the stone and a darker fracture
    for (let u = 0; u < 8; u++)
      for (let y = top; y < top + 5; y++)
        if (s.has(ox + sx + u, oy + y)) {
          s.set(ox + sx + u, oy + y, u < 4 ? St(5) : St(4));
          break;
        }
  } else {
    // capital: abacus slab + echinus, one pixel of cap above the cell at most
    const chip = state === 'cracked' ? (h(6) < 0.5 ? sx - 2 : sx + 9) : -99;
    for (let x = sx - 2; x < sx + 10; x++) {
      if (Math.abs(x - chip) < 2) continue;
      s.set(ox + x, oy - PILLAR_CAP + 1, x < sx + 4 ? St(5) : St(4));
      s.set(ox + x, oy + 1, x < sx ? St(4) : x > sx + 7 ? St(1) : St(3));
    }
    for (let x = sx - 1; x < sx + 9; x++)
      s.set(ox + x, oy + 2, x < sx + 2 ? St(4) : x > sx + 6 ? St(2) : St(3));
    if (S.biome === 'tundra')
      for (let x = sx - 2; x < sx + 9; x++)
        if (Math.abs(x - chip) >= 2) s.set(ox + x, oy, R('snow', 7));
  }
  if (state === 'cracked') {
    // a hairline crack running down the shaft
    let u = 2 + (hash2(c, r, S.seed + 502) % 4);
    for (let y = 5 + (hash2(r, c, S.seed) % 4); y < 17; y++) {
      if (hash2(u, y, S.seed + 503) % 3 === 0) u += hash2(y, u, S.seed) % 2 ? 1 : -1;
      if (u < 0 || u > 7) break;
      s.set(ox + sx + u, oy + y, S.biome === 'volcano' && y % 4 === 0 ? R('ember', 3) : St(1));
    }
  }
  if (snapped) {
    // the fallen drum lies beside the column, with rubble
    const left = h(7) < 0.5;
    const dx = left ? 0 : CELL - 7;
    if (state === 'stump' || h(8) < 0.6)
      for (let v = 0; v < 4; v++)
        for (let u = 0; u < 7; u++) {
          const corner = (v === 0 || v === 3) && (u === 0 || u === 6);
          if (corner) continue;
          const col =
            u === (left ? 0 : 6)
              ? St(4)
              : v === 0
                ? St(5)
                : v === 3
                  ? St(1)
                  : v === 1
                    ? St(4)
                    : St(3);
          s.set(ox + dx + u, oy + 19 + v, col);
        }
    for (const [ux, uy, k] of [
      [left ? 20 : 2, 21, 3],
      [left ? 21 : 3, 21, 2],
      [left ? 20 : 3, 20, 4],
      [left ? 17 : 5, 22, 2],
    ])
      s.set(ox + ux, oy + uy, St(k));
  }
  if (snapped && S.biome === 'tundra')
    for (let u = 1; u < 7; u++)
      if (s.has(ox + sx + u, oy + top + 1)) s.set(ox + sx + u, oy + top + 1, R('snow', 7));
  if (green) {
    // moss on the plinth, and on some columns ivy climbing the lit side
    s.set(ox + sx - 1, oy + 18, R('foliage', 5));
    s.set(ox + sx - 2, oy + 18, R('foliage', 4));
    if (h(9) < 0.45) {
      let u = h(10) < 0.5 ? 0 : 1;
      const reach = top + 2 + Math.floor(h(11) * (18 - top - 4));
      for (let y = 18; y > reach; y--) {
        s.set(ox + sx + u, oy + y, (y + c) % 3 ? R('foliage', 4) : R('foliage', 6));
        if ((y + r) % 3 === 0) s.set(ox + sx + u + 1, oy + y, R('foliage', 5));
        if (hash2(y, c, S.seed + 504) % 4 === 0) u = Math.min(2, u + 1);
      }
    }
  } else if (S.biome === 'volcano') {
    // soot creeping up from the base
    for (let u = 0; u < 8; u++)
      for (let y = 15 + (hash2(u, c, S.seed) % 3); y < 19; y++)
        if (s.has(ox + sx + u, oy + y)) s.set(ox + sx + u, oy + y, R('ash', u < 3 ? 3 : 2));
  }
  s.outline({ dark: R('ink', 2) });
  return s;
}

export function structureSprite(S, c, r, name) {
  let s = null;
  if (name === 'Fort') s = fort(S, c, r);
  else if (name === 'Village') s = village(S, c, r);
  else if (name === 'Throne') s = throne(S, c, r);
  else if (name === 'Ballista') s = ballista(S, c, r);
  else if (name === 'Pillar') s = pillar(S, c, r);
  if (!s) return null;
  const ox = c * CELL,
    oy = r * CELL;
  s.clipTo(ox, oy - (s.kind === 'pillar' ? PILLAR_CAP : 0), ox + CELL, oy + CELL);
  return s;
}
