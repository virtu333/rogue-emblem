// skyWash — pure data for the low sun of a dawn or dusk battle (no Phaser).
//
// A low sun lights a map from one side: warm light pooling from the sun's corner, the far
// corner falling into cool shade. SkyWashLayer draws it as two gradient quads over the map
// (an additive glow and a shade), static: nothing moves, nothing is redrawn. The corners are
// screen corners (as drawn), so a portrait board keeps its sun on the same side of the screen.
// Presentation only: no game state, no RNG.

export const SKY_WASH = Object.freeze({
  // Dawn: the sun rising at the right, rose-gold; the shade left over from the night is a
  // soft lavender.
  dawn: Object.freeze({
    sun: 'tr',
    glow: '#ff8c9c',
    glowAlpha: 0.34,
    shade: '#4a50a8',
    shadeAlpha: 0.34,
  }),
  // Dusk: the sun going down at the left, burnt orange; the far side already deep violet.
  dusk: Object.freeze({
    sun: 'tl',
    glow: '#ff7430',
    glowAlpha: 0.32,
    shade: '#28104a',
    shadeAlpha: 0.38,
  }),
});

// Reduced mode keeps the wash (it is static and cheap), a little lighter.
export const SKY_WASH_REDUCED = 0.85;
// The two corners beside the sun's carry this share of the sun corner's strength.
export const SKY_WASH_SIDE = 0.35;

const CORNERS = Object.freeze(['tl', 'tr', 'bl', 'br']);
const OPPOSITE = Object.freeze({ tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' });

/** The wash a battle's hour takes, or null (pure). */
export function skyWashFor(timeOfDay) {
  return SKY_WASH[timeOfDay] || null;
}

/**
 * Corner alphas for the glow and the shade quads (pure), in Phaser's
 * fillGradientStyle order: top-left, top-right, bottom-left, bottom-right.
 * @returns {{ glow: number[], shade: number[] }}
 */
export function skyWashCorners(wash, { reduced = false } = {}) {
  if (!wash || !CORNERS.includes(wash.sun)) return null;
  const scale = reduced ? SKY_WASH_REDUCED : 1;
  const far = OPPOSITE[wash.sun];
  const glow = CORNERS.map((c) =>
    c === wash.sun ? wash.glowAlpha : c === far ? 0 : wash.glowAlpha * SKY_WASH_SIDE,
  ).map((a) => a * scale);
  const shade = CORNERS.map((c) =>
    c === far ? wash.shadeAlpha : c === wash.sun ? 0 : wash.shadeAlpha * SKY_WASH_SIDE,
  ).map((a) => a * scale);
  return { glow, shade };
}
