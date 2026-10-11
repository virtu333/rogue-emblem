// Elite seize battles hold a captain scaled to the node, never the act's boss
// (playtest 2026-09-28: a mid-act elite fielded Act III's L17 Blade Lord, and the
// same boss could wait again at the act's end).
//
// Captain levels (the second describe): a captain's level is a spawn level like every foe's,
// which createPromotedEnemyUnit reads as the whole level (the base class to 12, the rest past
// promotion). Ways this goes wrong:
//   - a promoted captain's level is read on the recruits' scale (less 10 promotion levels), so it
//     spawns under its own escort (an Act III node topping out at 14 fielded a base-level-6 unit
//     promoted with no promoted levels, against fillers of 10-14);
//   - a fix that overshoots (12 or 10 added for the tier) puts the captain over the act's boss;
//   - a fix that touches base classes moves the Act I and II captains, which were right.
import { describe, expect, it } from 'vitest';
import { generateBattle, eliteCaptains } from '../src/engine/MapGenerator.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import {
  createEnemyUnit,
  createPromotedEnemyUnit,
  getXpEffectiveLevel,
} from '../src/engine/UnitManager.js';
import { DIFFICULTY_IDS, resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { ACT_CONFIG, XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const bossNames = new Set(Object.values(data.enemies.bosses).flatMap((l) => l.map((b) => b.name)));
const classTier = (name) => data.classes.find((c) => c.name === name)?.tier;

function seize(params, seed = 7) {
  const random = Math.random;
  let s = seed;
  Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  try {
    return generateBattle({ objective: 'seize', ...params }, data);
  } finally {
    Math.random = random;
  }
}
const throneHolder = (config) => config.enemySpawns.find((e) => e.isBoss);

describe('elite captains', () => {
  it('every captain names a real class and never an act boss', () => {
    for (const [act, list] of Object.entries(data.enemies.elites)) {
      expect(list.length, act).toBeGreaterThan(0);
      for (const entry of list) {
        expect(classTier(entry.className), `${act} ${entry.className}`).toBeTruthy();
        expect(bossNames.has(entry.name), entry.name).toBe(false);
      }
    }
  });

  it('an elite seize in Act III holds a captain at the node’s level, not a L17 boss', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const config = seize({ act: 'act3', isElite: true, levelRange: [10, 13] }, seed);
      const holder = throneHolder(config);
      const captain = data.enemies.elites.act3.find((e) => e.name === holder.name);
      expect(captain, holder.name).toBeTruthy();
      // Top of range (13) + 2, a spawn level on the one scale every foe uses, whatever the tier.
      expect(holder.level).toBe(15);
    }
  });

  it('the act’s boss node still draws the act’s bosses', () => {
    const acts = ['act2', 'act3'];
    for (const act of acts)
      for (let seed = 1; seed <= 6; seed++) {
        const boss = throneHolder(seize({ act, isBoss: true }, seed));
        expect(data.enemies.bosses[act].map((b) => b.name)).toContain(boss.name);
        const plain = throneHolder(seize({ act }, seed)); // no isElite: the boss node
        expect(data.enemies.bosses[act].map((b) => b.name)).toContain(plain.name);
      }
  });

  it('levels: Act I captains stand at the top of the node’s range; base classes +2 later', () => {
    const act1 = eliteCaptains(data.enemies, 'act1', [2, 3], data.classes);
    expect(act1.every((c) => c.level === 3)).toBe(true);
    const act2 = eliteCaptains(data.enemies, 'act2', [5, 8], data.classes);
    expect(act2.every((c) => c.level === 10)).toBe(true);
    // A promoted captain takes nothing off for its tier: Act III's list is all promoted.
    const act3 = eliteCaptains(data.enemies, 'act3', [10, 14], data.classes);
    expect(act3.map((c) => classTier(c.className))).toEqual(act3.map(() => 'promoted'));
    expect(act3.every((c) => c.level === 16)).toBe(true);
    // An act without captains keeps the boss list (old data, other campaigns).
    expect(eliteCaptains({ bosses: { act9: [{ name: 'X' }] } }, 'act9', [1, 2])).toEqual([
      { name: 'X' },
    ]);
  });
});

/** Run `fn` with Math.random swapped for `random`. */
function withRandom(random, fn) {
  const saved = Math.random;
  Math.random = random;
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const classByName = (name) => data.classes.find((c) => c.name === name);
const modifiers = (difficultyId) => resolveDifficultyMode(data.difficulty, difficultyId).modifiers;

/**
 * The unit a spawn becomes, as BattleScene.addEnemyFromSpawn and the harness build it, with every
 * growth roll a success (Math.random 0), so its stats count the levels it was given and nothing
 * else: one more level is never fewer stats.
 */
function buildAtFullGrowth(className, level, act) {
  const classData = classByName(className);
  return withRandom(
    () => 0,
    () =>
      classData.tier === 'promoted'
        ? createPromotedEnemyUnit(
            classData,
            level,
            data.weapons,
            1.0,
            data.skills,
            act,
            data.classes,
          )
        : createEnemyUnit(classData, level, data.weapons, 1.0, data.skills, act),
  );
}
const statTotal = (unit) => XP_STAT_NAMES.reduce((sum, stat) => sum + unit.stats[stat], 0);

/** The level ranges of the elite seize nodes real node maps give an act (row by row). */
function eliteSeizeRanges(act) {
  const ranges = new Map();
  for (let seed = 1; seed <= 60; seed++) {
    const map = withRandom(seeded(seed), () =>
      generateNodeMap(act, ACT_CONFIG[act], data.mapTemplates),
    );
    for (const node of map.nodes) {
      const bp = node.battleParams;
      if (node.type !== 'battle' || bp?.isElite !== true || bp.objective !== 'seize') continue;
      ranges.set(bp.levelRange.join('-'), bp.levelRange);
    }
  }
  return [...ranges.values()];
}

/** The captain a real elite seize battle seats at this node range and rung. */
function captainAt(act, levelRange, difficultyId, seed = 3) {
  const config = withRandom(seeded(seed), () =>
    generateBattle(
      {
        act,
        objective: 'seize',
        isElite: true,
        levelRange,
        difficultyId,
        enemyLevelBonus: modifiers(difficultyId).enemyLevelBonus,
        bossLevelBonus: modifiers(difficultyId).bossLevelBonus,
      },
      data,
    ),
  );
  return { config, holder: throneHolder(config) };
}

describe('elite captain levels: one spawn-level scale for every tier', () => {
  const promotedActs = ['act3', 'act4'];

  it('the acts under test field promoted captains, and their elite rows are real', () => {
    for (const act of promotedActs) {
      expect(data.enemies.elites[act].every((e) => classTier(e.className) === 'promoted')).toBe(
        true,
      );
      expect(eliteSeizeRanges(act).length, act).toBeGreaterThan(0);
    }
  });

  it('a promoted captain stands, stats-wise, at or above the top of its node’s fillers', () => {
    for (const act of promotedActs)
      for (const levelRange of eliteSeizeRanges(act))
        for (const difficultyId of DIFFICULTY_IDS)
          for (const seed of [3, 11]) {
            const where = `${act} [${levelRange}] ${difficultyId} seed ${seed}`;
            const top = levelRange[1] + modifiers(difficultyId).enemyLevelBonus;
            const { config, holder } = captainAt(act, levelRange, difficultyId, seed);
            expect(classTier(holder.className), where).toBe('promoted');
            // The rule as written: the top of the node's (rung-adjusted) range plus two.
            expect(holder.level, where).toBe(top + 2);
            // No foe on the map spawns above the captain who holds it.
            for (const spawn of config.enemySpawns)
              expect(spawn.level, `${where} ${spawn.className}`).toBeLessThanOrEqual(holder.level);
            // Built as the battle builds it, the captain has at least the stats of its own class
            // as a filler at the top of the node's range.
            const captain = buildAtFullGrowth(holder.className, holder.level, act);
            const filler = buildAtFullGrowth(holder.className, top, act);
            expect(captain.tier, where).toBe('promoted');
            expect(statTotal(captain), where).toBeGreaterThanOrEqual(statTotal(filler));
            expect(getXpEffectiveLevel(captain), where).toBeGreaterThanOrEqual(
              getXpEffectiveLevel(filler),
            );
          }
  });

  it('a promoted captain stands at or below its act’s boss on every rung', () => {
    for (const act of promotedActs)
      for (const difficultyId of DIFFICULTY_IDS) {
        const { bossLevelBonus, enemyLevelBonus } = modifiers(difficultyId);
        // Every captain the act's elite rows can seat on this rung (the generator's own list,
        // on the rung-adjusted range it is handed), and the real battle's throne holder.
        const seated = eliteSeizeRanges(act).flatMap((r) => {
          const adjusted = [r[0] + enemyLevelBonus, r[1] + enemyLevelBonus];
          return [
            ...eliteCaptains(data.enemies, act, adjusted, data.classes),
            captainAt(act, r, difficultyId).holder,
          ];
        });
        const bosses = data.enemies.bosses[act].filter(
          (b) => !b.difficultyFilter || b.difficultyFilter.includes(difficultyId),
        );
        for (const captainDef of seated)
          for (const bossDef of bosses) {
            const where = `${act} ${difficultyId} ${captainDef.name} L${captainDef.level} vs ${bossDef.name}`;
            const captain = buildAtFullGrowth(captainDef.className, captainDef.level, act);
            const boss = buildAtFullGrowth(bossDef.className, bossDef.level + bossLevelBonus, act);
            expect(getXpEffectiveLevel(captain), where).toBeLessThanOrEqual(
              getXpEffectiveLevel(boss),
            );
          }
      }
  });

  it('a base-class captain is unchanged: the top of its node’s range (Act I), plus two (Act II)', () => {
    for (const [act, offset] of [
      ['act1', 0],
      ['act2', 2],
    ])
      for (const levelRange of eliteSeizeRanges(act))
        for (const difficultyId of DIFFICULTY_IDS) {
          const where = `${act} [${levelRange}] ${difficultyId}`;
          const top = levelRange[1] + modifiers(difficultyId).enemyLevelBonus;
          const { holder } = captainAt(act, levelRange, difficultyId);
          expect(classTier(holder.className), where).toBe('base');
          expect(holder.level, where).toBe(top + offset);
          const unit = buildAtFullGrowth(holder.className, holder.level, act);
          expect([unit.tier, unit.level], where).toEqual(['base', top + offset]);
        }
  });

  it('a set piece’s captain follows the same rule: promoted in Act III, base in Act I', () => {
    const params = (act, levelRange) => ({
      act,
      objective: 'rout',
      setPiece: 'toll_house',
      difficultyId: 'normal',
      deployCount: 4,
      levelRange,
    });
    for (let seed = 1; seed <= 8; seed++) {
      const late = generateSeededBattle(params('act3', [10, 14]), data, seed);
      const revenant = late.enemySpawns.find((s) => s.isBoss);
      expect(revenant).toMatchObject({ className: 'Revenant', level: 16 });
      expect(classTier('Revenant')).toBe('promoted');
      for (const spawn of late.enemySpawns) expect(spawn.level).toBeLessThanOrEqual(16);
      const early = generateSeededBattle(params('act1', [2, 3]), data, seed);
      expect(early.enemySpawns.find((s) => s.isBoss)).toMatchObject({
        className: 'Zombie',
        level: 3,
      });
    }
  });
});
