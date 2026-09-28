// A piece: shots on the score's clock, drawn onto the page, with transitions between
// them and a snapshot cache (a shot frozen at one moment, which can then be torn, turned
// like a page, or stripped back to paper as a layer of its own).
//
// A shot is { name, from, to, draw(f, t), enter?: { kind, dur, ...opts } }. draw() gets a
// frame buffer that already holds the bare page. `enter` is the transition from the
// previous shot, which keeps drawing (its t runs on) until the transition ends.

import { buildStages, DEFAULTS } from './stages.js';
import { Layer, makePaper } from './compositor.js';
import { quantise } from './palette.js';
import { drawSprite } from './view.js';
import { burnWipe, inkWipe, pageTurn } from './transitions.js';
import { flash } from './anime.js';
import { Motion } from './motion.js';

export const loadImage = (src) =>
  new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`could not load ${src}`));
    im.src = src;
  });

/** The plate variant of the line settings: broader lines, higher floors, less wash. */
export const plateParams = (p) => ({
  ...p,
  sigma: p.sigma * p.plateSigma,
  lineLo: p.lineLo + p.plateLift,
  lineHi: p.lineHi + p.plateLift,
  pencilLo: p.pencilLo + p.plateLift,
  pencilHi: p.pencilHi + p.plateLift,
  tint: p.tint * 0.5,
});

/** A 16:9 crop of a landscape image; cy picks where it sits vertically (0 top, 1 bottom). */
export const crop169 = (img, cy = 0.5) => {
  const h = (img.width * 9) / 16;
  return { x: 0, y: (img.height - h) * cy, w: img.width, h };
};

/** Pull warm light out of a plate's wash (sunsets): no ordinary sun in any plate. */
export function coolGrade(stages, k = 1) {
  const w = stages.wash;
  for (let i = 0; i < w.length; i += 4) {
    const r = w[i];
    const g = w[i + 1];
    const b = w[i + 2];
    const warm = Math.max(0, r - b - 18) * k;
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    w[i] = r - warm * 0.75;
    w[i + 1] = g - warm * 0.3;
    w[i + 2] = b + warm * 0.25;
    // and a cooler, greyer overall
    w[i] = w[i] * 0.85 + L * 0.15 * k;
    w[i + 1] = w[i + 1] * 0.85 + L * 0.15 * k;
    w[i + 2] = w[i + 2] * 0.85 + (L + 8) * 0.15 * k;
  }
  return stages;
}

export class Piece {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.cache = new Map();
    this.snaps = new Map();
    this.params = { ...DEFAULTS };
    this.bufs = [0, 1, 2, 3].map(() => new Uint8ClampedArray(W * H * 4));
  }

  async loadImages(src) {
    const e = Object.entries(src);
    const imgs = await Promise.all(e.map(([, s]) => loadImage(s)));
    this.img = Object.fromEntries(e.map(([k], i) => [k, imgs[i]]));
    this.paper = makePaper(this.W, this.H);
  }

  /**
   * Load motion clips (atlas + JSON from motion/clip.py) by name. A clip that hasn't been
   * made yet is skipped, and shots fall back to their still cut-out.
   */
  async loadMotions(dir, names) {
    this.motionSrc = {};
    await Promise.all(
      names.map(async (n) => {
        try {
          const r = await fetch(`${dir}/${n}.json`);
          if (!r.ok) return;
          const meta = await r.json();
          const img = await loadImage(`${dir}/${n}.webp`);
          this.motionSrc[n] = { meta, img };
        } catch {
          /* not made yet */
        }
      }),
    );
  }

  /** A Motion (see motion.js) at height h art px, or null if the clip isn't there. */
  motion(name, h, o = {}) {
    const m = this.motionSrc?.[name];
    if (!m) return null;
    return this.memo(
      `motion:${name}:${h}:${o.flip ? 1 : 0}`,
      () => new Motion(m.img, m.meta, h, { ...o, params: this.params }),
    );
  }

  /** Forget built layers (after the line settings change). */
  build(params) {
    this.params = { ...DEFAULTS, ...params };
    this.cache.clear();
    this.snaps.clear();
  }

  /** A private scratch frame, for shots that compose in several passes. */
  scratch(name) {
    return this.memo(`scratch:${name}`, () => new Uint8ClampedArray(this.W * this.H * 4));
  }

  memo(key, make) {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key);
  }

  /**
   * A full-frame plate. o: { crop, zoom (built this much larger, for push-ins), w, h,
   * cool (0..1 grade), tint, seed, grain, lift (raise the line floors: calmer drawing) }.
   * Returns a Layer with .xf, its default
   * placement (centred on the frame).
   */
  plate(key, img, o = {}) {
    return this.memo(`plate:${key}`, () => {
      const z = o.zoom ?? 1;
      const w = Math.round((o.w ?? this.W) * z);
      const h = Math.round((o.h ?? this.H) * z);
      const pp = plateParams(this.params);
      const lift = o.lift ?? 0;
      const st = buildStages(img, w, h, {
        ...pp,
        lineLo: pp.lineLo + lift,
        lineHi: pp.lineHi + lift,
        pencilLo: pp.pencilLo + lift,
        pencilHi: pp.pencilHi + lift,
        crop: o.crop ?? crop169(img),
      });
      if (o.cool) coolGrade(st, o.cool);
      const l = new Layer(st, 0, 0, o.seed ?? 11, o.grain ?? 44);
      if (o.tint) l.tintRGB = o.tint;
      l.skin = !!o.skin;
      l.xf = { x: this.W / 2, y: this.H / 2, ax: w / 2, ay: h / 2, scale: 1 / z };
      return l;
    });
  }

  /** A keyed figure, h art px tall, anchored at its feet (bottom centre). */
  figure(key, img, h, o = {}) {
    return this.memo(`fig:${key}:${h}:${o.flip ? 1 : 0}`, () => {
      const c = o.crop;
      const ar = c ? c.w / c.h : img.width / img.height;
      const w = Math.round(h * ar);
      const st = buildStages(img, w, h, { ...this.params, figure: true, flip: !!o.flip, crop: c });
      const l = new Layer(st, 0, 0, o.seed ?? 21, o.grain ?? 14);
      if (o.tint) l.tintRGB = o.tint;
      l.skin = o.skin ?? true; // figures are people (a skin ramp is allowed)
      l.w = w;
      l.h = h;
      return l;
    });
  }

  /** Placement for a figure layer: feet at (x, y), scale s, rotation rot. */
  at(l, x, y, s = 1, rot = 0, extra = {}) {
    return { x, y, ax: l.st.w / 2, ay: l.st.h, scale: s, rot, ...extra };
  }

  /** Draw a layer into frame f (see view.drawSprite). */
  draw(f, layer, s, xf, cam, opts) {
    drawSprite(f, this.W, this.H, this.paper, layer, s, xf ?? layer.xf, cam ?? this.cam0, opts);
  }

  get cam0() {
    return { x: this.W / 2, y: this.H / 2, zoom: 1, rot: 0 };
  }

  /** A shot frozen at time t (RGBA, unquantised), cached. */
  snapshot(name, t) {
    const key = `${name}@${t.toFixed(3)}`;
    if (!this.snaps.has(key)) {
      const f = new Uint8ClampedArray(this.W * this.H * 4);
      f.set(this.paper);
      const shot = this.shots.find((s) => s.name === name);
      shot.draw(f, t);
      this.snaps.set(key, f);
    }
    return this.snaps.get(key);
  }

  /** A snapshot as a page layer of its own, so it can lose its paint like any painting. */
  snapLayer(name, t, seed = 51, skin = false) {
    return this.memo(`snapLayer:${name}@${t.toFixed(3)}`, () => {
      const f = this.snapshot(name, t).slice();
      for (let i = 3; i < f.length; i += 4) f[i] = 255;
      const cv = new OffscreenCanvas(this.W, this.H);
      cv.getContext('2d').putImageData(new ImageData(f, this.W, this.H), 0, 0);
      const st = buildStages(cv, this.W, this.H, plateParams(this.params));
      const l = new Layer(st, 0, 0, seed, 22);
      l.skin = skin;
      l.xf = { x: this.W / 2, y: this.H / 2, ax: this.W / 2, ay: this.H / 2, scale: 1 };
      return l;
    });
  }

  shotAt(t) {
    const S = this.shots;
    for (let i = 0; i < S.length; i++) if (t < S[i].to) return i;
    return S.length - 1;
  }

  /** Draw shot i at t into f (the page first). */
  drawShot(f, i, t) {
    f.set(this.paper);
    this.shots[i].draw(f, t);
  }

  render(out, t, { pixel = true, dither = 0.45 } = {}) {
    const i = this.shotAt(t);
    const s = this.shots[i];
    const e = s.enter;
    if (e && i > 0 && t >= s.from && t < s.from + e.dur) {
      const A = this.bufs[0];
      const B = this.bufs[1];
      this.drawShot(A, i - 1, t);
      this.drawShot(B, i, t);
      const p = (t - s.from) / e.dur;
      const fn = { page: pageTurn, ink: inkWipe, burn: burnWipe }[e.kind];
      if (fn) fn(out, A, B, this.W, this.H, p, e);
      else out.set(B);
    } else this.drawShot(out, i, t);
    if (this.post) this.post(out, t);
    if (pixel) quantise(out, this.W, this.H, dither);
  }

  /** Helper: a white (or coloured) flash over the frame by k. */
  flash(f, k, c) {
    flash(f, this.W, this.H, k, c);
  }
}
