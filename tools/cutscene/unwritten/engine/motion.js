// Motion: a figure that really moves. A generated clip (motion/clip.py) arrives as an
// atlas of keyed drawings; each drawing becomes a Layer with its own paint stages (built
// the first time it is shown), so a moving figure can still lose its paint in the
// rewind, or ink itself in. Playback is on twos by default, like drawn animation.
//
// Joints (when the clip was run through a pose model) come back in layer pixels, so
// effects can hang off the body: the thread from a hand, dust from a foot.

import { buildStages } from './stages.js';
import { plateParams } from './piece.js';
import { Layer } from './compositor.js';

export class Motion {
  /**
   * @param img   the atlas image
   * @param meta  its JSON (frames, cols, cell, fps, anchor, joints?)
   * @param h     height in art px to build the drawings at
   * @param o     { flip, params (line settings), seed, skin, tint }
   */
  constructor(img, meta, h, o = {}) {
    this.img = img;
    this.meta = meta;
    this.h = h;
    this.o = o;
    this.n = meta.frames;
    const [cw, ch] = meta.cell;
    this.s = h / ch; // cell px -> art px
    this.w = Math.round(cw * this.s);
    this.layers = new Array(this.n);
  }

  /** The Layer for drawing i (built on first use). */
  layer(i) {
    i = ((i % this.n) + this.n) % this.n;
    if (!this.layers[i]) {
      const { cols, cell } = this.meta;
      const [cw, ch] = cell;
      const crop = { x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch };
      // a painted plate clip (no key) is built like a plate: calmer lines, a full frame
      const plate = !!this.meta.plate;
      const p = this.o.params || {};
      const st = buildStages(this.img, this.w, this.h, {
        ...(plate ? plateParams(p) : p),
        figure: !plate,
        flip: !!this.o.flip,
        crop,
      });
      // the same dissolve mask for every drawing, so paint lifts off steadily as it moves
      const l = new Layer(st, 0, 0, this.o.seed ?? 29, plate ? 44 : 14);
      l.skin = this.o.skin ?? true;
      if (this.o.tint) l.tintRGB = this.o.tint;
      this.layers[i] = l;
    }
    return this.layers[i];
  }

  /**
   * Which drawing shows at time u (s) into the motion.
   *   mode 'loop' | 'once' (hold the last) | 'pingpong' | 'reverse' (loop backwards)
   *   rate  playback speed (1 = as generated)
   *   twos  hold each drawing two frames (true by default)
   */
  index(u, { mode = 'loop', rate = 1, twos = true } = {}) {
    const fps = this.meta.fps * rate;
    let k = u * fps;
    if (twos && this.meta.fps > 12) k = Math.floor(k / 2) * 2;
    k = Math.floor(k);
    const n = this.n;
    if (mode === 'once') return Math.max(0, Math.min(n - 1, k));
    if (mode === 'pingpong') {
      const p = ((k % (2 * n - 2)) + 2 * n - 2) % (2 * n - 2);
      return p < n ? p : 2 * n - 2 - p;
    }
    if (mode === 'reverse') return n - 1 - (((k % n) + n) % n);
    return ((k % n) + n) % n;
  }

  /** Placement with the feet at page point (x, y). */
  place(x, y, scale = 1, rot = 0, extra = {}) {
    const [axc, ayc] = this.meta.anchor;
    const ax = this.o.flip ? this.w - axc * this.s : axc * this.s;
    return { x, y, ax, ay: ayc * this.s, scale, rot, ...extra };
  }

  /** Placement that fills a W x H frame (a painted plate clip), times `zoom`. */
  fill(W, H) {
    return { x: W / 2, y: H / 2, ax: this.w / 2, ay: this.h / 2, scale: W / this.w };
  }

  /**
   * The outermost point of drawing i on one side, within a band of its height
   * (fractions 0 top .. 1 bottom), in layer px: a reaching hand is the rightmost point of
   * the upper body, a foot the lowest. Cheap, and needs no pose model.
   */
  extreme(i, side = 'right', y0 = 0, y1 = 1) {
    const st = this.layer(i).st;
    const ya = Math.floor(y0 * st.h);
    const yb = Math.ceil(y1 * st.h);
    let best = null;
    for (let y = ya; y < yb; y++)
      for (let x = 0; x < st.w; x++) {
        if (!st.alpha[y * st.w + x]) continue;
        if (
          !best ||
          (side === 'right' && x > best[0]) ||
          (side === 'left' && x < best[0]) ||
          (side === 'bottom' && y > best[1]) ||
          (side === 'top' && y < best[1])
        )
          best = [x, y];
      }
    return best;
  }

  /** Joint `name` of drawing i in layer px, or null. */
  joint(i, name) {
    const J = this.meta.joints?.[((i % this.n) + this.n) % this.n];
    const p = J?.[name];
    if (!p || p[2] < 0.3) return null;
    const x = p[0] * this.w;
    return [this.o.flip ? this.w - x : x, p[1] * this.h];
  }
}
