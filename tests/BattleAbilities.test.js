// Battle integration tests for utility abilities (Blink / Rally Cry /
// Healing Circle / Ensnare): action-menu presence, the Ability submenu,
// SELECTING_ABILITY_TILE state wiring (InputController + ESC/cancel +
// Vision rewind gating), effect execution, and suspend/serialize survival.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { InputController } from '../src/ui/InputController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { serializeSuspendUnit } from '../src/ui/BattleSuspendController.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { markUsed } from '../src/engine/ActionAbilitySystem.js';
import { hasCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const skillById = new Map(gameData.skills.map((skill) => [skill.id, skill]));

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

describe('action menu presence (Ability entry)', () => {
  function makeMenuScene(unit, { enemies = [], allies = [] } = {}) {
    const scene = new BattleScene();
    scene.gameData = { skills: gameData.skills, weaponArts: { arts: [] }, classes: [], lords: [] };
    scene.turnManager = { turnNumber: 1 };
    scene.grid = makeGridStub();
    scene.playerUnits = [unit, ...allies];
    scene.enemyUnits = enemies;
    return scene;
  }

  it('shows Ability when a usable ability has targets', () => {
    const unit = makeUnit({ skills: ['ensnare'] });
    const enemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 5, row: 7 });
    const scene = makeMenuScene(unit, { enemies: [enemy] });
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).toContain('Ability');
    expect(labels).toContain('Wait');
  });

  it('hides Ability once the per-map use is spent', () => {
    const unit = makeUnit({ skills: ['ensnare'] });
    markUsed(unit, 'ensnare');
    const enemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 5, row: 7 });
    const scene = makeMenuScene(unit, { enemies: [enemy] });
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).not.toContain('Ability');
  });

  it('hides Ability while silenced', () => {
    const unit = makeUnit({
      skills: ['blink'],
      _conditions: [{ id: 'silence', turnsRemaining: 2 }],
    });
    const scene = makeMenuScene(unit);
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).not.toContain('Ability');
  });

  it('shows Ability for a rooted unit (root allows acting)', () => {
    const unit = makeUnit({
      skills: ['blink'],
      _conditions: [{ id: 'root', turnsRemaining: 2 }],
    });
    const scene = makeMenuScene(unit);
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).toContain('Ability');
  });

  it('hides Ability when no ability has valid targets', () => {
    // Ensnare with no enemies in radius; no other abilities
    const unit = makeUnit({ skills: ['ensnare'] });
    const farEnemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 11, row: 11 });
    const scene = makeMenuScene(unit, { enemies: [farEnemy] });
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).not.toContain('Ability');
  });

  it('shows no Ability entry for units without actionAbility skills', () => {
    const unit = makeUnit({ skills: ['shove', 'sol'] });
    const scene = makeMenuScene(unit);
    const labels = setupActionMenuHarness(scene);
    scene.showActionMenu(unit);
    expect(labels).not.toContain('Ability');
  });
});

describe('ability submenu (picker)', () => {
  it('lists one row per ability with used/available status', () => {
    const unit = makeUnit({ skills: ['blink', 'ensnare'] });
    markUsed(unit, 'ensnare');
    const enemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 5, row: 7 });
    const scene = makeAbilityScene({ unit, enemies: [enemy] });
    const labels = setupActionMenuHarness(scene);
    scene.showAbilityPicker(unit);
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
    expect(scene.inEquipMenu).toBe(true);
    const blinkRow = labels.find((l) => l.startsWith('Blink'));
    const ensnareRow = labels.find((l) => l.startsWith('Ensnare'));
    expect(blinkRow).toContain('Map 0/1');
    expect(ensnareRow).toContain('Used this battle');
  });

  it('falls back to the action menu when the unit has no abilities', () => {
    const unit = makeUnit({ skills: [] });
    const scene = makeAbilityScene({ unit });
    setupActionMenuHarness(scene);
    scene.showActionMenu = vi.fn();
    scene.showAbilityPicker(unit);
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
  });
});

describe('Blink (SELECTING_ABILITY_TILE)', () => {
  it('startBlinkTileSelection highlights the legal tile diamond', () => {
    const unit = makeUnit({ skills: ['blink'] });
    const scene = makeAbilityScene({ unit });
    scene.hideActionMenu = vi.fn();
    scene._abilityController.startBlinkTileSelection(unit, skillById.get('blink'));
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene.abilityTiles.length).toBeGreaterThan(0);
    expect(scene._pendingAbility).toEqual({ unitName: 'Unit', skillId: 'blink' });
    expect(scene.grid.showAttackRange).toHaveBeenCalled();
  });

  it('handleAbilityTileClick executes the blink for a highlighted tile only', async () => {
    const unit = makeUnit({ skills: ['blink'] });
    const scene = makeAbilityScene({ unit });
    scene.hideActionMenu = vi.fn();
    scene.selectedUnit = unit;
    const ctrl = scene._abilityController;
    ctrl.startBlinkTileSelection(unit, skillById.get('blink'));
    const executeSpy = vi.spyOn(ctrl, 'executeBlink').mockResolvedValue();

    ctrl.handleAbilityTileClick({ col: 11, row: 11 }); // out of range
    expect(executeSpy).not.toHaveBeenCalled();

    ctrl.handleAbilityTileClick({ col: 5, row: 7 }); // manhattan 2 <= 4
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][2]).toEqual({ col: 5, row: 7 });
    expect(scene._pendingAbility).toBeNull();
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalled();
  });

  it('executeBlink relocates the unit, marks usage, refreshes fog, and ends the action', async () => {
    const unit = makeUnit({ skills: ['blink'] });
    const scene = makeAbilityScene({ unit });
    scene.hideActionMenu = vi.fn();
    const ctrl = scene._abilityController;

    await ctrl.executeBlink(unit, skillById.get('blink'), { col: 8, row: 4 });

    expect(unit.col).toBe(8);
    expect(unit.row).toBe(4);
    expect(unit._battleAbilityUsage.map.blink).toBe(1);
    expect(scene.updateUnitPosition).toHaveBeenCalledWith(unit);
    expect(scene._refreshPostCombatMovementState).toHaveBeenCalledWith([unit]);
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalled();
    // finishUnitAction without skipCanto — Canto applies like other actions
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit);
  });

  it('a blink error routes through _recoverUnitActionError instead of softlocking', async () => {
    const unit = makeUnit({ skills: ['blink'] });
    const scene = makeAbilityScene({ unit });
    scene.hideActionMenu = vi.fn();
    scene.updateUnitPosition = vi.fn(() => {
      throw new Error('boom');
    });
    scene._recoverUnitActionError = vi.fn();

    await scene._abilityController.executeBlink(unit, skillById.get('blink'), { col: 6, row: 5 });

    expect(scene._recoverUnitActionError).toHaveBeenCalledWith(
      unit,
      'ability_blink',
      expect.any(Error),
    );
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
  });
});

describe('state registration for SELECTING_ABILITY_TILE', () => {
  it('is cancelable and allows force-end-turn', () => {
    const scene = new BattleScene();
    scene.battleState = 'SELECTING_ABILITY_TILE';
    expect(scene.isCancelableBattleState()).toBe(true);

    scene.isStoryInputLocked = () => false;
    scene.turnManager = { currentPhase: 'player' };
    scene.pauseOverlay = null;
    scene.unitDetailOverlay = null;
    scene.lootSettingsOverlay = null;
    expect(scene.canForceEndTurn()).toBe(true);
  });

  it('InputController routes clicks to handleAbilityTileClick', () => {
    const scene = {
      isStoryInputLocked: () => false,
      unitDetailOverlay: null,
      battleState: 'SELECTING_ABILITY_TILE',
      isMobileInput: false,
      inspectMode: false,
      grid: { pixelToGrid: () => ({ col: 3, row: 4 }) },
      handleAbilityTileClick: vi.fn(),
      requestCancel: vi.fn(),
    };
    const ic = new InputController(scene);
    ic._screenToWorld = () => ({ x: 96, y: 128 });
    ic.onClick({ x: 96, y: 128, rightButtonDown: () => false });
    expect(scene.handleAbilityTileClick).toHaveBeenCalledWith({ col: 3, row: 4 });
  });

  it('handleCancel restores the action menu and clears blink state', () => {
    const unit = makeUnit({ skills: ['blink'] });
    const scene = makeAbilityScene({ unit });
    scene.hideActionMenu = vi.fn();
    scene.selectedUnit = unit;
    scene._abilityController.startBlinkTileSelection(unit, skillById.get('blink'));
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');

    scene.showActionMenu = vi.fn(() => {
      scene.battleState = 'UNIT_ACTION_MENU';
    });
    scene.handleCancel();

    expect(scene.grid.clearAttackHighlights).toHaveBeenCalled();
    expect(scene.abilityTiles).toEqual([]);
    expect(scene._pendingAbility).toBeNull();
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
  });

  it('Vision rewind stays available during ability tile selection', () => {
    const scene = {
      turnManager: { currentPhase: 'player' },
      battleState: 'SELECTING_ABILITY_TILE',
      pauseOverlay: null,
      visionDialog: null,
      visionSnapshot: {},
    };
    const ctrl = new VisionRewindController(scene);
    ctrl.getChargesRemaining = () => 1;
    expect(ctrl.canUseNow()).toBe(true);
  });
});

describe('confirm prompt (self-centered AOE)', () => {
  it('highlights affected units and clears the preview via the menu sentinel', () => {
    const unit = makeUnit({ skills: ['ensnare'] });
    const near = makeUnit({ name: 'Near', faction: 'enemy', col: 5, row: 7 });
    const far = makeUnit({ name: 'Far', faction: 'enemy', col: 11, row: 11 });
    const scene = makeAbilityScene({ unit, enemies: [near, far] });
    const labels = setupActionMenuHarness(scene);
    scene._abilityController._showConfirmPrompt(unit, skillById.get('ensnare'));

    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
    const [tiles] = scene.grid.showAttackRange.mock.calls.at(-1);
    expect(tiles).toEqual([{ col: 5, row: 7 }]);
    expect(labels).toContain('Use Ensnare (1 enemy)');
    expect(labels).toContain('Cancel');

    // The harness hideActionMenu stub bypasses destroy(); trigger the
    // sentinel directly the way the real hideActionMenu would.
    scene.grid.clearAttackHighlights.mockClear();
    for (const obj of scene.actionMenu) obj.destroy?.();
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalled();
  });
});

describe('Rally Cry effect', () => {
  it('buffs allies in radius via the shared timed-buff container and expires on the sweep', async () => {
    const unit = makeUnit({ name: 'Caster', skills: ['rally_cry_skill'] });
    const near = makeUnit({ name: 'Near', col: 6, row: 6 });
    const far = makeUnit({ name: 'Far', col: 10, row: 10 });
    const scene = makeAbilityScene({ unit, allies: [near, far] });
    scene.hideActionMenu = vi.fn();

    const baseStr = near.stats.STR;
    const baseSpd = near.stats.SPD;
    await scene._abilityController.executeSelfCentered(unit, skillById.get('rally_cry_skill'));

    expect(near.stats.STR).toBe(baseStr + 2);
    expect(near.stats.SPD).toBe(baseSpd + 2);
    expect(near._battleTimedWeaponArtBuffs).toHaveLength(1);
    const entry = near._battleTimedWeaponArtBuffs[0];
    expect(entry.artId).toBe('ability::rally_cry_skill');
    expect(entry.expiryPhase).toBe('player');
    expect(entry.expiryTurn).toBe(3); // turn 1 + 2 phases
    // Caster not included (includeSelf defaults off for Rally Cry)
    expect(unit._battleTimedWeaponArtBuffs).toBeUndefined();
    // Out-of-radius ally untouched
    expect(far._battleTimedWeaponArtBuffs).toBeUndefined();
    expect(unit._battleAbilityUsage.map.rally_cry_skill).toBe(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit);
    expect(scene._combatFx.playBuff).toHaveBeenCalledTimes(1);

    // Shared expiry sweep reverts the stats
    scene._expireTimedWeaponArtBuffs('player', 3);
    expect(near.stats.STR).toBe(baseStr);
    expect(near.stats.SPD).toBe(baseSpd);
    expect(near._battleTimedWeaponArtBuffs).toBeUndefined();
  });
});

describe('Healing Circle effect', () => {
  it('heals self and allies in radius, clamped to max HP', async () => {
    const unit = makeUnit({ name: 'Caster', skills: ['healing_circle'], currentHP: 10 });
    const hurt = makeUnit({ name: 'Hurt', col: 6, row: 6, currentHP: 20 });
    const full = makeUnit({ name: 'Full', col: 5, row: 6 }); // currentHP 24/24
    const far = makeUnit({ name: 'Far', col: 10, row: 10, currentHP: 1 });
    const scene = makeAbilityScene({ unit, allies: [hurt, full, far] });
    scene.hideActionMenu = vi.fn();

    await scene._abilityController.executeSelfCentered(unit, skillById.get('healing_circle'));

    expect(unit.currentHP).toBe(24); // 10 + 15 clamped to 24 (includeSelf)
    expect(hurt.currentHP).toBe(24); // 20 + 15 clamped to 24
    expect(full.currentHP).toBe(24); // unchanged
    expect(far.currentHP).toBe(1); // out of radius
    expect(scene._combatFx.playHeal).toHaveBeenCalledTimes(2);
    expect(unit._battleAbilityUsage.map.healing_circle).toBe(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit);
  });
});

describe('Ensnare effect', () => {
  it('roots enemies in radius with the +1 phase convention', async () => {
    const unit = makeUnit({ name: 'Caster', skills: ['ensnare'] });
    const near = makeUnit({ name: 'Near', faction: 'enemy', col: 5, row: 7 });
    const far = makeUnit({ name: 'Far', faction: 'enemy', col: 11, row: 11 });
    const scene = makeAbilityScene({ unit, enemies: [near, far] });
    scene.hideActionMenu = vi.fn();

    await scene._abilityController.executeSelfCentered(unit, skillById.get('ensnare'));

    expect(hasCondition(near, 'root')).toBe(true);
    const cond = near._conditions.find((c) => c.id === 'root');
    // durationPhases 1 + 1: recovery decrements at phase start before acting
    expect(cond.turnsRemaining).toBe(2);
    expect(cond.recoveryChance).toBe(0);
    expect(hasCondition(far, 'root')).toBe(false);
    expect(scene._addConditionIcon).toHaveBeenCalledWith(near, 'root');
    expect(scene.dangerZoneStale).toBe(true);
    expect(unit._battleAbilityUsage.map.ensnare).toBe(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit);
  });

  it('respects statusImmunity accessories', async () => {
    const unit = makeUnit({ name: 'Caster', skills: ['ensnare'] });
    const warded = makeUnit({
      name: 'Warded',
      faction: 'enemy',
      col: 5,
      row: 7,
      accessory: { combatEffects: { statusImmunity: true } },
    });
    const scene = makeAbilityScene({ unit, enemies: [warded] });
    scene.hideActionMenu = vi.fn();

    await scene._abilityController.executeSelfCentered(unit, skillById.get('ensnare'));

    expect(hasCondition(warded, 'root')).toBe(false);
    expect(scene._addConditionIcon).not.toHaveBeenCalled();
    expect(scene.showMinorHintAt).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'Immune!',
      expect.any(String),
    );
    // The use is still spent — the target being immune is on the player
    expect(unit._battleAbilityUsage.map.ensnare).toBe(1);
  });
});

describe('suspend/serialize survival', () => {
  it('serializeSuspendUnit carries _battleAbilityUsage through the checkpoint', () => {
    const ironSword = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof', uid: 'w-1' };
    const unit = makeUnit({
      className: 'Mercenary',
      level: 3,
      skills: ['blink'],
      weapon: ironSword,
      inventory: [ironSword],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    markUsed(unit, 'blink');
    const data = serializeSuspendUnit(unit);
    expect(data._battleAbilityUsage).toEqual({ map: { blink: 1 } });
    // Deep copy, not a shared reference
    expect(data._battleAbilityUsage).not.toBe(unit._battleAbilityUsage);
    // Round trip (BattleSuspendController.applyUnits structuredClones the data)
    const restored = structuredClone(data);
    expect(restored._battleAbilityUsage.map.blink).toBe(1);
  });

  it('RunManager.serializeUnit scrubs the counter for between-battle persistence', () => {
    const ironSword = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof', uid: 'w-1' };
    const unit = makeUnit({
      className: 'Mercenary',
      level: 3,
      skills: ['blink'],
      weapon: ironSword,
      inventory: [ironSword],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    markUsed(unit, 'blink');
    const data = serializeUnit(unit);
    expect(data._battleAbilityUsage).toBeUndefined();
  });
});
