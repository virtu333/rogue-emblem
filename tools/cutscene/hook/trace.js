// Traced drawings (trace.py output) redrawn as engraved ink.
//
// A trace is a sequence of drawings on twos (12 fps). Each drawing has layers of
// even-odd filled polygons in half-pixels of a 960x540 frame. The renderer never
// sees the source video; it only knows these shapes, and draws them in a palette:
//
//   fg  the figure: a dark body with a boiling rim line
//   t1  midtones: engraved hatching         t2  lights: flat ink
//   t3  highlights                          ln  ink lines over everything lit
//   gl  light itself (fire, candle, corona, spell), with a halo
//   b1  background shadows: sparse lines    b2  background lights
//
// A camera ({ z, x, y }: zoom about a point of the 960x540 frame) moves over the
// vectors, so push-ins and reframes cost nothing and stay sharp.

import { hash2 } from '../pilot/engine.js';

export const TW = 960;
export const TH = 540;

export const PALETTES = {
  gold: {
    ground: '#07060b',
    shadow: '#1a110d',
    mid: '#7d5626',
    light: '#d69b42',
    high: '#f8dd9e',
    ink: '#120a07',
    rim: '#e9b458',
    glow: '#fff0c4',
    bg1: '#3a2614',
    bg2: '#6e4a22',
  },
  red: {
    ground: '#07060b',
    shadow: '#1c090c',
    mid: '#6f1a1f',
    light: '#c3342d',
    high: '#f19067',
    ink: '#100407',
    rim: '#e0443a',
    glow: '#ffd4a4',
    bg1: '#3a0e12',
    bg2: '#6f1a1f',
  },
  night: {
    ground: '#06070c',
    shadow: '#0c1220',
    mid: '#243750',
    light: '#6283a4',
    high: '#f0dcae',
    ink: '#060911',
    rim: '#e9b458',
    glow: '#ffe3a8',
    bg1: '#101b2c',
    bg2: '#243750',
  },
  mist: {
    ground: '#07080b',
    shadow: '#10141a',
    mid: '#3a444f',
    light: '#9aa5ab',
    high: '#eef0e6',
    ink: '#090b0f',
    rim: '#c8d0cf',
    glow: '#ffffff',
    bg1: '#161c24',
    bg2: '#3a444f',
  },
  dusk: {
    ground: '#07060b',
    shadow: '#140b10',
    mid: '#5e2a1c',
    light: '#c0602c',
    high: '#f6c77c',
    ink: '#0c0507',
    rim: '#f0b25a',
    glow: '#fff1c8',
    bg1: '#2c1216',
    bg2: '#7a3420',
  },
};

// ---------------------------------------------------------------- loading

async function gunzipJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // a server may already have undone the gzip (Content-Encoding); check the magic
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/** Decode delta-encoded polygons into absolute Float32Arrays (frame pixels). */
function decode(flat) {
  const n = flat.length >> 1;
  const out = new Float32Array(n * 2);
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += flat[i * 2];
    y += flat[i * 2 + 1];
    out[i * 2] = x / 2;
    out[i * 2 + 1] = y / 2;
  }
  return out;
}

export async function loadTrace(url) {
  const doc = await gunzipJson(url);
  const frames = doc.frames.map((f) => {
    const o = {};
    for (const k of Object.keys(f)) o[k] = f[k].map(decode);
    return o;
  });
  return { shot: doc.shot, fps: doc.fps, n: doc.n, frames, paths: new Map() };
}

/** Smooth closed path through the midpoints (soft, drawn-looking outlines). */
function pathOf(polys) {
  const p = new Path2D();
  for (const a of polys) {
    const n = a.length >> 1;
    if (n < 3) continue;
    const mx = (i) => (a[(i % n) * 2] + a[((i + 1) % n) * 2]) / 2;
    const my = (i) => (a[(i % n) * 2 + 1] + a[((i + 1) % n) * 2 + 1]) / 2;
    p.moveTo(mx(0), my(0));
    for (let i = 1; i <= n; i++)
      p.quadraticCurveTo(a[(i % n) * 2], a[(i % n) * 2 + 1], mx(i), my(i));
    p.closePath();
  }
  return p;
}

export function tracePath(tr, idx, layer) {
  const key = `${idx}:${layer}`;
  let p = tr.paths.get(key);
  if (!p) {
    p = pathOf(tr.frames[idx][layer] || []);
    tr.paths.set(key, p);
    if (tr.paths.size > 4000) tr.paths.delete(tr.paths.keys().next().value);
  }
  return p;
}

/** Which drawing plays at clip time c (seconds into the source clip). */
export function frameAt(tr, c, loop = 'hold') {
  let i = Math.floor(c * tr.fps + 1e-6);
  if (loop === 'pingpong') {
    const m = 2 * (tr.n - 1);
    i = ((i % m) + m) % m;
    if (i >= tr.n) i = m - i;
  }
  return Math.max(0, Math.min(tr.n - 1, i));
}

// ---------------------------------------------------------------- patterns

const hatchCache = new Map();
/** A hatch tile: lines at `angle` degrees, `gap` px apart, `w` px wide. */
export function hatch(g, color, { angle = 45, gap = 5, w = 1.4, alpha = 1 } = {}) {
  const key = `${color}|${angle}|${gap}|${w}|${alpha}`;
  let pat = hatchCache.get(key);
  if (pat) return pat;
  const s = 64;
  const c = new OffscreenCanvas(s, s);
  const x = c.getContext('2d');
  x.strokeStyle = color;
  x.globalAlpha = alpha;
  x.lineWidth = w;
  x.translate(s / 2, s / 2);
  x.rotate((angle * Math.PI) / 180);
  for (let i = -s; i <= s; i += gap) {
    x.beginPath();
    x.moveTo(-s, i);
    x.lineTo(s, i);
    x.stroke();
  }
  pat = g.createPattern(c, 'repeat');
  hatchCache.set(key, pat);
  return pat;
}

// ---------------------------------------------------------------- drawing

/**
 * Draw drawing `idx` of trace `tr` into g (output canvas, 1280x720 or any size).
 * o: { pal, cam: {z, x, y}, alpha, rim, lines, glow, bg, clip(g) }
 */
export function drawTrace(g, tr, idx, o = {}) {
  const pal = typeof o.pal === 'string' ? PALETTES[o.pal] : o.pal || PALETTES.gold;
  const W = g.canvas.width;
  const H = g.canvas.height;
  const cam = o.cam || { z: 1, x: TW / 2, y: TH / 2 };
  const s = (W / TW) * cam.z;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  if (o.clip) o.clip(g);
  g.setTransform(s, 0, 0, s, W / 2 - cam.x * s, H / 2 - cam.y * s);
  const P = (k) => tracePath(tr, idx, k);
  const has = (k) => tr.frames[idx][k]?.length;
  const lw = 1 / s; // one output pixel, in frame units

  if (o.bg !== false && has('b1')) {
    g.fillStyle = hatch(g, pal.bg1, { angle: 0, gap: 4, w: 1.2 });
    g.fill(P('b1'), 'evenodd');
  }
  if (o.bg !== false && has('b2')) {
    g.fillStyle = pal.bg2;
    g.fill(P('b2'), 'evenodd');
  }
  if (has('fg')) {
    g.fillStyle = pal.shadow;
    g.fill(P('fg'), 'evenodd');
  }
  if (has('t1')) {
    g.fillStyle = hatch(g, pal.mid, { angle: o.hatchAngle ?? 45, gap: 4, w: 1.6 });
    g.fill(P('t1'), 'evenodd');
  }
  if (has('t2')) {
    g.fillStyle = pal.light;
    g.fill(P('t2'), 'evenodd');
  }
  if (has('t3')) {
    g.fillStyle = pal.high;
    g.fill(P('t3'), 'evenodd');
  }
  if (o.lines !== false && has('ln')) {
    g.fillStyle = pal.ink;
    g.fill(P('ln'), 'evenodd');
  }
  if (o.rim !== false && has('fg')) {
    g.strokeStyle = pal.rim;
    g.lineJoin = 'round';
    g.lineWidth = (o.rimWidth ?? 2) * lw;
    g.stroke(P('fg'));
  }
  if (o.glow !== false && has('gl')) {
    g.globalCompositeOperation = 'lighter';
    g.filter = `blur(${Math.round(10 * cam.z)}px)`;
    g.fillStyle = pal.glow;
    g.globalAlpha = (o.alpha ?? 1) * 0.55;
    g.fill(P('gl'), 'evenodd');
    g.filter = 'none';
    g.globalAlpha = o.alpha ?? 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = pal.glow;
    g.fill(P('gl'), 'evenodd');
  }
  g.restore();
}

/** Points sampled along a drawing's polygons (for threads that peel off it). */
export function samplePoints(tr, idx, layer, n, seed = 1, keep = () => true) {
  const polys = tr.frames[idx][layer] || [];
  const all = [];
  for (const a of polys) for (let i = 0; i < a.length; i += 2) all.push(a[i], a[i + 1]);
  const pts = [];
  const m = all.length >> 1;
  if (!m) return pts;
  for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
    const i = Math.floor(hash2(seed, tries) * m);
    const x = all[i * 2];
    const y = all[i * 2 + 1];
    if (!keep(x, y)) continue;
    pts.push([x, y, k]);
    k++;
  }
  return pts;
}

/** Map a frame point (960x540) to output pixels under a camera. */
export function toOut(W, H, cam, x, y) {
  const s = (W / TW) * cam.z;
  return [W / 2 + (x - cam.x) * s, H / 2 + (y - cam.y) * s];
}
