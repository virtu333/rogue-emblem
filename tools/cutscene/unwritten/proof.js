// Proof of the Unwritten Page engine: bars 47-56 of "Under the Broken Sun" (16 s).
//
//   47-48  the camp, the night before; the hymn drains it toward violet
//   49-50  the band returns and the shot is stripped back to paper, a beat at a time
//   51-52  bare paper; the gold thread (never paint) draws itself; the last shot
//          inks itself in: pencil, then lines
//   53-54  on the downbeat, full colour: Edric looks up at the camera
//   55-56  the sky: the Hollow Sun, and ROGUE DAWN set between the sky and Edric
//
// Every image here was generated once; everything that moves is code. A frame is a
// pure function of t, so the exporter can render frames in any order.

import { buildStages, DEFAULTS } from './engine/stages.js';
import { Layer, drawLayer, makePaper } from './engine/compositor.js';
import { quantise } from './engine/palette.js';
import { clamp, prog, smooth } from './engine/raster.js';
import { drain, drawTitle, embers, fireLight, hollowSun, makeTitle, thread } from './engine/fx.js';

export const W = 480;
export const H = 270;

// the score's clock: 150 bpm, 4/4
export const BPM = 150;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const FIRST_BAR = 47;
export const MUSIC_OFFSET = (FIRST_BAR - 1) * BAR; // 73.6 s into the track
export const DURATION = 10 * BAR; // bars 47-56
/** Time (s, proof-local) of bar n, beat b (1-based). */
export const at = (bar, beat = 1) => (bar - FIRST_BAR) * BAR + (beat - 1) * BEAT;

export const SHOTS = [
  { name: 'camp (hymn)', from: at(47), to: at(49) },
  { name: 'rewind to paper', from: at(49), to: at(51) },
  { name: 'paper, thread, ink-in', from: at(51), to: at(53) },
  { name: 'Edric looks up', from: at(53), to: at(55) },
  { name: 'ROGUE DAWN', from: at(55), to: DURATION },
];

const A = '/docs/art-direction/anime-op';
const SRC = {
  plate: `${A}/refs/b05_camp_night_plate.webp`, // 1024x1536
  final: `${A}/refs/b53_edric_final_frame_v2.webp`, // 1536x1024
  sera: `${A}/cutouts/sera_at_camp.webp`,
  edric: `${A}/cutouts/edric_at_fire.webp`,
  kira: `${A}/cutouts/kira_at_camp.webp`,
  standing: `${A}/cutouts/edric_standing.webp`,
};

const loadImage = (src) =>
  new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`could not load ${src}`));
    im.src = src;
  });

/** Size a figure to height h, keeping its aspect. */
const fig = (img, h) => [Math.round((img.width * h) / img.height), h];

export class Proof {
  async load() {
    const e = Object.entries(SRC);
    const imgs = await Promise.all(e.map(([, s]) => loadImage(s)));
    this.img = Object.fromEntries(e.map(([k], i) => [k, imgs[i]]));
    await document.fonts.load('600 40px Cinzel');
    this.paper = makePaper(W, H);
    this.title = makeTitle('ROGUE DAWN', 34, 0.12);
    this.build(DEFAULTS);
  }

  /** (Re)build every layer's paint stages with these line settings. */
  build(params) {
    const p = { ...DEFAULTS, ...params };
    // plates: broader lines, a higher floor and less wash, so painted texture and
    // brush grain don't turn into speckle in the drawing
    const plate = {
      ...p,
      sigma: p.sigma * p.plateSigma,
      lineLo: p.lineLo + p.plateLift,
      lineHi: p.lineHi + p.plateLift,
      pencilLo: p.pencilLo + p.plateLift,
      pencilHi: p.pencilHi + p.plateLift,
      tint: p.tint * 0.5,
    };
    const I = this.img;
    const plateScale = I.plate.width / W; // source px per art px
    const L = {};
    // the camp: the bottom 270 px of the plate at 480 wide
    L.camp = new Layer(
      buildStages(I.plate, W, H, {
        ...plate,
        crop: { x: 0, y: I.plate.height - H * plateScale, w: I.plate.width, h: H * plateScale },
      }),
      0,
      0,
      11,
      26,
    );
    const place = (img, h, cx, base, seed, flip = false) => {
      const [w, hh] = fig(img, h);
      const l = new Layer(
        buildStages(img, w, hh, { ...p, figure: true, flip }),
        Math.round(cx - w / 2),
        Math.round(base - hh),
        seed,
        14,
      );
      l.tintRGB = [0.86, 0.74, 0.8]; // night, lit from the fire
      return l;
    };
    L.sera = place(I.sera, 124, 106, 268, 21);
    L.edric = place(I.edric, 124, 317, 268, 22);
    L.kira = place(I.kira, 134, 422, 268, 23, true);
    // the final frame, full bleed (3:2 cropped to 16:9)
    const fh = (I.final.width * 9) / 16;
    L.final = new Layer(
      buildStages(I.final, W, H, {
        ...plate,
        crop: { x: 0, y: (I.final.height - fh) / 2, w: I.final.width, h: fh },
      }),
      0,
      0,
      31,
      30,
    );
    // the sky: the top 270 px of the plate
    L.sky = new Layer(
      buildStages(I.plate, W, H, {
        ...plate,
        crop: { x: 0, y: 0, w: I.plate.width, h: H * plateScale },
      }),
      0,
      0,
      41,
      26,
    );
    L.sky.tintRGB = [0.7, 0.66, 0.82];
    L.standing = place(I.standing, 290, 78, 300, 42);
    L.standing.tintRGB = [0.78, 0.74, 0.88];
    this.L = L;
    this.params = p;
  }

  /** Render proof-local time t into `out` (RGBA, W*H). */
  render(out, t, { pixel = true, dither = 0.45 } = {}) {
    const L = this.L;
    out.set(this.paper);
    const beatIn = (t0) => ((t - t0) / BEAT) | 0;
    const beatFrac = (t0) => ((t - t0) / BEAT) % 1;
    // a camera jolt on each beat of the rewind
    let oy = 0;

    if (t < at(51)) {
      // --- the camp, then the rewind -------------------------------------------
      const r0 = at(49);
      // stutter: each beat lifts a step of paint quickly, then holds
      const step = (lead, beats) => {
        if (t < r0) return 0;
        const b = beatIn(r0) - lead;
        if (b < 0) return 0;
        const u = Math.min(beats, b + smooth(0, 0.3, beatFrac(r0))) / beats;
        return 3 * u;
      };
      const sFig = step(0, 5);
      const sPlate = step(2, 6);
      if (t >= r0) oy = beatFrac(r0) < 0.12 ? 2 : 0;
      drawLayer(out, W, H, this.paper, L.camp, sPlate, 0, oy);
      for (const f of [L.sera, L.edric, L.kira]) drawLayer(out, W, H, this.paper, f, sFig, 0, oy);
      const lit = 1 - clamp(sPlate / 1.2);
      fireLight(out, W, H, 228, 164 - oy, 95, 0.55 * lit, t);
      // the hymn: colour drains toward violet, then the paint goes with it
      const k = 0.6 * smooth(at(47), at(48, 3), t) * (1 - clamp(sPlate / 1.5));
      drain(out, W, H, k);
      if (lit > 0)
        embers(out, W, H, 228, 150 - oy, t, { speed: t < r0 ? 0.55 : 1, count: 30 * lit });
      // the thread shows through once the page is bare
      const bare = clamp((sPlate - 1.8) / 1.2);
      if (bare > 0) thread(out, W, H, -10, 490, 118, 10, t, bare, 0.3);
    } else if (t < at(53)) {
      // --- paper; the thread; the last shot inks itself in ---------------------
      thread(out, W, H, -10, 490, 118, 10, t, 1, 0.3);
      const i0 = at(51, 2);
      if (t >= i0) {
        // per-beat stutter from paper (3) down to lines (1)
        const b = beatIn(i0);
        const u = Math.min(7, b + smooth(0, 0.3, beatFrac(i0))) / 7;
        drawLayer(out, W, H, this.paper, L.final, 3 - 2 * u);
      }
    } else if (t < at(55)) {
      // --- full colour, on the downbeat -----------------------------------------
      drawLayer(out, W, H, this.paper, L.final, 0);
      fireLight(out, W, H, 240, 300, 170, 0.35, t);
      embers(out, W, H, 250, 285, t, { count: 45, spread: 260, rise: 42, period: 0.06, life: 4 });
    } else {
      // --- the sky: Hollow Sun, the title between the sky and Edric -------------
      drawLayer(out, W, H, this.paper, L.sky, 0);
      const t0 = at(55);
      hollowSun(out, W, H, 330, 84, 38, t, smooth(t0, t0 + BEAT, t));
      const tp = prog(t, at(55, 2), at(56, 1));
      drawTitle(out, W, H, this.title, 158, 152, tp);
      drawLayer(out, W, H, this.paper, L.standing, 0);
      thread(out, W, H, 158, 490, 204, 4, t, prog(t, at(56, 1), at(56, 4)), 1.2);
    }
    if (pixel) quantise(out, W, H, dither);
  }
}
