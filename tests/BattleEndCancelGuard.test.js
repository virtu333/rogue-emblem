import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

// Desktop playtest: after the DOM reward dialog closed, Esc / gamepad B / Start opened the
// Settings overlay on top of the finishing battle. The DOM reward flow's `lootGroup` is an
// always-truthy empty array; only the legacy canvas loot screen fills it.
const { BattleScene } = await import('../src/scenes/BattleScene.js');
const { SettingsOverlay } = await import('../src/ui/SettingsOverlay.js');

vi.mock('../src/ui/SettingsOverlay.js', () => ({
  SettingsOverlay: vi.fn(function SettingsOverlay() {
    this.visible = false;
    this.show = vi.fn(() => {
      this.visible = true;
    });
    this.hide = vi.fn();
  }),
}));

function endScene(overrides = {}) {
  return {
    isStoryInputLocked: () => false,
    _isTutorialStrictGateActive: () => false,
    isDevToolsEnabled: () => false,
    isMobileInput: false,
    inspectMode: false,
    battleState: 'BATTLE_END',
    visionDialog: null,
    unitDetailOverlay: null,
    inspectionPanel: { visible: false, hide: vi.fn() },
    pauseOverlay: null,
    lootRosterVisible: false,
    lootSettingsOverlay: null,
    lootGroup: [],
    isTransitioningOut: false,
    debugOverlay: null,
    refreshEndTurnControl: vi.fn(),
    _hideLootTooltip: vi.fn(),
    canRequestCancel(opts) {
      return BattleScene.prototype.canRequestCancel.call(this, opts);
    },
    isCancelableBattleState() {
      return BattleScene.prototype.isCancelableBattleState.call(this);
    },
    ...overrides,
  };
}

const requestCancel = (scene) => BattleScene.prototype.requestCancel.call(scene);

describe('BATTLE_END cancel with the DOM reward flow', () => {
  it('does not open Settings when lootGroup is the reward flow empty array', () => {
    SettingsOverlay.mockClear();
    const scene = endScene({ lootGroup: [] });
    expect(scene.canRequestCancel()).toBe(false);
    expect(requestCancel(scene)).toBe(false);
    expect(SettingsOverlay).not.toHaveBeenCalled();
    expect(scene.lootSettingsOverlay).toBeNull();
  });

  it('does not open Settings once lootGroup is cleared or the scene is leaving', () => {
    SettingsOverlay.mockClear();
    expect(requestCancel(endScene({ lootGroup: null }))).toBe(false);
    expect(requestCancel(endScene({ lootGroup: [{}], isTransitioningOut: true }))).toBe(false);
    expect(SettingsOverlay).not.toHaveBeenCalled();
  });

  it('still opens Settings from the legacy canvas loot screen, then toggles it closed', () => {
    SettingsOverlay.mockClear();
    const scene = endScene({ lootGroup: [{}] });
    expect(scene.canRequestCancel()).toBe(true);
    expect(requestCancel(scene)).toBe(true);
    expect(SettingsOverlay).toHaveBeenCalledOnce();
    expect(scene.lootSettingsOverlay.show).toHaveBeenCalledOnce();
  });
});
