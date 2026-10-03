// Rung-driven enemy scaling that the 2026-10-02 Dusk review found missing:
// boss levels per rung (difficulty.json `bossLevelBonus`), the per-act promoted share
// of a map's enemies (enemies.json `promotedShare`) and the advertised enemy skill
// chance (difficulty.json `enemySkillChance`).
import { describe, expect, it } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import {
  createEnemyUnit,
  createPromotedEnemyUnit,
  enemyDifficultyConfigFromParams,
} from '../src/engine/UnitManager.js';
import {
  generateModifierSummary,
  resolveDifficultyMode,
  validateDifficultyConfig,
} from '../src/engine/DifficultyEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { DEFAULT_ENEMY_PROMOTED_SHARE } from '../src/utils/constants.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const COMBAT_SKILLS = ['sol', 'luna', 'vantage', 'wrath', 'adept', 'guard'];

function withSeed(seed, fn) {
  installSeed(seed);
  try {
    return fn();
  } finally {
    restoreMathRandom();
  }
}

function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const bossDef = (act, name) => data.enemies.bosses[act].find((b) => b.name === name);
const isPromoted = (className) =>
  data.classes.find((c) => c.name === className)?.tier === 'promoted';

describe('boss level bonus', () => {
  it('raises every act boss by the bonus and leaves the rest of the map alone', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      for (let seed = 1; seed <= 6; seed++) {
        const params = { act, objective: 'seize', isBoss: true, deployCount: 6 };
        const plain = withSeed(seed, () => generateBattle(params, data));
        const raised = withSeed(seed, () => generateBattle({ ...params, bossLevelBonus: 2 }, data));
        const boss = raised.enemySpawns.find((s) => s.isBoss);
        expect(boss.level).toBe(bossDef(act, boss.name).level + 2);
        const strip = (spawns) => spawns.map((s) => ({ ...s, level: s.isBoss ? 0 : s.level }));
        expect(strip(raised.enemySpawns)).toEqual(strip(plain.enemySpawns));
        expect(raised.mapLayout).toEqual(plain.mapLayout);
      }
    }
  });

  it('does not raise elite captains, which already follow the rung-adjusted level range', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const params = { act: 'act2', objective: 'seize', isElite: true, deployCount: 5 };
      const plain = withSeed(seed, () => generateBattle(params, data));
      const raised = withSeed(seed, () => generateBattle({ ...params, bossLevelBonus: 2 }, data));
      expect(raised.enemySpawns).toEqual(plain.enemySpawns);
    }
  });

  it('is +2 on Dusk only, and reaches the battle params', () => {
    const bonus = Object.fromEntries(
      ['normal', 'dusk', 'hard', 'lunatic'].map((id) => [
        id,
        resolveDifficultyMode(data.difficulty, id).modifiers.bossLevelBonus,
      ]),
    );
    expect(bonus).toEqual({ normal: 0, dusk: 2, hard: 0, lunatic: 0 });

    const node = { id: 'n1', type: 'boss', battleParams: { act: 'act4', objective: 'seize' } };
    const dusk = new RunManager(data);
    dusk.startRun({ difficultyId: 'dusk' });
    expect(dusk.getBattleParams(node)).toMatchObject({ bossLevelBonus: 2, enemySkillChance: 0.1 });
    const firstLight = new RunManager(data);
    firstLight.startRun({ difficultyId: 'normal' });
    expect(firstLight.getBattleParams(node)).toMatchObject({
      bossLevelBonus: 0,
      enemySkillChance: 0,
    });
  });

  it('a run saved before the bonus keeps its bosses', () => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'dusk' });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.difficultyModifiers.bossLevelBonus;
    const restored = RunManager.fromJSON(saved, data);
    expect(restored.getDifficultyModifier('bossLevelBonus', 0)).toBe(0);
  });

  it('a raised Emperor is stronger than the First Light one from the same rolls', () => {
    const emperor = bossDef('act4', 'The Emperor');
    const general = data.classes.find((c) => c.name === emperor.className);
    const build = (level) =>
      withSeed(7, () =>
        createPromotedEnemyUnit(general, level, data.weapons, 1.0, null, 'act4', data.classes),
      );
    const total = (u) => Object.values(u.stats).reduce((s, v) => s + v, 0);
    expect(total(build(emperor.level + 2))).toBeGreaterThan(total(build(emperor.level)));
  });

  it('must be a non-negative whole number when set', () => {
    const withBonus = (value) => {
      const config = structuredClone(data.difficulty);
      config.modes.dusk.bossLevelBonus = value;
      return validateDifficultyConfig(config).valid;
    };
    expect(withBonus(2)).toBe(true);
    expect(withBonus(undefined)).toBe(true);
    expect(withBonus(-1)).toBe(false);
    expect(withBonus(1.5)).toBe(false);
  });

  it('shows on the difficulty card', () => {
    expect(generateModifierSummary(data.difficulty.modes.dusk)).toContain('Boss levels +2');
    expect(generateModifierSummary(data.difficulty.modes.normal)).not.toContain('Boss levels +2');
  });
});

describe('promoted share', () => {
  function promotedFraction(enemies, seeds) {
    let promoted = 0;
    let total = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', deployCount: 6 }, { ...data, enemies }),
      );
      for (const s of config.enemySpawns) {
        total++;
        if (isPromoted(s.className)) promoted++;
      }
    }
    return promoted / total;
  }

  const withAct4Share = (share) => {
    const pools = structuredClone(data.enemies.pools);
    if (share === undefined) delete pools.act4.promotedShare;
    else pools.act4.promotedShare = share;
    return { ...data.enemies, pools };
  };

  it('Act IV draws more promoted enemies than Act III', () => {
    expect(data.enemies.pools.act3.promotedShare).toBe(0.3);
    expect(data.enemies.pools.act4.promotedShare).toBeGreaterThan(
      data.enemies.pools.act3.promotedShare,
    );
  });

  it('a pool without a share keeps the old 30% and the same maps', () => {
    expect(DEFAULT_ENEMY_PROMOTED_SHARE).toBe(0.3);
    for (let seed = 1; seed <= 8; seed++) {
      const params = { act: 'act4', objective: 'rout', deployCount: 6 };
      const unset = withSeed(seed, () =>
        generateBattle(params, { ...data, enemies: withAct4Share(undefined) }),
      );
      const explicit = withSeed(seed, () =>
        generateBattle(params, { ...data, enemies: withAct4Share(0.3) }),
      );
      expect(unset.enemySpawns).toEqual(explicit.enemySpawns);
    }
  });

  it('the share sets how many of a map’s enemies are promoted', () => {
    const none = promotedFraction(withAct4Share(0), 60);
    const low = promotedFraction(withAct4Share(0.3), 60);
    const high = promotedFraction(withAct4Share(0.6), 60);
    // Anchored and themed slots draw from both pools, so a share of 0 is not quite 0.
    expect(none).toBeLessThan(0.15);
    expect(high - low).toBeGreaterThan(0.2);
    expect(high - low).toBeLessThan(0.4);
  });
});

describe('enemy skill chance', () => {
  it('Black Sun adds 30%: above Nightfall’s 20%, below the old 40%, and the card says so', () => {
    const chance = Object.fromEntries(
      ['normal', 'dusk', 'hard', 'lunatic'].map((id) => [
        id,
        resolveDifficultyMode(data.difficulty, id).modifiers.enemySkillChance,
      ]),
    );
    expect(chance.lunatic).toBe(0.3);
    expect(chance.lunatic).toBeGreaterThan(chance.hard);
    expect(generateModifierSummary(data.difficulty.modes.lunatic)).toContain(
      '+30% enemy skill chance',
    );
  });

  const fighter = data.classes.find((c) => c.name === 'Fighter');
  const hasCombatSkill = (u) => (u.skills || []).some((s) => COMBAT_SKILLS.includes(s));
  // Every roll lands at 0.3: above Act II's 25% skill chance, under it plus Dusk's 10%.
  const build = (params) =>
    withRandom(0.3, () =>
      createEnemyUnit(
        fighter,
        8,
        data.weapons,
        enemyDifficultyConfigFromParams(params),
        data.skills,
        'act2',
      ),
    );

  it('reads the rung’s enemySkillChance from the battle params', () => {
    expect(enemyDifficultyConfigFromParams({ enemySkillChance: 0.1 }).skillChanceBonus).toBe(0.1);
    expect(enemyDifficultyConfigFromParams({}).skillChanceBonus).toBe(0);
  });

  it('is added to the act’s chance', () => {
    expect(hasCombatSkill(build({}))).toBe(false);
    expect(hasCombatSkill(build({ enemySkillChance: 0.1 }))).toBe(true);
  });

  it('promoted enemies roll with it too', () => {
    const hero = data.classes.find((c) => c.name === 'Hero');
    const make = (bonus) =>
      withRandom(0.65, () =>
        createPromotedEnemyUnit(
          hero,
          15,
          data.weapons,
          enemyDifficultyConfigFromParams({ enemySkillChance: bonus }),
          data.skills,
          'act4',
          data.classes,
        ),
      );
    // Act IV's chance is 60%: a 0.65 roll misses it, and hits it with +10%.
    expect(hasCombatSkill(make(0))).toBe(false);
    expect(hasCombatSkill(make(0.1))).toBe(true);
  });

  it('caps the chance at 100%', () => {
    const unit = withRandom(0.999, () =>
      createEnemyUnit(
        fighter,
        8,
        data.weapons,
        enemyDifficultyConfigFromParams({ enemySkillChance: 0.9 }),
        data.skills,
        'act2',
      ),
    );
    expect(hasCombatSkill(unit)).toBe(true);
  });
});
