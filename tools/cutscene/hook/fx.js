// Procedural layers for "The Roll": the thread, the Roll's red threads, Sera's
// branching sight, the tactical grid, the Hollow Sun, grain. All pure functions of t.

import { hash, hash2, clamp, prog, lerp, easeOut, easeInOut } from '../pilot/engine.js';

export const COL = {
  ground: '#07060b',
  gold: '#e9b458',
  goldHi: '#fff0bd',
  goldDim: '#7d5626',
  red: '#d23a31',
  redHi: '#ff8a64',
  redDim: '#5e1519',
  bone: '#f1e6cf',
  boneDim: '#8f8577',
};

export const boil = (t, fps = 12) => Math.floor(t * fps);
const TAU = Math.PI * 2;

/** A glowing line through pts ([[x,y]...]) drawn up to fraction k, with a nib. */
export function thread(g, pts, k, o = {}) {
  if (k <= 0 || pts.length < 2) return null;
  const len = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    len.push(d);
    total += d;
  }
  let want = total * clamp(k);
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = new Path2D();
  path.moveTo(pts[0][0], pts[0][1]);
  let end = pts[0];
  for (let i = 1; i < pts.length && want > 0; i++) {
    const f = Math.min(1, want / len[i - 1]);
    end = [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)];
    path.lineTo(end[0], end[1]);
    want -= len[i - 1];
  }
  g.globalAlpha = o.alpha ?? 1;
  if (o.glow !== false) {
    g.shadowColor = o.glowColor ?? o.color ?? COL.gold;
    g.shadowBlur = o.blur ?? 14;
  }
  g.strokeStyle = o.color ?? COL.gold;
  g.lineWidth = o.width ?? 2.5;
  g.stroke(path);
  g.shadowBlur = 0;
  if (o.nib !== false && k < 1) {
    g.fillStyle = o.nibColor ?? COL.goldHi;
    g.shadowColor = o.color ?? COL.gold;
    g.shadowBlur = 18;
    g.beginPath();
    g.arc(end[0], end[1], (o.width ?? 2.5) * 1.3, 0, TAU);
    g.fill();
  }
  g.restore();
  return end;
}

/** Catmull-Rom points through control points (for smooth threads). */
export function spline(ctrl, per = 16) {
  const out = [];
  const p = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    for (let s = 0; s < per; s++) {
      const u = s / per;
      const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
      const f = (a, b, c, d) =>
        0.5 *
        (2 * b +
          (-a + c) * u +
          (2 * a - 5 * b + 4 * c - d) * u * u +
          (-a + 3 * b - 3 * c + d) * u * u * u);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/**
 * Threads peeling off a drawing: each source point lets go at its own time in
 * [t0, t1] and streams toward `dir` with a wavering tail.
 * pts: [[x, y, id]...] in output pixels.
 */
export function peel(g, t, pts, o) {
  const { t0, t1, life = 1.4, dir = [0.35, -1], speed = 260, color = COL.red } = o;
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 8;
  for (const [x, y, id] of pts) {
    const start = lerp(t0, t1, o.order ? o.order(x, y, id) : hash2(id, 3));
    const a = (t - start) / life;
    if (a <= 0 || a >= 1) continue;
    const sp = speed * (0.6 + hash2(id, 5) * 0.8);
    const wob = (hash2(id, 7) - 0.5) * 80;
    const seg = 10;
    g.globalAlpha = (1 - a) * (o.alpha ?? 0.9);
    g.lineWidth = o.width ?? 1.4;
    g.beginPath();
    for (let s = 0; s <= seg; s++) {
      const u = Math.max(0, a - (s / seg) * 0.35) * life;
      const px = x + dir[0] * sp * u + Math.sin(u * 5 + id) * wob * u;
      const py = y + dir[1] * sp * u + Math.cos(u * 3 + id) * 6 * u;
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
}

/** Red threads converging from the frame's edges into a point (the pit). */
export function converge(g, t, o) {
  const { n = 140, t0, t1, cx, cy, W, H, seed = 11 } = o;
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const born = lerp(t0, t1, hash2(seed, i) * 0.8);
    const a = (t - born) / (o.life ?? 3.2);
    if (a <= 0) continue;
    const side = Math.floor(hash2(seed, i + 500) * 4);
    const r = hash2(seed, i + 900);
    const sx = side === 0 ? r * W : side === 1 ? W + 20 : side === 2 ? r * W : -20;
    const sy = side === 0 ? -20 : side === 1 ? r * H : side === 2 ? H + 20 : r * H * 0.9;
    // bend: a control point pulled sideways
    const mx = lerp(sx, cx, 0.5) + (hash2(seed, i + 77) - 0.5) * 260;
    const my = lerp(sy, cy, 0.5) + (hash2(seed, i + 78) - 0.5) * 160;
    const head = easeInOut(clamp(a));
    const tail = easeInOut(clamp(a - 0.35));
    const q = (u) => [
      (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * mx + u * u * cx,
      (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * my + u * u * cy,
    ];
    g.globalAlpha = (o.alpha ?? 0.85) * (a < 1.2 ? 1 : clamp(1 - (a - 1.2) * 2));
    g.strokeStyle = hash2(seed, i + 3) < 0.12 ? COL.redHi : COL.red;
    g.lineWidth = 0.8 + hash2(seed, i + 4) * 1.4;
    g.shadowColor = COL.red;
    g.shadowBlur = 6;
    g.beginPath();
    for (let s = 0; s <= 24; s++) {
      const u = lerp(tail, head, s / 24);
      const [x, y] = q(u);
      if (s === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

/**
 * Sera's sight: a thread from (x0, y0) that forks again and again toward the right.
 * Every branch but one ends in a red cross. Growth k in [0, 1]; `alive` is the
 * branch index that survives (drawn in bright gold to the edge).
 * Returns the number of crosses drawn (for the tally).
 */
export function branches(g, t, o) {
  const { x0, y0, W, k, depth = 6, seed = 5 } = o;
  const segs = [];
  const grow = (x, y, ang, d, id, alive) => {
    const L = ((W - x0) / (depth + 1.2)) * (0.8 + hash2(seed, id) * 0.4);
    const x1 = x + Math.cos(ang) * L;
    const y1 = y + Math.sin(ang) * L;
    segs.push({ x, y, x1, y1, d, id, alive, leaf: d === depth });
    if (d < depth) {
      const spread = 0.62 * Math.pow(0.78, d);
      const aliveKid = alive ? (hash2(seed, id + 99) < 0.5 ? 0 : 1) : -1;
      grow(
        x1,
        y1,
        ang - spread * (0.6 + hash2(seed, id * 2) * 0.6),
        d + 1,
        id * 2 + 1,
        aliveKid === 0,
      );
      grow(
        x1,
        y1,
        ang + spread * (0.6 + hash2(seed, id * 2 + 1) * 0.6),
        d + 1,
        id * 2 + 2,
        aliveKid === 1,
      );
    }
  };
  // aim the tree at the middle of the frame's right side, so its leaves fan across it
  grow(x0, y0, Math.atan2((o.H ?? 720) / 2 - y0, W - x0) * 0.6, 0, 0, true);
  let crosses = 0;
  g.save();
  g.lineCap = 'round';
  for (const s of segs) {
    const a = clamp(k * (depth + 1) - s.d);
    if (a <= 0) continue;
    const ex = lerp(s.x, s.x1, easeOut(a));
    const ey = lerp(s.y, s.y1, easeOut(a));
    const retracted = o.dim && !s.alive;
    g.globalAlpha = retracted ? o.dim : 1;
    g.strokeStyle = s.alive ? COL.goldHi : COL.gold;
    g.shadowColor = COL.gold;
    g.shadowBlur = s.alive ? 16 : 8;
    g.lineWidth = s.alive ? 2.6 : Math.max(0.8, 2.2 - s.d * 0.25);
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.lineTo(ex, ey);
    g.stroke();
    if (s.leaf && !s.alive && a >= 1) {
      crosses++;
      const r = 6;
      g.shadowBlur = 6;
      g.shadowColor = COL.red;
      g.strokeStyle = COL.red;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ex - r, ey - r);
      g.lineTo(ex + r, ey + r);
      g.moveTo(ex + r, ey - r);
      g.lineTo(ex - r, ey + r);
      g.stroke();
    }
  }
  g.restore();
  return crosses;
}

/** The tactical grid, lines arriving on the given times. */
export function grid(g, t, o) {
  const { W, H, cell = 64, times = [], alpha = 0.5, color = COL.gold } = o;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const lines = [];
  for (let i = 1; i < cols; i++) lines.push(['v', i * cell, i]);
  for (let j = 1; j < rows; j++) lines.push(['h', j * cell, j + 100]);
  lines.sort((a, b) => hash(a[2] * 7 + 3) - hash(b[2] * 7 + 3));
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1;
  lines.forEach(([dir, p, id], i) => {
    const born = times.length ? times[Math.floor((i / lines.length) * times.length)] : 0;
    const a = easeOut(prog(t, born, born + 0.25));
    if (a <= 0) return;
    g.globalAlpha = alpha * (o.fade ?? 1);
    g.beginPath();
    if (dir === 'v') {
      const up = hash(id) < 0.5;
      g.moveTo(p, up ? H : 0);
      g.lineTo(p, up ? H - H * a : H * a);
    } else {
      const lt = hash(id) < 0.5;
      g.moveTo(lt ? 0 : W, p);
      g.lineTo(lt ? W * a : W - W * a, p);
    }
    g.stroke();
  });
  g.restore();
}

/** The Hollow Sun: a black disc and its corona, the ring drawn to fraction k. */
export function hollowSun(g, t, o) {
  const { x, y, r, k = 1, bright = 1 } = o;
  g.save();
  // corona haze
  const haze = g.createRadialGradient(x, y, r * 0.9, x, y, r * (2.2 + bright * 0.8));
  haze.addColorStop(0, `rgba(233,180,88,${0.35 * bright * k})`);
  haze.addColorStop(1, 'rgba(233,180,88,0)');
  g.fillStyle = haze;
  g.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
  // flames of the corona: hashed rays that flicker on the boil clock
  const f = boil(t);
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const ang = (i / 90) * TAU;
    if (ang / TAU > k) continue;
    const L = r * (0.08 + hash2(i, f) * 0.18 * bright);
    g.strokeStyle = i % 3 ? COL.gold : COL.goldHi;
    g.globalAlpha = 0.55 * bright;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x + Math.cos(ang) * r * 1.02, y + Math.sin(ang) * r * 1.02);
    g.lineTo(x + Math.cos(ang) * (r + L), y + Math.sin(ang) * (r + L));
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = COL.ground;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = COL.goldHi;
  g.shadowColor = COL.gold;
  g.shadowBlur = 22 * bright;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(k));
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- grain

let grainTiles = null;
function makeGrain(W, H) {
  grainTiles = [];
  for (let k = 0; k < 6; k++) {
    const c = new OffscreenCanvas(W / 2, H / 2);
    const x = c.getContext('2d');
    const img = x.createImageData(W / 2, H / 2);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(hash2(k + 1, i) * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    grainTiles.push(c);
  }
}

/** Film grain and a vignette, over everything. */
export function finish(g, t, { grain = 0.07, vignette = 0.55 } = {}) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  if (!grainTiles) makeGrain(W, H);
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = grain;
  g.imageSmoothingEnabled = false;
  g.drawImage(grainTiles[boil(t) % grainTiles.length], 0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(7,6,11,0)');
  v.addColorStop(1, `rgba(7,6,11,${vignette})`);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  g.restore();
}

/** A full-frame flash that decays over `dur`. */
export function flash(g, t, t0, { dur = 0.25, color = COL.bone, peak = 0.9 } = {}) {
  const a = 1 - prog(t, t0, t0 + dur);
  if (t < t0 || a <= 0) return;
  g.save();
  g.globalAlpha = peak * a * a;
  g.fillStyle = color;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();
}

/**
 * A drawn fire: tongues of flame as closed curves that re-draw on the boil clock
 * (12 fps), ember to bone from the outside in, with a warm light pooled around it.
 */
export function fire(g, t, { x, y, s = 1, n = 7, seed = 3, light = 1 } = {}) {
  const f = boil(t);
  g.save();
  const pool = g.createRadialGradient(x, y - 30 * s, 10 * s, x, y - 30 * s, 260 * s);
  pool.addColorStop(0, `rgba(233,150,60,${0.28 * light})`);
  pool.addColorStop(1, 'rgba(233,150,60,0)');
  g.fillStyle = pool;
  g.fillRect(x - 300 * s, y - 330 * s, 600 * s, 600 * s);
  const layers = [
    ['#8a2a14', 1.0],
    ['#d0602a', 0.78],
    ['#f3b24e', 0.55],
    ['#fff0c4', 0.3],
  ];
  for (const [col, sc] of layers) {
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 12 * s;
    for (let i = 0; i < n; i++) {
      const bx = x + (i - (n - 1) / 2) * 11 * s * sc;
      const hgt = (40 + hash2(seed + i, f) * 55) * s * sc * (1 - Math.abs(i - (n - 1) / 2) / n);
      const wdt = 13 * s * sc;
      const lean = (hash2(seed + i, f + 99) - 0.5) * 18 * s;
      g.beginPath();
      g.moveTo(bx - wdt, y);
      g.quadraticCurveTo(bx - wdt * 0.9, y - hgt * 0.55, bx + lean, y - hgt);
      g.quadraticCurveTo(bx + wdt * 0.9, y - hgt * 0.5, bx + wdt, y);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}
