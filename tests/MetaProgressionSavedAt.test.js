// Regression tests for meta savedAt hardening (Wave 1):
// - savedAt is monotonic across saves regardless of wall clock
// - the per-slot clock floor written by CloudSync is respected
// - a newer foreign payload on disk (cloud heal/fetch) is adopted via
//   max-merge instead of being clobbered by a stale in-memory manager

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import upgradesData from '../data/metaUpgrades.json';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const KEY = 'emblem_rogue_slot_1_meta';
const FLOOR_KEY = 'emblem_rogue_slot_1_meta_clock_floor';

function readSaved() {
  return JSON.parse(store[KEY]);
}

describe('MetaProgressionManager savedAt hardening', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps strictly increasing savedAt even when the wall clock goes backwards', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    meta.addValor(10);
    const first = readSaved().savedAt;
    expect(first).toBe(10_000);

    // Clock jumps backwards (NTP correction) — savedAt must still advance.
    vi.setSystemTime(5_000);
    meta.addValor(10);
    const second = readSaved().savedAt;
    expect(second).toBe(first + 1);
  });

  it('stamps above the CloudSync clock floor when one is recorded', () => {
    store[FLOOR_KEY] = '900000';
    const meta = new MetaProgressionManager(upgradesData, KEY);
    vi.useFakeTimers();
    vi.setSystemTime(10_000); // device clock far behind the cloud row
    meta.addValor(10);
    expect(readSaved().savedAt).toBe(900_001);
  });

  it('adopts a newer foreign disk payload via max-merge instead of clobbering it', () => {
    // Fresh manager (new device, empty slot).
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.addValor(80); // a little local progress; writes savedAt = now

    // Cloud heal/background fetch lands a meaningful payload with newer savedAt.
    const healed = {
      totalValor: 5000,
      totalSupply: 4000,
      runsCompleted: 40,
      purchasedUpgrades: { hp_boost: 3 },
      skillAssignments: { Edric: ['sol'] },
      milestones: ['beatAct1', 'beatAct2', 'beatAct3'],
      savedAt: Date.now() + 1_000_000,
    };
    store[KEY] = JSON.stringify(healed);

    meta.addSupply(20);
    const saved = readSaved();
    expect(saved.totalValor).toBe(5000);
    // Conservative max-merge: the small in-session delta (+20 on a fresh 0)
    // is absorbed by the restored balance — losing 20 supply beats losing 4000.
    expect(saved.totalSupply).toBe(4000);
    expect(saved.runsCompleted).toBe(40);
    expect(saved.purchasedUpgrades).toEqual({ hp_boost: 3 });
    expect(saved.skillAssignments).toEqual({ Edric: ['sol'] });
    expect(new Set(saved.milestones)).toEqual(new Set(['beatAct1', 'beatAct2', 'beatAct3']));
    expect(saved.savedAt).toBeGreaterThan(healed.savedAt);
  });

  it('does not adopt its own previous write as foreign state', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.addValor(100);
    meta.addValor(-60);
    // Spending must stick: our own older on-disk valor (100) is not "foreign"
    // and must not be max-merged back over the post-spend value.
    expect(readSaved().totalValor).toBe(40);
  });
});
