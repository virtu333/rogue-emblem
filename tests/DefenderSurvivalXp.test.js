// A player unit that is attacked and survives earns combat XP even when it could not
// counter or dealt no damage: at least XP_DEFEND_SURVIVE (1, Fire Emblem's minimum and
// the combat formula's XP_MIN floor), before the battle-wide par / difficulty /
// blessing / trait multipliers of awardScaledXP. A player who ATTACKS and deals no
// damage still earns nothing, and a Mentor's Band shares only XP earned by damage.
//
// Every expected number is worked out by hand in the comment beside it.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { XP_DEFEND_SURVIVE, XP_MIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const plain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };
const AXE = {
  name: 'Test Axe',
  type: 'Axe',
  might: 8,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
  rankRequired: 'Prof',
};
const BOW = { ...AXE, name: 'Test Bow', type: 'Bow', range: '2' };
const SWORD = { ...AXE, name: 'Test Sword', type: 'Sword', might: 0 };

/** Level 5 sword fighter, 30 HP, DEF 3; SPD 5 + LCK 30 → avoid 40. */
function defender(extra = {}) {
  return {
    name: 'Bare',
    faction: 'player',
    className: 'Myrmidon',
    level: 5,
    xp: 0,
    col: 2,
    row: 2,
    moveType: 'Infantry',
    currentHP: 30,
    stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 5, DEF: 3, RES: 1, LCK: 30, MOV: 5 },
    growths: {},
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    inventory: [],
    consumables: [],
    weapon: null,
    skills: [],
    accessory: null,
    ...extra,
  };
}

/**
 * Level 5 axe brute: STR 10 + 8 might - DEF 3 = 15 damage; hit 100 + SKL 20 × 2
 * - avoid 40 = 100%; AS 5 vs 5, no double. One hit: 30 → 15, never lethal here.
 */
function brute(extra = {}) {
  const weapon = structuredClone(extra.weapon || AXE);
  return {
    name: 'Brute',
    faction: 'enemy',
    className: 'Fighter',
    level: 5,
    col: 3,
    row: 2,
    moveType: 'Infantry',
    currentHP: 30,
    stats: { HP: 30, STR: 10, MAG: 0, SKL: 20, SPD: 5, DEF: 4, RES: 0, LCK: 0, MOV: 5 },
    proficiencies: [{ type: weapon.type, rank: 'Prof' }],
    consumables: [],
    skills: [],
    accessory: null,
    ...extra,
    inventory: [weapon],
    weapon,
  };
}

function text() {
  return {
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    destroy() {},
  };
}

/** The scene's real enemy-combat, awardXP and awardScaledXP; presentation is stubbed. */
function scene() {
  const s = new BattleScene();
  s.grid = {
    fogEnabled: false,
    getTerrainAt: () => plain,
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    isVisible: () => true,
    gridToPixel: () => ({ x: 0, y: 0 }),
    cols: 8,
    rows: 8,
  };
  s.gameData = {
    skills: gameData.skills,
    affixes: [],
    weaponArts: { arts: [] },
    classes: gameData.classes,
    traits: gameData.traits,
  };
  s.npcUnits = [];
  s.battleParams = {};
  s.battleState = 'ENEMY_PHASE';
  s.turnPar = null;
  s.turnBonusConfig = null;
  s.turnManager = { currentPhase: 'enemy', turnNumber: 1 };
  s.runManager = {
    getActHitBonusForUnit: () => 0,
    getTerrainCombatBonuses: () => [],
    blessingRuntimeModifiers: {},
    getDifficultyModifier: (_key, fallback) => fallback,
    getXpMultiplierDelta: () => 0,
  };
  s.registry = { get: () => null };
  s.add = { text: () => text() };
  s.tweens = { add: () => {} };
  s.animateStrike = vi.fn(async () => {});
  s.animateSkillActivation = vi.fn(async () => {});
  s.updateHPBar = vi.fn();
  s._applyResolvedCombatPostEffects = vi.fn(async () => {});
  s._checkPhoenixBrooch = vi.fn(async () => {});
  s.isDevToolsEnabled = () => false;
  s.resetFortHealStreak = vi.fn();
  s.removeUnit = vi.fn(async () => {});
  s.checkBattleEnd = vi.fn(() => false);
  s._selectEnemyWeaponArt = vi.fn(() => null);
  s._maybeShowTutorialPermadeathHint = vi.fn(async () => {});
  vi.spyOn(s, 'awardScaledXP');
  return s;
}

async function attacked(unit, enemy = brute()) {
  const s = scene();
  s.enemyUnits = [enemy];
  s.playerUnits = [unit];
  await s.executeEnemyCombat(enemy, unit);
  return { s, enemy };
}

describe('a player unit that is attacked and survives', () => {
  it('uses the combat formula floor as its minimum: 1 XP', () => {
    expect(XP_DEFEND_SURVIVE).toBe(XP_MIN);
    expect(XP_DEFEND_SURVIVE).toBe(1);
  });

  it('earns 1 XP when unarmed (it cannot counter)', async () => {
    const unit = defender();
    const { s, enemy } = await attacked(unit);
    expect(unit.currentHP).toBe(15);
    expect(enemy.currentHP).toBe(30);
    expect(s.awardScaledXP).toHaveBeenCalledTimes(1);
    expect(s.awardScaledXP).toHaveBeenCalledWith(unit, 1);
    // No par, difficulty, blessing or trait multiplier here: floor(1 × 1) = 1.
    expect(unit.xp).toBe(1);
  });

  it('earns 1 XP when the attacker is out of its counter range', async () => {
    const sword = structuredClone(SWORD);
    const unit = defender({ inventory: [sword], weapon: sword, col: 1 }); // 2 tiles from the bow
    const archer = brute({ weapon: BOW }); // 15 damage at range 2
    const { enemy } = await attacked(unit, archer);
    expect(unit.currentHP).toBe(15);
    expect(enemy.currentHP).toBe(30); // no counter at range 2
    expect(unit.xp).toBe(1);
  });

  it('earns 1 XP when it counters for no damage', async () => {
    // A 0-might tome outside the triangle: MAG 0 + 0 - RES 0 = 0 damage per counter.
    const tome = { ...structuredClone(AXE), name: 'Test Tome', type: 'Tome', might: 0 };
    const unit = defender({
      inventory: [tome],
      weapon: tome,
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
    });
    const { s, enemy } = await attacked(unit);
    expect(unit.currentHP).toBe(15);
    expect(s.animateStrike.mock.calls.map(([event]) => event.attackerSide)).toContain('defender');
    expect(enemy.currentHP).toBe(30);
    expect(unit.xp).toBe(1);
  });

  it('levels up on the survival XP during the enemy phase, queued for presentation', async () => {
    const unit = defender({ xp: 99 });
    const { s } = await attacked(unit);
    expect(unit.level).toBe(6);
    expect(unit.xp).toBe(0);
    // Every growth is 0: the level-up's guaranteed stat is HP (levelUpFallbackStat).
    expect(unit.stats.HP).toBe(31);
    expect(s._pendingLevelUpPopups).toHaveLength(1);
    expect(s._pendingLevelUpPopups[0]).toMatchObject({ unitName: 'Bare' });
  });

  it('earns nothing when it falls', async () => {
    const unit = defender({ currentHP: 10 }); // 10 - 15: falls
    const { s } = await attacked(unit);
    expect(unit.currentHP).toBe(0);
    expect(s.awardScaledXP).not.toHaveBeenCalled();
    expect(unit.xp).toBe(0);
  });

  it('earns nothing from an attacker that grants no XP', async () => {
    const unit = defender();
    const { s } = await attacked(unit, brute({ _noXP: true }));
    expect(unit.currentHP).toBe(15);
    expect(s.awardScaledXP).not.toHaveBeenCalled();
  });
});

describe('awardXP survival minimum', () => {
  function awardScene() {
    const s = new BattleScene();
    s.awardScaledXP = vi.fn(async () => {});
    s.playerUnits = [];
    return s;
  }

  it('lifts chip damage that rounds to 0 up to 1 for a surviving defender only', async () => {
    const unit = { level: 5, currentHP: 10 };
    const foe = { level: 5 };
    // Equal levels: 25 base. 1 damage of 40 HP: floor(25 × 1/40) = floor(0.625) = 0.
    const s = awardScene();
    await s.awardXP(unit, foe, false, 1, 40, { survivedAttack: true });
    expect(s.awardScaledXP).toHaveBeenCalledWith(unit, 1);
    // The same chip as the attacker: nothing, as before.
    const t = awardScene();
    await t.awardXP(unit, foe, false, 1, 40);
    expect(t.awardScaledXP).not.toHaveBeenCalled();
  });

  it('keeps the damage-scaled XP when it is above the minimum', async () => {
    const unit = { level: 5, currentHP: 10 };
    const s = awardScene();
    // 10 of 20 HP: floor(25 × 0.5) = 12.
    await s.awardXP(unit, { level: 5 }, false, 10, 20, { survivedAttack: true });
    expect(s.awardScaledXP).toHaveBeenCalledWith(unit, 12);
  });

  it('holds the minimum under a weak reinforcement and deep late pressure', async () => {
    const unit = { level: 5, currentHP: 10 };
    const straggler = { level: 5, _isReinforcement: true, _reinforcementRewardMultiplier: 0.25 };
    const s = awardScene();
    s.turnPar = 2;
    s.turnBonusConfig = gameData.turnBonus;
    s.turnManager = { turnNumber: 20 }; // 18 over par: the last late-pressure step, 0.1
    // 0 damage: survival only, 1 (the per-enemy and pressure scaling cannot erase it).
    await s.awardXP(unit, straggler, false, 0, 20, { survivedAttack: true });
    expect(s.awardScaledXP).toHaveBeenCalledWith(unit, 1);
    // 10 of 20 HP: floor(25 × 0.5) = 12, × 0.25 × 0.1 = 0.3 → 0, lifted to 1.
    s.awardScaledXP.mockClear();
    await s.awardXP(unit, straggler, false, 10, 20, { survivedAttack: true });
    expect(s.awardScaledXP).toHaveBeenCalledWith(unit, 1);
  });

  it("never shares the survival minimum through a Mentor's Band", async () => {
    const trainee = { name: 'Trainee', level: 1, currentHP: 20, col: 1, row: 2 };
    const holder = {
      name: 'Holder',
      level: 10,
      currentHP: 20,
      col: 2,
      row: 2,
      accessory: { combatEffects: { xpShare: 0.5 } },
    };
    const s = awardScene();
    s.playerUnits = [holder, trainee];
    await s.awardXP(holder, { level: 5 }, false, 0, 20, { survivedAttack: true });
    expect(s.awardScaledXP.mock.calls).toEqual([[holder, 1]]);
  });
});

describe('headless harness mirror', () => {
  it('grants a surviving defender at least 1 XP when its multipliers round to 0', () => {
    const roster = [
      {
        ...defender(),
        name: 'Edric',
        isLord: true,
        isCommander: true,
        growths: { HP: 0 },
      },
    ];
    const b = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' }, roster);
    b.init();
    const unit = b.playerUnits[0];
    const enemy = brute({
      col: unit.col + 1,
      row: unit.row,
      _isReinforcement: true,
      _reinforcementRewardMultiplier: 0, // floor(base × 0) = 0
    });
    b.enemyUnits.push(enemy);
    const xpBefore = unit.xp;
    b._executeEnemyCombat(enemy, unit);
    expect(unit.currentHP).toBeGreaterThan(0);
    expect(unit.xp).toBe(xpBefore + 1);
  });
});
