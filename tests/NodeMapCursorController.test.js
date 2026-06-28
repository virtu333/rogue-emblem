import { describe, it, expect, vi } from 'vitest';
import { NodeMapCursorController } from '../src/ui/NodeMapCursorController.js';

function makeMarker() {
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
    setVisible: vi.fn(function () {
      return this;
    }),
    destroy: vi.fn(function () {
      this.scene = null;
    }),
  };
}

function makeScene() {
  const marker = makeMarker();
  return {
    _marker: marker,
    add: { circle: vi.fn(() => marker) },
    onNodeClick: vi.fn(),
    showNodeTooltip: vi.fn(),
    hideNodeTooltip: vi.fn(),
  };
}

const positions = new Map([
  ['a', { x: 10, y: 90 }],
  ['b', { x: 20, y: 90 }],
  ['c', { x: 30, y: 90 }],
]);
// Intentionally unsorted; setNodes should order by row then col.
const NODES = [
  { id: 'c', row: 0, col: 3 },
  { id: 'a', row: 0, col: 1 },
  { id: 'b', row: 0, col: 2 },
];

describe('NodeMapCursorController', () => {
  it('sorts available nodes and focuses the first; shows its tooltip + ring', () => {
    const scene = makeScene();
    const c = new NodeMapCursorController(scene);
    c.setNodes(NODES, positions);
    expect(c.current().id).toBe('a'); // sorted by (row, col): a,b,c
    expect(scene.add.circle).toHaveBeenCalled();
    expect(scene.showNodeTooltip).toHaveBeenCalledWith(NODES[1], positions.get('a'));
  });

  it('move steps through nodes and wraps', () => {
    const scene = makeScene();
    const c = new NodeMapCursorController(scene);
    c.setNodes(NODES, positions);
    c.move(1, 0);
    expect(c.current().id).toBe('b');
    c.move(0, 1); // any axis steps
    expect(c.current().id).toBe('c');
    c.move(1, 0); // wrap c -> a
    expect(c.current().id).toBe('a');
    c.move(-1, 0); // wrap a -> c
    expect(c.current().id).toBe('c');
  });

  it('confirm routes the focused node through scene.onNodeClick', () => {
    const scene = makeScene();
    const c = new NodeMapCursorController(scene);
    c.setNodes(NODES, positions);
    c.move(1, 0); // focus b
    c.confirm();
    expect(scene.onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('is inert with no available nodes and hides the tooltip', () => {
    const scene = makeScene();
    const c = new NodeMapCursorController(scene);
    c.setNodes([], positions);
    expect(c.current()).toBeNull();
    c.move(1, 0);
    c.confirm();
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene.hideNodeTooltip).toHaveBeenCalled();
  });

  it('keeps the focus index in range when the available set shrinks on redraw', () => {
    const scene = makeScene();
    const c = new NodeMapCursorController(scene);
    c.setNodes(NODES, positions);
    c.move(1, 0);
    c.move(1, 0); // focus c (index 2)
    expect(c.current().id).toBe('c');
    // Redraw with fewer nodes (e.g. one became completed): index clamps.
    c.setNodes([NODES[1]], positions); // only 'a'
    expect(c.current().id).toBe('a');
  });
});
