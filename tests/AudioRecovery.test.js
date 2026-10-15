import { describe, it, expect, vi, afterEach } from 'vitest';
import { installAudioRecovery } from '../src/utils/audioRecovery.js';
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const doc = new EventTarget();
  doc.hidden = false;
  doc.hasFocus = () => true;
  const win = new EventTarget();
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  // The native resume, kept apart: the recovery gates the context's own method.
  const nativeResume = vi.fn(() => Promise.resolve());
  const context = { state: 'interrupted', resume: nativeResume };
  const dispose = installAudioRecovery(context, { document: doc, window: win });
  return { doc, win, context, nativeResume, dispose };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
describe('audio foreground recovery', () => {
  it('retries on the next gesture after rejected foreground resume', async () => {
    const { doc, win, context, nativeResume, dispose } = setup();
    nativeResume.mockRejectedValueOnce(Error('gesture required'));
    win.dispatchEvent(new Event('focus'));
    await flush();
    expect(nativeResume).toHaveBeenCalledTimes(1);
    // A gesture waits out only the short cooldown that absorbs one tap's events.
    await vi.advanceTimersByTimeAsync(300);
    const calls = nativeResume.mock.calls.length;
    doc.dispatchEvent(new Event('pointerdown'));
    expect(nativeResume).toHaveBeenCalledTimes(calls + 1);
    context.state = 'running';
    await vi.runAllTimersAsync();
    doc.dispatchEvent(new Event('keydown'));
    expect(nativeResume).toHaveBeenCalledTimes(calls + 1);
    dispose();
  });
  it('cancels retries on background and never resumes hidden audio', async () => {
    const { doc, win, nativeResume, dispose } = setup();
    win.dispatchEvent(new Event('focus'));
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('touchend'));
    await vi.runAllTimersAsync();
    expect(nativeResume).toHaveBeenCalledTimes(1);
    dispose();
    doc.hidden = false;
    win.dispatchEvent(new Event('focus'));
    expect(nativeResume).toHaveBeenCalledTimes(1);
  });
  it('bounds retries and does not touch a closed context', async () => {
    const { win, context, nativeResume, dispose } = setup();
    win.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();
    expect(nativeResume).toHaveBeenCalledTimes(3);
    context.state = 'closed';
    win.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();
    expect(nativeResume).toHaveBeenCalledTimes(3);
    dispose();
  });
  it('sends one resume for a foreground return and one for a tap', async () => {
    const { doc, win, nativeResume, dispose } = setup();
    const settles = [];
    nativeResume.mockImplementation(() => new Promise((resolve) => settles.push(resolve)));
    win.dispatchEvent(new Event('focus'));
    win.dispatchEvent(new Event('pageshow'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(nativeResume).toHaveBeenCalledTimes(1);
    // A browser leaves a resume made without a gesture pending; the tap's own
    // resume is the one that can start the device, so it is sent, once a tap.
    doc.dispatchEvent(new Event('pointerdown'));
    doc.dispatchEvent(new Event('touchend'));
    doc.dispatchEvent(new Event('keydown'));
    expect(nativeResume).toHaveBeenCalledTimes(2);
    for (const settle of settles) settle();
    await flush();
    dispose();
  });
  it('backs off after repeated refusals and never lets one escape unhandled', async () => {
    const { doc, win, nativeResume, dispose } = setup();
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const refusal = Object.assign(new Error('Failed to start the audio device'), {
        name: 'InvalidStateError',
      });
      nativeResume.mockImplementation(() => Promise.reject(refusal));
      win.dispatchEvent(new Event('focus'));
      await vi.runAllTimersAsync();
      // focus at 0 is refused; the 250 ms retry is inside the 500 ms cooldown; 1000 ms runs.
      expect(nativeResume).toHaveBeenCalledTimes(2);
      // Second refusal: the next cooldown is 1000 ms for non-gesture retries.
      win.dispatchEvent(new Event('focus'));
      await flush();
      expect(nativeResume).toHaveBeenCalledTimes(2);
      // A gesture after the short gesture cooldown tries again.
      await vi.advanceTimersByTimeAsync(300);
      doc.dispatchEvent(new Event('pointerdown'));
      doc.dispatchEvent(new Event('touchend'));
      await flush();
      expect(nativeResume).toHaveBeenCalledTimes(3);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      dispose();
    }
  });
});
