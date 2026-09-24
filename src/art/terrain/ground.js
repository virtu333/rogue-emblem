// Ground passes. Each pass works on an art-pixel rectangle [x0,x1)x[y0,y1)
// of full-map buffers, reading neighbouring pixels of earlier passes. A full
// render runs every pass over the whole map; a repaint runs every pass over
// the dirty rectangles only.
//
// Locality budget (art px; one cell = 24). A pixel may only depend on cells
// in its own 3x3 neighbourhood, so the dependency reach of every chain must
// stay <= 24 px:
//   materials   box blur 5 + two 1-px spur clean-ups           = 7
//   edges       capped at EDGE_CAP (12) on top of materials    = 19
//   decals      stamp origin <= 5 px away, reads edges there   = 24
//   ground      reads edges / materials at the pixel (+1..2)   <= 21
import { R, down, up } from './palette.js';
import { hash2, jitteredPoints, worley } from './noise.js';
import { G, HARD, MATERIAL_COUNT } from './biomes.js';
import { ART_CELL as CELL } from './state.js';
import { ANIM } from './shimmer.js';
import { cornerShares, fieldAt } from './fields.js';

const BLUR = 5; // box radius in art px: corner rounding + wobble range
export const EDGE_CAP = 12;
export const DECAL_REACH = 5;

// Border wobble per material (noise amplitude in blurred-indicator units).
// score difference across a straight border is t / BLUR, so a border moves
// at most about BLUR * (AMP_a + AMP_b) * 0.6 px off the true cell line.
const AMP = new Float32Array(MATERIAL_COUNT).fill(0.3);
AMP[G.WATER] = 0.26;
AMP[G.ICE] = 0.34;
AMP[G.SWAMP] = 0.34;
AMP[G.BOG] = 0.34;
AMP[G.ASWAMP] = 0.34;
AMP[G.ABOG] = 0.34;
// Noise period per material: liquids get long, gentle curves; soft ground
// gets a shorter, more organic wobble.
const PERIOD = new Float32Array(MATERIAL_COUNT).fill(9);
PERIOD[G.WATER] = 14;
PERIOD[G.ICE] = 10;
PERIOD[G.LAVA] = 10;

function boxWeights(u) {
  // Overlap of [u+.5-B, u+.5+B] with the previous / own / next cell.
  const a = u + 0.5 - BLUR,
    b = u + 0.5 + BLUR,
    span = 2 * BLUR;
  const ov = (lo, hi) => Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / span;
  return [ov(-CELL, 0), ov(0, CELL), ov(CELL, 2 * CELL)];
}
const WTS = Array.from({ length: CELL }, (_, u) => boxWeights(u));

// ---------------------------------------------------------------- materials
export function passMaterials(S, x0, y0, x1, y1) {
  const { W, seed, style } = S;
  const def = style.defaultGround;
  const blendDefault = HARD[def] ? 0 : def;
  const scores = new Float32Array(MATERIAL_COUNT);
  const seen = new Uint8Array(9);
  for (let y = y0; y < y1; y++) {
    const r = (y / CELL) | 0,
      wy = WTS[y - r * CELL];
    for (let x = x0; x < x1; x++) {
      const c = (x / CELL) | 0,
        wx = WTS[x - c * CELL];
      const i = y * W + x;
      const own = S.groundAt(c, r);
      if (HARD[own] || (!wx[0] && !wx[2] && !wy[0] && !wy[2])) {
        S.matRaw[i] = own;
        continue;
      }
      let n = 0,
        single = true;
      for (let j = -1; j <= 1; j++) {
        const fy = wy[j + 1];
        if (!fy) continue;
        for (let k = -1; k <= 1; k++) {
          const fx = wx[k + 1];
          if (!fx) continue;
          let g = S.groundAt(c + k, r + j);
          // Hard ground never bleeds; soft ground treats it as the biome's
          // open ground (or as itself in stone biomes).
          if (HARD[g]) g = blendDefault || own;
          if (g !== own) single = false;
          if (scores[g] === 0) seen[n++] = g;
          scores[g] += fx * fy;
        }
      }
      if (single) {
        for (let q = 0; q < n; q++) scores[seen[q]] = 0;
        S.matRaw[i] = own;
        continue;
      }
      let best = own,
        bestS = -1e9;
      for (let q = 0; q < n; q++) {
        const g = seen[q];
        const noise = S.nz.fbm(x, y, PERIOD[g], seed * 31 + g * 977, 2) - 0.5;
        const s = scores[g] + AMP[g] * 2 * noise + (g === own ? 0.001 : 0);
        if (s > bestS) {
          bestS = s;
          best = g;
        }
        scores[g] = 0;
      }
      S.matRaw[i] = best;
    }
  }
}

// Spur clean-up: a pixel with at most one same-material 4-neighbour takes
// the majority material of its neighbours, so borders read as deliberate
// strokes rather than single-pixel noise.
function cleanPass(S, src, dst, x0, y0, x1, y1) {
  const { W, H } = S;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * W + x,
        m = src[i];
      if (HARD[m] || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        dst[i] = m;
        continue;
      }
      const a = src[i - 1],
        b = src[i + 1],
        c = src[i - W],
        d = src[i + W];
      const same = (a === m) + (b === m) + (c === m) + (d === m);
      if (same > 1) {
        dst[i] = m;
        continue;
      }
      let best = m,
        bestN = 1;
      for (const k of [a, b, c, d]) {
        if (HARD[k]) continue;
        const cnt = (a === k) + (b === k) + (c === k) + (d === k);
        if (cnt > bestN || (cnt === bestN && cnt >= 2 && k < best)) {
          bestN = cnt;
          best = k;
        }
      }
      dst[i] = bestN >= 2 ? best : m;
    }
}
export function passClean1(S, x0, y0, x1, y1) {
  cleanPass(S, S.matRaw, S.mat1, x0, y0, x1, y1);
}
export function passClean2(S, x0, y0, x1, y1) {
  cleanPass(S, S.mat1, S.mat, x0, y0, x1, y1);
}

// ---------------------------------------------------------------- edges
// Edge distances compare material *classes*: acid swamp is the same water as
// swamp and acid bog the same mud as bog, so no bank is drawn between them.
const CLASS = new Uint8Array(MATERIAL_COUNT).map((_, k) => k);
CLASS[G.ASWAMP] = G.SWAMP;
CLASS[G.ABOG] = G.BOG;

/** dU / dL: scan top-down, left-right. Bands must be processed top to bottom. */
export function passEdgesForward(S, x0, y0, x1, y1) {
  const { W, mat, dU, dL } = S;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * W + x,
        m = CLASS[mat[i]];
      dU[i] = y === 0 ? EDGE_CAP : CLASS[mat[i - W]] !== m ? 1 : Math.min(EDGE_CAP, dU[i - W] + 1);
      dL[i] = x === 0 ? EDGE_CAP : CLASS[mat[i - 1]] !== m ? 1 : Math.min(EDGE_CAP, dL[i - 1] + 1);
    }
}

/** dD / dR: scan bottom-up, right-left. Bands must be processed bottom to top. */
export function passEdgesBackward(S, x0, y0, x1, y1) {
  const { W, H, mat, dD, dR } = S;
  for (let y = y1 - 1; y >= y0; y--)
    for (let x = x1 - 1; x >= x0; x--) {
      const i = y * W + x,
        m = CLASS[mat[i]];
      dD[i] =
        y === H - 1 ? EDGE_CAP : CLASS[mat[i + W]] !== m ? 1 : Math.min(EDGE_CAP, dD[i + W] + 1);
      dR[i] =
        x === W - 1 ? EDGE_CAP : CLASS[mat[i + 1]] !== m ? 1 : Math.min(EDGE_CAP, dR[i + 1] + 1);
    }
}

// ---------------------------------------------------------------- ground
const WEAR_SOURCES = new Set(['Fort', 'Village']);

function wearAt(S, x, y) {
  // Trampled ground around lived-in structures (own 3x3 cells only).
  const c = (x / CELL) | 0,
    r = (y / CELL) | 0;
  let w = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      if (!S.inMap(c + i, r + j) || !WEAR_SOURCES.has(S.names[r + j][c + i])) continue;
      const cx = (c + i) * CELL + CELL / 2,
        cy = (r + j) * CELL + CELL * 0.72;
      const dx = (x - cx) * 0.9,
        dy = (y - cy) * 1.3;
      w = Math.max(w, 1 - Math.sqrt(dx * dx + dy * dy) / 15);
    }
  return w;
}

function paintOpenGround(S, x, y, s, wearNear, wood = 0) {
  const st = s.stretch;
  const n =
    S.nz.fbm(st ? x * st[0] : x, st ? y * st[1] : y, 44, S.seed + 11, 2) +
    (S.nz.vn(x, y, 3, S.seed + 13) - 0.5) * 0.05;
  let t = n < 0.28 ? s.dark : n > 0.72 ? s.light : s.base;
  if (wood > 0.5) {
    // Forest floor: the heart of a wood is in canopy shade, so the gaps
    // between crowns read as depth, not as open grass.
    const k = wood + (S.nz.vn(x, y, 3, S.seed + 14) - 0.5) * 0.18;
    if (k > 0.8) t = s.shade ?? down(s.dark, 1);
    else if (k > 0.62) t = s.dark;
  }
  const wear = wearNear ? wearAt(S, x, y) : 0;
  if (wear > 0) {
    const k = wear + (S.nz.vn(x, y, 5, S.seed + 12) - 0.5) * 0.5;
    const dirt = S.style.dirt || [R('soil', 5), R('soil', 6)];
    if (k > 0.55) t = dirt[1];
    else if (k > 0.42) t = dirt[0];
  }
  return t;
}

function paintLandLip(S, x, y, i, t) {
  // Land pixels touching open water: dark lip where the land's edge faces
  // away from the light (north / east of the water), bright lip on the lit
  // side. Only reads the 4-neighbours.
  const { W, H, mat } = S;
  if (y > 0 && mat[i - W] === G.WATER) return R('soil', 3);
  if (x < W - 1 && mat[i + 1] === G.WATER) return R('soil', 3);
  if (y < H - 1 && mat[i + W] === G.WATER) return up(t, 1);
  if (x > 0 && mat[i - 1] === G.WATER) return up(t, 1);
  return t;
}

// Painters return a palette index and leave the pixel's palette-cycling
// class in animOut (avoids a per-pixel allocation).
let animOut = 0;

function paintWater(S, x, y, i) {
  const seed = S.seed;
  const dAny = S.dAny(i);
  const d = Math.min(dAny, 10) + (S.nz.fbm(x, y, 12, seed + 21, 2) - 0.5) * 2.5;
  let t = R('tide', 4);
  let anim = 0;
  if (d <= 2.5) t = R('tide', 5);
  else if (dAny >= 9 && S.nz.fbm(x, y, 36, seed + 24, 2) < 0.46) t = R('tide', 3);
  else if (
    d > 4 &&
    y % 3 === 0 &&
    S.nz.fbm(x * 0.3, y * 1.5, 14, seed + 22, 2) > 0.64 &&
    S.nz.vn(x, y, 3, seed + 25) > 0.35
  ) {
    t = R('tide', 5);
    anim = ANIM.WATER;
  }
  const u = S.dU[i],
    l = S.dL[i];
  animOut = 0;
  // North bank: an earth face (we look from the south), then its shadow.
  if (u <= 2) return u === 1 ? R('soil', 4) : R('soil', 3);
  if (u <= 4) return down(t, 1);
  // West bank: thin dark earth edge, then shadow on the water.
  if (l === 1) return R('soil', 3);
  if (l <= 3) return down(t, 1);
  // South and east shores: broken foam line.
  if ((S.dD[i] === 1 || S.dR[i] === 1) && S.nz.vn(x, y, 4, seed + 23) > 0.34) return R('tide', 7);
  animOut = anim;
  return t;
}

function paintSand(S, x, y) {
  const n = S.nz.fbm(x, y, 30, S.seed + 31, 2);
  let t = n < 0.4 ? R('soil', 6) : R('soil', 7);
  // Wind ripples: gently curving parallel lines, only in patches.
  const wave = y + Math.sin(x / 6 + S.nz.fbm(x, y, 20, S.seed + 32) * 4) * 2.2;
  const band = ((wave % 5) + 5) % 5;
  if (S.nz.fbm(x, y, 16, S.seed + 33) > 0.5) {
    if (band < 1) t = down(t, 1);
    else if (band < 2) t = up(t, 1);
  }
  return t;
}

function paintIce(S, x, y, i) {
  const seed = S.seed;
  const n = S.nz.fbm(x, y, 26, seed + 41, 2);
  let t = n < 0.3 ? R('tide', 6) : n > 0.72 ? R('tide', 8) : R('tide', 7);
  // Long diagonal gleams ("/" strokes) lit from the upper left, sparse.
  const g = (x + y + Math.floor(S.nz.vn(x, y, 12, seed + 42) * 6)) % 15;
  if (g === 0 && S.nz.fbm(x, y, 9, seed + 43) > 0.6) t = R('ink', 11);
  // Partial crack network: dark hairlines, never a full grid.
  const w = worley(x, y, 16, seed + 44);
  if (w.d2 - w.d1 < 0.9 && S.nz.fbm(x, y, 13, seed + 45) > 0.5) t = down(t, 1);
  // Edges: ice sits slightly lower than the ground, north edge shadowed.
  if (S.dU[i] <= 2) t = S.dU[i] === 1 ? R('tide', 4) : R('tide', 5);
  else if (S.dL[i] === 1) t = R('tide', 5);
  else if (S.dD[i] === 1 || S.dR[i] === 1) t = R('tide', 8);
  return t;
}

function paintLava(S, x, y, i) {
  // Cooled basalt crust in bevelled plates; only some seams are live.
  const seed = S.seed;
  const SP = 9;
  const w = worley(x, y, SP, seed + 51);
  const edge = w.d2 - w.d1,
    plate = w.id;
  const inner = S.dAny(i);
  let t = R('ash', 2);
  if (worley(x - 1, y - 1, SP, seed + 51).id !== plate) t = R('ash', 3);
  if (worley(x + 1, y + 1, SP, seed + 51).id !== plate) t = R('ash', 1);
  const live = S.nz.fbm(x, y, 20, seed + 52, 2);
  const heat = Math.min(1, (inner - 1) / 3) * Math.max(0, (live - 0.38) * 2.6);
  let anim = 0;
  if (edge < 0.85 && heat > 0.15) {
    t = heat > 0.9 ? R('ember', 4) : heat > 0.55 ? R('ember', 3) : R('blood', 3);
    anim = heat > 0.55 ? ANIM.LAVA : 0;
  } else if (edge < 1.9 && heat > 0.35) t = R('ember', 1);
  // a few molten vents where seams meet
  const vent = S.nz.fbm(x, y, 6, seed + 53, 1);
  if (vent > 0.86 && heat > 0.6 && inner > 4) {
    t = vent > 0.9 ? R('ember', 5) : R('ember', 3);
    anim = ANIM.VENT;
  }
  animOut = anim;
  return t;
}

function paintSwamp(S, x, y, i, acid) {
  // Marsh water: murky olive pools in the same family as bog mud, told apart
  // by what makes water read as water - horizontal glints, a dark bank line
  // on the north / west edge and a mud lip on the lit south / east edge - so
  // a swamp / bog patchwork reads as one wetland with legible pools.
  const seed = S.seed;
  const n = S.nz.fbm(x, y, 18, seed + 61, 2);
  let t = n < 0.4 ? R('marsh', 3) : n < 0.84 ? R('marsh', 4) : R('marsh', 5);
  let anim = 0;
  if (
    y % 3 === 1 &&
    S.nz.fbm(x * 0.35, y * 1.4, 12, seed + 64, 2) > 0.62 &&
    S.nz.vn(x, y, 3, seed + 65) > 0.36
  )
    t = R('marsh', 6); // glints stay still: the tide cycle is for open water
  if (acid) {
    const a = S.nz.fbm(x, y, 10, seed + 71, 2);
    if (a > 0.74) {
      t = R('acid', 3);
      anim = ANIM.ACID;
    } else if (a > 0.66) {
      t = R('acid', 2);
      anim = 0;
    } else if (a > 0.58) {
      t = R('acid', 1);
      anim = 0;
    }
  }
  const u = S.dU[i];
  if (u === 1 || S.dL[i] === 1) {
    t = R('marsh', 1);
    anim = 0;
  } else if (u <= 3 || S.dL[i] <= 2) {
    t = down(t, 1);
    anim = 0;
  } else if ((S.dD[i] === 1 || S.dR[i] === 1) && S.nz.vn(x, y, 4, seed + 63) > 0.3) {
    t = R('earth', 3);
    anim = 0;
  }
  animOut = anim;
  return t;
}

function paintBog(S, x, y, acid) {
  // Brown-olive mud: broad wet hollows and drier rises, no crack network
  // (it read as paving next to swamp). Puddles and tussocks come from the
  // decals.
  const seed = S.seed;
  const n = S.nz.fbm(x, y, 22, seed + 81, 2) + (S.nz.vn(x, y, 4, seed + 83) - 0.5) * 0.06;
  let t = n < 0.3 ? R('marsh', 5) : n < 0.76 ? R('earth', 3) : R('earth', 4);
  let anim = 0;
  if (acid) {
    const a = S.nz.fbm(x, y, 9, seed + 82, 2);
    if (a > 0.7) {
      t = a > 0.78 ? R('acid', 3) : R('acid', 2);
      anim = a > 0.78 ? ANIM.ACID : 0;
    } else if (a > 0.64) t = R('acid', 0); // glow halo on mud
  }
  animOut = anim;
  return t;
}

// Floor: world-aligned running-bond flagstones with irregular row heights
// and stone widths, so the cell grid never shows through the paving. Row and
// stone boundaries are pure functions of the coordinate and seed (cached per
// state, never per layout).
function floorLayout(S) {
  if (S._floor) return S._floor;
  const P = 6,
    Q = 9;
  const rowOff = (k) => hash2(k, 0, S.seed + 91) % 3;
  const rowA = new Int32Array(S.H),
    rowB = new Int32Array(S.H),
    rowK = new Int32Array(S.H);
  for (let y = 0; y < S.H; y++) {
    let k = Math.floor(y / P);
    if (y < k * P + rowOff(k)) k--;
    rowA[y] = k * P + rowOff(k);
    rowB[y] = (k + 1) * P + rowOff(k + 1);
    rowK[y] = k;
  }
  const kMin = rowK[0],
    kMax = rowK[S.H - 1];
  const stoneA = [],
    stoneB = [],
    stoneS = [];
  for (let k = kMin; k <= kMax; k++) {
    const shift = hash2(k, 1, S.seed + 92) % Q;
    const off = (ss) => hash2(k, ss, S.seed + 93) % 4;
    const A = new Int32Array(S.W),
      B = new Int32Array(S.W),
      I = new Int32Array(S.W);
    for (let x = 0; x < S.W; x++) {
      const xx = x + shift;
      let s2 = Math.floor(xx / Q);
      if (xx < s2 * Q + off(s2)) s2--;
      A[x] = s2 * Q + off(s2) - shift;
      B[x] = (s2 + 1) * Q + off(s2 + 1) - shift;
      I[x] = s2;
    }
    stoneA.push(A);
    stoneB.push(B);
    stoneS.push(I);
  }
  return (S._floor = { rowA, rowB, rowK, kMin, stoneA, stoneB, stoneS });
}

function paintFloor(S, x, y, i) {
  // Mortar is only half a value step darker than its stone, so a big hall
  // reads as one quiet plane (open terrain) instead of a brick texture.
  const [mortarLo, base, alt, lit] = S.masonry.floor;
  const mortarOf = S.masonry.floorMortar;
  const F = floorLayout(S);
  const y0 = F.rowA[y],
    y1 = F.rowB[y],
    rk = F.rowK[y];
  const kk = rk - F.kMin;
  const x0 = F.stoneA[kk][x],
    x1 = F.stoneB[kk][x],
    si = F.stoneS[kk][x];
  const id = hash2(rk, si, S.seed + 94);
  const h = (id % 100) / 100;
  const drift = S.nz.fbm(x, y, 44, S.seed + 95, 2);
  const stone = h < 0.86 ? (drift < 0.26 ? alt : base) : h < 0.97 ? alt : lit;
  let t = stone;
  if (y === y1 - 1 || x === x1 - 1) t = mortarOf[stone] ?? mortarLo;
  else if (id % 17 === 0 && x - x0 === y - y0 + 1) t = mortarOf[stone] ?? mortarLo;
  // Edge of the paving next to open ground: a dark kerb line.
  const { W, H, mat } = S;
  const soft = (k) => k !== G.FLOOR && k !== G.WALL;
  if (
    (x > 0 && soft(mat[i - 1])) ||
    (y > 0 && soft(mat[i - W])) ||
    (x < W - 1 && soft(mat[i + 1])) ||
    (y < H - 1 && soft(mat[i + W]))
  )
    t = mortarLo;
  return t;
}

const FACE_H = 10;
function paintWall(S, x, y) {
  const c = (x / CELL) | 0,
    r = (y / CELL) | 0,
    u = x - c * CELL,
    v = y - r * CELL;
  const isWall = (cc, rr) => S.inMap(cc, rr) && S.groundAt(cc, rr) === G.WALL;
  const southOpen = r + 1 < S.rows && !isWall(c, r + 1);
  const northOpen = r > 0 && !isWall(c, r - 1);
  const westOpen = c > 0 && !isWall(c - 1, r);
  const eastOpen = c + 1 < S.cols && !isWall(c + 1, r);
  const T = S.masonry.wallTop,
    Fc = S.masonry.wallFace;
  if (southOpen && v >= CELL - FACE_H) {
    const fr = v - (CELL - FACE_H);
    let t;
    if (fr === 0) t = T[3];
    else if (fr === 1) t = Fc[1];
    else if (fr === FACE_H - 1) t = Fc[0];
    else {
      const course = Math.floor((fr - 2) / 3),
        k = (fr - 2) % 3;
      const off = course % 2 ? 3 : 0;
      const bx = Math.floor((x + off) / 6);
      if (k === 2 || (x + off) % 6 === 0) t = Fc[1];
      else {
        const h = hash2(bx, course + r * 7, S.seed + 101) % 10;
        t = h < 6 ? Fc[2] : h < 9 ? Fc[3] : Fc[4];
      }
    }
    if (westOpen && u === 0) t = fr === 0 ? T[4] : Fc[4];
    if (eastOpen && u === CELL - 1) t = Fc[0];
    return t;
  }
  // Rampart top.
  const topH = southOpen ? CELL - FACE_H : CELL;
  const course = Math.floor(y / 7),
    off = course % 2 ? 5 : 0;
  let t;
  if (y % 7 === 6 || (x + off) % 10 === 9) t = T[5];
  else {
    const h = hash2(Math.floor((x + off) / 10), course, S.seed + 102) % 10;
    t = h < 8 ? T[1] : T[2];
  }
  // Parapets with merlons on exposed long edges.
  const merlonRow = (vv, from) => {
    const p = (x + 1) % 5;
    if (p >= 3) return T[0];
    if (vv === from) return T[4];
    if (p === 2) return T[1];
    return T[3];
  };
  if (southOpen && v >= topH - 3) t = merlonRow(v, topH - 3);
  if (northOpen && v < 3) t = merlonRow(v, 0);
  if (northOpen && v === 0) t = T[4];
  if (westOpen && u === 0) t = T[3];
  if (eastOpen && u === CELL - 1) t = T[0];
  return t;
}

export function passGround(S, x0, y0, x1, y1) {
  const { W, style, mat, idx, anim, shadow, owner, cols } = S;
  // Per-cell flags for the cells this region touches: lava / lived-in
  // structures anywhere in the cell's 3x3 neighbourhood.
  const c0 = (x0 / CELL) | 0,
    c1 = ((x1 - 1) / CELL) | 0,
    r0 = (y0 / CELL) | 0,
    r1 = ((y1 - 1) / CELL) | 0;
  const fw = c1 - c0 + 1;
  const lavaNear = new Uint8Array(fw * (r1 - r0 + 1));
  const wearNear = new Uint8Array(fw * (r1 - r0 + 1));
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      let lava = 0,
        wear = 0;
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          if (!S.inMap(c + k, r + j)) continue;
          if (S.ground[(r + j) * cols + c + k] === G.LAVA) lava = 1;
          if (WEAR_SOURCES.has(S.names[r + j][c + k])) wear = 1;
        }
      lavaNear[(r - r0) * fw + c - c0] = lava;
      wearNear[(r - r0) * fw + c - c0] = wear;
    }
  // Region fields (see fields.js): woodland share around each cell corner.
  const woodCorners = new Float32Array(fw * (r1 - r0 + 1) * 4);
  const isWood = (c, r) => (S.name(c, r) === 'Forest' ? 1 : 0);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (S.names[r][c] === 'Forest')
        cornerShares(isWood, c, r, woodCorners, ((r - r0) * fw + c - c0) * 4);
  for (let y = y0; y < y1; y++) {
    const rr = ((y / CELL) | 0) - r0,
      v = y % CELL;
    for (let x = x0; x < x1; x++) {
      const i = y * W + x,
        m = mat[i],
        f = rr * fw + ((x / CELL) | 0) - c0;
      let t;
      animOut = 0;
      switch (m) {
        case G.GRASS:
        case G.FOREST: {
          const wood = woodCorners[f * 4] > 0 ? fieldAt(woodCorners, f * 4, x % CELL, v) : 0;
          t = paintLandLip(S, x, y, i, paintOpenGround(S, x, y, style.ground, wearNear[f], wood));
          break;
        }
        case G.ROCK:
          t = paintLandLip(S, x, y, i, paintOpenGround(S, x, y, style.rockGround, wearNear[f]));
          break;
        case G.SAND:
          t = paintLandLip(S, x, y, i, paintSand(S, x, y));
          break;
        case G.WATER:
          t = paintWater(S, x, y, i);
          break;
        case G.ICE:
          t = paintIce(S, x, y, i);
          break;
        case G.LAVA:
          t = paintLava(S, x, y, i);
          break;
        case G.SWAMP:
        case G.ASWAMP:
          t = paintSwamp(S, x, y, i, m === G.ASWAMP);
          break;
        case G.BOG:
        case G.ABOG: {
          const b = paintBog(S, x, y, m === G.ABOG);
          t = paintLandLip(S, x, y, i, b);
          if (t !== b) animOut = 0;
          break;
        }
        case G.FLOOR:
          t = paintFloor(S, x, y, i);
          break;
        case G.WALL:
          t = paintWall(S, x, y);
          break;
        default:
          t = R('ink', 5);
      }
      let a = animOut;
      // Emissive spill: lava warms the ground right next to it.
      if (lavaNear[f] && m !== G.LAVA && m !== G.WATER && !HARD[m]) {
        let lava = 9;
        for (let j = -2; j <= 2 && lava > 1; j++)
          for (let k = -2; k <= 2; k++)
            if (S.matAt(x + k, y + j) === G.LAVA)
              lava = Math.min(lava, Math.max(Math.abs(j), Math.abs(k)));
        if (lava === 1 || (lava === 2 && (x + y) % 2 === 0)) {
          t = R('ember', 1);
          a = 0;
        }
      }
      idx[i] = t;
      anim[i] = a;
      shadow[i] = 0;
      owner[i] = 0;
    }
  }
}

// ---------------------------------------------------------------- decals
function stampIf(S, rx0, ry0, rx1, ry1, x, y, rows, pick, allow) {
  const { W, mat, idx } = S;
  for (let j = 0; j < rows.length; j++) {
    const Y = y + j;
    if (Y < ry0 || Y >= ry1) continue;
    const row = rows[j];
    for (let k = 0; k < row.length; k++) {
      const ch = row[k];
      if (ch === '.') continue;
      const X = x + k;
      if (X < rx0 || X >= rx1) continue;
      const i = Y * W + X;
      if (!allow(mat[i], i)) continue;
      idx[i] = pick(ch, idx[i]);
      S.anim[i] = 0;
    }
  }
}

// Tufts are drawn relative to the ground under them: d = one ramp step
// darker, h = one step lighter, b = the biome's blade colour.
const TUFTS = [
  ['d.d', '.d.'],
  ['h..', 'dh.', '.d.'],
  ['..h', '.hd', '.d.'],
];
const DRY_TUFTS = [
  ['b.b', 'hbh', 'd.d'],
  ['.b', 'bh', 'dd'],
];

export function passDecals(S, x0, y0, x1, y1) {
  const { W, H, seed, style, mat } = S;
  const E = DECAL_REACH;
  const px0 = Math.max(0, x0 - E),
    py0 = Math.max(0, y0 - E),
    px1 = Math.min(W, x1 + E),
    py1 = Math.min(H, y1 + E);
  const pts = (spacing, s, jitter) => jitteredPoints(px0, py0, px1, py1, spacing, s, jitter);
  const stamp = (x, y, rows, pick, allow) => stampIf(S, x0, y0, x1, y1, x, y, rows, pick, allow);
  const openGround = (m) => m === G.GRASS || m === G.FOREST || m === G.ROCK;
  const stepPick = (ch, cur) => (ch === 'h' ? up(cur, 1) : ch === 'd' ? down(cur, 1) : cur);

  // Lit clumps: little mounds, lit on top, shaded underneath. They give the
  // ground a directional-light texture without speckle. Sparse: open ground
  // stays a quiet stage for the actors.
  for (const p of pts(11, seed + 201)) {
    const i = p.y * W + p.x,
      m = mat[i];
    if (!openGround(m) || S.dAny(i) < 3 || p.r > 0.3) continue;
    const rows = p.r < 0.12 ? ['.hhh.', 'hbbbd', '.ddd.'] : ['.hh.', 'hbbd', '.dd.'];
    stamp(p.x - 2, p.y - 1, rows, stepPick, (mm, ii) => mm === m && S.dAny(ii) >= 2);
  }
  // Grass tufts.
  if (style.tufts) {
    const set = style.tufts === 'dry' ? DRY_TUFTS : TUFTS;
    for (const p of pts(10, seed + 211)) {
      const i = p.y * W + p.x,
        m = mat[i];
      const limit = m === G.SAND ? 0.25 : style.tufts === 'dry' ? 0.12 : 0.26;
      if (!(m === G.GRASS || m === G.ROCK || m === G.SAND || m === G.BOG) || p.r > limit) continue;
      if (S.dAny(i) < 2 && m !== G.SAND) continue;
      if (m === G.SAND && S.dAny(i) > 4) continue; // grass creeps in at sand edges only
      const s = m === G.ROCK ? style.rockGround : style.ground;
      const rows = set[hash2(p.gx, p.gy, seed + 212) % set.length];
      const blade =
        m === G.BOG ? R('marsh', 7) : m === G.SAND ? style.ground.light : (s.blade ?? s.hi);
      const hi = m === G.BOG ? R('marsh', 8) : m === G.SAND ? style.ground.hi : up(blade, 1);
      const dry = style.tufts === 'dry' || m === G.BOG || m === G.SAND;
      stamp(
        p.x,
        p.y - 2,
        rows,
        (ch, cur) => (ch === 'b' ? blade : ch === 'h' ? (dry ? hi : up(cur, 1)) : down(cur, 1)),
        (mm) => mm === m || (m === G.SAND && openGround(mm)),
      );
    }
  }
  // Small stones and flowers on open ground.
  for (const p of pts(13, seed + 221)) {
    const i = p.y * W + p.x,
      m = mat[i];
    if (!(openGround(m) || m === G.SAND) || S.dAny(i) < 3) continue;
    if (p.r < (m === G.ROCK ? 0.4 : 0.04)) {
      const stone = style.pebble || [R('ink', 8), R('ink', 7)];
      stamp(
        p.x,
        p.y,
        p.r < 0.05 ? ['ab.', 'bbd'] : ['a.', 'bd'],
        (ch, cur) => (ch === 'a' ? stone[0] : ch === 'b' ? stone[1] : down(cur, 1)),
        (mm) => mm === m,
      );
    } else if (style.flowers && m === G.GRASS && p.r > 0.97) {
      const col = style.flowers[hash2(p.gx, p.gy, seed + 222) % style.flowers.length];
      stamp(
        p.x,
        p.y,
        ['f.f', '.f.'],
        () => col,
        (mm) => mm === m,
      );
    }
  }
  // Water ripples: short horizontal strokes, one ramp step lighter.
  for (const p of pts(8, seed + 231)) {
    const i = p.y * W + p.x;
    if (mat[i] !== G.WATER || S.dAny(i) < 4 || S.dU[i] < 6 || p.r > 0.45) continue;
    const len = 2 + (((p.r * 20) | 0) % 3);
    for (let k = 0; k < len; k++) {
      const X = p.x + k;
      if (X < x0 || X >= x1 || p.y < y0 || p.y >= y1) continue;
      const ii = i + k;
      if (mat[ii] === G.WATER && S.dAny(ii) >= 3) {
        S.idx[ii] = up(S.idx[ii], 1);
        S.anim[ii] = 0;
      }
    }
  }
  // Marsh: lily pads, reeds at the edges; bog: puddles and tussocks;
  // acid: bubbles.
  for (const p of pts(7, seed + 241)) {
    const i = p.y * W + p.x,
      m = mat[i];
    if (m === G.SWAMP && S.dAny(i) >= 3 && p.r < 0.16) {
      stamp(
        p.x - 1,
        p.y - 1,
        ['.hh.', 'hbb.', '.bbd'],
        (ch) => (ch === 'h' ? R('foliage', 7) : ch === 'b' ? R('foliage', 6) : R('marsh', 2)),
        (mm) => mm === G.SWAMP,
      );
    } else if ((m === G.SWAMP || m === G.ASWAMP) && S.dAny(i) <= 4 && p.r < 0.6) {
      // reed cluster
      const n = 2 + (hash2(p.gx, p.gy, seed + 243) % 3);
      for (let k = 0; k < n; k++) {
        const X = p.x + k * 2 - n,
          h = 3 + (hash2(p.x + k, p.y, seed + 242) % 3);
        if (X < x0 || X >= x1) continue;
        for (let j = 0; j < h; j++) {
          const Y = p.y - j;
          if (Y < y0 || Y >= y1) continue;
          S.idx[Y * W + X] = j === h - 1 ? R('earth', 5) : j === 0 ? R('marsh', 2) : R('earth', 4);
          S.anim[Y * W + X] = 0;
        }
      }
    } else if (m === G.ASWAMP && p.r < 0.4 && S.dAny(i) >= 2) {
      stamp(
        p.x - 1,
        p.y - 1,
        p.r < 0.15 ? ['hh', 'hd'] : ['h'],
        (ch) => (ch === 'h' ? R('acid', 4) : R('acid', 2)),
        (mm) => mm === G.ASWAMP,
      );
    } else if ((m === G.BOG || m === G.ABOG) && S.dAny(i) >= 3 && p.r < 0.2) {
      const acid = m === G.ABOG && p.r < 0.22;
      const rows = p.r < 0.2 ? ['.ddd.', 'dwwwl', '.lll.'] : ['.dd.', 'dwwl', '.ll.'];
      stamp(
        p.x - 2,
        p.y - 1,
        rows,
        (ch, cur) =>
          ch === 'd'
            ? acid
              ? R('acid', 1)
              : R('marsh', 3)
            : ch === 'w'
              ? acid
                ? R('acid', 3)
                : R('marsh', 4)
              : acid
                ? R('acid', 2)
                : up(cur, 1),
        (mm) => mm === m,
      );
    }
  }
}
