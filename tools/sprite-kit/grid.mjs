// Grid authoring: sprites drawn character-by-character as layered ASCII stamps.
//
// Primitive shapes (pixel.mjs) are quick but read as blocky. Grids give per-pixel
// control over the things that carry an anime / FE look at this size: tapered
// limbs, hair clusters, cloth folds, 3/4 faces. Shading is painted by hand, so the
// automatic shader is bypassed; outlines are still generated.
//
// Each character selects a material group and a shade (0 = darkest .. 4 = lightest).
// The group names resolve to concrete ramps per sprite through `alias`, e.g.
// { hair: 'hairRed', cloth: 'moss', metal: 'iron', faction: 'crimson' }.
import { PixelSprite } from './pixel.mjs';

const GROUPS = {
  skin: 'kzsSQ',
  hair: 'NnhHY',
  faction: 'vfcCF',
  metal: 'IimMW',
  leather: 'BblLT',
  cloth: 'UuoOR',
  linen: 'JqpPX',
  gold: 'EjygG',
  wood: 'VtdDr',
  glow: '12a@*',
};
export const DEFAULT_ALIAS = {
  metal: 'steel',
  gold: 'brass',
};
const LEGEND = new Map();
for (const [group, chars] of Object.entries(GROUPS))
  [...chars].forEach((ch, shade) => LEGEND.set(ch, [group, shade]));
LEGEND.set('e', ['eye', 0]);
LEGEND.set('w', ['spark', 4]);
LEGEND.set('#', ['ink', 0]);

// A stamp is { x, y, rows }. '.' and ' ' are transparent; '-' erases what lies beneath.
export function stamp(x, y, rows) {
  return { x, y, rows };
}

// Vertical run of one character (shafts, staves, lance poles).
export function column(x, y0, y1, ch) {
  return stamp(
    x,
    y0,
    Array.from({ length: y1 - y0 + 1 }, () => ch),
  );
}

// Compose stamps (back to front) into a PixelSprite on a 64x64 canvas.
// `origin` is where grid (0,0) lands on the canvas (the placement box corner).
export function composeGrid(stamps, origin = [13, 10], { shift = null } = {}) {
  stamps = stamps.flat(Infinity).filter(Boolean);
  const s = new PixelSprite(64, 64);
  const parts = new Map();
  const partFor = (group) => {
    if (!parts.has(group)) parts.set(group, s.begin(group, { flat: true }));
    return parts.get(group);
  };
  for (const st of stamps) {
    st.rows.forEach((row, ry) => {
      [...row].forEach((ch, rx) => {
        if (ch === '.' || ch === ' ') return;
        let gx = origin[0] + st.x + rx;
        let gy = origin[1] + st.y + ry;
        // Idle bob: rows above the waist move down one pixel.
        if (shift && st.y + ry <= shift.waist) gy += shift.dy;
        if (ch === '-') return s.set(gx, gy, null, -1);
        const hit = LEGEND.get(ch);
        if (!hit) throw new Error(`Unknown grid character '${ch}'`);
        const [group, shade] = hit;
        s.set(gx, gy, group, partFor(group), { shade });
      });
    });
  }
  return s;
}
