import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  pushInputScope,
  popInputScope,
  dispatchInputAction,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

beforeEach(() => _resetInputFocus());

function makeOverlay(overrides = {}) {
  const overlay = new PauseOverlay({}, { onResume: vi.fn() });
  overlay.visible = true;
  overlay._focus = {
    setObjects: vi.fn(),
    clear: vi.fn(),
    destroy: vi.fn(),
    move: vi.fn(),
    activate: vi.fn(),
    setRingVisible: vi.fn(),
  };
  overlay.hide = vi.fn();
  overlay._hideConfirm = vi.fn();
  Object.assign(overlay, overrides);
  return overlay;
}

describe('PauseOverlay gamepad routing', () => {
  it('main menu: NAVIGATE moves with dy, CONFIRM activates, CANCEL resumes', () => {
    const o = makeOverlay();
    o._onInputAction(InputAction.NAVIGATE, { dy: 1, dx: 0 });
    expect(o._focus.move).toHaveBeenCalledWith(1);
    o._onInputAction(InputAction.CONFIRM);
    expect(o._focus.activate).toHaveBeenCalledTimes(1);
    o._onInputAction(InputAction.CANCEL);
    expect(o.hide).toHaveBeenCalledTimes(1);
  });

  it('confirm modal: NAVIGATE uses dx, CANCEL dismisses the modal (not the menu)', () => {
    const o = makeOverlay({ _confirmButtons: [{}, {}] });
    o._onInputAction(InputAction.NAVIGATE, { dy: 1, dx: -1 });
    expect(o._focus.move).toHaveBeenCalledWith(-1); // horizontal
    o._onInputAction(InputAction.CANCEL);
    expect(o._hideConfirm).toHaveBeenCalledTimes(1);
    expect(o.hide).not.toHaveBeenCalled();
  });

  // Defensive fallback: each sub-overlay now pushes its own input-focus scope, so
  // the LIFO bus routes actions straight to it and this handler isn't reached while
  // one is open. This guards the mid-transition case where it somehow is.
  it('a sub-overlay confines the pad to backing out', () => {
    const closeActiveSubOverlay = vi.fn();
    const o = makeOverlay({
      helpOverlay: { visible: true },
      closeActiveSubOverlay,
    });
    o._onInputAction(InputAction.NAVIGATE, { dy: 1 });
    o._onInputAction(InputAction.CONFIRM);
    expect(o._focus.move).not.toHaveBeenCalled();
    expect(o._focus.activate).not.toHaveBeenCalled();
    o._onInputAction(InputAction.CANCEL);
    expect(closeActiveSubOverlay).toHaveBeenCalledTimes(1);
  });

  it('ignores input when not visible', () => {
    const o = makeOverlay({ visible: false });
    o._onInputAction(InputAction.CONFIRM);
    expect(o._focus.activate).not.toHaveBeenCalled();
  });
});

describe('PauseOverlay input-focus scope lifecycle', () => {
  it('_setupFocus claims the stack and _teardownFocus releases it', () => {
    const o = makeOverlay();
    o._menuButtons = [{ a: 1 }, { b: 2 }];
    o._setupFocus();
    expect(activeInputOwner()).toBe(o);
    expect(o._focus.setObjects).toHaveBeenCalledWith(o._menuButtons, true);

    o._teardownFocus();
    expect(activeInputOwner()).toBe(null);
    expect(o._focus).toBe(null);
    expect(o._onInputActionBound).toBe(null);
    expect(o._onTopChangeBound).toBe(null);
  });

  it('hides its focus ring while a sub-overlay covers the scope, restores on uncover', () => {
    const o = makeOverlay();
    o._menuButtons = [{ a: 1 }];
    o._setupFocus();
    // pushInputScope fires the pusher's own onTopChange(true) when it gains the top.
    expect(o._focus.setRingVisible).toHaveBeenLastCalledWith(true);

    // A sub-overlay (Help/Settings/etc.) pushes its own scope on top -> pause covered.
    const sub = { id: 'help' };
    pushInputScope(sub, vi.fn());
    expect(o._focus.setRingVisible).toHaveBeenLastCalledWith(false); // ring hidden

    // Sub-overlay closes (pops) -> pause re-exposed -> ring restored.
    popInputScope(sub);
    expect(o._focus.setRingVisible).toHaveBeenLastCalledWith(true);
  });

  it('dispatched actions only reach the topmost (pause) scope', () => {
    const sceneSpy = vi.fn();
    // Simulate a scene already holding the stack (the battle behind the pause menu).
    pushInputScope({ id: 'scene' }, sceneSpy);

    const o = makeOverlay();
    o._onInputAction = vi.fn();
    o._onInputActionBound = (a, p) => o._onInputAction(a, p);
    pushInputScope(o, o._onInputActionBound);

    dispatchInputAction(InputAction.CONFIRM);
    expect(o._onInputAction).toHaveBeenCalledTimes(1);
    expect(sceneSpy).not.toHaveBeenCalled();
  });
});
