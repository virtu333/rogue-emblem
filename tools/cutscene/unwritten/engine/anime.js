// The anime vocabulary, drawn in the Unwritten Page's materials: ink, paper and the one
// gold thread. Focus and speed lines, impact frames, flashes, shake, slashes, blade
// glints, sparks, splashes, ash and paint flakes. Everything is a pure function of its
// arguments; effects that are "drawn by hand" take a drawing index (on twos: 12 a
// second) so they boil the way hand-drawn effects do, instead of sliding.

import { bayer, clamp, hash, hexToRgb, noiseField, smooth, valueNoise } from './raster.js';
import { C } from './palette.js';

export const RGB = {
  ink: hexToRgb(C.ink),
  sepia: hexToRgb(C.sepia),
  graphite: hexToRgb(C.graphite),
  paper: hexToRgb(C.paper),
  paperHi: hexToRgb(C.paperHi),
  gold: hexToRgb(C.gold),
  goldHi: hexToRgb(C.goldHi),
  goldWhite: hexToRgb(C.goldWhite),
  crimson: hexToRgb(C.crimson),
  blood: hexToRgb('#6e1a28'),
  violet: hexToRgb(C.violet),
  steel: hexToRgb('#b8d8e6'),
  steelMid: hexToRgb('#77a5c6'),
};

/** A glow's tones for light that is not the Thread's: steel and bone, never gold. */
export const PALE = [RGB.steelMid, RGB.steel, RGB.paperHi];

/** Drawing index on twos (12 drawings a second at 24 fps). */
export const twos = (t) => Math.floor(t * 12);
/** t held on twos: for anything that should step like a drawing. */
export const onTwos = (t) => Math.floor(t * 12) / 12;

export function put(frame, fw, fh, x, y, c, a = 1) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= fw || y >= fh) return;
  const o = (y * fw + x) * 4;
  if (a >= 1) {
    frame[o] = c[0];
    frame[o + 1] = c[1];
    frame[o + 2] = c[2];
    return;
  }
  frame[o] = frame[o] * (1 - a) + c[0] * a;
  frame[o + 1] = frame[o + 1] * (1 - a) + c[1] * a;
  frame[o + 2] = frame[o + 2] * (1 - a) + c[2] * a;
}

/** A dithered put: on if a > the ordered threshold (pixel art has no half pixels). */
export const dput = (frame, fw, fh, x, y, c, a) => {
  if (a > bayer(x | 0, y | 0)) put(frame, fw, fh, x, y, c);
};

/**
 * Focus lines (shuchusen): tapered ink wedges pointing at (cx, cy), leaving a clear
 * ellipse. `drawing` reseeds them: pass twos(t) and they boil.
 * o: { inner: clear radius (px), count, width (px at the frame edge), color, aspect,
 *      jitter (0..1 inner radius spread), amount (0..1 how many lines are drawn),
 *      outer (px: where the lines end, fraying into the dither) }
 */
export function focusLines(frame, fw, fh, cx, cy, drawing, o = {}) {
  const {
    inner = 90,
    count = 90,
    width = 5,
    color = RGB.sepia,
    aspect = 1.6,
    jitter = 0.45,
    amount = 1,
    seed = 3,
    outer = Infinity, // lines end here (px from the point), fraying into the dither
  } = o;
  const BINS = 1440;
  const bins = new Int16Array(BINS).fill(-1);
  const R = Math.hypot(fw, fh * aspect);
  const lines = [];
  for (let i = 0; i < count; i++) {
    if (hash(i, drawing, seed + 1) > amount) continue;
    const a = hash(i, drawing, seed) * Math.PI * 2;
    const r0 = inner * (1 + (hash(i, drawing, seed + 2) - 0.2) * jitter * 2);
    const w = width * (0.35 + hash(i, drawing, seed + 3));
    lines.push([a, r0, w]);
    const half = w / R + 0.004;
    const b0 = Math.floor(((a - half) / (Math.PI * 2)) * BINS);
    const b1 = Math.ceil(((a + half) / (Math.PI * 2)) * BINS);
    for (let b = b0; b <= b1; b++) bins[((b % BINS) + BINS) % BINS] = lines.length - 1;
  }
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const dx = x - cx;
      const dy = (y - cy) * aspect;
      const r = Math.hypot(dx, dy);
      if (r < inner * (1 - jitter)) continue;
      let th = Math.atan2(dy, dx);
      if (th < 0) th += Math.PI * 2;
      const li = bins[Math.floor((th / (Math.PI * 2)) * BINS) % BINS];
      if (li < 0) continue;
      const [a, r0, w] = lines[li];
      if (r <= r0) continue;
      let d = Math.abs(th - a);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const hw = (w * (r - r0)) / (R - r0);
      if (d * r >= hw) continue;
      if (r > outer * 0.5) {
        if (r > outer) continue;
        if ((r - outer * 0.5) / (outer * 0.5) > bayer(x, y) * 0.9 + 0.05) continue;
      }
      put(frame, fw, fh, x, y, color);
    }
}

/**
 * Speed lines: thin streaks along the direction of travel (horizontal by default),
 * moving at `speed` px/s. o: { y0, y1 (band), density 0..1, len, color, vertical }
 */
export function speedLines(frame, fw, fh, t, o = {}) {
  const {
    density = 0.35,
    len = 60,
    color = RGB.sepia,
    speed = 900,
    seed = 9,
    vertical = false,
    y0 = 0,
    y1 = vertical ? fw : fh,
    thin = 1,
  } = o;
  const along = vertical ? fh : fw;
  const drawing = twos(t);
  for (let row = y0; row < y1; row++) {
    // rows come and go per drawing, so the field boils
    if (hash(row, drawing >> 1, seed) > density) continue;
    const n = 1 + Math.floor(hash(row, 1, seed) * 2);
    for (let k = 0; k < n; k++) {
      const L = len * (0.4 + hash(row, k + 7, seed) * 1.2);
      const span = along + L * 2;
      const raw = hash(row, k + 3, seed) * span + t * speed * (0.7 + hash(row, k, seed) * 0.6);
      const start = ((raw % span) + span) % span;
      const a = start - L;
      for (let s = 0; s < L; s++) {
        const p = a + s;
        const taper = Math.min(s / (L * 0.3), (L - s) / (L * 0.3), 1);
        const x = vertical ? row : p;
        const y = vertical ? p : row;
        if (taper > bayer(x | 0, y | 0)) {
          put(frame, fw, fh, x, y, color);
          if (thin > 1) put(frame, fw, fh, vertical ? x + 1 : x, vertical ? y : y + 1, color);
        }
      }
    }
  }
}

/**
 * An impact frame: the image thrown into two tones. mode 'neg' puts the light parts in
 * ink and the dark parts in `light` (a photographic negative); 'pos' keeps them.
 */
export function impact(frame, fw, fh, o = {}) {
  const { dark = RGB.ink, light = RGB.paperHi, mode = 'neg', bias = 0 } = o;
  let mean = 0;
  for (let i = 0; i < fw * fh; i++) {
    const p = i * 4;
    mean += 0.299 * frame[p] + 0.587 * frame[p + 1] + 0.114 * frame[p + 2];
  }
  mean = mean / (fw * fh) + bias;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const p = (y * fw + x) * 4;
      const L = 0.299 * frame[p] + 0.587 * frame[p + 1] + 0.114 * frame[p + 2];
      let on = L > mean + (bayer(x, y) - 0.5) * 18;
      if (mode === 'neg') on = !on;
      const c = on ? light : dark;
      frame[p] = c[0];
      frame[p + 1] = c[1];
      frame[p + 2] = c[2];
    }
}

/** A flash toward colour c by k (0..1), dithered: pixels go over, they don't fade. */
export function flash(frame, fw, fh, k, c = RGB.paperHi) {
  if (k <= 0) return;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      if (k <= bayer(x, y)) continue;
      const p = (y * fw + x) * 4;
      frame[p] = c[0];
      frame[p + 1] = c[1];
      frame[p + 2] = c[2];
    }
}

/**
 * Camera shake from a list of hit times: [dx, dy, rot]. Each hit kicks the camera and it
 * rings down over `decay` s. Deterministic.
 */
export function shake(t, hits, amp = 6, decay = 0.25, rotAmp = 0) {
  let dx = 0;
  let dy = 0;
  let r = 0;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const a = Array.isArray(h) ? h[1] : 1;
    const ht = Array.isArray(h) ? h[0] : h;
    const u = t - ht;
    if (u < 0 || u > decay * 4) continue;
    const e = Math.exp(-u / decay) * a;
    const q = Math.floor(u * 24); // on ones: shake is camera, not drawing
    dx += (valueNoise(q * 0.9, i * 7, 11) - 0.5) * 2 * amp * e;
    dy += (valueNoise(q * 0.9, i * 7, 12) - 0.5) * 2 * amp * e;
    r += (valueNoise(q * 0.9, i * 7, 13) - 0.5) * 2 * rotAmp * e;
  }
  return [dx, dy, r];
}

/** A tapered brush stroke from (x0, y0) to (x1, y1), width w0 -> w1, drawn to p. */
export function stroke(frame, fw, fh, x0, y0, x1, y1, w0, w1, c, p = 1, rough = 0.4, seed = 1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(L * 1.5);
  const nx = -(y1 - y0) / L;
  const ny = (x1 - x0) / L;
  for (let i = 0; i <= n * clamp(p); i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u;
    const w = (w0 + (w1 - w0) * u) * (1 + (valueNoise(u * 12, seed, 5) - 0.5) * rough);
    for (let s = -w / 2; s <= w / 2; s += 0.5) put(frame, fw, fh, x + nx * s, y + ny * s, c);
  }
}

/**
 * The Empire's blow: a crimson slash across the frame, thick in the middle, drawn over
 * two drawings, with ink spatter along it.
 */
export function slash(frame, fw, fh, x0, y0, x1, y1, p, w = 16, seed = 1) {
  if (p <= 0) return;
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(L * 1.5);
  const nx = -(y1 - y0) / L;
  const ny = (x1 - x0) / L;
  const end = clamp(p * 1.6);
  const start = clamp((p - 0.55) * 2.2);
  for (let i = Math.floor(n * start); i <= n * end; i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u;
    const ww = w * Math.sin(Math.PI * u) ** 0.7 * (0.8 + valueNoise(u * 20, seed, 3) * 0.4);
    for (let s = -ww / 2; s <= ww / 2; s += 0.5) {
      const edge = Math.abs(s) / (ww / 2 + 1e-6);
      const c = edge > 0.72 ? RGB.blood : edge < 0.2 ? RGB.crimsonHi : RGB.crimson;
      put(frame, fw, fh, x + nx * s, y + ny * s, c);
    }
  }
  // spatter
  for (let i = 0; i < 40; i++) {
    const u = hash(i, seed, 1);
    if (u > end || u < start) continue;
    const off = (hash(i, seed, 2) - 0.5) * w * 3.5;
    const x = x0 + (x1 - x0) * u + nx * off;
    const y = y0 + (y1 - y0) * u + ny * off;
    const r = hash(i, seed, 3) * 2.2;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r) put(frame, fw, fh, x + dx, y + dy, RGB.crimson);
  }
}
RGB.crimsonHi = hexToRgb('#ec7a5c');

/**
 * A glint running along a blade from (x0, y0) to (x1, y1): p is the glint's position
 * (0..1). Brightens what is there (steel is already light) and flares at the tip.
 */
export function glint(frame, fw, fh, x0, y0, x1, y1, p, width = 7, band = 0.12) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / L;
  const uy = (y1 - y0) / L;
  const xa = Math.max(0, Math.min(x0, x1) - width) | 0;
  const xb = Math.min(fw, Math.max(x0, x1) + width) | 0;
  const ya = Math.max(0, Math.min(y0, y1) - width) | 0;
  const yb = Math.min(fh, Math.max(y0, y1) + width) | 0;
  for (let y = ya; y < yb; y++)
    for (let x = xa; x < xb; x++) {
      const rx = x - x0;
      const ry = y - y0;
      const along = (rx * ux + ry * uy) / L;
      const across = Math.abs(-rx * uy + ry * ux);
      if (along < 0 || along > 1 || across > width) continue;
      const k = (1 - Math.abs(along - p) / band) * (1 - across / width);
      if (k <= 0) continue;
      const o = (y * fw + x) * 4;
      const L2 = 0.299 * frame[o] + 0.587 * frame[o + 1] + 0.114 * frame[o + 2];
      if (L2 < 70) continue; // only the steel catches it
      if (k * 1.6 > bayer(x, y)) put(frame, fw, fh, x, y, k > 0.55 ? RGB.paperHi : RGB.steel);
    }
  if (p > 0.85 && p < 1.25)
    star(frame, fw, fh, x1, y1, 14 * Math.sin(((p - 0.85) / 0.4) * Math.PI));
}

/** A four-point star (a sparkle) of arm length r. */
export function star(frame, fw, fh, cx, cy, r, c = RGB.paperHi) {
  if (r < 1) return;
  for (let i = -r; i <= r; i++) {
    const w = 1 - Math.abs(i) / r;
    if (w > 0.15 || Math.abs(i) < 2) {
      put(frame, fw, fh, cx + i, cy, c);
      put(frame, fw, fh, cx, cy + i, c);
    }
    if (Math.abs(i) < r * 0.35) {
      put(frame, fw, fh, cx + i * 0.7, cy + i * 0.7, c, 0.8);
      put(frame, fw, fh, cx + i * 0.7, cy - i * 0.7, c, 0.8);
    }
  }
}

/**
 * Sparks from a clash at (cx, cy), born at t0: short bright streaks flying out and
 * falling. Steel white, never gold: gold is the thread's.
 */
export function sparks(frame, fw, fh, cx, cy, t, t0, o = {}) {
  const { count = 40, speed = 260, life = 0.6, seed = 5, color = RGB.paperHi, dir = null } = o;
  const u = t - t0;
  if (u < 0 || u > life * 1.4) return;
  for (let i = 0; i < count; i++) {
    const a = dir !== null ? dir + (hash(i, seed, 1) - 0.5) * 1.6 : hash(i, seed, 1) * Math.PI * 2;
    const v = speed * (0.35 + hash(i, seed, 2));
    const li = life * (0.5 + hash(i, seed, 3) * 0.6);
    if (u > li) continue;
    const x = cx + Math.cos(a) * v * u;
    const y = cy + Math.sin(a) * v * u + 220 * u * u;
    const tail = 3 + v * 0.02;
    const k = 1 - u / li;
    for (let s = 0; s < tail; s++) {
      const q = s / tail;
      if (k * (1 - q) > bayer((x - Math.cos(a) * s) | 0, (y - Math.sin(a) * s) | 0) * 0.8)
        put(frame, fw, fh, x - Math.cos(a) * s, y - Math.sin(a) * s, q < 0.3 ? color : RGB.steel);
    }
  }
}

/** A splash of water at (cx, cy) born at t0: droplets arcing up and out, paper-white. */
export function splash(frame, fw, fh, cx, cy, t, t0, o = {}) {
  const {
    count = 50,
    speed = 150,
    seed = 8,
    spread = 1.2,
    dir = -Math.PI / 2,
    colors = [RGB.paperHi, RGB.steel],
    life = 1.2,
    gravity = 320,
  } = o;
  const u = t - t0;
  if (u < 0 || u > life) return;
  for (let i = 0; i < count; i++) {
    const a = dir + (hash(i, seed, 1) - 0.5) * spread * 2;
    const v = speed * (0.3 + hash(i, seed, 2) * 0.9);
    const x = cx + Math.cos(a) * v * u;
    const y = cy + Math.sin(a) * v * u + gravity * u * u;
    if (y > cy + 6) continue;
    const r = hash(i, seed, 3) < 0.3 ? 1.5 : 0.8;
    const c = colors[Math.floor(hash(i, seed, 4) * colors.length)];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r) put(frame, fw, fh, x + dx, y + dy, c);
  }
}

/**
 * Ash drifting down (or paint flakes, with colours from `palette`). Deterministic per t;
 * flakes tumble on twos (a flake is a 1-3 px drawing that flips).
 */
export function ash(frame, fw, fh, t, o = {}) {
  const {
    count = 70,
    fall = 18,
    drift = -14,
    seed = 4,
    palette = [RGB.graphite, RGB.paper],
    par = 1,
    camx = 0,
    camy = 0,
  } = o;
  const d = twos(t);
  for (let i = 0; i < count; i++) {
    const sx = hash(i, 1, seed) * (fw + 80);
    const sy = hash(i, 2, seed) * (fh + 60);
    const sp = 0.6 + hash(i, 3, seed) * 0.8;
    let x = sx + drift * t * sp + Math.sin(t * (1 + hash(i, 4, seed)) + i) * 6 - camx * par;
    let y = sy + fall * t * sp - camy * par;
    x = ((((x + 40) % (fw + 80)) + fw + 80) % (fw + 80)) - 40;
    y = ((((y + 30) % (fh + 60)) + fh + 60) % (fh + 60)) - 30;
    const c = palette[i % palette.length];
    const flip = (d + i) & 1;
    put(frame, fw, fh, x, y, c);
    if (hash(i, 5, seed) < 0.5) put(frame, fw, fh, x + (flip ? 1 : 0), y + (flip ? 0 : 1), c);
  }
}

/**
 * Flakes of paint peeling off a painting and blowing away: coloured bits sampled from
 * `src` (an RGBA frame the size of the screen), born over [t0, t1], blowing toward
 * (vx, vy). The rewind uses this: the future is being scraped off the page.
 */
export function flakes(frame, fw, fh, src, t, t0, t1, o = {}) {
  const { count = 160, vx = -260, vy = -60, seed = 12 } = o;
  for (let i = 0; i < count; i++) {
    const born = t0 + hash(i, 1, seed) * (t1 - t0);
    const u = t - born;
    if (u < 0 || u > 0.9) continue;
    const sx = hash(i, 2, seed) * fw;
    const sy = hash(i, 3, seed) * fh;
    const so = ((sy | 0) * fw + (sx | 0)) * 4;
    const c = [src[so], src[so + 1], src[so + 2]];
    const sp = 0.5 + hash(i, 4, seed);
    const x = sx + vx * u * sp + Math.sin(u * 9 + i) * 4;
    const y = sy + vy * u * sp + 40 * u * u;
    const sz = hash(i, 5, seed) < 0.3 ? 2 : 1;
    for (let dy = 0; dy < sz; dy++)
      for (let dx = 0; dx < sz; dx++) put(frame, fw, fh, x + dx, y + dy, c);
  }
}

/**
 * The thread's light around (cx, cy), radius r, strength k: a dithered halo of gold
 * pixels thinning outward (brighter golds in the middle). Pixel-art light: no blending,
 * which would only muddy the colour under it. tones: [outer, mid, core] (gold unless it
 * is a light that is not the Thread's: use PALE for steel and lamplight).
 */
export function glow(frame, fw, fh, cx, cy, r, k, tones = [RGB.gold, RGB.goldHi, RGB.goldWhite]) {
  const x0 = Math.max(0, (cx - r) | 0);
  const x1 = Math.min(fw, (cx + r) | 0);
  const y0 = Math.max(0, (cy - r) | 0);
  const y1 = Math.min(fh, (cy + r) | 0);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.25) / r;
      if (d >= 1) continue;
      const a = (1 - d) ** 2.2 * k;
      if (a * 0.85 <= bayer(x, y)) continue;
      put(frame, fw, fh, x, y, a > 0.7 ? tones[2] : a > 0.4 ? tones[1] : tones[0]);
    }
}

/**
 * A gold polyline (the thread) through pts [[x, y], ...], drawn to fraction p of its
 * length, with a 1 px core, a dithered halo, and a spark at the drawing end.
 */
export function threadPath(frame, fw, fh, pts, p = 1, o = {}) {
  const { halo = 0.6, spark = true, core = RGB.goldWhite } = o;
  if (p <= 0 || pts.length < 2) return;
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push(L);
    total += L;
  }
  const want = total * clamp(p);
  let acc = 0;
  let ex = pts[0][0];
  let ey = pts[0][1];
  for (let i = 1; i < pts.length && acc < want; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const L = segs[i - 1];
    const n = Math.max(1, Math.ceil(L * 2));
    for (let s = 0; s <= n; s++) {
      if (acc + (L * s) / n > want) break;
      const x = ax + ((bx - ax) * s) / n;
      const y = ay + ((by - ay) * s) / n;
      put(frame, fw, fh, x, y, core);
      if (bayer(x | 0, y | 0) < halo) put(frame, fw, fh, x, y - 1, RGB.goldHi, 0.85);
      if (bayer((x | 0) + 2, y | 0) < halo * 0.6) put(frame, fw, fh, x, y + 1, RGB.gold, 0.8);
      ex = x;
      ey = y;
    }
    acc += L;
  }
  if (spark && p < 1) star(frame, fw, fh, ex, ey, 3, RGB.goldWhite);
}

/** Points of a gently waving thread from (x0, y0) to (x1, y1). */
export function wavePts(x0, y0, x1, y1, t, amp = 4, waves = 1.5, n = 60, phase = 0) {
  const pts = [];
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const L = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const w = Math.sin(u * Math.PI * 2 * waves + t * 1.7 + phase) * amp * Math.sin(u * Math.PI);
    pts.push([x0 + (x1 - x0) * u + (nx / L) * w, y0 + (y1 - y0) * u + (ny / L) * w]);
  }
  return pts;
}

/**
 * The thread as a tunnel: we rush down it toward the vanishing point (vx, vy). Strands
 * come from the frame edges; dashes of light stream out toward the camera at `speed`.
 */
export function threadTunnel(frame, fw, fh, vx, vy, t, o = {}) {
  const { strands = 26, speed = 2.2, seed = 6, amount = 1, twist = 0.6 } = o;
  const R = Math.hypot(fw, fh);
  for (let i = 0; i < strands; i++) {
    if (hash(i, 9, seed) > amount) continue;
    const a0 = (i / strands) * Math.PI * 2 + hash(i, 1, seed) * 0.3 + t * twist * 0.3;
    const dashes = 5;
    for (let k = 0; k < dashes; k++) {
      // position along the strand in 0..1 (0 at the vanishing point), moving outward
      const ph = (hash(i, k + 2, seed) + t * speed * (0.8 + hash(i, 3, seed) * 0.5)) % 1;
      const r0 = R * 0.62 * ph ** 2.2;
      const r1 = R * 0.62 * Math.min(1, ph + 0.09) ** 2.2;
      const a = a0 + ph * twist;
      const x0 = vx + Math.cos(a) * r0;
      const y0 = vy + Math.sin(a) * r0 * 0.7;
      const x1 = vx + Math.cos(a) * r1;
      const y1 = vy + Math.sin(a) * r1 * 0.7;
      const L = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.ceil(L * 1.5) + 1;
      for (let s = 0; s <= n; s++) {
        const x = x0 + ((x1 - x0) * s) / n;
        const y = y0 + ((y1 - y0) * s) / n;
        put(frame, fw, fh, x, y, ph > 0.5 ? RGB.goldWhite : RGB.goldHi);
        if (ph > 0.55) put(frame, fw, fh, x, y + 1, RGB.gold);
      }
    }
  }
}

/**
 * The thread snapping: two ends from (cx, cy) whipping apart, a gold burst, fibres.
 * u: seconds since the snap.
 */
export function threadSnap(frame, fw, fh, x0, y0, x1, y1, cx, cy, u) {
  if (u < 0) return;
  const spring = (s) => Math.exp(-s * 4) * Math.cos(s * 22);
  for (const [ex, ey, side] of [
    [x0, y0, -1],
    [x1, y1, 1],
  ]) {
    const pts = [];
    const n = 40;
    const recoil = Math.min(1, u * 5);
    for (let i = 0; i <= n; i++) {
      const q = i / n; // 0 at the anchor (the hand), 1 at the broken end
      const bx = ex + (cx - ex) * q * (1 - recoil * 0.45);
      const by = ey + (cy - ey) * q;
      const whip = spring(u * 1.4 + (1 - q) * 0.3) * 26 * q * q * side;
      pts.push([bx, by + whip - q * q * 18 * recoil]);
    }
    threadPath(frame, fw, fh, pts, 1, { spark: false });
    // loose fibres at the broken end
    const [fx, fy] = pts[n];
    for (let k = 0; k < 6; k++) {
      const a = side > 0 ? Math.PI + (k - 2.5) * 0.35 : (k - 2.5) * 0.35;
      const len = 4 + k * 1.5;
      for (let s = 0; s < len; s++)
        put(frame, fw, fh, fx - Math.cos(a) * s, fy + Math.sin(a + u * 3) * s * 0.6, RGB.goldHi);
    }
  }
  const burst = Math.max(0, 1 - u * 3);
  if (burst > 0) {
    glow(frame, fw, fh, cx, cy, 70 * burst + 10, burst, RGB.goldHi);
    star(frame, fw, fh, cx, cy, 30 * burst, RGB.goldWhite);
  }
}

/** The Hollow Sun at any size, with ink rays when it is hungry (k: 0..1). */
export function hollowSunRays(frame, fw, fh, cx, cy, r, t, rays = 0) {
  if (rays <= 0) return;
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 0.05;
    const len = r * (0.6 + valueNoise(i, twos(t) * 0.5, 2) * 1.6) * rays;
    for (let s = r + 4; s < r + 4 + len; s++) {
      const w = 1 - (s - r) / (len + 4);
      if (w > bayer((cx + Math.cos(a) * s) | 0, (cy + Math.sin(a) * s) | 0))
        put(frame, fw, fh, cx + Math.cos(a) * s, cy + Math.sin(a) * s, RGB.ink);
    }
  }
}

/** Eased helpers used by the shot code. */
export const easeOut = (k) => 1 - (1 - clamp(k)) ** 3;
export const easeIn = (k) => clamp(k) ** 3;
export const easeInOut = (k) => smooth(0, 1, k);

const STRIP = new Map();

/**
 * Paint coming off a live frame (a moving shot, which has no paint stages of its own):
 * by k (0..1), pixels in organic patches go back to the page, and only the dark edges
 * (the drawing) stay, as ink, then as pencil. Cheap enough to run every frame.
 */
export function stripLive(frame, paper, fw, fh, k, seed = 5) {
  if (k <= 0) return;
  if (!STRIP.has(seed)) STRIP.set(seed, noiseField(fw, fh, seed, 40));
  const nf = STRIP.get(seed);
  const L = new Float32Array(fw * fh);
  for (let i = 0; i < fw * fh; i++)
    L[i] = (0.299 * frame[i * 4] + 0.587 * frame[i * 4 + 1] + 0.114 * frame[i * 4 + 2]) / 255;
  const pencil = k > 0.7;
  const c = pencil ? RGB.graphite : RGB.sepia;
  for (let y = 1; y < fh - 1; y++)
    for (let x = 1; x < fw - 1; x++) {
      const i = y * fw + x;
      if (0.8 * nf[i] + 0.2 * bayer(x, y) >= k) continue;
      const o = i * 4;
      const around = (L[i - 1] + L[i + 1] + L[i - fw] + L[i + fw]) / 4;
      const edge = L[i] < around - (pencil ? 0.11 : 0.07) && L[i] < 0.55;
      const col = edge ? c : [paper[o], paper[o + 1], paper[o + 2]];
      frame[o] = col[0];
      frame[o + 1] = col[1];
      frame[o + 2] = col[2];
      frame[o + 3] = 255;
    }
}
