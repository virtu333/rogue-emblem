// Encounter groups draw nothing (docs/specs/large-maps/02-encounters-and-pacing.md §6): a seeded
// map is the same map with or without them. 200 maps per objective across the four rungs and
// the four acts; every field but the encounter fields (`encounterVersion`, `encounterGroups`,
// each spawn's `encounterGroupId`) hashes to the digest frozen before encounter groups existed.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const ACTS = ['act1', 'act2', 'act3', 'act4'];
const MAPS = 200;

// Frozen from the generator as it stood before PR 2.1 (sha256 over the maps in order).
const FROZEN = {
  rout: '6e2423bf4c4b71c142e65a5e692d7362366a43bebf7ce67f4839a847653b8b88',
  seize: '9e2ec0049599dd5816a4369560c3c002d6800f67e40eb874aba93047b983c332',
  escape: '584744d54363131430b62632ca98b00a52034168f4498f68da609ff2429d0e2f',
};

function paramsFor(objective, seed) {
  const difficultyId = RUNGS[seed % RUNGS.length];
  const act = ACTS[Math.floor(seed / RUNGS.length) % ACTS.length];
  const m = resolveDifficultyMode(data.difficulty, difficultyId).modifiers;
  return {
    act,
    objective,
    deployCount: 4 + (seed % 3),
    difficultyId,
    holdShare: m.holdShare ?? null,
    routLadder: m.routLadder ?? null,
    objectiveParOffset: m.objectiveParOffset ?? null,
    battleSeed: 7000 + seed,
  };
}

function withoutEncounterFields(config) {
  const { encounterVersion, encounterGroups, ...rest } = config;
  return {
    ...rest,
    enemySpawns: (rest.enemySpawns || []).map(({ encounterGroupId, ...spawn }) => spawn),
  };
}

export function digestFor(objective, strip = withoutEncounterFields) {
  const hash = createHash('sha256');
  let groups = 0;
  for (let seed = 0; seed < MAPS; seed++) {
    const config = generateSeededBattle(paramsFor(objective, seed), data, 9000 + seed);
    groups += config.encounterGroups?.length || 0;
    hash.update(JSON.stringify(strip(config)));
    hash.update('\n');
  }
  return { digest: hash.digest('hex'), groups };
}

describe('encounter groups draw nothing at generation', () => {
  for (const objective of Object.keys(FROZEN)) {
    it(`${objective}: ${MAPS} seeded maps are the maps generated before groups existed`, () => {
      expect(digestFor(objective).digest).toBe(FROZEN[objective]);
    }, 120_000);
  }
});
