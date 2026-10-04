// The routing table (docs/specs/prologue-chapter.md §4, §9): where a slot goes on New
// Game / Continue given the prologue's state, and where Home Base's Begin Run goes.
// Derived from the spec, not from the code: a fresh slot is offered the prologue, a
// skipped one takes the fast path, a completed one opens Home Base whose Begin Run
// takes the fast path for the first real run only; a run in progress resumes; a slot
// that already started a run is never offered the prologue.
import { describe, expect, it } from 'vitest';
import {
  isFirstRunSlot,
  prologueStateOfSummary,
  routeForSlot,
  routeForBeginRun,
  PROLOGUE_ROUTES,
} from '../src/engine/PrologueRouting.js';
import { getSlotSummary } from '../src/engine/SlotManager.js';

const fresh = (prologue = 'none') => ({
  slot: 1,
  hasActiveRun: false,
  runCorrupt: false,
  runsStarted: 0,
  runsCompleted: 0,
  prologue,
});

describe('routeForSlot', () => {
  it.each([
    ['an empty slot', null, PROLOGUE_ROUTES.OFFER],
    ['a fresh slot that never saw the prologue', fresh('none'), PROLOGUE_ROUTES.OFFER],
    ['an old save without a prologue field', { ...fresh(), prologue: undefined }, PROLOGUE_ROUTES.OFFER], // prettier-ignore
    ['a skipped prologue', fresh('skipped'), PROLOGUE_ROUTES.FAST_PATH],
    ['a completed prologue (no run yet)', fresh('complete'), PROLOGUE_ROUTES.HOME_BASE],
    ['a prologue run in progress', { ...fresh('in_progress'), hasActiveRun: true }, PROLOGUE_ROUTES.RESUME], // prettier-ignore
    ['a real run in progress', { ...fresh('complete'), hasActiveRun: true }, PROLOGUE_ROUTES.RESUME], // prettier-ignore
    ['in_progress whose run save is gone (never reached a battle)', fresh('in_progress'), PROLOGUE_ROUTES.OFFER], // prettier-ignore
    ['a slot that started a run, prologue never played', { ...fresh('none'), runsStarted: 1 }, PROLOGUE_ROUTES.HOME_BASE], // prettier-ignore
    ['a slot that finished a run', { ...fresh('skipped'), runsCompleted: 1 }, PROLOGUE_ROUTES.HOME_BASE], // prettier-ignore
    ['a corrupt run save', { ...fresh('none'), runCorrupt: true }, PROLOGUE_ROUTES.HOME_BASE],
    ['a corrupt active run', { ...fresh('none'), hasActiveRun: true, runCorrupt: true }, PROLOGUE_ROUTES.HOME_BASE], // prettier-ignore
  ])('%s', (_label, summary, expected) => {
    expect(routeForSlot(summary)).toBe(expected);
  });

  it('a build without prologue data skips straight to the fast path on a fresh slot', () => {
    expect(routeForSlot(null, { hasPrologue: false })).toBe(PROLOGUE_ROUTES.FAST_PATH);
    expect(routeForSlot(fresh('none'), { hasPrologue: false })).toBe(PROLOGUE_ROUTES.FAST_PATH);
    expect(routeForSlot(fresh('complete'), { hasPrologue: false })).toBe(PROLOGUE_ROUTES.HOME_BASE); // prettier-ignore
  });

  it('reads only the known states off a summary', () => {
    expect(prologueStateOfSummary(null)).toBe('none');
    expect(prologueStateOfSummary({ prologue: 'bogus' })).toBe('none');
    expect(prologueStateOfSummary({ prologue: 'skipped' })).toBe('skipped');
  });

  it('isFirstRunSlot is unchanged by the prologue field', () => {
    expect(isFirstRunSlot(fresh('complete'))).toBe(true);
    expect(isFirstRunSlot({ ...fresh('complete'), runsStarted: 1 })).toBe(false);
  });
});

describe('routeForBeginRun', () => {
  const meta = (state, runsStarted = 0, runsCompleted = 0) => ({
    getPrologueState: () => state,
    getRunsStarted: () => runsStarted,
    getRunsCompleted: () => runsCompleted,
  });

  it('a completed prologue takes the fast path for the first real run only', () => {
    expect(routeForBeginRun(meta('complete'))).toBe(PROLOGUE_ROUTES.FAST_PATH);
    expect(routeForBeginRun(meta('complete', 1))).toBe(PROLOGUE_ROUTES.STANDARD);
    expect(routeForBeginRun(meta('complete', 0, 1))).toBe(PROLOGUE_ROUTES.STANDARD);
  });

  it('every other state takes the ordinary road', () => {
    expect(routeForBeginRun(meta('none'))).toBe(PROLOGUE_ROUTES.STANDARD);
    expect(routeForBeginRun(meta('skipped'))).toBe(PROLOGUE_ROUTES.STANDARD);
    expect(routeForBeginRun(meta('in_progress'))).toBe(PROLOGUE_ROUTES.STANDARD);
    expect(routeForBeginRun(null)).toBe(PROLOGUE_ROUTES.STANDARD);
  });

  it('reads plain fields when the meta is a raw record', () => {
    expect(routeForBeginRun({ prologue: { state: 'complete' }, runsStarted: 0 })).toBe(
      PROLOGUE_ROUTES.FAST_PATH,
    );
  });
});

describe('the slot summary carries the prologue state', () => {
  const store = new Map();
  const ls = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  it('reads meta.prologue.state, and none for an old save', () => {
    const prev = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: ls, writable: true });
    try {
      store.set('emblem_rogue_slot_2_meta', JSON.stringify({ totalValor: 0 }));
      expect(getSlotSummary(2)?.prologue).toBe('none');
      store.set(
        'emblem_rogue_slot_2_meta',
        JSON.stringify({ totalValor: 0, prologue: { state: 'complete', grantPaid: true } }),
      );
      expect(getSlotSummary(2)?.prologue).toBe('complete');
      expect(routeForSlot(getSlotSummary(2))).toBe(PROLOGUE_ROUTES.HOME_BASE);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: prev, writable: true });
    }
  });
});
