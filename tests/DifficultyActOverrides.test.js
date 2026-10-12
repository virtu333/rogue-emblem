// Per-act difficulty overrides (difficulty.json `actOverrides`): Black Sun eases its Act I
// (enemy stats +1 in place of +2, enemies scaled as if you field 5 in place of 6, +1 extra
// enemy in place of +2) and leaves every later act and every other rung as it was.
import { describe, expect, it } from 'vitest';
import {
  ACT_OVERRIDE_KEYS,
  DIFFICULTY_IDS,
  actOverrideFor,
  generateModifierSummary,
  validateDifficultyConfig,
} from '../src/engine/DifficultyEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const node = (act, row = 2) => ({
  id: `${act}_r${row}`,
  type: 'battle',
  row,
  battleParams: { act, objective: 'rout', row },
});
const LEVERS = [
  'enemyStatBonus',
  'enemyCountBonus',
  'enemyCountBase',
  'enemyLevelBonus',
  'bossLevelBonus',
  'enemySkillChance',
  'enemyPoisonChance',
];
const leversOf = (params) => Object.fromEntries(LEVERS.map((k) => [k, params[k]]));

function run(difficultyId) {
  const rm = new RunManager(data);
  rm.startRun({ difficultyId });
  return rm;
}

describe('Black Sun Act I', () => {
  it('reaches the battle with the eased values, and Act II onward with the rung’s own', () => {
    const rm = run('lunatic');
    expect(leversOf(rm.getBattleParams(node('act1')))).toEqual({
      enemyStatBonus: 1,
      enemyCountBonus: 1,
      enemyCountBase: 5,
      enemyLevelBonus: 2,
      bossLevelBonus: 4,
      enemySkillChance: 0.4,
      enemyPoisonChance: 0.2,
    });
    for (const act of ['act2', 'act3', 'act4', 'finalBoss']) {
      expect(leversOf(rm.getBattleParams(node(act)))).toEqual({
        enemyStatBonus: 2,
        enemyCountBonus: 2,
        enemyCountBase: 6,
        enemyLevelBonus: 2,
        bossLevelBonus: 4,
        enemySkillChance: 0.4,
        enemyPoisonChance: 0.2,
      });
    }
  });

  it('is still at least as hard as Nightfall’s Act I on every lever', () => {
    const black = leversOf(run('lunatic').getBattleParams(node('act1')));
    const night = leversOf(run('hard').getBattleParams(node('act1')));
    for (const key of LEVERS) expect(black[key]).toBeGreaterThanOrEqual(night[key]);
    expect(black.enemyCountBase).toBeGreaterThan(night.enemyCountBase);
  });

  it('fields fewer foes on its first maps than before, and more than Nightfall', () => {
    // Row 0 of Act I with Edric and Sera: Black Sun 5 + 1 (was 6 + 2), Nightfall 4 + 1.
    const count = (difficultyId, patch = {}) => {
      const params = {
        ...run(difficultyId).getBattleParams(node('act1', 0)),
        ...patch,
        deployCount: 2,
      };
      installSeed(11);
      try {
        return generateBattle(params, data).enemySpawns.length;
      } finally {
        restoreMathRandom();
      }
    };
    expect(count('lunatic')).toBe(6);
    expect(count('lunatic', { enemyCountBase: 6, enemyCountBonus: 2 })).toBe(8);
    expect(count('hard')).toBe(5);
  });

  it('leaves the other rungs’ battles exactly as the rung sets them', () => {
    for (const id of ['normal', 'dusk', 'hard']) {
      const mode = data.difficulty.modes[id];
      expect(mode.actOverrides ?? null).toBeNull();
      const params = run(id).getBattleParams(node('act1'));
      for (const key of LEVERS) expect(params[key]).toBe(mode[key]);
    }
  });

  it('a run saved before the override keeps the Act I it started with', () => {
    const rm = run('lunatic');
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(saved.difficultyModifiers.actOverrides.act1.enemyStatBonus).toBe(1);
    delete saved.difficultyModifiers.actOverrides;
    const restored = RunManager.fromJSON(saved, data);
    expect(leversOf(restored.getBattleParams(node('act1')))).toMatchObject({
      enemyStatBonus: 2,
      enemyCountBonus: 2,
      enemyCountBase: 6,
    });
    // A run saved with it keeps it through a save and load.
    const kept = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(kept.getBattleParams(node('act1')).enemyStatBonus).toBe(1);
  });

  it('says so on the difficulty card', () => {
    const lines = generateModifierSummary(data.difficulty.modes.lunatic);
    expect(lines).toContain('Enemy stats +2');
    expect(lines).toContain(
      'Act I eases in: enemy stats +1, +1 extra enemy per map, enemies scale as if you field at least 5 units',
    );
    for (const id of ['normal', 'dusk', 'hard'])
      expect(generateModifierSummary(data.difficulty.modes[id]).join('\n')).not.toMatch(/eases in/);
  });

  it('sits right under the enemy lines it qualifies', () => {
    const lines = generateModifierSummary(data.difficulty.modes.lunatic);
    const actOne = lines.findIndex((l) => l.startsWith('Act I eases in'));
    expect(lines[actOne - 1]).toBe('Enemies scale as if you field at least 6 units');
    expect(actOne).toBeGreaterThan(lines.indexOf('Enemy stats +2'));
  });

  it('never says "eases in" for an override that raises a value', () => {
    const mode = {
      ...data.difficulty.modes.lunatic,
      actOverrides: { act2: { enemyStatBonus: 3 } },
    };
    expect(generateModifierSummary(mode)).toContain('Act II: enemy stats +3');
  });
});

describe('actOverrideFor', () => {
  const modifiers = { enemyStatBonus: 2, actOverrides: { act1: { enemyStatBonus: 0 } } };

  it('returns the act’s value (zero included) and nothing for another act or key', () => {
    expect(actOverrideFor(modifiers, 'enemyStatBonus', 'act1')).toBe(0);
    expect(actOverrideFor(modifiers, 'enemyStatBonus', 'act2')).toBeUndefined();
    expect(
      actOverrideFor({ actOverrides: { act1: { xpMultiplier: 2 } } }, 'xpMultiplier', 'act1'),
    ).toBeUndefined();
    expect(actOverrideFor(null, 'enemyStatBonus', 'act1')).toBeUndefined();
  });
});

describe('validation', () => {
  const withOverrides = (actOverrides) => {
    const config = structuredClone(data.difficulty);
    config.modes.lunatic.actOverrides = actOverrides;
    return validateDifficultyConfig(config);
  };

  it('accepts the shipped data and an absent or null block', () => {
    expect(validateDifficultyConfig(data.difficulty)).toEqual({ valid: true, errors: [] });
    expect(withOverrides(undefined).valid).toBe(true);
    expect(withOverrides(null).valid).toBe(true);
  });

  it('refuses an unknown act, an unknown key and an out-of-range value', () => {
    expect(withOverrides({ act9: { enemyStatBonus: 1 } }).valid).toBe(false);
    expect(withOverrides({ act1: { xpMultiplier: 1 } }).valid).toBe(false);
    expect(withOverrides({ act1: { enemyStatBonus: -1 } }).valid).toBe(false);
    expect(withOverrides({ act1: { enemyCountBase: 4.5 } }).valid).toBe(false);
    expect(withOverrides({ act1: { enemySkillChance: 1.5 } }).valid).toBe(false);
    expect(withOverrides({ act1: 3 }).valid).toBe(false);
    expect(withOverrides([]).valid).toBe(false);
  });

  it('lists only levers getBattleParams reads, each one rung-wide too', () => {
    const lunatic = data.difficulty.modes.lunatic;
    for (const key of Object.keys(ACT_OVERRIDE_KEYS))
      expect(Number.isFinite(lunatic[key])).toBe(true);
    expect(DIFFICULTY_IDS).toContain('lunatic');
  });
});
