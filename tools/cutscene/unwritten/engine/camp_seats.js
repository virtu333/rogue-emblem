// The camp's seats as real things (CRAFT.md, Grounding): the rock Edric sits on and the folded
// wool blanket Sera sits on. Both are drawn by the ray-tested pass like every other prop, lit
// by the fire (warm side, cool side), inked on their contours (found, soft, lost) and drawn under
// the people who sit on them (the actor pass draws over a seat's ids).
//
//   rock     a convex block of sandstone: a flat crown he sits on, worn chamfers, a broken corner,
//            steep sides with strata and cracks, sunk into the ground (soil line at the base, grit,
//            pebbles, a chipped-off block, grass at its foot). Exact planes, so every facet is flat
//            and the ink follows the seams between them.
//   blanket  a height field: a thick fold (a rounded tube along the front edge), a top sheet with a
//            ragged raw edge over a base sheet that shows at the ends, a corner turned over with the
//            plain reverse showing, stripes that follow the folds, crease lines, and a dip where
//            she sits with wrinkles running away from it.
//
// Installed on CampWorld's prototype (engine/camp_world.js, camp_ground.js).

import { clamp, hash, smooth, valueNoise } from './raster.js';

const TWO_PI = Math.PI * 2;

export const ID_ROCK = 190;
export const ID_CHIP = 191;
export const ID_BLANKET = 192;

// materials (albedo, before the night's and the fire's light)
const ROCK_TOP = [196, 168, 134];
const ROCK_SIDE = [168, 138, 112];
const SOIL = [60, 46, 44];
const WOOL_RED = [170, 70, 66];
const WOOL_CREAM = [196, 176, 140];
const WOOL_BLUE = [92, 104, 158];
const WOOL_BACK = [150, 122, 110]; // the plain reverse of the turned corner
const INK = [14, 12, 22];
const AMB_R = [0.24, 0.235, 0.34]; // the night's light on stone: a little warmer than on canvas
const FIRE_R = [1.0, 0.63, 0.3];

// ------------------------------------------------------------------------ the rock

/**
 * A convex rock from planes: n . p <= d in its local frame (u, y, v). `top` is the crown's height
 * (the contact plane a person sits on); the sides lean in going up, a few chamfers wear the crown's
 * edge, and two shallow slopes tilt the crown away from the place he sits.
 */
export function makeRock(o) {
  const { x, z, yaw, a, c, top, seed, id } = o;
  const P = [];
  const add = (nx, ny, nz, d, kind, k) => {
    const l = Math.hypot(nx, ny, nz);
    P.push({ nx: nx / l, ny: ny / l, nz: nz / l, d: d / l, kind, k });
  };
  const rnd = (i) => hash(seed, i, 83);
  add(0, -1, 0, 0.04, 'bottom', -1);
  add(0, 1, 0, top, 'top', -1);
  // the sides: an irregular ring of planes (each side's distance wanders), in two tiers: a
  // steep foot that bulges, and shoulders that lean in toward the crown
  const N = o.sides ?? 17;
  const phase = rnd(99) * TWO_PI;
  const sideAt = [];
  for (let k = 0; k < N; k++) {
    const th = phase + (k / N) * TWO_PI + (rnd(k) - 0.5) * 0.5;
    const cx = Math.cos(th);
    const sz = Math.sin(th);
    const r = (1 / Math.hypot(cx / a, sz / c)) * (o.tight ?? 0.92) * (0.8 + 0.32 * rnd(k + 20));
    const leanLo = 0.04 + 0.1 * rnd(k + 40);
    const kk = Math.sqrt(1 - leanLo * leanLo);
    add(cx * kk, leanLo, sz * kk, kk * r, 'side', k);
    // the shoulder: leans in harder above a wandering height
    const ys = top * (0.42 + 0.3 * rnd(k + 50));
    const leanHi = 0.4 + 0.35 * rnd(k + 60);
    const kh = Math.sqrt(1 - leanHi * leanHi);
    const rSh = r - (leanLo / kk) * ys - 0.004;
    add(cx * kh, leanHi, sz * kh, kh * rSh + leanHi * ys, 'shoulder', k);
    sideAt.push({ th, cx, sz, r, lean: leanLo, kk });
  }
  // worn chamfers along the crown's edge (45 degrees), on some of the sides
  const CH = o.chamfers ?? 8;
  for (let q = 0; q < CH; q++) {
    const s = sideAt[Math.floor(rnd(70 + q) * N)];
    const w = 0.03 + 0.05 * rnd(80 + q);
    const rTop = s.r - 0.5 * top;
    add(s.cx * 0.7071, 0.7071, s.sz * 0.7071, 0.7071 * (rTop + top - w), 'chamfer', q);
  }
  // the crown tilts away from where he sits: shallow slopes toward two far corners
  for (let q = 0; q < (o.slopes ?? 2); q++) {
    const th = phase + rnd(180 + q) * TWO_PI;
    const rho0 = 0.5 * Math.min(a, c) + 0.05;
    const sl = 0.12 + 0.06 * rnd(185 + q);
    add(Math.cos(th) * sl, 1, Math.sin(th) * sl, top + sl * rho0, 'slope', q);
  }
  // a broken corner: one deeper cut through the crown at a corner
  if (o.broken !== false) {
    const th = phase + (0.15 + 0.7 * rnd(190)) * TWO_PI;
    const rho = 0.6 * Math.min(a, c) + 0.1;
    add(Math.cos(th) * 0.72, 0.5, Math.sin(th) * 0.72, 0.72 * rho + 0.5 * (top - 0.05), 'break', 0);
  }
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const pts = [];
  for (const su of [-1, 1])
    for (const sv of [-1, 1])
      for (const y of [0, top]) {
        const lu = su * a;
        const lv = sv * c;
        pts.push([x + lu * cs - lv * sn, y, z + lu * sn + lv * cs]);
      }
  return { kind: 'rock', x, z, yaw, cs, sn, a, c, top, seed, id, planes: P, pts, sideAt };
}

/** The rock's outline on the ground (y = 0): the signed distance (m) from a world point, > 0 outside. */
export function rockBaseDist(R, X, Z) {
  const dx = X - R.x;
  const dz = Z - R.z;
  const u = dx * R.cs + dz * R.sn;
  const v = -dx * R.sn + dz * R.cs;
  let m = -1e9;
  for (const p of R.planes) {
    if (p.kind !== 'side') continue;
    const h = Math.hypot(p.nx, p.nz);
    const dd = (p.nx * u + p.nz * v - p.d) / h;
    if (dd > m) m = dd;
  }
  return m;
}

/** A rock's outline at height y: the world point on its boundary in direction th (local), or null. */
function rockEdgePoint(R, th, y = 0) {
  const cx = Math.cos(th);
  const sz = Math.sin(th);
  let t = 1e9;
  for (const p of R.planes) {
    if (p.kind !== 'side') continue;
    const den = p.nx * cx + p.nz * sz;
    if (den <= 1e-6) continue;
    t = Math.min(t, (p.d - p.ny * y) / den);
  }
  if (t > 1e8) return null;
  const lu = cx * t;
  const lv = sz * t;
  return [R.x + lu * R.cs - lv * R.sn, R.z + lu * R.sn + lv * R.cs, lu, lv];
}

// ------------------------------------------------------------------------ the blanket

const TB = 0.036; // one sheet's thickness (m)

/**
 * The blanket as a height field. Local (u, v): u along its length, v across it, the fold along the
 * front edge (v = -sz). out = [height, part (1 base, 2 top sheet, 3 turned corner), stripe m (m from
 * the fold), edge (m to the nearest raw edge of the part, for ink)]. Returns height, or -1 outside.
 */
export function blanketHF(S, u, v, out) {
  const { sx, sz } = S;
  const sd = S.seed;
  // outline: a rounded rectangle whose edges wander a little (a soft, uneven edge)
  const r = 0.085;
  const wob =
    0.016 * (valueNoise(u * 4.2 + sd, v * 4.2, 5) - 0.5) +
    0.006 * (valueNoise(u * 13, v * 13, 6) - 0.5);
  const qx = Math.abs(u) - (sx - r);
  const qz = Math.abs(v) - (sz - r);
  const dist = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
  const di = -dist + wob;
  if (di <= 0) return -1;
  let h = TB * smooth(0, 0.014, di);
  let part = 1;
  const m = v + sz; // distance from the fold
  // the top sheet: over most of the front, its far edge and its two ends raw and a little short
  const uL = -sx * 0.9 + 0.02 * (valueNoise(v * 6, 3, 9) - 0.5);
  const uR = sx * 0.84 + 0.02 * (valueNoise(v * 6, 9, 9) - 0.5);
  const vB = S.foldTo + 0.03 * (valueNoise(u * 5, 4, 11) - 0.5);
  const eTop = Math.min(u - uL, uR - u, vB - v);
  let edge = 9;
  if (eTop > 0 && m > 0) {
    // the fold: a tube along the front edge (rounds over the last 2*TB)
    const T2 = 2 * TB;
    const dm = Math.min(m + di * 0 + 0.0, 9);
    const tube = dm < T2 ? Math.sqrt(Math.max(0, 1 - (1 - dm / T2) * (1 - dm / T2))) : 1;
    // the raw edges step down over a centimetre
    const step = smooth(0, 0.011, eTop);
    h = TB + TB * step * tube;
    part = step > 0.5 ? 2 : 1;
    edge = eTop;
  }
  // the corner turned over (front-left): the plain reverse showing, a fold along the diagonal
  const cu = u + sx;
  const cv = v + sz;
  const cc = S.corner;
  const g = (cu + cv) / Math.SQRT2;
  const gL = cc / Math.SQRT2;
  const t = (cu - cv) / Math.SQRT2;
  if (cu > -0.02 && cv > -0.02) {
    if (g < gL && part === 2) {
      // where the corner was: one sheet now
      h = TB * smooth(0, 0.012, Math.min(eTop, di)) + TB * 0.1;
      part = 1;
    }
    const gT = 2 * gL - Math.abs(t) * 1.0;
    if (g >= gL - 0.004 && g < gT && di > 0) {
      // the turned corner lies over the top sheet: a tube along its fold, raw on its other two edges
      const df = g - gL; // from the fold
      const de = Math.min(gT - g, 9);
      const tube = df < TB * 1.6 ? Math.sqrt(Math.max(0, 1 - (1 - df / (TB * 1.6)) ** 2)) : 1;
      const raw = smooth(0, 0.009, de);
      h = TB * 2 + TB * 1.05 * tube * raw + 0.002;
      part = 3;
      edge = Math.min(de, edge);
    }
  }
  // the dip where she sits, and wrinkles running away from it
  const dxs = u - S.sagU;
  const dvs = v - S.sagV;
  const rs = Math.hypot(dxs, dvs);
  h -= S.sagK * Math.exp(-(rs * rs) / (S.sagR * S.sagR)) * smooth(0, 0.02, di);
  const th = Math.atan2(dvs, dxs);
  const wr =
    0.009 *
    Math.sin(th * 5 + 3 * valueNoise(th * 2 + sd, rs * 3, 4) + rs * 8) *
    smooth(0.2, 0.34, rs) *
    smooth(0.85, 0.5, rs);
  h += wr * smooth(0, 0.03, di);
  // soft undulation of the whole (wool is never flat)
  h += 0.0035 * (valueNoise(u * 7 + 3, v * 7, 12) - 0.5);
  out[0] = Math.max(0.002, h);
  out[1] = part;
  out[2] = m;
  out[3] = edge;
  return out[0];
}

// ------------------------------------------------------------------------ methods

export const seatMethods = {
  /** Build the seat objects named in the set; fills this.rocks, this.blankets. */
  buildSeatObjects() {
    this.rocks = [];
    this.blankets = [];
    const out = {};
    (this.set.seats || []).forEach((s, k) => {
      if (s.kind === 'slab') {
        const R = makeRock({
          x: s.x,
          z: s.z,
          yaw: s.yaw,
          a: s.a,
          c: s.c,
          top: s.top,
          seed: s.seed ?? 5 + k,
          id: ID_ROCK,
        });
        R.main = true;
        this.rocks.push(R);
        const ids = [ID_ROCK];
        // lobes fused to the rock: lower steps and shoulders that make its outline more than one convex piece
        for (const [li, lb] of (s.lobes || []).entries()) {
          const cs0 = Math.cos(s.yaw);
          const sn0 = Math.sin(s.yaw);
          this.rocks.push(
            makeRock({
              x: s.x + lb.u * cs0 - lb.v * sn0,
              z: s.z + lb.u * sn0 + lb.v * cs0,
              yaw: s.yaw + (lb.yaw ?? 0),
              a: lb.a,
              c: lb.c,
              top: lb.top,
              seed: (s.seed ?? 5) + 11 + li * 7,
              id: ID_ROCK,
              sides: 11,
              chamfers: 4,
              slopes: 1,
              broken: false,
              tight: 0.92,
            }),
          );
        }
        // a block broken off the rock, half sunk at its foot
        if (s.chip) {
          const ch = s.chip;
          const cs = Math.cos(s.yaw);
          const sn = Math.sin(s.yaw);
          const C = makeRock({
            x: s.x + ch.u * cs - ch.v * sn,
            z: s.z + ch.u * sn + ch.v * cs,
            yaw: s.yaw + (ch.yaw ?? 0.5),
            a: ch.a,
            c: ch.c,
            top: ch.top,
            seed: (s.seed ?? 5) + 31,
            id: ID_CHIP,
            sides: 7,
            chamfers: 2,
            slopes: 1,
            broken: false,
            tight: 0.9,
          });
          this.rocks.push(C);
          ids.push(ID_CHIP);
        }
        out[s.id] = { ...s, ids, top: s.top };
      } else if (s.kind === 'blanket') {
        const cs = Math.cos(s.yaw);
        const sn = Math.sin(s.yaw);
        const sg = s.sag || { x: s.x, z: s.z };
        const dx = sg.x - s.x;
        const dz = sg.z - s.z;
        const B = {
          kind: 'blanket',
          x: s.x,
          z: s.z,
          sx: s.sx,
          sz: s.sz,
          yaw: s.yaw,
          cs,
          sn,
          seed: s.seed ?? 3,
          foldTo: s.foldTo ?? 0.08,
          corner: s.corner ?? 0.3,
          sagU: dx * cs + dz * sn,
          sagV: -dx * sn + dz * cs,
          sagK: s.sagK ?? 0.02,
          sagR: s.sagR ?? 0.3,
          id: ID_BLANKET,
          hmax: 0.07,
        };
        const pts = [];
        for (const su of [-1, 1])
          for (const sv of [-1, 1])
            for (const y of [0, B.hmax]) {
              const lu = su * s.sx;
              const lv = sv * s.sz;
              pts.push([s.x + lu * cs - lv * sn, y, s.z + lu * sn + lv * cs]);
            }
        B.pts = pts;
        this.blankets.push(B);
        out[s.id] = { ...s, ids: [ID_BLANKET], top: s.top ?? 0.034 };
      } else {
        out[s.id] = { ...s, ids: [], top: 0 };
      }
    });
    this.seats = out;
    // pebbles and grit round each rock's foot: small stones on the ground (the stone pass draws
    // them, the contact grid darkens the earth under them)
    for (const R of this.rocks) {
      if (!R.main) continue;
      for (let k = 0; k < 6; k++) {
        const th = hash(R.seed, 200 + k, 83) * TWO_PI;
        const e = rockEdgePoint(R, th, 0);
        if (!e) continue;
        const out2 = 0.05 + 0.13 * hash(R.seed, 210 + k, 83);
        const ux = Math.cos(th) * out2;
        const vz = Math.sin(th) * out2;
        // in front of the rock (toward the camera, -Z) only the small ones: boots go there
        const wx = ux * R.cs - vz * R.sn;
        const wz = ux * R.sn + vz * R.cs;
        const front = wz < -0.02;
        this.stones.push({
          x: e[0] + wx,
          z: e[1] + wz,
          a: (front ? 0.016 : 0.028) + 0.024 * hash(R.seed, 220 + k, 83),
          b: 0.014 + 0.016 * hash(R.seed, 230 + k, 83),
          c: 0.018 + 0.02 * hash(R.seed, 240 + k, 83),
          yaw: hash(R.seed, 250 + k, 83) * 3,
          fac: [0, 1, 0, 0.7],
          pebble: true,
        });
      }
    }
  },

  /** Grass rooted in the earth at the foot of each rock: short, few in front (the boots), more behind. */
  seatTufts() {
    for (const R of this.rocks) {
      if (!R.main) continue;
      for (let k = 0; k < 26; k++) {
        const th = hash(R.seed, 300 + k, 83) * TWO_PI;
        const e = rockEdgePoint(R, th, 0);
        if (!e) continue;
        const off = 0.02 + 0.07 * hash(R.seed, 310 + k, 83);
        const wx = Math.cos(th) * off * R.cs - Math.sin(th) * off * R.sn;
        const wz = Math.cos(th) * off * R.sn + Math.sin(th) * off * R.cs;
        const X = e[0] + wx;
        const Z = e[1] + wz;
        // the front arc (toward the camera) stays clear where the boots and the seat's edge are seen
        const facing = Math.atan2(Z - R.z, X - R.x);
        const front = Math.cos(facing + Math.PI / 2); // 1 straight toward -Z
        if (front > 0.55 && hash(R.seed, 320 + k, 83) < 0.8) continue;
        this.tufts.push({
          X,
          Z,
          h: 0.1 + 0.11 * hash(R.seed, 330 + k, 83),
          n: 3 + Math.floor(hash(R.seed, 340 + k, 83) * 3),
          seed: 900 + k,
        });
      }
    }
  },

  // ---------------------------------------------------------------- footprints, shadows

  /** Footprints for the contact grid: { t: 'p', R } for a rock, { t: 'r' } for a blanket. */
  seatFootprints(list) {
    for (const R of this.rocks)
      list.push({ t: 'p', R, margin: R.id === ID_ROCK ? 0.2 : 0.12, k: 0.85 });
    for (const B of this.blankets)
      list.push({
        t: 'r',
        x: B.x,
        z: B.z,
        a: B.sx * 0.94,
        c: B.sz * 0.94,
        cs: B.cs,
        sn: B.sn,
        margin: 0.08,
        k: 0.6,
      });
  },

  /**
   * Cast shadows of the seats: the block's outline swept away from the fire, longer for the higher
   * rock. `stamp(X, Z, r, k)` is the shadow grid's soft disc.
   */
  seatShadows(stamp, flick, STRETCH) {
    const F = this.fire;
    for (const R of this.rocks) {
      const dx = R.x - F.x;
      const dz = R.z - F.z;
      const rf = Math.hypot(dx, dz) || 1;
      const ux = dx / rf;
      const uz = dz / rf;
      const step = 0.06;
      for (let lu = -R.a; lu <= R.a; lu += step)
        for (let lv = -R.c; lv <= R.c; lv += step) {
          const X = R.x + lu * R.cs - lv * R.sn;
          const Z = R.z + lu * R.sn + lv * R.cs;
          const d = rockBaseDist(R, X, Z);
          if (d > -0.01) continue;
          // the point's depth into the rock: the block shades what is behind it
          for (const y of [0, 0.5, 1]) {
            const reach = R.top * y * STRETCH * flick;
            stamp(X + ux * reach, Z + uz * reach, 0.07 + 0.03 * y, 0.62 - 0.14 * y);
          }
        }
    }
    for (const B of this.blankets) {
      const dx = B.x - F.x;
      const dz = B.z - F.z;
      const rf = Math.hypot(dx, dz) || 1;
      // a blanket is nearly flat: only a hint of a shadow at its far edge
      void rf;
      void stamp;
    }
  },

  // ---------------------------------------------------------------- drawing

  drawSeats(frame, B) {
    for (const R of this.rocks) this.drawRock(frame, B, R);
    for (const S of this.blankets) this.drawBlanket(frame, B, S);
  },

  /**
   * Light on stone: the fire in three flat steps (as lightSurf) and a sky term that favours what faces
   * up, so a crown reads paler than a flank even where the fire does not reach it (moonlit stone).
   */
  lightRock(X, Y, Z, nx, ny, nz, A, out, warm) {
    const f = this.fire;
    let lx = f.x - X;
    let ly = f.y - Y;
    let lz = f.z - Z;
    const d2 = lx * lx + ly * ly + lz * lz;
    const il = 1 / Math.sqrt(d2 + 1e-6);
    lx *= il;
    ly *= il;
    lz *= il;
    const lam = Math.max(0, nx * lx + ny * ly + nz * lz);
    const I = (this.k * 1.2) / (1 + d2 / 2.0);
    let fl = I * (0.12 + 0.88 * lam) * this.shadowAt(X, Z);
    fl =
      0.78 *
      (0.36 * smooth(0.05, 0.075, fl) +
        0.34 * smooth(0.15, 0.18, fl) +
        0.3 * smooth(0.33, 0.37, fl));
    // the fire's light washes the sky's blue out of what it reaches (warm ones go ember, not salmon)
    const sky = (0.5 + 0.75 * Math.max(0, ny)) * (1 - 0.55 * (fl / 0.78));
    out[0] = A[0] * (AMB_R[0] * sky + FIRE_R[0] * fl) + warm * 90;
    out[1] = A[1] * (AMB_R[1] * sky + FIRE_R[1] * fl) + warm * 34;
    out[2] = A[2] * (AMB_R[2] * sky + FIRE_R[2] * fl) + warm * 4;
  },

  drawRock(frame, B, R) {
    const cam = this.cam;
    const { W } = this;
    const [bx0, by0, bx1, by1] = this.boxOf(cam, R.pts, 3);
    if (bx0 >= bx1 || by0 >= by1) return;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const lox = ox - R.x;
    const loz = oz - R.z;
    const lo0 = lox * R.cs + loz * R.sn;
    const lo1 = oy;
    const lo2 = -lox * R.sn + loz * R.cs;
    const P = R.planes;
    const np = P.length;
    const c = new Float64Array(3);
    const F = this.fire;
    const fireTop = Math.atan2(F.z - R.z, F.x - R.x);
    const seed = R.seed;
    const Fpx = B.F;
    for (let y = by0; y < by1; y++)
      for (let x = bx0; x < bx1; x++) {
        const i = y * W + x;
        const dx = this.rdx[i];
        const dy = this.rdy[i];
        const dz = this.rdz[i];
        const ld0 = dx * R.cs + dz * R.sn;
        const ld1 = dy;
        const ld2 = -dx * R.sn + dz * R.cs;
        let t0 = 0.05;
        let t1 = 1e9;
        let t2 = 0.05;
        let k = -1;
        let ok = true;
        for (let p = 0; p < np; p++) {
          const q = P[p];
          const den = q.nx * ld0 + q.ny * ld1 + q.nz * ld2;
          const num = q.d - (q.nx * lo0 + q.ny * lo1 + q.nz * lo2);
          if (den < -1e-9) {
            const t = num / den;
            if (t > t0) {
              t2 = t0;
              t0 = t;
              k = p;
            } else if (t > t2) t2 = t;
          } else if (den > 1e-9) {
            const t = num / den;
            if (t < t1) t1 = t;
          } else if (num < 0) {
            ok = false;
            break;
          }
          if (t0 > t1) {
            ok = false;
            break;
          }
        }
        if (!ok || k < 0) continue;
        const Y = oy + dy * t0;
        if (Y < 0) continue;
        const depth = t0 * this.cf[i];
        if (depth >= this.zbuf[i]) continue;
        const q = P[k];
        const hu = lo0 + ld0 * t0;
        const hv = lo2 + ld2 * t0;
        const X = ox + dx * t0;
        const Z = oz + dz * t0;
        // facet edges: ink where two facets meet (within about a pixel)
        const seam = (t0 - t2) * Math.hypot(dx, dy, dz) < (1.15 * depth) / Fpx;
        // ---- the material
        const onTop = q.kind === 'top' || q.kind === 'slope' || q.kind === 'break';
        const stoneSide = q.kind === 'side' || q.kind === 'shoulder';
        let A = onTop || q.kind === 'chamfer' ? ROCK_TOP : ROCK_SIDE;
        // grain in cells of about 1.6 cm, patches of a warmer and a paler stone
        const gu = onTop ? hu : stoneSide ? hu * q.nz - hv * q.nx : hu + hv;
        const gv = onTop ? hv : Y;
        const cellN = hash(Math.floor(gu * 62), Math.floor(gv * 62), seed);
        const patch = valueNoise(gu * 4.5 + seed, gv * 4.5, 7);
        let tone = 0.84 + 0.07 * cellN + 0.3 * patch;
        // strata on the sides: a few dark seams that wander with height and fade out along the
        // face (never a ruled line), and a paler lip above each
        if (!onTop) {
          const lvl = Y * 17 + 2.6 * valueNoise(gu * 2.6, seed, 4) + 0.5 * Math.sin(gu * 5 + seed);
          const fr = lvl - Math.floor(lvl);
          const here = valueNoise(gu * 2.1 + 9, Math.floor(lvl) * 3.7, 16) > 0.48;
          if (here && fr < 0.09) tone *= 0.62;
          else if (here && fr > 0.9) tone *= 1.12;
        }
        // cracks: a dark ridge in a noise field, on the crown and the chamfers, few and thin
        const crackN = Math.abs(valueNoise(gu * 3.1 + 7, gv * 3.1 + seed, 13) - 0.5);
        const crackM = valueNoise(gu * 1.3, gv * 1.3 + 3, 14);
        let crack = crackN < 0.012 && crackM > 0.46 ? 1 : 0;
        // a long crack across the crown
        if (q.kind === 'top' && R.main) {
          const ln = Math.abs(hv - 0.12 * Math.sin(hu * 3.1 + seed) - 0.14 - 0.35 * hu) < 0.0065;
          if (ln && hu > -0.3 && hu < 0.4) crack = 1;
          const ln2 = Math.abs(hu + 0.08 + 0.3 * (hv + 0.1) + 0.05 * Math.sin(hv * 9)) < 0.0055;
          if (ln2 && hv < 0.05 && hv > -0.3) crack = 1;
        }
        if (crack) tone *= 0.4;
        // the earth at its foot: soil grown up the side a little, with a wavering line
        const soilH = 0.018 + 0.03 * valueNoise(gu * 9, seed, 15);
        let soil = 0;
        if (!onTop && Y < soilH) {
          soil = 1;
          A = SOIL;
          tone = 0.85 + 0.3 * cellN;
        }
        // grit: a few pale specks
        if (cellN > 0.965) tone *= 1.3;
        // the stone is rough: the normal is jittered in patches, so the fire's flat steps break
        // into blotches instead of one clean plane
        const jit = onTop ? 0.07 : 0.26;
        const jx = (valueNoise(gu * 9 + 3, gv * 9, 41) - 0.5) * jit;
        const jz = (valueNoise(gu * 9, gv * 9 + 5, 42) - 0.5) * jit;
        let nlx = q.nx + jx;
        let nly = q.ny + (valueNoise(gu * 8, gv * 8 + 9, 43) - 0.5) * jit * 0.6;
        let nlz = q.nz + jz;
        const nll = Math.hypot(nlx, nly, nlz);
        nlx /= nll;
        nly /= nll;
        nlz /= nll;
        const nx = nlx * R.cs - nlz * R.sn;
        const nz = nlx * R.sn + nlz * R.cs;
        const ny = nly;
        // the side toward the fire is the warm one; the far side keeps the night's cool
        const facing = Math.cos(Math.atan2(nz, nx) - fireTop);
        const dk = R.id === ID_ROCK ? 1 : 0.94;
        // the earth round it is lit by the fire and throws some of it back: a warm fill on the low sides
        const Iw = this.intensity(X, 0.05, Z);
        const bounce = (0.16 + 0.5 * Iw) * (1 - 0.65 * ny * ny) * smooth(0.36, 0.03, Y) + 0.14 * Iw;
        this.lightRock(
          X,
          Y,
          Z,
          nx,
          ny,
          nz,
          [A[0] * tone * dk, A[1] * tone * dk, A[2] * tone * dk],
          c,
          bounce,
        );
        // a rim of the fire's light on the crown's lip and the chamfers toward it
        if ((q.kind === 'chamfer' || q.kind === 'break') && facing > 0.2) {
          const rk = 0.11 * this.k * (facing - 0.2);
          c[0] += 255 * rk;
          c[1] += 120 * rk;
          c[2] += 40 * rk;
        }
        if (seam && !soil) {
          const k2 = 0.5 * (1 - 0.45 * clamp(facing));
          c[0] = c[0] * (1 - k2) + INK[0] * k2;
          c[1] = c[1] * (1 - k2) + INK[1] * k2;
          c[2] = c[2] * (1 - k2) + INK[2] * k2;
        }
        frame[i * 4] = c[0];
        frame[i * 4 + 1] = c[1];
        frame[i * 4 + 2] = c[2];
        this.ids[i] = R.id;
        this.zbuf[i] = depth;
        this.ink[i] = 0;
        this.sky[i] = 0;
        this._seatLum[i] = clamp(0.5 + 0.8 * facing * (0.5 + 0.5 * this.k) - (onTop ? 0 : 0.1));
        this._seatPart[i] = 1;
        this._seatH[i] = Y;
      }
  },

  /** The wool at material coordinate m (metres from the fold) and local (u, v): stripes that follow the folds. */
  woolAt(S, m, u, v, part) {
    const n = hash(Math.floor(u * 55), Math.floor(v * 55), S.seed);
    const nn = valueNoise(u * 26, v * 26, 21);
    let A;
    if (part === 3) A = WOOL_BACK;
    else {
      // bands: a blue pair and a cream line near the fold, another cream, a wide blue band far in
      A = WOOL_RED;
      const bands = [
        [0.022, 0.036, WOOL_CREAM],
        [0.075, 0.105, WOOL_BLUE],
        [0.12, 0.155, WOOL_CREAM],
        [0.165, 0.195, WOOL_BLUE],
        [0.36, 0.385, WOOL_CREAM],
        [0.4, 0.46, WOOL_BLUE],
        [0.5, 0.52, WOOL_CREAM],
      ];
      // the bands wander a little (woven by hand)
      const mm = m + 0.006 * (valueNoise(u * 6, 2, 22) - 0.5) * 2;
      for (const [a, b, col] of bands) if (mm >= a && mm < b) A = col;
    }
    const w = 0.84 + 0.2 * n + 0.2 * nn;
    // a few pale fibres standing up
    const fib = hash(Math.floor(u * 70), Math.floor(v * 70), S.seed + 5) > 0.975 ? 1.3 : 1;
    return [A[0] * w * fib, A[1] * w * fib, A[2] * w * fib];
  },

  drawBlanket(frame, B, S) {
    const cam = this.cam;
    const { W } = this;
    const [bx0, by0, bx1, by1] = this.boxOf(cam, S.pts, 3);
    if (bx0 >= bx1 || by0 >= by1) return;
    const ox = B.ox;
    const oy = B.oy;
    const oz = B.oz;
    const lox = ox - S.x;
    const loz = oz - S.z;
    const lo0 = lox * S.cs + loz * S.sn;
    const lo2 = -lox * S.sn + loz * S.cs;
    const c = new Float64Array(3);
    const h4 = new Float64Array(4);
    const hs = new Float64Array(4);
    const F = this.fire;
    const fireDir = Math.atan2(F.z - S.z, F.x - S.x);
    const hmax = S.hmax;
    const eps = 0.005;
    for (let y = by0; y < by1; y++)
      for (let x = bx0; x < bx1; x++) {
        const i = y * W + x;
        const dx = this.rdx[i];
        const dy = this.rdy[i];
        const dz = this.rdz[i];
        if (dy > -1e-5 && oy > hmax) continue;
        const ld0 = dx * S.cs + dz * S.sn;
        const ld2 = -dx * S.sn + dz * S.cs;
        // the ray inside the slab 0 < y < hmax
        let ta = oy > hmax ? (hmax - oy) / dy : 0.05;
        let tb = dy < -1e-5 ? -oy / dy : 60;
        if (ta < 0.05) ta = 0.05;
        if (!(tb > ta)) continue;
        // march down the ray until it is under the surface
        const n = 46;
        let hit = -1;
        let tp = ta;
        for (let s = 0; s <= n; s++) {
          const t = ta + ((tb - ta) * s) / n;
          const yy = oy + dy * t;
          const hh = blanketHF(S, lo0 + ld0 * t, lo2 + ld2 * t, hs);
          if (hh >= 0 && yy <= hh) {
            // refine between the last step and this one
            let a = tp;
            let b = t;
            for (let q = 0; q < 7; q++) {
              const m = (a + b) * 0.5;
              const h2 = blanketHF(S, lo0 + ld0 * m, lo2 + ld2 * m, hs);
              if (h2 >= 0 && oy + dy * m <= h2) b = m;
              else a = m;
            }
            hit = b;
            break;
          }
          tp = t;
        }
        if (hit < 0) continue;
        const depth = hit * this.cf[i];
        if (depth >= this.zbuf[i]) continue;
        const u = lo0 + ld0 * hit;
        const v = lo2 + ld2 * hit;
        const hh = blanketHF(S, u, v, h4);
        if (hh < 0) continue;
        const part = h4[1];
        // the normal from the field
        const hu1 = blanketHF(S, u + eps, v, hs);
        const hu0 = blanketHF(S, u - eps, v, hs);
        const hv1 = blanketHF(S, u, v + eps, hs);
        const hv0 = blanketHF(S, u, v - eps, hs);
        const gU = ((hu1 < 0 ? hh : hu1) - (hu0 < 0 ? hh : hu0)) / (2 * eps);
        const gV = ((hv1 < 0 ? hh : hv1) - (hv0 < 0 ? hh : hv0)) / (2 * eps);
        let nu = -gU;
        let nvv = -gV;
        let ny = 1;
        const nl = Math.hypot(nu, ny, nvv);
        nu /= nl;
        ny /= nl;
        nvv /= nl;
        const nx = nu * S.cs - nvv * S.sn;
        const nz = nu * S.sn + nvv * S.cs;
        const X = ox + dx * hit;
        const Y = oy + dy * hit;
        const Z = oz + dz * hit;
        let A = this.woolAt(S, h4[2], u, v, part);
        // creases: a few dark fold lines across the top sheet (ink on the fold lines)
        let ink = 0;
        if (part === 2) {
          for (let q = 0; q < 3; q++) {
            const uc = -S.sx * 0.5 + q * S.sx * 0.55 + 0.05 * Math.sin(v * 8 + q * 2);
            const wv = Math.abs(u - uc - 0.35 * (v + S.sz) * (q - 1) * 0.3);
            if (wv < 0.0045 && v > -S.sz + 0.05 && v < S.foldTo - 0.05) ink = 0.5;
          }
        }
        // in the shadow under the fold's overhang and the turned corner's edge
        const under = h4[3] < 0.012 ? 0.78 + 0.22 * smooth(0, 0.012, h4[3]) : 1;
        // the pressed hollow where she sits is a little darker
        const rs = Math.hypot(u - S.sagU, v - S.sagV);
        const press = 1 - 0.14 * Math.exp(-(rs * rs) / (S.sagR * S.sagR));
        this.lightSurf(
          X,
          Y,
          Z,
          nx,
          ny,
          nz,
          [A[0] * under * press, A[1] * under * press, A[2] * under * press],
          c,
          0,
          1,
        );
        if (ink > 0) {
          c[0] = c[0] * (1 - ink) + INK[0] * ink;
          c[1] = c[1] * (1 - ink) + INK[1] * ink;
          c[2] = c[2] * (1 - ink) + INK[2] * ink;
        }
        frame[i * 4] = c[0];
        frame[i * 4 + 1] = c[1];
        frame[i * 4 + 2] = c[2];
        this.ids[i] = S.id;
        this.zbuf[i] = depth;
        this.ink[i] = 0;
        this.sky[i] = 0;
        const facing = Math.cos(Math.atan2(nz, nx) - fireDir);
        this._seatLum[i] = clamp(0.35 + 0.5 * facing * ny + 0.3 * (1 - ny));
        this._seatPart[i] = part + 1;
        this._seatH[i] = hh;
      }
  },

  /**
   * Ink on the seats' contours: where a seat meets the ground or a thing behind it, and where one
   * of its parts lies over another (the fold, the raw edge, the turned corner). Heavier on the side
   * away from the fire and at the foot, thin (soft) on the lit lip, broken in places (lost).
   */
  passSeatInk(frame) {
    const { W, H } = this;
    const ids = this.ids;
    const zb = this.zbuf;
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const id = ids[i];
        if (id < ID_ROCK || id > ID_BLANKET) continue;
        let edge = 0;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          const b = ids[j];
          if (b === id) {
            if (id === ID_BLANKET) {
              // a part that lies over another: ink on the higher one's edge
              if (
                this._seatPart[j] !== this._seatPart[i] &&
                this._seatH[i] > this._seatH[j] + 0.004
              )
                edge = Math.max(edge, 0.85);
            }
            continue;
          }
          if (b >= ID_ROCK && b <= ID_BLANKET) {
            if (zb[i] < zb[j] - 0.005) edge = Math.max(edge, 0.7);
            continue;
          }
          // the foot: where the seat meets the ground its lowest row is inked (the ground there is
          // nearer the lens, so the depth test would skip it); against anything else it must be nearer
          if (b === 20 || zb[i] <= zb[j] + 0.02) edge = Math.max(edge, 1);
        }
        if (!edge) continue;
        const lum = this._seatLum[i];
        // soft on the lit side, found on the dark one, lost in patches (a coarse noise)
        const lostN = valueNoise(x * 0.32 + 4, y * 0.32, 31);
        const lostK = smooth(0.2, 0.36, lostN);
        const s = edge * (0.95 - 0.5 * lum) * (0.45 + 0.55 * lostK);
        if (hash(x, y, 43) < 0.08) continue;
        const o = i * 4;
        frame[o] = frame[o] * (1 - s) + INK[0] * s;
        frame[o + 1] = frame[o + 1] * (1 - s) + INK[1] * s;
        frame[o + 2] = frame[o + 2] * (1 - s) + INK[2] * s;
      }
  },
};
