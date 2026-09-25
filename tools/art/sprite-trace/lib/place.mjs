// Placement rules shared with the runtime contract (RebuiltSprites.spritePlacement):
// a square texture centred on the unit's tile, feet on a fixed baseline, per-kind
// maximum bounds. Everything scales with the sprite density D (art px per world px):
// D = 1 is the current 64 px texture; D = 1.5 puts sprite pixels on the painted
// terrain's 48-texel-per-cell lattice (96 px texture shown at 64 world px). Pure.

/** Per-kind limits in WORLD px (32 px tile). body = target body height (outline incl.). */
export const KINDS = {
  infantry: { body: 34, maxW: 38, maxH: 34 },
  mage: { body: 30, maxW: 38, maxH: 30 },
  heavy: { body: 36, maxW: 38, maxH: 36 },
  mounted: { body: 40, maxW: 46, maxH: 40 },
  flyer: { body: 34, maxW: 40, maxH: 34 },
  // legibility-v2: the thief crouch is 80% of a standing unit, not normalised up
  crouch: { body: 27, maxW: 38, maxH: 27 },
  boss: { body: 36, maxW: 42, maxH: 36 },
  // The Entity fills a 3x3 footprint: a 128 px texture (RebuiltSprites 'entity' placement)
  entity: { body: 90, maxW: 94, maxH: 90, texture: 128, foot: 106 },
};

export const FOOT_Y = 44; // world px, exclusive bottom of the feet in a 64 px texture
export const TEXTURE = 64; // world px

export function textureSize(density, kind = null) {
  return Math.round((KINDS[kind]?.texture || TEXTURE) * density);
}

/** Exclusive foot baseline in texture px (lowest opaque row = footRow - 1). */
export function footRow(density, kind = null) {
  return Math.round((KINDS[kind]?.foot || FOOT_Y) * density);
}

/**
 * Scale for a native figure: body (non-weapon) height maps to the kind's body
 * height; the full figure (weapons included) must fit the kind's max width and the
 * texture height above the baseline. `outline` = px added around the fill.
 */
export function fitScale(bodyH, fullW, fullH, kind, density, outline = 2) {
  const k = KINDS[kind] || KINDS.infantry;
  const bodyPx = Math.round(k.body * density) - outline;
  let s = bodyPx / bodyH;
  const maxW = Math.round(k.maxW * density) - outline;
  if (fullW * s > maxW) s = maxW / fullW;
  const room = footRow(density, kind) - outline; // everything must fit above the baseline
  if (fullH * s > room) s = room / fullH;
  return s;
}

/**
 * Offsets that put a sprite's fill into the texture: fill bottom on footRow-2 (the
 * outline then lands on footRow-1) and the body centre on the texture centre.
 */
export function placement(fillBounds, bodyBounds, density, kind = null) {
  const size = textureSize(density, kind);
  const bottom = footRow(density, kind) - 2; // last fill row
  const dy = bottom - (fillBounds.y + fillBounds.height - 1);
  const bodyCx = bodyBounds.x + bodyBounds.width / 2;
  const dx = Math.round(size / 2 - bodyCx);
  return { size, dx, dy };
}
