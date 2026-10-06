// Smite (push an adjacent enemy 2 tiles away) and Transfuse (give up to 10 HP to an
// adjacent ally): the pure rules in engine/ActionAbilitySystem.js, their data
// (skills, schema, scrolls, loot) and the guarantees around them (no enemy ever holds
// them; HP moves only through UnitHealth). Positions and HP in the expectations are
// worked out by hand from the rules in the task, never by calling the code under test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { loadGameData } from './testData.js';
import {
  ACTION_ABILITY_KINDS,
  TARGETED_ABILITY_KINDS,
  abilityHasTargets,
  canUseAbility,
  findSmiteTargets,
  findTransfuseTargets,
  getActionAbilities,
  settleSmite,
  settleTransfuse,
  smiteBlockReason,
  traceSmite,
  transfuseAmount,
} from '../src/engine/ActionAbilitySystem.js';
import { HOLD_AI_MODE, markHoldDisturbed } from '../src/engine/HoldDisturbance.js';
import { wakeHolders } from '../src/engine/HoldActivation.js';
import { createEnemyUnit } from '../src/engine/UnitManager.js';

const gameData = loadGameData();
const skillById = new Map(gameData.skills.map((skill) => [skill.id, skill]));
const SMITE = skillById.get('smite');
const TRANSFUSE = skillById.get('transfuse');
const smiteAbility = SMITE.actionAbility;
const transfuseAbility = TRANSFUSE.actionAbility;

// --- worlds ---------------------------------------------------------------

/** A grid whose move cost is read from `cost(col, row, moveType)`; plain ground by default. */
function makeGrid({ cols = 10, rows = 10, cost = () => 1 } = {}) {
  return { cols, rows, getMoveCost: (col, row, moveType) => cost(col, row, moveType) };
}

const blockedTiles =
  (...tiles) =>
  (col, row) =>
    tiles.includes(`${col},${row}`) ? Infinity : 1;

function unit(name, col, row, extra = {}) {
  return {
    name,
    faction: 'player',
    col,
    row,
    currentHP: 20,
    stats: { HP: 30 },
    moveType: 'Infantry',
    skills: [],
    _conditions: [],
    ...extra,
  };
}
const foe = (name, col, row, extra = {}) => unit(name, col, row, { faction: 'enemy', ...extra });

/** Occupancy as the scene's seen-tile check builds it: every listed unit, plus `fog` tiles. */
function occupancy(units, fog = []) {
  return (col, row) =>
    fog.includes(`${col},${row}`) || units.find((u) => u.col === col && u.row === row) || null;
}

/** Targets of a Smite by `caster` at (5,5) among `foes` (and `others`, who only block). */
function smite({ foes, others = [], grid = makeGrid(), fog = [], affixes = gameData.affixes }) {
  const caster = unit('Caster', 5, 5);
  const everyone = [caster, ...foes, ...others];
  return findSmiteTargets(caster, smiteAbility, {
    grid,
    getUnitAt: occupancy(everyone, fog),
    enemies: foes,
    affixes,
  });
}
const landing = (target) => [target.destCol, target.destRow];

// --- data -----------------------------------------------------------------

describe('Smite and Transfuse data', () => {
  it('are action skills with the registry shape and the wording of the brief', () => {
    expect(SMITE).toMatchObject({
      name: 'Smite',
      description: 'Push an adjacent enemy 2 tiles away',
      trigger: 'action',
      actionAbility: { kind: 'push_enemy', distance: 2 },
    });
    expect(TRANSFUSE).toMatchObject({
      name: 'Transfuse',
      description: 'Give up to 10 HP to an adjacent ally',
      trigger: 'action',
      actionAbility: { kind: 'transfer_hp', amount: 10 },
    });
    for (const skill of [SMITE, TRANSFUSE]) {
      // Usable every turn: no per-battle limit; bodily acts, so silence does not stop them.
      expect(skill.actionAbility.perMapLimit).toBeUndefined();
      expect(skill.actionAbility.usableWhileSilenced).toBe(true);
      expect(ACTION_ABILITY_KINDS.has(skill.actionAbility.kind)).toBe(true);
      expect(TARGETED_ABILITY_KINDS.has(skill.actionAbility.kind)).toBe(true);
    }
  });

  it('a unit that knows them lists them as abilities', () => {
    const learner = unit('Learner', 1, 1, { skills: ['smite', 'transfuse', 'shove'] });
    expect(getActionAbilities(learner, gameData.skills).map((s) => s.id)).toEqual([
      'smite',
      'transfuse',
    ]);
  });

  describe('schema', () => {
    const validate = new Ajv({ allErrors: true }).compile(
      JSON.parse(readFileSync(path.join(path.resolve('schemas'), 'skills.schema.json'), 'utf-8')),
    );
    const skill = (actionAbility) => [
      { id: 'x', name: 'X', description: 'x', trigger: 'action', actionAbility },
    ];
    it('accepts the shipped shapes and keeps requiring a limit for the old kinds', () => {
      expect(validate(gameData.skills), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(skill({ kind: 'push_enemy', distance: 2 }))).toBe(true);
      expect(validate(skill({ kind: 'transfer_hp', amount: 10 }))).toBe(true);
      expect(validate(skill({ kind: 'aoe_root', radius: 2, durationPhases: 1 }))).toBe(false);
    });
    it('rejects a push with no distance and a transfer with no amount', () => {
      expect(validate(skill({ kind: 'push_enemy' }))).toBe(false);
      expect(validate(skill({ kind: 'push_enemy', distance: 0 }))).toBe(false);
      expect(validate(skill({ kind: 'transfer_hp' }))).toBe(false);
      expect(validate(skill({ kind: 'transfer_hp', amount: 10, usableWhileSilenced: 'yes' }))).toBe(
        false,
      );
    });
  });

  describe('scrolls and loot', () => {
    const scroll = (name) => gameData.weapons.find((w) => w.name === name);
    it.each([
      ['Smite Scroll', 'smite', 'Teaches Smite'],
      ['Transfuse Scroll', 'transfuse', 'Teaches Transfuse'],
    ])('%s teaches %s like every skill scroll', (name, skillId, special) => {
      expect(scroll(name)).toMatchObject({
        type: 'Scroll',
        skillId,
        special,
        price: 2500,
        tier: 'Rare',
        rankRequired: 'Prof',
      });
      expect(scroll(name).lore.length).toBeLessThanOrEqual(85);
    });

    /** Every `act/pool` path of lootTables.json whose list holds the item. */
    const poolsHolding = (item) =>
      Object.entries(gameData.lootTables).flatMap(([act, tables]) =>
        Object.entries(tables)
          .filter(([, list]) => Array.isArray(list) && list.includes(item))
          .map(([pool]) => `${act}/${pool}`),
      );

    it('sit in exactly the pools that hold Shove Scroll and Pull Scroll', () => {
      const shove = poolsHolding('Shove Scroll');
      expect(shove).toEqual(['act3/skillScroll', 'act4/skillScroll']);
      expect(poolsHolding('Pull Scroll')).toEqual(shove);
      expect(poolsHolding('Smite Scroll')).toEqual(shove);
      expect(poolsHolding('Transfuse Scroll')).toEqual(shove);
    });
  });

  describe('enemies never hold them', () => {
    it('no class lists them as a curriculum or innate skill', () => {
      for (const id of ['smite', 'transfuse']) {
        expect(skillById.get(id).classInnate).toBeUndefined();
        expect(skillById.get(id).personal).toBeUndefined();
        for (const cls of gameData.classes)
          expect(
            (cls.learnableSkills || []).some((entry) => entry.skillId === id),
            `${cls.name} learns ${id}`,
          ).toBe(false);
      }
    });

    it('a spawned enemy never knows one, whatever its class, level or act', () => {
      const known = new Set();
      for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss'])
        for (const cls of gameData.classes.filter((entry) => entry.baseStats))
          for (const level of [1, 8, 20])
            for (let roll = 0; roll < 3; roll++) {
              const enemy = createEnemyUnit(cls, level, gameData.weapons, 1, gameData.skills, act);
              for (const id of enemy.skills || []) known.add(id);
            }
      expect(known.has('smite')).toBe(false);
      expect(known.has('transfuse')).toBe(false);
      // The sweep did hand out skills, so the empty result means something.
      expect(known.size).toBeGreaterThan(0);
    });
  });
});

// --- Smite ----------------------------------------------------------------

describe('Smite: which foes and where they land', () => {
  it.each([
    ['north', [5, 4], [5, 2]],
    ['south', [5, 6], [5, 8]],
    ['west', [4, 5], [2, 5]],
    ['east', [6, 5], [8, 5]],
  ])('a foe to the %s goes 2 tiles straight away', (_side, at, expected) => {
    const target = foe('Brigand', ...at);
    const result = smite({ foes: [target] });
    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe(target);
    expect(landing(result[0])).toEqual(expected);
    expect(result[0].steps).toBe(2);
  });

  it('offers every adjacent foe, each with its own landing, and nothing diagonal or further', () => {
    const north = foe('N', 5, 4);
    const east = foe('E', 6, 5);
    const diagonal = foe('D', 6, 6);
    const reach = foe('R', 5, 7);
    const result = smite({ foes: [north, east, diagonal, reach] });
    expect(result.map((t) => t.unit.name).sort()).toEqual(['E', 'N']);
    expect(landing(result.find((t) => t.unit === north))).toEqual([5, 2]);
    expect(landing(result.find((t) => t.unit === east))).toEqual([8, 5]);
  });

  describe('a blocked first tile means the foe cannot be targeted', () => {
    it.each([
      ['an impassable tile', { grid: makeGrid({ cost: blockedTiles('7,5') }) }],
      ['the map edge', { grid: makeGrid({ cols: 7 }) }],
      ['an ally of the caster', { others: [unit('Ally', 7, 5)] }],
      ['another enemy', { others: [foe('Other', 7, 5)] }],
      ['a fogged tile (counts as taken)', { fog: ['7,5'] }],
    ])('%s', (_label, world) => {
      expect(smite({ foes: [foe('Brigand', 6, 5)], ...world })).toEqual([]);
    });

    it('but the same foe is a target when the first tile is free (control)', () => {
      expect(smite({ foes: [foe('Brigand', 6, 5)] })).toHaveLength(1);
    });
  });

  describe('a blocked second tile moves the foe one tile', () => {
    it.each([
      ['an impassable tile', { grid: makeGrid({ cost: blockedTiles('8,5') }) }],
      ['the map edge', { grid: makeGrid({ cols: 8 }) }],
      ['an ally of the caster', { others: [unit('Ally', 8, 5)] }],
      ['another enemy', { others: [foe('Other', 8, 5)] }],
      ['a fogged tile', { fog: ['8,5'] }],
    ])('%s', (_label, world) => {
      const [only] = smite({ foes: [foe('Brigand', 6, 5)], ...world });
      expect(landing(only)).toEqual([7, 5]);
      expect(only.steps).toBe(1);
    });
  });

  it('judges passability by the foe own move type, not the caster', () => {
    // Mountains: fliers cross them, infantry do not.
    const grid = makeGrid({ cost: (c, r, type) => (c === 7 && type !== 'Flying' ? Infinity : 1) });
    const walker = foe('Walker', 6, 5);
    const flier = foe('Flier', 6, 5, { moveType: 'Flying' });
    expect(smite({ foes: [walker], grid })).toEqual([]);
    expect(landing(smite({ foes: [flier], grid })[0])).toEqual([8, 5]);
  });

  describe('foes that cannot be moved', () => {
    const pinned = {
      'a boss': { isBoss: true },
      'an Anchored foe': { affixes: ['anchored'] },
      'a rooted foe': { _conditions: [{ id: 'root', turnsRemaining: 2 }] },
    };
    it.each(Object.entries(pinned))('%s is not a target', (_label, extra) => {
      expect(smite({ foes: [foe('Pinned', 6, 5, extra)] })).toEqual([]);
    });

    it('an ordinary foe, or one with an unrelated affix or status, is (control)', () => {
      const plain = foe('Plain', 6, 5, { affixes: ['shielded'], _conditions: [{ id: 'silence' }] });
      expect(smite({ foes: [plain] })).toHaveLength(1);
    });

    it('the Entity cannot be smitten from any tile of its footprint', () => {
      // A 3x3 body whose origin is up and left of the adjacent tile.
      const entity = foe('Entity', 6, 4, { isEntity: true, isBoss: false, footprint: 3 });
      expect(smiteBlockReason(entity, gameData.affixes)).toBe('entity');
      expect(smite({ foes: [entity] })).toEqual([]);
    });

    it('names why, in the order a player would read it', () => {
      expect(smiteBlockReason(foe('B', 1, 1, { isBoss: true }), gameData.affixes)).toBe('boss');
      expect(smiteBlockReason(foe('A', 1, 1, { affixes: ['anchored'] }), gameData.affixes)).toBe(
        'anchored',
      );
      expect(
        smiteBlockReason(foe('R', 1, 1, { _conditions: [{ id: 'root' }] }), gameData.affixes),
      ).toBe('rooted');
      expect(smiteBlockReason(foe('P', 1, 1), gameData.affixes)).toBeNull();
    });
  });

  it('ignores the dead and the departing', () => {
    expect(smite({ foes: [foe('Dead', 6, 5, { currentHP: 0 })] })).toEqual([]);
    expect(smite({ foes: [foe('Leaving', 6, 5, { _removing: true })] })).toEqual([]);
  });

  it('the distance is the data, and the foe stops where the ground does', () => {
    const grid = makeGrid();
    const target = foe('Brigand', 6, 5);
    const caster = unit('Caster', 5, 5);
    const ctx = { grid, getUnitAt: occupancy([caster, target]), enemies: [target] };
    expect(landing(findSmiteTargets(caster, { kind: 'push_enemy', distance: 1 }, ctx)[0])).toEqual([
      7, 5,
    ]);
    expect(landing(findSmiteTargets(caster, { kind: 'push_enemy', distance: 3 }, ctx)[0])).toEqual([
      9, 5,
    ]);
    // Asked for 4 with only 3 tiles of map left: the edge stops it, no error.
    expect(landing(findSmiteTargets(caster, { kind: 'push_enemy', distance: 4 }, ctx)[0])).toEqual([
      9, 5,
    ]);
  });

  it('is a pure read: finding targets moves nothing', () => {
    const target = foe('Brigand', 6, 5);
    const before = structuredClone(target);
    smite({ foes: [target] });
    expect(target).toEqual(before);
  });

  it('traceSmite reports no tile at all as null', () => {
    const grid = makeGrid({ cost: blockedTiles('7,5') });
    expect(traceSmite(foe('B', 6, 5), 1, 0, 2, grid, () => null)).toBeNull();
  });
});

describe('Smite: ground other than ice does nothing special (same as Shove)', () => {
  // Only Ice moves a pushed unit further (the forced slide: tests/ForcedSlide.test.js).
  // Slow or hot ground is a legal landing when the foe's move cost there is finite, and
  // the landing is exactly that tile: no damage on the way, the ground works on it at
  // the end of its own phase as after any move. This grid has no terrain table, so
  // nothing in it is ice.
  it('a foe is pushed onto costly ground and stays where the push put it, unhurt', () => {
    const slow = new Set(['7,5', '8,5']);
    const grid = makeGrid({ cost: (c, r) => (slow.has(`${c},${r}`) ? 2 : 1) });
    const target = foe('Brigand', 6, 5, { currentHP: 12 });
    const [entry] = smite({ foes: [target], grid });
    expect(landing(entry)).toEqual([8, 5]);
    settleSmite(entry);
    expect([target.col, target.row]).toEqual([8, 5]);
    expect(target.currentHP).toBe(12);
  });
});

describe('Smite: settling the push', () => {
  it('moves only the foe, by the offered landing, and costs nothing', () => {
    const caster = unit('Caster', 5, 5);
    const target = foe('Brigand', 6, 5);
    const [entry] = smite({ foes: [target] });
    const result = settleSmite(entry);
    expect([target.col, target.row]).toEqual([8, 5]);
    expect([caster.col, caster.row]).toEqual([5, 5]);
    expect(result.moves).toEqual([
      { unit: target, from: { col: 6, row: 5 }, to: { col: 8, row: 5 } },
    ]);
    expect(target.currentHP).toBe(20);
  });

  it('wakes a holding pack: the smitten holder is marked disturbed and the pack stands up', () => {
    const holder = foe('Holder', 6, 5, { aiMode: HOLD_AI_MODE, holdPack: 3, holdPackSize: 2 });
    const mate = foe('Mate', 9, 9, { aiMode: HOLD_AI_MODE, holdPack: 3, holdPackSize: 2 });
    // Quiet first: nothing has disturbed them and nobody threatens them.
    expect(
      wakeHolders({ enemyUnits: [holder, mate], playerUnits: [unit('Caster', 5, 5)] }),
    ).toEqual([]);
    const [entry] = smite({ foes: [holder] });
    settleSmite(entry);
    expect(holder.holdDisturbed).toBe('moved');
    const woken = wakeHolders({
      enemyUnits: [holder, mate],
      playerUnits: [unit('Caster', 5, 5)],
    });
    expect(woken.map((w) => [w.unit.name, w.reason])).toEqual([
      ['Holder', 'moved'],
      ['Mate', 'moved'],
    ]);
    expect(holder.aiMode).toBeUndefined();
    expect(mate.aiMode).toBeUndefined();
  });

  it('a foe that is not holding has no mark to carry', () => {
    const roamer = foe('Roamer', 6, 5);
    const [entry] = smite({ foes: [roamer] });
    settleSmite(entry);
    expect(roamer.holdDisturbed).toBeUndefined();
    // And the mark is first-reason-wins, as for any holder.
    const holder = foe('Holder', 6, 5, { aiMode: HOLD_AI_MODE });
    markHoldDisturbed(holder, 'hurt');
    settleSmite(smite({ foes: [holder] })[0]);
    expect(holder.holdDisturbed).toBe('hurt');
  });
});

// --- Transfuse ------------------------------------------------------------

describe('Transfuse: how much moves', () => {
  // [giver HP, ally HP, ally max HP, expected transfer]: min(10, giver - 1, ally missing)
  it.each([
    [25, 5, 30, 10], // plenty to give and plenty missing: the cap of 10
    [25, 20, 30, 10], // exactly 10 missing
    [25, 21, 30, 9], // 9 missing
    [25, 27, 30, 3], // an ally missing only 3 HP gets 3
    [25, 29, 30, 1],
    [11, 5, 30, 10], // giver can spare exactly 10
    [10, 5, 30, 9], // giver can spare 9
    [4, 5, 30, 3],
    [2, 5, 30, 1],
    [1, 5, 30, 0], // at 1 HP there is nothing to spare
    [25, 30, 30, 0], // full ally
    [25, 31, 30, 0], // never negative
  ])('giver %i HP, ally %i/%i gives %i', (giverHP, allyHP, allyMax, expected) => {
    const giver = unit('Giver', 5, 5, { currentHP: giverHP, stats: { HP: 40 } });
    const ally = unit('Ally', 6, 5, { currentHP: allyHP, stats: { HP: allyMax } });
    expect(transfuseAmount(giver, ally, transfuseAbility)).toBe(expected);
  });

  it('reads the cap from the data, not a constant', () => {
    const giver = unit('Giver', 5, 5, { currentHP: 40, stats: { HP: 40 } });
    const ally = unit('Ally', 6, 5, { currentHP: 1, stats: { HP: 40 } });
    expect(transfuseAmount(giver, ally, { kind: 'transfer_hp', amount: 4 })).toBe(4);
    expect(transfuseAmount(giver, ally, { kind: 'transfer_hp', amount: 25 })).toBe(25);
  });
});

describe('Transfuse: who can be given to', () => {
  const giver = unit('Giver', 5, 5, { currentHP: 20 });
  const wounded = (hp, extra = {}) => unit('Ally', 6, 5, { currentHP: hp, ...extra });
  const find = (allies, who = giver) => findTransfuseTargets(who, transfuseAbility, { allies });

  it('offers each hurt adjacent ally with the amount it would get', () => {
    const east = unit('East', 6, 5, { currentHP: 5 });
    const north = unit('North', 5, 4, { currentHP: 27 });
    expect(find([giver, east, north]).map((t) => [t.unit.name, t.amount])).toEqual([
      ['North', 3],
      ['East', 10],
    ]);
  });

  it.each([
    ['at full HP', wounded(30)],
    ['two tiles away', unit('Far', 7, 5, { currentHP: 5 })],
    ['diagonal', unit('Diagonal', 6, 6, { currentHP: 5 })],
    ['dead', wounded(0)],
    ['Wounded, so the HP could not land', wounded(5, { _conditions: [{ id: 'wounded' }] })],
  ])('not an ally %s', (_label, ally) => {
    expect(find([giver, ally])).toEqual([]);
  });

  it('never targets the giver themself, and nobody at all when the giver has 1 HP', () => {
    expect(find([giver])).toEqual([]);
    const spent = unit('Spent', 5, 5, { currentHP: 1 });
    expect(find([spent, wounded(5)], spent)).toEqual([]);
  });
});

describe('Transfuse: settling the transfer', () => {
  const run = ({ giverHP, allyHP, allyMax = 30, giverExtra = {}, allyExtra = {} }) => {
    const giver = unit('Giver', 5, 5, { currentHP: giverHP, stats: { HP: 40 }, ...giverExtra });
    const ally = unit('Ally', 6, 5, { currentHP: allyHP, stats: { HP: allyMax }, ...allyExtra });
    const [target] = findTransfuseTargets(giver, transfuseAbility, { allies: [giver, ally] });
    // No legal target means nothing is settled (the action is not offered).
    const facts = target ? settleTransfuse(giver, target, transfuseAbility) : { given: 0, paid: 0 };
    return { giver, ally, facts };
  };

  it.each([
    // giver, ally, -> giver after, ally after
    [25, 5, 15, 15],
    [25, 27, 22, 30], // ally missing 3: pays 3, not 10
    [4, 5, 1, 8], // spares 3, never drops below 1
    [2, 5, 1, 6],
    [11, 5, 1, 15], // pays exactly down to 1
  ])('giver %i, ally %i -> %i and %i', (giverHP, allyHP, giverAfter, allyAfter) => {
    const { giver, ally, facts } = run({ giverHP, allyHP });
    expect([giver.currentHP, ally.currentHP]).toEqual([giverAfter, allyAfter]);
    expect(facts.given).toBe(facts.paid);
    expect(facts.given).toBe(ally.currentHP - allyHP);
  });

  it('conserves HP: whatever the giver pays the ally receives, for every pairing', () => {
    for (let giverHP = 1; giverHP <= 40; giverHP += 3)
      for (let allyHP = 1; allyHP <= 30; allyHP += 2) {
        const { giver, ally, facts } = run({ giverHP, allyHP });
        expect(giver.currentHP, `${giverHP}/${allyHP}`).toBeGreaterThanOrEqual(1);
        expect(ally.currentHP, `${giverHP}/${allyHP}`).toBeLessThanOrEqual(30);
        expect(giver.currentHP + ally.currentHP).toBe(giverHP + allyHP);
        expect(facts.given).toBeLessThanOrEqual(10);
      }
  });

  it('goes through UnitHealth: filling the ally forgives its accessory HP debt', () => {
    // UnitHealth.settleAccessoryHpOwed: the debt is forgiven the moment a unit is full.
    const { ally } = run({ giverHP: 25, allyHP: 27, allyExtra: { _accessoryHpOwed: 2 } });
    expect(ally.currentHP).toBe(30);
    expect(ally._accessoryHpOwed).toBeUndefined();
  });

  it('a partly healed ally keeps its debt, as with any heal', () => {
    const { ally } = run({ giverHP: 25, allyHP: 5, allyExtra: { _accessoryHpOwed: 2 } });
    expect(ally.currentHP).toBe(15);
    expect(ally._accessoryHpOwed).toBe(2);
  });

  it('pays nothing if the ally could not take it (Wounded between pick and settle)', () => {
    const giver = unit('Giver', 5, 5, { currentHP: 25 });
    const ally = unit('Ally', 6, 5, { currentHP: 5, _conditions: [{ id: 'wounded' }] });
    const facts = settleTransfuse(giver, { unit: ally }, transfuseAbility);
    expect([giver.currentHP, ally.currentHP, facts.given, facts.paid]).toEqual([25, 5, 0, 0]);
  });
});

// --- availability ---------------------------------------------------------

describe('abilityHasTargets and canUseAbility', () => {
  const grid = makeGrid();
  it('Smite has targets when a legal foe is adjacent, Transfuse when a hurt ally is', () => {
    const caster = unit('Caster', 5, 5);
    const target = foe('Brigand', 6, 5);
    const hurt = unit('Hurt', 4, 5, { currentHP: 5 });
    const ctx = {
      grid,
      getUnitAt: occupancy([caster, target, hurt]),
      enemies: [target],
      allies: [caster, hurt],
      affixes: gameData.affixes,
    };
    expect(abilityHasTargets(caster, SMITE, ctx)).toBe(true);
    expect(abilityHasTargets(caster, TRANSFUSE, ctx)).toBe(true);
    expect(abilityHasTargets(caster, SMITE, { ...ctx, enemies: [] })).toBe(false);
    expect(abilityHasTargets(caster, TRANSFUSE, { ...ctx, allies: [caster] })).toBe(false);
  });

  it('are usable every turn, silenced or rooted; other abilities stay silenced', () => {
    const caster = unit('Caster', 5, 5, {
      _conditions: [
        { id: 'silence', turnsRemaining: 2 },
        { id: 'root', turnsRemaining: 2 },
      ],
    });
    expect(canUseAbility(caster, SMITE).ok).toBe(true);
    expect(canUseAbility(caster, TRANSFUSE).ok).toBe(true);
    expect(canUseAbility(caster, skillById.get('blink'))).toEqual({
      ok: false,
      reason: 'silenced',
    });
    // Used repeatedly, there is nothing to run out of.
    expect(canUseAbility({ ...caster, _battleAbilityUsage: { map: { smite: 9 } } }, SMITE).ok).toBe(
      true,
    );
  });
});
