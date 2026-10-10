// The pending run seed's storage is resolved inside a guard: a `localStorage` property getter that
// throws (SecurityError in a storage-denied browser or webview) must fall back to the registry
// instead of escaping from a default argument (utils/pendingRunSeed.js).
import { afterEach, describe, expect, it } from 'vitest';
import {
  PENDING_RUN_SEED_KEY,
  clearPendingRunSeed,
  readPendingRunSeed,
  writePendingRunSeed,
} from '../src/utils/pendingRunSeed.js';

const fakeRegistry = (slot = 2) => {
  const map = new Map([['activeSlot', slot]]);
  return { get: (k) => map.get(k), set: (k, v) => map.set(k, v) };
};

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const denyStorage = () =>
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});

describe('a localStorage getter that throws', () => {
  it('write does not throw and the registry keeps the seed', () => {
    denyStorage();
    const registry = fakeRegistry();
    expect(() => writePendingRunSeed(registry, 1234, { runsStarted: 3 })).not.toThrow();
    expect(registry.get(PENDING_RUN_SEED_KEY)).toEqual({ 2: { seed: 1234, runsStarted: 3 } });
  });

  it('read does not throw and round-trips the seed through the registry', () => {
    denyStorage();
    const registry = fakeRegistry();
    expect(() => readPendingRunSeed(registry, { runsStarted: 3 })).not.toThrow();
    expect(readPendingRunSeed(registry, { runsStarted: 3 })).toBeNull();
    writePendingRunSeed(registry, 77, { runsStarted: 3 });
    expect(readPendingRunSeed(registry, { runsStarted: 3 })).toBe(77);
    // A run has begun since: the kept seed is stale.
    expect(readPendingRunSeed(registry, { runsStarted: 4 })).toBeNull();
  });

  it('clear does not throw and empties the registry copy', () => {
    denyStorage();
    const registry = fakeRegistry();
    writePendingRunSeed(registry, 77, { runsStarted: 0 });
    expect(() => clearPendingRunSeed(registry, { runsStarted: 0 })).not.toThrow();
    expect(readPendingRunSeed(registry)).toBeNull();
  });
});

describe('injected storage still wins', () => {
  it('uses the injected storage over the browser getter, even a throwing one', () => {
    denyStorage();
    const data = new Map();
    const storage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    };
    const registry = fakeRegistry();
    writePendingRunSeed(registry, 5, { runsStarted: 1, storage });
    expect(data.size).toBe(1);
    expect(registry.get(PENDING_RUN_SEED_KEY)).toEqual({});
    expect(readPendingRunSeed(registry, { runsStarted: 1, storage })).toBe(5);
    clearPendingRunSeed(registry, { runsStarted: 1, storage });
    expect(data.size).toBe(0);
  });
});
