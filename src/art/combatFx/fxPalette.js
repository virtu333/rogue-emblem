// fxPalette — the Ink & Ember colours combat effects are drawn in (pure, no Phaser).
//
// Shared by the offline generator (tools/art/combat-fx), which bakes every effect
// frame from these ramps, and by the runtime, which tints pooled motes and ghosts
// with the same values. Ramps come from the art bible (docs/art-direction/ART_BIBLE.md);
// effect ramps are ordered dim -> hot so an intensity field can be quantized onto
// them. Additive glow ramps start dark: on the dusk and night grades a dim step adds
// only a faint haze, which is how a hard-edged pixel effect gets a soft outer glow.

export const ART_RAMPS = Object.freeze({
  ink: [
    '#07060b',
    '#0e0c14',
    '#16131e',
    '#211d2b',
    '#2e293a',
    '#403949',
    '#58505e',
    '#766b77',
    '#978b94',
    '#bdb0aa',
    '#ddd0bd',
    '#f4ecdb',
  ],
  ember: ['#2a170e', '#4f2c16', '#80461f', '#b3702c', '#dca044', '#f3cb6c', '#fff0bd'],
  blood: ['#22090f', '#44111c', '#6e1a28', '#9e2632', '#cc4038', '#ec7a5c'],
  steel: ['#101a2e', '#1c2f4f', '#2c4c77', '#4574a0', '#77a5c6', '#b8d8e6'],
  verdigris: ['#0f2622', '#1b4239', '#2d6450', '#4d8b66', '#86b27b', '#c3d69a'],
  unlight: ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'],
  earth: ['#1d1a12', '#34301d', '#4f4a2a', '#6e6a3b', '#938c55', '#b8ae78'],
  stone: ['#1a1a20', '#2b2c33', '#40414a', '#5a5b63', '#7a7a80', '#a09e9f'],
});

const R = ART_RAMPS;

/**
 * Additive glow ramps per effect family (dim -> hot). Each family keeps to its own
 * short ramp so effects read as one set without looking alike.
 */
export const GLOW_RAMPS = Object.freeze({
  // Moonlit steel: sword crescents, lance streaks, pierce needles.
  steel: [R.steel[1], R.steel[2], R.steel[3], R.steel[4], R.steel[5], R.ink[11]],
  // Heavy, hot: axe cleaves, boss enrage, drain pulses.
  blood: [R.blood[1], R.blood[2], R.blood[3], R.blood[4], R.blood[5], R.ember[5]],
  // Fire and cinders.
  ember: [R.ember[1], R.ember[2], R.ember[3], R.ember[4], R.ember[5], R.ember[6]],
  // Gilt light: holy motes, cross-flares, wards, rune rings.
  gilt: [R.ember[2], R.ember[3], R.ember[4], R.ember[5], R.ember[6], R.ink[11]],
  // Thunder: a steel halo around a white-gold bolt.
  thunder: [R.steel[2], R.steel[4], R.ember[4], R.ember[5], R.ember[6], R.ink[11]],
  // Wind: pale crescent gusts with a verdigris cast.
  wind: [R.verdigris[1], R.verdigris[2], R.verdigris[4], R.verdigris[5], R.ink[10], R.ink[11]],
  // Healing: verdigris motes.
  verdigris: [
    R.verdigris[1],
    R.verdigris[2],
    R.verdigris[3],
    R.verdigris[4],
    R.verdigris[5],
    R.ink[11],
  ],
  // Unlight rim (the only light corruption gives off is its own violet edge).
  unlight: [R.unlight[1], R.unlight[2], R.unlight[3], R.unlight[4], R.unlight[5]],
  // Acid / toxic breath: sickly verdigris that never reaches white.
  acid: [R.verdigris[1], R.verdigris[2], R.verdigris[3], R.verdigris[4], R.verdigris[5]],
  // Pale: drowsy steel-violet for sleep, ancient breath.
  pale: [R.unlight[1], R.steel[2], R.steel[4], R.unlight[5], R.ink[10], R.ink[11]],
});

/** Solid (normal-blend) ink tones, darkest first: effect line work and unlight bodies. */
export const INK_TONES = Object.freeze({
  line: R.ink[0],
  lineSoft: R.ink[2],
  lineEdge: R.ink[4],
  unlightCore: R.ink[0],
  unlightBody: R.unlight[0],
  unlightEdge: R.unlight[1],
});

/** Runtime mote colours (numeric, for Phaser tints). */
function hexInt(hex) {
  return parseInt(hex.slice(1), 16) >>> 0;
}

export const MOTE_COLORS = Object.freeze({
  emberHot: hexInt(R.ember[6]),
  ember: hexInt(R.ember[5]),
  emberMid: hexInt(R.ember[4]),
  emberDim: hexInt(R.ember[3]),
  emberDeep: hexInt(R.ember[2]),
  crimsonHot: hexInt(R.blood[5]),
  crimson: hexInt(R.blood[4]),
  crimsonDim: hexInt(R.blood[3]),
  crimsonDeep: hexInt(R.blood[2]),
  gilt: hexInt(R.ink[11]),
  verdigris: hexInt(R.verdigris[4]),
  verdigrisPale: hexInt(R.verdigris[5]),
  verdigrisDim: hexInt(R.verdigris[3]),
  violet: hexInt(R.unlight[4]),
  violetPale: hexInt(R.unlight[5]),
  violetDim: hexInt(R.unlight[2]),
  unlight: hexInt(R.unlight[0]),
  ink: hexInt(R.ink[0]),
  ash: hexInt(R.ink[6]),
  ashDim: hexInt(R.ink[4]),
  pale: hexInt(R.ink[10]),
  steel: hexInt(R.steel[5]),
  steelDim: hexInt(R.steel[3]),
});

/** Hex string -> [r, g, b] (0..255). */
export function hexRgb(hex) {
  const v = hexInt(hex);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lerp two 0xRRGGBB colours (t 0..1), rounding each channel; allocation-free. */
export function lerpColor(a, b, t) {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return ((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)) >>> 0;
}
