// Icon palette (pure data). Every colour here comes from the ART_BIBLE ramps
// (docs/art-direction/ART_BIBLE.md), so icons sit on the same light as terrain,
// key art and portraits. Material ramps are 5 levels:
//   0 outline (darkest)  1 shadow  2 mid  3 light  4 highlight
// Shading is computed from the key light (upper-left), so a ramp is all a
// material needs.

export const RAMPS = Object.freeze({
  ink: ['#07060b', '#0e0c14', '#16131e', '#211d2b', '#2e293a', '#403949', '#58505e', '#766b77', '#978b94', '#bdb0aa', '#ddd0bd', '#f4ecdb'],
  ember: ['#2a170e', '#4f2c16', '#80461f', '#b3702c', '#dca044', '#f3cb6c', '#fff0bd'],
  blood: ['#22090f', '#44111c', '#6e1a28', '#9e2632', '#cc4038', '#ec7a5c'],
  steel: ['#101a2e', '#1c2f4f', '#2c4c77', '#4574a0', '#77a5c6', '#b8d8e6'],
  verdigris: ['#0f2622', '#1b4239', '#2d6450', '#4d8b66', '#86b27b', '#c3d69a'],
  unlight: ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'],
  earth: ['#1d1a12', '#34301d', '#4f4a2a', '#6e6a3b', '#938c55', '#b8ae78'],
  stone: ['#1a1a20', '#2b2c33', '#40414a', '#5a5b63', '#7a7a80', '#a09e9f'],
});
const { ink, ember, blood, steel, verdigris, unlight, earth, stone } = RAMPS;

/** Material ramps (outline, shadow, mid, light, highlight). */
export const MATERIALS = Object.freeze({
  // Metals by tier: iron dull, steel blue-cold, silver bright, gilt for legends,
  // blackened with a violet glint for Rare (enemy-issue) pieces.
  iron: [stone[0], stone[3], stone[4], stone[5], ink[9]],
  steel: [steel[0], steel[2], steel[3], steel[4], steel[5]],
  silver: [ink[3], ink[7], ink[9], ink[10], ink[11]],
  gilt: [ember[1], ember[3], ember[4], ember[5], ember[6]],
  bronze: [ember[0], ember[2], ember[3], ember[4], ember[5]],
  blackened: [ink[0], ink[4], ink[5], ink[6], unlight[4]],
  // Legendary blades: bright silver body; the fuller carries the ember core.
  legendBlade: [ink[3], ink[8], ink[10], ink[11], ember[6]],
  // Fittings (guards, ferrules, bindings) sit one step darker than the blade.
  ironFit: [earth[0], stone[1], stone[3], stone[4], stone[5]],
  steelFit: [steel[0], steel[1], steel[2], steel[3], steel[4]],
  silverFit: [ink[2], ink[6], ink[8], ink[9], ink[10]],
  // Organics and cloth.
  wood: [ember[0], ember[2], ember[3], ember[4], ember[5]],
  darkWood: [ink[0], ember[0], ember[1], ember[2], ember[3]],
  cord: [ink[0], ink[3], ink[5], ink[6], ink[7]],
  parchment: [ink[4], ink[8], ink[9], ink[10], ink[11]],
  cloth: [ink[1], ink[4], ink[5], ink[6], ink[7]],
  // Elements, effects and accents.
  ember: [ember[1], ember[3], ember[4], ember[5], ember[6]],
  blood: [blood[0], blood[2], blood[3], blood[4], blood[5]],
  verdigris: [verdigris[0], verdigris[2], verdigris[3], verdigris[4], verdigris[5]],
  unlight: [unlight[0], unlight[2], unlight[3], unlight[4], unlight[5]],
  sky: [steel[1], steel[3], steel[4], steel[5], ink[11]],
  earth: [earth[0], earth[2], earth[3], earth[4], earth[5]],
  stone: [stone[0], stone[2], stone[3], stone[4], stone[5]],
  slate: [ink[0], ink[3], ink[4], ink[5], ink[6]],
  pearl: [ink[5], ink[8], ink[10], ink[11], ember[6]],
  rose: [blood[1], blood[3], blood[4], blood[5], ember[6]],
  lilac: [unlight[1], unlight[3], unlight[4], unlight[5], ink[11]],
  leaf: [verdigris[1], verdigris[3], verdigris[4], verdigris[5], ink[11]],
  ink: [ink[0], ink[1], ink[2], ink[3], ink[4]],
});

/** Tier -> metal ramps for blade and fittings. */
export const TIER_METAL = Object.freeze({
  Iron: { blade: 'iron', fit: 'ironFit' },
  Steel: { blade: 'steel', fit: 'steelFit' },
  Silver: { blade: 'silver', fit: 'silverFit' },
  Rare: { blade: 'blackened', fit: 'blackened' },
  Legend: { blade: 'legendBlade', fit: 'gilt' },
});

/**
 * Stat colour code, shared by gems, boosters, whetstones, upgrades and blessings.
 * Hue families pair attack/defence twins (STR/LCK red-rose, MAG/RES violet-lilac,
 * DEF/SPD blue-sky, HP/MOV green-leaf); SKL is the clear stone.
 */
export const STAT_MATERIAL = Object.freeze({
  HP: 'verdigris',
  STR: 'blood',
  MAG: 'unlight',
  SKL: 'pearl',
  SPD: 'sky',
  DEF: 'steel',
  RES: 'lilac',
  LCK: 'rose',
  MOV: 'leaf',
});

/** Element code for tomes, breaths, stones and imbues. */
export const ELEMENT_MATERIAL = Object.freeze({
  fire: 'blood',
  thunder: 'sky',
  wind: 'verdigris',
  light: 'pearl',
  dark: 'unlight',
  poison: 'verdigris',
  earth: 'earth',
});

/** UI panel colours (src/ui/uiPalette.json) used for contact sheets. */
export const PANELS = Object.freeze({
  bg: '#0e0c14',
  panel: '#17141f',
  raised: '#201c29',
  selected: '#3a2c24',
  sunken: '#08070c',
});

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
