// A meta save keeps the keys a newer build wrote. An older client (an app build behind the
// web, a rollback) loads the slot and saves it again; before this it wrote only the fields
// it knew, and its cloud push then carried the loss to every device on the account.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  META_SAVE_FIELDS,
  MetaProgressionManager,
  unknownMetaFields,
} from '../src/engine/MetaProgressionManager.js';
import upgradesData from '../data/metaUpgrades.json';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
    setItem: vi.fn((key, val) => {
      store[key] = String(val);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
  },
  writable: true,
});

const KEY = 'emblem_rogue_slot_1_meta';
const read = () => JSON.parse(store[KEY]);
const write = (payload) => {
  store[KEY] = JSON.stringify(payload);
};

// Keys no build writes today, standing in for a newer build's.
const FUTURE = {
  futureLedger: { owed: 3, ids: ['a', 'b'] },
  futureFlag: true,
  futureZero: 0,
  futureNull: null,
};

describe('meta saves keep keys they do not recognise', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('writes a newer build’s keys back unchanged on the next save', () => {
    write({ totalValor: 120, totalSupply: 40, savedAt: 1000, ...FUTURE });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.rememberDifficulty('hard');
    const saved = read();
    for (const [key, value] of Object.entries(FUTURE)) expect(saved[key]).toEqual(value);
    // The known fields are still this build's.
    expect(saved.totalValor).toBe(120);
    expect(saved.lastDifficulty).toBe('hard');
    expect(saved.savedAt).toBeGreaterThan(1000);
  });

  it('keeps them across repeated saves and a fresh manager', () => {
    write({ totalValor: 5, savedAt: 1000, ...FUTURE });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.rememberDifficulty('normal');
    meta.rememberDifficulty('dusk');
    new MetaProgressionManager(upgradesData, KEY).rememberDifficulty('hard');
    expect(read()).toMatchObject(FUTURE);
  });

  it('hands the kept keys to the cloud push (onSave)', () => {
    write({ savedAt: 1000, ...FUTURE });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    const pushed = [];
    meta.onSave = (payload) => pushed.push(payload);
    meta.rememberDifficulty('hard');
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject(FUTURE);
  });

  it('takes a newer disk copy’s keys when it adopts that copy, and keeps its own otherwise', () => {
    write({ savedAt: 1000, futureFlag: false, futureOnlyHere: 'local' });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    // Another tab or a cloud fetch wrote a newer copy with the newer build's values.
    write({ savedAt: Date.now() + 60_000, futureFlag: true, futureLedger: { owed: 1 } });
    meta.rememberDifficulty('hard');
    const saved = read();
    expect(saved.futureFlag).toBe(true);
    expect(saved.futureLedger).toEqual({ owed: 1 });
    expect(saved.futureOnlyHere).toBe('local');
  });

  it('never lets a kept key override a field this build writes', () => {
    // A stale value under a known name is not an unknown key: this build's value is written.
    write({ totalValor: 10, savedAt: 1000, futureFlag: 1 });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.totalValor = 99;
    meta.rememberDifficulty('hard');
    expect(read().totalValor).toBe(99);
    expect(unknownMetaFields({ totalValor: 1, totalRenown: 2, x: 3 })).toEqual({ x: 3 });
  });

  it('does not keep the legacy single-currency key it migrates', () => {
    write({ totalRenown: 50, savedAt: 1000 });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.rememberDifficulty('hard');
    expect(read()).not.toHaveProperty('totalRenown');
    expect(read().totalValor).toBe(50);
  });

  it('lists exactly the fields this build writes (a new field must be added to the list)', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.rememberDifficulty('hard');
    expect(Object.keys(read()).sort()).toEqual([...META_SAVE_FIELDS].sort());
  });
});
