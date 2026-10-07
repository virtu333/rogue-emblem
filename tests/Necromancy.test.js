// The Necromancer and the Skeleton (Phase 3I): the data, the gates, the generator and the
// engine rules that need no board (the board's behaviour is in
// tests/harness/HeadlessBattleNecromancy.test.js and tests/NecromancyBattle.test.js).
// Ways this breaks:
//   - an enemy-only class leaks into a recruit, reclass, event-join or loot list
//   - a rung or act meets a Necromancer it should not (First Light ever; Dusk or Nightfall
//     before Act IV; Black Sun before Act III)
//   - generation fields two Necromancers, or re-rolls a pick and shifts the battle stream
//   - an arrival, ladder wave or arena entrant copies a Necromancer or a Skeleton
//   - Gravesong reaches a shop or a loot table, or the tier picker hands it to a Mage
//   - the Necromancer's gear draws from Math.random differently from any other promoted enemy
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  NECROMANCER_RAISE_CAP,
  DARK_CLASSES,
  DIFFICULTY_GATED_CLASSES,
  filterClassPoolByDifficulty,
} from '../src/utils/constants.js';
import {
  ENEMY_ONLY_CLASS_NAMES,
  createPromotedEnemyUnit,
  getReclassTargets,
  getWeaponByTier,
  parseWeaponProficiencies,
} from '../src/engine/UnitManager.js';
import { getEffectivenessMultiplier } from '../src/engine/Combat.js';
import { joinClassBlock } from '../src/engine/EventJoin.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { generateChallenger } from '../src/engine/ColosseumEngine.js';
import {
  buildReinforcementSpawnSpec,
  buildReinforcementTemplatePool,
  enemyRewardMultiplier,
  enemyXpMultiplier,
  isZeroRewardUnit,
  ladderPromotedClasses,
} from '../src/engine/ReinforcementSpawns.js';
import {
  NECROMANCER_CLASS,
  SKELETON_CLASS,
  crumbleFor,
  isNecromancyClass,
  isRaisedUnit,
  mapExtraNecromancer,
  raisedCountOf,
  raisers,
  skeletonLevelFor,
} from '../src/engine/Necromancy.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { createBattleRng } from '../src/engine/BattleRng.js';

const data = loadGameData();
const classOf = (name) => data.classes.find((c) => c.name === name);
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const ACTS = ['act1', 'act2', 'act3', 'act4', 'postAct', 'finalBoss'];

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

describe('the two classes', () => {
  it('the Necromancer is a promoted Infantry caster of Tomes, promoted from Mage', () => {
    const necro = classOf('Necromancer');
    expect(necro).toMatchObject({
      tier: 'promoted',
      promotesFrom: 'Mage',
      moveType: 'Infantry',
      weaponProficiencies: 'Tomes (M)',
      enemyWeapon: 'Gravesong',
    });
    expect(parseWeaponProficiencies(necro.weaponProficiencies)).toEqual([
      { type: 'Tome', rank: 'Mast' },
    ]);
    // A holding caster sized for Act IV: at its act's level it out-stats a Sage in bulk but
    // not in reach (MOV 4: it holds its post).
    const sage = classOf('Sage');
    expect(necro.promotionBonuses.HP).toBeGreaterThanOrEqual(sage.promotionBonuses.HP);
    expect(necro.promotionBonuses.DEF).toBeGreaterThanOrEqual(sage.promotionBonuses.DEF);
    expect(classOf('Mage').baseStats.MOV + necro.promotionBonuses.MOV).toBe(4);
  });

  it('the Skeleton is a base Infantry class with low growths and three Prof weapon types', () => {
    const skeleton = classOf('Skeleton');
    expect(skeleton).toMatchObject({
      tier: 'base',
      moveType: 'Infantry',
      weaponProficiencies: 'Swords (P), Lances (P), Bows (P)',
    });
    expect(parseWeaponProficiencies(skeleton.weaponProficiencies).map((p) => p.type)).toEqual([
      'Sword',
      'Lance',
      'Bow',
    ]);
    // Low: no growth range tops 45, and the mean is far under a Soldier's or Mage's.
    const tops = Object.values(skeleton.growthRanges).map((r) => Number(r.split('-')[1]));
    expect(Math.max(...tops)).toBeLessThanOrEqual(45);
    const mean = (cls) => {
      const ranges = Object.values(classOf(cls).growthRanges).map((r) => {
        const [lo, hi] = r.split('-').map(Number);
        return (lo + hi) / 2;
      });
      return ranges.reduce((a, b) => a + b, 0) / ranges.length;
    };
    expect(mean('Skeleton')).toBeLessThan(mean('Soldier') - 10);
    expect(mean('Skeleton')).toBeLessThan(mean('Mage') - 10);
  });

  it('every enemy-only list names both; the Necromancer is a dark class (Endword reaches it)', () => {
    for (const name of [NECROMANCER_CLASS, SKELETON_CLASS]) {
      expect(ENEMY_ONLY_CLASS_NAMES.has(name), `${name} enemy-only`).toBe(true);
      expect(DIFFICULTY_GATED_CLASSES.has(name), `${name} gated`).toBe(true);
    }
    expect(DARK_CLASSES.has(NECROMANCER_CLASS)).toBe(true);
    expect(DARK_CLASSES.has(SKELETON_CLASS)).toBe(false); // bone, not dark magic
    const endword = data.weapons.find((w) => w.name === 'Endword');
    expect(getEffectivenessMultiplier(endword, { className: 'Necromancer' })).toBe(3);
    expect(getEffectivenessMultiplier(endword, { className: 'Skeleton' })).toBe(1);
  });

  it('neither class is in a recruit pool, a reclass seal target or an event join', () => {
    for (const [key, pool] of Object.entries(data.recruits)) {
      if (key === 'namePool') continue;
      for (const name of [NECROMANCER_CLASS, SKELETON_CLASS])
        expect(pool.classPool, `recruits.${key}`).not.toContain(name);
    }
    const mage = { tier: 'promoted', className: 'Sage', moveType: 'Infantry' };
    const fighter = { tier: 'base', className: 'Mage', moveType: 'Infantry' };
    for (const [unit, seal] of [
      [mage, 'infantry'],
      [mage, 'mounted'],
      [fighter, 'infantry'],
      [fighter, 'mounted'],
    ]) {
      const targets = getReclassTargets(unit, data.classes, seal).map((c) => c.name);
      expect(targets).not.toContain(NECROMANCER_CLASS);
      expect(targets).not.toContain(SKELETON_CLASS);
    }
    for (const name of [NECROMANCER_CLASS, SKELETON_CLASS])
      expect(joinClassBlock(data, name, ['act4'])).toMatch(/enemy-only/);
  });

  it('a Necromancer is never an ordinary Mage-line promotion: Mage promotes only to Sage and Warlock', () => {
    expect(classOf('Mage').promotesTo).toEqual(['Sage', 'Warlock']);
    expect(classOf('Skeleton').promotesTo).toEqual([]);
  });
});

describe('Gravesong', () => {
  const gravesong = data.weapons.find((w) => w.name === 'Gravesong');

  it('is a Steel tome that is priced 0 and in no loot table (nothing sells or drops it)', () => {
    expect(gravesong).toMatchObject({ type: 'Tome', tier: 'Steel', price: 0 });
    for (const [actId, table] of Object.entries(data.lootTables))
      for (const [poolKey, pool] of Object.entries(table)) {
        if (!Array.isArray(pool)) continue;
        const names = pool.map((entry) => (typeof entry === 'string' ? entry : entry?.name));
        expect(names, `${actId}.${poolKey}`).not.toContain('Gravesong');
      }
  });

  it('no ordinary pick reaches it: the tier picker skips a weapon with a special', () => {
    const tomes = parseWeaponProficiencies('Tomes (P)');
    for (const tier of ['Iron', 'Steel', 'Silver'])
      expect(getWeaponByTier(tomes, data.weapons, tier)?.name).not.toBe('Gravesong');
  });

  it('every Necromancer carries it (and only it), with no draw a Sage would not make', () => {
    const make = (className, seed) => {
      installSeed(seed);
      const random = vi.spyOn(Math, 'random');
      const unit = createPromotedEnemyUnit(
        classOf(className),
        16,
        data.weapons,
        1,
        data.skills,
        'act4',
        data.classes,
      );
      const draws = random.mock.calls.length;
      random.mockRestore();
      restoreMathRandom();
      return { unit, draws };
    };
    const necro = make('Necromancer', 5);
    expect(necro.unit.weapon.name).toBe('Gravesong');
    expect(necro.unit.inventory.map((w) => w.name)).toEqual(['Gravesong']);
    expect(typeof necro.unit.weapon.uid).toBe('string');
    expect(necro.unit.className).toBe('Necromancer');
    expect(necro.unit.tier).toBe('promoted');
    // Same pipeline as any promoted Mage-line enemy: the same number of draws.
    expect(necro.draws).toBe(make('Sage', 5).draws);
    expect(make('Sage', 5).unit.weapon.name).not.toBe('Gravesong');
  });
});

describe('where each rung meets a Necromancer', () => {
  const met = (rung, act) => {
    const pool = data.enemies.pools[act];
    return [...(pool.base || []), ...(pool.promoted || [])].filter(
      (name) =>
        filterClassPoolByDifficulty([name], rung, { act, difficulty: data.difficulty }).length > 0,
    );
  };

  it('First Light never; Dusk and Nightfall in Act IV only; Black Sun in Acts III and IV', () => {
    const expected = {
      normal: [],
      dusk: ['act4'],
      hard: ['act4'],
      lunatic: ['act3', 'act4'],
    };
    for (const rung of RUNGS) {
      const acts = ACTS.filter((act) => met(rung, act).includes('Necromancer'));
      expect(acts, rung).toEqual(expected[rung]);
    }
  });

  it('no pool ever offers a Skeleton (it only comes from a raise)', () => {
    for (const act of ACTS)
      for (const rung of RUNGS) expect(met(rung, act), `${rung} ${act}`).not.toContain('Skeleton');
  });

  it('the Necromancer stands in the Act III and Act IV promoted pools and no other', () => {
    const where = ACTS.filter((act) =>
      (data.enemies.pools[act].promoted || []).includes('Necromancer'),
    );
    expect(where).toEqual(['act3', 'act4']);
  });

  it('the gate is data: Black Sun lists Act III, Dusk and Nightfall Act IV', () => {
    const earliest = (rung) =>
      resolveDifficultyMode(data.difficulty, rung).modifiers.enemyClassEarliestAct;
    expect(earliest('normal')).toEqual({});
    expect(earliest('dusk').Necromancer).toBe('act4');
    expect(earliest('hard').Necromancer).toBe('act4');
    expect(earliest('lunatic').Necromancer).toBe('act3');
  });
});

describe('one Necromancer per battle', () => {
  const pool = { base: ['Myrmidon'], promoted: ['Swordmaster', 'Necromancer', 'Revenant'] };

  it("a further pick maps to the pool's next class; the first stands; others pass through", () => {
    expect(mapExtraNecromancer('Necromancer', [], pool)).toBe('Necromancer');
    expect(mapExtraNecromancer('Necromancer', [{ className: 'Hero' }], pool)).toBe('Necromancer');
    const held = [{ className: 'Necromancer' }];
    expect(mapExtraNecromancer('Necromancer', held, pool)).toBe('Revenant');
    expect(mapExtraNecromancer('Swordmaster', held, pool)).toBe('Swordmaster');
    // Wraps past the end of the list, and past a Necromancer-only list to the base pool.
    expect(
      mapExtraNecromancer('Necromancer', held, { base: [], promoted: ['Sage', 'Necromancer'] }),
    ).toBe('Sage');
    expect(
      mapExtraNecromancer('Necromancer', held, { base: ['Myrmidon'], promoted: ['Necromancer'] }),
    ).toBe('Myrmidon');
  });

  /** Black Sun Act IV with a promoted pool of nothing but Necromancers and one other. */
  function forcedData(promoted) {
    const pools = structuredClone(data.enemies.pools);
    pools.act4.promoted = promoted;
    pools.act4.promotedShare = 1;
    return { ...data, enemies: { ...data.enemies, pools } };
  }
  const params = (objective) => ({
    act: 'act4',
    objective,
    row: 4,
    deployCount: 6,
    difficultyId: 'lunatic',
    ...resolveDifficultyMode(data.difficulty, 'lunatic').modifiers,
  });
  const generate = (seed, objective, gameData) => {
    installSeed(seed);
    try {
      return generateBattle(params(objective), gameData);
    } finally {
      restoreMathRandom();
    }
  };

  it('never makes two: a pool of Necromancers and one other yields at most one Necromancer', () => {
    const forced = forcedData(['Necromancer', 'Warlock']);
    let withOne = 0;
    for (const objective of ['rout', 'seize', 'escape'])
      for (let seed = 1; seed <= 25; seed++) {
        const battle = generate(seed, objective, forced);
        const count = battle.enemySpawns.filter((s) => s.className === 'Necromancer').length;
        expect(count, `${objective} seed ${seed}`).toBeLessThanOrEqual(1);
        if (count === 1) withOne++;
      }
    expect(withOne).toBeGreaterThan(30); // the first pick is a Necromancer on most maps
  });

  it('also on the real Act III and IV pools, across seeds and rungs', () => {
    const seen = {};
    for (const rung of ['dusk', 'hard', 'lunatic'])
      for (const act of ['act3', 'act4'])
        for (let seed = 1; seed <= 40; seed++) {
          installSeed(seed);
          const battle = generateBattle(
            {
              ...params('rout'),
              act,
              difficultyId: rung,
              ...resolveDifficultyMode(data.difficulty, rung).modifiers,
            },
            data,
          );
          restoreMathRandom();
          const necros = battle.enemySpawns.filter((s) => s.className === 'Necromancer');
          seen[`${rung} ${act}`] = (seen[`${rung} ${act}`] || 0) + necros.length;
          expect(necros.length, `${rung} ${act} ${seed}`).toBeLessThanOrEqual(1);
          // The gate holds in the generated map as well as in the pool.
          const allowed = rung === 'lunatic' ? act !== 'act1' : act === 'act4';
          if (!allowed) expect(necros).toEqual([]);
        }
    // The classes do turn up where they are allowed (the test would pass on an empty pool).
    for (const key of ['dusk act4', 'hard act4', 'lunatic act3', 'lunatic act4'])
      expect(seen[key], key).toBeGreaterThan(0);
    for (const key of ['dusk act3', 'hard act3']) expect(seen[key], key).toBe(0);
  });

  it('a Necromancer starts on guard (the existing mode that returns it to its post), holders or not', () => {
    const forced = forcedData(['Necromancer', 'Warlock']);
    let checked = 0;
    let withHolders = 0;
    for (const objective of ['rout', 'seize', 'escape'])
      for (let seed = 1; seed <= 40; seed++) {
        const battle = generate(seed, objective, forced);
        const holders = battle.enemySpawns.filter((s) => s.aiMode === 'hold');
        if (holders.length > 0) withHolders++;
        // A holding pack never takes the Necromancer: its Skeletons hunt, it holds its own post.
        expect(holders.map((h) => h.className)).not.toContain('Necromancer');
        for (const spawn of battle.enemySpawns.filter((s) => s.className === 'Necromancer')) {
          expect(spawn.aiMode, `${objective} seed ${seed}`).toBe('guard');
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(30);
    expect(withHolders).toBeGreaterThan(5); // the maps where a pack could have taken it exist
  });

  it('mapping is not a re-roll: the stream ends where it does with an ordinary class in the slot', () => {
    // Same classes in the same places except the Necromancer's slot holds a Sage (both
    // Infantry tome users): every draw count is equal, so the next draw is the same.
    const cursor = (promoted, seed) => {
      installSeed(seed);
      generateBattle(params('rout'), forcedData(promoted));
      const next = Math.random();
      restoreMathRandom();
      return next;
    };
    for (let seed = 1; seed <= 20; seed++)
      expect(cursor(['Necromancer', 'Warlock'], seed), `seed ${seed}`).toBe(
        cursor(['Sage', 'Warlock'], seed),
      );
  });

  it('a map that rolled no Necromancer is the map it was before the class existed', () => {
    // First Light cannot draw it, so its maps are untouched by the pool entry.
    const without = structuredClone(data);
    for (const act of ['act3', 'act4'])
      without.enemies.pools[act].promoted = without.enemies.pools[act].promoted.filter(
        (n) => n !== 'Necromancer',
      );
    for (let seed = 1; seed <= 10; seed++) {
      installSeed(seed);
      const a = generateBattle({ act: 'act4', objective: 'rout', row: 4, deployCount: 4 }, data);
      installSeed(seed);
      const b = generateBattle({ act: 'act4', objective: 'rout', row: 4, deployCount: 4 }, without);
      restoreMathRandom();
      expect(a.enemySpawns).toEqual(b.enemySpawns);
    }
  });
});

describe('arrivals and arena entrants are never a Necromancer or a Skeleton', () => {
  const battleParams = { act: 'act4', difficultyId: 'lunatic' };
  const necroSpawn = { className: 'Necromancer', level: 15, col: 3, row: 3 };

  it('the template pool skips both when a map spawn is one, and from the act pool', () => {
    const fromMap = buildReinforcementTemplatePool({
      battleConfig: {
        enemySpawns: [
          necroSpawn,
          { className: 'Skeleton', level: 11, col: 4, row: 3 },
          { className: 'Fighter', level: 12, col: 5, row: 3 },
        ],
      },
      battleParams,
      gameData: data,
    });
    expect(fromMap.map((t) => t.className)).toEqual(['Fighter']);
    for (const difficultyId of ['dusk', 'hard', 'lunatic']) {
      const fallback = buildReinforcementTemplatePool({
        battleConfig: { enemySpawns: [] },
        battleParams: { act: 'act4', difficultyId },
        gameData: data,
      });
      expect(fallback.length).toBeGreaterThan(5);
      expect(fallback.map((t) => t.className)).not.toContain('Necromancer');
      expect(fallback.map((t) => t.className)).not.toContain('Skeleton');
    }
  });

  it('a promoted ladder wave never draws one, and a scripted class override is ignored', () => {
    for (const difficultyId of ['dusk', 'hard', 'lunatic']) {
      expect(
        ladderPromotedClasses({ battleParams: { act: 'act4', difficultyId }, gameData: data }),
      ).not.toContain('Necromancer');
    }
    const spec = buildReinforcementSpawnSpec({
      scheduledSpawn: { className: 'Necromancer', col: 1, row: 1, waveIndex: 0 },
      seed: 5,
      templates: [{ className: 'Fighter', level: 12 }],
      battleConfig: { enemySpawns: [] },
      battleParams,
      gameData: data,
    });
    expect(spec.className).toBe('Fighter');
  });

  it('an arena bout never draws a Necromancer on any rung or act', () => {
    const colosseum = data.colosseum;
    const tier = { levelOffset: [0, 0], xpMultiplier: 1 };
    for (const rung of ['dusk', 'hard', 'lunatic'])
      for (const actId of ['act3', 'act4']) {
        const classes = new Set();
        for (let i = 0; i < 200; i++) {
          const rng = createBattleRng(i + 1);
          const { unit } = generateChallenger(
            12,
            tier,
            actId,
            data.enemies,
            data.classes,
            data.weapons,
            rung,
            colosseum,
            rng,
            data.difficulty,
          );
          classes.add(unit.className);
        }
        expect(classes.has('Necromancer'), `${rung} ${actId}`).toBe(false);
        expect(classes.size).toBeGreaterThan(3);
      }
  });
});

describe('the raised unit predicate and its rewards', () => {
  const skeleton = { className: 'Skeleton', faction: 'enemy', _raisedBy: 'u4' };

  it('one predicate: raised means _raisedBy names a Necromancer', () => {
    expect(isRaisedUnit(skeleton)).toBe(true);
    expect(isRaisedUnit({ className: 'Skeleton' })).toBe(false);
    expect(isRaisedUnit({ _raisedBy: '' })).toBe(false);
    expect(isRaisedUnit(null)).toBe(false);
    expect(isNecromancyClass('Skeleton')).toBe(true);
    expect(isNecromancyClass('Zombie')).toBe(false);
  });

  it('gold 0, XP a quarter, deeds skipped; a raised unit that is somehow elite stays a quarter', () => {
    expect(enemyRewardMultiplier(skeleton)).toBe(0);
    expect(enemyXpMultiplier(skeleton)).toBe(0.25);
    expect(isZeroRewardUnit(skeleton)).toBe(true);
    expect(enemyXpMultiplier({ ...skeleton, isElite: true })).toBe(0.25);
    // Everyone else keeps their multipliers.
    expect(enemyRewardMultiplier({})).toBe(1);
    expect(enemyXpMultiplier({})).toBe(1);
    expect(isZeroRewardUnit({})).toBe(false);
    expect(isZeroRewardUnit({ _isReinforcement: true, _reinforcementRewardMultiplier: 0 })).toBe(
      true,
    );
  });
});

describe('the engine rules without a board', () => {
  const necro = (over = {}) => ({
    className: 'Necromancer',
    tier: 'promoted',
    level: 6,
    currentHP: 20,
    battleEntityId: 'u3',
    col: 4,
    row: 4,
    ...over,
  });

  it("a Skeleton is four levels under its Necromancer's XP-effective level, never under 1", () => {
    // A promoted unit counts 12 more levels than it shows (hand-derived: 6 + 12 - 4 = 14).
    expect(skeletonLevelFor(necro({ level: 6 }))).toBe(14);
    expect(skeletonLevelFor(necro({ level: 1 }))).toBe(9);
    expect(skeletonLevelFor(necro({ level: 20 }))).toBe(28);
    // A base unit counts what it shows; the floor is level 1.
    expect(skeletonLevelFor({ ...necro(), tier: 'base', level: 9 })).toBe(5);
    expect(skeletonLevelFor({ ...necro(), tier: 'base', level: 5 })).toBe(1);
    expect(skeletonLevelFor({ ...necro(), tier: 'base', level: 2 })).toBe(1);
  });

  it('the lifetime cap is six, from constants.js', () => {
    expect(NECROMANCER_RAISE_CAP).toBe(6);
  });

  it('raisers: living Necromancers below two living Skeletons, in roster order', () => {
    const a = necro({ battleEntityId: 'u1' });
    const b = necro({ battleEntityId: 'u2', col: 8 });
    const sk = (by, over = {}) => ({
      className: 'Skeleton',
      _raisedBy: by,
      currentHP: 5,
      ...over,
    });
    expect(raisers([a, b])).toEqual([a, b]);
    expect(raisers([a, sk('u1'), b])).toEqual([a, b]);
    expect(raisers([a, sk('u1'), sk('u1'), b])).toEqual([b]);
    // A Skeleton on its way out (or dead) no longer counts; another's never does.
    expect(raisers([a, sk('u1'), sk('u1', { _removing: true })])).toEqual([a]);
    expect(raisers([a, sk('u1'), sk('u1', { currentHP: 0 })])).toEqual([a]);
    expect(raisers([a, sk('u2'), sk('u2')])).toEqual([a]);
    expect(raisers([necro({ currentHP: 0 }), necro({ _removing: true })])).toEqual([]);
    // The lifetime cap: six raised in all and it raises no more, however few stand.
    expect(raisedCountOf(necro())).toBe(0);
    expect(raisers([necro({ _raisedCount: 5 })])).toHaveLength(1);
    expect(raisers([necro({ _raisedCount: 6 })])).toEqual([]);
    expect(raisers([necro({ _raisedCount: 9 })])).toEqual([]);
    expect(raisers([necro({ _raisedCount: 6 }), b])).toEqual([b]);
    // No id, no raise: nothing could link its Skeleton to it.
    expect(raisers([necro({ battleEntityId: undefined })])).toEqual([]);
  });

  it('crumbleFor takes only its own Skeletons, in place, and leaves a Skeleton mid-removal alone', () => {
    const a = necro({ battleEntityId: 'u1' });
    const b = necro({ battleEntityId: 'u2' });
    const mine = { className: 'Skeleton', _raisedBy: 'u1' };
    const mine2 = { className: 'Skeleton', _raisedBy: 'u1' };
    const leaving = { className: 'Skeleton', _raisedBy: 'u1', _removing: true };
    const theirs = { className: 'Skeleton', _raisedBy: 'u2' };
    const fighter = { className: 'Fighter' };
    const roster = [a, mine, b, theirs, fighter, mine2, leaving];
    const crumbled = crumbleFor(a, roster);
    expect(crumbled).toEqual([mine, mine2]);
    expect(roster).toEqual([a, b, theirs, fighter, leaving]);
    // Not a Necromancer (or no id): nothing crumbles.
    expect(crumbleFor(fighter, roster)).toEqual([]);
    expect(crumbleFor(necro({ battleEntityId: undefined }), roster)).toEqual([]);
    expect(roster).toHaveLength(5);
  });
});
