import { describe, it, expect, vi, afterEach } from 'vitest';
import { installAudioRecovery } from '../src/utils/audioRecovery.js';
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const doc = new EventTarget();
  doc.hidden = false;
  doc.hasFocus = () => true;
  const win = new EventTarget();
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  const context = { state: 'interrupted', resume: vi.fn(() => Promise.resolve()) };
  const dispose = installAudioRecovery(context, { document: doc, window: win });
  return { doc, win, context, dispose };
}
describe('audio foreground recovery', () => {
  it('retries on the next gesture after rejected foreground resume', async () => {
    const { doc, win, context, dispose } = setup();
    context.resume.mockRejectedValueOnce(Error('gesture required'));
    win.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event('pointerdown'));
    expect(context.resume).toHaveBeenCalledTimes(2);
    context.state = 'running';
    vi.runAllTimers();
    doc.dispatchEvent(new Event('keydown'));
    expect(context.resume).toHaveBeenCalledTimes(2);
    dispose();
  });
  it('cancels retries on background and never resumes hidden audio', () => {
    const { doc, win, context, dispose } = setup();
    win.dispatchEvent(new Event('focus'));
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('touchend'));
    vi.runAllTimers();
    expect(context.resume).toHaveBeenCalledTimes(1);
    dispose();
    doc.hidden = false;
    win.dispatchEvent(new Event('focus'));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
  it('bounds retries and does not touch a closed context', () => {
    const { win, context, dispose } = setup();
    win.dispatchEvent(new Event('focus'));
    vi.runAllTimers();
    expect(context.resume).toHaveBeenCalledTimes(3);
    context.state = 'closed';
    win.dispatchEvent(new Event('focus'));
    vi.runAllTimers();
    expect(context.resume).toHaveBeenCalledTimes(3);
    dispose();
  });
});
