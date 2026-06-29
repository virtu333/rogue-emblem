// Gamepad/keyboard focus for CampaignMapOverlay (Slice 2D-7c). The campaign map is
// a read-only viewer, so the only focus target is the [X] close button. Drives the
// REAL show() path against a mock scene, then exercises the focus scope through the
// shared input bus (dispatchInputAction) the way GamepadReader would.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  pushInputScope,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { CampaignMapOverlay } from '../src/ui/CampaignMapOverlay.js';

beforeEach(() => _resetInputFocus());

// Chainable display object — getBounds + truthy `scene` for BoundingFocusController,
// emit -> stored handler for synthetic activation.
function makeObj(seed = {}) {
  const o = { x: 0, y: 0, width: 20, height: 14, handlers: {}, scene: {}, ...seed };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setDepth = chain();
  o.setStrokeStyle = chain();
  o.setOrigin = chain();
  o.setColor = chain();
  o.setAlpha = chain();
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setVisible = chain((v) => (o.visible = v));
  o.setInteractive = chain(() => (o.input = { enabled: true }));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.getBounds = () => ({
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    centerX: o.x,
    centerY: o.y,
  });
  o.destroy = () => (o.destroyed = true);
  return o;
}

function makeGraphics() {
  const g = makeObj({ kind: 'graphics' });
  g.lineStyle = (...a) => (a, g);
  g.beginPath = () => g;
  g.moveTo = () => g;
  g.lineTo = () => g;
  g.strokePath = () => g;
  g.lineBetween = () => g;
  return g;
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: (x, y, width, height) => makeObj({ kind: 'rect', x, y, width, height }),
      text: (x, y, text) => makeObj({ kind: 'text', x, y, text }),
      circle: (x, y, radius) => makeObj({ kind: 'circle', x, y, radius }),
      graphics: () => makeGraphics(),
    },
    tweens: { add: vi.fn() },
    input: { keyboard: { addKey: () => ({ on: vi.fn(), off: vi.fn() }) } },
  };
}

function makeNodeMap() {
  return {
    nodes: [
      { id: 'a', row: 0, col: 2, type: 'battle', edges: ['b'], completed: true },
      { id: 'b', row: 1, col: 2, type: 'boss', edges: [], completed: false },
    ],
  };
}

function makeOverlay() {
  const scene = makeScene();
  const onClose = vi.fn();
  const overlay = new CampaignMapOverlay(scene, {
    nodeMap: makeNodeMap(),
    currentNodeId: 'a',
    actId: 'act1',
    activeNodeId: 'a',
    onClose,
  });
  return { overlay, scene, onClose };
}

describe('CampaignMapOverlay gamepad focus', () => {
  it('show() claims the input stack and rings the close button; hide() releases it', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    expect(overlay._focus).toBeTruthy();
    expect(overlay._focus.objects[0]).toBe(overlay._closeBtn); // ring on [X]
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
  });

  it('CONFIRM closes the viewer and fires onClose', () => {
    const { overlay, onClose } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.CONFIRM);
    expect(overlay.visible).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(activeInputOwner()).toBe(null);
  });

  it('CANCEL and PAUSE both close the viewer', () => {
    for (const action of [InputAction.CANCEL, InputAction.PAUSE]) {
      _resetInputFocus();
      const { overlay, onClose } = makeOverlay();
      overlay.show();
      dispatchInputAction(action);
      expect(overlay.visible).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('NAVIGATE is a no-op (nowhere to go in a read-only viewer)', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    const ringTarget = overlay._focus.objects[0];
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    expect(overlay.visible).toBe(true);
    expect(overlay._focus.objects[0]).toBe(ringTarget); // ring unchanged
  });

  it('only the topmost (campaign map) scope receives dispatched actions', () => {
    const sceneSpy = vi.fn();
    pushInputScope({ id: 'pause' }, sceneSpy); // simulate the pause menu underneath
    const { overlay } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.CANCEL);
    expect(sceneSpy).not.toHaveBeenCalled(); // pause scope shielded while map is up
    expect(overlay.visible).toBe(false);
  });

  it('re-show() does not double-push the scope; teardown is idempotent', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    overlay.show(); // show() calls hide() first -> single clean scope
    expect(activeInputOwner()).toBe(overlay);
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(() => overlay._teardownFocus()).not.toThrow();
  });
});
