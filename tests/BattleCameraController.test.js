import { describe, it, expect } from 'vitest';
import { BattleCameraController } from '../src/utils/BattleCameraController.js';

function createCamera() {
  return {
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    setZoom(value) {
      this.zoom = value;
      return this;
    },
    setScroll(x, y) {
      this.scrollX = x;
      this.scrollY = y;
      return this;
    },
  };
}

function createTouchPointer(id, x, y, manager, isDown = true) {
  return {
    id,
    x,
    y,
    isDown,
    pointerType: 'touch',
    manager,
  };
}

describe('BattleCameraController touch cleanup', () => {
  it('prunes stale touch ids before handling a new touch', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera);
    const manager = { pointers: [] };

    const stale = createTouchPointer(1, 100, 100, manager, true);
    manager.pointers = [stale];
    const first = controller.handlePointerDown(stale, true);
    expect(first.consumed).toBe(false);
    expect(controller.hasActiveTouches()).toBe(true);

    const next = createTouchPointer(2, 140, 100, manager, true);
    manager.pointers = [next];
    const second = controller.handlePointerDown(next, true);
    expect(second.consumed).toBe(false);

    const up = controller.handlePointerUp(next);
    expect(up.consumed).toBe(false);
    expect(controller.hasActiveTouches()).toBe(false);
  });

  it('clearTouches resets active gesture state', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera);
    const manager = { pointers: [] };
    const p1 = createTouchPointer(1, 100, 100, manager, true);
    const p2 = createTouchPointer(2, 140, 100, manager, true);

    manager.pointers = [p1, p2];
    controller.handlePointerDown(p1, true);
    const started = controller.handlePointerDown(p2, true);
    expect(started.consumed).toBe(true);
    expect(started.beganGesture).toBe(true);

    controller.clearTouches();
    expect(controller.hasActiveTouches()).toBe(false);

    const afterClear = controller.handlePointerUp(p1);
    expect(afterClear.consumed).toBe(false);
    expect(afterClear.endedGesture).toBe(false);
  });
});
