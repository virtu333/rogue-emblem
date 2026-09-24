// Production settings for the PC-98 portrait pass (pure data + helpers).
//
// Sizes follow where portraits are displayed (CSS px, see README):
//   192  master: boss card bust (190px), crit cut-in eyes strip at exactly 2x
//    96  dialogue bust (96px box)
//    64  roster detail / home base identity
//    48  battle forecast (DOM 48px, canvas 48px), Sera's rewind offer
//    40  canvas forecast (40px), roster summary
//    32  party rows, Loom party chips, roster list faces
// Every size is rendered from the source (never downscaled from a dithered
// master, which would moire); small sizes reuse the master's palette.

export const MASTER_SIZE = 192;
export const SIZES = Object.freeze([192, 96, 64, 48, 40, 32]);
export const ATLAS_SIZES = Object.freeze([32, 40, 48, 64]);
export const ATLAS_COLUMNS = 10;

/** Colour budget, dither mode and line settings per size. */
export function tierFor(size) {
  if (size >= 160)
    return {
      colours: 13,
      cel: { sigmaS: 1.3, sigmaR: 0.05, iterations: 2 },
      dither: 'full',
      nearDist: 0.13,
      line: {},
    };
  if (size >= 96)
    return {
      colours: 12,
      cel: { sigmaS: 0.9, sigmaR: 0.05, iterations: 1 },
      dither: 'full',
      nearDist: 0.12,
      line: { edgeThreshold: 0.09 },
    };
  if (size >= 64)
    return {
      colours: 11,
      cel: { sigmaS: 0.7, sigmaR: 0.05, iterations: 1 },
      dither: 'soft',
      nearDist: 0.11,
      line: { edgeThreshold: 0.11, edgeMaxL: 0.45 },
    };
  if (size >= 40)
    return {
      colours: 10,
      cel: null,
      dither: 'soft',
      nearDist: 0.1,
      line: { edges: false, lineMaxL: 0.2 },
    };
  return {
    colours: 9,
    cel: null,
    dither: 'none',
    nearDist: 0.1,
    line: { edges: false, lineMaxL: 0.18 },
  };
}

// Thumbnails crop toward the face so it stays readable at 32-64px (the Loom
// chips already cropped the old art to its top with object-position).
const THUMB_ZOOM = Object.freeze({ 64: 0.74, 48: 0.62, 40: 0.6, 32: 0.56 });

/**
 * Square crop (fractions of the source square) for a size: the master and
 * dialogue bust keep the full frame; thumbnails centre the face with the eye
 * line at 42% of the crop.
 * @returns {{left:number, top:number, side:number}}
 */
export function thumbCrop(size, framing) {
  const side = THUMB_ZOOM[size] ?? 1;
  if (side >= 1) return { left: 0, top: 0, side: 1 };
  const clamp = (v) => Math.min(1 - side, Math.max(0, v));
  return {
    left: Math.round(clamp(framing.cx - side / 2) * 1000) / 1000,
    top: Math.round(clamp(framing.eye - side * 0.42) * 1000) / 1000,
    side,
  };
}

/** Framing expressed inside a crop. */
export function framingInCrop(framing, c) {
  return { eye: (framing.eye - c.top) / c.side, cx: (framing.cx - c.left) / c.side };
}

/** De-pixelizing blur (px at target size) for a source of `native` px. */
export function smoothFor(size, native) {
  const ratio = size / Math.max(1, native);
  return ratio > 1 ? Math.round((ratio - 1) * 0.45 * 100) / 100 : 0;
}

const UNLIGHT = new Set(['boss_the_entity', 'enemy_entity', 'enemy_revenant', 'enemy_zombie']);

/** Default backdrop faction for a portrait id (overridable in config). */
export function defaultFaction(id) {
  if (UNLIGHT.has(id)) return 'unlight';
  if (id.startsWith('lord_')) return 'ember';
  if (id.startsWith('boss_') || id.startsWith('enemy_')) return 'blood';
  return 'steel';
}

/** Face ellipse (px) from framing fractions, for palette weight + iris guard. */
export function faceEllipse(framing, size) {
  return {
    cx: framing.cx * size,
    cy: (framing.eye + 0.05) * size,
    rx: 0.15 * size,
    ry: 0.2 * size,
  };
}
