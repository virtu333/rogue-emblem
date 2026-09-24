// factionRingStyles — pure style selection and rasterization for the ground rings
// under units (no Phaser, no DOM; unit-testable).
//
// Faction is an area, not piping (legibility principle 4): each ring is a filled
// translucent faction ellipse, a crisp faction-colored band, and a dark ink keyline
// outside it. The keyline carries the ring over light ground (snow, sand, stone,
// danger/range overlays); the bright band carries it over dark ground (lava, swamp,
// night). Bosses get a heavier band plus an outer hairline and side clasps, so they
// read as distinct without borrowing the player's gold.
//
// Colors come from the art ramps in docs/art-direction/ART_BIBLE.md (steel, blood,
// verdigris, earth, unlight, ink).

export const RING_STYLES = Object.freeze({
  player: { fill: '#1c2f4f', fillAlpha: 0.55, band: '#4f8fd0', rim: '#9cc8ea', bandWidth: 1.6 },
  enemy: { fill: '#6e1a28', fillAlpha: 0.5, band: '#cc4038', rim: '#ec7a5c', bandWidth: 1.6 },
  boss: {
    fill: '#6e1a28',
    fillAlpha: 0.56,
    band: '#cc4038',
    rim: '#ec7a5c',
    bandWidth: 2.4,
    outer: '#9e2632',
    clasps: true,
  },
  npc: { fill: '#1b4239', fillAlpha: 0.5, band: '#86b27b', rim: '#c3d69a', bandWidth: 1.6 },
  caravan: { fill: '#4f4a2a', fillAlpha: 0.5, band: '#b8ae78', rim: '#ddd0bd', bandWidth: 1.6 },
  entity: {
    fill: '#2c1645',
    fillAlpha: 0.5,
    band: '#a863cc',
    rim: '#dcaaf0',
    bandWidth: 2.4,
    outer: '#4a2270',
  },
});

export const RING_KEYLINE = Object.freeze({ color: '#07060b', alpha: 0.78, width: 1 });

// Multiplicative dim for acted units (the sprite gets its own tint; the ring follows).
export const RING_ACTED_TINT = 0x8c8c8c;
export const RING_ACTED_ALPHA = 0.82;

// Ring center sits just above the sprite's feet (rebuilt sprites put feet 12px below
// the tile center) and spans almost the full tile width, so its sides and front arc
// show past the sprite and below the HP bar, which crosses it and stays on top.
export const RING_OFFSET_Y = 9.5;

/** Which ring a unit wears (pure). */
export function selectRingStyle(unit) {
  if (!unit) return 'player';
  if (unit.isEntity) return 'entity';
  if (unit.isCaravan) return 'caravan';
  if (unit.faction === 'enemy') return unit.isBoss ? 'boss' : 'enemy';
  if (unit.faction === 'npc') return 'npc';
  return 'player';
}

/** Ellipse geometry in world pixels (pure). */
export function ringGeometry(styleKey, { entityWidthTiles = 3, tileSize = 32 } = {}) {
  if (styleKey === 'entity') {
    return { rx: (entityWidthTiles * tileSize - 8) / 2, ry: 8, pad: 3 };
  }
  if (styleKey === 'boss') return { rx: 16, ry: 6, pad: 3 };
  return { rx: 15, ry: 5.5, pad: 2 };
}

function parseHex(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Approximate signed distance (px) to an axis-aligned ellipse boundary. */
function ellipseSdf(x, y, rx, ry) {
  const f = (x * x) / (rx * rx) + (y * y) / (ry * ry) - 1;
  const gx = (2 * x) / (rx * rx);
  const gy = (2 * y) / (ry * ry);
  const g = Math.hypot(gx, gy) || 1e-6;
  return f / g;
}

/**
 * Rasterize a ring to straight-alpha RGBA at 1 texel per world pixel with 4×4
 * supersampled edges (pure). Returns { width, height, data, cx, cy }.
 */
export function rasterizeRing(styleKey, geometry = ringGeometry(styleKey)) {
  const style = RING_STYLES[styleKey] || RING_STYLES.player;
  const { rx, ry, pad } = geometry;
  // Bosses/entities: a second, darker crimson hairline hugging the keyline, then a
  // thin ink edge, so the heavier ring still separates from any ground.
  const outerWidth = style.outer ? 1.3 : 0;
  const reach = RING_KEYLINE.width + (style.outer ? outerWidth + 0.8 : 0);
  const width = Math.ceil((rx + reach + pad) * 2);
  const height = Math.ceil((ry + reach + pad) * 2);
  const cx = width / 2;
  const cy = height / 2;
  const fill = parseHex(style.fill);
  const band = parseHex(style.band);
  const rim = parseHex(style.rim);
  const outer = style.outer ? parseHex(style.outer) : null;
  const key = parseHex(RING_KEYLINE.color);
  const data = new Uint8ClampedArray(width * height * 4);
  const S = 4;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S - cx;
          const y = py + (sy + 0.5) / S - cy;
          const d = ellipseSdf(x, y, rx, ry);
          let c = null;
          let ca = 0;
          if (d <= -style.bandWidth) {
            c = fill;
            ca = style.fillAlpha;
          } else if (d <= 0) {
            // Upper arc catches the upper-left key light: a lighter rim on the band.
            const lit = y < -ry * 0.35 && d > -style.bandWidth * 0.55;
            c = lit ? rim : band;
            ca = 1;
          } else if (d <= RING_KEYLINE.width) {
            c = key;
            ca = RING_KEYLINE.alpha;
          } else if (outer && d <= reach) {
            const inOuter = d <= RING_KEYLINE.width + outerWidth;
            c = inOuter ? outer : key;
            ca = inOuter ? 1 : RING_KEYLINE.alpha * 0.8;
          }
          // Boss/entity clasps: short bars at the left and right ends of the ellipse.
          if (
            style.clasps &&
            Math.abs(Math.abs(x) - (rx + 1.5)) <= 1.5 &&
            Math.abs(y) <= 1.5 &&
            d > -style.bandWidth
          ) {
            c = Math.abs(y) <= 0.75 ? rim : key;
            ca = 1;
          }
          if (!c) continue;
          r += c[0] * ca;
          g += c[1] * ca;
          b += c[2] * ca;
          a += ca;
        }
      }
      const i = (py * width + px) * 4;
      if (a > 0) {
        data[i] = r / a;
        data[i + 1] = g / a;
        data[i + 2] = b / a;
        data[i + 3] = (a / (S * S)) * 255;
      }
    }
  }
  return { width, height, data, cx, cy };
}
