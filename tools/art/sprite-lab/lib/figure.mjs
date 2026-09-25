// Figure: a 64x64 layered, indexed sprite canvas.
//
// Every pixel stores a logical material slot + a shade (0 darkest .. 4
// lightest) + the id of the part that painted it. Nothing is RGB until
// `resolve()`. That is what makes faction, identity and corruption ramp swaps,
// and what lets the post passes (contact shadow, selective outline, rim) reason
// about *parts* instead of colours.

// ASCII legend — one character = (slot, shade). Five characters per slot, darkest
// first. Derived from tools/sprite-kit/grid.mjs conventions, extended with the
// slots the lab needs (trim thread, mount, mane) and without per-direction aliases.
const GROUPS = {
  skin: 'kzsSQ',
  hair: 'NnhHY',
  main: 'vfcCF', // faction area (player steel / enemy lacquer / Edric teal)
  metal: 'IimMW', // weapon steel, buckles
  leather: 'BblLT',
  sub: 'UuoOR', // identity / secondary cloth
  linen: 'JqpPX',
  trim: 'EjygG', // player gold thread / enemy iron
  wood: 'VtdDr',
  glow: '12a@*',
  mount: '56789',
  mane: '%&+=^',
};
export const LEGEND = new Map();
for (const [slot, chars] of Object.entries(GROUPS))
  [...chars].forEach((ch, shade) => LEGEND.set(ch, [slot, shade]));
LEGEND.set('e', ['eye', 0]);
LEGEND.set('w', ['spark', 4]);
LEGEND.set('#', ['ink', 0]);

export const W = 64;
export const H = 64;

export class Figure {
  constructor(w = W, h = H) {
    this.w = w;
    this.h = h;
    this.slot = new Array(w * h).fill(null);
    this.shade = new Int8Array(w * h);
    this.pid = new Int16Array(w * h).fill(-1);
    this.parts = [];
  }

  begin(tag, opts = {}) {
    this.parts.push({
      tag,
      casts: opts.casts ?? true, // casts a contact shadow on parts behind it
      outline: opts.outline ?? true,
      rim: opts.rim ?? true,
    });
    return this.parts.length - 1;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  px(x, y, slot, shade, pid, { behind = false } = {}) {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    if (behind && this.slot[i]) return;
    if (slot === null) {
      this.slot[i] = null;
      this.pid[i] = -1;
      return;
    }
    this.slot[i] = slot;
    this.shade[i] = Math.max(0, Math.min(4, shade));
    this.pid[i] = pid;
  }

  get(x, y) {
    if (!this.inside(x, y)) return null;
    const i = y * this.w + x;
    return this.slot[i] ? { slot: this.slot[i], shade: this.shade[i], pid: this.pid[i] } : null;
  }

  // Stamp ASCII rows. '.'/' ' transparent, '-' erases, other chars via LEGEND.
  // opts: tag, remap {slot: slot}, flip (mirror horizontally), shadeShift, behind, casts
  stamp(rows, x, y, opts = {}) {
    const pid = this.begin(opts.tag ?? 'part', opts);
    const width = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, ry) => {
      [...row].forEach((ch, rx) => {
        if (ch === '.' || ch === ' ') return;
        const gx = x + (opts.flip ? width - 1 - rx : rx);
        const gy = y + ry;
        if (ch === '-') return this.px(gx, gy, null, 0, -1);
        const hit = LEGEND.get(ch);
        if (!hit) throw new Error(`Unknown part character '${ch}' in ${opts.tag}`);
        let [slot, shade] = hit;
        if (opts.remap?.[slot]) slot = opts.remap[slot];
        if (opts.shadeShift && !['eye', 'spark', 'ink'].includes(slot)) shade += opts.shadeShift;
        this.px(gx, gy, slot, shade, pid, opts);
      });
    });
    return pid;
  }

  // Thick line with lighting across its width (light from the upper-left).
  // `shades` = [shadowSide, core, litSide]. Used for parametric limbs and weapons.
  line(x0, y0, x1, y1, slot, shades, opts = {}) {
    const pid = opts.pid ?? this.begin(opts.tag ?? 'line', opts);
    const w = opts.w ?? 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    // normal pointing toward the light (upper-left)
    let nx = -dy / len;
    let ny = dx / len;
    if (nx * -1 + ny * -1 < 0) {
      nx = -nx;
      ny = -ny;
    }
    const pts = bresenham(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1));
    const horizontalish = Math.abs(dx) > Math.abs(dy);
    for (const [x, y] of pts) {
      for (let k = 0; k < w; k++) {
        // widen perpendicular to the dominant axis
        const ox = horizontalish ? 0 : k - Math.floor((w - 1) / 2);
        const oy = horizontalish ? k - Math.floor((w - 1) / 2) : 0;
        let s = shades[1];
        if (w > 1) {
          const side = ox * nx + oy * ny;
          if (side > 0.1) s = shades[2];
          else if (side < -0.1) s = shades[0];
        }
        this.px(x + ox, y + oy, slot, s, pid, opts);
      }
    }
    return pid;
  }

  // Contact shadow: a part painted later (in front) darkens the pixels of an
  // earlier part directly below or to the right of it (key light is upper-left).
  contactShadow() {
    const out = Int8Array.from(this.shade);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const p = this.pid[i];
        if (p < 0 || ['eye', 'spark', 'ink'].includes(this.slot[i])) continue;
        for (const [dx, dy] of [
          [0, -1],
          [-1, 0],
        ]) {
          const q = this.inside(x + dx, y + dy) ? this.pid[(y + dy) * this.w + x + dx] : -1;
          if (q > p && this.parts[q].casts && this.parts[q].tag !== this.parts[p].tag) {
            // a nearer part drops a crisp shadow line on what is behind it
            out[i] = Math.max(0, this.shade[i] - (this.shade[i] >= 3 ? 2 : 1));
            break;
          }
        }
      }
    this.shade = out;
    return this;
  }

  // Translate every pixel whose part tag is in `tags` (animation offsets).
  shiftTags(tags, dx, dy) {
    if (!dx && !dy) return this;
    const set = new Set(tags);
    const moved = [];
    for (let i = 0; i < this.w * this.h; i++) {
      const p = this.pid[i];
      if (p >= 0 && set.has(this.parts[p].tag)) {
        moved.push([i % this.w, (i / this.w) | 0, this.slot[i], this.shade[i], p]);
        this.slot[i] = null;
        this.pid[i] = -1;
      }
    }
    for (const [x, y, s, sh, p] of moved) {
      const X = x + dx,
        Y = y + dy;
      if (!this.inside(X, Y)) continue;
      const j = Y * this.w + X;
      // keep draw order: only overwrite pixels of earlier parts
      if (this.pid[j] > p) continue;
      this.slot[j] = s;
      this.shade[j] = sh;
      this.pid[j] = p;
    }
    return this;
  }

  bounds() {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.slot[y * this.w + x]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  clone() {
    const f = new Figure(this.w, this.h);
    f.slot = this.slot.slice();
    f.shade = Int8Array.from(this.shade);
    f.pid = Int16Array.from(this.pid);
    f.parts = this.parts.map((p) => ({ ...p }));
    return f;
  }
}

export function bresenham(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0,
    y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}
