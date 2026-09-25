// Native save mirror for the iOS (Capacitor) app.
//
// localStorage stays the primary, synchronous save store everywhere. In the
// packaged iOS app WKWebView keeps it in WebKit's website-data store, which iOS
// may evict under storage pressure, and whose most recent writes can be lost if
// the process is killed before WebKit flushes them. When the native Filesystem
// plugin is present, every game key written to localStorage is mirrored to
// Library/emblem-rogue-saves/ (backed up with the device, never evicted), and
// read back before the game boots:
//
//  - localStorage evicted (its sentinel key is gone) → every mirrored key is
//    restored, deletions (tombstones) stay deleted.
//  - localStorage intact → only a strictly newer run/meta save (by its
//    monotonic `savedAt`) replaces the local copy (a write WebKit lost). A key
//    missing locally is never resurrected: it was deliberately removed.
//
// Each key is double-buffered in two files (A/B) with a header carrying a
// sequence number and the value length, so a write torn by a kill leaves the
// previous record intact. Web builds never construct a mirror (no native
// bridge), so their behavior is unchanged.

export const MIRROR_DIRECTORY = 'LIBRARY';
export const MIRROR_FOLDER = 'emblem-rogue-saves';
export const MIRROR_KEY_PREFIX = 'emblem_rogue_';
export const MIRROR_SENTINEL_KEY = 'emblem_rogue_storage_sentinel';
const RECORD_MAGIC = 'ERSAVE1';
// Diagnostics, one-shot flags and dev fixtures: not worth native writes.
const UNMIRRORED_KEYS = new Set([
  'emblem_rogue_startup_flags',
  'emblem_rogue_audio_diag',
  'emblem_rogue_dev_meta',
  MIRROR_SENTINEL_KEY,
]);
const WRITE_DEBOUNCE_MS = 600;
const WRITE_MAX_WAIT_MS = 3000;

export function shouldMirrorKey(key) {
  return typeof key === 'string' && key.startsWith(MIRROR_KEY_PREFIX) && !UNMIRRORED_KEYS.has(key);
}

// --- Record encoding -------------------------------------------------------

export function encodeRecord({ key, seq, value }) {
  const removed = value === null || value === undefined;
  const body = removed ? '' : String(value);
  const header = { key, seq, removed, length: body.length, savedAt: readSavedAt(body) };
  return `${RECORD_MAGIC} ${JSON.stringify(header)}\n${body}`;
}

/** Parse one mirror file; null for torn, foreign or corrupt content. */
export function decodeRecord(text) {
  if (typeof text !== 'string' || !text.startsWith(`${RECORD_MAGIC} `)) return null;
  const newline = text.indexOf('\n');
  if (newline < 0) return null;
  let header;
  try {
    header = JSON.parse(text.slice(RECORD_MAGIC.length + 1, newline));
  } catch {
    return null;
  }
  if (
    !header ||
    typeof header.key !== 'string' ||
    !Number.isSafeInteger(header.seq) ||
    header.seq < 1 ||
    !Number.isSafeInteger(header.length)
  )
    return null;
  const body = text.slice(newline + 1);
  if (body.length !== header.length) return null; // torn write
  return {
    key: header.key,
    seq: header.seq,
    removed: header.removed === true,
    value: header.removed === true ? null : body,
    savedAt: Number.isFinite(header.savedAt) ? header.savedAt : null,
  };
}

/** Monotonic save stamp of a run/meta payload (null when absent or not JSON). */
export function readSavedAt(value) {
  if (typeof value !== 'string' || !value.includes('"savedAt"')) return null;
  // Run and meta saves write savedAt as their last top-level key: read the
  // tail instead of parsing a payload that can reach a megabyte.
  const tail = /"savedAt":(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\}\s*$/.exec(value.slice(-96));
  if (tail) return Number(tail[1]);
  try {
    const parsed = JSON.parse(value);
    return Number.isFinite(parsed?.savedAt) ? parsed.savedAt : null;
  } catch {
    return null;
  }
}

export function recordFileNames(key) {
  const base = encodeURIComponent(key);
  return [`${base}.a.txt`, `${base}.b.txt`];
}

/** Newest valid record per key from { fileName: text } (either buffer may be torn). */
export function collectRecords(files) {
  const records = new Map();
  const slots = new Map();
  for (const [name, text] of Object.entries(files || {})) {
    const record = decodeRecord(text);
    if (!record) continue;
    const [a, b] = recordFileNames(record.key);
    if (name !== a && name !== b) continue;
    const current = records.get(record.key);
    if (!current || record.seq > current.seq) {
      records.set(record.key, record);
      slots.set(record.key, name);
    }
  }
  return { records, slots };
}

/**
 * Decide what the launch read-back restores into localStorage.
 * @param {{ local: Map<string,string>, sentinelPresent: boolean, records: Map<string,object> }} input
 * @returns {{ evicted: boolean, restore: Array<[string,string]> }}
 */
export function planRestore({ local, sentinelPresent, records }) {
  const evicted = !sentinelPresent && records.size > 0;
  const restore = [];
  for (const [key, record] of records) {
    if (!shouldMirrorKey(key) || record.removed) continue;
    const current = local.get(key);
    if (current === undefined || current === null) {
      // Missing locally: restore only when the whole store was evicted.
      if (evicted) restore.push([key, record.value]);
      continue;
    }
    if (current === record.value) continue;
    const localStamp = readSavedAt(current);
    if (
      Number.isFinite(record.savedAt) &&
      Number.isFinite(localStamp) &&
      record.savedAt > localStamp
    )
      restore.push([key, record.value]);
  }
  return { evicted, restore };
}

// --- Native backend --------------------------------------------------------

/** The injected Capacitor bridge on a native platform, or null (web). */
export function nativeCapacitor(win = globalThis) {
  const cap = win?.Capacitor;
  if (!cap || typeof cap.nativePromise !== 'function') return null;
  try {
    if (cap.isNativePlatform?.() !== true) return null;
  } catch {
    return null;
  }
  return cap;
}

export function hasNativePlugin(cap, name) {
  return Array.isArray(cap?.PluginHeaders) && cap.PluginHeaders.some((h) => h?.name === name);
}

/** Filesystem plugin calls through the bridge (no plugin JS in the bundle). */
export function createFilesystemBackend(cap) {
  const call = (method, options) => cap.nativePromise('Filesystem', method, options);
  const path = (name) => `${MIRROR_FOLDER}/${name}`;
  return {
    async list() {
      try {
        const result = await call('readdir', { path: MIRROR_FOLDER, directory: MIRROR_DIRECTORY });
        return (result?.files || [])
          .map((file) => (typeof file === 'string' ? file : file?.name))
          .filter((name) => typeof name === 'string');
      } catch {
        return []; // folder not created yet
      }
    },
    async read(name) {
      try {
        const result = await call('readFile', {
          path: path(name),
          directory: MIRROR_DIRECTORY,
          encoding: 'utf8',
        });
        return typeof result?.data === 'string' ? result.data : null;
      } catch {
        return null;
      }
    },
    write(name, text) {
      return call('writeFile', {
        path: path(name),
        data: text,
        directory: MIRROR_DIRECTORY,
        encoding: 'utf8',
        recursive: true,
      });
    },
  };
}

// --- Mirror ----------------------------------------------------------------

export class NativeSaveMirror {
  /**
   * @param {{ storage: Storage, backend: object, log?: Function,
   *   setTimer?: Function, clearTimer?: Function, now?: Function }} options
   */
  constructor({
    storage,
    backend,
    log = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    now = () => Date.now(),
  }) {
    Object.assign(this, { storage, backend, log, setTimer, clearTimer, now });
    this.cancelled = false;
    this.records = new Map(); // key → { seq, value, slot }
    this.dirty = new Set();
    this.active = false;
    this.timer = null;
    this.firstDirtyAt = 0;
    this.writing = Promise.resolve();
    this.lastRestore = null;
  }

  /** Abandon a read-back that took too long: it must never apply late. */
  cancel() {
    this.cancelled = true;
    this.active = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.dirty.clear();
  }

  /** Read the native copy back; call before the game reads any save. */
  async restore() {
    const names = await this.backend.list();
    const files = {};
    for (const name of names) {
      if (this.cancelled) return null;
      if (!name.endsWith('.txt')) continue;
      const text = await this.backend.read(name);
      if (text !== null) files[name] = text;
    }
    // Everything below is synchronous: it applies entirely or (cancelled) not at all.
    if (this.cancelled) return null;
    const { records, slots } = collectRecords(files);
    const local = new Map();
    for (const key of this.localKeys()) local.set(key, this.storage.getItem(key));
    const sentinelPresent = this.storage.getItem(MIRROR_SENTINEL_KEY) !== null;
    const plan = planRestore({ local, sentinelPresent, records });
    for (const [key, value] of plan.restore) {
      try {
        this.storage.setItem(key, value);
        local.set(key, value);
      } catch (error) {
        this.log('restore_write_failed', { key, error: error?.message || String(error) });
      }
    }
    for (const [key, record] of records)
      this.records.set(key, { seq: record.seq, value: record.value, slot: slots.get(key) });
    try {
      if (!sentinelPresent) this.storage.setItem(MIRROR_SENTINEL_KEY, String(this.now()));
    } catch {
      /* quota: the next launch treats storage as evicted and restores again */
    }
    // Reconcile: mirror every local key that differs, tombstone every record
    // whose key is gone locally (a removal the mirror missed).
    for (const [key, value] of local) {
      if (shouldMirrorKey(key) && this.records.get(key)?.value !== value) this.dirty.add(key);
    }
    for (const [key, record] of this.records) {
      if (!local.has(key) && record.value !== null) this.dirty.add(key);
    }
    this.lastRestore = {
      evicted: plan.evicted,
      restored: plan.restore.map(([key]) => key),
      records: records.size,
    };
    this.log('restore', this.lastRestore);
    this.active = true;
    if (this.dirty.size) this.schedule(0);
    return this.lastRestore;
  }

  localKeys() {
    const keys = [];
    const length = Number(this.storage.length) || 0;
    for (let i = 0; i < length; i++) {
      const key = this.storage.key(i);
      if (shouldMirrorKey(key)) keys.push(key);
    }
    return keys;
  }

  noteWrite(key) {
    if (!this.active || !shouldMirrorKey(key)) return;
    this.dirty.add(key);
    this.schedule(WRITE_DEBOUNCE_MS);
  }

  noteRemove(key) {
    if (!this.active || !shouldMirrorKey(key)) return;
    this.dirty.add(key);
    // A deletion (ended run, deleted slot) must not linger as a live copy.
    this.schedule(0);
  }

  noteClear() {
    if (!this.active) return;
    for (const key of this.records.keys()) this.dirty.add(key);
    this.schedule(0);
  }

  schedule(delay) {
    if (!this.dirty.size) return;
    const now = this.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    const wait = Math.max(0, Math.min(delay, this.firstDirtyAt + WRITE_MAX_WAIT_MS - now));
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /**
   * Write every dirty key now (lifecycle: page hidden / app paused). Values are
   * read at flush time, so bursts of saves coalesce into one native write.
   */
  flush() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.firstDirtyAt = 0;
    if (!this.active || !this.dirty.size) return this.writing;
    const keys = [...this.dirty];
    this.dirty.clear();
    const writes = [];
    for (const key of keys) {
      let value;
      try {
        value = this.storage.getItem(key);
      } catch {
        this.dirty.add(key);
        continue;
      }
      const previous = this.records.get(key);
      if (previous && previous.value === value) continue;
      if (!previous && value === null) continue;
      const seq = (previous?.seq || 0) + 1;
      const [a, b] = recordFileNames(key);
      // Overwrite the buffer that does not hold the newest record.
      const slot = previous?.slot === a ? b : a;
      const record = { seq, value, slot };
      this.records.set(key, record);
      const failed = (error) => {
        this.log('write_failed', { key, error: error?.message || String(error) });
        if (this.records.get(key) !== record) return;
        // Keep the last good record's slot; retry on the next flush.
        if (previous) this.records.set(key, previous);
        else this.records.delete(key);
        this.dirty.add(key);
      };
      // Dispatch now: the bridge message leaves JS synchronously, so a page
      // suspended right after a lifecycle flush cannot hold it back.
      try {
        writes.push(
          Promise.resolve(this.backend.write(slot, encodeRecord({ key, seq, value }))).catch(
            failed,
          ),
        );
      } catch (error) {
        failed(error);
      }
    }
    this.writing = Promise.all([this.writing, ...writes]).then(() => undefined);
    return this.writing;
  }

  /** Route Storage mutations of `target` through the mirror (patches the prototype). */
  hookStorage(proto, target) {
    const mirror = this;
    const originalSet = proto.setItem;
    const originalRemove = proto.removeItem;
    const originalClear = proto.clear;
    proto.setItem = function setItem(key, value) {
      const result = originalSet.call(this, key, value);
      if (this === target) mirror.noteWrite(String(key));
      return result;
    };
    proto.removeItem = function removeItem(key) {
      const result = originalRemove.call(this, key);
      if (this === target) mirror.noteRemove(String(key));
      return result;
    };
    proto.clear = function clear() {
      const result = originalClear.call(this);
      if (this === target) mirror.noteClear();
      return result;
    };
    return () => {
      proto.setItem = originalSet;
      proto.removeItem = originalRemove;
      proto.clear = originalClear;
    };
  }
}

let installedMirror = null;

export function getNativeSaveMirror() {
  return installedMirror;
}

/**
 * Start the mirror when running natively with the Filesystem plugin. Resolves
 * once saves are read back (bounded by `timeoutMs`); resolves null on the web.
 * A read-back that fails or times out leaves mirroring off for this session,
 * so a fresh-looking store can never overwrite the native copy.
 */
export async function startNativeSaveMirror({
  win = globalThis,
  timeoutMs = 2500,
  log = () => {},
} = {}) {
  if (installedMirror) return installedMirror;
  const cap = nativeCapacitor(win);
  if (!cap || !hasNativePlugin(cap, 'Filesystem')) return null;
  let storage;
  try {
    storage = win.localStorage;
    if (!storage) return null;
  } catch {
    return null;
  }
  const mirror = new NativeSaveMirror({ storage, backend: createFilesystemBackend(cap), log });
  let timer = null;
  try {
    await Promise.race([
      mirror.restore(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('restore timed out')), timeoutMs);
      }),
    ]);
  } catch (error) {
    mirror.cancel();
    log('restore_failed', { error: error?.message || String(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
  const StorageCtor = win.Storage;
  if (StorageCtor?.prototype) mirror.hookStorage(StorageCtor.prototype, storage);
  installedMirror = mirror;
  return mirror;
}

/** Test hook: forget the installed mirror. */
export function _resetNativeSaveMirrorForTests() {
  installedMirror = null;
}
