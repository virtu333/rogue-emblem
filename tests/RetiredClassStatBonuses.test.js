// difficulty.json `classStatBonuses` (Nightfall Fighter/Archer +1, Black Sun +2) never reached an
// enemy: the run snapshot read it as a number and fell back to {}. It is retired. These tests
// hold that the data and the cards no longer carry it, and that a run saved with the key in its
// difficulty snapshot loads and fights exactly as one saved without it.
import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_DEFAULTS,
  DIFFICULTY_IDS,
  generateModifierSummary,
  validateDifficultyConfig,
} from '../src/engine/DifficultyEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import {
  applyEnemyDifficultyModifiers,
  createEnemyUnit,
  enemyDifficultyConfigFromParams,
} from '../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
const node = (act) => ({
  id: `${act}_r2`,
  type: 'battle',
  row: 2,
  battleParams: { act, objective: 'rout', row: 2 },
});

function savedRun(difficultyId) {
  const rm = new RunManager(data);
  rm.startRun({ difficultyId });
  return JSON.parse(JSON.stringify(rm.toJSON()));
}

// An enemy built the way the scene builds it, on a pinned stream.
function enemyFor(className, params, seed) {
  installSeed(seed);
  try {
    const config = enemyDifficultyConfigFromParams(params);
    return createEnemyUnit(cls(className), 6, data.weapons, config, data.skills, params.act);
  } finally {
    restoreMathRandom();
  }
}

describe('the retired classStatBonuses config', () => {
  it('is gone from every rung, the defaults and the validator', () => {
    for (const id of DIFFICULTY_IDS) {
      expect(data.difficulty.modes[id]).not.toHaveProperty('classStatBonuses');
    }
    expect(DIFFICULTY_DEFAULTS).not.toHaveProperty('classStatBonuses');
    expect(validateDifficultyConfig(data.difficulty).valid).toBe(true);
  });

  it('leaves no per-class line on any difficulty card', () => {
    for (const id of DIFFICULTY_IDS) {
      const lines = generateModifierSummary(data.difficulty.modes[id]);
      expect(lines.filter((l) => /^Enemy [A-Z][a-z]+ stats/.test(l))).toEqual([]);
      expect(lines.every((l) => l.trim().length > 0 && !/[,;:-]\s*$/.test(l))).toBe(true);
    }
    // The flat bonus the old line sat beside is still advertised on the rungs that apply it.
    expect(generateModifierSummary(data.difficulty.modes.hard)).toContain('Enemy stats +1');
    expect(generateModifierSummary(data.difficulty.modes.lunatic)).toContain('Enemy stats +2');
  });

  it('ignores a stale key in a difficulty config object', () => {
    const fighter = () => ({
      className: 'Fighter',
      stats: { HP: 20, STR: 5, MAG: 1, SKL: 4, SPD: 4, DEF: 3, RES: 2, LCK: 2, MOV: 5 },
      currentHP: 20,
    });
    const plain = applyEnemyDifficultyModifiers(fighter(), { multiplier: 1, enemyStatBonus: 1 });
    const stale = applyEnemyDifficultyModifiers(fighter(), {
      multiplier: 1,
      enemyStatBonus: 1,
      classStatBonuses: { Fighter: 5 },
    });
    expect(stale.stats).toEqual(plain.stats);
    // Independent expectation: the flat bonus alone, HP doubled, MOV untouched.
    expect(stale.stats).toEqual({
      HP: 22,
      STR: 6,
      MAG: 2,
      SKL: 5,
      SPD: 5,
      DEF: 4,
      RES: 3,
      LCK: 3,
      MOV: 5,
    });
    expect(stale.currentHP).toBe(22);
  });
});

describe('a run saved with classStatBonuses in its difficulty snapshot', () => {
  it.each(['hard', 'lunatic'])('%s loads and fights exactly as one saved without', (id) => {
    const without = savedRun(id);
    const withKey = structuredClone(without);
    withKey.difficultyModifiers.classStatBonuses = { Fighter: 3, Archer: 3 };
    // A fresh save no longer carries the key at all.
    expect(without.difficultyModifiers).not.toHaveProperty('classStatBonuses');

    const plain = RunManager.fromJSON(without, data);
    const old = RunManager.fromJSON(withKey, data);

    for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
      const a = plain.getBattleParams(node(act));
      const b = old.getBattleParams(node(act));
      expect(b).toEqual(a);
      expect(b).not.toHaveProperty('classStatBonuses');
      expect(enemyDifficultyConfigFromParams(b)).toEqual(enemyDifficultyConfigFromParams(a));
      expect(enemyDifficultyConfigFromParams(b)).not.toHaveProperty('classStatBonuses');

      for (const className of ['Fighter', 'Archer', 'Mage']) {
        const x = enemyFor(className, a, 77);
        const y = enemyFor(className, b, 77);
        expect(y.stats).toEqual(x.stats);
        expect(y.currentHP).toBe(x.currentHP);
        // Independent expectation: the same unit with no difficulty plus the flat bonus.
        const base = enemyFor(className, { ...a, enemyStatBonus: 0, difficultyMod: 1 }, 77);
        const bonus = Math.trunc(a.enemyStatBonus || 0);
        const mult = a.difficultyMod || 1;
        if (mult === 1) {
          for (const [stat, value] of Object.entries(base.stats)) {
            const expected = stat === 'MOV' ? value : value + (stat === 'HP' ? bonus * 2 : bonus);
            expect(y.stats[stat]).toBe(expected);
          }
        }
      }
    }
  });

  it('generates the same map and enemies', () => {
    const without = savedRun('lunatic');
    const withKey = structuredClone(without);
    withKey.difficultyModifiers.classStatBonuses = { Fighter: 3, Archer: 3 };
    const build = (save) => {
      const rm = RunManager.fromJSON(structuredClone(save), data);
      const params = { ...rm.getBattleParams(node('act2')), deployCount: 3 };
      installSeed(31);
      try {
        return generateBattle(params, data);
      } finally {
        restoreMathRandom();
      }
    };
    expect(build(withKey)).toEqual(build(without));
  });

  it('keeps the stale key harmlessly through another save', () => {
    const withKey = savedRun('hard');
    withKey.difficultyModifiers.classStatBonuses = { Fighter: 3 };
    const again = JSON.parse(JSON.stringify(RunManager.fromJSON(withKey, data).toJSON()));
    const reloaded = RunManager.fromJSON(again, data);
    expect(reloaded.getBattleParams(node('act1'))).toEqual(
      RunManager.fromJSON(savedRun('hard'), data).getBattleParams(node('act1')),
    );
  });
});
