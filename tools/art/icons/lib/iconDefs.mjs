// Icon definitions for the procedural pixel direction ("Forged in code").
// Every builder returns a spec for pixelIcon.renderIcon: parts in a 32x32
// design space, lit from the upper left. Silhouette = family, metal = tier,
// accent (gem, wrap, cord, liquid) = what the item does (STAT/ELEMENT codes).

// ── Frames ───────────────────────────────────────────────────────────────

/** A local frame: `along` runs from origin at `deg` (0 = right, -45 = up-right). */
function frame(origin, deg) {
  const a = (deg * Math.PI) / 180;
  const u = [Math.cos(a), Math.sin(a)];
  const v = [-u[1], u[0]];
  const at = (along, across = 0) => [
    origin[0] + u[0] * along + v[0] * across,
    origin[1] + u[1] * along + v[1] * across,
  ];
  return { u, v, at, pts: (list) => list.map(([s, t]) => at(s, t)) };
}

const cap = (a, b, r) => ({ kind: 'capsule', a, b, r });
const circ = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const ell = (cx, cy, rx, ry, rot = 0) => ({ kind: 'ellipse', cx, cy, rx, ry, rot });
const poly = (pts) => ({ kind: 'poly', pts });
const ring = (cx, cy, r0, r1) => ({ kind: 'ring', cx, cy, r0, r1 });
const arc = (cx, cy, r, a0, a1, w) => ({ kind: 'arc', cx, cy, r, a0, a1, w });
const rect = (x, y, w, h) => ({ kind: 'rect', x, y, w, h });

// ── Weapons ──────────────────────────────────────────────────────────────

/**
 * Sword. opts: blade/fit metal, grip, accent (wrap or gem), variant:
 * 'broad' | 'rapier' | 'curved' | 'serrated' | 'twin' | 'short' | 'magic'
 */
/**
 * A blade outline around a bent centreline: `centre(s)` is the across-offset of the
 * blade's middle at `along` s, `half(s)` its half-width. Sampled from s0 to the tip.
 */
function bentBlade(s0, len, centre, half, tip = 1.2, steps = 10) {
  const top = [];
  const bottom = [];
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((len - s0) * i) / steps;
    top.push([s, centre(s) - half(s)]);
    bottom.push([s, centre(s) + half(s)]);
  }
  return [...top, [len + tip, centre(len + tip)], ...bottom.reverse()];
}

/** Named silhouettes for storied blades (the painted hero's shape at icon size). */
const SWORD_SHAPES = {
  // Katana: long, gently curved, single-edged; the spine bows away from the edge.
  katana: {
    len: 22.5,
    s0: 1.4,
    centre: (s) => -3.6 * (s / 22.5) ** 2,
    half: (s) => 1.55 - s * 0.018,
  },
  // Wo dao and other sabres: shorter, the same curve.
  curved: { len: 21, s0: 2, centre: (s) => -3.4 * (s / 21) ** 2, half: (s) => 1.9 - s * 0.02 },
  // A gust frozen in steel: short and strongly swept.
  gust: { len: 16.5, s0: 2, centre: (s) => -3.4 * (s / 16.5) ** 1.6, half: (s) => 2.1 - s * 0.05 },
  // Lightning bolt: the centreline zig-zags in hard steps.
  bolt: {
    len: 21,
    s0: 2,
    steps: 24,
    centre: (s) => {
      const pts = [
        [2, 0],
        [7, 2.1],
        [8, -1.2],
        [13.5, 1.6],
        [14.5, -1.4],
        [21, 0],
      ];
      for (let i = 1; i < pts.length; i++)
        if (s <= pts[i][0]) {
          const [a, ca] = pts[i - 1];
          const [b, cb] = pts[i];
          return ca + ((cb - ca) * (s - a)) / (b - a);
        }
      return 0;
    },
    half: (s) => 1.55 - s * 0.02,
  },
  // Falchion: straight spine, the edge swells toward the tip and runs out to a needle
  // point on the spine line (made to slip between plates).
  falchion: {
    len: 21.5,
    s0: 2,
    tip: 1.6,
    centre: (s) => 0.9 * Math.sin(Math.PI * Math.min(1, s / 21.5)) ** 1.3,
    half: (s) => 1.6 + 1.4 * Math.sin(Math.PI * Math.min(1, s / 21.5)) ** 1.3,
  },
  // Norse sword: broad, parallel-edged, rounded point.
  viking: {
    len: 19.5,
    s0: 2,
    tip: 1.6,
    centre: () => 0,
    half: (s) => (s > 17.5 ? 2.7 - (s - 17.5) * 0.7 : 2.7),
  },
};

export function sword({
  blade = 'iron',
  fit = 'ironFit',
  grip = 'cord',
  gem = null,
  variant = 'broad',
  core = null,
  temper = null,
  wind = null,
  tassel = null,
} = {}) {
  const f = frame([7.5, 24.5], -45);
  const shaped = SWORD_SHAPES[variant];
  const len = shaped ? shaped.len : variant === 'short' ? 15 : variant === 'rapier' ? 23 : 21;
  const w = variant === 'rapier' ? 1.15 : variant === 'broad' ? 2.35 : 2.05;
  const parts = [];
  const bladePts = shaped
    ? bentBlade(shaped.s0, shaped.len, shaped.centre, shaped.half, shaped.tip, shaped.steps)
    : variant === 'serrated'
      ? [
          [2, -w],
          [len - 3.5, -w],
          [len + 1, 0],
          [len - 3.5, w],
          [len * 0.8, w + 0.9],
          [len * 0.72, w],
          [len * 0.58, w + 0.9],
          [len * 0.5, w],
          [len * 0.36, w + 0.9],
          [len * 0.28, w],
          [2, w],
        ]
      : [
          [2, -w],
          [len - 3.5, -w],
          [len + 1, 0],
          [len - 3.5, w],
          [2, w],
        ];
  const bladeShape = poly(f.pts(bladePts));
  if (variant === 'twin') {
    // Two slender blades from one hilt, a clear gap between them.
    for (const off of [-1.9, 1.9]) {
      const g = frame(f.at(0, off), -45);
      parts.push({
        shape: poly(
          g.pts([
            [2, -1.05],
            [len - 3, -1.05],
            [len + 0.6, 0],
            [len - 3, 1.05],
            [2, 1.05],
          ]),
        ),
        mat: blade,
        shade: 'ridge',
        axis: g.u,
        spine0: g.at(0),
        halfWidth: 1.05,
        spec: 1.5,
        sep: true,
      });
    }
  } else
    parts.push({
      shape: bladeShape,
      mat: blade,
      shade: 'ridge',
      axis: f.u,
      spine0: f.at(0),
      halfWidth: shaped ? shaped.half(len / 2) : w,
      spec: 1.5,
    });
  if (wind)
    // Wind curling around the blade.
    for (const [c, r, a0, a1] of [
      [f.at(len * 0.62, -3.4), 4.2, Math.PI * 0.9, Math.PI * 1.75],
      [f.at(len * 0.32, 3.6), 3.6, -Math.PI * 0.15, Math.PI * 0.7],
    ])
      parts.push({
        shape: arc(c[0], c[1], r, a0, a1, 0.8),
        mat: wind,
        shade: 'flat',
        level: 3,
        minSize: 24,
        casts: false,
        emissive: true,
      });
  if (temper && shaped)
    // A temper line (hamon) running along the edge.
    parts.push({
      shape: poly(
        f.pts(
          bentBlade(
            4,
            len - 2.5,
            (t) => shaped.centre(t) + shaped.half(t) * 0.5,
            () => 0.36,
            0.4,
          ),
        ),
      ),
      mat: temper,
      shade: 'flat',
      level: 3,
      minSize: 24,
      casts: false,
      emissive: true,
    });
  if (core && shaped)
    parts.push({
      shape: poly(f.pts(bentBlade(4, len - 3, shaped.centre, () => 0.45, 0.5, shaped.steps))),
      mat: core,
      shade: 'flat',
      level: 3,
      minSize: 24,
      casts: false,
      emissive: true,
    });
  else if (core && variant === 'twin')
    for (const off of [-1.9, 1.9])
      parts.push({
        shape: cap(f.at(4, off), f.at(len - 4, off), 0.35),
        mat: core,
        shade: 'flat',
        level: 3,
        minSize: 32,
        casts: false,
        emissive: true,
      });
  else if (core)
    parts.push({
      shape: cap(f.at(4), f.at(len - 4), 0.45),
      mat: core,
      shade: 'flat',
      level: 3,
      minSize: 24,
      casts: false,
      emissive: true,
    });
  else if (variant !== 'rapier' && variant !== 'twin' && !shaped)
    parts.push({
      shape: cap(f.at(4.5), f.at(len - 5), 0.38),
      mat: blade,
      shade: 'flat',
      level: 1,
      minSize: 32,
      casts: false,
    });
  // Guard, grip, pommel.
  if (variant === 'katana') {
    // A round disc guard, a long two-handed grip and a tassel at the pommel.
    parts.push({ shape: circ(...f.at(0.8), 2.5), mat: fit, shade: 'dome', spec: true, sep: true });
    parts.push({
      shape: cap(f.at(-0.6), f.at(-7.6), 0.95),
      mat: grip,
      shade: 'cyl',
      stripes: { period: 1.6 },
    });
    parts.push({ shape: circ(...f.at(-8.3), 1.1), mat: fit, shade: 'sphere', sep: true });
    if (tassel)
      parts.push({
        shape: poly([f.at(-8.6, 0.4), f.at(-9.4, 3.6), f.at(-10.6, 3.2), f.at(-9.2, 0.2)]),
        mat: tassel,
        shade: 'flat',
        level: 2,
        sep: true,
      });
    return { parts, shadow: true };
  }
  if (variant === 'viking') {
    // Short thick guard and a heavy lobed pommel.
    parts.push({
      shape: cap(f.at(1, -3.4), f.at(1, 3.4), 1.3),
      mat: fit,
      shade: 'cyl',
      sep: true,
      spec: true,
    });
    parts.push({
      shape: cap(f.at(-0.4), f.at(-4.6), 0.95),
      mat: grip,
      shade: 'cyl',
      stripes: { period: 2 },
    });
    parts.push({
      shape: cap(f.at(-5.6, -2.2), f.at(-5.6, 2.2), 1.2),
      mat: fit,
      shade: 'cyl',
      sep: true,
    });
    for (const t of [-1.5, 0, 1.5])
      parts.push({
        shape: circ(...f.at(-6.8, t), 1.05),
        mat: fit,
        shade: 'sphere',
        sep: true,
        spec: t === 0,
      });
    return { parts, shadow: true };
  }
  const gw = variant === 'rapier' ? 3.2 : 4.6;
  if (variant === 'rapier')
    parts.push({
      shape: arc(
        ...f.at(-1.2, 0),
        3.2,
        -Math.PI * 0.25 - Math.PI / 2,
        Math.PI * 0.25 - Math.PI / 2 + Math.PI,
        0.9,
      ),
      mat: fit,
      shade: 'cyl',
      minSize: 24,
    });
  parts.push({
    shape: cap(f.at(1, -gw), f.at(1, gw), 1.05),
    mat: fit,
    shade: 'cyl',
    sep: true,
    spec: true,
  });
  parts.push({
    shape: cap(f.at(-0.4), f.at(-5.2), 0.95),
    mat: grip,
    shade: 'cyl',
    stripes: { period: 2 },
  });
  parts.push({
    shape: circ(...f.at(-6.6), 1.55),
    mat: gem ? gem : fit,
    shade: 'sphere',
    spec: true,
    sep: true,
  });
  return { parts, shadow: true };
}

export function lance({
  head = 'iron',
  shaft = 'wood',
  fit = 'ironFit',
  tassel = null,
  variant = 'leaf',
} = {}) {
  const f = frame([4, 28], -45);
  const L = 36;
  const parts = [];
  parts.push({
    shape: cap(f.at(0.5), f.at(L - 10), 0.95),
    mat: shaft,
    shade: 'cyl',
    stripes: variant === 'javelin' ? null : null,
  });
  if (tassel)
    parts.push({
      shape: poly(
        f.pts([
          [L - 11.5, 0.8],
          [L - 14, 3.6],
          [L - 16.6, 3.2],
          [L - 13.2, 0.6],
        ]),
      ),
      mat: tassel,
      shade: 'dome',
      sep: true,
    });
  parts.push({
    shape: cap(f.at(L - 11.5), f.at(L - 9.2), 1.25),
    mat: fit,
    shade: 'cyl',
    sep: true,
    spec: true,
  });
  const hp =
    variant === 'glaive'
      ? // A long single-edged sword head on the shaft.
        [
          [L - 11, -1.2],
          [L - 9.4, -2.1],
          [L + 0.4, -1.9],
          [L + 3, -0.1],
          [L + 0.6, 1.2],
          [L - 9.4, 1.3],
          [L - 11, 1.2],
        ]
      : variant === 'barbs'
        ? // Barbs all the way down the head.
          [
            [L - 10.5, -1.1],
            [L - 10.2, -3.6],
            [L - 8.4, -1.2],
            [L - 7.6, -3.3],
            [L - 5.8, -1.1],
            [L - 5, -2.9],
            [L - 3.2, -1],
            [L + 1, 0],
            [L - 3.2, 1],
            [L - 5, 2.9],
            [L - 5.8, 1.1],
            [L - 7.6, 3.3],
            [L - 8.4, 1.2],
            [L - 10.2, 3.6],
            [L - 10.5, 1.1],
          ]
        : variant === 'broad'
          ? [
              [L - 10.5, -1.5],
              [L - 7.5, -3.8],
              [L - 1.2, -0.7],
              [L + 0.9, 0],
              [L - 1.2, 0.7],
              [L - 7.5, 3.8],
              [L - 10.5, 1.5],
            ]
          : variant === 'barbed'
            ? [
                [L - 10.5, -1.2],
                [L - 9.8, -3.9],
                [L - 7.2, -1.5],
                [L - 2.2, -1.1],
                [L + 0.9, 0],
                [L - 2.2, 1.1],
                [L - 7.2, 1.5],
                [L - 9.8, 3.9],
                [L - 10.5, 1.2],
              ]
            : [
                [L - 10.5, -1.2],
                [L - 7, -3],
                [L - 2.2, -1.3],
                [L + 0.9, 0],
                [L - 2.2, 1.3],
                [L - 7, 3],
                [L - 10.5, 1.2],
              ];
  parts.push({
    shape: poly(f.pts(hp)),
    mat: head,
    shade: 'ridge',
    axis: f.u,
    spine0: f.at(0),
    halfWidth: 3.2,
    spec: 1.5,
    sep: true,
  });
  if (variant === 'javelin' || variant === 'throwing')
    parts[0].shape = cap(f.at(variant === 'throwing' ? 10 : 8), f.at(L - 10), 0.85);
  if (variant === 'throwing') {
    // Made to be thrown: a leather loop at the balance point and feathers at the butt.
    parts.push({
      shape: ring(...f.at(L - 17, 1.9), 1.1, 1.9),
      mat: 'wood',
      shade: 'flat',
      level: 2,
      minSize: 24,
      sep: true,
    });
    for (const side of [-1, 1])
      parts.push({
        shape: poly(
          f.pts([
            [10.2, side * 0.6],
            [13.6, side * 0.8],
            [11.4, side * 2.9],
            [8.6, side * 2.6],
          ]),
        ),
        mat: 'pearl',
        shade: 'flat',
        level: 2,
        sep: true,
      });
  }
  return { parts, shadow: true };
}

export function axe({
  head = 'iron',
  haft = 'wood',
  fit = 'ironFit',
  variant = 'bearded',
  gem = null,
} = {}) {
  const parts = [];
  const f = frame([7.5, 29], -60);
  const H = variant === 'hand' ? 21 : 26.5;
  parts.push({ shape: cap(f.at(0.5), f.at(H), 1.05), mat: haft, shade: 'cyl' });
  parts.push({
    shape: cap(f.at(1), f.at(4.5), 1.15),
    mat: 'cord',
    shade: 'cyl',
    stripes: { period: 1.8 },
  });
  // Head in a frame at the top of the haft; the blade grows toward +across (right).
  const h = frame(f.at(H - 5.5), -60);
  const k = variant === 'hand' ? 1.05 : 1.3;
  const sc = (list) => h.pts(list.map(([a, b]) => [a * k, b * k]));
  const big = variant === 'double' || variant === 'great';
  if (variant === 'hook') {
    // A nimble sword-catcher: a deep crescent bit, a short back spike, and a hook
    // curling from the butt of the haft to catch and wrench a blade.
    parts[0].shape = cap(f.at(2.5), f.at(H), 0.85);
    parts.push({
      shape: poly(
        h.pts([
          [9.4, -0.2],
          [8, -4.6],
          [5.2, -7.8],
          [1.4, -9.2],
          [-2.4, -8.4],
          [-4.8, -5.8],
          [-1.8, -6],
          [1.2, -6.4],
          [0.8, -1],
          [3.2, -1],
          [3.6, -5.6],
          [5.6, -3.4],
          [6.8, -0.6],
        ]),
      ),
      mat: head,
      shade: 'dome',
      domeDepth: 2,
      domeStrength: 0.7,
      spec: 1.5,
      sep: true,
    });
    parts.push({
      shape: poly(
        h.pts([
          [1.2, 0.8],
          [-1.8, 5.8],
          [-0.6, 0.8],
        ]),
      ),
      mat: head,
      shade: 'bevel',
      bevel: 0.6,
      sep: true,
    });
    parts.push({
      shape: arc(...f.at(2.2, 2.6), 2.6, Math.PI * 0.55, Math.PI * 1.55, 0.95),
      mat: head,
      shade: 'flat',
      level: 2,
      sep: true,
    });
  } else if (variant === 'hammer') {
    parts.push({
      shape: poly(
        h.pts([
          [-4.2, -4.6],
          [4.2, -4.6],
          [4.6, 7.4],
          [-4.6, 7.4],
        ]),
      ),
      mat: head,
      shade: 'bevel',
      bevel: 1.2,
      spec: 2,
      sep: true,
    });
    parts.push({
      shape: poly(
        h.pts([
          [-4.8, 5.4],
          [4.8, 5.4],
          [4.8, 8],
          [-4.8, 8],
        ]),
      ),
      mat: head,
      shade: 'bevel',
      bevel: 0.6,
      bias: 0.12,
      sep: true,
    });
  } else {
    const blade = big
      ? [
          [-1.4, 0.2],
          [-4.5, 3.5],
          [-6.8, 8.4],
          [-2.4, 9.8],
          [2.2, 10.2],
          [6.2, 8.8],
          [4.2, 3.6],
          [1.6, 0.2],
        ]
      : variant === 'hand'
        ? [
            [-0.8, 0.4],
            [-3.2, 3.4],
            [-4.8, 7.6],
            [0.2, 8.6],
            [4.6, 7.2],
            [2.6, 3.0],
            [1.2, 0.4],
          ]
        : [
            [-1.4, 0.2],
            [-4.2, 3.2],
            [-6.4, 7.8],
            [-1.6, 9.4],
            [3.2, 9.4],
            [5.8, 6.2],
            [3.2, 2.6],
            [1.4, 0.2],
          ];
    parts.push({
      shape: poly(sc(blade)),
      mat: head,
      shade: 'dome',
      domeDepth: 2.4,
      domeStrength: 0.75,
      spec: 1.5,
      sep: true,
    });
    // Bright cutting edge along the far rim.
    parts.push({
      shape: poly(
        sc(
          blade
            .slice(2, big ? 7 : 6)
            .map(([a, b]) => [a, b])
            .concat(
              blade
                .slice(2, big ? 7 : 6)
                .reverse()
                .map(([a, b]) => [a * 0.82, b * 0.84]),
            ),
        ),
      ),
      mat: head,
      shade: 'flat',
      level: 3,
      minSize: 24,
      casts: false,
    });
    if (big)
      parts.push({
        shape: poly(
          sc([
            [-1.2, -0.2],
            [-3.8, -2.6],
            [-4.8, -5.8],
            [-0.4, -5.4],
            [3.8, -5.6],
            [3.2, -2.4],
            [1.2, -0.2],
          ]),
        ),
        mat: head,
        shade: 'dome',
        domeDepth: 2,
        domeStrength: 0.75,
        sep: true,
      });
  }
  parts.push({
    shape: cap(h.at(-2.6), h.at(2.8), 1.45),
    mat: fit,
    shade: 'cyl',
    sep: true,
    spec: true,
  });
  if (gem)
    parts.push({
      shape: circ(...h.at(0, 0), 1.2),
      mat: gem,
      shade: 'sphere',
      spec: true,
      sep: true,
    });
  return { parts, shadow: true };
}

export function bow({
  limb = 'wood',
  fit = 'ironFit',
  string = 'parchment',
  size = 1,
  arrow = null,
  recurve = false,
} = {}) {
  const parts = [];
  const cx = 23;
  const cy = 23;
  const r = 16.5 * size;
  const a0 = Math.PI * 1.02;
  const a1 = Math.PI * 1.48;
  const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
  const p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
  parts.push({
    shape: cap(p0, p1, 0.4),
    mat: string,
    shade: 'flat',
    level: 3,
    casts: false,
    noRim: true,
  });
  if (arrow)
    parts.push({
      shape: cap([cx - 3, cy - 3], [cx - r * 0.95, cy - r * 0.95], 0.45),
      mat: arrow,
      shade: 'flat',
      level: 2,
    });
  parts.push({
    shape: arc(cx, cy, r, a0 - 0.02, a1 + 0.02, 2.8),
    mat: limb,
    shade: 'cyl',
    axis: [1, -1],
    centre: [cx - r * 0.707, cy - r * 0.707],
    halfWidth: 1.2,
    spec: 1,
  });
  if (recurve) {
    parts.push({ shape: cap(p0, [p0[0] + 1.2, p0[1] + 2.4], 0.9), mat: limb, shade: 'cyl' });
    parts.push({ shape: cap(p1, [p1[0] + 2.4, p1[1] + 1.2], 0.9), mat: limb, shade: 'cyl' });
  }
  const m = [cx - r * 0.707, cy - r * 0.707];
  parts.push({
    shape: cap([m[0] - 1.4, m[1] + 1.4], [m[0] + 1.4, m[1] - 1.4], 1.45),
    mat: fit,
    shade: 'cyl',
    sep: true,
    stripes: { period: 1.6 },
    spec: true,
  });
  return { parts, shadow: true };
}

/** Tome: cover colour = element, corner fittings = tier metal, emblem = element glyph. */
export function tome({
  cover = 'blood',
  fit = 'ironFit',
  emblem = 'fire',
  pages = 'parchment',
  emblemMat = 'ember',
} = {}) {
  const parts = [];
  // 3/4 book: page block (right/bottom), cover (front), spine (left).
  parts.push({
    shape: poly([
      [9, 7],
      [26, 5],
      [27, 24],
      [10, 27.5],
    ]),
    mat: pages,
    shade: 'flat',
    level: 2,
    stripes: { period: 1.4, axis: [1, 0] },
  });
  parts.push({
    shape: poly([
      [6, 6],
      [23.5, 4],
      [24.5, 23.5],
      [7, 26],
    ]),
    mat: cover,
    shade: 'bevel',
    bevel: 1.2,
    sep: true,
  });
  parts.push({
    shape: poly([
      [5, 6.2],
      [8, 5.8],
      [9, 26.4],
      [6, 26.8],
    ]),
    mat: cover,
    shade: 'cyl',
    axis: [0.05, 1],
    centre: [7, 16],
    halfWidth: 1.6,
    sep: true,
  });
  // Corner fittings (tier).
  for (const [x, y] of [
    [21.8, 5.6],
    [22.6, 22.4],
  ])
    parts.push({
      shape: poly([
        [x - 1.6, y - 1.6],
        [x + 1.7, y - 1.9],
        [x + 1.9, y + 1.5],
        [x - 1.4, y + 1.8],
      ]),
      mat: fit,
      shade: 'bevel',
      bevel: 0.6,
      spec: true,
      sep: true,
    });
  const e = emblemShape(emblem, 16.2, 15.2);
  e.forEach((s, i) =>
    parts.push({
      shape: s,
      mat: emblemMat,
      shade: i ? 'flat' : 'bevel',
      bevel: 0.8,
      level: i ? 3 : null,
      sep: true,
      spec: i ? false : 1,
      casts: false,
    }),
  );
  return { parts, shadow: true };
}

function emblemShape(kind, cx, cy) {
  switch (kind) {
    case 'fire':
      return [
        poly([
          [cx, cy - 6],
          [cx + 3.4, cy - 1],
          [cx + 3.2, cy + 3],
          [cx + 0.2, cy + 5],
          [cx - 3.2, cy + 3],
          [cx - 3.4, cy - 0.6],
          [cx - 1.6, cy + 0.6],
        ]),
      ];
    case 'thunder':
      return [
        poly([
          [cx + 1.2, cy - 6.2],
          [cx - 3.4, cy + 0.6],
          [cx - 0.2, cy + 0.6],
          [cx - 1.6, cy + 6],
          [cx + 3.6, cy - 1],
          [cx + 0.4, cy - 1],
        ]),
      ];
    case 'wind':
      return [
        arc(cx, cy, 4, Math.PI * 0.9, Math.PI * 2.4, 1.6),
        arc(cx + 1, cy, 1.6, Math.PI * 1.2, Math.PI * 2.6, 1.2),
      ];
    case 'light':
      return [
        poly([
          [cx, cy - 6],
          [cx + 1.5, cy - 1.5],
          [cx + 6, cy],
          [cx + 1.5, cy + 1.5],
          [cx, cy + 6],
          [cx - 1.5, cy + 1.5],
          [cx - 6, cy],
          [cx - 1.5, cy - 1.5],
        ]),
      ];
    case 'dark':
      return [circ(cx, cy, 4.2), circ(cx, cy, 1.6)];
    case 'sun':
      return [ring(cx, cy, 2.6, 4.6)];
    default:
      return [circ(cx, cy, 3.5)];
  }
}

/** Staff: rod (wood or metal), head = crook ring + gem (healing verdigris, status unlight...). */
export function staff({ rod = 'wood', fit = 'gilt', gem = 'verdigris', variant = 'ring' } = {}) {
  const parts = [];
  const f = frame([5, 28], -50);
  parts.push({ shape: cap(f.at(0.5), f.at(24), 0.9), mat: rod, shade: 'cyl' });
  parts.push({ shape: cap(f.at(17.5), f.at(20), 1.25), mat: fit, shade: 'cyl', sep: true });
  const c = f.at(27.4);
  if (variant === 'ring') {
    parts.push({
      shape: ring(c[0], c[1], 3.3, 5.1),
      mat: fit,
      shade: 'cyl',
      axis: [1, 0],
      sep: true,
      spec: 1,
    });
    parts.push({
      shape: circ(c[0], c[1], 2.4),
      mat: gem,
      shade: 'sphere',
      spec: true,
      emissive: true,
    });
  } else if (variant === 'crescent') {
    parts.push({
      shape: arc(c[0], c[1], 4.2, Math.PI * 0.75, Math.PI * 2.25, 1.9),
      mat: fit,
      shade: 'cyl',
      sep: true,
      spec: 1,
    });
    parts.push({
      shape: circ(c[0] + 0.3, c[1] - 0.3, 2.1),
      mat: gem,
      shade: 'sphere',
      spec: true,
      emissive: true,
    });
  } else {
    // wing
    parts.push({
      shape: poly([
        [c[0] - 1.5, c[1] + 2.5],
        [c[0] - 6, c[1] - 2],
        [c[0] - 3, c[1] - 3.6],
        [c[0], c[1] - 1.5],
      ]),
      mat: gem,
      shade: 'dome',
      sep: true,
    });
    parts.push({
      shape: poly([
        [c[0] + 1.5, c[1] - 2.5],
        [c[0] + 2, c[1] - 6.8],
        [c[0] + 3.8, c[1] - 3],
        [c[0] + 1.5, c[1]],
      ]),
      mat: gem,
      shade: 'dome',
      sep: true,
    });
    parts.push({ shape: circ(c[0], c[1], 2.2), mat: fit, shade: 'sphere', spec: true, sep: true });
  }
  return { parts, shadow: true };
}

/** Dragonstone for breath weapons. */
export function stoneGem({ mat = 'blood', fit = 'gilt', facets = 'hex', setting = true } = {}) {
  const parts = [];
  if (setting)
    parts.push({
      shape: poly([
        [9, 19],
        [23, 19],
        [21, 27],
        [11, 27],
      ]),
      mat: fit,
      shade: 'bevel',
      bevel: 1,
    });
  const pts =
    facets === 'hex'
      ? [
          [16, 3.5],
          [24.5, 9],
          [24.5, 18.5],
          [16, 24.5],
          [7.5, 18.5],
          [7.5, 9],
        ]
      : [
          [16, 3],
          [25, 13],
          [16, 26],
          [7, 13],
        ];
  parts.push({ shape: poly(pts), mat, shade: 'dome', domeStrength: 0.8, spec: 2, sep: true });
  // Facet lines (48+).
  parts.push({
    shape: poly([
      [16, 7.5],
      [20.8, 10.5],
      [20.8, 16.8],
      [16, 20.2],
      [11.2, 16.8],
      [11.2, 10.5],
    ]),
    mat,
    shade: 'flat',
    level: 3,
    minSize: 24,
    casts: false,
    bias: 0.1,
  });
  return { parts, shadow: true };
}

// ── Scrolls, seals, supplies ─────────────────────────────────────────────

export function scroll({
  paper = 'parchment',
  cord = 'unlight',
  seal = 'unlight',
  mark = null,
} = {}) {
  const parts = [];
  const f = frame([6, 25], -40);
  parts.push({ shape: cap(f.at(1.5), f.at(22), 4.2), mat: paper, shade: 'cyl', spec: 1 });
  parts.push({
    shape: ell(...f.at(22.2), 1.7, 4.2, -40),
    mat: paper,
    shade: 'flat',
    level: 1,
    sep: true,
  });
  parts.push({
    shape: ring(...f.at(22.2), 0.2, 1.1),
    mat: paper,
    shade: 'flat',
    level: 0,
    minSize: 24,
    casts: false,
  });
  parts.push({
    shape: cap(f.at(11, -4.8), f.at(11, 4.8), 1.1),
    mat: cord,
    shade: 'cyl',
    sep: true,
  });
  parts.push({
    shape: poly(
      f.pts([
        [10.2, 4.2],
        [7.6, 9.8],
        [9.6, 9.6],
        [11.2, 5.2],
      ]),
    ),
    mat: cord,
    shade: 'dome',
    sep: true,
  });
  parts.push({
    shape: poly(
      f.pts([
        [11.8, 4.2],
        [14.6, 9.4],
        [12.6, 9.6],
        [11, 5.2],
      ]),
    ),
    mat: cord,
    shade: 'dome',
    sep: true,
  });
  parts.push({
    shape: circ(...f.at(11, 0.2), 2.9),
    mat: seal,
    shade: 'sphere',
    sep: true,
    spec: 1,
  });
  if (mark)
    parts.push({
      shape: mark(f.at(11, 0.2)),
      mat: seal,
      shade: 'flat',
      level: 0,
      minSize: 32,
      casts: false,
    });
  return { parts, shadow: true };
}

export function seal({ wax = 'blood', ribbon = 'cloth', metal = 'gilt', glyph = 'star' } = {}) {
  const parts = [];
  parts.push({
    shape: poly([
      [11, 16],
      [7.5, 29],
      [11, 26.5],
      [13.5, 29.5],
      [15.5, 18],
    ]),
    mat: ribbon,
    shade: 'bevel',
    bevel: 0.8,
  });
  parts.push({
    shape: poly([
      [21, 16],
      [24.5, 29],
      [21, 26.5],
      [18.5, 29.5],
      [16.5, 18],
    ]),
    mat: ribbon,
    shade: 'bevel',
    bevel: 0.8,
  });
  // Wax blob: scalloped disc.
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const r = i % 2 ? 10.6 : 11.8;
    pts.push([16 + Math.cos(a) * r, 13.5 + Math.sin(a) * r]);
  }
  parts.push({ shape: poly(pts), mat: wax, shade: 'dome', domeDepth: 3, sep: true, spec: 1 });
  parts.push({
    shape: ring(16, 13.5, 6.2, 7.6),
    mat: wax,
    shade: 'flat',
    level: 1,
    casts: false,
    minSize: 24,
  });
  parts.push({
    shape: glyphShape(glyph, 16, 13.5),
    mat: metal,
    shade: 'bevel',
    bevel: 0.7,
    spec: 1,
    sep: true,
  });
  return { parts, shadow: true };
}

function glyphShape(kind, cx, cy, s = 1) {
  switch (kind) {
    case 'star':
      return poly(
        Array.from({ length: 10 }, (_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = (i % 2 ? 2.2 : 5.2) * s;
          return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        }),
      );
    case 'boot':
      return poly([
        [cx - 2.6, cy - 5],
        [cx + 1, cy - 5],
        [cx + 1, cy + 1],
        [cx + 5, cy + 2],
        [cx + 5, cy + 5],
        [cx - 2.6, cy + 5],
      ]);
    case 'horseshoe':
      return arc(cx, cy - 0.5, 3.8, Math.PI * 0.75, Math.PI * 2.25, 2.2);
    case 'sun':
      return ring(cx, cy, 2.2, 4.4);
    case 'eye':
      return ell(cx, cy, 5, 2.6);
    case 'cross':
      return poly([
        [cx - 1.4, cy - 5],
        [cx + 1.4, cy - 5],
        [cx + 1.4, cy - 1.4],
        [cx + 5, cy - 1.4],
        [cx + 5, cy + 1.4],
        [cx + 1.4, cy + 1.4],
        [cx + 1.4, cy + 5],
        [cx - 1.4, cy + 5],
        [cx - 1.4, cy + 1.4],
        [cx - 5, cy + 1.4],
        [cx - 5, cy - 1.4],
        [cx - 1.4, cy - 1.4],
      ]);
    case 'diamond':
      return poly([
        [cx, cy - 5],
        [cx + 4, cy],
        [cx, cy + 5],
        [cx - 4, cy],
      ]);
    case 'blades': {
      // Two short blades crossed (points up), as one outline.
      const k = 5.2 * s;
      const t = 0.95 * s;
      return poly([
        [cx - k, cy - k],
        [cx - k + t * 1.6, cy - k],
        [cx, cy - t * 1.1],
        [cx + k - t * 1.6, cy - k],
        [cx + k, cy - k],
        [cx + k, cy - k + t * 1.6],
        [cx + t * 1.1, cy],
        [cx + k, cy + k - t * 0.4],
        [cx + k - t * 1.4, cy + k],
        [cx, cy + t * 1.1],
        [cx - k + t * 1.4, cy + k],
        [cx - k, cy + k - t * 0.4],
        [cx - t * 1.1, cy],
        [cx - k, cy - k + t * 1.6],
      ]);
    }
    default:
      return circ(cx, cy, 3.5 * s);
  }
}

export function vial({ liquid = 'verdigris', glass = 'sky', cork = 'wood', shape = 'vial' } = {}) {
  const parts = [];
  if (shape === 'flask') {
    parts.push({
      shape: circ(16, 19.5, 9.2),
      mat: glass,
      shade: 'sphere',
      level: null,
      minLevel: 1,
      maxLevel: 2,
    });
    parts.push({
      shape: circ(16, 20.2, 7.8),
      holes: [rect(0, 0, 32, 15.5)],
      mat: liquid,
      shade: 'sphere',
      emissive: true,
      spec: 0,
    });
    parts.push({
      shape: rect(13.2, 5.5, 5.6, 6.5),
      mat: glass,
      shade: 'cyl',
      axis: [0, 1],
      minLevel: 1,
      maxLevel: 2,
      sep: true,
    });
    parts.push({
      shape: rect(12.4, 2.5, 7.2, 4),
      mat: cork,
      shade: 'bevel',
      bevel: 0.8,
      sep: true,
      spec: 1,
    });
  } else if (shape === 'tin') {
    parts.push({ shape: rect(6, 11, 20, 14), mat: glass, shade: 'bevel', bevel: 1.1, spec: 1 });
    parts.push({
      shape: rect(5, 8, 22, 5),
      mat: cork,
      shade: 'bevel',
      bevel: 0.8,
      sep: true,
      spec: 1,
    });
    parts.push({
      shape: glyphShape('cross', 16, 18.5),
      mat: liquid,
      shade: 'flat',
      level: 3,
      sep: true,
    });
  } else {
    parts.push({
      shape: poly([
        [12, 11],
        [20, 11],
        [22.5, 17],
        [22.5, 27.5],
        [9.5, 27.5],
        [9.5, 17],
      ]),
      mat: glass,
      shade: 'cyl',
      axis: [0, 1],
      centre: [16, 20],
      halfWidth: 6.5,
      minLevel: 1,
      maxLevel: 2,
    });
    parts.push({
      shape: poly([
        [10.8, 17.5],
        [21.2, 17.5],
        [21.2, 26.2],
        [10.8, 26.2],
      ]),
      mat: liquid,
      shade: 'cyl',
      axis: [0, 1],
      centre: [16, 20],
      halfWidth: 5.5,
      emissive: true,
    });
    parts.push({
      shape: rect(13, 7.5, 6, 4.5),
      mat: glass,
      shade: 'cyl',
      axis: [0, 1],
      minLevel: 1,
      maxLevel: 2,
      sep: true,
    });
    parts.push({
      shape: rect(12.4, 3.5, 7.2, 4.5),
      mat: cork,
      shade: 'bevel',
      bevel: 0.8,
      sep: true,
      spec: 1,
    });
  }
  return {
    parts,
    shadow: true,
    glints: [
      [11.5, 19.5],
      [12, 18.5],
    ],
  };
}

export function herb() {
  const leaf = (cx, cy, deg, len = 9, w = 3.2) => {
    const f = frame([cx, cy], deg);
    return poly(
      f.pts([
        [0, 0],
        [len * 0.35, -w],
        [len * 0.8, -w * 0.6],
        [len, 0],
        [len * 0.8, w * 0.6],
        [len * 0.35, w],
      ]),
    );
  };
  return {
    parts: [
      { shape: cap([9, 28], [17, 12], 0.7), mat: 'earth', shade: 'cyl' },
      { shape: leaf(15, 15, -110, 12, 3.8), mat: 'leaf', shade: 'dome', sep: true },
      { shape: leaf(14, 19, -160, 10, 3.2), mat: 'verdigris', shade: 'dome', sep: true },
      { shape: leaf(15.5, 17, -40, 12, 3.6), mat: 'leaf', shade: 'dome', sep: true, spec: 1 },
      { shape: leaf(12, 23, 10, 8, 2.6), mat: 'verdigris', shade: 'dome', sep: true },
    ],
    shadow: true,
  };
}

// ── Accessories ──────────────────────────────────────────────────────────

export function ringItem({ band = 'gilt', gem = 'blood', cut = 'round', wide = false } = {}) {
  const parts = [];
  parts.push({
    shape: ell(16, 19.5, 10.2, 9.2),
    holes: [ell(16, 20.4, wide ? 6.2 : 7.2, wide ? 5.4 : 6.4)],
    mat: band,
    shade: 'dome',
    domeDepth: 1.8,
    domeStrength: 0.85,
    spec: 1.5,
  });
  if (gem) {
    // Bezel cradles the stone where it meets the band.
    parts.push({
      shape: ell(16, 11.4, 5.6, 3),
      mat: band,
      shade: 'dome',
      domeDepth: 1.2,
      sep: true,
      spec: 1,
    });
    const g =
      cut === 'square'
        ? poly([
            [11.6, 4],
            [20.4, 4],
            [21.4, 9],
            [16, 12.6],
            [10.6, 9],
          ])
        : cut === 'marquise'
          ? poly([
              [16, 2.6],
              [20.6, 7.6],
              [16, 12.4],
              [11.4, 7.6],
            ])
          : circ(16, 7.8, 4.6);
    parts.push({
      shape: g,
      mat: gem,
      shade: cut === 'round' ? 'sphere' : 'dome',
      spec: 1.5,
      sep: true,
      emissive: true,
    });
  }
  return { parts, shadow: true };
}

export function pendant({ chain = 'gilt', body = 'gilt', gem = 'pearl', form = 'oval' } = {}) {
  const parts = [];
  if (form === 'phoenix') return phoenixBrooch({ body, gem });
  parts.push({
    shape: arc(16, 9, 9, Math.PI * 0.95, Math.PI * 2.05, 1.1),
    mat: chain,
    shade: 'flat',
    level: 2,
    stripes: { period: 1.6, axis: [1, 0] },
  });
  if (form === 'wing')
    // Spread wings either side of the jewel, their feathers scalloped.
    for (const m of [-1, 1])
      parts.push({
        shape: poly(
          [
            [13, 15],
            [10, 11],
            [5, 8.4],
            [0.8, 7.2],
            [3.6, 11.4],
            [1.4, 12.6],
            [5, 15.4],
            [2.8, 16.8],
            [7, 18.8],
            [5.6, 20.4],
            [10, 21],
            [13, 19.6],
          ].map(([x, y]) => [16 + m * (16 - x), y]),
        ),
        mat: body,
        shade: 'dome',
        domeDepth: 2,
        spec: 1,
        sep: true,
      });
  const bodyShape =
    form === 'wing'
      ? ell(16, 18.5, 4.4, 6.2)
      : form === 'moon'
        ? circ(16, 20, 7.8)
        : form === 'leaf'
          ? poly([
              [16, 10.5],
              [23, 17],
              [21.5, 25],
              [16, 29],
              [10.5, 25],
              [9, 17],
            ])
          : ell(16, 20, 7, 8.4);
  parts.push({
    shape: bodyShape,
    holes: form === 'moon' ? [circ(19.4, 17.4, 6.6)] : [],
    mat: body,
    shade: 'dome',
    spec: 1.5,
    sep: true,
  });
  if (gem && form !== 'moon')
    parts.push({
      shape:
        form === 'leaf'
          ? ell(16, 20, 2.6, 4)
          : form === 'wing'
            ? circ(16, 18.6, 2.7)
            : circ(16, 19.6, 3.4),
      mat: gem,
      shade: 'sphere',
      spec: 1,
      sep: true,
      emissive: true,
    });
  parts.push({ shape: circ(16, 10.6, 1.7), mat: chain, shade: 'sphere', sep: true });
  return { parts, shadow: true };
}

export function medal({
  ribbon = 'blood',
  disc = 'gilt',
  glyph = 'star',
  glyphMat = 'gilt',
  shape = 'round',
} = {}) {
  const parts = [];
  parts.push({
    shape: poly([
      [10.5, 2.5],
      [21.5, 2.5],
      [20, 13],
      [16, 15],
      [12, 13],
    ]),
    mat: ribbon,
    shade: 'bevel',
    bevel: 0.8,
    stripes: { period: 3, axis: [1, 0] },
  });
  const body =
    shape === 'shield'
      ? poly([
          [8, 12],
          [24, 12],
          [24, 20],
          [16, 29.5],
          [8, 20],
        ])
      : shape === 'diamond'
        ? poly([
            [16, 10.5],
            [26, 20],
            [16, 29.5],
            [6, 20],
          ])
        : circ(16, 20.5, 8.6);
  parts.push({
    shape: body,
    mat: disc,
    shade: shape === 'round' ? 'dome' : 'bevel',
    bevel: 1.3,
    domeDepth: 2.6,
    spec: 1.5,
    sep: true,
  });
  parts.push({
    shape: glyphShape(glyph, 16, 20.5, 0.8),
    mat: glyphMat,
    shade: 'bevel',
    bevel: 0.6,
    sep: true,
    spec: 1,
  });
  return { parts, shadow: true };
}

export function band({ metal = 'gilt', inlay = 'blood', studs = true } = {}) {
  const parts = [];
  parts.push({
    shape: ell(16, 17, 12, 9),
    holes: [ell(16, 15.6, 8.6, 5)],
    mat: metal,
    shade: 'cyl',
    axis: [1, 0.5],
    centre: [16, 17],
    halfWidth: 11,
    spec: 1.5,
  });
  parts.push({
    shape: arc(16, 17.4, 10.3, Math.PI * 0.1, Math.PI * 0.9, 2.4),
    mat: inlay,
    shade: 'cyl',
    axis: [1, 0],
    centre: [16, 26],
    halfWidth: 10,
    sep: true,
    emissive: true,
  });
  if (studs)
    for (const x of [9, 16, 23])
      parts.push({
        shape: circ(x, x === 16 ? 27.2 : 25, 1.3),
        mat: metal,
        shade: 'sphere',
        spec: true,
        sep: true,
        minSize: 24,
      });
  return { parts, shadow: true };
}

export function coin({ face = 'gilt', back = 'unlight', glyph = 'split' } = {}) {
  // Standing coin in 3/4: milled edge on the right, face with a split sun/moon (heads/tails).
  const parts = [];
  parts.push({
    shape: ell(18.2, 16.5, 8.2, 12.2),
    mat: face,
    shade: 'flat',
    level: 1,
    stripes: { period: 1.4, axis: [0, 1] },
  });
  parts.push({
    shape: ell(15.6, 16, 8.2, 12.2),
    mat: face,
    shade: 'dome',
    domeDepth: 2.4,
    spec: 2,
    sep: true,
  });
  parts.push({
    shape: ell(15.6, 16, 5.4, 8.8),
    mat: face,
    shade: 'flat',
    level: 1,
    minSize: 24,
    casts: false,
  });
  if (glyph === 'split') {
    parts.push({
      shape: circ(15.6, 16, 3.8),
      holes: [rect(15.6, 0, 20, 32)],
      mat: face,
      shade: 'flat',
      level: 3,
      sep: true,
      minSize: 24,
    });
    parts.push({
      shape: circ(15.6, 16, 3.8),
      holes: [rect(0, 0, 15.6, 32)],
      mat: back,
      shade: 'flat',
      level: 2,
      sep: true,
    });
  } else
    parts.push({
      shape: glyphShape(glyph, 15.6, 16, 0.7),
      mat: face,
      shade: 'bevel',
      bevel: 0.6,
      spec: 1,
      sep: true,
    });
  return { parts, shadow: true, glints: [[25.5, 4.5]] };
}

export function gemItem({ mat = 'blood', cut = 'drop', fit = null } = {}) {
  const parts = [];
  const shape =
    cut === 'drop'
      ? poly([
          [16, 3],
          [22.5, 14],
          [23.5, 19.5],
          [20.5, 25.5],
          [16, 27.5],
          [11.5, 25.5],
          [8.5, 19.5],
          [9.5, 14],
        ])
      : cut === 'oval'
        ? ell(16, 16, 7.2, 9.8)
        : cut === 'shard'
          ? poly([
              [18, 2.5],
              [23.5, 12],
              [21, 28.5],
              [13.5, 29],
              [9, 17],
              [12, 8],
            ])
          : poly([
              [16, 4],
              [26, 12],
              [22.5, 26],
              [9.5, 26],
              [6, 12],
            ]);
  if (cut === 'oval' && fit)
    // A gold setting around the stone, with four claws.
    parts.push({ shape: ell(16, 16, 9.4, 12.2), mat: fit, shade: 'dome', domeDepth: 1.4, spec: 1 });
  parts.push({ shape, mat, shade: 'dome', domeStrength: 0.85, spec: 2, sep: true });
  parts.push({
    shape:
      cut === 'oval'
        ? ell(15, 14, 3, 4.6)
        : cut === 'drop'
          ? ell(16, 19, 3.2, 4.6)
          : cut === 'shard'
            ? poly([
                [17.5, 8],
                [20, 14],
                [16.5, 23],
                [13.5, 15],
              ])
            : poly([
                [16, 8.5],
                [21, 13],
                [19, 21],
                [13, 21],
                [11, 13],
              ]),
    mat,
    shade: 'flat',
    level: 3,
    minSize: 24,
    casts: false,
  });
  if (fit && cut !== 'oval')
    parts.push({ shape: rect(12, 1.5, 8, 3), mat: fit, shade: 'bevel', bevel: 0.6, sep: true });
  return { parts, shadow: true };
}

export function whetstone({ stone = 'stone', streak = 'blood', silver = false } = {}) {
  const parts = [];
  const f = frame([5, 21], -18);
  parts.push({
    shape: poly(
      f.pts([
        [0, -4.2],
        [23, -4.2],
        [24.5, -2],
        [24.5, 3],
        [23, 4.8],
        [0, 4.8],
        [-1.2, 3],
        [-1.2, -2],
      ]),
    ),
    mat: silver ? 'silver' : stone,
    shade: 'bevel',
    bevel: 1.2,
    spec: silver ? 3 : 1,
  });
  parts.push({
    shape: poly(
      f.pts([
        [3, -0.9],
        [21.5, -1.6],
        [21.5, 1.2],
        [3, 1.6],
      ]),
    ),
    mat: streak,
    shade: 'flat',
    level: 3,
    sep: true,
    emissive: true,
  });
  parts.push({
    shape: poly(
      f.pts([
        [3, 2.4],
        [8, 2.2],
        [8, 3.2],
        [3, 3.4],
      ]),
    ),
    mat: silver ? 'silver' : stone,
    shade: 'flat',
    level: 1,
    minSize: 32,
    casts: false,
  });
  return { parts, shadow: true };
}

/** One hexagonal prism with a pointed top: lit left face, shadowed right face. */
function prism(parts, { x, y, h, w, lean = 0, mat, spec = false }) {
  const f = frame([x, y], -90 + lean);
  const top = h;
  const tip = h + w * 0.9;
  parts.push({
    shape: poly(
      f.pts([
        [0, -w],
        [top, -w],
        [tip, 0],
        [0, 0],
      ]),
    ),
    mat,
    shade: 'flat',
    bias: 0.22,
    sep: true,
    spec: spec ? 1.5 : false,
    emissive: true,
  });
  parts.push({
    shape: poly(
      f.pts([
        [0, 0],
        [tip, 0],
        [top, w],
        [0, w],
      ]),
    ),
    mat,
    shade: 'flat',
    bias: -0.28,
    emissive: true,
  });
  parts.push({
    shape: poly(
      f.pts([
        [top - 0.2, -w * 0.55],
        [tip - 0.6, -0.2],
        [top - 0.2, -0.2],
      ]),
    ),
    mat,
    shade: 'flat',
    level: 3,
    casts: false,
    minSize: 24,
    emissive: true,
  });
}

export function crystal({ mat = 'blood', fit = 'stone', prismatic = null } = {}) {
  const parts = [];
  parts.push({ shape: ell(16, 26.5, 11, 3.6), mat: fit, shade: 'dome', domeDepth: 1.6 });
  const m = (i) => (prismatic ? prismatic[i % prismatic.length] : mat);
  prism(parts, { x: 10.5, y: 27, h: 9, w: 3, lean: -24, mat: m(1) });
  prism(parts, { x: 22, y: 27, h: 8, w: 2.8, lean: 26, mat: m(2) });
  prism(parts, { x: 16, y: 28, h: 15, w: 4.2, lean: 4, mat: m(0), spec: true });
  return { parts, shadow: true, glints: [[13.5, 9]] };
}

export function goldPile() {
  const parts = [];
  const coinAt = (x, y) => ({
    shape: ell(x, y, 5.4, 2.6),
    mat: 'gilt',
    shade: 'dome',
    domeDepth: 1.4,
    spec: 1,
    sep: true,
  });
  const stack = (x, base, n) => {
    for (let i = 0; i < n; i++) parts.push(coinAt(x, base - i * 2.3));
  };
  stack(10, 27, 4);
  stack(22, 27.5, 5);
  stack(16, 29, 3);
  return { parts, shadow: true };
}

// ── Stat boosters (unique objects in stat colours) ───────────────────────

export function feather({ mat = 'sky' } = {}) {
  const f = frame([7, 27], -58);
  const vane = [];
  for (let i = 0; i <= 10; i++) {
    const s = 3 + i * 2.1;
    vane.push([s, -(Math.sin((i / 10) * Math.PI) * 4.6 + 1)]);
  }
  for (let i = 10; i >= 0; i--) {
    const s = 3 + i * 2.1;
    vane.push([s, Math.sin((i / 10) * Math.PI) * 3.6 + 0.8]);
  }
  return {
    parts: [
      { shape: poly(f.pts(vane)), mat, shade: 'dome', domeStrength: 0.7, spec: 1 },
      {
        shape: cap(f.at(0), f.at(24), 0.55),
        mat: 'parchment',
        shade: 'flat',
        level: 3,
        sep: false,
      },
      {
        shape: poly(
          f.pts([
            [9, -5],
            [11, -3.2],
            [12.4, -5.4],
          ]),
        ),
        holes: [],
        mat,
        shade: 'flat',
        level: 1,
        minSize: 32,
        casts: false,
      },
    ],
    shadow: true,
  };
}

/** A brooch, not a pendant: wings sweeping down around the stone, a fan of tail below. */
function phoenixBrooch({ body = 'ember', gem = 'blood' } = {}) {
  const parts = [];
  for (const m of [-1, 1])
    parts.push({
      shape: poly(
        [
          [12.8, 12.4],
          [10, 7.4],
          [6.4, 4.6],
          [3, 5.2],
          [1, 8.6],
          [0.9, 13.6],
          [2, 19],
          [4.2, 24.6],
          [5.4, 20.4],
          [6.8, 22.4],
          [7.4, 17.8],
          [9, 19.2],
          [9.8, 15.4],
          [12.6, 17],
        ].map(([x, y]) => [16 + m * (16 - x), y]),
      ),
      mat: body,
      shade: 'dome',
      domeDepth: 2,
      spec: 1,
      sep: true,
    });
  parts.push({
    shape: poly([
      [13.4, 20],
      [18.6, 20],
      [20.4, 28],
      [18, 26.4],
      [16, 29],
      [14, 26.4],
      [11.6, 28],
    ]),
    mat: 'gilt',
    shade: 'bevel',
    bevel: 0.6,
    sep: true,
  });
  parts.push({
    shape: ell(16, 15.5, 4.6, 5.8),
    mat: 'verdigris',
    shade: 'dome',
    spec: 1,
    sep: true,
  });
  parts.push({
    shape: ell(16, 15.5, 3, 4),
    mat: gem,
    shade: 'sphere',
    spec: 1,
    sep: true,
    emissive: true,
  });
  return { parts, shadow: true };
}

/** A leaf plaited on a cord: pointed blade, midrib and side veins, no stone. */
export function leafCharm({ leaf = 'leaf', cord = 'cloth' } = {}) {
  const f = frame([11.5, 10.5], 58);
  const L = 20.5;
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([t * L, -(Math.sin(Math.PI * t) ** 0.75) * 6.6]);
  }
  for (let i = 10; i >= 0; i--) {
    const t = i / 10;
    pts.push([t * L, Math.sin(Math.PI * t) ** 0.75 * 6.6]);
  }
  const parts = [
    {
      shape: arc(12, 8.5, 6.6, Math.PI * 0.85, Math.PI * 2.1, 1),
      mat: cord,
      shade: 'flat',
      level: 2,
      stripes: { period: 1.6, axis: [1, 0] },
    },
    { shape: poly(f.pts(pts)), mat: leaf, shade: 'dome', domeDepth: 2.2, spec: 1, sep: true },
    {
      shape: cap(f.at(0.6), f.at(L - 2.5), 0.5),
      mat: 'verdigris',
      shade: 'flat',
      level: 1,
      sep: true,
      casts: false,
    },
  ];
  for (const [a, side] of [
    [5.5, -1],
    [5.5, 1],
    [10.5, -1],
    [10.5, 1],
  ])
    parts.push({
      shape: cap(f.at(a), f.at(a + 3.4, side * 3.6), 0.45),
      mat: 'verdigris',
      shade: 'flat',
      level: 1,
      minSize: 32,
      casts: false,
    });
  parts.push({ shape: circ(...f.at(-0.4), 1.5), mat: 'wood', shade: 'sphere', sep: true });
  return { parts, shadow: true };
}

export function robe({ cloth = 'verdigris', trim = 'gilt', wings = null, hood = false } = {}) {
  const wingParts = wings
    ? [-1, 1].map((m) => ({
        shape: poly(
          [
            [9, 8.5],
            [3.5, 3.2],
            [1.4, 5.8],
            [2.6, 7],
            [1.2, 9.4],
            [3, 10.2],
            [2.4, 12.6],
            [6, 12.4],
            [9.6, 11.6],
          ].map(([x, y]) => [16 + m * (16 - x), y]),
        ),
        mat: wings,
        shade: 'dome',
        domeDepth: 1.6,
        spec: 1,
        sep: true,
      }))
    : [];
  if (hood)
    // A hooded mantle: the hood's peak at the top, the cloak widening to the hem.
    return {
      parts: [
        ...wingParts,
        {
          shape: poly([
            [16, 2.5],
            [21.5, 6.5],
            [22.5, 11],
            [26, 27.5],
            [6, 27.5],
            [9.5, 11],
            [10.5, 6.5],
          ]),
          mat: cloth,
          shade: 'bevel',
          bevel: 1.5,
          spec: 1,
        },
        { shape: ell(16, 9, 3.2, 3.6), mat: 'ink', shade: 'flat', level: 2, sep: true },
        { shape: circ(16, 13.5, 1.3), mat: trim, shade: 'sphere', sep: true, spec: true },
        { shape: rect(6.4, 25.5, 19.4, 2), mat: trim, shade: 'bevel', bevel: 0.5, sep: true },
      ],
      shadow: true,
    };
  return {
    parts: [
      ...wingParts,
      {
        shape: poly([
          [10, 4],
          [22, 4],
          [28, 10],
          [26, 14],
          [23, 12],
          [24, 28],
          [8, 28],
          [9, 12],
          [6, 14],
          [4, 10],
        ]),
        mat: cloth,
        shade: 'bevel',
        bevel: 1.5,
        spec: 1,
      },
      {
        shape: poly([
          [13, 4],
          [19, 4],
          [16, 9],
        ]),
        mat: 'ink',
        shade: 'flat',
        level: 2,
        sep: true,
      },
      {
        shape: poly([
          [15, 9],
          [17, 9],
          [17.5, 28],
          [14.5, 28],
        ]),
        mat: trim,
        shade: 'flat',
        level: 3,
        sep: true,
        spec: 1,
      },
      { shape: rect(8, 25.5, 16, 2.5), mat: trim, shade: 'bevel', bevel: 0.6, sep: true },
    ],
    shadow: true,
  };
}

export function boot({ leather = 'wood', trim = 'leaf', wing = false } = {}) {
  const parts = [
    {
      shape: poly([
        [9, 4],
        [18, 4],
        [18.5, 18],
        [27, 21],
        [27.5, 27.5],
        [8, 27.5],
      ]),
      mat: leather,
      shade: 'bevel',
      bevel: 1.4,
      spec: 1,
    },
    { shape: rect(8.2, 4, 10.6, 3.6), mat: trim, shade: 'bevel', bevel: 0.6, sep: true },
    { shape: rect(8, 25, 20, 2.8), mat: 'darkWood', shade: 'flat', level: 2, sep: true },
  ];
  if (wing)
    parts.push({
      shape: poly([
        [17.5, 8],
        [28, 4],
        [26.5, 8],
        [29, 9],
        [25, 12.5],
        [18, 13.5],
      ]),
      mat: trim,
      shade: 'dome',
      sep: true,
      spec: 1,
    });
  return { parts, shadow: true };
}

export function shield({
  face = 'steel',
  rim = 'silverFit',
  emblem = 'cross',
  emblemMat = 'gilt',
} = {}) {
  return {
    parts: [
      {
        shape: poly([
          [5, 4],
          [27, 4],
          [27, 15],
          [16, 29],
          [5, 15],
        ]),
        mat: rim,
        shade: 'bevel',
        bevel: 1.2,
        spec: 1,
      },
      {
        shape: poly([
          [7.6, 6.6],
          [24.4, 6.6],
          [24.4, 14.4],
          [16, 25.4],
          [7.6, 14.4],
        ]),
        mat: face,
        shade: 'dome',
        domeDepth: 4,
        domeStrength: 0.5,
        sep: true,
      },
      {
        shape: glyphShape(emblem, 16, 13.5, 0.85),
        mat: emblemMat,
        shade: 'bevel',
        bevel: 0.6,
        sep: true,
        spec: 1,
      },
    ],
    shadow: true,
  };
}

export function pouch({ cloth = 'unlight', tie = 'gilt', sparkle = 'lilac' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [12, 9],
          [20, 9],
          [26, 18],
          [25, 26],
          [16, 29],
          [7, 26],
          [6, 18],
        ]),
        mat: cloth,
        shade: 'dome',
        domeStrength: 0.8,
        spec: 1,
      },
      {
        shape: poly([
          [10.5, 4],
          [21.5, 4],
          [19.5, 9.5],
          [12.5, 9.5],
        ]),
        mat: cloth,
        shade: 'bevel',
        bevel: 0.8,
        sep: true,
      },
      { shape: rect(11.5, 8.6, 9, 2.2), mat: tie, shade: 'bevel', bevel: 0.5, sep: true, spec: 1 },
      {
        shape: glyphShape('diamond', 25, 6, 0.5),
        mat: sparkle,
        shade: 'flat',
        level: 3,
        minSize: 24,
      },
    ],
    shadow: true,
  };
}

export function smallBook({
  cover = 'pearl',
  fit = 'gilt',
  emblem = 'eye',
  emblemMat = 'ink',
} = {}) {
  return tome({ cover, fit, emblem, emblemMat });
}

export function glove({ leather = 'blood', cuff = 'gilt' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [9, 28],
          [9, 14],
          [7, 9],
          [9, 7.5],
          [11.5, 11],
          [11.5, 4],
          [14, 3],
          [15, 10],
          [15.5, 3],
          [18, 3],
          [18.5, 10],
          [19.5, 4],
          [22, 4.5],
          [22, 11],
          [23.5, 6.5],
          [26, 7.5],
          [24.5, 17],
          [22, 28],
        ]),
        mat: leather,
        shade: 'bevel',
        bevel: 1.2,
        spec: 1,
      },
      {
        shape: rect(8.4, 22.5, 14.2, 5.6),
        mat: cuff,
        shade: 'bevel',
        bevel: 0.8,
        sep: true,
        spec: 1,
      },
    ],
    shadow: true,
  };
}

export function cloak({ cloth = 'verdigris', clasp = 'gilt' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [16, 3],
          [23, 6],
          [27, 28],
          [19, 25.5],
          [16, 29],
          [13, 25.5],
          [5, 28],
          [9, 6],
        ]),
        mat: cloth,
        shade: 'dome',
        domeStrength: 0.6,
        domeDepth: 5,
        spec: 1,
      },
      {
        shape: poly([
          [11, 6.5],
          [16, 3.4],
          [21, 6.5],
          [16, 13],
        ]),
        mat: cloth,
        shade: 'bevel',
        bevel: 0.8,
        bias: 0.12,
        sep: true,
      },
      { shape: circ(16, 10.5, 2.2), mat: clasp, shade: 'sphere', spec: true, sep: true },
    ],
    shadow: true,
  };
}

// ── Services and meta (for headers, upgrade rows, reward chips) ──────────

export function anvil({ metal = 'iron' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [4, 9],
          [26, 9],
          [29, 12],
          [22, 14],
          [20, 19],
          [24, 26],
          [8, 26],
          [12, 19],
          [10, 14],
          [3.5, 12],
        ]),
        mat: metal,
        shade: 'bevel',
        bevel: 1.3,
        spec: 2,
      },
      { shape: rect(6, 25.5, 20, 3), mat: 'darkWood', shade: 'bevel', bevel: 0.6, sep: true },
    ],
    shadow: true,
    glints: [
      [24, 7],
      [27, 5],
    ],
  };
}

export function chest({ wood = 'wood', fit = 'gilt' } = {}) {
  return {
    parts: [
      {
        shape: rect(5, 14, 22, 14),
        mat: wood,
        shade: 'bevel',
        bevel: 1,
        stripes: { period: 3, axis: [0, 1] },
      },
      {
        shape: poly([
          [5, 14],
          [5, 9],
          [9, 5],
          [23, 5],
          [27, 9],
          [27, 14],
        ]),
        mat: wood,
        shade: 'dome',
        domeDepth: 3,
        sep: true,
      },
      { shape: rect(4.5, 12.5, 23, 2.6), mat: fit, shade: 'bevel', bevel: 0.5, sep: true, spec: 1 },
      { shape: rect(13.5, 11.5, 5, 6.5), mat: fit, shade: 'bevel', bevel: 0.6, sep: true, spec: 1 },
      { shape: rect(8, 5.4, 2.4, 22.4), mat: fit, shade: 'flat', level: 2, sep: true, minSize: 24 },
      {
        shape: rect(21.6, 5.4, 2.4, 22.4),
        mat: fit,
        shade: 'flat',
        level: 2,
        sep: true,
        minSize: 24,
      },
    ],
    shadow: true,
  };
}

export function banner({
  cloth = 'steel',
  pole = 'darkWood',
  emblem = 'star',
  emblemMat = 'gilt',
} = {}) {
  return {
    parts: [
      { shape: cap([7, 29], [7, 3], 1), mat: pole, shade: 'cyl' },
      {
        shape: poly([
          [8, 5],
          [26, 5],
          [26, 22],
          [21.5, 19],
          [17, 22],
          [17, 22],
          [8, 22],
        ]),
        mat: cloth,
        shade: 'bevel',
        bevel: 1,
        spec: 1,
        sep: true,
      },
      {
        shape: glyphShape(emblem, 16.5, 12.5, 0.75),
        mat: emblemMat,
        shade: 'bevel',
        bevel: 0.5,
        sep: true,
        spec: 1,
      },
      { shape: circ(7, 3, 1.7), mat: 'gilt', shade: 'sphere', spec: true, sep: true },
    ],
    shadow: true,
  };
}

export function crown({ metal = 'gilt', gem = 'blood' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [5, 26],
          [4, 10],
          [10, 16],
          [16, 6],
          [22, 16],
          [28, 10],
          [27, 26],
        ]),
        mat: metal,
        shade: 'bevel',
        bevel: 1.2,
        spec: 2,
      },
      { shape: rect(5, 21, 22, 5), mat: metal, shade: 'bevel', bevel: 0.7, bias: 0.1, sep: true },
      { shape: circ(16, 23.5, 2), mat: gem, shade: 'sphere', spec: true, sep: true },
      { shape: circ(10, 23.5, 1.4), mat: 'steel', shade: 'sphere', sep: true, minSize: 24 },
      { shape: circ(22, 23.5, 1.4), mat: 'steel', shade: 'sphere', sep: true, minSize: 24 },
    ],
    shadow: true,
  };
}

export function helm({ metal = 'steel', plume = 'blood' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [16, 3],
          [22, 1],
          [19, 7],
        ]),
        mat: plume,
        shade: 'dome',
        minSize: 24,
      },
      {
        shape: poly([
          [8, 29],
          [7, 14],
          [10, 7],
          [16, 5],
          [22, 7],
          [25, 14],
          [24, 29],
          [19, 29],
          [19, 20],
          [13, 20],
          [13, 29],
        ]),
        mat: metal,
        shade: 'dome',
        domeDepth: 5,
        domeStrength: 0.7,
        spec: 2,
        sep: true,
      },
      { shape: rect(10, 15, 12, 2), mat: metal, shade: 'flat', level: 0, casts: false },
    ],
    shadow: true,
  };
}

/** Hollow Sun: black disc, thin gold corona (blessing mark). */
export function hollowSun({ corona = 'gilt', core = 'ink' } = {}) {
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r0 = 10;
    const r1 = i % 3 === 0 ? 15.5 : 13;
    parts.push({
      shape: cap(
        [16 + Math.cos(a) * r0, 16 + Math.sin(a) * r0],
        [16 + Math.cos(a) * r1, 16 + Math.sin(a) * r1],
        0.8,
      ),
      mat: corona,
      shade: 'flat',
      level: 3,
      emissive: true,
    });
  }
  parts.push({
    shape: circ(16, 16, 10),
    mat: corona,
    shade: 'flat',
    level: 3,
    emissive: true,
    spec: 2,
  });
  parts.push({ shape: circ(16.4, 16.4, 8.6), mat: core, shade: 'sphere', casts: false });
  return { parts, shadow: false };
}
