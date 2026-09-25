// Page hidden / pagehide / freeze / Capacitor App pause flush the active
// scene's in-memory state and dispatch pending native-mirror writes.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import {
  flushSavesNow,
  installSaveLifecycle,
  registerSaveFlusher,
  getLastSaveFlush,
  _resetSaveLifecycleForTests,
} from '../src/utils/saveLifecycle.js';
import * as mirrorModule from '../src/utils/nativeSaveMirror.js';

class FakeTarget {
  constructor() {
    this.handlers = new Map();
  }
  addEventListener(type, fn) {
    (this.handlers.get(type) || this.handlers.set(type, new Set()).get(type)).add(fn);
  }
  removeEventListener(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }
  dispatch(type) {
    for (const fn of [...(this.handlers.get(type) || [])]) fn({ type });
  }
  count(type) {
    return this.handlers.get(type)?.size || 0;
  }
}

function env({ nativePlugins = null } = {}) {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  doc.visibilityState = 'visible';
  const capListeners = [];
  if (nativePlugins) {
    win.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: () => Promise.resolve(),
      PluginHeaders: nativePlugins.map((name) => ({ name })),
      addListener: (plugin, event, fn) => {
        const handle = { plugin, event, fn, removed: false, remove: () => (handle.removed = true) };
        capListeners.push(handle);
        return handle;
      },
    };
  }
  return { win, doc, capListeners };
}

afterEach(() => {
  _resetSaveLifecycleForTests();
  vi.restoreAllMocks();
});

describe('save lifecycle', () => {
  it('flushes on hidden, pagehide and freeze — not on becoming visible', () => {
    const { win, doc } = env();
    const flush = vi.fn();
    registerSaveFlusher('NodeMap', flush);
    const uninstall = installSaveLifecycle({ win, doc });
    doc.dispatch('visibilitychange'); // still visible
    expect(flush).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    expect(flush).toHaveBeenCalledWith('hidden');
    expect(getLastSaveFlush()).toMatchObject({ reason: 'hidden', ran: ['NodeMap'] });
    uninstall();
    expect(doc.count('visibilitychange') + win.count('pagehide') + doc.count('freeze')).toBe(0);
  });

  it('collapses the hidden → pagehide burst into one flush', () => {
    const { win, doc } = env();
    const flush = vi.fn();
    registerSaveFlusher('NodeMap', flush);
    installSaveLifecycle({ win, doc });
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    win.dispatch('pagehide');
    doc.dispatch('freeze');
    expect(flush).toHaveBeenCalledTimes(1);
    now.mockReturnValue(20_000);
    win.dispatch('pagehide');
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('listens to Capacitor App pause / appStateChange(inactive) when the plugin is native', () => {
    const { win, doc, capListeners } = env({ nativePlugins: ['App', 'Filesystem'] });
    const flush = vi.fn();
    registerSaveFlusher('NodeMap', flush);
    const uninstall = installSaveLifecycle({ win, doc });
    expect(capListeners.map((l) => `${l.plugin}.${l.event}`)).toEqual([
      'App.pause',
      'App.appStateChange',
    ]);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    capListeners[1].fn({ isActive: true });
    expect(flush).not.toHaveBeenCalled();
    capListeners[1].fn({ isActive: false });
    expect(flush).toHaveBeenLastCalledWith('app_inactive');
    now.mockReturnValue(5_000);
    capListeners[0].fn();
    expect(flush).toHaveBeenLastCalledWith('app_pause');
    uninstall();
    expect(capListeners.every((l) => l.removed)).toBe(true);
  });

  it('does not touch Capacitor on the web or without the App plugin', () => {
    const { win, doc, capListeners } = env({ nativePlugins: ['Filesystem'] });
    installSaveLifecycle({ win, doc });
    expect(capListeners).toEqual([]);
  });

  it('dispatches the native mirror after the scene flushers, and survives a throwing flusher', () => {
    const order = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(mirrorModule, 'getNativeSaveMirror').mockReturnValue({
      flush: () => order.push('mirror'),
    });
    registerSaveFlusher('broken', () => {
      throw new Error('boom');
    });
    registerSaveFlusher('NodeMap', () => order.push('scene'));
    expect(flushSavesNow('manual')).toEqual(['NodeMap']);
    expect(order).toEqual(['scene', 'mirror']);
  });

  it('a wall clock set back (manual change, network time) never suppresses a flush', () => {
    const { win, doc } = env();
    const flush = vi.fn();
    registerSaveFlusher('NodeMap', flush);
    installSaveLifecycle({ win, doc });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    win.dispatch('pagehide');
    expect(flush).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 - 3_600_000); // clock moved back an hour
    win.dispatch('pagehide');
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('a collapsed duplicate still dispatches native writes made since the first flush', () => {
    const mirror = { flush: vi.fn() };
    vi.spyOn(mirrorModule, 'getNativeSaveMirror').mockReturnValue(mirror);
    const scene = vi.fn();
    registerSaveFlusher('NodeMap', scene);
    const now = vi.spyOn(Date, 'now').mockReturnValue(50_000);
    flushSavesNow('app_inactive');
    now.mockReturnValue(50_100);
    flushSavesNow('app_pause'); // within the window: scene flushers do not re-run
    expect(scene).toHaveBeenCalledTimes(1);
    expect(mirror.flush).toHaveBeenCalledTimes(2);
  });

  it('unregister removes only its own registration', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerSaveFlusher('NodeMap', first);
    registerSaveFlusher('NodeMap', second); // a newer scene instance
    unregisterFirst();
    flushSavesNow('manual');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('NodeMap lifecycle flusher', () => {
  let NodeMapScene;
  let saveRun;
  // The scene module graph is large; load it once, with room on a busy runner.
  beforeAll(async () => {
    ({ NodeMapScene } = await import('../src/scenes/NodeMapScene.js'));
    ({ saveRun } = await import('../src/engine/RunManager.js'));
  }, 120_000);

  function memoryStorage() {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
    };
  }

  function makeScene(overrides = {}) {
    vi.stubGlobal('localStorage', memoryStorage());
    const runManager = { status: 'active', gold: 10, toJSON: () => ({ gold: runManager.gold }) };
    saveRun(runManager, null, 1); // the scene's own save (entry autosave)
    const scene = Object.create(NodeMapScene.prototype);
    Object.assign(scene, {
      runManager,
      registry: { get: (key) => (key === 'activeSlot' ? 1 : null) },
      persistRunSave: vi.fn(),
      ...overrides,
    });
    return scene;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('saves the route state when the app is backgrounded', () => {
    const scene = makeScene();
    scene._flushRunForLifecycle();
    expect(scene.persistRunSave).toHaveBeenCalledTimes(1);
  });

  it('never overwrites a save made elsewhere since (another tab, a cloud pull)', () => {
    const scene = makeScene();
    const stored = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    localStorage.setItem(
      'emblem_rogue_slot_1_run',
      JSON.stringify({ ...stored, gold: 999, savedAt: stored.savedAt + 5000 }),
    );
    scene._flushRunForLifecycle();
    expect(scene.persistRunSave).not.toHaveBeenCalled();
  });

  it('never resurrects a run ended elsewhere', () => {
    const scene = makeScene();
    localStorage.removeItem('emblem_rogue_slot_1_run');
    scene._flushRunForLifecycle();
    expect(scene.persistRunSave).not.toHaveBeenCalled();
  });

  it.each([
    ['a transition is in flight', { isTransitioning: true }],
    ['a battle is launching', { battleLaunchInFlight: true }],
    ['the scene is shutting down', { _sceneShuttingDown: true }],
    ['the run has ended', { runManager: { status: 'defeat' } }],
    ['no save slot is attached', { registry: { get: () => null } }],
  ])('leaves the save alone when %s', (_label, overrides) => {
    const scene = makeScene(overrides);
    scene._flushRunForLifecycle();
    expect(scene.persistRunSave).not.toHaveBeenCalled();
  });
});
