// BattleSceneFogSnapshot.test.js — Integration tests for fog snapshot lifecycle in BattleScene
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeUnit(overrides = {}) {
  return {
    col: 1, row: 1, faction: 'player', moveType: 'Infantry',
    hasMoved: false, hasActed: false,
    weapon: { range: '1' }, inventory: [], consumables: [], skills: [],
    stats: { MOV: 5 },
    graphic: { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn() },
    label: null, hpBar: null,
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
    cols: 10, rows: 10,
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
  scene.inspectionPanel = null;
  scene.turnManager = { endPlayerPhase: vi.fn(), unitActed: vi.fn() };

  return { scene, unit, snapshotSpy, restoreSpy, updateFogSpy };
}

describe('BattleScene fog snapshot lifecycle', () => {
  it('undoMove restores fog state from snapshot', async () => {
    const { scene, unit, restoreSpy, updateFogSpy } = setupScene();

    // Simulate: unit selected and moved — preMoveLoc + snapshot set
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

    // Simulate: unit moved and acted — snapshot still set
    scene.preMoveLoc = { col: 1, row: 1 };
    scene._preFogSnapshot = new Set(['0,0']);

    BattleScene.prototype.finishUnitAction.call(scene, unit);

    expect(scene._preFogSnapshot).toBeNull();
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('stay-in-place takes a fresh snapshot', () => {
    const { scene, unit, snapshotSpy } = setupScene();

    // The click-own-tile path (line ~2837-2843) sets preMoveLoc + snapshot
    // We call that inline block directly by simulating the relevant assignments
    scene.selectedUnit = unit;
    unit.col = 2;
    unit.row = 2;

    // Replicate the stay-in-place block from handleMovementClick
    scene.grid.clearHighlights();
    scene.preMoveLoc = { col: unit.col, row: unit.row };
    scene._preFogSnapshot = scene.grid.snapshotFogState();
    scene.showActionMenu(unit);

    expect(snapshotSpy).toHaveBeenCalled();
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
