import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dispatchInputAction,
  pushInputScope,
  popInputScope,
  activeInputOwner,
  hasInputFocus,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

describe('inputFocus (LIFO input-focus stack)', () => {
  beforeEach(() => _resetInputFocus());

  it('dispatches to the topmost scope only', () => {
    const base = vi.fn();
    const overlay = vi.fn();
    const baseOwner = {};
    const overlayOwner = {};
    pushInputScope(baseOwner, base);
    pushInputScope(overlayOwner, overlay);

    dispatchInputAction('input:confirm', { x: 1 });
    expect(overlay).toHaveBeenCalledWith('input:confirm', { x: 1 });
    expect(base).not.toHaveBeenCalled();
  });

  it('falls back to the scope below after the top pops (overlay close)', () => {
    const base = vi.fn();
    const overlay = vi.fn();
    const baseOwner = {};
    const overlayOwner = {};
    pushInputScope(baseOwner, base);
    pushInputScope(overlayOwner, overlay);

    popInputScope(overlayOwner); // overlay closes
    dispatchInputAction('input:cancel');
    expect(base).toHaveBeenCalledTimes(1);
    expect(overlay).not.toHaveBeenCalled();
  });

  it('is a no-op when the stack is empty', () => {
    expect(() => dispatchInputAction('input:navigate', { dx: 1 })).not.toThrow();
    expect(activeInputOwner()).toBeNull();
  });

  it('replaces an owner handler in place without re-ordering', () => {
    const owner = {};
    const first = vi.fn();
    const second = vi.fn();
    const other = {};
    const otherHandler = vi.fn();

    pushInputScope(owner, first);
    pushInputScope(other, otherHandler); // other is now on top
    pushInputScope(owner, second); // replace owner's handler, do NOT move it up

    dispatchInputAction('input:confirm');
    expect(otherHandler).toHaveBeenCalledTimes(1); // still topmost
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    popInputScope(other);
    dispatchInputAction('input:confirm');
    expect(second).toHaveBeenCalledTimes(1); // new handler is used
    expect(first).not.toHaveBeenCalled();
  });

  it('popInputScope is idempotent and order-independent', () => {
    const a = {};
    const b = {};
    pushInputScope(a, vi.fn());
    pushInputScope(b, vi.fn());
    popInputScope(a); // remove from the middle/bottom
    expect(activeInputOwner()).toBe(b);
    popInputScope(a); // second pop is harmless
    expect(activeInputOwner()).toBe(b);
  });

  it('activeInputOwner and hasInputFocus reflect the top of the stack', () => {
    const a = {};
    const b = {};
    pushInputScope(a, vi.fn());
    expect(activeInputOwner()).toBe(a);
    expect(hasInputFocus(a)).toBe(true);
    pushInputScope(b, vi.fn());
    expect(hasInputFocus(a)).toBe(false);
    expect(hasInputFocus(b)).toBe(true);
  });

  it('ignores a push with a non-function handler', () => {
    const owner = {};
    pushInputScope(owner, null);
    expect(activeInputOwner()).toBeNull();
    expect(() => dispatchInputAction('input:confirm')).not.toThrow();
  });

  describe('onTopChange notifications', () => {
    it('notifies a scope when it is covered and re-exposed', () => {
      const baseTop = vi.fn();
      const base = {};
      const over = {};
      pushInputScope(base, vi.fn(), baseTop);
      expect(baseTop).toHaveBeenLastCalledWith(true); // gained top on initial push

      pushInputScope(over, vi.fn());
      expect(baseTop).toHaveBeenLastCalledWith(false); // covered

      popInputScope(over);
      expect(baseTop).toHaveBeenLastCalledWith(true); // re-exposed
    });

    it('does not fire when a covered (non-top) scope is removed', () => {
      const baseTop = vi.fn();
      const base = {};
      const mid = {};
      const top = {};
      pushInputScope(base, vi.fn(), baseTop);
      pushInputScope(mid, vi.fn());
      pushInputScope(top, vi.fn());
      baseTop.mockClear();

      popInputScope(mid); // base is still covered by top -> no change for base
      expect(baseTop).not.toHaveBeenCalled();
    });

    it('replacing a handler keeps the existing onTopChange when none is passed', () => {
      const baseTop = vi.fn();
      const base = {};
      pushInputScope(base, vi.fn(), baseTop);
      baseTop.mockClear();
      pushInputScope(base, vi.fn()); // re-render swaps handler only
      pushInputScope({}, vi.fn()); // cover base
      expect(baseTop).toHaveBeenCalledWith(false); // original callback still wired
    });
  });
});
