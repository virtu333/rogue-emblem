// A piece cut from generated takes (boards/<scene>.json, previs3d/takes.py): the edit list
// boards/<scene>_edit.json places a slice of a take, or a code shot from the scene's older
// piece, on the score. The take's drawings play as a painted plate clip (motion/clip.py
// --plate, cut by previs3d/cut_clips.py), so the paint stages, the palette snap and the
// rewind work on them as on any painting. The engine owns the timing (hit-stop, slow
// motion, holds), the camera on the plate (push, pan, shake) and the effects (impact frames,
// flashes, sparks, splashes, the thread), so generated motion never has to do them.
//
// A cut: { name, from, to, take, clip, src (take seconds at `from`), rate,
//   stops: [{ t, hold, catch }], slow: [t0, t1, rate], hold: [t0, t1] (freeze on one drawing),
//   cam: { zoom: [z0, z1], x: [x0, x1], y: [y0, y1], rot, ease }, shake: [[t, amp]],
//   impact: [{ t, frames, mode, crimson }], flash: [{ t, frames, color }],
//   sparks: [{ t, x, y, count, speed }], splash: [{ t, x, y, count }],
//   enter: { kind, dur }, code: 'shotName' (drawn by the scene's older piece) }

import { Piece } from './engine/piece.js';
import { makePaper } from './engine/compositor.js';
import { quantise } from './engine/palette.js';
import { quantiseCamp } from './camp_palette.js';
import { RGB, flash, impact, shake, sparks, splash } from './engine/anime.js';
import { hitStop, slowMo } from './engine/timing.js';
import { smooth } from './engine/raster.js';

export const W = 480;
export const H = 270;
// the cut clips live outside git (References/ is ignored): they are rebuilt from the takes
const MOTION = '/References/cutscene/gen_motion';

const SCENES = {
  ford: { old: () => import('./ford.js'), palette: quantise },
  camp: { old: () => import('./camp.js'), palette: quantiseCamp },
};

const HEX = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function makeGenPiece(scene, edit) {
  const S = SCENES[scene];
  return class GenPiece extends Piece {
    constructor() {
      super(W, H);
      this.edit = edit;
      // the player reads the shot list before load(), so the cuts are shots from the start
      this.shots = edit.cuts.map((c) => ({
        name: c.name,
        from: c.from,
        to: c.to,
        enter: c.enter,
        draw: (f, t) => this.drawCut(f, c, t),
      }));
    }

    async load() {
      this.paper = makePaper(W, H);
      const clips = [...new Set(this.edit.cuts.filter((c) => c.clip).map((c) => c.clip))];
      await this.loadMotions(MOTION, clips);
      // code cuts are drawn by the scene's older piece (its shots, its assets)
      if (this.edit.cuts.some((c) => c.code)) {
        const mod = await S.old();
        this.old = new mod.PieceClass();
        await this.old.load();
      }
      this.build(this.params);
    }

    /** The take's time for score time t in cut c: hit-stops, slow motion, holds, rate. */
    srcTime(c, t) {
      let a = t;
      if (c.stops) a = hitStop(a, c.stops);
      if (c.slow) a = slowMo(a, c.slow[0], c.slow[1], c.slow[2]);
      // a hold freezes one drawing over [h0, h1]; the action then resumes where it stopped
      if (c.hold && a >= c.hold[0]) a = a < c.hold[1] ? c.hold[0] : a - (c.hold[1] - c.hold[0]);
      return (c.src ?? 0) + (a - c.from) * (c.rate ?? 1);
    }

    camAt(c, t) {
      const cam = c.cam || {};
      const u = smooth(c.from, c.to, t);
      const k = cam.ease === 'linear' ? (t - c.from) / (c.to - c.from) : u;
      const lerp2 = (v, d) => (v ? v[0] + (v[1] - v[0]) * k : d);
      const [dx, dy, dr] = c.shake ? shake(t, c.shake, 6, 0.16, 0.015) : [0, 0, 0];
      return {
        x: W / 2 + lerp2(cam.x, 0) + dx,
        y: H / 2 + lerp2(cam.y, 0) + dy,
        zoom: lerp2(cam.zoom, 1),
        rot: (cam.rot ?? 0) + dr,
      };
    }

    drawCut(f, c, t) {
      if (c.code) {
        const shot = this.old.shots.find((s) => s.name === c.code);
        if (shot) shot.draw(f, t);
        return;
      }
      const M = this.motion(c.clip, H);
      if (!M) return;
      // the clip's first drawing is take time `clipFrom` (cut_clips.py writes it)
      const u = this.srcTime(c, t) - (this.motionSrc[c.clip].meta.range?.[0] ?? 0);
      const i = M.index(u, { mode: 'once' });
      // overscanned 4 % so a shake or a roll never shows the page's edge
      const xf = M.fill(W, H);
      xf.scale *= 1.04;
      this.draw(f, M.layer(i), c.stage ?? 0, xf, this.camAt(c, t));
      for (const s of c.sparks || [])
        sparks(f, W, H, s.x, s.y, t, s.t, { count: s.count ?? 40, speed: s.speed ?? 260 });
      for (const s of c.splash || []) splash(f, W, H, s.x, s.y, t, s.t, { count: s.count ?? 50 });
      for (const fl of c.flash || [])
        if (t >= fl.t && t < fl.t + (fl.frames ?? 1) / 24)
          flash(f, W, H, 1, fl.color ? HEX(fl.color) : RGB.paperHi);
      for (const im of c.impact || [])
        if (t >= im.t && t < im.t + (im.frames ?? 2) / 24)
          impact(f, W, H, { mode: im.mode ?? 'neg', light: im.crimson ? RGB.crimson : undefined });
    }

    render(out, t, o = {}) {
      super.render(out, t, { ...o, pixel: false });
      if (o.pixel !== false) S.palette(out, W, H, o.dither ?? 0.45);
    }
  };
}
