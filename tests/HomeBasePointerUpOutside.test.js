// HomeBasePointerUpOutside.test.js -- Verify that pointerupoutside does NOT
// trigger requestCancel, matching the NodeMapScene fix from 97fd198.

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

describe('HomeBaseScene.onPointerUpOutside', () => {
  it('resets touch state without calling requestCancel', () => {
    const scene = Object.create(HomeBaseScene.prototype);
    scene._touchScrollDrag = { startY: 100, scrollY: 50 };
    scene._touchTapDown = { x: 200, y: 300 };
    scene.requestCancel = vi.fn();

    scene.onPointerUpOutside({});

    expect(scene._touchScrollDrag).toBeNull();
    expect(scene._touchTapDown).toBeNull();
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });

  it('pointerupoutside event is wired to onPointerUpOutside, not onPointerUp', () => {
    // Capture the handler registered for 'pointerupoutside' during create()
    const bindings = {};
    const inputOn = vi.fn((event, handler) => {
      bindings[event] = handler;
    });

    const scene = Object.create(HomeBaseScene.prototype);
    scene.input = { on: inputOn, keyboard: { on: vi.fn() } };
    scene.events = { once: vi.fn() };
    scene.registry = { get: () => null };
    scene.drawUI = vi.fn();

    // Spy on both methods before create wires the arrow functions
    scene.onPointerUp = vi.fn();
    scene.onPointerUpOutside = vi.fn();

    HomeBaseScene.prototype.create.call(scene);

    // Fire the captured pointerupoutside handler
    const handler = bindings['pointerupoutside'];
    expect(handler).toBeDefined();
    handler({ x: -10, y: -10 });

    expect(scene.onPointerUpOutside).toHaveBeenCalled();
    expect(scene.onPointerUp).not.toHaveBeenCalled();
  });
});
