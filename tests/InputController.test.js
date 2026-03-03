import { describe, expect, it, vi } from 'vitest';

import { InputController } from '../src/ui/InputController.js';

function makeScene(overrides = {}) {
  return {
    _isTouchPointer: vi.fn(() => false),
    isStoryInputLocked: vi.fn(() => false),
    isCameraGestureAllowed: vi.fn(() => true),
    _battleCamera: null,
    cameras: {
      main: {
        x: 0,
        y: 0,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
      },
    },
    grid: {
      pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
      getTerrainAt: vi.fn(() => ({
        name: 'Plain',
        moveCost: { Infantry: 1 },
        avoidBonus: 0,
        defBonus: 0,
      })),
      getMovementRange: vi.fn(() => new Map()),
      getAttackRange: vi.fn(() => []),
      showMovementRange: vi.fn(),
      showAttackRange: vi.fn(),
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
    },
    time: {
      delayedCall: vi.fn((_ms, _cb) => ({ remove: vi.fn() })),
    },
    requestCancel: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    unitDetailOverlay: null,
    pauseOverlay: null,
    lootSettingsOverlay: false,
    inspectionPanel: { show: vi.fn(), hide: vi.fn(), visible: false, objects: [] },
    isMobileInput: false,
    inspectMode: false,
    battleState: 'PLAYER_IDLE',
    ...overrides,
  };
}

describe('InputController', () => {
  it('coordinate conversion uses battle camera when present and camera math fallback otherwise', () => {
    const sceneWithBattleCamera = makeScene({
      _battleCamera: {
        screenToWorld: vi.fn(() => ({ x: 11, y: 22 })),
        worldToScreen: vi.fn(() => ({ x: 33, y: 44 })),
      },
    });
    const withBattleCamera = new InputController(sceneWithBattleCamera);
    expect(withBattleCamera._screenToWorld(5, 6)).toEqual({ x: 11, y: 22 });
    expect(withBattleCamera._worldToScreen(7, 8)).toEqual({ x: 33, y: 44 });

    const sceneWithFallback = makeScene({
      _battleCamera: null,
      cameras: {
        main: {
          x: 4,
          y: 6,
          zoom: 2,
          scrollX: 10,
          scrollY: 20,
        },
      },
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 9, row: 4 })),
      },
    });
    const fallback = new InputController(sceneWithFallback);

    expect(fallback._screenToWorld(14, 26)).toEqual({ x: 15, y: 30 });
    expect(fallback._worldToScreen(15, 30)).toEqual({ x: 14, y: 26 });
    expect(fallback._pointerToGrid({ x: 14, y: 26 })).toEqual({ col: 9, row: 4 });
    sceneWithFallback.grid = null;
    expect(fallback._pointerToGrid({ x: 14, y: 26 })).toBeNull();
  });

  it('touch hold start/update/cancel lifecycle writes state on scene fields', () => {
    const holdTimer = { remove: vi.fn() };
    const scene = makeScene({
      _isTouchPointer: vi.fn(() => true),
      time: {
        delayedCall: vi.fn((_ms, cb) => {
          holdTimer.cb = cb;
          return holdTimer;
        }),
      },
      _touchTapDown: null,
      _touchHoldStart: null,
      _touchHoldTimer: null,
      _touchHoldTriggered: false,
    });
    const controller = new InputController(scene);
    vi.spyOn(controller, '_screenToWorld').mockReturnValue({ x: 4, y: 7 });
    vi.spyOn(controller, '_showInspectionAtPixel').mockReturnValue(true);

    controller.startTouchInspectHold({ x: 12, y: 30, id: 2 });
    expect(scene._touchHoldStart).toEqual({ x: 12, y: 30, id: 2 });
    expect(scene._touchHoldTimer).toBe(holdTimer);
    expect(controller._touchHoldStart).toBeUndefined();

    holdTimer.cb();
    expect(scene._touchHoldTriggered).toBe(true);
    expect(controller._showInspectionAtPixel).toHaveBeenCalledWith(4, 7);

    const secondTimer = { remove: vi.fn() };
    scene._touchHoldTimer = secondTimer;
    scene._touchHoldStart = { x: 0, y: 0, id: 2 };
    controller.updateTouchInspectHold({ x: 999, y: 0, id: 2 });

    expect(secondTimer.remove).toHaveBeenCalledWith(false);
    expect(scene._touchHoldTimer).toBeNull();
    expect(scene._touchHoldStart).toBeNull();
  });

  it('camera gesture handlers consume and suppress tap flow when gesture release is consumed', () => {
    const scene = makeScene({
      _isTouchPointer: vi.fn(() => true),
      _battleCamera: {
        handlePointerDown: vi.fn(() => ({ consumed: false, beganGesture: false, touchCount: 2 })),
        hasActiveTouches: vi.fn(() => false),
      },
      _touchHoldTimer: { remove: vi.fn() },
      _touchHoldStart: { x: 1, y: 1, id: 1 },
      _touchHoldTriggered: true,
      _cameraGestureTapSuppressed: false,
      _touchTapDown: { x: 10, y: 20 },
      _uiClickBlocked: false,
      _tapMoveThreshold: 16,
      _syncMobileResetViewButton: vi.fn(),
    });
    const controller = new InputController(scene);
    const onClickSpy = vi.spyOn(controller, 'onClick').mockImplementation(() => {});
    vi.spyOn(controller, '_handleCameraGesturePointerUp').mockReturnValue(true);

    expect(controller._handleCameraGesturePointerDown({ wasTouch: true })).toBe(true);
    expect(scene._touchHoldTriggered).toBe(false);

    controller.onPointerUp({
      wasTouch: true,
      x: 10,
      y: 20,
      button: 0,
      rightButtonDown: () => false,
    });

    expect(scene._cameraGestureTapSuppressed).toBe(true);
    expect(scene._touchTapDown).toBeNull();
    expect(onClickSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['PLAYER_IDLE', 'handleIdleClick'],
    ['UNIT_SELECTED', 'handleSelectedClick'],
    ['UNIT_ACTION_MENU', 'handleActionMenuClick'],
    ['SELECTING_TARGET', 'handleTargetClick'],
    ['SHOWING_FORECAST', 'handleForecastClick'],
  ])('onClick routes %s to %s', (battleState, methodName) => {
    const gp = { col: 3, row: 4 };
    const scene = makeScene({
      battleState,
      grid: {
        pixelToGrid: vi.fn(() => gp),
      },
    });
    const controller = new InputController(scene);
    vi.spyOn(controller, '_screenToWorld').mockReturnValue({ x: 60, y: 72 });
    const routeSpy = vi.spyOn(controller, methodName).mockImplementation(() => {});

    controller.onClick({ x: 10, y: 20, rightButtonDown: () => false });

    expect(routeSpy).toHaveBeenCalledWith(gp);
  });

  it('inspection show/clear flow updates panel and range visuals', () => {
    const unit = {
      faction: 'player',
      col: 2,
      row: 3,
      mov: 5,
      moveType: 'Infantry',
      weapon: { range: '1' },
      stats: { MOV: 5 },
    };
    const scene = makeScene({
      battleState: 'PLAYER_IDLE',
      gameData: {},
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 2, row: 3 })),
        getTerrainAt: vi.fn(() => ({ name: 'Plain' })),
        getMovementRange: vi.fn(
          () =>
            new Map([
              ['2,3', { stoppable: true }],
              ['3,3', { stoppable: true }],
            ]),
        ),
        getAttackRange: vi.fn(() => [{ col: 4, row: 3 }]),
        showMovementRange: vi.fn(),
        showAttackRange: vi.fn(),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      getUnitAt: vi.fn(() => unit),
      buildUnitPositionMap: vi.fn(() => new Map()),
      _getCostModifier: vi.fn(() => 0),
      _pinToScreen: vi.fn(),
      inspectionPanel: { show: vi.fn(), hide: vi.fn(), visible: true, objects: [{ id: 1 }] },
    });
    const controller = new InputController(scene);

    const shown = controller._showInspectionAtPixel(100, 120);
    expect(shown).toBe(true);
    expect(scene.inspectionPanel.show).toHaveBeenCalledTimes(1);
    expect(scene.grid.showMovementRange).toHaveBeenCalledTimes(1);
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);

    controller.clearInspectionVisuals();
    expect(scene.inspectionPanel.hide).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalledTimes(1);
    expect(scene.refreshEndTurnControl).toHaveBeenCalled();
  });

  it('updateTopLeftHudLayout stacks HUD text below info text', () => {
    const scene = makeScene({
      infoText: { text: 'Plain | Move: 1', y: 10, height: 20 },
      turnCounterText: { height: 8, setY: vi.fn() },
      visionHudText: { setY: vi.fn() },
    });
    const controller = new InputController(scene);

    controller.updateTopLeftHudLayout();

    expect(scene.turnCounterText.setY).toHaveBeenCalledWith(34);
    expect(scene.visionHudText.setY).toHaveBeenCalledWith(44);
    expect(controller.turnCounterText).toBeUndefined();
  });
});
