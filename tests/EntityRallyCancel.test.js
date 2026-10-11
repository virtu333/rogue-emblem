import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

// Cancel (Esc, the pad's B, Android Back, the phone's Back button) reaches the Entity rally's card
// only when nothing else in the battle has something to close: a forecast, a unit's menu, a panel
// or the pause menu keeps its Back, and the card never costs the player their way out of one.
const { BattleScene } = await import('../src/scenes/BattleScene.js');
const { BattleBeatsController } = await import('../src/ui/BattleBeatsController.js');
const { default: EntityRallyController } = await import('../src/ui/EntityRallyController.js');

function sceneWithRally(overrides = {}) {
  const scene = {
    isStoryInputLocked: () => false,
    _isPrologueGateActive: () => false,
    isDevToolsEnabled: () => false,
    isMobileInput: false,
    inspectMode: false,
    battleState: 'PLAYER_IDLE',
    visionDialog: null,
    unitDetailOverlay: null,
    inspectionPanel: { visible: false, hide: vi.fn() },
    pauseOverlay: null,
    lootRosterVisible: false,
    lootGroup: [],
    debugOverlay: null,
    selectedUnit: null,
    refreshEndTurnControl: vi.fn(),
    showPauseMenu: vi.fn(),
    handleCancel: vi.fn(),
    clearInspectionVisuals: vi.fn(),
    cancelVisionDialog: vi.fn(),
    canRequestCancel(opts) {
      return BattleScene.prototype.canRequestCancel.call(this, opts);
    },
    isCancelableBattleState() {
      return BattleScene.prototype.isCancelableBattleState.call(this);
    },
    ...overrides,
  };
  const beats = new BattleBeatsController(scene, () => 0);
  // a rally whose card is on screen (the card's own drawing is covered in EntityRallyController.test)
  const rally = new EntityRallyController(scene);
  rally._card = { visible: true, hide: vi.fn(), destroy: vi.fn() };
  beats._rally = rally;
  scene._battleBeats = beats;
  return { scene, rally };
}

const cancel = (scene, opts) => BattleScene.prototype.requestCancel.call(scene, opts);

describe('Cancel and the Entity rally card', () => {
  it('dismisses the card at idle, instead of opening the pause menu', () => {
    const { scene, rally } = sceneWithRally();
    expect(cancel(scene)).toBe(true);
    expect(rally.skipped).toBe(true);
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
    // the next press is the ordinary one again
    expect(cancel(scene)).toBe(true);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
  });

  it('dismisses the card from the phone Back button too (no pause there), even in the enemy phase', () => {
    const idle = sceneWithRally();
    expect(cancel(idle.scene, { allowPause: false })).toBe(true);
    expect(idle.rally.skipped).toBe(true);
    const enemy = sceneWithRally({ battleState: 'ENEMY_PHASE' });
    expect(cancel(enemy.scene)).toBe(true);
    expect(enemy.rally.skipped).toBe(true);
  });

  it.each([
    ['a forecast', { battleState: 'SHOWING_FORECAST' }],
    ['a target choice', { battleState: 'SELECTING_TARGET' }],
    ['a selected unit', { battleState: 'UNIT_SELECTED' }],
    ['a unit menu', { battleState: 'UNIT_ACTION_MENU' }],
  ])('leaves Cancel to %s', (_name, overrides) => {
    const { scene, rally } = sceneWithRally(overrides);
    cancel(scene);
    expect(rally.skipped).toBe(false);
    expect(scene.handleCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves Cancel to the pause menu, the unit detail, the vision dialog and the inspection panel', () => {
    const pause = sceneWithRally({
      pauseOverlay: { visible: true, closeActiveSubOverlay: () => false, hide: vi.fn() },
    });
    cancel(pause.scene);
    expect(pause.rally.skipped).toBe(false);
    expect(pause.scene.pauseOverlay.hide).toHaveBeenCalled();

    const detail = sceneWithRally({ unitDetailOverlay: { visible: true, hide: vi.fn() } });
    cancel(detail.scene);
    expect(detail.rally.skipped).toBe(false);
    expect(detail.scene.unitDetailOverlay.hide).toHaveBeenCalled();

    const vision = sceneWithRally({ visionDialog: { visible: true } });
    cancel(vision.scene);
    expect(vision.rally.skipped).toBe(false);
    expect(vision.scene.cancelVisionDialog).toHaveBeenCalled();

    const panel = sceneWithRally({ inspectionPanel: { visible: true, hide: vi.fn() } });
    cancel(panel.scene, { allowPause: false });
    expect(panel.rally.skipped).toBe(false);
  });

  it('is not taken while a modal story line or ceremony owns input', () => {
    const { scene, rally } = sceneWithRally({ isStoryInputLocked: () => true });
    expect(cancel(scene)).toBe(true);
    expect(rally.skipped).toBe(false);
  });

  it('changes nothing when no card is on screen', () => {
    const { scene, rally } = sceneWithRally();
    rally._card.visible = false;
    expect(cancel(scene)).toBe(true);
    expect(rally.skipped).toBe(false);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
  });
});
