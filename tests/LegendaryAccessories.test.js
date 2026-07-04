// LegendaryAccessories.test.js — Mentor's Band (EXP Share), Mercury Sandals,
// Phalanx Band, Pursuit Ring (spec: legendary accessories, design log 2026-07-04).
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import {
  createUnit,
  equipAccessory,
  unequipAccessory,
  promoteUnit,
  normalizeUnitClassState,
  calculateCombatXP,
  getXpEffectiveLevel,
} from '../src/engine/UnitManager.js';
import { getXpShareRatio, getXpShareRecipients, calculateSharedXp } from '../src/engine/XpShare.js';
import {
  getEffectivenessMultiplier,
  getCombatForecast,
  resolveCombat,
} from '../src/engine/Combat.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { serializeUnit } from '../src/engine/RunManager.js';

const gameData = loadGameData();

const mentorsBand = gameData.accessories.find((a) => a.name === "Mentor's Band");
const mercurySandals = gameData.accessories.find((a) => a.name === 'Mercury Sandals');
const phalanxBand = gameData.accessories.find((a) => a.name === 'Phalanx Band');
const pursuitRing = gameData.accessories.find((a) => a.name === 'Pursuit Ring');

function findClass(name) {
  return gameData.classes.find((c) => c.name === name);
}

function makeUnit(overrides = {}) {
  const stats = overrides.stats || {
    HP: 30,
    STR: 10,
    MAG: 0,
    SKL: 10,
    SPD: 10,
    DEF: 5,
    RES: 5,
    LCK: 5,
    MOV: 5,
  };
  return {
    name: 'Unit',
    className: 'Myrmidon',
    tier: 'base',
    level: 1,
    xp: 0,
    faction: 'player',
    col: 0,
    row: 0,
    currentHP: stats.HP,
    stats: { ...stats },
    mov: stats.MOV,
    weapon: null,
    inventory: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    ...overrides,
  };
}

// Minimal BattleScene stand-in: real awardXP, recorded awardScaledXP.
function makeXpScene(playerUnits) {
  return {
    playerUnits,
    getEnemyXpMultiplier: () => 1,
    getTurnPressureState: () => ({ xpMultiplier: 1 }),
    sys: { isActive: () => true },
    awards: [],
    async awardScaledXP(unit, xp) {
      this.awards.push({ unit, xp });
    },
    awardXP: BattleScene.prototype.awardXP,
  };
}

describe('legendary accessories: data contract', () => {
  it('all four exist with the specced combat effects and prices', () => {
    expect(mentorsBand).toMatchObject({
      type: 'Accessory',
      effects: {},
      combatEffects: { xpShare: 0.5 },
      price: 2500,
    });
    expect(mercurySandals).toMatchObject({
      type: 'Accessory',
      effects: {},
      combatEffects: { moveTypeOverride: 'Flying' },
      price: 5000,
    });
    expect(phalanxBand).toMatchObject({
      type: 'Accessory',
      effects: {},
      combatEffects: { defBonus: 2, resBonus: 2, hitBonus: 10, condition: 'adjacent_ally' },
      price: 3500,
    });
    expect(pursuitRing).toMatchObject({
      type: 'Accessory',
      effects: {},
      combatEffects: { doubleThresholdReduction: 2 },
      price: 4000,
    });
  });

  it('Mercury Sandals lore states the flier weakness tradeoff', () => {
    expect(mercurySandals.lore.toLowerCase()).toContain('archer');
  });

  it("Mentor's Band is a catch-up item: act2+ loot pools (and thus act2+ shops)", () => {
    const pools = gameData.lootTables;
    expect(pools.act1.accessories).not.toContain("Mentor's Band");
    expect(pools.act2.accessories).toContain("Mentor's Band");
    expect(pools.act3.accessories).toContain("Mentor's Band");
    expect(pools.act4.accessories).toContain("Mentor's Band");
  });

  it('Mercury Sandals, Phalanx Band, and Pursuit Ring are gated to act3+act4 pools only', () => {
    const pools = gameData.lootTables;
    for (const name of ['Mercury Sandals', 'Phalanx Band', 'Pursuit Ring']) {
      expect(pools.act1.accessories, `${name} must not be in act1`).not.toContain(name);
      expect(pools.act2.accessories, `${name} must not be in act2`).not.toContain(name);
      expect(pools.act3.accessories, `${name} must be in act3`).toContain(name);
      expect(pools.act4.accessories, `${name} must be in act4`).toContain(name);
    }
  });
});

describe("Mentor's Band: XpShare engine helpers", () => {
  it('getXpShareRatio reads the equipped accessory, 0 otherwise', () => {
    const holder = makeUnit({ accessory: mentorsBand });
    expect(getXpShareRatio(holder)).toBe(0.5);
    expect(getXpShareRatio(makeUnit())).toBe(0);
    expect(getXpShareRatio(makeUnit({ accessory: pursuitRing }))).toBe(0);
    expect(getXpShareRatio(null)).toBe(0);
    expect(getXpShareRatio(makeUnit({ accessory: { combatEffects: { xpShare: 'bad' } } }))).toBe(0);
  });

  it('recipients: adjacent (distance 1), living, strictly lower effective level', () => {
    const holder = makeUnit({ name: 'Holder', level: 10, col: 2, row: 2 });
    const adjacentLower = makeUnit({ name: 'AdjLower', level: 2, col: 2, row: 3 });
    const adjacentEqual = makeUnit({ name: 'AdjEqual', level: 10, col: 1, row: 2 });
    const adjacentHigher = makeUnit({ name: 'AdjHigher', level: 15, col: 3, row: 2 });
    const diagonal = makeUnit({ name: 'Diagonal', level: 2, col: 3, row: 3 });
    const far = makeUnit({ name: 'Far', level: 2, col: 6, row: 6 });
    const dead = makeUnit({ name: 'Dead', level: 2, col: 2, row: 1, currentHP: 0 });

    const recipients = getXpShareRecipients(holder, [
      holder,
      adjacentLower,
      adjacentEqual,
      adjacentHigher,
      diagonal,
      far,
      dead,
    ]);
    expect(recipients).toEqual([adjacentLower]);
  });

  it('effective level counts promoted tier as +12 (promoted lv1 does not siphon from base lv10)', () => {
    const holder = makeUnit({ name: 'Holder', level: 10, tier: 'base', col: 2, row: 2 });
    const promotedAlly = makeUnit({
      name: 'Promoted',
      level: 1,
      tier: 'promoted',
      col: 2,
      row: 3,
    });
    // Promoted lv1 has effective level 13 > holder's 10 — not a recipient.
    expect(getXpEffectiveLevel(promotedAlly)).toBe(13);
    expect(getXpShareRecipients(holder, [promotedAlly])).toEqual([]);
  });

  it("calculateSharedXp uses the ally's own combat XP formula at the given ratio", () => {
    const ally = makeUnit({ level: 1 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy' });
    // Underdog ally: 25 base + 4*5 level diff + 15 kill = 60 → *0.5 = 30
    expect(calculateCombatXP(ally, enemy, true)).toBe(60);
    expect(calculateSharedXp(ally, enemy, true, 0.5)).toBe(30);
    // Contextual multiplier applies (e.g. chip-damage ratio, enemy reward mult)
    expect(calculateSharedXp(ally, enemy, true, 0.5, 0.25)).toBe(7);
  });

  it('calculateSharedXp floors at 1 XP', () => {
    const overleveled = makeUnit({ level: 20, tier: 'promoted' });
    const weakEnemy = makeUnit({ name: 'Enemy', level: 1, faction: 'enemy' });
    expect(calculateCombatXP(overleveled, weakEnemy, true)).toBe(1);
    expect(calculateSharedXp(overleveled, weakEnemy, true, 0.5)).toBe(1);
  });

  it('calculateSharedXp returns 0 for a non-positive ratio', () => {
    const ally = makeUnit({ level: 1 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy' });
    expect(calculateSharedXp(ally, enemy, true, 0)).toBe(0);
    expect(calculateSharedXp(ally, enemy, true, null)).toBe(0);
  });
});

describe("Mentor's Band: BattleScene.awardXP share pass", () => {
  it('adjacent lower-level allies receive their own-formula XP at 50% after the holder', async () => {
    const holder = makeUnit({ name: 'Holder', level: 10, col: 2, row: 2, accessory: mentorsBand });
    const trainee = makeUnit({ name: 'Trainee', level: 2, col: 2, row: 3 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy', col: 3, row: 2 });
    const scene = makeXpScene([holder, trainee]);

    await scene.awardXP(holder, enemy, true);

    // Holder (advantage +5): steep-decay tier → 25 - 15 - 16 + 7 = 1 XP
    // Trainee (underdog +3): 25 + 15 + 15 = 55 → *0.5 = 27 XP
    expect(scene.awards).toEqual([
      { unit: holder, xp: 1 },
      { unit: trainee, xp: 27 },
    ]);
  });

  it('holder XP is unchanged by the band (share is additive, not a split)', async () => {
    const bare = makeUnit({ name: 'Bare', level: 10, col: 2, row: 2 });
    const enemyA = makeUnit({ name: 'EnemyA', level: 5, faction: 'enemy' });
    const sceneBare = makeXpScene([bare]);
    await sceneBare.awardXP(bare, enemyA, true);

    const holder = makeUnit({ name: 'Holder', level: 10, col: 2, row: 2, accessory: mentorsBand });
    const trainee = makeUnit({ name: 'Trainee', level: 2, col: 2, row: 3 });
    const enemyB = makeUnit({ name: 'EnemyB', level: 5, faction: 'enemy' });
    const sceneBand = makeXpScene([holder, trainee]);
    await sceneBand.awardXP(holder, enemyB, true);

    expect(sceneBand.awards[0].xp).toBe(sceneBare.awards[0].xp);
  });

  it('no share without the band, on non-adjacent allies, or on higher/equal-level allies', async () => {
    const holder = makeUnit({ name: 'Holder', level: 10, col: 2, row: 2, accessory: mentorsBand });
    const equalLevel = makeUnit({ name: 'Equal', level: 10, col: 2, row: 3 });
    const farLower = makeUnit({ name: 'FarLower', level: 1, col: 6, row: 6 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy' });
    const scene = makeXpScene([holder, equalLevel, farLower]);

    await scene.awardXP(holder, enemy, true);
    expect(scene.awards).toHaveLength(1);
    expect(scene.awards[0].unit).toBe(holder);

    const bareHolder = makeUnit({ name: 'Bare', level: 10, col: 2, row: 2 });
    const trainee = makeUnit({ name: 'Trainee', level: 2, col: 2, row: 3 });
    const enemy2 = makeUnit({ name: 'Enemy2', level: 5, faction: 'enemy' });
    const scene2 = makeXpScene([bareHolder, trainee]);
    await scene2.awardXP(bareHolder, enemy2, true);
    expect(scene2.awards).toHaveLength(1);
  });

  it('respects opponent._noXP (no holder XP, no shares)', async () => {
    const holder = makeUnit({ name: 'Holder', level: 10, col: 2, row: 2, accessory: mentorsBand });
    const trainee = makeUnit({ name: 'Trainee', level: 2, col: 2, row: 3 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy', _noXP: true });
    const scene = makeXpScene([holder, trainee]);

    await scene.awardXP(holder, enemy, true);
    expect(scene.awards).toEqual([]);
  });

  it('does not chain and does not double-grant with two adjacent bands', async () => {
    // Holder fights; ally1 (band, adjacent, lower) receives one share.
    // Ally2 is adjacent to ally1 but NOT to the holder — ally1's band must not
    // re-share the received XP (no chaining).
    const holder = makeUnit({ name: 'Holder', level: 10, col: 2, row: 2, accessory: mentorsBand });
    const ally1 = makeUnit({
      name: 'Ally1',
      level: 5,
      col: 2,
      row: 3,
      accessory: { ...mentorsBand },
    });
    const ally2 = makeUnit({ name: 'Ally2', level: 1, col: 2, row: 4 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy' });
    const scene = makeXpScene([holder, ally1, ally2]);

    await scene.awardXP(holder, enemy, true);

    expect(scene.awards).toHaveLength(2);
    expect(scene.awards[0].unit).toBe(holder);
    expect(scene.awards[1].unit).toBe(ally1);
    expect(scene.awards.some((a) => a.unit === ally2)).toBe(false);
  });

  it('shares scale with the chip-damage ratio and skip zero-damage combats', async () => {
    const holder = makeUnit({ name: 'Holder', level: 5, col: 2, row: 2, accessory: mentorsBand });
    const trainee = makeUnit({ name: 'Trainee', level: 1, col: 2, row: 3 });
    const enemy = makeUnit({ name: 'Enemy', level: 5, faction: 'enemy' });
    const scene = makeXpScene([holder, trainee]);

    // 5/20 damage → ratio 0.25. Holder: floor(25 * 0.25) = 6.
    // Trainee base (underdog +4, no kill): 25 + 20 = 45 → floor(45 * 0.5 * 0.25) = 5.
    await scene.awardXP(holder, enemy, false, 5, 20);
    expect(scene.awards).toEqual([
      { unit: holder, xp: 6 },
      { unit: trainee, xp: 5 },
    ]);

    const scene2 = makeXpScene([holder, trainee]);
    await scene2.awardXP(holder, enemy, false, 0, 20);
    expect(scene2.awards).toEqual([]);
  });

  it('shares are combat-only: dance/heal XP goes through awardScaledXP and never shares', () => {
    // Structural guarantee: the share pass lives in awardXP (combat entry
    // point) and grants via awardScaledXP directly. awardScaledXP contains no
    // share logic, so heal XP (awardScaledXP(healer, ...)) and dance XP
    // (awardScaledXP(dancer, XP_BASE_DANCE)) cannot trigger shares.
    const source = String(BattleScene.prototype.awardScaledXP);
    expect(source).not.toContain('xpShare');
    expect(source).not.toContain('XpShare');
  });
});

describe("Mentor's Band: headless harness parity", () => {
  const battleParams = {
    act: 'act1',
    objective: 'rout',
    enemyStatBonus: 0,
    enemyCountBonus: 0,
  };

  function makeRosterUnit(name, level, extra = {}) {
    const ironSword = structuredClone(gameData.weapons.find((w) => w.name === 'Iron Sword'));
    return {
      name,
      className: 'Myrmidon',
      tier: 'base',
      level,
      xp: 0,
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 30, SPD: 12, DEF: 6, RES: 4, LCK: 6, MOV: 5 },
      currentHP: 30,
      inventory: [ironSword],
      weapon: ironSword,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      moveType: 'Infantry',
      faction: 'player',
      ...extra,
    };
  }

  it('_executeCombat mirrors the BattleScene share (adjacent lower-level ally gains XP)', () => {
    const holder = makeRosterUnit('Holder', 10, { accessory: structuredClone(mentorsBand) });
    const trainee = makeRosterUnit('Trainee', 1);
    const battle = new HeadlessBattle(gameData, battleParams, [holder, trainee]);
    battle.init();

    // Park all enemies far away, then stage the fight at fixed coordinates.
    battle.enemyUnits.forEach((e, i) => {
      e.col = i;
      e.row = 0;
    });
    const enemy = battle.enemyUnits[0];
    enemy.level = 5;
    enemy.tier = 'base';
    enemy.currentHP = 1;
    enemy.stats.SPD = 0;
    enemy.stats.LCK = 0;
    enemy.stats.DEF = 0;
    enemy.weapon = null;
    holder.col = 5;
    holder.row = 5;
    trainee.col = 5;
    trainee.row = 6;
    enemy.col = 6;
    enemy.row = 5;

    const expectedShare = calculateSharedXp(
      trainee,
      enemy,
      true,
      0.5,
      battle._getEnemyXpMultiplier(enemy),
    );
    expect(expectedShare).toBeGreaterThanOrEqual(30); // underdog +4 → 45, +15 kill = 60 → *0.5

    battle._executeCombat(holder, enemy);

    expect(enemy.currentHP).toBeLessThanOrEqual(0);
    expect(trainee.xp).toBe(expectedShare);
    expect(holder.xp).toBeGreaterThan(0); // holder's own XP untouched
  });

  it('_executeEnemyCombat shares when the player defender earns counter XP', () => {
    const holder = makeRosterUnit('Holder', 10, { accessory: structuredClone(mentorsBand) });
    const trainee = makeRosterUnit('Trainee', 1);
    const battle = new HeadlessBattle(gameData, battleParams, [holder, trainee]);
    battle.init();

    battle.enemyUnits.forEach((e, i) => {
      e.col = i;
      e.row = 0;
    });
    const enemy = battle.enemyUnits[0];
    enemy.level = 5;
    enemy.tier = 'base';
    enemy.currentHP = 1;
    enemy.stats.SPD = 0;
    enemy.stats.LCK = 0;
    enemy.stats.STR = 0;
    enemy.stats.DEF = 0;
    const enemySword = structuredClone(gameData.weapons.find((w) => w.name === 'Iron Sword'));
    enemy.weapon = enemySword;
    enemy.inventory = [enemySword];
    if (!Array.isArray(enemy.proficiencies) || enemy.proficiencies.length === 0) {
      enemy.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
    }
    holder.col = 5;
    holder.row = 5;
    trainee.col = 5;
    trainee.row = 6;
    enemy.col = 6;
    enemy.row = 5;

    const expectedShare = calculateSharedXp(
      trainee,
      enemy,
      true,
      0.5,
      battle._getEnemyXpMultiplier(enemy),
    );

    battle._executeEnemyCombat(enemy, holder);

    // Holder survives and counters the 1 HP enemy dead → counter XP + share.
    expect(holder.currentHP).toBeGreaterThan(0);
    expect(enemy.currentHP).toBeLessThanOrEqual(0);
    expect(trainee.xp).toBe(expectedShare);
  });

  it('no share without the band equipped', () => {
    const holder = makeRosterUnit('Holder', 10);
    const trainee = makeRosterUnit('Trainee', 1);
    const battle = new HeadlessBattle(gameData, battleParams, [holder, trainee]);
    battle.init();

    battle.enemyUnits.forEach((e, i) => {
      e.col = i;
      e.row = 0;
    });
    const enemy = battle.enemyUnits[0];
    enemy.level = 5;
    enemy.tier = 'base';
    enemy.currentHP = 1;
    enemy.stats.SPD = 0;
    enemy.stats.LCK = 0;
    enemy.stats.DEF = 0;
    enemy.weapon = null;
    holder.col = 5;
    holder.row = 5;
    trainee.col = 5;
    trainee.row = 6;
    enemy.col = 6;
    enemy.row = 5;

    battle._executeCombat(holder, enemy);
    expect(trainee.xp).toBe(0);
  });
});

describe('Mercury Sandals: move-type override', () => {
  function makeClassUnit(className, level = 5) {
    return createUnit(findClass(className), level, gameData.weapons);
  }

  it('equip sets Flying and stores the base type; unequip restores it', () => {
    const unit = makeClassUnit('Myrmidon');
    expect(unit.moveType).toBe('Infantry');

    equipAccessory(unit, structuredClone(mercurySandals));
    expect(unit.moveType).toBe('Flying');
    expect(unit._baseMoveType).toBe('Infantry');

    unequipAccessory(unit);
    expect(unit.moveType).toBe('Infantry');
    expect(unit._baseMoveType).toBeUndefined();
  });

  it('swapping to another accessory restores the base move type', () => {
    const unit = makeClassUnit('Cavalier');
    equipAccessory(unit, structuredClone(mercurySandals));
    expect(unit.moveType).toBe('Flying');

    equipAccessory(unit, structuredClone(pursuitRing));
    expect(unit.moveType).toBe('Cavalry');
    expect(unit._baseMoveType).toBeUndefined();
  });

  it('a native flier stays a flier through equip + unequip', () => {
    const unit = makeClassUnit('Pegasus Knight');
    expect(unit.moveType).toBe('Flying');
    equipAccessory(unit, structuredClone(mercurySandals));
    expect(unit.moveType).toBe('Flying');
    expect(unit._baseMoveType).toBeUndefined();
    unequipAccessory(unit);
    expect(unit.moveType).toBe('Flying');
  });

  it('promotion re-applies the override via normalizeUnitClassState', () => {
    const unit = makeClassUnit('Myrmidon', 10);
    equipAccessory(unit, structuredClone(mercurySandals));
    expect(unit.moveType).toBe('Flying');

    const swordmaster = findClass('Swordmaster');
    promoteUnit(unit, swordmaster, swordmaster.promotionBonuses, gameData.skills);

    expect(unit.className).toBe('Swordmaster');
    expect(unit.moveType).toBe('Flying');
    expect(unit._baseMoveType).toBe('Infantry');

    unequipAccessory(unit);
    expect(unit.moveType).toBe('Infantry');
  });

  it('reclass to a class of a different move type keeps the override and the new base', () => {
    const unit = makeClassUnit('Myrmidon');
    equipAccessory(unit, structuredClone(mercurySandals));

    normalizeUnitClassState(unit, findClass('Cavalier'));
    expect(unit.moveType).toBe('Flying');
    expect(unit._baseMoveType).toBe('Cavalry');

    unequipAccessory(unit);
    expect(unit.moveType).toBe('Cavalry');
  });

  it('reclass into a native flier drops the stale base so unequip keeps Flying', () => {
    const unit = makeClassUnit('Myrmidon');
    equipAccessory(unit, structuredClone(mercurySandals));
    expect(unit._baseMoveType).toBe('Infantry');

    normalizeUnitClassState(unit, findClass('Pegasus Knight'));
    expect(unit.moveType).toBe('Flying');
    expect(unit._baseMoveType).toBeUndefined();

    unequipAccessory(unit);
    expect(unit.moveType).toBe('Flying');
  });

  it('intended tradeoff: the holder gains flier weaknesses (bows 3x)', () => {
    const bow = gameData.weapons.find((w) => w.name === 'Iron Bow');
    const unit = makeClassUnit('Myrmidon');
    expect(getEffectivenessMultiplier(bow, unit)).toBe(1);

    equipAccessory(unit, structuredClone(mercurySandals));
    expect(getEffectivenessMultiplier(bow, unit)).toBe(3);

    unequipAccessory(unit);
    expect(getEffectivenessMultiplier(bow, unit)).toBe(1);
  });

  it('save/load round-trip keeps the override; unequip after load restores the base', () => {
    const unit = makeClassUnit('Myrmidon');
    equipAccessory(unit, structuredClone(mercurySandals));

    const restored = JSON.parse(JSON.stringify(serializeUnit(unit)));
    expect(restored.moveType).toBe('Flying');
    expect(restored._baseMoveType).toBe('Infantry');
    expect(restored.accessory?.name).toBe('Mercury Sandals');

    // Load-time class-state migration must not clobber the override.
    normalizeUnitClassState(restored, findClass('Myrmidon'));
    expect(restored.moveType).toBe('Flying');
    expect(restored._baseMoveType).toBe('Infantry');

    unequipAccessory(restored);
    expect(restored.moveType).toBe('Infantry');
    expect(restored._baseMoveType).toBeUndefined();
  });
});

describe('Phalanx Band: adjacent_ally combat mods', () => {
  it('grants +2 Def / +2 Res / +10 Hit only with a living adjacent ally', () => {
    const holder = makeUnit({ name: 'Holder', col: 4, row: 4, accessory: phalanxBand });
    const opponent = makeUnit({ name: 'Enemy', faction: 'enemy', col: 5, row: 4 });
    const allyNear = makeUnit({ name: 'AllyNear', col: 4, row: 5 });
    const allyFar = makeUnit({ name: 'AllyFar', col: 8, row: 8 });
    const deadAllyNear = makeUnit({ name: 'DeadAlly', col: 3, row: 4, currentHP: 0 });

    const withAlly = getSkillCombatMods(
      holder,
      opponent,
      [holder, allyNear],
      [opponent],
      gameData.skills,
      { name: 'Plain' },
      true,
    );
    expect(withAlly.defBonus).toBe(2);
    expect(withAlly.resBonus).toBe(2);
    expect(withAlly.hitBonus).toBe(10);

    const alone = getSkillCombatMods(
      holder,
      opponent,
      [holder, allyFar, deadAllyNear],
      [opponent],
      gameData.skills,
      { name: 'Plain' },
      true,
    );
    expect(alone.defBonus).toBe(0);
    expect(alone.resBonus).toBe(0);
    expect(alone.hitBonus).toBe(0);
  });

  it('mods flow into resolveCombat (defender takes 2 less damage with an adjacent ally)', () => {
    const ironSword = gameData.weapons.find((w) => w.name === 'Iron Sword');
    const attacker = makeUnit({
      name: 'Attacker',
      faction: 'enemy',
      col: 5,
      row: 4,
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 30, SPD: 5, DEF: 5, RES: 5, LCK: 0, MOV: 5 },
      weapon: ironSword,
    });
    const makeDefender = () =>
      makeUnit({
        name: 'Holder',
        col: 4,
        row: 4,
        stats: { HP: 30, STR: 5, MAG: 0, SKL: 5, SPD: 0, DEF: 5, RES: 5, LCK: 0, MOV: 5 },
        accessory: phalanxBand,
        weapon: null,
      });
    const ally = makeUnit({ name: 'Ally', col: 4, row: 5 });

    const resolveWith = (defender, allies) => {
      const defMods = getSkillCombatMods(
        defender,
        attacker,
        allies,
        [attacker],
        gameData.skills,
        { name: 'Plain' },
        false,
      );
      const result = resolveCombat(attacker, ironSword, defender, null, 1, null, null, {
        atkMods: {},
        defMods,
      });
      const strike = result.events.find(
        (e) => e.type === 'strike' && e.attacker === attacker.name && !e.miss,
      );
      return strike ? strike.damage : 0;
    };

    // Pin RNG so both strikes hit and neither crits (hitRate ~150, critRate ~15):
    // 0.5*100 = 50 is below the hit threshold and above the crit threshold.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const damageAlone = resolveWith(makeDefender(), []);
      const damageFormation = resolveWith(makeDefender(), [ally]);
      expect(damageAlone).toBeGreaterThan(0);
      expect(damageAlone - damageFormation).toBe(2);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('Pursuit Ring: double threshold reduction', () => {
  it('holder doubles at SPD+3 instead of SPD+5', () => {
    const ironSword = gameData.weapons.find((w) => w.name === 'Iron Sword');
    // Iron Sword weight 3 with 3 STR-based reduction → no effective penalty at STR>=6.
    const stats = { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 13, DEF: 5, RES: 5, LCK: 5, MOV: 5 };
    const slowStats = { ...stats, SPD: 10 };

    const bare = makeUnit({ name: 'Bare', stats, weapon: ironSword });
    const slow = makeUnit({ name: 'Slow', faction: 'enemy', stats: slowStats, weapon: ironSword });
    expect(
      getCombatForecast(bare, ironSword, slow, ironSword, 1, null, null).attacker.doubles,
    ).toBe(false);

    const ringed = makeUnit({ name: 'Ringed', stats, weapon: ironSword, accessory: pursuitRing });
    expect(
      getCombatForecast(ringed, ironSword, slow, ironSword, 1, null, null).attacker.doubles,
    ).toBe(true);

    // SPD+2 still does not double even with the ring.
    const barelyFaster = makeUnit({
      name: 'BarelyFaster',
      stats: { ...stats, SPD: 12 },
      weapon: ironSword,
      accessory: pursuitRing,
    });
    expect(
      getCombatForecast(barelyFaster, ironSword, slow, ironSword, 1, null, null).attacker.doubles,
    ).toBe(false);
  });

  it('resolveCombat grants the extra strike with the ring at SPD+3', () => {
    const ironSword = gameData.weapons.find((w) => w.name === 'Iron Sword');
    const stats = { HP: 40, STR: 5, MAG: 0, SKL: 30, SPD: 13, DEF: 9, RES: 9, LCK: 0, MOV: 5 };
    const slowStats = { ...stats, SPD: 10 };
    const slow = () =>
      makeUnit({ name: 'Slow', faction: 'enemy', stats: slowStats, weapon: ironSword });

    const bare = makeUnit({ name: 'Bare', stats, weapon: ironSword });
    const bareStrikes = resolveCombat(
      bare,
      ironSword,
      slow(),
      ironSword,
      1,
      null,
      null,
    ).events.filter((e) => e.attacker === 'Bare').length;
    expect(bareStrikes).toBe(1);

    const ringed = makeUnit({ name: 'Ringed', stats, weapon: ironSword, accessory: pursuitRing });
    const ringedStrikes = resolveCombat(
      ringed,
      ironSword,
      slow(),
      ironSword,
      1,
      null,
      null,
    ).events.filter((e) => e.attacker === 'Ringed').length;
    expect(ringedStrikes).toBe(2);
  });
});
