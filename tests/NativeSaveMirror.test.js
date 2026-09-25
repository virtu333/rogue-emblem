// Native (iOS) save mirror: localStorage stays primary; the Filesystem copy is
// read back before boot to survive WKWebView storage eviction and lost writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIRROR_SENTINEL_KEY,
  NativeSaveMirror,
  collectRecords,
  createFilesystemBackend,
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

  it('a tombstone carries the stamp of the save it deleted; older tombstones decode without it', () => {
    const key = 'emblem_rogue_slot_1_run';
    const stamped = encodeRecord({ key, seq: 4, value: null, deletedSavedAt: 42 });
    expect(decodeRecord(stamped)).toEqual({
      key,
      seq: 4,
      removed: true,
      value: null,
      savedAt: null,
      deletedSavedAt: 42,
    });
    // The field is optional in the header: a record written before it existed
    // (same magic, no deletedSavedAt) still decodes.
    const legacy =
      'ERSAVE1 {"key":"emblem_rogue_slot_1_run","seq":2,"removed":true,"length":0,"savedAt":null}\n';
    expect(decodeRecord(legacy)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: null });
    // A live record never carries it, whatever the caller passes.
    expect(
      decodeRecord(encodeRecord({ key, seq: 5, value: run(9), deletedSavedAt: 42 })),
    ).toMatchObject({ savedAt: 9, deletedSavedAt: null });
    // Unknown stamps are left out rather than written as null/NaN.
    expect(encodeRecord({ key, seq: 6, value: null })).not.toContain('deletedSavedAt');
    expect(encodeRecord({ key, seq: 6, value: null, deletedSavedAt: NaN })).not.toContain(
      'deletedSavedAt',
    );
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
    expect(plan).toEqual({ evicted: false, restore: [], remove: [] });
  });

  // A deletion WebKit lost: the newest native record is a tombstone while the
  // intact store still holds a value for the key.
  describe('tombstone vs a present local value', () => {
    const tomb = (deletedSavedAt, seq = 2) =>
      decodeRecord(encodeRecord({ key, seq, value: null, deletedSavedAt }));
    const plan = (record, localValue, sentinelPresent = true) =>
      planRestore({
        local: new Map(localValue === undefined ? [] : [[key, localValue]]),
        sentinelPresent,
        records: new Map([[key, record]]),
      });

    it('the deleted save itself (savedAt equal) is removed', () => {
      expect(plan(tomb(10), run(10))).toEqual({ evicted: false, restore: [], remove: [key] });
    });

    it('a save older than the deleted one is removed', () => {
      expect(plan(tomb(10), run(7)).remove).toEqual([key]);
    });

    it('a save made after the deletion is kept', () => {
      expect(plan(tomb(10), run(11))).toEqual({ evicted: false, restore: [], remove: [] });
    });

    it('a legacy tombstone without deletedSavedAt keeps the local value', () => {
      expect(tomb(null).deletedSavedAt).toBeNull();
      expect(plan(tomb(null), run(10)).remove).toEqual([]);
      expect(plan(tomb(undefined), run(10)).remove).toEqual([]);
    });

    it('a local value without savedAt is kept', () => {
      expect(plan(tomb(10), '{"music":0}').remove).toEqual([]);
      expect(plan(tomb(10), 'not json').remove).toEqual([]);
    });

    it('a stamped local value under a stampless tombstone (settings, flags) is kept', () => {
      const settings = 'emblem_rogue_settings';
      const record = { ...tomb(null), key: settings };
      const result = planRestore({
        local: new Map([[settings, '{"music":1,"savedAt":5}']]),
        sentinelPresent: true,
        records: new Map([[settings, record]]),
      });
      expect(result.remove).toEqual([]);
    });

    it('nothing local: the tombstone stays deleted, evicted or not', () => {
      expect(plan(tomb(10), undefined, true)).toEqual({ evicted: false, restore: [], remove: [] });
      expect(plan(tomb(10), undefined, false)).toEqual({ evicted: true, restore: [], remove: [] });
    });

    it('evicted store still holding a stale copy (sentinel never re-set): removed too', () => {
      expect(plan(tomb(10), run(10), false)).toEqual({ evicted: true, restore: [], remove: [key] });
      expect(plan(tomb(10), run(12), false).remove).toEqual([]);
    });

    it('a live newest record never removes anything', () => {
      const live = decodeRecord(encodeRecord({ key, seq: 3, value: run(12) }));
      expect(live.deletedSavedAt).toBeNull();
      expect(plan(live, run(10)).remove).toEqual([]);
      expect(plan(live, run(14)).remove).toEqual([]);
    });
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

// Review of the iOS persistence change: paths that could lose or regress a
// save. Each test failed before its fix.
describe('data-loss regressions', () => {
  const runKey = 'emblem_rogue_slot_1_run';
  const metaKey = 'emblem_rogue_slot_1_meta';

  /** Storage whose setItem throws a WebKit-style quota error for chosen keys. */
  class QuotaStorage extends FakeStorage {
    constructor(entries, fullFor = new Set()) {
      super(entries);
      this.fullFor = fullFor;
    }
    setItem(key, value) {
      if (this.fullFor.has(key)) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      super.setItem(key, value);
    }
  }

  async function mirrored(entries) {
    const backend = fakeBackend();
    const { mirror, timers } = await launch(new FakeStorage(entries), backend);
    timers.advance(0);
    await mirror.writing;
    return backend;
  }

  it('evicted store: a save that cannot be written back stays mirrored and is retried', async () => {
    const backend = await mirrored({ [runKey]: run(40), [metaKey]: run(39) });
    // iOS evicted WebKit's store; restoring the run hits the quota this launch.
    const full = new QuotaStorage({}, new Set([runKey]));
    const second = await launch(full, backend);
    expect(full.getItem(metaKey)).toBe(run(39));
    expect(full.getItem(runKey)).toBeNull();
    second.timers.advance(5000);
    await second.mirror.writing;
    // Reconcile must not tombstone the only copy of the run...
    const { records } = collectRecords(Object.fromEntries(backend.files));
    expect(records.get(runKey)).toMatchObject({ removed: false, value: run(40) });
    // ...and the next launch still treats the store as evicted and restores it.
    expect(full.getItem(MIRROR_SENTINEL_KEY)).toBeNull();
    full.fullFor.clear();
    await launch(full, backend);
    expect(full.getItem(runKey)).toBe(run(40));
  });

  it('intact store: a newer mirrored save that cannot be written back is not overwritten', async () => {
    const backend = await mirrored({ [runKey]: run(50) });
    // WebKit lost the newest write (local is older), and restoring hits the quota.
    const storage = new QuotaStorage(
      { [runKey]: run(45), [MIRROR_SENTINEL_KEY]: '1' },
      new Set([runKey]),
    );
    const second = await launch(storage, backend);
    second.timers.advance(5000);
    await second.mirror.writing;
    const { records } = collectRecords(Object.fromEntries(backend.files));
    expect(records.get(runKey).value).toBe(run(50));
  });

  /** Backend whose writes stay in flight until the test settles them in order. */
  function deferredBackend() {
    const files = new Map();
    const inflight = [];
    return {
      files,
      inflight,
      async list() {
        return [...files.keys()];
      },
      async read(name) {
        return files.has(name) ? files.get(name) : null;
      },
      write(name, text) {
        return new Promise((resolve, reject) => inflight.push({ name, text, resolve, reject }));
      },
      /** Settle the oldest write (the bridge runs plugin calls in order). */
      settle(outcome) {
        const w = inflight.shift();
        if (outcome === 'ok') {
          files.set(w.name, w.text);
          w.resolve();
          return;
        }
        // writeFile is not atomic: a failed or killed write leaves a torn file.
        files.set(w.name, w.text.slice(0, Math.floor(w.text.length / 2)));
        if (outcome === 'fail') w.reject(new Error('No space left on device'));
      },
    };
  }

  it('overlapping writes never overwrite the last good buffer', async () => {
    const storage = new FakeStorage();
    const backend = deferredBackend();
    const { mirror } = await launch(storage, backend);
    const restore = mirror.hookStorage(FakeStorage.prototype, storage);
    try {
      storage.setItem(runKey, run(1));
      mirror.flush();
      backend.settle('ok'); // v1 on disk
      await mirror.writing;
      storage.setItem(runKey, run(2));
      mirror.flush(); // v2 in flight...
      storage.setItem(runKey, run(3));
      mirror.flush(); // ...v3 dispatched before v2 settled (app backgrounded)
      backend.settle('fail'); // disk full: v2 fails and tears its file
      backend.settle('killed'); // the app is killed while v3 is written
    } finally {
      restore();
    }
    const evicted = new FakeStorage();
    await launch(evicted, { ...backend, write: () => Promise.resolve() });
    // A complete save survives (v1 at least) — never nothing.
    expect(evicted.getItem(runKey)).toBe(run(1));
  });

  it('a folder that exists but cannot be listed fails the read-back instead of reading as empty', async () => {
    const calls = [];
    const broken = {
      nativePromise: (plugin, method) => {
        calls.push(method);
        if (method === 'mkdir') return Promise.reject(new Error('Directory already exists.'));
        return Promise.reject(new Error('The operation could not be completed.'));
      },
    };
    await expect(createFilesystemBackend(broken).list()).rejects.toThrow();
    expect(calls).toEqual(['readdir', 'mkdir']);
    // First launch: the folder does not exist yet — creating it proves that.
    const fresh = {
      nativePromise: (plugin, method) =>
        method === 'mkdir' ? Promise.resolve() : Promise.reject(new Error('does not exist')),
    };
    await expect(createFilesystemBackend(fresh).list()).resolves.toEqual([]);
  });

  /** Filesystem plugin over the fake backend's files (folder exists). */
  function capOver(files, state) {
    const prefix = 'emblem-rogue-saves/';
    return {
      nativePromise: (plugin, method, options) => {
        if (method === 'readdir')
          return state.failReaddir
            ? Promise.reject(new Error('The operation could not be completed.'))
            : Promise.resolve({ files: [...files.keys()].map((name) => ({ name })) });
        if (method === 'mkdir') return Promise.reject(new Error('Directory already exists.'));
        if (method === 'readFile') {
          const name = options.path.slice(prefix.length);
          return files.has(name)
            ? Promise.resolve({ data: files.get(name) })
            : Promise.reject(new Error('does not exist'));
        }
        if (method === 'writeFile') {
          files.set(options.path.slice(prefix.length), options.data);
          return Promise.resolve({});
        }
        return Promise.reject(new Error(`unexpected ${method}`));
      },
    };
  }

  it('evicted store + a failed listing: the following launch still restores every save', async () => {
    const { files } = await mirrored({ [runKey]: run(60), [metaKey]: run(59) });
    const state = { failReaddir: true };
    const backend = createFilesystemBackend(capOver(files, state));
    const evicted = new FakeStorage();
    // Launch 1: the WebKit store was evicted and the listing fails once.
    const first = await launch(evicted, backend).catch(() => null);
    if (first) {
      first.timers.advance(5000);
      await first.mirror.writing;
    }
    expect(evicted.getItem(MIRROR_SENTINEL_KEY)).toBeNull();
    // Launch 2: the listing works; the saves must come back, not be tombstoned.
    state.failReaddir = false;
    const second = await launch(evicted, backend);
    second.timers.advance(5000);
    await second.mirror.writing;
    expect(evicted.getItem(runKey)).toBe(run(60));
    expect(evicted.getItem(metaKey)).toBe(run(59));
  });

  it('evicted store + a mirror file that fails to read: it is restored on a later launch', async () => {
    const backend = await mirrored({ [runKey]: run(70), [metaKey]: run(69) });
    const readOk = backend.read;
    const [a] = recordFileNames(runKey);
    backend.read = async (name) => (name === a ? null : readOk.call(backend, name));
    const evicted = new FakeStorage();
    const first = await launch(evicted, backend);
    expect(evicted.getItem(metaKey)).toBe(run(69));
    expect(evicted.getItem(runKey)).toBeNull();
    first.timers.advance(5000);
    await first.mirror.writing;
    backend.read = readOk;
    const second = await launch(evicted, backend);
    second.timers.advance(5000);
    await second.mirror.writing;
    expect(evicted.getItem(runKey)).toBe(run(70));
  });
});

// A deletion WebKit lost: the run ended (or the slot was deleted) and the
// tombstone reached native storage, but the process died before WebKit
// flushed the removal, so on relaunch localStorage still holds the old save
// with its sentinel intact. Before the fix the stale save was kept and the
// reconcile mirrored it back over the tombstone, so an ended run came back.
describe('lost deletions', () => {
  const runKey = 'emblem_rogue_slot_1_run';
  const metaKey = 'emblem_rogue_slot_1_meta';
  const newest = (backend, key) =>
    collectRecords(Object.fromEntries(backend.files)).records.get(key);

  /** A session: launch over `backend`, hook storage, run `play`, unhook. */
  async function session(storage, backend, play) {
    const { mirror, timers } = await launch(storage, backend);
    const unhook = mirror.hookStorage(FakeStorage.prototype, storage);
    try {
      await play({ mirror, timers });
    } finally {
      unhook();
    }
    return mirror;
  }

  /** Relaunch over `backend` with `entries` still in the (intact) store. */
  async function relaunch(backend, entries) {
    const storage = new FakeStorage({ [MIRROR_SENTINEL_KEY]: '1', ...entries });
    const { mirror, result, timers } = await launch(storage, backend);
    timers.advance(5000);
    await mirror.writing;
    return { storage, mirror, result };
  }

  it("reviewers' repro: an ended run whose removal WebKit lost stays ended", async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      await mirror.flush();
      mirror.storage.removeItem(runKey); // run over
      await mirror.flush();
    });
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: 10 });
    // Relaunch: WebKit never flushed the removal.
    const { storage, result } = await relaunch(backend, { [runKey]: run(10) });
    expect(result).toMatchObject({ evicted: false, restored: [], removed: [runKey] });
    expect(storage.getItem(runKey)).toBeNull();
    expect(storage.getItem(MIRROR_SENTINEL_KEY)).not.toBeNull();
    // The tombstone was not superseded by a live copy of the stale save.
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true });
    // And the removal stays applied on the launch after that.
    const again = await relaunch(backend, {});
    expect(again.storage.getItem(runKey)).toBeNull();
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true });
  });

  it('a run started after the deletion is kept and mirrored above the tombstone', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      await mirror.flush();
      mirror.storage.removeItem(runKey);
      await mirror.flush();
      mirror.storage.setItem(runKey, run(20, 'new run')); // its native write is lost
    });
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: 10 });
    const { storage, result } = await relaunch(backend, { [runKey]: run(20, 'new run') });
    expect(result).toMatchObject({ evicted: false, restored: [] });
    expect(result.removed).toBeUndefined();
    expect(storage.getItem(runKey)).toBe(run(20, 'new run'));
    expect(newest(backend, runKey)).toMatchObject({
      seq: 3,
      removed: false,
      value: run(20, 'new run'),
    });
  });

  it('a save the debounce coalesced away still dates the tombstone', async () => {
    // save 10 reached disk; save 11 was still debounced when the run ended.
    // WebKit kept 11 but lost the removal: 11 is the deleted save, not a newer one.
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      await mirror.flush();
      mirror.storage.setItem(runKey, run(11));
      mirror.storage.removeItem(runKey);
      await mirror.flush();
    });
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: 11 });
    const { storage } = await relaunch(backend, { [runKey]: run(11) });
    expect(storage.getItem(runKey)).toBeNull();
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true });
  });

  it('a run created and ended within one debounce gets a tombstone that dates it', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(30));
      mirror.storage.removeItem(runKey); // no live record was ever written
      await mirror.flush();
    });
    expect(newest(backend, runKey)).toMatchObject({ seq: 1, removed: true, deletedSavedAt: 30 });
    const { storage } = await relaunch(backend, { [runKey]: run(30) });
    expect(storage.getItem(runKey)).toBeNull();
  });

  it('a key that never reached disk and has no stamp is not tombstoned', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem('emblem_rogue_active_slot', '2');
      mirror.storage.removeItem('emblem_rogue_active_slot');
      await mirror.flush();
    });
    expect(backend.files.size).toBe(0);
  });

  it('deleted slot: stale run and meta are both removed on relaunch', async () => {
    const backend = fakeBackend();
    const floorKey = 'emblem_rogue_slot_1_run_clock_floor';
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      mirror.storage.setItem(metaKey, run(9));
      mirror.storage.setItem(floorKey, '5');
      await mirror.flush();
      // SlotManager.deleteSlot
      for (const key of [metaKey, runKey, floorKey]) mirror.storage.removeItem(key);
      await mirror.flush();
    });
    expect(newest(backend, metaKey)).toMatchObject({ removed: true, deletedSavedAt: 9 });
    expect(newest(backend, runKey)).toMatchObject({ removed: true, deletedSavedAt: 10 });
    expect(newest(backend, floorKey)).toMatchObject({ removed: true, deletedSavedAt: null });
    const { storage, result } = await relaunch(backend, {
      [runKey]: run(10),
      [metaKey]: run(9),
      [floorKey]: '5',
    });
    expect(result.removed.sort()).toEqual([metaKey, runKey]);
    expect(storage.getItem(runKey)).toBeNull();
    expect(storage.getItem(metaKey)).toBeNull();
    // Unordered keys keep the local value (and are mirrored back as before).
    expect(storage.getItem(floorKey)).toBe('5');
    expect(newest(backend, floorKey)).toMatchObject({ removed: false, value: '5' });
    // A new slot in the same place is mirrored live above both tombstones.
    await session(storage, backend, async ({ mirror }) => {
      mirror.storage.setItem(metaKey, run(40));
      mirror.storage.setItem(runKey, run(41));
      await mirror.flush();
    });
    expect(newest(backend, runKey)).toMatchObject({ seq: 3, removed: false, savedAt: 41 });
    expect(newest(backend, metaKey)).toMatchObject({ seq: 3, removed: false, savedAt: 40 });
  });

  it('legacy tombstone (no deletedSavedAt) + a present local save: the save is kept', async () => {
    const backend = fakeBackend();
    const [a, b] = recordFileNames(runKey);
    backend.files.set(a, encodeRecord({ key: runKey, seq: 1, value: run(10) }));
    backend.files.set(b, encodeRecord({ key: runKey, seq: 2, value: null })); // pre-field build
    const { storage, result } = await relaunch(backend, { [runKey]: run(10) });
    // Order cannot be proven (this could equally be a new run whose native
    // write was lost), so nothing is deleted; the save is mirrored live again
    // and from here on every tombstone carries its stamp.
    expect(result.removed).toBeUndefined();
    expect(storage.getItem(runKey)).toBe(run(10));
    expect(newest(backend, runKey)).toMatchObject({ seq: 3, removed: false, savedAt: 10 });
    await session(storage, backend, async ({ mirror }) => {
      mirror.storage.removeItem(runKey);
      await mirror.flush();
    });
    expect(newest(backend, runKey)).toMatchObject({ seq: 4, removed: true, deletedSavedAt: 10 });
  });

  it('evicted store + tombstone: the deletion stays deleted', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      mirror.storage.setItem(metaKey, run(9));
      await mirror.flush();
      mirror.storage.removeItem(runKey);
      await mirror.flush();
    });
    const evicted = new FakeStorage();
    const { mirror, result, timers } = await launch(evicted, backend);
    timers.advance(5000);
    await mirror.writing;
    expect(result).toMatchObject({ evicted: true, restored: [metaKey] });
    expect(evicted.getItem(runKey)).toBeNull();
    expect(evicted.getItem(metaKey)).toBe(run(9));
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: 10 });
  });

  it('a deletion the mirror missed is tombstoned with the stamp it had mirrored', async () => {
    // Intact store, key gone locally, live native record: the reconcile
    // tombstone dates the deletion by the mirrored save.
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      await mirror.flush();
    });
    await relaunch(backend, {});
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: 10 });
    // ...which a later launch still holding that save honors.
    const { storage } = await relaunch(backend, { [runKey]: run(10) });
    expect(storage.getItem(runKey)).toBeNull();
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true });
  });

  it('a torn tombstone leaves the last live record in force', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      await mirror.flush();
      mirror.storage.removeItem(runKey);
      await mirror.flush();
    });
    const [, b] = recordFileNames(runKey);
    backend.files.set(b, backend.files.get(b).slice(0, 30)); // killed mid-write
    // The deletion reached neither store durably: the save is (rightly) still there.
    const { storage } = await relaunch(backend, { [runKey]: run(10) });
    expect(storage.getItem(runKey)).toBe(run(10));
    // With the removal in the store, the reconcile tombstone goes to the torn buffer.
    const gone = await relaunch(backend, {});
    expect(gone.storage.getItem(runKey)).toBeNull();
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true, deletedSavedAt: 10 });
  });

  it('a stale save that cannot be removed is left out of the reconcile', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      await mirror.flush();
      mirror.storage.removeItem(runKey);
      await mirror.flush();
    });
    class StuckStorage extends FakeStorage {
      removeItem(key) {
        if (key === runKey) throw new Error('SecurityError');
        super.removeItem(key);
      }
    }
    const storage = new StuckStorage({ [MIRROR_SENTINEL_KEY]: '1', [runKey]: run(10) });
    const { mirror, result, timers } = await launch(storage, backend);
    timers.advance(5000);
    await mirror.writing;
    expect(result).toMatchObject({ unremoved: [runKey] });
    expect(result.removed).toBeUndefined();
    expect(newest(backend, runKey)).toMatchObject({ seq: 2, removed: true });
  });

  it('clear() dates every tombstone by the values it wiped', async () => {
    const backend = fakeBackend();
    await session(new FakeStorage(), backend, async ({ mirror }) => {
      mirror.storage.setItem(runKey, run(10));
      mirror.storage.setItem(metaKey, run(9));
      await mirror.flush();
      mirror.storage.setItem(runKey, run(12)); // still debounced
      mirror.storage.clear();
      await mirror.flush();
    });
    expect(newest(backend, runKey)).toMatchObject({ removed: true, deletedSavedAt: 12 });
    expect(newest(backend, metaKey)).toMatchObject({ removed: true, deletedSavedAt: 9 });
  });
});
