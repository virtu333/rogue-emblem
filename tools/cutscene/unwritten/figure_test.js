// Figure test: the Empire's rank and file drawn in code (engine/figure.js), judged against the
// GPT cut-out. Five shots, 8 s, on the score's clock (bar 28 beat 3, the Ford's slot):
//
//   1  one soldier walking, side view, ~150 px, the camera on him (the ground runs past, so a
//      sliding foot can't hide), next to the GPT cut-out at the same height
//   2  the Warden's thrust from skeletonAt('warden', t), ~120 px: anticipation, snap, recover
//   3  the line of eight stepping in unison, from the blocking (t 2.1-3.7)
//   4  a parade of 30 at three depths, in lockstep, paler and smaller with distance
//   5  the 3/4 view: a soldier turning on the march (yaw 0 -> 0.9), and a group at 3/4
//
//   node tools/cutscene/render.mjs --piece figure_test --stills 0.5,2,4,6 --out <dir>

import { Piece } from './engine/piece.js';
import { T, BAR } from './engine/score.js';
import { RGB, put, onTwos } from './engine/anime.js';
import { clamp, lerp, smooth } from './engine/raster.js';
import { PARADE_ROWS, drawActor, drawLine, drawParade, fordLine, marchSkeleton, soldierLook } from './engine/figure.js';
import { LINE, TIME, bedY, skeletonAt } from './ford_blocking.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const MUSIC_OFFSET = 44.0; // bar 28, beat 3
export const DURATION = 8.0;
export { BAR };
/** Piece-local time of bar n, beat b. */
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;
const BEAT = BAR / 4;

const K = '/docs/art-direction/anime-op/cutouts';
const SRC = { march: `${K}/empire_soldier_march.webp` };

// ------------------------------------------------------------------ a 3x5 pixel font

const GLYPHS = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  Y: '101101010010010',
  0: '111101101101111',
  1: '010110010010111',
  2: '110001010100111',
  3: '110001010001110',
  4: '101101111001001',
  5: '111100110001110',
  6: '011100111101111',
  7: '111001010010010',
  8: '111101111101111',
  9: '111101111001110',
  '/': '001001010100100',
  '-': '000000111000000',
  '.': '000000000000010',
  ' ': '000000000000000',
};
function text(f, x, y, s, c) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let i = 0; i < 15; i++)
      if (g[i] === '1') put(f, W, H, cx + (i % 3), y + Math.floor(i / 3), c);
    cx += 4;
  }
}

// ------------------------------------------------------------------------ the ground

/** A ground line at screen row y with ticks at world positions (m) every `every`, and stones. */
function ground(f, y, s, ax, sx, every = 2, thick = 2, tone = RGB.sepia) {
  for (let x = 0; x < W; x++) for (let k = 0; k < thick; k++) put(f, W, H, x, y + k, tone, 0.85);
  const x0 = Math.floor(ax - sx / s) - 1;
  const x1 = Math.ceil(ax + (W - sx) / s) + 1;
  for (let X = Math.ceil(x0 / every) * every; X <= x1; X += every) {
    const px = Math.round(sx + (X - ax) * s);
    const big = Math.round(X / every) % 4 === 0;
    for (let d = 2; d <= (big ? 9 : 4); d++) put(f, W, H, px, y + d, tone, 0.55);
  }
}

export class PieceClass extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
  }

  async load() {
    await this.loadImages(SRC);
    this.build(this.params);
  }

  makeShots() {
    const beats = [
      ['walk', 5, (f, t) => this.shotWalk(f, t)],
      ['thrust', 4, (f, t) => this.shotThrust(f, t)],
      ['line', 4, (f, t) => this.shotLine(f, t)],
      ['parade', 4, (f, t) => this.shotParade(f, t)],
      ['threeQuarter', 3, (f, t) => this.shotThreeQuarter(f, t)],
    ];
    let b = 0;
    return beats.map(([name, n, draw]) => {
      const from = b * BEAT;
      b += n;
      const to = b * BEAT;
      return { name, from, to, draw: (f, t) => draw(f, t - from, t) };
    });
  }

  // ------------------------------------------------------------ 1: walk beside the cut-out
  shotWalk(f, lt) {
    const s = 83; // px per metre: helm to sole = 1.8 m = 150 px
    const gy = 246;
    const seed = 3;
    const x0 = 0;
    const speed = 1.45;
    const skel = (t) => marchSkeleton(t, { x0, seed, speed, name: 'walker' });
    const t = 0.35 + lt;
    // the camera rides on the soldier: the world runs past under his feet
    const camX = x0 - speed * t;
    ground(f, gy, s, camX, 150, 1.0);
    drawActor(f, W, H, skel, t, { x: 150, y: gy, s, ax: camX, ay: 0 }, { seed });
    // the GPT cut-out at the same body height (helm top to sole = 1.8 m)
    const h = Math.round((1.8 * s) / 0.826);
    const L = this.figure('march', this.img.march, h);
    this.draw(f, L, 0, this.at(L, 345, gy + 1));
    for (let x = 250; x < W; x++) put(f, W, H, x, gy, RGB.sepia, 0.85), put(f, W, H, x, gy + 1, RGB.sepia, 0.85);
    text(f, 118, 14, 'CODE', RGB.sepia);
    text(f, 312, 14, 'GPT CUT-OUT', RGB.sepia);
    text(f, 118, 22, 'DRAWN EVERY FRAME', RGB.graphite);
  }

  // ------------------------------------------------------------ 2: the Warden's thrust
  shotThrust(f, lt) {
    const s = 65; // body 120 px
    const t = TIME.thrust - 0.55 + lt; // 5.45 .. 7.05: the sink, the snap on the snare, the recover
    const ax = 4.0; // world x at the screen anchor
    const sx = 255;
    const gy = 236;
    const ay = -0.5; // the bed the Warden wades on
    const skel = (tt) => skeletonAt('warden', tt);
    // the ford's cross-section: water, and the bed under the feet
    const yOf = (Y) => gy - (Y - ay) * s;
    for (let px = 0; px < W; px++) {
      const X = ax + (px - sx) / s;
      const bed = bedY(X);
      for (let y = Math.round(yOf(0)); y < Math.round(yOf(bed)); y++)
        put(f, W, H, px, y, RGB.steelMid, (y - yOf(0)) % 6 < 3 ? 0.2 : 0.12);
      put(f, W, H, px, yOf(bed), RGB.sepia, 0.9);
      put(f, W, H, px, yOf(bed) + 1, RGB.sepia, 0.9);
      put(f, W, H, px, yOf(0) + Math.sin(px * 0.12 + t * 4) * 0.7, RGB.steelMid, 0.9);
    }
    drawActor(f, W, H, skel, t, { x: sx, y: gy, s, ax, ay }, { seed: 7, boots: 'brown', wind: 0.35 });
    text(f, 14, 14, 'THE WARDEN THRUST', RGB.sepia);
    text(f, 14, 22, 'FROM SKELETONAT WARDEN T', RGB.graphite);
  }

  // ------------------------------------------------------------ 3: the line of eight
  shotLine(f, lt) {
    const s = 62; // body 112 px
    const bt = 2.05 + lt; // 2.05 .. 3.65: standing, three steps in unison, the halt
    const ax = 11.6;
    const sx = 250;
    const ay = 0.22;
    const gy = 238;
    const yOf = (Y) => gy - (Y - ay) * s;
    // the bank behind: its edge at the waterline
    for (let px = 0; px < W; px++) {
      const X = ax + (px - sx) / s;
      const y = yOf(bedY(X));
      put(f, W, H, px, y, RGB.sepia, 0.9);
      put(f, W, H, px, y + 1, RGB.sepia, 0.9);
    }
    ground(f, gy + 12, s, ax, sx, 1.0, 1, RGB.graphite);
    const soldiers = fordLine(skeletonAt, LINE);
    drawLine(f, W, H, soldiers, bt, { x: sx, y: gy, s, ax, ay, tilt: 0.28 }, { hazePerM: 0.2 });
    text(f, 14, 14, 'THE LINE OF EIGHT', RGB.sepia);
    text(f, 14, 22, 'STEPPING IN UNISON FROM THE BLOCKING', RGB.graphite);
  }

  // ------------------------------------------------------------ 4: the parade
  shotParade(f, lt) {
    const t = 0.2 + lt;
    // ground lines for each rank (stones stand still: the feet should land on them)
    for (const r of PARADE_ROWS) ground(f, r.y, r.s, 0, 0, 2, 1, RGB.graphite);
    const n = drawParade(f, W, H, t);
    text(f, 14, 14, `PARADE OF ${n}`, RGB.sepia);
    text(f, 14, 22, 'LOCKSTEP AT THREE DEPTHS', RGB.graphite);
  }

  // ------------------------------------------------------------ 5: 3/4
  shotThreeQuarter(f, lt) {
    const s = 83;
    const gy = 246;
    const speed = 1.45;
    const t = 0.5 + lt;
    // he turns from side view toward us while marching, then holds
    const yaw = 0.95 * smooth(0.0, 0.7, lt);
    const seed = 11;
    const skel = (tt) => marchSkeleton(tt, { x0: 0, seed, speed });
    const camX = -speed * t;
    ground(f, gy, s, camX, 150, 1.0);
    drawActor(f, W, H, skel, t, { x: 150, y: gy, s, ax: camX, ay: 0, yaw }, { seed });
    // a small group at a fixed 3/4, three depths
    const items = [
      { x0: 0.0, z: -0.8, seed: 21, ph: 0.0 },
      { x0: 0.6, z: 0.0, seed: 22, ph: 0.0 },
      { x0: 1.2, z: -1.6, seed: 23, ph: 0.0 },
    ];
    const sg = 60;
    items
      .sort((a, b) => a.z - b.z)
      .forEach((it) => {
        const sk2 = (tt) => marchSkeleton(tt, { x0: it.x0, seed: it.seed, speed, z: it.z });
        const cam2 = -speed * t;
        drawActor(
          f,
          W,
          H,
          sk2,
          t,
          { x: 380 + it.x0 * 20, y: 246 + it.z * 10, s: sg, ax: cam2 + it.x0 * 0 + it.x0, ay: 0, yaw: 0.6, tilt: 0 },
          { seed: it.seed, haze: -it.z * 0.12 },
        );
      });
    text(f, 14, 14, '3/4 VIEW', RGB.sepia);
  }
}

export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
void clamp;
void lerp;
void onTwos;
void soldierLook;
