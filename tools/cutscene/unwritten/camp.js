// "The Night Before" (CAMP.md): bars 5-12 of "Under the Broken Sun", 12.8 s. Three people keep
// a fire on the last quiet night before a battle; a look passes between them and Edric gets
// up. Seven shots in one procedural night camp (engine/camp_world.js), staged from one flat
// plan (camp_blocking.js):
//
//    1  5.1  the sky: the Thread across the stars flares on the crash, a bead runs along it on
//            every note; tilt down past the ridge to the camp
//    2  7.1  medium-wide three-shot: Kira works, Edric stares at the flames, Sera looks up
//    3  8.1  Sera, close: the long E; a breath; on the rest her eyes come down
//    4  9.1  what she sees: the Thread, flaring on the crash, a bead on every note
//    5  10.1 Edric: his eyes lift and meet hers across the fire
//    6  11.1 Kira sees him look; the finger stops; she folds the map
//    7  11.4 Edric rises on the leading tone; the tilt up to the Thread; the hit
//
// The craft (CAMP.md): holds with life in them (breath, hair and cloth in the gusts, flicker
// on every face, embers, smoke), figures on threes in the holds and twos in the gestures,
// the camera on ones, one gesture per shot on the note, eyelines that carry the cuts, slow
// pushes, the background acting (torchbearer, grass, stars, the Thread).

import { Piece, loadImage } from './engine/piece.js';
import { makePaper } from './engine/compositor.js';
import { pulse } from './engine/score.js';
import { clamp, smooth } from './engine/raster.js';
import { flash } from './engine/anime.js';
import { onN } from './engine/timing.js';
import { nudge } from './engine/world.js';
import { CampWorld } from './engine/camp_world.js';
import { quantiseCamp } from './camp_palette.js';
import {
  DURATION as BLOCK_DURATION,
  HITS,
  MUSIC_OFFSET as BLOCK_OFFSET,
  NOTES,
  PEOPLE,
  S,
  SET,
  THREAD,
  CAMERA,
  TIME,
} from './camp_blocking.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 5;
export const MUSIC_OFFSET = BLOCK_OFFSET; // 6.4 s: bar 5
export const DURATION = BLOCK_DURATION; // at(13): 12.8 s
export { BAR } from './engine/score.js';
export { at } from './camp_blocking.js';

const DIR = '/docs/art-direction/anime-op';
const K = `${DIR}/cutouts`;

const SRC = {
  edricFire: `${K}/edric_at_fire.webp`,
  seraCamp: `${K}/sera_at_camp.webp`,
  kiraCamp: `${K}/kira_at_camp.webp`,
  standing: `${K}/edric_standing.webp`,
};
const MOTIONS = [
  'camp_edric_rise',
  'camp_edric_look',
  'camp_edric_fire',
  'camp_kira_map',
  'camp_sera_look',
];
// every drawing of Edric that came from the seated cut-out (its hair is painted auburn: retoned at load)
const EDRIC_CLIPS = ['camp_edric_rise', 'camp_edric_look', 'camp_edric_fire'];

/**
 * The still cut-outs as figures in the world: metres per source pixel and the feet anchor in
 * source px (bottom centre of the drawing's alpha). Seated figures are scaled so a seated
 * Edric is about 1.3 m to the top of his hair, Sera 1.15 m, Kira on her crate 1.45 m.
 */
const CUT = {
  edricFire: { img: 'edricFire', mpp: 0.00116, anchor: [457, 1127], face: -1 },
  seraCamp: { img: 'seraCamp', mpp: 0.00094, anchor: [480, 1230], face: 1 },
  kiraCamp: { img: 'kiraCamp', mpp: 0.00105, anchor: [500, 1385], face: 1 },
  standing: { img: 'standing', mpp: 0.001224, anchor: [475, 1462], face: -1 },
};

/**
 * The clips (MiniMax, 12 fps): metres per cell px, measured from the first drawing against the
 * cut-out it was made from. All face right.
 */
const CLIP = {
  camp_edric_rise: { mpp: 0.0045, cell: [360, 400], anchor: [83.2, 395], face: -1 },
  camp_edric_look: { mpp: 0.00342, cell: [328, 400], anchor: [110, 396], face: -1 },
  // seated by the fire: breath, a glance, the sword put out toward the flames once and drawn back
  camp_edric_fire: { mpp: 0.003337, cell: [592, 400], anchor: [348.5, 395], face: -1 },
  camp_kira_map: { mpp: 0.0039, cell: [309, 400], anchor: [186.2, 393], face: 1 },
  camp_sera_look: { mpp: 0.00297, cell: [307, 400], anchor: [148.1, 396], face: 1 },
};

/**
 * Edric's hair is dark chestnut (STYLE.md), but the seated cut-out and the clips made from it are
 * painted auburn. In the head band of each drawing (its top third when he sits, its top sixth
 * standing) reds and rusts turn toward brown: hue toward 23 degrees, a quarter less saturated,
 * a little darker. Skin (light) and cloth (not red) are left alone. `cells`: a clip's atlas
 * layout { cell: [w, h], cols, frames }, or null for a single drawing.
 */
function retoneHair(img, cells) {
  const c = new OffscreenCanvas(img.width, img.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const [cw, ch] = cells ? cells.cell : [img.width, img.height];
  const cols = cells ? cells.cols : 1;
  const n = cells ? cells.frames : 1;
  for (let f = 0; f < n; f++) {
    const ox = (f % cols) * cw;
    const oy = Math.floor(f / cols) * ch;
    let top = -1;
    let bot = -1;
    for (let yy = 0; yy < ch; yy++) {
      let any = false;
      for (let xx = 0; xx < cw; xx += 2)
        if (p[((oy + yy) * c.width + ox + xx) * 4 + 3] > 128) {
          any = true;
          break;
        }
      if (any) {
        if (top < 0) top = yy;
        bot = yy;
      }
    }
    if (top < 0) continue;
    const hh = (bot - top + 1) / ch;
    const frac = 0.16 + 0.14 * smooth(0.85, 0.55, hh);
    const y1 = top + Math.round(frac * (bot - top + 1));
    for (let yy = top; yy < y1; yy++)
      for (let xx = 0; xx < cw; xx++) {
        const i = ((oy + yy) * c.width + ox + xx) * 4;
        if (p[i + 3] < 8) continue;
        const r = p[i] / 255;
        const g = p[i + 1] / 255;
        const b = p[i + 2] / 255;
        const mx = Math.max(r, g, b);
        const dd = mx - Math.min(r, g, b);
        if (mx < 0.16 || mx > 0.72 || dd < 1e-6 || mx !== r) continue;
        const s0 = dd / mx;
        if (s0 < 0.4) continue;
        let h = ((g - b) / dd) * 60;
        if (h < 0) h += 360;
        if (h > 26 && h < 340) continue;
        if (h >= 340) h -= 360;
        const h2 = h + (23 - h) * 0.85;
        const s2 = s0 * 0.74;
        const v2 = mx * 0.9;
        // hue 0..60 sextant: r = v, g rises with hue, b = v (1 - s)
        const cc = v2 * s2;
        const m = v2 - cc;
        const X = cc * (h2 / 60);
        p[i] = (cc + m) * 255;
        p[i + 1] = (X + m) * 255;
        p[i + 2] = m * 255;
      }
  }
  x.putImageData(d, 0, 0);
  return c;
}

/** Build figures near the size they are seen at (steps of about a tenth). */
const bucket = (px) => {
  const p = Math.max(10, Math.min(640, px));
  return Math.round(10 * 1.1 ** Math.round(Math.log(p / 10) / Math.log(1.1)));
};
const ease = (u) => smooth(0, 1, u);

/** Drawing a..b of a clip, back and forth, `rate` times as fast as generated (12 fps). */
const pingpong = (t, a, b, rate) => {
  const span = b - a;
  const k = Math.floor(t * 12 * rate);
  const p = ((k % (2 * span)) + 2 * span) % (2 * span);
  return a + (p < span ? p : 2 * span - p);
};

/** A drawing schedule [[t, frame], ...] -> the drawing at t (held between keys, floored). */
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

/**
 * Edric's drawing in the wides: the idle (breath, a glance) through the tilt down, then on the
 * bar-7 beat 2 (3.6 s) the sword goes out toward the flames (drawings 36-56 of the clip, a little
 * quicker than generated), holds a beat and comes back. On twos.
 */
const EDRIC_FIRE_KEYS = [
  [0, 0],
  [3.4, 34],
  [3.55, 37],
  [4.72, 56],
  [4.8, 58],
];
const edricFireFrame = (t) => frameAt(EDRIC_FIRE_KEYS, onN(t, 2));

// the Thread's pulses: a bead runs along it on every note of the tune, and a swell on the hits
const PULSES = [
  ...NOTES.map((n) => ({ t0: n.t, k: n.dur > 0.5 ? 0.85 : 0.6, speed: 0.5, from: 0.02 })),
  ...HITS.crash.map((t0) => ({ t0, k: 1.5, speed: 0.95, from: -0.05 })),
];
const CRASHES = HITS.crash;

/** How hard the tune is sounding (0..1): each note strikes and rings, the rests are calm. */
function tuneEnergy(t) {
  let e = 0;
  for (const n of NOTES) {
    if (t < n.t || t > n.t + n.dur + 0.5) continue;
    e = Math.max(e, Math.exp(-(t - n.t) / 0.32) * (n.dur > 0.5 ? 1 : 0.7));
  }
  return e;
}

export class CampPiece extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
  }

  /** The frame, snapped to the camp's ramps (no olive earth ramp: see camp_palette.js). */
  render(out, t, { pixel = true, dither = 0.45 } = {}) {
    this.drawShot(out, this.shotAt(t), t);
    if (pixel) quantiseCamp(out, this.W, this.H, dither);
  }

  async load() {
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
    if (this.img.edricFire) this.img.edricFire = retoneHair(this.img.edricFire, null);
    for (const n of EDRIC_CLIPS)
      if (this.motionSrc[n])
        this.motionSrc[n].img = retoneHair(this.motionSrc[n].img, this.motionSrc[n].meta);
    this.build(this.params);
    this.world = new CampWorld({ paper: this.paper, W, H, set: SET });
  }

  // ------------------------------------------------------------------ figures

  /**
   * Idle life for a still cut-out: a breath (the upper body rises and falls), and the free
   * edges (hair, cloak, hem) swaying with the gusts and following through. `o`: { breath,
   * sway: [{ u0, u1, v0, v1, amp, ph }] in source orientation (0..1 of the drawing) }.
   */
  idle(t, o, flip) {
    const t3 = onN(t, 3);
    const gust = 0.55 + 0.45 * Math.sin(t3 * 1.1 + (o.seed || 0)) * Math.sin(t3 * 0.37 + 1);
    return (w, h) => (u, v, out) => {
      const fu = u / w;
      const fv = v / h;
      let dx = 0;
      let dy = 0;
      if (o.breath) {
        const b = 0.5 + 0.5 * Math.sin(t3 * 2.2 + (o.seed || 0));
        dy += o.breath * h * b * (1 - fv) ** 1.4 * smooth(0.98, 0.5, fv);
      }
      for (const z of o.sway || []) {
        const uu = flip ? 1 - fu : fu;
        const m =
          smooth(z.u1, z.u0, uu) *
          smooth(z.v0 - 0.05, z.v0 + 0.05, fv) *
          smooth(z.v1 + 0.05, z.v1 - 0.05, fv);
        if (m <= 0) continue;
        const a = z.amp * w * gust;
        const ph = t3 * (z.rate || 2.4) + fv * 4.5 + (z.ph || 0);
        dx += (flip ? -1 : 1) * m * a * (Math.sin(ph) * 0.7 + 0.45 * Math.sin(ph * 2.3 + 1));
        dy += m * a * 0.25 * Math.sin(ph * 1.3);
      }
      if (o.tilt) {
        // a head lifting about the neck: rotate what is above it (turned to face the other way for
        // a flipped drawing), the drawing's own pixels moved, not a new head
        const T = o.tilt;
        const m = smooth(T.vb, T.va, fv);
        if (m > 0) {
          const Px = (flip ? 1 - T.u : T.u) * w;
          const Py = T.v * h;
          const phi = -T.phi * m * (flip ? -1 : 1);
          const c = Math.cos(phi);
          const s = Math.sin(phi);
          const ex = u - Px;
          const ey = v - Py;
          dx += Px + ex * c - ey * s - u;
          dy += Py + ex * s + ey * c - v;
        }
      }
      out[0] = dx;
      out[1] = dy;
    };
  }

  /** A still cut-out standing (or sitting) in the world. o: { flip, idle, shadowW, gain }. */
  cutActor(key, X, Z, face, o = {}) {
    const c = CUT[key];
    const im = this.img[c.img];
    if (!im) return null;
    const flip = o.flip ?? c.face !== face;
    const H_m = im.height * c.mpp;
    let L = null;
    const self = this;
    const a = {
      X,
      Z,
      Y: o.Y,
      height: H_m,
      flip,
      key,
      shadowW: o.shadowW ?? 0.55,
      gain: o.gain,
      hueHold: o.hold,
      rim: o.rim,
      layerFor: (px) => (L = self.figure(`${key}`, im, bucket(px), { flip, seed: 5 })),
      place: (x, y, s) => {
        const k = L.st.h / im.height;
        const ax = flip ? L.st.w - c.anchor[0] * k : c.anchor[0] * k;
        return { x, y, ax, ay: c.anchor[1] * k, scale: s };
      },
      xf: o.rot ? { rot: o.rot } : undefined,
    };
    Object.defineProperty(a, 'opts', {
      get: () =>
        o.idle && L ? { warp: this.idle(o.t ?? 0, o.idle, flip)(L.st.w, L.st.h) } : undefined,
    });
    return a;
  }

  /** A clip's drawing i standing in the world (the cell's anchor at (X, Z)). */
  clipActor(name, i, X, Z, face, o = {}) {
    if (!this.motionSrc?.[name]) return null;
    const C = CLIP[name];
    const flip = o.flip ?? C.face !== face;
    let M = null;
    const a = {
      X,
      Z,
      Y: o.Y,
      height: C.cell[1] * C.mpp,
      cell: C.cell,
      flip,
      shadowW: o.shadowW ?? 0.55,
      gain: o.gain,
      hueHold: o.hold,
      rim: o.rim,
      layerFor: (px) => {
        M = this.motion(name, bucket(px), { flip });
        return M.layer(i);
      },
      place: (x, y, s) => M.place(x, y, s),
      xf: o.rot ? { rot: o.rot } : undefined,
    };
    Object.defineProperty(a, 'opts', {
      get: () => (o.idle && M ? { warp: this.idle(o.t ?? 0, o.idle, flip)(M.w, M.h) } : undefined),
    });
    return a;
  }

  // ------------------------------------------------------------------ the three at the fire

  /**
   * The people, at time t, as world actors, from the blocking. Each uses a clip while it
   * acts and a still with idle life while it holds. `pose` overrides per person for a shot.
   */
  people(t, o = {}) {
    const tt = onN(t, o.twos ?? 3);
    const list = [];
    const [ex, ez] = PEOPLE.edric.seat;
    const [sx, sz] = PEOPLE.sera.seat;
    const [kx, kz] = PEOPLE.kira.seat;
    const IDLE_E = {
      seed: 1,
      breath: 0.011,
      sway: [
        { u0: 1.0, u1: 0.55, v0: 0.4, v1: 0.98, amp: 0.012, rate: 2.2 },
        { u0: 0.45, u1: 0.1, v0: 0.0, v1: 0.16, amp: 0.006, rate: 3 },
      ],
    };
    const IDLE_S = {
      seed: 2,
      breath: 0.008,
      sway: [
        { u0: 0.0, u1: 0.4, v0: 0.06, v1: 0.75, amp: 0.016, rate: 1.9, ph: 1 },
        { u0: 0.5, u1: 1.0, v0: 0.5, v1: 0.99, amp: 0.006, rate: 2.5 },
      ],
    };
    const IDLE_K = {
      seed: 3,
      breath: 0.008,
      sway: [
        { u0: 0.0, u1: 0.4, v0: 0.0, v1: 0.3, amp: 0.012, rate: 3.1, ph: 2 },
        { u0: 0.0, u1: 0.4, v0: 0.55, v1: 0.95, amp: 0.012, rate: 2.2 },
      ],
    };
    // Edric by the fire: his own clip (breath, a glance, the sword put out toward the flames once
    // on a beat and drawn back); the still cut-out with breath and sway is the fallback
    const e =
      o.edric ??
      this.clipActor('camp_edric_fire', edricFireFrame(t), ex + 0.36, ez, 1, {
        t: tt,
        hold: 0.85,
        shadowW: 0.6,
      }) ??
      this.cutActor('edricFire', ex, ez, 1, { idle: IDLE_E, t: tt, shadowW: 0.6, hold: 0.85 });
    // Sera and Kira hold on their clips' first drawings (their own hair, breath and hands, slowly
    // back and forth); the still cut-outs are the fallback
    const s =
      o.sera ??
      this.clipActor('camp_sera_look', pingpong(tt, 0, 6, 0.5), sx, sz, -1, {
        idle: { seed: 2, breath: 0.004 },
        t: tt,
      }) ??
      this.cutActor('seraCamp', sx, sz, -1, { idle: IDLE_S, t: tt, shadowW: 0.55 });
    const k =
      o.kira ??
      this.clipActor('camp_kira_map', pingpong(tt, 0, 22, 0.55), kx, kz, -1, {
        idle: { seed: 3, breath: 0.004 },
        t: tt,
        gain: 1.2,
      }) ??
      this.cutActor('kiraCamp', kx, kz, -1, { idle: IDLE_K, t: tt, shadowW: 0.55 });
    for (const a of [e, s, k]) if (a) list.push(a);
    return list;
  }

  // ------------------------------------------------------------------ the world, per frame

  /** Render the world with the scene's standing options. */
  renderWorld(f, t, cam, o = {}) {
    const thread = {
      cfg: THREAD,
      energy: tuneEnergy(t),
      k: (o.threadK ?? 0.85) + 0.7 * pulse(t, CRASHES, 0.3),
      pulses: PULSES,
    };
    this.world.torchOn = true;
    this.world.render(f, t, cam, {
      wind: o.wind ?? 1,
      thread,
      actors: o.actors ?? [],
      foreground: o.foreground,
      smoke: o.smoke,
      embers: o.embers,
      flame: o.flame,
      starK: o.starK,
      fireK: o.fireK,
    });
  }

  // ------------------------------------------------------------------ the shots

  makeShots() {
    const L = [];
    const shot = (name, [from, to], draw) => L.push({ name, from, to, draw });
    shot('crane', S.crane, (f, t) => this.shotCrane(f, t));
    shot('three', S.three, (f, t) => this.shotThree(f, t));
    shot('sera', S.sera, (f, t) => this.shotSera(f, t));
    shot('sky', S.sky, (f, t) => this.shotSky(f, t));
    shot('edric', S.edric, (f, t) => this.shotEdric(f, t));
    shot('kira', S.kira, (f, t) => this.shotKira(f, t));
    shot('rise', S.rise, (f, t) => this.shotRise(f, t));
    return L;
  }

  // --- 1 · the sky, tilt down to the camp -----------------------------------------------
  shotCrane(f, t) {
    const lt = t - S.crane[0];
    this.renderWorld(f, t, this.shake(CAMERA.crane(lt), t), { actors: this.people(t) });
    if (lt < 2 / 24) flash(f, W, H, 0.75 * (1 - lt * 12));
  }

  // --- 2 · the three-shot ---------------------------------------------------------------
  shotThree(f, t) {
    const lt = t - S.three[0];
    this.renderWorld(f, t, CAMERA.three(lt), { actors: this.people(t) });
  }

  // --- 3 · Sera ---------------------------------------------------------------------------
  shotSera(f, t) {
    const lt = t - S.sera[0];
    // the long E: eyes up, a breath (the clip's first drawings); on the rest her eyes come down
    const i = frameAt(
      [
        [0, 0],
        [0.8, 6],
        [0.83, 8],
        [1.5, 18],
        [1.6, 19],
      ],
      onN(lt, lt < 0.8 ? 3 : 2),
    );
    const s = this.clipActor('camp_sera_look', i, ...PEOPLE.sera.seat, -1, {
      rim: 1.4,
      gain: 1.5,
      t,
    });
    const cam = CAMERA.sera(lt);
    this.renderWorld(f, t, cam, { actors: this.people(t, { sera: s }) });
    // the Thread in her eye: a small pale glint while she looks up at it, going out as the lid comes down
    const eye = this.clipPoint(s, cam, 163 + Math.min(i, 8) * 0.4, 46 + Math.min(i, 8) * 0.5);
    if (eye) {
      const k = clamp(1 - (i - 3) / 5) * (0.75 + 0.25 * tuneEnergy(t) + 0.1 * Math.sin(t * 9));
      if (k > 0.1) {
        const x = Math.round(eye[0]);
        const y = Math.round(eye[1]);
        for (const [dx, dy, a] of [
          [0, 0, 1],
          [1, 0, 0.8],
          [0, 1, 0.6],
          [-1, 0, 0.35 * k],
          [0, -1, 0.35 * k],
          [1, 1, 0.3],
        ]) {
          const j = ((y + dy) * W + x + dx) * 4;
          const w = a * clamp(k * 1.2);
          f[j] += (255 - f[j]) * w;
          f[j + 1] += (236 - f[j + 1]) * w;
          f[j + 2] += (176 - f[j + 2]) * w;
        }
      }
    }
  }

  /** A clip actor's cell point (u, v) on the screen, after the world has drawn it. */
  clipPoint(a, cam, u, v) {
    if (!a) return null;
    const { m, st } = this.world.cardBox(a, cam);
    const k = st.h / a.cell[1];
    const lu = a.flip ? st.w - u * k : u * k;
    const lv = v * k;
    return [m[0] * lu + m[1] * lv + m[2], m[3] * lu + m[4] * lv + m[5]];
  }

  // --- 4 · the Thread -----------------------------------------------------------------------
  shotSky(f, t) {
    const lt = t - S.sky[0];
    this.renderWorld(f, t, this.shake(CAMERA.sky(lt), t), { actors: [] });
  }

  // --- 5 · Edric ---------------------------------------------------------------------------
  shotEdric(f, t) {
    const lt = t - S.edric[0];
    // he stares at the fire; feels it; his head snaps up (twos), then settles and meets her look
    const i = frameAt(
      [
        [0, 0],
        [0.4, 2],
        [0.7, 18],
        [1.6, 34],
      ],
      onN(lt, lt < 0.4 ? 3 : 2),
    );
    const e = this.clipActor('camp_edric_look', i, ...PEOPLE.edric.seat, 1, { t, hold: 0.85 });
    this.renderWorld(f, t, CAMERA.edric(lt), { actors: this.people(t, { edric: e }) });
  }

  // --- 6 · Kira -----------------------------------------------------------------------------
  shotKira(f, t) {
    const lt = t - S.kira[0];
    const i = frameAt(
      [
        [0, 22],
        [0.35, 32],
        [0.75, 36],
        [1.2, 46],
      ],
      onN(lt, 2),
    );
    const kk = this.clipActor('camp_kira_map', i, ...PEOPLE.kira.seat, -1, { t, gain: 1.3 });
    this.renderWorld(f, t, CAMERA.kira(lt), { actors: this.people(t, { kira: kk }) });
  }

  // --- 7 · he rises -------------------------------------------------------------------------
  shotRise(f, t) {
    const lt = t - S.rise[0];
    const hitLt = TIME.hit - S.rise[0];
    let e;
    if (lt < hitLt) {
      const i = frameAt(
        [
          [0, 2],
          [1.0, 22],
          [1.3, 26],
          [2, 36],
        ],
        onN(lt, 2),
      );
      e = this.clipActor('camp_edric_rise', i, ...PEOPLE.edric.seat, 1, { t, hold: 0.85 });
    } else {
      // the big hit: a paper-white flash covers the change of drawing, and he stands as drawn,
      // his face lifted to the Thread (the standing cut-out; its head rises a little more and
      // holds), breathing, the cloak in the wind. Placed so his head is where the clip's was.
      const tt = onN(t, 3);
      const rise = ease((lt - hitLt) / 0.5);
      const [ex, ez] = PEOPLE.edric.seat;
      e = this.cutActor('standing', ex - 0.222, ez, 1, {
        hold: 0.85,
        t: tt,
        idle: {
          seed: 4,
          breath: 0.006,
          sway: [{ u0: 1.0, u1: 0.58, v0: 0.12, v1: 0.75, amp: 0.012, rate: 2.2 }],
          tilt: { u: 0.36, v: 0.16, va: 0.11, vb: 0.19, phi: 0.16 * rise },
        },
      });
    }
    this.renderWorld(f, t, this.shake(CAMERA.rise(lt), t), {
      actors: this.people(t, { edric: e }),
    });
    // the hit: two frames of paper-white over the whole picture (high, so it stays flat: a middle
    // value over a dark frame breaks into a halftone screen)
    const since = lt - hitLt;
    if (since >= 0 && since < 2 / 24) flash(f, W, H, since < 1 / 24 ? 0.95 : 0.8);
  }

  /** The camera takes a small jolt on each crash (the score's clock, on ones). */
  shake(cam, t) {
    const p = pulse(t, CRASHES, 0.09);
    return nudge(cam, 2.4 * p * Math.sin(t * 90), 3 * p * Math.cos(t * 70));
  }
}

export const PieceClass = CampPiece;
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
