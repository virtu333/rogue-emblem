// Biome styles: which ramp entries each material uses. Materials and shapes
// are shared; biomes swap palettes *and* a few shape choices (tree species,
// snow caps, basalt peaks) so biomes differ by material, not just by tint.
import { R } from './palette.mjs';

// Ground materials (per pixel). HARD materials keep exact cell squares.
export const G = {
  NONE: 0,
  GRASS: 1,
  FOREST: 2,
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
};
export const HARD = new Set([G.FLOOR, G.WALL]);
export const LIQUID = new Set([G.WATER, G.SWAMP, G.ASWAMP]);

const f = (i) => R('foliage', i);

export const BIOMES = {
  grassland: {
    defaultGround: G.GRASS,
    // Open ground: 3 quiet tones + highlight for lit clumps.
    ground: { dark: f(5), base: f(6), light: f(7), hi: f(8), blade: f(8), shade: f(4) },
    forestFloor: { dark: f(4), base: f(5), light: f(6), hi: f(7), blade: f(7), shade: f(3) },
    rockGround: { dark: f(5), base: f(6), light: R('earth', 3), hi: R('earth', 4), shade: f(4) },
    tree: 'broadleaf',
    leaf: [f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)],
    rock: {
      lit: [R('soil', 4), R('soil', 5), R('soil', 6), R('soil', 7)],
      shade: [R('ink', 4), R('ink', 5), R('ink', 6), R('ink', 7)],
      outline: R('ink', 3),
      cap: null,
    },
    flowers: [R('ink', 10), R('ember', 5), R('blood', 5)],
    tufts: true,
  },
  tundra: {
    defaultGround: G.GRASS,
    ground: { dark: R('snow', 2), base: R('snow', 3), light: R('snow', 4), hi: R('snow', 5), blade: R('earth', 4), shade: R('snow', 1) },
    forestFloor: { dark: R('snow', 1), base: R('snow', 2), light: R('snow', 3), hi: R('snow', 4), blade: R('earth', 3), shade: R('snow', 0) },
    rockGround: { dark: R('snow', 1), base: R('snow', 2), light: R('snow', 3), hi: R('snow', 4), shade: R('snow', 0) },
    tree: 'pine',
    leaf: [R('steel', 0), f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7)],
    rock: {
      lit: [R('stone', 3), R('stone', 4), R('ink', 8), R('ink', 9)],
      shade: [R('ink', 3), R('ink', 4), R('ink', 5), R('ink', 6)],
      outline: R('ink', 2),
      cap: { lit: [R('snow', 4), R('snow', 5), R('snow', 6)], shade: [R('snow', 1), R('snow', 2)] },
    },
    flowers: null,
    tufts: 'dry',
  },
  volcano: {
    defaultGround: G.GRASS,
    ground: { dark: R('ash', 3), base: R('ash', 4), light: R('ash', 5), hi: R('ash', 6), blade: R('earth', 3), shade: R('ash', 2) },
    forestFloor: { dark: R('ash', 2), base: R('ash', 3), light: R('ash', 4), hi: R('ash', 5), blade: R('earth', 2), shade: R('ash', 1) },
    rockGround: { dark: R('ash', 2), base: R('ash', 3), light: R('ash', 4), hi: R('ash', 5), shade: R('ash', 1) },
    tree: 'dead',
    leaf: [R('ash', 0), R('ash', 1), R('ash', 2), R('ash', 3), R('ash', 4), R('ash', 5), R('ash', 6), R('soil', 5), R('soil', 6)],
    rock: {
      lit: [R('ash', 3), R('ash', 4), R('ash', 5), R('ash', 6)],
      shade: [R('ink', 1), R('ink', 2), R('ink', 3), R('ink', 4)],
      outline: R('ink', 1),
      cap: null,
      ember: true,
    },
    flowers: null,
    tufts: 'dry',
  },
  swamp: {
    defaultGround: G.GRASS,
    ground: { dark: f(3), base: f(4), light: R('earth', 3), hi: R('earth', 4), blade: R('earth', 5), shade: f(2) },
    forestFloor: { dark: f(2), base: f(3), light: f(4), hi: R('earth', 3), blade: R('earth', 4), shade: f(1) },
    rockGround: { dark: R('earth', 2), base: R('earth', 3), light: R('earth', 4), hi: R('earth', 5), shade: R('earth', 1) },
    tree: 'willow',
    leaf: [f(0), f(1), f(2), f(3), f(4), f(5), R('earth', 3), R('earth', 4), R('earth', 5)],
    rock: {
      lit: [R('earth', 3), R('earth', 4), R('soil', 5), R('soil', 6)],
      shade: [R('ink', 4), R('ink', 5), R('ink', 6), R('ink', 7)],
      outline: R('ink', 3),
      cap: null,
    },
    flowers: [R('ink', 10)],
    tufts: true,
  },
  castle: {
    defaultGround: G.FLOOR,
    ground: { dark: f(4), base: f(5), light: f(6), hi: f(7), blade: f(8), shade: f(3) },
    forestFloor: { dark: f(2), base: f(3), light: f(4), hi: f(5), blade: f(6), shade: f(1) },
    rockGround: { dark: R('soil', 3), base: R('soil', 4), light: R('soil', 5), hi: R('soil', 6), shade: R('soil', 2) },
    tree: 'broadleaf',
    leaf: [f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)],
    rock: {
      lit: [R('stone', 3), R('stone', 4), R('stone', 5), R('ink', 9)],
      shade: [R('ink', 3), R('ink', 4), R('ink', 5), R('ink', 6)],
      outline: R('ink', 2),
      cap: null,
    },
    flowers: null,
    tufts: false,
  },
  void: {
    defaultGround: G.FLOOR,
    ground: { dark: R('unlight', 1), base: R('unlight', 2), light: R('ink', 5), hi: R('ink', 6), blade: R('unlight', 3), shade: R('unlight', 0) },
    forestFloor: { dark: R('unlight', 0), base: R('unlight', 1), light: R('unlight', 2), hi: R('ink', 5), blade: R('unlight', 3), shade: R('ink', 1) },
    rockGround: { dark: R('ink', 3), base: R('ink', 4), light: R('ink', 5), hi: R('ink', 6), shade: R('ink', 2) },
    tree: 'dead',
    leaf: [R('ink', 1), R('ink', 2), R('ink', 3), R('ink', 4), R('ink', 5), R('ink', 6), R('ink', 7), R('unlight', 4), R('unlight', 5)],
    rock: {
      lit: [R('ink', 5), R('ink', 6), R('ink', 7), R('ink', 8)],
      shade: [R('ink', 1), R('ink', 2), R('ink', 3), R('ink', 4)],
      outline: R('ink', 0),
      cap: null,
    },
    flowers: null,
    tufts: false,
  },
};

// Floor / wall stone per biome (castle stone by default).
export const MASONRY = {
  default: {
    floor: [R('stone', 3), R('stone', 4), R('ink', 7), R('ink', 8)], // [mortar, base, alt, lit]
    floorMortar: R('stone', 3),
    wallTop: [R('stone', 1), R('stone', 2), R('stone', 3), R('stone', 4), R('stone', 5)],
    wallFace: [R('stone', 0), R('stone', 1), R('stone', 2), R('ink', 5), R('stone', 3)],
  },
  void: {
    floor: [R('unlight', 1), R('ink', 5), R('unlight', 2), R('ink', 6)],
    floorMortar: R('unlight', 1),
    wallTop: [R('ink', 1), R('ink', 2), R('ink', 3), R('unlight', 2), R('unlight', 3)],
    wallFace: [R('ink', 0), R('ink', 1), R('ink', 2), R('unlight', 1), R('ink', 3)],
  },
  tundra: {
    floor: [R('stone', 3), R('stone', 4), R('snow', 2), R('snow', 3)],
    floorMortar: R('stone', 3),
    wallTop: [R('stone', 2), R('snow', 2), R('snow', 3), R('snow', 4), R('snow', 5)],
    wallFace: [R('stone', 0), R('stone', 1), R('stone', 2), R('ink', 5), R('stone', 3)],
  },
};
