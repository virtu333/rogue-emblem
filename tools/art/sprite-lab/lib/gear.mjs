// Parametric parts: limbs and weapons are drawn from sockets and angles, not
// stamped. This is what lets one pose library drive idle bobs, attack lunges
// and every weapon length without redrawing, and it enforces the legibility
// contract's blade grammar (white highlight bounded by grey/charcoal).
import { bresenham } from './figure.mjs';

// Arm: shoulder -> elbow -> hand. Sleeve for the upper arm (and forearm unless
// `forearm` is given), hand as a 2x2 cluster (skin or glove).
export function arm(f, [sx, sy], [ex, ey], [hx, hy], opts = {}) {
  const {
    sleeve = 'sub',
    forearm = sleeve,
    hand = 'skin',
    tag = 'arm',
    w = 2,
    handSize = 2,
  } = opts;
  const pid = f.begin(tag, opts);
  const seg = (a, b, slot) => {
    const pts = bresenham(a[0], a[1], b[0], b[1]);
    for (const [x, y] of pts)
      for (let k = 0; k < w; k++) {
        // the column to the left is the lit side
        const shade = w === 1 ? 2 : k === 0 ? 3 : 1;
        f.px(x + k - (w - 1), y, slot, shade + (slot === 'skin' ? 0 : 0), pid);
      }
  };
  seg([sx, sy], [ex, ey], sleeve);
  seg([ex, ey], [hx, hy], forearm);
  // hand cluster
  if (handSize) {
    const hs = hand === 'skin' ? [3, 2] : [3, 1];
    f.px(hx, hy, hand, hs[0], pid);
    if (handSize > 1) {
      f.px(hx - 1, hy, hand, hs[1], pid);
      f.px(hx, hy + 1, hand, hs[1], pid);
      f.px(hx - 1, hy + 1, hand, hs[1] - 1, pid);
    }
  }
  return pid;
}

// Unit direction from an angle in degrees (0 = right, 90 = up).
const dir = (deg) => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
const at = ([x, y], [dx, dy], t) => [Math.round(x + dx * t), Math.round(y + dy * t)];

// Blade body along a line, `width` 1..3. The edge nearer the light is the
// white highlight; the far edge is grey; a charcoal outline comes from resolve().
function blade(f, pid, p0, p1, width, slot = 'metal') {
  const pts = bresenham(p0[0], p0[1], p1[0], p1[1]);
  const dx = p1[0] - p0[0],
    dy = p1[1] - p0[1];
  const steep = Math.abs(dy) >= Math.abs(dx);
  pts.forEach(([x, y], k) => {
    const last = k === pts.length - 1;
    for (let j = 0; j < (last ? 1 : width); j++) {
      // perpendicular offsets: steep lines widen in x (left = lit), shallow in y (up = lit)
      const ox = steep ? -j : 0;
      const oy = steep ? 0 : -j;
      const shade = width === 1 ? 4 : j === width - 1 ? 4 : j === 0 ? 2 : 3;
      f.px(x + ox, y + oy, slot, shade, pid);
    }
  });
}

// Weapons. `grip` = hand socket. `deg` = pointing direction of the business end.
export function weapon(f, kind, grip, deg, opts = {}) {
  const tag = opts.tag ?? 'weapon';
  const pid = f.begin(tag, opts);
  const d = dir(deg);
  const back = [-d[0], -d[1]];
  const perp = [-d[1], d[0]];
  const P = (p, s = 2) => f.px(p[0], p[1], 'trim', s, pid);
  switch (kind) {
    case 'sword':
    case 'longsword':
    case 'dagger':
    case 'broadsword': {
      const len = opts.len ?? { sword: 10, longsword: 13, dagger: 5, broadsword: 11 }[kind];
      const width = opts.width ?? { sword: 2, longsword: 2, dagger: 2, broadsword: 3 }[kind];
      const guard = at(grip, d, 1);
      // grip + pommel behind the hand
      const pommel = at(grip, back, 2);
      for (const [x, y] of bresenham(grip[0], grip[1], pommel[0], pommel[1]))
        f.px(x, y, 'leather', 2, pid);
      f.px(pommel[0], pommel[1], opts.pommel ?? 'trim', 3, pid);
      // cross guard
      const g1 = at(guard, perp, 1),
        g2 = at(guard, perp, -1);
      P(g1, 3);
      P(guard, 2);
      P(g2, 1);
      if (kind === 'broadsword') {
        P(at(guard, perp, 2), 3);
        P(at(guard, perp, -2), 1);
      }
      blade(f, pid, at(grip, d, 2), at(grip, d, 2 + len), width, 'metal');
      break;
    }
    case 'lance': {
      const len = opts.len ?? 26;
      const tail = at(grip, back, opts.tail ?? 8);
      const tipBase = at(grip, d, len);
      for (const [x, y] of bresenham(tail[0], tail[1], tipBase[0], tipBase[1]))
        f.px(x, y, 'wood', 2, pid);
      // leaf head: 4 long, 2 wide
      blade(f, pid, tipBase, at(grip, d, len + 5), 2, 'metal');
      P(at(tipBase, back, 0), 1);
      break;
    }
    case 'axe': {
      const len = opts.len ?? 12;
      const tail = at(grip, back, 2);
      const top = at(grip, d, len);
      for (const [x, y] of bresenham(tail[0], tail[1], top[0], top[1])) f.px(x, y, 'wood', 2, pid);
      // bearded head on the outboard side (perp toward +x when vertical)
      const side = opts.side ?? 1;
      const o = [perp[0] * side, perp[1] * side];
      const h0 = at(grip, d, len - 1);
      const rows = opts.big
        ? [
            [-1, 1],
            [0, 3],
            [1, 4],
            [2, 5],
            [3, 5],
            [4, 4],
            [5, 2],
          ]
        : [
            [0, 1],
            [1, 3],
            [2, 4],
            [3, 4],
            [4, 3],
            [5, 1],
          ];
      rows.forEach(([t, reach]) => {
        const base = at(h0, back, t - 1);
        for (let r = 1; r <= reach; r++) {
          const p = at(base, o, r);
          const edge = r === reach;
          f.px(p[0], p[1], 'metal', edge ? 4 : t < 2 ? 3 : 2, pid);
        }
      });
      break;
    }
    case 'staff': {
      const len = opts.len ?? 22;
      const tail = at(grip, back, opts.tail ?? 9);
      const top = at(grip, d, len);
      for (const [x, y] of bresenham(tail[0], tail[1], top[0], top[1])) f.px(x, y, 'wood', 3, pid);
      // head: a ring of trim with a light (gold for the living, unlight for the corrupted)
      const [cx, cy] = at(grip, d, len + 2);
      for (const [x, y, s] of [
        [cx - 1, cy - 1, 3],
        [cx, cy - 2, 4],
        [cx + 1, cy - 1, 2],
        [cx - 2, cy, 3],
        [cx + 2, cy, 1],
        [cx - 1, cy + 1, 2],
        [cx + 1, cy + 1, 1],
      ])
        f.px(x, y, 'trim', s, pid);
      f.px(cx, cy, 'glow', 3, pid);
      f.px(cx, cy - 1, 'glow', 2, pid);
      f.px(cx, cy + 1, 'trim', 2, pid);
      break;
    }
    case 'bow': {
      // Tall recurve held vertically in front hand; string on the body side.
      const h = opts.len ?? 13; // half height
      const [gx, gy] = grip;
      const bulge = opts.bulge ?? 3;
      const pts = [];
      for (let t = -h; t <= h; t++) {
        const u = t / h;
        const x = gx + Math.round(bulge * (1 - u * u)) - bulge + (Math.abs(u) > 0.85 ? 1 : 0);
        pts.push([x, gy + t]);
      }
      pts.forEach(([x, y], k) => f.px(x + bulge, y, 'wood', k < h ? 3 : 2, pid));
      // string
      for (let t = -h + 1; t <= h - 1; t++)
        f.px(gx - (opts.draw ?? 0) * (1 - Math.abs(t) / h), gy + t, 'linen', 3, pid);
      f.px(gx + bulge, gy, 'leather', 3, pid);
      break;
    }
    case 'tome': {
      const [x, y] = grip;
      const rows = opts.open
        ? [
            [-2, -1, 'linen', 3],
            [-1, -1, 'linen', 4],
            [1, -1, 'linen', 4],
            [2, -1, 'linen', 3],
            [-2, 0, 'linen', 4],
            [-1, 0, 'linen', 3],
            [0, 0, 'main', 1],
            [1, 0, 'linen', 3],
            [2, 0, 'linen', 2],
            [-2, 1, 'main', 2],
            [-1, 1, 'main', 2],
            [0, 1, 'main', 1],
            [1, 1, 'main', 2],
            [2, 1, 'main', 1],
          ]
        : [
            [-1, -1, 'main', 3],
            [0, -1, 'main', 2],
            [-1, 0, 'main', 2],
            [0, 0, 'linen', 4],
            [-1, 1, 'main', 1],
            [0, 1, 'linen', 3],
          ];
      for (const [dx, dy, s, sh] of rows)
        f.px(x + dx, y + dy, opts.cover && s === 'main' ? opts.cover : s, sh, pid);
      if (opts.glow) {
        // a small plume of light over the pages (gold for the living, unlight for the corrupted)
        f.px(x, y - 1, 'glow', 4, pid);
        f.px(x, y - 2, 'glow', 3, pid);
        f.px(x - 1, y - 2, 'glow', 2, pid);
        f.px(x + 1, y - 2, 'glow', 2, pid);
        f.px(x, y - 3, 'glow', 2, pid);
        f.px(x + 1, y - 4, 'glow', 1, pid);
      }
      break;
    }
    default:
      throw new Error(`unknown weapon ${kind}`);
  }
  return pid;
}
