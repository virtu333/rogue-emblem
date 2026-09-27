// A touch release is a tap only when the battle saw its press. Releases without one
// arrive after a scene restart (or an orientation re-open) under a held finger, or after
// a press made while story input was locked (dialogue, a ceremony, turn start). Their
// lift position names whatever tile is there now, so they must never select, move or
// cancel. Mouse clicks and fresh taps work.
import { describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/ui/InputController.js';
import { BattleCameraController } from '../src/utils/BattleCameraController.js';

function touch(id, x, y, type = 'touchstart') {
  return { id, x, y, pointerType: 'touch', isDown: type === 'touchstart', event: { type } };
}
const lift = (id, x, y) => touch(id, x, y, 'touchend');
const mouse = (x, y) => ({ id: 0, x, y, pointerType: 'mouse', rightButtonDown: () => false });

function makeScene(overrides = {}) {
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
    _storyLocked: false,
    isStoryInputLocked() {
      return this._storyLocked;
    },
    isCameraGestureAllowed: () => true,
    _tapMoveThreshold: 12,
    _syncMobileResetViewButton: vi.fn(),
    time: { delayedCall: () => ({ remove() {} }) },
    battleState: 'PLAYER_IDLE',
    ...overrides,
  };
  scene._battleCamera = new BattleCameraController(camera, { minZoom: 0.5, maxZoom: 3 });
  const input = new InputController(scene);
  input.onClick = vi.fn();
  return { scene, input };
}

describe('a touch release with no recorded press', () => {
  it('never clicks: a finger held through a scene restart lifts on the new battle', () => {
    const { scene, input } = makeScene();
    input.onPointerDown(touch(1, 100, 200));
    // BattleScene.beginBattle clears the press record for the re-opened battle.
    scene._touchTapDown = null;
    input.onPointerUp(lift(1, 100, 200));
    expect(input.onClick).not.toHaveBeenCalled();
  });

  it('never clicks: the press came while story input was locked', () => {
    const { scene, input } = makeScene();
    scene._storyLocked = true;
    input.onPointerDown(touch(1, 100, 200));
    scene._storyLocked = false; // the dialogue closed before the finger lifted
    input.onPointerUp(lift(1, 100, 200));
    expect(input.onClick).not.toHaveBeenCalled();
  });

  it('never clicks: a lift the battle never saw go down (a fresh controller)', () => {
    const { input } = makeScene();
    input.onPointerUp(lift(4, 30, 40));
    expect(input.onClick).not.toHaveBeenCalled();
  });

  it('does not eat the next real tap', () => {
    const { scene, input } = makeScene();
    scene._storyLocked = true;
    input.onPointerDown(touch(1, 100, 200));
    scene._storyLocked = false;
    input.onPointerUp(lift(1, 100, 200));
    input.onPointerDown(touch(2, 50, 60));
    input.onPointerUp(lift(2, 51, 61));
    expect(input.onClick).toHaveBeenCalledTimes(1);
    // A tap resolves at its press position.
    expect(input.onClick.mock.calls[0][1]).toEqual({ x: 50, y: 60 });
  });
});

describe('legitimate input keeps working', () => {
  it('a touch tap with its press clicks once', () => {
    const { input } = makeScene();
    input.onPointerDown(touch(1, 80, 90));
    input.onPointerUp(lift(1, 82, 91));
    expect(input.onClick).toHaveBeenCalledTimes(1);
    expect(input.onClick.mock.calls[0][1]).toEqual({ x: 80, y: 90 });
  });

  it('a desktop mouse click clicks at the pointer', () => {
    const { input } = makeScene();
    input.onPointerDown(mouse(10, 20));
    input.onPointerUp(mouse(10, 20));
    expect(input.onClick).toHaveBeenCalledTimes(1);
    expect(input.onClick.mock.calls[0][1]).toBeNull();
  });

  it('a mouse release is unchanged by the touch guard (no press record needed)', () => {
    const { input } = makeScene();
    input.onPointerUp(mouse(10, 20));
    expect(input.onClick).toHaveBeenCalledTimes(1);
  });

  it('a touch drag past the tap threshold is still not a tap', () => {
    const { input } = makeScene();
    input.onPointerDown(touch(1, 80, 90));
    input.onPointerUp(lift(1, 140, 90));
    expect(input.onClick).not.toHaveBeenCalled();
  });
});
