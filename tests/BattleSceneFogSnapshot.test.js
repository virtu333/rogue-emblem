// BattleSceneFogSnapshot.test.js - Integration tests for fog snapshot lifecycle in BattleScene
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transitionToSceneMock, rosterOverlayInstances } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
  rosterOverlayInstances: [],
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: transitionToSceneMock,
  };
});

vi.mock('../src/ui/RosterOverlay.js', () => ({
  RosterOverlay: class {
    constructor(scene, runManager, gameData, options = {}) {
      this.scene = scene;
      this.runManager = runManager;
      this.gameData = gameData;
      this.options = options;
      this.visible = false;
      rosterOverlayInstances.push(this);
    }

    show() {
      this.visible = true;
    }
  },
}));

import { BattleScene, resetUnitForBattle } from '../src/scenes/BattleScene.js';
import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../src/utils/constants.js';
import { applyCondition, isSleeping, isSilenced } from '../src/engine/StatusConditionSystem.js';

function makeUnit(overrides = {}) {
  return {
    col: 1,
    row: 1,
    faction: 'player',
    moveType: 'Infantry',
    hasMoved: false,
    hasActed: false,
    weapon: { range: '1' },
    inventory: [],
    consumables: [],
    skills: [],
    stats: { MOV: 5 },
    graphic: { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn() },
    label: null,
    hpBar: null,
    ...overrides,
  };
}

function setupScene() {
  const scene = new BattleScene();
  const unit = makeUnit();

  const snapshotSpy = vi.fn(() => new Set(['0,0', '1,1']));
  const restoreSpy = vi.fn();
  const updateFogSpy = vi.fn();

  scene.grid = {
    fogEnabled: true,
    snapshotFogState: snapshotSpy,
    restoreFogState: restoreSpy,
    updateFogOfWar: updateFogSpy,
    isVisible: vi.fn(() => true),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearPath: vi.fn(),
    getMovementRange: vi.fn(() => new Map()),
    getAttackRange: vi.fn(() => []),
    gridToPixel: () => ({ x: 64, y: 64 }),
    cols: 10,
    rows: 10,
  };
  scene.playerUnits = [unit];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.battleParams = { tutorialMode: false };
  scene.battleState = 'PLAYER_IDLE';
  scene.selectedUnit = unit;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.dangerZoneStale = false;
  scene.dangerZoneCache = [];
  scene.tradeMutatedThisSession = false;
  scene.inEquipMenu = false;
  scene.attackTargets = [];
  scene.healTargets = [];
  scene.shoveTargets = [];
  scene.pullTargets = [];
  scene.tradeTargets = [];
  scene.swapTargets = [];
  scene.danceTargets = [];
  scene.cantoRange = null;
  scene.movementRange = null;
  scene.unitPositions = null;

  // Stubs for methods called by the lifecycle hooks
  scene.showActionMenu = vi.fn();
  scene.hideActionMenu = vi.fn();
  scene.hideForecast = vi.fn();
  scene.cleanupTradeUI = vi.fn();
  scene.dimUnit = vi.fn();
  scene.updateUnitPosition = vi.fn();
  scene.updateEnemyVisibility = vi.fn();
  scene.selectUnit = vi.fn();
  scene.deselectUnit = vi.fn();
  scene.buildUnitPositionMap = vi.fn(() => new Map());
  scene._clearSelectedWeaponArt = vi.fn();
  scene.isStoryInputLocked = () => false;
  scene._isTutorialStrictGateActive = () => false;
  scene.inspectionPanel = null;
  scene.turnManager = { endPlayerPhase: vi.fn(), unitActed: vi.fn() };
  scene.showPhaseBanner = vi.fn();
  scene.dangerZone = { hide: vi.fn() };
  scene.undimUnit = vi.fn();
  scene.captureVisionSnapshot = vi.fn();
  scene.updateVisionHud = vi.fn();
  scene.refreshEndTurnControl = vi.fn();
  scene.getTurnPressureState = vi.fn(() => ({ active: false, xpMultiplier: 1, goldMultiplier: 1 }));
  scene.registry = { get: vi.fn(() => null) };
  scene.time = { delayedCall: vi.fn() };

  return { scene, unit, snapshotSpy, restoreSpy, updateFogSpy };
}

beforeEach(() => {
  transitionToSceneMock.mockReset();
  transitionToSceneMock.mockResolvedValue(true);
  rosterOverlayInstances.length = 0;
});

function makeUiObject(seed = {}) {
  const handlers = {};
  return {
    ...seed,
    handlers,
    destroyed: false,
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setColor(color) {
      this.color = color;
      return this;
    },
    setText(text) {
      this.text = text;
      return this;
    },
    setFillStyle() {
      return this;
    },
    on(event, cb) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(cb);
      return this;
    },
    trigger(event, ...args) {
      for (const cb of handlers[event] || []) cb(...args);
    },
    destroy: vi.fn(function destroy() {
      this.destroyed = true;
    }),
  };
}

function attachUiHarness(scene) {
  const rectangles = [];
  const texts = [];

  scene.cameras = {
    main: { centerX: 320, centerY: 240, width: 640, height: 480 },
  };
  scene.scene = { isActive: vi.fn(() => true) };
  scene.add = {
    rectangle: vi.fn((x, y, width, height, color, alpha) => {
      const obj = makeUiObject({ kind: 'rectangle', x, y, width, height, color, alpha });
      rectangles.push(obj);
      return obj;
    }),
    text: vi.fn((x, y, text, style) => {
      const obj = makeUiObject({ kind: 'text', x, y, text, style });
      texts.push(obj);
      return obj;
    }),
  };

  return { rectangles, texts };
}

describe('BattleScene fog snapshot lifecycle', () => {
  it('undoMove restores fog state from snapshot', async () => {
    const { scene, unit, restoreSpy, updateFogSpy } = setupScene();

    // Simulate: unit selected and moved - preMoveLoc + snapshot set
    scene.preMoveLoc = { col: 1, row: 1 };
    const fakeSnapshot = new Set(['0,0', '1,1']);
    scene._preFogSnapshot = fakeSnapshot;
    unit.col = 3;
    unit.row = 3;

    BattleScene.prototype.undoMove.call(scene, unit);

    expect(restoreSpy).toHaveBeenCalledWith(fakeSnapshot);
    expect(scene._preFogSnapshot).toBeNull();
    expect(updateFogSpy).toHaveBeenCalledWith(scene.playerUnits);
    expect(scene.updateEnemyVisibility).toHaveBeenCalled();
    // Unit should be back at original position
    expect(unit.col).toBe(1);
    expect(unit.row).toBe(1);
  });

  it('finishUnitAction clears snapshot without restoring', () => {
    const { scene, unit, restoreSpy } = setupScene();

    // Simulate: unit moved and acted - snapshot still set
    scene.preMoveLoc = { col: 1, row: 1 };
    scene._preFogSnapshot = new Set(['0,0']);

    BattleScene.prototype.finishUnitAction.call(scene, unit);

    expect(scene._preFogSnapshot).toBeNull();
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('finishUnitAction canto branch clears snapshot before canto move', () => {
    const { scene, unit, restoreSpy } = setupScene();

    unit.skills = ['canto'];
    unit.stats.MOV = 6;
    unit._movementSpent = 2;
    scene.preMoveLoc = { col: 1, row: 1 };
    scene._preFogSnapshot = new Set(['0,0']);
    scene.startCantoMove = vi.fn();

    BattleScene.prototype.finishUnitAction.call(scene, unit);

    expect(scene._preFogSnapshot).toBeNull();
    expect(scene.preMoveLoc).toBeNull();
    expect(scene.startCantoMove).toHaveBeenCalledWith(unit, 4);
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('stay-in-place selected-click path takes a fresh snapshot', () => {
    const { scene, unit, snapshotSpy } = setupScene();

    scene.selectedUnit = unit;
    unit.col = 2;
    unit.row = 2;
    scene.movementRange = new Map();

    BattleScene.prototype.handleSelectedClick.call(scene, { col: 2, row: 2 });

    expect(snapshotSpy).toHaveBeenCalled();
    expect(scene.preMoveLoc).toEqual({ col: 2, row: 2 });
    expect(scene._preFogSnapshot).toBeInstanceOf(Set);
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
  });

  it('forceEndTurn clears snapshot', () => {
    const { scene } = setupScene();

    // Extra stubs needed by forceEndTurn
    scene.canForceEndTurn = () => true;
    scene.activatePendingVisionSnapshot = vi.fn();
    scene.registry = { get: () => null };
    scene.refreshEndTurnControl = vi.fn();
    scene._isTutorialStrictGateActive = () => false;

    // Set a snapshot as if a unit is mid-move
    scene._preFogSnapshot = new Set(['1,1', '2,2']);
    scene.selectedUnit = makeUnit();

    BattleScene.prototype.forceEndTurn.call(scene);

    expect(scene._preFogSnapshot).toBeNull();
  });
});

describe('BattleScene deferred vision snapshot commit', () => {
  function primeVisionSnapshots(scene) {
    const previous = { id: 'previous-commit' };
    const pending = { id: 'current-turn-start' };
    scene.visionSnapshot = previous;
    scene.pendingVisionSnapshot = pending;
    scene.turnManager = {
      ...scene.turnManager,
      currentPhase: 'player',
      unitActed: scene.turnManager?.unitActed || vi.fn(),
      endPlayerPhase: scene.turnManager?.endPlayerPhase || vi.fn(),
    };
    return { previous, pending };
  }

  function prepareSelectUnitDeps(scene) {
    scene.inspectionPanel = { hide: vi.fn() };
    scene.unitDetailOverlay = { visible: false, hide: vi.fn() };
    scene.dangerZone = { hide: vi.fn() };
    scene._clearCombatRollSession = vi.fn();
    scene._clearSelectedWeaponArt = vi.fn();
    scene.buildUnitPositionMap = vi.fn(() => new Map());
    scene.grid.showMovementRange = vi.fn();
  }

  it('does not promote pending snapshot on selectUnit', () => {
    const { scene, unit } = setupScene();
    const { previous, pending } = primeVisionSnapshots(scene);
    unit.mov = 5;
    prepareSelectUnitDeps(scene);

    BattleScene.prototype.selectUnit.call(scene, unit);

    expect(scene.visionSnapshot).toBe(previous);
    expect(scene.pendingVisionSnapshot).toBe(pending);
  });

  it('promotes pending snapshot on confirmForecastCombat', () => {
    const { scene, unit } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    scene.selectedUnit = unit;
    scene.forecastTarget = makeUnit({ faction: 'enemy' });
    scene.battleState = 'SHOWING_FORECAST';
    scene.executeCombat = vi.fn();

    BattleScene.prototype.confirmForecastCombat.call(scene);

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
    expect(scene.executeCombat).toHaveBeenCalledWith(unit, scene.forecastTarget);
  });

  it('promotes pending snapshot on finishUnitAction', () => {
    const { scene, unit } = setupScene();
    const { pending } = primeVisionSnapshots(scene);

    BattleScene.prototype.finishUnitAction.call(scene, unit, { skipCanto: true });

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
  });

  it('promotes pending snapshot on forceEndTurn', () => {
    const { scene } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    scene.canForceEndTurn = () => true;
    scene._isTutorialStrictGateActive = () => false;
    scene.registry = { get: () => null };
    scene.selectedUnit = makeUnit();

    BattleScene.prototype.forceEndTurn.call(scene);

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
  });

  it('promotes pending snapshot on first trade mutation', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    const { pending } = primeVisionSnapshots(scene);
    const unitA = makeUnit({
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [{ name: 'Iron Sword', type: 'Sword', rank: 'Prof', range: '1' }],
      consumables: [],
    });
    const unitB = makeUnit({
      name: 'Sera',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [],
      consumables: [],
    });

    BattleScene.prototype.showBattleTradeUI.call(scene, unitA, unitB);
    const swordRow = texts.find((obj) => obj.text === 'Iron Sword');
    expect(swordRow).toBeTruthy();

    swordRow.trigger('pointerdown');

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
    expect(scene.tradeMutatedThisSession).toBe(true);
  });

  it('promotes pending snapshot on useConsumable entry (heal path)', async () => {
    const { scene, unit } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    unit.name = 'Edric';
    unit.currentHP = 10;
    unit.stats = { ...unit.stats, HP: 20 };
    scene.updateHPBar = vi.fn();
    scene.finishUnitAction = vi.fn();
    const item = { name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 };
    unit.consumables = [item];

    let resolveBanner;
    scene.showBriefBanner = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveBanner = resolve;
        }),
    );

    const actionPromise = BattleScene.prototype.useConsumable.call(scene, unit, item);

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();

    resolveBanner();
    await actionPromise;
  });

  it('does not promote pending snapshot on useConsumable promote (cancelled)', async () => {
    const { scene, unit } = setupScene();
    const { previous, pending } = primeVisionSnapshots(scene);
    const item = { name: 'Master Seal', effect: 'promote', uses: 1 };
    scene.executePromotion = vi.fn(async () => false);
    scene.finishUnitAction = vi.fn();

    await BattleScene.prototype.useConsumable.call(scene, unit, item);

    expect(scene.executePromotion).toHaveBeenCalledWith(unit, item);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.visionSnapshot).toBe(previous);
    expect(scene.pendingVisionSnapshot).toBe(pending);
  });

  it('does not promote pending snapshot on useConsumable reclass entry', async () => {
    const { scene, unit } = setupScene();
    const { previous, pending } = primeVisionSnapshots(scene);
    const item = { name: 'Second Seal', effect: 'reclass', uses: 1 };
    scene.showReclassClassPicker = vi.fn();
    scene.finishUnitAction = vi.fn();

    await BattleScene.prototype.useConsumable.call(scene, unit, item);

    expect(scene.showReclassClassPicker).toHaveBeenCalledWith(unit, item);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.visionSnapshot).toBe(previous);
    expect(scene.pendingVisionSnapshot).toBe(pending);
  });

  it('promotes pending snapshot on executeShove entry', () => {
    const { scene } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    scene.tweens = { add: vi.fn() };
    const actor = makeUnit({ col: 4, row: 4, label: { x: 0, y: 0 } });
    const ally = makeUnit({ col: 5, row: 4, label: { x: 0, y: 0 } });

    BattleScene.prototype.executeShove.call(scene, actor, {
      ally,
      destCol: 6,
      destRow: 4,
    });

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
  });

  it('promotes pending snapshot on executePull entry', () => {
    const { scene } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    scene.tweens = { add: vi.fn() };
    const actor = makeUnit({ col: 4, row: 4, label: { x: 0, y: 0 } });
    const ally = makeUnit({ col: 4, row: 5, label: { x: 0, y: 0 } });

    BattleScene.prototype.executePull.call(scene, actor, {
      ally,
      retreatCol: 4,
      retreatRow: 3,
    });

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
  });

  it('promotes pending snapshot on executeSwap entry', () => {
    const { scene } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    scene.tweens = { add: vi.fn() };
    const actor = makeUnit({ col: 4, row: 4, label: { x: 0, y: 0 } });
    const ally = makeUnit({ col: 5, row: 4, label: { x: 0, y: 0 } });

    BattleScene.prototype.executeSwap.call(scene, actor, { ally });

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();
  });

  it('promotes pending snapshot on executeDance entry', async () => {
    const { scene } = setupScene();
    const { pending } = primeVisionSnapshots(scene);
    const sparkle = {
      setDepth: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    };
    scene.add = {
      circle: vi.fn(() => sparkle),
    };
    scene._isReducedEffects = vi.fn(() => true);
    scene.tweens = { add: vi.fn() };
    scene.awardScaledXP = vi.fn(async () => {});
    scene.finishUnitAction = vi.fn();
    const actor = makeUnit({ name: 'Dancer' });
    const ally = makeUnit({ hasMoved: true, hasActed: true });

    const actionPromise = BattleScene.prototype.executeDance.call(scene, actor, { ally });

    expect(scene.visionSnapshot).toBe(pending);
    expect(scene.pendingVisionSnapshot).toBeNull();

    await actionPromise;
  });

  it('rewind after select-before-action uses prior committed snapshot', () => {
    const { scene, unit } = setupScene();
    const { previous, pending } = primeVisionSnapshots(scene);
    scene.runManager = { visionChargesRemaining: 1, visionCount: 0 };
    scene.applyVisionSnapshot = vi.fn(function applyVisionSnapshot() {
      this._appliedSnapshotId = this.visionSnapshot?.id;
      return true;
    });
    unit.mov = 5;
    prepareSelectUnitDeps(scene);

    BattleScene.prototype.selectUnit.call(scene, unit);
    const didRewind = BattleScene.prototype.executeVisionRewind.call(scene);

    expect(didRewind).toBe(true);
    expect(scene._appliedSnapshotId).toBe(previous.id);
    expect(scene.visionSnapshot).toBe(previous);
    expect(scene.pendingVisionSnapshot).toBeNull();
    expect(scene.runManager.visionChargesRemaining).toBe(0);
    expect(pending.id).toBe('current-turn-start');
  });
});

describe('BattleScene _movementSpent reset', () => {
  it('undoMove resets _movementSpent to zero', () => {
    const { scene, unit } = setupScene();

    unit._movementSpent = 4;
    scene.preMoveLoc = { col: 1, row: 1 };
    unit.col = 3;
    unit.row = 3;

    BattleScene.prototype.undoMove.call(scene, unit);

    expect(unit._movementSpent).toBe(0);
  });

  it('Canto uses full MOV after undoMove + stay-in-place', () => {
    const { scene, unit } = setupScene();

    unit.skills = ['canto'];
    unit.stats = { ...unit.stats, MOV: 7 };
    unit.faction = 'player';
    scene.startCantoMove = vi.fn();

    // Simulate: moved 4 tiles, then undid move
    scene.preMoveLoc = { col: 1, row: 1 };
    unit._movementSpent = 4;
    unit.col = 3;
    unit.row = 3;
    BattleScene.prototype.undoMove.call(scene, unit);

    // Stay-in-place action path after undo.
    BattleScene.prototype.handleSelectedClick.call(scene, { col: 1, row: 1 });
    BattleScene.prototype.finishUnitAction.call(scene, unit);

    expect(scene.startCantoMove).toHaveBeenCalledWith(unit, 7);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('onPhaseChange resets _movementSpent for player units', () => {
    const { scene } = setupScene();
    const mockUnit = {
      hasMoved: true,
      hasActed: true,
      _movementSpent: 5,
      _gambitUsedThisTurn: true,
      skills: [],
      graphic: { clearTint: vi.fn() },
    };
    scene.playerUnits = [mockUnit];
    scene.grid.fogEnabled = false;

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 2);

    expect(mockUnit._movementSpent).toBe(0);
    expect(mockUnit.hasMoved).toBe(false);
    expect(mockUnit.hasActed).toBe(false);
    expect(mockUnit._gambitUsedThisTurn).toBe(false);
  });
});

describe('BattleScene trade cancel flow', () => {
  it('TRADING cancel returns to action menu even when trade mutated', () => {
    const { scene, unit } = setupScene();
    scene.battleState = 'TRADING';
    scene.selectedUnit = unit;
    scene.tradeMutatedThisSession = true;
    scene.showActionMenu = vi.fn(() => {
      // Mirror BattleScene.showActionMenu side effect.
      scene.tradeMutatedThisSession = false;
    });
    scene.finishUnitAction = vi.fn();

    BattleScene.prototype.handleCancel.call(scene);

    expect(scene.cleanupTradeUI).toHaveBeenCalled();
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.tradeMutatedThisSession).toBe(true);
  });

  it('UNIT_ACTION_MENU cancel with mutated trade reopens action menu (no undo, no finish)', () => {
    const { scene, unit } = setupScene();
    scene.battleState = 'UNIT_ACTION_MENU';
    scene.selectedUnit = unit;
    scene.inEquipMenu = false;
    scene.tradeMutatedThisSession = true;
    scene.showActionMenu = vi.fn(() => {
      // Mirror BattleScene.showActionMenu side effect.
      scene.tradeMutatedThisSession = false;
    });
    scene.undoMove = vi.fn();
    scene.finishUnitAction = vi.fn();

    BattleScene.prototype.handleCancel.call(scene);

    expect(scene.hideActionMenu).toHaveBeenCalled();
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
    expect(scene.undoMove).not.toHaveBeenCalled();
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.tradeMutatedThisSession).toBe(true);
  });

  it('UNIT_ACTION_MENU cancel without mutation still undoes move', () => {
    const { scene, unit } = setupScene();
    scene.battleState = 'UNIT_ACTION_MENU';
    scene.selectedUnit = unit;
    scene.inEquipMenu = false;
    scene.tradeMutatedThisSession = false;
    scene.undoMove = vi.fn();
    scene.finishUnitAction = vi.fn();

    BattleScene.prototype.handleCancel.call(scene);

    expect(scene.hideActionMenu).toHaveBeenCalled();
    expect(scene.undoMove).toHaveBeenCalledWith(unit);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.showActionMenu).not.toHaveBeenCalled();
  });

  it('trade Done returns to action menu and preserves mutation lock', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    const unitA = makeUnit({
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [{ name: 'Iron Sword', type: 'Sword', rank: 'Prof', range: '1' }],
      consumables: [],
    });
    const unitB = makeUnit({
      name: 'Sera',
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      inventory: [{ name: 'Iron Axe', type: 'Axe', rank: 'Prof', range: '1' }],
      consumables: [],
    });
    scene.selectedUnit = unitA;
    scene.tradeMutatedThisSession = true;
    scene.showActionMenu = vi.fn(() => {
      scene.tradeMutatedThisSession = false;
    });
    scene.finishUnitAction = vi.fn();

    BattleScene.prototype.showBattleTradeUI.call(scene, unitA, unitB);
    const doneBtn = texts.find((obj) => obj.text === '[ Done ]');
    expect(doneBtn).toBeTruthy();

    doneBtn.trigger('pointerdown');

    expect(scene.showActionMenu).toHaveBeenCalledWith(unitA);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.tradeMutatedThisSession).toBe(true);
  });
});

describe('BattleScene trade weapon gating', () => {
  it('allows trading an equipped last weapon between one-weapon units', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    const elfire = {
      name: 'Elfire',
      type: 'Tome',
      rankRequired: 'Prof',
      range: '1-2',
      might: 8,
      hit: 85,
      crit: 0,
      weight: 6,
    };
    const fire = {
      name: 'Fire',
      type: 'Tome',
      rankRequired: 'Prof',
      range: '1-2',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 4,
    };
    const unitA = makeUnit({
      name: 'Iris',
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      inventory: [elfire],
      weapon: elfire,
      consumables: [],
    });
    const unitB = makeUnit({
      name: 'Mora',
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      inventory: [fire],
      weapon: fire,
      consumables: [],
    });

    scene.preMoveLoc = { col: 2, row: 2 };

    BattleScene.prototype.showBattleTradeUI.call(scene, unitA, unitB);
    const elfireRow = texts.find((obj) => obj.text === 'Elfire');
    expect(elfireRow).toBeTruthy();
    expect(elfireRow.handlers.pointerdown).toBeTruthy();

    elfireRow.trigger('pointerdown');

    expect(unitA.inventory).toHaveLength(0);
    expect(unitA.weapon).toBeNull();
    expect(unitB.inventory.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Fire', 'Elfire']),
    );
    expect(scene.tradeMutatedThisSession).toBe(true);
    expect(scene.preMoveLoc).toBeNull();
  });

  it('keeps weapon rows disabled when recipient inventory is full', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      range: '1',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
    };
    const filler = Array.from({ length: INVENTORY_MAX }, (_v, idx) => ({
      name: `Filler ${idx + 1}`,
      type: 'Axe',
      rankRequired: 'Prof',
      range: '1',
      might: 5,
      hit: 80,
      crit: 0,
      weight: 8,
    }));
    const unitA = makeUnit({
      name: 'Edric',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [sword],
      weapon: sword,
      consumables: [],
    });
    const unitB = makeUnit({
      name: 'Bran',
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      inventory: filler,
      weapon: filler[0],
      consumables: [],
    });

    BattleScene.prototype.showBattleTradeUI.call(scene, unitA, unitB);
    const swordRow = texts.find(
      (obj) => typeof obj.text === 'string' && obj.text.startsWith('Iron Sword'),
    );
    expect(swordRow).toBeTruthy();
    expect(swordRow.style?.color).toBe('#666666');
    expect(swordRow.handlers.pointerdown).toBeUndefined();

    swordRow.trigger('pointerdown');
    expect(unitA.inventory).toHaveLength(1);
    expect(unitB.inventory).toHaveLength(INVENTORY_MAX);
  });

  it('shows labeled capacities and disables consumable rows when recipient consumables are full', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    const vulnerary = { name: 'Vulnerary', type: 'Consumable', uses: 3, price: 300 };
    const unitA = makeUnit({
      name: 'Iris',
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      inventory: [],
      consumables: [vulnerary],
      weapon: null,
    });
    const unitB = makeUnit({
      name: 'Mora',
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      inventory: [],
      consumables: Array.from({ length: CONSUMABLE_MAX }, (_v, idx) => ({
        name: `Item ${idx + 1}`,
        type: 'Consumable',
        uses: 1,
      })),
      weapon: null,
    });

    BattleScene.prototype.showBattleTradeUI.call(scene, unitA, unitB);

    expect(
      texts.some(
        (obj) => obj.text === `Inventory 0/${INVENTORY_MAX} | Consumables 1/${CONSUMABLE_MAX}`,
      ),
    ).toBe(true);
    expect(
      texts.some(
        (obj) =>
          obj.text ===
          `Inventory 0/${INVENTORY_MAX} | Consumables ${CONSUMABLE_MAX}/${CONSUMABLE_MAX}`,
      ),
    ).toBe(true);

    const consumableRow = texts.find((obj) => obj.text === 'Vulnerary (consumables full)');
    expect(consumableRow).toBeTruthy();
    expect(consumableRow.style?.color).toBe('#666666');
    expect(consumableRow.handlers.pointerdown).toBeUndefined();
  });
});

describe('BattleScene deploy controls', () => {
  function makeRosterUnit(name) {
    return {
      name,
      level: 1,
      className: 'Fighter',
      currentHP: 18,
      stats: { HP: 18 },
    };
  }

  it('deploy BACK transitions to NodeMap with BACK reason', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    scene.runManager = { getRoster: vi.fn(() => []) };
    scene.gameData = { classes: [], lords: [] };
    const roster = [makeRosterUnit('Edric'), makeRosterUnit('Sera')];

    BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 2 }, vi.fn());

    const backText = texts.find((obj) => obj.text === 'BACK');
    expect(backText).toBeTruthy();
    backText.trigger('pointerdown');

    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'NodeMap',
      {
        gameData: scene.gameData,
        runManager: scene.runManager,
      },
      { reason: TRANSITION_REASONS.BACK },
    );
  });

  it('deploy BACK is a safe no-op when runManager is missing', () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    scene.runManager = null;
    scene.gameData = { classes: [], lords: [] };
    const roster = [makeRosterUnit('Edric'), makeRosterUnit('Sera')];

    BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 2 }, vi.fn());

    const backText = texts.find((obj) => obj.text === 'BACK');
    expect(backText).toBeTruthy();
    expect(() => backText.trigger('pointerdown')).not.toThrow();
    expect(transitionToSceneMock).not.toHaveBeenCalled();
    expect(backText.destroyed).toBe(false);
  });

  it('deploy BACK keeps overlay open when transition fails and closes on retry success', async () => {
    const { scene } = setupScene();
    const { texts } = attachUiHarness(scene);
    scene.runManager = { getRoster: vi.fn(() => []) };
    scene.gameData = { classes: [], lords: [] };
    const roster = [makeRosterUnit('Edric'), makeRosterUnit('Sera')];
    transitionToSceneMock.mockResolvedValueOnce(false);

    BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 2 }, vi.fn());

    const backText = texts.find((obj) => obj.text === 'BACK');
    expect(backText).toBeTruthy();

    backText.trigger('pointerdown');
    await Promise.resolve();

    expect(transitionToSceneMock).toHaveBeenCalledTimes(1);
    expect(backText.destroyed).toBe(false);

    backText.trigger('pointerdown');
    await Promise.resolve();

    expect(transitionToSceneMock).toHaveBeenCalledTimes(2);
    expect(backText.destroyed).toBe(true);
  });

  it('deploy ROSTER close reopens deploy and restores selected names', () => {
    const { scene } = setupScene();
    const { rectangles, texts } = attachUiHarness(scene);
    const initialRoster = [makeRosterUnit('Edric'), makeRosterUnit('Sera'), makeRosterUnit('Brom')];
    const refreshedRoster = [
      makeRosterUnit('Edric'),
      makeRosterUnit('Brom'),
      makeRosterUnit('Sera'),
    ];
    scene.runManager = { getRoster: vi.fn(() => refreshedRoster) };
    scene.gameData = { classes: [], lords: [] };
    const onConfirm = vi.fn();

    BattleScene.prototype.showDeployScreen.call(
      scene,
      initialRoster,
      { min: 1, max: 3 },
      onConfirm,
    );

    // Select "Sera" on the first deploy overlay.
    const seraRowBg = rectangles.find(
      (obj) => obj.kind === 'rectangle' && obj.width === 400 && obj.y === 134,
    );
    expect(seraRowBg).toBeTruthy();
    seraRowBg.trigger('pointerdown');

    const rosterText = texts.find((obj) => obj.text === 'ROSTER');
    expect(rosterText).toBeTruthy();
    rosterText.trigger('pointerdown');
    expect(rosterOverlayInstances).toHaveLength(1);

    // Simulate closing RosterOverlay to trigger deploy reopen with refreshed roster.
    rosterOverlayInstances[0].options.onClose();

    // Confirm the reopened deploy list; selection should still include Sera by name.
    const activeConfirm = rectangles
      .filter((obj) => obj.kind === 'rectangle' && obj.width === 120 && !obj.destroyed)
      .at(-1);
    expect(activeConfirm).toBeTruthy();
    activeConfirm.trigger('pointerdown');

    expect(scene.runManager.getRoster).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selectedNames = onConfirm.mock.calls[0][0].map((unit) => unit.name);
    expect(selectedNames).toContain('Edric');
    expect(selectedNames).toContain('Sera');
  });

  it('keeps deploy controls visible and allows scrolling when roster exceeds viewport', () => {
    const { scene } = setupScene();
    const { rectangles, texts } = attachUiHarness(scene);
    const roster = [
      makeRosterUnit('Edric'),
      ...Array.from({ length: 12 }, (_v, idx) => makeRosterUnit(`Unit${idx + 1}`)),
    ];

    BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 6, max: 6 }, vi.fn());

    const confirmBg = rectangles.find(
      (obj) => obj.kind === 'rectangle' && obj.width === 120 && obj.height === 32,
    );
    expect(confirmBg).toBeTruthy();
    expect(confirmBg.y).toBe(426);
    expect(confirmBg.y).toBeLessThan(scene.cameras.main.height);

    const lastRow = texts.find((obj) => obj.text.includes('Unit12'));
    expect(lastRow).toBeTruthy();
    expect(lastRow.visible).toBe(false);
    const ninthVisibleRow = texts.find((obj) => obj.text.includes('Unit8'));
    expect(ninthVisibleRow).toBeTruthy();
    expect(ninthVisibleRow.visible).toBe(true);

    const scrollDown = texts.find((obj) => obj.text === 'v');
    expect(scrollDown).toBeTruthy();
    for (let i = 0; i < 12; i++) scrollDown.trigger('pointerdown');

    expect(lastRow.visible).toBe(true);
  });

  it('detaches deploy wheel listener when overlay closes', () => {
    const { scene } = setupScene();
    const { rectangles } = attachUiHarness(scene);
    scene.input = { on: vi.fn(), off: vi.fn() };
    const roster = [
      makeRosterUnit('Edric'),
      ...Array.from({ length: 12 }, (_v, idx) => makeRosterUnit(`Unit${idx + 1}`)),
    ];

    BattleScene.prototype.showDeployScreen.call(scene, roster, { min: 1, max: 6 }, vi.fn());

    expect(scene.input.on).toHaveBeenCalledTimes(1);
    const [eventName, wheelHandler] = scene.input.on.mock.calls[0];
    expect(eventName).toBe('wheel');
    expect(typeof wheelHandler).toBe('function');

    const confirmBg = rectangles.find(
      (obj) => obj.kind === 'rectangle' && obj.width === 120 && obj.height === 32,
    );
    expect(confirmBg).toBeTruthy();
    confirmBg.trigger('pointerdown');

    expect(scene.input.off).toHaveBeenCalledWith('wheel', wheelHandler);
  });
});

describe('updateEnemyVisibility hides affix pips in fog', () => {
  it('toggles affixPips visibility based on fog', () => {
    const scene = new BattleScene();
    const pip1 = { setVisible: vi.fn() };
    const pip2 = { setVisible: vi.fn() };
    const enemy = {
      col: 2,
      row: 3,
      graphic: { setVisible: vi.fn() },
      label: { setVisible: vi.fn() },
      factionIndicator: { setVisible: vi.fn() },
      hpBar: { bg: { setVisible: vi.fn() }, fill: { setVisible: vi.fn() } },
      affixPips: [pip1, pip2],
    };
    scene.grid = {
      fogEnabled: true,
      isVisible: vi.fn(() => false),
    };
    scene.enemyUnits = [enemy];
    scene.npcUnits = [];
    scene.dangerZoneStale = false;

    BattleScene.prototype.updateEnemyVisibility.call(scene);

    expect(pip1.setVisible).toHaveBeenCalledWith(false);
    expect(pip2.setVisible).toHaveBeenCalledWith(false);
    expect(enemy.graphic.setVisible).toHaveBeenCalledWith(false);
  });

  it('shows affixPips when tile is visible', () => {
    const scene = new BattleScene();
    const pip = { setVisible: vi.fn() };
    const enemy = {
      col: 1,
      row: 1,
      graphic: { setVisible: vi.fn() },
      label: null,
      factionIndicator: null,
      hpBar: null,
      affixPips: [pip],
    };
    scene.grid = {
      fogEnabled: true,
      isVisible: vi.fn(() => true),
    };
    scene.enemyUnits = [enemy];
    scene.npcUnits = [];
    scene.dangerZoneStale = false;

    BattleScene.prototype.updateEnemyVisibility.call(scene);

    expect(pip.setVisible).toHaveBeenCalledWith(true);
  });

  it('shows NPC affixPips on visible tiles', () => {
    const scene = new BattleScene();
    const pip = { setVisible: vi.fn() };
    const npc = {
      col: 3,
      row: 3,
      graphic: { setVisible: vi.fn() },
      label: null,
      factionIndicator: null,
      hpBar: null,
      affixPips: [pip],
    };
    scene.grid = {
      fogEnabled: true,
      isVisible: vi.fn(() => true),
    };
    scene.enemyUnits = [];
    scene.npcUnits = [npc];
    scene.recruitFogMarker = null;
    scene.dangerZoneStale = false;

    BattleScene.prototype.updateEnemyVisibility.call(scene);

    expect(pip.setVisible).toHaveBeenCalledWith(true);
  });

  it('hides NPC affixPips in fog too', () => {
    const scene = new BattleScene();
    const pip = { setVisible: vi.fn() };
    const npc = {
      col: 3,
      row: 3,
      graphic: { setVisible: vi.fn() },
      label: null,
      factionIndicator: null,
      hpBar: null,
      affixPips: [pip],
    };
    scene.grid = {
      fogEnabled: true,
      isVisible: vi.fn(() => false),
    };
    scene.enemyUnits = [];
    scene.npcUnits = [npc];
    scene.recruitFogMarker = null;
    scene.dangerZoneStale = false;

    BattleScene.prototype.updateEnemyVisibility.call(scene);

    expect(pip.setVisible).toHaveBeenCalledWith(false);
  });
});

// --- Status condition scene-level regressions ---

describe('onPhaseChange condition recovery ordering', () => {
  it('recovers sleeping units before the all-sleeping auto-advance check', () => {
    const { scene } = setupScene();
    // Two player units, both sleeping — one will expire on recovery
    const u1 = makeUnit({ name: 'A', currentHP: 20 });
    const u2 = makeUnit({ name: 'B', currentHP: 20 });
    applyCondition(u1, 'sleep', 1); // turnsRemaining=1, will expire
    applyCondition(u2, 'sleep', 3); // stays sleeping
    scene.playerUnits = [u1, u2];
    scene.showBriefBanner = vi.fn();
    scene._removeConditionIcon = vi.fn();
    scene.endPlayerPhase = vi.fn();
    scene._expireTimedWeaponArtBuffs = vi.fn();
    scene.turnCounterText = null;
    scene._latePressureWarningShown = false;
    scene.processTurnStartEffects = vi.fn();

    // Force high RNG so u2 doesn't randomly recover (recoveryChance = 0.5)
    const origRandom = Math.random;
    Math.random = () => 0.99;
    try {
      BattleScene.prototype.onPhaseChange.call(scene, 'player', 2);
    } finally {
      Math.random = origRandom;
    }

    // u1 should have recovered (timer expired, no longer sleeping)
    expect(isSleeping(u1)).toBe(false);
    // u2 is still sleeping (RNG prevented random recovery)
    expect(isSleeping(u2)).toBe(true);
    // Recovery banner was shown
    expect(scene.showBriefBanner).toHaveBeenCalled();
    // NOT all sleeping, so no auto-advance
    expect(scene.endPlayerPhase).not.toHaveBeenCalled();
  });

  it('auto-advances when all units still sleeping after recovery', () => {
    const { scene } = setupScene();
    const u1 = makeUnit({ name: 'A', currentHP: 20 });
    const u2 = makeUnit({ name: 'B', currentHP: 20 });
    applyCondition(u1, 'sleep', 3);
    applyCondition(u2, 'sleep', 3);
    scene.playerUnits = [u1, u2];
    scene.showBriefBanner = vi.fn();
    scene._removeConditionIcon = vi.fn();
    scene.endPlayerPhase = vi.fn();
    scene._expireTimedWeaponArtBuffs = vi.fn();
    scene.turnCounterText = null;
    scene._latePressureWarningShown = false;

    // Force high RNG so no random recovery triggers (recoveryChance = 0.5)
    const origRandom = Math.random;
    Math.random = () => 0.99;
    try {
      BattleScene.prototype.onPhaseChange.call(scene, 'player', 2);
    } finally {
      Math.random = origRandom;
    }

    // All sleeping (no timer-based recovery), so auto-advance is scheduled
    // time.delayedCall gets called with short delay for the skip
    const skipCall = scene.time.delayedCall.mock.calls.find(([delay]) => delay === 300);
    expect(skipCall).toBeDefined();
  });
});

describe('deploy clears _conditions (cross-battle leak prevention)', () => {
  it('resetUnitForBattle clears conditions and per-battle state', () => {
    // Unit carrying conditions + spent weapon uses from a previous battle
    const u = makeUnit({ name: 'Knight', currentHP: 25 });
    u.hasMoved = true;
    u.hasActed = true;
    u._miracleUsed = true;
    u._gambitUsedThisTurn = true;
    u.inventory = [{ name: 'Bolting', perBattleUses: 2, _usesSpent: 2 }];
    applyCondition(u, 'sleep', 2);
    applyCondition(u, 'silence', 3);
    expect(isSleeping(u)).toBe(true);
    expect(isSilenced(u)).toBe(true);

    // Call the actual function used by both deploy loops in BattleScene.create
    resetUnitForBattle(u);

    expect(isSleeping(u)).toBe(false);
    expect(isSilenced(u)).toBe(false);
    expect(u._conditions).toEqual([]);
    expect(u.hasMoved).toBe(false);
    expect(u.hasActed).toBe(false);
    expect(u._miracleUsed).toBe(false);
    expect(u._gambitUsedThisTurn).toBe(false);
    expect(u.inventory[0]._usesSpent).toBe(0);
  });
});

describe('scene-level silence enforcement (hybrid magic/physical)', () => {
  function setupSilenceScene() {
    const scene = new BattleScene();
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      range: '1',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      rankRequired: 'Prof',
    };
    const tome = {
      name: 'Fire',
      type: 'Tome',
      range: '1-2',
      might: 4,
      hit: 85,
      crit: 0,
      weight: 3,
      rankRequired: 'Prof',
    };
    const unit = makeUnit({
      name: 'DarkKnight',
      weapon: tome,
      inventory: [tome, sword],
      skills: [],
      proficiencies: [
        { type: 'Sword', rank: 'Prof' },
        { type: 'Tome', rank: 'Prof' },
      ],
    });
    applyCondition(unit, 'silence', 3);

    const enemy = makeUnit({ name: 'Bandit', col: 2, row: 1, faction: 'enemy' });

    scene.grid = {
      fogEnabled: false,
      isVisible: () => true,
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
      cols: 10,
      rows: 10,
    };
    scene.playerUnits = [unit];
    scene.enemyUnits = [enemy];
    scene.npcUnits = [];
    scene.battleState = 'SHOWING_FORECAST';
    scene.selectedUnit = unit;
    scene.forecastTarget = enemy;
    scene.hideForecast = vi.fn();
    scene.commitVisionSnapshotIfPending = vi.fn();
    scene.executeCombat = vi.fn();

    // Stub _isDistanceInWeaponRange: check weapon range covers distance
    scene._isDistanceInWeaponRange = (_u, w, dist) => {
      const [lo, hi] = (w.range || '1').split('-').map(Number);
      return dist >= lo && dist <= (hi || lo);
    };

    return { scene, unit, enemy, sword, tome };
  }

  it('findAttackTargets excludes targets only reachable by magic weapons', () => {
    const { scene, unit, enemy } = setupSilenceScene();
    // Enemy is at distance 1, reachable by both sword (range 1) and tome (range 1-2)
    const targets = scene.findAttackTargets(unit);
    // Should still find enemy (sword can reach distance 1)
    expect(targets).toContain(enemy);
  });

  it('findAttackTargets returns empty when only magic weapon has range', () => {
    const { scene, unit, enemy } = setupSilenceScene();
    // Move enemy to range 2 — only tome can reach
    enemy.col = 3;
    enemy.row = 1;
    const targets = scene.findAttackTargets(unit);
    expect(targets).toEqual([]);
  });

  it('ensureValidWeaponForRange swaps from magic to physical when silenced', () => {
    const { scene, unit, sword, tome } = setupSilenceScene();
    expect(unit.weapon).toBe(tome);
    scene.ensureValidWeaponForRange(unit, 1);
    // Should have swapped to sword
    expect(unit.weapon).toBe(sword);
  });

  it('ensureValidWeaponForRange does not early-return with magic weapon when silenced', () => {
    const { scene, unit, tome } = setupSilenceScene();
    // Tome has range 1-2, distance is 1, so without silence check the early return would fire
    expect(unit.weapon).toBe(tome);
    scene.ensureValidWeaponForRange(unit, 1);
    // Should NOT keep the tome equipped
    expect(unit.weapon.type).not.toBe('Tome');
  });

  it('forecast valid weapons exclude magic when attacker is silenced', () => {
    const { scene, unit, enemy, sword } = setupSilenceScene();
    // Stub showForecast to capture _forecastValidWeapons
    const origShowForecast = BattleScene.prototype.showForecast;
    // Minimal forecast stub that builds _forecastValidWeapons
    const dist = Math.abs(unit.col - enemy.col) + Math.abs(unit.row - enemy.row);
    const validWeapons = getCombatWeaponsForTest(unit).filter((w) => {
      if (isSilenced(unit) && (w.type === 'Tome' || w.type === 'Light' || w.type === 'Staff'))
        return false;
      return scene._isDistanceInWeaponRange(unit, w, dist);
    });
    // Only the sword should remain
    expect(validWeapons).toEqual([sword]);
    expect(validWeapons.some((w) => w.type === 'Tome')).toBe(false);
  });

  it('confirmForecastCombat blocks combat when weapon is magic and unit is silenced', () => {
    const { scene, unit, tome } = setupSilenceScene();
    unit.weapon = tome;
    scene.confirmForecastCombat();
    // Should have hidden forecast but NOT called executeCombat
    expect(scene.hideForecast).toHaveBeenCalled();
    expect(scene.executeCombat).not.toHaveBeenCalled();
  });

  it('confirmForecastCombat allows combat when weapon is physical', () => {
    const { scene, unit, sword } = setupSilenceScene();
    unit.weapon = sword;
    scene.confirmForecastCombat();
    expect(scene.executeCombat).toHaveBeenCalled();
  });
});

// Helper: replicate getCombatWeapons logic for test assertions
function getCombatWeaponsForTest(unit) {
  return unit.inventory.filter(
    (w) => w.type !== 'Staff' && w.type !== 'Scroll' && w.type !== 'Consumable',
  );
}
