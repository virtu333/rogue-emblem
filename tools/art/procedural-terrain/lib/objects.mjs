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
        if (snow && y - ay <= 1 + (dx < 0 ? 1 : 0) && Math.abs(dx) <= half)
          c = dx <= 0 ? R('snow', 6) : R('snow', 4);
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
    for (let k = 1; k <= len; k++)
      s.set(x + (dir > 0 ? 1 : 0) + dir * k, y0 - Math.floor(k / 2), k === len ? L[3] : L[4]);
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
    if (kind === 'pine') return pine(M, x, y, 13 + (Math.round(rr * 30) % 5), seed + gx * 7 + gy);
    if (kind === 'dead') return deadTree(M, x, y, 10 + (hash2(gx, gy, seed) % 4), seed);
    return broadleaf(M, x, y, 6.5 + rr * 2.5, seed + gx * 131 + gy * 17, {
      strands: kind === 'willow',
    });
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
      if (isF(c, r) && !count.get(`${c},${r}`))
        add(c, r, make(c * CELL + 11, r * CELL + 19, 0.6, c, r));
}

// -------------------------------------------------------------- mountains
// Mountains are a real heightfield (cones with jittered radius + ridged
// crests), rendered front-to-back per screen column like a voxel terrain.
// That gives true facets lit from the upper-left, occlusion lines where a
// near peak overlaps a far one, and ranges that merge across cells.
const MT_K = 0.95; // vertical exaggeration (screen px per unit of height)
const MT_LIGHT = (() => {
  const v = [-0.75, -0.2, 0.7],
    n = Math.hypot(...v);
  return v.map((k) => k / n);
})();

function mountainPeaks(M) {
  const isMt = (c, r) => M.inMap(c, r) && M.name(c, r) === 'Mountain';
  const peaks = [];
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c < M.cols; c++) {
      if (!isMt(c, r)) continue;
      const h = (k) => rand2(c, r, M.seed + 300 + k);
      const roll = h(0);
      let local;
      // [x, y, height, radius] in cell-local art px. Broad, low massifs:
      // a tall narrow cone reads as a shark fin at phone scale.
      if (roll < 0.4) local = [[12 + (h(1) - 0.5) * 4, 13 + (h(2) - 0.5) * 3, 13 + h(3) * 3, 12.5]];
      else if (roll < 0.85) {
        const flip = h(4) < 0.5 ? -1 : 1;
        local = [
          [12 - flip * (4 + h(1) * 2), 12 + h(2) * 2, 12.5 + h(3) * 3, 11],
          [12 + flip * (5 + h(5) * 2), 16 + h(6) * 2, 9 + h(7) * 3, 9.5],
        ];
      } else
        local = [
          [6 + h(1) * 2, 15 + h(2) * 2, 9 + h(3) * 2, 9],
          [12 + (h(5) - 0.5) * 3, 11 + h(6) * 2, 13 + h(7) * 3, 10.5],
          [18 - h(8) * 2, 16 + h(9) * 2, 8.5 + h(10) * 2, 9],
        ];
      for (const [px, py, H, rad] of local) {
        // keep the cone inside the cell on sides without mountain neighbours
        let x = c * CELL + px,
          y = r * CELL + py;
        const room = Math.min(
          isMt(c - 1, r) ? 99 : px + 1,
          isMt(c + 1, r) ? 99 : CELL + 1 - px,
          isMt(c, r + 1) ? 99 : CELL + 1 - py,
        );
        peaks.push({ x, y, H, rad: Math.min(rad, room + 2) });
      }
    }
  return peaks;
}

function mountainHeight(M, peaks, x, y) {
  const c = Math.floor(x / CELL),
    r = Math.floor(y / CELL);
  const isMt = (cc, rr) => M.inMap(cc, rr) && M.name(cc, rr) === 'Mountain';
  if (!isMt(c, r)) {
    // allow a 2px skirt onto neighbouring cells so the base is not a square
    const u = x - c * CELL,
      v = y - r * CELL;
    const near =
      (u < 2 && isMt(c - 1, r)) ||
      (u > CELL - 3 && isMt(c + 1, r)) ||
      (v < 2 && isMt(c, r - 1)) ||
      (v > CELL - 3 && isMt(c, r + 1));
    if (!near) return 0;
  }
  // Taper toward cell sides without a mountain neighbour so the foot of the
  // range curves into the grass instead of being cut flat on the grid line.
  const u = x - c * CELL,
    v = y - r * CELL;
  let taper = 1;
  if (isMt(c, r)) {
    if (!isMt(c, r + 1)) taper = Math.min(taper, (CELL + 1 - v) / 7);
    if (!isMt(c - 1, r)) taper = Math.min(taper, (u + 2) / 6);
    if (!isMt(c + 1, r)) taper = Math.min(taper, (CELL + 1 - u) / 6);
  }
  taper = Math.max(0, Math.min(1, taper));
  let h = 0;
  const jitter = 1 + (valueNoise(x, y, 4, M.seed + 310) - 0.5) * 0.38;
  for (const p of peaks) {
    const dx = x + 0.5 - p.x,
      dy = (y + 0.5 - p.y) * 1.08;
    if (Math.abs(dx) > p.rad * 1.5 || Math.abs(dy) > p.rad * 1.5) continue;
    const ang = Math.atan2(dy, dx);
    // radiating spurs: the angular lobes become ridges with lit/shaded flanks
    const lobes = 1 + 0.22 * Math.sin(ang * 3 + p.x) + 0.13 * Math.sin(ang * 5 + p.y * 0.7);
    const d = (Math.hypot(dx, dy) / (p.rad * lobes)) * jitter;
    if (d >= 1) continue;
    h = Math.max(h, p.H * Math.pow(1 - d, 1.05));
  }
  if (h > 0)
    h += (1 - Math.abs(2 * valueNoise(x, y, 6, M.seed + 311) - 1)) * 2.2 * Math.min(1, h / 8);
  return h * (taper * taper * (3 - 2 * taper));
}

function buildMountains(M, out) {
  const peaks = mountainPeaks(M);
  if (!peaks.length) return;
  const { W, H } = M;
  const st = M.style.rock;
  const hmap = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) hmap[y * W + x] = mountainHeight(M, peaks, x, y);
  const hAt = (x, y) => hmap[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  // screen buffers
  const TOP = 12; // allow peaks to rise above the map's first row
  const SH = H + TOP;
  const gyBuf = new Int32Array(W * SH).fill(-1);
  const tone = new Int16Array(W * SH).fill(-1);
  const hBuf = new Float32Array(W * SH);
  for (let x = 0; x < W; x++) {
    let ybuf = SH;
    for (let y = H - 1; y >= 0; y--) {
      const h = hmap[y * W + x];
      if (h < 1.6) continue; // the foot is just the ground under it
      const ys = Math.round(y + TOP - h * MT_K);
      if (ys >= ybuf) continue;
      const gx = (hAt(x + 1, y) - hAt(x - 1, y)) / 2,
        gyy = (hAt(x, y + 1) - hAt(x, y - 1)) / 2;
      const n = [-gx, -gyy, 1],
        nl = Math.hypot(...n);
      let s = (n[0] * MT_LIGHT[0] + n[1] * MT_LIGHT[1] + n[2] * MT_LIGHT[2]) / nl;
      s += (h / 22) * 0.12; // summits a touch brighter
      for (let k = ys; k < Math.min(ybuf, y + TOP + 1); k++) {
        const i = k * W + x;
        gyBuf[i] = y;
        hBuf[i] = h;
        tone[i] = Math.round(s * 100);
      }
      ybuf = ys;
    }
  }
  const snowAt = (h, x, y) => st.cap && h > 9.5 + valueNoise(x, y, 5, M.seed + 312) * 4;
  const colorOf = (i, x, ys) => {
    const s = tone[i] / 100,
      h = hBuf[i];
    let lvl = s < 0.05 ? 0 : s < 0.28 ? 1 : s < 0.46 ? 2 : s < 0.62 ? 3 : s < 0.78 ? 4 : 5;
    // crag marks: sparse darker notches on lit faces
    if (lvl >= 3 && valueNoise(x, ys, 2.5, M.seed + 313) > 0.8) lvl -= 1;
    if (snowAt(h, x, ys)) return st.cap.ramp[lvl];
    let c = st.ramp[lvl + 1];
    if (st.ember && lvl <= 1 && h < 8 && hash2(x, ys, M.seed + 314) % 17 === 0) c = R('ember', 2);
    return c;
  };
  // per-cell sprites (so trees in front/behind still sort correctly)
  const sprites = new Map();
  const spriteFor = (c, r) => {
    const k = `${c},${r}`;
    if (!sprites.has(k)) {
      const s = new Sprite(c * CELL + 12, (r + 1) * CELL - 2, null);
      s.ground = [];
      sprites.set(k, s);
    }
    return sprites.get(k);
  };
  for (let ys = 0; ys < SH; ys++)
    for (let x = 0; x < W; x++) {
      const i = ys * W + x;
      if (gyBuf[i] < 0) continue;
      let col = colorOf(i, x, ys);
      const gy = gyBuf[i];
      const below = ys + 1 < SH ? gyBuf[i + W] : -1;
      const right = x + 1 < W ? gyBuf[i + 1] : -1;
      const left = x > 0 ? gyBuf[i - 1] : -1;
      const above = ys > 0 ? gyBuf[i - W] : -1;
      // outer silhouette: dark on bottom/right, nothing on top/left
      if (below < 0 || right < 0) col = st.outline;
      // occlusion: this pixel sits just behind a nearer peak -> dark line
      else if (
        (below >= 0 && below - gy > 3) ||
        (left >= 0 && left - gy > 4) ||
        (right >= 0 && right - gy > 4)
      )
        col = down(col, 2);
      // summit rim light where the top silhouette meets the sky/ground behind
      else if ((above < 0 || gy - above > 3) && tone[i] > 20) col = up(col, 1);
      const y = ys - TOP;
      const s = spriteFor(Math.floor(x / CELL), Math.floor(gy / CELL));
      s.set(x, y, col);
      s.ground.push([x, gy, hBuf[i]]);
    }
  for (const s of sprites.values()) {
    s.castShadow = function (MM) {
      for (const [x, gy, h] of this.ground) {
        const X = Math.round(x + h * 0.55),
          Y = Math.round(gy + h * 0.3);
        for (const XX of [X, X + 1]) {
          if (XX < 0 || Y < 0 || XX >= MM.W || Y >= MM.H) continue;
          const i = Y * MM.W + XX;
          if (MM.mat[i] !== G.WALL) MM.shadow[i] = Math.max(MM.shadow[i], 1);
        }
      }
    };
    out.push(s);
  }
}

// ------------------------------------------------------------ structures
function rect(s, ox, oy, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) s.set(ox + x, oy + y, typeof c === 'function' ? c(x, y) : c);
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
  rect(s, ox, oy, 10, 13, 14, 20, (x, y) =>
    y === 13 && (x === 10 || x === 13)
      ? S(4)
      : x === 10 || y === 14
        ? R('ink', 2)
        : x % 2
          ? R('soil', 2)
          : R('soil', 1),
  );
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
  rect(s, ox, oy, 20, -5, 23, -2, (x, y) =>
    y === -3 ? R('ember', 2) : x === 20 && y === -5 ? R('ember', 4) : R('ember', 3),
  );
  s.outline({ dark: R('ink', 3), darkSteps: 2 });
  return s;
}

// Small landmark structures are hand-authored masks (one letter per art
// pixel) shaded procedurally, so they read as deliberate icons while still
// varying per cell (roof material, lit window, clutter side).
function drawMask(s, ox, oy, rows, colorAt) {
  rows.forEach((row, v) => {
    [...row].forEach((ch, u) => {
      if (ch === '.' || ch === ' ') return;
      const col = colorAt(ch, u, v);
      if (col != null) s.set(ox + u, oy + v, col);
    });
  });
}

const HOUSE = [
  '......KKKKKKKKKK...SS.',
  '.....RRRRRRRRRRRR..SS.',
  '....RRRRRRRRRRRRRR.SS.',
  '...RRRRRRRRRRRRRRRRSS.',
  '..RRRRRRRRRRRRRRRRRRR.',
  '.RRRRRRRRRRRRRRRRRRRRR',
  'RRRRRRRRRRRRRRRRRRRRRR',
  'EEEEEEEEEEEEEEEEEEEEEE',
  '.TWWWWWWWTWWWWWWWWWWT.',
  '.TWWWWWWWTWWFFFFWWWWT.',
  '.TWWDDDWWTWWFGGFWWWWT.',
  '.TTTDDDTTTTTFggFTTTTT.',
  '.TWWDDDWWTWWFFFFWWWWT.',
  '.TWWDDdWWTWWWWWWWWWWT.',
  '.BBBDDdBBBBBBBBBBBBBB.',
];

function village(M, c, r) {
  const ox = c * CELL + 1,
    oy = r * CELL + 6;
  const s = new Sprite(c * CELL + 12, r * CELL + 20, { a: 0.5, b: 0.25 });
  const roll = rand2(c, r, M.seed + 520);
  // roof material: terracotta, thatch or slate
  const roof =
    roll < 0.5
      ? [R('ember', 1), R('ember', 2), R('ember', 3), R('ember', 4)]
      : roll < 0.85
        ? [R('earth', 2), R('earth', 3), R('earth', 4), R('earth', 5)]
        : [R('stone', 1), R('stone', 2), R('stone', 3), R('stone', 4)];
  const lit = rand2(c, r, M.seed + 521) < 0.75;
  const width = HOUSE[0].length;
  drawMask(s, ox, oy, HOUSE, (ch, u, v) => {
    switch (ch) {
      case 'K':
        return roof[3];
      case 'R': {
        // hip ends: lit on the left diagonal, shaded on the right one
        const row = HOUSE[v],
          first = row.indexOf('R'),
          last = row.lastIndexOf('R');
        if (u - first < 2) return roof[2];
        if (last - u < 2) return roof[0];
        // shingle courses, staggered
        if (v % 2 === 0) return roof[0];
        return (u + (v % 4 === 1 ? 0 : 2)) % 4 === 0
          ? roof[0]
          : u < width * 0.45
            ? roof[2]
            : roof[1];
      }
      case 'E':
        return R('ink', 3);
      case 'W':
        return v === 8 ? R('ink', 7) : u < 9 ? R('ink', 9) : R('ink', 8);
      case 'T':
        return R('soil', 2);
      case 'D':
        return R('soil', 3);
      case 'd':
        return R('soil', 1);
      case 'F':
        return R('soil', 1);
      case 'G':
        return lit ? R('ember', 5) : R('steel', 1);
      case 'g':
        return lit ? R('ember', 4) : R('steel', 0);
      case 'S':
        return v === 0 ? R('stone', 4) : u === 19 ? R('stone', 3) : R('stone', 2);
      case 'B':
        return R('soil', 1);
    }
    return null;
  });
  // clutter on one side: barrel or wood pile
  const side = rand2(c, r, M.seed + 522) < 0.5;
  const bx = side ? c * CELL + 20 : c * CELL + 1;
  for (let v = 0; v < 4; v++)
    for (let u = 0; u < 3; u++)
      s.set(
        bx + u,
        r * CELL + 17 + v,
        v === 1 ? R('soil', 1) : u === 0 ? R('soil', 5) : R('soil', 3),
      );
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
  rect(s, ox, oy, 6, 18, 18, 21, (x, y) =>
    y === 18 ? (x < 12 ? S(5) : S(4)) : y === 20 ? S(1) : x < 8 ? S(4) : x > 15 ? S(2) : S(3),
  );
  // shaft
  for (let y = top; y < 18; y++)
    for (let u = 0; u < 8; u++) {
      if (broken && y < top + 2 && (u + y) % 3 === 0) continue;
      let col = shaft[u];
      if (u === 3 && (y - top) % 7 === 3) col = S(3); // stone drum joints
      s.set(ox + 8 + u, oy + y, col);
    }
  if (!broken) {
    rect(s, ox, oy, 7, -8, 17, -5, (x, y) =>
      y === -8 ? S(5) : y === -6 ? S(2) : x < 10 ? S(5) : x > 14 ? S(2) : S(4),
    );
  } else {
    // rubble at the foot
    for (const [dx, dy] of [
      [18, 20],
      [19, 20],
      [18, 19],
      [5, 20],
    ])
      s.set(ox + dx, oy + dy, dy === 19 ? S(4) : S(3));
  }
  // a little moss at the base
  s.set(ox + 7, oy + 17, R('foliage', 5));
  s.set(ox + 6, oy + 17, R('foliage', 4));
  s.outline({ dark: R('ink', 3) });
  return s;
}

const THRONE = [
  '....GggggG....',
  '...gCCCCCCg...',
  '...gCccccCg...',
  '...gCccccCg...',
  '...gCccccCg...',
  '...gCccccCg...',
  '...gCccccCg...',
  '.AAgCCCCCCgAA.',
  '.AaasssssssaA.',
  '.ll........ll.',
];

function throne(M, c, r) {
  const ox = c * CELL,
    oy = r * CELL;
  const s = new Sprite(ox + 12, oy + 22, { a: 0.35, b: 0.18 });
  const S = (k) => R('stone', k);
  // dais: top plate, lip, two steps
  rect(s, ox, oy, 1, 7, 23, 22, (x, y) => {
    if (y < 16) return y === 7 ? S(5) : x === 1 ? S(5) : x === 22 ? S(3) : S(4);
    if (y === 16) return S(5);
    if (y < 18) return S(3);
    if (y === 18) return S(4);
    if (y < 21) return S(2);
    return S(1);
  });
  // carpet from the chair to the cell edge, gold-trimmed
  rect(s, ox, oy, 9, 15, 15, 24, (x, y) =>
    x === 9 || x === 14
      ? R('ember', 3)
      : y === 17 || y === 20
        ? R('blood', 1)
        : x < 12
          ? R('blood', 3)
          : R('blood', 2),
  );
  // the chair sits on the dais: seat on the top plate, back rising above it
  drawMask(s, ox + 5, oy + 1, THRONE, (ch, u, v) => {
    switch (ch) {
      case 'G':
        return R('ember', 5);
      case 'g':
        return u < 7 ? R('ember', 4) : R('ember', 3);
      case 'C':
        return u < 7 ? R('blood', 3) : R('blood', 2);
      case 'c':
        return u < 7 ? R('blood', 4) : R('blood', 3);
      case 's':
        return R('blood', 3);
      case 'A':
        return v === 7 ? R('soil', 5) : R('soil', 3);
      case 'a':
        return R('soil', 1);
      case 'l':
        return R('soil', 1);
    }
    return null;
  });
  s.outline({ dark: R('ink', 2) });
  return s;
}

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
  '....PPPPPPXXPPPPPP....',
  '....pP....XX....Pp....',
  '....QP....XX....PQ....',
  '...QQq...QXXQ...qQQ...',
  '...q.q...q..q...q.q...',
];

function ballista(M, c, r) {
  const ox = c * CELL + 1,
    oy = r * CELL + 6;
  const s = new Sprite(c * CELL + 12, r * CELL + 20, { a: 0.45, b: 0.22 });
  drawMask(s, ox, oy, BALLISTA, (ch, u) => {
    switch (ch) {
      case 'H':
        return R('steel', 5);
      case 'h':
        return R('steel', 3);
      case 'b':
        return u === 10 ? R('soil', 7) : R('soil', 5);
      case 'L':
        return R('stone', 4);
      case 'A':
        return R('soil', 4);
      case 'a':
        return R('soil', 1);
      case 'X':
        return u === 10 ? R('stone', 4) : R('stone', 2);
      case 's':
        return R('ink', 9);
      case 'P':
        return R('soil', 5);
      case 'p':
        return R('soil', 2);
      case 'Q':
        return R('soil', 3);
      case 'q':
        return R('soil', 1);
    }
    return null;
  });
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
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) M.deck[(r * CELL + y) * W + c * CELL + x] = o;
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
        c =
          x % 3 === 2
            ? S(2)
            : hash2(plank, Math.floor(y / 24), M.seed + 601) % 4 === 0
              ? S(5)
              : S(4);
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
        c =
          y % 3 === 2
            ? S(2)
            : hash2(plank, Math.floor(x / 24), M.seed + 602) % 4 === 0
              ? S(5)
              : S(4);
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
        if (X < W && Y < H && !M.deck[Y * W + X] && M.mat[Y * W + X] === G.WATER)
          M.shadow[Y * W + X] = 1;
      }
    }
}
