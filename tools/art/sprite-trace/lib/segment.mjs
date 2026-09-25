// Material segmentation of a recovered native figure into the slot model.
//
// 1. Rule seeds: pixels whose colour unambiguously belongs to a material (the
//    faction cloth hue, gold thread, bright steel, face skin, the hair cap at the top
//    of the head...). Rules are parameterised by the recipe (which hue is the faction
//    area, which family the hair is, whether a helmet hides it).
// 2. Seeded geodesic growth (multi-source Dijkstra) over non-ink pixels with a
//    shading-tolerant colour step cost, so each material floods its own shading
//    range and stops at line work and hue changes.
// 3. Recipe overrides (normalised rectangles / flood points) fix what rules miss.
// 4. Metal is split into weapon vs armour by component shape; eyes are found in
//    the face.
// Pure and deterministic.
import { rgbToLab, lch, hueDist } from './color.mjs';
import { SLOT } from './slots.mjs';

const inHue = (h, lo, hi) => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);

/** Hue/chroma/lightness families. Hue is CIE LCh(ab) hue in degrees. */
export const FAMILIES = {
  blue: ({ L, C, h }) => C >= 14 && inHue(h, 235, 315) && L >= 8,
  navy: ({ L, C, h }) => C >= 8 && inHue(h, 240, 320) && L < 40,
  red: ({ L, C, h }) => C >= 26 && inHue(h, 345, 48) && L <= 62,
  teal: ({ C, h }) => C >= 9 && inHue(h, 165, 240),
  purple: ({ L, C, h }) => C >= 7 && inHue(h, 292, 20) && L <= 62,
  green: ({ C, h }) => C >= 10 && inHue(h, 110, 170),
  gold: ({ L, C, h }) =>
    L >= 42 && ((C >= 34 && inHue(h, 72, 102)) || (C >= 48 && inHue(h, 62, 102))),
  brownHair: ({ L, C, h }) => C >= 9 && inHue(h, 30, 80) && L >= 16 && L <= 70,
  redHair: ({ L, C, h }) => C >= 30 && inHue(h, 18, 58) && L >= 20 && L <= 72,
  blondHair: ({ L, C, h }) => C >= 20 && inHue(h, 65, 100) && L >= 50,
  silverHair: ({ L, C }) => C < 14 && L >= 50,
  blackHair: ({ L, C }) => L < 38 && C < 18,
  skin: ({ L, C, h }) => C >= 12 && C <= 46 && inHue(h, 40, 82) && L >= 58,
  // deep skin tones (the later player passes) sit below the light-skin lightness floor;
  // only ever read inside the head box, where brown cloth and leather are rare
  skinDeep: ({ L, C, h }) => C >= 14 && C <= 44 && inHue(h, 35, 72) && L >= 26 && L < 58,
  leather: ({ L, C, h }) => C >= 9 && C <= 45 && inHue(h, 28, 80) && L >= 14 && L < 60,
  steel: ({ L, C }) => C < 10 && L >= 58,
  charcoal: ({ L, C }) => C < 14 && L >= 13 && L < 52,
  linen: ({ L, C, h }) => L >= 70 && C < 22 && (C < 6 || inHue(h, 40, 110)),
  ink: ({ L, C }) => L < 13 || (L < 19 && C < 14),
};

function hairFamOf(recipe) {
  return recipe.hair ? FAMILIES[HAIR[recipe.hair] || recipe.hair] : null;
}

const HAIR = {
  brown: 'brownHair',
  red: 'redHair',
  auburn: 'redHair',
  blond: 'blondHair',
  silver: 'silverHair',
  white: 'silverHair',
  black: 'blackHair',
};

function components(mask, w, h, conn8 = false) {
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = comps.length,
      px = [];
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      px.push(p);
      const x = p % w,
        y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!conn8 && dx && dy) continue;
          const X = x + dx,
            Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const q = Y * w + X;
          if (!mask[q] || lab[q] >= 0) continue;
          lab[q] = id;
          stack.push(q);
        }
    }
    comps.push(px);
  }
  return { lab, comps };
}

/** Principal-axis length / width of a pixel set (elongation of blades and shafts). */
export function elongation(px, w) {
  const n = px.length;
  if (n < 3) return { ratio: 1, length: n };
  let mx = 0,
    my = 0;
  for (const p of px) {
    mx += p % w;
    my += (p / w) | 0;
  }
  mx /= n;
  my /= n;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const p of px) {
    const dx = (p % w) - mx,
      dy = ((p / w) | 0) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const tr = sxx + syy,
    det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = Math.max(1e-6, tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det)));
  return { ratio: Math.sqrt(l1 / l2), length: Math.sqrt(12 * l1) };
}

class Heap {
  constructor() {
    this.a = [];
  }
  push(v) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] < v[0] || (a[p][0] === v[0] && a[p][1] <= v[1])) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = v;
  }
  pop() {
    const a = this.a;
    const top = a[0],
      last = a.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (
          c + 1 < a.length &&
          (a[c + 1][0] < a[c][0] || (a[c + 1][0] === a[c][0] && a[c + 1][1] < a[c][1]))
        )
          c++;
        if (a[c][0] > last[0] || (a[c][0] === last[0] && a[c][1] >= last[1])) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/** Resolve a normalised box [x0,y0,x1,y1] (0..1 of the alpha bounds) to pixel coords. */
function boxPx(b, bb) {
  return [
    Math.floor(bb.x + b[0] * bb.width),
    Math.floor(bb.y + b[1] * bb.height),
    Math.ceil(bb.x + b[2] * bb.width),
    Math.ceil(bb.y + b[3] * bb.height),
  ];
}

/**
 * Segment a native figure.
 * recipe: {
 *   main: 'blue'|'red'|'teal'|'purple'|'green'|null,   faction cloth family
 *   hair: 'brown'|'red'|'blond'|'silver'|'black'|null,  (null = hidden by headgear)
 *   head: [x0,y0,x1,y1]?  normalised head box (auto if omitted)
 *   armor: boolean        whether bright metal on the body is plate (else all metal = weapon)
 *   rects: [{ slot, box, from? }]   overrides (normalised boxes)
 *   points: [{ slot, at: [x,y] }]   flood-relabel the region under a point
 * }
 * Returns { w, h, slot: Uint8Array, lab: Float32Array, head, bounds }.
 */
export function segment(native, recipe = {}) {
  const { w, h } = native;
  const n = w * h;
  const bb = native.alphaBounds(0) || { x: 0, y: 0, width: w, height: h };
  const lab = new Float32Array(n * 3);
  const L = new Float32Array(n),
    C = new Float32Array(n),
    H = new Float32Array(n);
  const opaque = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!native.d[p * 4 + 3]) continue;
    opaque[p] = 1;
    const l = rgbToLab([native.d[p * 4], native.d[p * 4 + 1], native.d[p * 4 + 2]]);
    lab.set(l, p * 3);
    const [LL, CC, hh] = lch(l);
    L[p] = LL;
    C[p] = CC;
    H[p] = hh;
  }
  const px = (p) => ({ L: L[p], C: C[p], h: H[p] });
  const slot = new Uint8Array(n);
  const seed = new Uint8Array(n);

  // --- ink --------------------------------------------------------------------
  for (let p = 0; p < n; p++) if (opaque[p] && FAMILIES.ink(px(p))) slot[p] = seed[p] = SLOT.ink;

  // --- head box ---------------------------------------------------------------
  let head;
  if (recipe.head) head = boxPx(recipe.head, bb);
  else {
    // auto: the largest skin component in the top 40% is the face; the head box is
    // that face expanded (hair above and behind).
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const y = (p / w) | 0;
      if (opaque[p] && !slot[p] && y < bb.y + bb.height * 0.4 && FAMILIES.skin(px(p))) mask[p] = 1;
    }
    let { comps } = components(mask, w, h);
    // no light face: look for a deep-toned one (never with a brown-haired recipe, whose
    // hair shares the hue)
    if (!comps.some((c) => c.length >= 6) && recipe.hair !== 'brown' && recipe.hair !== 'red') {
      for (let p = 0; p < n; p++) {
        const y = (p / w) | 0;
        if (opaque[p] && !slot[p] && y < bb.y + bb.height * 0.4 && FAMILIES.skinDeep(px(p)))
          mask[p] = 1;
      }
      comps = components(mask, w, h).comps;
    }
    // the face is the skin patch with hair (or headgear) right above it: count non-skin,
    // non-ink pixels in the band above each candidate, prefer higher and larger patches
    const hairLike = hairFamOf(recipe);
    const scored = comps
      .filter((c) => c.length >= 3)
      .map((c) => {
        let x0 = Infinity,
          x1 = -1,
          y0 = Infinity;
        for (const p of c) {
          x0 = Math.min(x0, p % w);
          x1 = Math.max(x1, p % w);
          y0 = Math.min(y0, (p / w) | 0);
        }
        let above = 0;
        const band = Math.max(3, Math.round(Math.sqrt(c.length)));
        for (let y = Math.max(0, y0 - band); y < y0; y++)
          for (let x = x0; x <= x1; x++) {
            const q = y * w + x;
            if (opaque[q] && !FAMILIES.skin(px(q)) && (hairLike ? hairLike(px(q)) : true)) above++;
          }
        const top = 1 - (y0 - bb.y) / bb.height;
        return { c, score: c.length * (0.5 + top) + 1.5 * above };
      })
      .sort((a, b) => b.score - a.score);
    const face = scored[0]?.c || [];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (const p of face) {
      const x = p % w,
        y = (p / w) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (x1 < 0) head = [bb.x, bb.y, bb.x + bb.width, bb.y + Math.round(bb.height * 0.22)];
    else {
      const fh = y1 - y0 + 1;
      head = [
        x0 - Math.round(fh * 0.9),
        y0 - Math.round(fh * 1.1),
        x1 + Math.round(fh * 0.5),
        y1 + 1,
      ];
    }
  }
  const inHead = (p) => {
    const x = p % w,
      y = (p / w) | 0;
    return x >= head[0] && x < head[2] && y >= head[1] && y < head[3];
  };

  // --- rule seeds (precedence order) -------------------------------------------
  const mainFam = recipe.main ? FAMILIES[recipe.main] : null;
  const hairFam = recipe.hair ? FAMILIES[HAIR[recipe.hair] || recipe.hair] : null;
  let lightFace = 0;
  for (let y = Math.max(0, head[1]); y < Math.min(h, head[3]); y++)
    for (let x = Math.max(0, head[0]); x < Math.min(w, head[2]); x++) {
      const p = y * w + x;
      if (opaque[p] && FAMILIES.skin(px(p))) lightFace++;
    }
  const deepFace = recipe.deepSkin ?? lightFace < 6;
  const rules = [
    [
      SLOT.trim,
      (p) =>
        FAMILIES.gold(px(p)) &&
        !(recipe.hair === 'blond' && inHead(p)) &&
        // in the face, warm highlights are skin unless they are unmistakably gold
        !(inHead(p) && FAMILIES.skin(px(p)) && C[p] < 44),
    ],
    [
      SLOT.main,
      (p) =>
        mainFam && mainFam(px(p)) && !(recipe.hair === 'red' && recipe.main === 'red' && inHead(p)),
    ],
    [SLOT.skin, (p) => FAMILIES.skin(px(p)) && (inHead(p) || C[p] >= 18)],
    // a deep-toned face (only when the head holds no light-toned face): lower head box
    // only (the hair rule owns the top), not hair-coloured
    [
      SLOT.skin,
      (p) =>
        deepFace &&
        inHead(p) &&
        ((p / w) | 0) >= head[1] + (head[3] - head[1]) * 0.4 &&
        FAMILIES.skinDeep(px(p)) &&
        !(hairFam && hairFam(px(p))),
    ],
    [
      SLOT.hair,
      (p) => {
        if (!hairFam || !inHead(p)) return false;
        const y = (p / w) | 0;
        // the upper part of the head box is hair (the face sits lower and right)
        return y < head[1] + (head[3] - head[1]) * 0.45 && hairFam(px(p));
      },
    ],
    [SLOT.metal, (p) => FAMILIES.steel(px(p)) && !(recipe.hair === 'silver' && inHead(p))],
    [SLOT.linen, (p) => recipe.linen !== false && FAMILIES.linen(px(p)) && !inHead(p)],
    [SLOT.leather, (p) => FAMILIES.leather(px(p)) && !inHead(p)],
    [SLOT.sub, (p) => FAMILIES.charcoal(px(p)) && !inHead(p)],
  ];
  for (let p = 0; p < n; p++) {
    if (!opaque[p] || seed[p]) continue;
    for (const [s, rule] of rules)
      if (rule(p)) {
        seed[p] = s;
        break;
      }
  }
  // skin seeds must be clusters (a single warm highlight on a boot is not skin)
  {
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) mask[p] = seed[p] === SLOT.skin ? 1 : 0;
    for (const comp of components(mask, w, h).comps)
      if (comp.length < 3 && !comp.some(inHead)) for (const p of comp) seed[p] = 0;
  }
  // hair seeds: only the largest hair-coloured clusters near the head top
  {
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) mask[p] = seed[p] === SLOT.hair ? 1 : 0;
    for (const comp of components(mask, w, h, true).comps)
      if (comp.length < 3) for (const p of comp) seed[p] = 0;
  }

  // --- geodesic growth --------------------------------------------------------
  const cost = new Float64Array(n).fill(Infinity);
  const heap = new Heap();
  for (let p = 0; p < n; p++)
    if (seed[p] && seed[p] !== SLOT.ink) {
      cost[p] = 0;
      slot[p] = seed[p];
      heap.push([0, p]);
    }
  const step = (p, q) => {
    const dL = lab[p * 3] - lab[q * 3],
      da = lab[p * 3 + 1] - lab[q * 3 + 1],
      db = lab[p * 3 + 2] - lab[q * 3 + 2];
    return 1 + 0.22 * Math.sqrt(0.3 * dL * dL + da * da + db * db);
  };
  while (heap.size) {
    const [c, p] = heap.pop();
    if (c > cost[p]) continue;
    const x = p % w,
      y = (p / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const X = x + dx,
        Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const q = Y * w + X;
      if (!opaque[q] || slot[q] === SLOT.ink || (seed[q] && seed[q] !== slot[p])) continue;
      const nc = c + step(p, q);
      if (nc < cost[q]) {
        cost[q] = nc;
        slot[q] = slot[p];
        heap.push([nc, q]);
      }
    }
  }
  // unreached opaque pixels: nearest seed mean colour
  {
    const mean = {};
    for (let p = 0; p < n; p++)
      if (seed[p] && seed[p] !== SLOT.ink) {
        const m = (mean[seed[p]] ||= [0, 0, 0, 0]);
        m[0] += lab[p * 3];
        m[1] += lab[p * 3 + 1];
        m[2] += lab[p * 3 + 2];
        m[3]++;
      }
    const means = Object.entries(mean).map(([s, m]) => [+s, m[0] / m[3], m[1] / m[3], m[2] / m[3]]);
    for (let p = 0; p < n; p++) {
      if (!opaque[p] || slot[p]) continue;
      let best = SLOT.sub,
        bd = Infinity;
      for (const [s, a, b2, c2] of means) {
        const d = (lab[p * 3] - a) ** 2 + (lab[p * 3 + 1] - b2) ** 2 + (lab[p * 3 + 2] - c2) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      slot[p] = best;
    }
  }

  // --- weapon vs armour ------------------------------------------------------------
  const isBlade = new Uint8Array(n);
  {
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) mask[p] = slot[p] === SLOT.metal ? 1 : 0;
    const figH = bb.height;
    for (const comp of components(mask, w, h, true).comps) {
      const e = elongation(comp, w);
      const blade = e.ratio >= 3.2 && e.length >= figH * 0.1;
      if (blade) for (const p of comp) isBlade[p] = 1;
      if (recipe.armor && !blade) for (const p of comp) slot[p] = SLOT.armor;
    }
  }

  // --- overrides -----------------------------------------------------------------
  for (const r of recipe.rects || []) {
    const [x0, y0, x1, y1] = boxPx(r.box, bb);
    const from = r.from ? new Set(r.from.map((s) => SLOT[s])) : null;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const p = y * w + x;
        if (!opaque[p] || slot[p] === SLOT.ink || (isBlade[p] && r.slot !== 'metal')) continue;
        if (from && !from.has(slot[p])) continue;
        if (r.where && !FAMILIES[r.where](px(p))) continue;
        slot[p] = SLOT[r.slot];
      }
  }
  for (const pt of recipe.points || []) {
    const x = Math.floor(bb.x + pt.at[0] * bb.width),
      y = Math.floor(bb.y + pt.at[1] * bb.height);
    const p0 = y * w + x;
    if (!opaque[p0]) continue;
    const target = slot[p0];
    const stack = [p0];
    const seen = new Uint8Array(n);
    seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop();
      slot[p] = SLOT[pt.slot];
      const px0 = p % w,
        py0 = (p / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const X = px0 + dx,
          Y = py0 + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (seen[q] || slot[q] !== target) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
  }

  // --- eyes: dark or iris-coloured clusters inside the face, with skin below them ---
  let face = null;
  {
    // face = bounding box of skin inside the head box
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (let p = 0; p < n; p++)
      if (slot[p] === SLOT.skin && inHead(p)) {
        x0 = Math.min(x0, p % w);
        x1 = Math.max(x1, p % w);
        y0 = Math.min(y0, (p / w) | 0);
        y1 = Math.max(y1, (p / w) | 0);
      }
    if (x1 >= 0) face = [x0, y0, x1 + 1, y1 + 1];
  }
  const eyes = [];
  if (recipe.eyes !== false && face) {
    const [fx0, fy0, fx1, fy1] = face;
    const fh = fy1 - fy0;
    const cand = new Uint8Array(n);
    const isDarkOrIris = (p) =>
      opaque[p] &&
      (slot[p] !== SLOT.skin || L[p] < 40) &&
      ((L[p] < 38 && C[p] < 26) || (C[p] > 20 && hueDist(H[p], 60) > 45 && L[p] < 70));
    // seeds: dark/iris pixels with skin directly below — the lower lid sits on the cheek,
    // which the hairline never does
    for (let y = Math.max(0, fy0); y < fy1; y++)
      for (let x = fx0; x < fx1; x++) {
        const p = y * w + x;
        if (!isDarkOrIris(p) || y + 1 >= h) continue;
        if (slot[p + w] === SLOT.skin) cand[p] = 1;
      }
    // grow each seed up to two rows (tall anime eyes) through dark pixels flanked by skin
    for (let pass = 0; pass < 2; pass++)
      for (let y = fy1 - 1; y > Math.max(0, fy0 - 2); y--)
        for (let x = fx0; x < fx1; x++) {
          const p = y * w + x;
          if (!cand[p]) continue;
          const q = p - w;
          if (q < 0 || cand[q] || !isDarkOrIris(q)) continue;
          const flank =
            (x > 0 && slot[q - 1] === SLOT.skin) || (x < w - 1 && slot[q + 1] === SLOT.skin);
          if (flank) cand[q] = 1;
        }
    const { comps } = components(cand, w, h, true);
    const scored = [];
    for (const comp of comps) {
      if (comp.length > Math.max(8, (fx1 - fx0) * fh * 0.18)) continue;
      // skin directly below (within 2 rows) and on at least one side: an eye, not the hairline
      let below = 0,
        side = 0,
        top = Infinity;
      for (const p of comp) {
        const x = p % w,
          y = (p / w) | 0;
        top = Math.min(top, y);
        for (let d = 1; d <= 2; d++) if (y + d < h && slot[(y + d) * w + x] === SLOT.skin) below++;
        if ((x > 0 && slot[p - 1] === SLOT.skin) || (x < w - 1 && slot[p + 1] === SLOT.skin))
          side++;
      }
      if (!below || !side) continue;
      if (top > fy0 + fh * 0.75) continue; // mouth / chin shadow
      scored.push({ comp, score: comp.length + below + side });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { comp } of scored.slice(0, 2)) {
      for (const p of comp) slot[p] = SLOT.eye;
      eyes.push(comp);
    }
  }

  return { w, h, slot, lab, L, head, face, eyes, bounds: bb };
}
