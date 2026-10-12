// The difficulty ladder: First Light (normal) → Dusk (dusk) → Nightfall (hard) →
// Black Sun (lunatic). Ids are save data; names come from difficulty.json.
import { describe, expect, it, vi } from 'vitest';
import {
  DIFFICULTY_IDS,
  DIFFICULTY_UNLOCKS,
  difficultyLockReason,
  difficultyRank,
  difficultyVictoryMilestone,
  isDifficultyAtLeast,
  resolveDifficultyMode,
  validateDifficultyConfig,
} from '../src/engine/DifficultyEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { victoryEndingKey } from '../src/engine/NarrativeDirector.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { generateChallenger } from '../src/engine/ColosseumEngine.js';
import { filterClassPoolByDifficulty } from '../src/utils/constants.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const modes = gameData.difficulty.modes;

describe('the ladder', () => {
  it('four rungs, easiest first, each named in the data', () => {
    expect(DIFFICULTY_IDS).toEqual(['normal', 'dusk', 'hard', 'lunatic']);
    expect(DIFFICULTY_IDS.map((id) => modes[id].label)).toEqual([
      'First Light',
      'Dusk',
      'Nightfall',
      'Black Sun',
    ]);
    expect(validateDifficultyConfig(gameData.difficulty)).toEqual({ valid: true, errors: [] });
    expect(validateMapTemplatesConfig(gameData.mapTemplates).valid).toBe(true);
  });

  it('where each road ends', () => {
    const last = (id) => resolveDifficultyMode(gameData.difficulty, id).modifiers.actsIncluded;
    expect(last('normal').at(-1)).toBe('finalBoss'); // the Lieutenant
    // Dusk goes on past the Emperor (Act IV) to the Lieutenant (the final act).
    expect(last('dusk')).toEqual(['act1', 'act2', 'act3', 'act4', 'finalBoss']);
    expect(last('hard').at(-1)).toBe('finalBoss'); // the Entity
    expect(last('lunatic').at(-1)).toBe('finalBoss');
    const boss = (id) =>
      gameData.enemies.bosses.finalBoss.filter((b) => b.difficultyFilter?.includes(id));
    expect(boss('normal').map((b) => b.name)).toEqual(['The Lieutenant']);
    expect(boss('dusk').map((b) => b.name)).toEqual(['The Lieutenant']);
    expect(boss('hard').map((b) => b.name)).toEqual(['The Entity']);
    expect(boss('lunatic').map((b) => b.name)).toEqual(['The Entity']);
  });

  it('meta currency climbs with the ladder: First Light below the base rate, each rung above it more', () => {
    const rates = DIFFICULTY_IDS.map((id) => modes[id].currencyMultiplier);
    expect(rates[0]).toBeLessThan(1);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    expect(modes.dusk.currencyMultiplier).toBeGreaterThan(1.1);
  });

  it('Dusk sits between First Light and Nightfall on every tuned number', () => {
    const between = [
      'enemyCountBonus',
      'enemyLevelBonus',
      'enemySkillChance',
      'enemyPoisonChance',
      'fogChanceBonus',
      'villageAmbushChance',
      'currencyMultiplier',
    ];
    for (const key of between) {
      expect(modes.dusk[key], key).toBeGreaterThanOrEqual(modes.normal[key]);
      expect(modes.dusk[key], key).toBeLessThanOrEqual(modes.hard[key]);
    }
    for (const key of ['goldMultiplier', 'xpMultiplier', 'growthBonusMultiplier']) {
      expect(modes.dusk[key], key).toBeLessThanOrEqual(modes.normal[key]);
      expect(modes.dusk[key], key).toBeGreaterThanOrEqual(modes.hard[key]);
    }
    const affix = gameData.affixes.config.difficultyGating;
    expect(affix.dusk.affixChance).toBeGreaterThan(affix.normal.affixChance);
    expect(affix.dusk.affixChance).toBeLessThan(affix.hard.affixChance);
    const par = gameData.turnBonus.difficultyParMultiplier;
    expect(par.dusk).toBeLessThan(par.normal);
    expect(par.dusk).toBeGreaterThan(par.hard);
  });

  it('rank and "at least" follow the ladder; unknown ids are never harder', () => {
    expect(DIFFICULTY_IDS.map(difficultyRank)).toEqual([0, 1, 2, 3]);
    expect(isDifficultyAtLeast('dusk', 'dusk')).toBe(true);
    expect(isDifficultyAtLeast('dusk', 'hard')).toBe(false);
    expect(isDifficultyAtLeast('lunatic', 'hard')).toBe(true);
    expect(isDifficultyAtLeast('normal', 'dusk')).toBe(false);
    expect(isDifficultyAtLeast('bogus', 'normal')).toBe(false);
  });
});

describe('what each rung does', () => {
  it('Dusk and harder see the Act IV enemy classes; First Light does not', () => {
    const pool = ['Fighter', 'Zombie', 'Dragon'];
    expect(filterClassPoolByDifficulty(pool, 'normal')).toEqual(['Fighter']);
    for (const id of ['dusk', 'hard', 'lunatic'])
      expect(filterClassPoolByDifficulty(pool, id)).toEqual(pool);
  });

  it('Dusk holds Dragons back until Act IV; Dragon Lord, Zombie and Revenant stay', () => {
    const pool = ['Fighter', 'Zombie', 'Revenant', 'Dragon', 'Dragon Lord'];
    const dusk = (act) =>
      filterClassPoolByDifficulty(pool, 'dusk', { act, difficulty: gameData.difficulty });
    for (const act of ['act1', 'act2', 'act3'])
      expect(dusk(act)).toEqual(['Fighter', 'Zombie', 'Revenant', 'Dragon Lord']);
    for (const act of ['act4', 'postAct', 'finalBoss']) expect(dusk(act)).toEqual(pool);
    // A gated class never leaks through an unknown act.
    expect(dusk(undefined)).not.toContain('Dragon');
    // Nightfall and Black Sun are unchanged: Dragons in Act III.
    for (const id of ['hard', 'lunatic'])
      expect(
        filterClassPoolByDifficulty(pool, id, { act: 'act3', difficulty: gameData.difficulty }),
      ).toEqual(pool);
  });

  it('Dusk Act III battles never field a Dragon; Nightfall ones do; Dusk Act IV fields Dragon Lords', () => {
    const count = (difficultyId, act, className) => {
      let total = 0;
      const original = Math.random;
      let seed = 11;
      Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      try {
        for (let i = 0; i < 60; i++)
          for (const objective of ['rout', 'seize'])
            total += generateBattle(
              { act, objective, difficultyId, row: 3 },
              gameData,
            ).enemySpawns.filter((s) => s.className === className).length;
      } finally {
        Math.random = original;
      }
      return total;
    };
    expect(count('dusk', 'act3', 'Dragon')).toBe(0);
    expect(count('hard', 'act3', 'Dragon')).toBeGreaterThan(0);
    expect(count('dusk', 'act4', 'Dragon Lord')).toBeGreaterThan(0);
  });

  it('Dusk arena challengers in Act III are never Dragons', () => {
    const tier = gameData.colosseum.arena.tiers.gold;
    let seed = 5;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const drawn = new Set();
    for (let i = 0; i < 400; i++) {
      const { unit } = generateChallenger(
        14,
        tier,
        'act3',
        gameData.enemies,
        gameData.classes,
        gameData.weapons,
        'dusk',
        gameData.colosseum,
        rng,
        gameData.difficulty,
      );
      drawn.add(unit.className);
    }
    expect(drawn.has('Dragon')).toBe(false);
    expect(drawn.has('Revenant')).toBe(true);
  });

  it('the class act gate must name real acts', () => {
    const broken = structuredClone(gameData.difficulty);
    broken.modes.dusk.enemyClassEarliestAct = { Dragon: 'act9' };
    expect(validateDifficultyConfig(broken).errors).toContain(
      'modes.dusk.enemyClassEarliestAct must map classes to act ids',
    );
  });

  it('a Dusk run can build Act IV battles', () => {
    for (const objective of ['rout', 'seize']) {
      const battle = generateBattle(
        { act: 'act4', objective, difficultyId: 'dusk', row: 2 },
        gameData,
      );
      expect(battle.enemySpawns.length).toBeGreaterThan(0);
    }
  });

  it('ballistas stay on Nightfall and Black Sun', () => {
    const ballistas = (difficultyId) => {
      let total = 0;
      const original = Math.random;
      let seed = 7;
      Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      try {
        for (let i = 0; i < 40; i++)
          total += (
            generateBattle({ act: 'act3', objective: 'seize', difficultyId, row: 2 }, gameData)
              .ballistas || []
          ).length;
      } finally {
        Math.random = original;
      }
      return total;
    };
    expect(ballistas('dusk')).toBe(0);
    expect(ballistas('normal')).toBe(0);
    expect(ballistas('hard')).toBeGreaterThan(0);
  });
});

describe('unlocks', () => {
  const has = (slot = [], anySlot = []) => ({
    slot: (m) => slot.includes(m),
    anySlot: (m) => anySlot.includes(m),
  });

  it('First Light is always open', () => {
    expect(difficultyLockReason('normal', has())).toBeNull();
  });

  it('a win on each rung opens the next', () => {
    expect(difficultyLockReason('dusk', has())).toBe('Win on First Light to unlock');
    expect(difficultyLockReason('dusk', has(['beatGame']))).toBeNull();
    expect(difficultyLockReason('hard', has(['beatGame']))).toBe('Win on Dusk to unlock');
    expect(difficultyLockReason('hard', has(['beatDusk']))).toBeNull();
    expect(difficultyLockReason('lunatic', has(['beatDusk']))).toBe('Win on Nightfall to unlock');
    expect(difficultyLockReason('lunatic', has(['beatHard']))).toBeNull();
  });

  it('an old Hard win (it ended at the Emperor) still opens Nightfall and Black Sun', () => {
    expect(difficultyLockReason('hard', has(['beatHard']))).toBeNull();
    expect(difficultyLockReason('lunatic', has(['beatHard']))).toBeNull();
  });

  it('Nightfall and Black Sun count a win on another slot; Dusk needs this one', () => {
    expect(difficultyLockReason('hard', has([], ['beatDusk']))).toBeNull();
    expect(difficultyLockReason('lunatic', has([], ['beatLunatic']))).toBeNull();
    expect(difficultyLockReason('dusk', has([], ['beatGame']))).not.toBeNull();
    expect(Object.keys(DIFFICULTY_UNLOCKS)).toEqual(['dusk', 'hard', 'lunatic']);
  });

  it('a victory records its rung', () => {
    expect(DIFFICULTY_IDS.map(difficultyVictoryMilestone)).toEqual([
      null,
      'beatDusk',
      'beatHard',
      'beatLunatic',
    ]);
    const rm = new RunManager(gameData);
    rm.startRun({ difficultyId: 'dusk' });
    rm.actIndex = 3;
    const meta = {
      addValor: vi.fn(),
      addSupply: vi.fn(),
      incrementRunsCompleted: vi.fn(),
      recordMilestone: vi.fn(),
      hasMilestone: vi.fn(() => false),
      recordRunEnd: vi.fn(),
    };
    rm.settleEndRunRewards(meta, 'victory');
    const earned = meta.recordMilestone.mock.calls.map(([m]) => m);
    expect(earned).toContain('beatDusk');
    expect(earned).toContain('beatGame');
    expect(earned).not.toContain('beatHard');
  });
});

describe('saves', () => {
  it('a Hard run saved before the ladder keeps its road: it still ends at the Emperor', () => {
    const rm = new RunManager(gameData);
    rm.startRun({ difficultyId: 'hard' });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.actSequence = ['act1', 'act2', 'act3', 'act4'];
    saved.difficultyModifiers = { ...saved.difficultyModifiers, actsIncluded: saved.actSequence };
    const restored = RunManager.fromJSON(saved, gameData);
    expect(restored.difficultyId).toBe('hard');
    expect(restored.actSequence).toEqual(['act1', 'act2', 'act3', 'act4']);
  });

  it('a new Nightfall run goes on to the Entity', () => {
    const rm = new RunManager(gameData);
    rm.startRun({ difficultyId: 'hard' });
    expect(rm.actSequence.at(-1)).toBe('finalBoss');
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), gameData);
    expect(restored.actSequence.at(-1)).toBe('finalBoss');
  });

  it('a new Dusk run goes on to the Lieutenant, and survives a save and load as Dusk', () => {
    const rm = new RunManager(gameData);
    rm.startRun({ difficultyId: 'dusk' });
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), gameData);
    expect(restored.difficultyId).toBe('dusk');
    expect(restored.actSequence).toEqual(['act1', 'act2', 'act3', 'act4', 'finalBoss']);
    expect(restored.difficultyModifiers.actsIncluded).toEqual(restored.actSequence);
  });

  // A run keeps the act list it started with: the live difficulty.json now lists the final act
  // for Dusk, and a load must not hand it to a run that began without it.
  describe('a Dusk run saved before Dusk went on to the Lieutenant', () => {
    const OLD_ROAD = ['act1', 'act2', 'act3', 'act4'];
    const oldDuskSave = ({ dropActSequence = false } = {}) => {
      const rm = new RunManager(gameData);
      rm.startRun({ difficultyId: 'dusk' });
      const saved = JSON.parse(JSON.stringify(rm.toJSON()));
      saved.actSequence = [...OLD_ROAD];
      saved.difficultyModifiers = { ...saved.difficultyModifiers, actsIncluded: [...OLD_ROAD] };
      if (dropActSequence) delete saved.actSequence;
      return saved;
    };

    it('keeps its four acts, from either copy of the list', () => {
      for (const dropActSequence of [false, true]) {
        const restored = RunManager.fromJSON(oldDuskSave({ dropActSequence }), gameData);
        expect(restored.difficultyId).toBe('dusk');
        expect(restored.actSequence).toEqual(OLD_ROAD);
        expect(restored.difficultyModifiers.actsIncluded).toEqual(OLD_ROAD);
      }
    });

    it('still ends at the Emperor: the run completes with Act IV, and the ending is his', () => {
      const restored = RunManager.fromJSON(oldDuskSave(), gameData);
      restored.actIndex = 3;
      expect(restored.isRunComplete()).toBe(false);
      restored.nodeMap.nodes.find((n) => n.id === restored.nodeMap.bossNodeId).completed = true;
      expect(restored.isRunComplete()).toBe(true);
      expect(victoryEndingKey(restored, gameData)).toBe('victory_emperor');
    });

    it('a new Dusk run is not complete at the Emperor: Act V is still ahead', () => {
      const rm = new RunManager(gameData);
      rm.startRun({ difficultyId: 'dusk' });
      while (rm.currentAct !== 'act4') rm.advanceAct();
      rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId).completed = true;
      expect(rm.isActComplete()).toBe(true);
      expect(rm.isRunComplete()).toBe(false);
      rm.advanceAct();
      expect(rm.currentAct).toBe('finalBoss');
    });
  });
});

describe('the Lieutenant is the finale on First Light and Dusk', () => {
  const finalBossDef = (difficultyId) => {
    const defs = gameData.enemies.bosses.finalBoss;
    const filtered = defs.filter(
      (b) => !b.difficultyFilter || b.difficultyFilter.includes(difficultyId),
    );
    return filtered.map((b) => b.name);
  };

  it('both rungs have exactly one candidate, so the legacy random pick can only be him', () => {
    expect(finalBossDef('normal')).toEqual(['The Lieutenant']);
    expect(finalBossDef('dusk')).toEqual(['The Lieutenant']);
  });

  it('a generated final-act seize map on Dusk seats the Lieutenant, never the Entity', () => {
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const battle = generateBattle(
        { act: 'finalBoss', objective: 'seize', difficultyId: 'dusk', isBoss: true, row: 1 },
        gameData,
      );
      for (const spawn of battle.enemySpawns) if (spawn.isBoss) seen.add(spawn.name);
    }
    expect([...seen]).toEqual(['The Lieutenant']);
  });

  it('the run-complete ending of each road ending there is the Lieutenant\u2019s', () => {
    for (const difficultyId of ['normal', 'dusk']) {
      const rm = new RunManager(gameData);
      rm.startRun({ difficultyId });
      expect(victoryEndingKey(rm, gameData), difficultyId).toBe('victory_lieutenant');
    }
    for (const difficultyId of ['hard', 'lunatic']) {
      const rm = new RunManager(gameData);
      rm.startRun({ difficultyId });
      expect(victoryEndingKey(rm, gameData), difficultyId).toBe('victory_entity');
    }
  });
});
