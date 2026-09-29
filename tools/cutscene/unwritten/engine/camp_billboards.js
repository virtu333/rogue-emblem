// The camp's billboards: everything drawn as cards or strokes standing in the world after the
// ray-tested pass, back to front and depth-tested against it: the palisade, grass in the wind,
// the spear tripod and the banner, far sentry fires and a torchbearer pacing behind the tents,
// the flame, smoke, embers, and the figures with the fire's light on them (rim, gradient and
// long shadows). Installed on CampWorld's prototype (engine/camp_world.js).

import { project } from './world.js';
import { bayer, clamp, hash, lerp, smooth } from './raster.js';
import { drawSprite, layerMatrix } from './view.js';

const AMB = [0.2, 0.225, 0.36];
// figures' shadow side: a violet with no green in it (green dark tones snap to the olive ramp)
const AMB_A = [0.26, 0.2, 0.34];
const FIRE_C = [1.2, 0.6, 0.22];
const HAZE = [70, 64, 92];
const ID_FENCE = 200;
const ID_GRASS = 205;
const ID_ACTOR = 210;
const ID_FX = 230;

/**
 * The flame's palette: flat washes, deep orange-red outside, orange inside, and one small pale
 * core (the brightest value in the picture, and not gold).
 */
const FL = {
  edge: [120, 34, 30], // the ink at the tips
  outer: [196, 70, 36],
  mid: [232, 118, 44],
  inner: [246, 168, 76],
  core: [255, 226, 150],
};

export const billboardMethods = {
  /** Depth-tested pixel write. Returns true if written. */
  bpx(frame, x, y, z, r, g, b, id = ID_FX, write = true, a = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const i = y * this.W + x;
    if (z >= this.zbuf[i] + 0.02) return false;
    const o = i * 4;
    if (a < 1) {
      frame[o] += (r - frame[o]) * a;
      frame[o + 1] += (g - frame[o + 1]) * a;
      frame[o + 2] += (b - frame[o + 2]) * a;
    } else {
      frame[o] = r;
      frame[o + 1] = g;
      frame[o + 2] = b;
    }
    frame[o + 3] = 255;
    if (write) {
      this.zbuf[i] = z;
      this.ids[i] = id;
    }
    return true;
  },

  /** A tapered stroke with depth. */
  strokeZ(frame, x0, y0, x1, y1, w0, w1, col, z0, z1, id = ID_GRASS, a = 1, write = true) {
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const n = Math.ceil(len * 1.4);
    for (let s = 0; s <= n; s++) {
      const f = s / n;
      const w = lerp(w0, w1, f);
      const x = lerp(x0, x1, f);
      const y = lerp(y0, y1, f);
      const z = lerp(z0, z1, f);
      const r = Math.max(0, (w - 1) / 2);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          if (dx * dx + dy * dy > r * r + 0.3) continue;
          this.bpx(
            frame,
            Math.round(x - 0.5) + dx,
            Math.round(y - 0.5) + dy,
            z,
            col[0],
            col[1],
            col[2],
            id,
            write,
            a,
          );
        }
    }
  },

  /** The colour of an albedo lit at a world point (fire and night), for billboards. */
  litColour(A, X, Y, Z, gain = 1) {
    const I = this.intensity(X, Y, Z) * gain;
    return [
      A[0] * (AMB[0] + FIRE_C[0] * I),
      A[1] * (AMB[1] + FIRE_C[1] * I),
      A[2] * (AMB[2] + FIRE_C[2] * I),
    ];
  },

  drawBillboards(frame, cam, B, t, o) {
    const { W, H } = this;
    const items = [];
    const tt = t + 6; // the fire, smoke and embers are already going when the piece starts
    // ---- the palisade
    const P = this.set.palisade;
    if (P) {
      const mid = (P.x0 + P.x1) / 2;
      const half = (P.x1 - P.x0) / 2;
      for (let k = 0; k * 0.3 + P.x0 <= P.x1; k++) {
        const X = P.x0 + k * 0.3 + (hash(k, 1, 61) - 0.5) * 0.06;
        const Z = P.z + P.bow * (1 - ((X - mid) / half) ** 2) * -1 + (hash(k, 2, 61) - 0.5) * 0.08;
        const ph = project(cam, X, 0, Z, W, H);
        if (ph.depth < 1 || ph.sx < -6 || ph.sx > W + 6) continue;
        items.push({ z: ph.depth, kind: 0, X, Z, k });
      }
    }
    // ---- grass
    const tufts = this.tufts;
    for (let k = 0; k < tufts.length; k++) {
      const q = tufts[k];
      const p = project(cam, q.X, 0, q.Z, W, H);
      if (p.depth < 0.35 || p.sx < -30 || p.sx > W + 30 || p.sy < -40 || p.sy > H + 60) continue;
      if (p.depth > 70) continue;
      items.push({ z: p.depth, kind: 1, q });
    }
    for (const q of o.foreground || []) {
      const p = project(cam, q.X, q.Y ?? 0, q.Z, W, H);
      if (p.depth < 0.3) continue;
      items.push({ z: p.depth, kind: 1, q: { ...q, near: true } });
    }
    // ---- props drawn as strokes
    if (this.set.tripod) {
      const p = project(cam, this.set.tripod.x, 0, this.set.tripod.z, W, H);
      if (p.depth > 0.5) items.push({ z: p.depth, kind: 2 });
    }
    if (this.set.banner) {
      const p = project(cam, this.set.banner.x, 0, this.set.banner.z, W, H);
      if (p.depth > 0.5) items.push({ z: p.depth, kind: 3 });
    }
    for (const f of this.set.farFires || []) {
      const p = project(cam, f.x, 0.3, f.z, W, H);
      if (p.depth > 0.5) items.push({ z: p.depth, kind: 4, f });
    }
    // the torchbearer walking behind the tents
    if (o.sentry !== 0) {
      const S = this.sentryAt(t);
      const p = project(cam, S.X, 0, S.Z, W, H);
      if (p.depth > 0.5) items.push({ z: p.depth, kind: 5, S });
    }
    // ---- the fire: flame, smoke, embers
    const fp = project(cam, this.fire.x, 0, this.fire.z, W, H);
    if (fp.depth > 0.4) {
      items.push({ z: fp.depth - 0.05, kind: 6 });
      const smk = o.smoke ?? 1;
      if (smk > 0) {
        const period = 0.2;
        const life = 6.2;
        for (let i = Math.floor((tt - life) / period); i <= Math.floor(tt / period); i++) {
          const age = tt - i * period;
          if (age < 0 || age > life) continue;
          const q = this.puffAt(i, age, smk);
          const p = project(cam, q.X, q.Y, q.Z, W, H);
          if (p.depth > 0.4) items.push({ z: p.depth, kind: 7, q, p });
        }
      }
      const emb = o.embers ?? 1;
      if (emb > 0) {
        const period = 0.13 / emb;
        for (let i = Math.floor((tt - 2.6) / period); i <= Math.floor(tt / period); i++) {
          const age = tt - i * period;
          if (age < 0) continue;
          const q = this.emberAt(i, age);
          if (!q) continue;
          const p = project(cam, q.X, q.Y, q.Z, W, H);
          if (p.depth > 0.3) items.push({ z: p.depth, kind: 8, q, p });
        }
      }
    }
    // ---- the figures
    for (const P of this.preps || []) if (P) items.push({ z: P.feet.depth, kind: 9, P });
    items.sort((p, q) => q.z - p.z);
    for (const it of items) {
      switch (it.kind) {
        case 0:
          this.drawPost(frame, cam, it);
          break;
        case 1:
          this.drawTuft(frame, cam, it.q);
          break;
        case 2:
          this.drawTripod(frame, cam);
          break;
        case 3:
          this.drawBanner(frame, cam);
          break;
        case 4:
          this.drawFarFire(frame, cam, it.f);
          break;
        case 5:
          this.drawSentry(frame, cam, it.S);
          break;
        case 6:
          this.heatShimmer(frame, cam);
          this.drawFlame(frame, cam, o);
          break;
        case 7:
          this.drawPuff(frame, it.q, it.p);
          break;
        case 8:
          this.drawEmber(frame, it.q, it.p);
          break;
        case 9:
          this.drawActor(frame, cam, it.P);
          break;
      }
    }
  },

  // ---------------------------------------------------------------- fence, grass, props

  drawPost(frame, cam, it) {
    const { W, H } = this;
    const { X, Z, k } = it;
    const hgt = 1.95 + 0.4 * hash(k, 3, 61);
    const base = project(cam, X, 0, Z, W, H);
    const top = project(cam, X, hgt, Z, W, H);
    const w = Math.max(1, 0.17 * base.scale);
    const tone = 0.75 + 0.5 * hash(k, 4, 61);
    const torch = this.torchLight(X, hgt * 0.6, Z);
    const A = [96 * tone, 76 * tone, 60 * tone];
    const c = this.litColour(A, X, 1, Z);
    const hz = smooth(12, 60, base.depth) * 0.55;
    const col = [
      c[0] + (HAZE[0] - c[0]) * hz + torch * 62,
      c[1] + (HAZE[1] - c[1]) * hz + torch * 26,
      c[2] + (HAZE[2] - c[2]) * hz + torch * 6,
    ];
    const x0 = Math.round(base.sx - w / 2);
    const x1 = Math.max(x0 + 1, Math.round(base.sx + w / 2));
    const y1 = Math.round(base.sy);
    const y0 = Math.round(top.sy);
    for (let y = y0; y <= y1; y++) {
      // the point of the stake
      const tip = y - y0 < 2 ? 1 - (2 - (y - y0)) * 0.5 : 1;
      for (let x = x0; x < x1; x++) {
        if (tip < 1 && Math.abs(x - base.sx) > w * tip * 0.5 + 0.2) continue;
        const dark = x === x0 && w > 2 ? 0.72 : 1;
        this.bpx(frame, x, y, base.depth, col[0] * dark, col[1] * dark, col[2] * dark, ID_FENCE);
      }
    }
    // the rail across
    const ry = Math.round(lerp(base.sy, top.sy, 0.55));
    for (let x = x0 - 1; x <= x1; x++)
      this.bpx(frame, x, ry, base.depth - 0.01, col[0] * 0.6, col[1] * 0.6, col[2] * 0.7, ID_FENCE);
  },

  /** Wind at a ground point: a gust wave crossing the field, on twos. */
  gust(X, Z) {
    const t = this.t2;
    const g = 0.5 + 0.5 * Math.sin(t * 1.5 + X * 0.32 + Z * 0.21);
    const h = 0.55 + 0.45 * Math.sin(t * 0.55 + Z * 0.27 - X * 0.1 + 1.3);
    return this.wind * (0.12 + 0.5 * g * h);
  },

  drawTuft(frame, cam, q) {
    const { W, H } = this;
    const g = this.gust(q.X, q.Z);
    const near = !!q.near;
    for (let j = 0; j < q.n; j++) {
      const s = q.seed * 13 + j;
      const bx = q.X + (hash(s, 1, 7) - 0.5) * 0.28;
      const bz = q.Z + (hash(s, 2, 7) - 0.5) * 0.28;
      const hb = q.h * (0.6 + 0.6 * hash(s, 3, 7));
      // blades lean away from where they root, and all lean with the wind
      const fan = (hash(s, 4, 7) - 0.5) * 0.5;
      const lean = g * hb * (0.7 + 0.5 * hash(s, 5, 7)) + fan * hb * 0.5;
      const tx = bx + lean;
      const tz = bz + (hash(s, 6, 7) - 0.5) * 0.12;
      const mx = bx + lean * 0.3 + fan * hb * 0.15;
      const p0 = project(cam, bx, 0, bz, W, H);
      const p1 = project(cam, mx, hb * 0.58, bz, W, H);
      const p2 = project(cam, tx, hb * (1 - 0.12 * g), tz, W, H);
      if (p0.depth < 0.25 || p2.depth < 0.25) continue;
      const wpx = Math.max(1, 0.028 * p0.scale);
      const dry = hash(s, 8, 7);
      const A = dry > 0.6 ? [150, 132, 88] : [98, 96, 66];
      // tips catch the fire; the roots stay in the dark
      const cb = this.litColour(A, bx, 0.05, bz, 0.8);
      const ct = this.litColour(A, tx, hb, tz, 1.5);
      const hz = smooth(15, 70, p0.depth) * 0.6;
      const mix = (c) => [
        c[0] + (HAZE[0] - c[0]) * hz,
        c[1] + (HAZE[1] - c[1]) * hz,
        c[2] + (HAZE[2] - c[2]) * hz,
      ];
      const dark = near ? 0.55 : 1;
      const c0 = mix(cb).map((v) => v * dark * 0.75);
      const c1 = mix(ct).map((v) => v * dark);
      // two segments: root to the bend (dark), bend to the tip (lit)
      this.strokeZ(
        frame,
        p0.sx,
        p0.sy,
        p1.sx,
        p1.sy,
        wpx,
        wpx * 0.8,
        c0,
        p0.depth,
        p1.depth,
        ID_GRASS,
      );
      this.strokeZ(
        frame,
        p1.sx,
        p1.sy,
        p2.sx,
        p2.sy,
        wpx * 0.8,
        0.6,
        c1,
        p1.depth,
        p2.depth,
        ID_GRASS,
      );
    }
  },

  drawTripod(frame, cam) {
    const { W, H } = this;
    const T = this.set.tripod;
    const top = project(cam, T.x, 2.5, T.z, W, H);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.6;
      const bx = T.x + Math.cos(a) * 0.55;
      const bz = T.z + Math.sin(a) * 0.55;
      const b = project(cam, bx, 0, bz, W, H);
      if (b.depth < 0.4) continue;
      const c = this.litColour([110, 86, 62], bx, 1, bz, 1);
      this.strokeZ(
        frame,
        b.sx,
        b.sy,
        top.sx + (k - 1) * 0.6,
        top.sy,
        Math.max(1, 0.05 * b.scale),
        1,
        c,
        b.depth,
        top.depth,
        ID_GRASS,
      );
      // the spearhead: a little pale steel above the crossing
      if (k === 1) {
        const hd = project(cam, T.x, 2.75, T.z, W, H);
        this.strokeZ(
          frame,
          top.sx,
          top.sy,
          hd.sx,
          hd.sy,
          2,
          0.6,
          [150, 150, 160],
          top.depth,
          top.depth,
          ID_GRASS,
        );
      }
    }
  },

  drawBanner(frame, cam) {
    const { W, H } = this;
    const Bn = this.set.banner;
    const b = project(cam, Bn.x, 0, Bn.z, W, H);
    const t = project(cam, Bn.x, Bn.h, Bn.z, W, H);
    if (b.depth < 0.5) return;
    const pole = this.litColour([118, 90, 64], Bn.x, 1, Bn.z, 1);
    this.strokeZ(
      frame,
      b.sx,
      b.sy,
      t.sx,
      t.sy,
      Math.max(1, 0.07 * b.scale),
      1,
      pole,
      b.depth,
      b.depth,
      ID_GRASS,
    );
    // the banner: a torn strip of teal cloth streaming toward the wind's side, waving on twos
    const cols = 12;
    const bw = 1.05;
    const bh = 1.5;
    for (let u = 0; u < cols; u++) {
      const f = u / (cols - 1);
      const wave =
        Math.sin(this.t2 * 4.2 - f * 4.5) * 0.14 * f * (0.5 + this.wind) + this.wind * 0.16 * f;
      const drop = Math.sin(this.t2 * 3.1 - f * 3) * 0.05 * f;
      const hh = bh * (1 - 0.2 * f) * (0.86 + 0.14 * hash(u, Math.floor(this.t2 * 12), 3) * 0);
      const X = Bn.x + f * bw;
      const top = project(cam, X, Bn.h - 0.1 + drop, Bn.z + wave, W, H);
      const bot = project(
        cam,
        X,
        Bn.h - 0.1 - hh + drop * 2 + hash(u, 4, 3) * 0.12 * f,
        Bn.z + wave,
        W,
        H,
      );
      const cc = this.litColour([52, 110, 100], X, Bn.h - 0.6, Bn.z, 1.2);
      const shade = 0.75 + 0.3 * Math.sin(f * 9 + this.t2 * 3);
      this.strokeZ(
        frame,
        top.sx,
        top.sy,
        bot.sx,
        bot.sy,
        Math.max(1.3, 0.11 * top.scale),
        Math.max(1, 0.1 * top.scale),
        [cc[0] * shade, cc[1] * shade, cc[2] * shade],
        top.depth,
        top.depth,
        ID_GRASS,
      );
    }
  },

  drawFarFire(frame, cam, f) {
    const { W, H } = this;
    const p = project(cam, f.x, 0.25, f.z, W, H);
    if (p.sx < -10 || p.sx > W + 10) return;
    const fl = 0.75 + 0.25 * Math.sin(this.t2 * 8.5 + f.x);
    const r = Math.max(2, 2.6 * p.scale * 0.1 + 2);
    // a small glow, dithered, then the flame
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx / 1.4, dy);
        if (d > 6) continue;
        const a = (1 - d / 6) ** 2 * 0.55 * fl;
        if (a < bayer(Math.round(p.sx) + dx, Math.round(p.sy) + dy)) continue;
        this.bpx(
          frame,
          Math.round(p.sx) + dx,
          Math.round(p.sy) + dy,
          p.depth,
          190,
          96,
          40,
          ID_FX,
          false,
          0.55,
        );
      }
    const h = Math.max(2, Math.round(r));
    for (let y = 0; y < h; y++) {
      const w = y < h * 0.4 ? 1 : 0;
      for (let x = -w; x <= w; x++)
        this.bpx(
          frame,
          Math.round(p.sx) + x,
          Math.round(p.sy) - y,
          p.depth,
          y > h * 0.55 ? 250 : 232,
          y > h * 0.55 ? 196 : 122,
          y > h * 0.55 ? 110 : 44,
          ID_FX,
          false,
        );
    }
  },

  /** The torchbearer: where he is at time t. He walks behind the tents, in front of the palisade. */
  sentryAt(t) {
    const X = -7.5 + 1.15 * (t + 3.5);
    return { X, Z: 12.6, phase: ((t + 3.5) * 1.15) / 0.62, torchY: 1.55 };
  },

  torchLight(X, Y, Z) {
    if (!this.torchOn) return 0;
    const S = this.sentryAt(this.t);
    const d2 = (X - S.X) ** 2 + (Y - 1.4) ** 2 + (Z - S.Z) ** 2;
    return (1.2 / (1 + d2 / 1.3)) * (0.85 + 0.3 * Math.sin(this.t2 * 11));
  },

  drawSentry(frame, cam, S) {
    const { W, H } = this;
    const base = project(cam, S.X, 0, S.Z, W, H);
    const head = project(cam, S.X, 1.8, S.Z, W, H);
    const sc = base.scale;
    if (sc < 3) return;
    const ph = Math.floor(S.phase * 2) / 2; // walks on twos
    const swing = Math.sin(ph * Math.PI) * 0.3;
    const col = [20, 17, 28];
    const z = base.depth;
    // legs
    this.strokeZ(
      frame,
      base.sx,
      base.sy - 0.85 * sc,
      base.sx + swing * sc * 0.5,
      base.sy,
      Math.max(1, 0.13 * sc),
      Math.max(1, 0.11 * sc),
      col,
      z,
      z,
      ID_ACTOR,
    );
    this.strokeZ(
      frame,
      base.sx,
      base.sy - 0.85 * sc,
      base.sx - swing * sc * 0.5,
      base.sy,
      Math.max(1, 0.13 * sc),
      Math.max(1, 0.11 * sc),
      col,
      z,
      z,
      ID_ACTOR,
    );
    // body and head
    this.strokeZ(
      frame,
      base.sx,
      base.sy - 0.85 * sc,
      base.sx,
      head.sy + 0.25 * sc,
      Math.max(2, 0.4 * sc),
      Math.max(2, 0.34 * sc),
      col,
      z,
      z,
      ID_ACTOR,
    );
    this.strokeZ(
      frame,
      base.sx,
      head.sy + 0.22 * sc,
      base.sx,
      head.sy,
      Math.max(1.5, 0.2 * sc),
      Math.max(1.5, 0.2 * sc),
      col,
      z,
      z,
      ID_ACTOR,
    );
    // the torch held out ahead, and its flame
    const tx = base.sx + 0.55 * sc;
    const ty = base.sy - 1.5 * sc;
    this.strokeZ(
      frame,
      base.sx + 0.1 * sc,
      base.sy - 1.15 * sc,
      tx,
      ty,
      1,
      1,
      [70, 52, 40],
      z,
      z,
      ID_ACTOR,
    );
    const fl = 0.7 + 0.3 * Math.sin(this.t2 * 13);
    for (let y = 0; y < 4; y++)
      for (let x = -1; x <= 1; x++) {
        if (Math.abs(x) > 1 - y * 0.3) continue;
        this.bpx(
          frame,
          tx + x,
          ty - y,
          z - 0.01,
          y > 1 ? 250 : 236,
          y > 1 ? 200 : 130,
          y > 1 ? 110 : 46,
          ID_FX,
          false,
        );
      }
    for (let dy = -7; dy <= 6; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx / 1.2, dy);
        if (d > 7) continue;
        const a = (1 - d / 7) ** 2 * 0.5 * fl;
        if (a < bayer(Math.round(tx) + dx, Math.round(ty) + dy)) continue;
        this.bpx(
          frame,
          Math.round(tx) + dx,
          Math.round(ty) + dy,
          z - 0.02,
          180,
          90,
          40,
          ID_FX,
          false,
          0.5,
        );
      }
  },

  // ---------------------------------------------------------------- the fire

  /**
   * The fire: a small real campfire. Tongues of flame drawn the anime way, on twos, from a loop of
   * eight drawings played out of order: flat shapes, a darker outer tongue with a paler one inside
   * and a small hot core, a thin ink line on the outer edge at the tips only, a lick or two
   * torn off the top. The logs stand in it (drawLogs); the stones round it; a little heat above.
   */
  drawFlame(frame, cam, o) {
    const { W, H } = this;
    const F = this.fire;
    const base = project(cam, F.x, 0.06, F.z, W, H);
    const sc = base.scale;
    // a card that faces the camera
    let rx = cam.x - F.x;
    let rz = cam.z - F.z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const RX = -rz;
    const RZ = rx;
    const d = Math.floor(this.t * 12);
    // eight drawings, never the same twice running (a step of five through the eight)
    const cel = (d * 5 + Math.floor(d / 8) * 3) & 7;
    const size = (o.flame ?? 1) * (0.9 + 0.2 * this.k);
    const lean = this.wind * 0.05;
    const px = (x, y) => project(cam, F.x + RX * x, 0.06 + y, F.z + RZ * x, W, H);
    // tongues: [x centre, base width, height, lean, phase] from the cel
    const tongues = [];
    const NT = 5;
    for (let k = 0; k < NT; k++) {
      const mid = 1 - Math.abs(k - 2) * 0.28;
      const hs = hash(k, cel, 44);
      tongues.push({
        x: (k - 2) * 0.08 * size + (hash(k, cel, 43) - 0.5) * 0.03,
        w: (0.2 + 0.06 * hash(k, cel, 41)) * mid * size,
        h: (0.3 + 0.24 * hs) * (0.6 + 0.6 * mid) * size * (k === 2 ? 1.12 : 1),
        lean: (hash(k, cel, 47) - 0.5) * 0.16 * size + lean + (k - 2) * 0.03,
        ph: hash(k, cel, 42) * 6,
      });
    }
    // a lick torn off above the tallest, on some drawings
    const lick =
      hash(cel, 5, 46) > 0.4
        ? { x: tongues[2].x + (hash(cel, 6, 46) - 0.5) * 0.06, y: tongues[2].h + 0.05 }
        : null;
    const z0 = base.depth;
    const layers = [
      { s: 1.0, hs: 1.0, c: FL.outer },
      { s: 0.66, hs: 0.8, c: FL.mid },
      { s: 0.38, hs: 0.58, c: FL.inner },
    ];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      for (const T of tongues) {
        const hL = T.h * L.hs;
        const wL = T.w * L.s;
        const rows = Math.max(2, Math.ceil(hL * sc * 1.6));
        for (let r = 0; r <= rows; r++) {
          const u = r / rows;
          const y = u * hL;
          const half =
            (wL / 2) * Math.max(0, 1 - u ** 1.5) ** 0.7 * (1 + 0.12 * Math.sin(u * 7 + T.ph));
          if (half <= 0.001) continue;
          const cx = T.x + T.lean * u ** 1.5 * T.h + 0.012 * Math.sin(u * 6 + T.ph);
          const pl = px(cx - half, y);
          const pr = px(cx + half, y);
          const xa = Math.round(pl.sx);
          const xb = Math.round(pr.sx);
          const yy = Math.round(pl.sy);
          for (let x = xa; x <= xb; x++) {
            // the ink line on the outer tongue, at the tips only: its edge pixels, its top rows
            const tip = li === 0 && u > 0.55 && (x === xa || x === xb || u > 0.94);
            const c = tip ? FL.edge : L.c;
            this.bpx(frame, x, yy, z0 + 0.02, c[0], c[1], c[2], ID_FX, true);
          }
        }
      }
    }
    // the hot core: small, low, in the middle
    {
      const T = tongues[2];
      const hL = T.h * 0.32;
      const rows = Math.max(2, Math.ceil(hL * sc * 1.6));
      for (let r = 0; r <= rows; r++) {
        const u = r / rows;
        const half = T.w * 0.2 * Math.max(0, 1 - u ** 1.4) ** 0.7;
        const cx = T.x + T.lean * 0.3 * u;
        const pl = px(cx - half, u * hL + 0.01);
        const pr = px(cx + half, u * hL + 0.01);
        for (let x = Math.round(pl.sx); x <= Math.round(pr.sx); x++)
          this.bpx(
            frame,
            x,
            Math.round(pl.sy),
            z0 + 0.01,
            FL.core[0],
            FL.core[1],
            FL.core[2],
            ID_FX,
            true,
          );
      }
    }
    if (lick) {
      const p = px(lick.x, lick.y);
      const r = Math.max(1, Math.round(0.03 * sc));
      for (let dy = 0; dy < r * 2; dy++)
        for (let dx = -Math.max(0, r - (dy >> 1)); dx <= Math.max(0, r - (dy >> 1)); dx++)
          this.bpx(
            frame,
            p.sx + dx,
            p.sy - dy,
            z0 + 0.02,
            FL.mid[0],
            FL.mid[1],
            FL.mid[2],
            ID_FX,
            true,
          );
    }
    // the warmth in the air: two small dithered bands round the flames, not a haze over the camp
    const gx = base.sx;
    const gy = base.sy - 0.22 * sc;
    for (const [rad, aa] of [
      [0.46, 0.2],
      [0.78, 0.09],
    ]) {
      const R = Math.min(60, rad * sc);
      for (let dy = -R; dy <= R * 0.5; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const dd = Math.hypot(dx, dy * 1.2) / R;
          if (dd > 1) continue;
          const a = aa * this.k * (1 - dd * 0.4);
          const x = Math.round(gx) + dx;
          const y = Math.round(gy) + dy;
          if (a < bayer(x, y)) continue;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          if (this.ids[i] === ID_FX) continue;
          const oo = i * 4;
          frame[oo] += (214 - frame[oo]) * 0.3;
          frame[oo + 1] += (100 - frame[oo + 1]) * 0.26;
          frame[oo + 2] += (48 - frame[oo + 2]) * 0.18;
        }
    }
  },

  /**
   * Heat shimmer: the air over the flames wobbles what is behind it, a pixel or two, sideways,
   * row by row, on twos (a drawn effect, not a blur). Only the background: figures and the fire's
   * own drawing are left alone. Called before the flames are drawn, over everything farther.
   */
  heatShimmer(frame, cam) {
    const { W, H } = this;
    const F = this.fire;
    const base = project(cam, F.x, 0.3, F.z, W, H);
    const sc = base.scale;
    const halfW = Math.round(0.2 * sc);
    const hgt = Math.round(0.85 * sc);
    if (halfW < 3 || hgt < 6) return;
    const phase = Math.floor(this.t * 12);
    const y1 = Math.round(base.sy) - Math.round(0.3 * sc);
    const y0 = y1 - hgt;
    const cx = Math.round(base.sx);
    const row = new Float32Array((halfW * 2 + 1) * 3);
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      const v = (y1 - y) / hgt; // 0 at the flames, 1 at the top of the column
      // the air rises: a slow ripple climbing the column, strongest just above the flames
      const env = Math.sin(Math.PI * Math.min(1, v * 1.1)) ** 1.2 * (1 - 0.55 * v);
      const wave = Math.sin(y * 0.42 - phase * 1.3 + 1.7 * Math.sin(y * 0.11 + phase * 0.35));
      const sw = wave * env;
      // one pixel, on the crests of the ripple only: a wobble of what is behind, no colour of its own
      const sh = sw > 0.48 ? 1 : sw < -0.48 ? -1 : 0;
      if (!sh) continue;
      const xs = Math.max(0, cx - halfW);
      const xe = Math.min(W - 1, cx + halfW);
      for (let x = xs; x <= xe; x++) {
        const k = (x - xs) * 3;
        const o = (y * W + x) * 4;
        row[k] = frame[o];
        row[k + 1] = frame[o + 1];
        row[k + 2] = frame[o + 2];
      }
      for (let x = xs; x <= xe; x++) {
        // the column is soft at its sides: fewer pixels move toward the edge
        const edge = Math.abs(x - cx) / halfW;
        if (edge > 0.55 && hash(x, y, 63) < (edge - 0.55) * 2.2) continue;
        const sx = Math.max(xs, Math.min(xe, x - sh));
        const id = this.ids[y * W + sx];
        if (id >= ID_ACTOR || this.ids[y * W + x] >= ID_ACTOR) continue;
        const o = (y * W + x) * 4;
        const k = (sx - xs) * 3;
        // half of the neighbour's colour: refraction bends the view, it does not replace it
        frame[o] = frame[o] * 0.5 + row[k] * 0.5;
        frame[o + 1] = frame[o + 1] * 0.5 + row[k + 1] * 0.5;
        frame[o + 2] = frame[o + 2] * 0.5 + row[k + 2] * 0.5;
      }
    }
  },

  /** Smoke puff i at age (s): a pale, lumpy column rising and leaning with the wind. */
  puffAt(i, age, k) {
    const F = this.fire;
    const rise = 0.5 + 0.35 * hash(i, 1, 51);
    const drift = (0.25 + 0.45 * hash(i, 2, 51)) * this.wind * (0.4 + 0.2 * age);
    const swirl = Math.sin(age * 1.3 + hash(i, 3, 51) * 6) * 0.12 * age;
    return {
      X: F.x + drift * age * 0.5 + swirl,
      Y: 1.15 + rise * age,
      Z: F.z + Math.cos(age * 0.9 + hash(i, 4, 51) * 6) * 0.1 * age,
      r: 0.14 + 0.2 * age,
      a: (1 - age / 6.2) ** 1.4 * 0.55 * Math.min(1, age * 3) * k,
      age,
      i,
    };
  },

  drawPuff(frame, q, p) {
    const { W, H } = this;
    const R = q.r * p.scale;
    if (R < 0.8) return;
    const nearK = smooth(1.5, 4.5, p.depth);
    const x0 = Math.floor(p.sx - R * 1.3);
    const x1 = Math.ceil(p.sx + R * 1.3);
    const y0 = Math.floor(p.sy - R * 1.3);
    const y1 = Math.ceil(p.sy + R * 1.3);
    // warm from below near the flames, cool grey-violet up in the dark
    const warm = clamp(1 - q.age / 0.8) * this.k;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x - p.sx) / R;
        const dy = (y - p.sy) / R;
        const ang = Math.atan2(dy, dx);
        // a lumpy edge: the disc's radius wanders with the angle
        const lump = 1 + 0.22 * Math.sin(ang * 3 + q.i * 1.7) + 0.12 * Math.sin(ang * 5 + q.i);
        const d = Math.hypot(dx, dy) / lump;
        if (d > 1) continue;
        // opacity: solid in the middle, dithered only toward the rim
        const a = q.a * nearK * (1 - d * d * 0.5);
        if (d > 0.62 && a < bayer(x, y)) continue;
        const i = y * W + x;
        if (p.depth >= this.zbuf[i]) continue;
        const o = i * 4;
        // three flat tones, lit from below-left (the fire): the shading of drawn smoke
        const lit = clamp(0.5 - dy * 0.55 - dx * 0.15 + (warm > 0 ? 0.2 : 0));
        const tone = lit < 0.36 ? 0 : lit < 0.68 ? 1 : 2;
        let c = tone === 0 ? [50, 45, 68] : tone === 1 ? [74, 66, 92] : [104, 92, 116];
        if (warm > 0.25 && tone === 2) c = [150, 100, 84];
        else if (warm > 0.25 && tone === 1) c = [100, 72, 86];
        const w = d > 0.62 ? 0.8 : Math.min(0.75, q.a * nearK * 1.5);
        frame[o] += (c[0] - frame[o]) * w;
        frame[o + 1] += (c[1] - frame[o + 1]) * w;
        frame[o + 2] += (c[2] - frame[o + 2]) * w;
      }
  },

  /**
   * A spark i at age (s), or null: it leaves the flames quickly and slows as it climbs, sways
   * on the draught and goes out (most within two seconds and a metre and a half; a rare one goes
   * higher).
   */
  emberAt(i, age) {
    const life = 0.8 + 1.7 * hash(i, 1, 53);
    if (age > life) return null;
    const F = this.fire;
    const fast = hash(i, 8, 53) > 0.92 ? 1.7 : 1;
    const vy = (0.55 + 0.9 * hash(i, 2, 53)) * fast;
    const rise = (vy * (1 - Math.exp(-age * 1.3))) / 1.3;
    const sw =
      Math.sin(age * (2.4 + 2 * hash(i, 3, 53)) + hash(i, 4, 53) * 6) * (0.03 + 0.09 * age);
    return {
      X: F.x + (hash(i, 5, 53) - 0.5) * 0.26 + sw + this.wind * 0.16 * age * age * 0.35,
      Y: 0.34 + rise,
      Z: F.z + (hash(i, 6, 53) - 0.5) * 0.2 + Math.cos(age * 2.3 + hash(i, 7, 53) * 6) * 0.05 * age,
      u: age / life,
      i,
    };
  },

  drawEmber(frame, q, p) {
    if (p.sx < 0 || p.sy < 0 || p.sx >= this.W || p.sy >= this.H) return;
    // dying sparks flicker off on twos
    if (q.u > 0.6 && hash(q.i, Math.floor(this.t * 12), 55) < (q.u - 0.6) * 1.9) return;
    const c = q.u < 0.22 ? [255, 222, 146] : q.u < 0.6 ? [238, 128, 50] : [168, 56, 34];
    this.bpx(frame, p.sx, p.sy, p.depth, c[0], c[1], c[2], ID_FX, false);
    // a young spark leaves a short streak behind it (below: it is rising)
    if (q.u < 0.4 && p.scale > 50)
      this.bpx(frame, p.sx, p.sy + 1, p.depth, c[0], c[1] * 0.8, c[2] * 0.6, ID_FX, false, 0.6);
    if (p.scale > 110 && q.u < 0.35)
      this.bpx(frame, p.sx + 1, p.sy, p.depth, c[0], c[1] * 0.8, c[2] * 0.6, ID_FX, false, 0.5);
  },

  // ---------------------------------------------------------------- figures

  /**
   * A figure standing (or sitting) in the world, lit by the fire. a: { X, Z, Y?, height,
   * layerFor(px), place(x, y, s), xf?, opts?, shadowW?, gain?, seat? }: same contract as world.js's
   * actors (`Y` is the height of what it stands on; `seat` names the world's seat that carries it,
   * which it is drawn over rather than behind). The drawing is painted in daylight; here it takes
   * the night's cool on the side away from the fire, the fire's warmth on the side toward it, an
   * orange rim on the edge facing the flames, a contact shadow under everything that touches, and
   * the world throws its cast shadow from the drawing itself (camp_ground.js).
   *
   * prepActor draws the sprite into a private buffer (before the world is shaded, so the shadow
   * can be cast from it); drawActor lights it and composites it.
   */
  prepActor(a, cam) {
    const { W, H } = this;
    const Y0 = a.Y ?? 0;
    const feet = project(cam, a.X, Y0, a.Z, W, H);
    const head = project(cam, a.X, Y0 + a.height, a.Z, W, H);
    if (feet.depth < 0.3) return null;
    const vx = head.sx - feet.sx;
    const vy = head.sy - feet.sy;
    const pxH = Math.hypot(vx, vy);
    if (pxH < 2) return null;
    const layer = a.layerFor(pxH);
    const st = layer.st;
    const s = (feet.scale * a.height) / st.h;
    const sy = pxH / (feet.scale * a.height);
    const rot = Math.atan2(vx, -vy);
    const base = a.place(feet.sx, feet.sy, s);
    const xf = { ...base, ...(a.xf || {}) };
    xf.x = base.x;
    xf.y = base.y;
    xf.scale = base.scale ?? s;
    xf.rot = (xf.rot || 0) + rot;
    xf.sy = (xf.sy ?? 1) * sy;
    const cam2 = { x: W / 2, y: H / 2, zoom: 1, rot: 0 };
    const m = layerMatrix(xf, cam2, W, H);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [u, v] of [
      [0, 0],
      [st.w, 0],
      [0, st.h],
      [st.w, st.h],
    ]) {
      const X = m[0] * u + m[1] * v + m[2];
      const Y = m[3] * u + m[4] * v + m[5];
      x0 = Math.min(x0, X);
      y0 = Math.min(y0, Y);
      x1 = Math.max(x1, X);
      y1 = Math.max(y1, Y);
    }
    const pad = a.opts?.warp ? 9 : 3;
    const X0 = Math.max(0, Math.floor(x0 - pad));
    const Y0s = Math.max(0, Math.floor(y0 - pad));
    const X1 = Math.min(W, Math.ceil(x1 + pad));
    const Y1 = Math.min(H, Math.ceil(y1 + pad));
    if (X0 >= X1 || Y0s >= Y1) return null;
    const sc = this.scratch;
    for (let y = Y0s; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const o = (y * W + x) * 4;
        sc[o] = 1;
        sc[o + 1] = 0;
        sc[o + 2] = 1;
        sc[o + 3] = 0;
      }
    drawSprite(sc, W, H, this.paper, layer, a.stage ?? 0, xf, cam2, a.opts || {});
    // keep the drawing: RGB, and alpha 0 where nothing was drawn
    const bw = X1 - X0;
    const bh = Y1 - Y0s;
    const buf = new Uint8ClampedArray(bw * bh * 4);
    for (let y = Y0s; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const o = (y * W + x) * 4;
        if (sc[o + 3] === 0 || (sc[o] === 1 && sc[o + 1] === 0 && sc[o + 2] === 1)) continue;
        const q = ((y - Y0s) * bw + (x - X0)) * 4;
        buf[q] = sc[o];
        buf[q + 1] = sc[o + 1];
        buf[q + 2] = sc[o + 2];
        buf[q + 3] = sc[o + 3];
      }
    const bladeMask = a.blade ? this.repaintBlade(a, m, st, X0, Y0s, X1, Y1, bw, buf) : null;
    return {
      a,
      feet,
      head,
      pxH,
      X0,
      Y0s,
      X1,
      Y1,
      bw,
      bh,
      buf,
      bladeMask,
      x0,
      y0,
      x1,
      y1,
      mask: {
        alpha: st.alpha,
        w: st.w,
        h: st.h,
        ax: base.ax,
        ay: base.ay,
        mpp: a.height / st.h,
      },
    };
  },

  /**
   * A painted sword turns to a saw of pixels at game size (a 2-3 px diagonal, lit orange and inked
   * along both edges). Given the blade's line in the drawing (a.blade() -> [x0, y0, x1, y1, w] in
   * cell px, from motion/camp_blade.py) this takes the painted blade out of the buffer (bright
   * pixels near the line, past the guard) and draws a clean one: two pixels wide, a highlight line on
   * its upper edge, a shadow edge below, a tapered tip. Its colours are final (steel, warm on the
   * side toward the fire), so drawActor skips the lighting for them. Returns a Uint8Array mask of
   * the blade's pixels in the buffer, or null.
   */
  repaintBlade(a, m, st, X0, Y0s, X1, Y1, bw, buf) {
    const bl = a.blade();
    if (!bl) return null;
    const k = st.h / a.cell[1];
    const pt = (u, v) => {
      const lu = a.flip ? st.w - u * k : u * k;
      const lv = v * k;
      return [m[0] * lu + m[1] * lv + m[2], m[3] * lu + m[4] * lv + m[5]];
    };
    const [ax, ay] = pt(bl[0], bl[1]);
    const [bx, by] = pt(bl[2], bl[3]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 5) return null;
    const ux = dx / len;
    const uy = dy / len;
    const sc = k * Math.hypot(m[0], m[3]);
    const hwPainted = Math.max(1.6, (bl[4] * sc) / 2);
    const mask = new Uint8Array(buf.length / 4);
    const HI = [232, 218, 200];
    const MID = [150, 140, 146];
    const LO = [92, 84, 100];
    // steel takes the fire's light like everything else: brighter and warmer toward the flames
    const F0 = project(this.cam, this.fire.x, this.fire.y, this.fire.z, this.W, this.H);
    const feetScale = project(this.cam, a.X, a.Y ?? 0, a.Z, this.W, this.H).scale;
    // which side is "up" on screen for the highlight (the normal with a negative y)
    let nx = -uy;
    let ny = ux;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const F = this.fire;
    // a warmer highlight on the side toward the fire
    const fx = F.x - a.X;
    const wx = Math.sign(fx) === Math.sign(nx) || Math.abs(fx) < 0.2 ? 1 : 0.55;
    for (let y = Y0s; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        let t = px * ux + py * uy;
        const o = px * nx + py * ny; // + toward the up side
        const q = ((y - Y0s) * bw + (x - X0)) * 4;
        const dEnd = t < 0 ? -t : t > len ? t - len : 0;
        const d = Math.hypot(o, dEnd);
        // 1. take the painted blade out: bright pixels near the line, from just past the guard
        if (buf[q + 3] !== 0 && t > 3 && t < len + 2 && Math.abs(o) < hwPainted + 1.4) {
          const lum = 0.3 * buf[q] + 0.59 * buf[q + 1] + 0.11 * buf[q + 2];
          if (lum > 118) {
            // fill from a neighbour that is not blade: the body under it, or nothing
            let r = 0;
            let g = 0;
            let b = 0;
            let n = 0;
            for (let yy = -3; yy <= 3; yy++)
              for (let xx = -3; xx <= 3; xx++) {
                const x2 = x + xx;
                const y2 = y + yy;
                if (x2 < X0 || y2 < Y0s || x2 >= X1 || y2 >= Y1) continue;
                const q2 = ((y2 - Y0s) * bw + (x2 - X0)) * 4;
                if (buf[q2 + 3] === 0) continue;
                const l2 = 0.3 * buf[q2] + 0.59 * buf[q2 + 1] + 0.11 * buf[q2 + 2];
                const p2 = x2 + 0.5 - ax;
                const p3 = y2 + 0.5 - ay;
                if (l2 > 118 && Math.abs(p2 * nx + p3 * ny) < hwPainted + 1.4) continue;
                r += buf[q2];
                g += buf[q2 + 1];
                b += buf[q2 + 2];
                n++;
              }
            if (n >= 3) {
              buf[q] = r / n;
              buf[q + 1] = g / n;
              buf[q + 2] = b / n;
            } else buf[q + 3] = 0;
          }
        }
        // 2. the clean blade: 2 px wide (a hair over, so the diagonal has no gaps), tapering to a point
        const taper = t > len - 5 ? 0.35 + 0.65 * Math.max(0, (len - t) / 5) : 1;
        if (t >= 0 && t <= len && Math.abs(o) <= 1.0 * taper + 0.05) {
          const c = o > 0.25 ? HI : o < -0.45 ? LO : MID;
          const dm = Math.hypot(x - F0.sx, y - F0.sy) / feetScale;
          const bk = 0.5 + 0.8 * clamp(1.3 / (1 + (dm * dm) / 1.6));
          const warm = 0.06 * (bk - 0.8);
          buf[q] = Math.min(255, c[0] * bk * (1 + warm) * (c === HI ? 0.88 + 0.12 * wx : 1));
          buf[q + 1] = Math.min(255, c[1] * bk);
          buf[q + 2] = Math.min(255, c[2] * bk * (1 - warm) * (c === HI ? 0.85 + 0.15 * wx : 1));
          buf[q + 3] = 255;
          mask[q >> 2] = 1;
        }
        void d;
      }
    return mask;
  },

  drawActor(frame, cam, P) {
    if (!P) return;
    const { W, H } = this;
    const { a, feet, pxH, X0, Y0s, X1, Y1, bw, buf, x0, y0, x1, y1 } = P;
    const Y0 = a.Y ?? 0;
    /** offset of the drawing's pixel (x, y) in buf, or -1 */
    const at = (x, y) => {
      if (x < X0 || y < Y0s || x >= X1 || y >= Y1) return -1;
      const o = ((y - Y0s) * bw + (x - X0)) * 4;
      return buf[o + 3] !== 0 ? o : -1;
    };
    const seatIds = (a.seat && this.seats?.[a.seat]?.ids) || [];
    // ---- where the drawing meets the ground: its lowest pixel in each column
    const yb = new Int16Array(X1 - X0).fill(-1);
    for (let x = X0; x < X1; x++)
      for (let y = Y1 - 1; y >= Y0s; y--)
        if (buf[((y - Y0s) * bw + (x - X0)) * 4 + 3] !== 0) {
          yb[x - X0] = y;
          break;
        }
    // a column touches when its lowest pixel is within a third of a metre of the contact line
    const band = 0.34 * feet.scale;
    const touch = (x) => {
      const y = yb[x - X0];
      return y >= 0 && y >= feet.sy - band;
    };
    // ---- light the drawing and composite it
    const F = this.fire;
    const fp = project(cam, F.x, F.y, F.z, W, H);
    const I = this.intensity(a.X, Y0 + a.height * 0.45, a.Z) * (a.gain ?? 1.15);
    const front = clamp((feet.depth - fp.depth) / 1.4, -1, 1);
    const faceK = 0.42 + 0.58 * smooth(-0.7, 0.9, front);
    const cxA = (x0 + x1) / 2;
    const cyA = (y0 + y1) / 2;
    let tfx = fp.sx - cxA;
    let tfy = fp.sy - cyA;
    const tl = Math.hypot(tfx, tfy) || 1;
    tfx /= tl;
    tfy /= tl;
    const half = Math.max(8, (x1 - x0) / 2);
    const zA = feet.depth;
    const rimStr = clamp(I * 1.5) * (a.rim ?? 1);
    const ew = pxH < 150 ? 1 : pxH < 300 ? 2 : 3;
    // the cloth that touches the ground goes dark in the last pixels above it (it is in its own
    // shadow there): a thin band, deeper for a bigger figure
    const eAO = Math.max(1, Math.min(6, Math.round(0.05 * feet.scale)));
    for (let y = Y0s; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const bo = at(x, y);
        if (bo < 0) continue;
        const i = y * W + x;
        if (zA >= this.zbuf[i] + 0.02 && !seatIds.includes(this.ids[i])) continue;
        const o = i * 4;
        if (P.bladeMask && P.bladeMask[bo >> 2]) {
          // the repainted blade: final colours, no light, no ink, no rim
          frame[o] = buf[bo];
          frame[o + 1] = buf[bo + 1];
          frame[o + 2] = buf[bo + 2];
          frame[o + 3] = 255;
          this.zbuf[i] = zA;
          this.ids[i] = ID_ACTOR;
          continue;
        }
        const sxr = ((x - cxA) * tfx + (y - cyA) * tfy) / half;
        const lf = 0.5 + 0.5 * clamp(sxr, -1, 1);
        const low = clamp((y - y0) / Math.max(1, y1 - y0));
        const L = I * (0.28 + 0.85 * lf) * (0.7 + 0.55 * low) * faceK;
        let r = buf[bo] * (AMB_A[0] + FIRE_C[0] * L);
        let g = buf[bo + 1] * (AMB_A[1] + FIRE_C[1] * L);
        let b = buf[bo + 2] * (AMB_A[2] + FIRE_C[2] * L);
        if (a.hueHold) {
          // brown that firelight would push to red (Edric's chestnut hair, his leather) keeps its
          // own hue: only its brightness follows the light
          const r0 = buf[bo];
          const g0 = buf[bo + 1];
          const b0 = buf[bo + 2];
          const m0 = Math.max(r0, g0, b0);
          const sat = (m0 - Math.min(r0, g0, b0)) / (m0 + 1e-6);
          if (r0 >= g0 && g0 >= b0 && sat > 0.25 && sat < 0.8 && m0 < 165) {
            const k =
              (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * r0 + 0.587 * g0 + 0.114 * b0 + 1e-6);
            const w = a.hueHold * smooth(0.25, 0.4, sat) * smooth(165, 130, m0);
            r += (r0 * k - r) * w;
            g += (g0 * k - g) * w;
            b += (b0 * k - b) * w;
          }
        }
        // the drawing's own fringe (a pale line where the cut-out met its green) becomes the
        // ink of the contour: the edge pixels are darkened, deeper for a bigger figure
        let edge = false;
        for (let e = 1; e <= ew && !edge; e++)
          for (const [ox, oy] of [
            [e, 0],
            [-e, 0],
            [0, e],
            [0, -e],
          ]) {
            if (at(x + ox, y + oy) < 0) {
              edge = true;
              break;
            }
          }
        if (edge) {
          // a thin strand (a blade, a hair) is nearly all edge: it keeps its own colour rather
          // than turning into a saw of ink
          let cnt = 0;
          for (let q = -1; q <= 1; q++)
            for (let w = -1; w <= 1; w++) if (at(x + w, y + q) >= 0) cnt++;
          const k = clamp((cnt - 3) / 3);
          r *= 1 - 0.6 * k;
          g *= 1 - 0.62 * k;
          b *= 1 - 0.52 * k;
        }
        // the rim: the edge that faces the flames takes an orange line
        const nx = Math.round(x + tfx * 2);
        const ny = Math.round(y + tfy * 2);
        if (at(nx, ny) < 0) {
          const rk = rimStr * (0.55 + 0.45 * (1 - faceK) + 0.25 * lf);
          r += 255 * 0.5 * rk;
          g += 138 * 0.5 * rk;
          b += 58 * 0.4 * rk;
        }
        // the cloth touching the ground is in its own shadow
        const yc = yb[x - X0];
        if (yc >= 0 && touch(x) && yc - y < eAO) {
          const k = 1 - 0.34 * (1 - (yc - y) / eAO);
          r *= k;
          g *= k;
          b *= k * 1.02;
        }
        frame[o] = Math.min(255, r);
        frame[o + 1] = Math.min(255, g);
        frame[o + 2] = Math.min(255, b);
        frame[o + 3] = buf[bo + 3];
        this.zbuf[i] = zA;
        this.ids[i] = ID_ACTOR;
      }
    // ---- contact shadow: a tight dark line on whatever the drawing rests on (ground or seat),
    // right under its lowest pixels, following the silhouette (boot, hem, crate base) and spread a
    // couple of pixels to each side; strongest at the contact, gone within a few pixels
    const depthPx = clamp(Math.round(0.06 * feet.scale), 2, 12);
    const side = clamp(Math.round(0.025 * feet.scale), 1, 4);
    const amp = a.contactK ?? 0.82;
    const occ = this.aoBuf || (this.aoBuf = new Float32Array(W * H));
    const yTop = Math.max(0, Y0s);
    const yBot = Math.min(H - 1, Y1 + depthPx + 2);
    for (let y = yTop; y <= yBot; y++)
      for (let x = Math.max(0, X0 - side); x < Math.min(W, X1 + side); x++) occ[y * W + x] = 0;
    for (let x = X0; x < X1; x++) {
      if (!touch(x)) continue;
      const yc = yb[x - X0];
      for (let dx = -side; dx <= side; dx++) {
        const cx = x + dx;
        if (cx < 0 || cx >= W) continue;
        const wgt = 1 - Math.abs(dx) / (side + 1);
        for (let d = 1; d <= depthPx; d++) {
          const yy = yc + d;
          if (yy >= H) break;
          const k = amp * wgt * (1 - (d - 1) / depthPx) ** 1.4;
          const q = yy * W + cx;
          if (k > occ[q]) occ[q] = k;
        }
      }
    }
    for (let y = yTop; y <= yBot; y++)
      for (let x = Math.max(0, X0 - side); x < Math.min(W, X1 + side); x++) {
        const q = y * W + x;
        const k = occ[q];
        if (k <= 0.01) continue;
        const id = this.ids[q];
        if (id !== 20 && !seatIds.includes(id)) continue;
        const o = q * 4;
        frame[o] *= 1 - k;
        frame[o + 1] *= 1 - k;
        frame[o + 2] *= 1 - k * 0.94;
      }
    void Y0;
  },

  /** The screen box of an actor (after render), for glints and effects that must sit on it. */
  cardBox(a, cam) {
    const { W, H } = this;
    const Y0 = a.Y ?? 0;
    const feet = project(cam, a.X, Y0, a.Z, W, H);
    const head = project(cam, a.X, Y0 + a.height, a.Z, W, H);
    const pxH = Math.hypot(head.sx - feet.sx, head.sy - feet.sy);
    const layer = a.layerFor(pxH);
    const st = layer.st;
    const s = (feet.scale * a.height) / st.h;
    const base = a.place(feet.sx, feet.sy, s);
    const xf = { ...base, ...(a.xf || {}) };
    xf.x = base.x;
    xf.y = base.y;
    xf.scale = base.scale ?? s;
    xf.rot = (xf.rot || 0) + Math.atan2(head.sx - feet.sx, -(head.sy - feet.sy));
    xf.sy = (xf.sy ?? 1) * (pxH / (feet.scale * a.height));
    const m = layerMatrix(xf, { x: W / 2, y: H / 2, zoom: 1, rot: 0 }, W, H);
    return { m, st };
  },
};
