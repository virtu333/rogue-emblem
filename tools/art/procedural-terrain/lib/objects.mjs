// Tall terrain objects as small procedural sprites. Each sprite knows its
// ground line (baseY) so it can (a) project a low-sun shadow toward the
// bottom-right and (b) be painted back-to-front with its neighbours, which is
// what lets forest crowns merge into one canopy and peaks form ranges.
import { R, down, up } from './palette.mjs';
import { rand2, hash2, valueNoise, jitteredPoints } from './noise.mjs';
import { G } from './biomes.mjs';

const CELL = 24;
const key = (x, y) => (y + 4096) * 16384 + (x + 4096);

export class Sprite {
  constructor(x, baseY, shadow = { a: 0.5, b: 0.25 }) {
    this.x = x;
    this.baseY = baseY;
    this.shadowK = shadow;
    this.px = new Map();
  }
  set(x, y, c) {
    this.px.set(key(x, y), [x, y, c]);
  }
  has(x, y) {
    return this.px.has(key(x, y));
  }
  get(x, y) {
    return this.px.get(key(x, y))?.[2];
  }
  // Selective outline: dark on the bottom/right silhouette edge (away from
  // the light), optional warm rim on the top/left edge.
  outline({ dark = null, darkSteps = 2, rim = false, skipBottom = false } = {}) {
    const next = [];
    for (const [x, y, c] of this.px.values()) {
      const openR = !this.has(x + 1, y),
        openD = !this.has(x, y + 1) && !skipBottom;
      const openL = !this.has(x - 1, y),
        openU = !this.has(x, y - 1);
      if (openR || openD) next.push([x, y, dark ?? down(c, darkSteps)]);
      else if (rim && (openL || openU)) next.push([x, y, up(c, 1)]);
    }
    for (const [x, y, c] of next) this.set(x, y, c);
  }
  castShadow(M) {
    if (!this.shadowK) return;
    const { a, b } = this.shadowK;
    // Billboard projection: a pixel h rows above the ground line lands
    // h*(a, b) toward the bottom-right of its foot (low sun, upper-left).
    for (const [x, y] of this.px.values()) {
      const h = Math.max(0, this.baseY - y);
      const sx = Math.round(x + h * a),
        sy = y >= this.baseY ? y : Math.round(this.baseY + h * b);
      for (const [X, Y] of [
        [sx, sy],
        [sx + 1, sy],
      ]) {
        if (X < 0 || Y < 0 || X >= M.W || Y >= M.H) continue;
        const i = Y * M.W + X;
        if (M.mat[i] === G.WALL) continue;
        M.shadow[i] = Math.max(M.shadow[i], 1);
      }
    }
  }
  commit(M) {
    for (const [x, y, c] of this.px.values()) M.set(x, y, c);
  }
}

// ------------------------------------------------------------------ trees
const LIGHT = (() => {
  const v = [-0.55, -0.7, 0.55],
    n = Math.hypot(...v);
  return v.map((k) => k / n);
})();

function crownSprite(M, s, cx, cy, Rr, seed, leaf, opts = {}) {
  const clumps = [{ x: cx, y: cy, r: Rr }];
  const n = 4 + (hash2(cx, cy, seed) % 2);
  for (let k = 0; k < n; k++) {
    const ang = -Math.PI / 2 + (k / (n - 1) - 0.5) * 2.6 + (rand2(k, cx, seed + 1) - 0.5) * 0.5;
    const d = Rr * (0.52 + rand2(k, cy, seed + 2) * 0.18);
    clumps.push({
      x: cx + Math.cos(ang) * d,
      y: cy + Math.sin(ang) * d * 0.85,
      r: Rr * (0.5 + rand2(k, cx + cy, seed + 3) * 0.14),
    });
  }
  // two lower side lobes widen the base of the crown
  for (const side of [-1, 1])
    clumps.push({ x: cx + side * Rr * 0.5, y: cy + Rr * 0.3, r: Rr * 0.55 });
  const x0 = Math.floor(cx - Rr * 1.6),
    x1 = Math.ceil(cx + Rr * 1.6);
  const y0 = Math.floor(cy - Rr * 1.6),
    y1 = Math.ceil(cy + Rr * 1.3);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let best = null,
        bestD = 0;
      for (const cl of clumps) {
        const dx = x + 0.5 - cl.x,
          dy = y + 0.5 - cl.y;
        const dd = cl.r - Math.hypot(dx, dy);
        // later / lower clumps win ties so lobes read as overlapping
        if (dd > 0 && (best === null || dd + (cl.y - cy) * 0.08 > bestD)) {
          best = cl;
          bestD = dd + (cl.y - cy) * 0.08;
        }
      }
      if (!best) continue;
      const nx = (x + 0.5 - best.x) / best.r,
        ny = (y + 0.5 - best.y) / best.r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let I = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      I -= ((y - cy) / Rr) * 0.22; // whole crown: top lit, underside dark
      let tone = I > 0.86 ? 7 : I > 0.66 ? 6 : I > 0.42 ? 5 : I > 0.16 ? 4 : I > -0.12 ? 3 : 2;
      // Leaf breaks: sparse darker notches in the mid tones.
      if (tone >= 4 && tone <= 6 && valueNoise(x, y, 2.2, seed + 9) > 0.74) tone -= 1;
      s.set(x, y, leaf[tone]);
    }
  if (opts.strands) {
    for (let x = x0; x <= x1; x++) {
      if (rand2(x, cy, seed + 11) > 0.4) continue;
      let yb = null;
      for (let y = y1; y >= y0; y--)
        if (s.has(x, y)) {
          yb = y;
          break;
        }
      if (yb === null) continue;
      const len = 2 + (hash2(x, cy, seed + 12) % 3);
      for (let k = 1; k <= len; k++) s.set(x, yb + k, leaf[k === len ? 2 : 3]);
    }
  }
}

function broadleaf(M, x, baseY, Rr, seed, opts = {}) {
  const leaf = M.style.leaf;
  const s = new Sprite(x, baseY, { a: 0.55, b: 0.3 });
  const trunkH = 3;
  // trunk
  for (let y = baseY - trunkH - 3; y <= baseY; y++) {
    s.set(x, y, R('soil', 3));
    s.set(x + 1, y, R('soil', 1));
  }
  s.set(x - 1, baseY, R('soil', 2));
  s.set(x + 2, baseY, R('soil', 1));
  const cy = baseY - trunkH - Math.round(Rr * 0.8);
  crownSprite(M, s, x + 1, cy, Rr, seed, leaf, opts);
  s.outline({ dark: leaf[1] });
  return s;
}

function pine(M, x, baseY, height, seed) {
  const leaf = M.style.leaf;
  const snow = M.biome === 'tundra';
  const s = new Sprite(x, baseY, { a: 0.55, b: 0.3 });
  s.set(x, baseY, R('soil', 2));
  s.set(x, baseY - 1, R('soil', 2));
  s.set(x + 1, baseY, R('soil', 1));
  const tiers = 3;
  const top = baseY - height;
  const halfW = 5 + (hash2(x, baseY, seed) % 2);
  for (let t = 0; t < tiers; t++) {
    const ay = top + Math.round((t * height) / (tiers + 0.6));
    const by = top + Math.round(((t + 1.6) * height) / (tiers + 0.6));
    const w = Math.round(halfW * (0.55 + (0.45 * (t + 1)) / tiers));
    for (let y = ay; y <= by; y++) {
      const k = (y - ay) / Math.max(1, by - ay);
      const half = Math.max(0, Math.round(w * k + 0.3));
      for (let dx = -half; dx <= half; dx++) {
        let tone = dx < -half / 2 ? 6 : dx < 0 ? 5 : dx === 0 ? 4 : dx <= half / 2 ? 3 : 2;
        if (y === by) tone = Math.min(tone, 2);
        let c = leaf[tone];
        if (snow && y - ay <= 1 + (dx < 0 ? 1 : 0) && Math.abs(dx) <= half) c = dx <= 0 ? R('snow', 6) : R('snow', 4);
        else if (snow && dx === -half && k > 0.3) c = R('snow', 5);
        s.set(x + dx, y, c);
      }
    }
  }
  s.outline({ dark: leaf[1] });
  return s;
}

function deadTree(M, x, baseY, height, seed) {
  const L = M.style.leaf;
  const s = new Sprite(x, baseY, { a: 0.55, b: 0.3 });
  for (let y = baseY - height; y <= baseY; y++) {
    s.set(x, y, L[4]);
    s.set(x + 1, y, L[2]);
  }
  for (let b = 0; b < 3; b++) {
    const y0 = baseY - height + 2 + b * 3,
      dir = b % 2 ? 1 : -1,
      len = 3 + (hash2(x, b, seed) % 3);
    for (let k = 1; k <= len; k++) s.set(x + (dir > 0 ? 1 : 0) + dir * k, y0 - Math.floor(k / 2), k === len ? L[3] : L[4]);
  }
  s.outline({ dark: L[0] });
  return s;
}

function buildForest(M, out) {
  const { W, H, seed } = M;
  const isF = (c, r) => M.inMap(c, r) && M.name(c, r) === 'Forest';
  const count = new Map();
  const add = (c, r, sprite) => {
    out.push(sprite);
    count.set(`${c},${r}`, (count.get(`${c},${r}`) || 0) + 1);
  };
  const kind = M.style.tree;
  const make = (x, y, rr, gx, gy) => {
    if (kind === 'pine' || (kind === 'broadleaf' && rr < 0.12)) return pine(M, x, y, 13 + Math.round(rr * 30) % 5, seed + gx * 7 + gy);
    if (kind === 'dead') return deadTree(M, x, y, 10 + (hash2(gx, gy, seed) % 4), seed);
    return broadleaf(M, x, y, 6.5 + rr * 2.5, seed + gx * 131 + gy * 17, { strands: kind === 'willow' });
  };
  for (const p of jitteredPoints(0, 0, W, H, 9, seed + 400, 0.95)) {
    const c = (p.x / CELL) | 0,
      r = (p.y / CELL) | 0;
    if (!isF(c, r)) continue;
    const u = p.x % CELL,
      v = p.y % CELL;
    if (!isF(c - 1, r) && u < 5) continue;
    if (!isF(c + 1, r) && u > 18) continue;
    if (!isF(c, r + 1) && v > 21) continue;
    if (!isF(c, r - 1) && v < 10) continue;
    if (rand2(p.gx, p.gy, seed + 401) < 0.12) continue;
    add(c, r, make(p.x, p.y, p.r, p.gx, p.gy));
  }
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c < M.cols; c++)
      if (isF(c, r) && !count.get(`${c},${r}`)) add(c, r, make(c * CELL + 11, r * CELL + 19, 0.6, c, r));
}

// -------------------------------------------------------------- mountains
function peak(M, ax, ay, by, wl, wr, seed, secondary = false) {
  const st = M.style.rock;
  const s = new Sprite(ax, by, { a: 0.45, b: 0.2 });
  const hgt = by - ay;
  for (let y = ay; y <= by; y++) {
    const t = (y - ay) / hgt;
    const jagL = (valueNoise(0, y, 3, seed + 1) - 0.5) * 2.6 * Math.min(1, t * 3);
    const jagR = (valueNoise(9, y, 3, seed + 2) - 0.5) * 2.2 * Math.min(1, t * 3);
    const spread = Math.pow(t, 0.85);
    const xl = Math.round(ax - wl * spread + jagL),
      xr = Math.round(ax + wr * spread + jagR);
    const ridge = ax + (y - ay) * 0.22 + (valueNoise(4, y, 4, seed + 3) - 0.5) * 2;
    const capLine = 0.34 + (valueNoise(ax, y, 3, seed + 4) - 0.5) * 0.2;
    for (let x = xl; x <= xr; x++) {
      let c;
      const lit = x < ridge;
      if (lit) {
        const k = t < 0.3 ? 3 : t < 0.62 ? 2 : 1;
        c = st.lit[k];
        // strata: short dark ledges on the lit face
        const band = (y + Math.floor((x - xl) * 0.35)) % 5;
        if (band === 0 && hash2(Math.floor(x / 3), y, seed + 5) % 3 === 0 && x > xl + 1 && x < ridge - 1) c = st.lit[Math.max(0, k - 1)];
        if (Math.abs(x - ridge) < 1 && t < 0.8) c = st.lit[3];
      } else {
        const k = t < 0.4 ? 2 : t < 0.75 ? 1 : 0;
        c = st.shade[k + 1];
        const band = (y + Math.floor((xr - x) * 0.4)) % 6;
        if (band === 0 && hash2(Math.floor(x / 3), y, seed + 6) % 3 === 0 && x > ridge + 1) c = st.shade[Math.min(3, k + 2)];
        if (x >= xr - 1) c = st.shade[0];
      }
      if (st.cap && t < capLine) c = lit ? st.cap.lit[t < capLine * 0.5 ? 2 : 1] : st.cap.shade[1];
      if (st.ember && !lit && t > 0.7 && hash2(x, y, seed + 7) % 23 === 0) c = R('ember', 2);
      s.set(x, y, c);
    }
  }
  // boulders at the foot
  if (!secondary)
    for (const side of [-1, 1]) {
      const bx = Math.round(ax + side * (side < 0 ? wl : wr) * 0.95),
        byy = by - 1;
      if (hash2(bx, byy, seed + 8) % 2) continue;
      s.set(bx, byy - 1, st.lit[2]);
      s.set(bx + 1, byy - 1, st.lit[1]);
      s.set(bx, byy, st.lit[1]);
      s.set(bx + 1, byy, st.shade[1]);
      s.set(bx + 2, byy, st.shade[0]);
    }
  s.outline({ dark: st.outline });
  return s;
}

function buildMountains(M, out) {
  const seed = M.seed;
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c < M.cols; c++) {
      if (M.name(c, r) !== 'Mountain') continue;
      const h = (k) => rand2(c, r, seed + 300 + k);
      const ax = c * CELL + 12 + Math.round((h(1) - 0.5) * 6);
      const ay = r * CELL - 2 - Math.round(h(2) * 5);
      const by = r * CELL + 21;
      if (h(5) < 0.6) {
        const side = h(6) < 0.5 ? -1 : 1;
        out.push(peak(M, ax + side * 8, r * CELL + 6 + Math.round(h(7) * 3), by - 1, 7, 7, seed + c * 17 + r * 3 + 1, true));
      }
      out.push(peak(M, ax, ay, by, 11 + Math.round(h(3) * 2), 10 + Math.round(h(4) * 3), seed + c * 31 + r * 7));
    }
}

// ------------------------------------------------------------ structures
function rect(s, ox, oy, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s.set(ox + x, oy + y, typeof c === 'function' ? c(x, y) : c);
}

function fort(M, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(ox + 12, oy + 21, { a: 0.5, b: 0.25 });
  const S = (k) => R('stone', k);
  // curtain wall between the towers
  rect(s, ox, oy, 7, 7, 17, 21, (x, y) => {
    if (y === 7) return x % 2 ? S(5) : null;
    if (y < 10) return y === 9 ? S(5) : S(3);
    if (y === 20) return R('ink', 3);
    const course = Math.floor((y - 10) / 3);
    if ((y - 10) % 3 === 2 || (x + course * 2) % 5 === 0) return S(3);
    return S(4);
  });
  // gate
  rect(s, ox, oy, 10, 13, 14, 20, (x, y) => (y === 13 && (x === 10 || x === 13) ? S(4) : x === 10 || y === 14 ? R('ink', 2) : x % 2 ? R('soil', 2) : R('soil', 1)));
  // towers
  for (const tx of [2, 16]) {
    rect(s, ox, oy, tx, 1, tx + 6, 21, (x, y) => {
      const u = x - tx;
      if (y === 1) return u % 2 === 0 ? S(5) : null; // merlons
      if (y < 4) return u === 0 ? S(5) : u === 5 ? S(3) : S(4);
      if (y === 4) return S(5);
      if (y === 20) return R('ink', 3);
      if (u === 0) return S(5);
      if (u === 5) return S(2);
      if ((u === 2 || u === 3) && (y === 8 || y === 9)) return R('ink', 2);
      const course = Math.floor(y / 3);
      if (y % 3 === 0 && (u + course) % 2 === 0) return S(3);
      return u >= 4 ? S(3) : S(4);
    });
  }
  // clean null merlon gaps
  for (const [k, v] of [...s.px]) if (v[2] === null) s.px.delete(k);
  // banner on the right tower
  for (let y = -5; y < 1; y++) s.set(ox + 19, oy + y, R('soil', 1));
  rect(s, ox, oy, 20, -5, 23, -2, (x, y) => (y === -3 ? R('ember', 2) : x === 20 && y === -5 ? R('ember', 4) : R('ember', 3)));
  s.outline({ dark: R('ink', 3), darkSteps: 2 });
  return s;
}

function village(M, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(ox + 12, oy + 21, { a: 0.5, b: 0.25 });
  const E = (k) => R('ember', k),
    I = (k) => R('ink', k);
  // walls
  rect(s, ox, oy, 4, 11, 20, 21, (x, y) => {
    if (y === 20) return R('soil', 1);
    if (y === 11) return I(7);
    if (x === 4 || x === 19 || x === 12) return R('soil', 2);
    if (y === 15) return R('soil', 3);
    return x < 12 ? I(9) : I(8);
  });
  // door
  rect(s, ox, oy, 7, 15, 10, 20, (x) => (x === 9 ? R('soil', 1) : R('soil', 2)));
  // lit window (dusk: someone is home)
  rect(s, ox, oy, 14, 12, 18, 15, (x, y) => (x === 14 || x === 17 || y === 12 ? R('soil', 2) : y === 14 ? E(4) : E(5)));
  // hipped roof
  for (let y = 1; y <= 10; y++) {
    const inset = Math.max(0, 4 - (y - 1));
    for (let x = 3 + inset; x < 21 - inset; x++) {
      let col;
      if (y === 10) col = E(1);
      else if (y === 1) col = E(4);
      else if (x < 3 + inset + 2) col = E(3);
      else if (x >= 21 - inset - 2) col = E(1);
      else col = y % 2 === 0 ? E(1) : E(2);
      s.set(ox + x, oy + y, col);
    }
  }
  // chimney
  rect(s, ox, oy, 15, -2, 17, 2, (x, y) => (y === -2 ? R('stone', 4) : x === 15 ? R('stone', 3) : R('stone', 2)));
  // barrel + fence post: lived-in clutter
  rect(s, ox, oy, 20, 17, 22, 21, (x, y) => (y === 18 ? R('soil', 1) : x === 20 ? R('soil', 4) : R('soil', 3)));
  rect(s, ox, oy, 1, 16, 2, 21, R('soil', 3));
  s.set(ox + 1, oy + 16, R('soil', 5));
  s.outline({ dark: R('ink', 3) });
  return s;
}

function pillar(M, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(ox + 12, oy + 21, { a: 0.55, b: 0.3 });
  const broken = rand2(c, r, M.seed + 500) < 0.3;
  const S = (k) => R('stone', k);
  const shaft = [S(4), S(5), S(5), S(4), S(4), S(3), S(2), S(1)];
  const top = broken ? 2 + (hash2(c, r, M.seed) % 4) : -5;
  // plinth
  rect(s, ox, oy, 6, 18, 18, 21, (x, y) => (y === 18 ? (x < 12 ? S(5) : S(4)) : y === 20 ? S(1) : x < 8 ? S(4) : x > 15 ? S(2) : S(3)));
  // shaft
  for (let y = top; y < 18; y++)
    for (let u = 0; u < 8; u++) {
      if (broken && y < top + 2 && (u + y) % 3 === 0) continue;
      let col = shaft[u];
      if (u === 3 && (y - top) % 7 === 3) col = S(3); // stone drum joints
      s.set(ox + 8 + u, oy + y, col);
    }
  if (!broken) {
    rect(s, ox, oy, 7, -8, 17, -5, (x, y) => (y === -8 ? S(5) : y === -6 ? S(2) : x < 10 ? S(5) : x > 14 ? S(2) : S(4)));
  } else {
    // rubble at the foot
    for (const [dx, dy] of [
      [18, 20],
      [19, 20],
      [18, 19],
      [5, 20],
    ]) s.set(ox + dx, oy + dy, dy === 19 ? S(4) : S(3));
  }
  // a little moss at the base
  s.set(ox + 7, oy + 17, R('foliage', 5));
  s.set(ox + 6, oy + 17, R('foliage', 4));
  s.outline({ dark: R('ink', 3) });
  return s;
}

function throne(M, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(ox + 12, oy + 22, { a: 0.35, b: 0.18 });
  const S = (k) => R('stone', k);
  // dais with two steps
  rect(s, ox, oy, 2, 6, 22, 22, (x, y) => {
    if (y < 17) return y === 6 ? S(5) : x === 2 ? S(5) : x === 21 ? S(3) : S(4);
    if (y === 17) return S(5);
    if (y < 19) return S(3);
    if (y === 19) return S(4);
    return S(2);
  });
  // carpet runner down the steps
  rect(s, ox, oy, 9, 11, 15, 24, (x, y) => (x === 9 || x === 14 ? R('ember', 3) : y === 18 || y === 20 ? R('blood', 1) : R('blood', 2)));
  // chair
  rect(s, ox, oy, 7, -3, 17, 12, (x, y) => {
    if (y === -3) return x === 7 || x === 16 ? R('ember', 4) : x > 8 && x < 15 ? R('ember', 3) : null;
    if (x === 7 || x === 16) return R('ember', 3);
    if (x === 8 || x === 15) return R('soil', 1);
    if (y < 8) return y === -2 ? R('ember', 2) : x < 11 ? R('blood', 3) : R('blood', 2);
    if (y < 10) return R('blood', 3);
    return R('soil', 1);
  });
  for (const [k, v] of [...s.px]) if (v[2] === null) s.px.delete(k);
  s.outline({ dark: R('ink', 2) });
  return s;
}

function ballista(M, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(ox + 12, oy + 21, { a: 0.45, b: 0.22 });
  const W = (k) => R('soil', k);
  // axle + two spoked wheels
  rect(s, ox, oy, 5, 18, 19, 20, (x, y) => (y === 18 ? W(4) : W(1)));
  for (const wx of [2, 17])
    rect(s, ox, oy, wx, 15, wx + 5, 22, (x, y) => {
      const u = x - wx,
        v = y - 15;
      if ((u === 0 || u === 4) && (v === 0 || v === 6)) return null;
      if (u === 2 && v === 3) return W(6);
      if (u === 0 || v === 0) return W(4);
      if (u === 4 || v === 6) return W(1);
      return u === 2 || v === 3 ? W(3) : W(2);
    });
  // stock
  rect(s, ox, oy, 11, 4, 13, 19, (x) => (x === 11 ? W(5) : W(2)));
  // bow arms: thick arc curving back at the tips, iron-capped
  for (let x = 3; x <= 20; x++) {
    const d = Math.abs(x - 11.5);
    const y = 6 + Math.round((d * d) / 20);
    s.set(ox + x, oy + y, W(5));
    s.set(ox + x, oy + y + 1, W(2));
    s.set(ox + x, oy + y + 2, W(1));
    if (d > 7) {
      s.set(ox + x, oy + y, R('stone', 4));
      s.set(ox + x, oy + y + 1, R('stone', 2));
    }
  }
  // string drawn back to the nock
  for (let x = 4; x <= 19; x++) {
    const d = Math.abs(x - 11.5);
    const y = Math.round(14 - d * 0.55);
    if (!s.has(ox + x, oy + y)) s.set(ox + x, oy + y, R('ink', 8));
  }
  // bolt with a steel head
  rect(s, ox, oy, 11, 1, 13, 6, (x, y) => (y < 3 ? (x === 11 ? R('steel', 5) : R('steel', 3)) : W(6)));
  s.set(ox + 10, oy + 3, R('steel', 4));
  s.set(ox + 13, oy + 3, R('steel', 2));
  for (const [k, v] of [...s.px]) if (v[2] === null) s.px.delete(k);
  s.outline({ dark: R('ink', 3) });
  return s;
}

export function buildObjects(M) {
  const out = [];
  buildForest(M, out);
  buildMountains(M, out);
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c < M.cols; c++) {
      const n = M.name(c, r);
      if (n === 'Fort') out.push(fort(M, c, r));
      else if (n === 'Village') out.push(village(M, c, r));
      else if (n === 'Pillar') out.push(pillar(M, c, r));
      else if (n === 'Throne') out.push(throne(M, c, r));
      else if (n === 'Ballista') out.push(ballista(M, c, r));
    }
  return out;
}

// ---------------------------------------------------------------- bridges
export function paintBridges(M) {
  const { W, H } = M;
  const isB = (c, r) => M.inMap(c, r) && M.name(c, r) === 'Bridge';
  const isWater = (c, r) => M.inMap(c, r) && (M.name(c, r) === 'Water' || M.name(c, r) === 'River');
  const orient = (c, r) => {
    const lr = isB(c - 1, r) || isB(c + 1, r),
      ud = isB(c, r - 1) || isB(c, r + 1);
    const waterNS = isWater(c, r - 1) || isWater(c, r + 1);
    return lr || (!ud && waterNS) ? 1 : 2;
  };
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c < M.cols; c++) {
      if (!isB(c, r)) continue;
      const o = orient(c, r),
        rects = [];
      if (o === 1) {
        const up = isB(c, r - 1) && orient(c, r - 1) === 1,
          dn = isB(c, r + 1) && orient(c, r + 1) === 1;
        rects.push([0, up ? 0 : 5, 24, dn ? 24 : 19]);
        if (isB(c, r - 1) && !up) rects.push([6, 0, 18, 5]);
        if (isB(c, r + 1) && !dn) rects.push([6, 19, 18, 24]);
      } else {
        const lf = isB(c - 1, r) && orient(c - 1, r) === 2,
          rt = isB(c + 1, r) && orient(c + 1, r) === 2;
        rects.push([lf ? 0 : 6, 0, rt ? 24 : 18, 24]);
      }
      for (const [x0, y0, x1, y1] of rects)
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) M.deck[(r * CELL + y) * W + c * CELL + x] = o;
    }
  const S = (k) => R('soil', k);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        o = M.deck[i];
      if (!o) continue;
      const d = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : M.deck[yy * W + xx]);
      let c;
      if (o === 1) {
        const plank = Math.floor(x / 3);
        c = x % 3 === 2 ? S(2) : hash2(plank, Math.floor(y / 24), M.seed + 601) % 4 === 0 ? S(5) : S(4);
        if (x % 3 === 0 && x % 3 !== 2) c = up(c, 0);
        if (!d(x, y - 1)) c = S(6);
        else if (!d(x, y - 2)) c = S(3);
        if (!d(x, y + 1)) c = S(1);
        else if (!d(x, y + 2)) c = S(5);
        // end beams where the deck lands on the bank
        const cc = (x / CELL) | 0,
          rr = (y / CELL) | 0;
        if (x % CELL === 0 && !isB(cc - 1, rr) && !isWater(cc - 1, rr)) c = S(1);
        if (x % CELL === CELL - 1 && !isB(cc + 1, rr) && !isWater(cc + 1, rr)) c = S(1);
      } else {
        const plank = Math.floor(y / 3);
        c = y % 3 === 2 ? S(2) : hash2(plank, Math.floor(x / 24), M.seed + 602) % 4 === 0 ? S(5) : S(4);
        if (!d(x - 1, y)) c = S(6);
        else if (!d(x - 2, y)) c = S(3);
        if (!d(x + 1, y)) c = S(1);
        else if (!d(x + 2, y)) c = S(5);
        const cc = (x / CELL) | 0,
          rr = (y / CELL) | 0;
        if (y % CELL === 0 && !isB(cc, rr - 1) && !isWater(cc, rr - 1)) c = S(1);
        if (y % CELL === CELL - 1 && !isB(cc, rr + 1) && !isWater(cc, rr + 1)) c = S(1);
      }
      M.idx[i] = c;
      // shadow on the water below/right of the deck
      for (const [dx, dy] of [
        [1, 1],
        [1, 2],
        [2, 3],
        [2, 2],
      ]) {
        const X = x + dx,
          Y = y + dy;
        if (X < W && Y < H && !M.deck[Y * W + X] && M.mat[Y * W + X] === G.WATER) M.shadow[Y * W + X] = 1;
      }
    }
}
