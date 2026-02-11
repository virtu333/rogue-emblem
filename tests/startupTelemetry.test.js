import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStartupTelemetry,
  initStartupTelemetry,
  logStartupSummary,
  markStartup,
  recordStartupAssetFailure,
} from '../src/utils/startupTelemetry.js';

describe('startupTelemetry', () => {
  beforeEach(() => {
    delete globalThis.__emblemRogueStartupTelemetry;
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'localhost' },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'performance', {
      value: { now: vi.fn(() => 100) },
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('records startup markers and asset failures', () => {
    initStartupTelemetry({ isMobile: true });
    markStartup('boot_preload_start', { reducedPreload: true });
    recordStartupAssetFailure({ key: 'portrait_lord_edric', type: 'image', src: '/assets/foo.png' }, 'Boot');

    const telemetry = getStartupTelemetry();
    expect(telemetry.meta.isMobile).toBe(true);
    expect(telemetry.markers.some(m => m.name === 'app_init_start')).toBe(true);
    expect(telemetry.markers.some(m => m.name === 'boot_preload_start')).toBe(true);
    expect(telemetry.assetFailures).toHaveLength(1);
    expect(telemetry.assetFailures[0]).toMatchObject({
      key: 'portrait_lord_edric',
      type: 'image',
      scene: 'Boot',
    });
  });

  it('logs summary once by default', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    initStartupTelemetry({ isMobile: false });
    markStartup('first_interactive_frame');
    logStartupSummary({ reason: 'first' });
    logStartupSummary({ reason: 'second' });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it('can force re-log summary', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    initStartupTelemetry();
    logStartupSummary({ reason: 'first' });
    logStartupSummary({ reason: 'forced', force: true });
    expect(infoSpy).toHaveBeenCalledTimes(2);
  });
});
