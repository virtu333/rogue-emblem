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
const THRONE = [
  '.......GG.......',
  '......gGGg......',
  '.....gCCCCg.....',
  '....gCccccCg....',
  '....gCccccCg....',
  '....gCccccCg....',
  '....gCccccCg....',
  '....gCccccCg....',
  '..AAgCCCCCCgAA..',
  '..AaasssssssaA..',
  '..ll........ll..',
];

function throne(S, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(c, r, 'structure', oy + 22, { a: 0.35, b: 0.18 });
  const St = stoneFor(S);
  // dais: top plate, lip, two steps
  for (let y = 9; y < 23; y++)
    for (let x = 1; x < 23; x++) {
      let col;
      if (y < 17) col = y === 9 ? St(5) : x === 1 ? St(5) : x === 22 ? St(2) : St(4);
      else if (y === 17) col = St(5);
      else if (y < 20) col = x < 3 ? St(4) : St(3);
      else if (y === 20) col = St(4);
      else col = y === 22 ? St(1) : St(2);
      s.set(ox + x, oy + y, col);
    }
  // carpet from the chair to the cell edge, gold-trimmed
  for (let y = 16; y < 23; y++)
    for (let x = 9; x < 15; x++)
      s.set(
        ox + x,
        oy + y,
        x === 9 || x === 14
          ? R('ember', 3)
          : y === 18 || y === 21
            ? R('blood', 1)
            : x < 12
              ? R('blood', 3)
              : R('blood', 2),
      );
  drawMask(s, ox + 4, oy, THRONE, (ch, u, v) => {
    switch (ch) {
      case 'G':
        return R('ember', 5);
      case 'g':
        return u < 8 ? R('ember', 4) : R('ember', 3);
      case 'C':
        return u < 8 ? R('blood', 3) : R('blood', 2);
      case 'c':
        return v < 4 ? R('blood', 4) : u < 8 ? R('blood', 4) : R('blood', 3);
      case 's':
        return R('blood', 3);
      case 'A':
        return v === 8 ? R('ember', 4) : R('soil', 4);
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
  '..........bb..........',
  'LL........bb........LL',
  '.LAA......bb......AAL.',
  '..aAAA....bb....AAAa..',
  '...aaAAA..bb..AAAaa...',
  '.....aaAAAXXAAAaa.....',
  '......ss..XX..ss......',
  '........ssXXss........',
  '...PPPPPPPXXPPPPPPP...',
  '...pPPPPPPXXPPPPPPp...',
  '...OoO....XX....OoO...',
  '..OoooO..QXXQ..OoooO..',
  '...OoO...q..q...OoO...',
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
        return u === 10 ? R('soil', 7) : R('soil', 5);
      case 'L':
        return R('stone', 5);
      case 'A':
        return v < 5 ? R('soil', 6) : R('soil', 5);
      case 'a':
        return R('soil', 2);
      case 'X':
        return u === 10 ? R('stone', 4) : R('stone', 2);
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
function pillar(S, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(c, r, 'pillar', oy + 22, { a: 0.55, b: 0.3 });
  const St = stoneFor(S);
  const broken = rand2(c, r, S.seed + 500) < 0.3;
  // cylinder shading across the 8-px shaft: rim, highlight, body, core shadow
  const shaft = [St(3), St(5), St(5), St(4), St(4), St(3), St(2), St(1)];
  const top = broken ? 6 + (hash2(c, r, S.seed) % 4) : 3;
  // plinth
  for (let y = 19; y < 23; y++)
    for (let x = 5; x < 19; x++)
      s.set(
        ox + x,
        oy + y,
        y === 19
          ? x < 12
            ? St(5)
            : St(4)
          : y === 22
            ? St(1)
            : x < 7
              ? St(4)
              : x > 16
                ? St(2)
                : St(3),
      );
  // shaft with fluting and drum joints
  for (let y = top; y < 19; y++)
    for (let u = 0; u < 8; u++) {
      if (broken && y < top + 2 && (u + y) % 3 === 0) continue;
      let col = shaft[u];
      if ((u === 3 || u === 5) && y > top + 1) col = shaft[u + 1];
      if ((y - top) % 6 === 5) col = St(Math.max(1, [3, 4, 4, 3, 3, 2, 1, 1][u] - 1));
      s.set(ox + 8 + u, oy + y, col);
    }
  if (!broken) {
    // capital: abacus slab + echinus, one pixel of cap above the cell at most
    for (let x = 6; x < 18; x++) {
      s.set(ox + x, oy - PILLAR_CAP + 1, x < 12 ? St(5) : St(4));
      s.set(ox + x, oy + 1, x < 8 ? St(4) : x > 15 ? St(1) : St(3));
    }
    for (let x = 7; x < 17; x++) s.set(ox + x, oy + 2, x < 10 ? St(4) : x > 14 ? St(2) : St(3));
  } else {
    // rubble at the foot
    for (const [dx, dy, k] of [
      [19, 21, 3],
      [20, 21, 2],
      [19, 20, 4],
      [3, 21, 3],
      [4, 21, 2],
    ])
      s.set(ox + dx, oy + dy, St(k));
  }
  if (S.biome === 'tundra' && !broken) for (let x = 6; x < 17; x++) s.set(ox + x, oy, R('snow', 7));
  // a little moss at the base
  if (S.biome !== 'void' && S.biome !== 'volcano') {
    s.set(ox + 7, oy + 18, R('foliage', 5));
    s.set(ox + 6, oy + 18, R('foliage', 4));
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
