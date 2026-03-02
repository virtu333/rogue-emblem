import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSlotSummary,
  getMetaKey,
  getRunKey,
  getNextAvailableSlot,
} from '../src/engine/SlotManager.js';

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

describe('SlotManager corruption handling', () => {
  let errorSpy;

  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockImplementation((key) => store[key] ?? null);
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = val;
    });
    localStorageMock.removeItem.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns runCorrupt: true when run JSON is invalid but meta is valid', () => {
    const slot = 1;
    store[getMetaKey(slot)] = JSON.stringify({
      totalValor: 500,
      totalSupply: 200,
      runsCompleted: 3,
    });
    store[getRunKey(slot)] = '{{{bad json';

    const summary = getSlotSummary(slot);

    expect(summary).not.toBeNull();
    expect(summary.hasActiveRun).toBe(false);
    expect(summary.runCorrupt).toBe(true);
    expect(summary.valor).toBe(500);
    expect(summary.supply).toBe(200);
    expect(summary.runsCompleted).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`slot ${slot}`));
  });

  it('returns null and auto-cleans malformed meta JSON', () => {
    const slot = 2;
    store[getMetaKey(slot)] = '{{{bad meta';
    store[getRunKey(slot)] = JSON.stringify({ actIndex: 1 });

    let summary;
    expect(() => {
      summary = getSlotSummary(slot);
    }).not.toThrow();

    expect(summary).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getMetaKey(slot));
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getRunKey(slot));
  });

  it('returns runCorrupt: false for healthy slot', () => {
    const slot = 3;
    store[getMetaKey(slot)] = JSON.stringify({
      totalValor: 100,
      totalSupply: 50,
      runsCompleted: 1,
    });
    store[getRunKey(slot)] = JSON.stringify({ actIndex: 2 });

    const summary = getSlotSummary(slot);

    expect(summary).not.toBeNull();
    expect(summary.runCorrupt).toBe(false);
    expect(summary.hasActiveRun).toBe(true);
    expect(summary.actReached).toBe(3);
  });

  it('returns runCorrupt: true when localStorage.getItem throws on run key', () => {
    const slot = 1;
    store[getMetaKey(slot)] = JSON.stringify({
      totalValor: 300,
      totalSupply: 100,
      runsCompleted: 2,
    });

    // Make getItem throw only for the run key (simulates SecurityError in private browsing)
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === getRunKey(slot)) throw new DOMException('SecurityError');
      return store[key] ?? null;
    });

    const summary = getSlotSummary(slot);

    expect(summary).not.toBeNull();
    expect(summary.runCorrupt).toBe(true);
    expect(summary.valor).toBe(300);
    expect(summary.supply).toBe(100);
    expect(summary.runsCompleted).toBe(2);
    expect(summary.hasActiveRun).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`slot ${slot}`));
  });

  it('returns runCorrupt: false when no run data exists', () => {
    const slot = 1;
    store[getMetaKey(slot)] = JSON.stringify({
      totalValor: 0,
      totalSupply: 0,
      runsCompleted: 0,
    });

    const summary = getSlotSummary(slot);

    expect(summary).not.toBeNull();
    expect(summary.runCorrupt).toBe(false);
    expect(summary.hasActiveRun).toBe(false);
  });

  it.each([
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"x"'],
    ['number', '42'],
  ])('returns null and auto-cleans parseable invalid meta (%s)', (_label, rawMeta) => {
    const slot = 2;
    store[getMetaKey(slot)] = rawMeta;
    store[getRunKey(slot)] = JSON.stringify({ actIndex: 1 });

    let summary;
    expect(() => {
      summary = getSlotSummary(slot);
    }).not.toThrow();

    expect(summary).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getMetaKey(slot));
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getRunKey(slot));
  });

  it('corrupt meta auto-cleans: deleteSlot is called and summary returns null', () => {
    const slot = 2;
    store[getMetaKey(slot)] = '{{{bad meta';
    store[getRunKey(slot)] = JSON.stringify({ actIndex: 1 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const summary = getSlotSummary(slot);

    expect(summary).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getMetaKey(slot));
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getRunKey(slot));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`slot ${slot}`));
    warnSpy.mockRestore();
  });

  it('storage access error does NOT delete slot data', () => {
    const slot = 1;
    store[getMetaKey(slot)] = JSON.stringify({ totalValor: 100 });

    // Make getItem throw for the meta key (simulates SecurityError)
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === getMetaKey(slot)) throw new DOMException('SecurityError');
      return store[key] ?? null;
    });

    const summary = getSlotSummary(slot);

    expect(summary).toBeNull();
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it('getNextAvailableSlot cleans corrupt slots before allocation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Slot 1 has parseable-but-invalid meta shape.
    store[getMetaKey(1)] = 'null';
    // Slot 2 is healthy
    store[getMetaKey(2)] = JSON.stringify({ totalValor: 50 });
    // Slot 3 is empty

    const slot = getNextAvailableSlot();

    // Should return 1 because corrupt slot 1 was cleaned
    expect(slot).toBe(1);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(getMetaKey(1));
    warnSpy.mockRestore();
  });

  it('keeps healthy object meta (with missing optional fields) without deleting', () => {
    const slot = 3;
    store[getMetaKey(slot)] = JSON.stringify({ runsCompleted: 2 });

    const summary = getSlotSummary(slot);

    expect(summary).not.toBeNull();
    expect(summary.valor).toBe(0);
    expect(summary.supply).toBe(0);
    expect(summary.runsCompleted).toBe(2);
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });
});
