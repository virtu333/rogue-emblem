import { describe, it, expect, vi, beforeEach } from 'vitest';

// Scenes import Phaser at module load; we only need a base class to extend.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// BlessingSelectScene.create() builds a RunManager; stub it so create() is cheap.
vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return {
    ...actual,
    RunManager: class {
      startRun() {}
      getBlessingOptions() {
        return [{ id: 'a' }, { id: 'b' }];
      }
    },
  };
});

import { DifficultySelectScene } from '../src/scenes/DifficultySelectScene.js';
import { BlessingSelectScene } from '../src/scenes/BlessingSelectScene.js';
import { InputAction } from '../src/utils/InputActions.js';
import {
  dispatchInputAction,
  activeInputOwner,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

function createKeyboard() {
  return { on: vi.fn(), off: vi.fn() };
}

describe('DifficultySelectScene gamepad routing', () => {
  function fakeScene() {
    return {
      _navigate: vi.fn(),
      _confirm: vi.fn(),
      _back: vi.fn(),
      _toggleMetaMode: vi.fn(),
    };
  }

  it('routes NAVIGATE.dx into _navigate (horizontal cards)', () => {
    const s = fakeScene();
    DifficultySelectScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(s._navigate).toHaveBeenCalledWith(1);
    DifficultySelectScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: -1 });
    expect(s._navigate).toHaveBeenCalledWith(-1);
  });

  it('ignores NAVIGATE with no horizontal component', () => {
    const s = fakeScene();
    DifficultySelectScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: 0, dy: 1 });
    expect(s._navigate).not.toHaveBeenCalled();
  });

  it('routes CONFIRM/CANCEL/DANGER into _confirm/_back/_toggleMetaMode', () => {
    const s = fakeScene();
    DifficultySelectScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    DifficultySelectScene.prototype._onInputAction.call(s, InputAction.CANCEL);
    DifficultySelectScene.prototype._onInputAction.call(s, InputAction.DANGER);
    expect(s._confirm).toHaveBeenCalledTimes(1);
    expect(s._back).toHaveBeenCalledTimes(1);
    expect(s._toggleMetaMode).toHaveBeenCalledTimes(1);
  });
});

describe('BlessingSelectScene gamepad routing', () => {
  function fakeScene() {
    return { _navigate: vi.fn(), _confirm: vi.fn(), _back: vi.fn() };
  }

  it('routes NAVIGATE.dy into _navigate (vertical list)', () => {
    const s = fakeScene();
    BlessingSelectScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dy: 1, dx: 0 });
    expect(s._navigate).toHaveBeenCalledWith(1);
  });

  it('ignores NAVIGATE with no vertical component', () => {
    const s = fakeScene();
    BlessingSelectScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(s._navigate).not.toHaveBeenCalled();
  });

  it('routes CONFIRM/CANCEL into _confirm/_back', () => {
    const s = fakeScene();
    BlessingSelectScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    BlessingSelectScene.prototype._onInputAction.call(s, InputAction.CANCEL);
    expect(s._confirm).toHaveBeenCalledTimes(1);
    expect(s._back).toHaveBeenCalledTimes(1);
  });
});

describe('select scenes register/release an input-focus scope across create/shutdown', () => {
  beforeEach(() => _resetInputFocus());

  it('DifficultySelect: dispatched actions reach routing while focused, stop after shutdown', () => {
    const keyboard = createKeyboard();
    let shutdownHandler = null;
    const scene = {
      registry: { get: vi.fn((k) => (k === 'meta' ? { hasMilestone: () => false } : null)) },
      events: {
        once: vi.fn((name, h) => {
          if (name === 'shutdown') shutdownHandler = h;
        }),
      },
      input: { keyboard, on: vi.fn(), off: vi.fn() },
      gameData: { difficulty: { modes: { normal: {} } } },
      _draw: vi.fn(),
      _navigate: vi.fn(),
      _confirm: vi.fn(),
      _back: vi.fn(),
      _toggleMetaMode: vi.fn(),
      _buildModes: vi.fn(() => [{ id: 'normal', locked: false }]),
      // real routing method so dispatch exercises the true switch
      _onInputAction: DifficultySelectScene.prototype._onInputAction,
    };

    DifficultySelectScene.prototype.create.call(scene);
    expect(activeInputOwner()).toBe(scene); // create() claimed focus

    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    expect(scene._navigate).toHaveBeenCalledWith(1);

    shutdownHandler();
    expect(activeInputOwner()).toBeNull(); // shutdown released focus
    dispatchInputAction(InputAction.CONFIRM);
    expect(scene._confirm).not.toHaveBeenCalled(); // dead scene no longer routed
  });
});
