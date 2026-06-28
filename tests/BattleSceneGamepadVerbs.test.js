import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { InputAction } from '../src/utils/InputActions.js';

// Plain unit fixture: no _conditions array, so isSleeping() returns false.
const unit = (col, row, extra = {}) => ({ col, row, currentHP: 10, hasActed: false, ...extra });

function cycleScene(overrides = {}) {
  return {
    isStoryInputLocked: () => false,
    battleState: 'PLAYER_IDLE',
    _gridCursor: { cursorCol: 0, cursorRow: 0, snapTo: vi.fn() },
    playerUnits: [],
    ...overrides,
  };
}

const cycle = (scene, dir) => BattleScene.prototype._cycleCursorToUnit.call(scene, dir);

describe('BattleScene _cycleCursorToUnit', () => {
  it('NEXT from an off-unit cursor snaps to the first un-acted unit (reading order)', () => {
    const scene = cycleScene({
      playerUnits: [unit(5, 2), unit(1, 0), unit(3, 1)],
    });
    cycle(scene, 1);
    // Sorted by row,col -> (1,0) is first.
    expect(scene._gridCursor.snapTo).toHaveBeenCalledWith(1, 0);
  });

  it('PREV from an off-unit cursor wraps to the last un-acted unit', () => {
    const scene = cycleScene({
      playerUnits: [unit(5, 2), unit(1, 0), unit(3, 1)],
    });
    cycle(scene, -1);
    expect(scene._gridCursor.snapTo).toHaveBeenCalledWith(5, 2);
  });

  it('steps relative to the unit currently under the cursor', () => {
    const scene = cycleScene({
      _gridCursor: { cursorCol: 1, cursorRow: 0, snapTo: vi.fn() }, // on (1,0) = index 0
      playerUnits: [unit(1, 0), unit(3, 1), unit(5, 2)],
    });
    cycle(scene, 1); // -> index 1 = (3,1)
    expect(scene._gridCursor.snapTo).toHaveBeenCalledWith(3, 1);
  });

  it('skips dead and already-acted units', () => {
    const scene = cycleScene({
      playerUnits: [unit(1, 0, { currentHP: 0 }), unit(3, 1, { hasActed: true }), unit(5, 2)],
    });
    cycle(scene, 1);
    expect(scene._gridCursor.snapTo).toHaveBeenCalledWith(5, 2);
  });

  it('does nothing when no units can act', () => {
    const scene = cycleScene({ playerUnits: [unit(1, 0, { hasActed: true })] });
    cycle(scene, 1);
    expect(scene._gridCursor.snapTo).not.toHaveBeenCalled();
  });

  it('is inert outside PLAYER_IDLE', () => {
    const scene = cycleScene({ battleState: 'UNIT_SELECTED', playerUnits: [unit(1, 0)] });
    cycle(scene, 1);
    expect(scene._gridCursor.snapTo).not.toHaveBeenCalled();
  });
});

function inspectScene(overrides = {}) {
  return {
    isStoryInputLocked: () => false,
    battleState: 'PLAYER_IDLE',
    _gridCursor: { cursorCol: 2, cursorRow: 3 },
    _inputController: { _ballistaRangeShown: false },
    inspectionPanel: { visible: false },
    grid: { gridToPixel: vi.fn(() => ({ x: 80, y: 96 })) },
    clearInspectionVisuals: vi.fn(),
    _showInspectionAtPixel: vi.fn(),
    ...overrides,
  };
}

const inspect = (scene) => BattleScene.prototype._inspectAtCursor.call(scene);

describe('BattleScene _inspectAtCursor', () => {
  it('shows the inspection panel at the cursor tile when nothing is shown', () => {
    const scene = inspectScene();
    inspect(scene);
    expect(scene.grid.gridToPixel).toHaveBeenCalledWith(2, 3);
    expect(scene._showInspectionAtPixel).toHaveBeenCalledWith(80, 96);
    expect(scene.clearInspectionVisuals).not.toHaveBeenCalled();
  });

  it('toggles off when the inspection panel is already visible', () => {
    const scene = inspectScene({ inspectionPanel: { visible: true } });
    inspect(scene);
    expect(scene.clearInspectionVisuals).toHaveBeenCalledTimes(1);
    expect(scene._showInspectionAtPixel).not.toHaveBeenCalled();
  });

  it('toggles off when ballista range is showing', () => {
    const scene = inspectScene({ _inputController: { _ballistaRangeShown: true } });
    inspect(scene);
    expect(scene.clearInspectionVisuals).toHaveBeenCalledTimes(1);
    expect(scene._showInspectionAtPixel).not.toHaveBeenCalled();
  });

  it('is inert during BATTLE_END', () => {
    const scene = inspectScene({ battleState: 'BATTLE_END' });
    inspect(scene);
    expect(scene._showInspectionAtPixel).not.toHaveBeenCalled();
    expect(scene.clearInspectionVisuals).not.toHaveBeenCalled();
  });
});

describe('BattleScene _onInputAction routes the global verbs', () => {
  function routeScene() {
    return {
      isStoryInputLocked: () => false,
      battleState: 'PLAYER_IDLE',
      _cycleCursorToUnit: vi.fn(),
      _inspectAtCursor: vi.fn(),
      _gridCursor: { move: vi.fn(), confirm: vi.fn() },
      _menuFocus: { move: vi.fn(), activate: vi.fn() },
    };
  }
  const route = (scene, action, payload) =>
    BattleScene.prototype._onInputAction.call(scene, action, payload);

  it('PREV_UNIT / NEXT_UNIT delegate to _cycleCursorToUnit with direction', () => {
    const scene = routeScene();
    route(scene, InputAction.PREV_UNIT);
    expect(scene._cycleCursorToUnit).toHaveBeenCalledWith(-1);
    route(scene, InputAction.NEXT_UNIT);
    expect(scene._cycleCursorToUnit).toHaveBeenCalledWith(1);
  });

  it('INSPECT delegates to _inspectAtCursor', () => {
    const scene = routeScene();
    route(scene, InputAction.INSPECT);
    expect(scene._inspectAtCursor).toHaveBeenCalledTimes(1);
  });
});
