import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function createCancelScene(overrides = {}) {
  return {
    isStoryInputLocked: () => false,
    _isTutorialStrictGateActive: () => false,
    isDevToolsEnabled: () => false,
    isMobileInput: true,
    inspectMode: true,
    battleState: 'PLAYER_IDLE',
    visionDialog: null,
    unitDetailOverlay: null,
    inspectionPanel: { visible: false, hide: vi.fn() },
    pauseOverlay: null,
    lootRosterVisible: false,
    lootGroup: null,
    debugOverlay: null,
    game: { events: { emit: vi.fn() } },
    clearInspectionVisuals: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    hideLootRoster: vi.fn(),
    showPauseMenu: vi.fn(),
    handleCancel: vi.fn(),
    cancelVisionDialog: vi.fn(),
    canRequestCancel(opts) { return BattleScene.prototype.canRequestCancel.call(this, opts); },
    isCancelableBattleState() { return BattleScene.prototype.isCancelableBattleState.call(this); },
    ...overrides,
  };
}

function createPhaseScene(overrides = {}) {
  const inspectionPanel = {
    visible: true,
    hide: vi.fn(function hide() {
      this.visible = false;
    }),
  };
  return {
    isMobileInput: true,
    inspectMode: true,
    inspectionPanel,
    grid: {
      fogEnabled: false,
      tickTemporaryTerrains: vi.fn(),
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
    },
    showPhaseBanner: vi.fn(),
    dangerZone: { hide: vi.fn() },
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    battleParams: { tutorialMode: false },
    turnCounterText: null,
    turnPar: null,
    registry: { get: vi.fn(() => null) },
    time: { delayedCall: vi.fn() },
    undimUnit: vi.fn(),
    updateEnemyVisibility: vi.fn(),
    captureVisionSnapshot: vi.fn(),
    updateVisionHud: vi.fn(),
    processTurnStartEffects: vi.fn(),
    processTerrainDamage: vi.fn(async () => {}),
    updateAntiTurtlePressure: vi.fn(),
    applyDueHybridOverridesForTurn: vi.fn(),
    applyReinforcementsForTurn: vi.fn(),
    startEnemyPhase: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    getTurnPressureState: vi.fn(() => ({ active: false })),
    ...overrides,
  };
}

describe('BattleScene mobile context mapping', () => {
  it('maps PLAYER_IDLE to battle_player_idle', () => {
    const emit = vi.fn();
    const scene = {
      isMobileInput: true,
      battleState: 'PLAYER_IDLE',
      isStoryInputLocked: () => false,
      game: { events: { emit } },
    };

    BattleScene.prototype._emitMobileContext.call(scene);

    expect(emit).toHaveBeenCalledWith('mobile:setContext', { context: 'battle_player_idle' });
  });

  it('maps UNIT_SELECTED to battle_unit_selected', () => {
    const emit = vi.fn();
    const scene = {
      isMobileInput: true,
      battleState: 'UNIT_SELECTED',
      isStoryInputLocked: () => false,
      game: { events: { emit } },
    };

    BattleScene.prototype._emitMobileContext.call(scene);

    expect(emit).toHaveBeenCalledWith('mobile:setContext', { context: 'battle_unit_selected' });
  });
});

describe('BattleScene mobile inspect cancel behavior', () => {
  it('allowPause:false exits mobile inspect mode when idle and no overlays are open', () => {
    const scene = createCancelScene();

    const handled = BattleScene.prototype.requestCancel.call(scene, { allowPause: false });

    expect(handled).toBe(true);
    expect(scene.inspectMode).toBe(false);
    expect(scene.clearInspectionVisuals).toHaveBeenCalledTimes(1);
  });

  it('inspection panel cancel on mobile turns inspect off and clears visuals', () => {
    const scene = createCancelScene({
      inspectionPanel: { visible: true, hide: vi.fn() },
    });

    const handled = BattleScene.prototype.requestCancel.call(scene, { allowPause: false });

    expect(handled).toBe(true);
    expect(scene.inspectMode).toBe(false);
    expect(scene.clearInspectionVisuals).toHaveBeenCalledTimes(1);
  });

  it('allowPause:true opens pause and clears mobile inspect in one press', () => {
    const scene = createCancelScene({
      inspectionPanel: { visible: true, hide: vi.fn() },
      grid: { clearHighlights: vi.fn(), clearAttackHighlights: vi.fn() },
    });

    const handled = BattleScene.prototype.requestCancel.call(scene, { allowPause: true });

    expect(handled).toBe(true);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
    expect(scene.inspectMode).toBe(false);
    expect(scene.inspectionPanel.hide).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalledTimes(1);
    expect(scene.clearInspectionVisuals).not.toHaveBeenCalled();
  });

  it('vision dialog still has cancel priority over inspect-mode exit', () => {
    const scene = createCancelScene({
      visionDialog: { visible: true },
      cancelVisionDialog: vi.fn(),
    });

    const handled = BattleScene.prototype.requestCancel.call(scene, { allowPause: false });

    expect(handled).toBe(true);
    expect(scene.cancelVisionDialog).toHaveBeenCalledTimes(1);
    expect(scene.clearInspectionVisuals).not.toHaveBeenCalled();
    expect(scene.inspectMode).toBe(true);
  });
});

describe('BattleScene mobile inspect phase reset', () => {
  it('resets inspect mode and clears visuals on both player and enemy phase changes', () => {
    const scene = createPhaseScene();

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 2);
    expect(scene.inspectMode).toBe(false);
    expect(scene.inspectionPanel.hide).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalledTimes(1);

    scene.inspectMode = true;
    scene.inspectionPanel.visible = true;

    BattleScene.prototype.onPhaseChange.call(scene, 'enemy', 2);
    expect(scene.inspectMode).toBe(false);
    expect(scene.inspectionPanel.hide).toHaveBeenCalledTimes(2);
    expect(scene.grid.clearHighlights).toHaveBeenCalledTimes(2);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalledTimes(2);
  });
});
