// haptic(kind): the Capacitor plugin when present, else navigator.vibrate, else nothing;
// the Vibration setting; the tick throttle; and no error ever reaches the caller.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HAPTIC_KINDS,
  TICK_MIN_INTERVAL_MS,
  VIBRATE_PATTERNS,
  bindHapticSettings,
  haptic,
  hapticsEnabled,
  hapticsSupported,
  resetHapticsForTests,
  setHapticsEnabled,
} from '../src/utils/haptics.js';
import { SettingsManager, normalizeSettings } from '../src/utils/SettingsManager.js';
import { strikeFeedback } from '../src/ui/impactFeedback.js';
import RevivalStoneController from '../src/ui/RevivalStoneController.js';
import { GridCursorController } from '../src/ui/GridCursorController.js';

function capacitor() {
  return {
    impact: vi.fn(() => Promise.resolve()),
    selectionChanged: vi.fn(() => Promise.resolve()),
    notification: vi.fn(() => Promise.resolve()),
  };
}

function stubVibrate(touch = 5) {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal('navigator', { vibrate, maxTouchPoints: touch });
  return vibrate;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Capacitor', undefined);
  vi.stubGlobal('navigator', {});
  resetHapticsForTests();
});

afterEach(() => {
  resetHapticsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('haptic()', () => {
  it('uses the Capacitor plugin over navigator.vibrate, with the right style per kind', () => {
    const plugin = capacitor();
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: plugin } });
    const vibrate = stubVibrate();
    haptic('light');
    haptic('medium');
    haptic('heavy');
    expect(plugin.impact.mock.calls.map((c) => c[0])).toEqual([
      { style: 'LIGHT' },
      { style: 'MEDIUM' },
      { style: 'HEAVY' },
    ]);
    haptic('success');
    expect(plugin.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    haptic('tick');
    expect(plugin.selectionChanged).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('falls back to short vibrate patterns without the plugin', () => {
    const vibrate = stubVibrate();
    for (const kind of HAPTIC_KINDS) {
      vi.advanceTimersByTime(TICK_MIN_INTERVAL_MS + 1);
      haptic(kind);
    }
    expect(vibrate.mock.calls.map((c) => c[0])).toEqual([5, 10, 20, 35, [15, 40, 15]]);
    expect(VIBRATE_PATTERNS.tick).toBe(5);
    expect(VIBRATE_PATTERNS.success).toEqual([15, 40, 15]);
  });

  it('does nothing, and never throws, when neither exists', () => {
    expect(hapticsSupported()).toBe(false);
    for (const kind of [...HAPTIC_KINDS, 'nonsense', undefined, null, 42]) {
      expect(() => haptic(kind)).not.toThrow();
    }
  });

  it('swallows a throwing plugin, a rejecting plugin and a throwing vibrate', async () => {
    const rejecting = {
      impact: vi.fn(() => Promise.reject(new Error('no motor'))),
      selectionChanged: vi.fn(() => {
        throw new Error('sync boom');
      }),
      notification: vi.fn(() => Promise.reject(new Error('no motor'))),
    };
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: rejecting } });
    expect(() => {
      haptic('heavy');
      haptic('tick');
      haptic('success');
    }).not.toThrow();
    await Promise.resolve();
    vi.stubGlobal('Capacitor', undefined);
    vi.stubGlobal('navigator', {
      maxTouchPoints: 5,
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => haptic('heavy')).not.toThrow();
    // A plugin missing a method is not an error either.
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: {} } });
    expect(() => haptic('light')).not.toThrow();
  });

  it('is silent when the setting is off, and speaks again when it is back on', () => {
    const plugin = capacitor();
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: plugin } });
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    haptic('heavy');
    haptic('success');
    expect(plugin.impact).not.toHaveBeenCalled();
    expect(plugin.notification).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    haptic('heavy');
    expect(plugin.impact).toHaveBeenCalledTimes(1);
  });

  it('throttles ticks to one per interval, and only ticks', () => {
    const vibrate = stubVibrate();
    haptic('tick');
    haptic('tick');
    vi.advanceTimersByTime(TICK_MIN_INTERVAL_MS - 1);
    haptic('tick');
    expect(vibrate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    haptic('tick');
    expect(vibrate).toHaveBeenCalledTimes(2);
    // Other kinds are never held back by it.
    haptic('light');
    haptic('light');
    haptic('heavy');
    expect(vibrate).toHaveBeenCalledTimes(5);
  });

  it('counts a desktop vibrate() with no touch screen as unsupported', () => {
    const vibrate = stubVibrate(0);
    expect(hapticsSupported()).toBe(false);
    haptic('heavy');
    expect(vibrate).not.toHaveBeenCalled();
    stubVibrate(5);
    expect(hapticsSupported()).toBe(true);
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: capacitor() } });
    vi.stubGlobal('navigator', {});
    expect(hapticsSupported()).toBe(true);
  });
});

describe('the Vibration setting', () => {
  let store;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
      removeItem: (k) => {
        delete store[k];
      },
    });
  });

  it('defaults on, validates to a boolean, and round-trips through normalizeSettings', () => {
    expect(normalizeSettings().vibration).toBe(true);
    expect(normalizeSettings({ vibration: false }).vibration).toBe(false);
    expect(normalizeSettings({ vibration: 'no' }).vibration).toBe(true);
    expect(normalizeSettings({ vibration: 0 }).vibration).toBe(true);
    const sm = new SettingsManager();
    expect(sm.getVibration()).toBe(true);
    sm.setVibration(false);
    expect(JSON.parse(store.emblem_rogue_settings).vibration).toBe(false);
    expect(new SettingsManager().getVibration()).toBe(false);
  });

  it('keeps the haptics flag in step with the settings, live and on load', () => {
    const plugin = capacitor();
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: plugin } });
    const sm = new SettingsManager();
    bindHapticSettings(sm);
    haptic('heavy');
    expect(plugin.impact).toHaveBeenCalledTimes(1);
    sm.setVibration(false);
    haptic('heavy');
    expect(plugin.impact).toHaveBeenCalledTimes(1);
    sm.setVibration(true);
    haptic('heavy');
    expect(plugin.impact).toHaveBeenCalledTimes(2);
    // A saved Off is honoured from the first call after binding.
    store.emblem_rogue_settings = JSON.stringify({ vibration: false, savedAt: Date.now() + 10 });
    bindHapticSettings(new SettingsManager());
    haptic('heavy');
    expect(plugin.impact).toHaveBeenCalledTimes(2);
  });

  it('stops following a settings object that was replaced', () => {
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: capacitor() } });
    const first = new SettingsManager();
    bindHapticSettings(first);
    bindHapticSettings(new SettingsManager());
    first.setVibration(false);
    expect(hapticsEnabled()).toBe(true);
  });
});

describe('where the hooks sit', () => {
  it('a strike: light for damage, heavy for a crit, nothing for a miss or no damage', () => {
    const plugin = capacitor();
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: plugin } });
    const scene = { shakeScreen: vi.fn() };
    strikeFeedback(scene, { miss: true, damage: 9 }, {}, {});
    strikeFeedback(scene, { damage: 0 }, {}, {});
    expect(plugin.impact).not.toHaveBeenCalled();
    strikeFeedback(scene, { damage: 5 }, {}, {});
    strikeFeedback(scene, { damage: 12, isCrit: true }, {}, {});
    expect(plugin.impact.mock.calls.map((c) => c[0].style)).toEqual(['LIGHT', 'HEAVY']);
    expect(scene.shakeScreen).not.toHaveBeenCalled();
  });

  it('a boss blow landing on a player unit shakes; no other blow does', () => {
    const scene = { shakeScreen: vi.fn() };
    const hit = { damage: 7 };
    strikeFeedback(scene, hit, { isBoss: true }, { faction: 'player' });
    expect(scene.shakeScreen).toHaveBeenCalledWith('boss');
    strikeFeedback(scene, hit, { isBoss: true }, { faction: 'enemy' });
    strikeFeedback(scene, hit, { isBoss: false }, { faction: 'player' });
    strikeFeedback(scene, { miss: true, damage: 7 }, { isBoss: true }, { faction: 'player' });
    strikeFeedback(scene, { damage: 0 }, { isBoss: true }, { faction: 'player' });
    expect(scene.shakeScreen).toHaveBeenCalledTimes(1);
    // A scene with no shake (a stub) is fine.
    expect(() => strikeFeedback({}, hit, { isBoss: true }, { faction: 'player' })).not.toThrow();
  });

  it('a broken Revival Stone shakes hard and pulses heavy', () => {
    const plugin = capacitor();
    vi.stubGlobal('Capacitor', { Plugins: { Haptics: plugin } });
    const scene = {
      shakeScreen: vi.fn(),
      updateAffixPips: vi.fn(),
      updateHPBar: vi.fn(),
      grid: { gridToPixel: () => ({ x: 1, y: 2 }) },
      showMinorHintAt: vi.fn(),
    };
    new RevivalStoneController(scene).create().playBreak({ col: 1, row: 1, stats: { HP: 10 } });
    expect(scene.shakeScreen).toHaveBeenCalledWith('stone');
    expect(plugin.impact).toHaveBeenCalledWith({ style: 'HEAVY' });
  });

  it('the cursor ticks on a step onto a new tile, not against the board edge', () => {
    const vibrate = stubVibrate();
    const scene = {
      grid: { cols: 3, rows: 3, gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) },
      cursorHighlight: null,
      _onGridCursorMoved: vi.fn(),
    };
    const cursor = new GridCursorController(scene);
    cursor.move(1, 0);
    expect(vibrate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TICK_MIN_INTERVAL_MS + 1);
    cursor.move(1, 0);
    cursor.move(1, 0); // at the right edge now: stays put, no tick
    vi.advanceTimersByTime(TICK_MIN_INTERVAL_MS + 1);
    cursor.move(1, 0);
    expect(cursor.cursorCol).toBe(2);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
});
