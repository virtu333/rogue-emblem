import { describe, it, expect } from 'vitest';
import { GridCursorController } from '../src/ui/GridCursorController.js';

// Minimal fake scene. gridToPixel returns each tile's world-space center (matching
// the real Grid: highlight is positioned directly from gridToPixel). _worldToScreen
// simulates a camera with scroll + zoom so we can prove the world->screen conversion.
function makeScene(opts = {}) {
  const calls = { onClick: [], ensureWorldVisible: [], highlight: [] };
  const scroll = opts.scroll || { x: 0, y: 0 };
  const zoom = opts.zoom || 1;
  const scene = {
    grid: {
      cols: opts.cols ?? 10,
      rows: opts.rows ?? 8,
      gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }),
    },
    _worldToScreen: (x, y) => ({ x: (x - scroll.x) * zoom, y: (y - scroll.y) * zoom }),
    onClick: (pointer, clickPos) => calls.onClick.push({ pointer, clickPos }),
    cursorHighlight: {
      _visible: false,
      _pos: null,
      setPosition(x, y) {
        this._pos = { x, y };
        return this;
      },
      setVisible(v) {
        this._visible = v;
        return this;
      },
    },
    _battleCamera: {
      ensureWorldVisible: (x, y, margin) => calls.ensureWorldVisible.push({ x, y, margin }),
    },
  };
  return { scene, calls };
}

describe('GridCursorController — movement', () => {
  it('clamps to grid bounds and starts inactive', () => {
    const { scene } = makeScene({ cols: 10, rows: 8 });
    const cursor = new GridCursorController(scene);
    expect(cursor.active).toBe(false);

    cursor.move(-1, -1); // already at 0,0
    expect([cursor.cursorCol, cursor.cursorRow]).toEqual([0, 0]);
    expect(cursor.active).toBe(true);

    for (let i = 0; i < 20; i++) cursor.move(1, 1);
    expect([cursor.cursorCol, cursor.cursorRow]).toEqual([9, 7]); // clamped to max
  });

  it('repositions the shared highlight and follows with the camera', () => {
    const { scene, calls } = makeScene();
    const cursor = new GridCursorController(scene);
    cursor.move(2, 3);
    // gridToPixel(2,3) = (2*32+16, 3*32+16) = (80, 112)
    expect(scene.cursorHighlight._pos).toEqual({ x: 80, y: 112 });
    expect(scene.cursorHighlight._visible).toBe(true);
    expect(calls.ensureWorldVisible.at(-1)).toMatchObject({ x: 80, y: 112 });
  });

  it('snapTo jumps to a tile and renders', () => {
    const { scene } = makeScene();
    const cursor = new GridCursorController(scene);
    cursor.snapTo(5, 4);
    expect([cursor.cursorCol, cursor.cursorRow]).toEqual([5, 4]);
    expect(scene.cursorHighlight._pos).toEqual({ x: 5 * 32 + 16, y: 4 * 32 + 16 });
  });
});

describe('GridCursorController — confirm routes through the world->screen seam', () => {
  it('passes a SCREEN-space clickPos to onClick (not raw world coords) under scroll+zoom', () => {
    // Camera scrolled to (100,50) at zoom 2 — the bug the review caught: passing the
    // world point straight to onClick would double-transform. Prove we convert.
    const { scene, calls } = makeScene({ scroll: { x: 100, y: 50 }, zoom: 2 });
    const cursor = new GridCursorController(scene);
    cursor.snapTo(3, 4); // world center (3*32+16, 4*32+16) = (112, 144)
    cursor.confirm();

    expect(calls.onClick).toHaveLength(1);
    const { pointer, clickPos } = calls.onClick[0];
    expect(pointer).toBeNull();
    // _worldToScreen(112,144) with scroll(100,50) zoom2 = ((112-100)*2,(144-50)*2) = (24,188)
    expect(clickPos).toEqual({ x: 24, y: 188 });
    // Explicitly NOT the raw world coordinates.
    expect(clickPos).not.toEqual({ x: 112, y: 144 });
  });

  it('is a no-op confirm when the grid is unavailable', () => {
    const { scene, calls } = makeScene();
    scene.grid = null;
    const cursor = new GridCursorController(scene);
    cursor.confirm();
    expect(calls.onClick).toHaveLength(0);
  });
});

describe('GridCursorController — hide', () => {
  it('hides the highlight and deactivates', () => {
    const { scene } = makeScene();
    const cursor = new GridCursorController(scene);
    cursor.move(1, 1);
    cursor.hide();
    expect(cursor.active).toBe(false);
    expect(scene.cursorHighlight._visible).toBe(false);
  });
});
