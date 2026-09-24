// Forest cells: a small cluster of trees that fits the cell footprint.
//
// Owner feedback on the study: trees were too big for their squares. Every
// tree here is planned from a per-cell layout whose slots are sized so the
// crown stays inside the cell with at most OVERHANG px of canopy spill on the
// sides and top (trunks never leave the cell's bottom edge). Clusters of
// neighbouring forest cells still touch at the shared border, so a wood
// reads as one canopy while each cell's trees clearly belong to it.
//
// Species are per biome (two each), chosen per tree by a hash.
import { R } from './palette.js';
import { rand2, hash2, valueNoise } from './noise.js';
import { Sprite } from './sprite.js';
import { ART_CELL as CELL } from './state.js';

export const TREE_OVERHANG = 2;

// Slots: [u, baseV, size 0..1] in cell-local art px, back to front.
// Crowns overlap each other and reach the cell border (within the allowed
// overhang), so a forest cell reads as a block of cover, not an orchard.
const LAYOUTS = [
  // dense groves: a back row of three crowns behind two larger front crowns
  [
    [4.5, 11, 0.45],
    [12, 10.5, 0.5],
    [19.5, 11, 0.45],
    [7.5, 22.5, 0.8],
    [16.5, 22.5, 0.82],
  ],
  [
    [5, 10.5, 0.5],
    [13.5, 11, 0.45],
    [20, 10.5, 0.42],
    [9, 22.5, 0.86],
    [18, 21.5, 0.7],
  ],
  [
    [4, 11, 0.42],
    [10.5, 10.5, 0.46],
    [19, 11, 0.5],
    [6.5, 21.5, 0.7],
    [15.5, 22.5, 0.86],
  ],
  // three large crowns
  [
    [6, 13, 0.8],
    [17.5, 12.5, 0.8],
    [11.5, 23, 0.95],
  ],
];

const LIGHT = (() => {
  const v = [-0.55, -0.7, 0.55],
    n = Math.hypot(...v);
  return v.map((k) => k / n);
})();

// ------------------------------------------------------------ crowns
function crown(s, cx, cy, Rr, seed, leaf, opts = {}) {
  const clumps = [{ x: cx, y: cy, r: Rr }];
  const n = 3 + (hash2(Math.round(cx * 3), Math.round(cy * 3), seed) % 2);
  for (let k = 0; k < n; k++) {
    const ang =
      -Math.PI / 2 + (k / (n - 1) - 0.5) * 2.4 + (rand2(k, Math.round(cx), seed + 1) - 0.5) * 0.5;
    const d = Rr * (0.46 + rand2(k, Math.round(cy), seed + 2) * 0.16);
    clumps.push({
      x: cx + Math.cos(ang) * d,
      y: cy + Math.sin(ang) * d * 0.85,
      r: Rr * (0.5 + rand2(k, Math.round(cx + cy), seed + 3) * 0.12),
    });
  }
  for (const side of [-1, 1])
    clumps.push({ x: cx + side * Rr * 0.48, y: cy + Rr * 0.3, r: Rr * 0.54 });
  const x0 = Math.floor(cx - Rr * 1.5),
    x1 = Math.ceil(cx + Rr * 1.5);
  const y0 = Math.floor(cy - Rr * 1.5),
    y1 = Math.ceil(cy + Rr * 1.2);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let best = null,
        bestD = 0;
      for (const cl of clumps) {
        const dx = x + 0.5 - cl.x,
          dy = y + 0.5 - cl.y;
        const dd = cl.r - Math.sqrt(dx * dx + dy * dy);
        // lower clumps win ties so lobes read as overlapping
        const score = dd + (cl.y - cy) * 0.08;
        if (dd > 0 && (best === null || score > bestD)) {
          best = cl;
          bestD = score;
        }
      }
      if (!best) continue;
      const nx = (x + 0.5 - best.x) / best.r,
        ny = (y + 0.5 - best.y) / best.r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let I = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      I -= ((y - cy) / Rr) * 0.22; // whole crown: top lit, underside dark
      let tone = I > 0.86 ? 7 : I > 0.64 ? 6 : I > 0.4 ? 5 : I > 0.14 ? 4 : I > -0.14 ? 3 : 2;
      if (tone >= 4 && tone <= 6 && valueNoise(x, y, 2.2, seed + 9) > 0.76) tone -= 1;
      s.set(x, y, leaf[tone]);
    }
  if (opts.strands) {
    // willow: hanging strands below the crown
    for (let x = x0; x <= x1; x++) {
      if (rand2(x, Math.round(cy), seed + 11) > 0.45) continue;
      let yb = null;
      for (let y = y1; y >= y0; y--)
        if (s.has(x, y)) {
          yb = y;
          break;
        }
      if (yb === null) continue;
      const len = 1 + (hash2(x, Math.round(cy), seed + 12) % 3);
      for (let k = 1; k <= len; k++)
        if (yb + k < opts.maxY) s.set(x, yb + k, leaf[k === len ? 2 : 3]);
    }
  }
}

// ------------------------------------------------------------ species
function trunk(s, x, baseY, h, cols) {
  for (let y = baseY - h; y <= baseY; y++) {
    s.set(x, y, cols[1]);
    s.set(x + 1, y, cols[0]);
  }
  s.set(x - 1, baseY, cols[0]);
  s.set(x + 2, baseY, cols[0]);
}

function broadleaf(S, c, r, x, baseY, size, seed, opts = {}) {
  const st = S.style;
  const leaf = opts.leaf || st.leaf;
  const Rr = 3.8 + size * 2.6;
  const s = new Sprite(c, r, 'tree', baseY);
  const trunkH = 2 + (size > 0.7 ? 1 : 0);
  trunk(s, x, baseY, trunkH + 2, st.trunk);
  const cy = baseY - trunkH - Math.round(Rr * 0.8);
  crown(s, x + 1, cy, Rr, seed, leaf, { strands: opts.strands, maxY: baseY });
  s.outline({ dark: leaf[1] });
  return s;
}

function poplar(S, c, r, x, baseY, size, seed) {
  // Narrow, tall crown one step darker: a second silhouette for groves.
  const leaf = S.style.leaf2;
  const s = new Sprite(c, r, 'tree', baseY);
  const h = Math.round(10 + size * 5),
    halfW = 2.6 + size * 1.4;
  trunk(s, x, baseY, 2, S.style.trunk);
  const top = baseY - h,
    bottom = baseY - 2;
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
      if (valueNoise(X, y, 2, seed + 5) > 0.72) I -= 0.3; // leaf breaks
      const tone = I > 0.55 ? 7 : I > 0.25 ? 6 : I > -0.05 ? 5 : I > -0.4 ? 4 : 3;
      s.set(X, y, leaf[tone]);
    }
  s.outline({ dark: leaf[1] });
  return s;
}

function pine(S, c, r, x, baseY, size, seed, { fir = false } = {}) {
  const leaf = S.style.leaf;
  const snow = S.biome === 'tundra';
  const s = new Sprite(c, r, 'tree', baseY);
  s.set(x, baseY, R('soil', 2));
  s.set(x, baseY - 1, R('soil', 2));
  s.set(x + 1, baseY, R('soil', 1));
  const height = Math.round((fir ? 8 : 9) + size * 6);
  const tiers = fir ? 3 : 3;
  const top = baseY - height;
  const halfW = (fir ? 4.2 : 3.4) + size * (fir ? 2.2 : 2);
  for (let t = 0; t < tiers; t++) {
    const ay = top + Math.round((t * height) / (tiers + 0.6));
    const by = top + Math.round(((t + 1.6) * height) / (tiers + 0.6));
    const w = halfW * (0.55 + (0.45 * (t + 1)) / tiers);
    for (let y = ay; y <= by && y < baseY - 1; y++) {
      const k = (y - ay) / Math.max(1, by - ay);
      const half = Math.max(0, Math.round(w * k + 0.3));
      for (let dx = -half; dx <= half; dx++) {
        let tone = dx < -half / 2 ? 6 : dx < 0 ? 5 : dx === 0 ? 4 : dx <= half / 2 ? 3 : 2;
        if (y === by) tone = Math.min(tone, 2);
        let col = leaf[tone];
        if (snow) {
          const cap = fir ? 2 : 1;
          if (y - ay <= cap + (dx < 0 ? 1 : 0)) col = dx <= 0 ? R('snow', 7) : R('snow', 5);
          else if (dx === -half && k > 0.3) col = R('snow', 6);
          else if (fir && dx < 0 && (y + dx + seed) % 4 === 0) col = R('snow', 6);
        }
        s.set(x + dx, y, col);
      }
    }
  }
  s.outline({ dark: leaf[1] });
  return s;
}

function deadTree(S, c, r, x, baseY, size, seed) {
  const L = S.style.leaf;
  const s = new Sprite(c, r, 'tree', baseY);
  const height = Math.round(8 + size * 6);
  for (let y = baseY - height; y <= baseY; y++) {
    s.set(x, y, L[5]);
    s.set(x + 1, y, L[2]);
  }
  s.set(x - 1, baseY, L[3]);
  s.set(x + 2, baseY, L[2]);
  for (let b = 0; b < 3; b++) {
    const y0 = baseY - height + 2 + b * 3,
      dir = (b + seed) % 2 ? 1 : -1,
      len = 2 + (hash2(x, b, seed) % 3);
    for (let k = 1; k <= len; k++)
      s.set(x + (dir > 0 ? 1 : 0) + dir * k, y0 - Math.floor(k / 2), k === len ? L[4] : L[5]);
  }
  s.outline({ dark: L[0] });
  return s;
}

function snag(S, c, r, x, baseY, size, seed) {
  // A broken, charred stump: short and wide, jagged top, a glowing crack.
  const L = S.style.leaf;
  const s = new Sprite(c, r, 'tree', baseY);
  const h = Math.round(5 + size * 4);
  for (let y = baseY - h; y <= baseY; y++)
    for (let dx = -1; dx <= 2; dx++) {
      if (y < baseY - h + 2 && (dx + y + seed) % 3 === 0) continue; // jagged break
      const col = dx <= 0 ? L[5] : dx === 1 ? L[3] : L[2];
      s.set(x + dx, y, col);
    }
  s.set(x - 2, baseY, L[3]);
  s.set(x + 3, baseY, L[2]);
  if (S.biome === 'volcano') {
    const cy = baseY - 2 - (hash2(x, baseY, seed) % Math.max(1, h - 3));
    s.set(x, cy, R('ember', 3));
    s.set(x + 1, cy + 1, R('ember', 2));
  }
  // one stub branch
  const dir = seed % 2 ? 1 : -1;
  s.set(x + (dir > 0 ? 3 : -2), baseY - h + 2, L[4]);
  s.outline({ dark: L[0] });
  return s;
}

function cypress(S, c, r, x, baseY, size, seed) {
  // Bald cypress: a narrow dark cone on a flared, buttressed foot.
  const leaf = S.style.leaf2;
  const s = new Sprite(c, r, 'tree', baseY);
  const h = Math.round(10 + size * 5);
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
  const halfW = 2.4 + size * 1.6;
  for (let y = top; y <= baseY - 2; y++) {
    const k = (y - top) / Math.max(1, baseY - 2 - top);
    const half = Math.round(halfW * Math.min(1, 0.25 + k * 1.1));
    for (let dx = -half; dx <= half + 1; dx++) {
      let I = -(dx - 0.5) / (half + 1) - (1 - k) * 0.2;
      if (valueNoise(x + dx, y, 2, seed + 3) > 0.74) I -= 0.35;
      const tone = I > 0.45 ? 7 : I > 0.12 ? 6 : I > -0.2 ? 5 : I > -0.55 ? 4 : 3;
      s.set(x + dx, y, leaf[tone]);
    }
  }
  s.outline({ dark: leaf[1] });
  return s;
}

function makeTree(S, kind, c, r, x, baseY, size, seed) {
  switch (kind) {
    case 'poplar':
      return poplar(S, c, r, x, baseY, size, seed);
    case 'pine':
      return pine(S, c, r, x, baseY, size, seed);
    case 'fir':
      return pine(S, c, r, x, baseY, size, seed, { fir: true });
    case 'birch':
      return pine(S, c, r, x, baseY, size, seed, { fir: true });
    case 'dead':
      return deadTree(S, c, r, x, baseY, size, seed);
    case 'snag':
      return snag(S, c, r, x, baseY, size, seed);
    case 'cypress':
      return cypress(S, c, r, x, baseY, size, seed);
    case 'willow':
      return broadleaf(S, c, r, x, baseY, size, seed, { strands: true });
    default:
      return broadleaf(S, c, r, x, baseY, size, seed);
  }
}

function pickSpecies(S, c, r, k) {
  const list = S.style.trees;
  const total = list.reduce((a, t) => a + t.weight, 0);
  let roll = rand2(c * 7 + k, r * 5 - k, S.seed + 410) * total;
  for (const t of list) {
    roll -= t.weight;
    if (roll < 0) return t.kind;
  }
  return list[0].kind;
}

/** Trees of one forest cell, back to front. */
export function forestTrees(S, c, r) {
  const layout = LAYOUTS[hash2(c, r, S.seed + 400) % LAYOUTS.length];
  const ox = c * CELL,
    oy = r * CELL;
  const out = [];
  layout.forEach(([u, v, size], k) => {
    const jx = Math.round((rand2(c * 3 + k, r, S.seed + 402) - 0.5) * 2);
    const jy = Math.round((rand2(c, r * 3 + k, S.seed + 403) - 0.5) * 1.4);
    const s = size * (0.9 + rand2(c + k, r - k, S.seed + 404) * 0.2);
    const kind = pickSpecies(S, c, r, k);
    const baseY = oy + Math.min(CELL - 1, Math.round(v) + jy);
    const tree = makeTree(
      S,
      kind,
      c,
      r,
      ox + Math.round(u) + jx - 1,
      baseY,
      s,
      S.seed + c * 131 + r * 17 + k,
    );
    const box = [ox - TREE_OVERHANG, oy - TREE_OVERHANG, ox + CELL + TREE_OVERHANG, oy + CELL];
    tree.shiftToFit(...box);
    tree.clipTo(...box);
    out.push(tree);
  });
  return out;
}
