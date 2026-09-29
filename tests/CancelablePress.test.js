import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindCancelablePress } from '../src/utils/cancelablePress.js';
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  const b = new EventTarget();
  Object.assign(b, {
    isConnected: true,
    closest: () => null,
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 50 }),
  });
  const tap = vi.fn(),
    hold = vi.fn();
  const dispose = bindCancelablePress(b, tap, { onLongPress: hold });
  const send = (name, data = {}) => {
    const e = new Event(name, { cancelable: true });
    Object.assign(e, { pointerId: 1, clientX: 20, clientY: 20, detail: 1, ...data });
    b.dispatchEvent(e);
  };
  return { b, tap, hold, dispose, send };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('cancelable long press', () => {
  it('retains normal tap and keyboard activation, consumes long-press click', () => {
    const { send, tap, hold } = setup();
    send('pointerdown');
    vi.advanceTimersByTime(100);
    send('pointerup');
    send('click');
    expect(tap).toHaveBeenCalledTimes(1);
    send('pointerdown');
    vi.advanceTimersByTime(550);
    send('pointerup');
    send('click');
    expect(hold).toHaveBeenCalledTimes(1);
    expect(tap).toHaveBeenCalledTimes(1);
    send('click', { detail: 0 });
    expect(tap).toHaveBeenCalledTimes(2);
  });
  it.each(['pointercancel', 'pointerleave', 'pointermove'])('cancels hold after %s', (event) => {
    const { send, hold, tap } = setup();
    send('pointerdown');
    send(event, { clientX: 90 });
    vi.advanceTimersByTime(600);
    send('pointerup');
    send('click');
    expect(hold).not.toHaveBeenCalled();
    expect(tap).not.toHaveBeenCalled();
  });
  it('does not activate after disposal or removal', () => {
    const { send, dispose, hold, b } = setup();
    send('pointerdown');
    b.isConnected = false;
    vi.advanceTimersByTime(600);
    expect(hold).not.toHaveBeenCalled();
    b.isConnected = true;
    send('pointerdown');
    dispose();
    vi.advanceTimersByTime(600);
    expect(hold).not.toHaveBeenCalled();
  });
});
