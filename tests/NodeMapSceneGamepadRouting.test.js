import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { InputAction } from '../src/utils/InputActions.js';

function makeScene(overrides = {}) {
  const s = new NodeMapScene();
  return Object.assign(s, {
    isSceneReady: true,
    isTransitioning: false,
    battleLaunchInFlight: false,
    _nodeCursor: { move: vi.fn(), confirm: vi.fn() },
    requestCancel: vi.fn(),
    _openRoster: vi.fn(),
    ...overrides,
  });
}

describe('NodeMapScene gamepad routing', () => {
  it('NAVIGATE drives the node cursor; CONFIRM confirms; Y opens roster', () => {
    const s = makeScene();
    s._onInputAction(InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(s._nodeCursor.move).toHaveBeenCalledWith(1, 0);
    s._onInputAction(InputAction.CONFIRM);
    expect(s._nodeCursor.confirm).toHaveBeenCalledTimes(1);
    s._onInputAction(InputAction.ROSTER);
    expect(s._openRoster).toHaveBeenCalledTimes(1);
  });

  it('CANCEL and PAUSE both cascade through requestCancel', () => {
    const s = makeScene();
    s._onInputAction(InputAction.CANCEL);
    s._onInputAction(InputAction.PAUSE);
    expect(s.requestCancel).toHaveBeenCalledTimes(2);
  });

  it('ignores cursor input until the scene is ready', () => {
    const s = makeScene({ isSceneReady: false });
    s._onInputAction(InputAction.NAVIGATE, { dx: 1 });
    s._onInputAction(InputAction.CONFIRM);
    expect(s._nodeCursor.move).not.toHaveBeenCalled();
    expect(s._nodeCursor.confirm).not.toHaveBeenCalled();
  });

  it('ignores cursor input while an overlay is open, but CANCEL still closes it', () => {
    const s = makeScene({ shopOverlay: {} });
    s._onInputAction(InputAction.NAVIGATE, { dx: 1 });
    s._onInputAction(InputAction.CONFIRM);
    expect(s._nodeCursor.move).not.toHaveBeenCalled();
    expect(s._nodeCursor.confirm).not.toHaveBeenCalled();
    s._onInputAction(InputAction.CANCEL);
    expect(s.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores cursor input mid-transition / battle launch', () => {
    const s = makeScene({ isTransitioning: true });
    s._onInputAction(InputAction.CONFIRM);
    expect(s._nodeCursor.confirm).not.toHaveBeenCalled();
  });
});
