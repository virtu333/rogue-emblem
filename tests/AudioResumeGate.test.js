import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  installAudioResumeGate,
  failureCooldownMs,
  GESTURE_COOLDOWN_MS,
  STALE_MS,
} from '../src/utils/audioResumeGate.js';

afterEach(() => vi.useRealTimers());

function deviceRefusal() {
  // WebKit's exact refusal (a DOMException in the browser).
  const error = new Error('Failed to start the audio device');
  error.name = 'InvalidStateError';
  return error;
}

function makeContext(state = 'interrupted') {
  const target = new EventTarget();
  const context = {
    state,
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  return context;
}

async function collectUnhandled(run) {
  const seen = [];
  const listener = (reason) => seen.push(reason);
  process.on('unhandledRejection', listener);
  try {
    await run();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', listener);
  }
  return seen;
}

describe('audio resume gate', () => {
  it("absorbs Phaser's dropped resume() when the device refuses to start", async () => {
    const context = makeContext();
    const nativeResume = context.resume;
    nativeResume.mockImplementation(() => Promise.reject(deviceRefusal()));
    const onFailure = vi.fn();
    const gate = installAudioResumeGate(context, { onFailure });
    const unhandled = await collectUnhandled(async () => {
      // Phaser's onFocus / onGameVisible / createAudioContext: `context.resume();`
      context.resume();
    });
    expect(unhandled).toEqual([]);
    expect(nativeResume).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0].message).toBe('Failed to start the audio device');
    expect(gate.recentAttempts().map((a) => a.outcome)).toEqual(['rejected']);
    gate.dispose();
  });

  it('still hands the refusal to a caller that handles it (Phaser unlock)', async () => {
    const context = makeContext();
    context.resume.mockImplementation(() => Promise.reject(deviceRefusal()));
    const gate = installAudioResumeGate(context);
    const failed = vi.fn();
    const ok = vi.fn();
    await context.resume().then(ok, failed);
    expect(ok).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it('keeps one resume in flight for every caller', async () => {
    const context = makeContext();
    let settle;
    context.resume.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const nativeResume = context.resume;
    const gate = installAudioResumeGate(context);
    const a = context.resume();
    const b = context.resume();
    expect(nativeResume).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    settle();
    await a;
    context.resume();
    expect(nativeResume).toHaveBeenCalledTimes(2);
    gate.dispose();
  });

  it('sends a gesture resume past a pending one, once a tap', async () => {
    // Chromium and WebKit leave a resume made without a gesture pending until the
    // page may play; only a resume made during a gesture starts the context.
    let t = 0;
    const context = makeContext();
    context.resume.mockImplementation(() => new Promise(() => {}));
    const nativeResume = context.resume;
    let active = false;
    const gate = installAudioResumeGate(context, { now: () => t, userActive: () => active });
    const pending = context.resume();
    t = 10;
    const tap = gate.request({ gesture: true });
    expect(tap).not.toBe(pending);
    expect(nativeResume).toHaveBeenCalledTimes(2);
    // The same tap's touchend shares it; Phaser's raw call during the tap too.
    t = 60;
    expect(gate.request({ gesture: true })).toBe(tap);
    active = true;
    expect(context.resume()).toBe(tap);
    expect(nativeResume).toHaveBeenCalledTimes(2);
    // A later tap sends again.
    t = 60 + GESTURE_COOLDOWN_MS;
    gate.request({ gesture: true });
    expect(nativeResume).toHaveBeenCalledTimes(3);
    // A raw call during user activation counts as a gesture.
    t = 2000;
    context.resume();
    expect(nativeResume).toHaveBeenCalledTimes(4);
    // Without activation, a pending request is shared until it is stale.
    active = false;
    t = 2100;
    context.resume();
    expect(nativeResume).toHaveBeenCalledTimes(4);
    t = 2000 + STALE_MS;
    context.resume();
    expect(nativeResume).toHaveBeenCalledTimes(5);
    gate.dispose();
  });

  it('cools down after a refusal, doubling to a cap, and resets once running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const context = makeContext();
    const nativeResume = context.resume;
    nativeResume.mockImplementation(() => Promise.reject(deviceRefusal()));
    const gate = installAudioResumeGate(context);
    expect([1, 2, 3, 4, 5, 6, 7].map(failureCooldownMs)).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000,
    ]);
    const unhandled = await collectUnhandled(async () => {
      context.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(nativeResume).toHaveBeenCalledTimes(1);
      // Inside the 500 ms cooldown: refused without touching the device.
      const skipped = vi.fn();
      await context.resume().catch(skipped);
      expect(skipped).toHaveBeenCalledTimes(1);
      expect(nativeResume).toHaveBeenCalledTimes(1);
      // A gesture waits only the short cooldown.
      await vi.advanceTimersByTimeAsync(GESTURE_COOLDOWN_MS);
      gate.request({ gesture: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(nativeResume).toHaveBeenCalledTimes(2);
      // Two refusals: a non-gesture call waits 1000 ms.
      await vi.advanceTimersByTimeAsync(999);
      context.resume();
      expect(nativeResume).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      context.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(nativeResume).toHaveBeenCalledTimes(3);
      // The device comes back: the state change clears the backoff.
      context.state = 'running';
      context.dispatchEvent(new Event('statechange'));
      await context.resume();
      expect(nativeResume).toHaveBeenCalledTimes(3);
      context.state = 'interrupted';
      nativeResume.mockImplementation(() => Promise.resolve());
      await context.resume();
      expect(nativeResume).toHaveBeenCalledTimes(4);
    });
    expect(unhandled).toEqual([]);
    gate.dispose();
  });

  it('a suspend clears the in-flight resume and its own refusal is handled', async () => {
    const context = makeContext();
    let settle;
    context.resume.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    context.suspend.mockImplementation(() => Promise.reject(deviceRefusal()));
    const nativeResume = context.resume;
    const gate = installAudioResumeGate(context);
    const unhandled = await collectUnhandled(async () => {
      context.resume();
      // Phaser's onGameVisible: suspend(); resume();
      context.suspend();
      context.resume();
    });
    expect(nativeResume).toHaveBeenCalledTimes(2);
    expect(unhandled).toEqual([]);
    settle();
    gate.dispose();
  });

  it('a resume that throws synchronously is a handled refusal', async () => {
    const context = makeContext();
    context.resume.mockImplementation(() => {
      throw deviceRefusal();
    });
    const gate = installAudioResumeGate(context);
    const unhandled = await collectUnhandled(async () => {
      expect(() => context.resume()).not.toThrow();
    });
    expect(unhandled).toEqual([]);
    gate.dispose();
  });

  it('installs once and restores the native methods on dispose', () => {
    const context = makeContext();
    const nativeResume = context.resume;
    const nativeSuspend = context.suspend;
    const gate = installAudioResumeGate(context);
    expect(installAudioResumeGate(context)).toBe(gate);
    gate.dispose();
    expect(context.resume).toBe(nativeResume);
    expect(context.suspend).toBe(nativeSuspend);
    expect(context.__audioResumeGate).toBeUndefined();
  });
});
