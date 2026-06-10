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

    // Phaser zooms around the camera center: at zoom 3 the visible left/top edge is
    // scroll + (size/2)(1 - 1/3). Clamping must operate on the visible edges.
    // X: visible left = -50 + 213.33 = 163.33 > max 106.67 → scrollX = 106.67 - 213.33
    // Y: visible top = 500 + 160 = 660 > max 80 → scrollY = 80 - 160
    expect(camera.scrollX).toBeCloseTo(106.666 - 213.333, 1);
    expect(camera.scrollY).toBeCloseTo(-80, 5);
  });

  it('maps screen to world around the camera center (Phaser camera model)', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera);
    camera.zoom = 2;
    camera.scrollX = 100;
    camera.scrollY = 50;

    // Phaser: worldX = scrollX + width/2 + (screenX - width/2) / zoom
    const center = controller.screenToWorld(320, 240);
    expect(center.x).toBeCloseTo(420);
    expect(center.y).toBeCloseTo(290);

    const topLeft = controller.screenToWorld(0, 0);
    expect(topLeft.x).toBeCloseTo(420 - 160);
    expect(topLeft.y).toBeCloseTo(290 - 120);

    const roundTrip = controller.worldToScreen(topLeft.x, topLeft.y);
    expect(roundTrip.x).toBeCloseTo(0);
    expect(roundTrip.y).toBeCloseTo(0);
  });

  it('pinch keeps the world point under the finger midpoint (no drift toward bottom-right)', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera, {
      // Oversized bounds so clamping cannot mask anchor drift
      getBounds: () => ({ left: -2000, top: -2000, width: 5000, height: 5000 }),
    });
    const manager = { pointers: [] };
    const p1 = createTouchPointer(1, 280, 200, manager, true);
    const p2 = createTouchPointer(2, 360, 280, manager, true);

    manager.pointers = [p1, p2];
    controller.handlePointerDown(p1, true);
    controller.handlePointerDown(p2, true);

    // Midpoint (320, 240) at zoom 1, scroll (0, 0) → world anchor (320, 240)
    // Spread fingers to double the distance → zoom 2, same midpoint
    p1.x = 240;
    p1.y = 160;
    p2.x = 400;
    p2.y = 320;
    const movedFirst = controller.handlePointerMove(p1, true);
    expect(movedFirst.consumed).toBe(true);
    const movedSecond = controller.handlePointerMove(p2, true);
    expect(movedSecond.consumed).toBe(true);
    expect(camera.zoom).toBeCloseTo(2);

    const anchorOnScreen = controller.worldToScreen(320, 240);
    expect(anchorOnScreen.x).toBeCloseTo(320);
    expect(anchorOnScreen.y).toBeCloseTo(240);
  });

  it('clamping at zoom keeps the visible window inside map bounds on every edge', () => {
    const camera = createCamera();
    const controller = new BattleCameraController(camera, {
      getBounds: () => ({ left: 0, top: 0, width: 960, height: 720 }),
    });
    camera.zoom = 2;

    camera.setScroll(10000, 10000);
    controller.clampToBounds();
    const bottomRight = controller.screenToWorld(640, 480);
    expect(bottomRight.x).toBeCloseTo(960);
    expect(bottomRight.y).toBeCloseTo(720);

    camera.setScroll(-10000, -10000);
    controller.clampToBounds();
    const topLeft = controller.screenToWorld(0, 0);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
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
