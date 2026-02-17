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
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setColor() { return this; },
    on(event, cb) {
      handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

describe('BattleScene mobile camera gesture policy', () => {
  it('allows gestures only in approved states when no overlays are active', () => {
    const scene = makeGesturePolicyScene({ battleState: 'PLAYER_IDLE' });
    expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(true);

    scene.battleState = 'UNIT_ACTION_MENU';
    expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(false);
  });

  it('blocks gestures while roster-like overlays are visible', () => {
    const scene = makeGesturePolicyScene({
      rosterOverlay: { visible: true },
    });
    expect(BattleScene.prototype.isCameraGestureAllowed.call(scene)).toBe(false);
  });

  it('suppresses tap flow when a second touch is active, even if gesture input is disallowed', () => {
    const cancelTouchInspectHold = vi.fn();
    const scene = {
      _battleCamera: {
        handlePointerDown: vi.fn(() => ({ consumed: false, beganGesture: false, touchCount: 2 })),
      },
      isCameraGestureAllowed: () => false,
      cancelTouchInspectHold,
      _touchHoldTriggered: true,
    };

    const consumed = BattleScene.prototype._handleCameraGesturePointerDown.call(scene, { pointerType: 'touch' });

    expect(consumed).toBe(true);
    expect(cancelTouchInspectHold).toHaveBeenCalledTimes(1);
    expect(scene._touchHoldTriggered).toBe(false);
  });
});

describe('BattleScene camera touch interruption cleanup', () => {
  it('clears touch state and suppresses tap on touch cancel via onPointerUp', () => {
    const onClick = vi.fn();
    const handlePointerUp = vi.fn(() => false);
    const scene = {
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
      pointerType: 'touch',
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
