// Epic weapons in a real battle (docs/specs/epic-weapons.md): every fight runs the real combat
// and the real post-combat generator through BattleScene and through the headless harness, and
// both must agree. Numbers are worked by hand:
//   Edric: STR 12, MAG 12, SKL 40, LCK 5, SPD 9, HP 40.
//   A foe: DEF 4, RES 3, SPD 9, LCK 20, HP 60, unarmed (it never counters).
//   Hit = weapon hit + 80 + 5 - (18 + 20) = weapon hit + 47: every weapon here hits (>= 65 Hit).
//   Crit = 20 + weapon crit - 20 = the weapon's crit: 0 for every weapon used here.
//   Attack speed never reaches the foe's 9 + 5, so Edric never doubles; one strike each fight.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { hasCondition } from '../src/engine/StatusConditionSystem.js';
import { calculateKillReward } from '../src/engine/LootSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

const catalogWeapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const body = { HP: 40, STR: 12, MAG: 12, SKL: 40, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };

function makeEdric(weaponName, { hp = 40, col = 0, row = 0 } = {}) {
  const weapon = catalogWeapon(weaponName);
  return {
    name: 'Edric',
    level: 5,
    tier: 'base',
    faction: 'player',
    col,
    row,
    xp: 0,
    currentHP: hp,
    stats: { ...body },
    moveType: 'Infantry',
    className: 'Myrmidon',
    growths: {},
    weaponRank: 'Mast',
    weapon,
    inventory: [weapon],
    proficiencies: ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light'].map((type) => ({
      type,
      rank: 'Mast',
    })),
    skills: [],
    accessory: null,
    affixes: [],
    isCommander: true,
    isLord: true,
    _gambitUsedThisTurn: true,
  };
}
function makeFoe(
  name,
  col,
  { hp = 60, maxHp = 60, row = 0, className = 'Soldier', lck = 20 } = {},
) {
  return {
    name,
    level: 5,
    tier: 'base',
    faction: 'enemy',
    className,
    col,
    row,
    currentHP: hp,
    moveType: 'Infantry',
    stats: { HP: maxHp, STR: 5, MAG: 0, SKL: 5, SPD: 9, DEF: 4, RES: 3, LCK: lck, MOV: 5 },
    weapon: null,
    inventory: [],
    skills: [],
    accessory: null,
    affixes: [],
  };
}
// Keeps a rout from ending when the foe under test falls.
const bystander = () => makeFoe('Bystander', 7, { row: 7 });

/** The battle through BattleScene: real executeCombat, no drawing. */
function sceneWorld(players, enemies) {
  const scene = journeyBattleScene({}, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = players;
  scene.enemyUnits = enemies;
  rendering(scene, 0);
  scene._getSelectedWeaponArtForUnit = () => null;
  scene.animateStrike = async () => {};
  scene.animateSkillActivation = async () => {};
  scene._battleBeats.checkBossHalfHealth = async () => {};
  scene._battleBeats.onChipLance = () => {};
  scene._battleBeats.onLowHealth = () => {};
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  scene.onVictory = () => {
    scene.battleState = 'BATTLE_END';
  };
  scene.onDefeat = () => {
    scene.battleState = 'BATTLE_END';
  };
  scene.awardScaledXP = async () => {};
  const revealed = [];
  scene.grid.revealContact = (tiles) => revealed.push(...tiles);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return {
    revealed,
    turnStart: async (units, turn) => {
      scene.turnManager.turnNumber = turn;
      await scene.processTurnStartEffects(units);
    },
    enemyTurnStart: async (turn) => {
      scene.turnManager.turnNumber = turn;
      await scene.processTurnStartEffects(scene.enemyUnits);
    },
    gold: () => scene.goldEarned,
    // The scene pays kill gold only inside a run.
    inRun: () => {
      scene.runManager = {};
    },
    attack: (attacker, defender) => scene.executeCombat(attacker, defender),
  };
}

/** The same battle through the headless harness. */
function harnessWorld(players, enemies) {
  const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1, unitActed() {} };
  battle.battleConfig = { objective: 'rout' };
  battle.turnPar = 99;
  battle.goldEarned = 0;
  battle.playerUnits = players;
  battle.enemyUnits = enemies;
  battle.npcUnits = [];
  battle.grid = {
    cols: 8,
    rows: 8,
    fogEnabled: false,
    getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    getMoveCost: () => 1,
    updateFogOfWar() {},
  };
  const revealed = [];
  battle.grid.revealContact = (tiles) => revealed.push(...tiles);
  battle._grantScaledXP = () => {};
  return {
    revealed,
    turnStart: async (units, turn) => {
      battle.turnManager.turnNumber = turn;
      battle._processTurnStartEffects(units);
    },
    enemyTurnStart: async (turn) => {
      battle.turnManager.turnNumber = turn;
      battle._processTurnStartEffects(battle.enemyUnits);
    },
    gold: () => battle.goldEarned,
    inRun: () => {},
    attack: async (attacker, defender) => {
      battle.selectedUnit = attacker;
      const prev = Math.random;
      Math.random = () => 0.5;
      try {
        battle._executeCombat(attacker, defender);
      } finally {
        Math.random = prev;
      }
    },
  };
}

const WORLDS = [
  ['the scene', sceneWorld],
  ['the harness', harnessWorld],
];

describe.each(WORLDS)('Epic weapons through %s', (_label, makeWorld) => {
  it('Prodding Spear pushes the foe a tile after a hit it starts', async () => {
    const edric = makeEdric('Prodding Spear');
    const foe = makeFoe('Target', 1);
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    // 12 + 7 - 4 = 15.
    expect(foe.currentHP).toBe(45);
    expect([foe.col, foe.row]).toEqual([2, 0]);
    expect([edric.col, edric.row]).toEqual([0, 0]);
  });

  it('Haulhook pulls a foe struck from range a tile closer', async () => {
    const edric = makeEdric('Haulhook');
    const foe = makeFoe('Target', 2);
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    // 12 + 9 - 4 = 17.
    expect(foe.currentHP).toBe(43);
    expect([foe.col, foe.row]).toEqual([1, 0]);
  });

  it("Pilgrim's Lamp mends its wielder 3 after a combat it hit in", async () => {
    const edric = makeEdric("Pilgrim's Lamp", { hp: 20 });
    const foe = makeFoe('Target', 1);
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    // MAG 12 + 5 - RES 3 = 14.
    expect(foe.currentHP).toBe(46);
    expect(edric.currentHP).toBe(23);
  });

  it('Sealed Orders silences the foe it hits and costs its wielder 3 HP', async () => {
    const edric = makeEdric('Sealed Orders');
    const foe = makeFoe('Target', 2);
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    // MAG 12 + 9 - RES 3 = 18.
    expect(foe.currentHP).toBe(42);
    expect(hasCondition(foe, 'silence')).toBe(true);
    expect(edric.currentHP).toBe(37);
  });

  it('Treatybreaker hits a foe at full HP for 5 more', async () => {
    const edric = makeEdric('Treatybreaker');
    const fresh = makeFoe('Fresh', 1);
    const hurt = makeFoe('Hurt', 1, { hp: 59, row: 2 });
    const world = makeWorld([edric], [fresh, hurt, bystander()]);
    await world.attack(edric, fresh);
    // 12 + 10 - 4 = 18, + 5 at full HP.
    expect(fresh.currentHP).toBe(60 - 23);
    edric.col = 0;
    edric.row = 2;
    await world.attack(edric, hurt);
    expect(hurt.currentHP).toBe(59 - 18);
  });

  it('Daybreak strikes a wyvern for three times its Might', async () => {
    const edric = makeEdric('Daybreak');
    // LCK 30 cancels Daybreak's 10 Crit (20 + 10 - 30 = 0); Hit stays above 100.
    const wyvern = makeFoe('Wyvern', 1, { className: 'Wyvern Rider', lck: 30 });
    const soldier = makeFoe('Soldier', 1, { row: 2, lck: 30 });
    const world = makeWorld([edric], [wyvern, soldier, bystander()]);
    await world.attack(edric, wyvern);
    // 12 + 13 x 3 - 4 = 47; the same blow lands on the soldier without the multiplier.
    expect(wyvern.currentHP).toBe(60 - 47);
    edric.row = 2;
    await world.attack(edric, soldier);
    expect(soldier.currentHP).toBe(60 - 21);
  });

  it("Tollkeeper's Knife pays 150 gold more for its kill", async () => {
    const edric = makeEdric("Tollkeeper's Knife");
    const foe = makeFoe('Target', 1, { hp: 1, maxHp: 30 });
    const world = makeWorld([edric], [foe, bystander()]);
    world.inRun();
    const before = world.gold();
    await world.attack(edric, foe);
    expect(foe.currentHP).toBe(0);
    const plain = calculateKillReward(foe, null, { rewardMultiplier: 1 });
    expect(world.gold() - before).toBe(plain + 150);
  });

  it('Frightened Acclaim strikes 3 harder after a kill this battle', async () => {
    const edric = makeEdric('Frightened Acclaim');
    const first = makeFoe('First', 1, { hp: 1, lck: 25 });
    const second = makeFoe('Second', 1, { row: 2, lck: 25 });
    const world = makeWorld([edric], [first, second, bystander()]);
    await world.attack(edric, first);
    expect(first.currentHP).toBe(0);
    expect(edric._epicBattleKills).toBe(1);
    edric.row = 2;
    await world.attack(edric, second);
    // 12 + 11 - 4 = 19, + 3 for the kill.
    expect(second.currentHP).toBe(60 - 22);
  });

  it('Tallyblade notches each kill and gains on the fourth', async () => {
    const edric = makeEdric('Tallyblade');
    const before = { might: edric.weapon.might, crit: edric.weapon.crit, hit: edric.weapon.hit };
    const foes = [0, 2, 4, 6].map((row) => makeFoe(`F${row}`, 1, { hp: 1, row }));
    const world = makeWorld([edric], [...foes, bystander()]);
    for (const [i, target] of foes.entries()) {
      edric.row = target.row;
      await world.attack(edric, target);
      expect(target.currentHP).toBe(0);
      expect(edric.weapon._tally.kills).toBe(i + 1);
    }
    const w = edric.weapon;
    const gained = (w.might - before.might) * 5 + (w.crit - before.crit) + (w.hit - before.hit);
    // One gain in four kills: +1 Mt (counted as 5 here), +5 Crit or +5 Hit.
    expect(gained).toBe(5);
  });

  it('Gorgemaw is fed by a kill and goes hungry the turn after it does not kill', async () => {
    const edric = makeEdric('Gorgemaw', { hp: 40 });
    const foe = makeFoe('Target', 1, { hp: 1 });
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    expect(foe.currentHP).toBe(0);
    await world.turnStart([edric], 2);
    expect(edric.currentHP).toBe(40);
    // Turn 3: nothing killed on turn 2. 15% of 40 = 6.
    await world.turnStart([edric], 3);
    expect(edric.currentHP).toBe(34);
  });

  it('Holder of the Breach slows the foe beside it as the enemy phase starts', async () => {
    const edric = makeEdric('Holder of the Breach');
    const beside = makeFoe('Beside', 1);
    const far = makeFoe('Far', 3);
    const world = makeWorld([edric], [beside, far, bystander()]);
    // The army's own phase start slows nobody.
    await world.turnStart([edric], 2);
    expect(beside.stats.MOV).toBe(5);
    await world.enemyTurnStart(2);
    expect(beside.stats.MOV).toBe(3);
    expect(far.stats.MOV).toBe(5);
  });

  it('Wakelight keeps the foe it hits shown, and Hollowsong is stamped once it strikes', async () => {
    const edric = makeEdric('Wakelight');
    const foe = makeFoe('Target', 2);
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    // MAG 12 + 5 - RES 3 = 14.
    expect(foe.currentHP).toBe(46);
    expect(world.revealed).toEqual([{ col: 2, row: 0 }]);
    const sage = makeEdric('Hollowsong');
    const other = makeFoe('Other', 2);
    const second = makeWorld([sage], [other, bystander()]);
    await second.attack(sage, other);
    expect(other.currentHP).toBe(60 - (12 + 13 - 3));
    expect(sage.weapon._epicBattleUsed).toBe(true);
  });

  it('Futuresold strikes with its +2 Atk', async () => {
    const edric = makeEdric('Futuresold');
    const foe = makeFoe('Target', 1, { lck: 25 });
    const world = makeWorld([edric], [foe, bystander()]);
    await world.attack(edric, foe);
    // 12 + 12 + 2 - 4 = 22.
    expect(foe.currentHP).toBe(38);
  });
});
