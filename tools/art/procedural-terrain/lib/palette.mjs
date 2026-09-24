// Master palette for the procedural terrain study.
//
// Every pixel the renderer writes is an index into PALETTE, so output is
// palette-pure by construction. Colours are grouped into hue-shifted ramps
// (dark -> light). Shading is done by stepping along a ramp rather than by
// multiplying RGB, which keeps shadows cool (toward blue-violet) and
// highlights warm, the way hand-made SNES/GBA tiles are shaded.

// Ramps supplied by the art direction brief.
const BRIEF = {
  ink: '#07060b #0e0c14 #16131e #211d2b #2e293a #403949 #58505e #766b77 #978b94 #bdb0aa #ddd0bd #f4ecdb',
  ember: '#2a170e #4f2c16 #80461f #b3702c #dca044 #f3cb6c #fff0bd',
  blood: '#22090f #44111c #6e1a28 #9e2632 #cc4038 #ec7a5c',
  steel: '#101a2e #1c2f4f #2c4c77 #4574a0 #77a5c6 #b8d8e6',
  verdigris: '#0f2622 #1b4239 #2d6450 #4d8b66 #86b27b #c3d69a',
  unlight: '#170c24 #2c1645 #4a2270 #763aa0 #a863cc #dcaaf0',
  earth: '#1d1a12 #34301d #4f4a2a #6e6a3b #938c55 #b8ae78',
  stone: '#1a1a20 #2b2c33 #40414a #5a5b63 #7a7a80 #a09e9f',
};

// Intermediate ramps added for this study (allowed by the brief: a few
// greens/browns for grass and foliage). Each one is hue-shifted: shadows drift
// toward blue/violet, highlights toward warm yellow.
const ADDED = {
  // Grass and canopy. Darks lean blue-green, lights lean ochre.
  foliage: '#141f22 #1b2b2a #243a30 #2f4832 #3b5535 #4a6238 #58703c #6a7f43 #82904d #9ea05b #bdb570',
  // Meadow grass: muted olive so actors, not the ground, carry saturation.
  meadow: '#2f3a2e #3d4933 #4b5739 #5a653f #6a7346 #7c824e #92935a #aba66a',
  // Soil, bank earth, wood and thatch. Darks lean violet-brown.
  soil: '#221a19 #33261f #463426 #5c4430 #74573b #8e6d4a #aa875c #c6a474',
  // Dusk snow: cool violet shadows, warm cream tops.
  snow: '#4f5468 #666b82 #80849b #9c9eb1 #b8b7c3 #d0cbca #e4dccd',
  // Volcanic ash / basalt: warm dark greys.
  ash: '#1c181b #272125 #342c2f #43393a #544846 #685952 #806d62',
  // Acid: sickly chartreuse, emissive.
  acid: '#3f4d1a #5f7523 #8aa22f #b5cb43 #dde985',
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const PALETTE = []; // [[r,g,b], ...]
export const HEX = []; // index -> '#rrggbb'
const indexOfHex = new Map();
export const RAMP = {}; // rampName -> [paletteIndex, ...] dark -> light
const rampOf = []; // paletteIndex -> [rampName, position]

for (const [name, list] of Object.entries({ ...BRIEF, ...ADDED })) {
  RAMP[name] = list.split(/\s+/).map((hex) => {
    hex = hex.toLowerCase();
    if (!indexOfHex.has(hex)) {
      indexOfHex.set(hex, PALETTE.length);
      PALETTE.push(hexToRgb(hex));
      HEX.push(hex);
      rampOf.push([name, 0]);
    }
    return indexOfHex.get(hex);
  });
  RAMP[name].forEach((idx, pos) => {
    if (rampOf[idx][0] === name) rampOf[idx][1] = pos;
  });
}

export const PALETTE_SIZE = PALETTE.length;

/** Palette index for a hex string that must exist in the palette. */
export function hex(h) {
  const idx = indexOfHex.get(h.toLowerCase());
  if (idx === undefined) throw new Error(`Colour ${h} is not in the palette`);
  return idx;
}

/** Ramp colour by name and position (clamped). */
export function R(name, pos) {
  const ramp = RAMP[name];
  return ramp[Math.max(0, Math.min(ramp.length - 1, pos))];
}

// Step maps. A ramp's darkest entry steps into ink (cool) and its lightest
// into a warm cream, so repeated shading never leaves the palette.
export const DOWN = new Uint8Array(PALETTE_SIZE);
export const UP = new Uint8Array(PALETTE_SIZE);
for (let i = 0; i < PALETTE_SIZE; i++) {
  const [name, pos] = rampOf[i];
  const ramp = RAMP[name];
  DOWN[i] = pos > 0 ? ramp[pos - 1] : RAMP.ink[Math.max(0, inkNear(i) - 1)];
  UP[i] = pos < ramp.length - 1 ? ramp[pos + 1] : RAMP.ink[11];
}
function inkNear(i) {
  // Position on the ink ramp with the closest luminance.
  const lum = luma(PALETTE[i]);
  let best = 0,
    bestD = 1e9;
  RAMP.ink.forEach((idx, p) => {
    const d = Math.abs(luma(PALETTE[idx]) - lum);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  return best;
}
export function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function down(i, n = 1) {
  for (let k = 0; k < n; k++) i = DOWN[i];
  return i;
}
export function up(i, n = 1) {
  for (let k = 0; k < n; k++) i = UP[i];
  return i;
}

/** Emissive tint: pulls a dark ground colour toward the ember ramp. */
export function glow(i, strength) {
  const lum = luma(PALETTE[i]) / 255;
  const pos = Math.max(0, Math.min(6, Math.round(lum * 5 + strength)));
  return RAMP.ember[pos];
}
