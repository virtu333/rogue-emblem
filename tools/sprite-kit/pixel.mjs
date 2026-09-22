// Minimal pixel-art authoring kit: sprites are built from material-tagged
// primitives on a native-resolution grid, then shaded with a fixed top-left
// light and a coloured (selout) outline. No resampling ever touches the art.

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Five-step ramps, darkest first. Shadows drift toward violet/blue and highlights
// toward warm yellow so the palette can stay muted without turning to mud.
export const RAMPS = {
  skin: ['#4a2530', '#8a4a3e', '#c47f5e', '#e6b088', '#f7dcc0'],
  steel: ['#1b1d2b', '#3a4057', '#65708a', '#9eaabe', '#dfe6ef'],
  iron: ['#191a24', '#2e3140', '#4a4f63', '#737a8e', '#a9afbd'],
  leather: ['#231616', '#48302a', '#72503a', '#9c7550', '#c9a377'],
  wood: ['#2a1a14', '#553622', '#80552f', '#a87a45', '#d2a868'],
  cloth: ['#1f1c26', '#3b3644', '#5d5566', '#877c8a', '#b8adb4'],
  moss: ['#171d18', '#2d3a2c', '#4a5a40', '#6f8058', '#a0ac7c'],
  linen: ['#3e3a4a', '#77707e', '#aea5a4', '#d9d0c4', '#f4eee2'],
  brass: ['#2e1a10', '#6a4418', '#a8762a', '#dcae48', '#f6e08c'],
  fur: ['#251a16', '#4e3a2c', '#7a624a', '#a89070', '#d0bc9c'],
  horse: ['#1d1210', '#3e2620', '#62402e', '#8a6044', '#b08460'],
  hairBrown: ['#1f1114', '#44241e', '#6e3e28', '#9a6238', '#c08a50'],
  hairBlack: ['#101018', '#23222e', '#3a3848', '#5a586a', '#8a879a'],
  hairAsh: ['#3a2a1e', '#6e5530', '#a88a48', '#d6bb6e', '#f2e2a0'],
  hairRed: ['#2a0f12', '#5e1e1a', '#943222', '#c85a2e', '#eb9150'],
  glow: ['#123048', '#1f6c8c', '#3ab0c8', '#8ae6ea', '#e8fffa'],
  // Faction cloth. Every sprite routes its one large identifying cloth block
  // through the `faction` material so a side can be recoloured without redrawing.
  azure: ['#141c36', '#233f73', '#3669ad', '#5b97d6', '#a3cdf0'],
  crimson: ['#26101a', '#5e1822', '#9c2e2a', '#cf5536', '#f09a6a'],
  teal: ['#0f2a2e', '#1d5256', '#2f8083', '#56b0a8', '#a6e0cf'],
};
export const OUTLINE = hex('#140f18');
export const EYE = hex('#1a1220');
const RGB = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, v.map(hex)]));

export class PixelSprite {
  constructor(w = 64, h = 64) {
    this.w = w;
    this.h = h;
    this.mat = new Array(w * h).fill(null);
    this.part = new Int32Array(w * h).fill(-1);
    this.force = new Int8Array(w * h).fill(-1);
    this.parts = [];
  }

  // Each primitive is its own part unless `opts.part` joins an earlier one.
  // Part boundaries are what the shader reads as form edges.
  begin(mat, opts = {}) {
    if (opts.part != null) return opts.part;
    this.parts.push({
      mat,
      base: opts.base ?? 2,
      flat: !!opts.flat,
      rim: opts.rim ?? true,
      x0: Infinity,
      y0: Infinity,
      x1: -Infinity,
      y1: -Infinity,
    });
    return this.parts.length - 1;
  }

  set(x, y, mat, id, opts = {}) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (opts.behind && this.mat[i]) return;
    if (mat === null) {
      this.mat[i] = null;
      this.part[i] = -1;
      this.force[i] = -1;
      return;
    }
    this.mat[i] = mat;
    this.part[i] = id;
    this.force[i] = opts.shade ?? -1;
    const p = this.parts[id];
    p.x0 = Math.min(p.x0, x);
    p.y0 = Math.min(p.y0, y);
    p.x1 = Math.max(p.x1, x);
    p.y1 = Math.max(p.y1, y);
  }

  rect(x0, y0, x1, y1, mat, opts = {}) {
    const id = mat && this.begin(mat, opts);
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, mat, id, opts);
    return id;
  }

  ellipse(cx, cy, rx, ry, mat, opts = {}) {
    const id = mat && this.begin(mat, opts);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.5);
        const dy = (y - cy) / (ry + 0.5);
        if (dx * dx + dy * dy <= 1) this.set(x, y, mat, id, opts);
      }
    return id;
  }

  // Filled polygon sampled at pixel centres; vertices are in pixel coordinates.
  poly(pts, mat, opts = {}) {
    const id = mat && this.begin(mat, opts);
    const ys = pts.map((p) => p[1]);
    const xs = pts.map((p) => p[0]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = [pts[i][0] + 0.5, pts[i][1] + 0.5];
          const [xj, yj] = [pts[j][0] + 0.5, pts[j][1] + 0.5];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
            inside = !inside;
        }
        if (inside) this.set(x, y, mat, id, opts);
      }
    return id;
  }

  // Bresenham line with an optional square brush width.
  line(x0, y0, x1, y1, mat, opts = {}) {
    const id = mat && this.begin(mat, opts);
    const w = opts.w ?? 1;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let [x, y] = [x0, y0];
    for (;;) {
      for (let ox = 0; ox < w; ox++)
        for (let oy = 0; oy < w; oy++) this.set(x + ox, y + oy, mat, id, opts);
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
    return id;
  }

  pixels(list, mat, opts = {}) {
    const id = mat && this.begin(mat, opts);
    for (const [x, y] of list) this.set(x, y, mat, id, opts);
    return id;
  }

  erase(list) {
    for (const [x, y] of list) this.set(x, y, null, -1);
  }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.part[y * this.w + x];
  }

  bounds() {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.mat[y * this.w + x]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    return { x0, y0, x1, y1 };
  }

  // Resolve materials + shading into RGBA. `alias` maps logical materials
  // (e.g. `faction`) onto concrete ramps.
  //
  // `grade` optionally mutes every material except the listed accents, e.g.
  // { sat: 0.7, val: 0.85, keep: ['faction'] } for a grimmer read that still
  // leaves the side colour at full strength.
  render(alias = {}, grade = null) {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    const graded = (rgb, m) => {
      if (!grade || grade.keep?.includes(m)) return rgb;
      const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      return rgb.map((c) => Math.round((l + (c - l) * grade.sat) * grade.val));
    };
    const ramp = (m) => RGB[alias[m] ?? m] ?? (m === 'eye' ? [EYE, EYE, EYE, EYE, EYE] : null);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const m = this.mat[i];
        let color;
        if (m) {
          const p = this.part[i];
          const P = this.parts[p];
          let s = this.force[i];
          if (s < 0) {
            s = P.base;
            const w = P.x1 - P.x0 + 1;
            // Form shadow: the far (right) side of wide parts turns away from the light.
            if (!P.flat && w >= 4 && x > P.x0 + w * 0.62) s -= 1;
            const up = this.at(x, y - 1);
            const down = this.at(x, y + 1);
            const left = this.at(x - 1, y);
            const right = this.at(x + 1, y);
            const exposed = (n) => n === -1 || (n !== p && n < p);
            const occluder = (n) => n !== -1 && n !== p && n > p;
            if (P.rim && exposed(up)) s += 1;
            else if (P.rim && exposed(left) && !exposed(right)) s += 1;
            if (exposed(down) && !exposed(up)) s -= 1;
            if (exposed(right) && !exposed(left) && w >= 3) s -= 1;
            // Contact shadow: whatever sits beneath or right of a nearer part is shaded.
            if (occluder(up) || occluder(left)) s -= 1;
            s = Math.max(0, Math.min(4, s));
          }
          color = graded(ramp(m)[s], m);
        } else {
          // Selective outline: tinted by the neighbouring material, lighter on the lit side.
          const probes = [
            [0, 1, 1],
            [1, 0, 1],
            [0, -1, 0],
            [-1, 0, 0],
          ];
          for (const [dx, dy, lit] of probes) {
            const n = this.at(x + dx, y + dy);
            if (n === -1) continue;
            const r = ramp(this.parts[n].mat);
            const nm = this.parts[n].mat;
            color = graded(
              lit && nm !== 'eye' ? mixRgb(r[0], r[1], 0.5) : mixRgb(r[0], OUTLINE, 0.35),
              nm,
            );
            break;
          }
        }
        if (color) {
          out.set(color, i * 4);
          out[i * 4 + 3] = 255;
        }
      }
    return out;
  }
}

export function mixRgb(a, b, t) {
  return [0, 1, 2].map((k) => Math.round(a[k] * (1 - t) + b[k] * t));
}
