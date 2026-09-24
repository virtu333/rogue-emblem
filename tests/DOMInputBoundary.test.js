import { describe, it, expect, vi } from 'vitest';
import {
  isolateDOMInput,
  installDOMDragRelease,
  ignoreRepeatedActivation,
} from '../src/utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../src/utils/domUI.js';

describe('DOM input boundaries', () => {
  it('covers every event family without preventing native defaults, and detaches', () => {
    const root = new EventTarget();
    const cleanup = isolateDOMInput(root, { keyboard: true });
    for (const type of [...DOM_INPUT_EVENTS, 'keydown', 'keyup']) {
      const event = new Event(type, { cancelable: true });
      event.stopPropagation = vi.fn();
      root.dispatchEvent(event);
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(false);
    }
    cleanup();
    const event = new Event('touchstart');
    event.stopPropagation = vi.fn();
    root.dispatchEvent(event);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
  it('cancels only canvas-origin releases over DOM and cleans up at game destruction', () => {
    const listeners = new Map();
    const target = {
      addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
      removeEventListener: vi.fn(),
    };
    const canvas = {};
    const pointer = { isDown: true, downElement: canvas, reset: vi.fn() };
    const input = { emit: vi.fn() };
    const game = {
      canvas,
      input: { mousePointer: pointer },
      scene: { getScenes: () => [{ input }] },
      events: { once: vi.fn() },
    };
    const cleanup = installDOMDragRelease(game, target);
    const event = { target: {}, stopPropagation: vi.fn() };
    listeners.get('mouseup')(event);
    expect(pointer.reset).toHaveBeenCalledOnce();
    expect(input.emit).toHaveBeenCalledWith('pointerupoutside', pointer, []);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    pointer.reset.mockClear();
    listeners.get('mouseup')({ ...event, target: canvas });
    pointer.downElement = {};
    listeners.get('mouseup')(event);
    pointer.downElement = canvas;
    pointer.isDown = false;
    listeners.get('mouseup')(event);
    expect(pointer.reset).not.toHaveBeenCalled();
    expect(game.events.once).toHaveBeenCalledWith('destroy', cleanup);
    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      'mouseup',
      listeners.get('mouseup'),
      true,
    );
  });
});

it('ignores held commit/cancel keys without disabling arrow repeat or typing', () => {
  const event = { repeat: true, key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
  expect(ignoreRepeatedActivation(event)).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(ignoreRepeatedActivation({ ...event, repeat: false })).toBe(false);
  expect(ignoreRepeatedActivation({ ...event, key: 'ArrowDown' })).toBe(false);
  expect(ignoreRepeatedActivation({ ...event, key: ' ', target: { matches: () => true } })).toBe(
    false,
  );
  expect(
    ignoreRepeatedActivation({ ...event, key: 'Escape', target: { matches: () => true } }),
  ).toBe(true);
});
