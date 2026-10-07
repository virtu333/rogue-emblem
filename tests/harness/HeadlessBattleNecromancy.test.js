// The Necromancer in the headless battle (rules: engine/Necromancy.js; the scene drives the
// same rules through ui/NecromancyController.js). Ways this breaks:
//   - a raise happens above two Skeletons, on the wrong tile, or onto a blocked one
//   - a raise draws from the battle's Math.random (so a replay would shift the battle)
//   - one Necromancer's fall crumbles another's Skeletons (or its own survive)
//   - a Skeleton pays gold, a full share of XP, or feeds a kill deed
//   - a Rout is not won when the Necromancer was the last living foe
//   - a risen Zombie pays gold in sims (the harness lacked the scene's `_noXP` check)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameDriver } from './GameDriver.js';
import {
  createEnemyUnit,
  createPromotedEnemyUnit,
  createUnit,
  calculateCombatXP,
} from '../../src/engine/UnitManager.js';
import { calculateKillReward } from '../../src/engine/LootSystem.js';
import { recordKill, beginBattleDeeds } from '../../src/engine/DeedSystem.js';
import { buildRisenUnit, createRemains } from '../../src/engine/ZombieRemains.js';
import { isRaisedUnit, skeletonsOf } from '../../src/engine/Necromancy.js';
import { registerBattleEntity } from '../../src/engine/BattleEntityIdentity.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

const data = loadGameData();
const classOf = (name) => data.classes.find((c) => c.name === name);
const LEFT_RIGHT_UP_DOWN = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

/** A rout with Edric alone and the enemies replaced by what the test places. */
function emptyRout(seed = 7, params = {}) {
  installSeed(seed);
  const driver = new GameDriver(data, {
    act: 'act4',
    objective: 'rout',
    battleSeed: seed,
    difficultyId: 'lunatic',
    ...params,
  });
  driver.init();
  const b = driver.battle;
  b.battleConfig.reinforcements = null;
  const edric = b.playerUnits.find((u) => u.name === 'Edric');
  b.playerUnits.splice(0, b.playerUnits.length, edric);
  b.enemyUnits.splice(0, b.enemyUnits.length);
  return { driver, b, edric };
}

function necromancerAt(b, col, row, level = 15) {
  const unit = createPromotedEnemyUnit(
    classOf('Necromancer'),
    level,
    data.weapons,
    1,
    data.skills,
    'act4',
    data.classes,
  );
  Object.assign(unit, { col, row, aiMode: 'guard' });
  b.enemyUnits.push(unit);
  registerBattleEntity(b, unit);
  return unit;
}

const passable = (b, col, row) => {
  const cost = b.grid.getTerrainAt(col, row)?.moveCost?.Infantry;
  return cost !== undefined && cost !== null && cost !== '--';
};
const inBounds = (b, col, row) =>
  col >= 0 && row >= 0 && col < b.battleConfig.cols && row < b.battleConfig.rows;

/** A tile with four free passable neighbours, far from Edric. */
function openSpot(b, edric) {
  for (let row = 1; row < b.battleConfig.rows - 1; row++)
    for (let col = 1; col < b.battleConfig.cols - 1; col++) {
      if (Math.abs(col - edric.col) + Math.abs(row - edric.row) < 4) continue;
      const around = LEFT_RIGHT_UP_DOWN.map(([dc, dr]) => [col + dc, row + dr]);
      if (
        passable(b, col, row) &&
        around.every(([c, r]) => passable(b, c, r) && !b.getUnitAt(c, r))
      )
        return { col, row };
    }
  throw new Error('no open spot on this map');
}

describe('HeadlessBattle: raising', () => {
  it('raises one Skeleton per phase onto the first free neighbour, and stops at two', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    const phases = [];
    for (let i = 0; i < 4; i++) {
      b._processNecromancy();
      phases.push(skeletonsOf(necro, b.enemyUnits).map((s) => [s.col, s.row]));
    }
    // Left, right, up, down: the first free passable one, then the next.
    expect(phases[0]).toEqual([[spot.col - 1, spot.row]]);
    expect(phases[1]).toEqual([
      [spot.col - 1, spot.row],
      [spot.col + 1, spot.row],
    ]);
    expect(phases[2]).toEqual(phases[1]); // two stand: nothing more is raised
    expect(phases[3]).toEqual(phases[1]);
    expect(b.enemyUnits).toHaveLength(3);
  });

  it('raises again once a Skeleton falls, and never onto an occupied or impassable tile', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    // Block left with an ally unit and up by making the tile impassable for the test.
    const blocker = createEnemyUnit(classOf('Fighter'), 3, data.weapons, 1, data.skills, 'act4');
    Object.assign(blocker, { col: spot.col - 1, row: spot.row });
    b.enemyUnits.push(blocker);
    b.grid.getTerrainAt = ((orig) => (c, r) =>
      c === spot.col + 1 && r === spot.row
        ? { ...orig(c, r), moveCost: { Infantry: '--' } }
        : orig(c, r))(b.grid.getTerrainAt.bind(b.grid));
    b._processNecromancy();
    const [first] = skeletonsOf(necro, b.enemyUnits);
    // Left is held, right is impassable: the first free passable one is up.
    expect([first.col, first.row]).toEqual([spot.col, spot.row - 1]);
    b._processNecromancy();
    const second = skeletonsOf(necro, b.enemyUnits).find((s) => s !== first);
    expect([second.col, second.row]).toEqual([spot.col, spot.row + 1]);
    // Both stand; one falls to Edric: the next phase raises one more.
    b._removeUnit(first, { killer: edric });
    expect(skeletonsOf(necro, b.enemyUnits)).toHaveLength(1);
    b._processNecromancy();
    expect(skeletonsOf(necro, b.enemyUnits)).toHaveLength(2);
  });

  it('raises nothing when all four neighbours are taken or off the map', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    for (const [dc, dr] of LEFT_RIGHT_UP_DOWN) {
      const filler = createEnemyUnit(classOf('Fighter'), 3, data.weapons, 1, data.skills, 'act4');
      Object.assign(filler, { col: spot.col + dc, row: spot.row + dr });
      b.enemyUnits.push(filler);
    }
    const before = b.enemyUnits.length;
    b._processNecromancy();
    expect(b.enemyUnits).toHaveLength(before);
    // A Necromancer on the map's corner has only two neighbours in bounds.
    const corner = emptyRout(9);
    const lone = necromancerAt(corner.b, 0, 0);
    const open = LEFT_RIGHT_UP_DOWN.map(([dc, dr]) => [dc, dr]).find(
      ([dc, dr]) => inBounds(corner.b, dc, dr) && passable(corner.b, dc, dr),
    );
    corner.b._processNecromancy();
    const [sk] = skeletonsOf(lone, corner.b.enemyUnits);
    if (open) expect([sk.col, sk.row]).toEqual([open[0], open[1]]);
    else expect(sk).toBeUndefined();
    expect(necro.currentHP).toBeGreaterThan(0);
  });

  it('draws nothing from Math.random: the battle stream does not move', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    const random = vi.spyOn(Math, 'random');
    b._processNecromancy();
    b._processNecromancy();
    expect(skeletonsOf(necro, b.enemyUnits)).toHaveLength(2);
    expect(random).not.toHaveBeenCalled();
  });

  it('the same raise (necromancer, turn, seed) builds the same Skeleton; another turn another', () => {
    const build = (turn, seed = 7) => {
      const { b, edric } = emptyRout(seed);
      const spot = openSpot(b, edric);
      const necro = necromancerAt(b, spot.col, spot.row);
      b.turnManager.turnNumber = turn;
      b._processNecromancy();
      const [sk] = skeletonsOf(necro, b.enemyUnits);
      return { sk, necro };
    };
    const a = build(3);
    const again = build(3);
    expect(again.sk).toEqual(a.sk);
    const weapons = new Set();
    for (let turn = 1; turn <= 30; turn++) weapons.add(build(turn).sk.weapon.name);
    expect([...weapons].sort()).toEqual(['Iron Bow', 'Iron Lance', 'Iron Sword']);
  });

  it('builds a base-class Skeleton four levels under its Necromancer, acting this phase', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row, 16);
    necro.level = 9; // a promoted unit's own level counts from 1: a 9 is a veteran
    b._processNecromancy();
    const [sk] = skeletonsOf(necro, b.enemyUnits);
    expect(sk).toMatchObject({
      className: 'Skeleton',
      tier: 'base',
      faction: 'enemy',
      hasActed: false,
      hasMoved: false,
      _raisedBy: necro.battleEntityId,
      isBoss: false,
      consumables: [],
      accessory: null,
      level: 5,
    });
    expect(sk.inventory).toEqual([sk.weapon]); // one Iron weapon and nothing else
    expect(sk.weapon.tier).toBe('Iron');
    expect(sk.currentHP).toBe(sk.stats.HP);
    expect(sk.battleEntityId).toMatch(/^u\d+$/);
    expect(isRaisedUnit(sk)).toBe(true);
    expect(isRaisedUnit(necro)).toBe(false);
    // The floor: a Necromancer under level 5 raises a level 1 Skeleton.
    const { b: b2, edric: e2 } = emptyRout(8);
    const spot2 = openSpot(b2, e2);
    const young = necromancerAt(b2, spot2.col, spot2.row);
    young.level = 3;
    b2._processNecromancy();
    expect(skeletonsOf(young, b2.enemyUnits)[0].level).toBe(1);
  });

  it("the Skeleton raised at the phase start is in the AI's list and has not acted", async () => {
    const { driver, b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    edric.col = spot.col + 3;
    edric.row = spot.row;
    const seen = [];
    const run = b.aiController.processEnemyPhase.bind(b.aiController);
    b.aiController.processEnemyPhase = (enemies, ...rest) => {
      seen.push(enemies.map((e) => ({ unit: e, hasActed: e.hasActed })));
      return run(enemies, ...rest);
    };
    await driver.step({ type: 'end_turn', payload: {} });
    const raised = seen[0].filter((entry) => entry.unit._raisedBy === necro.battleEntityId);
    expect(raised).toHaveLength(1);
    expect(raised[0].hasActed).toBe(false);
  });
});

describe('HeadlessBattle: the lifetime cap', () => {
  it('raises six in all and never a seventh, however many it fields', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    let raised = 0;
    for (let phase = 1; phase <= 20; phase++) {
      b.turnManager.turnNumber = phase;
      const before = b.enemyUnits.length;
      b._processNecromancy();
      raised += b.enemyUnits.length - before;
      // Every Skeleton falls at once: a Necromancer with none standing always wants one.
      for (const sk of skeletonsOf(necro, b.enemyUnits)) b._removeUnit(sk, { killer: edric });
    }
    expect(raised).toBe(6);
    expect(necro._raisedCount).toBe(6);
    expect(skeletonsOf(necro, b.enemyUnits)).toEqual([]);
    b._processNecromancy();
    expect(skeletonsOf(necro, b.enemyUnits)).toEqual([]);
  });

  it('the cap counts raises, not Skeletons standing: it stops at six with two on the field', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    necro._raisedCount = 5;
    b._processNecromancy();
    expect(skeletonsOf(necro, b.enemyUnits)).toHaveLength(1);
    b._processNecromancy(); // would be the seventh in a battle's life: it is the sixth, stops
    expect(skeletonsOf(necro, b.enemyUnits)).toHaveLength(1);
    expect(necro._raisedCount).toBe(6);
  });

  it('each Necromancer has its own count', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const a = necromancerAt(b, spot.col, spot.row);
    a._raisedCount = 6;
    const other = { col: spot.col, row: spot.row };
    let second = null;
    for (let row = 1; row < b.battleConfig.rows - 1 && !second; row++)
      for (let col = 1; col < b.battleConfig.cols - 1 && !second; col++) {
        const around = LEFT_RIGHT_UP_DOWN.map(([dc, dr]) => [col + dc, row + dr]);
        if (
          Math.abs(col - other.col) + Math.abs(row - other.row) >= 6 &&
          Math.abs(col - edric.col) + Math.abs(row - edric.row) >= 3 &&
          passable(b, col, row) &&
          !b.getUnitAt(col, row) &&
          around.every(([c, r]) => passable(b, c, r) && !b.getUnitAt(c, r))
        )
          second = { col, row };
      }
    const c = necromancerAt(b, second.col, second.row);
    b._processNecromancy();
    expect(skeletonsOf(a, b.enemyUnits)).toEqual([]);
    expect(skeletonsOf(c, b.enemyUnits)).toHaveLength(1);
  });

  it('total Skeleton XP over a battle fought to the last turn is at most six quarter-kills', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    necro.level = 5; // Skeletons of level 1
    // A level 1 recruit takes every kill: raw 40 XP, a quarter is 10, the most one can pay.
    b.battleParams.xpMultiplier = 1;
    b.turnPar = null;
    Object.assign(edric, { level: 1, tier: 'base', xp: 0 });
    const perKill = Math.floor(calculateCombatXP(edric, { ...skeletonProbe(), level: 1 }, true) * 0.25); // prettier-ignore
    expect(perKill).toBe(10);
    let total = 0;
    for (let turn = 1; turn <= 40; turn++) {
      b.turnManager.turnNumber = turn;
      b._processNecromancy();
      for (const sk of skeletonsOf(necro, b.enemyUnits)) {
        const xp0 = edric.xp + (edric.level - 1) * 100;
        b._awardCombatXP(edric, sk, true, null, null);
        total += edric.xp + (edric.level - 1) * 100 - xp0;
        b._removeUnit(sk, { killer: edric });
      }
    }
    expect(necro._raisedCount).toBe(6);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(6 * perKill);
  });
});

/** A raised Skeleton's shape, for XP arithmetic. */
const skeletonProbe = () => ({
  className: 'Skeleton',
  faction: 'enemy',
  tier: 'base',
  _raisedBy: 'u1',
});

describe('HeadlessBattle: crumbling', () => {
  function twoNecromancers() {
    const { b, edric } = emptyRout();
    // Two open spots far apart.
    const first = openSpot(b, edric);
    const a = necromancerAt(b, first.col, first.row);
    let second = null;
    for (let row = 1; row < b.battleConfig.rows - 1 && !second; row++)
      for (let col = 1; col < b.battleConfig.cols - 1 && !second; col++) {
        const around = LEFT_RIGHT_UP_DOWN.map(([dc, dr]) => [col + dc, row + dr]);
        if (
          Math.abs(col - first.col) + Math.abs(row - first.row) >= 6 &&
          Math.abs(col - edric.col) + Math.abs(row - edric.row) >= 3 &&
          passable(b, col, row) &&
          !b.getUnitAt(col, row) &&
          around.every(([c, r]) => passable(b, c, r) && !b.getUnitAt(c, r))
        )
          second = { col, row };
      }
    const c = necromancerAt(b, second.col, second.row);
    for (let i = 0; i < 2; i++) b._processNecromancy();
    return { b, edric, a, c };
  }

  it('only its own Skeletons crumble when two Necromancers stand (constructed)', () => {
    const { b, edric, a, c } = twoNecromancers();
    expect(skeletonsOf(a, b.enemyUnits)).toHaveLength(2);
    expect(skeletonsOf(c, b.enemyUnits)).toHaveLength(2);
    const survivors = skeletonsOf(c, b.enemyUnits);
    const gold = b.goldEarned;
    b._removeUnit(a, { killer: edric });
    expect(skeletonsOf(a, b.enemyUnits)).toEqual([]);
    expect(b.enemyUnits.filter((u) => u._raisedBy === a.battleEntityId)).toEqual([]);
    expect(skeletonsOf(c, b.enemyUnits)).toEqual(survivors);
    expect(b.enemyUnits).toContain(c);
    // No gold for the crumbled Skeletons: only the Necromancer's own kill reward.
    expect(b.goldEarned - gold).toBe(calculateKillReward(a, edric, { rewardMultiplier: 1 }));
  });

  it('a Necromancer removed with no killer (poison, lava) crumbles its Skeletons too', () => {
    const { b, a, c } = twoNecromancers();
    b._removeUnit(c, {});
    expect(skeletonsOf(c, b.enemyUnits)).toEqual([]);
    expect(skeletonsOf(a, b.enemyUnits)).toHaveLength(2);
  });

  it('a Rout is won when the Necromancer was the last living foe (its Skeletons crumble first)', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    b._processNecromancy();
    b._processNecromancy();
    expect(b.enemyUnits).toHaveLength(3);
    b._removeUnit(necro, { killer: edric });
    expect(b.enemyUnits).toEqual([]);
    expect(b._checkBattleEnd()).toBe(true);
    expect(b.result).toBe('victory');
  });

  it('killing the Skeletons first does not win the Rout while the Necromancer stands', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    b._processNecromancy();
    b._processNecromancy();
    for (const sk of skeletonsOf(necro, b.enemyUnits)) b._removeUnit(sk, { killer: edric });
    expect(b.enemyUnits).toEqual([necro]);
    expect(b._checkBattleEnd()).toBe(false);
  });
});

describe('HeadlessBattle: what a Skeleton pays', () => {
  it('no gold on a kill, a quarter of the XP, and no deed record', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    b._processNecromancy();
    const [sk] = skeletonsOf(necro, b.enemyUnits);
    expect(b._getEnemyRewardMultiplier(sk)).toBe(0);
    expect(b._getEnemyXpMultiplier(sk)).toBe(0.25);
    expect(b._getEnemyXpMultiplier(necro)).toBe(1);
    const gold = b.goldEarned;
    b._removeUnit(sk, { killer: edric });
    expect(b.goldEarned).toBe(gold);

    // The same kill of an ordinary enemy of that level pays.
    const grunt = createEnemyUnit(classOf('Fighter'), 8, data.weapons, 1, data.skills, 'act4');
    b.enemyUnits.push(grunt);
    b._removeUnit(grunt, { killer: edric });
    expect(b.goldEarned).toBeGreaterThan(gold);

    // Deeds: the kill counts, the terrain and weapon tallies do not.
    const hero = createUnit(classOf('Fighter'), 5, data.weapons, { name: 'Hero' });
    const victim = { ...sk, faction: 'enemy' };
    recordKill(victim, hero, { terrain: 'Plains' });
    const tallies = beginBattleDeeds(hero);
    expect(tallies.kills).toBe(1);
    expect(tallies.killsByTerrain).toEqual({});
    expect(tallies.killsByWeapon).toEqual({});
  });

  it('a killing blow on a Skeleton pays a quarter of the XP the same blow pays on a plain foe', () => {
    const { b, edric } = emptyRout();
    const spot = openSpot(b, edric);
    const necro = necromancerAt(b, spot.col, spot.row);
    b._processNecromancy();
    const [sk] = skeletonsOf(necro, b.enemyUnits);
    const plain = { ...sk };
    delete plain._raisedBy;
    // This rung's own XP scale and the par bonus would blur the quarter.
    b.battleParams.xpMultiplier = 1;
    b.turnPar = null;
    Object.assign(edric, { level: 1, tier: 'base', xp: 0 }); // a level 1 recruit: raw XP 40
    const level0 = edric.level;
    const earned = (victim) => {
      edric.level = level0;
      edric.xp = 0;
      b._awardCombatXP(edric, victim, true, null, null);
      return (edric.level - level0) * 100 + edric.xp;
    };
    const base = calculateCombatXP(edric, sk, true);
    expect(base).toBeGreaterThan(8); // a number big enough for the quarter to show
    expect(earned(plain)).toBe(base);
    expect(earned(sk)).toBe(Math.floor(base * 0.25));
  });
});

describe('HeadlessBattle: a risen Zombie pays no gold (parity with the scene)', () => {
  it('a revived Zombie falls for nothing; a plain Zombie pays', () => {
    const { b, edric } = emptyRout(11, { act: 'act2' });
    const zombie = createEnemyUnit(classOf('Zombie'), 5, data.weapons, 1, data.skills, 'act2');
    const risen = buildRisenUnit(createRemains(zombie, { col: 2, row: 2 }), { col: 3, row: 3 });
    expect(risen._noXP).toBe(true);
    b.enemyUnits.push(risen);
    const gold = b.goldEarned;
    b._removeUnit(risen, { killer: edric });
    expect(b.goldEarned).toBe(gold);
    b.enemyUnits.push(zombie);
    b._removeUnit(zombie, { killer: edric });
    expect(b.goldEarned).toBeGreaterThan(gold);
  });
});
