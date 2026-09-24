// Sprite-lab palette: five-step ramps (darkest first) built from the Art Bible
// ramps (docs/art-direction/ART_BIBLE.md). Shadows lean violet/blue, highlights
// warm. Skin and hair ramps are new but follow the same hue-shift rule.
//
// Sprites are stored as (logical slot, shade 0..4) — never as RGB — so a
// faction, a corruption grade or a recruit's identity is a ramp swap, and
// every output pixel is guaranteed to come from this file.

export const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Art Bible ramps, verbatim (reference only; sprite ramps below pick from them).
export const BIBLE = {
  ink: '#07060b #0e0c14 #16131e #211d2b #2e293a #403949 #58505e #766b77 #978b94 #bdb0aa #ddd0bd #f4ecdb',
  ember: '#2a170e #4f2c16 #80461f #b3702c #dca044 #f3cb6c #fff0bd',
  blood: '#22090f #44111c #6e1a28 #9e2632 #cc4038 #ec7a5c',
  steel: '#101a2e #1c2f4f #2c4c77 #4574a0 #77a5c6 #b8d8e6',
  verdigris: '#0f2622 #1b4239 #2d6450 #4d8b66 #86b27b #c3d69a',
  unlight: '#170c24 #2c1645 #4a2270 #763aa0 #a863cc #dcaaf0',
  earth: '#1d1a12 #34301d #4f4a2a #6e6a3b #938c55 #b8ae78',
  stone: '#1a1a20 #2b2c33 #40414a #5a5b63 #7a7a80 #a09e9f',
};

const R = (s) => s.split(/\s+/).map(hex);

export const RAMPS = {
  // --- faction areas -------------------------------------------------------
  steelCloth: R('#1c2f4f #2c4c77 #4574a0 #77a5c6 #b8d8e6'), // bible steel 1..5
  lacquer: R('#44111c #6e1a28 #9e2632 #cc4038 #ec7a5c'), // bible blood 1..5
  teal: R('#0d1f25 #15393d #23605e #3f8c86 #7ec0b0'), // Edric only (sampled from rebuilt Edric)
  unlightCloth: R('#170c24 #2c1645 #4a2270 #763aa0 #a863cc'), // bible unlight 0..4
  // --- thread / trim ------------------------------------------------------
  gold: R('#4f2c16 #80461f #b3702c #dca044 #f3cb6c'), // bible ember 1..5
  ironTrim: R('#1a1a20 #2b2c33 #40414a #5a5b63 #7a7a80'), // bible stone 0..4
  unlightTrim: R('#170c24 #2c1645 #4a2270 #763aa0 #a863cc'),
  // --- metals -------------------------------------------------------------
  // Player plate: warm silver (bible ink/stone mix), top step is the bible's paper white.
  silver: R('#211d2b #403949 #766b77 #bdb0aa #f4ecdb'),
  // Enemy plate: dull iron, no bright step — "enemies carry no light of their own".
  iron: R('#16131e #2b2c33 #40414a #5a5b63 #7a7a80'),
  // Blades keep a white highlight on both sides so the weapon cue survives (legibility rule 1).
  bladeP: R('#211d2b #58505e #978b94 #ddd0bd #f4ecdb'),
  bladeE: R('#16131e #40414a #766b77 #bdb0aa #ddd0bd'),
  // --- materials ----------------------------------------------------------
  leather: R('#1d1412 #3b2419 #5e3a22 #865632 #b07c4a'),
  darkLeather: R('#110d10 #241a1a #3b2a24 #5a4032 #7a5a44'),
  wood: R('#1d1612 #3a2a1d #5c432b #806040 #a8845a'),
  // Secondary / identity cloth (never blue or crimson: those belong to the factions)
  charcoal: R('#0e0c14 #211d2b #2e293a #403949 #58505e'),
  ash: R('#16131e #2e293a #403949 #58505e #766b77'),
  olive: R('#1d1a12 #34301d #4f4a2a #6e6a3b #938c55'),
  moss: R('#0f2622 #1b4239 #2d6450 #4d8b66 #86b27b'),
  rust: R('#22120f #45231a #6b3a26 #93573a #b97d57'),
  umber: R('#1d1412 #33241c #4e3828 #6e5038 #8f6c4c'),
  linen: R('#58505e #978b94 #bdb0aa #ddd0bd #f4ecdb'),
  bone: R('#403949 #766b77 #a89a8c #cfc0a8 #ece0c8'),
  plum: R('#1c111a #3e2d39 #5b4552 #7d6270 #a88d98'), // Sera's robe (sampled from rebuilt Sera)
  // --- skin (fair → deep) -------------------------------------------------
  skinFair: R('#4a2530 #8a4a3e #c47f5e #e6b088 #f7dcc0'),
  skinWarm: R('#3e2027 #74402f #b06f4e #d6996c #eec39a'),
  skinOlive: R('#3a2a24 #6a4b37 #9c7452 #c49d74 #e2c49c'),
  skinTan: R('#2f1a1d #5e3426 #8f5638 #b87c52 #d9a878'),
  skinDeep: R('#1f1216 #3e2220 #633826 #8a5536 #b07b54'),
  // --- hair ---------------------------------------------------------------
  hairBlack: R('#0e0c14 #1c1822 #2e293a #4a4252 #6f6577'),
  hairBrown: R('#1f1114 #44241e #6e3e28 #9a6238 #c08a50'),
  hairChestnut: R('#1c0f10 #3d1c17 #63301f #8c4a2b #b3703f'),
  hairAuburn: R('#2a0f12 #5e1e1a #8d2f2a #bf4532 #e0704a'),
  hairAsh: R('#3a2a1e #6e5530 #a88a48 #d6bb6e #f2e2a0'),
  hairSilver: R('#2e293a #58505e #978b94 #ddd0bd #f4ecdb'),
  hairSlate: R('#101a2e #1e2638 #343c52 #56607a #8a93aa'),
  // --- mounts -------------------------------------------------------------
  horseBay: R('#1d1210 #3e2620 #62402e #8a6044 #b08460'),
  horseGrey: R('#211d2b #403949 #6e6673 #9a929a #c8c0c0'),
  horseBlack: R('#16131e #262230 #3a3444 #544b5c #766b77'),
  pegasus: R('#403949 #766b77 #bdb0aa #ddd0bd #f4ecdb'),
  maneDark: R('#0e0c14 #1c1822 #2e293a #403949 #58505e'),
  maneFlax: R('#3a2a1e #6e5530 #a88a48 #d6bb6e #f2e2a0'),
  // --- light --------------------------------------------------------------
  glowGold: R('#80461f #dca044 #f3cb6c #fff0bd #ffffff'),
  glowUnlight: R('#2c1645 #763aa0 #a863cc #dcaaf0 #f4e4ff'),
};

export const INK = hex('#07060b');
export const INK_SOFT = hex('#16131e');
export const EYE = hex('#16131e');
export const SPARK = hex('#f4ecdb');
export const UNLIGHT_EYE = hex('#dcaaf0');

// Faction treatments: logical slot -> ramp. Identity slots (skin, hair, sub,
// leather...) come from the unit and are not touched by faction.
export const TREATMENTS = {
  player: {
    main: 'steelCloth',
    trim: 'gold',
    armor: 'silver',
    metal: 'bladeP',
    glow: 'glowGold',
  },
  enemy: {
    main: 'lacquer',
    trim: 'ironTrim',
    armor: 'iron',
    metal: 'bladeE',
    glow: 'glowGold',
  },
  // Corrupted uses the enemy kit, then the "unlight" grade in treat.mjs drains it.
  corrupted: {
    main: 'lacquer',
    trim: 'ironTrim',
    armor: 'iron',
    metal: 'bladeE',
    glow: 'glowUnlight',
  },
};

export function mix(a, b, t) {
  return [0, 1, 2].map((k) => Math.round(a[k] * (1 - t) + b[k] * t));
}

export function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
