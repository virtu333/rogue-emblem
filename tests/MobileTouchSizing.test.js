import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mobileTarget, deferTouchActivation } from '../src/ui/mobileTouchSizing.js';
describe('mobile canvas controls', () => {
  it('keeps a 44px target after canvas scaling', () => {
    const scene = {
      registry: { get: () => ({ isMobile: true }) },
      game: { canvas: { getBoundingClientRect: () => ({ height: 320 }) } },
      scale: { height: 480 },
    };
    expect(mobileTarget(scene)).toBe(66);
    scene.registry.get = () => ({ isMobile: false });
    expect(mobileTarget(scene, 24)).toBe(24);
  });
  it('does not execute purchases or sales on a drag, exit or repeated release', () => {
    const target = new EventEmitter();
    target.input = { enabled: true };
    const command = vi.fn();
    target.on('pointerdown', command);
    deferTouchActivation(target);
    deferTouchActivation(target);
    const touch = (x, y) => ({ x, y, wasTouch: true, button: 0 });
    target.emit('pointerdown', touch(10, 10));
    expect(command).not.toHaveBeenCalled();
    target.emit('pointerup', touch(10, 70));
    expect(command).not.toHaveBeenCalled();
    target.emit('pointerdown', touch(10, 10));
    target.emit('pointerout');
    target.emit('pointerup', touch(10, 10));
    expect(command).not.toHaveBeenCalled();
    target.emit('pointerdown', touch(10, 10));
    target.emit('pointerup', touch(12, 12));
    target.emit('pointerup', touch(12, 12));
    expect(command).toHaveBeenCalledTimes(1);
    target.emit('pointerdown', { button: 0 });
    expect(command).toHaveBeenCalledTimes(2);
  });
});
