// Real layouts from the game's own MapGenerator, with fixed seeds.
// Math.random is swapped for a seeded PRNG only for the duration of the call,
// exactly like tests/MapGenerator.test.js does.
import { generateBattle } from '../../../../src/engine/MapGenerator.js';
import { mulberry32 } from '../../../../src/art/terrain/noise.js';
import { loadGameData } from '../../../../tests/testData.js';

let data = null;
export function gameData() {
  return (data ||= loadGameData());
}

// The study set (one map per biome family) plus two production checks.
// Seeds were picked by scanning for layouts that exercise the most terrain
// types / transitions. `crop` is the top-left cell of the 16x10 phone view.
export const STUDY_MAPS = [
  {
    key: 'river',
    label: 'Grassland river crossing',
    params: { act: 'act3', objective: 'rout', templateId: 'river_crossing', hasVillage: true },
    seed: 3,
    crop: [1, 1],
  },
  {
    key: 'chokepoint',
    label: 'Grassland ruins chokepoint (walls + mountains)',
    params: { act: 'act3', objective: 'rout', templateId: 'chokepoint' },
    seed: 4,
    crop: [1, 0],
  },
  {
    key: 'castle',
    label: 'Castle great hall',
    params: { act: 'act3', objective: 'seize', templateId: 'great_hall' },
    seed: 1,
    crop: [2, 1],
  },
  {
    key: 'mire',
    label: 'Swamp mire crossing (acid hazards)',
    params: { act: 'act3', objective: 'rout', templateId: 'mire_crossing' },
    seed: 2,
    crop: [1, 0],
  },
  {
    key: 'caldera',
    label: 'Volcano caldera (lava cracks)',
    params: { act: 'act4', objective: 'rout', templateId: 'caldera' },
    seed: 1,
    crop: [1, 2],
  },
  {
    key: 'frozen',
    label: 'Tundra glacier fortress (ice)',
    params: { act: 'act4', objective: 'seize', templateId: 'glacier_fortress' },
    seed: 1,
    crop: [1, 1],
  },
  {
    key: 'ambush',
    label: 'Grassland forest ambush (dense woods)',
    params: { act: 'act2', objective: 'rout', templateId: 'forest_ambush' },
    seed: 5,
    crop: [0, 0],
    extra: true,
  },
  {
    key: 'ruins',
    label: 'Castle ruins (pillars, broken walls)',
    params: { act: 'act3', objective: 'rout', templateId: 'castle_ruins' },
    seed: 2,
    crop: [1, 1],
    extra: true,
  },
];

export function generateStudyMap(spec) {
  const d = gameData();
  const original = Math.random;
  Math.random = mulberry32(spec.seed);
  let config;
  try {
    config = generateBattle({ difficultyId: 'hard', ...spec.params }, d);
  } finally {
    Math.random = original;
  }
  const names = config.mapLayout.map((row) => row.map((i) => d.terrain[i].name));
  return {
    ...spec,
    names,
    mapLayout: config.mapLayout,
    cols: config.cols,
    rows: config.rows,
    biome: config.biome || 'grassland',
    playerSpawns: config.playerSpawns || [],
    enemySpawns: config.enemySpawns || [],
    templateId: config.templateId,
  };
}

/** Terrain seed used for a study map (kept from the study for comparability). */
export function terrainSeed(spec) {
  return spec.seed * 1000 + 7;
}

export function terrainNames() {
  return gameData().terrain.map((t) => t.name);
}
