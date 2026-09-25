// Production additions to the "Forged in code" builders (tools/art/icons/lib/iconDefs.mjs):
// the design pass the study flagged — skill medallions and sealed scrolls with a glyph
// (the Skills tab no longer reads as all scrolls), helms with a stat-coloured crest and
// crowns with a stat-coloured cap (the plume was too small to carry the colour), the
// objects that make every blessing boon unique, and a bold small-size tome emblem.
import { glyph } from './glyphs.mjs';

const cap = (a, b, r) => ({ kind: 'capsule', a, b, r });
const circ = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
const ell = (cx, cy, rx, ry, rot = 0) => ({ kind: 'ellipse', cx, cy, rx, ry, rot });
const poly = (pts) => ({ kind: 'poly', pts });
const ring = (cx, cy, r0, r1) => ({ kind: 'ring', cx, cy, r0, r1 });
const arc = (cx, cy, r, a0, a1, w) => ({ kind: 'arc', cx, cy, r, a0, a1, w });
const rect = (x, y, w, h) => ({ kind: 'rect', x, y, w, h });

function frame(origin, deg) {
  const a = (deg * Math.PI) / 180;
  const u = [Math.cos(a), Math.sin(a)];
  const v = [-u[1], u[0]];
  const at = (along, across = 0) => [
    origin[0] + u[0] * along + v[0] * across,
    origin[1] + u[1] * along + v[1] * across,
  ];
  return { at, pts: (list) => list.map(([s, t]) => at(s, t)) };
}

/** Glyph shapes as struck parts (main piece bevelled, accents one level lighter). */
export function glyphParts(kind, cx, cy, s, mat, { accentMat = null, minSize } = {}) {
  return glyph(kind, cx, cy, s).map((g) => ({
    shape: g.shape,
    holes: g.holes,
    mat: g.accent && accentMat ? accentMat : mat,
    shade: g.accent && !accentMat ? 'flat' : 'bevel',
    level: g.accent && !accentMat ? 3 : null,
    bevel: 0.6,
    sep: true,
    spec: g.accent ? false : 1,
    casts: false,
    emissive: true,
    minSize,
  }));
}

/**
 * Skill medallion (the Skills upgrade tab, skill chips): a dark struck disc in a gilt rim,
 * the skill's glyph large in its own colour. Reads as "a skill", not "a scroll".
 */
export function skillMedal({ glyphKind = 'star', glyphMat = 'ember', rim = 'gilt' } = {}) {
  const parts = [];
  parts.push({
    shape: circ(16, 16, 13.2),
    mat: rim,
    shade: 'dome',
    domeDepth: 2.2,
    domeStrength: 0.8,
    spec: 2,
  });
  parts.push({
    shape: circ(16, 16, 10.6),
    mat: 'slate',
    shade: 'dome',
    domeDepth: 6,
    domeStrength: 0.5,
    bias: -0.12,
    sep: true,
    noRim: true,
  });
  // Milled pips on the rim, only where there is room.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    parts.push({
      shape: circ(16 + Math.cos(a) * 11.9, 16 + Math.sin(a) * 11.9, 0.7),
      mat: rim,
      shade: 'flat',
      level: 1,
      casts: false,
      minSize: 40,
    });
  }
  parts.push(...glyphParts(glyphKind, 16, 16, 1.25, glyphMat));
  return { parts, shadow: true };
}

/**
 * Sealed scroll: the study's scroll with a larger wax seal carrying a glyph (the skill's
 * sign, or the weapon family a weapon art belongs to). Cord and wax colour = the glyph's.
 */
export function sealedScroll({
  cord = 'unlight',
  wax = 'blood',
  glyphKind = null,
  glyphMat = 'gilt',
} = {}) {
  const parts = [];
  const f = frame([4.2, 24.6], -34);
  parts.push({ shape: cap(f.at(1), f.at(24), 4.9), mat: 'parchment', shade: 'cyl', spec: 1 });
  parts.push({
    shape: ell(...f.at(24.1), 1.9, 4.9, -34),
    mat: 'parchment',
    shade: 'flat',
    level: 1,
    sep: true,
  });
  parts.push({
    shape: ring(...f.at(24.1), 0.2, 1.2),
    mat: 'parchment',
    shade: 'flat',
    level: 0,
    minSize: 24,
    casts: false,
  });
  parts.push({
    shape: cap(f.at(6.5, -5.4), f.at(6.5, 5.4), 1.1),
    mat: cord,
    shade: 'cyl',
    sep: true,
  });
  parts.push({
    shape: poly(
      f.pts([
        [6, 4.8],
        [3.4, 10.2],
        [5.4, 10.4],
        [7, 5.8],
      ]),
    ),
    mat: cord,
    shade: 'dome',
    sep: true,
  });
  // Wax seal: a scalloped disc pressed on the middle of the roll.
  const c = f.at(14.2, 1.2);
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 ? 5.9 : 6.6;
    pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  parts.push({ shape: poly(pts), mat: wax, shade: 'dome', domeDepth: 2.2, sep: true, spec: 1 });
  if (glyphKind) parts.push(...glyphParts(glyphKind, c[0], c[1], 0.66, glyphMat));
  return { parts, shadow: true };
}

/** Helm with a tall stat-coloured crest (recruit upgrades). */
export function crestHelm({ metal = 'steel', crest = 'blood' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [5.5, 14],
          [6.5, 5.5],
          [13, 0.6],
          [22.5, 0.4],
          [29, 3.6],
          [31.2, 11],
          [27.4, 9.4],
          [22.5, 8.8],
          [16, 10],
          [10.4, 13.6],
        ]),
        mat: crest,
        shade: 'dome',
        domeDepth: 2,
        stripes: { period: 2.2, axis: [1, 0.4], floor: 1 },
        spec: 1,
        emissive: true,
      },
      {
        shape: poly([
          [7, 30],
          [5.5, 17],
          [8, 10],
          [15, 7],
          [22, 8.5],
          [25.5, 15],
          [25, 30],
          [19.5, 30],
          [19.5, 21.5],
          [12.5, 21.5],
          [12.5, 30],
        ]),
        mat: metal,
        shade: 'dome',
        domeDepth: 5,
        domeStrength: 0.7,
        spec: 2,
        sep: true,
      },
      { shape: rect(9, 16, 14, 2), mat: metal, shade: 'flat', level: 0, casts: false },
      {
        shape: cap([16, 9], [16, 20.6], 0.8),
        mat: metal,
        shade: 'flat',
        level: 3,
        casts: false,
        minSize: 32,
      },
    ],
    shadow: true,
  };
}

/** Crown over a velvet cap in the stat's colour (lord upgrades). */
export function cappedCrown({ metal = 'gilt', capMat = 'blood', gem = 'pearl' } = {}) {
  return {
    parts: [
      {
        shape: ell(16, 17, 10.6, 10.4),
        holes: [rect(0, 20, 32, 12)],
        mat: capMat,
        shade: 'sphere',
        emissive: true,
      },
      {
        shape: poly([
          [4.5, 28],
          [3.5, 12],
          [9.5, 18],
          [16, 8],
          [22.5, 18],
          [28.5, 12],
          [27.5, 28],
        ]),
        holes: [
          poly([
            [8.5, 20.4],
            [9.8, 19.4],
            [15.6, 11.4],
            [16.4, 11.4],
            [22.2, 19.4],
            [23.5, 20.4],
            [23.5, 21.6],
            [8.5, 21.6],
          ]),
        ],
        mat: metal,
        shade: 'bevel',
        bevel: 1.2,
        spec: 2,
        sep: true,
      },
      { shape: rect(4.5, 22, 23, 6), mat: metal, shade: 'bevel', bevel: 0.7, bias: 0.1, sep: true },
      {
        shape: circ(16, 25, 2.2),
        mat: gem,
        shade: 'sphere',
        spec: true,
        sep: true,
        emissive: true,
      },
      { shape: circ(16, 7.4, 1.8), mat: metal, shade: 'sphere', spec: true, sep: true },
      { shape: circ(3.6, 11, 1.4), mat: metal, shade: 'sphere', sep: true, minSize: 24 },
      { shape: circ(28.4, 11, 1.4), mat: metal, shade: 'sphere', sep: true, minSize: 24 },
    ],
    shadow: true,
  };
}

/** Clay salve jar with a green salve (Field Medic). */
export function salveJar({ clay = 'wood', salve = 'verdigris' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [9, 12],
          [23, 12],
          [26, 17],
          [25, 26],
          [21, 29],
          [11, 29],
          [7, 26],
          [6, 17],
        ]),
        mat: clay,
        shade: 'dome',
        domeDepth: 5,
        spec: 1,
      },
      { shape: ell(16, 11.5, 8.4, 2.8), mat: clay, shade: 'flat', level: 1, sep: true },
      { shape: ell(16, 11.3, 6.8, 1.9), mat: salve, shade: 'dome', emissive: true, sep: true },
      { shape: ell(16, 9.4, 3.4, 2.4), mat: salve, shade: 'sphere', emissive: true, spec: 1 },
      { shape: cap([8, 20.5], [24, 20.5], 0.9), mat: 'cord', shade: 'cyl', sep: true, minSize: 24 },
    ],
    shadow: true,
  };
}

/** Hooded lantern (Scout Blessing). */
export function lantern({ metal = 'iron', flame = 'ember' } = {}) {
  return {
    parts: [
      { shape: ring(16, 5.4, 2, 3.2), mat: metal, shade: 'flat', level: 2 },
      {
        shape: poly([
          [10, 11],
          [22, 11],
          [19, 7],
          [13, 7],
        ]),
        mat: metal,
        shade: 'bevel',
        bevel: 0.8,
        spec: 1,
        sep: true,
      },
      {
        shape: rect(10.5, 11, 11, 13.5),
        mat: flame,
        shade: 'dome',
        domeDepth: 4,
        emissive: true,
        spec: 1,
      },
      {
        shape: poly([
          [16, 13.4],
          [18.4, 18],
          [16, 21.6],
          [13.6, 18],
        ]),
        mat: 'pearl',
        shade: 'flat',
        level: 3,
        emissive: true,
        sep: true,
      },
      { shape: rect(9.5, 10.5, 1.8, 15), mat: metal, shade: 'bevel', bevel: 0.5, sep: true },
      { shape: rect(20.7, 10.5, 1.8, 15), mat: metal, shade: 'bevel', bevel: 0.5, sep: true },
      {
        shape: rect(8.5, 24.5, 15, 3.6),
        mat: metal,
        shade: 'bevel',
        bevel: 0.7,
        spec: 1,
        sep: true,
      },
    ],
    shadow: true,
  };
}

/** Curved war horn (Rally Cry, Hero's Call): a tapering crescent, banded, open bell. */
export function warHorn({ horn = 'pearl', band = 'gilt' } = {}) {
  // Centre line: an arc under the key light, from the mouthpiece (left) to the bell (right).
  const cx = 16;
  const cy = 31.5;
  const R = 13.5;
  const a0 = Math.PI * 1.08;
  const a1 = Math.PI * 1.9;
  const at = (t, off = 0) => {
    const a = a0 + (a1 - a0) * t;
    return [cx + Math.cos(a) * (R + off), cy + Math.sin(a) * (R + off)];
  };
  const width = (t) => 1.5 + 5.6 * t ** 1.35;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    outer.push(at(t, width(t)));
    inner.push(at(t, -width(t)));
  }
  const body = poly([...outer, ...inner.reverse()]);
  const bell = at(1);
  const bandAt = (t) => {
    const w = width(t) + 0.4;
    return cap(at(t, w), at(t, -w), 1.05);
  };
  return {
    parts: [
      { shape: body, mat: horn, shade: 'dome', domeDepth: 3, spec: 1.5 },
      { shape: bandAt(0.34), mat: band, shade: 'cyl', sep: true, spec: 1 },
      { shape: bandAt(0.68), mat: band, shade: 'cyl', sep: true, spec: 1 },
      {
        shape: ell(bell[0], bell[1], width(1) * 0.92, 2.1, a1),
        mat: 'ink',
        shade: 'flat',
        level: 2,
        sep: true,
      },
    ],
    shadow: true,
  };
}

/** Smith's hammer (Frugal Smith). */
export function smithHammer({ head = 'iron', haft = 'wood' } = {}) {
  const f = frame([7, 27], -48);
  return {
    parts: [
      { shape: cap(f.at(0), f.at(22), 1.4), mat: haft, shade: 'cyl' },
      {
        shape: poly(
          f.pts([
            [16, -7.5],
            [23, -6.2],
            [23, 5.4],
            [16, 6.6],
          ]),
        ),
        mat: head,
        shade: 'bevel',
        bevel: 1.2,
        spec: 2,
        sep: true,
      },
      {
        shape: poly(
          f.pts([
            [16.6, -7.5],
            [22.4, -6.3],
            [22.4, -4.3],
            [16.6, -5.4],
          ]),
        ),
        mat: head,
        shade: 'flat',
        level: 3,
        casts: false,
      },
    ],
    shadow: true,
  };
}

/** Scallop-shell pilgrim token on a cord (Pilgrim Coin). */
export function shellToken({ shell = 'pearl', cord = 'wood' } = {}) {
  const parts = [];
  parts.push({
    shape: arc(16, 8, 7, Math.PI * 1.05, Math.PI * 1.95, 1),
    mat: cord,
    shade: 'flat',
    level: 2,
  });
  const pts = [[16, 29]];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    const r = i % 2 ? 11.2 : 12.2;
    pts.push([16 + Math.cos(a) * r, 18.5 + Math.sin(a) * r * 0.9]);
  }
  parts.push({ shape: poly(pts), mat: shell, shade: 'dome', domeDepth: 4, spec: 1.5, sep: true });
  for (const dx of [-6, -3, 0, 3, 6])
    parts.push({
      shape: cap([16, 27], [16 + dx * 1.35, 9.6 + Math.abs(dx) * 0.35], 0.45),
      mat: shell,
      shade: 'flat',
      level: 1,
      casts: false,
      minSize: 24,
    });
  parts.push({ shape: rect(13, 26.5, 6, 3), mat: shell, shade: 'bevel', bevel: 0.5, sep: true });
  return { parts, shadow: true };
}

/** A broad oak leaf (Terrain Mastery). */
export function oakLeaf({ mat = 'leaf', vein = 'verdigris' } = {}) {
  const f = frame([6, 27], -52);
  const pts = [];
  const lobes = [
    [0, 0],
    [4, -3],
    [6.5, -6.4],
    [9.5, -4.4],
    [12, -7.4],
    [15, -5],
    [18, -7],
    [21, -3.6],
    [25, 0],
    [21, 3.6],
    [18, 7],
    [15, 5],
    [12, 7.4],
    [9.5, 4.4],
    [6.5, 6.4],
    [4, 3],
  ];
  for (const [s, t] of lobes) pts.push(f.at(s, t));
  return {
    parts: [
      { shape: poly(pts), mat, shade: 'dome', domeDepth: 4, spec: 1 },
      {
        shape: cap(f.at(-2), f.at(21), 0.6),
        mat: vein,
        shade: 'flat',
        level: 1,
        sep: false,
        casts: false,
      },
    ],
    shadow: true,
  };
}

/** Two practice blades crossed (War Tutelage). */
export function crossedBlades({ blade = 'silver', fit = 'gilt' } = {}) {
  const one = (flip) => {
    const f = flip ? frame([25, 26], -135) : frame([7, 26], -45);
    return [
      {
        shape: poly(
          f.pts([
            [3, -1.8],
            [21, -1.8],
            [23.5, 0],
            [21, 1.8],
            [3, 1.8],
          ]),
        ),
        mat: blade,
        shade: 'ridge',
        axis: flip ? [-1, -1] : [1, -1],
        spec: 1,
        sep: true,
      },
      { shape: cap(f.at(3, -4.6), f.at(3, 4.6), 1.1), mat: fit, shade: 'cyl', sep: true, spec: 1 },
      { shape: cap(f.at(-3.2), f.at(2.2), 1.1), mat: 'cord', shade: 'cyl', sep: true },
    ];
  };
  return { parts: [...one(true), ...one(false)], shadow: true };
}

/** Hourglass (Focused Curriculum: the same lesson, every day). */
export function hourglass({ frameMat = 'darkWood', sand = 'ember', glass = 'sky' } = {}) {
  return {
    parts: [
      {
        shape: poly([
          [9.5, 6],
          [22.5, 6],
          [22, 9],
          [17.2, 16],
          [22, 23],
          [22.5, 26],
          [9.5, 26],
          [10, 23],
          [14.8, 16],
          [10, 9],
        ]),
        mat: glass,
        shade: 'flat',
        level: 1,
      },
      {
        shape: poly([
          [11.6, 8.6],
          [20.4, 8.6],
          [16.8, 14.6],
          [15.2, 14.6],
        ]),
        mat: sand,
        shade: 'flat',
        level: 3,
        emissive: true,
        sep: true,
      },
      {
        shape: poly([
          [15.4, 21],
          [16.6, 21],
          [21, 25],
          [11, 25],
        ]),
        mat: sand,
        shade: 'flat',
        level: 2,
        emissive: true,
        sep: true,
      },
      {
        shape: cap([16, 15], [16, 21.4], 0.45),
        mat: sand,
        shade: 'flat',
        level: 3,
        emissive: true,
      },
      { shape: rect(7, 3, 18, 3.6), mat: frameMat, shade: 'bevel', bevel: 0.8, spec: 1, sep: true },
      {
        shape: rect(7, 25.4, 18, 3.6),
        mat: frameMat,
        shade: 'bevel',
        bevel: 0.8,
        spec: 1,
        sep: true,
      },
      { shape: cap([8.6, 6], [8.6, 25.6], 0.9), mat: frameMat, shade: 'cyl', sep: true },
      { shape: cap([23.4, 6], [23.4, 25.6], 0.9), mat: frameMat, shade: 'cyl', sep: true },
    ],
    shadow: true,
    glints: [[12, 8]],
  };
}

/** Iron chain across a spec (Forbidden Tome: a book bound shut). */
export function withChain(spec, { metal = 'iron' } = {}) {
  const links = [];
  for (let i = 0; i < 6; i++) {
    const x = 4 + i * 4.4;
    const y = 23 - i * 3.3;
    links.push({
      shape: i % 2 ? ell(x, y, 2.6, 1.5, -0.64) : ring(x, y, 0.8, 2.1),
      mat: metal,
      shade: i % 2 ? 'dome' : 'flat',
      level: i % 2 ? null : 3,
      spec: i % 2 ? 1 : false,
      sep: true,
    });
  }
  return { ...spec, parts: [...spec.parts, ...links] };
}

/** Anvil with a blood-red quenched blade on it (Blood Forge). */
export function bloodAnvil() {
  const f = frame([5, 9], -8);
  return {
    parts: [
      {
        shape: poly([
          [4, 14],
          [26, 14],
          [29, 17],
          [22, 19],
          [20, 23],
          [24, 29],
          [8, 29],
          [12, 23],
          [10, 19],
          [3.5, 17],
        ]),
        mat: 'blackened',
        shade: 'bevel',
        bevel: 1.3,
        spec: 1,
      },
      {
        shape: poly(
          f.pts([
            [2, -1.6],
            [21, -1.6],
            [24, 0],
            [21, 1.6],
            [2, 1.6],
          ]),
        ),
        mat: 'blood',
        shade: 'ridge',
        axis: [1, -0.14],
        emissive: true,
        spec: 1,
        sep: true,
      },
      { shape: cap(f.at(-3.4), f.at(1.6), 1.1), mat: 'cord', shade: 'cyl', sep: true },
      {
        shape: circ(22.5, 23, 1.6),
        mat: 'blood',
        shade: 'sphere',
        emissive: true,
        sep: true,
        minSize: 24,
      },
    ],
    shadow: true,
  };
}

/** Marching boots, a pair (Blessed Vigor: out on two feet, home on two feet). */
export function bootPair({ leather = 'wood', trim = 'verdigris' } = {}) {
  const boot = (dx, dy, mat) => [
    {
      shape: poly([
        [dx + 3, dy + 1],
        [dx + 10, dy + 1],
        [dx + 10, dy + 13],
        [dx + 17, dy + 15.5],
        [dx + 17, dy + 19],
        [dx + 3, dy + 19],
      ]),
      mat,
      shade: 'bevel',
      bevel: 1,
      spec: 1,
      sep: true,
    },
    { shape: rect(dx + 2.6, dy + 1, 7.8, 2.8), mat: trim, shade: 'bevel', bevel: 0.5, sep: true },
  ];
  return { parts: [...boot(9, 3, 'darkWood'), ...boot(3, 9, leather)], shadow: true };
}
