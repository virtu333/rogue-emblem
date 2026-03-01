import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadRun } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import { getRunKey } from '../src/engine/SlotManager.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('loadRun corruption logging', () => {
  let gameData;
  let errorSpy;

  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockImplementation((key) => store[key] ?? null);
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = val;
    });
    gameData = loadGameData();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs console.error with slot number on corrupted JSON', () => {
    const slot = 2;
    store[getRunKey(slot)] = '{{{bad json';

    const result = loadRun(gameData, slot);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`slot ${slot}`),
      expect.any(String),
    );
  });

  it('logs console.error when fromJSON throws (no lord in roster)', () => {
    const slot = 1;
    // Valid JSON but roster has no lord and no name matching any lord
    const fakeRun = {
      version: 1,
      status: 'active',
      actIndex: 0,
      roster: [
        {
          name: 'NonExistentUnit',
          class: 'Soldier',
          level: 1,
          stats: { hp: 20, str: 8, mag: 0, skl: 5, spd: 5, lck: 3, def: 6, res: 1, mov: 5 },
          maxHp: 20,
          weapon: null,
          skills: [],
          isLord: false,
        },
      ],
      fallenUnits: [],
      gold: 100,
      accessories: [],
      scrolls: [],
      convoy: { weapons: [], consumables: [] },
      metaEffects: null,
    };
    store[getRunKey(slot)] = JSON.stringify(fakeRun);

    const result = loadRun(gameData, slot);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`slot ${slot}`),
      expect.stringContaining('no lord'),
    );
  });
});
