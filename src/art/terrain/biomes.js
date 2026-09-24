// Biome styles: which ramp entries each material uses. Materials and shapes
// are shared; biomes swap palettes *and* a few shape choices (tree species,
// snow caps, basalt peaks) so biomes differ by material, not just by tint.
import { R } from './palette.js';

// Ground materials (per art pixel). HARD materials keep exact cell squares.
export const G = Object.freeze({
  NONE: 0,
  GRASS: 1,
  FOREST: 2, // reserved (forest cells use the open-ground material)
  ROCK: 3,
  SAND: 4,
  WATER: 5,
  ICE: 6,
  LAVA: 7,
  SWAMP: 8,
  BOG: 9,
  ASWAMP: 10,
  ABOG: 11,
  FLOOR: 12,
  WALL: 13,
});
export const MATERIAL_COUNT = 14;
export const HARD = new Uint8Array(MATERIAL_COUNT);
HARD[G.FLOOR] = 1;
HARD[G.WALL] = 1;

/** Terrain name -> ground material for a biome's default ground. */
export function groundOf(name, defaultGround) {
  switch (name) {
    case 'Plain':
    case 'Fort':
    case 'Village':
    case 'Ballista':
      return defaultGround;
    case 'Forest':
      // Trees stand on soil: in stone biomes a forest cell is a garden patch.
      return HARD[defaultGround] ? G.GRASS : defaultGround;
    case 'Mountain':
      return G.ROCK;
    case 'Throne':
    case 'Pillar':
    case 'Floor':
      return G.FLOOR;
    case 'Wall':
      return G.WALL;
    case 'Water':
    case 'River':
    case 'Bridge':
      return G.WATER;
    case 'Sand':
      return G.SAND;
    case 'Ice':
      return G.ICE;
    case 'Lava Crack':
      return G.LAVA;
    case 'Swamp':
      return G.SWAMP;
    case 'Bog':
      return G.BOG;
    case 'Acidic Swamp':
      return G.ASWAMP;
    case 'Acidic Bog':
      return G.ABOG;
    default:
      return defaultGround;
  }
}

/** Every terrain name the renderer paints explicitly (data/terrain.json + River). */
export const PAINTED_TERRAIN = Object.freeze([
  'Plain',
  'Forest',
  'Mountain',
  'Fort',
  'Throne',
  'Wall',
  'Water',
  'River',
  'Bridge',
  'Sand',
  'Village',
  'Ice',
  'Lava Crack',
  'Floor',
  'Pillar',
  'Ballista',
  'Swamp',
  'Bog',
  'Acidic Swamp',
  'Acidic Bog',
]);

const f = (i) => R('foliage', i);
const g = (i) => R('meadow', i);
const ramp = (name, positions) => positions.map((k) => R(name, k));

// Open ground: `base` covers most of it, `light` / `dark` are large, soft
// value patches one close step away, `hi` lights clumps, `blade` is the
// tuft colour. Keep the ground one value step lighter than the canopy so
// cover reads as mass and actors stay lit.
export const BIOMES = {
  grassland: {
    defaultGround: G.GRASS,
    ground: { dark: g(5), base: g(6), light: g(7), hi: g(8), blade: g(8), shade: g(4) },
    rockGround: { dark: g(5), base: g(6), light: g(7), hi: g(8), blade: g(8) },
    trees: {
      canopy: [
        ['broadleaf', 5],
        ['pine', 0.7],
        ['poplar', 0.6],
        ['birch', 0.6],
      ],
      under: [
        ['bush', 3],
        ['sapling', 2],
        ['log', 0.4],
        ['stump', 0.25],
      ],
    },
    leaf: ramp('foliage', [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    leaf2: ramp('foliage', [0, 0, 1, 2, 3, 4, 5, 6, 7]),
    conifer: ramp('foliage', [0, 0, 1, 1, 2, 3, 4, 5, 6]),
    birch: ramp('foliage', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    moss: R('foliage', 6),
    trunk: [R('soil', 1), R('soil', 3)],
    rock: {
      ramp: ramp('rock', [1, 2, 3, 4, 5, 6, 7, 8]),
      outline: R('rock', 0),
      cap: null,
    },
    flowers: [R('ink', 10), R('ember', 5), R('blood', 5)],
    path: [R('meadow', 8), R('earth', 5)],
    tufts: true,
  },
  tundra: {
    defaultGround: G.GRASS,
    dirt: [R('snow', 3), R('snow', 2)],
    pebble: [R('stone', 4), R('stone', 3)],
    ground: {
      dark: R('snow', 4),
      base: R('snow', 5),
      light: R('snow', 6),
      hi: R('snow', 7),
      blade: R('earth', 4),
      shade: R('snow', 3),
      stretch: [0.35, 1.7],
      drift: { period: 14, len: 12, patch: 0.56 },
    },
    rockGround: {
      dark: R('snow', 4),
      base: R('snow', 5),
      light: R('snow', 6),
      hi: R('snow', 7),
      blade: R('earth', 4),
      stretch: [0.35, 1.7],
    },
    trees: {
      canopy: [
        ['pine', 4],
        ['fir', 3],
        ['bare', 0.7],
      ],
      under: [
        ['spruceling', 2],
        ['stump', 0.3],
      ],
    },
    bark: ramp('ink', [2, 3, 4, 5, 6, 7, 8, 9, 10]),
    shrub: [R('steel', 0), f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7)],
    leaf: [R('steel', 0), f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7)],
    leaf2: ramp('ink', [3, 4, 5, 6, 7, 8, 9, 10, 11]),
    trunk: [R('ink', 4), R('ink', 9)],
    rock: {
      ramp: [
        R('ink', 4),
        R('ink', 5),
        R('stone', 3),
        R('stone', 4),
        R('ink', 8),
        R('ink', 9),
        R('ink', 10),
        R('ink', 11),
      ],
      outline: R('ink', 3),
      cap: { ramp: ramp('snow', [2, 3, 4, 5, 6, 7]) },
    },
    flowers: null,
    tufts: 'dry',
  },
  volcano: {
    defaultGround: G.GRASS,
    dirt: [R('ash', 5), R('ash', 4)],
    pebble: [R('ash', 8), R('ash', 5)],
    // one step lighter than the study: dark units must still read on ash
    ground: {
      dark: R('ash', 5),
      base: R('ash', 6),
      light: R('ash', 7),
      hi: R('ash', 8),
      blade: R('earth', 4),
      shade: R('ash', 4),
      stretch: [0.6, 1.2],
      drift: { period: 12, len: 9, patch: 0.64, crest: false },
    },
    rockGround: {
      dark: R('ash', 5),
      base: R('ash', 6),
      light: R('ash', 7),
      hi: R('ash', 8),
      blade: R('earth', 4),
      stretch: [0.6, 1.2],
    },
    trees: {
      canopy: [
        ['dead', 3],
        ['snag', 2],
        ['charpine', 1.2],
      ],
      under: [
        ['thorn', 2],
        ['stump', 0.6],
        ['log', 0.4],
      ],
    },
    leaf: ramp('ash', [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    bark: ramp('ash', [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    leaf2: ramp('ash', [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    trunk: [R('ash', 1), R('ash', 4)],
    rock: {
      ramp: [
        R('ink', 2),
        R('ash', 1),
        R('ash', 2),
        R('ash', 3),
        R('ash', 4),
        R('ash', 5),
        R('ash', 6),
        R('ash', 7),
      ],
      outline: R('ink', 1),
      cap: null,
      ember: true,
    },
    flowers: null,
    tufts: 'dry',
  },
  swamp: {
    defaultGround: G.GRASS,
    dirt: [R('earth', 4), R('earth', 3)],
    ground: {
      dark: g(4),
      base: g(5),
      light: g(6),
      hi: g(7),
      blade: R('earth', 5),
      shade: g(3),
    },
    rockGround: { dark: g(4), base: g(5), light: g(6), hi: g(7), blade: R('earth', 5) },
    trees: {
      canopy: [
        ['willow', 3],
        ['cypress', 2],
        ['snag', 0.7],
      ],
      under: [
        ['bush', 2],
        ['sapling', 1],
        ['log', 0.5],
      ],
    },
    bark: ramp('rock', [0, 1, 2, 3, 3, 4, 5, 6, 7]),
    moss: R('foliage', 6),
    leaf: [f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)],
    leaf2: ramp('marsh', [0, 1, 1, 2, 3, 4, 5, 6, 7]),
    trunk: [R('soil', 1), R('soil', 3)],
    rock: {
      ramp: [
        R('rock', 1),
        R('rock', 2),
        R('rock', 3),
        R('earth', 3),
        R('earth', 4),
        R('earth', 5),
        R('soil', 7),
        R('soil', 8),
      ],
      outline: R('rock', 0),
      cap: null,
    },
    flowers: [R('ink', 10)],
    path: [R('earth', 4), R('earth', 5)],
    tufts: true,
  },
  castle: {
    defaultGround: G.FLOOR,
    ground: { dark: g(4), base: g(5), light: g(6), hi: g(7), blade: g(7), shade: g(3) },
    rockGround: {
      dark: R('soil', 4),
      base: R('soil', 5),
      light: R('soil', 6),
      hi: R('soil', 7),
    },
    trees: {
      canopy: [
        ['broadleaf', 3],
        ['poplar', 2],
        ['birch', 1],
      ],
      under: [
        ['bush', 3],
        ['sapling', 1],
      ],
    },
    leaf: ramp('foliage', [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    leaf2: ramp('foliage', [0, 0, 1, 2, 3, 4, 5, 6, 7]),
    birch: ramp('foliage', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    moss: R('foliage', 6),
    trunk: [R('soil', 1), R('soil', 3)],
    rock: {
      ramp: [
        R('ink', 4),
        R('ink', 5),
        R('stone', 3),
        R('stone', 4),
        R('stone', 5),
        R('ink', 9),
        R('ink', 10),
        R('ink', 11),
      ],
      outline: R('ink', 2),
      cap: null,
    },
    flowers: null,
    tufts: false,
  },
  void: {
    defaultGround: G.FLOOR,
    ground: {
      dark: R('unlight', 1),
      base: R('unlight', 2),
      light: R('ink', 5),
      hi: R('ink', 6),
      blade: R('unlight', 3),
      shade: R('unlight', 1), // forest floor stays off black
    },
    rockGround: {
      dark: R('ink', 3),
      base: R('ink', 4),
      light: R('ink', 5),
      hi: R('ink', 6),
    },
    trees: {
      canopy: [
        ['dead', 3],
        ['snag', 2],
      ],
      under: [['thorn', 2]],
    },
    leaf: ramp('ink', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    leaf2: ramp('unlight', [0, 1, 1, 2, 2, 3, 3, 4, 5]),
    trunk: [R('ink', 2), R('ink', 6)],
    rock: {
      ramp: [
        R('ink', 2),
        R('ink', 3),
        R('ink', 4),
        R('ink', 5),
        R('unlight', 2),
        R('ink', 7),
        R('ink', 8),
        R('ink', 9),
      ],
      outline: R('ink', 0),
      cap: null,
    },
    flowers: null,
    tufts: false,
  },
};
export const BIOME_NAMES = Object.freeze(Object.keys(BIOMES));

// Floor / wall stone per biome (castle stone by default).
// floor: [kerb, base, alt, lit]; floorMortar: stone -> its mortar.
// wallTop: [joint-dark, base, alt, merlon, rim, joint]; wallFace: dark -> light.
export const MASONRY = {
  default: {
    // Warm taupe flagstones (dusk / torch light) against cool slate walls:
    // hue *and* value separate open floor from blocking masonry.
    // variation drifts lighter, not darker, so the hall stays a lit stage
    floor: [R('rock', 5), R('rock', 6), R('rock', 7), R('rock', 8)],
    floorMortar: {
      [R('rock', 6)]: R('rock', 5),
      [R('rock', 7)]: R('rock', 6),
      [R('rock', 8)]: R('rock', 7),
    },
    wallTop: [R('stone', 2), R('stone', 3), R('ink', 6), R('stone', 4), R('stone', 5), R('ink', 6)],
    wallFace: [R('stone', 0), R('stone', 1), R('stone', 2), R('ink', 5), R('stone', 3)],
  },
  void: {
    // one step lighter than the study so the final battle's units separate
    floor: [R('ink', 4), R('ink', 6), R('ink', 5), R('unlight', 3)],
    floorMortar: {
      [R('ink', 6)]: R('ink', 5),
      [R('ink', 5)]: R('ink', 4),
      [R('unlight', 3)]: R('unlight', 2),
    },
    wallTop: [R('ink', 1), R('ink', 2), R('ink', 3), R('ink', 4), R('unlight', 3), R('ink', 1)],
    wallFace: [R('ink', 0), R('ink', 1), R('ink', 2), R('ink', 2), R('ink', 3)],
  },
  tundra: {
    floor: [R('stone', 3), R('stone', 4), R('snow', 3), R('snow', 4)],
    floorMortar: {
      [R('stone', 4)]: R('stone', 3),
      [R('snow', 3)]: R('snow', 2),
      [R('snow', 4)]: R('snow', 3),
    },
    wallTop: [R('stone', 2), R('snow', 2), R('snow', 3), R('snow', 4), R('snow', 5), R('snow', 1)],
    wallFace: [R('stone', 0), R('stone', 1), R('stone', 2), R('ink', 5), R('stone', 3)],
  },
};
