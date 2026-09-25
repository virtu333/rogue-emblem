// StatusBadges — status conditions on the map as small pixel seals
// (docs/art-direction/growth/README.md, mechanics audit).
//
// Replaces 10px monospace letters ("Zzz", "X", "Ac", "Rt") that overlapped
// each other and vanished on grass. Each condition is an 11×11 pixel badge
// baked once into a texture from a mask (no image files, same pixel grid as
// the 32px tiles): an ink outline, a coloured seal, a bone glyph lit from
// the upper left. Presentation only; no RNG.
import { CREST_PALETTE } from './crestArt.js';

const { INK, STEEL, UNLIGHT, VERD, EARTH, EMBER, BLOOD } = CREST_PALETTE;

// 7×7 glyphs ('#' = glyph pixel) centred in the 11×11 badge.
const GLYPHS = {
  // sleep: a crescent moon with a small z
  sleep: ['..###..', '.##....', '##..###', '##....#', '##...#.', '.##.###', '..###..'],
  // silence: a sealed mouth (bar with two stitches)
  silence: ['.......', '..#.#..', '#######', '#######', '..#.#..', '.......', '.......'],
  // acid: a falling drop
  acid: ['...#...', '...#...', '..###..', '.#####.', '.##.##.', '.#####.', '..###..'],
  // root: a knot of vine
  root: ['.#...#.', '..#.#..', '...#...', '..###..', '.#.#.#.', '#..#..#', '...#...'],
};
const FALLBACK = ['..###..', '.#...#.', '....#..', '...#...', '...#...', '.......', '...#...'];

const TONES = {
  sleep: { rim: STEEL[3], seal: STEEL[1], glyph: INK[11], shade: STEEL[4] },
  silence: { rim: UNLIGHT[4], seal: UNLIGHT[1], glyph: INK[11], shade: UNLIGHT[5] },
  acid: { rim: VERD[4], seal: VERD[1], glyph: VERD[5], shade: EMBER[6] },
  root: { rim: EARTH[4], seal: EARTH[1], glyph: EARTH[5], shade: EMBER[5] },
};
const DEFAULT_TONE = { rim: BLOOD[4], seal: BLOOD[1], glyph: INK[11], shade: INK[10] };

export const STATUS_BADGE_SIZE = 11;
export const STATUS_BADGE_SPACING = 12;

/** Pure: the badge as rows of palette colours (null = transparent). */
export function statusBadgePixels(conditionId) {
  const size = STATUS_BADGE_SIZE;
  const tone = TONES[conditionId] || DEFAULT_TONE;
  const glyph = GLYPHS[conditionId] || FALLBACK;
  const rows = [];
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      // A diamond seal (tile-shaped): |dx| + |dy| <= 5, outlined in ink.
      const d = Math.abs(x - c) + Math.abs(y - c);
      if (d > 5.5) row.push(null);
      else if (d > 4.5) row.push(INK[0]);
      else if (d > 3.5) row.push(x + y < size - 1 ? tone.shade : tone.rim);
      else row.push(tone.seal);
    }
    rows.push(row);
  }
  for (let gy = 0; gy < 7; gy++)
    for (let gx = 0; gx < 7; gx++) if (glyph[gy][gx] === '#') rows[gy + 2][gx + 2] = tone.glyph;
  return rows;
}

export function statusBadgeKey(conditionId) {
  return `status-badge-${TONES[conditionId] ? conditionId : 'unknown'}`;
}

/** Bake (once per game) and return the texture key for a condition. */
export function ensureStatusBadgeTexture(scene, conditionId) {
  const key = statusBadgeKey(conditionId);
  const textures = scene?.textures;
  if (!textures) return null;
  if (textures.exists?.(key)) return key;
  if (typeof document === 'undefined' || typeof textures.addCanvas !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STATUS_BADGE_SIZE;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  statusBadgePixels(conditionId).forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  textures.addCanvas(key, canvas);
  return key;
}

/**
 * A badge game object for a unit's condition (image when the texture can be
 * baked, else null so the caller keeps its text fallback).
 */
export function createStatusBadge(scene, conditionId, x, y, depth = 200) {
  const key = ensureStatusBadgeTexture(scene, conditionId);
  if (!key || typeof scene.add?.image !== 'function') return null;
  const image = scene.add.image(x, y, key).setDepth(depth);
  image.setOrigin?.(0.5);
  image.conditionId = conditionId;
  return image;
}
