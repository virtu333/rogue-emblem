// An accessory's bound skill and the battle UI (docs/specs/phase3.md 3H): the action menu, the
// Ability picker and the forecast all read one effective-skill model, so a lent skill shows
// exactly when it works and stops showing when it does not (accessory off, per-battle use
// spent, silenced).
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { bindAccessorySkill } from '../src/engine/AccessorySkills.js';
import { markUsed } from '../src/engine/ActionAbilitySystem.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

/** A Power Ring that lends `skillId` (made by the real binder with a stubbed stream). */
function accessoryLending(skillId) {
  const pool = gameData.lootTables.accessorySkills.poolByAct.act4;
  const draws = [0, (pool.indexOf(skillId) + 0.5) / pool.length];
  const ring = structuredClone(gameData.accessories.find((a) => a.name === 'Power Ring'));
  return bindAccessorySkill(ring, 'act4', gameData, () => draws.shift());
}

function makeUnit(overrides = {}) {
  const stats = overrides.stats || {
    HP: 24,
    STR: 8,
    MAG: 4,
    SKL: 6,
    SPD: 7,
    LCK: 3,
    DEF: 4,
    RES: 2,
    MOV: 5,
  };
  return {
    name: 'Unit',
    faction: 'player',
    col: 5,
    row: 5,
    currentHP: stats.HP,
    stats: { ...stats },
    mov: stats.MOV,
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    _conditions: [],
    ...overrides,
  };
}

// setupActionMenuHarness pattern from tests/BattleWeaponArts.test.js
function setupActionMenuHarness(scene) {
  const labels = [];
  scene._makeMenuTextButton = vi.fn((_x, _y, label) => {
    labels.push(label);
    return {
      label,
      destroy() {},
      setColor() {
        return this;
      },
      on() {
        return this;
      },
      setOrigin() {
        return this;
      },
      setDepth() {
        return this;
      },
      setInteractive() {
        return this;
      },
    };
  });
  scene._pinToScreen = vi.fn();
  scene.hideActionMenu = vi.fn(() => {
    scene.actionMenu = [];
    scene.inEquipMenu = false;
  });
  scene._clampMenuPosition = vi.fn((x, y) => ({ x, y }));
  scene.add = {
    rectangle: vi.fn(() => ({
      destroy() {},
      setDepth() {
        return this;
      },
      setStrokeStyle() {
        return this;
      },
    })),
  };
  scene.findHealTargets = vi.fn(() => []);
  scene.getActiveHealStaff = vi.fn(() => null);
  scene.findShoveTargets = vi.fn(() => []);
  scene.findPullTargets = vi.fn(() => []);
  scene.findTradeTargets = vi.fn(() => []);
  scene.findSwapTargets = vi.fn(() => []);
  scene.findDanceTargets = vi.fn(() => []);
  scene.findBreakTargets = vi.fn(() => []);
  scene.npcUnits = [];
  scene.battleConfig = {};
  return labels;
}

function makeGridStub({ cols = 12, rows = 12 } = {}) {
  return {
    cols,
    rows,
    fogEnabled: false,
    getMoveCost: () => 1,
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
    showAttackRange: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearHighlights: vi.fn(),
  };
}

function makeAbilityScene({ unit, allies = [], enemies = [] } = {}) {
  const scene = new BattleScene();
  scene.gameData = {
    skills: gameData.skills,
    weaponArts: { arts: [] },
    classes: [],
    lords: [],
  };
  scene.turnManager = { turnNumber: 1, currentPhase: 'player' };
  scene.grid = makeGridStub();
  scene.playerUnits = [unit, ...allies];
  scene.enemyUnits = enemies;
  scene.npcUnits = [];
  scene.registry = { get: vi.fn(() => null) };
  scene.updateHPBar = vi.fn();
  scene.showMinorHintAt = vi.fn();
  scene.updateUnitPosition = vi.fn();
  scene.commitVisionSnapshotIfPending = vi.fn();
  scene.finishUnitAction = vi.fn();
  scene._addConditionIcon = vi.fn();
  scene._refreshPostCombatMovementState = vi.fn();
  scene._combatFx = { playBuff: vi.fn(), playHeal: vi.fn(), playStatus: vi.fn() };
  scene._awaitSceneTween = vi.fn(async () => {});
  // Pre-seed the controller the scene shims would otherwise lazily create
  scene._abilityController = new AbilityController(scene);
  return scene;
}

const sword = {
  name: 'Iron Sword',
  type: 'Sword',
  range: '1',
  might: 5,
  hit: 90,
  crit: 0,
  weight: 5,
};

describe('a lent skill in the battle UI', () => {
  it('the action menu offers Ability while the accessory is worn, and not once it is off', () => {
    const unit = makeUnit({});
    equipAccessory(unit, accessoryLending('blink'));
    const scene = makeAbilityScene({ unit });
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).toContain('Ability');
    unequipAccessory(unit);
    const after = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(after).not.toContain('Ability');
  });

  it('the Ability picker lists the lent Blink with its uses; spent, it says so; off, it is gone', () => {
    const unit = makeUnit({});
    const ring = accessoryLending('blink');
    equipAccessory(unit, ring);
    const scene = makeAbilityScene({ unit });
    const labels = setupActionMenuHarness(scene);
    scene.showAbilityPicker(unit);
    expect(labels.find((l) => l.startsWith('Blink'))).toContain('1/1 uses left');
    // Used once: the picker says so, and the entry cannot be used.
    markUsed(unit, 'blink');
    const spent = setupActionMenuHarness(scene);
    scene.showAbilityPicker(unit);
    expect(spent.find((l) => l.startsWith('Blink'))).toContain('Used this battle');
    const [entry] = scene._abilityController._getAbilityEntries(unit);
    expect(entry).toMatchObject({ canUse: false, reason: 'per_map_limit' });
    // Taken off and put back on: still spent (the limit is the unit's).
    unequipAccessory(unit);
    expect(scene._abilityController._getAbilityEntries(unit)).toEqual([]);
    equipAccessory(unit, ring);
    const [again] = scene._abilityController._getAbilityEntries(unit);
    expect(again).toMatchObject({ canUse: false, reason: 'per_map_limit' });
  });

  it('a silenced wearer sees the lent ability, disabled, as a known one would', () => {
    const silenced = [{ id: 'silence', turnsRemaining: 2 }];
    const unit = makeUnit({ _conditions: silenced });
    equipAccessory(unit, accessoryLending('blink'));
    const [entry] = makeAbilityScene({ unit })._abilityController._getAbilityEntries(unit);
    expect(entry.skill.id).toBe('blink');
    expect(entry).toMatchObject({ canUse: false, reason: 'silenced' });
    const known = makeUnit({ skills: ['blink'], _conditions: silenced });
    const [same] = makeAbilityScene({ unit: known })._abilityController._getAbilityEntries(known);
    expect({ canUse: same.canUse, reason: same.reason }).toEqual({
      canUse: entry.canUse,
      reason: entry.reason,
    });
  });

  it('the forecast warns of a counter proc a defender’s accessory lends, and not once it is off', () => {
    const attacker = makeUnit({ name: 'A', weapon: { ...sword } });
    const defender = makeUnit({ name: 'D', faction: 'enemy', col: 6, weapon: { ...sword } });
    const ctx = { skillsData: gameData.skills };
    const forecast = () =>
      getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1, null, null, ctx);
    expect(forecast().display.counterHasDamageProc).toBe(false);
    equipAccessory(defender, accessoryLending('luna'));
    expect(forecast().display.counterHasDamageProc).toBe(true);
    unequipAccessory(defender);
    expect(forecast().display.counterHasDamageProc).toBe(false);
  });
});
