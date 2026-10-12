// The Circle Adept and the Hollowed (Act V "The Descent", docs/specs/act-v-descent.md §5): two
// enemy-only classes that no pool, recruit, seal, arena bout or copied arrival may produce.
// Ways this breaks:
//   - one of them leaks into a recruit pool, a reclass seal, an event join, an enemy pool or a
//     Colosseum bout (the enemy-only lists were a hand-kept pair of names);
//   - the split of `isNecromancyClass` is wrong: the Hollowed or Adept inherit the raising rules
//     (a scripted wave refuses them), or an arrival template / arena entrant may copy them;
//   - a map that lists them as spawns turns them into ladder or arrival templates;
//   - a rung or act meets them before the finale (a set piece in Act IV; First Light's set pieces
//     skip the gated pools but still honour this table);
//   - a Hollowed learns a skill, or carries a thief's item; a Voice carries one;
//   - the Adept's tome (Greycord) reaches a shop or a loot table, a Sage picks it up, or its
//     pipeline draws more Math.random than any promoted Mage-line enemy;
//   - the validator lets a priced enemy-only tome or a recruit pool listing them ship.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  DARK_CLASSES,
  DIFFICULTY_GATED_CLASSES,
  filterClassPoolByDifficulty,
} from '../src/utils/constants.js';
import {
  ENEMY_ONLY_CLASS_NAMES,
  createEnemyUnit,
  createPromotedEnemyUnit,
  getReclassTargets,
  getWeaponByTier,
  parseWeaponProficiencies,
} from '../src/engine/UnitManager.js';
import { getEffectivenessMultiplier } from '../src/engine/Combat.js';
import { joinClassBlock } from '../src/engine/EventJoin.js';
import { generateChallenger } from '../src/engine/ColosseumEngine.js';
import {
  buildReinforcementSpawnSpec,
  buildReinforcementTemplatePool,
  ladderPromotedClasses,
} from '../src/engine/ReinforcementSpawns.js';
import {
  CIRCLE_ADEPT_CLASS,
  HOLLOWED_CLASS,
  isNecromancyClass,
  isNeverCopiedClass,
} from '../src/engine/Necromancy.js';
import { assignEnemyCarry, isCarrierEligible } from '../src/engine/EnemyCarry.js';
import { validateSetPiecesConfig } from '../src/engine/SetPieces.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';
import { createBattleRng } from '../src/engine/BattleRng.js';

const data = loadGameData();
const classOf = (name) => data.classes.find((c) => c.name === name);
const NEW_CLASSES = [CIRCLE_ADEPT_CLASS, HOLLOWED_CLASS];
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const ACTS = ['act1', 'act2', 'act3', 'act4', 'postAct', 'finalBoss'];

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

describe('the data', () => {
  it('the Circle Adept is a promoted Infantry caster of Tomes, promoted from Mage', () => {
    const adept = classOf(CIRCLE_ADEPT_CLASS);
    expect(adept).toMatchObject({
      tier: 'promoted',
      promotesFrom: 'Mage',
      moveType: 'Infantry',
      weaponProficiencies: 'Tomes (M)',
      enemyWeapon: 'Greycord',
    });
    expect(parseWeaponProficiencies(adept.weaponProficiencies)).toEqual([
      { type: 'Tome', rank: 'Mast' },
    ]);
    expect(classOf('Mage').baseStats.MOV + adept.promotionBonuses.MOV).toBe(4);
    // Warded and soft (the design): more MAG and RES than a Sage's promotion, no more DEF.
    const sage = classOf('Sage');
    expect(adept.promotionBonuses.RES).toBeGreaterThan(sage.promotionBonuses.RES);
    expect(adept.promotionBonuses.MAG).toBeGreaterThanOrEqual(sage.promotionBonuses.MAG);
    expect(adept.promotionBonuses.DEF).toBeLessThanOrEqual(sage.promotionBonuses.DEF);
  });

  it('the Hollowed is a base Infantry class: lance and sword, low growths, no skills, no promotion', () => {
    const hollowed = classOf(HOLLOWED_CLASS);
    expect(hollowed).toMatchObject({
      tier: 'base',
      moveType: 'Infantry',
      weaponProficiencies: 'Lances (P), Swords (P)',
      promotesTo: [],
      noEnemySkills: true,
    });
    expect(hollowed.learnableSkills).toBeUndefined();
    expect(parseWeaponProficiencies(hollowed.weaponProficiencies).map((p) => p.type)).toEqual([
      'Lance',
      'Sword',
    ]);
    const mean = (name) => {
      const ranges = Object.values(classOf(name).growthRanges).map((r) => {
        const [lo, hi] = r.split('-').map(Number);
        return (lo + hi) / 2;
      });
      return ranges.reduce((a, b) => a + b, 0) / ranges.length;
    };
    expect(mean(HOLLOWED_CLASS)).toBeLessThan(mean('Soldier') - 10);
  });

  it('both are on every enemy-only list; only the Adept is a dark class (Endword reaches it)', () => {
    for (const name of NEW_CLASSES) {
      expect(ENEMY_ONLY_CLASS_NAMES.has(name), `${name} enemy-only`).toBe(true);
      expect(DIFFICULTY_GATED_CLASSES.has(name), `${name} gated`).toBe(true);
    }
    expect(DARK_CLASSES.has(CIRCLE_ADEPT_CLASS)).toBe(true);
    expect(DARK_CLASSES.has(HOLLOWED_CLASS)).toBe(false);
    const endword = data.weapons.find((w) => w.name === 'Endword');
    expect(getEffectivenessMultiplier(endword, { className: CIRCLE_ADEPT_CLASS })).toBe(3);
    expect(getEffectivenessMultiplier(endword, { className: HOLLOWED_CLASS })).toBe(1);
  });

  it('class lore is a found text of at most 160 characters, one line, no double quotes', () => {
    for (const name of NEW_CLASSES) {
      const { lore, description } = classOf(name);
      expect(lore.length, name).toBeGreaterThan(20);
      expect(lore.length, name).toBeLessThanOrEqual(160);
      expect(lore, name).not.toMatch(/["\n]/);
      expect(lore, name).not.toBe(description);
    }
  });
});

describe('the split predicate', () => {
  it('"never copied" holds all four enemy-only casters and fodder; "necromancy" only the raising pair', () => {
    for (const name of ['Necromancer', 'Skeleton', ...NEW_CLASSES])
      expect(isNeverCopiedClass(name), name).toBe(true);
    for (const name of ['Fighter', 'Sage', 'Zombie', 'Soldier', 'Entity'])
      expect(isNeverCopiedClass(name), name).toBe(false);
    for (const name of ['Necromancer', 'Skeleton'])
      expect(isNecromancyClass(name), name).toBe(true);
    // The raising rules are not the new classes' business.
    for (const name of NEW_CLASSES) expect(isNecromancyClass(name), name).toBe(false);
  });
});

describe('Greycord', () => {
  const greycord = data.weapons.find((w) => w.name === 'Greycord');

  it('is a Steel tome priced 0 with short found-text lore, in no loot table, never a tier pick', () => {
    expect(greycord).toMatchObject({ type: 'Tome', tier: 'Steel', price: 0 });
    expect(greycord.lore.length).toBeLessThanOrEqual(85);
    expect(greycord.lore).not.toMatch(/["\n]/);
    for (const [actId, table] of Object.entries(data.lootTables))
      for (const [poolKey, pool] of Object.entries(table)) {
        if (!Array.isArray(pool)) continue;
        const names = pool.map((entry) => (typeof entry === 'string' ? entry : entry?.name));
        expect(names, `${actId}.${poolKey}`).not.toContain('Greycord');
      }
    const tomes = parseWeaponProficiencies('Tomes (P)');
    for (const tier of ['Iron', 'Steel', 'Silver'])
      expect(getWeaponByTier(tomes, data.weapons, tier)?.name).not.toBe('Greycord');
  });

  it('every Circle Adept carries it and only it, with no draw a Sage would not make', () => {
    const make = (className, seed) => {
      installSeed(seed);
      const random = vi.spyOn(Math, 'random');
      const unit = createPromotedEnemyUnit(
        classOf(className),
        16,
        data.weapons,
        1,
        data.skills,
        'finalBoss',
        data.classes,
      );
      const draws = random.mock.calls.length;
      random.mockRestore();
      restoreMathRandom();
      return { unit, draws };
    };
    const adept = make(CIRCLE_ADEPT_CLASS, 5);
    expect(adept.unit.weapon.name).toBe('Greycord');
    expect(adept.unit.inventory.map((w) => w.name)).toEqual(['Greycord']);
    expect(typeof adept.unit.weapon.uid).toBe('string');
    expect(adept.unit.className).toBe(CIRCLE_ADEPT_CLASS);
    expect(adept.draws).toBe(make('Sage', 5).draws);
    expect(make('Sage', 5).unit.weapon.name).not.toBe('Greycord');
  });

  it('the validator refuses a priced Greycord or one that sits in a loot table', () => {
    const priced = structuredClone(data.weapons);
    priced.find((w) => w.name === 'Greycord').price = 900;
    expect(validateCrossReferences({ ...data, weapons: priced }).errors.join('\n')).toMatch(
      /Greycord is Circle Adept's enemy-only weapon: its price must be 0/,
    );
    const loot = structuredClone(data.lootTables);
    const pool = Object.values(loot.act5 || loot.act4).find(Array.isArray);
    pool.push('Greycord');
    expect(validateCrossReferences({ ...data, lootTables: loot }).errors.join('\n')).toMatch(
      /lists enemy-only weapon "Greycord"/,
    );
  });
});

describe('no skills, no carried item', () => {
  const build = (className, seed, bonus) => {
    installSeed(seed);
    const config = { multiplier: 1, enemyStatBonus: 0, skillChanceBonus: bonus };
    const unit = createEnemyUnit(
      classOf(className),
      16,
      data.weapons,
      config,
      data.skills,
      'finalBoss',
    );
    restoreMathRandom();
    return unit;
  };

  it('a Hollowed never learns a skill even when every roll succeeds; a Soldier does', () => {
    let soldiersWithSkill = 0;
    for (let seed = 1; seed <= 25; seed++) {
      expect(build(HOLLOWED_CLASS, seed, 1).skills, `seed ${seed}`).toEqual([]);
      if (build('Soldier', seed, 1).skills.length > 0) soldiersWithSkill++;
    }
    expect(soldiersWithSkill).toBe(25);
  });

  it('a Hollowed takes the lance or sword the tier pick gives, and nothing special', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const unit = build(HOLLOWED_CLASS, seed, 0);
      expect(['Lance', 'Sword']).toContain(unit.weapon.type);
      expect(unit.weapon.special || '').toBe('');
    }
  });

  it('neither class is a carrier, and a garrison of only them rolls no carrier at all', () => {
    for (const className of NEW_CLASSES)
      expect(isCarrierEligible({ className, level: 16, col: 1, row: 1 }), className).toBe(false);
    expect(isCarrierEligible({ className: 'Fighter', level: 16, col: 1, row: 1 })).toBe(true);
    const carryConfig = { perBattle: true, finalBoss: 1, maxPerBattle: 4 };
    const spawns = [
      { className: HOLLOWED_CLASS, level: 16, col: 1, row: 1 },
      { className: HOLLOWED_CLASS, level: 16, col: 2, row: 1 },
      { className: CIRCLE_ADEPT_CLASS, level: 16, col: 3, row: 1 },
    ];
    const { carriers } = assignEnemyCarry(spawns, {
      act: 'finalBoss',
      difficultyId: 'lunatic',
      templateId: 'x',
      carryConfig,
      lootTables: data.lootTables,
    });
    expect(carriers).toBe(0);
    expect(spawns.some((s) => s.carries)).toBe(false);
  });
});

describe('never a recruit, a seal target, a join or an ordinary pick', () => {
  it('no recruit pool lists them, and no seal reclasses into them', () => {
    for (const [key, pool] of Object.entries(data.recruits)) {
      if (key === 'namePool') continue;
      for (const name of NEW_CLASSES) expect(pool.classPool, `recruits.${key}`).not.toContain(name);
    }
    const units = [
      { tier: 'promoted', className: 'Sage', moveType: 'Infantry' },
      { tier: 'base', className: 'Mage', moveType: 'Infantry' },
      { tier: 'base', className: 'Soldier', moveType: 'Infantry' },
      { tier: 'promoted', className: 'Hero', moveType: 'Infantry' },
    ];
    for (const unit of units)
      for (const seal of ['infantry', 'mounted']) {
        const targets = getReclassTargets(unit, data.classes, seal).map((c) => c.name);
        for (const name of NEW_CLASSES)
          expect(targets, `${unit.className} ${seal}`).not.toContain(name);
      }
    for (const name of NEW_CLASSES)
      expect(joinClassBlock(data, name, ['act4']), name).toMatch(/enemy-only/);
    // Mage promotes only to Sage and Warlock: an Adept is never an ordinary promotion.
    expect(classOf('Mage').promotesTo).toEqual(['Sage', 'Warlock']);
  });

  it('the validator refuses a recruit pool that lists one', () => {
    for (const name of NEW_CLASSES) {
      const recruits = structuredClone(data.recruits);
      recruits.act4.classPool.push(name);
      expect(validateCrossReferences({ ...data, recruits }).errors.join('\n')).toMatch(
        new RegExp(`recruits.json:act4.classPool lists enemy-only class "${name}"`),
      );
    }
  });

  it('no enemy pool (any act) lists them yet', () => {
    for (const [actId, pool] of Object.entries(data.enemies.pools))
      for (const name of NEW_CLASSES) {
        expect(pool.base || [], `${actId} base`).not.toContain(name);
        expect(pool.promoted || [], `${actId} promoted`).not.toContain(name);
      }
  });
});

describe('arrivals and arena entrants are never one', () => {
  const battleParams = { act: 'finalBoss', difficultyId: 'lunatic' };

  it('a map that lists them as spawns copies neither into the arrival templates', () => {
    const templates = buildReinforcementTemplatePool({
      battleConfig: {
        enemySpawns: [
          { className: HOLLOWED_CLASS, level: 16, col: 3, row: 3 },
          { className: CIRCLE_ADEPT_CLASS, level: 16, col: 4, row: 3 },
          { className: 'Fighter', level: 15, col: 5, row: 3 },
        ],
      },
      battleParams,
      gameData: data,
    });
    expect(templates.map((t) => t.className)).toEqual(['Fighter']);
  });

  it('a map of only them falls back to the act pool, which holds neither', () => {
    const templates = buildReinforcementTemplatePool({
      battleConfig: { enemySpawns: [{ className: HOLLOWED_CLASS, level: 16, col: 3, row: 3 }] },
      battleParams: { act: 'act4', difficultyId: 'lunatic' },
      gameData: data,
    });
    expect(templates.length).toBeGreaterThan(5);
    for (const name of NEW_CLASSES) expect(templates.map((t) => t.className)).not.toContain(name);
  });

  it('a promoted ladder wave never draws one, even from a pool that lists them (the finale admits them)', () => {
    const polluted = structuredClone(data);
    for (const act of ['act4', 'finalBoss'])
      polluted.enemies.pools[act].promoted.push(...NEW_CLASSES);
    for (const act of ['act4', 'finalBoss'])
      for (const difficultyId of ['dusk', 'hard', 'lunatic']) {
        const drawn = ladderPromotedClasses({
          battleParams: { act, difficultyId },
          gameData: polluted,
        });
        expect(drawn.length, `${difficultyId} ${act}`).toBeGreaterThan(5);
        for (const name of NEW_CLASSES) expect(drawn, `${difficultyId} ${act}`).not.toContain(name);
      }
  });

  it('a template copy never lands on one, but a scripted wave may NAME a Hollowed or an Adept', () => {
    const spec = (className) =>
      buildReinforcementSpawnSpec({
        scheduledSpawn: { className, col: 1, row: 1, waveIndex: 0 },
        seed: 5,
        templates: [{ className: 'Fighter', level: 12 }],
        battleConfig: { enemySpawns: [] },
        battleParams,
        gameData: data,
      });
    // A named class is a scripted wave's own (the Rite's Hollowed waves): it stands.
    expect(spec(HOLLOWED_CLASS).className).toBe(HOLLOWED_CLASS);
    expect(spec(CIRCLE_ADEPT_CLASS).className).toBe(CIRCLE_ADEPT_CLASS);
    // The raising pair stay refused (a Necromancer is one per battle, a Skeleton only a raise).
    expect(spec('Necromancer').className).toBe('Fighter');
    expect(spec('Skeleton').className).toBe('Fighter');
    // An unnamed arrival copies a template, which is never one of them.
    const unnamed = buildReinforcementSpawnSpec({
      scheduledSpawn: { col: 1, row: 1, waveIndex: 0 },
      seed: 5,
      templates: [{ className: 'Fighter', level: 12 }],
      battleConfig: { enemySpawns: [] },
      battleParams,
      gameData: data,
    });
    expect(unnamed.className).toBe('Fighter');
  });

  it('an arena bout never draws one, even from a pool that lists them', () => {
    const polluted = structuredClone(data.enemies);
    for (const pool of Object.values(polluted.pools))
      pool.promoted = [...(pool.promoted || []), ...NEW_CLASSES];
    const tier = { levelOffset: [0, 0], xpMultiplier: 1 };
    for (const rung of RUNGS)
      for (const actId of ['act3', 'act4', 'finalBoss']) {
        const seen = new Set();
        for (let i = 0; i < 150; i++) {
          const { unit } = generateChallenger(
            12,
            tier,
            actId,
            polluted,
            data.classes,
            data.weapons,
            rung,
            data.colosseum,
            createBattleRng(i + 1),
            data.difficulty,
          );
          seen.add(unit.className);
        }
        for (const name of NEW_CLASSES)
          expect(seen.has(name), `${rung} ${actId} ${name}`).toBe(false);
        expect(seen.size).toBeGreaterThan(3);
      }
  });
});

describe('the gate: the finale only', () => {
  const earliest = (rung) => data.difficulty.modes[rung].enemyClassEarliestAct;

  it('every rung holds both back to the finale', () => {
    for (const rung of RUNGS)
      for (const name of NEW_CLASSES)
        expect(earliest(rung)[name], `${rung} ${name}`).toBe('finalBoss');
  });

  it('a pool that lists them offers them on no rung before the finale; First Light never', () => {
    const pool = ['Fighter', ...NEW_CLASSES];
    for (const rung of RUNGS)
      for (const act of ACTS) {
        const met = filterClassPoolByDifficulty(pool, rung, { act, difficulty: data.difficulty });
        const expected = rung !== 'normal' && act === 'finalBoss' ? NEW_CLASSES : [];
        expect(
          met.filter((n) => NEW_CLASSES.includes(n)),
          `${rung} ${act}`,
        ).toEqual(expected);
      }
  });

  it('the set piece validator refuses them in an event set piece Acts I to IV on every rung (First Light too)', () => {
    const setPieces = structuredClone(data.setPieces);
    setPieces.setPieces[0].variants[0].enemies[0].classes = [HOLLOWED_CLASS];
    const deps = {
      terrain: data.terrain,
      classes: data.classes,
      weapons: data.weapons,
      difficulty: data.difficulty,
      events: data.events,
    };
    const errors = validateSetPiecesConfig(setPieces, deps).errors.join('\n');
    for (const rung of RUNGS)
      expect(errors, rung).toMatch(new RegExp(`Hollowed in act\\d breaks ${rung}'s gate`));
    // Without the table's First Light entry only Dusk and up would catch it.
    const noNormal = structuredClone(data.difficulty);
    noNormal.modes.normal.enemyClassEarliestAct = {};
    expect(
      validateSetPiecesConfig(setPieces, { ...deps, difficulty: noNormal }).errors.join('\n'),
    ).not.toMatch(/breaks normal's gate/);
  });
});
