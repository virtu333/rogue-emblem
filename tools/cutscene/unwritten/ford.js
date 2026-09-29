// "The Ford" (FORD.md): bars 28.3-36 of "Under the Broken Sun", 13.6 s. One complete
// future: Edric crosses a ford under the Hollow Sun, fights the Empire's spearman in the
// river and loses. Sixteen shots, all staged in one procedural world (engine/world.js) from
// one flat-camera plan (ford_blocking.js), so space stays continuous across the cuts.
//
//    1  28.3  the rush down the Thread (the roll); white on the crash
//    2  29.1  extreme wide: crane down from the Hollow Sun to the ford; the sun's
//             reflection breaking in the current; Edric starts to run; the line waits
//    3  30.1  low at the water: the Warden's boots step into the shallows, the line
//             behind stepping in unison
//    4  30.3  medium, frontal: the spear levels at the lens (drawn in code), held
//    5  31.1  tracking profile: Edric runs through the ford, feet locked to the riverbed,
//             a splash on each footfall, reeds and stones passing the lens
//    6  31.4  extreme close-up: Edric's eye; the spear point is in it
//    7  32.1  over the Warden's shoulder: the thrust on the snare, the spear shooting
//             away from us; Edric drops under it
//    8  32.2+ wide, low: the spray sheet erupts, the point withdraws through it
//    9  32.4  three cuts on the fill: spray wall, the helm's eye slit, a shape in the spray
//   10  33.1  the clash on the crash: impact frames, sparks, hit-stop, a shock ring
//   11  33.3  the bind: a slow orbit, sparks grinding on twos, rain; the hold
//   12  34.3  close-up: the helm's eye slit; a tilt; he decides
//   13  35.1  the yield: the Warden steps away, Edric pitches onto the slick stone; the
//             camera whips round and crosses the line (the only time)
//   14  35.3  the crimson cut: negative crimson impact frames, hit-stop
//   15  35.4  close-up: Edric's face; the spray hangs in the air
//   16  36.1  wide, low: he falls onto his back in the river; the splash settles; the
//             Hollow Sun in the water; on the fill the paint lifts off the page
//
// The craft (FORD.md): tame and tsume, hit-stop (figures, particles and rain freeze
// together, then catch up: engine/timing.js), impact frames, smears on fast arcs,
// drawings on twos (threes in the holds), the camera on ones, shake on hits, foreground
// passing the lens, footfalls from the clips' contacts (engine/locomotion.js: no sliding
// feet), shot sizes that never repeat back to back, screen direction held (ours right,
// the Empire left) and crossed once.
//
// World coordinates: X along the crossing (as the blocking), Y up from the water, and the
// world's Z = -(the blocking's z): the world's camera sits downstream (-Z) looking up the
// river at the Hollow Sun, so +X is screen right until the line is crossed.

import { Piece, loadImage } from './engine/piece.js';
import { makePaper } from './engine/compositor.js';
import { KIT, pulse } from './engine/score.js';
import { clamp, hash, lerp, smooth } from './engine/raster.js';
import { layerMatrix, cam as pageCam } from './engine/view.js';
import {
  RGB,
  easeOut,
  flash,
  focusLines,
  glint,
  glow,
  impact,
  put,
  shake,
  sparks,
  speedLines,
  star,
  stroke,
  threadTunnel,
  twos,
} from './engine/anime.js';
import { hollowSun } from './engine/fx.js';
import { hitStop, inStop, keyMove, onN, slowMo } from './engine/timing.js';
import { spear as drawSpear } from './engine/props.js';
import { Stride } from './engine/locomotion.js';
import {
  World,
  crane,
  foregroundRow,
  impulse,
  lookAt,
  nudge,
  orbit,
  project,
} from './engine/world.js';
import { drawSoldier, history, soldierLook } from './engine/figure.js';
import {
  DURATION as BLOCK_DURATION,
  LINE,
  MUSIC_OFFSET as BLOCK_OFFSET,
  TIME,
  actorAt,
  bindPoint,
  groundY as blockGround,
  skeletonAt,
} from './ford_blocking.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const MUSIC_OFFSET = BLOCK_OFFSET; // 44.0 s: bar 28, beat 3
export const DURATION = BLOCK_DURATION; // at(37): 13.6 s
export { BAR } from './engine/score.js';
/** Piece-local time of bar n, beat b. */
export { at } from './ford_blocking.js';

const DIR = '/docs/art-direction/anime-op';
const K = `${DIR}/cutouts`;
const R = `${DIR}/refs`;

// images: every one optional (a missing file falls back; see fig())
const SRC = {
  edricEye: `${R}/b01_edric_eye.webp`,
  helm: `${R}/f_warden_helm.webp`,
  struck: `${R}/f_edric_struck.webp`,
  soldier: `${K}/empire_soldier.webp`,
  standing: `${K}/edric_standing.webp`,
  charge: `${K}/edric_charge.webp`,
  falls: `${K}/edric_falls.webp`,
  wGuard: `${K}/f_warden_poses_1_guard.webp`,
  wThrust: `${K}/f_warden_poses_2_thrust.webp`,
  wRecover: `${K}/f_warden_poses_3_recover.webp`,
  wDecide: `${K}/f_warden_poses_4_decide.webp`,
  wYield: `${K}/f_warden_cut_1_yield.webp`,
  wWind: `${K}/f_warden_cut_2_windup.webp`,
  wCut: `${K}/f_warden_cut_3_cut.webp`,
  eSlide: `${K}/f_edric_slide_burst_1_slide.webp`,
  eRise: `${K}/f_edric_slide_burst_2_rise.webp`,
  eCut: `${K}/f_edric_slide_burst_3_rising_cut.webp`,
  eOver: `${K}/f_edric_slip_fall_1_overbalance.webp`,
  eStruck: `${K}/f_edric_slip_fall_2_struck.webp`,
  eFall: `${K}/f_edric_slip_fall_3_fall.webp`,
};

// generated clips (skipped when absent): the run, and the batch-7 clips when they land
const MOTIONS = [
  'edric_run',
  'march',
  'warden_wade',
  'warden_level',
  'edric_tumble',
  'warden_thrust',
  'warden_yield_cut',
  'edric_slide_burst',
  'edric_slip_fall',
];

/**
 * The cut-outs as figures in the world: which image, metres per source pixel (one scale
 * per generated sheet, measured on the standing heights), the feet anchor in source px
 * (f_sheets.json), the way the drawing faces (+1 right), and an optional crop (source px)
 * that removes a painted weapon so the code can draw it instead.
 */
const CUT = {
  // the Warden (batch 7: the poses sheet and the cut sheet; he is 1.9 m in his helm)
  wGuard: { img: 'wGuard', mpp: 0.00317, anchor: [217.2, 560], face: -1 },
  wThrust: { img: 'wThrust', mpp: 0.00317, anchor: [736.9, 533], face: -1 },
  // the thrust's body, its painted spear cropped off at the hands (the code draws it)
  wThrustBody: {
    img: 'wThrust',
    mpp: 0.00317,
    anchor: [736.9 - 468, 533],
    face: -1,
    crop: { x: 468, y: 0, w: 537, h: 550 },
  },
  wRecover: { img: 'wRecover', mpp: 0.00317, anchor: [334.7, 572], face: -1 },
  wDecide: { img: 'wDecide', mpp: 0.00317, anchor: [130.2, 769], face: -1 },
  wYield: { img: 'wYield', mpp: 0.00226, anchor: [303.5, 872], face: -1 },
  wWind: { img: 'wWind', mpp: 0.00226, anchor: [247.1, 926], face: -1 },
  wCut: { img: 'wCut', mpp: 0.00226, anchor: [292.4, 730], face: -1 },
  // the old stand-in, for the walk into the water (he steps between it and 'decide')
  soldier: { img: 'soldier', mpp: 0.00161, anchor: [232, 1278], face: -1 },
  // Edric (batch 7; 1.78 m)
  eSlide: { img: 'eSlide', mpp: 0.0021, anchor: [401.4, 473], face: 1 },
  eRise: { img: 'eRise', mpp: 0.0021, anchor: [411.2, 699], face: 1 },
  eCut: { img: 'eCut', mpp: 0.0021, anchor: [347, 871], face: 1 },
  eOver: { img: 'eOver', mpp: 0.0023, anchor: [300.5, 637], face: 1 },
  eStruck: { img: 'eStruck', mpp: 0.0023, anchor: [223.6, 676], face: 1 },
  eFall: { img: 'eFall', mpp: 0.0023, anchor: [382.4, 499], face: 1 },
  charge: { img: 'charge', mpp: 0.00135, anchor: [440, 1170], face: 1 },
  standing: { img: 'standing', mpp: 0.00122, anchor: [470, 1460], face: 1 },
};
// what a missing drawing falls back to
const FALLBACK = {
  wGuard: 'soldier',
  wThrust: 'soldier',
  wThrustBody: 'soldier',
  wRecover: 'soldier',
  wDecide: 'soldier',
  wYield: 'soldier',
  wWind: 'soldier',
  wCut: 'soldier',
  eSlide: 'charge',
  eRise: 'charge',
  eCut: 'charge',
  eOver: 'charge',
  eStruck: 'standing',
  eFall: 'standing',
};

/**
 * The batch-7 clips (MiniMax, 12 fps, not stabilised: each figure moves inside a fixed
 * cell, so a cell held at one world point keeps the planted feet planted). mpp: metres
 * per cell px, from each clip's first drawing against the cut-out it was made from.
 * Points in cell px, measured on the atlases.
 */
const CLIP = {
  warden_thrust: { mpp: 0.00595, cell: [582, 300], anchor: [402.7, 295], face: -1 },
  // his own walk and his move into the guard (helm-to-sole 1.9 m standing)
  warden_wade: { mpp: 0.00679, cell: [173, 360], anchor: [103.3, 356], face: -1 },
  warden_level: { mpp: 0.0077, cell: [424, 360], anchor: [337.6, 355], face: -1 },
  warden_yield_cut: { mpp: 0.00809, cell: [332, 300], anchor: [151.6, 278], face: -1 },
  edric_slide_burst: { mpp: 0.00627, cell: [458, 300], anchor: [209.6, 295], face: 1 },
  edric_slip_fall: { mpp: 0.0063, cell: [433, 300], anchor: [343.7, 292], face: 1 },
};
const CPTS = {
  // the Warden's shaft in the bind stance (yield_cut drawings 0-5): point, lower hand end
  shaft: { point: [76, 41], butt: [163, 245] },
  // Edric's blade in the rising cut: as it strikes (drawings 10-11), then held in the
  // bind (12-20: shorter and steeper, pressed against the shaft)
  strike: { hilt: [304, 90], tip: [367, 5] },
  blade: { hilt: [300, 94], tip: [330, 26] },
};

/** A frame schedule [[t, frame], ...] -> the drawing at t (held between keys, floored). */
const frameAt = (keys, t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (t < keys[i][0]) {
      const [t0, f0] = keys[i - 1];
      const [t1, f1] = keys[i];
      return Math.floor(f0 + ((f1 - f0) * (t - t0)) / (t1 - t0));
    }
  return keys[keys.length - 1][1];
};
// the Warden into his guard (shot 4, piece-local shot time): upright, the drop, the settle
const LEVEL = [
  [0, 0],
  [0.12, 0],
  [0.22, 3],
  [0.3, 4],
  [0.72, 14],
];
// Edric: the slide held, the burst on the clash, the rising cut held through the bind
const SLIDE_BURST = [
  [5.97, 0],
  [6.8, 5],
  [6.95, 6],
  [7.2, 10],
  [8.4, 13],
  [10.4, 20],
];
// the Warden: the yield's step on the kick, the wind-up, the cut on the crash, the follow
const YIELD_CUT = [
  [7.0, 0],
  [10.3, 5],
  [10.4, 6],
  [10.62, 10],
  [10.8, 14],
  [10.95, 17],
  [11.1, 25],
  [11.16, 26],
  [11.3, 28],
  [11.7, 33],
  [13.6, 41],
];
// Edric: the overbalance, struck on the crash, falling back
const SLIP_FALL = [
  [10.4, 0],
  [11.12, 4],
  [11.2, 5],
  [11.6, 10],
  [12.0, 14],
  [12.3, 22],
];

const FALL_TIP = 1;
const BIND_LEAN = 1; // which way a positive lean tips a figure toward +X (by eye) // which way the flipped slip clip rotates to lie back (by eye)
const RUN_H = 1.76; // edric_run's cell height in metres (the runner is ~1.68 m in it)

/** Build figures near the size they are seen at (in steps of about a tenth). */
const bucket = (px) => {
  const p = Math.max(10, Math.min(560, px));
  return Math.round(10 * 1.1 ** Math.round(Math.log(p / 10) / Math.log(1.1)));
};
const step = (u, n) => Math.floor(clamp(u) * n) / n; // progress in n stutters
const Zw = (zb) => -zb; // the blocking's z to the world's Z

// hit-stops: the thrust (short), the clash and the cut (long). Everything that acts reads
// its time through these; only the camera keeps the score's clock.
const STOPS = [
  { t: TIME.thrust, hold: 2, catch: 3 },
  { t: TIME.clash, hold: 4, catch: 5 },
  { t: TIME.cut, hold: 4, catch: 4 },
];
const act = (t) => hitStop(t, STOPS);

const HITS = (name, t0, t1) =>
  KIT[name].map((h) => h.t - MUSIC_OFFSET).filter((x) => x >= t0 - 1e-6 && x < t1);

// the shots' edges, on the drums
const S = {
  rush: [0, TIME.run],
  wide: [TIME.run, TIME.water],
  low: [TIME.water, TIME.level],
  level: [TIME.level, TIME.plant],
  track: [TIME.plant, TIME.eye],
  eye: [TIME.eye, TIME.charge],
  ots: [TIME.charge, 6.2],
  spray: [6.2, TIME.sprayEnd],
  wall: [TIME.sprayEnd, 7.0],
  slit: [7.0, 7.1],
  shape: [7.1, TIME.clash],
  clash: [TIME.clash, TIME.bind],
  bind: [TIME.bind, TIME.decide],
  helm: [TIME.decide, TIME.yield],
  yield: [TIME.yield, TIME.cut],
  cut: [TIME.cut, 11.6],
  face: [11.6, TIME.fall],
  fall: [TIME.fall, DURATION],
};

export class FordPiece extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
  }

  async load() {
    // every image optional: a missing one is skipped and its drawings fall back
    const imgs = await Promise.all(
      Object.entries(SRC).map(async ([k, s]) => {
        try {
          return [k, await loadImage(s)];
        } catch {
          return [k, null];
        }
      }),
    );
    this.img = Object.fromEntries(imgs.filter(([, v]) => v));
    this.paper = makePaper(W, H);
    await this.loadMotions(`${DIR}/motion`, MOTIONS);
    // the cut-out rigs (engine/skin.js): paintings bent onto the blocking's skeletons
    try {
      this.rigs = (await (await fetch(`${K}/rigs.json`)).json()).rigs;
    } catch {
      this.rigs = {};
    }
    this.build(this.params);
    // the ford's stones where the blocking has them (the slick one under Edric's foot)
    this.world = new World({ paper: this.paper, W, H });
    this.prepare();
  }

  /** Images cleaned up once for the code: the guard's spear stub is removed. */
  prepare() {
    const g = this.img.wGuard;
    if (g) {
      const c = new OffscreenCanvas(g.width, g.height);
      const x = c.getContext('2d');
      x.drawImage(g, 0, 0);
      // the painted shaft below and ahead of the lead hand: the code draws the spear
      x.globalCompositeOperation = 'destination-out';
      x.beginPath();
      x.moveTo(60, 262);
      x.lineTo(138, 262);
      x.lineTo(138, 298);
      x.lineTo(128, 330);
      x.lineTo(60, 340);
      x.closePath();
      x.fill();
      this.img.wGuard = c;
    }
  }

  // ------------------------------------------------------------------ figures

  /** A cut-out spec (with its fallback when the image is missing). */
  cut(key) {
    let k = key;
    if (!this.img[CUT[k].img] && FALLBACK[k]) k = FALLBACK[k];
    if (!this.img[CUT[k].img]) k = 'soldier';
    const c = CUT[k];
    const im = this.img[c.img];
    const w = c.crop ? c.crop.w : im.width;
    const h = c.crop ? c.crop.h : im.height;
    return { key: k, ...c, im, w, h, height: h * c.mpp };
  }

  /** The figure layer of a cut-out built at px tall. */
  layerOf(c, px, flip) {
    return this.figure(`${c.key}${c.crop ? ':c' : ''}`, c.im, bucket(px), {
      flip,
      crop: c.crop,
    });
  }

  /**
   * A cut-out standing in the world at (X, Z) (world Z), facing `face` (+1 screen right
   * on the uncrossed side). o: { flip (screen), Y, stage, rings, wade, reflect, rot,
   * opts, sy }.
   */
  actor(key, X, Z, face, o = {}) {
    const c = this.cut(key);
    const flip = o.flip ?? c.face !== face;
    let L = null;
    return {
      X,
      Z,
      Y: o.Y,
      height: c.height,
      cut: c,
      flip,
      layerFor: (px) => (L = this.layerOf(c, px, flip)),
      place: (x, y, s) => {
        const k = L.st.h / c.h;
        const ax = flip ? L.st.w - c.anchor[0] * k : c.anchor[0] * k;
        return { x, y, ax, ay: c.anchor[1] * k, scale: s };
      },
      xf: o.rot ? { rot: o.rot } : undefined,
      opts: o.opts,
      stage: o.stage,
      rings: o.rings ?? 0.5,
      wade: o.wade,
      reflect: o.reflect,
      seed: o.seed ?? 1,
    };
  }

  /**
   * A clip drawing standing in the world: the cell's anchor at (X, Z), drawing i. Falls
   * back to a cut-out (key `fb`) when the clip hasn't been made. o as actor().
   */
  clipActor(name, i, X, Z, face, o = {}) {
    const src = this.motionSrc?.[name];
    if (!src) return this.actor(o.fb ?? 'soldier', X, Z, face, o);
    const C = CLIP[name];
    const flip = o.flip ?? C.face !== face;
    const cut = {
      key: name,
      mpp: C.mpp,
      anchor: C.anchor,
      w: C.cell[0],
      h: C.cell[1],
      face: C.face,
    };
    let M = null;
    return {
      X,
      Z,
      Y: o.Y,
      height: C.cell[1] * C.mpp,
      cut,
      flip,
      frame: i,
      layerFor: (px) => {
        M = this.motion(name, bucket(px), { flip });
        return M.layer(i);
      },
      place: (x, y, s) => M.place(x, y, s),
      xf: o.rot ? { rot: o.rot } : undefined,
      opts: o.opts,
      stage: o.stage,
      rings: o.rings ?? 0.5,
      wade: o.wade,
      reflect: o.reflect,
      seed: o.seed ?? 1,
    };
  }

  /**
   * Where a source-px point of a world actor lands, as drawAsActor places it: screen
   * [x, y] and the world point on the actor's card. Must mirror World.drawActor.
   */
  cardPoint(a, cam, u, v) {
    const w = this.world;
    const ground = w.groundY(a.X, a.Z);
    const Y0 = a.Y ?? ground;
    const feet = project(cam, a.X, Y0, a.Z, W, H);
    const head = project(cam, a.X, Y0 + a.height, a.Z, W, H);
    const vx = head.sx - feet.sx;
    const vy = head.sy - feet.sy;
    const pxH = Math.hypot(vx, vy);
    const layer = a.layerFor(pxH);
    const st = layer.st;
    const s = (feet.scale * a.height) / st.h;
    const sy = pxH / (feet.scale * a.height);
    const base = a.place(feet.sx, feet.sy, s);
    const xf = { ...base, ...(a.xf || {}) };
    xf.x = base.x;
    xf.y = base.y;
    xf.scale = s;
    xf.rot = (xf.rot || 0) + Math.atan2(vx, -vy);
    xf.sy = (xf.sy ?? 1) * sy;
    const m = layerMatrix(xf, { x: W / 2, y: H / 2, zoom: 1, rot: 0 }, W, H);
    const k = st.h / a.cut.h;
    const lu = a.flip ? st.w - u * k : u * k;
    const lv = v * k;
    const sx = m[0] * lu + m[1] * lv + m[2];
    const syy = m[3] * lu + m[4] * lv + m[5];
    // the card faces the camera at the feet's depth: offsets along the camera's right/up
    const mpp = a.cut.mpp;
    const du = (a.flip ? -1 : 1) * (u - a.cut.anchor[0]) * mpp;
    const dv = (a.cut.anchor[1] - v) * mpp;
    const yaw = cam.yaw || 0;
    return {
      x: sx,
      y: syy,
      X: a.X + Math.cos(yaw) * du,
      Y: Y0 + dv,
      Z: a.Z - Math.sin(yaw) * du,
      depth: feet.depth,
      scale: feet.scale,
    };
  }

  /** The screen box of an actor (for effects that must sit on it). */
  cardBox(a, cam) {
    const p0 = this.cardPoint(a, cam, 0, 0);
    const p1 = this.cardPoint(a, cam, a.cut.w, a.cut.h);
    return [Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.max(p0.x, p1.x), Math.max(p0.y, p1.y)];
  }

  /**
   * Edric running on the generated clip, locked to the world: from X0 at t0 he travels
   * exactly as far as the planted foot needs (Stride), at the rate that covers `speed`
   * m/s. Returns the actor and the footfalls (world X, time) up to t.
   */
  runner(t, t0, X0, speed, o = {}) {
    const M0 = this.motion('edric_run', 360);
    if (!M0) {
      const X = X0 + speed * (t - t0);
      return { actor: this.actor('charge', X, 0, 1, o), falls: [], X };
    }
    const mPerPx = RUN_H / 360;
    const S0 = this.memo(`stride:${speed.toFixed(3)}`, () => {
      const at1 = new Stride(M0, { rate: 1 }).speed(1) * mPerPx;
      return new Stride(M0, { rate: speed / at1 });
    });
    const u = Math.max(0, t - t0);
    const X = X0 + S0.travel(u) * mPerPx;
    const i = S0.index(u);
    let M = null;
    const actor = {
      X,
      Z: o.Z ?? 0,
      height: RUN_H,
      layerFor: (px) => {
        M = this.motion('edric_run', bucket(px), { flip: !!o.flip });
        return M.layer(i);
      },
      place: (x, y, s) => M.place(x, y, s),
      stage: o.stage,
      rings: 0.9,
      seed: 3,
      opts: o.opts,
    };
    const falls = S0.footfallsIn(Math.max(0, u - 1.2), u + 1e-6).map((f) => ({
      X: X0 + f.world * mPerPx,
      t: t0 + f.u,
    }));
    return { actor, falls, X, stride: S0 };
  }

  /**
   * The Empire's line (and, far off, the Warden) drawn in code from the blocking's
   * skeletons (engine/figure.js), as world actors so they wade, reflect and sort.
   * names: blocking actor names; flip: the crossed side.
   */
  soldiers(t, cam, names, o = {}) {
    const tt = onN(t, 2);
    return names.map((n, i) => {
      const sk = shorten(skeletonAt(n, tt), o.spear ?? 2.3);
      // the blocking files them in a column along the crossing; staged, they stand as a
      // rank abreast on the bank, facing the ford (same steps, in unison)
      const r = o.rank === false ? -1 : LINE.indexOf(n);
      const X = r < 0 ? sk.X : sk.X - 0.43 * r + 0.18 * (r % 2);
      const Z = r < 0 ? Zw(sk.Z ?? 0) : 0.6 + r * 0.95; // receding upstream from the ford
      const skW = { ...sk, Z: 0 };
      const look = soldierLook(o.seedBase ?? 101 + i * 7);
      // the skeleton stands on the blocking's ground; lift it onto the world's
      const lift = this.world.groundY(X, Z) - blockGround(sk.X, sk.Z ?? 0);
      return {
        X,
        Z,
        height: 1.95,
        wade: true,
        rings: 0.35,
        seed: 20 + i,
        stage: o.stage,
        box: null,
        draw: (buf) => {
          const p = project(cam, X, Math.max(0, lift), Z, W, H);
          if (p.depth < 0.5) return;
          const xf = { x: p.sx, y: p.sy, s: p.scale, ax: sk.X, ay: 0, flip: !!o.flip, yaw: 0 };
          const hist = history(
            (q) => ({ ...shorten(skeletonAt(n, q), o.spear ?? 2.3), Z: 0 }),
            tt,
            8,
          );
          // aerial perspective: through the rain even the near rank goes pale
          const haze = clamp(0.25 + (p.depth - 5) / 40) * (o.haze ?? 1);
          drawSoldier(buf, W, H, skW, xf, { look, haze, hist, t: tt, detail: o.detail });
          // the painter writes colour only: mark what it drew for the compositor
          const r = 3.6 * p.scale + 8;
          const x0 = Math.max(0, Math.floor(p.sx - r));
          const x1 = Math.min(W, Math.ceil(p.sx + r));
          const y0 = Math.max(0, Math.floor(p.sy - r * 1.1));
          const y1 = Math.min(H, Math.ceil(p.sy + r * 0.4));
          // and the rain's haze over them (aerial perspective, toward the world's mist)
          const mist = o.mist ?? clamp(0.15 + (p.depth - 4) / 30, 0, 0.6);
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const q = (y * W + x) * 4;
              if (buf[q] === 1 && buf[q + 1] === 0 && buf[q + 2] === 1) continue;
              buf[q + 3] = 255;
              buf[q] += (199 - buf[q]) * mist * 0.85;
              buf[q + 1] += (194 - buf[q + 1]) * mist;
              buf[q + 2] += (192 - buf[q + 2]) * mist;
            }
        },
      };
    });
  }

  // ------------------------------------------------------------------ plates

  plateOf(key, o = {}) {
    const im = this.img[key];
    if (!im) return null;
    // the memo key carries the build options: one image, several builds
    return this.plate(`${key}:${o.zoom ?? 1}:${o.skin ? 's' : ''}${o.tag || ''}`, im, o);
  }

  // ------------------------------------------------------------------ the shots

  makeShots() {
    const L = [];
    const shot = (name, [from, to], draw, enter) => L.push({ name, from, to, draw, enter });
    shot('rush', S.rush, (f, t) => this.shotRush(f, t));
    shot('wide', S.wide, (f, t) => this.shotWide(f, t));
    shot('low', S.low, (f, t) => this.shotLow(f, t));
    shot('level', S.level, (f, t) => this.shotLevel(f, t));
    shot('track', S.track, (f, t) => this.shotTrack(f, t));
    shot('eye', S.eye, (f, t) => this.shotEye(f, t));
    shot('ots', S.ots, (f, t) => this.shotOts(f, t));
    shot('spray', S.spray, (f, t) => this.shotSpray(f, t));
    shot('wall', S.wall, (f, t) => this.shotWall(f, t));
    shot('slit', S.slit, (f, t) => this.shotSlit(f, t));
    shot('shape', S.shape, (f, t) => this.shotShape(f, t));
    shot('clash', S.clash, (f, t) => this.shotClash(f, t));
    shot('bind', S.bind, (f, t) => this.shotBind(f, t));
    shot('helm', S.helm, (f, t) => this.shotHelm(f, t));
    shot('yield', S.yield, (f, t) => this.shotYield(f, t));
    shot('cut', S.cut, (f, t) => this.shotCut(f, t));
    shot('face', S.face, (f, t) => this.shotFace(f, t));
    shot('fall', S.fall, (f, t) => this.shotFall(f, t));
    return L;
  }

  // --- 1 · 28.3: the rush down the Thread (the roll), white on the crash ------------
  shotRush(f, t) {
    const lt = t - S.rush[0];
    const k = lt / (S.rush[1] - S.rush[0]);
    // the page is dark ink here: we are inside the Thread
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      f[o] = 22 + (f[o] - 214) * 0.05;
      f[o + 1] = 19 + (f[o + 1] - 207) * 0.05;
      f[o + 2] = 30 + (f[o + 2] - 196) * 0.05;
    }
    const roll = HITS('roll', 0, S.rush[1]);
    let hi = -1;
    for (let i = 0; i < roll.length; i++) if (roll[i] <= t + 1e-6) hi = i;
    // single-frame inserts on the roll's strokes: this future flickering past
    const INS = ['sun', 'helm', 'ford', 'edricEye', 'sun', 'struck', 'helm', 'ford', 'sun', 'helm'];
    if (hi >= 0 && t - roll[hi] < 1 / 24 - 1e-3) {
      const name = INS[hi % INS.length];
      if (name === 'sun') hollowSun(f, W, H, 240, 135, 60, t, 1);
      else if (name === 'ford') {
        this.world.render(
          f,
          t + 5,
          { x: 1.5, y: 1.4, z: -9, yaw: -0.05, pitch: -0.05, focal: 300 },
          {
            stage: 1,
            rain: 0.5,
          },
        );
      } else {
        const l = this.plateOf(name, { zoom: 1.15, skin: name !== 'helm' });
        if (l) this.draw(f, l, name === 'struck' ? 1 : 0, null, pageCam(240, 135, 1.1));
      }
    }
    focusLines(f, W, H, 240, 135, twos(t), {
      inner: 24,
      count: 150,
      width: 3,
      color: RGB.graphite,
      amount: 0.35 + 0.5 * k,
      aspect: 1.3,
      jitter: 0.9,
    });
    threadTunnel(f, W, H, 240, 135, t, { speed: 1.1 + 3.5 * k * k, amount: 0.55 + 0.45 * k });
    glow(f, W, H, 240, 135, 30 + 70 * k, 0.6 + 0.4 * k);
    flash(f, W, H, smooth(0.6, 0.8, lt) * 0.97);
  }

  // --- 2 · 29.1: extreme wide. Crane down from the Hollow Sun to the ford --------------
  shotWide(f, t) {
    const [t0] = S.wide;
    const lt = t - t0;
    const a = act(t);
    // tame, then tsume: a breath on the sun, the drop through cloud and ridge, the settle
    const k = smooth(0.08, 1.25, lt) ** 0.85;
    const cam0 = crane(
      // settles low on our side of the ford, close enough that Edric reads as a man
      { x: -5.2, z: -19, yaw: 0.1, focal: 300, roll: 0 },
      { y: 30, pitch: 0.5, z: -28 },
      { y: 1.9, pitch: -0.02 },
      k,
    );
    const [sx, sy] = shake(t, [t0], 3, 0.12);
    const cam = nudge(cam0, sx, sy);
    // the page inks itself in, in stutters, out of the white
    const stage = 2 * (1 - step(lt / 0.24, 3));
    const run = this.runner(a, TIME.run, -14, 3.44);
    const actors = [
      run.actor,
      ...this.soldiers(a, cam, ['warden', ...LINE], { mist: 0.22, haze: 0.5 }),
    ];
    this.world.render(f, a, cam, {
      stage,
      rain: 0.5,
      clouds: 0.55,
      actors,
      wind: 1.2,
    });
    if (lt < 2 / 24) flash(f, W, H, 1 - lt * 12);
  }

  // --- 3 · 30.1: low at the water. The Warden's boots step into the shallows ----------
  shotLow(f, t) {
    const [t0] = S.low;
    const lt = t - t0;
    const a = act(t);
    // across the shallows from downstream, low: the column on the bank spreads out
    // behind him instead of stacking up along the lens
    // low at the water, across the shallows from downstream: the column on the bank
    // spreads out behind him instead of stacking up along the lens
    const cam = lookAt(
      { x: lerp(4.75, 4.9, lt / 0.8), y: 0.24, z: -3.15 },
      { x: 8.6, y: 0.72, z: 0.4 },
      { focal: 320, roll: -0.025 },
    );
    // the Warden's walk: two drawings, a contact and a passing position, each step
    // planted where it lands (the support foot holds; the figure moves only between)
    const w = this.wardenWalk(a);
    const actors = [w.actor, ...this.soldiers(a, cam, LINE, { haze: 0.7, mist: 0.24 })];
    const splashes = w.falls.map((s, i) => ({
      X: s.X,
      Z: s.Z,
      t0: s.t,
      strength: 0.6,
      seed: 30 + i,
    }));
    this.world.render(f, a, cam, { rain: 0.6, actors, splashes, wind: 1 });
  }

  /**
   * The Warden wading into the shallows (shot 3): the generated march (the Empire's
   * spearman, in his livery) turned to face left and locked to the riverbed by its
   * measured contacts (Stride), so each planted boot stays where it went in; slowed to a
   * heavy wading pace. Returns the actor and the footfalls (world X, time).
   */
  wardenWalk(a) {
    const T0 = TIME.water - 0.3;
    const X0 = 7.35;
    // his own walk (warden_wade, made from his standing drawing) when it exists; else
    // the generic march, turned to face left
    const own = !!this.motionSrc?.warden_wade;
    const name = own ? 'warden_wade' : 'march';
    const flip = !own;
    const M0 = this.motion(name, 360, { flip });
    if (!M0) {
      return { actor: this.actor('wDecide', X0, 0.1, -1, { rings: 0.9 }), falls: [] };
    }
    const MH = own ? 360 * CLIP.warden_wade.mpp : 2.02; // the cell's height in metres
    const mPerPx = MH / 360;
    const S0 = this.memo(`stride:${name}`, () => new Stride(M0, { rate: own ? 1.5 : 1.35 }));
    const u = Math.max(0, a - T0);
    const X = X0 + S0.travel(u) * mPerPx; // travel is signed: he walks left
    const i = S0.index(u);
    let M = null;
    const actor = {
      X,
      Z: 0.1,
      height: MH,
      layerFor: (px) => {
        M = this.motion(name, bucket(px), { flip });
        return M.layer(i);
      },
      place: (x, y, sc) => M.place(x, y, sc),
      rings: 0.9,
      seed: 1,
    };
    const falls = S0.footfallsIn(0, u + 1e-6).map((q) => ({
      X: X0 + q.world * mPerPx,
      Z: 0.1,
      t: T0 + q.u,
    }));
    return { actor, falls };
  }

  // --- 4 · 30.3: low medium. He levels the spear, and it holds ---------------------
  // Hand-timed on twos: the carried spear held (the anticipation), one swish frame, the
  // painted guard (warden_thrust's first drawing) snapping in with a lean that overshoots
  // and settles, then stillness while the camera creeps down the shaft to the point.
  shotLevel(f, t) {
    const [t0] = S.level;
    const lt = onN(t, 2) - t0; // the figure's time, on twos
    const lc = t - t0; // the camera's, on ones
    const wx = actorAt('warden', TIME.plant).X;
    const own = !!this.motionSrc?.warden_level; // his own move into the guard
    const SNAP = 0.125; // the swish frame (the still drawings' fallback)
    const SET = own ? 0.24 : SNAP + 1 / 24; // the moment the spear is level
    // the camera: low, ahead of him on Edric's side, looking up at the guard
    const punch = lc >= SET ? 0.07 * Math.exp(-(lc - SET) / 0.12) : 0;
    const creep = smooth(SET + 0.12, 0.8, lc);
    // a push in on the guard that ends with the point on the left third, the helm in frame
    const cam = lookAt(
      { x: lerp(wx - 1.75, wx - 1.65, creep), y: 0.6, z: lerp(-2.75, -2.6, creep) },
      { x: lerp(wx - 0.3, wx - 0.36, creep), y: lerp(0.98, 1.04, creep), z: 0 },
      { focal: (330 + 34 * creep) * (1 + punch), roll: 0.03 - 0.02 * creep },
    );
    let wd;
    // his own move into the guard (warden_level): held upright a beat (the anticipation),
    // the spear drops forward into both hands on twos, then the cloth settles
    if (own) {
      const i = frameAt(LEVEL, lt);
      wd = this.clipActor('warden_level', i, wx, 0, -1, { fb: 'wGuard', rings: 0.4 });
    } else if (lt < SNAP) {
      // the carried spear, point up; he settles his weight (a slight sink: anticipation)
      wd = this.actor('wDecide', wx, 0, -1, {
        rings: 0.4,
        Y: this.world.groundY(wx, 0) - 0.02 * smooth(0, SNAP, lt),
      });
    } else {
      // the guard; a lean past the pose and back (overshoot on twos)
      const u = lt - SET;
      const lean = u < 0 ? 0.06 : 0.06 * Math.exp(-u / 0.07) * Math.cos(u * 26);
      wd = this.clipActor('warden_thrust', 0, wx, 0, -1, {
        fb: 'wGuard',
        rings: 0.4,
        rot: lean,
      });
    }
    this.world.render(f, t, cam, { rain: 0.7, actors: [wd], wind: 1 });
    const hasClip = !!this.motionSrc?.warden_thrust;
    // the point and the blade's socket on the drawing in use (cell px)
    const P = own
      ? { tip: [93, 270.5], sock: [133, 259] }
      : { tip: [150, 180.7], sock: [203, 170.8] };
    // the swish: the spear's arc from up to level, drawn as ink ghosts around his hands
    if (!own && lt >= SNAP && lt < SET + 1 / 24 && hasClip) {
      const piv = this.cardPoint(wd, cam, 420, 128);
      const tip = this.cardPoint(wd, cam, 150, 180.7);
      const R = Math.hypot(tip.x - piv.x, tip.y - piv.y);
      const a1 = Math.atan2(tip.y - piv.y, tip.x - piv.x);
      const a0 = a1 + Math.PI / 2; // from straight up (the level point is to his left)
      // three strokes, thick toward the level end (where the spear is fastest)
      const k = lt < SET ? 1 : 0.5;
      for (const [r, w] of [
        [0.42, 1.2],
        [0.54, 2],
        [0.64, 3],
      ]) {
        const n = 14;
        for (let q = 0; q < n; q++) {
          const qa = q / n;
          const qb = (q + 1) / n;
          if (hash(q, r * 10, 23) > k * (0.4 + qa)) continue;
          const xa = piv.x + Math.cos(lerp(a0, a1, qa)) * R * r;
          const ya = piv.y + Math.sin(lerp(a0, a1, qa)) * R * r;
          const xb = piv.x + Math.cos(lerp(a0, a1, qb)) * R * r;
          const yb = piv.y + Math.sin(lerp(a0, a1, qb)) * R * r;
          stroke(f, W, H, xa, ya, xb, yb, w * qa, w * qb, RGB.sepia, 1, 0.3, q);
        }
      }
    }
    if (lt >= SET && (own || hasClip)) {
      const sock = this.cardPoint(wd, cam, ...P.sock);
      const tip = this.cardPoint(wd, cam, ...P.tip);
      // a glint runs out along the blade once he is still, then the point holds a star
      const g = (lc - 0.42) / 0.22;
      if (g > 0 && g < 1.3) glint(f, W, H, sock.x, sock.y, tip.x, tip.y, g, 5, 0.18);
      if (lc > 0.62) star(f, W, H, tip.x, tip.y, 2 + (twos(t) % 2), RGB.paperHi);
      const fk = smooth(SET, SET + 0.2, lc);
      focusLines(f, W, H, tip.x, tip.y, twos(t), {
        inner: 150,
        amount: 0.16 * fk,
        aspect: 1.6,
        width: 2,
        color: RGB.sepia,
      });
    }
  }

  // --- 5 · 31.1: tracking profile. Edric runs through the ford --------------------------
  shotTrack(f, t) {
    const [t0, t1] = S.track;
    const a = act(t);
    const X0 = actorAt('edric', t0).X;
    const X1 = actorAt('edric', t1).X;
    const run = this.runner(a, t0, X0, (X1 - X0) / (t1 - t0));
    // the camera follows the blocking's smooth path (on ones); the runner steps on twos
    const cx = actorAt('edric', t).X + 0.7;
    const cam = { x: cx, y: 0.95, z: -3.7, yaw: 0.01, pitch: -0.035, roll: 0, focal: 330 };
    const fg = this.memo('track:fg', () =>
      foregroundRow({
        z: -2.75,
        x0: -8,
        x1: 6,
        step: 1.3,
        kind: 'mixed',
        h: 0.62,
        stoneH: 0.16,
        gaps: 0.35,
        seed: 5,
        Y: 0,
      }),
    );
    const splashes = run.falls.map((s, i) => ({
      X: s.X + 0.15,
      Z: (i % 2 ? 0.12 : -0.1) + 0,
      t0: s.t,
      strength: 0.75,
      seed: 50 + Math.round(s.t * 10),
    }));
    this.world.render(f, a, cam, {
      rain: 0.65,
      rainWind: [1.4, 0],
      actors: [run.actor],
      splashes,
      foreground: fg,
      wind: 1.1,
    });
  }

  // --- 6 · 31.4: extreme close-up of Edric's eye. The spear point is in it ------------
  shotEye(f, t) {
    const [t0] = S.eye;
    const lt = t - t0;
    const k = easeOut(lt / 0.45);
    const c = pageCam(lerp(236, 226, k), lerp(128, 114, k), 1 + 0.22 * k, 0);
    const l = this.plateOf('edricEye', { zoom: 1.35, skin: true });
    if (l) this.draw(f, l, 0, null, c);
    // the iris (plate px 1536x1024 -> page): the point, foreshortened, catching the light
    const [ix, iy] = scrPage(c, 223 * 1.0, 113 * 1.0);
    const s = 0.8 + 0.5 * k;
    // the reflected point fills half the iris: the shaft from outside the eye, the leaf
    // of the blade at its centre, catching the light
    drawSpear(f, W, H, [ix + 26 * s, iy + 12 * s, 1.5], [ix - 2, iy - 1, 7 * s], {
      blade: 0.45,
      light: 1,
    });
    if (lt > 0.2) star(f, W, H, ix - 1, iy - 1, 2 + (twos(t) % 2), RGB.paperHi);
    // rain across the lens
    speedLines(f, W, H, t, {
      vertical: true,
      density: 0.05,
      speed: 900,
      len: 26,
      color: RGB.paperHi,
      seed: 21,
    });
    focusLines(f, W, H, ix, iy, twos(t), { inner: 170, amount: 0.5, aspect: 1.7, width: 6 });
  }

  // --- 7 · 32.1: over the Warden's shoulder. The thrust, on the snare -----------------
  shotOts(f, t) {
    const [t0] = S.ots;
    const a = act(t);
    const aa = onN(a, 2);
    const cam0 = lookAt({ x: 6.9, y: 1.5, z: -1.75 }, { x: 1.3, y: 0.7, z: 0.05 }, { focal: 400 });
    const [sx, sy, sr] = shake(t, [[TIME.thrust, 1]], 5, 0.12, 0.01);
    const push = 1 + 0.07 * pulse(t, [TIME.thrust], 0.15);
    const cam = nudge({ ...cam0, focal: cam0.focal * push }, sx, sy, sr);
    const wd = this.wardenAt(a, aa);
    const ed = this.edricAt(a, aa, { crossed: false });
    const sprays = this.slideSpray(a);
    this.world.render(f, a, cam, {
      rain: 0.7,
      actors: [ed.actor, wd],
      sprays,
      splashes: ed.splashes,
      wind: 1,
    });
    if (aa >= TIME.thrustGo) {
      // focus lines on the point; ink streaks along the shaft on the snap
      const tip = this.cardPoint(wd, cam, 15, 77);
      const hand = this.cardPoint(wd, cam, 262, 78);
      if (wd.frame >= 9)
        focusLines(f, W, H, tip.x, tip.y, twos(t), {
          inner: 55,
          amount: 0.7,
          aspect: 1.4,
          width: 5,
        });
      if (aa < TIME.thrust + 0.05)
        speedLinesAlong(f, { sx: hand.x, sy: hand.y }, { sx: tip.x, sy: tip.y }, t);
    }
    if (inStop(t, STOPS) && t < TIME.thrust + 1 / 24) impact(f, W, H, { mode: 'neg' });
    void t0;
  }

  /** The spray sheet Edric throws up as he drops (one sheet, seen from every camera). */
  slideSpray(a) {
    const t0 = TIME.drop + 0.12;
    if (a < t0) return [];
    return [{ X: 1.05, Z: -0.12, age: a - t0, width: 2.6, dir: 1, height: 2.2, seed: 4 }];
  }

  /**
   * The Warden from the plant to the fall (shots 7-16), on the clips where they exist:
   * the thrust, the block (the yield clip's first drawings), the yield, the cut. The
   * cell stays at his station; only the yield's step moves it (while the foot is up).
   */
  wardenAt(a, aa, o = {}) {
    const st = this.station(aa);
    let key;
    let i;
    if (aa < TIME.recover) {
      key = 'warden_thrust';
      i =
        aa < 5.833
          ? Math.floor(clamp((aa - 5.2) / 0.633) * 7)
          : clamp(Math.floor(10 + (aa - TIME.thrust) * 12), 9, 18); // 8 (a stub in the hand) skipped: 7 snaps to 9
    } else if (aa < 6.62 && !o.noRecover) {
      // the recovery: the painted in-between (the spear drawn back across the body)
      return this.actor('wRecover', st.w + 0.12, 0, -1, { flip: o.flip, rings: 0.6 });
    } else {
      key = 'warden_yield_cut';
      i = frameAt(YIELD_CUT, aa);
    }
    return this.clipActor(key, i, st.w, 0, -1, {
      flip: o.flip,
      rings: 0.6,
      fb: key === 'warden_thrust' ? 'wThrust' : 'wYield',
    });
  }

  /**
   * Where the two stand in the close shots: the bind point from the blocking; Edric's cell
   * so his blade's middle meets it, the Warden's so his shaft does. The Warden gives
   * ground with the bind and steps back on the yield.
   */
  station(aa) {
    // in the bind the pair rocks a hair, push and give, on threes (feet deep in the water)
    const rock =
      aa > TIME.bind - 0.3 && aa < TIME.yield
        ? 0.035 *
          Math.sin((onN(aa, 3) - TIME.bind) * 4.1) *
          smooth(TIME.bind - 0.3, TIME.bind + 0.2, aa)
        : 0;
    const bx = this.bindX(clamp(aa, TIME.clash, 10.4)) + rock;
    const E = CLIP.edric_slide_burst;
    const Wc = CLIP.warden_yield_cut;
    const B = CPTS.blade;
    const P = CPTS.shaft;
    const bm = [
      (B.hilt[0] * 0.3 + B.tip[0] * 0.7 - E.anchor[0]) * E.mpp,
      (E.anchor[1] - (B.hilt[1] * 0.3 + B.tip[1] * 0.7)) * E.mpp,
    ];
    const p0 = [(P.point[0] - Wc.anchor[0]) * Wc.mpp, (Wc.anchor[1] - P.point[1]) * Wc.mpp];
    const p1 = [(P.butt[0] - Wc.anchor[0]) * Wc.mpp, (Wc.anchor[1] - P.butt[1]) * Wc.mpp];
    const u = clamp((p0[1] - bm[1]) / (p0[1] - p1[1]));
    const shaftX = p0[0] + (p1[0] - p0[0]) * u; // from the Warden's anchor (he faces -X)
    const step = 0.6 * smooth(10.4, 10.62, aa) + 0.12 * smooth(11.2, 11.35, aa);
    return { e: bx - bm[0], w: bx - shaftX + step, bx, by: bm[1] };
  }

  /** The bind point's X from the blocking (held at its ends outside the bind). */
  bindX(aa) {
    const p = bindPoint(clamp(aa, TIME.clash, 10.7));
    return p ? p.x : 3.7;
  }

  /**
   * Edric from the charge to the fall: the run, the slide under the spray (the cell
   * slides with the blocking: nothing is planted), the burst from a fixed cell, the bind,
   * the overbalance and the fall (the slip clip). Returns { actor, splashes }.
   */
  edricAt(a, aa, o = {}) {
    const crossed = !!o.crossed;
    const flip = crossed ? true : undefined;
    const st = this.station(aa);
    const eX = actorAt('edric', aa).X;
    if (aa < TIME.drop + 0.02) {
      const X0 = actorAt('edric', S.track[0]).X;
      const X1 = actorAt('edric', S.track[1]).X;
      const run = this.runner(a, S.track[0], X0, (X1 - X0) / (S.track[1] - S.track[0]));
      const splashes = run.falls.map((q, k) => ({
        X: q.X + 0.15,
        Z: k % 2 ? 0.1 : -0.1,
        t0: q.t,
        strength: 0.8,
        seed: 70 + k,
      }));
      return { actor: run.actor, splashes };
    }
    if (aa < 6.9) {
      const i = frameAt(SLIDE_BURST, aa);
      // the slide skims the surface (on the riverbed the water would swallow all but his
      // cloak); as he springs up out of it his feet find the bed again
      const bed = this.world.groundY(eX + 0.1, 0);
      const Y = lerp(-0.2, bed, smooth(4, 8, i));
      return {
        actor: this.clipActor('edric_slide_burst', i, eX + 0.1, 0, 1, {
          flip,
          rings: 1,
          fb: 'eSlide',
          Y,
        }),
        splashes: [{ X: eX + 0.4, Z: -0.1, t0: TIME.drop + 0.1, strength: 1.4, seed: 80 }],
      };
    }
    if (aa < 10.4) {
      const i = frameAt(SLIDE_BURST, aa);
      return {
        actor: this.clipActor('edric_slide_burst', i, st.e, 0, 1, { flip, rings: 0.9, fb: 'eCut' }),
        splashes: [],
      };
    }
    // the slip clip's cell: his body where the bind left it
    const i = frameAt(SLIP_FALL, aa);
    const cx = this.station(10.39).e + 0.2;
    return {
      actor: this.clipActor('edric_slip_fall', i, cx, 0, 1, {
        flip,
        rings: 1,
        fb: 'eOver',
        Y: o.Y,
      }),
      splashes: [],
    };
  }

  // --- 8 · 32.2+: wide, low. The spray sheet; the point withdraws through it ---------
  shotSpray(f, t) {
    const [t0] = S.spray;
    const lt = t - t0;
    const a = act(t);
    const aa = onN(a, 2);
    const cam = lookAt(
      { x: 1.9 + 0.3 * lt, y: 0.36, z: -7.6 },
      { x: 3.0, y: 0.75, z: 0 },
      { focal: 290, roll: 0.02 },
    );
    const wd = this.wardenAt(a, aa);
    const ed = this.edricAt(a, aa);
    const sprays = this.slideSpray(a);
    this.world.render(f, a, cam, {
      rain: 0.7,
      actors: [ed.actor, wd],
      sprays,
      splashes: ed.splashes,
      impulses: [impulse(1.4, 0, TIME.thrust, 0.5)],
      wind: 1.2,
    });
  }

  // --- 9 · 32.4: three cuts on the fill ------------------------------------------------
  shotWall(f, t) {
    // the spray wall, close: it fills the frame and falls
    const a = act(t);
    const lt = t - S.wall[0];
    const cam = lookAt(
      { x: 1.0 + 0.4 * lt, y: 0.5, z: -2.1 },
      { x: 2.5, y: 1.0, z: 0 },
      { focal: 300 },
    );
    const [sx, sy] = shake(t, [[S.wall[0], 0.7]], 4, 0.1);
    // the wall at its height (time runs slow inside it), falling as the cut ends; the
    // Warden a shape beyond it, waiting
    this.world.render(f, a, nudge(cam, sx, sy), {
      rain: 0.8,
      actors: [this.wardenAt(a, onN(a, 2))],
      sprays: [{ X: 1.3, Z: -0.1, age: 0.42 + lt * 0.9, width: 3.0, dir: 1, height: 2.4, seed: 4 }],
    });
  }

  shotSlit(f, t) {
    const lt = t - S.slit[0];
    const l = this.helmPlate();
    const slit = this.plateOf('helm', { zoom: 2.3, skin: false }) || l.layer;
    const c = pageCam(262, 110, 2.1 + 0.2 * lt, 0);
    this.draw(f, slit, 0, null, c);
    const [ex, ey] = scrPage(c, ...l.eye);
    star(f, W, H, ex, ey, 3, RGB.paperHi);
  }

  shotShape(f, t) {
    // a shape moving in the spray: Edric's burst seen through the falling sheet
    const a = act(t);
    const cam = lookAt({ x: 3.6, y: 0.8, z: -3.4 }, { x: 2.6, y: 0.8, z: 0 }, { focal: 330 });
    const ed = this.edricAt(a, onN(a, 2));
    ed.actor.opts = { silhouette: RGB.ink, rim: { dir: [-0.7, -0.7], w: 1.5, color: RGB.steel } };
    this.world.render(f, a, cam, { rain: 0.8, actors: [ed.actor], sprays: this.slideSpray(a) });
  }

  // --- 10 · 33.1: the clash, on the crash -----------------------------------------------
  shotClash(f, t) {
    const [t0] = S.clash;
    const lt = t - t0;
    const a = act(t);
    const aa = onN(a, 2);
    const hit = TIME.clash + 4 / 24; // the frame after the stop's first impact frames
    const cam0 = lookAt({ x: 3.45, y: 1.05, z: -3.9 }, { x: 3.62, y: 0.9, z: 0 }, { focal: 330 });
    const [sx, sy, sr] = shake(t, [[hit, 1]], 7, 0.13, 0.015);
    const punch = 1 + 0.1 * pulse(t, [hit], 0.14);
    const cam = nudge({ ...cam0, focal: cam0.focal * punch }, sx, sy, sr);
    const st = this.station(aa);
    const ed = this.edricAt(a, aa);
    const wd = this.wardenAt(a, aa);
    // the blow lands: the Warden is rocked back on his heels and recovers; Edric's body
    // follows through into it (a peak two drawings after the stop, then a damped return)
    const u = aa - TIME.clash;
    const k =
      u <= 0 ? 0 : u < 0.09 ? u / 0.09 : Math.exp(-(u - 0.09) / 0.22) * Math.cos((u - 0.09) * 9);
    wd.X += 0.12 * k;
    wd.xf = { rot: BIND_LEAN * 0.07 * k };
    ed.actor.X += 0.07 * k;
    ed.actor.xf = { rot: BIND_LEAN * 0.05 * k };
    this.world.render(f, a, cam, {
      rain: 0.8,
      rainWind: [1.8, 0],
      actors: [ed.actor, wd],
      impulses: [impulse(st.bx, 0, TIME.clash, 1.3)],
      splashes: [{ X: st.e + 0.35, Z: -0.25, t0: 6.97, strength: 0.7, seed: 9 }],
      sprays: this.slideSpray(a),
      wind: 1.3,
    });
    const c = this.contact(ed.actor, wd, cam);
    if (c) {
      sparks(f, W, H, c[0], c[1], a, TIME.clash, { count: 80, speed: 340, life: 0.55, seed: 5 });
      const v = a - TIME.clash;
      if (v < 0.14) star(f, W, H, c[0], c[1], 26 * (1 - v / 0.14));
    }
    // impact frames: ink and paper, on the crash (inside the hit-stop's held frames)
    if (lt < 1 / 24) impact(f, W, H, { mode: 'neg' });
    else if (lt < 2 / 24) impact(f, W, H, { mode: 'pos' });
    else if (lt < 3 / 24 && c) glow(f, W, H, c[0], c[1], 40, 0.8);
  }

  /** The screen point where Edric's blade crosses the Warden's shaft (bind clips), or null. */
  contact(ea, wa, cam) {
    if (ea.cut.key !== 'edric_slide_burst' || wa.cut.key !== 'warden_yield_cut') return null;
    if (ea.frame < 10 || wa.frame > 5) return null;
    const B = ea.frame < 12 ? CPTS.strike : CPTS.blade;
    const h = this.cardPoint(ea, cam, ...B.hilt);
    const tp = this.cardPoint(ea, cam, ...B.tip);
    const p = this.cardPoint(wa, cam, ...CPTS.shaft.point);
    const b = this.cardPoint(wa, cam, ...CPTS.shaft.butt);
    const r = segX([h.x, h.y], [tp.x, tp.y], [p.x, p.y], [b.x, b.y]);
    return r;
  }

  // --- 11 · 33.3: the bind. A slow orbit; the hold ------------------------------------
  shotBind(f, t) {
    const [t0, t1] = S.bind;
    const lt = t - t0;
    const a = act(t);
    const a3 = onN(a, 3); // the hold on threes
    const st = this.station(a3);
    // the orbit: the background one way, the reeds the other
    const ang = lerp(-0.42, -0.08, lt / (t1 - t0));
    const cam0 = orbit({ x: st.bx - 0.15, y: 0.9, z: 0 }, 3.0, ang, 1.2, {
      focal: 390,
      lookY: 0.86,
    });
    const [sx, sy] = shake(
      t,
      HITS('kick', t0, t1).map((h) => [h, 0.35]),
      1.6,
      0.08,
    );
    const cam = nudge(cam0, sx, sy);
    const ring = this.memo('bind:ring', () => {
      const out = [];
      for (let k = 0; k < 11; k++) {
        const q = -1.35 + k * 0.23;
        const stone = k % 4 === 2;
        out.push({
          X: 3.6 + Math.sin(q) * 2.2,
          Z: -Math.cos(q) * 2.2,
          kind: stone ? 'stone' : 'reeds',
          h: stone ? 0.2 : 0.75,
          seed: 40 + k,
          Y: 0,
        });
      }
      return out;
    });
    const ed = this.edricAt(a3, a3);
    const wd = this.wardenAt(a3, a3);
    // the bodies strain: each leans into the lock as it presses and is bent back as the
    // other does (counter-phased, on threes), with a tremor that grows toward the decision
    const push = Math.sin((a3 - TIME.bind) * 4.1);
    const strain = smooth(TIME.bind, TIME.decide, a);
    const trem = (k) => strain * 0.012 * Math.sin(twos(a) * 2.7 + k);
    ed.actor.xf = { rot: BIND_LEAN * (0.03 + 0.03 * push) + trem(0) };
    wd.xf = { rot: -BIND_LEAN * (0.02 - 0.03 * push) + trem(1.9) };
    this.world.render(f, a, cam, {
      rain: 0.9,
      rainWind: [2.2, 0.4],
      actors: [ed.actor, wd],
      foreground: ring,
      wind: 1.4,
    });
    const c = this.contact(ed.actor, wd, cam);
    if (c) {
      // sparks grinding on twos: a few each drawing, thrown down along the shaft
      const d = twos(a);
      for (let k = 0; k < 3; k++)
        sparks(f, W, H, c[0], c[1], a, (d - k) / 12, {
          count: 11,
          speed: 190,
          life: 0.24,
          seed: 100 + d - k,
          dir: 2.3,
        });
      glow(f, W, H, c[0], c[1], 9, 0.45 + 0.25 * (d % 2));
      if (d % 2) star(f, W, H, c[0], c[1], 5, RGB.paperHi);
    }
    // breath, on threes: a pale puff at Edric's mouth
    this.breath(f, ed.actor, cam, a3, 1);
  }

  /** A breath: a small pale puff at Edric's mouth that forms and thins on threes. */
  breath(f, a, cam, t, seed) {
    const ph = (((t * 0.85 + seed * 0.3) % 1) + 1) % 1;
    if (ph > 0.55 || a.cut.key !== 'edric_slide_burst') return;
    const m = this.cardPoint(a, cam, 254, 108);
    const r = 1.5 + ph * 7;
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y * 1.4) / r;
        if (d > 1) continue;
        const k = (1 - d) * (1 - ph / 0.55) * 0.6;
        if (k > hashDither(x, y))
          put(f, W, H, m.x + 3 + x + ph * 12, m.y + y - ph * 3, RGB.paperHi);
      }
  }

  // --- 12 · 34.3: close-up. The helm's eye slit; a tilt; he decides ------------------
  helmPlate() {
    if (this.img.helm) {
      return { layer: this.plateOf('helm', { zoom: 1.6, skin: false }), eye: [336, 58] };
    }
    // fallback: the helm of the old stand-in, cropped close
    const im = this.img.soldier;
    const l = this.plate('helmCrop', im, {
      crop: { x: 150, y: 60, w: 180, h: 101 },
      zoom: 1.2,
    });
    return { layer: l, eye: [270, 115] };
  }

  shotHelm(f, t) {
    const [t0] = S.helm;
    const lt = t - t0;
    const a = act(t);
    const hp = this.helmPlate();
    const L = hp.layer;
    // he breathes (a pixel or two, slow), then decides: a lift, and the helm snaps down
    // and toward the blade with an overshoot (the head moves, not the camera), on twos
    const D = TIME.decide + 0.26;
    const tilt = keyMove(a, D, 0.34, { ant: 0.4, back: 0.25, over: 0.12, n: 2 });
    const breath = Math.sin(onN(a, 3) * 5.2) * 1.2 * (1 - clamp(tilt));
    const w = L.st.w;
    const h = L.st.h;
    const xf = {
      x: W / 2 - 10 * tilt,
      y: H / 2 + h * 0.55 * L.xf.scale + breath + 6 * tilt,
      ax: w / 2,
      ay: h * 1.05, // the neck, below the frame
      scale: L.xf.scale * (1.22 + 0.025 * tilt), // overscanned: the tilt never shows its edge
      rot: -0.11 * tilt,
    };
    const c = pageCam(240, 135, 1.02 + 0.02 * lt, 0);
    // whatever the tilt uncovers is the shadow under his collar, not the page
    for (let i = 0; i < W * H * 4; i += 4) {
      f[i] = 34;
      f[i + 1] = 28;
      f[i + 2] = 40;
    }
    this.draw(f, L, 0, xf, c);
    // the eye: dark, then it catches the light on the snap, flares and holds
    const m = layerMatrix(xf, c, W, H);
    // the eye is given in page px of the plate at rest: back to layer px
    const u = (hp.eye[0] - W / 2) / L.xf.scale + w / 2;
    const v = (hp.eye[1] - H / 2) / L.xf.scale + h / 2;
    const ex = m[0] * u + m[1] * v + m[2];
    const ey = m[3] * u + m[4] * v + m[5];
    const on = a - (D + 0.12);
    if (on > 0) {
      const flare = on < 0.1 ? 5 : on < 0.2 ? 3 : 2 + ((twos(t) >> 1) % 2);
      star(f, W, H, ex, ey, flare, RGB.paperHi);
      if (on < 0.25) glow(f, W, H, ex, ey, 14, 0.5 * (1 - on / 0.25));
    }
    // rain in front of him (drawings on twos)
    speedLines(f, W, H, t, {
      vertical: true,
      density: 0.09,
      speed: 1100,
      len: 34,
      color: RGB.paperHi,
      seed: 31,
    });
    void lt;
  }

  /**
   * Edric losing his footing (10.6 on the slick stone, to the cut): the body pitches
   * forward toward the Warden and drops as the leg goes out from under it, with a
   * wobble on the way. On the crossed side he faces screen left, so forward is a
   * negative (counter-clockwise) tip. Returns { rot, dY } for his actor.
   */
  edricSlip(aa) {
    const u = smooth(TIME.stone, TIME.cut - 0.05, aa);
    const wob = 0.03 * Math.sin((aa - TIME.stone) * 17) * (1 - u) * (aa > TIME.stone ? 1 : 0);
    return { rot: -(0.24 * u + wob), dY: -0.1 * u };
  }

  // --- 13 · 35.1: the yield. The camera whips round and crosses the line --------------
  whipCam(t) {
    const w0 = 10.62;
    const w1 = 10.75; // three frames: the eye can't follow
    const w = smooth(w0, w1, t);
    const settle = t > w1 ? Math.exp(-(t - w1) * 9) * Math.sin((t - w1) * 18) * 0.05 : 0;
    const ang = lerp(-0.3, Math.PI + 0.35, w) + settle + 0.06 * (t - TIME.yield);
    const cx = lerp(4.1, 4.35, w);
    return orbit({ x: cx, y: 1.0, z: 0 }, lerp(3.5, 3.3, w), ang, lerp(1.3, 1.2, w), {
      focal: 340,
      lookY: 0.95,
    });
  }

  shotYield(f, t) {
    const a = act(t);
    const aa = onN(a, 2);
    const cam = this.whipCam(t);
    const crossed = t >= 10.7;
    const ed = this.edricAt(a, aa, { crossed });
    if (crossed) {
      const sl = this.edricSlip(aa);
      ed.actor.xf = { rot: sl.rot };
      ed.actor.Y = this.world.groundY(ed.actor.X, ed.actor.Z) + sl.dY;
    }
    const wd = this.wardenAt(a, aa);
    this.world.render(f, a, cam, {
      rain: 0.8,
      actors: [ed.actor, wd],
      splashes: [
        { X: 3.8, Z: 0, t0: TIME.stone, strength: 0.8, seed: 61 },
        { X: 4.2, Z: 0.1, t0: 10.95, strength: 0.8, seed: 62 },
        { X: this.station(10.62).w - 0.2, Z: 0, t0: 10.6, strength: 0.6, seed: 63 },
      ],
      wind: 1.3,
    });
    // the whip: the eye can't follow; streaked multiples and speed lines
    const prev = this.whipCam(t - 1 / 24);
    let dyaw = cam.yaw - prev.yaw;
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    const drag = -dyaw * cam.focal * 0.9;
    if (Math.abs(drag) > 3) {
      panBlur(f, Math.min(90, Math.abs(drag)));
      speedLines(f, W, H, t, {
        density: 0.3,
        speed: drag > 0 ? 3000 : -3000,
        len: 160,
        color: RGB.graphite,
      });
    }
  }

  // --- 14 · 35.3: the crimson cut -------------------------------------------------------
  shotCut(f, t) {
    const [t0] = S.cut;
    const lt = t - t0;
    const a = act(t);
    const aa = onN(a, 2);
    const cam0 = orbit({ x: 4.35, y: 1.0, z: 0 }, 3.1, Math.PI + 0.4, 1.2, {
      focal: 350,
      lookY: 0.95,
    });
    const [sx, sy, sr] = shake(t, [[TIME.cut + 4 / 24, 1.2]], 8, 0.14, 0.02);
    const cam = nudge(cam0, sx, sy, sr);
    const ed = this.edricAt(a, aa, { crossed: true });
    // he is still falling forward from the slip when the blade comes down; the blow
    // straightens him up and back (the struck drawings take over from there)
    const sl = this.edricSlip(Math.min(aa, TIME.cut));
    const rec = smooth(TIME.cut, TIME.cut + 0.25, aa);
    ed.actor.xf = { rot: sl.rot * (1 - rec) };
    ed.actor.Y = this.world.groundY(ed.actor.X, ed.actor.Z) + sl.dY * (1 - rec);
    const wd = this.wardenAt(a, aa);
    this.world.render(f, a, cam, {
      rain: 0.85,
      actors: [ed.actor, wd],
      impulses: [impulse(ed.actor.X, 0, TIME.cut, 0.8)],
      wind: 1.2,
    });
    // the crimson stroke across his back: a crescent that sweeps through in one drawing
    // (inside the stop's negative frames), then thins and breaks over three, flinging
    // crimson along its path
    const back = this.cardPoint(ed.actor, cam, 238, 128);
    const v = t - TIME.cut;
    if (v >= 0 && v < 10 / 24) crescent(f, back.x, back.y, v / (10 / 24), 7);
    // negative crimson impact frames, on the crash
    if (lt < 3 / 24) impact(f, W, H, { mode: 'neg', light: RGB.crimson });
    else if (lt < 4 / 24) flash(f, W, H, 0.35, RGB.crimson);
  }

  // --- 15 · 35.4: close-up. Edric's face; the spray hangs in the air ---------------------
  shotFace(f, t) {
    const [t0] = S.face;
    const lt = t - t0;
    const slow = slowMo(t, t0, S.face[1], 0.18, 0.02) - t0;
    const l = this.plateOf('struck', { zoom: 1.2, skin: true });
    // the blow snaps his head back in two drawings, then time slows and it keeps going,
    // barely: the plate turns about his neck (below the frame), overscanned over a dark
    // underlay so the turn never shows the page
    const snap = 1 - Math.exp(-onN(lt, 2) / 0.05);
    const rot = 0.075 * snap + 0.12 * slow;
    const c = pageCam(236 - 10 * slow, 132 + 10 * slow, 1.03 + 0.05 * slow, 0);
    for (let i = 0; i < W * H * 4; i += 4) {
      f[i] = 30;
      f[i + 1] = 26;
      f[i + 2] = 40;
    }
    if (l) {
      const w = l.st.w;
      const h = l.st.h;
      this.draw(
        f,
        l,
        0,
        {
          x: W / 2 + 6 * snap,
          y: H / 2 + h * 0.6 * l.xf.scale * 1.18 + 20 - 5 * snap,
          ax: w / 2,
          ay: h * 1.1,
          scale: l.xf.scale * 1.18,
          rot,
          flip: true,
        },
        c,
      );
    }
    // spray hanging in the air: droplets that barely move
    for (let i = 0; i < 70; i++) {
      const x0 = hash(i, 1, 91) * W;
      const y0 = hash(i, 2, 91) * H;
      const vx = (hash(i, 3, 91) - 0.3) * 60;
      const vy = -40 + hash(i, 4, 91) * 30;
      const x = x0 + vx * slow;
      const y = y0 + vy * slow + 30 * slow * slow;
      const r = hash(i, 5, 91) < 0.25 ? 2 : 1;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (dx * dx + dy * dy <= r * r)
            put(f, W, H, x + dx, y + dy, dx < 0 && dy < 0 ? RGB.paperHi : RGB.steel);
    }
    // crimson drops from the cut, among them
    for (let i = 0; i < 9; i++) {
      const x = 330 + hash(i, 6, 92) * 120 - 40 * slow;
      const y = 60 + hash(i, 7, 92) * 140 - 18 * slow;
      put(f, W, H, x, y, RGB.crimson);
      put(f, W, H, x + 1, y, RGB.crimson);
      put(f, W, H, x, y + 1, RGB.blood);
    }
    // slow rain: long, pale streaks barely falling
    speedLines(f, W, H, t0 + slow * 0.4, {
      vertical: true,
      density: 0.06,
      speed: 700,
      len: 30,
      color: RGB.paperHi,
      seed: 41,
    });
    if (lt < 1 / 24) flash(f, W, H, 0.3, RGB.crimson);
  }

  // --- 16 · 36.1: wide, low. He falls onto his back; the paint lifts ------------------
  shotFall(f, t) {
    const [t0] = S.fall;
    const lt = t - t0;
    const a = act(t);
    const aa = onN(a, 2);
    // the crossed side, low at the water and close: he falls through the frame
    const cam = lookAt(
      { x: 3.98 - 0.05 * lt, y: 0.36 - 0.04 * lt, z: 2.25 - 0.18 * lt },
      // the camera follows him down (on ones): from his chest to the water he lands in
      { x: 3.72, y: lerp(0.62, 0.28, smooth(0.05, 0.45, lt)), z: -0.4 },
      { focal: 300, roll: 0.015 },
    );
    const [sx, sy] = shake(
      t,
      [
        [TIME.fall, 0.4],
        [TIME.landed, 1],
      ],
      4,
      0.12,
    );
    const camS = nudge(cam, sx, sy);
    // the lift: the paint comes off the page in stutters on the fill's snares
    const lift = HITS('snare', TIME.lift - 0.01, DURATION + 1);
    let stage = 0;
    lift.forEach((h, i) => {
      if (t >= h) stage = [0.55, 1.2, 2.0, 3][Math.min(3, i)]; // the paint lifts in patches first
    });
    if (t >= DURATION - 2 / 24) stage = 3;
    // where he comes down: a body's length in front of the Warden's station
    const LX = 3.42;
    const LZ = -0.45;
    const HIT = TIME.landed; // his back meets the water on the snare
    let ed;
    if (aa < HIT) {
      // airborne: the clip's backward tip (drawings 12-20, before it starts to float),
      // with gravity doing the falling and the body rotating about the feet toward flat
      const u = clamp((aa - t0) / (HIT - t0));
      const i = 12 + Math.floor(u * 8.99);
      ed = this.clipActor('edric_slip_fall', i, LX + 0.2, LZ, 1, {
        flip: true,
        rings: 1,
        fb: 'eOver',
        Y: -0.12 - 0.1 * u * u,
        rot: FALL_TIP * 0.66 * u ** 1.6,
      });
    } else {
      // in the water: he sinks in, bobs back up once or twice, and settles, rocking
      const v = aa - HIT;
      const bob = 0.08 * Math.exp(-v / 0.26) * Math.cos(v * 11);
      const rock = 0.06 * Math.exp(-v / 0.4) * Math.sin(v * 8.5);
      ed = this.actor('eFall', LX + 0.1, LZ, 1, {
        flip: true,
        rings: 1,
        Y: -0.33 - 0.05 * smooth(0, 1.0, v) - bob,
        rot: rock,
      });
    }
    ed.stage = stage;
    const wd = this.wardenAt(a, aa);
    wd.stage = stage;
    // the sun is cheated round to the downstream sky (the camera has turned): only here
    const sun0 = this.world.sun;
    this.world.sun = { ...sun0, az: 3.2, el: 0.16 };
    this.world.render(f, a, camS, {
      stage,
      rain: 0.75,
      actors: [ed, wd, ...this.soldiers(a, camS, LINE, { flip: true, stage })],
      // droplets and the ring only (a flat body throws sheets, not a crown: below)
      splashes: [{ X: LX + 0.1, Z: LZ, t0: HIT, strength: 0.85, seed: 13 }],
      wind: 0.9,
    });
    // the water he lands in: a white mass thrown up along his length that breaks into
    // blobs and drops (anime water: flat white, an ink rim, no gradients)
    if (stage < 3)
      this.world.spraySheet(f, camS, {
        X: LX + 0.1,
        Z: LZ,
        width: 1.8,
        age: a - HIT + 1 / 24, // already thrown on the landing frame
        dir: 0.2,
        height: 0.8,
        strength: 0.8,
        seed: 7,
      });
    this.world.sun = sun0;
  }
}

// ---------------------------------------------------------------------- helpers

/** A camera whip in one frame: every row dragged sideways over L px (a box average). */
function panBlur(f, L) {
  const n = Math.max(2, Math.round(L));
  const row = new Float32Array(W * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      row[x * 3] = f[o];
      row[x * 3 + 1] = f[o + 1];
      row[x * 3 + 2] = f[o + 2];
    }
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < n; k++) {
        const xx = Math.min(W - 1, Math.max(0, x - (n >> 1) + k));
        r += row[xx * 3];
        g += row[xx * 3 + 1];
        b += row[xx * 3 + 2];
      }
      const o = (y * W + x) * 4;
      f[o] = r / n;
      f[o + 1] = g / n;
      f[o + 2] = b / n;
    }
  }
}

/**
 * The Empire's cut as an anime crescent through (cx, cy): swept in during the first
 * tenth of p, then thinning and breaking up, crimson flung off along its path.
 */
function crescent(f, cx, cy, p, seed = 1) {
  const R = 150; // the arc's radius (px): a long, flat crescent
  const ox = cx + R * 0.45; // its centre sits below and right: the arc runs down-left to up-right
  const oy = cy + R * 0.78;
  const a0 = -Math.PI * 0.86;
  const a1 = -Math.PI * 0.33;
  const sweep = clamp(p / 0.08);
  const thin = 1 - smooth(0.45, 1, p); // it holds its width past the negative frames
  const wmax = 8 * thin + 1;
  const n = 140;
  for (let i = 0; i <= n * sweep; i++) {
    const u = i / n;
    // broken as it fades: gaps open along it
    if (p > 0.55 && hash(Math.floor(u * 22), seed, 3) < (p - 0.55) * 2) continue;
    const ang = lerp(a0, a1, u);
    const w = wmax * Math.sin(Math.PI * u) ** 0.8;
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const x = ox + nx * R;
    const y = oy + ny * R;
    for (let d = -w / 2; d <= w / 2; d += 0.5) {
      const e = Math.abs(d) / (w / 2 + 1e-6);
      put(
        f,
        W,
        H,
        x + nx * d,
        y + ny * d,
        e > 0.7 ? RGB.blood : d < 0 && e > 0.25 ? RGB.crimsonHi : RGB.crimson,
      );
    }
  }
  // crimson flung off the stroke, along its tangent and outward
  if (p > 0.1)
    for (let j = 0; j < 36; j++) {
      const u = 0.15 + 0.7 * hash(j, seed, 5);
      const ang = lerp(a0, a1, u);
      const tx = -Math.sin(ang);
      const ty = Math.cos(ang);
      const q = (p - 0.1) * (0.6 + hash(j, seed, 6));
      const sp = 60 + 120 * hash(j, seed, 7);
      const x = ox + Math.cos(ang) * R + (tx * 0.7 + Math.cos(ang) * 0.5) * sp * q;
      const y = oy + Math.sin(ang) * R + (ty * 0.7 + Math.sin(ang) * 0.5) * sp * q + 80 * q * q;
      const r = hash(j, seed, 8) < 0.3 ? 1.5 : 0.8;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (dx * dx + dy * dy <= r * r) put(f, W, H, x + dx, y + dy, RGB.crimson);
    }
}

/** A skeleton with its spear cut to `len` m (the blocking's 3.05 m runs off the frame). */
function shorten(sk, len) {
  const w = sk.weapon;
  if (!w || w.kind !== 'spear') return sk;
  const L = Math.hypot(w.tip[0] - w.butt[0], w.tip[1] - w.butt[1]) || 1;
  const k = len / L;
  const r = w.rear;
  const tip = [r[0] + (w.tip[0] - r[0]) * k, r[1] + (w.tip[1] - r[1]) * k];
  const butt = [r[0] + (w.butt[0] - r[0]) * k, r[1] + (w.butt[1] - r[1]) * k];
  return { ...sk, weapon: { ...w, tip, butt } };
}

const hashDither = (x, y) => hash(x & 63, y & 63, 5);

/** Page point (x, y) through a page camera -> screen. */
function scrPage(c, x, y) {
  const dx = (x - c.x) * c.zoom;
  const dy = (y - c.y) * c.zoom;
  const cs = Math.cos(c.rot);
  const sn = Math.sin(c.rot);
  return [cs * dx - sn * dy + W / 2, sn * dx + cs * dy + H / 2];
}

/** Where segments ab and cd cross (or their closest approach within 6 px), or null. */
function segX(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-6) return null;
  const u = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (u < -0.3 || u > 1.3 || v < -0.3 || v > 1.3) return null;
  return [a[0] + r[0] * u, a[1] + r[1] * u];
}

/** A smear ghost: a thick dithered graphite stroke (the multiple of a fast arc). */
function speedLinesAlong(f, pa, pb, t) {
  const dx = pb.sx - pa.sx;
  const dy = pb.sy - pa.sy;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const d = twos(t);
  for (let i = 0; i < 14; i++) {
    const off = (hash(i, d, 3) - 0.5) * 40;
    const u0 = hash(i, d, 4) * 0.7;
    const len = 0.15 + 0.3 * hash(i, d, 5);
    for (let k = 0; k < L * len; k++) {
      const u = u0 + k / L;
      put(f, W, H, pa.sx + dx * u + nx * off, pa.sy + dy * u + ny * off, RGB.sepia);
    }
  }
}

export const PieceClass = FordPiece;
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
