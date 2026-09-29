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
import { clamp, hash, lerp, smooth } from './engine/raster.js';
import { flash, glint, star, twos, RGB, stroke } from './engine/anime.js';
import { onN } from './engine/timing.js';
import { crane, lerpCam, lookAt, nudge, project } from './engine/world.js';
import { CampWorld } from './engine/camp_world.js';
import {
  DURATION as BLOCK_DURATION,
  FIRE,
  HITS,
  MUSIC_OFFSET as BLOCK_OFFSET,
  NOTES,
  PEOPLE,
  S,
  SET,
  THREAD,
  CAMERA,
  TIME,
  at,
  beat,
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
const MOTIONS = ['camp_edric_rise', 'camp_edric_look', 'camp_kira_map', 'camp_sera_look'];

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
  camp_kira_map: { mpp: 0.0039, cell: [309, 400], anchor: [186.2, 393], face: 1 },
  camp_sera_look: { mpp: 0.00297, cell: [307, 400], anchor: [148.1, 396], face: 1 },
};

/** Build figures near the size they are seen at (steps of about a tenth). */
const bucket = (px) => {
  const p = Math.max(10, Math.min(640, px));
  return Math.round(10 * 1.1 ** Math.round(Math.log(p / 10) / Math.log(1.1)));
};
const step = (u, n) => Math.floor(clamp(u) * n) / n;
const ease = (u) => smooth(0, 1, u);
const easeOut = (u) => 1 - (1 - clamp(u)) ** 3;

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
        { u0: 0.0, u1: 0.42, v0: 0.5, v1: 0.98, amp: 0.012, rate: 2.2 },
        { u0: 0.2, u1: 0.8, v0: 0.0, v1: 0.16, amp: 0.006, rate: 3 },
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
    const e =
      o.edric ?? this.cutActor('edricFire', ex, ez, 1, { idle: IDLE_E, t: tt, shadowW: 0.6 });
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
    const base = 0.8 + 0.2 * Math.sin(t * 0.7);
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
    const e = this.clipActor('camp_edric_look', i, ...PEOPLE.edric.seat, 1, { t });
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
    const i = frameAt(
      [
        [0, 24],
        [0.25, 30],
        [0.85, 46],
        [1.2, 50],
        [2, 60],
      ],
      onN(lt, 2),
    );
    const e = this.clipActor('camp_edric_rise', i, ...PEOPLE.edric.seat, 1, { t });
    this.renderWorld(f, t, this.shake(CAMERA.rise(lt), t), {
      actors: this.people(t, { edric: e }),
    });
  }

  /** The camera takes a small jolt on each crash (the score's clock, on ones). */
  shake(cam, t) {
    const p = pulse(t, CRASHES, 0.09);
    return nudge(cam, 2.4 * p * Math.sin(t * 90), 3 * p * Math.cos(t * 70));
  }
}

export const PieceClass = CampPiece;
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
