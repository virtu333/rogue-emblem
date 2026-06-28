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
    const scene2Ring = makeRing();
    scene.add.rectangle.mockReturnvalueOnce?.(scene2Ring);
    c.setObjects([makeObj('a', 10), makeObj('b', 20)]);
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2); // a fresh ring was made
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
