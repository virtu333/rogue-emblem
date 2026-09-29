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
import { bayer, clamp, hash, lerp, smooth } from './engine/raster.js';
import { layerMatrix, cam as pageCam } from './engine/view.js';
import {
  RGB,
  easeOut,
  flash,
  focusLines,
  glint,
  glow,
  PALE,
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
import { drawSoldier, history, marchPlan, soldierLook, stepSkeleton } from './engine/figure.js';
import {
  DURATION as BLOCK_DURATION,
  MUSIC_OFFSET as BLOCK_OFFSET,
  TIME,
  actorAt,
  bindPoint,
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

// the flickers on the roll's ten strokes, in the order the fight will show them
const RUSH_INSERTS = [
  'sun',
  'ford',
  'guard',
  'edricEye',
  'spray',
  'helm',
  'clash',
  'crimson',
  'struck',
  'fall',
];

// the bind's push and give: [time, -1..1] (see bindPush); BIND_SHIFT metres at +-1
const PUSH = [
  [7.2, 0],
  [8.0, 0],
  [8.3, 0.55],
  [8.6, 1],
  [8.85, 0.95],
  [9.0, 0.25],
  [9.25, -0.85],
  [9.45, -0.5],
  [9.6, 0.05],
];
const BIND_SHIFT = 0.07;
// the hips of the drawings held in the bind, cell px (annotated by eye on the atlases)
const HIPS = { edric_slide_burst: [233, 172], warden_yield_cut: [153, 167] };

// every drawing of Edric (their warm tan is retoned at load: see retoneWarm)
const EDRIC_MOTIONS = ['edric_run', 'edric_tumble', 'edric_slide_burst', 'edric_slip_fall'];
const EDRIC_IMAGES = [
  'standing',
  'charge',
  'falls',
  'eSlide',
  'eRise',
  'eCut',
  'eOver',
  'eStruck',
  'eFall',
];

// the eye in the uncropped helm plate (page px), for the one-sixteenth cut on the slit
const SLIT_EYE = [336, 58];

const FALL_TIP = 1;
const BIND_LEAN = 1; // which way a positive lean tips a figure toward +X (by eye) // which way the flipped slip clip rotates to lie back (by eye)
const RUN_H = 1.76; // edric_run's cell height in metres (the runner is ~1.68 m in it)

/** Build figures near the size they are seen at (in steps of about a tenth). */
const bucket = (px) => {
  const p = Math.max(10, Math.min(560, px));
  return Math.round(10 * 1.1 ** Math.round(Math.log(p / 10) / Math.log(1.1)));
};
const step = (u, n) => Math.floor(clamp(u) * n) / n; // progress in n stutters

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
    // Edric's tan skin and brass snap to the ember ramp's gold: turn them toward skin and
    // steel in every drawing of him, so he is one design (and not gold) across the cuts
    for (const n of EDRIC_MOTIONS)
      if (this.motionSrc[n]) this.motionSrc[n].img = retoneWarm(this.motionSrc[n].img);
    for (const k of EDRIC_IMAGES) if (this.img[k]) this.img[k] = retoneWarm(this.img[k]);
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
    // gold is the Thread's alone: the struck close-up was painted in amber light, which
    // the palette snaps to the ember ramp (a yellow face, brass armour). Its warm tan is
    // turned toward skin and steel before the plate is built.
    if (this.img.struck) this.img.struck = retoneWarm(this.img.struck);
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
      motionRef: () => M,
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
    let lu = a.flip ? st.w - u * k : u * k;
    let lv = v * k;
    // a body bent by the bind (bendActor): the point goes where the drawing was moved to
    if (a.bend) [lu, lv] = a.bend.fwd(lu, lv);
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
   * The Empire's rank on the far bank, and (far off, in the wide) the Warden coming down to
   * the water: code-drawn soldiers (engine/figure.js) standing on the world's real ground.
   * Each man is staged from the terrain, not from the blocking's column: he starts a stride
   * or two up the bank and steps down it in step with the others, every sole on the ground
   * at its own X (the slope tilts the boot), and halts at the water's edge in the shallows
   * with a stamp and a settle, the spear butt dropping onto the bed. The rank is a real one:
   * a man's width and a half between the shoulders, uneven the way men are, following the
   * shore. Returns { actors, splashes, puffs }: the footfalls as effects for world.render.
   * names: 'warden' in it adds the Warden; o: { flip (ignored: derived from the camera), stage,
   * mist, haze, n (men in the rank), zMin/zMax (only the men in that stretch of shore) }.
   */
  soldiers(t, cam, names, o = {}) {
    const tt = onN(t, 2);
    const men = this.rankStaging().filter((m) =>
      m.warden ? names.includes('warden') : m.Z >= (o.zMin ?? -99) && m.Z <= (o.zMax ?? 99),
    );
    const actors = [];
    const splashes = [];
    const puffs = [];
    const world = this.world;
    for (const m of men) {
      const skel = (q) => m.skel(q);
      const sk = skel(tt);
      const X = sk.X;
      const Z = m.Z;
      const look = m.look;
      // where he stands on the page: the water plane under his hips; the skeleton is in
      // world metres, so his soles land wherever the ground is
      const p = project(cam, X, 0, Z, W, H);
      // which way he turns toward the lens (3/4 view), and on which side of the page he
      // faces: from the ray to him (he faces -X, toward the ford)
      const rx = X - cam.x;
      const rz = Z - cam.z;
      const rl = Math.hypot(rx, rz) || 1;
      const vx = rx / rl;
      const vz = rz / rl;
      const side = -vz; // > 0: he faces screen right
      const yaw = Math.max(0, Math.min(1.2, Math.atan2(vx, Math.abs(side))));
      // the haze: aerial perspective from the world's own fog, a touch stronger (the ink
      // ramps step up on it), and the same veil over what is drawn
      const dist = Math.max(1, p.depth);
      const fog = world.fogAt(dist);
      const haze = clamp(0.1 + fog * 4.2, 0, 0.8) * (o.haze ?? 1);
      const mist = clamp(0.06 + fog * 2.4, 0, 0.5) * (o.mist ?? 1);
      const sc = p.scale;
      const box = [
        p.sx - 1.7 * sc - 6,
        p.sy - 3.1 * sc - 6,
        p.sx + 1.7 * sc + 6,
        p.sy + 0.8 * sc + 6,
      ];
      actors.push({
        X,
        Z,
        height: 1.95 * m.scale,
        rings: m.warden ? 0.5 : 0.4,
        seed: 20 + m.i,
        stage: o.stage,
        shadow: false,
        box,
        // a contact patch under each sole that is down (on wet earth: a small dark spot)
        contacts: ['N', 'F'].map((nm) => ({
          X: sk.legs[nm].foot[0],
          Z,
          r: 0.17,
          on: sk.legs[nm].foot[1] - m.ground(sk.legs[nm].foot[0]) < 0.11,
        })),
        draw: (buf, info) => {
          const xf = { x: p.sx, y: p.sy, s: sc, ax: X, ay: 0, flip: side > 0, yaw };
          const hist = history(skel, tt, 8);
          drawSoldier(buf, W, H, sk, xf, {
            look,
            haze,
            hist,
            t: tt,
            detail: o.detail,
            boots: 'black',
          });
          // the painter writes colour only: mark what it drew for the compositor, and lay the
          // world's haze over it
          const paper = info.paper;
          const x0 = Math.max(0, Math.floor(box[0]));
          const x1 = Math.min(W, Math.ceil(box[2]));
          const y0 = Math.max(0, Math.floor(box[1]));
          const y1 = Math.min(H, Math.ceil(box[3]));
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const q = (y * W + x) * 4;
              if (buf[q] === 1 && buf[q + 1] === 0 && buf[q + 2] === 1) continue;
              buf[q + 3] = 255;
              buf[q] += (paper[q] * 0.93 - buf[q]) * mist * 0.8;
              buf[q + 1] += (paper[q + 1] * 0.94 - buf[q + 1]) * mist * 0.8;
              buf[q + 2] += (paper[q + 2] * 0.97 - buf[q + 2]) * mist * 0.8;
            }
        },
      });
      // the footfalls and the spear's stamp as effects: a splash where the ground is under
      // water, a kick of wet earth where it is not
      for (const e of m.events) {
        const g = world.groundY(e.X, Z);
        const fx = { X: e.X, Z, t0: e.t, strength: e.strength, seed: 40 + m.i * 3 + e.k };
        if (g < -0.015) splashes.push(fx);
        else puffs.push({ ...fx, Y: g });
      }
    }
    return { actors, splashes, puffs };
  }

  /**
   * Where each man of the rank stands, and how he gets there (memoised: it reads the
   * world's shore). The Warden first (index 0) when the wide wants him.
   */
  rankStaging() {
    return this.memo('rank', () => {
      const w = this.world;
      const men = [];
      const shore = (Z) => {
        w.edges(Z);
        return w._er;
      };
      const N = 11;
      for (let r = -1; r < N; r++) {
        const warden = r < 0;
        const i = r + 1;
        const j = (k) => hash(i, k, 41) - 0.5;
        // a man's width and a half between the shoulders, uneven; centred on the Warden's
        // place, so the rank runs out of frame both ways
        const Z = warden ? 0 : (r - (N - 1) / 2) * 1.7 + 0.3 * j(1);
        const er = shore(Z);
        // at rest: ankle-deep at the edge (the ground there is a hand under the surface)
        const xE = warden ? 7.05 : er - 0.2 + 0.36 * j(2);
        const D = warden ? 0 : 0.9 + 0.09 * j(3); // the strides down the bank
        const scale = warden ? 1.03 : 0.95 + 0.06 * hash(i, 4, 41);
        const t0 = warden ? 1.2 : 2.0 + 0.035 * j(5); // in step, a hair apart
        const ground = (X) => w.groundY(X, Z);
        // the Warden marches on into the water; the men close up at its edge
        const plan = warden
          ? marchPlan({ xh0: 8.95, xhE: 7.05, f: -1, n: 4, t0, dt: 0.4, close: false })
          : marchPlan({ xh0: xE + D, xhE: xE, f: -1, n: 3, t0, dt: 0.4, close: true });
        const seed = 101 + i * 7;
        const opts = {
          ...plan,
          ground,
          facing: -1,
          z: 0,
          scale,
          seed,
          spearLen: warden ? 2.4 : 2.3,
          name: warden ? 'warden' : `line${r}`,
        };
        const events = plan.steps.map((s, k) => ({
          k,
          t: s.t,
          X: s.x,
          strength: k === plan.steps.length - 1 && plan.halt !== null ? 0.5 : 0.34,
        }));
        if (plan.halt !== null) {
          // the butt of the spear comes down on the stamp
          const sk = stepSkeleton(plan.halt + 0.2, opts);
          events.push({ k: 7, t: plan.halt, X: sk.weapon.butt[0], strength: 0.3 });
        }
        men.push({
          i,
          warden,
          Z,
          scale,
          look: soldierLook(seed),
          ground,
          events,
          skel: (q) => stepSkeleton(q, opts),
        });
      }
      return men;
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
    // single-frame inserts on the roll's strokes: this future flickering past. Each lands
    // on the first frame at or after its stroke, the slow early strokes hold two frames and
    // the fast late ones (under two frames apart) one, so every image is on the drum.
    const roll = HITS('roll', 0, S.rush[1]);
    const fr = Math.round(t * 24);
    let hi = -1;
    for (let i = 0; i < roll.length; i++) {
      const start = Math.ceil(roll[i] * 24 - 1e-3);
      const hold = roll[i + 1] !== undefined && (roll[i + 1] - roll[i]) * 24 > 2.2 ? 2 : 1;
      if (fr >= start && fr < start + hold) hi = i;
    }
    if (hi >= 0) this.rushInsert(f, RUSH_INSERTS[hi % RUSH_INSERTS.length], t);
    // the tunnel's lines thin out over an insert so the image reads
    const ins = hi >= 0 ? 0.3 : 1;
    focusLines(f, W, H, 240, 135, twos(t), {
      inner: 24,
      count: 150,
      width: 3,
      color: RGB.graphite,
      amount: (0.35 + 0.5 * k) * ins,
      aspect: 1.3,
      jitter: 0.9,
    });
    threadTunnel(f, W, H, 240, 135, t, {
      speed: 1.1 + 3.5 * k * k,
      amount: (0.55 + 0.45 * k) * ins,
    });
    glow(f, W, H, 240, 135, 30 + 70 * k, (0.6 + 0.4 * k) * ins);
    flash(f, W, H, smooth(0.6, 0.8, lt) * 0.97);
  }

  /**
   * One flicker of the roll: a glimpse of a shot to come, drawn as ink lines (paint stage
   * 1) so it is a drawing of the future, not the future itself.
   */
  rushInsert(f, name, t) {
    const wx = actorAt('warden', TIME.plant).X;
    switch (name) {
      case 'sun':
        hollowSun(f, W, H, 240, 135, 60, t, 1);
        break;
      case 'ford':
        this.world.render(
          f,
          t + 5,
          { x: 1.5, y: 1.4, z: -9, yaw: -0.05, pitch: -0.05, focal: 300 },
          { stage: 1, rain: 0.5 },
        );
        break;
      case 'guard': {
        const cam = lookAt(
          { x: wx - 1.65, y: 0.6, z: -2.6 },
          { x: wx - 0.36, y: 1.04, z: 0 },
          { focal: 364, roll: 0.01 },
        );
        const wd = this.clipActor('warden_level', 14, wx, 0, -1, { fb: 'wGuard', rings: 0.4 });
        this.world.render(f, 3.9, cam, { stage: 1, rain: 0.7, actors: [wd], wind: 1 });
        break;
      }
      case 'spray': {
        const cam = lookAt({ x: 1.4, y: 0.5, z: -2.1 }, { x: 2.5, y: 1.0, z: 0 }, { focal: 300 });
        this.world.render(f, 6.9, cam, {
          stage: 1,
          rain: 0.8,
          sprays: [{ X: 1.3, Z: -0.1, age: 0.5, width: 3.0, dir: 1, height: 2.4, seed: 4 }],
        });
        break;
      }
      case 'clash': {
        // white sparks and a star on the ink: the bind's contact
        for (let i = 0; i < W * H * 4; i += 4) {
          f[i] = 14;
          f[i + 1] = 12;
          f[i + 2] = 22;
        }
        sparks(f, W, H, 250, 120, t + 0.15, t, { count: 90, speed: 300, life: 0.4, seed: 8 });
        star(f, W, H, 250, 120, 44, RGB.paperHi);
        glow(f, W, H, 250, 120, 36, 0.9, PALE);
        break;
      }
      case 'crimson': {
        for (let i = 0; i < W * H * 4; i += 4) {
          f[i] = 14;
          f[i + 1] = 12;
          f[i + 2] = 22;
        }
        crescent(f, 240, 150, 0.16, 7);
        break;
      }
      case 'fall': {
        const cam = lookAt(
          { x: 3.95, y: 0.36, z: 2.2 },
          { x: 3.72, y: 0.5, z: -0.4 },
          { focal: 300, roll: 0.015 },
        );
        const ed = this.clipActor('edric_slip_fall', 16, 3.6, -0.45, 1, {
          flip: true,
          fb: 'eOver',
          Y: -0.15,
          rot: 0.5,
        });
        this.world.render(f, 12.1, cam, { stage: 1, rain: 0.75, actors: [ed], wind: 0.9 });
        break;
      }
      default: {
        const l = this.plateOf(name, { zoom: 1.15, skin: name !== 'helm' });
        if (l) this.draw(f, l, name === 'struck' ? 1 : 0, null, pageCam(240, 135, 1.1));
      }
    }
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
      { x: -5.6, z: -16, yaw: 0.11, focal: 315, roll: 0 },
      { y: 30, pitch: 0.5, z: -28 },
      { y: 1.9, pitch: -0.02 },
      k,
    );
    const [sx, sy] = shake(t, [t0], 3, 0.12);
    const cam = nudge(cam0, sx, sy);
    // the page inks itself in, in stutters, out of the white
    const stage = 2 * (1 - step(lt / 0.24, 3));
    const run = this.runner(a, TIME.run, -14, 3.44);
    const line = this.soldiers(a, cam, ['warden']);
    const actors = [run.actor, ...line.actors];
    this.world.render(f, a, cam, {
      stage,
      rain: 0.5,
      clouds: 0.55,
      actors,
      splashes: line.splashes,
      puffs: line.puffs,
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
    const line = this.soldiers(a, cam, [], { zMin: 2.2 });
    const actors = [w.actor, ...line.actors];
    const splashes = [
      ...w.falls.map((s, i) => ({ X: s.X, Z: s.Z, t0: s.t, strength: 0.6, seed: 30 + i })),
      ...line.splashes,
    ];
    this.world.render(f, a, cam, { rain: 0.6, actors, splashes, puffs: line.puffs, wind: 1 });
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
        inner: 70,
        outer: 230,
        count: 150,
        amount: 0.3 * fk,
        aspect: 1.5,
        width: 3,
        jitter: 0.5,
        color: RGB.graphite,
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
        arch: 0.95, // blades bend over in an arch: the tips sweep through the frame
        step: 1.7,
        kind: 'mixed',
        h: 1.2,
        stoneH: 0.16,
        gaps: 0.42,
        seed: 5,
        Y: 0,
      }),
    );
    // the leaves pass the lens ~3.6 times faster than the runner: dragged into streaks
    const fgV = ((actorAt('edric', t).X - actorAt('edric', t - 1 / 24).X) * cam.focal) / 0.95;
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
      foregroundSmear: -fgV,
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
    // the eye acts: as the point comes it narrows (the upper lid comes down over the iris,
    // on twos) and sets. The drawing is pushed down in a band about the lash line.
    const sq = smooth(0.06, 0.34, onN(t, 2) - t0);
    const SQ = 7; // layer px at the lash line
    const bump = (u, v) => {
      const dx = (u - 312) / 95;
      const dy = (v - 138) / 30;
      return Math.exp(-(dx * dx + dy * dy) * 1.3);
    };
    const warp = (u, v, out) => {
      out[0] = 0;
      out[1] = -SQ * sq * bump(u, v);
    };
    if (l) this.draw(f, l, 0, null, c, { warp });
    // the iris (plate px 1536x1024 -> page): the point, foreshortened, catching the light;
    // it goes down with the iris as the lid closes
    const [ix, iy] = scrPage(c, 223 * 1.0, 113 + (SQ * sq * bump(301, 152)) / 1.35);
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
    focusLines(f, W, H, ix, iy, twos(t), {
      inner: 150,
      outer: 330,
      amount: 0.5,
      aspect: 1.7,
      width: 4,
      color: RGB.graphite,
    });
  }

  // --- 7 · 32.1: over the Warden's shoulder. The thrust, on the snare -----------------
  shotOts(f, t) {
    const [t0] = S.ots;
    const a = act(t);
    const aa = onN(a, 2);
    // over the Warden's shoulder, low: near enough that Edric's slide reads as a body
    const cam0 = lookAt({ x: 6.6, y: 1.3, z: -1.6 }, { x: 1.35, y: 0.55, z: 0.05 }, { focal: 540 });
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
          inner: 60,
          outer: 250,
          count: 120,
          amount: 0.4,
          aspect: 1.4,
          width: 3,
          color: RGB.graphite,
        });
      if (aa < TIME.thrust + 0.05)
        speedLinesAlong(f, { sx: hand.x, sy: hand.y }, { sx: tip.x, sy: tip.y }, t);
    }
    if (inStop(t, STOPS) && t < TIME.thrust + 1 / 24) impact(f, W, H, { mode: 'neg' });
    void t0;
  }

  /** The spray sheet Edric throws up as he drops (one sheet, seen from every camera). */
  /**
   * The wake Edric's slide cuts through the water: from where he dropped to where he is
   * (his cell rides the blocking's path), a V of foam behind the spray.
   */
  slideWake(a) {
    const t0 = TIME.drop + 0.06;
    if (a < t0) return [];
    const aa = Math.min(a, 7.05);
    const X1 = actorAt('edric', aa).X + 0.25;
    const X0 = actorAt('edric', TIME.drop).X - 0.1;
    return [{ X0, X1, Z: 0, width: 0.75, seed: 5, alpha: 1 }];
  }

  slideSpray(a) {
    const t0 = TIME.drop + 0.12;
    if (a < t0) return [];
    return [{ X: 0.8, Z: 0.12, age: a - t0, width: 2.6, dir: 1, height: 2.2, seed: 4 }];
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
    // in the bind the pair moves as one: Edric presses and the Warden gives ground, then
    // he presses back (bindPush), both bodies carried the same way so the blades stay crossed
    const rock = BIND_SHIFT * this.bindPush(aa);
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

  /**
   * The push and give of the bind, -1..1 (+1: Edric presses and the Warden gives ground;
   * -1: the Warden presses back). Eased between held keys: a surge, a hold at its top, the
   * counter, the final lock (equal strain, trembling) where the helm will decide.
   */
  bindPush(aa) {
    if (aa <= PUSH[0][0] || aa >= PUSH[PUSH.length - 1][0]) return 0;
    for (let i = 1; i < PUSH.length; i++)
      if (aa < PUSH[i][0]) {
        const [t0, v0] = PUSH[i - 1];
        const [t1, v1] = PUSH[i];
        return lerp(v0, v1, smooth(t0, t1, aa));
      }
    return 0;
  }

  /** How far each body leans (radians, + toward screen right) at aa, on the push. */
  bindLean(aa) {
    const p = this.bindPush(aa);
    const strain = smooth(TIME.bind, TIME.decide, aa);
    const d = twos(aa); // a tremor on twos that grows toward the decision
    return {
      e: 0.015 + 0.05 * p + strain * 0.011 * Math.sin(d * 2.7),
      w: -0.015 + 0.045 * p + strain * 0.011 * Math.sin(d * 2.7 + 1.9),
    };
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
        actor: this.clipActor('edric_slide_burst', i, st.e, this.slipZ(aa), 1, {
          flip,
          rings: 0.9,
          fb: 'eCut',
          Y: this.stepUp(aa, st.e),
        }),
        splashes: [],
      };
    }
    // the slip clip's cell: his body where the bind left it
    const i = frameAt(SLIP_FALL, aa);
    const cx = this.station(10.39).e + 0.2;
    return {
      actor: this.clipActor('edric_slip_fall', i, cx, this.slipZ(aa), 1, {
        flip,
        rings: 1,
        fb: 'eOver',
        Y: o.Y ?? this.stepUp(aa, cx),
      }),
      splashes: [],
    };
  }

  /**
   * Edric's depth as he lunges onto the slick stone: it lies half a metre toward the lens
   * from the line the two fought on (so nobody stands inside it), and he steps diagonally
   * onto it (the blocking swings him toward the camera here).
   */
  slipZ(aa) {
    return -0.5 * smooth(10.28, 10.55, aa);
  }

  /** The top of the slick stone: what Edric's lead foot lands on. */
  slickTop() {
    return this.memo('slickTop', () => this.world.stones.find((q) => q.slick).top);
  }

  /**
   * Edric's card height as he steps up out of the shoal onto the slick stone (his lead foot
   * lands on its crown at the overbalance, and slips off it): the bed until 10.28, the crown
   * by 10.52.
   */
  stepUp(aa, X) {
    const bed = this.world.groundY(X, 0);
    return lerp(bed, this.slickTop(), smooth(10.28, 10.52, aa));
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
      wakes: this.slideWake(a),
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
    const slit = this.plateOf('helm', { zoom: 2.3, skin: false }) || this.helmPlate().layer;
    const c = pageCam(262, 110, 2.1 + 0.2 * lt, 0);
    this.draw(f, slit, 0, null, c);
    const [ex, ey] = scrPage(c, ...SLIT_EYE);
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
    else if (lt < 3 / 24 && c) glow(f, W, H, c[0], c[1], 40, 0.8, PALE);
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
    // the orbit: the background one way, the reeds the other (centred on the bind's rest
    // point, not on the pair, so their push and give shows against the frame)
    const ang = lerp(-0.42, -0.08, lt / (t1 - t0));
    const cam0 = orbit({ x: this.bindX(a3) - 0.15, y: 0.9, z: 0 }, 3.0, ang, 1.2, {
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
    // the bodies push and give: the trunks bend about the hips, each into the lock as it
    // presses and back as the other does, with a tremor that grows toward the decision
    const ln = this.bindLean(a3);
    bendActor(ed.actor, { pivot: HIPS.edric_slide_burst, ramp: 75, lean: ln.e });
    bendActor(wd, { pivot: HIPS.warden_yield_cut, ramp: 75, lean: ln.w });
    this.world.render(f, a, cam, {
      rain: 0.9,
      rainWind: [2.2, 0.4],
      actors: [ed.actor, wd],
      foreground: ring,
      wind: 1.4,
    });
    const c = this.contact(ed.actor, wd, cam);
    if (c) {
      // sparks grind down the shaft where the steel meets it, a fresh few each drawing
      // (threes), more as the pressure rises, thrown along the shaft and falling
      const pt = this.cardPoint(wd, cam, ...CPTS.shaft.point);
      const bt = this.cardPoint(wd, cam, ...CPTS.shaft.butt);
      const along = Math.atan2(bt.y - pt.y, bt.x - pt.x);
      const d = Math.floor(a * 8);
      const press = Math.abs(this.bindPush(a3));
      const n = Math.round(11 + 14 * press);
      for (let k = 0; k < 3; k++)
        sparks(f, W, H, c[0], c[1], a, (d - k) / 8, {
          count: n,
          speed: 160 + 100 * press,
          life: 0.34,
          seed: 100 + d - k,
          dir: along + 0.25 * (((d - k) % 3) - 1),
        });
      glow(f, W, H, c[0], c[1], 8 + 3 * press, 0.4 + 0.25 * (d % 2), PALE);
      if (d % 2) star(f, W, H, c[0], c[1], 4 + Math.round(2 * press), RGB.paperHi);
    }
    // breath, on threes: a pale puff at Edric's mouth, and the Warden's through his visor
    this.breath(f, ed.actor, cam, a3, 1);
    this.breath(f, wd, cam, a3, 2);
  }

  /** A breath: a small pale puff at Edric's mouth that forms and thins on threes. */
  breath(f, a, cam, t, seed) {
    const ph = (((t * 0.85 + seed * 0.3) % 1) + 1) % 1;
    if (ph > 0.55) return;
    // the mouth (Edric) or the visor's slit (the Warden), in cell px, and which way it drifts
    const at = { edric_slide_burst: [254, 108, 1], warden_yield_cut: [110, 92, -1] }[a.cut.key];
    if (!at) return;
    const m = this.cardPoint(a, cam, at[0], at[1]);
    const dirn = a.flip ? -at[2] : at[2];
    const r = 1.5 + ph * 7;
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y * 1.4) / r;
        if (d > 1) continue;
        const k = (1 - d) * (1 - ph / 0.55) * 0.6;
        if (k > hashDither(x, y))
          put(f, W, H, m.x + dirn * (3 + ph * 12) + x, m.y + y - ph * 3, RGB.paperHi);
      }
  }

  // --- 12 · 34.3: close-up. The helm's eye slit; a tilt; he decides ------------------
  helmPlate() {
    if (this.img.helm) {
      // cropped from the top of the painting (the crown of the helm in, the slit a third of
      // the way down); the eye is at (525, 169) of the 768 x 432 plate
      return {
        layer: this.plateOf('helm', {
          zoom: 1.6,
          skin: false,
          crop: { x: 0, y: 0, w: 1536, h: 864 },
          tag: ':top',
        }),
        eyeL: [525, 169],
      };
    }
    // fallback: the helm of the old stand-in, cropped close
    const im = this.img.soldier;
    const l = this.plate('helmCrop', im, {
      crop: { x: 150, y: 60, w: 180, h: 101 },
      zoom: 1.2,
    });
    return { layer: l, eyeL: [270 * 1.2, 115 * 1.2] };
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
    const sc = 0.7625; // layer px -> art px, overscanned so the tilt never shows the edge
    const [eu, ev] = hp.eyeL;
    const anchor = [w / 2, h * 1.05]; // the neck, below the frame
    const sk = sc * (1 + 0.02 * tilt);
    // the slit a third of the way down and a little right of centre at rest
    const tx = 292 - 10 * tilt;
    const ty = 92 + breath + 6 * tilt;
    const xf = {
      x: tx - (eu - anchor[0]) * sk,
      y: ty - (ev - anchor[1]) * sk,
      ax: anchor[0],
      ay: anchor[1],
      scale: sk,
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
    const ex = m[0] * eu + m[1] * ev + m[2];
    const ey = m[3] * eu + m[4] * ev + m[5];
    const on = a - (D + 0.12);
    if (on > 0) {
      // the flare: a star and a streak of light along the slit on the snap, then it holds
      // as a small cold point that flickers on twos
      const flare = on < 0.1 ? 10 : on < 0.2 ? 6 : 3 + ((twos(t) >> 1) % 2);
      star(f, W, H, ex, ey, flare, RGB.paperHi);
      const streak = on < 0.1 ? 34 : on < 0.2 ? 22 : 12;
      for (let q = -streak; q <= streak; q++)
        if (1 - Math.abs(q) / streak > bayer(q + 40, 3) * 0.9)
          put(f, W, H, ex + q, ey + q * -0.03, RGB.steel);
      if (on < 0.25) glow(f, W, H, ex, ey, 16, 0.6 * (1 - on / 0.25), PALE);
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
      ed.actor.Y = this.slickTop() + sl.dY;
    }
    const wd = this.wardenAt(a, aa);
    this.world.render(f, a, cam, {
      rain: 0.8,
      actors: [ed.actor, wd],
      splashes: [
        { X: 3.72, Z: -0.55, t0: TIME.stone, strength: 0.8, seed: 61 },
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
    ed.actor.Y = this.slickTop() + sl.dY * (1 - rec);
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
    // (framed to hold the Warden standing over him: the camera is turned toward his side)
    const cam = lookAt(
      { x: 4.3 - 0.05 * lt, y: 0.36 - 0.04 * lt, z: 2.9 - 0.18 * lt },
      // the camera follows him down (on ones): from his chest to the water he lands in
      { x: 3.98, y: lerp(0.62, 0.28, smooth(0.05, 0.45, lt)), z: 0.1 },
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
    const LZ = 0.1;
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
    // he stands over him and breathes: a slow chest rise (the trunk bends a hair about the
    // hips and stretches a little), a weight shift, on threes; the cloak moves by itself
    const br = Math.sin((onN(a, 3) - t0) * 3.3);
    bendActor(wd, {
      pivot: HIPS.warden_yield_cut,
      ramp: 75,
      lean: 0.014 * br + 0.006 * Math.sin((onN(a, 3) - t0) * 1.1),
    });
    wd.xf = { sy: 1 + 0.006 * br };
    // the sun is cheated round to the downstream sky (the camera has turned): only here
    const sun0 = this.world.sun;
    this.world.sun = { ...sun0, az: 3.2, el: 0.16 };
    const line = this.soldiers(a, camS, [], { stage });
    this.world.render(f, a, camS, {
      stage,
      rain: 0.75,
      actors: [ed, wd, ...line.actors],
      // droplets and the ring only (a flat body throws sheets, not a crown: below)
      splashes: [{ X: LX + 0.1, Z: LZ, t0: HIT, strength: 0.85, seed: 13 }, ...line.splashes],
      puffs: line.puffs,
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

const hashDither = (x, y) => hash(x & 63, y & 63, 5);

/**
 * A trunk bend for a clip drawing (the skin idea of engine/skin.js, reduced to one joint,
 * for the small push and give of a bind: a few degrees, well inside the +-25 deg trunk
 * limit). Everything above the hips turns about them, more the higher it is (a smooth
 * ramp), so hips and feet stay and the shoulders, arms and weapon lean together.
 * spec: { pivot: [x, y] the hips in cell px, ramp: cell px over which the bend builds,
 * lean: radians, positive = the top goes toward screen right }.
 */
class Bend {
  constructor(actor, spec) {
    this.a = actor;
    this.spec = spec;
  }

  /** Layer-space pivot, ramp and scale of the drawing in use. */
  frame() {
    const M = this.a.motionRef();
    const k = M.s;
    const { pivot, ramp } = this.spec;
    const flip = this.a.flip;
    return { Px: flip ? M.w - pivot[0] * k : pivot[0] * k, Py: pivot[1] * k, L: ramp * k };
  }

  /** Where a drawing point (layer px) is moved to. */
  fwd(lu, lv) {
    const { Px, Py, L } = this.frame();
    const lean = this.spec.lean;
    if (!lean) return [lu, lv];
    const h = clamp((Py - lv) / L);
    const phi = lean * h * h * (3 - 2 * h);
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const dx = lu - Px;
    const dy = lv - Py;
    return [Px + dx * c - dy * sn, Py + dx * sn + dy * c];
  }

  /** drawSprite's warp: where in the drawing the pixel at (u, v) is taken from. */
  warp(u, v, out) {
    const lean = this.spec.lean;
    if (!lean) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const { Px, Py, L } = this.frame();
    const h = clamp((Py - v) / L);
    const phi = lean * h * h * (3 - 2 * h);
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const dx = u - Px;
    const dy = v - Py;
    out[0] = Px + dx * c + dy * sn - u;
    out[1] = Py - dx * sn + dy * c - v;
  }
}

/** Bend an actor's drawing (see Bend). Returns the actor. */
function bendActor(actor, spec) {
  actor.bend = new Bend(actor, spec);
  actor.opts = { ...actor.opts, warp: (u, v, out) => actor.bend.warp(u, v, out) };
  return actor;
}

/**
 * A painting with its amber tan (hue 26-56 degrees, mid saturation, light) turned toward
 * peach and grey: skin snaps to the skin ramp and brass to steel instead of the ember
 * ramp's gold. Hair, cloth and everything not amber are left alone.
 */
function retoneWarm(img, hk = 0.6, sk = 0.65) {
  const c = new OffscreenCanvas(img.width, img.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i] / 255;
    const g = p[i + 1] / 255;
    const b = p[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const dd = mx - Math.min(r, g, b);
    if (mx < 0.5 || dd < 1e-6) continue;
    const s = dd / mx;
    if (s <= 0.16 || s >= 0.85) continue;
    let h;
    if (mx === r) h = (((g - b) / dd) % 6) * 60;
    else if (mx === g) h = ((b - r) / dd + 2) * 60;
    else h = ((r - g) / dd + 4) * 60;
    if (h < 0) h += 360;
    if (h <= 26 || h >= 64) continue;
    const h2 = h * hk;
    const s2 = s * sk;
    const cc = mx * s2;
    const xx = cc * (1 - Math.abs(((h2 / 60) % 2) - 1));
    const m = mx - cc;
    // hue is 15-34 degrees here: red-to-yellow sextant
    p[i] = (cc + m) * 255;
    p[i + 1] = (xx + m) * 255;
    p[i + 2] = m * 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

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
  for (let i = 0; i < 7; i++) {
    const off = (hash(i, d, 3) - 0.5) * 34;
    const u0 = hash(i, d, 4) * 0.7;
    const len = 0.12 + 0.22 * hash(i, d, 5);
    for (let k = 0; k < L * len; k++) {
      const u = u0 + k / L;
      put(f, W, H, pa.sx + dx * u + nx * off, pa.sy + dy * u + ny * off, RGB.sepia);
    }
  }
}

export const PieceClass = FordPiece;
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
