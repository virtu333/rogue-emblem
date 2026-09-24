// Forest cells: natural, varied woods whose trees still mostly fit their cell.
//
// Owner feedback: the study's trees were too big for their squares, then the
// first runtime overcorrected into one uniform 2-4 tree stamp per cell. Here
// a forest cell is planted from a context-free set of well-spaced foot
// positions, and each position becomes a tree (of one of several species and
// any size from sapling to one large crown), a shrub or a log, or stays
// empty, depending on how much forest surrounds that corner of the cell:
//
//   - each foot position belongs to a quadrant of the cell, and its tree is
//     decided from the 2x2 block of cells that share that corner (how many of
//     them are forest), so interior cells grow dense and tall, edges sparse
//     and low, and a lone forest cell becomes one tree or a small copse;
//   - one "hero" tree per cell depends on nothing but the cell itself, so it
//     may spill a little over every side;
//   - a tree may spill up to TREE_OVERHANG px over the top and sides only
//     toward the cells its quadrant can see, fewer pixels toward open ground
//     than toward more forest, and a trunk foot at most 1-2 px downward.
//
// Because a tree only paints into cells whose 3x3 neighbourhood contains the
// corner block it was decided from, a change still repaints only the changed
// cell's 3x3 neighbourhood (see Sprite.setDeps).
import { R } from './palette.js';
import { rand2, hash2, valueNoise, worley } from './noise.js';
import { Sprite } from './sprite.js';
import { ART_CELL as CELL } from './state.js';

export const TREE_OVERHANG = Object.freeze({ side: 4, top: 4, bottom: 2 });

const LIGHT = (() => {
  const v = [-0.55, -0.7, 0.55],
    n = Math.hypot(...v);
  return v.map((k) => k / n);
})();

// ------------------------------------------------------------------ crowns
/**
 * A lobed, leafy crown: overlapping spherical lobes (lower lobes in front),
 * lit from the upper left, with a leaf-clump texture of small bumps that
 * each catch the light on their upper-left side.
 */
function crown(s, cx, cy, Rr, seed, leaf, o = {}) {
  const sqx = o.squashX ?? 1,
    sqy = o.squashY ?? 0.92;
  const lobes = [{ x: cx, y: cy + Rr * 0.08, r: Rr * 0.8 }];
  const n = Math.max(2, Math.min(6, 2 + Math.round(Rr / 2.2)));
  for (let k = 0; k < n; k++) {
    const ang =
      Math.PI * (-0.95 + (0.9 * k) / Math.max(1, n - 1)) + (rand2(k, seed, 1) - 0.5) * 0.7;
    const d = Rr * (0.42 + rand2(k, seed, 2) * 0.2);
    lobes.push({
      x: cx + Math.cos(ang) * d * sqx,
      y: cy + Math.sin(ang) * d * sqy,
      r: Rr * (0.46 + rand2(k, seed, 3) * 0.16),
    });
  }
  for (const side of [-1, 1])
    lobes.push({
      x: cx + side * Rr * (0.42 + rand2(side, seed, 4) * 0.1) * sqx,
      y: cy + Rr * 0.36 * sqy,
      r: Rr * (0.5 + rand2(side, seed, 5) * 0.08),
    });
  const x0 = Math.floor(cx - Rr * 1.35),
    x1 = Math.ceil(cx + Rr * 1.35);
  const y0 = Math.floor(cy - Rr * 1.3),
    y1 = Math.ceil(cy + Rr * 1.1);
  const bumps = Rr >= 3.4;
  const BS = o.bump ?? 3.3;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (o.maxY !== undefined && y > o.maxY) continue;
      let best = null,
        bestS = 0;
      for (const L of lobes) {
        const dx = (x + 0.5 - L.x) / sqx,
          dy = (y + 0.5 - L.y) / sqy;
        const dd = L.r - Math.sqrt(dx * dx + dy * dy);
        const score = dd + (L.y - cy) * 0.1;
        if (dd > 0 && (best === null || score > bestS)) {
          best = L;
          bestS = score;
        }
      }
      if (!best) continue;
      const nx = (x + 0.5 - best.x) / sqx / best.r,
        ny = (y + 0.5 - best.y) / sqy / best.r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let I = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      I -= ((y - cy) / Rr) * 0.22; // whole crown: top lit, underside dark
      if (bumps) {
        const w = worley(x, y * 1.15, BS, seed + 50);
        const id = w.id,
          d1 = w.d1,
          seam = w.d2 - w.d1;
        const a = worley(x + 1, (y + 1) * 1.15, BS, seed + 50);
        if (a.id === id && a.d1 < d1) I += 0.13;
        else I -= 0.1;
        if (seam < 0.55 && I < 0.45) I -= 0.18;
      }
      const tone =
        I > 0.95 ? 8 : I > 0.74 ? 7 : I > 0.52 ? 6 : I > 0.3 ? 5 : I > 0.06 ? 4 : I > -0.2 ? 3 : 2;
      s.set(x, y, leaf[tone]);
    }
  if (o.strands) {
    // willow: hanging strands below the crown
    for (let x = x0; x <= x1; x++) {
      if (rand2(x, Math.round(cy), seed + 11) > 0.5) continue;
      let yb = null;
      for (let y = y1; y >= y0; y--)
        if (s.has(x, y)) {
          yb = y;
          break;
        }
      if (yb === null) continue;
      const len = 1 + (hash2(x, Math.round(cy), seed + 12) % 4);
      for (let k = 1; k <= len; k++)
        if (o.maxY === undefined || yb + k < o.maxY) s.set(x, yb + k, leaf[k === len ? 2 : 3]);
    }
  }
}

function trunk(s, x, baseY, top, cols, flare = true) {
  for (let y = top; y <= baseY; y++) {
    s.set(x, y, cols[1]);
    s.set(x + 1, y, cols[0]);
  }
  if (flare) {
    s.set(x - 1, baseY, cols[0]);
    s.set(x + 2, baseY, cols[0]);
  }
}

// ----------------------------------------------------------------- species
// Every painter draws a tree standing at foot (x, baseY) with size 0..1 and
// returns its sprite. HEIGHT estimates each species' height (px above the
// foot) for a size, so the planner can pick sizes that fit.
const HEIGHT = {
  broadleaf: (z, dense) => (dense ? 0.6 : 2 + z * 1.2) + (3.5 + z * 5.4) * 1.9,
  birch: (z) => 3 + z * 1.2 + (2.6 + z * 4) * 1.95,
  willow: (z) => 1 + z + (3 + z * 5) * 1.9,
  poplar: (z) => 9 + z * 8,
  pine: (z) => 8 + z * 13,
  fir: (z) => 8 + z * 12,
  charpine: (z) => 7 + z * 10,
  cypress: (z) => 9 + z * 9,
  dead: (z) => 7 + z * 10,
  bare: (z) => 7 + z * 9,
  snag: (z) => 4 + z * 6,
  sapling: (z) => 1 + z * 2 + (2.6 + z * 1.6) * 1.9,
  spruceling: (z) => 4 + z * 4,
  bush: (z) => 3 + z * 3,
  thorn: (z) => 3 + z * 3,
  log: () => 3,
  stump: () => 3,
};

/** Half-width (px either side of the trunk) for a size, for planning. */
const HALF_W = {
  broadleaf: (z) => (3.5 + z * 5.4) * 1.12 + 1,
  birch: (z) => (2.6 + z * 4) * 0.95 + 1,
  willow: (z) => (3.5 + z * 5.4) * 1.25 + 1,
  poplar: (z) => 3.4 + z * 1.8,
  pine: (z) => 4 + z * 2.4,
  fir: (z) => 4.8 + z * 2.8,
  charpine: (z) => 4 + z * 2.4,
  cypress: (z) => 4.2 + z * 1.8,
  dead: (z) => 4 + z * 4,
  bare: (z) => 4 + z * 4,
  snag: () => 5,
  sapling: (z) => (2.6 + z * 1.6) * 1.05 + 1,
  spruceling: () => 5.5,
  bush: (z) => (2.2 + z * 1.8) * 1.4 + 1,
  thorn: () => 5,
  log: () => 8,
  stump: () => 3,
};

function broadleaf(S, t) {
  const st = S.style;
  const leaf = t.leaf || st.leaf;
  const Rr = 3.5 + t.size * 5.4;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const trunkH = t.dense ? (t.size < 0.5 ? 0 : 1) : t.size < 0.3 ? 1 : t.size < 0.65 ? 2 : 3;
  const cy = t.baseY - trunkH - Math.round(Rr * 0.9);
  trunk(s, t.x, t.baseY, Math.round(cy), st.trunk, t.size > 0.45);
  crown(s, t.x + 1, cy, Rr, t.seed, leaf, { strands: t.strands, maxY: t.baseY, ...t.crown });
  s.outline({ dark: leaf[1], rim: true });
  return s;
}

function birch(S, t) {
  // Light, small-leaved crown on a pale trunk with dark bark marks.
  const leaf = S.style.birch || S.style.leaf;
  const Rr = 2.6 + t.size * 4;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const trunkH = 2 + (t.size > 0.5 ? 1 : 0);
  const cy = t.baseY - trunkH - Math.round(Rr * 0.9);
  const bark = [R('ink', 8), R('ink', 10)];
  for (let y = Math.round(cy); y <= t.baseY; y++) {
    const mark = hash2(t.x, y, t.seed) % 4 === 0;
    s.set(t.x, y, mark ? R('ink', 4) : bark[1]);
    s.set(t.x + 1, y, mark ? R('ink', 3) : bark[0]);
  }
  crown(s, t.x + 1, cy, Rr, t.seed, leaf, { squashX: 0.82, maxY: t.baseY, bump: 2.6 });
  s.outline({ dark: leaf[1] });
  return s;
}

function poplar(S, t) {
  // Narrow, tall crown: a columnar silhouette for groves.
  const leaf = S.style.leaf2;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const h = Math.round(HEIGHT.poplar(t.size)),
    halfW = 2.2 + t.size * 1.8;
  const x = t.x;
  trunk(s, x, t.baseY, t.baseY - 2, S.style.trunk, false);
  const top = t.baseY - h,
    bottom = t.baseY - 2;
  const cy = (top + bottom) / 2,
    ry = (bottom - top) / 2;
  for (let y = top; y <= bottom; y++)
    for (let dx = -Math.ceil(halfW); dx <= Math.ceil(halfW) + 1; dx++) {
      const X = x + dx;
      const ny = (y + 0.5 - cy) / ry,
        nx = (X + 0.5 - (x + 1)) / halfW;
      // teardrop: widest below the middle
      const w = Math.sqrt(Math.max(0, 1 - ny * ny)) * (ny > -0.2 ? 1 : 0.85 + (ny + 1) * 0.19);
      if (Math.abs(nx) > w) continue;
      let I = -nx * 0.7 - ny * 0.45 + 0.1;
      if (valueNoise(X, y, 2, t.seed + 5) > 0.72) I -= 0.3; // leaf breaks
      const tone = I > 0.55 ? 7 : I > 0.25 ? 6 : I > -0.05 ? 5 : I > -0.4 ? 4 : 3;
      s.set(X, y, leaf[tone]);
    }
  s.outline({ dark: leaf[1] });
  return s;
}

function conifer(S, t, kind) {
  // Tiered conifer. pine: slim, open tiers; fir: broad, dense, snow-laden in
  // the tundra; charpine: a scorched pine with a broken top.
  const st = S.style;
  const leaf = kind === 'charpine' ? st.leaf : st.conifer || st.leaf;
  const snow = S.biome === 'tundra';
  const fir = kind === 'fir';
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const x = t.x,
    baseY = t.baseY;
  s.set(x, baseY, R('soil', 2));
  s.set(x, baseY - 1, R('soil', 2));
  s.set(x + 1, baseY, R('soil', 1));
  const height = Math.round(HEIGHT[kind](t.size));
  const tiers = Math.max(2, Math.min(5, 2 + Math.round(height / 6)));
  const top = baseY - height + (kind === 'charpine' ? 2 : 0);
  const halfW = (fir ? 3.8 : 3) + t.size * (fir ? 2.8 : 2.4);
  const span = baseY - 1 - top;
  // Bottom tier first: each tier's hem hangs over the tier below it, so
  // snow shows along the lit upper edges of the boughs, not as caps.
  for (let q = tiers - 1; q >= 0; q--) {
    const ay = top + Math.round((q * span) / (tiers + 0.5));
    const by = top + Math.round(((q + 1.5) * span) / (tiers + 0.5));
    const w = halfW * (0.45 + (0.55 * (q + 1)) / tiers);
    const jag = hash2(q, t.seed, 7);
    for (let y = ay; y <= by && y < baseY - 1; y++) {
      const k = (y - ay) / Math.max(1, by - ay);
      let half = Math.max(0, Math.round(w * k + 0.3));
      if (y === by && half > 1) half -= (jag >> 2) & 1; // ragged tier hem
      for (let dx = -half; dx <= half; dx++) {
        if (y === by && Math.abs(dx) === half && (jag >> (dx + 8)) & 1) continue;
        let tone = dx < -half / 2 ? 6 : dx < 0 ? 5 : dx === 0 ? 4 : dx <= half / 2 ? 3 : 2;
        if (y === by) tone = Math.min(tone, 2);
        let col = leaf[tone];
        if (snow) {
          const edge = Math.abs(dx) >= half - (fir ? 1 : 0);
          if (q === 0 && y - ay <= 1) col = dx <= 0 ? R('snow', 7) : R('snow', 5);
          else if (edge && dx < 0 && k < 0.9) col = R('snow', k < 0.5 ? 7 : 6);
          else if (edge && dx > 0 && k < 0.5) col = R('snow', 4);
          else if (fir && dx < 0 && hash2(dx, y, t.seed) % 7 === 0) col = R('snow', 6);
        } else if (kind === 'charpine' && (dx + y + t.seed) % 5 === 0) col = leaf[1];
        s.set(x + dx, y, col);
      }
    }
  }
  if (kind === 'charpine') {
    // bare, broken leader above the tiers
    for (let y = top - 2; y < top + 1; y++) s.set(x, y, leaf[5]);
  }
  s.outline({ dark: leaf[1] });
  return s;
}

function deadTree(S, t, frost = false) {
  // Bare tree: a leaning trunk that forks into upward-reaching branches.
  const L = S.style.bark || S.style.leaf;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const height = Math.round(HEIGHT[frost ? 'bare' : 'dead'](t.size));
  const lean = (rand2(t.x, t.baseY, t.seed) - 0.5) * 0.25;
  const pts = [];
  for (let k = 0; k <= height; k++) {
    const y = t.baseY - k,
      x = t.x + Math.round(k * lean);
    s.set(x, y, L[5]);
    if (k < height * 0.85) s.set(x + 1, y, L[2]);
    if (k < 2) s.set(x - 1, y, L[4]);
    pts.push([x, y]);
  }
  s.set(t.x - 2, t.baseY, L[3]);
  s.set(t.x + 2, t.baseY, L[2]);
  const nb = 2 + Math.round(t.size * 2);
  for (let b = 0; b < nb; b++) {
    const at = Math.round(height * (0.35 + (0.55 * b) / Math.max(1, nb - 1)));
    const [bx, by] = pts[Math.min(pts.length - 1, at)];
    const dir = (b + (t.seed & 1)) % 2 ? 1 : -1;
    const len = 2 + (hash2(t.x, b, t.seed) % (2 + Math.round(t.size * 3)));
    let X = bx + (dir > 0 ? 1 : 0),
      Y = by;
    for (let k = 1; k <= len; k++) {
      X += dir;
      if (k % 2 === 0 || k === 1) Y -= 1;
      s.set(X, Y, k === len ? L[4] : L[5]);
      if (k <= len / 2) s.set(X, Y + 1, L[3]); // limbs thicken toward the trunk
      if (frost && k < len) s.set(X, Y - 1, R('snow', 7));
      if (k === 2 && len > 3) {
        // a twig
        s.set(X, Y - 2, L[4]);
        s.set(X - dir, Y - 3, L[4]);
      }
    }
  }
  if (frost)
    for (let k = 0; k < 3; k++) s.set(pts[height][0] + (k - 1), pts[height][1], R('snow', 6));
  s.outline({ dark: L[0] });
  return s;
}

function snag(S, t) {
  // A broken, charred (or grey, rotten) stump: jagged top, one stub branch.
  const L = S.style.bark || S.style.leaf;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const h = Math.round(HEIGHT.snag(t.size));
  const x = t.x,
    baseY = t.baseY;
  for (let y = baseY - h; y <= baseY; y++)
    for (let dx = -1; dx <= 2; dx++) {
      if (y < baseY - h + 2 && (dx + y + t.seed) % 3 === 0) continue; // jagged break
      s.set(x + dx, y, dx <= 0 ? L[5] : dx === 1 ? L[3] : L[2]);
    }
  s.set(x - 2, baseY, L[3]);
  s.set(x + 3, baseY, L[2]);
  if (S.biome === 'volcano') {
    const cy = baseY - 2 - (hash2(x, baseY, t.seed) % Math.max(1, h - 3));
    s.set(x, cy, R('ember', 3));
    s.set(x + 1, cy + 1, R('ember', 2));
  }
  const dir = t.seed % 2 ? 1 : -1;
  s.set(x + (dir > 0 ? 3 : -2), baseY - h + 2, L[4]);
  s.set(x + (dir > 0 ? 4 : -3), baseY - h + 1, L[4]);
  s.outline({ dark: L[0] });
  return s;
}

function cypress(S, t) {
  // Bald cypress: a narrow dark cone on a flared, buttressed foot.
  const leaf = S.style.leaf2;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const x = t.x,
    baseY = t.baseY;
  const h = Math.round(HEIGHT.cypress(t.size));
  const top = baseY - h;
  for (const [dx, col] of [
    [-1, R('soil', 3)],
    [0, R('soil', 4)],
    [1, R('soil', 2)],
    [2, R('soil', 1)],
  ])
    s.set(x + dx, baseY, col);
  s.set(x, baseY - 1, R('soil', 3));
  s.set(x + 1, baseY - 1, R('soil', 1));
  const halfW = 2.2 + t.size * 1.8;
  for (let y = top; y <= baseY - 2; y++) {
    const k = (y - top) / Math.max(1, baseY - 2 - top);
    const half = Math.round(halfW * Math.min(1, 0.25 + k * 1.1));
    for (let dx = -half; dx <= half + 1; dx++) {
      let I = -(dx - 0.5) / (half + 1) - (1 - k) * 0.2;
      if (valueNoise(x + dx, y, 2, t.seed + 3) > 0.74) I -= 0.35;
      const tone = I > 0.45 ? 7 : I > 0.12 ? 6 : I > -0.2 ? 5 : I > -0.55 ? 4 : 3;
      s.set(x + dx, y, leaf[tone]);
    }
  }
  s.outline({ dark: leaf[1] });
  return s;
}

function sapling(S, t, conif = false) {
  // Young tree: a short stem under a small, bushy crown (or a little spruce).
  if (conif) return conifer(S, { ...t, size: 0.05 + t.size * 0.2 }, 'fir');
  const leaf = t.leaf || S.style.leaf;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const Rr = 2.6 + t.size * 1.6;
  const stem = 1 + Math.round(t.size * 2);
  const cy = t.baseY - stem - Rr * 0.85;
  for (let y = Math.round(cy); y <= t.baseY; y++) s.set(t.x, y, S.style.trunk[1]);
  crown(s, t.x + 0.5, cy, Rr, t.seed, leaf, { maxY: t.baseY - 1, squashX: 0.9 });
  s.outline({ dark: leaf[1] });
  return s;
}

function bush(S, t) {
  // Undergrowth: a low, wide dome sitting on the ground.
  const leaf = S.style.shrub || S.style.leaf;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const Rr = 2.2 + t.size * 1.8;
  crown(s, t.x + 1, t.baseY - Rr * 0.62, Rr, t.seed, leaf, {
    squashX: 1.25,
    squashY: 0.7,
    maxY: t.baseY,
  });
  if (S.biome === 'tundra')
    s.forEach((x, y, col) => {
      if (!s.has(x, y - 1) && col !== leaf[2]) s.set(x, y, R('snow', 6));
    });
  s.outline({ dark: leaf[1] });
  return s;
}

function thorn(S, t) {
  // Harsh-biome shrub: a tangle of dark, spiky twigs.
  const L = S.style.bark || S.style.leaf;
  const s = new Sprite(t.c, t.r, 'tree', t.baseY);
  const n = 4 + Math.round(t.size * 3);
  for (let k = 0; k < n; k++) {
    const dir = (k / (n - 1)) * 2 - 1 + (rand2(k, t.seed, 1) - 0.5) * 0.4;
    const len = 2 + (hash2(k, t.seed, 2) % (2 + Math.round(t.size * 2)));
    for (let q = 0; q <= len; q++)
      s.set(
        t.x + Math.round(dir * q * 0.9),
        t.baseY - Math.round(q * (1 - Math.abs(dir) * 0.45)),
        q === len ? L[5] : L[3],
      );
  }
  if (S.biome === 'volcano' && t.seed % 3 === 0) s.set(t.x, t.baseY - 1, R('ember', 3));
  s.outline({ dark: L[0] });
  return s;
}

function log(S, t) {
  // A fallen log: bark with a lit top edge and a pale cut end.
  const wood = S.style.bark || [
    R('soil', 1),
    R('soil', 2),
    R('soil', 3),
    R('soil', 4),
    R('soil', 5),
    R('soil', 6),
  ];
  const s = new Sprite(t.c, t.r, 'tree', t.baseY, { a: 0.3, b: 0.15 });
  const len = 5 + Math.round(t.size * 3);
  const dir = t.seed % 2 ? 1 : -1;
  const x0 = dir > 0 ? t.x - 1 : t.x - len + 2;
  for (let k = 0; k < len; k++) {
    const X = x0 + k;
    s.set(X, t.baseY - 2, wood[4]);
    s.set(X, t.baseY - 1, (X + t.seed) % 3 === 0 ? wood[1] : wood[2]);
    s.set(X, t.baseY, wood[1]);
  }
  const endX = dir > 0 ? x0 + len - 1 : x0;
  s.set(endX, t.baseY - 2, R('soil', 7));
  s.set(endX, t.baseY - 1, R('soil', 6));
  if (S.style.moss && t.seed % 2) s.set(x0 + 1 + (t.seed % (len - 2)), t.baseY - 2, S.style.moss);
  s.outline({ dark: R('ink', 2) });
  return s;
}

function stump(S, t) {
  const wood = [R('soil', 2), R('soil', 3), R('soil', 5), R('soil', 7)];
  const s = new Sprite(t.c, t.r, 'tree', t.baseY, { a: 0.3, b: 0.15 });
  for (let dx = -1; dx <= 2; dx++) {
    s.set(t.x + dx, t.baseY - 2, dx < 1 ? wood[3] : wood[2]);
    s.set(t.x + dx, t.baseY - 1, dx < 1 ? wood[1] : wood[0]);
    s.set(t.x + dx, t.baseY, wood[0]);
  }
  s.set(t.x - 2, t.baseY, wood[1]);
  s.outline({ dark: R('ink', 2) });
  return s;
}

function paintTree(S, t) {
  switch (t.kind) {
    case 'birch':
      return birch(S, t);
    case 'poplar':
      return poplar(S, t);
    case 'pine':
    case 'fir':
    case 'charpine':
      return conifer(S, t, t.kind);
    case 'cypress':
      return cypress(S, t);
    case 'dead':
      return deadTree(S, t);
    case 'bare':
      return deadTree(S, t, true);
    case 'snag':
      return snag(S, t);
    case 'willow':
      return broadleaf(S, { ...t, strands: true, crown: { squashX: 1.12 } });
    case 'sapling':
      return sapling(S, t);
    case 'spruceling':
      return sapling(S, t, true);
    case 'bush':
      return bush(S, t);
    case 'thorn':
      return thorn(S, t);
    case 'log':
      return log(S, t);
    case 'stump':
      return stump(S, t);
    default:
      return broadleaf(S, t);
  }
}

function pick(list, roll) {
  let total = 0;
  for (const [, w] of list) total += w;
  roll *= total;
  for (const [kind, w] of list) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return list[0][0];
}

// ------------------------------------------------------------------ layout
const isForest = (S, c, r) => S.name(c, r) === 'Forest'; // map edges extend outward

/** Species whose single crown can hold a lone forest cell on its own. */
const BROAD = new Set(['broadleaf', 'willow', 'fir']);

/** Probability that a foot position grows something, by forest cells in its 2x2 block. */
const GROW = [0, 0.28, 0.74, 0.9, 0.97];
/** Mean size of what grows there. */
const SIZE = [0, 0.58, 0.72, 0.82, 0.9];

/**
 * The context-free core of a cell: one large tree, a pair or a trio. It
 * alone reads as a stand of trees (a lone forest cell is exactly this), and
 * it may spill a little over every side because it depends on nothing else.
 */
function corePlan(S, c, r, broad) {
  const h = (k) => rand2(c * 11 + k, r * 5 - k, S.seed + 420);
  const roll = h(0);
  const u = 6 + h(1) * 12,
    v = 17.5 + h(2) * 5;
  // a slim species needs company to read as a stand
  if (broad && roll < 0.45) return [{ u, v, size: 0.86 + h(3) * 0.14 }];
  const du = 4.5 + h(4) * 2,
    dv = (h(5) - 0.5) * 5;
  if (roll < 0.85)
    return [
      { u: Math.max(5, u - du), v: v - Math.abs(dv) - 1, size: 0.68 + h(6) * 0.2 },
      { u: Math.min(19, u + du), v: v - Math.abs(dv) + dv, size: 0.64 + h(7) * 0.2 },
    ].sort((a, b) => a.v - b.v);
  return [
    { u: 12 + (h(8) - 0.5) * 4, v: 13 + h(9) * 2, size: 0.58 + h(10) * 0.14 },
    { u: 6 + h(11) * 2, v: 21 + h(12) * 2, size: 0.55 + h(13) * 0.14 },
    { u: 16 + h(14) * 2, v: 20 + h(15) * 2.5, size: 0.52 + h(3) * 0.14 },
  ];
}

/** Context-free, well-spaced extra foot positions (best of several darts each). */
function footPositions(S, c, r, core) {
  const h = (k, q) => rand2(c * 16 + k, r * 16 + q, S.seed + 421);
  const pts = [...core];
  const out = [];
  for (let k = 1; k <= 6; k++) {
    let best = null,
      bestD = -1;
    for (let q = 0; q < 6; q++) {
      const u = 1.5 + h(k, 2 + q * 2) * 21,
        v = 8 + h(k, 3 + q * 2) * 16;
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot(u - p.u, (v - p.v) * 1.25));
      if (d > bestD) {
        bestD = d;
        best = { u, v, k };
      }
    }
    pts.push(best);
    out.push(best);
  }
  return out;
}

/**
 * A crown may reach over the corner into the diagonal cell only as far as
 * it may reach into open ground (2 px) unless that cell is forest too.
 */
function clipCorner(sp, { sx, sy }) {
  const x0 = sp.c * CELL,
    y0 = sp.r * CELL;
  const next = [];
  sp.forEach((x, y) => {
    const dx = sx < 0 ? x0 - x : x - (x0 + CELL - 1),
      dy = sy < 0 ? y0 - y : y - (y0 + CELL - 1);
    if (dx > 0 && dy > 0 && (dx > 2 || dy > 2)) next.push(x, y);
  });
  for (let k = 0; k < next.length; k += 2) sp.clear(next[k], next[k + 1]);
  sp.clipped += next.length / 2;
}

/** Trees (and shrubs / logs) of one forest cell as separate parts. */
export function forestParts(S, c, r) {
  const st = S.style,
    flora = st.trees;
  const ox = c * CELL,
    oy = r * CELL;
  const seed = S.seed + 440;
  const out = [];

  const plant = (t, lim) => {
    // Plan a size that fits the allowed box (the height table is a first
    // guess; the painted bounds decide), then shift / clip as a safety net.
    const maxH = t.baseY - oy + lim.top * (t.sy < 0 ? 1 : 0) + (t.sy === 0 ? lim.top : 0);
    const H = HEIGHT[t.kind] || HEIGHT.broadleaf;
    while (t.size > 0.1 && H(t.size, t.dense) > maxH) t.size -= 0.08;
    let sp;
    const footX = t.x;
    const probe = new Sprite(c, r, 'tree', t.baseY);
    if (t.deps) probe.setDeps(...t.deps);
    const [x0, , x1] = probe.allowedBox(lim);
    for (let attempt = 0; attempt < 6; attempt++) {
      // keep the whole crown inside the box horizontally (the sprite frame
      // cannot hold pixels far outside the cell)
      const hw = Math.ceil((HALF_W[t.kind] || HALF_W.broadleaf)(t.size));
      t.x = Math.max(x0 + hw - 1, Math.min(x1 - hw - 1, footX));
      sp = paintTree(S, t);
      if (t.deps) sp.setDeps(...t.deps);
      sp.fitTo(lim);
      if (t.corner) clipCorner(sp, t.corner);
      if (!sp.clipped || t.size <= 0.06) break; // planned to fit: nothing trimmed
      t.size = Math.max(0.05, t.size - 0.1);
    }
    out.push(sp);
    return sp;
  };

  // The core depends on this cell only, so it may spill (a little) anywhere.
  const coreList = flora.canopy.filter(([kind]) => kind !== 'snag');
  const coreKind = pick(coreList, rand2(c, r, seed + 1));
  const core = corePlan(S, c, r, BROAD.has(coreKind));
  const reach = [];
  core.forEach((p, k) => {
    const kind = k === 0 ? coreKind : pick(coreList, rand2(c * 3 + k, r, seed + 2));
    const sp = plant(
      {
        c,
        r,
        kind,
        x: ox + Math.round(p.u) - 1,
        baseY: oy + Math.round(p.v),
        size: p.size,
        seed: seed + c * 131 + r * 17 + k * 3,
        leaf: rand2(c, r * 7 + k, seed + 2) < 0.3 ? st.leaf2 : st.leaf,
        sy: 0,
      },
      { left: 2, right: 2, top: 2, bottom: 1 },
    );
    const b = sp.bounds();
    if (b) reach.push(b);
  });

  for (const { u, v, k } of footPositions(S, c, r, core)) {
    // Under a core crown: that ground is already covered.
    const fx = ox + u,
      fy = oy + v;
    if (reach.some((b) => fx > b.x0 + 2 && fx < b.x1 - 2 && fy > b.y0 && fy < b.y1 - 2)) continue;
    const sx = u < 12 ? -1 : 1,
      sy = v < 19 ? -1 : 1; // only feet near the bottom may drop below the cell
    const side = isForest(S, c + sx, r),
      vert = isForest(S, c, r + sy),
      diag = isForest(S, c + sx, r + sy);
    const d = 1 + side + vert + (diag && (side || vert) ? 1 : 0);
    const roll = rand2(c * 8 + k, r * 8 - k, seed + 3);
    if (roll > GROW[d]) continue;
    let size = SIZE[d] + (rand2(c * 8 + k, r * 8 + k, seed + 4) - 0.5) * 0.5;
    // nearer the open side a tree stays lower
    if (!vert && sy < 0) size -= 0.12;
    size = Math.max(0.08, Math.min(1, size));
    const under = size < 0.3 || rand2(c + k * 5, r, seed + 5) < (d <= 2 ? 0.15 : 0.05);
    const kind = pick(under ? flora.under : flora.canopy, rand2(c * 8 + k, r, seed + 6));
    const lim = {
      left: side ? TREE_OVERHANG.side : 2,
      right: side ? TREE_OVERHANG.side : 2,
      top: vert ? TREE_OVERHANG.top : 2,
      bottom: vert ? TREE_OVERHANG.bottom : 1,
    };
    plant(
      {
        c,
        r,
        kind,
        x: ox + Math.round(u) - 1,
        baseY: oy + Math.round(v),
        size: under ? Math.min(size, 0.5) : size,
        seed: seed + c * 131 + r * 17 + k * 7,
        leaf: rand2(c, r * 3 + k, seed + 7) < 0.3 ? st.leaf2 : st.leaf,
        dense: d >= 3,
        sy,
        corner: diag ? null : { sx, sy },
        // decided from the 2x2 block of cells sharing this quadrant's corner
        deps: [Math.min(0, sx), Math.max(0, sx), Math.min(0, sy), Math.max(0, sy)],
      },
      lim,
    );
  }
  return out;
}
