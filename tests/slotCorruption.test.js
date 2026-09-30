import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  inspectSlot,
  getSlotSummary,
  getSlotCount,
  getOccupiedSlots,
  getNextAvailableSlot,
  clearAllSlotData,
} from '../src/engine/SlotManager.js';
import {
  archiveAndDiscardSlot,
  retireSlotArchive,
  readSlotArchive,
} from '../src/engine/SlotRecovery.js';

let values, storage;
const META = 'emblem_rogue_slot_1_meta';
const RUN = 'emblem_rogue_slot_1_run';
const ARCHIVE = 'emblem_rogue_slot_1_quarantine';
const JOURNAL = 'emblem_rogue_slot_1_pair_journal';
beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  };
  vi.stubGlobal('localStorage', storage);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('read-only slot inspection and allocation', () => {
  it.each(['{bad', 'null', '[]', '42', '"x"', '', null])(
    'preserves every byte when metadata is %s and a run survives',
    (raw) => {
      if (raw !== null) values.set(META, raw);
      values.set(RUN, '{"actIndex":1,"gold":137}');
      values.set('unrelated', 'keep me');
      const before = new Map(values);
      expect(inspectSlot(1)).toMatchObject({
        status: 'damaged',
        hasRunData: true,
        runParseable: true,
      });
      expect(getSlotSummary(1)).toMatchObject({
        slot: 1,
        recoveryRequired: true,
        hasActiveRun: false,
        runRecoverable: true,
      });
      expect(getSlotCount()).toBe(1);
      expect(getOccupiedSlots()).toEqual([1]);
      expect(getNextAvailableSlot()).toBe(2);
      expect(values).toEqual(before);
    },
  );

  it.each(['cloud_conflict', 'quarantine', 'pair_journal'])(
    'reserves a slot with only %s evidence',
    (suffix) => {
      values.set(`emblem_rogue_slot_1_${suffix}`, 'raw recovery evidence');
      const before = new Map(values);
      expect(getSlotSummary(1)?.recoveryRequired).toBe(true);
      expect(getNextAvailableSlot()).toBe(2);
      expect(values).toEqual(before);
    },
  );

  it('excludes unreadable slots and preserves available metadata in their summary', () => {
    values.set(META, '{"totalValor":500,"totalSupply":200}');
    storage.getItem.mockImplementation((key) => {
      if (key === RUN) throw new Error('SecurityError');
      return values.get(key) ?? null;
    });
    expect(inspectSlot(1).status).toBe('unreadable');
    expect(getSlotSummary(1)).toMatchObject({
      valor: 500,
      supply: 200,
      recoveryRequired: true,
      runCorrupt: true,
    });
    expect(getNextAvailableSlot()).toBe(2);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('treats total storage unavailability as occupied rather than allocating a slot', () => {
    storage.getItem.mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getSlotCount()).toBe(3);
    expect(getNextAvailableSlot()).toBeNull();
    expect(getSlotSummary(1)?.slotStatus).toBe('unreadable');
  });

  it('keeps the healthy summary and optional-meta-field compatibility', () => {
    values.set(META, '{"runsCompleted":2}');
    values.set(RUN, '{"actIndex":2}');
    expect(getSlotSummary(1)).toMatchObject({
      valor: 0,
      supply: 0,
      runsCompleted: 2,
      runsStarted: 2,
      hasActiveRun: true,
      actReached: 3,
      runCorrupt: false,
    });
    expect(getSlotSummary(2)).toBeNull();
    values.set(META, '{}');
    values.delete(RUN);
    expect(getSlotSummary(1)).toMatchObject({ hasActiveRun: false, runCorrupt: false });
  });

  it.each(['{bad', 'null', '[]', '42', '', '{"roster":42}'])(
    'never advertises malformed run %s as active, and keeps its bytes',
    (run) => {
      values.set(META, '{"totalValor":500,"totalSupply":200}');
      values.set(RUN, run);
      expect(getSlotSummary(1)).toMatchObject({
        hasActiveRun: false,
        runCorrupt: true,
        valor: 500,
        supply: 200,
      });
      expect(values.get(RUN)).toBe(run);
    },
  );

  it('keeps bookkeeping-only keys read-only without mistaking them for a lost run', () => {
    values.set('emblem_rogue_slot_1_run_clock_floor', '123');
    values.set('emblem_rogue_slot_1_meta_clock_floor', '456');
    values.set('emblem_rogue_slot_1_hints', '["heal"]');
    const before = new Map(values);
    expect(getSlotSummary(1)).toBeNull();
    expect(getNextAvailableSlot()).toBe(1);
    expect(values).toEqual(before);
  });
});

function seedDamagedSave() {
  values.set(META, '{bad raw meta');
  values.set(RUN, '{"actIndex":1,"gold":137}');
  values.set('emblem_rogue_slot_1_cloud_conflict', 'raw conflict');
  values.set('emblem_rogue_slot_1_run_clock_floor', '123');
  values.set('emblem_rogue_slot_1_meta_clock_floor', '456');
  values.set('emblem_rogue_slot_1_hints', '["heal"]');
  values.set('unrelated', 'untouched');
}

describe('explicit archive, discard and retirement', () => {
  it('keeps the exact raw bytes before discard and reserves the recovery-only slot', () => {
    seedDamagedSave();
    const originals = Object.fromEntries([...values].filter(([key]) => key !== 'unrelated'));
    expect(archiveAndDiscardSlot(1)).toEqual({ ok: true });
    expect(readSlotArchive(1)).toMatchObject({
      version: 1,
      slot: 1,
      state: 'archived',
      values: originals,
    });
    expect([...values.keys()].sort()).toEqual([ARCHIVE, 'unrelated'].sort());
    expect(getNextAvailableSlot()).toBe(2);
    expect(retireSlotArchive(1)).toEqual({ ok: true });
    expect(getNextAvailableSlot()).toBe(1);
    expect(values.get('unrelated')).toBe('untouched');
  });

  it('records absent keys explicitly without inventing metadata', () => {
    values.set(RUN, '{"gold":137}');
    expect(archiveAndDiscardSlot(1).ok).toBe(true);
    expect(readSlotArchive(1).values[META]).toBeNull();
    expect(values.has(META)).toBe(false);
  });

  it('does not remove any data if a recovery copy cannot be written', () => {
    seedDamagedSave();
    const before = new Map(values);
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(archiveAndDiscardSlot(1).ok).toBe(false);
    expect(values).toEqual(before);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('does not delete canonical data if backup verification fails', () => {
    seedDamagedSave();
    storage.setItem.mockImplementation((key) => values.set(key, 'truncated'));
    expect(archiveAndDiscardSlot(1).ok).toBe(false);
    expect(values.get(RUN)).toBe('{"actIndex":1,"gold":137}');
    expect(values.get(META)).toBe('{bad raw meta');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([META, RUN, 'emblem_rogue_slot_1_hints'])(
    'retains a complete recovery copy and safely retries partial deletion at %s',
    (failureKey) => {
      seedDamagedSave();
      const originals = Object.fromEntries([...values].filter(([key]) => key !== 'unrelated'));
      storage.removeItem.mockImplementation((key) => {
        if (key === failureKey) throw new Error('write denied');
        values.delete(key);
      });
      expect(archiveAndDiscardSlot(1).ok).toBe(false);
      expect(readSlotArchive(1)).toMatchObject({ state: 'archiving', values: originals });
      expect(getSlotSummary(1)?.recoveryRequired).toBe(true);
      expect(retireSlotArchive(1).ok).toBe(false);
      storage.removeItem.mockImplementation((key) => values.delete(key));
      expect(archiveAndDiscardSlot(1).ok).toBe(true);
      expect(readSlotArchive(1).values).toEqual(originals);
    },
  );

  it('never overwrites an existing archive or deletes data changed after partial discard', () => {
    seedDamagedSave();
    storage.removeItem.mockImplementation(() => {
      throw new Error('denied');
    });
    archiveAndDiscardSlot(1);
    const firstCopy = values.get(ARCHIVE);
    values.set(RUN, 'new progress from another tab');
    storage.removeItem.mockImplementation((key) => values.delete(key));
    expect(archiveAndDiscardSlot(1).ok).toBe(false);
    expect(values.get(ARCHIVE)).toBe(firstCopy);
    expect(values.get(RUN)).toBe('new progress from another tab');
    expect(retireSlotArchive(1).ok).toBe(false);
  });

  it('refuses discard/retirement while a pair restore remains unfinished', () => {
    seedDamagedSave();
    values.set(JOURNAL, 'raw restore evidence');
    const before = new Map(values);
    expect(archiveAndDiscardSlot(1).ok).toBe(false);
    expect(retireSlotArchive(1).ok).toBe(false);
    expect(values).toEqual(before);
  });

  it('logout cleanup refuses damaged or archived data without deleting healthy slots either', () => {
    seedDamagedSave();
    values.set('emblem_rogue_slot_2_meta', '{"totalValor":250}');
    const before = new Map(values);
    expect(clearAllSlotData()).toBe(false);
    expect(values).toEqual(before);
    archiveAndDiscardSlot(1);
    const afterDiscard = new Map(values);
    expect(clearAllSlotData()).toBe(false);
    expect(values).toEqual(afterDiscard);
  });
});
