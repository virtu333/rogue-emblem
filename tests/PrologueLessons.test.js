// prologueLessons: what a finished prologue chapter carries into a new save slot. The
// device-wide keys keep the tutorial's spelling (CLAUDE.md: internal identifiers stay).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HintManager } from '../src/engine/HintManager.js';
import {
  applyCompletedTutorialHints,
  recordTaughtLessons,
  TUTORIAL_COMPLETED_KEY,
  TUTORIAL_HINT_IDS,
  TUTORIAL_LESSONS_KEY,
} from '../src/ui/prologueLessons.js';
import { NOTE_HINT_IDS } from '../src/data/prologueContent.js';

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

describe('recordTaughtLessons', () => {
  it('writes the completion flag and only known lesson ids, merged with earlier ones', () => {
    store.set(TUTORIAL_LESSONS_KEY, JSON.stringify(['battle_terrain', 'arbitrary']));
    const all = recordTaughtLessons(['battle_forecast', 'battle_first_turn', 'made_up']);
    expect(store.get(TUTORIAL_COMPLETED_KEY)).toBe('1');
    expect(all.sort()).toEqual(['battle_first_turn', 'battle_forecast', 'battle_terrain']);
    expect(JSON.parse(store.get(TUTORIAL_LESSONS_KEY)).sort()).toEqual(all.sort());
    expect([...store.keys()].sort()).toEqual([TUTORIAL_COMPLETED_KEY, TUTORIAL_LESSONS_KEY]);
  });

  it('survives a storage that refuses writes', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(recordTaughtLessons(['battle_terrain'])).toEqual(['battle_terrain']);
  });
});

describe('applyCompletedTutorialHints', () => {
  it('does not suppress lessons after a skipped prologue or trust unknown persisted ids', () => {
    store.set(TUTORIAL_LESSONS_KEY, JSON.stringify(['battle_triangle', 'arbitrary']));
    const hints = { markSeen: vi.fn() };
    applyCompletedTutorialHints(hints);
    expect(hints.markSeen).not.toHaveBeenCalled();
    store.set(TUTORIAL_COMPLETED_KEY, '1');
    applyCompletedTutorialHints(hints);
    expect(hints.markSeen.mock.calls).toEqual([['battle_triangle']]);
  });

  it('imports only into new slots, preserving a reset across reconstructed managers', () => {
    store.set(TUTORIAL_COMPLETED_KEY, '1');
    store.set(TUTORIAL_LESSONS_KEY, JSON.stringify(['battle_forecast', 'battle_triangle']));
    const first = new HintManager(1);
    expect(first.isNew).toBe(true);
    applyCompletedTutorialHints(first);
    expect(first.hasSeen('battle_triangle')).toBe(true);
    first.reset();
    applyCompletedTutorialHints(first);
    expect(first.hasSeen('battle_triangle')).toBe(false);
    const restored = new HintManager(1);
    expect(restored.isNew).toBe(false);
    applyCompletedTutorialHints(restored);
    expect([...restored.seen]).toEqual([]);
    const nextSlot = new HintManager(2);
    applyCompletedTutorialHints(nextSlot);
    expect(nextSlot.hasSeen('battle_triangle')).toBe(true);
  });

  it('every in-run hint a prologue note stands in for is a known lesson id', () => {
    for (const ids of Object.values(NOTE_HINT_IDS))
      for (const id of ids) expect(TUTORIAL_HINT_IDS.has(id), id).toBe(true);
    // The Danger lesson is taught by P1's turn note, so a new slot skips its toast.
    expect(TUTORIAL_HINT_IDS.has('battle_danger_zone')).toBe(true);
  });
});
