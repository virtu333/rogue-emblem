// Property/fuzz test for MapGenerator: generate the full act × objective ×
// difficulty × seed matrix and assert every produced battle config passes the
// validateBattleConfig output assertion. This is the safety net that keeps a
// silently-broken (unwinnable / out-of-bounds / disconnected) battle from ever
// getting locked into a save — see maps-review-fixes spec Phase 2.1.
import { describe, it, expect } from 'vitest';
import { generateBattle, validateBattleConfig } from '../src/engine/MapGenerator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const mapTemplates = data.mapTemplates;

const ACTS = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];
const OBJECTIVES = ['rout', 'seize', 'escape'];
const DIFFICULTIES = ['normal', 'hard', 'lunatic'];
const SEEDS_PER_COMBO = 25;

// A combo is generatable when at least one template of that objective is allowed
// for the act, honoring the bossOnly gate (bossOnly templates need isBoss).
function hasTemplate(objective, act, isBoss) {
  const pool = mapTemplates[objective] || [];
  return pool.some(
    (tpl) => (!Array.isArray(tpl.acts) || tpl.acts.includes(act)) && (isBoss || !tpl.bossOnly),
  );
}

const VARIANTS = [
  { label: 'standard', params: {} },
  { label: 'boss', params: { isBoss: true } },
  { label: 'recruit', params: { isRecruitBattle: true } },
  { label: 'caravan', params: { hasCaravan: true } },
];

describe('MapGenerator fuzz — validateBattleConfig over the full matrix', () => {
  it('produces zero violations across acts × objectives × difficulties × seeds', () => {
    let generated = 0;
    const failures = [];

    let seedCounter = 1;
    for (const act of ACTS) {
      const deployCount = DEPLOY_LIMITS[act]?.max || 4;
      for (const objective of OBJECTIVES) {
        for (const difficultyId of DIFFICULTIES) {
          for (const variant of VARIANTS) {
            const isBoss = variant.params.isBoss === true;
            if (!hasTemplate(objective, act, isBoss)) continue;

            for (let i = 0; i < SEEDS_PER_COMBO; i++) {
              const seed = seedCounter++;
              installSeed(seed);
              let config;
              try {
                config = generateBattle(
                  {
                    act,
                    objective,
                    difficultyId,
                    deployCount,
                    ...variant.params,
                  },
                  data,
                );
              } catch (err) {
                restoreMathRandom();
                failures.push(
                  `${objective}/${act}/${difficultyId}/${variant.label} seed ${seed} threw: ${err?.message || err}`,
                );
                continue;
              }
              restoreMathRandom();
              generated += 1;

              const violations = validateBattleConfig(config, data, {
                expectedPlayerSpawns: deployCount,
              });
              if (violations.length > 0) {
                failures.push(
                  `${objective}/${act}/${difficultyId}/${variant.label} (template ${config.templateId}) seed ${seed}:\n    ${violations.join('\n    ')}`,
                );
              }
            }
          }
        }
      }
    }

    expect(generated).toBeGreaterThan(500);
    expect(failures, `\n${failures.slice(0, 40).join('\n')}`).toEqual([]);
    // Explicit timeout: the caravan variant grew the matrix by a third, and
    // under full-suite parallel load this run brushes the 5s default.
  }, 20000);
});
