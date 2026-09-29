// The camp's ground truth (CRAFT.md, Grounding): what carries each person's weight, where
// things touch the earth, and where the fire's light is blocked.
//
//   seats     a flat faceted rock and a folded blanket the people sit on (drawn by the ray-tested
//             pass like every other prop, lit by the fire), and a footprint for Kira's painted crate
//   ao        contact occlusion, precomputed on a ground grid: a tight dark line where a thing
//             meets the ground (stones, barrels, crates, tents, posts, seats)
//   shadows   cast shadows on the ground, stamped every frame from the fire: each prop and each
//             figure (from the figure's own drawing, so a raised arm or a sword throws its shadow)
//             is thrown away from the flames, longer and softer the farther up it is. The
//             fire's flicker lengthens and shortens them a little.
//
// Installed on CampWorld's prototype (engine/camp_world.js).

import { project } from './world.js';
import { clamp, hash, smooth } from './raster.js';

const TWO_PI = Math.PI * 2;

// the ground grids cover the camp; outside them the ground has no occlusion and no shadows
const AO_GRID = { x0: -24, z0: -7, cell: 0.08, nx: 600, nz: 380 };
const SH_GRID = { x0: -9, z0: -7, cell: 0.05, nx: 360, nz: 300 };

/** How far a shadow is thrown per metre of height (a low fire throws long shadows). */
const STRETCH = 1.5;

/** Bilinear sample of a grid { x0, z0, cell, nx, nz, d }. */
function sampleGrid(g, X, Z) {
  const fx = (X - g.x0) / g.cell - 0.5;
  const fz = (Z - g.z0) / g.cell - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= g.nx - 1 || iz >= g.nz - 1) return 0;
  const ax = fx - ix;
  const az = fz - iz;
  const i = iz * g.nx + ix;
  const d = g.d;
  return (
    d[i] * (1 - ax) * (1 - az) +
    d[i + 1] * ax * (1 - az) +
    d[i + g.nx] * (1 - ax) * az +
    d[i + g.nx + 1] * ax * az
  );
}

export const groundMethods = {
  // ---------------------------------------------------------------- seats

  /**
   * The seats named in the set (set.seats). A slab is a stone (faceted, flat crown) added to the
   * ray-tested stones; a blanket is a low box; a ghost draws nothing (Kira's crate is in her
   * drawing) but still has a footprint for the ground's contact shadow. `this.seats[id]` says
   * where the top is (`top`, metres), so a figure can be stood on it (actor Y).
   */
  buildSeats() {
    this.seats = {};
    (this.set.seats || []).forEach((s, k) => {
      if (s.kind === 'slab') {
        const F = [0, 1, 0, s.crown ?? 0.72];
        const n = 7;
        for (let f = 0; f < n; f++) {
          const th = (f / n) * TWO_PI + (hash(k, f, 83) - 0.5) * 0.5 + 0.4;
          const el = 0.1 + 0.2 * hash(k, f + 10, 83);
          F.push(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el));
          F.push(0.8 + 0.1 * hash(k, f + 20, 83));
        }
        const si = this.stones.length;
        this.stones.push({
          x: s.x,
          z: s.z,
          a: s.a,
          b: s.b,
          c: s.c,
          yaw: s.yaw,
          seat: true,
          fac: F,
        });
        this.seats[s.id] = {
          ...s,
          ids: [ID_SEAT_OF_STONE(si)],
          top: s.b * (0.6 + (s.crown ?? 0.72)),
        };
      } else if (s.kind === 'blanket') {
        const b = this.mkBox(s.x, s.z, s.sx, s.sz, s.h, s.yaw, 'blanket');
        b.id = 100 + k;
        // the fold: a second, smaller layer on top (a folded blanket is never flat)
        const f = this.mkBox(
          s.x + s.sx * 0.12,
          s.z - s.sz * 0.1,
          s.sx * 0.78,
          s.sz * 0.7,
          s.h * 1.9,
          s.yaw + 0.1,
          'blanket',
        );
        f.id = 105 + k;
        this.boxes.push(b, f);
        this.seats[s.id] = { ...s, ids: [100 + k, 105 + k], top: s.h * 1.9 };
      } else {
        this.seats[s.id] = { ...s, ids: [], top: 0 };
      }
    });
  },

  // ---------------------------------------------------------------- contact occlusion

  /** Everything static that touches the ground, as footprints for the contact grid. */
  footprints() {
    const list = [];
    const ell = (x, z, a, c, yaw, margin, k) =>
      list.push({ t: 'e', x, z, a, c, cs: Math.cos(yaw), sn: Math.sin(yaw), margin, k });
    const rect = (x, z, a, c, yaw, margin, k) =>
      list.push({ t: 'r', x, z, a, c, cs: Math.cos(yaw), sn: Math.sin(yaw), margin, k });
    for (const s of this.stones)
      ell(s.x, s.z, s.a * 0.92, s.c * 0.92, s.yaw, s.bed ? 0.16 : 0.13, s.bed ? 0.55 : 0.8);
    for (const c of this.cyls) ell(c.x, c.z, c.r, c.r, 0, 0.16, 0.8);
    for (const b of this.boxes)
      rect(
        b.x,
        b.z,
        b.sx,
        b.sz,
        b.yaw,
        b.kind === 'blanket' ? 0.07 : 0.14,
        b.kind === 'blanket' ? 0.55 : 0.8,
      );
    for (const t of this.tents) rect(t.x, t.z, t.a, t.b, t.yaw, 0.3, 0.6);
    for (const s of Object.values(this.seats))
      if (s.kind === 'ghost') rect(s.x, s.z, s.sx, s.sz, s.yaw, 0.2, 0.75);
    const P = this.set.palisade;
    if (P) {
      const mid = (P.x0 + P.x1) / 2;
      const half = (P.x1 - P.x0) / 2;
      for (let k = 0; k * 0.3 + P.x0 <= P.x1; k++) {
        const X = P.x0 + k * 0.3;
        const Z = P.z - P.bow * (1 - ((X - mid) / half) ** 2);
        ell(X, Z, 0.09, 0.09, 0, 0.12, 0.7);
      }
    }
    const T = this.set.tripod;
    if (T)
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TWO_PI + 0.6;
        ell(T.x + Math.cos(a) * 0.55, T.z + Math.sin(a) * 0.55, 0.06, 0.06, 0, 0.1, 0.8);
      }
    if (this.set.banner) ell(this.set.banner.x, this.set.banner.z, 0.07, 0.07, 0, 0.1, 0.8);
    // the fire's own logs where they lie on the ground
    const F = this.fire;
    for (const L of this.logs) {
      const n = 6;
      for (let q = 0; q <= n; q++) {
        const f = q / n;
        const y = L.p0[1] + (L.p1[1] - L.p0[1]) * f;
        if (y > 0.14) continue;
        ell(
          F.x + L.p0[0] + (L.p1[0] - L.p0[0]) * f,
          F.z + L.p0[2] + (L.p1[2] - L.p0[2]) * f,
          L.r,
          L.r,
          0,
          0.09,
          0.8,
        );
      }
    }
    return list;
  },

  buildAO() {
    const g = { ...AO_GRID, d: new Float32Array(AO_GRID.nx * AO_GRID.nz) };
    this.ao = g;
    for (const f of this.footprints()) {
      const ext = Math.max(f.a, f.c) + f.margin + 0.05;
      const i0 = Math.max(0, Math.floor((f.x - ext - g.x0) / g.cell));
      const i1 = Math.min(g.nx - 1, Math.ceil((f.x + ext - g.x0) / g.cell));
      const j0 = Math.max(0, Math.floor((f.z - ext - g.z0) / g.cell));
      const j1 = Math.min(g.nz - 1, Math.ceil((f.z + ext - g.z0) / g.cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const X = g.x0 + (i + 0.5) * g.cell - f.x;
          const Z = g.z0 + (j + 0.5) * g.cell - f.z;
          const u = X * f.cs + Z * f.sn;
          const v = -X * f.sn + Z * f.cs;
          let d;
          if (f.t === 'e') d = (Math.hypot(u / f.a, v / f.c) - 1) * Math.min(f.a, f.c);
          else {
            const qx = Math.abs(u) - f.a;
            const qz = Math.abs(v) - f.c;
            d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
          }
          if (d >= f.margin) continue;
          const a = f.k * (1 - smooth(-0.02, f.margin, d)) ** 1.5;
          const idx = j * g.nx + i;
          if (a > g.d[idx]) g.d[idx] = a;
        }
    }
  },

  /** Contact occlusion on the ground at (X, Z): 0 (none) .. ~0.8 (against a thing). */
  aoAt(X, Z) {
    return sampleGrid(this.ao, X, Z);
  },

  // ---------------------------------------------------------------- shadows

  initShadows() {
    this.shd = { ...SH_GRID, d: new Float32Array(SH_GRID.nx * SH_GRID.nz) };
    this.shdTmp = new Float32Array(SH_GRID.nx * SH_GRID.nz);
  },

  /** A soft disc stamped into the shadow grid, strength k (the strongest wins where they overlap). */
  stampShadow(X, Z, r, k) {
    const g = this.shd;
    const i0 = Math.max(0, Math.floor((X - r - g.x0) / g.cell));
    const i1 = Math.min(g.nx - 1, Math.ceil((X + r - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((Z - r - g.z0) / g.cell));
    const j1 = Math.min(g.nz - 1, Math.ceil((Z + r - g.z0) / g.cell));
    const ir = 1 / r;
    for (let j = j0; j <= j1; j++) {
      const dz = (g.z0 + (j + 0.5) * g.cell - Z) * ir;
      for (let i = i0; i <= i1; i++) {
        const dx = (g.x0 + (i + 0.5) * g.cell - X) * ir;
        const q = dx * dx + dz * dz;
        if (q >= 1) continue;
        const v = k * (1 - q * 0.5);
        const idx = j * g.nx + i;
        if (v > g.d[idx]) g.d[idx] = v;
      }
    }
  },

  /**
   * Rebuild the cast shadows for this frame: the props, then each figure from its own drawing.
   * The fire's flicker (this.k) and wobble (this.fire) move them a little.
   */
  buildShadows(preps) {
    const g = this.shd;
    g.d.fill(0);
    const F = this.fire;
    const flick = 1 + 0.55 * (this.k - 1);
    const dirOf = (x, z) => {
      const dx = x - F.x;
      const dz = z - F.z;
      const r = Math.hypot(dx, dz) || 1;
      return [dx / r, dz / r, r];
    };
    // props: a column of soft discs from the base out along the shadow
    const column = (x, z, r, h, k = 0.62) => {
      const [dx, dz, rf] = dirOf(x, z);
      if (rf < 0.35 || rf > 12) return;
      const n = Math.max(2, Math.ceil(h / (r * 0.7)));
      for (let q = 0; q <= n; q++) {
        const y = (h * q) / n;
        // taller means farther out, fainter, softer
        this.stampShadow(
          x + dx * y * STRETCH * flick,
          z + dz * y * STRETCH * flick,
          r * (0.95 + 0.5 * y),
          k * (1 - 0.35 * (y / Math.max(h, 0.1))),
        );
      }
    };
    for (const s of this.set.stumps || []) column(s.x, s.z, s.r * 0.95, s.h);
    for (const b of this.set.barrels || []) column(b.x, b.z, b.r * 0.95, b.h);
    for (const b of this.set.crates || []) column(b.x, b.z, Math.max(b.sx, b.sz) * 0.9, b.sy * 2);
    for (const b of this.set.benches || []) {
      for (const q of [-0.7, -0.35, 0, 0.35, 0.7])
        column(b.x + Math.cos(b.yaw) * b.sx * q, b.z + Math.sin(b.yaw) * b.sx * q, b.sz * 1.1, b.h);
    }
    // figures: every few pixels of the drawing throw a soft disc along the shadow direction
    for (const P of preps) if (P && P.a.shadow !== false) this.stampActorShadow(P, flick);
    // one soft pass so the edges are not stairs (a shadow's edge is a little wider the farther it goes)
    const n = g.nx;
    const t = this.shdTmp;
    const d = g.d;
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        t[k] = (d[k] * 2 + (i > 0 ? d[k - 1] : 0) + (i < n - 1 ? d[k + 1] : 0)) * 0.25;
      }
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        d[k] = (t[k] * 2 + (j > 0 ? t[k - n] : 0) + (j < g.nz - 1 ? t[k + n] : 0)) * 0.25;
      }
  },

  /**
   * A figure's shadow from its drawing: the drawing (a pose, a raised arm, a sword put out toward
   * the flames) is sampled on a grid, each point at height y above the seat is thrown y * STRETCH
   * along the ground away from the fire, given some depth (a body is not a card), and stamped as
   * a soft disc that grows with height. Fainter and softer toward the end of the shadow.
   */
  stampActorShadow(P, flick) {
    const { mask, a, ground } = P;
    if (!mask) return;
    const F = this.fire;
    const B = this.B;
    const X0 = a.X;
    const Z0 = a.Z;
    let dx = X0 - F.x;
    let dz = Z0 - F.z;
    const rf = Math.hypot(dx, dz) || 1;
    dx /= rf;
    dz /= rf;
    // the card's right (across the view) and forward on the ground
    let rx = B.rx;
    let rz = B.rz;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const fx = -rz;
    const fz = rx;
    const { alpha, w, h, ax, ay, mpp } = mask;
    const depth = a.shadowDepth ?? 0.16;
    const K = a.shadowK ?? 0.72;
    // a stride that keeps the work bounded and the stamps overlapping
    let stride = 1;
    let count = 0;
    for (let v = 0; v < h; v += 4) for (let u = 0; u < w; u += 4) if (alpha[v * w + u]) count++;
    count *= 16;
    while (count / (stride * stride) > 3000) stride++;
    const sp = stride * mpp;
    const Y0 = a.Y ?? 0;
    const height = a.height;
    for (let v = 0; v < h; v += stride)
      for (let u = 0; u < w; u += stride) {
        if (!alpha[v * w + u]) continue;
        const x = (u - ax) * mpp;
        const y = (ay - v) * mpp;
        if (y < -0.05) continue;
        const yy = Math.max(0, y);
        const reach = yy * STRETCH * flick;
        // the seat's height lifts the whole drawing off the ground
        const gx = X0 + x * rx + dx * reach;
        const gz = Z0 + x * rz + dz * reach;
        const r = Math.max(0.045 + 0.06 * yy, sp * 0.8);
        // fainter with height and with how far the shadow has run
        const k = K * (1 - 0.5 * smooth(0, height * 1.05, yy));
        for (const z of [-depth, depth * 0.1, depth])
          this.stampShadow(gx + fx * z, gz + fz * z, r, k);
      }
    void ground;
    void Y0;
  },

  // ---------------------------------------------------------------- marks on the ground

  /**
   * Marks on a horizontal surface, drawn on the world before the figures: a hand pressed on a slab, a
   * scuff where a boot dragged. Each: { x, y (height of the surface), z, r (m), k (darkness of the
   * press 0..1), ash (0..1, how much pale ash is scattered on it), seed }. A pixel is marked when
   * its ray meets that plane inside the mark (a ragged edge) and the plane is what the pixel shows.
   */
  drawDecals(frame, list) {
    const { W, H } = this;
    const B = this.B;
    for (const d of list) {
      if (Math.abs(B.oy - d.y) < 0.02) continue;
      const cen = project(this.cam, d.x, d.y, d.z, W, H);
      if (cen.depth < 0.3) continue;
      const rp = d.r * cen.scale * 1.5;
      const x0 = Math.max(0, Math.floor(cen.sx - rp - 2));
      const x1 = Math.min(W - 1, Math.ceil(cen.sx + rp + 2));
      const y0 = Math.max(0, Math.floor(cen.sy - rp - 2));
      const y1 = Math.min(H - 1, Math.ceil(cen.sy + rp * 0.6 + 2));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          const dy = this.rdy[i];
          if (Math.abs(dy) < 1e-4) continue;
          const tt = (d.y - B.oy) / dy;
          if (tt < 0.05) continue;
          if (Math.abs(tt * this.cf[i] - this.zbuf[i]) > 0.03 + 0.004 * this.zbuf[i]) continue;
          const gx = B.ox + tt * this.rdx[i] - d.x;
          const gz = B.oz + tt * this.rdz[i] - d.z;
          // a ragged edge: the radius wanders with the angle
          const ang = Math.atan2(gz, gx);
          const rr =
            d.r * (0.75 + 0.35 * hash(Math.floor(((ang + Math.PI) / TWO_PI) * 9), d.seed ?? 1, 41));
          const q = Math.hypot(gx, gz) / rr;
          if (q >= 1) continue;
          const o = i * 4;
          const n = hash(x >> 1, y >> 1, (d.seed ?? 1) + 7);
          if ((d.ash ?? 0) > 0 && n < d.ash * (1 - q)) {
            // ash scattered over the press: a few pale flecks, warm where the fire reaches them
            frame[o] += (176 - frame[o]) * 0.7;
            frame[o + 1] += (150 - frame[o + 1]) * 0.7;
            frame[o + 2] += (132 - frame[o + 2]) * 0.6;
          } else {
            const k = 1 - (d.k ?? 0.4) * (1 - q * q) * (0.75 + 0.25 * n);
            frame[o] *= k;
            frame[o + 1] *= k;
            frame[o + 2] *= k * 1.02;
          }
        }
    }
  },

  /** Shadow multiplier on the ground light at (X, Z): the figures and props block the fire. */
  shadowAt(X, Z) {
    const f = this.fire;
    const qx = X - f.x;
    const qz = Z - f.z;
    if (qx * qx + qz * qz > 190) return 1;
    return 1 - clamp(sampleGrid(this.shd, X, Z), 0, 1);
  },
};

// a stone's id in the ray-tested pass (see drawStones)
function ID_SEAT_OF_STONE(si) {
  return 120 + (si & 63);
}
