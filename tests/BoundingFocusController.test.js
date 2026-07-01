import { describe, it, expect, vi } from 'vitest';
import { BoundingFocusController } from '../src/ui/BoundingFocusController.js';

function makeRing() {
  return {
    scene: {},
    setStrokeStyle() {
      return this;
    },
    setDepth() {
      return this;
    },
    setPosition: vi.fn(function () {
      return this;
    }),
    setSize: vi.fn(function () {
      return this;
    }),
    setVisible: vi.fn(function () {
      return this;
    }),
    destroy: vi.fn(function () {
      this.scene = null;
    }),
  };
}

function makeScene() {
  const ring = makeRing();
  return { _ring: ring, add: { rectangle: vi.fn(() => ring) } };
}

function makeObj(id, y) {
  return {
    id,
    y,
    x: 0,
    emit: vi.fn(),
    getBounds: () => ({ centerX: 5, centerY: y, width: 20, height: 10 }),
  };
}

describe('BoundingFocusController', () => {
  it('focuses the first object and draws a ring around it', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    const objs = [makeObj('a', 10), makeObj('b', 20)];
    c.setObjects(objs);
    expect(c.current().id).toBe('a');
    expect(scene.add.rectangle).toHaveBeenCalledTimes(1);
  });

  it('move steps and wraps; the ring repositions (not recreated)', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10), makeObj('b', 20), makeObj('c', 30)]);
    c.move(1);
    expect(c.current().id).toBe('b');
    expect(scene._ring.setPosition).toHaveBeenCalled();
    c.move(1);
    c.move(1); // wrap c -> a
    expect(c.current().id).toBe('a');
    expect(scene.add.rectangle).toHaveBeenCalledTimes(1); // single ring reused
  });

  it('activate re-emits the focused object pointerdown', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    const objs = [makeObj('a', 10), makeObj('b', 20)];
    c.setObjects(objs);
    c.move(1);
    expect(c.activate()).toBe(true);
    expect(objs[1].emit).toHaveBeenCalledWith('pointerdown', { button: 0 });
    expect(objs[0].emit).not.toHaveBeenCalled();
  });

  it('keeps the index in range when the object set shrinks', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10), makeObj('b', 20), makeObj('c', 30)]);
    c.move(1);
    c.move(1); // index 2
    c.setObjects([makeObj('a', 10)]); // shrink
    expect(c.current().id).toBe('a');
  });

  it('recreates the ring after a redraw destroyed it', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10)]);
    expect(scene.add.rectangle).toHaveBeenCalledTimes(1);
    scene._ring.scene = null; // simulate children.removeAll destroying the ring
    const freshRing = makeRing();
    scene.add.rectangle.mockReturnValueOnce(freshRing);
    c.setObjects([makeObj('a', 10), makeObj('b', 20)]);
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2); // a fresh ring was made
    expect(c.ring).toBe(freshRing); // ...and adopted (not the stale wiped one)
  });

  it('setRingVisible(false) hides the ring but keeps the object list', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10), makeObj('b', 20)]);
    c.setRingVisible(false);
    expect(scene._ring.setVisible).toHaveBeenCalledWith(false);
    expect(c.objects.length).toBe(2); // list retained, unlike clear()
    expect(c.current().id).toBe('a');
  });

  it('setRingVisible(true) re-renders at the current focus (restore after cover)', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10), makeObj('b', 20)]);
    c.move(1); // focus 'b'
    c.setRingVisible(false);
    scene._ring.setPosition.mockClear();
    c.setRingVisible(true);
    // _render repositions the existing ring at the focused object's bounds.
    expect(scene._ring.setPosition).toHaveBeenCalledWith(5, 20);
    expect(scene._ring.setVisible).toHaveBeenLastCalledWith(true);
  });

  it('setRingVisible(true) recreates a ring that a redraw wiped while covered', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10)]);
    c.setRingVisible(false);
    scene._ring.scene = null; // redraw wiped the ring while hidden
    const freshRing = makeRing();
    scene.add.rectangle.mockReturnValueOnce(freshRing);
    c.setRingVisible(true);
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2);
    expect(c.ring).toBe(freshRing);
  });

  it('is inert and hides the ring with no objects', () => {
    const scene = makeScene();
    const c = new BoundingFocusController(scene);
    c.setObjects([makeObj('a', 10)]);
    c.clear();
    expect(c.isActive).toBe(false);
    expect(scene._ring.setVisible).toHaveBeenCalledWith(false);
    expect(c.activate()).toBe(false);
  });
});
