import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

// An explicit Cancel (Esc, the pad's B, Android Back, the phone's Back button) reaches the Entity
// rally's card only when nothing else in the battle has something to close: a forecast, a unit's
// menu, a panel or the pause menu keeps its Back, and the card never costs the player their way
// out of one. BattleScene.requestCancel also serves inputs that are not a Cancel (a right-click
// inspect, a tap off the map, the phone's Menu, the pad's Start); those never touch the card.
const { BattleScene } = await import('../src/scenes/BattleScene.js');
const { BattleBeatsController } = await import('../src/ui/BattleBeatsController.js');
const { default: EntityRallyController } = await import('../src/ui/EntityRallyController.js');
const { InputController } = await import('../src/ui/InputController.js');
const { InputAction } = await import('../src/utils/InputActions.js');
const { installAndroidBackButton } = await import('../src/utils/androidBackButton.js');

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

// an explicit Cancel, as Esc, the input bus's Cancel and the Back buttons send it
const cancel = (scene, opts = {}) =>
  BattleScene.prototype.requestCancel.call(scene, { cancelAction: true, ...opts });

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

// ---------------------------------------------------------------------------------------------
// The real input paths. A board of 10x8 tiles of 32px; the Entity stands on its 3x3 at (4, 2).
const TILE = 32;
const { getFootprintKeys } = await import('../src/engine/EntitySystem.js');

function boardScene(overrides = {}) {
  const entity = {
    name: 'The Entity',
    faction: 'enemy',
    isEntity: true,
    isBoss: true,
    col: 4,
    row: 2,
    currentHP: 90,
    stats: { HP: 120, MOV: 0 },
    mov: 0,
    moveType: 'Infantry',
    weapon: null,
    statusEffects: [],
  };
  const inspectionPanel = {
    visible: false,
    _unit: null,
    show: vi.fn(function show(unit) {
      this.visible = true;
      this._unit = unit;
    }),
    hide: vi.fn(function hide() {
      this.visible = false;
      this._unit = null;
    }),
  };
  const grid = {
    cols: 10,
    rows: 8,
    fogEnabled: false,
    pixelToGrid: (px, py) => {
      const col = Math.floor(px / TILE);
      const row = Math.floor(py / TILE);
      return col >= 0 && col < 10 && row >= 0 && row < 8 ? { col, row } : null;
    },
    gridToPixel: (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 }),
    getTerrainAt: () => ({ name: 'Plain' }),
    getMovementRange: () => new Map(),
    getAttackRange: () => [],
    showMovementRange: vi.fn(),
    showAttackRange: vi.fn(),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
  };
  const keys = {};
  const built = sceneWithRally({
    grid,
    inspectionPanel,
    enemyUnits: [entity],
    playerUnits: [],
    getUnitAt: (col, row) => (getFootprintKeys(entity).includes(`${col},${row}`) ? entity : null),
    buildUnitPositionMap: () => new Map(),
    _getCostModifier: () => 0,
    _battleCamera: { screenToWorld: (x, y) => ({ x, y }) },
    input: {
      hitTestPointer: () => [],
      keyboard: { on: (name, fn) => (keys[name] = fn), off: () => {} },
    },
    ...overrides,
  });
  const { scene } = built;
  scene.requestCancel = (opts) => BattleScene.prototype.requestCancel.call(scene, opts);
  scene._inputController = new InputController(scene);
  return { ...built, entity, inspectionPanel, keys };
}

// a pointer over tile (col, row): the right button for onRightClick, the left for onClick
const pointerAt = (col, row, { right = false } = {}) => ({
  x: col * TILE + TILE / 2,
  y: row * TILE + TILE / 2,
  button: right ? 2 : 0,
  rightButtonDown: () => right,
});

const expectCardKept = (rally) => {
  expect(rally.skipped).toBe(false);
  expect(rally._card.hide).not.toHaveBeenCalled();
  expect(rally.cardVisible).toBe(true);
};

describe('inputs that are not a Cancel leave the rally card up', () => {
  it.each(['PLAYER_IDLE', 'ENEMY_PHASE'])(
    'a right-click on the Entity (%s) keeps the card and opens its inspection',
    (battleState) => {
      const { scene, rally, entity, inspectionPanel } = boardScene({ battleState });
      // a tile of its body other than the anchor
      scene._inputController.onRightClick(pointerAt(5, 3, { right: true }));
      expectCardKept(rally);
      expect(inspectionPanel.show).toHaveBeenCalledTimes(1);
      expect(inspectionPanel.show.mock.calls[0][0]).toBe(entity);
      expect(inspectionPanel.visible).toBe(true);
      expect(scene.showPauseMenu).not.toHaveBeenCalled();
    },
  );

  it('a tap off the map keeps the card and opens nothing', () => {
    const { scene, rally, inspectionPanel } = boardScene();
    scene._inputController.onClick(pointerAt(14, 3));
    expectCardKept(rally);
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
    expect(inspectionPanel.show).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it("the phone's Menu (a plain requestCancel) opens Pause at idle and the card stays", () => {
    const { scene, rally } = boardScene();
    // the rail's Menu at idle: canOpenPauseFromMenu() is false there, so it falls to requestCancel()
    expect(BattleScene.prototype.canOpenPauseFromMenu.call({ ...scene, turnManager: {} })).toBe(
      false,
    );
    expect(scene.requestCancel()).toBe(true);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
    expectCardKept(rally);
  });

  it("the pad's Start opens Pause and the card stays", () => {
    const { scene, rally } = boardScene();
    BattleScene.prototype._onInputAction.call(scene, InputAction.PAUSE);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
    expectCardKept(rally);
  });
});

describe('every explicit Cancel still skips the rally', () => {
  it('Esc', () => {
    const { scene, rally, keys } = boardScene();
    BattleScene.prototype._bindGameplayKeyboardHandlers.call(
      Object.assign(scene, {
        _unbindGameplayKeyboardHandlers: BattleScene.prototype._unbindGameplayKeyboardHandlers,
      }),
    );
    keys['keydown-ESC']({
      key: 'Escape',
      repeat: false,
      preventDefault() {},
      stopPropagation() {},
    });
    expect(rally.skipped).toBe(true);
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
  });

  it("the input bus's Cancel (the pad's B)", () => {
    const { scene, rally } = boardScene();
    BattleScene.prototype._onInputAction.call(scene, InputAction.CANCEL);
    expect(rally.skipped).toBe(true);
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
  });

  it('Android Back (Cancel on the input bus)', () => {
    const { scene, rally } = boardScene();
    const listeners = [];
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        PluginHeaders: [{ name: 'App' }],
        nativePromise: () => Promise.resolve(),
        addListener: (_plugin, event, fn) => {
          listeners.push({ event, fn });
          return { remove: async () => {} };
        },
      },
    };
    installAndroidBackButton({
      win,
      dispatch: (action) => BattleScene.prototype._onInputAction.call(scene, action),
      getOwner: () => scene,
    });
    for (const l of listeners) if (l.event === 'backButton') l.fn({});
    expect(rally.skipped).toBe(true);
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
  });
});
