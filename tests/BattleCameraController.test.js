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
    wasTouch: true,
    pointerType: 'touch',
    manager,
  };
}

describe('BattleCameraController touch cleanup', () => {
  it('accepts touch pointers flagged via wasTouch when pointerType is missing', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera);
    const manager = { pointers: [] };
    const p1 = { id: 1, x: 100, y: 100, isDown: true, wasTouch: true, manager };
    const p2 = { id: 2, x: 140, y: 100, isDown: true, wasTouch: true, manager };

    manager.pointers = [p1, p2];
    const first = controller.handlePointerDown(p1, true);
    const second = controller.handlePointerDown(p2, true);

    expect(first.consumed).toBe(false);
    expect(second.consumed).toBe(true);
    expect(second.beganGesture).toBe(true);
  });

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

describe('BattleCameraController clamp and pinch behavior', () => {
  it('centers small maps and clamps large-map scroll bounds', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera, {
      getBounds: () => ({ left: 0, top: 0, width: 320, height: 240 }),
    });

    controller.resetView();
    expect(camera.zoom).toBe(1);
    expect(camera.scrollX).toBe(-160);
    expect(camera.scrollY).toBe(-120);

    camera.zoom = 3;
    camera.scrollX = -50;
    camera.scrollY = 500;
    controller.clampToBounds();

    expect(camera.scrollX).toBe(0);
    expect(camera.scrollY).toBe(80);
  });

  it('supports pinch-out reset back to default zoom/scroll', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera, {
      getBounds: () => ({ left: 0, top: 0, width: 1280, height: 960 }),
      resetPinchScaleThreshold: 0.95,
    });
    const manager = { pointers: [] };
    const p1 = createTouchPointer(1, 100, 100, manager, true);
    const p2 = createTouchPointer(2, 200, 100, manager, true);

    manager.pointers = [p1, p2];
    controller.handlePointerDown(p1, true);
    const started = controller.handlePointerDown(p2, true);
    expect(started.beganGesture).toBe(true);

    p1.x = 120;
    p2.x = 180;
    const moved = controller.handlePointerMove(p1, true);
    expect(moved.consumed).toBe(true);

    const ended = controller.handlePointerUp(p1);
    expect(ended.endedGesture).toBe(true);
    expect(camera.zoom).toBe(1);
    expect(camera.scrollX).toBe(0);
    expect(camera.scrollY).toBe(0);
  });
});
