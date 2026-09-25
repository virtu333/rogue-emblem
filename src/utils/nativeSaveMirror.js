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
//  - A deletion WebKit lost (the run ended or the slot was deleted, the
//    tombstone reached disk, but the process died before WebKit flushed the
//    removal, so the old save is still in localStorage) is replayed: the
//    tombstone records `deletedSavedAt`, the newest `savedAt` of the key the
//    mirror had seen live, and a local value stamped at or before it is the
//    deleted save (or older) and is removed before the game boots — otherwise
//    the reconcile below would mirror the stale save back over the deletion
//    and an ended run would be resumable again. A local value stamped after
//    the deletion is a newer save (a run started after the deletion whose
//    native write was lost) and is kept and mirrored. Without both stamps
//    (a tombstone from before this field existed, or a key whose payload has
//    no `savedAt`) order cannot be proven and the local value is kept — the
//    error that loses nothing.
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
// Stands for "the last write of this key did not reach disk": never equal to
// a stored value, so the next flush writes the key again.
const UNWRITTEN = Symbol('unwritten');
const WRITE_DEBOUNCE_MS = 600;
const WRITE_MAX_WAIT_MS = 3000;

export function shouldMirrorKey(key) {
  return typeof key === 'string' && key.startsWith(MIRROR_KEY_PREFIX) && !UNMIRRORED_KEYS.has(key);
}

// --- Record encoding -------------------------------------------------------

/**
 * A live record carries the payload's `savedAt`; a tombstone carries
 * `deletedSavedAt`, the newest `savedAt` the mirror had seen live for the key
 * (omitted when the key never had one — the header field is optional, so
 * older tombstones decode with `deletedSavedAt: null`).
 */
export function encodeRecord({ key, seq, value, deletedSavedAt = null }) {
  const removed = value === null || value === undefined;
  const body = removed ? '' : String(value);
  const header = { key, seq, removed, length: body.length, savedAt: readSavedAt(body) };
  if (removed && Number.isFinite(deletedSavedAt)) header.deletedSavedAt = deletedSavedAt;
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
  const removed = header.removed === true;
  return {
    key: header.key,
    seq: header.seq,
    removed,
    value: removed ? null : body,
    savedAt: !removed && Number.isFinite(header.savedAt) ? header.savedAt : null,
    deletedSavedAt:
      removed && Number.isFinite(header.deletedSavedAt) ? header.deletedSavedAt : null,
  };
}

/** Monotonic save stamp of a run/meta payload (null when absent or not JSON). */
export function readSavedAt(value) {
  if (typeof value !== 'string') return null;
  // Run and meta saves write savedAt as their last top-level key: read the
  // tail instead of scanning or parsing a payload that can reach a megabyte
  // (this runs on every localStorage.setItem of a mirrored key).
  const tail = /"savedAt":(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\}\s*$/.exec(value.slice(-96));
  if (tail) return Number(tail[1]);
  if (!value.includes('"savedAt"')) return null;
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

/** The key a mirror file name belongs to (null for foreign names). */
export function keyForFileName(name) {
  const match = /^(.+)\.[ab]\.txt$/.exec(String(name));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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
 * Decide what the launch read-back restores into, and removes from, localStorage.
 *
 * Newest native record per key × local value:
 *
 *   live, local missing        → restore only when the store was evicted
 *   live, local older savedAt  → restore (a write WebKit lost)
 *   live, otherwise            → keep local
 *   tombstone, local missing   → nothing (stays deleted, evicted or not)
 *   tombstone, local savedAt <= deletedSavedAt → remove local: it is the
 *                                deleted save or older (a deletion WebKit lost)
 *   tombstone, local savedAt >  deletedSavedAt → keep local: a save made after
 *                                the deletion whose native write was lost
 *   tombstone, either stamp missing → keep local (order unprovable: a legacy
 *                                tombstone without the field, or a key such as
 *                                settings/flags whose payload has no savedAt)
 *
 * `savedAt` is monotonic per key while the key exists (each save takes
 * max(now, previous + 1, cloud floor + 1)), which is what makes "stamped at or
 * before the deleted save" mean "written before the deletion". After a
 * deletion the chain restarts from the wall clock, so a device whose clock was
 * set back (or a deleted save stamped ahead of it by a faster device's cloud
 * floor) could stamp a new run at or below the tombstone; that run is only
 * lost if its native write was also lost, and the alternative — keeping every
 * stale save — reopens the ended run every time a deletion is lost.
 *
 * @param {{ local: Map<string,string>, sentinelPresent: boolean, records: Map<string,object> }} input
 * @returns {{ evicted: boolean, restore: Array<[string,string]>, remove: string[] }}
 */
export function planRestore({ local, sentinelPresent, records }) {
  const evicted = !sentinelPresent && records.size > 0;
  const restore = [];
  const remove = [];
  for (const [key, record] of records) {
    if (!shouldMirrorKey(key)) continue;
    const current = local.get(key);
    if (current === undefined || current === null) {
      // Missing locally: restore only when the whole store was evicted.
      if (evicted && !record.removed) restore.push([key, record.value]);
      continue;
    }
    const localStamp = readSavedAt(current);
    if (record.removed) {
      if (
        Number.isFinite(record.deletedSavedAt) &&
        Number.isFinite(localStamp) &&
        localStamp <= record.deletedSavedAt
      )
        remove.push(key);
      continue;
    }
    if (current === record.value) continue;
    if (
      Number.isFinite(record.savedAt) &&
      Number.isFinite(localStamp) &&
      record.savedAt > localStamp
    )
      restore.push([key, record.value]);
  }
  return { evicted, restore, remove };
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
      let result;
      try {
        result = await call('readdir', { path: MIRROR_FOLDER, directory: MIRROR_DIRECTORY });
      } catch (error) {
        // "No folder yet" (first launch) must not be confused with a folder
        // that exists but could not be listed: reading the latter as empty
        // would, after an eviction, let the next launch tombstone every save.
        // mkdir succeeds only when the folder did not exist (it refuses an
        // existing one), which proves the mirror is really empty.
        try {
          await call('mkdir', {
            path: MIRROR_FOLDER,
            directory: MIRROR_DIRECTORY,
            recursive: true,
          });
        } catch {
          throw error;
        }
        return [];
      }
      return (result?.files || [])
        .map((file) => (typeof file === 'string' ? file : file?.name))
        .filter((name) => typeof name === 'string');
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
    // key → { seq: last issued, value: last issued, slot: buffer holding the
    //   newest complete record (never overwritten), pending: writes in flight }
    this.records = new Map();
    // key → the newest `savedAt` seen live for the key: every value read back
    // or mirrored, and every value written or removed through the hooks (also
    // the ones a debounce coalesced away, which never reach disk). A tombstone
    // carries it as `deletedSavedAt` so a later launch can tell the deleted
    // save from one made after the deletion.
    this.stamps = new Map();
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
    const unreadKeys = new Set();
    for (const name of names) {
      if (this.cancelled) return null;
      if (!name.endsWith('.txt')) continue;
      const text = await this.backend.read(name);
      if (text !== null) files[name] = text;
      else if (keyForFileName(name)) unreadKeys.add(keyForFileName(name));
    }
    // Everything below is synchronous: it applies entirely or (cancelled) not at all.
    if (this.cancelled) return null;
    const { records, slots } = collectRecords(files);
    const local = new Map();
    for (const key of this.localKeys()) local.set(key, this.storage.getItem(key));
    const sentinelPresent = this.storage.getItem(MIRROR_SENTINEL_KEY) !== null;
    const plan = planRestore({ local, sentinelPresent, records });
    // Saves the plan could not write back (quota): the native copy is the one
    // to keep, so reconcile must neither overwrite nor tombstone it.
    const unrestored = new Set();
    for (const [key, value] of plan.restore) {
      try {
        this.storage.setItem(key, value);
        local.set(key, value);
      } catch (error) {
        unrestored.add(key);
        this.log('restore_write_failed', { key, error: error?.message || String(error) });
      }
    }
    // Stale saves whose deletion WebKit lost: removed here, before reconcile
    // snapshots `local`, so they are never mirrored back over the tombstone.
    // One that cannot be removed is left out of reconcile for the same reason
    // (the tombstone stands; the next launch removes it again).
    const unremoved = new Set();
    for (const key of plan.remove) {
      try {
        this.storage.removeItem(key);
        local.delete(key);
      } catch (error) {
        unremoved.add(key);
        this.log('restore_remove_failed', { key, error: error?.message || String(error) });
      }
    }
    for (const [key, record] of records) {
      this.records.set(key, {
        seq: record.seq,
        value: record.value,
        slot: slots.get(key),
        pending: 0,
      });
      this.noteStamp(key, record.removed ? record.deletedSavedAt : record.savedAt);
    }
    for (const [key, value] of local) this.noteStamp(key, readSavedAt(value));
    // The sentinel ends "evicted" mode. Keep that mode (so the next launch
    // restores again) while a mirrored save is still missing locally because
    // it could not be read or written back this time — with the sentinel set,
    // the next launch would take its absence for a deletion and tombstone it.
    const incomplete =
      unrestored.size > 0 || [...unreadKeys].some((key) => shouldMirrorKey(key) && !local.has(key));
    try {
      if (!sentinelPresent && !incomplete)
        this.storage.setItem(MIRROR_SENTINEL_KEY, String(this.now()));
    } catch {
      /* quota: the next launch treats storage as evicted and restores again */
    }
    // Reconcile: mirror every local key that differs, tombstone every record
    // whose key is gone locally (a removal the mirror missed).
    for (const [key, value] of local) {
      if (unrestored.has(key) || unremoved.has(key)) continue;
      if (shouldMirrorKey(key) && this.records.get(key)?.value !== value) this.dirty.add(key);
    }
    for (const [key, record] of this.records) {
      if (unrestored.has(key)) continue;
      if (!local.has(key) && record.value !== null) this.dirty.add(key);
    }
    const removed = plan.remove.filter((key) => !unremoved.has(key));
    this.lastRestore = {
      evicted: plan.evicted,
      restored: plan.restore.map(([key]) => key).filter((key) => !unrestored.has(key)),
      records: records.size,
      ...(removed.length ? { removed } : {}),
      ...(unrestored.size ? { unrestored: [...unrestored] } : {}),
      ...(unremoved.size ? { unremoved: [...unremoved] } : {}),
      ...(incomplete ? { incomplete: true } : {}),
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

  /** Remember `stamp` as the newest `savedAt` seen live for `key` (null: no-op). */
  noteStamp(key, stamp) {
    if (!Number.isFinite(stamp)) return;
    const known = this.stamps.get(key);
    if (known === undefined || stamp > known) this.stamps.set(key, stamp);
  }

  /** Newest live stamp of every mirrored key in localStorage (before a clear). */
  noteLocalStamps() {
    for (const key of this.localKeys()) {
      try {
        this.noteStamp(key, readSavedAt(this.storage.getItem(key)));
      } catch {
        /* unreadable: nothing to remember */
      }
    }
  }

  noteWrite(key, value) {
    if (!this.active || !shouldMirrorKey(key)) return;
    if (value !== null && value !== undefined) this.noteStamp(key, readSavedAt(String(value)));
    this.dirty.add(key);
    this.schedule(WRITE_DEBOUNCE_MS);
  }

  /** `previous` is the value the key held before removal (its stamp dates the deletion). */
  noteRemove(key, previous = null) {
    if (!this.active || !shouldMirrorKey(key)) return;
    if (typeof previous === 'string') this.noteStamp(key, readSavedAt(previous));
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
      // A key that never reached disk needs no tombstone — unless a stamped
      // save of it was seen (written, then removed within one debounce): its
      // tombstone is what lets a launch remove that save if WebKit kept it.
      if (!previous && value === null && !this.stamps.has(key)) continue;
      if (value !== null) this.noteStamp(key, readSavedAt(value));
      const deletedSavedAt = value === null ? (this.stamps.get(key) ?? null) : null;
      const entry = previous || { seq: 0, value: undefined, slot: null, pending: 0 };
      const [a, b] = recordFileNames(key);
      // writeFile is not atomic (a kill or a full disk can tear the file), so
      // `slot` — the buffer holding the newest record known to be complete —
      // is never written. Overlapping writes (a lifecycle flush while the
      // previous write is still on the bridge) all go to the other buffer;
      // `slot` moves only once every write in flight has settled and the
      // newest of them succeeded.
      const target = entry.slot === a ? b : a;
      const seq = entry.seq + 1;
      entry.seq = seq;
      entry.value = value;
      entry.pending = (entry.pending || 0) + 1;
      this.records.set(key, entry);
      const settle = (ok, error) => {
        if (!ok) this.log('write_failed', { key, error: error?.message || String(error) });
        if (seq === entry.seq) entry.ok = ok; // the newest write decides
        entry.pending -= 1;
        if (entry.pending > 0) return;
        if (entry.ok) {
          entry.slot = target;
        } else {
          // The target may be torn; `slot` still holds the last good record.
          // Retry on the next flush, whatever the value is by then.
          entry.value = UNWRITTEN;
          this.dirty.add(key);
        }
      };
      // Dispatch now: the bridge message leaves JS synchronously, so a page
      // suspended right after a lifecycle flush cannot hold it back.
      try {
        writes.push(
          Promise.resolve(
            this.backend.write(target, encodeRecord({ key, seq, value, deletedSavedAt })),
          ).then(
            () => settle(true),
            (error) => settle(false, error),
          ),
        );
      } catch (error) {
        settle(false, error);
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
    // The value a key holds before its removal dates the deletion (its
    // `savedAt` becomes the tombstone's `deletedSavedAt`), so it is read
    // before the original call; a failing original call notes nothing.
    const previousValue = (storage, key) => {
      if (storage !== target || !mirror.active || !shouldMirrorKey(key)) return null;
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    };
    proto.setItem = function setItem(key, value) {
      const result = originalSet.call(this, key, value);
      if (this === target) mirror.noteWrite(String(key), value);
      return result;
    };
    proto.removeItem = function removeItem(key) {
      const previous = previousValue(this, String(key));
      const result = originalRemove.call(this, key);
      if (this === target) mirror.noteRemove(String(key), previous);
      return result;
    };
    proto.clear = function clear() {
      if (this === target && mirror.active) mirror.noteLocalStamps();
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
