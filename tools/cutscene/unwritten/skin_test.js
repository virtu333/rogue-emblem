// The skin test: can a painted cut-out be bent to follow a solved skeleton, frame by frame?
// (engine/skin.js; annotations in cutouts/rigs.json.) Four parts, 8.7 s:
//
//   0.0  the rest pose: the cut-out and its annotated skeleton, then the same rig baked
//        at its reference pose with the mesh drawn over it
//   1.3  Edric's standing cut-out driven by a synthetic skeleton (a slow arm raise and a
//        step): left, that one drawing alone on ones, to judge tearing; right, the
//        nearest-key puppet on twos
//   3.3  the Warden through the thrust window of ford_blocking (5.4 - 6.9 s at 0.6x):
//        left, the thrust drawing alone; right, the puppet choosing among his drawings
//   5.7  the fight: Edric and the Warden, both driven by skeletonAt through bind, yield,
//        slip and cut (8.0 - 11.2 s), the drawing chosen per frame, on twos
//
// Blocking skeletons are overlaid thin (cyan: the blocking's own; magenta: the art's bones
// after retargeting) where a panel asks for it, so a bend that leaves the skeleton shows.

import { Piece, loadImage } from './engine/piece.js';
import { drawSprite } from './engine/view.js';
import { T, BAR } from './engine/score.js';
import { clamp, lerp } from './engine/raster.js';
import { onTwos, RGB } from './engine/anime.js';
import { Skin, Puppet, line, ik2, specPpm, CHAIN } from './engine/skin.js';
import { skeletonAt, bedY, TIME } from './ford_blocking.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const MUSIC_OFFSET = 44.0; // bar 28, beat 3
export const DURATION = 9.0;
export { BAR };
/** Piece-local time of bar n, beat b. */
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;

const K = '/docs/art-direction/anime-op/cutouts';
const RIGS = `${K}/rigs.json`;
const EDRIC_KEYS = [
  'edric_standing',
  'edric_charge',
  'f_edric_slide_burst_3_rising_cut',
  'f_edric_slip_fall_1_overbalance',
];
const WARDEN_KEYS = [
  'f_warden_poses_4_decide',
  'f_warden_poses_1_guard',
  'f_warden_poses_2_thrust',
  'f_warden_poses_3_recover',
];
const GY = 246; // the ground line on screen
const CYAN = [40, 170, 190];
const MAGENTA = [200, 40, 160];

const ease = (u) => {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
};

// ------------------------------------------------------------------ a synthetic skeleton

/**
 * A standing skeleton in the blocking's format (metres, y up, facing +x), built from a few
 * numbers: for driving one drawing through moves the blocking doesn't make.
 *   o: { x, hipY, lean, head, arm (weapon arm's angle from the shoulder: -pi/2 down, 0 fwd),
 *        wang (weapon angle), footN: [x, lift], footF: [x, lift], free: [x, y] }
 */
export function synth(o) {
  const hips = [o.x, o.hipY];
  const lean = o.lean ?? 0.05;
  const tv = [Math.sin(lean), Math.cos(lean)];
  const nv = [Math.cos(lean), -Math.sin(lean)];
  const neck = [hips[0] + tv[0] * 0.56, hips[1] + tv[1] * 0.56];
  const spine = [hips[0] + tv[0] * 0.28 + nv[0] * 0.02, hips[1] + tv[1] * 0.28 + nv[1] * 0.02];
  const ha = lean + (o.head ?? 0);
  const head = [neck[0] + Math.sin(ha) * 0.19, neck[1] + Math.cos(ha) * 0.19];
  const sh = [neck[0] - tv[0] * 0.05, neck[1] - tv[1] * 0.05];
  const legs = {};
  for (const [nm, ft] of [
    ['N', o.footN],
    ['F', o.footF],
  ]) {
    const foot = [ft[0], 0.07 + ft[1]];
    const a = ik2(hips, foot, 0.44, 0.44, 1);
    const b = ik2(hips, foot, 0.44, 0.44, -1);
    const knee = a.joint[0] > b.joint[0] ? a.joint : b.joint;
    legs[nm] = { knee, foot: a.end, toe: [a.end[0] + 0.19, a.end[1] - 0.05] };
  }
  const phi = o.arm;
  const rear = [sh[0] + 0.52 * Math.cos(phi), sh[1] + 0.52 * Math.sin(phi)];
  const elbowOf = (hand) => {
    const a = ik2(sh, hand, 0.3, 0.29, 1);
    const b = ik2(sh, hand, 0.3, 0.29, -1);
    return a.joint[1] < b.joint[1] ? a.joint : b.joint; // the elbow hangs below
  };
  const free = [sh[0] + (o.free?.[0] ?? 0.05), sh[1] + (o.free?.[1] ?? -0.52)];
  const dir = [Math.cos(o.wang), Math.sin(o.wang)];
  return {
    name: 'synth',
    facing: 1,
    hips,
    spine,
    neck,
    head,
    headR: 0.115,
    shoulder: sh,
    legs,
    arms: {
      N: { elbow: elbowOf(rear), hand: rear },
      F: { elbow: elbowOf(free), hand: free },
    },
    weapon: {
      kind: 'sword',
      butt: [rear[0] - dir[0] * 0.15, rear[1] - dir[1] * 0.15],
      tip: [rear[0] + dir[0], rear[1] + dir[1]],
      rear,
      lead: null,
      dir,
      ang: o.wang,
    },
    over: 0,
  };
}

/** The synthetic move: raise the sword arm slowly, hold, take a step, let it fall. u 0..1. */
function synthMove(u) {
  const raise = ease(u / 0.42);
  const lower = ease((u - 0.86) / 0.14);
  const step = ease((u - 0.58) / 0.26);
  const arm = lerp(-1.5, 0.75, raise) - lower * 1.2;
  const wang = lerp(-2.05, 0.85, raise) - lower * 1.6;
  return synth({
    x: 0.12 * step,
    hipY: 0.9 - 0.03 * Math.sin(Math.PI * step),
    lean: 0.03 + 0.1 * step - 0.06 * raise,
    head: 0.02,
    arm,
    wang,
    footN: [-0.16, 0],
    footF: [0.2 + 0.55 * step, 0.16 * Math.sin(Math.PI * step)],
    free: [0.08 + 0.12 * raise, -0.5],
  });
}

// --------------------------------------------------------------------------- the piece

export class PieceClass extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
    this.skins = new Map();
  }

  async load() {
    const res = await fetch(RIGS);
    this.rigs = (await res.json()).rigs;
    this.names = [...EDRIC_KEYS, ...WARDEN_KEYS].filter((n) => this.rigs[n]);
    const imgs = await Promise.all(this.names.map((n) => loadImage(`${K}/${this.rigs[n].image}`)));
    this.art = Object.fromEntries(this.names.map((n, i) => [n, imgs[i]]));
    const { makePaper } = await import('./engine/compositor.js');
    this.paper = makePaper(this.W, this.H);
    this.build(this.params);
    this.puppets = {};
    if (typeof window !== 'undefined') {
      window.__skin = this; // for the checking scripts
      this.skeletonAt = skeletonAt;
    }
  }

  /**
   * Debug: one frame of `actor` at blocking time tb, one colour per part (which part drew each
   * pixel), with the key the puppet chose. Names the parts in order.
   */
  debugIds(actor, tb, P = 100, forceKey = null) {
    const keys = actor === 'edric' ? EDRIC_KEYS : WARDEN_KEYS;
    const puppet = this.puppet(keys, actor, P);
    const skAt = (x) => skeletonAt(actor, x);
    const skin = forceKey ? this.skin(forceKey, actor, P) : puppet.pick(skAt(tb)).skin;
    skin.trackIds = true;
    const baked = skin.bake(skin.pose(skAt, tb));
    const st = baked.layer.st;
    const S = 4;
    const cv = document.createElement('canvas');
    cv.width = st.w * S;
    cv.height = st.h * S;
    const g = cv.getContext('2d');
    g.fillStyle = '#ccc';
    g.fillRect(0, 0, cv.width, cv.height);
    const n = skin.parts.length;
    for (let i = 0; i < st.w * st.h; i++) {
      const id = skin.ids[i];
      if (id < 0) continue;
      const a = (id / n) * Math.PI * 2;
      g.fillStyle = `rgb(${128 + 110 * Math.cos(a)},${128 + 110 * Math.cos(a - 2.1)},${128 + 110 * Math.cos(a + 2.1)})`;
      g.fillRect((i % st.w) * S, ((i / st.w) | 0) * S, S, S);
    }
    skin.trackIds = false;
    return { url: cv.toDataURL('image/png'), parts: skin.parts.map((p) => p.name), key: skin.name };
  }

  /**
   * Debug: how far one drawing can be bent. Rows of synthetic poses (arm raise, lean, crouch,
   * stride) driving one key alone; returns a PNG data URL at 2x.
   */
  rangeSheet(name, actor = 'edric', P = 100) {
    const skin = this.skin(name, actor, P);
    const cell = [130, 210];
    const rows = [
      [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5].map((a) => ({ arm: a, wang: a - 0.55 })),
      [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((l) => ({ lean: l, hipY: 0.9 - 0.15 * l })),
      [0.9, 0.78, 0.66, 0.54, 0.42, 0.3].map((y) => ({
        hipY: y,
        footF: [0.35, 0],
        footN: [-0.35, 0],
      })),
      [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((d) => ({
        footF: [0.2 + d, 0.1 * Math.min(1, d * 3)],
        footN: [-0.16 - d * 0.5, 0],
      })),
    ];
    const cv = document.createElement('canvas');
    cv.width = cell[0] * 6;
    cv.height = cell[1] * rows.length;
    const g = cv.getContext('2d');
    const img = g.createImageData(cell[0], cell[1]);
    const W0 = this.W;
    const H0 = this.H;
    void W0;
    void H0;
    rows.forEach((row, ri) =>
      row.forEach((o, ci) => {
        const sk = synth({
          x: 0,
          hipY: 0.9,
          lean: 0.05,
          arm: -1.5,
          wang: -2.05,
          footN: [-0.16, 0],
          footF: [0.2, 0],
          ...o,
        });
        // draw into a private frame the size of the cell
        const f = new Uint8ClampedArray(cell[0] * cell[1] * 4);
        for (let i = 0; i < f.length; i += 4) {
          f[i] = 214;
          f[i + 1] = 207;
          f[i + 2] = 196;
          f[i + 3] = 255;
        }
        const pose = skin.pose(() => sk, 0);
        const baked = skin.bake(pose);
        const sc = P / skin.ppm;
        drawSprite(
          f,
          cell[0],
          cell[1],
          f,
          baked.layer,
          0,
          {
            x: cell[0] / 2,
            y: cell[1] - 20 - sk.hips[1] * P,
            ax: baked.ax,
            ay: baked.ay,
            scale: sc,
          },
          { x: cell[0] / 2, y: cell[1] / 2, zoom: 1, rot: 0 },
        );
        for (let x = 0; x < cell[0]; x++) f[((cell[1] - 20) * cell[0] + x) * 4 + 1] = 120;
        img.data.set(f);
        g.putImageData(img, ci * cell[0], ri * cell[1]);
      }),
    );
    const out = document.createElement('canvas');
    out.width = cv.width * 2;
    out.height = cv.height * 2;
    const og = out.getContext('2d');
    og.imageSmoothingEnabled = false;
    og.drawImage(cv, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  /**
   * Debug: the baked layer through drawSprite's options (paint stages, silhouette with rim,
   * dither opacity, ink only), to show the proxy layer behaves like any other. PNG at 3x.
   */
  stagesDemo(name = 'f_warden_poses_2_thrust', actor = 'warden', tb = 6.0, P = 100) {
    const skin = this.skin(name, actor, P);
    const cw = 200;
    const ch = 200;
    const opts = [
      [0, {}],
      [1.5, {}],
      [2.4, {}],
      [0, { silhouette: [40, 30, 60], rim: { dir: [0, -1], w: 1.5, color: [220, 160, 60] } }],
      [0, { opacity: 0.5 }],
      [1, { inkOnly: true }],
    ];
    const cv = document.createElement('canvas');
    cv.width = cw * opts.length;
    cv.height = ch;
    const g = cv.getContext('2d');
    const img = g.createImageData(cw, ch);
    const sk = skeletonAt(actor, tb);
    const baked = skin.bake(skin.pose((x) => skeletonAt(actor, x), tb));
    opts.forEach(([stage, o], i) => {
      const f = new Uint8ClampedArray(cw * ch * 4);
      for (let k = 0; k < f.length; k += 4) {
        f[k] = 214;
        f[k + 1] = 207;
        f[k + 2] = 196;
        f[k + 3] = 255;
      }
      drawSprite(
        f,
        cw,
        ch,
        f.slice(),
        baked.layer,
        stage,
        { x: 130, y: 60 + sk.hips[1] * 0 + 60, ax: baked.ax, ay: baked.ay, scale: P / skin.ppm },
        { x: cw / 2, y: ch / 2, zoom: 1, rot: 0 },
        o,
      );
      img.data.set(f);
      g.putImageData(img, i * cw, 0);
    });
    const out = document.createElement('canvas');
    out.width = cv.width * 3;
    out.height = cv.height * 3;
    const og = out.getContext('2d');
    og.imageSmoothingEnabled = false;
    og.drawImage(cv, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  /** A debug picture of a rig, 2x: 'parts', 'weights', 'rest' (bake of the rest pose), 'plain'. */
  debugPng(name, actor, mode, P = 110) {
    const skin = this.skin(name, actor, P);
    const w = skin.w;
    const h = skin.h;
    const S = 2;
    const f = new Uint8ClampedArray(w * S * h * S * 4);
    const st = skin.layer.st;
    const put = (x, y, r, g, b) => {
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) {
          const o = ((y * S + dy) * w * S + x * S + dx) * 4;
          f[o] = r;
          f[o + 1] = g;
          f[o + 2] = b;
          f[o + 3] = 255;
        }
    };
    for (let i = 0; i < f.length; i += 4) {
      f[i] = 200;
      f[i + 1] = 200;
      f[i + 2] = 200;
      f[i + 3] = 255;
    }
    const hue = (k, n) => {
      const a = (k / n) * Math.PI * 2;
      return [
        128 + 110 * Math.cos(a),
        128 + 110 * Math.cos(a - 2.1),
        128 + 110 * Math.cos(a + 2.1),
      ];
    };
    if (mode === 'parts') {
      skin.parts.forEach((part, k) => {
        const c = hue(k, skin.parts.length);
        for (let j = 0; j < w * h; j++)
          if (part.accept[j] === 1 && st.alpha[j]) put(j % w, (j / w) | 0, c[0], c[1], c[2]);
      });
    } else if (mode === 'weights') {
      // nearest-vertex dominant bone per pixel, by painting each part's triangles
      const nb = skin.bones.length;
      for (const part of skin.parts) {
        const tr = part.tris;
        for (let t = 0; t < tr.length; t += 3) {
          const cx =
            (part.rest[tr[t] * 2] + part.rest[tr[t + 1] * 2] + part.rest[tr[t + 2] * 2]) / 3;
          const cy =
            (part.rest[tr[t] * 2 + 1] +
              part.rest[tr[t + 1] * 2 + 1] +
              part.rest[tr[t + 2] * 2 + 1]) /
            3;
          let col = [0, 0, 0];
          for (let v = 0; v < 3; v++)
            for (let k = 0; k < 4; k++) {
              const b = part.bi[tr[t + v] * 4 + k];
              if (b < 0) break;
              const c = hue(b, nb);
              const wv = part.bw[tr[t + v] * 4 + k] / 3;
              col = [col[0] + c[0] * wv, col[1] + c[1] * wv, col[2] + c[2] * wv];
            }
          const ix = Math.floor(cx);
          const iy = Math.floor(cy);
          // fill the cell around the triangle centre
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const x = ix + dx;
              const y = iy + dy;
              if (x < 0 || y < 0 || x >= w || y >= h) continue;
              const j = y * w + x;
              if (part.accept[j] === 1 && st.alpha[j]) put(x, y, col[0], col[1], col[2]);
            }
        }
      }
    } else if (mode === 'rest') {
      const b = skin.bake(skin.restPose());
      const L = b.layer.st;
      for (let y = 0; y < L.h; y++)
        for (let x = 0; x < L.w; x++) {
          const i = y * L.w + x;
          const X = x + b.ox;
          const Y = y + b.oy;
          if (!L.alpha[i] || X < 0 || Y < 0 || X >= w || Y >= h) continue;
          put(X, Y, L.wash[i * 4], L.wash[i * 4 + 1], L.wash[i * 4 + 2]);
        }
    } else {
      for (let j = 0; j < w * h; j++)
        if (st.alpha[j])
          put(j % w, (j / w) | 0, st.wash[j * 4], st.wash[j * 4 + 1], st.wash[j * 4 + 2]);
    }
    const cv = document.createElement('canvas');
    cv.width = w * S;
    cv.height = h * S;
    cv.getContext('2d').putImageData(new ImageData(f, w * S, h * S), 0, 0);
    const g = cv.getContext('2d');
    g.lineWidth = 2;
    for (const [n] of CHAIN) {
      const b = skin.bones[skin.boneIx[n]];
      g.strokeStyle = n.endsWith('N') ? '#d00' : n.endsWith('F') ? '#00d' : '#080';
      g.beginPath();
      g.moveTo(b.ra[0] * S, b.ra[1] * S);
      g.lineTo(b.rb[0] * S, b.rb[1] * S);
      g.stroke();
    }
    for (const ix of skin.wk?.ix || []) {
      const b = skin.bones[ix];
      g.strokeStyle = '#e80';
      g.beginPath();
      g.moveTo(b.ra[0] * S, b.ra[1] * S);
      g.lineTo(b.rb[0] * S, b.rb[1] * S);
      g.stroke();
    }
    return cv.toDataURL('image/png');
  }

  /** The Skin of rig `name` for a figure facing `facing` (cached), built at about P px/m. */
  skin(name, actor, P) {
    const key = `${name}:${actor}:${P}`;
    if (this.skins.has(key)) return this.skins.get(key);
    const spec = this.rigs[name];
    const face = skeletonAt(actor, 0).facing;
    const flip = spec.facing !== face;
    const ppmNative = specPpm(spec, skeletonAt(actor, 0));
    const h = Math.round((spec.size[1] * P) / ppmNative);
    const layer = this.figure(`${name}:${actor}`, this.art[name], h, { flip, seed: 21, grain: 14 });
    const skin = new Skin(layer, { ...spec, name }, { flip });
    skin.actor = actor;
    skin.fitRef((t) => skeletonAt(actor, t), 0, 13.6, 0.1);
    this.skins.set(key, skin);
    return skin;
  }

  puppet(keys, actor, P) {
    const key = `${actor}:${P}:${keys.join()}`;
    if (!this.puppets[key])
      this.puppets[key] = new Puppet(
        keys.filter((n) => this.rigs[n]).map((n) => this.skin(n, actor, P)),
      );
    return this.puppets[key];
  }

  /**
   * Draw one figure from a skeleton function. p: { P (px/m), cx (screen x of world X0), X0,
   * keys or skin, twos, overlay, stage }.
   */
  actor(f, skAt, t, p) {
    const tt = p.twos ? onTwos(t) : t;
    let skin;
    if (p.skin) skin = p.skin;
    else skin = p.puppet.pick(skAt(tt)).skin;
    const pose = skin.pose(skAt, tt);
    const baked = skin.bake(pose);
    const sk = pose.sk;
    const sc = p.P / skin.ppm;
    const hx = p.cx + (sk.hips[0] - p.X0) * p.P;
    const hy = GY - (sk.hips[1] - p.Y0) * p.P;
    this.draw(
      f,
      baked.layer,
      p.stage ?? 0,
      { x: hx, y: hy, ax: baked.ax, ay: baked.ay, scale: sc },
      null,
      p.opts,
    );
    if (p.overlay) {
      const map = (q) => [p.cx + (q[0] - p.X0) * p.P, GY - (q[1] - p.Y0) * p.P];
      this.stick(f, sk, map, CYAN);
      for (const [name, a, b] of CHAIN) {
        const ix = skin.boneIx[name];
        if (ix === undefined) continue;
        const [pa, pb] = pose.T[ix].map((q) => skin.screen(q, hx, hy, sc));
        line(f, W, H, pa[0], pa[1], pb[0], pb[1], MAGENTA, 0.9);
        void a;
        void b;
      }
      if (skin.wk)
        for (const ix of skin.wk.ix) {
          const [pa, pb] = pose.T[ix].map((q) => skin.screen(q, hx, hy, sc));
          line(f, W, H, pa[0], pa[1], pb[0], pb[1], MAGENTA, 0.9);
        }
    }
    return { skin, pose, hx, hy, sc };
  }

  /** The blocking skeleton as thin lines. */
  stick(f, sk, map, c) {
    const seg = (a, b) => {
      const A = map(a);
      const B = map(b);
      line(f, W, H, A[0], A[1], B[0], B[1], c, 0.8);
    };
    seg(sk.hips, sk.spine);
    seg(sk.spine, sk.neck);
    seg(sk.neck, sk.head);
    for (const s of ['N', 'F']) {
      seg(sk.shoulder, sk.arms[s].elbow);
      seg(sk.arms[s].elbow, sk.arms[s].hand);
      seg(sk.hips, sk.legs[s].knee);
      seg(sk.legs[s].knee, sk.legs[s].foot);
      seg(sk.legs[s].foot, sk.legs[s].toe);
    }
    seg(sk.weapon.butt, sk.weapon.tip);
  }

  ground(f, x0 = 0, x1 = W) {
    line(f, W, H, x0, GY, x1, GY, RGB.graphite, 0.9);
  }

  /** A row of marks along the bottom: which key drawing a puppet is using. */
  keyMarks(f, puppet, active, x, y) {
    puppet.skins.forEach((s, i) => {
      const on = s === active;
      for (let dx = 0; dx < 6; dx++)
        for (let dy = 0; dy < (on ? 6 : 2); dy++) {
          const o = ((y + 6 - (on ? 6 : 2) + dy) * W + x + i * 9 + dx) * 4;
          f[o] = on ? 200 : 120;
          f[o + 1] = on ? 40 : 110;
          f[o + 2] = on ? 40 : 110;
        }
    });
  }

  // ---------------------------------------------------------------------------- shots

  makeShots() {
    const S = [];
    const shot = (name, from, to, draw) => S.push({ name, from, to, draw });

    // 1. the rest pose and the skeleton on it
    shot('rest', 0, 1.2, (f) => {
      this.ground(f);
      const cols = [
        { name: 'edric_standing', actor: 'edric', cx: 100, mode: 'plain', P: 115 },
        { name: 'edric_standing', actor: 'edric', cx: 240, mode: 'baked', P: 115 },
        { name: 'f_warden_poses_4_decide', actor: 'warden', cx: 390, mode: 'plain', P: 88 },
      ];
      for (const c of cols) {
        if (!this.rigs[c.name]) continue;
        const skin = this.skin(c.name, c.actor, c.P);
        const ground = Math.max(skin.J.toN[1], skin.J.toF[1]) + 4;
        const scr = (p) => [c.cx + (p[0] - skin.J.hips[0]), GY + (p[1] - ground)];
        if (c.mode === 'plain') {
          // the untouched cut-out, feet on the ground, with the annotated skeleton over it
          this.draw(
            f,
            skin.layer,
            0,
            { x: c.cx, y: GY, ax: skin.J.hips[0], ay: ground, scale: 1 },
            null,
          );
          this.riglines(f, skin, scr);
        } else {
          // the rig baked at rest (must equal the painting), with its mesh over it
          const baked = skin.bake(skin.restPose());
          this.draw(
            f,
            baked.layer,
            0,
            { x: c.cx, y: GY + skin.J.hips[1] - ground, ax: baked.ax, ay: baked.ay, scale: 1 },
            null,
          );
          const hx = c.cx;
          const hy = GY + skin.J.hips[1] - ground;
          for (const part of skin.parts) {
            const D = part.def;
            const tr = part.tris;
            const m = (i) => [
              hx + D[i * 2] - (baked.ox + baked.ax),
              hy + D[i * 2 + 1] - (baked.oy + baked.ay),
            ];
            for (let i = 0; i < tr.length; i += 12) {
              const a = m(tr[i]);
              const b = m(tr[i + 1]);
              const cc = m(tr[i + 2]);
              line(f, W, H, a[0], a[1], b[0], b[1], [60, 80, 190], 0.5);
              line(f, W, H, b[0], b[1], cc[0], cc[1], [60, 80, 190], 0.5);
            }
          }
        }
      }
    });

    // 2. one drawing driven by a synthetic skeleton: tearing
    shot('synth', 1.2, 3.0, (f, t) => {
      this.ground(f);
      const skAt = (x) => synthMove(clamp((x - 1.2) / 1.8, 0, 1));
      const P = 110;
      const alone = this.skin('edric_standing', 'edric', P);
      const puppet = this.puppet(EDRIC_KEYS, 'edric', P);
      this.actor(f, skAt, t, { skin: alone, P, cx: 130, X0: 0, Y0: 0, overlay: true });
      const r = this.actor(f, skAt, t, { puppet, P, cx: 350, X0: 0, Y0: 0, twos: true });
      this.keyMarks(f, puppet, r.skin, 300, 258);
    });

    // 3. the Warden through the thrust: first the thrust drawing alone (ones), then the puppet (twos)
    shot('thrust', 3.0, 6.2, (f, t) => {
      this.ground(f);
      const alone = t < 4.6;
      const t0 = alone ? 3.0 : 4.6;
      const skAt = (x) => skeletonAt('warden', 5.4 + clamp((x - t0) / 1.6, 0, 1) * 1.5);
      const P = 78;
      const puppet = this.puppet(WARDEN_KEYS, 'warden', P);
      const thrust = this.skin('f_warden_poses_2_thrust', 'warden', P);
      const sk0 = skAt(t);
      const X0 = sk0.hips[0] - 1.6;
      const r = this.actor(f, skAt, t, {
        skin: alone ? thrust : null,
        puppet,
        P,
        cx: 240,
        X0,
        Y0: bedY(sk0.hips[0]),
        twos: !alone,
        overlay: alone,
      });
      if (!alone) this.keyMarks(f, puppet, r.skin, 20, 258);
    });

    // 4. the fight: bind, yield, slip, cut
    shot('fight', 6.2, 9.0, (f, t) => {
      this.ground(f);
      const tb = (x) => TIME.bind + (x - 6.2) * ((TIME.cut - TIME.bind) / 2.8);
      const P = 100;
      const pe = this.puppet(EDRIC_KEYS, 'edric', P);
      const pw = this.puppet(WARDEN_KEYS, 'warden', P);
      const eAt = (x) => skeletonAt('edric', tb(x));
      const wAt = (x) => skeletonAt('warden', tb(x));
      const mid = (eAt(t).hips[0] + wAt(t).hips[0]) / 2;
      const Y0 = bedY(mid);
      this.actor(f, wAt, t, { puppet: pw, P, cx: W / 2, X0: mid, Y0, twos: true });
      const r = this.actor(f, eAt, t, { puppet: pe, P, cx: W / 2, X0: mid, Y0, twos: true });
      this.keyMarks(f, pe, r.skin, 20, 258);
    });
    return S;
  }

  /** The annotated skeleton of a rest pose as lines and dots (scr maps layer px to screen). */
  riglines(f, skin, scr) {
    for (const [name] of CHAIN) {
      const b = skin.bones[skin.boneIx[name]];
      if (!b) continue;
      const a = scr(b.ra);
      const c = scr(b.rb);
      line(
        f,
        W,
        H,
        a[0],
        a[1],
        c[0],
        c[1],
        name.endsWith('N') ? [220, 30, 30] : name.endsWith('F') ? [30, 60, 230] : [20, 150, 20],
        1,
      );
    }
    if (skin.wk)
      for (const ix of skin.wk.ix) {
        const b = skin.bones[ix];
        const a = scr(b.ra);
        const c = scr(b.rb);
        line(f, W, H, a[0], a[1], c[0], c[1], [230, 140, 0], 1);
      }
    for (const p of Object.values(skin.J)) {
      const q = scr(p);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const x = Math.round(q[0]) + dx;
          const y = Math.round(q[1]) + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4;
          f[o] = 255;
          f[o + 1] = 255;
          f[o + 2] = 255;
        }
    }
  }
}

export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
