// The deferred-asset warm-up (utils/assetWarmup.js) runs on the loader of the scene that
// started it, and Phaser drops that loader's queue when the scene shuts down. A scene left
// early hands the warm-up back, and the next scene that asks loads only what is missing.
// Only the title starts one; the route map, Home Base and a battle resume one handed back.
import { describe, it, expect, vi } from 'vitest';
import { startDeferredAssetWarmup } from '../src/utils/assetWarmup.js';

function makeRegistry(initial = {}) {
  const store = new Map(Object.entries(initial));
  return { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
}

/** A scene whose loader finishes a batch only when the test calls finishBatch(). */
function makeScene(registry, audioCache) {
  const shutdown = [];
  let complete = null;
  const queued = [];
  const scene = {
    registry,
    queued,
    cache: { audio: { has: (k) => audioCache.has(k) } },
    textures: { exists: () => false },
    time: { delayedCall: (_ms, fn) => fn() },
    events: { once: (ev, fn) => ev === 'shutdown' && shutdown.push(fn) },
    load: {
      loading: false,
      isLoading() {
        return this.loading;
      },
      audio: vi.fn((key) => queued.push(key)),
      once: (ev, fn) => {
        if (ev === 'complete') complete = fn;
      },
      start() {
        this.loading = true;
      },
    },
    finishBatch(loadedKeys) {
      for (const k of loadedKeys) audioCache.add(k);
      scene.load.loading = false;
      const fn = complete;
      complete = null;
      fn?.();
    },
    shutDown() {
      // Phaser clears the loader's queue and in-flight files here.
      scene.load.loading = false;
      complete = null;
      for (const fn of shutdown) fn();
    },
  };
  return scene;
}

const asset = (key) => ({ type: 'audio', key, src: [`${key}.mp3`], group: 'ui_sfx' });

describe('startDeferredAssetWarmup', () => {
  it('a scene left mid-warm-up hands it back, and the next scene loads only what is missing', () => {
    const audioCache = new Set();
    const registry = makeRegistry({ deferredAssets: ['a', 'b', 'c'].map(asset) });
    const title = makeScene(registry, audioCache);
    startDeferredAssetWarmup(title, { batchSize: 2 });
    expect(title.queued).toEqual(['a', 'b']);
    title.finishBatch(['a']); // only 'a' landed before the player tapped on
    title.shutDown();
    expect(registry.get('deferredAssetWarmupStarted')).toBe(false);

    const battle = makeScene(registry, audioCache);
    startDeferredAssetWarmup(battle, { batchSize: 2, resumeOnly: true });
    expect(battle.queued).toEqual(['b', 'c']);
    battle.finishBatch(['b', 'c']);
    expect(registry.get('deferredAssetWarmupDone')).toBe(true);
    // Done is done: a later scene starts nothing.
    battle.shutDown();
    const map = makeScene(registry, audioCache);
    startDeferredAssetWarmup(map, { resumeOnly: true });
    expect(map.queued).toEqual([]);
  });

  it('a scene reached without the title (a dev route) starts no warm-up of its own', () => {
    const registry = makeRegistry({ deferredAssets: [asset('a')] });
    const battle = makeScene(registry, new Set());
    startDeferredAssetWarmup(battle, { resumeOnly: true });
    expect(battle.queued).toEqual([]);
    expect(registry.get('deferredAssetWarmupStarted')).toBeFalsy();
  });

  it('a warm-up resumed and finished is not handed on again', () => {
    const audioCache = new Set();
    const registry = makeRegistry({ deferredAssets: [asset('a'), asset('b')] });
    const title = makeScene(registry, audioCache);
    startDeferredAssetWarmup(title, { batchSize: 1 });
    title.shutDown();
    const map = makeScene(registry, audioCache);
    startDeferredAssetWarmup(map, { batchSize: 1, resumeOnly: true });
    expect(map.queued).toEqual(['a']);
    // The map leaves too: the battle after it picks the rest up.
    map.shutDown();
    const battle = makeScene(registry, audioCache);
    startDeferredAssetWarmup(battle, { batchSize: 2, resumeOnly: true });
    expect(battle.queued).toEqual(['a', 'b']);
    battle.finishBatch(['a', 'b']);
    battle.finishBatch([]);
    expect(registry.get('deferredAssetWarmupDone')).toBe(true);
    battle.shutDown();
    expect(registry.get('deferredAssetWarmupHandedBack')).toBe(false);
  });

  it('runs once at a time: a second scene asking while one is warming up starts nothing', () => {
    const registry = makeRegistry({ deferredAssets: [asset('a')] });
    const first = makeScene(registry, new Set());
    const second = makeScene(registry, new Set());
    startDeferredAssetWarmup(first);
    startDeferredAssetWarmup(second);
    expect(first.queued).toEqual(['a']);
    expect(second.queued).toEqual([]);
  });

  it('a stub scene with no registry is left alone', () => {
    expect(() => startDeferredAssetWarmup({ registry: {} })).not.toThrow();
    expect(() => startDeferredAssetWarmup(null)).not.toThrow();
  });
});
