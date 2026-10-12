// haptic(kind): the @capacitor/haptics plugin on a native platform, else navigator.vibrate,
// else nothing; the Vibration setting; the tick throttle; and no error ever reaches the caller.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The native app: a fake injected bridge (`window.Capacitor`, as the iOS/Android shell
// injects it, listing the plugins it carries) and the package's registered interface,
// both handing each call to whichever plugin fake the test installed, noting which way
// the call went.
const native = { plugin: null, via: [] };
// The package's registered interface as the app would load it, minus @capacitor/core
// (which would rewrite this test's bridge, as it does a real one).
const fakeInterface = {
  Haptics: new Proxy(
    {},
    {
      get: (_, key) =>
        typeof native.plugin?.[key] === 'function'
          ? (options) => {
              native.via.push(`interface:${String(key)}`);
              return native.plugin[key](options);
            }
          : undefined,
    },
  ),
};
import {
  HAPTIC_KINDS,
  TICK_MIN_INTERVAL_MS,
  VIBRATE_PATTERNS,
  bindHapticSettings,
  haptic,
  hapticsEnabled,
  hapticsSupported,
  nativeHapticsImportForTests,
  resetHapticsForTests,
  setHapticsEnabled,
  setNativeHapticsLoaderForTests,
} from '../src/utils/haptics.js';
import {
  ImpactStyle,
  NotificationType,
} from '../node_modules/@capacitor/haptics/dist/esm/definitions.js';
import { SettingsManager, normalizeSettings } from '../src/utils/SettingsManager.js';
import { strikeFeedback } from '../src/ui/impactFeedback.js';
import RevivalStoneController from '../src/ui/RevivalStoneController.js';
import { GridCursorController } from '../src/ui/GridCursorController.js';

// A plugin fake that behaves as the device does: impact and notification are felt at once,
// a selection tick only between selectionStart() and selectionEnd().
function capacitor() {
  const felt = [];
  let selecting = false;
  return {
    felt,
    impact: vi.fn(async (o) => felt.push(`impact:${o?.style}`)),
    notification: vi.fn(async (o) => felt.push(`notification:${o?.type}`)),
    selectionStart: vi.fn(async () => {
      selecting = true;
    }),
    selectionChanged: vi.fn(async () => {
      if (selecting) felt.push('selection');
    }),
    selectionEnd: vi.fn(async () => {
      selecting = false;
    }),
  };
}

function useNative(plugin, { available = true } = {}) {
  native.plugin = plugin;
  vi.stubGlobal('Capacitor', {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    PluginHeaders: available ? [{ name: 'Haptics' }] : [{ name: 'Filesystem' }],
    nativePromise: (pluginName, method, options) => {
      native.via.push(`bridge:${method}`);
      if (pluginName !== 'Haptics') throw new Error(`unexpected plugin ${pluginName}`);
      return plugin[method](options);
    },
  });
  return plugin;
}

function useWeb() {
  native.plugin = null;
  vi.stubGlobal('Capacitor', undefined);
}

function stubVibrate(touch = 5) {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal('navigator', { vibrate, maxTouchPoints: touch });
  return vibrate;
}

beforeEach(() => {
  vi.useFakeTimers();
  native.via.length = 0;
  useWeb();
  vi.stubGlobal('navigator', {});
  resetHapticsForTests();
  setNativeHapticsLoaderForTests(async () => fakeInterface);
});

afterEach(() => {
  resetHapticsForTests();
  useWeb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('haptic()', () => {
  it('uses the Capacitor plugin over navigator.vibrate, with the right style per kind', () => {
    const plugin = useNative(capacitor());
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
    vi.advanceTimersByTime(TICK_MIN_INTERVAL_MS + 1);
    haptic('tick');
    expect(plugin.impact).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('a native tick is felt: a stateless light impact, never a selection outside its pair', async () => {
    const plugin = useNative(capacitor());
    haptic('tick');
    await Promise.resolve();
    expect(plugin.felt).toEqual(['impact:LIGHT']);
    expect(plugin.selectionChanged).not.toHaveBeenCalled();
    expect(plugin.selectionStart).not.toHaveBeenCalled();
    // Every tick after the throttle is felt too, with no selection state left behind.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(TICK_MIN_INTERVAL_MS + 1);
      haptic('tick');
    }
    await Promise.resolve();
    expect(plugin.felt).toEqual(Array(4).fill('impact:LIGHT'));
  });

  it('falls back to vibrate on a native shell built without the plugin, and in a browser', () => {
    const plugin = useNative(capacitor(), { available: false });
    const vibrate = stubVibrate();
    expect(hapticsSupported()).toBe(true);
    haptic('heavy');
    expect(plugin.impact).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(35);
    // A browser never uses the plugin (its web shim throws without vibrate).
    useWeb();
    native.plugin = plugin;
    haptic('medium');
    expect(plugin.impact).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenLastCalledWith(20);
    // Neither imported the package: importing @capacitor/core rewrites window.Capacitor,
    // which a browser (or an app without the plugin) keeps as it is.
    expect(nativeHapticsImportForTests()).toBeNull();
  });

  it('goes through the bridge until the registered interface lands, then through it', async () => {
    const plugin = useNative(capacitor());
    haptic('heavy');
    expect(native.via).toEqual(['bridge:impact']);
    await nativeHapticsImportForTests();
    haptic('medium');
    haptic('success');
    expect(native.via).toEqual(['bridge:impact', 'interface:impact', 'interface:notification']);
    await Promise.resolve();
    expect(plugin.felt).toEqual([
      `impact:${ImpactStyle.Heavy}`,
      `impact:${ImpactStyle.Medium}`,
      `notification:${NotificationType.Success}`,
    ]);
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
      impact: vi.fn((o) => (o.style === 'LIGHT' ? Promise.reject(new Error('no motor')) : sync())),
      notification: vi.fn(() => Promise.reject(new Error('no motor'))),
    };
    function sync() {
      throw new Error('sync boom');
    }
    useNative(rejecting);
    expect(() => {
      haptic('heavy');
      haptic('tick');
      haptic('success');
    }).not.toThrow();
    await Promise.resolve();
    useWeb();
    vi.stubGlobal('navigator', {
      maxTouchPoints: 5,
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => haptic('heavy')).not.toThrow();
    // A plugin missing a method is not an error either.
    useNative({});
    expect(() => haptic('light')).not.toThrow();
  });

  it('is silent when the setting is off, and speaks again when it is back on', () => {
    const plugin = useNative(capacitor());
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
    useNative(capacitor());
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
    const plugin = useNative(capacitor());
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
    useNative(capacitor());
    const first = new SettingsManager();
    bindHapticSettings(first);
    bindHapticSettings(new SettingsManager());
    first.setVibration(false);
    expect(hapticsEnabled()).toBe(true);
  });
});

describe('where the hooks sit', () => {
  it('a strike: light for damage, heavy for a crit, nothing for a miss or no damage', () => {
    const plugin = useNative(capacitor());
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
    const plugin = useNative(capacitor());
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

describe('the package', () => {
  it('is installed, and its registered interface has the calls haptic() makes', async () => {
    const mod = await import('@capacitor/haptics');
    expect(typeof mod.Haptics.impact).toBe('function');
    expect(typeof mod.Haptics.notification).toBe('function');
    expect(mod.ImpactStyle).toEqual(ImpactStyle);
    expect(mod.NotificationType).toEqual(NotificationType);
  });
});
