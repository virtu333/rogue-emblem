// Touch taps on a phone (the "I have to touch a unit more exactly" report, Oct 2026).
//
// 1. No dead zone: a finger that wobbles a little is either a tap or a camera pan, never
//    neither. The tap used to give up at 12 game px while the pan began past 10 CSS px;
//    upright (640 game px in 390 CSS px) that left 7.3-10 CSS px where nothing happened.
// 2. The haptic tick is a receipt: it fires after a board tap changed something, and not
//    for a tap that changed nothing.
// 3. A tap just off a ready ally's tile selects it at idle, only when that ally is the one
//    unit in reach; never in any other state (a move destination keeps the exact tile).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hapticCalls = [];
vi.mock('../src/utils/haptics.js', () => ({
  haptic: (kind) => hapticCalls.push({ kind, state: globalThis.__tapScene?.battleState }),
}));

import { InputController } from '../src/ui/InputController.js';
import { BattleCameraController } from '../src/utils/BattleCameraController.js';
import { Grid } from '../src/engine/Grid.js';
import { createBoardTransform } from '../src/utils/boardOrientation.js';
import { TOUCH_SLOP_CSS_PX } from '../src/utils/touchSlop.js';
import { snapTapToUnitCell } from '../src/ui/tapSnap.js';

// An upright phone: the 640-wide canvas shown 390 CSS px wide.
const CSS_WIDTH = 390;
const canvas = { width: 640, height: 480, getBoundingClientRect: () => ({ width: CSS_WIDTH }) };
const RATIO = 640 / CSS_WIDTH;
const manager = { game: { canvas }, pointers: [] };

function touch(id, x, y, type) {
  return {
    id,
    x,
    y,
    pointerType: 'touch',
    isDown: type !== 'touchend',
    event: { type },
    manager,
  };
}

function makeTapScene(overrides = {}) {
  const camera = {
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    width: 640,
    height: 480,
    setZoom(z) {
      this.zoom = z;
    },
    setScroll(x, y) {
      this.scrollX = x;
      this.scrollY = y;
    },
  };
  const scene = {
    game: { canvas },
    _isTouchPointer: (p) => p?.pointerType === 'touch',
    isStoryInputLocked: () => false,
    isCameraGestureAllowed: () => true,
    _syncMobileResetViewButton: vi.fn(),
    time: { delayedCall: () => ({ remove() {} }) },
    battleState: 'PLAYER_IDLE',
    // What BattleScene set before the shared slop (unread now; kept so the old rule
    // would be exercised here).
    _tapMoveThreshold: 12,
    ...overrides,
  };
  scene._battleCamera = new BattleCameraController(camera, { minZoom: 0.5, maxZoom: 3 });
  const input = new InputController(scene);
  input.onClick = vi.fn();
  return { scene, input, camera };
}

describe('tap or pan: no movement is neither', () => {
  it('every wobble from 0 to 30 CSS px is exactly one of a tap or a pan', () => {
    const undecided = [];
    for (let css = 0; css <= 30; css += 0.25) {
      const { input, camera } = makeTapScene();
      const d = css * RATIO; // game px
      input.onPointerDown(touch(1, 200, 200, 'touchstart'));
      input.onPointerMove(touch(1, 200 + d, 200, 'touchmove'));
      input.onPointerUp(touch(1, 200 + d, 200, 'touchend'));
      const tapped = input.onClick.mock.calls.length === 1;
      const panned = camera.scrollX !== 0;
      if (tapped === panned) undecided.push(css);
    }
    expect(undecided).toEqual([]);
  });

  it('the boundary is the slop in CSS pixels, at the canvas scale', () => {
    const at = (css) => {
      const { input } = makeTapScene();
      input.onPointerDown(touch(1, 100, 100, 'touchstart'));
      input.onPointerUp(touch(1, 100, 100 + css * RATIO, 'touchend'));
      return input.onClick.mock.calls.length === 1;
    };
    // 8 CSS px upright: ~13 game px, past the old 12 game px cut-off. Still a tap.
    expect(at(8)).toBe(true);
    expect(at(TOUCH_SLOP_CSS_PX - 0.1)).toBe(true);
    expect(at(TOUCH_SLOP_CSS_PX + 0.1)).toBe(false);
  });

  it('with panning off, a small wobble is still a tap', () => {
    const { input, camera } = makeTapScene({ isCameraGestureAllowed: () => false });
    input.onPointerDown(touch(1, 200, 200, 'touchstart'));
    input.onPointerMove(touch(1, 200, 200 + 8 * RATIO, 'touchmove'));
    input.onPointerUp(touch(1, 200, 200 + 8 * RATIO, 'touchend'));
    expect(input.onClick).toHaveBeenCalledTimes(1);
    expect(camera.scrollY).toBe(0);
  });

  it('a quick swipe with no move event (down, then lift) is still a tap or a pan', () => {
    const undecided = [];
    for (let css = 0; css <= 30; css += 0.5) {
      const { input, camera } = makeTapScene();
      const d = css * RATIO;
      input.onPointerDown(touch(1, 200, 200, 'touchstart'));
      input.onPointerUp(touch(1, 200 + d * 0.6, 200 + d * 0.8, 'touchend'));
      const tapped = input.onClick.mock.calls.length === 1;
      const panned = camera.scrollX !== 0 || camera.scrollY !== 0;
      if (tapped === panned) undecided.push(css);
    }
    expect(undecided).toEqual([]);
  });

  it('the lift-only pan moves the camera by the swipe, like a dragged pan', () => {
    const { input, camera } = makeTapScene();
    input.onPointerDown(touch(1, 200, 200, 'touchstart'));
    input.onPointerUp(touch(1, 170, 180, 'touchend'));
    expect(camera.scrollX).toBe(30);
    expect(camera.scrollY).toBe(20);
    expect(input.onClick).not.toHaveBeenCalled();
  });
});

// A small board as Grid draws it (pixelToGrid is the real one).
function makeBoardScene({ units = [], battleState = 'PLAYER_IDLE', fog = false, zoom = 1 } = {}) {
  const grid = {
    cols: 6,
    rows: 6,
    offsetX: 0,
    offsetY: 0,
    board: createBoardTransform(6, 6),
    fogEnabled: fog,
    isVisible: () => false,
    mapLayout: Array.from({ length: 6 }, () => Array(6).fill(0)),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
  };
  grid.pixelToGrid = Grid.prototype.pixelToGrid.bind(grid);
  grid.gridToPixel = Grid.prototype.gridToPixel.bind(grid);
  const scene = {
    game: { canvas },
    grid,
    battleState,
    isMobileInput: false,
    _isTouchPointer: (p) => p?.pointerType === 'touch',
    isStoryInputLocked: () => false,
    _battleCamera: null,
    cameras: { main: { x: 0, y: 0, zoom, scrollX: 0, scrollY: 0, width: 640, height: 480 } },
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row) || null,
    inspectionPanel: { visible: false, hide: vi.fn(), show: vi.fn() },
    unitDetailOverlay: null,
    selectedUnit: null,
    actionMenu: null,
    forecastTarget: null,
    ballistas: [],
    requestCancel: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    selectUnit(unit) {
      this.selectedUnit = unit;
      this.battleState = 'UNIT_SELECTED';
    },
  };
  globalThis.__tapScene = scene;
  return scene;
}

const tapAt = (input, x, y) =>
  input.onClick({ pointerType: 'touch', x, y, manager, rightButtonDown: () => false });

describe('the haptic tick is a receipt', () => {
  beforeEach(() => {
    hapticCalls.length = 0;
  });

  it('a tap that selects a unit ticks once, after the selection', () => {
    const ally = { name: 'Edric', faction: 'player', col: 2, row: 2 };
    const scene = makeBoardScene({ units: [ally] });
    const input = new InputController(scene);
    tapAt(input, 2 * 32 + 16, 2 * 32 + 16);
    expect(scene.selectedUnit).toBe(ally);
    expect(hapticCalls).toEqual([{ kind: 'tick', state: 'UNIT_SELECTED' }]);
  });

  it('a tap on an empty tile with nothing open gives no tick', () => {
    const scene = makeBoardScene();
    const input = new InputController(scene);
    tapAt(input, 4 * 32 + 16, 4 * 32 + 16);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(hapticCalls).toEqual([]);
  });

  it('a tap that closes the inspected foe ticks', () => {
    const scene = makeBoardScene();
    scene.inspectionPanel.visible = true;
    scene.inspectionPanel.hide = vi.fn(() => {
      scene.inspectionPanel.visible = false;
    });
    const input = new InputController(scene);
    tapAt(input, 4 * 32 + 16, 4 * 32 + 16);
    expect(hapticCalls.map((c) => c.kind)).toEqual(['tick']);
  });

  it('moving a chosen-center art to another legal tile ticks (same state, new lock)', () => {
    const scene = makeBoardScene({ battleState: 'SELECTING_AREA_CENTER' });
    const pending = { locked: { col: 1, row: 1 } };
    scene._areaTargetingController = { pending };
    scene._areaTargeting = () => ({
      lock: (gp) => {
        pending.locked = { col: gp.col, row: gp.row };
      },
    });
    const input = new InputController(scene);
    tapAt(input, 4 * 32 + 16, 4 * 32 + 16);
    expect(pending.locked).toEqual({ col: 4, row: 4 });
    expect(hapticCalls.map((c) => c.kind)).toEqual(['tick']);
  });

  it('a tap that only closes the end-turn confirm ticks', () => {
    const scene = makeBoardScene();
    scene._mobileBattleHud = {
      endTurnPending: { at: 1 },
      cancelEndTurn() {
        this.endTurnPending = null;
      },
    };
    tapAt(new InputController(scene), 4 * 32 + 16, 4 * 32 + 16);
    expect(hapticCalls.map((c) => c.kind)).toEqual(['tick']);
  });

  it('an inspect-mode tap on empty ground with nothing shown gives no tick', () => {
    const scene = makeBoardScene();
    scene.isMobileInput = true;
    scene.inspectMode = true;
    const input = new InputController(scene);
    input.clearInspectionVisuals = () => {};
    input.refreshTileInfo = () => {};
    tapAt(input, 4 * 32 + 16, 4 * 32 + 16);
    expect(hapticCalls).toEqual([]);
  });
});

describe('a tap just off a ready ally selects it at idle', () => {
  const ally = () => ({ name: 'Edric', faction: 'player', col: 2, row: 2 });
  // 2 CSS px right of the ally's right edge, in world px at zoom 1.
  const justRight = 3 * 32 + 2 * RATIO;
  const mid = 2 * 32 + 16;

  it('selects the ally the finger just missed', () => {
    const a = ally();
    const scene = makeBoardScene({ units: [a] });
    tapAt(new InputController(scene), justRight, mid);
    expect(scene.selectedUnit).toBe(a);
  });

  it('does not reach further than a few CSS pixels', () => {
    const scene = makeBoardScene({ units: [ally()] });
    tapAt(new InputController(scene), 3 * 32 + 8 * RATIO, mid);
    expect(scene.selectedUnit).toBeNull();
  });

  it('a zoomed-in board reaches the same few CSS pixels, so fewer world pixels', () => {
    // World coordinates fed straight in: the camera's screen-to-world map is not under test.
    const tapWorld = (scene, wx) => {
      const input = new InputController(scene);
      input._screenToWorld = (x, y) => ({ x, y });
      tapAt(input, wx, mid);
      return scene.selectedUnit;
    };
    // At zoom 2 one world px is 2 game px: 4 CSS px past the edge is 4 * RATIO / 2 world px.
    expect(
      tapWorld(makeBoardScene({ units: [ally()], zoom: 2 }), 3 * 32 + (4 * RATIO) / 2),
    ).not.toBeNull();
    // 4 * RATIO world px at zoom 2 is 8 CSS px on screen: out of reach.
    expect(tapWorld(makeBoardScene({ units: [ally()], zoom: 2 }), 3 * 32 + 4 * RATIO)).toBeNull();
  });

  it('never snaps when a seen foe is also in reach (ambiguous)', () => {
    const foe = { name: 'Brigand', faction: 'enemy', col: 3, row: 1 };
    const scene = makeBoardScene({ units: [ally(), foe] });
    // The top-left corner of (3,2): next to the ally on the left and the foe above.
    tapAt(new InputController(scene), 3 * 32 + 1, 2 * 32 + 1);
    expect(scene.selectedUnit).toBeNull();
  });

  it('a foe the fog hides does not block it (and so is never revealed by it)', () => {
    const foe = { name: 'Brigand', faction: 'enemy', col: 3, row: 1 };
    const a = ally();
    const scene = makeBoardScene({ units: [a, foe], fog: true });
    tapAt(new InputController(scene), 3 * 32 + 1, 2 * 32 + 1);
    expect(scene.selectedUnit).toBe(a);
  });

  it('never snaps a move destination: with a unit selected the exact tile is read', () => {
    const a = ally();
    const scene = makeBoardScene({ units: [a], battleState: 'UNIT_SELECTED' });
    scene.selectedUnit = { name: 'Sera', faction: 'player', col: 0, row: 0 };
    const input = new InputController(scene);
    const seen = [];
    input.handleSelectedClick = (gp) => seen.push(gp);
    tapAt(input, justRight, mid);
    expect(seen).toEqual([{ col: 3, row: 2 }]);
  });

  it('an acted ally is not snapped to', () => {
    const a = { ...ally(), hasActed: true };
    const scene = makeBoardScene({ units: [a] });
    tapAt(new InputController(scene), justRight, mid);
    expect(scene.selectedUnit).toBeNull();
  });
});

describe('snapTapToUnitCell (pure)', () => {
  const base = { offsetX: 0, offsetY: 0, tileSize: 32, displayCols: 5, displayRows: 5 };
  const cells = (map) => (dc, dr) => map[`${dc},${dr}`] ?? null;

  it('snaps to the one target within the margin, by its nearest edge or corner', () => {
    const cellAt = cells({ '1,1': 'target' });
    // Inside (2,2), 3 px right and 3 px down of (1,1)'s corner: diagonal distance ~4.2.
    expect(snapTapToUnitCell({ ...base, px: 67, py: 67, margin: 5, cellAt })).toEqual({
      dc: 1,
      dr: 1,
    });
    expect(snapTapToUnitCell({ ...base, px: 67, py: 67, margin: 4, cellAt })).toBeNull();
  });

  it('never moves a tap that landed on a unit, or with two units in reach', () => {
    expect(
      snapTapToUnitCell({
        ...base,
        px: 33,
        py: 40,
        margin: 5,
        cellAt: cells({ '1,1': 'other', '0,1': 'target' }),
      }),
    ).toBeNull();
    expect(
      snapTapToUnitCell({
        ...base,
        px: 33,
        py: 33,
        margin: 5,
        cellAt: cells({ '0,1': 'target', '1,0': 'target' }),
      }),
    ).toBeNull();
  });
});
