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

import { BattleScene } from '../src/scenes/BattleScene.js';
import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../src/utils/constants.js';

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
