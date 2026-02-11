import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectMobileRuntime, getStartupFlags, resolveStartupFlags } from '../src/utils/runtimeFlags.js';

describe('runtimeFlags', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.__emblemRogueStartupFlags;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'matchMedia', {
      value: vi.fn(() => ({ matches: false })),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: vi.fn(() => null) },
      configurable: true,
      writable: true,
    });
  });

  it('detects non-mobile runtime by default', () => {
    expect(detectMobileRuntime()).toBe(false);
    expect(resolveStartupFlags()).toEqual({
      isMobile: false,
      mobileSafeBoot: false,
      reducedPreload: false,
    });
  });

  it('detects mobile via user agent and enables flags by default', () => {
    globalThis.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(detectMobileRuntime()).toBe(true);
    expect(resolveStartupFlags()).toEqual({
      isMobile: true,
      mobileSafeBoot: true,
      reducedPreload: true,
    });
  });

  it('honors localStorage overrides', () => {
    globalThis.localStorage.getItem.mockReturnValue(JSON.stringify({
      mobileSafeBoot: false,
      reducedPreload: true,
    }));
    globalThis.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(resolveStartupFlags()).toEqual({
      isMobile: true,
      mobileSafeBoot: false,
      reducedPreload: true,
    });
  });

  it('caches startup flags on global key', () => {
    const first = getStartupFlags();
    globalThis.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    const second = getStartupFlags();
    expect(second).toBe(first);
    expect(second.isMobile).toBe(false);
  });
});
