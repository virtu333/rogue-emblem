// Locomotion: the end of the treadmill.
//
// A generated clip (motion/clip.py) is stabilised on the body, so the runner runs on the
// spot and the planted foot slides backward through the cell. motion/contacts.py measures
// that slide and writes it into the clip's JSON (`meta.contacts`): how far the body has to
// travel from each drawing to the next for the planted foot to stay put on the ground.
// This module turns that into pure functions of time, so a shot can move the figure
// through a world that stands still, and the feet stay where they landed.
//
//   const M = this.motion('edric_run', 214);
//   const S = new Stride(M, { rate: rateForSpeed(M, 200) });   // 200 art px/s, no sliding
//   const i = S.index(lt);                                      // the drawing (same as M.index)
//   const w = lockToWorld(S, lt, { x0: 90, follow: 1 });        // camera on the runner
//   this.draw(f, M.layer(i), 0, M.place(w.x, 268), c);          // figure
//   ground marks at page x = worldX + w.ground                  // the world beneath him
//   for (const ff of S.footfallsIn(t0, t1)) ...                 // dust where a foot lands
//
// Units: everything returned is in art px (the size the Motion was built at), +x to the
// right of the page. `travel` already knows about `flip`: a mirrored clip travels left.
// Every function is a pure function of its arguments (frames may render in any order).

/** Same arithmetic as Motion.index, but the count of drawings since u = 0 (not wrapped). */
function drawingCount(fpsClip, rate, twos, u) {
  let k = u * (fpsClip * rate);
  if (twos && fpsClip > 12) k = Math.floor(k / 2) * 2;
  return Math.floor(k);
}

const mod = (a, n) => ((a % n) + n) % n;

/** Frames in one pass of the clip: a loop wraps, a clip that plays once has n - 1 steps. */
const cycleFrames = (m) => (m.meta.loop ? m.n : Math.max(1, m.n - 1));

export class Stride {
  /**
   * @param motion  a Motion whose JSON has a `contacts` block (run contacts.py)
   * @param o       { rate = 1 (playback speed), mode = 'loop' | 'once', twos = true }
   */
  constructor(motion, { rate = 1, mode = 'loop', twos = true } = {}) {
    if (mode !== 'loop' && mode !== 'once') throw new Error(`Stride: mode ${mode}`);
    this.motion = motion;
    this.rate = rate;
    this.mode = mode;
    this.twos = twos;
    this.n = motion.n;
    this.fps = motion.meta.fps;
    const c = motion.meta.contacts || null;
    this.contacts = c;
    // cell px -> art px, horizontally as the drawings were actually resampled
    this.sx = motion.w / motion.meta.cell[0];
    this.sy = motion.h / motion.meta.cell[1];
    this.flip = !!motion.o.flip;
    this.sign = this.flip ? -1 : 1;
    this.advance = c ? c.advance.slice(0, this.n) : new Array(this.n).fill(0);
    while (this.advance.length < this.n) this.advance.push(0);
    // cum[r]: body travel (cell px) from drawing 0 to drawing r within one pass
    this.cum = [0];
    for (let r = 0; r < this.n; r++) this.cum.push(this.cum[r] + this.advance[r]);
    this.stride = this.cum[this.n]; // one full pass (cell px)
    this.ax = motion.place(0, 0).ax; // where the anchor sits in the layer
  }

  /** True when the clip has contacts (otherwise travel is 0: the old treadmill). */
  get measured() {
    return !!this.contacts;
  }

  /** Which drawing shows at time u: exactly Motion.index for the same rate. */
  index(u) {
    return this.motion.index(u, { mode: this.mode, rate: this.rate, twos: this.twos });
  }

  /**
   * Distance the body has travelled by time u (art px, + right; a flipped clip: left):
   * constant while a drawing shows, then a step of `advance[i]` to the next, so the planted
   * foot's position on the page never changes while it is planted. It accumulates over
   * loops: floor(k / n) * stride + cum[k % n].
   * `smooth` interpolates through each drawing's hold instead: for a camera on ones, at
   * the price of the foot creeping a little within a hold.
   */
  travel(u, { smooth = false } = {}) {
    const n = this.n;
    const k = drawingCount(this.fps, this.rate, this.twos, u);
    let cell;
    if (this.mode === 'once') {
      const kk = Math.max(0, Math.min(n - 1, k));
      cell = this.cum[kk];
      if (smooth && k >= 0 && k < n - 1) cell += this.advance[kk] * this.holdFraction(u, k);
    } else {
      const loops = Math.floor(k / n);
      const r = k - loops * n;
      cell = loops * this.stride + this.cum[r];
      if (smooth) cell += this.advance[r] * this.holdFraction(u, k);
    }
    return cell * this.sx * this.sign;
  }

  /** How far through the hold of the drawing shown at count k (0..1). */
  holdFraction(u, k) {
    const hold = this.twos && this.fps > 12 ? 2 : 1;
    const raw = u * (this.fps * this.rate);
    return Math.max(0, Math.min(1, (raw - k) / hold));
  }

  /** Average speed at this rate, art px/s (a magnitude; see `dir` for the way). */
  speed(rate = this.rate) {
    return (Math.abs(this.stride) * this.sx * this.fps * rate) / cycleFrames(this.motion);
  }

  /** +1 if the figure travels right on the page, -1 left, 0 if it doesn't move. */
  get dir() {
    return Math.sign(this.stride) * this.sign;
  }

  /** Seconds one pass of the clip takes at this rate. */
  get period() {
    return cycleFrames(this.motion) / (this.fps * this.rate);
  }

  /** The foot on the ground in drawing i as [x, y] layer px (in the built, flipped layer), or null (flight). */
  plantedFoot(i) {
    const p = this.contacts?.planted?.[mod(i, this.n)];
    return p ? this.toLayer(p[0], p[1]) : null;
  }

  /** Every foot found in drawing i: [{ x, y, id, ground }] in layer px. */
  feet(i) {
    const fs = this.contacts?.feet?.[mod(i, this.n)] || [];
    return fs.map(([x, y, id, ground]) => {
      const [lx, ly] = this.toLayer(x, y);
      return { x: lx, y: ly, id, ground: !!ground };
    });
  }

  /** Cell px -> layer px (the drawings are built mirrored when the clip is flipped). */
  toLayer(x, y) {
    const lx = x * this.sx;
    return [this.flip ? this.motion.w - lx : lx, y * this.sy];
  }

  /**
   * Feet that touch down between u0 (inclusive) and u1 (exclusive): where dust and splashes go.
   * Each is { u (when its drawing comes up), i, foot: [x, y] layer px, world, side, id }.
   *   world  the touchdown's x in the world, relative to the figure's world position at
   *          u = 0 (add the x you started the runner at). Add the ground offset for page x.
   *   side   'left' | 'right', alternating from one footfall to the next (a run alternates
   *          feet; the clip can't tell us which is which), or the hoof-set for a horse.
   */
  footfallsIn(u0, u1) {
    const falls = this.contacts?.footfalls;
    if (!falls || !falls.length) return [];
    const n = this.n;
    const F = this.fps * this.rate;
    const step = this.twos && this.fps > 12 ? 2 : 1;
    const byDrawing = new Map();
    falls.forEach((f, idx) => byDrawing.set(f.i, [...(byDrawing.get(f.i) || []), [f, idx]]));
    const out = [];
    for (let m = Math.floor((u0 * F) / step) - 1; m <= Math.ceil((u1 * F) / step) + 1; m++) {
      const k = m * step;
      const u = k / F;
      if (u < u0 || u >= u1) continue;
      if (this.mode === 'once' && (k < 0 || k > n - 1)) continue;
      const i = mod(k, n);
      for (const [f, idx] of byDrawing.get(i) || []) {
        const foot = this.toLayer(f.x, f.y);
        const ordinal = Math.floor(k / n) * falls.length + idx;
        out.push({
          u,
          i,
          foot,
          world: this.travel(u) + (foot[0] - this.ax),
          side: mod(ordinal, 2) ? 'right' : 'left',
          id: f.id,
        });
      }
    }
    return out.sort((a, b) => a.u - b.u);
  }
}

/**
 * The playback rate at which the clip travels `pxPerSec` art px/s without sliding: a shot
 * can say "Edric crosses 200 px in 1.2 s" (rateForSpeed(M, 200 / 1.2)) and get the cadence.
 */
export function rateForSpeed(motion, pxPerSec) {
  const at1 = new Stride(motion, { rate: 1 }).speed(1);
  return at1 > 1e-9 ? Math.abs(pxPerSec) / at1 : 1;
}

/** The inverse: art px/s the clip travels at playback rate `rate`. */
export function speedForRate(motion, rate) {
  return new Stride(motion, { rate }).speed(rate);
}

/**
 * Lock a figure to a world that scrolls: the world holds still, the runner moves through
 * it, and a camera follows him by `follow` (1: he stays at one screen x and the ground
 * runs past; 0: a static camera and he crosses the frame; between: a partial pan).
 * Returns
 *   world   his position in the world (art px): x0 + travel(u)
 *   x       the page x to place his anchor at: world + ground
 *   ground  add to any world x to get its page x (ground marks, stones, reeds)
 *   cam     the world x a camera looks at to get the same picture with a camera (page =
 *           world; the camera starts on x0 and follows by `follow`)
 * Ground marks drawn at worldX + ground and the runner at x stay locked whatever `follow`
 * is: the planted foot's page x minus the mark's page x only changes when the foot lifts.
 */
export function lockToWorld(stride, u, { x0 = 0, follow = 1 } = {}) {
  const travel = stride.travel(u);
  const world = x0 + travel;
  const ground = -follow * travel;
  return { world, ground, x: world + ground, cam: x0 + follow * travel };
}

/** World x of every mark of a ground with marks each `spacing` px that shows on a page `width` wide. */
export function marksInView(spacing, ground, width, margin = 0) {
  const first = Math.ceil((-margin - ground) / spacing);
  const last = Math.floor((width + margin - ground) / spacing);
  const out = [];
  for (let m = first; m <= last; m++) out.push(m * spacing);
  return out;
}
