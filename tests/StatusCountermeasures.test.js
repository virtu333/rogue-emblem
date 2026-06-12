// Status countermeasures + Restore staff suite.
// See docs/reports/status_countermeasures_restore_spec_2026-06-12.md
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import {
  applyCondition,
  hasCondition,
  getConditions,
  isCureStaff,
  isHealStaff,
  isStatusStaff,
  isStatusImmune,
  resolveStatusStaff,
} from '../src/engine/StatusConditionSystem.js';
import { generateShopInventory } from '../src/engine/LootSystem.js';
import { formatAccessoryCombatEffect } from '../src/utils/accessoryText.js';
import { XP_BASE_HEAL } from '../src/utils/constants.js';

const gameData = loadGameData();
const artById = new Map(gameData.weaponArts.arts.map((art) => [art.id, art]));
const restoreStaff = gameData.weapons.find((w) => w.name === 'Restore');
const wardingCharm = gameData.accessories.find((a) => a.name === 'Warding Charm');

function makeUnit(overrides = {}) {
  const stats = overrides.stats || {
    HP: 30,
    STR: 10,
    MAG: 8,
    SKL: 8,
    SPD: 8,
    DEF: 8,
    RES: 8,
    LCK: 8,
    MOV: 5,
  };
  return {
    name: 'Unit',
    faction: 'player',
    col: 0,
    row: 0,
    currentHP: stats.HP,
    stats: { ...stats },
    mov: stats.MOV,
    ...overrides,
  };
}

function withWardingCharm(unit) {
  unit.accessory = { name: 'Warding Charm', combatEffects: { statusImmunity: true } };
  return unit;
}

describe('countermeasures: data shapes', () => {
  it('Restore staff exists with the cure contract', () => {
    expect(restoreStaff).toMatchObject({
      type: 'Staff',
      tier: 'Steel',
      rankRequired: 'Prof',
      range: '1-2',
      uses: 2,
      perBattleUses: true,
      cureConditions: true,
      price: 1200,
    });
  });

  it('Warding Charm exists with statusImmunity', () => {
    expect(wardingCharm).toMatchObject({
      type: 'Accessory',
      combatEffects: { statusImmunity: true },
      price: 2000,
    });
  });

  it('every staff classifies as exactly one of heal/status/cure', () => {
    const staves = gameData.weapons.filter((w) => w.type === 'Staff');
    expect(staves.length).toBeGreaterThanOrEqual(8);
    for (const staff of staves) {
      const flags = [isHealStaff(staff), isStatusStaff(staff), isCureStaff(staff)];
      expect(flags.filter(Boolean)).toHaveLength(1);
    }
    expect(isCureStaff(restoreStaff)).toBe(true);
    expect(isHealStaff(restoreStaff)).toBe(false);
  });

  it('cure tools are reachable in act2+ loot pools', () => {
    const consumableNames = new Set(gameData.consumables.map((c) => c.name));
    const weaponNames = new Set(gameData.weapons.map((w) => w.name));
    const accessoryNames = new Set(gameData.accessories.map((a) => a.name));

    for (const actId of ['act2', 'act3', 'act4']) {
      const table = gameData.lootTables[actId];
      expect(table.weapons).toContain('Restore');
      expect(table.accessories).toContain('Warding Charm');
      expect(table.healing).toContain('Herb');
      // Everything referenced must resolve against a catalog
      for (const name of table.healing) expect(consumableNames.has(name)).toBe(true);
      for (const name of table.weapons) expect(weaponNames.has(name)).toBe(true);
      for (const name of table.accessories) expect(accessoryNames.has(name)).toBe(true);
    }
    expect(gameData.lootTables.act3.healing).toContain('Remedy');
    expect(gameData.lootTables.act4.healing).toContain('Remedy');
    // Act 1 stays countermeasure-free (no status pressure before act2)
    expect(gameData.lootTables.act1.weapons).not.toContain('Restore');
    expect(gameData.lootTables.act1.healing).not.toContain('Herb');
  });
});

describe('countermeasures: status immunity engine gate', () => {
  it('isStatusImmune reads the equipped accessory', () => {
    const unit = makeUnit();
    expect(isStatusImmune(unit)).toBe(false);
    withWardingCharm(unit);
    expect(isStatusImmune(unit)).toBe(true);
    expect(isStatusImmune(null)).toBe(false);
  });

  it('applyCondition reports application and blocks every condition while immune', () => {
    const normal = makeUnit();
    expect(applyCondition(normal, 'sleep', 3)).toBe(true);
    expect(hasCondition(normal, 'sleep')).toBe(true);

    const immune = withWardingCharm(makeUnit());
    for (const conditionId of ['sleep', 'silence', 'root', 'acid']) {
      expect(applyCondition(immune, conditionId, 3)).toBe(false);
    }
    expect(getConditions(immune)).toEqual([]);
  });

  it('immunity blocks new conditions but does not cleanse existing ones', () => {
    const unit = makeUnit();
    applyCondition(unit, 'silence', 3);
    withWardingCharm(unit);
    expect(hasCondition(unit, 'silence')).toBe(true); // equip is not a cure
    expect(applyCondition(unit, 'sleep', 3)).toBe(false);
    expect(getConditions(unit)).toHaveLength(1);
  });

  it('applyCondition still rejects invalid input', () => {
    expect(applyCondition(null, 'sleep', 3)).toBe(false);
    expect(applyCondition(makeUnit(), 'notACondition', 3)).toBe(false);
  });

  it('resolveStatusStaff short-circuits without consuming RNG for immune targets', () => {
    const staff = gameData.weapons.find((w) => w.name === 'Sleep Staff');
    const caster = makeUnit({ faction: 'enemy' });
    const target = withWardingCharm(makeUnit());
    const rng = vi.fn(() => 0); // would always hit if rolled

    const result = resolveStatusStaff(staff, caster, target, rng);
    expect(result).toEqual({ hit: false, hitChance: 0, conditionId: 'sleep', immune: true });
    expect(rng).not.toHaveBeenCalled();
    expect(getConditions(target)).toEqual([]);
  });
});

describe('countermeasures: art status vs immunity (scene/headless parity)', () => {
  let scene;
  let headless;

  beforeEach(() => {
    scene = new BattleScene();
    scene.turnManager = { turnNumber: 1 };
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.grid = { gridToPixel: (col, row) => ({ x: col * 16, y: row * 16 }) };
    scene.updateHPBar = vi.fn();
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.removeUnit = vi.fn(async () => {});

    headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.turnManager = { turnNumber: 1 };
    headless.battleConfig = { objective: 'rout' };
    headless.grid = {
      cols: 10,
      rows: 10,
      getTerrainAt: () => null,
      getMoveCost: () => 1,
      fogEnabled: false,
    };
    headless.playerUnits = [];
    headless.enemyUnits = [];
    headless.npcUnits = [];
  });

  it('Encloser cannot root a Warding Charm holder in scene or harness', async () => {
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 6 }],
    };
    const sceneAttacker = makeUnit({ name: 'Atk', faction: 'enemy' });
    const sceneDefender = withWardingCharm(makeUnit({ name: 'Def', faction: 'player', col: 1 }));
    scene.playerUnits = [sceneDefender];
    scene.enemyUnits = [sceneAttacker];
    await scene._applyResolvedCombatPostEffects({
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: artById.get('bow_encloser'),
    });

    const headlessAttacker = makeUnit({ name: 'Atk', faction: 'enemy' });
    const headlessDefender = withWardingCharm(makeUnit({ name: 'Def', faction: 'player', col: 1 }));
    headless.playerUnits = [headlessDefender];
    headless.enemyUnits = [headlessAttacker];
    headless._applyResolvedCombatPostEffects({
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: artById.get('bow_encloser'),
    });

    for (const defender of [sceneDefender, headlessDefender]) {
      expect(getConditions(defender)).toEqual([]);
      expect(defender._conditionIcons).toBeUndefined();
    }
    // Scene surfaces the block instead of the status label
    const hints = scene.showMinorHintAt.mock.calls.map((call) => call[2]);
    expect(hints).toContain('Immune!');
    expect(hints).not.toContain('Rooted!');
  });

  it('the same art still roots an unprotected defender (control)', async () => {
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 6 }],
    };
    const attacker = makeUnit({ name: 'Atk', faction: 'enemy' });
    const defender = makeUnit({ name: 'Def', faction: 'player', col: 1 });
    scene.playerUnits = [defender];
    scene.enemyUnits = [attacker];
    await scene._applyResolvedCombatPostEffects({
      attacker,
      defender,
      result,
      attackerWeaponArt: artById.get('bow_encloser'),
    });
    expect(hasCondition(defender, 'root')).toBe(true);
    const hints = scene.showMinorHintAt.mock.calls.map((call) => call[2]);
    expect(hints).toContain('Rooted!');
  });
});

describe('countermeasures: Restore staff flow', () => {
  function makeHealSceneCtx() {
    const ctx = {
      battleParams: { xpMultiplier: 1 },
      battleState: '',
      registry: { get: () => ({ playSFX() {} }) },
      grid: {
        clearAttackHighlights() {},
        gridToPixel: () => ({ x: 0, y: 0 }),
        showHealRange: vi.fn(),
      },
      add: {
        text: () => ({
          setOrigin() {
            return this;
          },
          setDepth() {
            return this;
          },
          destroy() {},
        }),
      },
      tweens: {
        add: ({ onComplete }) => {
          if (onComplete) onComplete();
        },
      },
      _isReducedEffects: () => true,
      _awaitSceneDelay: async () => {},
      _removeAllConditionIcons: vi.fn(),
      undimUnit: vi.fn(),
      awardScaledXP: vi.fn(async () => {}),
      finishUnitAction: vi.fn(),
      updateHPBar: vi.fn(),
      hideActionMenu() {},
      gameData: { classes: [], skills: [] },
    };
    return ctx;
  }

  it('findHealTargets returns only conditioned allies in range for a cure staff', () => {
    const ctx = makeHealSceneCtx();
    const staff = { ...restoreStaff };
    const healer = makeUnit({
      col: 5,
      row: 5,
      inventory: [staff],
      weapon: staff,
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    });

    const rootedAdjacent = makeUnit({ name: 'Rooted', col: 5, row: 6 });
    applyCondition(rootedAdjacent, 'root', 2, { recoveryChance: 0 });
    const sleptAtTwo = makeUnit({ name: 'Slept', col: 5, row: 3 });
    applyCondition(sleptAtTwo, 'sleep', 3);
    const healthyAdjacent = makeUnit({ name: 'Healthy', col: 4, row: 5 });
    const conditionedTooFar = makeUnit({ name: 'Far', col: 5, row: 8 });
    applyCondition(conditionedTooFar, 'silence', 3);
    const woundedAdjacent = makeUnit({ name: 'Wounded', col: 6, row: 5, currentHP: 5 });
    // Healer itself silenced — cure staves can't self-target
    applyCondition(healer, 'silence', 3);

    ctx.playerUnits = [
      healer,
      rootedAdjacent,
      sleptAtTwo,
      healthyAdjacent,
      conditionedTooFar,
      woundedAdjacent,
    ];

    const targets = BattleScene.prototype.findHealTargets.call(ctx, healer, staff);
    expect(targets.map((t) => t.name).sort()).toEqual(['Rooted', 'Slept']);
  });

  it('a heal staff still targets by missing HP, not conditions', () => {
    const ctx = makeHealSceneCtx();
    const heal = gameData.weapons.find((w) => w.name === 'Heal');
    const staff = { ...heal };
    const healer = makeUnit({
      col: 5,
      row: 5,
      inventory: [staff],
      weapon: staff,
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    });
    const wounded = makeUnit({ name: 'Wounded', col: 5, row: 6, currentHP: 10 });
    const conditionedFullHP = makeUnit({ name: 'Conditioned', col: 4, row: 5 });
    applyCondition(conditionedFullHP, 'root', 2);
    ctx.playerUnits = [healer, wounded, conditionedFullHP];

    const targets = BattleScene.prototype.findHealTargets.call(ctx, healer, staff);
    expect(targets.map((t) => t.name)).toEqual(['Wounded']);
  });

  it('executeHeal with Restore cures, spends a use, and awards staff XP', async () => {
    const ctx = makeHealSceneCtx();
    const staff = { ...restoreStaff, _usesSpent: 0 };
    const sword = { name: 'Iron Sword', type: 'Sword', range: '1', rankRequired: 'Prof' };
    const healer = makeUnit({
      col: 5,
      row: 5,
      inventory: [staff, sword],
      weapon: staff,
      proficiencies: [
        { type: 'Staff', rank: 'Prof' },
        { type: 'Sword', rank: 'Prof' },
      ],
    });
    const target = makeUnit({
      name: 'Afflicted',
      col: 5,
      row: 6,
      graphic: { setTint() {}, clearTint() {} },
    });
    applyCondition(target, 'sleep', 3);
    applyCondition(target, 'root', 2, { recoveryChance: 0 });
    ctx.playerUnits = [healer, target];

    await BattleScene.prototype.executeHeal.call(ctx, healer, target);

    expect(getConditions(target)).toEqual([]);
    expect(ctx._removeAllConditionIcons).toHaveBeenCalledWith(target);
    expect(ctx.undimUnit).toHaveBeenCalledWith(target);
    expect(staff._usesSpent).toBe(1);
    expect(ctx.awardScaledXP).toHaveBeenCalledWith(healer, XP_BASE_HEAL);
    expect(ctx.finishUnitAction).toHaveBeenCalledWith(healer);
    // Target HP untouched — Restore is cure-only
    expect(target.currentHP).toBe(target.stats.HP);
  });

  it('re-equips a combat weapon when Restore is depleted', async () => {
    const ctx = makeHealSceneCtx();
    // MAG 4 → no bonus uses; one use left
    const staff = { ...restoreStaff, _usesSpent: 1 };
    const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5, rankRequired: 'Prof' };
    const healer = makeUnit({
      col: 5,
      row: 5,
      stats: { HP: 30, STR: 10, MAG: 4, SKL: 8, SPD: 8, DEF: 8, RES: 8, LCK: 8, MOV: 5 },
      inventory: [staff, sword],
      weapon: staff,
      proficiencies: [
        { type: 'Staff', rank: 'Prof' },
        { type: 'Sword', rank: 'Prof' },
      ],
    });
    const target = makeUnit({
      name: 'Afflicted',
      col: 5,
      row: 6,
      graphic: { setTint() {}, clearTint() {} },
    });
    applyCondition(target, 'silence', 3);
    ctx.playerUnits = [healer, target];

    await BattleScene.prototype.executeHeal.call(ctx, healer, target);

    expect(staff._usesSpent).toBe(2);
    expect(healer.weapon).toBe(sword);
  });
});

describe('countermeasures: shop cure gating includes the Restore staff', () => {
  it('a gated shop always stocks Herb, Remedy, and Restore', () => {
    const inventory = generateShopInventory(
      'act1', // act1 pools carry no cure items — only the gated append can add them
      gameData.lootTables,
      gameData.weapons,
      gameData.consumables,
      gameData.accessories,
      null,
      null,
      { shopCureGating: { act1: true } },
    );
    const names = inventory.map((entry) => entry.item.name);
    expect(names).toContain('Herb');
    expect(names).toContain('Remedy');
    expect(names).toContain('Restore');

    const restoreEntry = inventory.find((entry) => entry.item.name === 'Restore');
    expect(restoreEntry.type).toBe('weapon');
    expect(restoreEntry.price).toBe(1200);
  });

  it('an ungated act1 shop cannot stock cure items', () => {
    for (let i = 0; i < 5; i++) {
      const inventory = generateShopInventory(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
        gameData.accessories,
        null,
        null,
        { shopCureGating: { act1: false } },
      );
      const names = inventory.map((entry) => entry.item.name);
      expect(names).not.toContain('Herb');
      expect(names).not.toContain('Remedy');
      expect(names).not.toContain('Restore');
    }
  });
});

describe('countermeasures: text surfaces', () => {
  it('Warding Charm renders its immunity in accessory text', () => {
    expect(formatAccessoryCombatEffect(wardingCharm)).toContain('Immune to status conditions');
  });
});
