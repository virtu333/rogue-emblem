// Skin: cut-out animation for painted figures. One painting (a keyed cut-out Layer) is
// bound to a 2D skeleton and bent to follow a solved skeleton frame by frame, the way
// Live2D or Spine bend a layered picture, so a character moves as the blocking says
// (ford_blocking.js `skeletonAt`) and stays on-model, because every pixel still comes from
// the one painting.
//
//   rest pose            joints and a few painted regions, annotated by eye (cutouts/rigs.json)
//   Skin                 the rig bound to a Layer: a triangle mesh per part, linear-blend weights
//   Skin.pose(skAt, t)   retarget: the blocking's skeleton onto the art's own bone lengths
//   Skin.bake(pose)      deform the mesh, rasterise it back into the painting, and return a
//                        proxy Layer (same paint stages, dissolve mask, nearest-pixel crispness)
//                        that view.drawSprite draws like any other layer
//   Puppet               several key poses of one character; per frame the nearest key is
//                        warped (a cut between drawings, on twos)
//
// Everything is a pure function of the skeleton (and of the skeleton a moment earlier, for
// the cloth and hair that follow with lag), so a frame can be rendered in any order.
//
// Conventions. Layer px, y down. A blocking skeleton is metres, y up; it is brought into
// the layer by hips -> the art's hips and metres -> px by the rig's `ppm` (px per metre,
// measured from the art's bone lengths against the blocking's). The art must face the
// way the blocking faces: pass `flip` and the layer is mirrored (joints and regions too).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth01 = (u) => {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
};
export const angDiff = (a, b) => {
  const d = a - b;
  return d - TAU * Math.round(d / TAU);
};
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const polar = (p, a, l) => [p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l];

/** The body's bones: [name, from joint, to joint]. N = the weapon arm / near leg, F = the other. */
export const CHAIN = [
  ['torsoLow', 'hips', 'spine'],
  ['torsoUp', 'spine', 'neck'],
  ['head', 'neck', 'head'],
  ['uarmN', 'shN', 'elN'],
  ['farmN', 'elN', 'wrN'],
  ['handN', 'wrN', 'hdN'],
  ['uarmF', 'shF', 'elF'],
  ['farmF', 'elF', 'wrF'],
  ['handF', 'wrF', 'hdF'],
  ['thighN', 'hips', 'knN'],
  ['shinN', 'knN', 'anN'],
  ['footN', 'anN', 'toN'],
  ['thighF', 'hips', 'knF'],
  ['shinF', 'knF', 'anF'],
  ['footF', 'anF', 'toF'],
];
/** Names a region may use for groups of bones. */
const GROUPS = {
  torso: ['torsoLow', 'torsoUp'],
  armN: ['uarmN', 'farmN'],
  armF: ['uarmF', 'farmF'],
  legN: ['thighN', 'shinN', 'footN'],
  legF: ['thighF', 'shinF', 'footF'],
};
const STRETCH = { min: 0.9, max: 1.1 };
/** How much each bone counts when picking the key pose nearest a skeleton. */
const DIST_W = {
  torsoLow: 1.4,
  torsoUp: 1.4,
  head: 0.5,
  uarmN: 0.5,
  farmN: 0.5,
  uarmF: 0.35,
  farmF: 0.35,
  thighN: 1,
  shinN: 0.6,
  thighF: 1,
  shinF: 0.6,
  weapon: 2.2,
};

// ---------------------------------------------------------------- polygons and masks

/** Fill polygon `pts` (px) into `mask` (w*h) with `val` (even-odd). */
function fillPoly(mask, w, h, pts, val) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(h - 1, Math.ceil(y1));
  const n = pts.length;
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy))
        xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * w + x] = val;
    }
  }
}

/** Box-dilate the set `core` (value 1) by r px into 1 (core) and 2 (ring), limited to `alpha`. */
function dilate(core, alpha, w, h, r) {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dx = -r; dx <= r && !hit; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && core[y * w + xx] === 1) hit = 1;
      }
      tmp[y * w + x] = hit;
    }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (!alpha[j]) continue;
      if (core[j] === 1) {
        out[j] = 1;
        continue;
      }
      let hit = 0;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) hit = 1;
      }
      if (hit) out[j] = 2;
    }
  return out;
}

/** A capsule (thick segment with round ends) as a polygon. */
function capsule(a, b, r) {
  const ang = angle(a, b);
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / 8;
    pts.push([b[0] + Math.cos(t) * r, b[1] + Math.sin(t) * r]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / 8;
    pts.push([a[0] + Math.cos(t) * r, a[1] + Math.sin(t) * r]);
  }
  return pts;
}

const segDist = (px, py, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const u = l2 < 1e-9 ? 0 : clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(px - (a[0] + u * dx), py - (a[1] + u * dy));
};

/** 2x3 matrix taking the rest segment (ra, rb) onto (ta, tb): rotate, stretch along it, move. */
function boneMatrix(ra, rb, ta, tb, out) {
  const rl = dist(ra, rb);
  const tl = dist(ta, tb);
  if (rl < 1e-6) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = ta[0] - ra[0];
    out[5] = ta[1] - ra[1];
    return out;
  }
  const k = tl < 1e-6 ? 1 : tl / rl;
  // p' = ta + Rt * diag(k, 1) * R0^-1 (p - ra): into the bone's frame, stretch along the bone,
  // out again at the target angle
  const a0 = angle(ra, rb);
  const c0 = Math.cos(a0);
  const s0 = Math.sin(a0);
  const at = tl < 1e-6 ? a0 : angle(ta, tb);
  const ct = Math.cos(at);
  const st = Math.sin(at);
  out[0] = ct * k * c0 + st * s0;
  out[1] = ct * k * s0 - st * c0;
  out[2] = st * k * c0 - ct * s0;
  out[3] = st * k * s0 + ct * c0;
  out[4] = ta[0] - (out[0] * ra[0] + out[1] * ra[1]);
  out[5] = ta[1] - (out[2] * ra[0] + out[3] * ra[1]);
  return out;
}

/** Two-bone IK from S toward T; the joint bends to `side` (+1: rotate the reach clockwise on screen). */
export function ik2(S, T, a, b, side, kmax = STRETCH.max) {
  let d = dist(S, T);
  let k = 1;
  if (d > a + b) k = Math.min(kmax, d / (a + b));
  const A = a * k;
  const B = b * k;
  const dc = clamp(d, Math.abs(A - B) + 1e-3, A + B - 1e-4);
  d = d || 1e-6;
  const ux = (T[0] - S[0]) / d;
  const uy = (T[1] - S[1]) / d;
  const ang = Math.acos(clamp((A * A + dc * dc - B * B) / (2 * A * dc), -1, 1)) * side;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return {
    joint: [S[0] + A * (ux * c - uy * s), S[1] + A * (ux * s + uy * c)],
    end: [S[0] + ux * dc, S[1] + uy * dc],
    stretch: k,
  };
}

/** px per metre from joints J (px) against a blocking skeleton: the median bone-length ratio. */
function ppmFrom(J, sk) {
  const r = [dist(J.hips, J.neck) / dist(sk.hips, sk.neck)];
  for (const s of ['N', 'F']) {
    const leg = sk.legs[s];
    r.push(dist(J.hips, J[`kn${s}`]) / dist(sk.hips, leg.knee));
    r.push(dist(J[`kn${s}`], J[`an${s}`]) / dist(leg.knee, leg.foot));
  }
  r.sort((a, b) => a - b);
  return r[Math.floor(r.length / 2)];
}

/** The rig's px per metre at the image's own size (before a layer is built from it). */
export function specPpm(spec, sk) {
  const [w, h] = spec.size;
  const J = {};
  for (const [k, p] of Object.entries(spec.joints)) J[k] = [p[0] * w, p[1] * h];
  return ppmFrom(J, sk);
}

// ---------------------------------------------------------------------------- the rig

/**
 * A rig bound to a Layer.
 *   layer  from Piece.figure(...) (already mirrored if `flip`)
 *   spec   a rigs.json entry (normalised joints, regions, weapon, lags)
 *   opts   { flip, step (mesh cell px), pad (part overlap px) }
 */
export class Skin {
  constructor(layer, spec, opts = {}) {
    this.layer = layer;
    this.spec = spec;
    this.flip = !!opts.flip;
    const st = layer.st;
    const w = (this.w = st.w);
    const h = (this.h = st.h);
    this.name = spec.name || '';
    const fx = (x) => (this.flip ? 1 - x : x) * w;
    const P = (p) => [fx(p[0]), p[1] * h];
    // joints (px)
    this.J = {};
    for (const [k, p] of Object.entries(spec.joints)) this.J[k] = P(p);
    this.grips = { N: !!spec.grips?.N, F: !!spec.grips?.F };
    this.buildBones();
    this.ppm = spec.ppm || null; // set by calibrate()
    this.step = opts.step || Math.max(3, Math.round(h / 64));
    this.pad = opts.pad ?? 2;
    this.tau = (spec.blend ?? 0.045) * h;
    this.buildParts(P);
    this.ref = null;
    this.bias = { torsoLow: 0, torsoUp: 0, head: 0 };
    this.swap = !!spec.legs?.swap;
    // deformed-frame buffers, grown on demand
    this.cap = 0;
    this.src = null;
    this.proxy = null;
    this.mats = new Float32Array(this.bones.length * 6);
  }

  // ------------------------------------------------------------------ bones

  buildBones() {
    const J = this.J;
    this.bones = [];
    this.boneIx = {};
    for (const [name, a, b] of CHAIN) {
      if (!J[a] || !J[b]) continue;
      this.addBone({ name, ja: a, jb: b, ra: J[a], rb: J[b], ...STRETCH });
    }
    this.buildWeapon();
  }

  addBone(b) {
    b.len = dist(b.ra, b.rb);
    b.ang = angle(b.ra, b.rb);
    b.set = b.set || null;
    this.boneIx[(b.set ? `${b.set}:` : '') + b.name] = this.bones.length;
    this.bones.push(b);
    return this.bones.length - 1;
  }

  /** The weapon as a polyline of knots (butt, grips, mid, tip); each segment is a bone. */
  buildWeapon() {
    const J = this.J;
    this.wk = null;
    if (!J.wButt || !J.wTip) return;
    const mid = J.wMid || [(J.wButt[0] + J.wTip[0]) / 2, (J.wButt[1] + J.wTip[1]) / 2];
    const poly = [J.wButt, mid, J.wTip];
    const arc = [0, dist(poly[0], poly[1]), 0];
    arc[2] = arc[1] + dist(poly[1], poly[2]);
    // project a point on the polyline: arc length
    const proj = (p) => {
      let best = { d: Infinity, s: 0 };
      for (let i = 0; i < 2; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const u = l2 < 1e-9 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
        const q = [a[0] + u * dx, a[1] + u * dy];
        const d = dist(p, q);
        if (d < best.d) best = { d, s: arc[i] + u * (arc[i + 1] - arc[i]), q };
      }
      return best;
    };
    const at = (s) => {
      if (s <= arc[1]) return lerp2(poly[0], poly[1], s / (arc[1] || 1));
      return lerp2(poly[1], poly[2], (s - arc[1]) / (arc[2] - arc[1] || 1));
    };
    const knots = [
      { s: 0, roles: ['butt'] },
      { s: arc[1], roles: ['mid'] },
      { s: arc[2], roles: ['tip'] },
    ];
    for (const side of ['N', 'F']) {
      if (!this.grips[side] || !J[`hd${side}`]) continue;
      const s = proj(J[`hd${side}`]).s;
      const near = knots.find((k) => Math.abs(k.s - s) < 3);
      if (near) near.roles.push(`g${side}`);
      else knots.push({ s, roles: [`g${side}`] });
    }
    knots.sort((a, b) => a.s - b.s);
    for (const k of knots) k.p = at(k.s);
    const rigidA = (this.spec.weapon?.rigid || 'A') === 'A';
    const smax = this.spec.weapon?.stretch ?? 1.4;
    const imid = knots.findIndex((k) => k.roles.includes('mid'));
    this.wk = { knots, imid, ix: [] };
    for (let i = 0; i < knots.length - 1; i++) {
      const rigid = rigidA ? i < imid : i >= imid;
      const ix = this.addBone({
        name: `wk${i}`,
        ra: knots[i].p,
        rb: knots[i + 1].p,
        min: rigid ? 0.97 : 0.8,
        max: rigid ? 1.03 : smax,
        rigid,
        weapon: true,
      });
      this.wk.ix.push(ix);
    }
    this.wk.ref = angle(knots[knots.length - 2].p, knots[knots.length - 1].p);
  }

  // ------------------------------------------------------------------ parts

  buildParts(P) {
    const { w, h } = this;
    const alpha = this.layer.st.alpha;
    const regions = (this.spec.regions || []).map((r) => ({
      name: r.name,
      z: r.z ?? 3,
      bones: r.bones || null,
      lag: r.lag || null,
      poly: (r.poly || []).map(P),
      // capsules [x0, y0, x1, y1, r] (r is a share of the image width): thick strokes
      caps: (r.caps || []).map(([x0, y0, x1, y1, rr]) => [P([x0, y0]), P([x1, y1]), rr * w]),
    }));
    // the default part: whatever no region claims
    regions.unshift({ name: 'body', z: this.spec.bodyZ ?? 3, bones: ['torso', 'head'], poly: null });
    const label = new Int16Array(w * h).fill(0);
    for (let i = 1; i < regions.length; i++) {
      const m = new Uint8Array(w * h);
      if (regions[i].poly.length > 2) fillPoly(m, w, h, regions[i].poly, 1);
      for (const [a, b, rr] of regions[i].caps) fillPoly(m, w, h, capsule(a, b, rr), 1);
      for (let j = 0; j < w * h; j++) if (m[j]) label[j] = i;
    }
    this.label = label;
    this.parts = [];
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const core = new Uint8Array(w * h);
      let n = 0;
      for (let j = 0; j < w * h; j++)
        if (label[j] === i && alpha[j]) {
          core[j] = 1;
          n++;
        }
      if (!n) continue;
      const accept = dilate(core, alpha, w, h, this.pad);
      const cands = this.expand(r.bones);
      const part = { name: r.name, z: r.z, accept, cands, lag: r.lag, n };
      this.meshPart(part);
      this.parts.push(part);
    }
    this.parts.sort((a, b) => a.z - b.z);
    this.lags = this.spec.lags || {};
  }

  /** Bone names (or groups) -> bone indices. Unlisted: every body bone. */
  expand(names) {
    const out = [];
    const all = this.bones.filter((b) => !b.weapon && !b.set).map((b) => b.name);
    for (const n of names || all) {
      if (n === 'weapon') for (const ix of this.wk?.ix || []) out.push(ix);
      else if (GROUPS[n]) for (const g of GROUPS[n]) this.boneIx[g] !== undefined && out.push(this.boneIx[g]);
      else if (this.boneIx[n] !== undefined) out.push(this.boneIx[n]);
    }
    return out;
  }

  /** A grid mesh over the part's accepted pixels, weights bound at the vertices. */
  meshPart(part) {
    const { w, h, step } = this;
    const acc = part.accept;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (acc[y * w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    const nx = Math.ceil((x1 - x0 + 1) / step);
    const ny = Math.ceil((y1 - y0 + 1) / step);
    const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
    const pos = [];
    const tris = [];
    const vert = (i, j) => {
      const k = j * (nx + 1) + i;
      if (vid[k] < 0) {
        vid[k] = pos.length / 2;
        pos.push(x0 + i * step, y0 + j * step);
      }
      return vid[k];
    };
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let any = false;
        for (let y = y0 + j * step; y < Math.min(h, y0 + (j + 1) * step) && !any; y++)
          for (let x = x0 + i * step; x < Math.min(w, x0 + (i + 1) * step); x++)
            if (acc[y * w + x]) {
              any = true;
              break;
            }
        if (!any) continue;
        const a = vert(i, j);
        const b = vert(i + 1, j);
        const c = vert(i + 1, j + 1);
        const d = vert(i, j + 1);
        tris.push(a, b, c, a, c, d);
      }
    part.rest = new Float32Array(pos);
    part.tris = new Int32Array(tris);
    const nv = pos.length / 2;
    part.bi = new Int16Array(nv * 4).fill(-1);
    part.bw = new Float32Array(nv * 4);
    const lag = part.lag;
    const lo = lag ? lag.from.map((v, k) => (k ? v * h : this.flip ? (1 - v) * w : v * w)) : null;
    const hi = lag ? lag.to.map((v, k) => (k ? v * h : this.flip ? (1 - v) * w : v * w)) : null;
    const tau = this.tau;
    for (let v = 0; v < nv; v++) {
      const px = pos[v * 2];
      const py = pos[v * 2 + 1];
      const cs = part.cands;
      let dmin = Infinity;
      const ds = new Float32Array(cs.length);
      for (let k = 0; k < cs.length; k++) {
        const b = this.bones[cs[k]];
        ds[k] = segDist(px, py, b.ra, b.rb);
        if (ds[k] < dmin) dmin = ds[k];
      }
      let ws = [];
      let sum = 0;
      for (let k = 0; k < cs.length; k++) {
        const e = (ds[k] - dmin) / tau;
        const wv = Math.exp(-e * e);
        ws.push([cs[k], wv]);
        sum += wv;
      }
      ws = ws.map(([b, wv]) => [b, wv / sum]).filter(([, wv]) => wv > 0.02);
      if (lag) {
        // the fraction f of each weight moves to the lag copy of its bone (cloth, hair)
        const dx = hi[0] - lo[0];
        const dy = hi[1] - lo[1];
        const f = smooth01(((px - lo[0]) * dx + (py - lo[1]) * dy) / (dx * dx + dy * dy || 1));
        const out = [];
        for (const [b, wv] of ws) {
          if (1 - f > 0.01) out.push([b, wv * (1 - f)]);
          if (f > 0.01) out.push([this.lagBone(b, lag.set), wv * f]);
        }
        ws = out;
      }
      ws.sort((a, b) => b[1] - a[1]);
      ws = ws.slice(0, 4);
      let s2 = 0;
      for (const [, wv] of ws) s2 += wv;
      ws.forEach(([b, wv], k) => {
        part.bi[v * 4 + k] = b;
        part.bw[v * 4 + k] = wv / s2;
      });
    }
  }

  /** The lag copy of bone index `b` in set `set` (created on first use). */
  lagBone(b, set) {
    const base = this.bones[b];
    const key = `${set}:${base.name}`;
    if (this.boneIx[key] !== undefined) return this.boneIx[key];
    return this.addBone({ ...base, set, base: b });
  }

  // ------------------------------------------------------- calibration and reference

  /**
   * Pixels per metre: the art's bone lengths against the blocking's (median of trunk, thigh
   * and shin ratios), so the retargeted skeleton has the art's proportions at the art's size.
   */
  calibrate(sk) {
    this.ppm = ppmFrom(this.J, sk);
    return this.ppm;
  }

  /** The blocking skeleton in layer px around the art's hips. */
  bpts(sk) {
    const H = this.J.hips;
    const P = this.ppm;
    const hx = sk.hips[0];
    const hy = sk.hips[1];
    const L = (p) => [H[0] + (p[0] - hx) * P, H[1] - (p[1] - hy) * P];
    const legN = sk.legs[this.swap ? 'F' : 'N'];
    const legF = sk.legs[this.swap ? 'N' : 'F'];
    const w = sk.weapon;
    return {
      hips: L(sk.hips),
      spine: L(sk.spine),
      neck: L(sk.neck),
      head: L(sk.head),
      sh: L(sk.shoulder),
      elN: L(sk.arms.N.elbow),
      hdN: L(sk.arms.N.hand),
      elF: L(sk.arms.F.elbow),
      hdF: L(sk.arms.F.hand),
      knN: L(legN.knee),
      anN: L(legN.foot),
      toN: L(legN.toe),
      knF: L(legF.knee),
      anF: L(legF.foot),
      toF: L(legF.toe),
      butt: L(w.butt),
      tip: L(w.tip),
      rear: L(w.rear),
      lead: w.lead ? L(w.lead) : null,
      wdir: Math.atan2(-w.dir[1], w.dir[0]),
    };
  }

  /**
   * Optional: make torso and head follow the blocking as changes from the skeleton `sk` this
   * art depicts (delta mode), instead of by its absolute angles. Off by default: a bad
   * reference bends the whole trunk (the fit picks whichever time suits the legs).
   */
  setRef(sk, delta = false) {
    if (!this.ppm) this.calibrate(sk);
    this.ref = sk;
    if (!delta) {
      this.bias = { torsoLow: 0, torsoUp: 0, head: 0 };
      return;
    }
    const B = this.bpts(sk);
    const J = this.J;
    this.bias = {
      torsoLow: angle(J.hips, J.spine) - angle(B.hips, B.spine),
      torsoUp: angle(J.spine, J.neck) - angle(B.spine, B.neck),
      head: angle(J.neck, J.head) - angle(B.neck, B.head),
    };
  }

  /** Distance between this art's own pose and a skeleton (for choosing a key pose). */
  distance(sk) {
    if (!this.ppm) this.calibrate(sk);
    const B = this.bpts(sk);
    const J = this.J;
    let d = 0;
    const term = (w, a, b) => {
      d += w * angDiff(a, b) ** 2;
    };
    term(DIST_W.torsoLow, angle(J.hips, J.spine), angle(B.hips, B.spine));
    term(DIST_W.torsoUp, angle(J.spine, J.neck), angle(B.spine, B.neck));
    term(DIST_W.head, angle(J.neck, J.head), angle(B.neck, B.head));
    for (const s of ['N', 'F']) {
      term(DIST_W[`thigh${s}`], angle(J.hips, J[`kn${s}`]), angle(B.hips, B[`kn${s}`]));
      term(DIST_W[`shin${s}`], angle(J[`kn${s}`], J[`an${s}`]), angle(B[`kn${s}`], B[`an${s}`]));
    }
    // arms: art shoulder -> elbow / wrist against the blocking's shoulder -> elbow / hand
    for (const s of ['N', 'F']) {
      if (this.armVisible(s)) {
        term(DIST_W[`uarm${s}`], angle(J[`sh${s}`], J[`el${s}`]), angle(B.sh, B[`el${s}`]));
        term(DIST_W[`farm${s}`], angle(J[`el${s}`], J[`wr${s}`]), angle(B[`el${s}`], B[`hd${s}`]));
      }
    }
    if (this.wk) {
      const k = this.wk.knots;
      term(DIST_W.weapon, angle(k[0].p, k[k.length - 1].p), B.wdir);
    }
    return d;
  }

  armVisible(s) {
    const p = this.parts.find((q) => q.name === `arm${s}`);
    return !p || p.n > 200;
  }

  /** Pick the reference time and leg mapping that make the art's rest pose fit best. */
  fitRef(skAt, t0, t1, dt = 0.05) {
    let best = { d: Infinity };
    for (const swap of [false, true]) {
      this.swap = swap;
      for (let t = t0; t <= t1 + 1e-9; t += dt) {
        const sk = skAt(t);
        if (!this.ppm) this.calibrate(sk);
        const d = this.distance(sk);
        if (d < best.d) best = { d, t, swap };
      }
    }
    this.swap = best.swap;
    this.setRef(skAt(best.t));
    this.refT = best.t;
    return best;
  }

  // ---------------------------------------------------------------- retargeting

  /**
   * The target skeleton for blocking skeleton `sk`: for every bone, where its two ends go
   * (layer px, around the art's hips). Torso and head take the blocking's angles (as changes
   * from `ref`) with the art's own lengths; feet and hands go where the blocking puts them
   * (two-bone IK with the art's lengths, each stretching up to 10%); the weapon is laid
   * along the blocking's line with grips at the hands and the shaft stretched to the reach.
   */
  solve(sk) {
    if (!this.ppm) this.calibrate(sk);
    const B = this.bpts(sk);
    const J = this.J;
    const bn = (n) => this.bones[this.boneIx[n]];
    const T = new Array(this.bones.length);
    const hips = J.hips;
    // trunk chain
    const tl = bn('torsoLow');
    const tu = bn('torsoUp');
    const hd = bn('head');
    const a1 = angle(B.hips, B.spine) + this.bias.torsoLow;
    const spine = polar(hips, a1, tl.len);
    const a2 = angle(B.spine, B.neck) + this.bias.torsoUp;
    const neck = polar(spine, a2, tu.len);
    const a3 = angle(B.neck, B.head) + this.bias.head;
    const head = polar(neck, a3, hd.len);
    T[this.boneIx.torsoLow] = [hips, spine];
    T[this.boneIx.torsoUp] = [spine, neck];
    T[this.boneIx.head] = [neck, head];
    // shoulders ride on the upper torso
    const mu = boneMatrix(tu.ra, tu.rb, spine, neck, new Float32Array(6));
    const map = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];
    const sh = { N: map(mu, J.shN), F: map(mu, J.shF) };

    // the weapon first: the hands that hold it follow its grips
    const wt = this.layoutWeapon(B);
    // a free hand goes where the blocking puts it relative to the shoulder (the blocking has one
    // shoulder point; the art, seen three-quarters, has two)
    const hand = {
      N: [sh.N[0] + B.hdN[0] - B.sh[0], sh.N[1] + B.hdN[1] - B.sh[1]],
      F: [sh.F[0] + B.hdF[0] - B.sh[0], sh.F[1] + B.hdF[1] - B.sh[1]],
    };
    const wAng = { N: null, F: null };
    if (wt) {
      for (const s of ['N', 'F']) {
        const gi = wt.knots.findIndex((k) => k.roles.includes(`g${s}`));
        if (gi >= 0 && this.grips[s] && (s === 'N' || B.lead)) {
          hand[s] = wt.pos[gi];
          const seg = Math.min(gi, wt.pos.length - 2);
          const sb = this.bones[this.wk.ix[seg]];
          const th = wt.dir[seg];
          wAng[s] = th + (angle(J[`wr${s}`], J[`hd${s}`]) - sb.ang);
        }
      }
    }
    // arms: shoulder -> elbow -> wrist by IK, then the hand bone
    for (const s of ['N', 'F']) {
      const u = bn(`uarm${s}`);
      const f = bn(`farm${s}`);
      const h = bn(`hand${s}`);
      const S = sh[s];
      const H = hand[s];
      const hb = s === 'N' ? B.hdN : B.hdF;
      const eb = s === 'N' ? B.elN : B.elF;
      const ub = [hb[0] - B.sh[0], hb[1] - B.sh[1]];
      const side = Math.sign(ub[0] * (eb[1] - B.sh[1]) - ub[1] * (eb[0] - B.sh[0])) || 1;
      let wrist;
      let el;
      let fa = angle(S, H);
      let stretch = 1;
      for (let pass = 0; pass < 2; pass++) {
        const ha = wAng[s] !== null ? wAng[s] : fa + (h.ang - f.ang);
        wrist = polar(H, ha + Math.PI, h.len);
        const r = ik2(S, wrist, u.len, f.len, side);
        el = r.joint;
        wrist = r.end;
        stretch = r.stretch;
        fa = angle(el, wrist);
      }
      const ha = wAng[s] !== null ? wAng[s] : fa + (h.ang - f.ang);
      T[this.boneIx[`uarm${s}`]] = [S, el];
      T[this.boneIx[`farm${s}`]] = [el, wrist];
      // the hand keeps its length; it is drawn where the wrist ended up
      T[this.boneIx[`hand${s}`]] = [wrist, polar(wrist, ha, h.len)];
    }
    // legs: hips -> knee -> ankle by IK; the sole goes where the blocking's toe is
    for (const s of ['N', 'F']) {
      const th = bn(`thigh${s}`);
      const sn = bn(`shin${s}`);
      const ft = bn(`foot${s}`);
      const an = B[`an${s}`];
      const to = B[`to${s}`];
      const kn = B[`kn${s}`];
      // the art's ankle-to-toe drop against the blocking's: keep the sole on the same ground
      const drop = ft.rb[1] - ft.ra[1];
      const target = [an[0], to[1] - drop];
      const ub = [target[0] - B.hips[0], target[1] - B.hips[1]];
      const side = Math.sign(ub[0] * (kn[1] - B.hips[1]) - ub[1] * (kn[0] - B.hips[0])) || 1;
      const r = ik2(hips, target, th.len, sn.len, side);
      T[this.boneIx[`thigh${s}`]] = [hips, r.joint];
      T[this.boneIx[`shin${s}`]] = [r.joint, r.end];
      T[this.boneIx[`foot${s}`]] = [r.end, [r.end[0] + (ft.rb[0] - ft.ra[0]), r.end[1] + drop]];
    }
    if (wt)
      for (let i = 0; i < this.wk.ix.length; i++)
        T[this.wk.ix[i]] = [wt.pos[i], wt.pos[i + 1]];
    return { T, B, joints: this.jointsOf(T) };
  }

  jointsOf(T) {
    const o = {};
    for (const [name, a, b] of CHAIN) {
      const ix = this.boneIx[name];
      if (ix === undefined) continue;
      o[a] = T[ix][0];
      o[b] = T[ix][1];
    }
    if (this.wk) {
      const k = this.wk.knots;
      for (let i = 0; i < k.length; i++) {
        const pt = i < this.wk.ix.length ? T[this.wk.ix[i]][0] : T[this.wk.ix[i - 1]][1];
        for (const r of k[i].roles) o[`w:${r}`] = pt;
      }
    }
    return o;
  }

  /** Lay the weapon's knots along the blocking's line: grips pinned to the hands. */
  layoutWeapon(B) {
    if (!this.wk) return null;
    const { knots, imid, ix } = this.wk;
    const m = knots.length;
    const dirMain = B.wdir;
    const dm = [Math.cos(dirMain), Math.sin(dirMain)];
    const segs = ix.map((i) => this.bones[i]);
    const dir = segs.map((sg) => dirMain + (sg.ang - this.wk.ref));
    // pins: knot index -> target point
    const pins = new Map();
    pins.set(m - 1, B.tip);
    pins.set(0, B.butt);
    const iN = knots.findIndex((k) => k.roles.includes('gN'));
    const iF = knots.findIndex((k) => k.roles.includes('gF'));
    if (iN >= 0) pins.set(iN, B.rear);
    if (iF >= 0 && B.lead) pins.set(iF, B.lead);
    // a spear's head is rigid at the tip: the tip pin belongs to the far end of the shaft
    const anchor = iN >= 0 ? iN : iF >= 0 && B.lead ? iF : imid;
    const pos = new Array(m);
    pos[anchor] = pins.get(anchor) || B.rear;
    // forward
    let i = anchor;
    while (i < m - 1) {
      let j = i + 1;
      while (!pins.has(j) && j < m - 1) j++;
      let R = 0;
      let S = 0;
      for (let s = i; s < j; s++) segs[s].rigid ? (R += segs[s].len) : (S += segs[s].len);
      const D = (pins.get(j)[0] - pos[i][0]) * dm[0] + (pins.get(j)[1] - pos[i][1]) * dm[1];
      const lo = Math.min(...segs.slice(i, j).map((q) => q.min));
      const hi = Math.max(...segs.slice(i, j).map((q) => q.max));
      const k = S > 0 ? clamp((D - R) / S, lo, hi) : 1;
      for (let s = i; s < j; s++)
        pos[s + 1] = polar(pos[s], dir[s], segs[s].len * (segs[s].rigid ? 1 : k));
      i = j;
    }
    // backward
    i = anchor;
    while (i > 0) {
      let j = i - 1;
      while (!pins.has(j) && j > 0) j--;
      let R = 0;
      let S = 0;
      for (let s = j; s < i; s++) segs[s].rigid ? (R += segs[s].len) : (S += segs[s].len);
      const D = (pos[i][0] - pins.get(j)[0]) * dm[0] + (pos[i][1] - pins.get(j)[1]) * dm[1];
      const lo = Math.min(...segs.slice(j, i).map((q) => q.min));
      const hi = Math.max(...segs.slice(j, i).map((q) => q.max));
      const k = S > 0 ? clamp((D - R) / S, lo, hi) : 1;
      for (let s = i - 1; s >= j; s--)
        pos[s] = polar(pos[s + 1], dir[s] + Math.PI, segs[s].len * (segs[s].rigid ? 1 : k));
      i = j;
    }
    return { pos, dir, knots };
  }

  /** The rest pose as a pose: every bone where it is painted (baking it must reproduce the painting). */
  restPose() {
    const T = this.bones.map((b) => [b.ra, b.rb]);
    const lags = {};
    for (const name of Object.keys(this.lags)) lags[name] = { T, off: [0, 0] };
    return { T, lags, joints: this.J };
  }

  /**
   * The pose for time t: the target skeleton, plus (for cloth and hair) the target a moment
   * earlier, each lag set with its own delay and its drag (a share of the body's own travel).
   * skAt(t) is the blocking's skeleton at time t.
   */
  pose(skAt, t) {
    const sk = skAt(t);
    const main = this.solve(sk);
    const lags = {};
    for (const [name, o] of Object.entries(this.lags)) {
      const skl = skAt(t - o.sec);
      const s = this.solve(skl);
      const drag = o.drag ?? 0.5;
      const off = [
        (skl.hips[0] - sk.hips[0]) * this.ppm * drag,
        -(skl.hips[1] - sk.hips[1]) * this.ppm * drag,
      ];
      lags[name] = { T: s.T, off };
    }
    return { sk, T: main.T, B: main.B, joints: main.joints, lags };
  }

  // ------------------------------------------------------------------ rendering

  ensure(n) {
    if (n <= this.cap) return;
    this.cap = n;
    this.src = new Int32Array(n);
    const st = this.layer.st;
    this.proxy = {
      st: {
        w: 0,
        h: 0,
        wash: new Uint8ClampedArray(n * 4),
        alpha: new Uint8Array(n),
        line: new Float32Array(n),
        pencil: new Float32Array(n),
        figure: st.figure,
        tint: st.tint,
      },
      mask: new Float32Array(n),
      x: 0,
      y: 0,
      tintRGB: this.layer.tintRGB,
      skin: this.layer.skin,
    };
  }

  /**
   * Deform the mesh to `pose` and rasterise it back into the painting. Returns
   * { layer, ax, ay }: a proxy layer holding the deformed drawing; draw it with
   * xf = { x, y, ax, ay, scale } where (x, y) is where the hips go.
   */
  bake(pose) {
    const nb = this.bones.length;
    const M = this.mats;
    for (let i = 0; i < nb; i++) {
      const b = this.bones[i];
      let tgt;
      let off = null;
      if (b.set) {
        const l = pose.lags[b.set];
        tgt = l.T[b.base];
        off = l.off;
      } else tgt = pose.T[i];
      const ta = off ? [tgt[0][0] + off[0], tgt[0][1] + off[1]] : tgt[0];
      const tb = off ? [tgt[1][0] + off[0], tgt[1][1] + off[1]] : tgt[1];
      const m = boneMatrix(b.ra, b.rb, ta, tb, new Float32Array(6));
      for (let k = 0; k < 6; k++) M[i * 6 + k] = m[k];
    }
    // deform every part's vertices
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const part of this.parts) {
      const nv = part.rest.length / 2;
      if (!part.def || part.def.length !== nv * 2) part.def = new Float32Array(nv * 2);
      for (let v = 0; v < nv; v++) {
        const px = part.rest[v * 2];
        const py = part.rest[v * 2 + 1];
        let dx = 0;
        let dy = 0;
        for (let k = 0; k < 4; k++) {
          const b = part.bi[v * 4 + k];
          if (b < 0) break;
          const wv = part.bw[v * 4 + k];
          const o = b * 6;
          dx += wv * (M[o] * px + M[o + 1] * py + M[o + 4]);
          dy += wv * (M[o + 2] * px + M[o + 3] * py + M[o + 5]);
        }
        part.def[v * 2] = dx;
        part.def[v * 2 + 1] = dy;
        if (dx < x0) x0 = dx;
        if (dx > x1) x1 = dx;
        if (dy < y0) y0 = dy;
        if (dy > y1) y1 = dy;
      }
    }
    const ox = Math.floor(x0) - 2;
    const oy = Math.floor(y0) - 2;
    const bw = Math.ceil(x1) - ox + 3;
    const bh = Math.ceil(y1) - oy + 3;
    this.ensure(bw * bh);
    const out = this.src;
    out.fill(-1, 0, bw * bh);
    const { w, h } = this;
    const alpha = this.layer.st.alpha;
    const eps = 0.03;
    for (const part of this.parts) {
      const D = part.def;
      const R = part.rest;
      const tr = part.tris;
      const acc = part.accept;
      for (let t = 0; t < tr.length; t += 3) {
        const i0 = tr[t];
        const i1 = tr[t + 1];
        const i2 = tr[t + 2];
        const ax = D[i0 * 2] - ox;
        const ay = D[i0 * 2 + 1] - oy;
        const bx = D[i1 * 2] - ox;
        const by = D[i1 * 2 + 1] - oy;
        const cx = D[i2 * 2] - ox;
        const cy = D[i2 * 2 + 1] - oy;
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(det) < 1e-6) continue;
        const inv = 1 / det;
        const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const maxx = Math.min(bw - 1, Math.ceil(Math.max(ax, bx, cx)));
        const miny = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const maxy = Math.min(bh - 1, Math.ceil(Math.max(ay, by, cy)));
        const ru0 = R[i0 * 2];
        const rv0 = R[i0 * 2 + 1];
        const ru1 = R[i1 * 2];
        const rv1 = R[i1 * 2 + 1];
        const ru2 = R[i2 * 2];
        const rv2 = R[i2 * 2 + 1];
        for (let y = miny; y <= maxy; y++) {
          const py = y + 0.5;
          for (let x = minx; x <= maxx; x++) {
            const px = x + 0.5;
            const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * inv;
            const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * inv;
            const l2 = 1 - l0 - l1;
            if (l0 < -eps || l1 < -eps || l2 < -eps) continue;
            const u = l0 * ru0 + l1 * ru1 + l2 * ru2;
            const v = l0 * rv0 + l1 * rv1 + l2 * rv2;
            const iu = u < 0 ? 0 : u >= w ? w - 1 : Math.floor(u);
            const iv = v < 0 ? 0 : v >= h ? h - 1 : Math.floor(v);
            const j = iv * w + iu;
            if (!alpha[j] || !acc[j]) continue;
            out[y * bw + x] = j;
          }
        }
      }
    }
    // bake the painting through the map
    const ps = this.proxy.st;
    ps.w = bw;
    ps.h = bh;
    const src = this.layer.st;
    const sm = this.layer.mask;
    for (let i = 0; i < bw * bh; i++) {
      const j = out[i];
      if (j < 0) {
        ps.alpha[i] = 0;
        continue;
      }
      ps.alpha[i] = 1;
      ps.wash[i * 4] = src.wash[j * 4];
      ps.wash[i * 4 + 1] = src.wash[j * 4 + 1];
      ps.wash[i * 4 + 2] = src.wash[j * 4 + 2];
      ps.wash[i * 4 + 3] = 255;
      ps.line[i] = src.line[j];
      ps.pencil[i] = src.pencil[j];
      this.proxy.mask[i] = sm[j];
    }
    this.proxy.tintRGB = this.layer.tintRGB;
    return {
      layer: this.proxy,
      ax: this.J.hips[0] - ox,
      ay: this.J.hips[1] - oy,
      ox,
      oy,
    };
  }

  /** Screen position of a layer-px point for a figure whose hips are at (hx, hy), drawn at `scale`. */
  screen(p, hx, hy, scale) {
    return [hx + (p[0] - this.J.hips[0]) * scale, hy + (p[1] - this.J.hips[1]) * scale];
  }
}

function lerp2(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

// ------------------------------------------------------------------ several key poses

/**
 * Key poses of one character. `skins` are Skins of the same character (each art at its own
 * scale); per frame the key nearest the skeleton is warped. Switching is a cut between
 * drawings, so drive it with a time on twos (the piece decides).
 */
export class Puppet {
  constructor(skins) {
    this.skins = skins;
  }

  /** The key (Skin) nearest the skeleton, and its distance. */
  pick(sk) {
    let best = null;
    for (const s of this.skins) {
      const d = s.distance(sk);
      if (!best || d < best.d) best = { skin: s, d };
    }
    return best;
  }

  /** One frame: { skin, pose, baked, scale (draw at this * screen px per metre / ppm) }. */
  frame(skAt, t) {
    const sk = skAt(t);
    const { skin } = this.pick(sk);
    const pose = skin.pose(skAt, t);
    return { skin, pose, baked: skin.bake(pose) };
  }
}

/** A line into an RGBA frame (debug overlays). */
export function line(f, W, H, x0, y0, x1, y1, rgb, a = 1) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = (y * W + x) * 4;
    f[o] = f[o] * (1 - a) + rgb[0] * a;
    f[o + 1] = f[o + 1] * (1 - a) + rgb[1] * a;
    f[o + 2] = f[o + 2] * (1 - a) + rgb[2] * a;
    f[o + 3] = 255;
  }
}
