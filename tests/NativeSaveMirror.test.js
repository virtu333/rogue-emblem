// Native (iOS) save mirror: localStorage stays primary; the Filesystem copy is
// read back before boot to survive WKWebView storage eviction and lost writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIRROR_SENTINEL_KEY,
  NativeSaveMirror,
  collectRecords,
  decodeRecord,
  encodeRecord,
  planRestore,
  readSavedAt,
  recordFileNames,
  shouldMirrorKey,
  startNativeSaveMirror,
  getNativeSaveMirror,
  _resetNativeSaveMirrorForTests,
} from '../src/utils/nativeSaveMirror.js';

class FakeStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
  clear() {
    this.map.clear();
  }
}

/** In-memory stand-in for Library/emblem-rogue-saves (survives "relaunches"). */
function fakeBackend(files = new Map()) {
  return {
    files,
    writes: [],
    failNext: 0,
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.has(name) ? files.get(name) : null;
    },
    write(name, text) {
      if (this.failNext > 0) {
        this.failNext--;
        return Promise.reject(new Error('disk full'));
      }
      this.writes.push(name);
      files.set(name, text);
      return Promise.resolve();
    },
  };
}

// Manual timers so debounce is deterministic.
function manualTimers() {
  let now = 1000;
  const queue = new Map();
  let id = 0;
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      queue.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (timerId) => queue.delete(timerId),
    advance(ms) {
      now += ms;
      for (const [timerId, t] of [...queue]) {
        if (t.at <= now) {
          queue.delete(timerId);
          t.fn();
        }
      }
    },
    pending: () => queue.size,
  };
}

const run = (savedAt, extra = '') => JSON.stringify({ roster: [extra], savedAt });

async function launch(storage, backend, timers = manualTimers()) {
  const mirror = new NativeSaveMirror({ storage, backend, ...timers });
  const result = await mirror.restore();
  return { mirror, result, timers };
}

afterEach(() => {
  _resetNativeSaveMirrorForTests();
  vi.restoreAllMocks();
});

describe('record format', () => {
  it('round-trips values and tombstones and rejects torn or foreign files', () => {
    const text = encodeRecord({ key: 'emblem_rogue_slot_1_run', seq: 3, value: run(42) });
    expect(decodeRecord(text)).toMatchObject({ seq: 3, value: run(42), savedAt: 42 });
    const tomb = decodeRecord(
      encodeRecord({ key: 'emblem_rogue_slot_1_run', seq: 4, value: null }),
    );
    expect(tomb).toMatchObject({ removed: true, value: null });
    expect(decodeRecord(text.slice(0, -3))).toBeNull(); // truncated
    expect(decodeRecord('{"not":"ours"}')).toBeNull();
    expect(decodeRecord('ERSAVE1 {broken\nvalue')).toBeNull();
  });

  it('reads savedAt from the payload tail, falling back to a parse', () => {
    expect(readSavedAt(run(1727270000123))).toBe(1727270000123);
    expect(readSavedAt('{"savedAt":5,"x":1}')).toBe(5);
    expect(readSavedAt('{"x":1}')).toBeNull();
    expect(readSavedAt('not json "savedAt"')).toBeNull();
  });

  it('mirrors game keys only', () => {
    expect(shouldMirrorKey('emblem_rogue_slot_2_meta')).toBe(true);
    expect(shouldMirrorKey('emblem_rogue_settings')).toBe(true);
    expect(shouldMirrorKey('emblem_rogue_startup_flags')).toBe(false);
    expect(shouldMirrorKey(MIRROR_SENTINEL_KEY)).toBe(false);
    expect(shouldMirrorKey('__er_chunk_reload')).toBe(false);
  });

  it('picks the newest valid buffer per key', () => {
    const key = 'emblem_rogue_slot_1_run';
    const [a, b] = recordFileNames(key);
    const files = {
      [a]: encodeRecord({ key, seq: 5, value: run(5) }),
      [b]: encodeRecord({ key, seq: 6, value: run(6) }).slice(0, -2), // torn
    };
    const { records, slots } = collectRecords(files);
    expect(records.get(key).seq).toBe(5);
    expect(slots.get(key)).toBe(a);
  });
});

describe('restore planning', () => {
  const key = 'emblem_rogue_slot_1_run';
  const rec = (value, seq = 1) => decodeRecord(encodeRecord({ key, seq, value }));

  it('evicted store: restores every live record, never a tombstone', () => {
    const records = new Map([
      [key, rec(run(9))],
      ['emblem_rogue_slot_2_run', { ...rec(null), key: 'emblem_rogue_slot_2_run' }],
    ]);
    const plan = planRestore({ local: new Map(), sentinelPresent: false, records });
    expect(plan.evicted).toBe(true);
    expect(plan.restore).toEqual([[key, run(9)]]);
  });

  it('intact store: only a strictly newer save replaces the local copy', () => {
    const records = new Map([[key, rec(run(12))]]);
    const newer = planRestore({
      local: new Map([[key, run(10)]]),
      sentinelPresent: true,
      records,
    });
    expect(newer.restore).toEqual([[key, run(12)]]);
    const older = planRestore({
      local: new Map([[key, run(14)]]),
      sentinelPresent: true,
      records,
    });
    expect(older.restore).toEqual([]);
  });

  it('intact store: a key removed locally is never resurrected', () => {
    const plan = planRestore({
      local: new Map(),
      sentinelPresent: true,
      records: new Map([[key, rec(run(12))]]),
    });
    expect(plan).toEqual({ evicted: false, restore: [] });
  });

  it('keys without savedAt keep the local value', () => {
    const settings = 'emblem_rogue_settings';
    const plan = planRestore({
      local: new Map([[settings, '{"music":1}']]),
      sentinelPresent: true,
      records: new Map([[settings, { ...rec('{"music":0}'), key: settings }]]),
    });
    expect(plan.restore).toEqual([]);
  });
});

describe('NativeSaveMirror', () => {
  const runKey = 'emblem_rogue_slot_1_run';
  const metaKey = 'emblem_rogue_slot_1_meta';

  it('first launch with the mirror: mirrors the existing saves, writes the sentinel', async () => {
    const storage = new FakeStorage({
      [runKey]: run(3),
      [metaKey]: run(2),
      emblem_rogue_startup_flags: '{}',
    });
    const backend = fakeBackend();
    const { mirror, result, timers } = await launch(storage, backend);
    expect(result).toMatchObject({ evicted: false, restored: [] });
    expect(storage.getItem(MIRROR_SENTINEL_KEY)).not.toBeNull();
    timers.advance(0);
    await mirror.writing;
    const { records } = collectRecords(Object.fromEntries(backend.files));
    expect([...records.keys()].sort()).toEqual([metaKey, runKey]);
    expect(records.get(runKey).value).toBe(run(3));
  });

  it('coalesces a burst of saves into one debounced write, alternating buffers', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const { mirror, timers } = await launch(storage, backend);
    const restore = mirror.hookStorage(FakeStorage.prototype, storage);
    try {
      storage.setItem(runKey, run(1));
      storage.setItem(runKey, run(2));
      storage.setItem(runKey, run(3));
      expect(backend.writes).toEqual([]);
      timers.advance(700);
      await mirror.writing;
      expect(backend.writes).toEqual([recordFileNames(runKey)[0]]);
      storage.setItem(runKey, run(4));
      timers.advance(700);
      await mirror.writing;
      expect(backend.writes).toEqual(recordFileNames(runKey));
      const { records } = collectRecords(Object.fromEntries(backend.files));
      expect(records.get(runKey)).toMatchObject({ seq: 2, value: run(4) });
    } finally {
      restore();
    }
  });

  it('keeps writing during a long session (max wait) and writes deletions at once', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const { mirror, timers } = await launch(storage, backend);
    const restore = mirror.hookStorage(FakeStorage.prototype, storage);
    try {
      for (let i = 1; i <= 8; i++) {
        storage.setItem(runKey, run(i));
        timers.advance(500); // never 600ms idle
      }
      await mirror.writing;
      expect(backend.writes.length).toBeGreaterThanOrEqual(1);
      storage.removeItem(runKey);
      timers.advance(0);
      await mirror.writing;
      const { records } = collectRecords(Object.fromEntries(backend.files));
      expect(records.get(runKey).removed).toBe(true);
    } finally {
      restore();
    }
  });

  it('ignores other Storage instances (sessionStorage)', async () => {
    const storage = new FakeStorage();
    const other = new FakeStorage();
    const backend = fakeBackend();
    const { mirror, timers } = await launch(storage, backend);
    const restore = mirror.hookStorage(FakeStorage.prototype, storage);
    try {
      other.setItem(runKey, run(1));
      timers.advance(5000);
      await mirror.writing;
      expect(backend.writes).toEqual([]);
    } finally {
      restore();
    }
  });

  it('flush() dispatches pending writes immediately (app backgrounded)', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const { mirror } = await launch(storage, backend);
    const restore = mirror.hookStorage(FakeStorage.prototype, storage);
    try {
      storage.setItem(runKey, run(7));
      mirror.flush();
      // The bridge call is issued synchronously inside flush().
      expect(backend.writes).toEqual([recordFileNames(runKey)[0]]);
    } finally {
      restore();
    }
  });

  it('retries a failed native write on the next flush', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const { mirror } = await launch(storage, backend);
    const restore = mirror.hookStorage(FakeStorage.prototype, storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      backend.failNext = 1;
      storage.setItem(runKey, run(1));
      await mirror.flush();
      expect(backend.files.size).toBe(0);
      await mirror.flush();
      const { records } = collectRecords(Object.fromEntries(backend.files));
      expect(records.get(runKey).value).toBe(run(1));
    } finally {
      restore();
    }
  });

  it('survives eviction: a relaunch with an empty store restores every save', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const first = await launch(storage, backend);
    const restore = first.mirror.hookStorage(FakeStorage.prototype, storage);
    storage.setItem(runKey, run(20));
    storage.setItem(metaKey, run(19));
    storage.setItem('emblem_rogue_slot_2_run', run(5));
    storage.removeItem('emblem_rogue_slot_2_run'); // ended run: must stay gone
    await first.mirror.flush();
    restore();

    const evicted = new FakeStorage(); // iOS purged the WebKit store
    const { result } = await launch(evicted, backend);
    expect(result.evicted).toBe(true);
    expect(result.restored.sort()).toEqual([metaKey, runKey]);
    expect(evicted.getItem(runKey)).toBe(run(20));
    expect(evicted.getItem('emblem_rogue_slot_2_run')).toBeNull();
    expect(evicted.getItem(MIRROR_SENTINEL_KEY)).not.toBeNull();
  });

  it('recovers a write WebKit lost, never resurrects a deletion it missed', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const first = await launch(storage, backend);
    const restore = first.mirror.hookStorage(FakeStorage.prototype, storage);
    storage.setItem(runKey, run(30));
    storage.setItem('emblem_rogue_slot_3_run', run(8));
    await first.mirror.flush();
    restore();
    // Relaunch: WebKit lost the last run write; slot 3 was deleted but the
    // tombstone never reached the mirror.
    storage.setItem(runKey, run(25));
    storage.removeItem('emblem_rogue_slot_3_run');
    const second = await launch(storage, backend);
    expect(second.result.restored).toEqual([runKey]);
    expect(storage.getItem(runKey)).toBe(run(30));
    expect(storage.getItem('emblem_rogue_slot_3_run')).toBeNull();
    // Reconcile writes the missing tombstone.
    await second.mirror.flush();
    const { records } = collectRecords(Object.fromEntries(backend.files));
    expect(records.get('emblem_rogue_slot_3_run').removed).toBe(true);
  });

  it('a torn newest buffer falls back to the previous record', async () => {
    const storage = new FakeStorage();
    const backend = fakeBackend();
    const first = await launch(storage, backend);
    const restore = first.mirror.hookStorage(FakeStorage.prototype, storage);
    storage.setItem(runKey, run(1));
    await first.mirror.flush();
    storage.setItem(runKey, run(2));
    await first.mirror.flush();
    restore();
    const [, b] = recordFileNames(runKey);
    backend.files.set(b, backend.files.get(b).slice(0, 20)); // killed mid-write
    const evicted = new FakeStorage();
    await launch(evicted, backend);
    expect(evicted.getItem(runKey)).toBe(run(1));
  });
});

describe('startNativeSaveMirror', () => {
  function nativeWindow({ plugins = ['Filesystem'], fs = new Map(), hang = false } = {}) {
    const storage = new FakeStorage();
    class WinStorage extends FakeStorage {}
    Object.setPrototypeOf(storage, WinStorage.prototype);
    const calls = [];
    return {
      calls,
      fs,
      localStorage: storage,
      Storage: WinStorage,
      Capacitor: {
        isNativePlatform: () => true,
        PluginHeaders: plugins.map((name) => ({ name, methods: [] })),
        nativePromise: (plugin, method, options) => {
          calls.push([plugin, method, options?.path]);
          if (hang) return new Promise(() => {});
          if (method === 'readdir') {
            const prefix = `${options.path}/`;
            return Promise.resolve({
              files: [...fs.keys()]
                .filter((p) => p.startsWith(prefix))
                .map((p) => ({ name: p.slice(prefix.length), type: 'file' })),
            });
          }
          if (method === 'readFile') {
            return fs.has(options.path)
              ? Promise.resolve({ data: fs.get(options.path) })
              : Promise.reject(new Error('File does not exist'));
          }
          if (method === 'writeFile') {
            expect(options).toMatchObject({
              directory: 'LIBRARY',
              encoding: 'utf8',
              recursive: true,
            });
            fs.set(options.path, options.data);
            return Promise.resolve({ uri: options.path });
          }
          return Promise.reject(new Error(`unexpected ${method}`));
        },
      },
    };
  }

  it('stays off on the web and without the Filesystem plugin', async () => {
    expect(await startNativeSaveMirror({ win: { localStorage: new FakeStorage() } })).toBeNull();
    const win = nativeWindow({ plugins: ['App'] });
    expect(await startNativeSaveMirror({ win })).toBeNull();
    expect(win.calls).toEqual([]);
    const web = { Capacitor: { isNativePlatform: () => false, nativePromise() {} } };
    expect(await startNativeSaveMirror({ win: web })).toBeNull();
  });

  it('mirrors through the Filesystem plugin and restores after eviction', async () => {
    const win = nativeWindow();
    const mirror = await startNativeSaveMirror({ win });
    expect(mirror).toBe(getNativeSaveMirror());
    win.localStorage.setItem('emblem_rogue_slot_1_run', run(50));
    await mirror.flush();
    expect([...win.fs.keys()]).toEqual(['emblem-rogue-saves/emblem_rogue_slot_1_run.a.txt']);

    _resetNativeSaveMirrorForTests();
    const relaunch = nativeWindow({ fs: win.fs });
    const restored = await startNativeSaveMirror({ win: relaunch });
    expect(restored.lastRestore).toMatchObject({ evicted: true });
    expect(relaunch.localStorage.getItem('emblem_rogue_slot_1_run')).toBe(run(50));
  });

  it('a read-back that times out boots without mirroring and never applies late', async () => {
    vi.useFakeTimers();
    try {
      const win = nativeWindow({ hang: true });
      const pending = startNativeSaveMirror({ win, timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(150);
      expect(await pending).toBeNull();
      expect(getNativeSaveMirror()).toBeNull();
      // Storage was not hooked.
      win.localStorage.setItem('emblem_rogue_slot_1_run', run(1));
      expect(win.calls.filter(([, method]) => method === 'writeFile')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
