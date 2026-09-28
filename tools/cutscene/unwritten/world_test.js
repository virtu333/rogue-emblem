// The world test: engine/world.js on its own, bars 28.3-36 (13.6 s, the Ford's slot),
// with six camera moves taken from the Ford's shot list (FORD.md) and placeholder
// actors standing and wading, so depth, water, wind, rain, reflections and waterlines
// can be judged before the real shots are made.
//
//   28.3  crane down from the Hollow Sun through the clouds to the upstream wide (shot 2)
//   30    low at the water: the Warden steps into the shallows, the line behind (shot 3)
//   31    tracking profile at running speed, stones and reeds passing the lens (shot 5);
//         the slide throws up the spray sheet (shot 8)
//   32    a slow orbit round the bind; the clash's shock ring on 32.1 (shots 10-11)
//   34    the whip pan across the line (shot 13)
//   35    overhead, looking down into the water where he fell; the paint lifts (shot 16)

import { Piece } from './engine/piece.js';
import { T, BAR, BEAT } from './engine/score.js';
import { clamp, lerp, smooth } from './engine/raster.js';
import { easeInOut, easeOut } from './engine/anime.js';
import { World, crane, foregroundRow, impulse, lookAt, orbit, smearFrame } from './engine/world.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const MUSIC_OFFSET = 44.0; // bar 28, beat 3
export const DURATION = T(37) - MUSIC_OFFSET; // 13.6 s
export { BAR };
/** Piece-local time of bar n, beat b. */
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;
const step = (u, n) => Math.floor(clamp(u) * n) / n;

const K = '/docs/art-direction/anime-op/cutouts';
const SRC = {
  edric: `${K}/edric_standing.webp`,
  warden: `${K}/empire_soldier.webp`,
  march: `${K}/empire_soldier_march.webp`,
};

/** Build figures near the size they are seen at (in steps of about a tenth). */
const bucket = (px) => {
  const p = Math.max(12, Math.min(480, px));
  return Math.round(12 * 1.1 ** Math.round(Math.log(p / 12) / Math.log(1.1)));
};

// Edric's run along the ford (FORD.md blocking): X by time
const EDRIC = [
  [0, -14],
  [at(29), -14],
  [at(30), -8.5],
  [at(31), -6],
  [at(31, 4), -3],
  [at(32, 2), -2.2],
];
const edricX = (t) => {
  for (let i = 1; i < EDRIC.length; i++)
    if (t < EDRIC[i][0])
      return lerp(
        EDRIC[i - 1][1],
        EDRIC[i][1],
        (t - EDRIC[i - 1][0]) / (EDRIC[i][0] - EDRIC[i - 1][0]),
      );
  return EDRIC[EDRIC.length - 1][1];
};

export class WorldTest extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
  }

  async load() {
    await this.loadImages(SRC);
    await this.loadMotions('/docs/art-direction/anime-op/motion', ['edric_run']);
    this.build(this.params);
    this.world = new World({ paper: this.paper, W, H });
  }

  // ------------------------------------------------------------------ the actors

  fig(name, o = {}) {
    return (px) => this.figure(`${name}${o.flip ? ':f' : ''}`, this.img[name], bucket(px), o);
  }

  /** Edric: the generated run while he runs, else the standing cut-out. */
  edric(t, o = {}) {
    const X = o.X ?? edricX(t);
    const running = o.run ?? (t > at(29) && t < at(32, 2));
    if (running && this.motionSrc.edric_run) {
      let M = null;
      return {
        X,
        Z: o.Z ?? 0,
        height: 2.05, // the clip's cell, with its margin
        layerFor: (px) => {
          M = this.motion('edric_run', bucket(px));
          return M.layer(M.index(t - at(29), { rate: 1.05 }));
        },
        place: (x, y, s) => M.place(x, y, s),
        seed: 1,
      };
    }
    return { X, Z: o.Z ?? 0, height: 1.86, layerFor: this.fig('edric'), seed: 1, ...o };
  }

  warden(X, Z = 0, o = {}) {
    return { X, Z, height: 2.6, layerFor: this.fig('warden'), seed: 2, ...o };
  }

  /** The Empire's line on the far bank. */
  line() {
    const out = [];
    for (let k = 0; k < 5; k++) {
      const X = 11 + k * 0.85 + (k % 2) * 0.3;
      const Z = -1.2 + k * 0.9;
      out.push({ X, Z, height: 2.5, layerFor: this.fig('march', { flip: true }), seed: 10 + k });
    }
    return out;
  }

  // ------------------------------------------------------------------ the shots

  makeShots() {
    const S = [];
    const shot = (name, from, to, draw) => S.push({ name, from, to, draw });
    const world = () => this.world;

    // --- 28.3: crane down from the Hollow Sun to the upstream wide -----------------
    shot('crane', 0, at(30), (f, t) => {
      const k = easeInOut(t / at(30));
      const cam = crane(
        { x: -1.5, z: -26, yaw: 0.02, focal: 300 },
        { y: 16, pitch: 0.46, x: -1, z: -31 },
        { y: 2.2, pitch: -0.015 },
        k,
      );
      const stage = 2 * (1 - step(t / 0.45, 4));
      world().render(f, t, cam, {
        stage,
        rain: 0.5,
        actors: [this.edric(t), this.warden(9.2, 0.4), ...this.line()],
      });
    });

    // --- 30.1: low at the water, the Warden steps into the shallows ----------------
    shot('low', at(30), at(31), (f, t) => {
      const lt = t - at(30);
      const u = lt / (at(31) - at(30));
      const cam = lookAt(
        { x: lerp(5.3, 5.9, u), y: 0.34, z: lerp(-2.9, -2.4, u) },
        { x: 7.9, y: 0.55, z: 0.3 },
        { focal: 380 },
      );
      const wx = lerp(8.7, 6.6, smooth(0.0, 0.75, u));
      const steps = [at(30) + 0.25, at(30) + 0.8, at(30) + 1.3];
      world().render(f, t, cam, {
        rain: 0.6,
        actors: [this.warden(wx, 0.3, { rings: 0.9 }), ...this.line()],
        splashes: steps.map((t0, i) => ({
          X: wx - 0.15 + i * 0.05,
          Z: 0.3,
          t0,
          strength: 0.45,
          seed: i + 3,
        })),
      });
    });

    // --- 31.1: tracking profile, running speed; the slide throws up the spray -------
    const fg = foregroundRow({
      z: -3.9,
      x0: -12,
      x1: 4,
      step: 1.25,
      kind: 'mixed',
      h: 1.2,
      seed: 5,
      Y: 0,
    });
    const slide = at(31, 4) - 0.05; // the slide throws up the spray before the cut
    shot('track', at(31), at(32), (f, t) => {
      const X = edricX(t);
      const cam = { x: X + 0.5, y: 1.0, z: -5.4, yaw: 0, pitch: -0.035, roll: 0, focal: 320 };
      const falls = [];
      for (let k = 0; k < 10; k++) {
        const t0 = at(31) - 0.4 + k * BEAT * 0.5;
        if (t0 > t) break;
        falls.push({
          X: edricX(t0) + (k % 2 ? 0.1 : -0.1),
          Z: k % 2 ? 0.12 : -0.1,
          t0,
          strength: 0.6,
          seed: 20 + k,
        });
      }
      world().render(f, t, cam, {
        rain: 0.6,
        actors: [this.edric(t)],
        splashes: falls.slice(-4),
        foreground: fg,
        sprays:
          t > slide ? [{ X: X + 0.6, Z: 0.35, age: t - slide, width: 2.4, dir: 1, seed: 4 }] : [],
      });
    });

    // --- 32.1: the bind, a slow orbit; the clash's shock ring --------------------
    const clash = at(32) + 0.12;
    const ring = [];
    for (let k = 0; k < 9; k++) {
      const a = -1.25 + k * 0.28;
      const stone = k % 4 === 2;
      ring.push({
        X: 3.3 + Math.sin(a) * 3.1,
        Z: -Math.cos(a) * 3.1,
        kind: stone ? 'stone' : 'reeds',
        h: stone ? 0.22 : 1.3,
        seed: 40 + k,
        Y: 0,
      });
    }
    shot('orbit', at(32), at(34), (f, t) => {
      const lt = t - at(32);
      const a = -0.6 + 0.24 * lt;
      const cam = orbit({ x: 3.3, y: 1.15, z: 0 }, 4.5, a, 1.45, { focal: 360 });
      world().render(f, t, cam, {
        rain: 0.85,
        rainWind: [2.5, 0.5],
        impulses: [impulse(3.3, 0, clash, 1.2)],
        actors: [this.edric(t, { X: 2.85, run: false }), this.warden(3.75, 0.05)],
        splashes: [{ X: 3.3, Z: 0, t0: clash, strength: 1.1, seed: 9 }],
        foreground: ring,
      });
    });

    // --- 34.1: the whip pan across the line ----------------------------------------
    const whip0 = at(34) + 0.3;
    const whip1 = whip0 + 0.3;
    const whipCam = (t) => {
      const w = smooth(whip0, whip1, t);
      const settle = Math.exp(-(t - whip1) * 6) * Math.sin((t - whip1) * 14) * 0.06;
      const a = lerp(0.35, Math.PI - 0.35, w) + (t > whip1 ? settle : 0) + 0.05 * (t - at(34));
      return orbit({ x: 3.6, y: 1.1, z: 0 }, 4.2, a, 1.35, { focal: 340 });
    };
    shot('whip', at(34), at(35), (f, t) => {
      const cam = whipCam(t);
      const lean = smooth(at(34, 3), at(35), t);
      world().render(f, t, cam, {
        rain: 0.7,
        actors: [
          this.edric(t, { X: 3.0 + 0.5 * lean, run: false, xf: { rot: 0.35 * lean } }),
          this.warden(lerp(3.8, 4.6, smooth(whip0, whip1 + 0.2, t)), 0.05),
        ],
      });
      // the eye can't follow: smear along the turn
      const prev = whipCam(t - 1 / 24);
      let dyaw = cam.yaw - prev.yaw;
      dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
      smearFrame(f, W, H, -dyaw * cam.focal * 0.8, 0);
    });

    // --- 35.1: overhead into the water where he fell; the paint lifts off ---------
    shot('overhead', at(35), DURATION, (f, t) => {
      const lt = t - at(35);
      const u = lt / (DURATION - at(35));
      const cam = {
        x: 4.1,
        y: lerp(6.2, 3.6, easeOut(u)),
        z: lerp(-2.6, -1.6, u),
        yaw: 0.15,
        pitch: lerp(-1.42, -1.12, easeOut(u)),
        roll: 0.28 * u,
        focal: 330,
      };
      const lift = at(36, 4) - 0.2;
      const stage = t > lift ? step((t - lift) / (DURATION - lift - 0.05), 6) * 3 : 0;
      world().render(f, t, cam, {
        stage,
        rain: 0.75,
        actors: [
          {
            X: 4.2,
            Z: 0.1,
            height: 1.86,
            layerFor: this.fig('edric'),
            flat: { yaw: -1.9 },
            sink: 0.3,
          },
        ],
        splashes: [{ X: 4.3, Z: 0.1, t0: at(35) + 0.05, strength: 1.6, seed: 12 }],
      });
    });
    return S;
  }
}

export const PieceClass = WorldTest;
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
