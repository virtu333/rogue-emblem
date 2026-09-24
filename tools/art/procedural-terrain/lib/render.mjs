// Procedural terrain renderer.
//
// Works on a logical pixel grid of CELL (24) art pixels per map cell; the
// output is upscaled 2x to the game's 48px-per-cell weathered texture size,
// so every art pixel is a clean 2x2 block (SNES/GBA density, and it survives
// the ~34 CSS px phone scale far better than 1px detail).
//
// Every pass is local: a pixel depends only on its own cell and the 8
// neighbouring cells (plus world-space hash noise), so the same code can paint
// one cell at a time from its 3x3 neighbourhood at runtime. Here we simply run
// the passes over the whole map.
//
// Passes:
//   1. materials  - per-pixel ground material from box-blurred cell
//                   indicators + world-space noise (rounded, wobbly borders).
//   2. edges      - directional distance to a different material (shores,
//                   lips, bank faces).
//   3. ground     - base texture per material, low-frequency value patches.
//   4. decals     - tufts, stones, ripples, reeds, lily pads, puddles...
//   5. flats      - bridges (flat objects that sit on the ground layer).
//   6. shadows    - projected bottom-right shadows of all tall objects and
//                   wall faces, applied as one ramp step darker.
//   7. objects    - trees, peaks, forts, houses, pillars, throne, ballista,
//                   painted back-to-front with a selective outline.
import { R, down, up } from './palette.mjs';
import { rand2, hash2, fbm, valueNoise, jitteredPoints, worley } from './noise.mjs';
import { G, HARD, BIOMES, MASONRY } from './biomes.mjs';
import { buildObjects, paintBridges } from './objects.mjs';

export const CELL = 24;

export function groundOf(name, biome) {
  const def = BIOMES[biome]?.defaultGround ?? G.GRASS;
  switch (name) {
    case 'Plain':
      return def;
    case 'Forest':
      return G.FOREST;
    case 'Mountain':
      return G.ROCK;
    case 'Fort':
    case 'Village':
    case 'Ballista':
      return def;
    case 'Throne':
    case 'Pillar':
    case 'Floor':
      return G.FLOOR;
    case 'Wall':
      return G.WALL;
    case 'Water':
    case 'River':
    case 'Bridge':
      return G.WATER;
    case 'Sand':
      return G.SAND;
    case 'Ice':
      return G.ICE;
    case 'Lava Crack':
      return G.LAVA;
    case 'Swamp':
      return G.SWAMP;
    case 'Bog':
      return G.BOG;
    case 'Acidic Swamp':
      return G.ASWAMP;
    case 'Acidic Bog':
      return G.ABOG;
    default:
      return def;
  }
}

// Border wobble per material (noise amplitude in blurred-indicator units).
const AMP = {
  [G.GRASS]: 0.2,
  [G.FOREST]: 0.24,
  [G.ROCK]: 0.24,
  [G.SAND]: 0.28,
  [G.WATER]: 0.17,
  [G.ICE]: 0.3,
  [G.LAVA]: 0.2,
  [G.SWAMP]: 0.36,
  [G.BOG]: 0.38,
  [G.ASWAMP]: 0.36,
  [G.ABOG]: 0.38,
};
// Noise period per material: liquids get long, gentle curves; soft ground
// gets a shorter, more organic wobble.
const PERIOD = { [G.WATER]: 22, [G.ICE]: 12, [G.SWAMP]: 13, [G.ASWAMP]: 13, [G.BOG]: 12, [G.ABOG]: 12, [G.LAVA]: 13 };
const BLUR = 8; // box radius in art px: corner rounding + wobble range

export class TerrainContext {
  constructor(names, biome, seed) {
    this.names = names;
    this.rows = names.length;
    this.cols = names[0].length;
    this.W = this.cols * CELL;
    this.H = this.rows * CELL;
    this.biome = BIOMES[biome] ? biome : 'grassland';
    this.style = BIOMES[this.biome];
    this.masonry = MASONRY[this.biome] || MASONRY.default;
    this.seed = seed;
    const n = this.W * this.H;
    this.mat = new Uint8Array(n);
    this.idx = new Uint8Array(n);
    this.shadow = new Uint8Array(n);
    this.deck = new Uint8Array(n); // bridge deck mask (1 = E-W, 2 = N-S)
    this.dU = new Uint8Array(n);
    this.dD = new Uint8Array(n);
    this.dL = new Uint8Array(n);
    this.dR = new Uint8Array(n);
    this.groundGrid = names.map((row) => row.map((name) => groundOf(name, this.biome)));
  }
  name(c, r) {
    c = Math.max(0, Math.min(this.cols - 1, c));
    r = Math.max(0, Math.min(this.rows - 1, r));
    return this.names[r][c];
  }
  inMap(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }
  ground(c, r) {
    c = Math.max(0, Math.min(this.cols - 1, c));
    r = Math.max(0, Math.min(this.rows - 1, r));
    return this.groundGrid[r][c];
  }
  matAt(x, y) {
    x = Math.max(0, Math.min(this.W - 1, x));
    y = Math.max(0, Math.min(this.H - 1, y));
    return this.mat[y * this.W + x];
  }
  get(x, y) {
    return this.idx[y * this.W + x];
  }
  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.idx[y * this.W + x] = c;
  }
  dAny(i) {
    return Math.min(this.dU[i], this.dD[i], this.dL[i], this.dR[i]);
  }
}

// ---------------------------------------------------------------- pass 1
function boxWeights(u) {
  // Overlap of [u+.5-B, u+.5+B] with the previous / own / next cell.
  const a = u + 0.5 - BLUR,
    b = u + 0.5 + BLUR,
    span = 2 * BLUR;
  const ov = (lo, hi) => Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / span;
  return [ov(-CELL, 0), ov(0, CELL), ov(CELL, 2 * CELL)];
}

function resolveMaterials(M) {
  const { W, H, seed } = M;
  const wts = Array.from({ length: CELL }, (_, u) => boxWeights(u));
  const blendGround = (c, r) => {
    const g = M.ground(c, r);
    if (!HARD.has(g)) return g;
    const def = M.style.defaultGround;
    return HARD.has(def) ? null : def;
  };
  const scores = new Float32Array(16);
  for (let y = 0; y < H; y++) {
    const r = (y / CELL) | 0,
      v = y % CELL,
      wy = wts[v];
    for (let x = 0; x < W; x++) {
      const c = (x / CELL) | 0,
        u = x % CELL,
        own = M.ground(c, r);
      if (HARD.has(own)) {
        M.mat[y * W + x] = own;
        continue;
      }
      const wx = wts[u];
      scores.fill(-1);
      for (let j = -1; j <= 1; j++) {
        if (!wy[j + 1]) continue;
        for (let i = -1; i <= 1; i++) {
          if (!wx[i + 1]) continue;
          let g = blendGround(c + i, r + j);
          if (g === null) g = own;
          if (scores[g] < 0) scores[g] = 0;
          scores[g] += wx[i + 1] * wy[j + 1];
        }
      }
      let best = own,
        bestS = -1e9;
      for (let g = 1; g < 16; g++) {
        if (scores[g] < 0) continue;
        const n = fbm(x, y, PERIOD[g] ?? 10, seed * 31 + g * 977, 2) - 0.5;
        const s = scores[g] + (AMP[g] ?? 0.2) * 2 * n + (g === own ? 0.001 : 0);
        if (s > bestS) {
          bestS = s;
          best = g;
        }
      }
      M.mat[y * W + x] = best;
    }
  }
  // Clean-up: kill single-pixel spurs so borders read as deliberate strokes.
  for (let pass = 0; pass < 2; pass++) {
    const src = M.mat.slice();
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x,
          m = src[i];
        if (HARD.has(m)) continue;
        const n4 = [src[i - 1], src[i + 1], src[i - W], src[i + W]];
        const same = n4.filter((k) => k === m).length;
        if (same <= 1) {
          const counts = {};
          for (const k of n4) if (!HARD.has(k)) counts[k] = (counts[k] || 0) + 1;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          if (top && top[1] >= 2) M.mat[i] = +top[0];
        }
      }
  }
}

// ---------------------------------------------------------------- pass 2
function computeEdges(M) {
  const { W, H, mat, dU, dD, dL, dR } = M;
  const CAP = 15;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      dU[i] = y === 0 ? CAP : mat[i - W] !== mat[i] ? 1 : Math.min(CAP, dU[i - W] + 1);
      dL[i] = x === 0 ? CAP : mat[i - 1] !== mat[i] ? 1 : Math.min(CAP, dL[i - 1] + 1);
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      dD[i] = y === H - 1 ? CAP : mat[i + W] !== mat[i] ? 1 : Math.min(CAP, dD[i + W] + 1);
      dR[i] = x === W - 1 ? CAP : mat[i + 1] !== mat[i] ? 1 : Math.min(CAP, dR[i + 1] + 1);
    }
}

// ---------------------------------------------------------------- pass 3
const STRUCTURES = new Set(['Fort', 'Village', 'Ballista']);

function wearAt(M, x, y) {
  // Trampled ground around lived-in structures.
  const c = (x / CELL) | 0,
    r = (y / CELL) | 0;
  let w = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      if (!M.inMap(c + i, r + j) || !STRUCTURES.has(M.name(c + i, r + j))) continue;
      const cx = (c + i) * CELL + CELL / 2,
        cy = (r + j) * CELL + CELL * 0.62;
      const d = Math.hypot((x - cx) * 0.9, (y - cy) * 1.25);
      w = Math.max(w, 1 - d / 17);
    }
  return w;
}

function paintOpenGround(M, x, y, s, i) {
  const n = fbm(x, y, 40, M.seed + 11, 2);
  let t = n < 0.32 ? s.dark : n > 0.7 ? s.light : s.base;
  const wear = wearAt(M, x, y);
  if (wear > 0) {
    const k = wear + (valueNoise(x, y, 5, M.seed + 12) - 0.5) * 0.5;
    const dirt = M.biome === 'tundra' ? [R('snow', 1), R('snow', 2)] : M.biome === 'volcano' ? [R('ash', 2), R('ash', 3)] : M.biome === 'swamp' ? [R('earth', 2), R('earth', 3)] : [R('soil', 3), R('soil', 4)];
    if (k > 0.5) t = dirt[1];
    else if (k > 0.4) t = dirt[0];
  }
  return t;
}

function paintWater(M, x, y, i) {
  const d = Math.min(M.dAny(i), 12) + (fbm(x, y, 12, M.seed + 21, 2) - 0.5) * 2.5;
  // Stretched noise gives horizontal sheen bands instead of blobs.
  const sheen = fbm(x * 0.3, y * 1.5, 14, M.seed + 22, 2);
  const deep = fbm(x, y, 40, M.seed + 24, 2);
  let t = R('steel', 2);
  if (d <= 2.5) t = R('steel', 3);
  else if (deep < 0.3 && d > 6) t = R('steel', 1);
  else if (sheen > 0.7 && d > 4 && (x + y) % 2 === 0) t = R('steel', 3);
  const u = M.dU[i],
    l = M.dL[i],
    dd = M.dD[i],
    rr = M.dR[i];
  // North bank: an earth face (we look from the south), then its shadow.
  if (u <= 2) return u === 1 ? R('soil', 3) : R('soil', 2);
  if (u <= 4) t = down(t, 1);
  // West bank: thin dark earth edge, then shadow on the water.
  if (l === 1) return R('soil', 2);
  if (l <= 3) t = down(t, 1);
  // South and east shores: broken foam line.
  const foam = valueNoise(x, y, 4, M.seed + 23) > 0.34;
  if ((dd === 1 || rr === 1) && foam) return R('steel', 4);
  return t;
}

function paintLandLip(M, x, y, i, t) {
  // Land pixels touching water / swamp: dark lip on south and west sides of
  // the land (bank edge facing away from the light), bright lip on the
  // north bank top edge (catches the low sun).
  const W = M.W;
  const liquid = (k) => k === G.WATER || k === G.SWAMP || k === G.ASWAMP;
  const below = y < M.H - 1 && liquid(M.mat[i + W]);
  const above = y > 0 && liquid(M.mat[i - W]);
  const right = x < W - 1 && liquid(M.mat[i + 1]);
  const left = x > 0 && liquid(M.mat[i - 1]);
  if (above) return R('soil', 2);
  if (right) return R('soil', 2);
  if (below) return up(t, 1);
  if (left) return up(t, 1);
  return t;
}

function paintSand(M, x, y, i) {
  const n = fbm(x, y, 30, M.seed + 31, 2);
  let t = n < 0.4 ? R('soil', 5) : R('soil', 6);
  // Wind ripples: gently curving parallel lines, only in patches.
  const wave = y + Math.sin(x / 6 + fbm(x, y, 20, M.seed + 32) * 4) * 2.2;
  const band = ((wave % 5) + 5) % 5;
  if (fbm(x, y, 16, M.seed + 33) > 0.48) {
    if (band < 1) t = down(t, 1);
    else if (band < 2) t = up(t, 1);
  }
  return t;
}

function paintIce(M, x, y, i) {
  const n = fbm(x, y, 26, M.seed + 41, 2);
  let t = n < 0.5 ? R('steel', 3) : R('steel', 4);
  // Long diagonal gleams ("/" strokes) lit from the upper left, sparse.
  const g = (x + y + Math.floor(valueNoise(x, y, 12, M.seed + 42) * 6)) % 15;
  if (g === 0 && fbm(x, y, 9, M.seed + 43) > 0.6) t = R('steel', 5);
  // Partial crack network: dark hairlines, never a full grid.
  const w = worley(x, y, 16, M.seed + 44);
  if (w.d2 - w.d1 < 0.9 && fbm(x, y, 13, M.seed + 45) > 0.5) t = down(t, 1);
  // Edges: ice sits slightly lower than the ground, north edge shadowed.
  if (M.dU[i] <= 2) t = M.dU[i] === 1 ? R('steel', 2) : down(t, 1);
  else if (M.dL[i] === 1) t = R('steel', 2);
  else if (M.dD[i] === 1 || M.dR[i] === 1) t = R('steel', 5);
  return t;
}

function paintLava(M, x, y, i) {
  // Cooled basalt crust in bevelled plates; only some seams are live.
  const S = 9;
  const w = worley(x, y, S, M.seed + 51);
  const edge = w.d2 - w.d1;
  const inner = M.dAny(i);
  const plate = [R('ash', 1), R('ash', 2), R('ash', 3)];
  let t = plate[1];
  if (worley(x - 1, y - 1, S, M.seed + 51).id !== w.id) t = plate[2];
  if (worley(x + 1, y + 1, S, M.seed + 51).id !== w.id) t = plate[0];
  const live = fbm(x, y, 20, M.seed + 52, 2);
  const heat = Math.min(1, (inner - 1) / 3) * Math.max(0, (live - 0.38) * 2.6);
  if (edge < 0.85 && heat > 0.15) t = heat > 0.9 ? R('ember', 4) : heat > 0.55 ? R('ember', 3) : R('blood', 3);
  else if (edge < 1.9 && heat > 0.35) t = R('ember', 1);
  // a few molten vents where seams meet
  const vent = fbm(x, y, 6, M.seed + 53, 1);
  if (vent > 0.82 && heat > 0.5 && inner > 3) t = vent > 0.88 ? R('ember', 5) : R('ember', 3);
  return t;
}

function paintSwamp(M, x, y, i, acid) {
  const n = fbm(x, y, 18, M.seed + 61, 2);
  // Murky water with drifting algae; acid swamp shares the water but
  // carries glowing scum so it reads as a hazard, not a different lake.
  let t = n < 0.55 ? R('verdigris', 1) : n < 0.78 ? R('foliage', 3) : R('foliage', 4);
  if (acid) {
    const a = fbm(x, y, 11, M.seed + 71, 2);
    if (a > 0.72) t = R('acid', 3);
    else if (a > 0.62) t = R('acid', 2);
    else if (a > 0.54) t = R('acid', 1);
  }
  const u = M.dU[i];
  if (u <= 1) return R('soil', 2);
  if (u <= 3 || M.dL[i] <= 2) t = down(t, 1);
  if ((M.dD[i] === 1 || M.dR[i] === 1) && valueNoise(x, y, 4, M.seed + 63) > 0.4) t = acid ? R('acid', 2) : R('earth', 3);
  return t;
}

function paintBog(M, x, y, i, acid) {
  // Olive-brown mud: wet dark hollows, drier crust on the lit rises.
  const n = fbm(x, y, 16, M.seed + 81, 2);
  let t = n < 0.36 ? R('soil', 2) : n < 0.7 ? R('earth', 2) : R('earth', 3);
  if (acid) {
    const a = fbm(x, y, 9, M.seed + 82, 2);
    if (a > 0.7) t = a > 0.78 ? R('acid', 3) : R('acid', 2);
    else if (a > 0.64) t = R('acid', 0); // glow halo on mud
  }
  return t;
}

function floorLayout(M) {
  // World-aligned running-bond flagstones with irregular row heights and
  // stone widths, so the cell grid never shows through the paving.
  const rowsY = [];
  let y = -((hash2(1, 2, M.seed) % 4) | 0),
    k = 0;
  while (y < M.H + 8) {
    const h = 5 + (hash2(k, 0, M.seed + 91) % 3);
    rowsY.push([y, y + h, k]);
    y += h;
    k++;
  }
  const rowOf = new Int32Array(M.H);
  rowsY.forEach(([a, b], ri) => {
    for (let yy = Math.max(0, a); yy < Math.min(M.H, b); yy++) rowOf[yy] = ri;
  });
  const cuts = rowsY.map(([, , k2]) => {
    const list = [];
    let x = -(hash2(k2, 1, M.seed + 92) % 9);
    let s = 0;
    while (x < M.W + 12) {
      const w = 6 + (hash2(k2, s, M.seed + 93) % 6);
      list.push([x, x + w, s]);
      x += w;
      s++;
    }
    const at = new Int32Array(M.W);
    list.forEach(([a, b], si) => {
      for (let xx = Math.max(0, a); xx < Math.min(M.W, b); xx++) at[xx] = si;
    });
    return { list, at };
  });
  return { rowsY, rowOf, cuts };
}

function paintFloor(M, x, y, i, F) {
  const [mortar, base, alt, lit] = M.masonry.floor;
  const ri = F.rowOf[y],
    [y0, y1, rk] = F.rowsY[ri];
  const row = F.cuts[ri],
    si = row.at[x],
    [x0, x1] = row.list[si];
  const id = hash2(rk, si, M.seed + 94);
  let t;
  if (y === y1 - 1 || x === x1 - 1) t = mortar;
  else {
    const h = (id % 100) / 100;
    t = h < 0.6 ? base : h < 0.86 ? alt : lit;
    // Occasional hairline crack across a stone.
    if (id % 13 === 0 && x - x0 === y - y0 + 1) t = mortar;
    // Worn, lit chip on the upper-left corner of lit stones.
    if (t === lit && x === x0 && y === y0) t = up(lit, 1);
  }
  // Large, soft grime / light variation so big halls are not flat.
  const g = fbm(x, y, 44, M.seed + 95, 2);
  if (g < 0.32) t = down(t, 1);
  // Edge of the paving next to open ground: a dark kerb line.
  const W = M.W;
  const nonFloor = (k) => k !== G.FLOOR && k !== G.WALL;
  if ((x > 0 && nonFloor(M.mat[i - 1])) || (y > 0 && nonFloor(M.mat[i - W])) || (x < W - 1 && nonFloor(M.mat[i + 1])) || (y < M.H - 1 && nonFloor(M.mat[i + W])))
    t = mortar;
  return t;
}

const FACE_H = 10;
function paintWall(M, x, y) {
  const c = (x / CELL) | 0,
    r = (y / CELL) | 0,
    u = x % CELL,
    v = y % CELL;
  const isWall = (cc, rr) => M.inMap(cc, rr) && M.ground(cc, rr) === G.WALL;
  const southOpen = r + 1 < M.rows && !isWall(c, r + 1);
  const northOpen = r > 0 && !isWall(c, r - 1);
  const westOpen = c > 0 && !isWall(c - 1, r);
  const eastOpen = c + 1 < M.cols && !isWall(c + 1, r);
  const T = M.masonry.wallTop,
    Fc = M.masonry.wallFace;
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
        const h = hash2(bx, course + r * 7, M.seed + 101) % 10;
        t = h < 6 ? Fc[2] : h < 9 ? Fc[3] : Fc[4];
        if (k === 0 && h >= 9) t = up(Fc[4], 0);
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
  if (y % 7 === 6 || (x + off) % 10 === 9) t = T[0];
  else {
    const h = hash2(Math.floor((x + off) / 10), course, M.seed + 102) % 10;
    t = h < 7 ? T[1] : T[2];
  }
  if (fbm(x, y, 30, M.seed + 103) < 0.3) t = down(t, 1);
  // Parapets with merlons on exposed long edges.
  const merlonRow = (vv, from) => {
    const p = (x + 1) % 5;
    const m = p < 3;
    if (!m) return vv === from + 2 ? T[0] : T[0];
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

function paintGround(M) {
  const { W, H } = M;
  const F = floorLayout(M);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        m = M.mat[i];
      let t;
      switch (m) {
        case G.GRASS:
          t = paintLandLip(M, x, y, i, paintOpenGround(M, x, y, M.style.ground, i));
          break;
        case G.FOREST:
          // Same ground as open grass: the canopy and its shadows make the
          // forest, so the cell square never shows as a darker block.
          t = paintLandLip(M, x, y, i, paintOpenGround(M, x, y, M.style.ground, i));
          break;
        case G.ROCK:
          t = paintLandLip(M, x, y, i, paintOpenGround(M, x, y, M.style.rockGround, i));
          break;
        case G.SAND:
          t = paintLandLip(M, x, y, i, paintSand(M, x, y, i));
          break;
        case G.WATER:
          t = paintWater(M, x, y, i);
          break;
        case G.ICE:
          t = paintIce(M, x, y, i);
          break;
        case G.LAVA:
          t = paintLava(M, x, y, i);
          break;
        case G.SWAMP:
          t = paintSwamp(M, x, y, i, false);
          break;
        case G.ASWAMP:
          t = paintSwamp(M, x, y, i, true);
          break;
        case G.BOG:
          t = paintLandLip(M, x, y, i, paintBog(M, x, y, i, false));
          break;
        case G.ABOG:
          t = paintLandLip(M, x, y, i, paintBog(M, x, y, i, true));
          break;
        case G.FLOOR:
          t = paintFloor(M, x, y, i, F);
          break;
        case G.WALL:
          t = paintWall(M, x, y);
          break;
        default:
          t = R('ink', 5);
      }
      M.idx[i] = t;
    }
  // Emissive spill: lava and acid tint the ground right next to them.
  const src = M.mat;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        m = src[i];
      if (m === G.LAVA || m === G.ASWAMP || m === G.ABOG || m === G.WATER || HARD.has(m)) continue;
      let lava = 99,
        acid = 99;
      for (let j = -2; j <= 2; j++)
        for (let k = -2; k <= 2; k++) {
          const mm = M.matAt(x + k, y + j);
          const d = Math.max(Math.abs(j), Math.abs(k));
          if (mm === G.LAVA) lava = Math.min(lava, d);
          if (mm === G.ASWAMP) acid = Math.min(acid, d);
        }
      if (lava === 1) M.idx[i] = R('ember', 1);
      else if (lava === 2 && (x + y) % 2 === 0) M.idx[i] = R('ember', 1);
      else if (acid === 1 && m !== G.SWAMP) M.idx[i] = R('acid', 0);
    }
}

// ---------------------------------------------------------------- pass 4
function stampIf(M, x, y, rows, pick, allow) {
  for (let j = 0; j < rows.length; j++)
    for (let k = 0; k < rows[j].length; k++) {
      const ch = rows[j][k];
      if (ch === '.') continue;
      const X = x + k,
        Y = y + j;
      if (X < 0 || Y < 0 || X >= M.W || Y >= M.H) continue;
      const i = Y * M.W + X;
      if (!allow(M.mat[i], i)) continue;
      M.idx[i] = pick(ch, M.idx[i]);
    }
}

// Tufts are drawn relative to the ground under them: d = one ramp step
// darker, h = one step lighter, b = the biome's blade colour.
const TUFTS = [
  ['d.d', '.d.'],
  ['d.d.d', '.d.d.'],
  ['h..', 'dh.', '.d.'],
  ['..h', '.hd', '.d.'],
];
const DRY_TUFTS = [
  ['b.b', 'hbh', 'd.d'],
  ['.b', 'bh', 'dd'],
];

function paintDecals(M) {
  const { W, H, seed, style } = M;
  const openGround = (m) => m === G.GRASS || m === G.FOREST || m === G.ROCK;
  // Lit clumps: little mounds, lit on top, shaded underneath. These give
  // the ground a directional-light texture without speckle.
  for (const p of jitteredPoints(0, 0, W, H, 9, seed + 201)) {
    const i = p.y * W + p.x,
      m = M.mat[i];
    if (!openGround(m) || M.dAny(i) < 3 || p.r > 0.62) continue;
    const s = m === G.FOREST ? style.forestFloor : m === G.ROCK ? style.rockGround : style.ground;
    const rx = 2 + (p.r * 5) % 2,
      w = rx * 2 + 1;
    const rows = p.r < 0.3 ? ['.hhh.', 'hbbbd', '.ddd.'] : ['.hh.', 'hbbd', '.dd.'];
    stampIf(M, p.x - (w >> 1), p.y - 1, rows, (ch, cur) => (ch === 'h' ? up(cur, 1) : ch === 'd' ? down(cur, 1) : cur), (mm, ii) => mm === m && M.dAny(ii) >= 2);
  }
  // Grass tufts.
  if (style.tufts) {
    const set = style.tufts === 'dry' ? DRY_TUFTS : TUFTS;
    for (const p of jitteredPoints(0, 0, W, H, 10, seed + 211)) {
      const i = p.y * W + p.x,
        m = M.mat[i];
      const limit = m === G.SAND ? 0.3 : style.tufts === 'dry' ? 0.14 : 0.4;
      if (!(m === G.GRASS || m === G.ROCK || m === G.SAND || m === G.BOG) || p.r > limit) continue;
      if (M.dAny(i) < 2 && m !== G.SAND) continue;
      if (m === G.SAND && M.dAny(i) > 4) continue; // grass creeps in at sand edges only
      const s = m === G.ROCK ? style.rockGround : style.ground;
      const rows = set[hash2(p.gx, p.gy, seed + 212) % set.length];
      const blade = m === G.BOG ? R('earth', 4) : m === G.SAND ? style.ground.light : s.blade;
      const hi = m === G.BOG ? R('earth', 5) : m === G.SAND ? style.ground.hi : up(s.blade, 1);
      const dry = style.tufts === 'dry' || m === G.BOG || m === G.SAND;
      stampIf(
        M,
        p.x,
        p.y - 2,
        rows,
        (ch, cur) => (ch === 'b' ? blade : ch === 'h' ? (dry ? hi : up(cur, 1)) : down(cur, 1)),
        (mm) => mm === m || (m === G.SAND && openGround(mm)),
      );
    }
  }
  // Small stones and flowers on open ground.
  for (const p of jitteredPoints(0, 0, W, H, 13, seed + 221)) {
    const i = p.y * W + p.x,
      m = M.mat[i];
    if (!(openGround(m) || m === G.SAND) || M.dAny(i) < 3) continue;
    if (p.r < (m === G.ROCK ? 0.4 : 0.05)) {
      const stone = M.biome === 'volcano' ? [R('ash', 5), R('ash', 4)] : M.biome === 'tundra' ? [R('stone', 4), R('stone', 3)] : [R('ink', 8), R('ink', 7)];
      stampIf(M, p.x, p.y, p.r < 0.06 ? ['ab.', 'bbd'] : ['a.', 'bd'], (ch, cur) => (ch === 'a' ? stone[0] : ch === 'b' ? stone[1] : down(cur, 1)), (mm) => mm === m);
    } else if (style.flowers && m === G.GRASS && p.r > 0.965) {
      const col = style.flowers[hash2(p.gx, p.gy, seed + 222) % style.flowers.length];
      stampIf(M, p.x, p.y, ['f.f', '.f.'], () => col, (mm) => mm === m);
    }
  }
  // Water ripples: short horizontal strokes, one ramp step lighter.
  for (const p of jitteredPoints(0, 0, W, H, 8, seed + 231)) {
    const i = p.y * W + p.x;
    if (M.mat[i] !== G.WATER || M.dAny(i) < 4 || M.dU[i] < 6 || p.r > 0.5) continue;
    const len = 3 + (((p.r * 20) | 0) % 4);
    for (let k = 0; k < len; k++) {
      if (p.x + k < W && M.mat[i + k] === G.WATER && M.dAny(i + k) >= 3) M.idx[i + k] = up(M.idx[i + k], 1);
    }
  }
  // Swamp: lily pads, reeds at the edges; bog: puddles; acid: bubbles.
  for (const p of jitteredPoints(0, 0, W, H, 7, seed + 241)) {
    const i = p.y * W + p.x,
      m = M.mat[i];
    if (m === G.SWAMP && M.dAny(i) >= 3 && p.r < 0.3) {
      stampIf(M, p.x - 1, p.y - 1, ['.hh.', 'hbb.', '.bbd'], (ch, cur) => (ch === 'h' ? R('foliage', 7) : ch === 'b' ? R('foliage', 6) : R('foliage', 3)), (mm) => mm === G.SWAMP);
    } else if ((m === G.SWAMP || m === G.ASWAMP) && M.dAny(i) <= 4 && p.r < 0.75) {
      // reed cluster
      const n = 2 + (p.r * 7) % 3;
      for (let k = 0; k < n; k++) {
        const X = p.x + k * 2 - n,
          h = 3 + (hash2(p.x + k, p.y, seed + 242) % 3);
        for (let j = 0; j < h; j++) {
          const Y = p.y - j;
          if (X < 0 || Y < 0 || X >= W) continue;
          M.idx[Y * W + X] = j === h - 1 ? R('earth', 5) : j === 0 ? R('foliage', 2) : R('earth', 4);
        }
      }
    } else if (m === G.ASWAMP && p.r < 0.5) {
      stampIf(M, p.x - 1, p.y - 1, ['.h.', 'hdh', '.h.'], (ch) => (ch === 'h' ? R('acid', 4) : R('acid', 1)), (mm) => mm === G.ASWAMP);
    } else if ((m === G.BOG || m === G.ABOG) && M.dAny(i) >= 3 && p.r < 0.45) {
      const acid = m === G.ABOG && p.r < 0.3;
      const rows = p.r < 0.2 ? ['.ddd.', 'dwwwl', '.lll.'] : ['.dd.', 'dwwl', '.ll.'];
      stampIf(
        M,
        p.x - 2,
        p.y - 1,
        rows,
        (ch, cur) => (ch === 'd' ? (acid ? R('acid', 1) : R('steel', 0)) : ch === 'w' ? (acid ? R('acid', 3) : R('steel', 1)) : acid ? R('acid', 4) : up(cur, 1)),
        (mm) => mm === m,
      );
    }
  }
}

// ---------------------------------------------------------------- pass 6
function wallShadows(M) {
  // Walls are the tallest mass: a band below the face and a long slanted
  // shadow east of any east-facing edge.
  const { W, H } = M;
  const isWall = (c, r) => M.inMap(c, r) && M.ground(c, r) === G.WALL;
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c < M.cols; c++) {
      if (!isWall(c, r)) continue;
      if (r + 1 < M.rows && !isWall(c, r + 1)) {
        for (let j = 0; j < 4; j++)
          for (let k = 0; k < CELL; k++) {
            const x = c * CELL + k + Math.floor(j / 2),
              y = (r + 1) * CELL + j;
            if (x < W && y < H) M.shadow[y * W + x] = Math.max(M.shadow[y * W + x], j === 0 ? 2 : 1);
          }
      }
      if (c + 1 < M.cols && !isWall(c + 1, r)) {
        for (let v = 0; v < CELL + 3; v++)
          for (let k = 0; k < 6; k++) {
            const x = (c + 1) * CELL + k,
              y = r * CELL + v + 3 + Math.floor(k / 2);
            if (k > 1 + v * 0.8) continue; // slanted leading edge
            if (x < W && y < H && M.mat[y * W + x] !== G.WALL) M.shadow[y * W + x] = Math.max(M.shadow[y * W + x], 1);
          }
      }
    }
}

function applyShadows(M) {
  const { W, H } = M;
  for (let i = 0; i < W * H; i++) {
    const s = M.shadow[i];
    if (!s || M.mat[i] === G.WALL) continue;
    M.idx[i] = down(M.idx[i], s);
  }
}

// ---------------------------------------------------------------- driver
export function renderTerrain(names, { biome = 'grassland', seed = 1 } = {}) {
  const M = new TerrainContext(names, biome, seed);
  resolveMaterials(M);
  computeEdges(M);
  paintGround(M);
  paintDecals(M);
  paintBridges(M);
  const objects = buildObjects(M);
  wallShadows(M);
  for (const o of objects) o.castShadow(M);
  applyShadows(M);
  objects.sort((a, b) => a.baseY - b.baseY || a.x - b.x);
  for (const o of objects) o.commit(M);
  return { idx: M.idx, w: M.W, h: M.H, cols: M.cols, rows: M.rows, context: M };
}
