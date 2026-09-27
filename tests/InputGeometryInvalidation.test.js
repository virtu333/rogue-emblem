// A press that began before the battle panel's geometry changed (the phone turned, the
// rail or browser bars resized) must not complete as a tap on whatever tile now sits
// under its old screen position. The release can arrive without a pointercancel.
import { describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/ui/InputController.js';
import { BattleCameraController } from '../src/utils/BattleCameraController.js';

function touch(id, x, y) {
  return {
    id,
    x,
    y,
    pointerType: 'touch',
    isDown: true,
    wasTouch: true,
    event: { type: 'touchstart' },
  };
}

function makeScene() {
  const camera = {
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    width: 640,
    height: 960,
    setZoom(z) {
      this.zoom = z;
    },
    setScroll(x, y) {
      this.scrollX = x;
      this.scrollY = y;
    },
  };
  const scene = {
    _isTouchPointer: (p) => p?.pointerType === 'touch',
    isStoryInputLocked: () => false,
    isCameraGestureAllowed: () => true,
    _tapMoveThreshold: 12,
    _syncMobileResetViewButton: vi.fn(),
    time: { delayedCall: () => ({ remove() {} }) },
    battleState: 'PLAYER_IDLE',
  };
  scene._battleCamera = new BattleCameraController(camera, { minZoom: 0.5, maxZoom: 3 });
  const input = new InputController(scene);
  input.onClick = vi.fn();
  return { scene, input };
}

describe('geometry change under a live press', () => {
  it('swallows the release of a press made before the change', () => {
    const { scene, input } = makeScene();
    input.onPointerDown(touch(1, 100, 200));
    expect(scene._touchTapDown).not.toBeNull();
    input.invalidatePointerGestures();
    expect(scene._touchTapDown).toBeNull();
    expect(scene._touchHoldStart).toBeNull();
    input.onPointerUp({ ...touch(1, 100, 200), isDown: false, event: { type: 'touchend' } });
    expect(input.onClick).not.toHaveBeenCalled();
  });

  it('swallows a mouse release too (no saved press position to fall back on)', () => {
    const { input } = makeScene();
    input.onPointerDown({
      id: 0,
      x: 10,
      y: 10,
      pointerType: 'mouse',
      rightButtonDown: () => false,
    });
    input.invalidatePointerGestures();
    input.onPointerUp({ id: 0, x: 10, y: 10, pointerType: 'mouse', rightButtonDown: () => false });
    expect(input.onClick).not.toHaveBeenCalled();
  });

  it('lets the next fresh tap through', () => {
    const { input } = makeScene();
    input.onPointerDown(touch(1, 100, 200));
    input.invalidatePointerGestures();
    input.onPointerUp({ ...touch(1, 100, 200), isDown: false, event: { type: 'touchend' } });
    input.onPointerDown(touch(2, 50, 60));
    input.onPointerUp({ ...touch(2, 50, 60), isDown: false, event: { type: 'touchend' } });
    expect(input.onClick).toHaveBeenCalledTimes(1);
    expect(input.onClick.mock.calls[0][1]).toEqual({ x: 50, y: 60 });
  });

  it('a change with no press down does not eat the next tap', () => {
    const { input } = makeScene();
    input.invalidatePointerGestures();
    input.onPointerDown(touch(3, 20, 30));
    input.onPointerUp({ ...touch(3, 20, 30), isDown: false, event: { type: 'touchend' } });
    expect(input.onClick).toHaveBeenCalledTimes(1);
  });

  it('drops a camera gesture in progress', () => {
    const { scene, input } = makeScene();
    scene._battleCamera._touches.set(1, { x: 0, y: 0 });
    scene._battleCamera._touches.set(2, { x: 50, y: 0 });
    input.invalidatePointerGestures();
    expect(scene._battleCamera.hasActiveTouches()).toBe(false);
    expect(scene._syncMobileResetViewButton).toHaveBeenCalled();
  });
});
