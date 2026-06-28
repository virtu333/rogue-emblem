import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

beforeEach(() => _resetInputFocus());

function makeObj(seed = {}) {
  const o = { visible: true, x: 0, y: 0, width: 10, height: 10, handlers: {}, ...seed };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setStrokeStyle = chain();
  o.setDepth = chain();
  o.setOrigin = chain();
  o.setAlpha = chain((a) => (o.alpha = a));
  o.setColor = chain((c) => (o.color = c));
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setVisible = chain((v) => (o.visible = v));
  o.setScrollFactor = chain();
  o.setInteractive = chain(() => (o.input = { enabled: true }));
  o.disableInteractive = chain(() => (o.input = { enabled: false }));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.getBounds = () => ({ centerX: o.x, centerY: o.y, width: o.width, height: o.height });
  o.destroy = () => (o.destroyed = true);
  o.input = null;
  return o;
}

// Minimal BattleScene `this` for _setupLootPickerScroller.
function makeSceneThis() {
  return {
    add: { text: () => makeObj({ kind: 'text' }), rectangle: () => makeObj({ kind: 'rect' }) },
    input: { on: vi.fn(), off: vi.fn(), keyboard: { on: vi.fn(), off: vi.fn() } },
    cameras: { main: { width: 640, height: 480 } },
  };
}

// Build N rows; each row tracks selection via its inputTarget pointerdown.
function makeRows(n, fired) {
  return Array.from({ length: n }, (_, i) => {
    const target = makeObj();
    target.on('pointerdown', () => fired.push(i));
    const visObj = makeObj();
    return {
      index: i,
      selectable: true,
      inputTarget: target,
      objects: [visObj, target],
      setCenterY: (cy) => {
        target.y = cy;
        visObj.y = cy;
      },
    };
  });
}

const run = (sceneThis, opts) =>
  BattleScene.prototype._setupLootPickerScroller.call(sceneThis, opts);

describe('_setupLootPickerScroller gamepad focus', () => {
  it('CONFIRM activates the focused row; NAVIGATE moves focus', () => {
    const sceneThis = makeSceneThis();
    const fired = [];
    const rows = makeRows(3, fired);
    const detach = run(sceneThis, {
      pickerGroup: [],
      rows,
      topY: 0,
      bottomY: 300,
      rowHeight: 50,
      listLeft: 0,
      listRight: 200,
      onBack: vi.fn(),
    });
    expect(activeInputOwner()).not.toBe(null);

    dispatchInputAction(InputAction.CONFIRM); // row 0
    expect(fired).toEqual([0]);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.CONFIRM); // row 1
    expect(fired).toEqual([0, 1]);

    detach();
    expect(activeInputOwner()).toBe(null);
  });

  it('CANCEL calls onBack', () => {
    const sceneThis = makeSceneThis();
    const onBack = vi.fn();
    const detach = run(sceneThis, {
      pickerGroup: [],
      rows: makeRows(2, []),
      topY: 0,
      bottomY: 300,
      rowHeight: 50,
      listLeft: 0,
      listRight: 200,
      onBack,
    });
    dispatchInputAction(InputAction.CANCEL);
    expect(onBack).toHaveBeenCalledTimes(1);
    detach();
  });

  it('extra focus targets (Convoy/Back) are reachable after the rows', () => {
    const sceneThis = makeSceneThis();
    const fired = [];
    const rows = makeRows(2, fired);
    const convoy = makeObj();
    let convoyFired = 0;
    convoy.on('pointerdown', () => convoyFired++);
    const detach = run(sceneThis, {
      pickerGroup: [],
      rows,
      topY: 0,
      bottomY: 300,
      rowHeight: 50,
      listLeft: 0,
      listRight: 200,
      onBack: vi.fn(),
      extraFocusTargets: [convoy],
    });
    // 2 rows then convoy -> 2 downs land on convoy.
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.CONFIRM);
    expect(convoyFired).toBe(1);
    expect(fired).toEqual([]); // rows not triggered
    detach();
  });

  it('NAVIGATE scrolls an off-screen row into view', () => {
    const sceneThis = makeSceneThis();
    const fired = [];
    const rows = makeRows(5, fired); // maxVisibleRows = floor(100/50) = 2
    const detach = run(sceneThis, {
      pickerGroup: [],
      rows,
      topY: 0,
      bottomY: 100,
      rowHeight: 50,
      listLeft: 0,
      listRight: 200,
      onBack: vi.fn(),
    });
    // Row 4 starts hidden (only rows 0-1 visible).
    expect(rows[4].objects[0].visible).toBe(false);
    for (let i = 0; i < 4; i++) dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(rows[4].objects[0].visible).toBe(true); // scrolled into view
    detach();
  });
});
