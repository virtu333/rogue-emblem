// FactionRings — the ground ring under each battle unit (rendering only).
//
// Styles and rasterization are pure (src/art/factionRingStyles.js). This module turns
// them into cached canvas textures and returns a plain Image, so every existing call
// site keeps working: setPosition / x / y, setAlpha (death fades, warps), setVisible
// (fog), destroy. The ring stays at depth 8: above range/danger highlights, below
// sprites (10+) and HP bars (12/13).

import {
  RING_ACTED_ALPHA,
  RING_ACTED_TINT,
  RING_OFFSET_Y,
  rasterizeRing,
  ringGeometry,
  selectRingStyle,
} from '../art/factionRingStyles.js';

export { RING_OFFSET_Y, selectRingStyle };
export const RING_DEPTH = 8;

const textureKey = (styleKey, geometry) =>
  `faction-ring-${styleKey}-${Math.round(geometry.rx * 2)}x${Math.round(geometry.ry * 2)}`;

/** Build (once) and return the texture key for a ring style. */
export function ensureRingTexture(scene, styleKey, options = {}) {
  const geometry = ringGeometry(styleKey, options);
  const key = textureKey(styleKey, geometry);
  const textures = scene?.textures;
  if (!textures?.exists || textures.exists(key)) return key;
  if (typeof textures.createCanvas !== 'function') return null;
  const img = rasterizeRing(styleKey, geometry);
  const tex = textures.createCanvas(key, img.width, img.height);
  const ctx = tex?.getContext?.();
  if (!ctx) return null;
  const imageData = ctx.createImageData(img.width, img.height);
  imageData.data.set(img.data);
  ctx.putImageData(imageData, 0, 0);
  tex.refresh();
  return key;
}

/**
 * Create a unit's ring at (x, ringY). Falls back to the legacy stroked ellipse when
 * textures are unavailable (headless tests, exotic renderers).
 */
export function createFactionRing(scene, unit, x, y, { color, entityWidthTiles } = {}) {
  const styleKey = selectRingStyle(unit);
  let key;
  try {
    key = ensureRingTexture(scene, styleKey, { entityWidthTiles });
  } catch {
    key = null; // headless mocks: fall back to the stroked ellipse
  }
  if (key && typeof scene.add?.image === 'function') {
    const ring = scene.add.image(x, y, key).setDepth(RING_DEPTH);
    ring.ringStyle = styleKey;
    return ring;
  }
  const g = ringGeometry(styleKey, { entityWidthTiles });
  return scene.add
    .ellipse(x, y, g.rx * 2, g.ry * 2, 0x000000, 0)
    .setStrokeStyle(2, color ?? 0xffffff, 0.7)
    .setDepth(RING_DEPTH);
}

/** Re-skin an existing ring (e.g. the caravan after a checkpoint restore). */
export function restyleFactionRing(scene, unit) {
  const ring = unit?.factionIndicator;
  if (!ring?.setTexture) return false;
  const styleKey = selectRingStyle(unit);
  if (ring.ringStyle === styleKey) return true;
  const key = ensureRingTexture(scene, styleKey);
  if (!key) return false;
  ring.setTexture(key);
  ring.ringStyle = styleKey;
  return true;
}

/** Acted (grayed) vs ready: a multiplicative dim that matches the sprite's tint. */
export function setFactionRingActed(ring, acted) {
  if (!ring) return;
  if (acted) {
    ring.setTint?.(RING_ACTED_TINT);
    ring.setAlpha?.(RING_ACTED_ALPHA);
  } else {
    ring.clearTint?.();
    ring.setAlpha?.(1);
  }
}
