// pixelIcon — a tiny procedural pixel-art renderer for item icons (pure, no deps).
//
// An icon is a stack of parts (shapes in a 32x32 design space) with a material
// ramp and a shading model. Each display size (16/24/32/48) is rasterized
// natively, so a 16px icon is drawn *as* a 16px icon (whole-pixel lines, no
// resampling blur) and a 48px one gains detail instead of fat pixels.
//
// Pipeline per size:
//   coverage (4x4 supersampled, thin lines forced to 1px) -> z-buffer of parts
//   -> per-pixel normal (analytic for spheres/cylinders, distance field for
//      polygons) -> key light from the upper left (ART_BIBLE) -> ramp level
//   -> cast shadow of upper parts onto lower ones, separator lines
//   -> orphan clean-up -> specular glints -> exterior outline (selective:
//      lit side takes the part's darkest ramp colour, shadow side ink)
//   -> optional drop shadow.
// Ramps are 5 colours: 0 line, 1 shadow, 2 mid, 3 light, 4 highlight.

const LIGHT = (() => {
  const v = [-1, -1.05, 1.25];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

const INK_OUTLINE = [7, 6, 11];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Shapes (design space, y down) ────────────────────────────────────────

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function angleIn(a, a0, a1) {
  const tau = Math.PI * 2;
  const norm = (v) => ((v % tau) + tau) % tau;
  const s = norm(a0);
  const span = norm(a1 - a0) || tau;
  return norm(a - s) <= span;
}

/** inside(x, y) for a shape; also returns the analytic frame when available. */
function shapeFns(shape) {
  switch (shape.kind) {
    case 'circle':
      return { inside: (x, y) => Math.hypot(x - shape.cx, y - shape.cy) <= shape.r };
    case 'ellipse': {
      const rot = ((shape.rot || 0) * Math.PI) / 180;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      return {
        inside: (x, y) => {
          const dx = x - shape.cx;
          const dy = y - shape.cy;
          const u = (dx * c + dy * s) / shape.rx;
          const v = (-dx * s + dy * c) / shape.ry;
          return u * u + v * v <= 1;
        },
      };
    }
    case 'capsule':
      return {
        inside: (x, y) =>
          segDist(x, y, shape.a[0], shape.a[1], shape.b[0], shape.b[1]).d <= shape.r,
      };
    case 'ring':
      return {
        inside: (x, y) => {
          const d = Math.hypot(x - shape.cx, y - shape.cy);
          return d <= shape.r1 && d >= shape.r0;
        },
      };
    case 'arc':
      return {
        inside: (x, y) => {
          const d = Math.hypot(x - shape.cx, y - shape.cy);
          return (
            Math.abs(d - shape.r) <= shape.w / 2 &&
            angleIn(Math.atan2(y - shape.cy, x - shape.cx), shape.a0, shape.a1)
          );
        },
      };
    case 'rect':
      return {
        inside: (x, y) =>
          x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h,
      };
    case 'poly':
      return { inside: (x, y) => inPoly(x, y, shape.pts) };
    default:
      throw new Error(`unknown shape ${shape.kind}`);
  }
}

/** Axis-aligned bounds of a shape in design units [x0, y0, x1, y1] (conservative). */
function shapeBounds(shape) {
  switch (shape.kind) {
    case 'circle':
      return [shape.cx - shape.r, shape.cy - shape.r, shape.cx + shape.r, shape.cy + shape.r];
    case 'ellipse': {
      const r = Math.max(shape.rx, shape.ry);
      return [shape.cx - r, shape.cy - r, shape.cx + r, shape.cy + r];
    }
    case 'capsule':
      return [
        Math.min(shape.a[0], shape.b[0]) - shape.r,
        Math.min(shape.a[1], shape.b[1]) - shape.r,
        Math.max(shape.a[0], shape.b[0]) + shape.r,
        Math.max(shape.a[1], shape.b[1]) + shape.r,
      ];
    case 'ring':
      return [shape.cx - shape.r1, shape.cy - shape.r1, shape.cx + shape.r1, shape.cy + shape.r1];
    case 'arc': {
      const r = shape.r + shape.w / 2;
      return [shape.cx - r, shape.cy - r, shape.cx + r, shape.cy + r];
    }
    case 'rect':
      return [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h];
    case 'poly': {
      const xs = shape.pts.map((p) => p[0]);
      const ys = shape.pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    default:
      return [-1e9, -1e9, 1e9, 1e9];
  }
}

// Centre lines of thin shapes, plotted so a 0.5px line still reads as 1px.
function spinePoints(shape) {
  const pts = [];
  if (shape.kind === 'capsule') {
    const n = 96;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([
        shape.a[0] + (shape.b[0] - shape.a[0]) * t,
        shape.a[1] + (shape.b[1] - shape.a[1]) * t,
      ]);
    }
  } else if (shape.kind === 'arc' || shape.kind === 'ring') {
    const r = shape.kind === 'arc' ? shape.r : (shape.r0 + shape.r1) / 2;
    const a0 = shape.kind === 'arc' ? shape.a0 : 0;
    const tau = Math.PI * 2;
    const span = shape.kind === 'arc' ? (((shape.a1 - shape.a0) % tau) + tau) % tau || tau : tau;
    const n = 180;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n;
      pts.push([shape.cx + Math.cos(a) * r, shape.cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

function thinWidth(shape) {
  if (shape.kind === 'capsule') return shape.r * 2;
  if (shape.kind === 'arc') return shape.w;
  if (shape.kind === 'ring') return shape.r1 - shape.r0;
  return Infinity;
}

// ── Distance field (chamfer 3-4, in pixels) ──────────────────────────────

function distanceInside(mask, n) {
  const INF = 1e6;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : d[y * n + x]);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1.414,
        at(x + 1, y - 1) + 1.414,
      );
    }
  for (let y = n - 1; y >= 0; y--)
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1.414,
        at(x - 1, y + 1) + 1.414,
      );
    }
  return d;
}

// ── Renderer ─────────────────────────────────────────────────────────────

/**
 * @param {{parts: object[], shadow?: boolean, outline?: 'selective'|'ink'|'none'}} spec
 * @param {number} size output pixels (16, 24, 32, 48 ...)
 * @param {Record<string,string[]>} materials name -> 5 hex colours
 * @returns {{ size:number, rgba: Uint8ClampedArray }}
 */
export function renderIcon(spec, size, materials) {
  const n = size;
  const S = n / 32; // design unit -> pixels
  const parts = spec.parts.filter(
    (p) => (p.minSize == null || n >= p.minSize) && (p.maxSize == null || n <= p.maxSize),
  );
  const owner = new Int16Array(n * n).fill(-1);
  const level = new Int8Array(n * n).fill(-1);
  const light = new Float32Array(n * n);
  const masks = [];
  const SS = 4;

  parts.forEach((part) => {
    const { inside } = shapeFns(part.shape);
    const holes = (part.holes || []).map((h) => shapeFns(h).inside);
    const test = (x, y) => inside(x, y) && !holes.some((h) => h(x, y));
    const mask = new Uint8Array(n * n);
    const thr = part.coverage ?? 0.5;
    // Only pixels inside the shape's bounds can be covered (same result, far fewer tests).
    const [bx0, by0, bx1, by1] = shapeBounds(part.shape);
    const px0 = Math.max(0, Math.floor(bx0 * S) - 1);
    const py0 = Math.max(0, Math.floor(by0 * S) - 1);
    const px1 = Math.min(n - 1, Math.ceil(bx1 * S) + 1);
    const py1 = Math.min(n - 1, Math.ceil(by1 * S) + 1);
    for (let py = py0; py <= py1; py++)
      for (let px = px0; px <= px1; px++) {
        let c = 0;
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++)
            if (test((px + (sx + 0.5) / SS) / S, (py + (sy + 0.5) / SS) / S)) c++;
        if (c / (SS * SS) >= thr) mask[py * n + px] = 1;
      }
    // Thin strokes: guarantee a continuous 1px spine at small sizes.
    if (thinWidth(part.shape) * S < 1.6 || part.spine) {
      for (const [x, y] of spinePoints(part.shape)) {
        const px = Math.floor(x * S);
        const py = Math.floor(y * S);
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        if (holes.some((h) => h((px + 0.5) / S, (py + 0.5) / S))) continue;
        mask[py * n + px] = 1;
      }
    }
    masks.push(mask);
  });

  // Normals + light per part (on the part's full mask, so occlusion never bends shading).
  const partLight = parts.map((part, pi) => {
    const mask = masks[pi];
    const out = new Float32Array(n * n);
    const shade = part.shade || 'dome';
    const sh = part.shape;
    let dist = null;
    let dmax = 1;
    if (['dome', 'bevel', 'pillow'].includes(shade)) {
      dist = distanceInside(mask, n);
      for (let i = 0; i < n * n; i++) dmax = Math.max(dmax, dist[i]);
    }
    const axis = (() => {
      if (part.axis) return part.axis;
      if (sh.kind === 'capsule') return [sh.b[0] - sh.a[0], sh.b[1] - sh.a[1]];
      return [0, 1];
    })();
    const al = Math.hypot(axis[0], axis[1]) || 1;
    const u = [axis[0] / al, axis[1] / al];
    const v = [-u[1], u[0]];
    const centre = (() => {
      if (part.centre) return part.centre;
      if (sh.kind === 'capsule') return [(sh.a[0] + sh.b[0]) / 2, (sh.a[1] + sh.b[1]) / 2];
      if ('cx' in sh) return [sh.cx, sh.cy];
      if (sh.kind === 'rect') return [sh.x + sh.w / 2, sh.y + sh.h / 2];
      const xs = sh.pts.map((p) => p[0]);
      const ys = sh.pts.map((p) => p[1]);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    })();
    const half =
      part.halfWidth ??
      (sh.kind === 'capsule'
        ? sh.r
        : sh.kind === 'rect'
          ? Math.abs(v[0]) > Math.abs(v[1])
            ? sh.w / 2
            : sh.h / 2
          : (() => {
              let m = 0.5;
              for (let py = 0; py < n; py++)
                for (let px = 0; px < n; px++) {
                  if (!mask[py * n + px]) continue;
                  const s =
                    ((px + 0.5) / S - centre[0]) * v[0] + ((py + 0.5) / S - centre[1]) * v[1];
                  m = Math.max(m, Math.abs(s) + 0.5 / S);
                }
              return m;
            })());
    for (let py = 0; py < n; py++)
      for (let px = 0; px < n; px++) {
        const i = py * n + px;
        if (!mask[i]) continue;
        const x = (px + 0.5) / S;
        const y = (py + 0.5) / S;
        let nx = 0;
        let ny = 0;
        let nz = 1;
        if (shade === 'sphere') {
          const rx = sh.rx ?? sh.r ?? half;
          const ry = sh.ry ?? sh.r ?? half;
          const cx = sh.cx ?? centre[0];
          const cy = sh.cy ?? centre[1];
          nx = (x - cx) / (rx + 0.5 / S);
          ny = (y - cy) / (ry + 0.5 / S);
          const r2 = nx * nx + ny * ny;
          nz = Math.sqrt(Math.max(0.02, 1 - Math.min(1, r2)));
        } else if (shade === 'cyl' || shade === 'ridge') {
          let s;
          if (sh.kind === 'capsule') {
            const { t } = segDist(x, y, sh.a[0], sh.a[1], sh.b[0], sh.b[1]);
            const cx = sh.a[0] + (sh.b[0] - sh.a[0]) * t;
            const cy = sh.a[1] + (sh.b[1] - sh.a[1]) * t;
            s = ((x - cx) * v[0] + (y - cy) * v[1]) / (half + 0.5 / S);
          } else {
            const spine = part.spine0 || centre;
            s = ((x - spine[0]) * v[0] + (y - spine[1]) * v[1]) / (half + 0.5 / S);
          }
          s = Math.max(-1, Math.min(1, s));
          if (shade === 'cyl') {
            nx = v[0] * s;
            ny = v[1] * s;
            nz = Math.sqrt(Math.max(0.02, 1 - s * s));
          } else {
            const k = Math.abs(s) < (part.ridgeFlat ?? 0.12) ? 0 : Math.sign(s) * 0.62;
            nx = v[0] * k;
            ny = v[1] * k;
            nz = Math.sqrt(1 - k * k);
          }
        } else if (shade === 'dome' || shade === 'bevel' || shade === 'pillow') {
          const d = (xx, yy) => (xx < 0 || yy < 0 || xx >= n || yy >= n ? 0 : dist[yy * n + xx]);
          const gx = (d(px + 1, py) - d(px - 1, py)) / 2;
          const gy = (d(px, py + 1) - d(px, py - 1)) / 2;
          const g = Math.hypot(gx, gy) || 1;
          const di = dist[i];
          if (shade === 'dome') {
            // Circular profile from the edge inward.
            const t = Math.min(1, di / (part.domeDepth ? part.domeDepth * S : dmax));
            const slope = Math.sqrt(Math.max(0, 1 - t * t)) * (part.domeStrength ?? 0.9);
            nx = (-gx / g) * slope;
            ny = (-gy / g) * slope;
            nz = Math.sqrt(Math.max(0.05, 1 - slope * slope));
          } else {
            const w = (part.bevel ?? 1.2) * Math.max(1, S * 0.75);
            const slope = di <= w ? 0.7 : 0;
            nx = (-gx / g) * slope;
            ny = (-gy / g) * slope;
            nz = Math.sqrt(1 - slope * slope);
          }
        }
        out[i] = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] + (part.bias || 0);
      }
    return out;
  });

  // Z-buffer: later parts are on top.
  parts.forEach((part, pi) => {
    const mask = masks[pi];
    for (let i = 0; i < n * n; i++) if (mask[i]) owner[i] = pi;
  });

  const levelFor = (I, part) => {
    if (part.level != null) return part.level;
    // Flat facing (0,0,1) lands at ~0.63 -> mid; lit slopes -> light; far side -> shadow.
    const t = part.thresholds || [0.5, 0.8];
    const l = I > t[1] ? 3 : I > t[0] ? 2 : 1;
    return Math.max(part.minLevel ?? 1, Math.min(part.maxLevel ?? 3, l));
  };
  for (let i = 0; i < n * n; i++) {
    const pi = owner[i];
    if (pi < 0) continue;
    light[i] = partLight[pi][i];
    level[i] = levelFor(light[i], parts[pi]);
  }

  // Stripes (grip wraps, bindings): drop a level on alternate bands.
  parts.forEach((part, pi) => {
    if (!part.stripes) return;
    const sh = part.shape;
    const ax =
      part.stripes.axis ||
      (sh.kind === 'capsule' ? [sh.b[0] - sh.a[0], sh.b[1] - sh.a[1]] : [0, 1]);
    const al = Math.hypot(ax[0], ax[1]);
    const origin = sh.kind === 'capsule' ? sh.a : [0, 0];
    const period = Math.max(2, Math.round(part.stripes.period * S));
    for (let py = 0; py < n; py++)
      for (let px = 0; px < n; px++) {
        const i = py * n + px;
        if (owner[i] !== pi) continue;
        const t =
          (((px + 0.5) / S - origin[0]) * ax[0] + ((py + 0.5) / S - origin[1]) * ax[1]) / al;
        const k = Math.floor((t * S + (part.stripes.phase || 0)) / (period / 2));
        if (k % 2 === 0) level[i] = Math.max(part.stripes.floor ?? 1, level[i] - 1);
      }
  });

  // Cast shadow: a lower part under an upper part's down-right offset darkens.
  for (let py = n - 1; py >= 0; py--)
    for (let px = n - 1; px >= 0; px--) {
      const i = py * n + px;
      const pi = owner[i];
      if (pi < 0 || parts[pi].noCast) continue;
      const src = px > 0 && py > 0 ? owner[(py - 1) * n + (px - 1)] : -1;
      if (src > pi && parts[src].casts !== false && !parts[pi].emissive)
        level[i] = Math.max(1, level[i] - 1);
    }

  // Separator lines where a part sits on another (the lower part's line colour).
  const sepLevel = new Int8Array(n * n).fill(-1);
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      const i = py * n + px;
      const pi = owner[i];
      if (pi < 0) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const o = owner[y * n + x];
        if (o > pi && parts[o].sep) {
          sepLevel[i] = 0;
          break;
        }
      }
    }

  // Orphan clean-up (a lone level inside a flat patch of the same part).
  for (let pass = 0; pass < 2; pass++)
    for (let py = 1; py < n - 1; py++)
      for (let px = 1; px < n - 1; px++) {
        const i = py * n + px;
        const pi = owner[i];
        if (pi < 0 || parts[pi].keepOrphans) continue;
        const nb = [i - 1, i + 1, i - n, i + n];
        if (!nb.every((j) => owner[j] === pi)) continue;
        const lv = nb.map((j) => level[j]);
        if (lv.every((l) => l === lv[0]) && lv[0] !== level[i]) level[i] = lv[0];
      }

  // Key-light rim: silhouette pixels facing the upper-left light catch it (keeps dark
  // materials legible on ink panels without a lighter outline).
  if (spec.rim !== false)
    for (let py = 0; py < n; py++)
      for (let px = 0; px < n; px++) {
        const i = py * n + px;
        const pi = owner[i];
        if (pi < 0 || parts[pi].noRim || sepLevel[i] >= 0) continue;
        const open = (x, y) => x < 0 || y < 0 || owner[y * n + x] < 0;
        if (open(px - 1, py) && open(px, py - 1)) level[i] = Math.max(level[i], 3);
        else if ((open(px - 1, py) || open(px, py - 1)) && level[i] < 2) level[i] = 2;
      }

  // Specular glints: the brightest pixels of shiny parts.
  parts.forEach((part, pi) => {
    if (!part.spec) return;
    const idx = [];
    for (let i = 0; i < n * n; i++) if (owner[i] === pi && sepLevel[i] < 0) idx.push(i);
    idx.sort((a, b) => light[b] - light[a]);
    const count = Math.max(1, Math.round((part.spec === true ? 1 : part.spec) * (n / 16)));
    for (const i of idx.slice(0, count)) if (light[i] > 0.75) level[i] = 4;
  });
  // Explicit glint points (design space).
  for (const g of spec.glints || []) {
    if (g.minSize && n < g.minSize) continue;
    const px = Math.floor(g[0] * S);
    const py = Math.floor(g[1] * S);
    const i = py * n + px;
    if (px >= 0 && py >= 0 && px < n && py < n && owner[i] >= 0) level[i] = 4;
  }

  // Compose colours.
  const rgba = new Uint8ClampedArray(n * n * 4);
  const ramp = (part) => {
    const m = typeof part.mat === 'string' ? materials[part.mat] : part.mat;
    if (!m) throw new Error(`unknown material ${part.mat}`);
    return m;
  };
  const rampRgb = parts.map((p) => ramp(p).map(hexToRgb));
  const put = (i, rgb, a = 255) => {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = a;
  };
  for (let i = 0; i < n * n; i++) {
    const pi = owner[i];
    if (pi < 0) continue;
    const l = sepLevel[i] >= 0 ? 0 : level[i];
    put(i, rampRgb[pi][l]);
  }

  // Exterior outline.
  const outlineMode = spec.outline || 'selective';
  const filled = (x, y) => x >= 0 && y >= 0 && x < n && y < n && owner[y * n + x] >= 0;
  const outline = new Uint8Array(n * n);
  if (outlineMode !== 'none')
    for (let py = 0; py < n; py++)
      for (let px = 0; px < n; px++) {
        const i = py * n + px;
        if (owner[i] >= 0) continue;
        const right = filled(px + 1, py);
        const down = filled(px, py + 1);
        const left = filled(px - 1, py);
        const up = filled(px, py - 1);
        if (!(right || down || left || up)) continue;
        outline[i] = 1;
        let rgb = INK_OUTLINE;
        if (outlineMode === 'selective' && (right || down) && !(left || up)) {
          const o = right ? owner[i + 1] : owner[i + n];
          if (!parts[o].inkOutline) rgb = rampRgb[o][0];
        }
        if (parts.some((p) => p.emissive) && outlineMode === 'selective') {
          const o = [right && i + 1, down && i + n, left && i - 1, up && i - n].find((j) => j);
          if (o && parts[owner[o]]?.emissive) rgb = rampRgb[owner[o]][0];
        }
        put(i, rgb);
      }

  // Drop shadow (down-right), soft ink.
  if (spec.shadow) {
    const off = Math.max(1, Math.round(n / 32));
    for (let py = n - 1; py >= 0; py--)
      for (let px = n - 1; px >= 0; px--) {
        const i = py * n + px;
        if (owner[i] >= 0 || outline[i]) continue;
        const sx = px - off;
        const sy = py - off;
        if (sx < 0 || sy < 0) continue;
        const j = sy * n + sx;
        if (owner[j] >= 0 || outline[j]) put(i, INK_OUTLINE, 110);
      }
  }
  return { size: n, rgba };
}

/** Composite RGBA icons onto a background colour (for sheets). */
export function composite(dst, dw, src, sw, sh, ox, oy, scale = 1) {
  for (let y = 0; y < sh * scale; y++)
    for (let x = 0; x < sw * scale; x++) {
      const si = (Math.floor(y / scale) * sw + Math.floor(x / scale)) * 4;
      const a = src[si + 3] / 255;
      if (!a) continue;
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dw) continue;
      const di = (dy * dw + dx) * 4;
      for (let c = 0; c < 3; c++) dst[di + c] = Math.round(src[si + c] * a + dst[di + c] * (1 - a));
      dst[di + 3] = 255;
    }
}
