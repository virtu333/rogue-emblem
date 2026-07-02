import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { LootScreenController } from '../src/ui/LootScreenController.js';
import { LootFlowController } from '../src/ui/LootFlowController.js';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  pushInputScope,
  popInputScope,
  dispatchInputAction,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

beforeEach(() => _resetInputFocus());

// Minimal chainable display-object + scene mock (enough for a BoundingFocusController ring).
function makeObj(seed = {}) {
  const o = { visible: true, x: 0, y: 0, width: 10, height: 10, handlers: {}, ...seed };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setStrokeStyle = chain();
  o.setDepth = chain();
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setVisible = chain((v) => (o.visible = v));
  o.setScrollFactor = chain();
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.getBounds = () => ({ centerX: o.x, centerY: o.y, width: o.width, height: o.height });
  o.destroy = () => (o.destroyed = true);
  return o;
}
const makeScene = () => ({
  add: { rectangle: () => makeObj({ kind: 'ring' }) },
  _pinToScreen: vi.fn(),
});

const focusStub = () => ({
  move: vi.fn(),
  activate: vi.fn(),
  destroy: vi.fn(),
  setRingVisible: vi.fn(),
});

describe('LootScreenController main card row routing', () => {
  const route = (fake, action, payload) =>
    LootScreenController.prototype._onInputAction.call(fake, action, payload);

  it('NAVIGATE moves across cards (dx); CONFIRM activates; CANCEL is inert', () => {
    const fake = { _focus: focusStub() };
    route(fake, InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(fake._focus.move).toHaveBeenCalledWith(1);
    route(fake, InputAction.CONFIRM);
    expect(fake._focus.activate).toHaveBeenCalledTimes(1);
    route(fake, InputAction.CANCEL); // must NOT forfeit loot
    route(fake, InputAction.PAUSE);
    expect(fake._focus.move).toHaveBeenCalledTimes(1); // unchanged
  });

  it('_setupInputFocus claims the stack; the card ring hides while covered, restores when re-exposed', () => {
    const ctrl = new LootScreenController(makeScene(), {}, {}, {});
    ctrl._focusCards = [makeObj(), makeObj()];
    ctrl._setupInputFocus();
    expect(activeInputOwner()).toBe(ctrl);

    const ring = ctrl._focus;
    expect(ring.ring.visible).toBe(true); // shown on initial top

    const cover = {};
    pushInputScope(cover, vi.fn()); // a sub-picker covers the loot cards
    expect(ring.ring.visible).toBe(false); // onTopChange -> ring hidden

    popInputScope(cover); // sub-picker closes
    expect(ring.ring.visible).toBe(true);
  });

  it('_teardownInputFocus releases the scope and destroys the ring', () => {
    const ctrl = new LootScreenController(makeScene(), {}, {}, {});
    ctrl._focusCards = [makeObj()];
    ctrl._setupInputFocus();
    expect(activeInputOwner()).toBe(ctrl);
    ctrl._teardownInputFocus();
    expect(activeInputOwner()).toBe(null);
    expect(ctrl._focus).toBe(null);
  });
});

describe('LootFlowController forge sub-picker focus', () => {
  it('routes NAVIGATE/CONFIRM/CANCEL and tears down idempotently', () => {
    const ctrl = new LootFlowController(makeScene());
    const btnA = makeObj();
    const btnB = makeObj();
    const backBtn = makeObj();
    let backFired = 0;
    backBtn.on('pointerdown', () => backFired++);
    let aFired = 0;
    btnA.on('pointerdown', () => aFired++);

    const teardown = ctrl._attachForgePickerFocus([btnA, btnB], backBtn);
    // Owner is an internal token; it is the topmost scope now.
    const owner = activeInputOwner();
    expect(owner).not.toBe(null);

    dispatchInputAction(InputAction.CONFIRM); // ring starts on btnA
    expect(aFired).toBe(1);

    dispatchInputAction(InputAction.CANCEL); // -> backBtn pointerdown
    expect(backFired).toBe(1);

    teardown();
    expect(activeInputOwner()).toBe(null);
    teardown(); // idempotent
    expect(activeInputOwner()).toBe(null);
  });

  it('returns a no-op teardown when there are no targets', () => {
    const ctrl = new LootFlowController(makeScene());
    const teardown = ctrl._attachForgePickerFocus([], null);
    expect(activeInputOwner()).toBe(null); // nothing pushed
    expect(() => teardown()).not.toThrow();
  });
});
