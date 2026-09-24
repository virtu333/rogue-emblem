import { describe, expect, it, vi } from 'vitest';

import { InputController } from '../src/ui/InputController.js';
import { TERRAIN } from '../src/utils/constants.js';

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
      mapLayout: [
        [TERRAIN.Plain, TERRAIN.Plain],
        [TERRAIN.Plain, TERRAIN.Plain],
      ],
      cols: 2,
      rows: 2,
      getTerrainAt: vi.fn(() => ({
        name: 'Plain',
        moveCost: { Infantry: 1 },
        avoidBonus: 0,
        defBonus: 0,
      })),
      fogEnabled: false,
      isVisible: vi.fn(() => true),
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
    getUnitAt: vi.fn(() => null),
    ballistas: [],
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

  it.each([
    ['SELECTING_STAFF_ALLY', 'handleStaffAllyClick'],
    ['SELECTING_STAFF_TILE', 'handleStaffTileClick'],
  ])('onClick routes %s to scene.%s', (battleState, sceneMethod) => {
    const gp = { col: 3, row: 4 };
    const scene = makeScene({
      battleState,
      grid: {
        pixelToGrid: vi.fn(() => gp),
      },
      [sceneMethod]: vi.fn(),
    });
    const controller = new InputController(scene);
    vi.spyOn(controller, '_screenToWorld').mockReturnValue({ x: 60, y: 72 });

    controller.onClick({ x: 10, y: 20, rightButtonDown: () => false });

    expect(scene[sceneMethod]).toHaveBeenCalledWith(gp);
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

    // Showing a new inspection first clears stale status/attack overlays.
    // Measure the explicit close independently of that replacement cleanup.
    scene.grid.clearAttackHighlights.mockClear();
    controller.clearInspectionVisuals();
    expect(scene.inspectionPanel.hide).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalledTimes(1);
    expect(scene.refreshEndTurnControl).toHaveBeenCalled();
  });

  it('right-click enemy ballista tile shows and dismisses range overlay', () => {
    const showAttackRange = vi.fn();
    const scene = makeScene({
      requestCancel: vi.fn(() => false),
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
        mapLayout: [
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Ballista, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        ],
        cols: 3,
        rows: 3,
        fogEnabled: false,
        isVisible: vi.fn(() => true),
        showAttackRange,
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      getUnitAt: vi.fn(() => null),
      ballistas: [{ col: 1, row: 1, owner: 'enemy' }],
      inspectionPanel: { show: vi.fn(), hide: vi.fn(), visible: false, objects: [] },
    });
    const controller = new InputController(scene);

    controller.onRightClick({ x: 16, y: 16 });
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);
    expect(controller._ballistaRangeShown).toBe(true);

    controller.onRightClick({ x: 16, y: 16 });
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalledTimes(1);
    expect(controller._ballistaRangeShown).toBe(false);
  });

  it('does not show range for player-owned ballistas', () => {
    const scene = makeScene({
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
        mapLayout: [
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Ballista, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        ],
        cols: 3,
        rows: 3,
        fogEnabled: false,
        isVisible: vi.fn(() => true),
        showAttackRange: vi.fn(),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      getUnitAt: vi.fn(() => null),
      ballistas: [{ col: 1, row: 1, owner: 'player' }],
    });
    const controller = new InputController(scene);

    expect(controller._showInspectionAtPixel(16, 16)).toBe(false);
    expect(scene.grid.showAttackRange).not.toHaveBeenCalled();
    expect(controller._ballistaRangeShown).toBe(false);
  });

  it('does not show range for fog-hidden enemy ballistas', () => {
    const scene = makeScene({
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
        mapLayout: [
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Ballista, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        ],
        cols: 3,
        rows: 3,
        fogEnabled: true,
        isVisible: vi.fn(() => false),
        showAttackRange: vi.fn(),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      getUnitAt: vi.fn(() => null),
      ballistas: [{ col: 1, row: 1, owner: 'enemy' }],
    });
    const controller = new InputController(scene);

    expect(controller._showInspectionAtPixel(16, 16)).toBe(false);
    expect(scene.grid.showAttackRange).not.toHaveBeenCalled();
  });

  it('ballista range preview clears stale inspection panel and movement highlights', () => {
    const scene = makeScene({
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
        mapLayout: [
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Ballista, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        ],
        cols: 3,
        rows: 3,
        fogEnabled: false,
        isVisible: vi.fn(() => true),
        showAttackRange: vi.fn(),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      getUnitAt: vi.fn(() => null),
      ballistas: [{ col: 1, row: 1, owner: 'enemy' }],
      inspectionPanel: { show: vi.fn(), hide: vi.fn(), visible: true, objects: [] },
    });
    const controller = new InputController(scene);

    expect(controller._showInspectionAtPixel(16, 16)).toBe(true);
    expect(scene.inspectionPanel.hide).toHaveBeenCalledTimes(1);
    expect(scene.grid.clearHighlights).toHaveBeenCalledTimes(1);
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);
  });

  it('occupied ballista tile still shows unit inspection and range behavior', () => {
    const unit = {
      faction: 'enemy',
      col: 1,
      row: 1,
      mov: 5,
      moveType: 'Infantry',
      weapon: { range: '1' },
      stats: { MOV: 5 },
    };
    const scene = makeScene({
      battleState: 'PLAYER_IDLE',
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
        mapLayout: [
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Ballista, TERRAIN.Plain],
          [TERRAIN.Plain, TERRAIN.Plain, TERRAIN.Plain],
        ],
        cols: 3,
        rows: 3,
        getTerrainAt: vi.fn(() => ({ name: 'Ballista' })),
        fogEnabled: false,
        isVisible: vi.fn(() => true),
        getMovementRange: vi.fn(
          () =>
            new Map([
              ['1,1', { stoppable: true }],
              ['1,2', { stoppable: true }],
            ]),
        ),
        getAttackRange: vi.fn(() => [{ col: 1, row: 0 }]),
        showMovementRange: vi.fn(),
        showAttackRange: vi.fn(),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      getUnitAt: vi.fn(() => unit),
      buildUnitPositionMap: vi.fn(() => new Map()),
      _getCostModifier: vi.fn(() => 0),
      inspectionPanel: { show: vi.fn(), hide: vi.fn(), visible: false, objects: [] },
    });
    const controller = new InputController(scene);

    expect(controller._showInspectionAtPixel(16, 16)).toBe(true);
    expect(scene.inspectionPanel.show).toHaveBeenCalledTimes(1);
    expect(scene.grid.showMovementRange).toHaveBeenCalledTimes(1);
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);
    expect(controller._ballistaRangeShown).toBe(false);
  });

  it('clearInspectionVisuals always resets ballista range flag', () => {
    const scene = makeScene();
    const controller = new InputController(scene);
    controller._ballistaRangeShown = true;

    controller.clearInspectionVisuals();
    expect(controller._ballistaRangeShown).toBe(false);
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

describe('tile info + path preview (shared by mouse hover and the gamepad cursor)', () => {
  function makeInfoScene(extra = {}) {
    return makeScene({
      infoText: {
        text: '',
        y: 10,
        height: 20,
        setText(t) {
          this.text = t;
        },
      },
      turnCounterText: { height: 8, setY: vi.fn() },
      grid: {
        getTerrainAt: vi.fn(() => ({
          name: 'Forest',
          moveCost: { Infantry: '2', Cavalry: '3' },
          avoidBonus: '20',
          defBonus: '1',
          special: '',
        })),
        isVisible: vi.fn(() => true),
      },
      getUnitAt: vi.fn(() => null),
      ...extra,
    });
  }

  it('refreshTileInfo writes the terrain summary and stacks the HUD below it', () => {
    const scene = makeInfoScene();
    const controller = new InputController(scene);
    controller.refreshTileInfo(2, 3);

    expect(scene.grid.getTerrainAt).toHaveBeenCalledWith(2, 3);
    expect(scene.infoText.text).toBe('Forest | Move: 2 | Avo +20 | Def +1');
    expect(scene.turnCounterText.setY).toHaveBeenCalled(); // updateTopLeftHudLayout ran
  });

  it('refreshTileInfo appends the unit line (weapon + XP) for a visible unit', () => {
    const unit = {
      name: 'Edric',
      className: 'Lord',
      level: 4,
      moveType: 'Cavalry',
      currentHP: 18,
      stats: { HP: 22 },
      weapon: { name: 'Iron Sword' },
      faction: 'player',
      xp: 55,
    };
    const scene = makeInfoScene({ getUnitAt: vi.fn(() => unit) });
    const controller = new InputController(scene);
    controller.refreshTileInfo(2, 3);

    // Move cost uses the hovered unit's move type (Cavalry: 3), matching mouse hover.
    expect(scene.infoText.text).toContain('| Move: 3');
    expect(scene.infoText.text).toContain('Edric Lv4 Lord | HP 18/22 | Iron Sword | XP 55/100');
  });

  it('refreshTileInfo omits the unit line AND moveType on fog-hidden tiles (no leak)', () => {
    // A hidden Cavalry unit must not leak through the Move-cost line: fogged
    // tiles always show the Infantry cost (Forest: Inf 2 vs Cav 3).
    const unit = { name: 'Bandit', moveType: 'Cavalry', currentHP: 9, stats: { HP: 9 } };
    const scene = makeInfoScene({ getUnitAt: vi.fn(() => unit) });
    scene.grid.fogEnabled = true;
    scene.grid.isVisible = vi.fn(() => false);
    const controller = new InputController(scene);
    controller.refreshTileInfo(2, 3);
    expect(scene.infoText.text).not.toContain('Bandit');
    expect(scene.infoText.text).toContain('| Move: 2'); // Infantry cost, not Cavalry's 3
  });

  it('refreshTileInfo is a safe no-op before the info panel exists', () => {
    const scene = makeInfoScene({ infoText: null });
    const controller = new InputController(scene);
    expect(() => controller.refreshTileInfo(0, 0)).not.toThrow();
  });

  function makePathScene(extra = {}) {
    const selectedUnit = { col: 0, row: 0, moveType: 'Infantry', faction: 'player' };
    return makeScene({
      battleState: 'UNIT_SELECTED',
      selectedUnit,
      movementRange: new Map([
        ['0,0', { stoppable: true }],
        ['1,0', { stoppable: true }],
        ['1,1', { stoppable: false }],
      ]),
      unitPositions: new Map(),
      _getCostModifier: vi.fn(() => 0),
      buildOccupiedSet: vi.fn(() => new Set()),
      _lastPathPreviewKey: null,
      grid: {
        cols: 3,
        rows: 3,
        mapLayout: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        terrainData: [{ name: 'Plain', moveCost: { Infantry: '1' } }],
        reconstructIcePath: vi.fn(() => null),
        findPath: vi.fn(() => [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ]),
        showPath: vi.fn(),
        showSlidePath: vi.fn(),
        clearPath: vi.fn(),
      },
      ...extra,
    });
  }

  it('updatePathPreview shows the path to a stoppable tile and memoizes by key', () => {
    const scene = makePathScene();
    const controller = new InputController(scene);

    controller.updatePathPreview(1, 0);
    expect(scene.grid.findPath).toHaveBeenCalledTimes(1);
    expect(scene.grid.showPath).toHaveBeenCalledWith([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(scene._lastPathPreviewKey).toBe('1,0');

    // Same tile again (held d-pad repeat / hover jitter) -> memoized, no recompute.
    controller.updatePathPreview(1, 0);
    expect(scene.grid.findPath).toHaveBeenCalledTimes(1);
  });

  it("updatePathPreview clears the preview on the unit's own tile and non-stoppable tiles", () => {
    const scene = makePathScene({ _lastPathPreviewKey: '1,0' });
    const controller = new InputController(scene);

    controller.updatePathPreview(0, 0); // own tile
    expect(scene.grid.clearPath).toHaveBeenCalledTimes(1);
    expect(scene._lastPathPreviewKey).toBe(null);

    controller.updatePathPreview(1, 1); // stoppable === false (pass-through only)
    expect(scene.grid.clearPath).toHaveBeenCalledTimes(2);
    expect(scene.grid.showPath).not.toHaveBeenCalled();
  });

  it('updatePathPreview is inert outside UNIT_SELECTED', () => {
    const scene = makePathScene({ battleState: 'PLAYER_IDLE' });
    const controller = new InputController(scene);
    controller.updatePathPreview(1, 0);
    expect(scene.grid.findPath).not.toHaveBeenCalled();
    expect(scene.grid.clearPath).not.toHaveBeenCalled();
  });

  it('updatePathPreview prefers the reconstructed ice path over findPath', () => {
    const scene = makePathScene();
    const icePath = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ];
    scene.grid.reconstructIcePath = vi.fn(() => icePath);
    const controller = new InputController(scene);

    controller.updatePathPreview(1, 0);
    expect(scene.grid.findPath).not.toHaveBeenCalled(); // ice path wins
    expect(scene.grid.showPath).toHaveBeenCalledWith(icePath);
  });

  it('updatePathPreview renders slide segments when the path crosses Ice', () => {
    const scene = makePathScene();
    // (1,0) is Ice: walking right onto it slides through to (2,0) Plain.
    scene.grid.mapLayout = [
      [0, 1, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    scene.grid.terrainData = [
      { name: 'Plain', moveCost: { Infantry: '1' } },
      { name: 'Ice', moveCost: { Infantry: '1' } },
    ];
    scene.movementRange.set('2,0', { stoppable: true });
    scene.grid.findPath = vi.fn(() => [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    const controller = new InputController(scene);

    controller.updatePathPreview(2, 0);
    // Real computeEffectivePath detects the Ice step and emits a slide segment
    // ending at the landing tile past the ice.
    expect(scene.grid.showSlidePath).toHaveBeenCalledTimes(1);
    const slidePath = scene.grid.showSlidePath.mock.calls[0][0];
    expect(slidePath.at(-1)).toEqual({ col: 2, row: 0 });
    expect(scene.grid.showPath).toHaveBeenCalledTimes(1);
    const effectivePath = scene.grid.showPath.mock.calls[0][0];
    expect(effectivePath.at(-1)).toEqual({ col: 2, row: 0 }); // preview reaches the landing
  });

  it('onPointerMove routes through the shared helpers with the hovered tile', () => {
    const scene = makeInfoScene({
      cursorHighlight: {
        setPosition() {
          return this;
        },
        setVisible() {
          return this;
        },
      },
    });
    scene.grid.pixelToGrid = vi.fn(() => ({ col: 1, row: 1 }));
    scene.grid.gridToPixel = vi.fn(() => ({ x: 48, y: 48 }));
    const controller = new InputController(scene);
    const infoSpy = vi.spyOn(controller, 'refreshTileInfo');
    const pathSpy = vi.spyOn(controller, 'updatePathPreview');

    controller.onPointerMove({ x: 48, y: 48 });

    expect(infoSpy).toHaveBeenCalledWith(1, 1);
    expect(pathSpy).toHaveBeenCalledWith(1, 1);
  });
});

describe('mobile idle tap on non-player units', () => {
  function makeMobileScene(extra = {}) {
    return makeScene({
      isMobileInput: true,
      grid: {
        pixelToGrid: vi.fn(() => ({ col: 1, row: 1 })),
        gridToPixel: vi.fn(() => ({ x: 48, y: 80 })),
        fogEnabled: false,
        isVisible: vi.fn(() => true),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      ...extra,
    });
  }

  it('shows inspection + range for a visible enemy instead of clearing', () => {
    const enemy = { faction: 'enemy', col: 1, row: 1 };
    const scene = makeMobileScene({ getUnitAt: vi.fn(() => enemy) });
    const controller = new InputController(scene);
    const showSpy = vi.spyOn(controller, '_showInspectionAtPixel').mockReturnValue(true);

    controller.handleIdleClick({ col: 1, row: 1 });

    expect(scene.grid.gridToPixel).toHaveBeenCalledWith(1, 1);
    expect(showSpy).toHaveBeenCalledWith(48, 80);
    expect(scene.inspectionPanel.hide).not.toHaveBeenCalled();
  });

  it('second tap on the same enemy clears inspection visuals', () => {
    const enemy = { faction: 'enemy', col: 1, row: 1 };
    const scene = makeMobileScene({
      getUnitAt: vi.fn(() => enemy),
      inspectionPanel: { show: vi.fn(), hide: vi.fn(), visible: true, _unit: enemy, objects: [] },
    });
    const controller = new InputController(scene);
    const showSpy = vi.spyOn(controller, '_showInspectionAtPixel');

    controller.handleIdleClick({ col: 1, row: 1 });

    expect(showSpy).not.toHaveBeenCalled();
    expect(scene.inspectionPanel.hide).toHaveBeenCalled();
    expect(scene.grid.clearHighlights).toHaveBeenCalled();
  });

  it('does not reveal enemies on fogged tiles', () => {
    const enemy = { faction: 'enemy', col: 1, row: 1 };
    const scene = makeMobileScene({ getUnitAt: vi.fn(() => enemy) });
    scene.grid.fogEnabled = true;
    scene.grid.isVisible = vi.fn(() => false);
    const controller = new InputController(scene);
    const showSpy = vi.spyOn(controller, '_showInspectionAtPixel');

    controller.handleIdleClick({ col: 1, row: 1 });

    expect(showSpy).not.toHaveBeenCalled();
    expect(scene.inspectionPanel.hide).toHaveBeenCalled();
  });

  it('desktop click on an enemy keeps the clearing behavior', () => {
    const enemy = { faction: 'enemy', col: 1, row: 1 };
    const scene = makeMobileScene({ isMobileInput: false, getUnitAt: vi.fn(() => enemy) });
    const controller = new InputController(scene);
    const showSpy = vi.spyOn(controller, '_showInspectionAtPixel');

    controller.handleIdleClick({ col: 1, row: 1 });

    expect(showSpy).not.toHaveBeenCalled();
    expect(scene.inspectionPanel.hide).toHaveBeenCalled();
  });
});

describe('mobile first-tap unit actions', () => {
  function setup() {
    const unit = { faction: 'player', col: 1, row: 1, graphic: { clearTint: vi.fn() } };
    const scene = makeScene({
      isMobileInput: true,
      _mobileBattleHud: { available: () => true },
      _isTutorialStrictGateActive: () => false,
      getUnitAt: () => unit,
      selectUnit: vi.fn(() => {
        scene.selectedUnit = unit;
        scene.battleState = 'UNIT_SELECTED';
      }),
      showActionMenu: vi.fn(() => {
        scene.battleState = 'UNIT_ACTION_MENU';
        scene.actionMenu = [];
      }),
      hideActionMenu: vi.fn(),
      moveUnit: vi.fn(),
    });
    scene.grid.snapshotFogState = vi.fn(() => 'fog');
    scene.movementRange = new Map([['1,0', { stoppable: true }]]);
    const controller = new InputController(scene);
    return { unit, scene, controller };
  }

  it.each(['Forest', 'Mountain', 'Plain'])(
    'one tap on %s selects actions and refreshes terrain',
    (name) => {
      const { unit, scene, controller } = setup();
      scene.infoText = { setText: vi.fn() };
      scene.grid.getTerrainAt.mockReturnValue({
        name,
        moveCost: { Infantry: 2 },
        avoidBonus: 20,
        defBonus: 1,
      });
      unit.moveType = 'Infantry';
      unit.stats = { HP: 20 };
      vi.spyOn(controller, 'updateTopLeftHudLayout').mockImplementation(() => {});
      controller.onClick({ x: 48, y: 48 });
      expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
      expect(scene._mobileTerrainFocus).toEqual({ col: 1, row: 1 });
      expect(scene.infoText.setText.mock.calls[0][0]).toContain(name);
      expect(unit.hasMoved).toBeUndefined();
      expect(unit.hasActed).toBeUndefined();
      expect(scene.preMoveLoc).toEqual({ col: 1, row: 1 });
      expect(controller.isSelectionMenu()).toBe(true);
    },
  );

  it('own-tile menu after undo stays registered and accepts tap-away', () => {
    const { unit, scene, controller } = setup();
    controller.handleIdleClick({ col: 1, row: 1 });
    controller.handleActionMenuClick({ col: 1, row: 0 });
    // undoMove returns to a fresh UNIT_SELECTED state at the original location.
    scene.selectUnit(unit);
    controller.handleSelectedClick({ col: 1, row: 1 });
    expect(controller.isSelectionMenu()).toBe(true);
    scene.getUnitAt = () => null;
    scene.registry = { get: () => null };
    scene.deselectUnit = vi.fn();
    controller.handleActionMenuClick({ col: 9, row: 9 });
    expect(scene.deselectUnit).toHaveBeenCalledOnce();
  });

  it('allows a destination tap without a second unit tap', () => {
    const { unit, scene, controller } = setup();
    controller.handleIdleClick({ col: 1, row: 1 });
    controller.handleActionMenuClick({ col: 1, row: 0 });
    expect(scene.hideActionMenu).toHaveBeenCalledOnce();
    expect(scene.moveUnit).toHaveBeenCalledWith(unit, 1, 0);
    expect(controller.isSelectionMenu()).toBe(false);
  });

  it.each(['submenu', 'moved', 'traded', 'committed'])(
    'does not allow movement after %s',
    (kind) => {
      const { scene, unit, controller } = setup();
      controller.handleIdleClick({ col: 1, row: 1 });
      if (kind === 'submenu') scene.actionMenu = [];
      if (kind === 'moved') unit.hasMoved = true;
      if (kind === 'traded') scene.tradeMutatedThisSession = true;
      if (kind === 'committed') controller.commitSelectionMenu(scene.actionMenu);
      controller.handleActionMenuClick({ col: 1, row: 0 });
      expect(scene.moveUnit).not.toHaveBeenCalled();
    },
  );

  it('switches a ready ally directly from the initial menu', () => {
    const { scene, controller, unit } = setup();
    controller.handleIdleClick({ col: 1, row: 1 });
    const ally = { ...unit, col: 0 };
    scene.getUnitAt = () => ally;
    scene.deselectUnit = vi.fn();
    scene.selectUnit.mockImplementation((u) => {
      scene.selectedUnit = u;
      scene.battleState = 'UNIT_SELECTED';
    });
    controller.handleActionMenuClick({ col: 0, row: 1 });
    expect(scene.selectUnit).toHaveBeenLastCalledWith(ally);
    expect(scene.selectedUnit).toBe(ally);
    expect(controller.isSelectionMenu()).toBe(true);
    expect(scene.moveUnit).not.toHaveBeenCalled();
  });

  it.each(['moved', 'committed', 'traded', 'submenu', 'tutorial'])(
    'does not switch units from %s state',
    (kind) => {
      const { scene, controller, unit } = setup();
      controller.handleIdleClick({ col: 1, row: 1 });
      const ally = { ...unit, col: 0 };
      scene.getUnitAt = () => ally;
      if (kind === 'moved') unit.hasMoved = true;
      if (kind === 'committed') unit._movementCommitted = true;
      if (kind === 'traded') scene.tradeMutatedThisSession = true;
      if (kind === 'submenu') scene.actionMenu = [];
      if (kind === 'tutorial') scene._isTutorialStrictGateActive = () => true;
      expect(controller.handlePlanningUnitTap({ col: 0, row: 1 })).toBe(false);
      expect(scene.selectedUnit).toBe(unit);
    },
  );

  it.each(['acted', 'npc'])('does not transfer selection to an %s unit', (kind) => {
    const { scene, controller, unit } = setup();
    controller.handleIdleClick({ col: 1, row: 1 });
    scene.getUnitAt = () => ({
      ...unit,
      col: 0,
      hasActed: kind === 'acted',
      faction: kind === 'npc' ? 'npc' : 'player',
    });
    scene.grid.gridToPixel = () => ({ x: 0, y: 32 });
    const inspect = vi.spyOn(controller, '_showInspectionAtPixel').mockReturnValue(true);
    expect(controller.handlePlanningUnitTap({ col: 0, row: 1 })).toBe(true);
    expect(inspect).toHaveBeenCalledOnce();
    expect(scene.selectedUnit).toBe(unit);
  });

  it('empty out-of-range tap deselects without undoing a move', () => {
    const { scene, controller } = setup();
    controller.handleIdleClick({ col: 1, row: 1 });
    scene.getUnitAt = () => null;
    scene.registry = { get: () => null };
    scene.deselectUnit = vi.fn();
    controller.handleActionMenuClick({ col: 9, row: 9 });
    expect(scene.deselectUnit).toHaveBeenCalledOnce();
    expect(scene.moveUnit).not.toHaveBeenCalled();
  });

  it('inspection cleanup preserves movement and attack highlights', () => {
    const { scene, controller } = setup();
    controller._planningInspection = true;
    controller._planningThreat = { hide: vi.fn() };
    controller.clearInspectionVisuals();
    expect(controller._planningThreat.hide).toHaveBeenCalledOnce();
    expect(scene.grid.clearHighlights).not.toHaveBeenCalled();
    expect(scene.grid.clearAttackHighlights).not.toHaveBeenCalled();
  });

  it('fog-hidden enemies cannot enter planning inspection', () => {
    const { scene, controller } = setup();
    controller.handleIdleClick({ col: 1, row: 1 });
    scene.grid.fogEnabled = true;
    scene.grid.isVisible = () => false;
    scene.getUnitAt = () => ({ faction: 'enemy', col: 0, row: 0 });
    const inspect = vi.spyOn(controller, '_showInspectionAtPixel');
    expect(controller.handlePlanningUnitTap({ col: 0, row: 0 })).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(['desktop', 'tutorial', 'acted', 'no-hud'])('preserves %s selection rules', (kind) => {
    const { scene, unit, controller } = setup();
    if (kind === 'desktop') scene.isMobileInput = false;
    if (kind === 'tutorial') scene._isTutorialStrictGateActive = () => true;
    if (kind === 'acted') unit.hasActed = true;
    if (kind === 'no-hud') scene._mobileBattleHud = null;
    controller.handleIdleClick({ col: 1, row: 1 });
    expect(scene.showActionMenu).not.toHaveBeenCalled();
  });
});
