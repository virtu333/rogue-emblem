// UnarmedUnits.test.js — a player unit with no weapon (docs/specs/item-trade.md,
// "Unarmed units"): combat, the battle scene's enemy-attack path, saves, battle
// checkpoints, the timeline, and the screens that describe the unit.
// Every expected number is worked out by hand in the comment beside it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { getCombatForecast, resolveCombat, getStaticCombatStats } from '../src/engine/Combat.js';
import {
  getSkillCombatMods,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { isUnarmed, createRecruitUnit } from '../src/engine/UnitManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { serializeBattleUnit, restoreEquippedReference } from '../src/engine/BattleUnitState.js';
import { timelineChanges } from '../src/engine/BattleTimelineFacts.js';
import { formationUnitLine } from '../src/ui/FormationPicker.js';
import { rewardForWhom } from '../src/ui/choiceContent.js';
import { equipmentComparison } from '../src/ui/equipmentComparison.js';
import { applyRewardTarget } from '../src/engine/LootRewardCommands.js';
import { purchaseShopItem } from '../src/engine/ShopCommands.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
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

/** A sword fighter carrying nothing; fixed stats so every number can be worked out. */
function bare(extra = {}) {
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
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    inventory: [],
    consumables: [],
    weapon: null,
    skills: [],
    accessory: null,
    ...extra,
  };
}

function brute(extra = {}) {
  const axe = structuredClone(AXE);
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
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    inventory: [axe],
    consumables: [],
    weapon: axe,
    skills: [],
    accessory: null,
    ...extra,
  };
}

function skillCtx(attacker, defender) {
  const skills = gameData.skills;
  return {
    atkMods: getSkillCombatMods(attacker, defender, [attacker], [defender], skills, plain, true),
    defMods: getSkillCombatMods(defender, attacker, [defender], [attacker], skills, plain, false),
    rollStrikeSkills,
    rollDefenseSkills,
    skillsData: skills,
  };
}

beforeEach(() => installSeed(7));
afterEach(() => restoreMathRandom());

describe('isUnarmed', () => {
  const sword = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof' };
  const heal = { name: 'Heal', type: 'Staff', rankRequired: 'Prof' };
  it('is a fighter with no combat weapon it can wield', () => {
    expect(isUnarmed(bare())).toBe(true);
    expect(isUnarmed(bare({ inventory: [{ ...sword, type: 'Axe' }] }))).toBe(true);
    expect(isUnarmed(bare({ inventory: [sword], weapon: sword }))).toBe(false);
    // A sword and staff user holding only a staff still has nothing to attack with.
    const both = [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ];
    expect(isUnarmed(bare({ proficiencies: both, inventory: [heal], weapon: heal }))).toBe(true);
  });
  it('never marks a staff-only healer, a missing unit or an inventory-less record', () => {
    const cleric = bare({ proficiencies: [{ type: 'Staff', rank: 'Prof' }] });
    expect(isUnarmed(cleric)).toBe(false);
    expect(isUnarmed(null)).toBe(false);
    expect(isUnarmed(bare({ inventory: undefined }))).toBe(true);
  });
});

describe('combat against an unarmed defender', () => {
  it('forecast: no counter, and says why', () => {
    const enemy = brute();
    const unit = bare();
    const f = getCombatForecast(
      enemy,
      enemy.weapon,
      unit,
      null,
      1,
      plain,
      plain,
      skillCtx(enemy, unit),
    );
    expect(f.defender.canCounter).toBe(false);
    expect(f.display.counterReason).toBe('No combat weapon equipped');
    // Damage = STR 10 + Mt 8 − DEF 3 = 15; AS 5 vs 5 (needs +5) → one strike.
    expect(f.attacker.damage).toBe(15);
    expect(f.attacker.attackCount).toBe(1);
  });

  it('resolve: only the attacker strikes, even with Vantage, Wrath, Desperation and Quick Riposte', () => {
    const enemy = brute();
    const unit = bare({
      skills: ['vantage', 'wrath', 'desperation', 'quick_riposte', 'dragon_scale'],
      currentHP: 12, // ≤ half HP, so Vantage/Wrath/Desperation would all be live
    });
    const result = resolveCombat(
      enemy,
      enemy.weapon,
      unit,
      null,
      1,
      plain,
      plain,
      skillCtx(enemy, unit),
    );
    const strikes = result.events.filter((e) => e.type === 'strike');
    // Hit: 100 + SKL 20×2 + LCK 0 − (SPD 5×2 + LCK 30) = 100 → always hits.
    // Crit: 20/2 + 0 − LCK 30 < 0 → 0. Dragon Scale (always) −3: 15 − 3 = 12 → 12 − 12 = 0.
    expect(strikes.map((e) => e.attackerSide)).toEqual(['attacker']);
    expect(result.defenderHP).toBe(0);
    expect(result.attackerHP).toBe(30);
  });

  it('an unarmed attacker is a no-op, never a crash', () => {
    const unit = bare();
    const enemy = brute();
    const result = resolveCombat(
      unit,
      null,
      enemy,
      enemy.weapon,
      1,
      plain,
      plain,
      skillCtx(unit, enemy),
    );
    expect(result.events).toEqual([]);
    expect([result.attackerHP, result.defenderHP]).toEqual([30, 30]);
    // Status screens: no weapon means Attack 0, AS = SPD.
    expect(getStaticCombatStats(unit, null)).toEqual({ atk: 0, as: 5, hit: 0, crit: 0, weight: 0 });
  });
});

describe('BattleScene: an enemy attacks an unarmed unit', () => {
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
    s.gameData = { skills: gameData.skills, affixes: [], weaponArts: { arts: [] }, classes: [] };
    s.npcUnits = [];
    s.battleParams = {};
    s.battleState = 'ENEMY_PHASE';
    s.turnManager = { endPlayerPhase: vi.fn(), unitActed: vi.fn(), turnNumber: 1 };
    s.runManager = {
      blessingRuntimeModifiers: {},
    };
    s.registry = { get: () => null };
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
    s.awardScaledXP = vi.fn(async () => {});
    return s;
  }

  it('takes the hit, strikes nothing back and earns only the survival XP (the real awardXP)', async () => {
    const s = scene();
    const enemy = brute();
    const unit = bare();
    s.enemyUnits = [enemy];
    s.playerUnits = [unit];
    await s.executeEnemyCombat(enemy, unit);
    // One 15-damage hit (see the forecast test): 30 → 15; the enemy is untouched.
    expect(unit.currentHP).toBe(15);
    expect(enemy.currentHP).toBe(30);
    // animateStrike(event, attacker, defender): every animated strike is the enemy's.
    const sides = s.animateStrike.mock.calls.map(([event]) => event.attackerSide);
    expect(sides).toEqual(['attacker']);
    // It dealt no damage, but it was attacked and lived: XP_DEFEND_SURVIVE (1).
    expect(s.awardScaledXP.mock.calls).toEqual([[unit, 1]]);
    expect(s.removeUnit).not.toHaveBeenCalled();
  });
});

describe('saves and battle checkpoints keep an unarmed unit unarmed', () => {
  function roster() {
    const heal = structuredClone(gameData.weapons.find((w) => w.name === 'Heal'));
    const vulnerary = structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'));
    return {
      empty: bare({ name: 'Empty' }),
      supplies: bare({ name: 'Supplies', consumables: [vulnerary] }),
      // A Heal staff it has no rank for: carried, never equipped.
      staff: bare({ name: 'Staffed', inventory: [heal] }),
    };
  }

  it('run save → load: bags and weapon: null survive; nothing is auto-equipped', () => {
    const run = new RunManager(gameData);
    run.startRun({ runSeed: 3 });
    const units = roster();
    run.roster.push(...Object.values(units));
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), gameData);
    const byName = (name) => loaded.roster.find((u) => u.name === name);
    expect(byName('Empty').inventory).toEqual([]);
    expect(byName('Empty').weapon).toBeNull();
    expect(byName('Supplies').weapon).toBeNull();
    expect(byName('Supplies').consumables.map((c) => c.name)).toEqual(['Vulnerary']);
    expect(byName('Staffed').inventory.map((w) => w.name)).toEqual(['Heal']);
    expect(byName('Staffed').weapon).toBeNull();
    // Armed lords are untouched by the round trip.
    const edric = loaded.roster.find((u) => u.name === 'Edric');
    expect(edric.inventory).toContain(edric.weapon);
  });

  it('battle checkpoint serialization: equippedInventoryIndex −1 restores to null', () => {
    for (const unit of Object.values(roster())) {
      const data = serializeBattleUnit(unit);
      expect(data.equippedInventoryIndex).toBe(-1);
      const restored = JSON.parse(JSON.stringify(data));
      restoreEquippedReference(restored);
      expect(restored.weapon).toBeNull();
      expect(restored.inventory).toEqual(JSON.parse(JSON.stringify(unit.inventory)));
      expect('equippedInventoryIndex' in restored).toBe(false);
    }
  });
});

describe('screens that describe an unarmed unit', () => {
  it('timeline: giving away the last weapon reads "is now unarmed"', () => {
    const before = {
      units: [
        {
          id: 'u1',
          name: 'Kai',
          hp: 20,
          level: 3,
          col: 1,
          row: 1,
          items: ['Iron Sword'],
          weapon: 'Iron Sword',
          conditions: [],
        },
      ],
    };
    const after = { units: [{ ...before.units[0], items: [], weapon: 'Unarmed' }] };
    expect(timelineChanges(before, after)).toEqual([
      "Kai's items changed: none.",
      'Kai is now unarmed.',
    ]);
    // Arming again still names the weapon.
    expect(timelineChanges(after, before)).toContain('Kai equipped Iron Sword.');
  });

  it('formation line marks the unit Unarmed; a healer is not', () => {
    const unit = createRecruitUnit(
      { name: 'Kai', level: 3 },
      gameData.classes.find((c) => c.name === 'Fighter'),
      gameData.weapons,
    );
    const axe = unit.weapon.name;
    expect(formationUnitLine(unit)).toBe(`Lv 3 Fighter · ${axe}`);
    unit.inventory = [];
    unit.weapon = null;
    expect(formationUnitLine(unit)).toBe('Lv 3 Fighter · Unarmed');
    const cleric = createRecruitUnit(
      { name: 'Saul', level: 2 },
      gameData.classes.find((c) => c.name === 'Cleric'),
      gameData.weapons,
    );
    cleric.inventory = [];
    cleric.weapon = null;
    expect(formationUnitLine(cleric)).toBe('Lv 2 Cleric');
  });

  it('rewards and shop comparisons read an unarmed unit as Attack 0', () => {
    const run = { roster: [bare()] };
    const sword = structuredClone(gameData.weapons.find((w) => w.name === 'Iron Sword'));
    // Iron Sword: Mt 5 + STR 8 = 13 from nothing.
    expect(sword.might).toBe(5);
    expect(rewardForWhom({ type: 'weapon', item: sword }, run)).toMatchObject({
      who: 'For Bare',
      detail: 'Atk 0 → 13 · 1 can wield',
      tone: 'good',
    });
    expect(equipmentComparison(run.roster[0], sword)).toContain('Attack 0 → 13');
  });
});

describe('a usable weapon given to an unarmed unit is equipped', () => {
  // Before: rewards, the shop and in-battle class changes added the weapon but left
  // `weapon: null`, so the unit read "Unarmed" and could not counter until it attacked.
  const ironSword = () => structuredClone(gameData.weapons.find((w) => w.name === 'Iron Sword'));
  const ironAxe = () => structuredClone(gameData.weapons.find((w) => w.name === 'Iron Axe'));

  it('a reward weapon', () => {
    const unit = bare();
    const run = { roster: [unit] };
    expect(applyRewardTarget(run, ironSword(), unit)).toEqual({ ok: true, reason: '' });
    expect(unit.inventory.map((w) => w.name)).toEqual(['Iron Sword']);
    expect(unit.weapon).toBe(unit.inventory[0]);
  });

  it('a weapon bought at the shop, but never one the buyer cannot wield', () => {
    const run = new RunManager(gameData);
    const unit = bare();
    run.roster = [unit];
    run.gold = 5000;
    const axe = { item: ironAxe(), type: 'weapon', price: 100 };
    const sword = { item: ironSword(), type: 'weapon', price: 100 };
    const stock = [axe, sword];
    expect(purchaseShopItem(run, stock, axe, unit).ok).toBe(true);
    // No Axe rank: carried, not equipped.
    expect(unit.weapon).toBeNull();
    expect(purchaseShopItem(run, stock, sword, unit).ok).toBe(true);
    // Equipped and moved to slot 0 (equipped-first).
    expect(unit.inventory.map((w) => w.name)).toEqual(['Iron Sword', 'Iron Axe']);
    expect(unit.weapon).toBe(unit.inventory[0]);
  });

  it('an armed recipient keeps its equipped weapon', () => {
    const own = ironSword();
    const unit = bare({ inventory: [own], weapon: own });
    applyRewardTarget({ roster: [unit] }, ironSword(), unit);
    expect(unit.weapon).toBe(own);
  });

  it('in battle, a reclass seal that grants a new weapon type arms an unarmed unit', async () => {
    const s = new BattleScene();
    Object.assign(s, {
      _battleSession: 1,
      gameData,
      runManager: null,
      hideActionMenu: vi.fn(),
      removeUnitGraphic: vi.fn(),
      addUnitGraphic: vi.fn(),
      updateHPBar: vi.fn(),
      showBriefBanner: vi.fn(async () => {}),
      finishUnitAction: vi.fn(),
    });
    const fighter = gameData.classes.find((c) => c.name === 'Fighter');
    const mercenary = gameData.classes.find((c) => c.name === 'Mercenary');
    const unit = createRecruitUnit({ name: 'Kai', level: 3 }, fighter, gameData.weapons);
    unit.inventory = [];
    unit.weapon = null;
    const seal = {
      name: 'Infantry Seal',
      type: 'Consumable',
      effect: 'reclass',
      subEffect: 'infantry',
      uses: 1,
    };
    unit.consumables = [seal];
    await s.executeReclass(unit, seal, mercenary);
    // Fighter (Axes) → Mercenary (Swords): the new Sword rank grants an Iron Sword.
    expect(unit.className).toBe('Mercenary');
    expect(unit.inventory.map((w) => w.name)).toEqual(['Iron Sword']);
    expect(unit.weapon).toBe(unit.inventory[0]);
    expect(unit.consumables).toEqual([]);
  });
});
