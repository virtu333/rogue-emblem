import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HintManager } from '../src/engine/HintManager.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('HintManager', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
  });

  it('constructor loads empty state for new slot', () => {
    const hm = new HintManager(1);
    expect(hm.hasSeen('anything')).toBe(false);
  });

  it('shouldShow returns true first time, false second time', () => {
    const hm = new HintManager(1);
    expect(hm.shouldShow('battle_first_turn')).toBe(true);
    expect(hm.shouldShow('battle_first_turn')).toBe(false);
  });

  it('hasSeen returns true after markSeen', () => {
    const hm = new HintManager(1);
    expect(hm.hasSeen('test_hint')).toBe(false);
    hm.markSeen('test_hint');
    expect(hm.hasSeen('test_hint')).toBe(true);
  });

  it('shouldShow marks seen and persists immediately', () => {
    const hm = new HintManager(1);
    hm.shouldShow('battle_recruit');
    expect(localStorageMock.setItem).toHaveBeenCalled();
    expect(hm.hasSeen('battle_recruit')).toBe(true);
  });

  it('state persists across instances for same slot', () => {
    const hm1 = new HintManager(2);
    hm1.shouldShow('nodemap_intro');
    hm1.shouldShow('battle_fog');

    const hm2 = new HintManager(2);
    expect(hm2.hasSeen('nodemap_intro')).toBe(true);
    expect(hm2.hasSeen('battle_fog')).toBe(true);
    expect(hm2.shouldShow('nodemap_intro')).toBe(false);
  });

  it('slots are independent — slot 1 hints do not affect slot 2', () => {
    const hm1 = new HintManager(1);
    hm1.shouldShow('battle_first_turn');

    const hm2 = new HintManager(2);
    expect(hm2.hasSeen('battle_first_turn')).toBe(false);
    expect(hm2.shouldShow('battle_first_turn')).toBe(true);
  });

  it('deleteForSlot clears stored data', () => {
    const hm = new HintManager(1);
    hm.shouldShow('homebase_intro');
    expect(hm.hasSeen('homebase_intro')).toBe(true);

    HintManager.deleteForSlot(1);
    expect(store['emblem_rogue_slot_1_hints']).toBeUndefined();

    // New instance should have clean state
    const hm2 = new HintManager(1);
    expect(hm2.hasSeen('homebase_intro')).toBe(false);
  });

  it('handles localStorage getItem throwing gracefully', () => {
    localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('blocked'); });
    const hm = new HintManager(1);
    expect(hm.hasSeen('anything')).toBe(false);
    // Should still work in-memory
    expect(hm.shouldShow('test')).toBe(true);
  });

  it('handles localStorage setItem throwing gracefully', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    const hm = new HintManager(1);
    // Should not throw
    expect(() => hm.shouldShow('test')).not.toThrow();
    expect(hm.hasSeen('test')).toBe(true); // in-memory still works
  });

  it('handles corrupt JSON in localStorage', () => {
    store['emblem_rogue_slot_1_hints'] = 'not valid json{{{';
    const hm = new HintManager(1);
    expect(hm.hasSeen('anything')).toBe(false);
  });

  it('handles non-array JSON in localStorage', () => {
    store['emblem_rogue_slot_1_hints'] = JSON.stringify({ not: 'array' });
    const hm = new HintManager(1);
    expect(hm.hasSeen('anything')).toBe(false);
  });

  it('tracks multiple hints independently', () => {
    const hm = new HintManager(1);
    expect(hm.shouldShow('hint_a')).toBe(true);
    expect(hm.shouldShow('hint_b')).toBe(true);
    expect(hm.shouldShow('hint_a')).toBe(false);
    expect(hm.shouldShow('hint_b')).toBe(false);
    expect(hm.shouldShow('hint_c')).toBe(true);
  });
});
