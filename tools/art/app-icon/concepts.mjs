// concepts.mjs — the app-icon candidates, each a pure function painting a Plate.
//
// Shared language (docs/art-direction/ART_BIBLE.md): the Hollow Sun is a black disc
// with a thin gold corona; gold means the player's light (the thread); the empire is
// iron and crimson and carries no light; key light low and warm from the upper-left.
// No text, no transparency, no winged sword, no shield crest.

import {
  Plate,
  INK,
  EMB,
  BLD,
  UNL,
  STL,
  SKY,
  GOLD,
  pick,
  band,
  bayer,
  clamp,
  smooth,
  hash2,
  fbm1,
  dist,
  inPoly,
  angDiff,
  bezier2,
} from './lib.mjs';

const TAU = Math.PI * 2;

/** Dusk-to-dawn ramp: violet night -> crimson -> ember -> white-hot gold. */
const DUSK = [
  INK[0],
  INK[1],
  UNL[0],
  UNL[1],
  UNL[2],
  BLD[2],
  EMB[2],
  BLD[4],
  EMB[3],
  EMB[4],
  EMB[5],
  EMB[6],
];

/** Corona streamer profile (elongated "equatorial" corona like the title's). */
function streamerProfile(seed, axis = -0.35) {
  const N = 360;
  const amp = new Float32Array(N);
  const len = new Float32Array(N);
  const peaks = [];
  for (let i = 0; i < 12; i++) {
    const along = i < 6;
    const h = (k) => hash2(i, k, seed);
    peaks.push({
      a: along ? axis + (i % 2 ? Math.PI : 0) + (h(1) - 0.5) * 0.5 : h(2) * TAU,
      w: 0.06 + h(3) * 0.16,
      amp: along ? 0.8 + h(4) * 0.4 : 0.35 + h(5) * 0.4,
      len: along ? 12 + h(6) * 12 : 5 + h(7) * 6,
    });
  }
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    let A = 0.18;
    let Lg = 4;
    for (const p of peaks) {
      const d = Math.abs(angDiff(a, p.a));
      const g = Math.exp(-((d / p.w) ** 2));
      A += p.amp * g;
      Lg = Math.max(Lg, 4 + (p.len - 4) * g);
    }
    amp[i] = Math.min(1.3, A);
    len[i] = Lg;
  }
  return (ang) => {
    const i = Math.floor(((((ang % TAU) + TAU) % TAU) / TAU) * N) % N;
    return [amp[i], len[i]];
  };
}

/**
 * The gold corona ring of a hollow sun, thickening and brightening toward the
 * diamond-ring bead (where the last light leaks out). Paints ring pixels only.
 */
function coronaRing(p, { cx, cy, r, beadAng, width = 1, spread = 1, inner = 1.6, boost = 1.2 }) {
  p.paint((x, y, ix, iy) => {
    const d = dist(x, y, cx, cy);
    const a = Math.atan2(y - cy, x - cx);
    const near = Math.cos(Math.min(Math.PI, Math.abs(angDiff(a, beadAng)) / spread)); // 1 at bead
    const wOut = width + Math.max(0, near) * boost;
    const wIn = Math.max(0, near) * inner * width;
    if (d >= r && d < r + wOut) {
      const v = 0.5 + 0.5 * near;
      return v > 0.93 ? EMB[6] : v > 0.45 ? EMB[5] : EMB[4];
    }
    if (d >= r + wOut && d < r + wOut + 1 && near + bayer(ix, iy) * 0.7 > 1.05) return EMB[3];
    if (d < r && d >= r - wIn) return near > 0.85 ? EMB[5] : EMB[4];
    if (d < r - wIn && d >= r - wIn - 1 && near > 0.35 && bayer(ix, iy) < near * 0.6) return EMB[3];
    return null;
  });
}

/** Four-point diamond-ring flare centred on (bx, by). Returns a luminance boost. */
function flareL(x, y, bx, by, { h = 40, v = 16, diag = 5, core = 3 } = {}) {
  const dx = x - bx;
  const dy = y - by;
  const d = Math.hypot(dx, dy);
  let L = 6 * Math.exp(-((d / core) ** 2)) + 2.4 * Math.exp(-((d / (core * 3.2)) ** 2));
  const thinY = Math.exp(-((dy / 0.55) ** 2));
  const thinX = Math.exp(-((dx / 0.55) ** 2));
  L += 5 * thinY * Math.exp(-Math.abs(dx) / h);
  L += 4 * thinX * Math.exp(-Math.abs(dy) / v);
  const dd1 = Math.abs(dx - dy) / Math.SQRT2;
  const dd2 = Math.abs(dx + dy) / Math.SQRT2;
  const diagFall = Math.exp(-d / diag);
  L += 2.2 * (Math.exp(-((dd1 / 0.5) ** 2)) + Math.exp(-((dd2 / 0.5) ** 2))) * diagFall;
  return L;
}

/** A 1-px horizontal light line: rounded (not dithered) so it never reads as dashes. */
function lineRamp(ramp, L) {
  return ramp[clamp(Math.round(L), 0, ramp.length - 1)];
}

// =====================================================================================
// 1. Hollow Dawn — the Hollow Sun rising over a horizon hedge of the empire's pikes.
// =====================================================================================
function hollowDawn(p) {
  const n = p.n;
  const HZ = 97;
  const S = { x: 64, y: 62, r: 29 };
  const beadAng = (-130 * Math.PI) / 180;
  const bead = { x: S.x + Math.cos(beadAng) * S.r, y: S.y + Math.sin(beadAng) * S.r };
  const prof = streamerProfile(11, -0.08);
  const skyL = (x, y) => {
    const v = clamp(y / HZ, 0, 1.2);
    let L = 1.8 + 5.3 * Math.pow(v, 2.1);
    L += 2 * Math.exp(-(((y - HZ) / 8) ** 2)) * (0.5 + 0.5 * Math.exp(-(((x - S.x) / 50) ** 2)));
    const d = dist(x, y, S.x, S.y);
    if (d > S.r) {
      const out = d - S.r;
      const [A, Lg] = prof(Math.atan2(y - S.y, x - S.x));
      L += 2.8 * Math.exp(-out / 6) + 1.4 * Math.exp(-out / 26) + 2 * A * Math.exp(-out / Lg);
    }
    const db = dist(x, y, bead.x, bead.y);
    L += 4 * Math.exp(-((db / 2.6) ** 2)) + 1.6 * Math.exp(-((db / 10) ** 2));
    L -= 1.4 * smooth(0.8, 1.4, Math.hypot((x - 64) / 64, (y - 70) / 70));
    return L;
  };
  p.paint((x, y, ix, iy) => pick(DUSK, skyL(x, y), ix, iy));
  p.paint((x, y) => (dist(x, y, S.x, S.y) < S.r ? INK[0] : null));
  coronaRing(p, { cx: S.x, cy: S.y, r: S.r, beadAng, width: 1.2, spread: 1.1 });
  p.paint((x, y, ix, iy) => {
    const L = flareL(x, y, bead.x, bead.y, { h: 7, v: 5, diag: 2.5, core: 2 });
    return L < 1.3 ? null : pick(GOLD, 2.6 + L * 0.9, ix, iy);
  });

  // the far shore: a dawn line along the ridge, a dark bank, then a flooded plain
  // (the Border Marches after rain) that mirrors the broken sun in streaks
  const ridge = () => HZ;
  const BANK = 3;
  const ripple = (ix, iy) => fbm1(iy * 0.9 + ix * 0.012, 21 + (iy & 3));
  p.paint((x, y, ix, iy) => {
    const top = ridge(ix);
    if (iy < top) return null;
    const glow = Math.exp(-(((x - S.x) / 40) ** 2));
    if (iy === top)
      return lineRamp([INK[3], EMB[2], EMB[3], EMB[4], EMB[5], EMB[6]], 1 + glow * 4.6);
    if (iy <= top + BANK) return iy === top + 1 ? lineRamp([INK[1], EMB[1]], glow * 1.4) : INK[0];
    const depth = iy - top - BANK;
    // the water holds only the horizon's glow, in streaks, and a glitter path of the
    // dawn running from under the black sun toward the viewer (the thread, broken)
    const Lh = skyL(x, top - 2);
    const r = ripple(ix, iy);
    const atten = 0.6 * Math.exp(-depth / 22);
    let L = Lh * atten * (0.35 + 1.2 * r);
    const pathW = 3 + depth * 0.55;
    const path = Math.exp(-(((x - S.x) / pathW) ** 2));
    if (r > 0.5) L += path * (5.2 - depth * 0.1) * (r - 0.4) * 1.6;
    if (r < 0.3) L *= 0.45; // dark swell between the streaks
    return pick(DUSK, Math.max(0.2, L), ix, iy);
  });

  // the empire's line: massed helms along the ridge and a hedge of pikes against the dawn
  const SIL = INK[0];
  for (let x = 4; x < n - 4; x++) {
    const top = ridge(x);
    const h = hash2(x >> 1, 7, 5);
    const bump = h > 0.72 ? 3 : h > 0.3 ? 2 : 1;
    for (let k = 1; k <= bump; k++) p.set(x, top - k, SIL);
  }
  const pikes = [];
  const COUNT = 15;
  for (let i = 0; i < COUNT; i++) {
    const px = 9 + (i * (n - 18)) / (COUNT - 1) + (hash2(i, 1, 9) - 0.5) * 3;
    const centre = Math.exp(-(((px - S.x) / 38) ** 2));
    const h = 17 + centre * 22 + hash2(i, 2, 9) * 6;
    const lean = (hash2(i, 3, 9) - 0.5) * 0.14;
    pikes.push({ x: px, h, lean, pennant: i === 2 || i === 12 });
  }
  for (const pk of pikes) {
    const base = ridge(Math.round(pk.x)) - 1;
    const tipY = base - pk.h;
    const tipX = pk.x + pk.lean * pk.h;
    p.line(pk.x, base, tipX, tipY + 4, SIL);
    const hx = Math.round(tipX);
    const hy = Math.round(tipY);
    // a long leaf blade: 1 px point, 3 px belly, 1 px socket (7 px tall on a 1 px shaft)
    [1, 1, 3, 3, 3, 1, 1].forEach((w, dy) => {
      for (let dx = -(w >> 1); dx <= w >> 1; dx++) p.set(hx + dx, hy + dy, SIL);
    });
    if (pk.pennant) {
      // an imperial standard: black cloth streaming right, its upper edge lacquer-crimson
      const rows = ['#######', '########', '#########', '########', '######.##', '#####...#'];
      rows.forEach((row, j) =>
        [...row].forEach((ch, k) => {
          if (ch !== '#') return;
          const edge = j === 0 || (j === 1 && k > 5);
          p.set(hx + 1 + k, hy + 8 + j + (k > 5 ? 1 : 0), edge ? BLD[4] : j === 1 ? BLD[2] : SIL);
        }),
      );
    }
  }
  // pike shafts mirrored in the water, broken by the swell
  for (const pk of pikes) {
    const x = Math.round(pk.x);
    const top = ridge(x);
    const len = Math.round(pk.h * 0.45);
    for (let k = 0; k < len; k++) {
      const iy = top + BANK + 1 + k;
      if (ripple(x, iy) > 0.42 && hash2(x, iy, 13) > 0.2)
        p.set(x + Math.round(-pk.lean * k), iy, INK[0]);
    }
  }
}

// =====================================================================================
// 2. The Gap — a sword of light stands in the seam where the eclipse splits.
// =====================================================================================
function theGap(p) {
  const S = { x: 64, y: 60, r: 38 };
  const HZ = 108;
  const cx = 64;
  const beadAng = (-90 * Math.PI) / 180;
  const prof = streamerProfile(23, -0.05);
  const guardY = 26;
  const tipY = HZ + 5;
  const bladeHalf = (y) => {
    const t = (y - guardY) / (tipY - guardY);
    if (t < 0.84) return 3.6 - t * 1.1;
    return Math.max(0, (1 - t) / 0.16) * 2.7;
  };
  const inBlade = (x, y) => y >= guardY && y < tipY && Math.abs(x - cx) < bladeHalf(y);
  const guard = [
    [cx - 15, guardY - 1],
    [cx + 15, guardY - 1],
    [cx + 18, guardY + 1.5],
    [cx + 15, guardY + 4],
    [cx - 15, guardY + 4],
    [cx - 18, guardY + 1.5],
  ];
  const inGuard = (x, y) => inPoly(x, y, guard);
  const inGrip = (x, y) => y >= 13 && y < guardY - 1 && Math.abs(x - cx) < 2;
  const inPommel = (x, y) => Math.abs(x - cx) + Math.abs(y - 10) < 4.1;
  const inSword = (x, y) => inBlade(x, y) || inGuard(x, y) || inGrip(x, y) || inPommel(x, y);
  const nearSword = (x, y) =>
    inSword(x - 1, y) || inSword(x + 1, y) || inSword(x, y - 1) || inSword(x, y + 1);
  const crack = (x, y) => y > guardY && Math.abs(x - cx) < bladeHalf(y) + 3.2;

  p.paint((x, y, ix, iy) => {
    let L = 0.9 + 2 * Math.pow(clamp(y / HZ, 0, 1), 2);
    const d = dist(x, y, S.x, S.y);
    if (d > S.r) {
      const out = d - S.r;
      const [A, Lg] = prof(Math.atan2(y - S.y, x - S.x));
      L += 3.6 * Math.exp(-out / 5) + 1.8 * Math.exp(-out / 22) + 2.8 * A * Math.exp(-out / Lg);
    }
    L += 1.6 * Math.exp(-Math.abs(x - cx) / 5) * smooth(HZ + 2, 40, y);
    L -= 1.6 * smooth(0.85, 1.4, Math.hypot((x - 64) / 64, (y - 60) / 66));
    return pick(SKY, L, ix, iy);
  });
  // the disc, split down the middle: light pours through the seam around the blade
  p.paint((x, y, ix, iy) => {
    const d = dist(x, y, S.x, S.y);
    if (d >= S.r) return null;
    if (crack(x, y)) {
      const e = Math.abs(x - cx) - bladeHalf(y);
      return e < 1.2 ? INK[11] : e < 2.2 ? EMB[6] : pick([EMB[4], EMB[5]], 1.4 - (e - 2.2), ix, iy);
    }
    const e = Math.abs(x - cx) - bladeHalf(y) - 3.2;
    const L = 2.2 * Math.exp(-e / 1.8);
    return pick([INK[0], UNL[0], UNL[1], BLD[1], EMB[1]], L, ix, iy);
  });
  coronaRing(p, { cx: S.x, cy: S.y, r: S.r, beadAng, width: 1, spread: 0.5, inner: 0.8 });
  p.paint((x, y, ix, iy) => {
    if (iy < HZ) return null;
    const g = Math.exp(-(((x - cx) / 24) ** 2));
    if (iy === HZ) return lineRamp([INK[3], EMB[2], EMB[3], EMB[4], EMB[5]], 0.6 + g * 4);
    return pick([INK[0], INK[1], INK[2], INK[3]], 2.2 - (iy - HZ) / 8 + g * 0.8, ix, iy);
  });
  // the sword: gold, lit from the upper-left, a dark keyline so it stands clear of the light
  p.paint((x, y, ix, iy) => {
    if (!inSword(x, y)) return nearSword(x, y) && iy < HZ ? INK[0] : null;
    if (inGuard(x, y)) {
      if (y < guardY + 0.5) return EMB[6];
      if (y < guardY + 1.5) return EMB[5];
      return y < guardY + 3 ? EMB[4] : EMB[3];
    }
    if (inBlade(x, y)) {
      const off = x - cx;
      if (y >= HZ) return lineRamp([EMB[2], EMB[3]], 1.4 - (y - HZ) / 3);
      if (Math.abs(off) < 0.6) return EMB[6];
      return off < 0 ? EMB[5] : off < 2 ? EMB[4] : EMB[3];
    }
    if (inPommel(x, y)) return x < cx - 0.5 ? EMB[6] : x < cx + 0.6 ? EMB[5] : EMB[3];
    return (iy & 1) === 0 ? EMB[4] : EMB[2]; // wrapped grip
  });
}

// =====================================================================================
// 3. Hollow Helm — an empty knight's helm haloed by the Hollow Sun, dawn in the visor.
// =====================================================================================
function hollowHelm(p) {
  const S = { x: 64, y: 54, r: 45 };
  const beadAng = (-135 * Math.PI) / 180;
  const prof = streamerProfile(5, -0.2);
  const TOP = 20; // crown
  const VISOR = 56; // first row of the slit
  const CHIN = 92;
  const PL = { x: 14, y: 134, r: 36 };
  const PR = { x: 114, y: 134, r: 36 };
  // silhouette: a great helm — near-flat crown, straight cheeks, chamfered chin,
  // a gorget down to the frame, and low round pauldrons
  const head = (x, y) => {
    const dx = Math.abs(x - 64);
    if (y < TOP) return false;
    if (y < 40) {
      const yy = (40 - y) / (40 - TOP);
      return Math.pow(dx / 30, 3) + Math.pow(yy, 2) < 1;
    }
    if (y < CHIN - 6) return dx < 30 - 2 * ((y - 40) / (CHIN - 46)) ** 2;
    if (y < CHIN) return dx < 28 - (y - (CHIN - 6)) * 0.9;
    return false;
  };
  const gorget = (x, y) =>
    y >= CHIN - 2 && Math.abs(x - 64) < 20 + Math.pow(Math.max(0, y - CHIN) / 36, 1.6) * 30;
  const pauldron = (x, y) => dist(x, y, PL.x, PL.y) < PL.r || dist(x, y, PR.x, PR.y) < PR.r;
  const body = (x, y) => head(x, y) || gorget(x, y) || pauldron(x, y);
  const inSlit = (x, y) =>
    y >= VISOR && y < VISOR + 3 && Math.abs(x - 64) < 24 && Math.abs(x - 64) > 1.5;

  p.paint((x, y, ix, iy) => {
    let L = 1.3 + 1.8 * Math.pow(clamp(y / 128, 0, 1), 1.4);
    const d = dist(x, y, S.x, S.y);
    if (d > S.r) {
      const out = d - S.r;
      const [A, Lg] = prof(Math.atan2(y - S.y, x - S.x));
      L += 3.6 * Math.exp(-out / 5) + 1.6 * Math.exp(-out / 20) + 2.4 * A * Math.exp(-out / Lg);
    }
    L -= 1.5 * smooth(0.85, 1.4, Math.hypot((x - 64) / 64, (y - 64) / 64));
    return pick(SKY, L, ix, iy);
  });
  p.paint((x, y) => (dist(x, y, S.x, S.y) < S.r ? INK[0] : null));
  coronaRing(p, { cx: S.x, cy: S.y, r: S.r, beadAng, width: 1.2, spread: 1.2 });
  const bead = { x: S.x + Math.cos(beadAng) * S.r, y: S.y + Math.sin(beadAng) * S.r };
  p.paint((x, y, ix, iy) => {
    const L = flareL(x, y, bead.x, bead.y, { h: 16, v: 14, diag: 3, core: 2 });
    return L < 1.2 ? null : pick(GOLD, 2.6 + L * 0.9, ix, iy);
  });

  // blued steel (the player's colour), lit from the upper-left; the sun behind gilds
  // the right-hand edges
  const STEEL = [INK[0], STL[0], STL[1], STL[2], STL[3], STL[4], STL[5]];
  const run = (x, y, dx, dy, max, fn) => {
    let k = 0;
    while (k < max && fn(x + dx * (k + 1), y + dy * (k + 1))) k++;
    return k;
  };
  const helmOrGorget = (a, b) => head(a, b) || gorget(a, b);
  p.paint((x, y, ix, iy) => {
    if (!body(x, y)) return null;
    const dx = x - 64;
    if (!helmOrGorget(x, y)) {
      // pauldrons: darker iron, a lit rim on the upper-left of each, one lame seam
      const c = x < 64 ? PL : PR;
      const d = dist(x, y, c.x, c.y);
      const nx = (x - c.x) / d;
      const ny = (y - c.y) / d;
      const lit = -(nx * 0.6 + ny * 0.8);
      let L = 1.1 + lit * 0.9;
      if (d > c.r - 1.2) {
        if (x > 64 && nx < 0.2) return EMB[2]; // corona rim on the right shoulder
        L += lit > 0.3 ? 2.4 : 0.6;
      }
      if (d > c.r - 8 && d < c.r - 7) L -= 0.9;
      if (d > c.r - 7 && d < c.r - 6) L += 0.7;
      return band(STEEL, L, ix, iy);
    }
    const eL = run(x, y, -1, 0, 3, helmOrGorget);
    const eR = run(x, y, 1, 0, 3, helmOrGorget);
    const eT = run(x, y, 0, -1, 3, helmOrGorget);
    let L = 2.7 - dx / 15;
    if (!head(x, y)) {
      // gorget: stacked lames
      L -= 0.8;
      const k = (iy - CHIN) % 11;
      if (iy >= CHIN && k === 0) L -= 1.1;
      if (iy >= CHIN && k === 1) L += 0.8;
    } else if (y < 40) L += 0.5 * (1 - (40 - y) / 20);
    if (eL === 0) L += 2.6;
    else if (eL === 1) L += 1.1;
    if (eT === 0 && dx < 14) L += 1.8;
    else if (eT === 1 && dx < 8) L += 0.6;
    if (eR === 0) {
      if (iy < CHIN + 4) return iy < 70 ? EMB[4] : EMB[3];
      L -= 1;
    }
    // the keel down the face
    if (head(x, y)) {
      if (Math.abs(dx) < 0.6) L += 1.7;
      else if (dx > 0.5 && dx < 1.6) L -= 1;
    }
    // brow band over the visor, with rivets
    if (iy >= VISOR - 5 && iy < VISOR && head(x, y)) {
      if (iy === VISOR - 1) return INK[0];
      if (iy === VISOR - 5) L += 1.3;
      else L += 0.35;
      if (iy === VISOR - 3 && [-22, -12, 12, 22].includes(Math.round(dx - 0.5)))
        return dx < 0 ? STL[5] : STL[3];
    }
    // breaths: two short columns of slots on the right cheek
    if (head(x, y) && iy >= VISOR + 9 && iy <= CHIN - 10) {
      const col = Math.round(dx - 0.5);
      if ((col === 10 || col === 14 || col === 18) && (iy - VISOR) % 4 < 2) return INK[0];
    }
    let c = band(STEEL, L, ix, iy);
    // the slit's light spilling onto the cheek plates below it
    const sd = iy - (VISOR + 3);
    if (head(x, y) && sd >= 0 && sd < 4 && Math.abs(dx) < 25) {
      const w = Math.exp(-sd / 1.3) * (1 - Math.abs(dx) / 30);
      if (w + bayer(ix, iy) * 0.45 > 0.62) c = w > 0.6 ? EMB[3] : EMB[2];
    }
    return c;
  });
  // the visor slit: dawn inside an empty helm
  p.paint((x, y, ix, iy) => {
    if (!inSlit(x, y)) return null;
    const dx = Math.abs(x - 64);
    if (iy === VISOR + 1) return dx < 16 ? EMB[6] : EMB[5];
    return dx < 12 ? EMB[5] : EMB[4];
  });
}

// =====================================================================================
// 4. Hollow Crest — the sun as negative space: a faceted gilt sunburst with no sun in it.
// =====================================================================================
function hollowCrest(p) {
  const C = { x: 64, y: 64 };
  const R0 = 21; // the hole
  const R1 = 30; // outer edge of the ring
  const RAYS = 12;
  const LONG = 57;
  const SHORT = 45;
  const HALF = (Math.PI / RAYS) * 0.92;
  const LX = -Math.SQRT1_2; // toward the key light (upper-left)
  const LY = -Math.SQRT1_2;
  const rayAt = (x, y) => {
    const dx = x - C.x;
    const dy = y - C.y;
    const rho = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const k = Math.round(((a + Math.PI / 2) / TAU) * RAYS);
    const th = (k / RAYS) * TAU - Math.PI / 2; // ray 0 points straight up
    const tip = ((k % RAYS) + RAYS) % 2 === 0 ? LONG : SHORT;
    const d = angDiff(a, th);
    const along = rho * Math.cos(d);
    const across = rho * Math.sin(d);
    const baseA = R1 * Math.cos(HALF) - 3;
    const half = (R1 * Math.sin(HALF) * (tip - along)) / (tip - R1 * Math.cos(HALF));
    if (along < baseA || along > tip || Math.abs(across) > half) return null;
    return { th, across, along, half, tip };
  };
  const inCrest = (x, y) => {
    const r = dist(x, y, C.x, C.y);
    return (r >= R0 && r < R1) || (r >= R1 && rayAt(x, y));
  };
  // ground: ink night, a pale corona breathing behind the crest, dawn low
  p.paint((x, y, ix, iy) => {
    const d = dist(x, y, C.x, C.y);
    let L = 1 + 1.6 * Math.pow(clamp(y / 128, 0, 1), 1.6);
    L += 2.6 * Math.exp(-Math.max(0, d - 30) / 16);
    L -= 1.6 * smooth(0.85, 1.4, Math.hypot((x - 64) / 64, (y - 64) / 64));
    return pick(SKY, L, ix, iy);
  });
  // cast shadow, down-right
  p.paint((x, y) => (!inCrest(x, y) && inCrest(x - 2, y - 2) ? INK[0] : null));
  // keyline
  p.paint((x, y) => {
    if (inCrest(x, y)) return null;
    const r = dist(x, y, C.x, C.y);
    if (r < R0) return null;
    return inCrest(x - 1, y) || inCrest(x + 1, y) || inCrest(x, y - 1) || inCrest(x, y + 1)
      ? INK[0]
      : null;
  });
  p.paint((x, y, ix, iy) => {
    if (!inCrest(x, y)) return null;
    const r = dist(x, y, C.x, C.y);
    const nx = (x - C.x) / r;
    const ny = (y - C.y) / r;
    if (r < R1) {
      // the ring: a rounded band, split by an engraved groove
      const mid = (R0 + R1) / 2;
      if (Math.abs(r - mid) < 0.55) return EMB[1];
      const outward = r > mid ? 1 : -1;
      const dot = outward * (nx * LX + ny * LY);
      const edge = r > R1 - 1 || r < R0 + 1;
      return band(GOLD, 3.7 + 2 * dot + (edge && dot > 0 ? 0.8 : 0), ix, iy, 0.25);
    }
    const ray = rayAt(x, y);
    // two facets either side of a ridge
    const side = ray.across >= 0 ? 1 : -1;
    const fnx = -Math.sin(ray.th) * side;
    const fny = Math.cos(ray.th) * side;
    const dot = fnx * LX + fny * LY;
    if (Math.abs(ray.across) < 0.5) return dot > 0 ? EMB[6] : EMB[5]; // the ridge
    const toward = 1 - (ray.along - R1) / (ray.tip - R1); // brighter near the ring
    return band(GOLD, 3.4 + 2.3 * dot + toward * 0.4, ix, iy, 0.25);
  });
  // the hole: void, its far wall catching the light
  p.paint((x, y, ix, iy) => {
    const r = dist(x, y, C.x, C.y);
    if (r >= R0) return null;
    const nx = (x - C.x) / r;
    const ny = (y - C.y) / r;
    const far = -(nx * LX + ny * LY); // >0 on the lower-right wall
    if (r >= R0 - 1 && far > 0.25) return EMB[2];
    if (r >= R0 - 2 && far > 0.55 && bayer(ix, iy) < 0.5) return EMB[1];
    return INK[0];
  });
  // the diamond-ring bead on the hole's upper-left lip
  const ba = (-135 * Math.PI) / 180;
  const bead = { x: C.x + Math.cos(ba) * R0, y: C.y + Math.sin(ba) * R0 };
  p.paint((x, y, ix, iy) => {
    const L = flareL(x, y, bead.x, bead.y, { h: 8, v: 8, diag: 2.5, core: 1.7 });
    return L < 1.7 ? null : pick([EMB[5], EMB[6], INK[11]], (L - 1.7) * 0.6, ix, iy);
  });
}

// =====================================================================================
// 5. The Last Warden — the title's lone figure on the promontory under the Hollow Sun.
//     Painted at 64 x 64 (twice the chunk) so the figure keeps the key art's own pixels.
// =====================================================================================
const WARDEN = [
  '...........h....',
  '..........#.....',
  '..........#.....',
  '.........#......',
  '....##...#......',
  '...####..#......',
  '...####.#.......',
  '....##..#.......',
  '..#######.......',
  '..#########.....',
  '..###########...',
  '...###########..',
  '...####.#######.',
  '...###....######',
  '...###......###.',
  '...###.......#.#',
  '...##.#.........',
  '...##.#.........',
  '...##.#.........',
  '...##..#........',
  '...##..#........',
  '..###..##.......',
];
function lastWarden(p) {
  const S = { x: 45, y: 19, r: 14 };
  const feet = { x: 15, y: 52 };
  const hand = { x: feet.x - 4 + 11, y: feet.y - WARDEN.length };
  const toHand = Math.atan2(hand.y - S.y, hand.x - S.x);
  const beadAng = toHand - 0.3;
  const bead = { x: S.x + Math.cos(beadAng) * S.r, y: S.y + Math.sin(beadAng) * S.r };
  const prof = streamerProfile(3, -0.35);
  const HZ = 52;
  p.paint((x, y, ix, iy) => {
    let L = 0.9 + 7.2 * Math.pow(clamp(y / HZ, 0, 1.1), 1.8);
    const d = dist(x, y, S.x, S.y);
    if (d > S.r) {
      const out = d - S.r;
      const [A, Lg] = prof(Math.atan2(y - S.y, x - S.x));
      L +=
        3 * Math.exp(-out / 3.5) +
        1.3 * Math.exp(-out / 13) +
        2.6 * A * Math.exp(-out / (Lg * 0.55));
    }
    const db = dist(x, y, bead.x, bead.y);
    L += 2.2 * Math.exp(-((db / 1.4) ** 2)) + 0.8 * Math.exp(-((db / 4) ** 2));
    L -= 1.5 * smooth(0.85, 1.4, Math.hypot((x - 32) / 32, (y - 30) / 34));
    return pick(SKY, L, ix, iy);
  });
  p.paint((x, y) => (dist(x, y, S.x, S.y) < S.r ? INK[0] : null));
  coronaRing(p, {
    cx: S.x,
    cy: S.y,
    r: S.r,
    beadAng,
    width: 1,
    spread: 0.7,
    inner: 0.5,
    boost: 0.7,
  });
  // far ranges, parting behind the figure so the brightest sky sits at its head
  p.paint((x, y, ix, iy) => {
    const dip = 1 - 0.8 * Math.exp(-(((ix - feet.x) / 10) ** 2));
    const top = HZ - 2 - Math.round((fbm1(ix * 0.14, 8) * 6 + 1) * dip);
    if (iy < top) return null;
    return pick([INK[1], INK[2], INK[3], INK[4], INK[5]], 3.4 - (iy - top) / 4, ix, iy);
  });
  // the promontory: a slab rising from the lower right to the figure's ledge
  const rockTop = (ix) => {
    let t;
    if (ix <= feet.x + 6) t = feet.y + Math.max(0, feet.x - 10 - ix) * 0.3;
    else t = feet.y + (ix - feet.x - 6) * 0.55;
    return Math.round(t + (fbm1(ix * 0.35, 4) - 0.5) * 1.2);
  };
  p.paint((x, y, ix, iy) => {
    const top = rockTop(ix);
    if (iy < top) return null;
    return pick([INK[0], INK[1], INK[2]], 1.5 - (iy - top) / 6, ix, iy);
  });
  // gold threads spun from the bead down to the raised hand, bowed like the title's
  for (let s = 0; s < 2; s++) {
    const ang = beadAng + (s ? 0.1 : -0.06);
    const from = [S.x + Math.cos(ang) * (S.r + 0.6), S.y + Math.sin(ang) * (S.r + 0.6)];
    const vx = hand.x - from[0];
    const vy = hand.y - from[1];
    const len = Math.hypot(vx, vy);
    const bow = s ? 6 : 3.5;
    const ctrl = [
      (from[0] + hand.x) / 2 - (vy / len) * bow,
      (from[1] + hand.y) / 2 + (vx / len) * bow,
    ];
    p.polyline(bezier2(from, ctrl, [hand.x, hand.y], 200), s ? EMB[4] : EMB[5]);
  }
  p.stamp(WARDEN, feet.x - 4, feet.y - WARDEN.length, { '#': INK[0], h: EMB[6] });
}

// =====================================================================================
// 6. Diamond Ring — the instant the light returns: one bead of dawn on the black sun's rim.
// =====================================================================================
function diamondRing(p) {
  const S = { x: 68, y: 68, r: 35 };
  const beadAng = (-135 * Math.PI) / 180;
  const bead = {
    x: S.x + Math.cos(beadAng) * (S.r + 0.5),
    y: S.y + Math.sin(beadAng) * (S.r + 0.5),
  };
  const prof = streamerProfile(17, -0.6);
  p.paint((x, y, ix, iy) => {
    let L = 1.1 + 2.2 * Math.pow(clamp(y / 128, 0, 1), 1.3);
    const d = dist(x, y, S.x, S.y);
    if (d > S.r) {
      const out = d - S.r;
      const [A, Lg] = prof(Math.atan2(y - S.y, x - S.x));
      L += 3.6 * Math.exp(-out / 5) + 1.8 * Math.exp(-out / 24) + 3 * A * Math.exp(-out / Lg);
    }
    const db = dist(x, y, bead.x, bead.y);
    L += 2.2 * Math.exp(-((db / 14) ** 2));
    L -= 1.6 * smooth(0.85, 1.4, Math.hypot((x - 66) / 64, (y - 66) / 64));
    return pick(SKY, L, ix, iy);
  });
  p.paint((x, y) => (dist(x, y, S.x, S.y) < S.r ? INK[0] : null));
  coronaRing(p, { cx: S.x, cy: S.y, r: S.r, beadAng, width: 1, spread: 0.9, inner: 1.2 });
  p.paint((x, y, ix, iy) => {
    const L = flareL(x, y, bead.x, bead.y, { h: 44, v: 20, diag: 6, core: 2.6 });
    if (L < 1.1) return null;
    return pick(GOLD, 2.4 + L * 0.85, ix, iy);
  });
}

export const CONCEPTS = [
  {
    id: 'hollow-dawn',
    name: 'Hollow Dawn',
    grid: 128,
    concept:
      'The Hollow Sun rising over a horizon hedge of the empire’s pikes; dawn breaks around the black disc.',
    draw: hollowDawn,
  },
  {
    id: 'hollow-helm',
    name: 'Hollow Helm',
    grid: 128,
    concept:
      'An empty knight’s helm haloed by the Hollow Sun; the only light is dawn through its visor slit.',
    draw: hollowHelm,
  },
  {
    id: 'hollow-crest',
    name: 'Hollow Crest',
    grid: 128,
    concept:
      'The sun as negative space: a faceted gilt sunburst whose centre is a hole, lit from the upper-left.',
    draw: hollowCrest,
  },
  {
    id: 'the-gap',
    name: 'The Gap',
    grid: 128,
    concept: 'The eclipse splits down the middle and a sword of light stands in the seam.',
    draw: theGap,
  },
  {
    id: 'diamond-ring',
    name: 'Diamond Ring',
    grid: 128,
    concept:
      'The instant the light returns: one white-gold bead flares on the black sun’s rim, its ray a single thread.',
    draw: diamondRing,
  },
  {
    id: 'last-warden',
    name: 'The Last Warden',
    grid: 64,
    concept:
      'The title’s lone figure on the promontory, gold threads spun from the Hollow Sun to a raised hand.',
    draw: lastWarden,
  },
];

export function renderConcept(c) {
  const p = new Plate(c.grid);
  c.draw(p);
  return p;
}
