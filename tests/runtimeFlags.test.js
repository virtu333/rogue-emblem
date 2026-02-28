import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectIOSSafariRuntime,
  detectMobileRuntime,
  getStartupFlags,
  isTouchPointer,
  resolveStartupFlags,
} from '../src/utils/runtimeFlags.js';

describe('runtimeFlags', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.__emblemRogueStartupFlags;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
      },
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
    expect(detectIOSSafariRuntime()).toBe(false);
    expect(resolveStartupFlags()).toEqual({
      isMobile: false,
      isIOSSafari: false,
      mobileSafeBoot: false,
      reducedPreload: false,
      mobileCameraEnabled: false,
      MOBILE_CAMERA_ENABLED: false,
      startupViewportGuard: false,
      STARTUP_VIEWPORT_GUARD: false,
    });
  });

  it('detects mobile via user agent and enables flags by default', () => {
    globalThis.navigator.userAgent = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'AppleWebKit/605.1.15 (KHTML, like Gecko)',
      'Version/17.0 Mobile/15E148 Safari/604.1',
    ].join(' ');
    globalThis.navigator.maxTouchPoints = 5;
    expect(detectMobileRuntime()).toBe(true);
    expect(detectIOSSafariRuntime()).toBe(true);
    expect(resolveStartupFlags()).toEqual({
      isMobile: true,
      isIOSSafari: true,
      mobileSafeBoot: true,
      reducedPreload: true,
      mobileCameraEnabled: true,
      MOBILE_CAMERA_ENABLED: true,
      startupViewportGuard: true,
      STARTUP_VIEWPORT_GUARD: true,
    });
  });

  it('honors localStorage overrides', () => {
    globalThis.localStorage.getItem.mockReturnValue(
      JSON.stringify({
        mobileSafeBoot: false,
        reducedPreload: true,
        mobileCameraEnabled: false,
        startupViewportGuard: false,
      }),
    );
    globalThis.navigator.userAgent = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'AppleWebKit/605.1.15 (KHTML, like Gecko)',
      'Version/17.0 Mobile/15E148 Safari/604.1',
    ].join(' ');
    globalThis.navigator.maxTouchPoints = 5;
    expect(resolveStartupFlags()).toEqual({
      isMobile: true,
      isIOSSafari: true,
      mobileSafeBoot: false,
      reducedPreload: true,
      mobileCameraEnabled: false,
      MOBILE_CAMERA_ENABLED: false,
      startupViewportGuard: false,
      STARTUP_VIEWPORT_GUARD: false,
    });
  });

  it('does not mark iOS Chrome as Safari runtime', () => {
    globalThis.navigator.userAgent = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'AppleWebKit/605.1.15 (KHTML, like Gecko)',
      'CriOS/132.0.0.0 Mobile/15E148 Safari/604.1',
    ].join(' ');
    globalThis.navigator.maxTouchPoints = 5;

    expect(detectMobileRuntime()).toBe(true);
    expect(detectIOSSafariRuntime()).toBe(false);

    const flags = resolveStartupFlags();
    expect(flags.isMobile).toBe(true);
    expect(flags.isIOSSafari).toBe(false);
    expect(flags.startupViewportGuard).toBe(false);
    expect(flags.STARTUP_VIEWPORT_GUARD).toBe(false);
  });

  it('excludes iOS standalone/PWA from Safari runtime gate', () => {
    globalThis.navigator.userAgent = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'AppleWebKit/605.1.15 (KHTML, like Gecko)',
      'Version/17.0 Mobile/15E148 Safari/604.1',
    ].join(' ');
    globalThis.navigator.maxTouchPoints = 5;
    globalThis.matchMedia = vi.fn((query) => ({ matches: query === '(display-mode: standalone)' }));

    expect(detectMobileRuntime()).toBe(true);
    expect(detectIOSSafariRuntime()).toBe(false);

    const flags = resolveStartupFlags();
    expect(flags.isMobile).toBe(true);
    expect(flags.isIOSSafari).toBe(false);
    expect(flags.startupViewportGuard).toBe(false);
    expect(flags.STARTUP_VIEWPORT_GUARD).toBe(false);
  });

  it('caches startup flags on global key', () => {
    const first = getStartupFlags();
    globalThis.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    const second = getStartupFlags();
    expect(second).toBe(first);
    expect(second.isMobile).toBe(false);
  });

  describe('isTouchPointer', () => {
    it('returns true for wasTouch pointer', () => {
      expect(isTouchPointer({ wasTouch: true })).toBe(true);
    });

    it('returns true for pointerType touch', () => {
      expect(isTouchPointer({ pointerType: 'touch' })).toBe(true);
    });

    it('returns true for nested event.pointerType touch', () => {
      expect(isTouchPointer({ event: { pointerType: 'touch' } })).toBe(true);
    });

    it('returns true for uppercase Touch', () => {
      expect(isTouchPointer({ pointerType: 'Touch' })).toBe(true);
    });

    it('returns false for mouse pointer', () => {
      expect(isTouchPointer({ pointerType: 'mouse' })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isTouchPointer(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTouchPointer(undefined)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isTouchPointer('touch')).toBe(false);
      expect(isTouchPointer(42)).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isTouchPointer({})).toBe(false);
    });
  });
});
