import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { bindCeremonySkip } from '../src/ui/ceremonyDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

// A press that skips a ceremony still has its finger down when the ceremony's
// layer goes away and new UI (a church list, the rewards screen) is built under
// it. The click that follows the lift must not land on that new UI.

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

const scene = () => ({ events: { once() {}, off() {} } });
const down = (target, init = {}) =>
  target.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 1, ...init }));
const up = (target) =>
  target.dispatchEvent(new dom.FakeEvent('pointerup', { button: 0, pointerId: 1 }));
const click = (target) => {
  const event = new dom.FakeEvent('click', { button: 0 });
  target.dispatchEvent(event);
  return event;
};

// A ceremony layer over a page with one button under it. Skipping removes the
// layer, as the real flows do, and the page button is what the click can hit.
function setup() {
  const root = dom.doc.createElement('div');
  const leave = dom.doc.createElement('button');
  const leaveTaps = vi.fn();
  leave.addEventListener('click', leaveTaps);
  dom.doc.body.append(leave, root);
  const onSkip = vi.fn(() => root.remove());
  const unbind = bindCeremonySkip(scene(), root, onSkip, { name: 'Test' });
  return { root, leave, leaveTaps, onSkip, unbind };
}

describe('bindCeremonySkip — the skipping press swallows its own click', () => {
  it('a click on a sibling control after the layer is gone does not reach it', async () => {
    const { root, leave, leaveTaps, onSkip } = setup();
    await vi.advanceTimersByTimeAsync(300); // past the opening guard
    down(root);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(root.isConnected).toBe(false);
    up(leave);
    const ghost = click(leave);
    expect(leaveTaps).not.toHaveBeenCalled();
    expect(ghost.defaultPrevented).toBe(true);
  });

  it('swallows one click only: the next click goes through', async () => {
    const { root, leave, leaveTaps } = setup();
    await vi.advanceTimersByTimeAsync(300);
    down(root);
    up(leave);
    click(leave);
    click(leave);
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });

  it('a new press cancels the swallow, so a genuine next tap counts', async () => {
    const { root, leave, leaveTaps } = setup();
    await vi.advanceTimersByTimeAsync(300);
    down(root);
    up(leave);
    await vi.advanceTimersByTimeAsync(100);
    down(leave, { pointerId: 2 });
    up(leave);
    click(leave);
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });

  it('expires 600 ms after the lift', async () => {
    const { root, leave, leaveTaps } = setup();
    await vi.advanceTimersByTimeAsync(300);
    down(root);
    await vi.advanceTimersByTimeAsync(1500); // a long hold: the window opens at the lift
    up(leave);
    await vi.advanceTimersByTimeAsync(500);
    expect(dom.doc.totalListeners()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(dom.doc.totalListeners()).toBe(0); // and it left nothing bound
    click(leave);
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });

  it('a lift that never comes still expires', async () => {
    const { root, leave, leaveTaps } = setup();
    await vi.advanceTimersByTimeAsync(300);
    down(root);
    await vi.advanceTimersByTimeAsync(10000);
    click(leave);
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });

  it('a keyboard skip makes no click, so it does not eat a later one', async () => {
    const { root, leave, leaveTaps, onSkip } = setup();
    await vi.advanceTimersByTimeAsync(300);
    root.focus();
    dom.key('Enter');
    expect(onSkip).toHaveBeenCalledTimes(1);
    click(leave);
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });

  it('a press inside the opening guard skips nothing and swallows nothing', () => {
    const { root, leave, leaveTaps, onSkip } = setup();
    down(root);
    expect(onSkip).not.toHaveBeenCalled();
    click(leave);
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });

  it('a secondary button press does not skip or swallow', async () => {
    const { root, leave, leaveTaps, onSkip } = setup();
    await vi.advanceTimersByTimeAsync(300);
    down(root, { button: 2 });
    click(leave);
    expect(onSkip).not.toHaveBeenCalled();
    expect(leaveTaps).toHaveBeenCalledTimes(1);
  });
});
