// Mountain cells: a characterful massif that mostly fits the cell, joined to
// neighbouring mountain cells by ridges, with boulders and scree where it
// meets open ground.
//
// A cell's mountain is built from parts with different deps (see
// Sprite.setDeps), so the renderer stays 3x3-local:
//
//   - the massif depends on the cell alone: one of several archetypes (spire,
//     monolith dome, leaning crag, twin summit, flat-topped butte), jittered
//     in position, height and width. It may rise MOUNTAIN_OVERHANG.top px
//     above the cell and spill a pixel or two sideways;
//   - a shoulder toward an east / west mountain neighbour runs from the
//     massif's flank to a saddle on the shared border. The saddle is keyed by
//     the border itself, so the two cells' shoulders meet exactly and a range
//     reads as one ridge;
//   - the foot depends on the cell below: rock continues down into the next
//     peak of a north-south range, or boulders and scree gather at the base
//     facing open ground (and, per side, facing open ground east or west).
//
// Rock is shaded as faceted planes (Voronoi plates with their own tilt), lit
// on the west face and shaded on the east face, with creases, spurs and
// strata ticks, so it reads as carved stone rather than vertical streaks.
import { R } from './palette.js';
import { rand2, hash2, valueNoise, worley } from './noise.js';
import { Sprite } from './sprite.js';
import { ART_CELL as CELL } from './state.js';

export const MOUNTAIN_OVERHANG = Object.freeze({ side: 3, top: 4, bottom: 1 });
const LIM = {
  left: MOUNTAIN_OVERHANG.side,
  right: MOUNTAIN_OVERHANG.side,
  top: MOUNTAIN_OVERHANG.top,
  bottom: MOUNTAIN_OVERHANG.bottom,
};
const SHADOW = { a: 0.45, b: 0.22 };
const isMountain = (S, c, r) => S.name(c, r) === 'Mountain'; // edges extend outward

// ------------------------------------------------------------- archetypes
const ARCHETYPES = {
  grassland: [
    ['spire', 2],
    ['dome', 3],
    ['crag', 2],
    ['twin', 2],
    ['butte', 1],
  ],
  tundra: [
    ['spire', 4],
    ['crag', 2],
    ['twin', 2],
    ['dome', 1],
  ],
  volcano: [
    ['spire', 2],
    ['crag', 3],
    ['butte', 2],
    ['dome', 1],
  ],
  swamp: [
    ['dome', 4],
    ['crag', 1],
    ['twin', 1],
  ],
  castle: [
    ['crag', 3],
    ['spire', 2],
    ['dome', 1],
    ['twin', 1],
  ],
  void: [
    ['crag', 3],
    ['spire', 3],
    ['twin', 1],
  ],
};

function pick(list, roll) {
  let total = 0;
  for (const [, w] of list) total += w;
  roll *= total;
  for (const [k, w] of list) {
    roll -= w;
    if (roll < 0) return k;
  }
  return list[0][0];
}

/** Context-free massif plan of one cell (cell-local art px, v down). */
export function massifPlan(S, c, r) {
  const h = (k) => rand2(c * 13 + k, r * 7 - k, S.seed + 300);
  const kind = pick(ARCHETYPES[S.biome] || ARCHETYPES.grassland, h(0));
  const flip = h(1) < 0.5;
  const scale = 0.8 + h(2) * 0.2; // lone foothill .. full massif
  const base = 21.5 + h(3) * 1.5;
  // summit 20..27 px above the foot, at most MOUNTAIN_OVERHANG.top above the cell
  const height = Math.min(base + MOUNTAIN_OVERHANG.top - 0.5, (20 + h(4) * 7) * scale);
  const ax = 12 + (h(5) - 0.5) * 6;
  const wide = 1.02 + h(6) * 0.22;
  const peaks = [];
  const add = (p) => peaks.push({ base, jag: 1, ...p });
  switch (kind) {
    case 'twin':
      add({
        shape: 'spire',
        ax: ax - 3.5,
        ay: base - height,
        wl: 8 * wide,
        wr: 6.5 * wide,
      });
      add({
        shape: 'spire',
        ax: ax + 4.5,
        ay: base - height * (0.62 + h(7) * 0.16),
        wl: 6.5 * wide,
        wr: 7.5 * wide,
      });
      break;
    case 'dome':
      add({ shape: 'dome', ax, ay: base - height * 0.96, wl: 9 * wide, wr: 9 * wide });
      break;
    case 'crag':
      add({
        shape: 'crag',
        ax: ax - 2,
        ay: base - height,
        wl: 7 * wide,
        wr: 10.5 * wide,
        jag: 1.6,
      });
      break;
    case 'butte':
      add({
        shape: 'butte',
        ax,
        ay: base - height * 0.8,
        wl: 9.5 * wide,
        wr: 9.5 * wide,
        crater: S.biome === 'volcano',
      });
      break;
    default:
      add({ shape: 'spire', ax, ay: base - height, wl: 9 * wide, wr: 9 * wide });
  }
  if (flip)
    for (const p of peaks) {
      p.ax = CELL - p.ax;
      [p.wl, p.wr] = [p.wr, p.wl];
      p.flip = true;
    }
  return { kind, peaks, base, ax: flip ? CELL - ax : ax, height };
}

/** Half-width fractions (left, right) at t = 0 (summit) .. 1 (foot). */
function profile(shape, t, flip) {
  switch (shape) {
    case 'dome': {
      const f = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
      return [f, f];
    }
    case 'crag': {
      // one steep face, one long slope with a ledge
      const steep = Math.pow(t, 0.5),
        long = Math.min(1, Math.pow(t, 1.05) + (t > 0.35 && t < 0.5 ? 0.12 : 0));
      return flip ? [long, steep] : [steep, long];
    }
    case 'butte': {
      const f =
        t < 0.12 ? 0.32 + t * 1.2 : Math.min(1, 0.46 + Math.pow((t - 0.12) / 0.88, 0.7) * 0.6);
      return [f, f];
    }
    default: {
      const f = Math.pow(t, 0.55);
      return [f, f];
    }
  }
}

// ------------------------------------------------------------------ rock
// Facets: Voronoi plates, each a flat plane with its own tilt, and a dark
// crease along the lower / right edge of every plate. The plates are a pure
// function of the world pixel and the seed, and neighbouring parts (massif,
// shoulders, valleys) paint over the same pixels, so they are memoised per
// map (like the noise lattices): FACET_TILT[i] is the plate's tilt in
// thousandths + 1, and bit 0x8000 marks a crease pixel.
function facet(S, x, y) {
  const inside = x >= 0 && y >= 0 && x < S.W && y < S.H;
  const i = y * S.W + x;
  if (inside) {
    if (!S._facets) S._facets = new Uint16Array(S.W * S.H);
    const v = S._facets[i];
    if (v) return v;
  }
  const w = worley(x, y * 1.25, 5.5, S.seed + 320);
  const id = w.id,
    seam = w.d2 - w.d1;
  let v = (id % 1000) + 1;
  if (seam < 0.9 && worley(x + 1, (y + 1) * 1.25, 5.5, S.seed + 320).id !== id) v |= 0x8000;
  if (inside) S._facets[i] = v;
  return v;
}

function rockTone(S, x, y, lit, t, seed, edgeDist) {
  const f = facet(S, x, y);
  const tilt = ((f & 0x7fff) - 1) / 1000;
  let tone;
  if (lit) tone = tilt > 0.62 ? 6 : tilt < 0.18 ? 4 : 5;
  else tone = tilt > 0.75 ? 3 : tilt < 0.2 ? 1 : 2;
  if (lit && edgeDist < 1.6 && t < 0.6) tone = 6; // sunlit ridge line
  if (lit) tone += S.style.rock.litShift || 0; // rock must stay apart from pale ground
  if (f & 0x8000) tone = Math.max(0, tone - (lit ? 2 : 1));
  if (t > 0.82) tone = Math.max(0, tone - 1); // occlusion near the ground
  // strata ticks on the lit face
  if (lit && t > 0.3 && t < 0.8 && (y + Math.round(x / 3)) % 5 === 0) {
    if (valueNoise(x, y, 3, seed + 8) > 0.62) tone = Math.max(1, tone - 1);
  }
  return tone;
}

/** Quiet, shadowed rock between peaks: facets in two close tones. */
function valleyTone(S, x, y) {
  const f = facet(S, x, y);
  if (f & 0x8000) return 1;
  return ((f & 0x7fff) - 1) / 1000 > 0.8 ? 3 : 2;
}

function rockColour(S, tone, lit, x, y, t, seed, cap) {
  const st = S.style.rock;
  const ramp = st.ramp;
  let col = ramp[Math.max(0, Math.min(ramp.length - 1, tone))];
  if (cap && st.cap) {
    const c = st.cap.ramp;
    col = lit
      ? c[Math.min(c.length - 1, (tone >= 4 ? 5 : 4) - (tone < 3 ? 1 : 0))]
      : c[tone <= 1 ? 1 : 2];
  } else if (st.ember && !lit && t > 0.45 && valueNoise(x, y, 2, seed + 9) > 0.83) {
    col = R('ember', 2);
  } else if (st.moss && lit && t > 0.55 && valueNoise(x, y, 4, seed + 10) > 0.7) {
    col = st.moss;
  }
  return col;
}

// ---------------------------------------------------------------- massif
function paintPeak(S, s, c, r, p, k) {
  const ox = c * CELL,
    oy = r * CELL;
  const seed = S.seed + 330 + k * 17 + c * 7 + r * 13;
  const ay = Math.round(p.ay),
    by = Math.round(p.base);
  const span = Math.max(1, by - ay);
  const spurs = [];
  const nSpur = 2 + Math.floor(rand2(c + k, r, seed) * 2);
  for (let q = 0; q < nSpur; q++)
    spurs.push({
      y0: ay + Math.round(span * (0.22 + 0.5 * rand2(q, k, seed + 1))),
      side: q % 2 ? 1 : -1,
      slope: 0.7 + rand2(q, k, seed + 2) * 0.5,
      len: Math.round(span * (0.25 + rand2(q, k, seed + 3) * 0.2)),
    });
  const capDepth = 3 + rand2(c, r, seed + 12) * 3;
  for (let y = ay; y <= by; y++) {
    const t = (y - ay) / span;
    const [fl, fr] = profile(p.shape, t, p.flip);
    const jagK = Math.min(1, t * 3) * p.jag;
    const jl = (valueNoise(y, 3, 3.4, seed + 4) - 0.5) * 3 * jagK;
    const jr = (valueNoise(y, 7, 3.4, seed + 5) - 0.5) * 2.8 * jagK;
    const foot = t > 0.88 ? (t - 0.88) * 10 : 0; // the base rounds off
    const xl = Math.round(p.ax - p.wl * fl + jl + foot);
    const xr = Math.round(p.ax + p.wr * fr + jr - foot);
    // ridge line: lit west face | shaded east face
    let xm = p.ax + (xr - p.ax) * 0.18 * t + (valueNoise(y, 11, 3, seed + 6) - 0.5) * 1.2;
    if (p.shape === 'dome' || p.shape === 'butte') xm = p.ax - (p.ax - xl) * 0.12 + 1;
    const capLine = ay + capDepth + (valueNoise(y, 13, 3, seed + 7) - 0.5) * 2;
    for (let x = xl; x <= xr; x++) {
      // a ragged foot, not a ruled base line
      if (y >= by - 1 && valueNoise(x, y, 2, seed + 14) > (y === by ? 0.55 : 0.8)) continue;
      const lit = x + 0.5 < xm;
      const wx = ox + x,
        wy = oy + y;
      let tone = rockTone(S, wx, wy, lit, t, seed, Math.abs(xm - (x + 0.5)));
      if (p.shape === 'dome') {
        // rounded monolith: the light wraps, the far flank falls away
        const nx = (x + 0.5 - p.ax) / Math.max(2, (xr - xl) / 2);
        if (nx < -0.55 && t < 0.7) tone = Math.min(tone + 1, 6);
        else if (nx > 0.6) tone = Math.max(0, tone - 1);
      }
      if (p.crater && y <= ay + 1 && x > xl + 1 && x < xr - 1) {
        s.set(ox + x, oy + y, y === ay ? R('ember', 3) : R('ink', 2));
        continue;
      }
      for (const sp of spurs) {
        if (y < sp.y0 || y > sp.y0 + sp.len) continue;
        const along = y - sp.y0;
        const cx = xm + sp.side * (along * sp.slope + 1);
        if (Math.abs(x + 0.5 - cx) < 0.6) tone = lit ? 3 : 1;
        else if (Math.abs(x + 0.5 - (cx - 1)) < 0.6 && lit) tone = Math.max(tone, 5);
      }
      const cap = y < capLine + (lit ? 0.6 : -0.6) && t < 0.55;
      s.set(wx, wy, rockColour(S, tone, lit, wx, wy, t, seed, cap));
    }
  }
}

function massifPart(S, c, r, plan) {
  const st = S.style.rock;
  const oy = r * CELL;
  const composite = new Sprite(c, r, 'mountain', oy + Math.round(plan.base), SHADOW);
  plan.peaks.forEach((p, k) => {
    const s = new Sprite(c, r, 'mountain', oy + Math.round(p.base));
    paintPeak(S, s, c, r, p, k);
    s.outline({ dark: st.outline, rim: true });
    if (k > 0) {
      // occlusion line where this nearer peak overlaps the one behind
      const edge = [];
      s.forEach((x, y) => {
        if (!s.has(x, y - 1) && composite.has(x, y - 1)) edge.push(x, y - 1);
        if (!s.has(x - 1, y) && composite.has(x - 1, y)) edge.push(x - 1, y);
      });
      for (let q = 0; q < edge.length; q += 2) composite.set(edge[q], edge[q + 1], st.outline);
    }
    composite.drawOver(s);
  });
  return composite.fitTo(LIM);
}

// ------------------------------------------------------------- shoulders
/** Saddle on the vertical border between columns cb-1 and cb of row r. */
function saddle(S, cb, r) {
  const h = (k) => rand2(cb * 5 + k, r * 11, S.seed + 350);
  return { v: 12 + h(0) * 5, base: 21.5 + h(1) * 1.5, seed: hash2(cb, r, S.seed + 351) };
}

/**
 * Shoulder of cell (c, r) toward its east (dir 1) or west (dir -1) mountain
 * neighbour: from the massif flank to the saddle on the shared border, and a
 * couple of px past it (the neighbour's shoulder starts there too).
 */
function shoulderPart(S, c, r, plan, dir) {
  const st = S.style.rock;
  const ox = c * CELL,
    oy = r * CELL;
  const sd = saddle(S, dir > 0 ? c + 1 : c, r);
  const edgeX = dir > 0 ? ox + CELL : ox; // world x of the shared border
  const fromX = ox + plan.ax;
  const fromV = plan.peaks[0].ay + (plan.base - plan.peaks[0].ay) * 0.38;
  const s = new Sprite(c, r, 'mountain', oy + Math.round(sd.base) - 1, SHADOW);
  s.setDeps(Math.min(0, dir), Math.max(0, dir), 0, 0);
  const reach = MOUNTAIN_OVERHANG.side - 1;
  const xa = dir > 0 ? Math.floor(fromX) : edgeX - reach,
    xb = dir > 0 ? edgeX + reach : Math.ceil(fromX);
  const seed = sd.seed;
  for (let x = xa; x < xb; x++) {
    // 0 at the massif, 1 at the border (and beyond: flat saddle)
    const k = Math.max(0, Math.min(1, (x + 0.5 - fromX) / (edgeX - fromX)));
    const e = k * k * (3 - 2 * k);
    // crest: world-x keyed near the border, so both sides agree there
    const crest =
      oy + fromV + (sd.v - fromV) * e + (valueNoise(x, r * 97, 3, seed) - 0.5) * 2.2 * e;
    const bottom = oy + plan.base + (sd.base - plan.base) * e;
    const cy = Math.round(crest),
      by = Math.round(bottom);
    for (let y = cy; y <= by; y++) {
      const t = (y - cy) / Math.max(1, by - cy);
      // a ridge's south face: lit near the crest, facets, dark toward the foot
      let tone = rockTone(S, x, y, t < 0.35, 0.3 + t * 0.6, seed, y - cy);
      if (y === cy) tone = Math.min(6, tone + 1);
      s.set(x, y, rockColour(S, tone, t < 0.35, x, y, t, seed, y - cy < 2 && sd.v < 10));
    }
  }
  s.outline({ dark: st.outline, rim: true });
  return s.fitTo(LIM);
}

// ------------------------------------------------------------------ foot
function boulder(s, x, y, w, h, ramp, outline) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1) && w > 2;
      if (corner) continue;
      const lit = i < w / 2 && j < h / 2;
      const col = j === h - 1 ? ramp[1] : lit ? ramp[5] : i >= w - 1 ? ramp[2] : ramp[3];
      s.set(x + i, y + j, col);
    }
  s.set(x + w, y + h - 1, outline);
}

/** Below the massif: rock running on into the next peak, or boulders + scree. */
function footPart(S, c, r) {
  const st = S.style.rock;
  const ox = c * CELL,
    oy = r * CELL;
  // (With a peak below, that cell's ridge spine joins the two; see backPart.)
  if (isMountain(S, c, r + 1)) return null;
  const s = new Sprite(c, r, 'mountain', oy + CELL, SHADOW);
  s.setDeps(0, 0, 0, 1);
  const seed = S.seed + 370 + c * 31 + r * 17;
  // boulders and scree at the foot, spilling a pixel onto the ground below
  const n = 2 + (hash2(c, r, seed) % 3);
  for (let k = 0; k < n; k++) {
    const bx = ox + 2 + Math.floor(rand2(c * 4 + k, r, seed + 2) * 18);
    const w = 2 + (hash2(k, c, seed + 3) % 3),
      h = w > 3 ? 3 : 2;
    boulder(s, bx, oy + CELL - h + (k % 2), w, h, st.ramp, st.outline);
  }
  s.outline({ dark: st.outline });
  return s.fitTo(LIM);
}

/** Boulders at the side of the base, toward open ground east or west. */
function sidePart(S, c, r, plan, dir) {
  const st = S.style.rock;
  const ox = c * CELL,
    oy = r * CELL;
  const seed = S.seed + 390 + c * 23 + r * 7 + dir;
  if (rand2(c, r, seed) < 0.35) return null;
  const s = new Sprite(c, r, 'mountain', oy + Math.round(plan.base), SHADOW);
  s.setDeps(Math.min(0, dir), Math.max(0, dir), 0, 0);
  const n = 1 + (hash2(c, r, seed + 1) % 2);
  for (let k = 0; k < n; k++) {
    const w = 2 + (hash2(k, r, seed + 2) % 2);
    const bx =
      dir > 0
        ? ox + CELL - w - (k * 3 + (hash2(k, c, seed) % 2))
        : ox + k * 3 + (hash2(k, c, seed) % 2);
    const by = oy + Math.round(plan.base) - 2 - k * 2;
    boulder(s, bx, by, w, 2, st.ramp, st.outline);
  }
  s.outline({ dark: st.outline });
  return s.fitTo(LIM);
}

/**
 * With a mountain to the north: the rock between the two massifs, so a
 * north-south range reads as one mountainside instead of stacked walls.
 */
function backPart(S, c, r, plan) {
  const st = S.style.rock;
  const ox = c * CELL,
    oy = r * CELL;
  const seed = S.seed + 380 + c * 29 + r * 13;
  const s = new Sprite(c, r, 'mountain', oy + 8, SHADOW);
  s.setDeps(0, 0, -1, 0);
  // A north-south ridge: a narrow spine from the foot of the peak to the
  // north down to this cell's summit, lit on its west face. Ground still
  // shows either side of it, so a column of peaks reads as a ridge line
  // rather than a stacked tower.
  const north = massifPlan(S, c, r - 1);
  const summit = plan.peaks[0];
  const y0 = oy - 2,
    y1 = oy + Math.max(5, Math.round(summit.ay) + 5);
  // as wide as the narrower of the two masses, narrowing into a col
  const widthOf = (p) => Math.min(...p.peaks.map((q) => Math.min(q.wl, q.wr)));
  const baseHalf = Math.max(3, Math.min(widthOf(north), widthOf(plan)) * 0.75);
  const fromX = ox + north.ax,
    toX = ox + summit.ax;
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const cx = fromX + (toX - fromX) * t + (valueNoise(y, 5, 4, seed) - 0.5) * 2;
    const half = baseHalf * (1 - t * 0.45) + (valueNoise(y, 9, 3, seed) - 0.5);
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const lit = x + 0.5 < cx;
      let tone = rockTone(S, x, y, lit, 0.35 + t * 0.2, seed, Math.abs(cx - x - 0.5));
      if (!lit && x + 0.5 - cx < 1) tone = Math.max(tone, 3);
      s.set(x, y, rockColour(S, tone, lit, x, y, 0.4, seed, false));
    }
  }
  s.outline({ dark: st.outline, rim: true });
  return s.fitTo(LIM);
}

/**
 * Inside a 2x2 block of mountain cells the corner between the peaks is rock
 * too: a shadowed valley behind them, so a block reads as one massif, not a
 * lattice of ridges around holes of grass.
 */
function valleyPart(S, c, r, plan, sx, sy) {
  const st = S.style.rock;
  const ox = c * CELL,
    oy = r * CELL;
  const seed = S.seed + 395 + c * 19 + r * 23 + sx * 3 + sy;
  const s = new Sprite(c, r, 'mountain', oy + (sy < 0 ? 4 : 14), SHADOW);
  s.setDeps(Math.min(0, sx), Math.max(0, sx), Math.min(0, sy), Math.max(0, sy));
  const u0 = sx > 0 ? 11 : 0,
    u1 = sx > 0 ? CELL - 1 : 13;
  const v0 = sy < 0 ? 0 : 10,
    v1 = sy < 0 ? 15 : CELL - 1;
  for (let v = v0; v <= v1; v++)
    for (let u = u0; u <= u1; u++) {
      // ragged toward the cell centre
      const du = sx > 0 ? u - 11 : 13 - u,
        dv = sy < 0 ? 15 - v : v - 10;
      const n = valueNoise(u + ox, v + oy, 3, seed);
      if (Math.min(du, dv) < 4 * n) continue;
      const x = ox + u,
        y = oy + v;
      const tone = valleyTone(S, x, y);
      const lit = false;
      s.set(x, y, rockColour(S, tone, lit, x, y, 0, seed, false));
    }
  s.outline({ dark: st.outline });
  return s.fitTo(LIM);
}

/** All parts of one mountain cell. */
export function mountainParts(S, c, r) {
  const plan = massifPlan(S, c, r);
  const parts = [];
  if (isMountain(S, c, r - 1)) parts.push(backPart(S, c, r, plan));
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      if (isMountain(S, c + sx, r) && isMountain(S, c, r + sy) && isMountain(S, c + sx, r + sy))
        parts.push(valleyPart(S, c, r, plan, sx, sy));
  for (const dir of [-1, 1]) {
    if (isMountain(S, c + dir, r)) parts.push(shoulderPart(S, c, r, plan, dir));
    else {
      const p = sidePart(S, c, r, plan, dir);
      if (p) parts.push(p);
    }
  }
  parts.push(massifPart(S, c, r, plan));
  parts.push(footPart(S, c, r));
  return parts.filter((p) => p && p.count() > 0);
}
