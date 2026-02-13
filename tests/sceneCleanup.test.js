import { describe, it, expect, vi } from 'vitest';
import { cleanupScene } from '../src/utils/sceneCleanup.js';

describe('cleanupScene', () => {
  it('calls tweens.killAll and time.removeAllEvents', () => {
    const scene = {
      tweens: { killAll: vi.fn() },
      time: { removeAllEvents: vi.fn() },
    };
    cleanupScene(scene);
    expect(scene.tweens.killAll).toHaveBeenCalledOnce();
    expect(scene.time.removeAllEvents).toHaveBeenCalledOnce();
  });

  it('handles null tweens and time gracefully', () => {
    expect(() => cleanupScene({})).not.toThrow();
    expect(() => cleanupScene({ tweens: null, time: null })).not.toThrow();
  });

  it('handles missing subsystems gracefully', () => {
    expect(() => cleanupScene(null)).not.toThrow();
    expect(() => cleanupScene(undefined)).not.toThrow();
  });

  it('does not throw when subsystems error', () => {
    const scene = {
      tweens: { killAll: () => { throw new Error('boom'); } },
      time: { removeAllEvents: () => { throw new Error('boom'); } },
    };
    expect(() => cleanupScene(scene)).not.toThrow();
  });

  it('does NOT touch input.keyboard', () => {
    const off = vi.fn();
    const scene = {
      tweens: { killAll: vi.fn() },
      time: { removeAllEvents: vi.fn() },
      input: { keyboard: { off } },
    };
    cleanupScene(scene);
    expect(off).not.toHaveBeenCalled();
  });
});
