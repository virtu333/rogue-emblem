// Master palette for the procedural battlefield terrain.
//
// Every pixel the renderer writes is an index into PALETTE, so the output is
// palette-pure by construction. Colours are grouped into hue-shifted ramps
// (dark -> light). Shading steps along a ramp instead of multiplying RGB, so
// shadows lean cool (blue-violet) and highlights warm, the way hand-made
// SNES/GBA tiles are shaded, and nothing can leave the palette.
//
// The eight Ink & Ember ramps come from the art bible
// (docs/art-direction/ART_BIBLE.md). The added ramps are terrain materials the
// bible allows ("a few greens/browns for grass and foliage"); each one is
// hue-shifted the same way.

export const BRIEF_RAMPS = Object.freeze({
  ink: '#07060b #0e0c14 #16131e #211d2b #2e293a #403949 #58505e #766b77 #978b94 #bdb0aa #ddd0bd #f4ecdb',
  ember: '#2a170e #4f2c16 #80461f #b3702c #dca044 #f3cb6c #fff0bd',
  blood: '#22090f #44111c #6e1a28 #9e2632 #cc4038 #ec7a5c',
  steel: '#101a2e #1c2f4f #2c4c77 #4574a0 #77a5c6 #b8d8e6',
  verdigris: '#0f2622 #1b4239 #2d6450 #4d8b66 #86b27b #c3d69a',
  unlight: '#170c24 #2c1645 #4a2270 #763aa0 #a863cc #dcaaf0',
  earth: '#1d1a12 #34301d #4f4a2a #6e6a3b #938c55 #b8ae78',
  stone: '#1a1a20 #2b2c33 #40414a #5a5b63 #7a7a80 #a09e9f',
});

export const ADDED_RAMPS = Object.freeze({
  // Canopy. Darks lean blue-green, lights lean ochre.
  foliage:
    '#141f22 #1b2b2a #243a30 #2f4832 #3b5535 #4a6238 #58703c #6a7f43 #82904d #9ea05b #bdb570',
  // Meadow grass: muted olive so the actors, not the ground, carry
  // saturation. Close steps in the middle keep open ground quiet.
  meadow: '#2f3a2e #3d4933 #4b5739 #5a653f #6a7346 #7c824e #8a8f58 #979a62 #aba66a #c0b67a',
  // Rock: violet shadows -> mauve-brown -> warm tan lights (dusk key light).
  rock: '#221d2a #332c3a #463d49 #5b5054 #74655e #8e7b69 #a99276 #c4ab88 #d8c29e',
  // Soil, bank earth, wood and thatch. Darks lean violet-brown.
  soil: '#221a19 #33261f #463426 #5c4430 #74573b #8e6d4a #aa875c #c6a474 #dcbf8e',
  // Dusk snow: cool violet shadows, warm cream tops.
  snow: '#4f5468 #666b82 #80849b #9c9eb1 #b0b1c1 #c2c1cb #d2cdcd #e4dccd',
  // Volcanic ash / basalt: warm dark greys.
  ash: '#1c181b #272125 #342c2f #43393a #544846 #685952 #7a6a60 #8c7b6d #a08e7c',
  // Acid: sickly chartreuse, emissive.
  acid: '#3f4d1a #5f7523 #8aa22f #b5cb43 #dde985',
  // Open water: a teal-slate blue. Lighter and greener than the steel UI
  // ramp so wide water reads as dusk water, not navy.
  tide: '#1b2a3e #233a50 #2d4a60 #385a6f #456b7c #587f8b #7297a0 #95b3b4 #c1d3c9',
  // Marsh: swamp water and bog mud share this olive ramp so adjacent
  // swamp / bog cells differ in texture and one value step, not in hue.
  marsh: '#1f2a22 #29372a #354430 #435236 #525f3d #636d46 #767c50 #8b8b5d #a29d6d',
});

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** index -> [r, g, b] */
export const PALETTE = [];
/** index -> '#rrggbb' */
export const HEX = [];
/** rampName -> [paletteIndex, ...] dark -> light */
export const RAMP = {};
const indexOfHex = new Map();
const rampOf = []; // paletteIndex -> [rampName, position] (first ramp that owns it)

for (const [name, list] of Object.entries({ ...BRIEF_RAMPS, ...ADDED_RAMPS })) {
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
Object.freeze(RAMP);

export const PALETTE_SIZE = PALETTE.length;
if (PALETTE_SIZE > 255) throw new Error('Terrain palette must fit in a byte');

/** Palette index for a hex string that must exist in the palette. */
export function hex(h) {
  const idx = indexOfHex.get(h.toLowerCase());
  if (idx === undefined) throw new Error(`Colour ${h} is not in the terrain palette`);
  return idx;
}

/** Ramp colour by name and position (clamped). */
export function R(name, pos) {
  const ramp = RAMP[name];
  if (!ramp) throw new Error(`Unknown ramp ${name}`);
  return ramp[Math.max(0, Math.min(ramp.length - 1, pos))];
}

/** [rampName, position] of a palette index. */
export function rampPosition(i) {
  return rampOf[i];
}

export function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

export function down(i, n = 1) {
  for (let k = 0; k < n; k++) i = DOWN[i];
  return i;
}
export function up(i, n = 1) {
  for (let k = 0; k < n; k++) i = UP[i];
  return i;
}

// Packed RGBA words for fast writes through a Uint32Array view of an
// ImageData / Uint8ClampedArray buffer (handles either byte order).
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
export const PALETTE_RGBA32 = new Uint32Array(256);
for (let i = 0; i < PALETTE_SIZE; i++) {
  const [r, g, b] = PALETTE[i];
  PALETTE_RGBA32[i] = LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}
