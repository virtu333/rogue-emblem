import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeGesturePolicyScene(overrides = {}) {
  return {
    mobileCameraEnabled: true,
    _battleCamera: {},
    isStoryInputLocked: () => false,
    _isTutorialStrictGateActive: () => false,
    pauseOverlay: null,
    unitDetailOverlay: null,
    visionDialog: null,
    rosterOverlay: null,
    lootSettingsOverlay: false,
    lootRosterVisible: false,
    battleState: 'PLAYER_IDLE',
    ...overrides,
  };
}

function makeUiObject() {
  const handlers = {};
  return {
    handlers,
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setColor() {
      return this;
    },
    on(event, cb) {
      handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

describe('BattleScene mobile camera gesture policy', () => {
  it('allows gestures across active gameplay states when no overlays are active', () => {
    const scene = makeGesturePolicyScene();
    const allowedStates = [
      'PLAYER_IDLE',
      'UNIT_SELECTED',
      'SELECTING_TARGET',
      'SHOWING_FORECAST',
      'ENEMY_PHASE',
      'COMBAT_RESOLVING',
      'HEAL_RESOLVING',
      'CANTO_MOVING',
    ];

    for (const state of allowedStates) {
      scene.battleState = state;
      expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(true);
    }
  });

  it('blocks gestures in modal or non-gesture battle states', () => {
    const scene = makeGesturePolicyScene();
    const blockedStates = [
      'UNIT_ACTION_MENU',
      'SELECTING_HEAL_TARGET',
      'DEPLOY_SELECTION',
      'PAUSED',
      'BATTLE_END',
    ];

    for (const state of blockedStates) {
      scene.battleState = state;
      expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(false);
    }
  });

  it('blocks gestures while roster-like overlays are visible', () => {
    const scene = makeGesturePolicyScene({
      rosterOverlay: { visible: true },
    });
    expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(false);
  });

  it('blocks gestures while modal overlays are visible', () => {
    const blockedOverlayScenarios = [
      { pauseOverlay: { visible: true } },
      { unitDetailOverlay: { visible: true } },
      { visionDialog: {} },
      { lootSettingsOverlay: true },
      { lootRosterVisible: true },
    ];

    for (const overrides of blockedOverlayScenarios) {
      const scene = makeGesturePolicyScene(overrides);
      expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(false);
    }
  });

  it('suppresses tap flow when a second touch is active, even if gesture input is disallowed', () => {
    const cancelTouchInspectHold = vi.fn();
    const scene = {
      _isTouchPointer: BattleScene.prototype._isTouchPointer,
      _battleCamera: {
        handlePointerDown: vi.fn(() => ({ consumed: false, beganGesture: false, touchCount: 2 })),
      },
      isCameraGestureAllowed: () => false,
      cancelTouchInspectHold,
      _touchHoldTriggered: true,
    };

    const consumed = BattleScene.prototype._handleCameraGesturePointerDown.call(scene, {
      wasTouch: true,
    });

    expect(consumed).toBe(true);
    expect(cancelTouchInspectHold).toHaveBeenCalledTimes(1);
    expect(scene._touchHoldTriggered).toBe(false);
  });

  it('recognizes touch pointers through Phaser wasTouch metadata', () => {
    const scene = {};
    expect(BattleScene.prototype._isTouchPointer.call(scene, { wasTouch: true })).toBe(true);
    expect(
      BattleScene.prototype._isTouchPointer.call(scene, { event: { pointerType: 'touch' } }),
    ).toBe(true);
    expect(BattleScene.prototype._isTouchPointer.call(scene, { pointerType: 'mouse' })).toBe(false);
  });

  it('blocks gestures while story or tutorial gate is active', () => {
    const storyLocked = makeGesturePolicyScene({
      isStoryInputLocked: () => true,
    });
    expect(BattleScene.prototype.isCameraGestureAllowed.call(storyLocked)).toBe(false);

    const tutorialLocked = makeGesturePolicyScene({
      _isTutorialStrictGateActive: () => true,
    });
    expect(BattleScene.prototype.isCameraGestureAllowed.call(tutorialLocked)).toBe(false);
  });
});

describe('BattleScene camera touch interruption cleanup', () => {
  it('clears touch state and suppresses tap on touch cancel via onPointerUp', () => {
    const onClick = vi.fn();
    const handlePointerUp = vi.fn(() => false);
    const scene = {
      _isTouchPointer: BattleScene.prototype._isTouchPointer,
      _battleCamera: { clearTouches: vi.fn(() => true) },
      _cameraGestureTapSuppressed: false,
      _touchTapDown: { x: 10, y: 20 },
      cancelTouchInspectHold: vi.fn(),
      _syncMobileResetViewButton: vi.fn(),
      _handleCameraGesturePointerUp: handlePointerUp,
      isStoryInputLocked: () => false,
      _uiClickBlocked: false,
      onClick,
    };

    BattleScene.prototype.onPointerUp.call(scene, {
      wasTouch: true,
      wasCanceled: true,
      rightButtonDown: () => false,
      button: 0,
    });

    expect(scene._battleCamera.clearTouches).toHaveBeenCalledTimes(1);
    expect(handlePointerUp).toHaveBeenCalledTimes(0);
    expect(onClick).toHaveBeenCalledTimes(0);
    expect(scene.cancelTouchInspectHold).toHaveBeenCalledTimes(1);
    expect(scene._syncMobileResetViewButton).toHaveBeenCalledTimes(1);
    expect(scene._cameraGestureTapSuppressed).toBe(true);
    expect(scene._touchTapDown).toBeNull();
  });

  it('still releases touch gesture tracking when pointerup is UI-blocked', () => {
    const onClick = vi.fn();
    const handlePointerUp = vi.fn(() => false);
    const scene = {
      _isTouchPointer: BattleScene.prototype._isTouchPointer,
      _battleCamera: { clearTouches: vi.fn(() => false), hasActiveTouches: vi.fn(() => false) },
      _cameraGestureTapSuppressed: false,
      _touchTapDown: { x: 10, y: 20 },
      cancelTouchInspectHold: vi.fn(),
      _syncMobileResetViewButton: vi.fn(),
      _handleCameraGesturePointerUp: handlePointerUp,
      isStoryInputLocked: () => false,
      _uiClickBlocked: true,
      onClick,
    };

    BattleScene.prototype.onPointerUp.call(scene, {
      wasTouch: true,
      rightButtonDown: () => false,
      button: 0,
      x: 10,
      y: 20,
    });

    expect(handlePointerUp).toHaveBeenCalledTimes(1);
    expect(scene.cancelTouchInspectHold).toHaveBeenCalledTimes(1);
    expect(scene._touchTapDown).toBeNull();
    expect(scene._uiClickBlocked).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(0);
  });

  it('suppresses tap when pointerup is UI-blocked and gesture release is consumed', () => {
    const onClick = vi.fn();
    const handlePointerUp = vi.fn(() => true);
    const scene = {
      _isTouchPointer: BattleScene.prototype._isTouchPointer,
      _battleCamera: { clearTouches: vi.fn(() => false), hasActiveTouches: vi.fn(() => false) },
      _cameraGestureTapSuppressed: false,
      _touchTapDown: { x: 10, y: 20 },
      cancelTouchInspectHold: vi.fn(),
      _syncMobileResetViewButton: vi.fn(),
      _handleCameraGesturePointerUp: handlePointerUp,
      isStoryInputLocked: () => false,
      _uiClickBlocked: true,
      onClick,
    };

    BattleScene.prototype.onPointerUp.call(scene, {
      wasTouch: true,
      rightButtonDown: () => false,
      button: 0,
      x: 10,
      y: 20,
    });

    expect(handlePointerUp).toHaveBeenCalledTimes(1);
    expect(scene._cameraGestureTapSuppressed).toBe(true);
    expect(scene.cancelTouchInspectHold).toHaveBeenCalledTimes(1);
    expect(scene._touchTapDown).toBeNull();
    expect(scene._uiClickBlocked).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(0);
  });

  it('still releases touch gesture tracking when story input lock is active', () => {
    const onClick = vi.fn();
    const handlePointerUp = vi.fn(() => true);
    const scene = {
      _isTouchPointer: BattleScene.prototype._isTouchPointer,
      _battleCamera: { clearTouches: vi.fn(() => false), hasActiveTouches: vi.fn(() => false) },
      _cameraGestureTapSuppressed: false,
      _touchTapDown: { x: 10, y: 20 },
      cancelTouchInspectHold: vi.fn(),
      _syncMobileResetViewButton: vi.fn(),
      _handleCameraGesturePointerUp: handlePointerUp,
      isStoryInputLocked: () => true,
      _uiClickBlocked: false,
      onClick,
    };

    BattleScene.prototype.onPointerUp.call(scene, {
      wasTouch: true,
      rightButtonDown: () => false,
      button: 0,
      x: 10,
      y: 20,
    });

    expect(handlePointerUp).toHaveBeenCalledTimes(1);
    expect(scene._cameraGestureTapSuppressed).toBe(true);
    expect(scene.cancelTouchInspectHold).toHaveBeenCalledTimes(1);
    expect(scene._touchTapDown).toBeNull();
    expect(onClick).toHaveBeenCalledTimes(0);
  });
});

describe('BattleScene mobile camera modal pinning', () => {
  it('pins vision dialog objects to screen camera', () => {
    const scene = {
      visionDialog: null,
      battleState: 'PLAYER_IDLE',
      prePauseState: 'PLAYER_IDLE',
      cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
      add: {
        rectangle: vi.fn(() => makeUiObject()),
        text: vi.fn(() => makeUiObject()),
      },
      confirmVisionDialog: vi.fn(),
      cancelVisionDialog: vi.fn(),
      _pinToScreen: vi.fn(),
    };

    BattleScene.prototype.showVisionDialog.call(scene, {
      title: 'Vision',
      body: 'Spend 1 charge?',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(scene.visionDialog?.group?.length).toBeGreaterThan(0);
    expect(scene._pinToScreen).toHaveBeenCalledWith(scene.visionDialog.group);
  });
});
