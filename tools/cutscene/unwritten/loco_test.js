// Locomotion test: the end of the treadmill (FORD.md, problem 1).
//
// Five short shots of generated clips moving through a plain procedural ground, so a
// foot that slides can't hide. The ground has a tick every 30 px and a post every 120 px,
// stones between them, and a footprint where each foot landed. The runner is placed by
// engine/locomotion.js: the world stands still, the runner travels through it exactly as
// far as the planted foot needs, at the speed the shot asks for (rateForSpeed).
//
//   1  Edric, the camera on him (the ground runs past)
//   2  Edric, a static camera (he crosses the frame)
//   3  Sera, the camera on her
//   4  Rowan's gallop, the camera on him
//   5  the march, a static camera
//
// Watch one thing: the planted boot stays on its footprint until it lifts. A white cross
// marks the detected planted foot (SHOW_MARKERS), a crimson one the footprint it landed on.
//
//   node tools/cutscene/render.mjs --piece loco_test --stills 0.5,1,2 --out <dir>

import { Piece } from './engine/piece.js';
import { T, BAR } from './engine/score.js';
import { hash, hexToRgb } from './engine/raster.js';
import { RGB, put, splash } from './engine/anime.js';
import { Stride, lockToWorld, marksInView, rateForSpeed } from './engine/locomotion.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const MUSIC_OFFSET = T(FIRST_BAR, 3); // 44.0 s into the track (bar 28.3)
export const DURATION = T(33, 3) - MUSIC_OFFSET; // 8 s
export { BAR };
/** Piece-local time of bar n, beat b. */
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;

/** Debug markers on the detected planted foot and on the footprint it landed on. */
const SHOW_MARKERS = true;

const GROUND_Y = 232; // the page y of the ground line: the feet stand here
const SPACING = 30; // world px between ticks
const CLIPS = ['edric_run', 'sera_run', 'rowan_gallop', 'march'];
const DUST = [RGB.sepia, RGB.graphite, hexToRgb('#938c55')];

// One entry per shot. speed: art px/s the figure should travel (rateForSpeed turns it into
// the playback rate). follow: 1 camera on the runner, 0 a static camera. x0: the runner's
// world x at the start of the shot.
const SPECS = [
  { name: 'edric_follow', clip: 'edric_run', h: 214, beats: 4, x0: 200, follow: 1, speed: 250 },
  { name: 'edric_static', clip: 'edric_run', h: 214, beats: 5, x0: -100, follow: 0, speed: 330 },
  { name: 'sera_follow', clip: 'sera_run', h: 200, beats: 4, x0: 210, follow: 1, speed: 230 },
  { name: 'rowan_follow', clip: 'rowan_gallop', h: 190, beats: 3, x0: 200, follow: 1, speed: 420 },
  { name: 'march_static', clip: 'march', h: 200, beats: 4, x0: 120, follow: 0, speed: 100 },
];

/** The ground: a tint below the line, ticks and posts every SPACING px, stones. */
function drawGround(f, ground) {
  for (let y = GROUND_Y; y < H; y++)
    for (let x = 0; x < W; x++) put(f, W, H, x, y, RGB.sepia, y === GROUND_Y ? 0.6 : 0.14);
  for (const wx of marksInView(SPACING, ground, W, 12)) {
    const m = Math.round(wx / SPACING);
    const x = Math.round(wx + ground);
    const post = ((m % 4) + 4) % 4 === 0;
    for (let d = 1; d <= (post ? 16 : 6); d++)
      put(f, W, H, x, GROUND_Y + d, post ? RGB.ink : RGB.sepia);
    if (hash(m, 3, 9) < 0.55) {
      // a stone: a little dome on the line
      const w = 2 + Math.floor(hash(m, 4, 9) * 4);
      const off = Math.round((hash(m, 5, 9) - 0.5) * (SPACING - 2 * w - 4));
      for (let dx = -w; dx <= w; dx++) {
        const hgt = Math.round(Math.sqrt(1 - (dx / (w + 0.5)) ** 2) * (w * 0.7 + 1));
        for (let dy = 0; dy < hgt; dy++) put(f, W, H, x + off + dx, GROUND_Y - dy, RGB.graphite);
      }
    }
  }
}

function cross(f, x, y, r, c) {
  for (let d = -r; d <= r; d++) {
    put(f, W, H, x + d, y, c);
    put(f, W, H, x, y + d, c);
  }
}

export class PieceClass extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
  }

  async load() {
    await this.loadImages({});
    await this.loadMotions('/docs/art-direction/anime-op/motion', CLIPS);
    this.build(this.params);
  }

  /** The Motion and its Stride for a shot spec (built once). */
  rig(s) {
    const M = this.motion(s.clip, s.h);
    if (!M) return null;
    return this.memo(`rig:${s.name}`, () => {
      const rate = rateForSpeed(M, s.speed);
      return { M, S: new Stride(M, { rate }) };
    });
  }

  makeShots() {
    const shots = [];
    let beat = 0;
    for (const s of SPECS) {
      const from = at(FIRST_BAR, 3 + beat);
      beat += s.beats;
      const to = at(FIRST_BAR, 3 + beat);
      shots.push({ name: s.name, from, to, draw: (f, t) => this.drawRun(f, t - from, s) });
    }
    return shots;
  }

  drawRun(f, lt, s) {
    const rig = this.rig(s);
    if (!rig) return;
    const { M, S } = rig;
    const w = lockToWorld(S, lt, { x0: s.x0, follow: s.follow });
    drawGround(f, w.ground);

    // where each foot landed: a footprint locked to the world
    const falls = S.footfallsIn(lt - S.period * 2.2, lt + 1e-6);
    const ay = M.place(0, 0).ay;
    const pageX = (ff) => s.x0 + ff.world + w.ground;
    for (const ff of falls) {
      const px = Math.round(pageX(ff));
      for (let d = -3; d <= 3; d++) put(f, W, H, px + d, GROUND_Y + 3, RGB.ink);
    }

    // the figure, standing on the line
    const i = S.index(lt);
    const xf = M.place(w.x, GROUND_Y);
    this.draw(f, M.layer(i), 0, xf);

    // dust off each landing, hung on the world so it stays where the foot came down
    for (const ff of falls)
      splash(f, W, H, pageX(ff), GROUND_Y + ff.foot[1] - ay, lt, ff.u, {
        count: 26,
        speed: 80,
        dir: S.dir >= 0 ? -Math.PI * 0.8 : -Math.PI * 0.2,
        spread: 0.6,
        seed: 40 + ff.i,
        colors: DUST,
        life: 0.55,
        gravity: 130,
      });

    if (SHOW_MARKERS) {
      const last = falls[falls.length - 1];
      if (last) cross(f, Math.round(pageX(last)), GROUND_Y + 3, 4, RGB.crimson);
      const p = S.plantedFoot(i);
      if (p)
        cross(f, Math.round(xf.x + p[0] - xf.ax), Math.round(xf.y + p[1] - xf.ay), 2, RGB.paperHi);
    }
  }
}

export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
