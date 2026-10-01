import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  inspectSlot,
  getSlotSummary,
  getSlotCount,
  getOccupiedSlots,
  getNextAvailableSlot,
  clearAllSlotData,
  hasSlotRecoveryRecord,
  getSlotDataKeys,
} from '../src/engine/SlotManager.js';
import {
  archiveAndDiscardSlot,
  retireSlotArchive,
  readSlotArchive,
  retakeSlotArchive,
  forgetSlotArchive,
  MAX_SLOT_ARCHIVE_BYTES,
  discardExportedSlot,
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
  it('fails closed when recovery evidence cannot be read', () => {
    storage.getItem.mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(hasSlotRecoveryRecord(1)).toBe(true);
  });
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
  it('discards a verified conflict-only export at full quota', () => {
    const conflictKey = 'emblem_rogue_slot_1_cloud_conflict';
    values.set(
      conflictKey,
      JSON.stringify({
        localRun: { gold: 10 },
        cloudRun: { gold: 20 },
        cloudMeta: { totalValor: 91 },
        data: 'x'.repeat(MAX_SLOT_ARCHIVE_BYTES),
      }),
    );
    const limit = [...values.values()].reduce((sum, raw) => sum + raw.length, 0);
    storage.setItem.mockImplementation((key, raw) => {
      const size =
        [...values].reduce((sum, [k, value]) => sum + (k === key ? 0 : value.length), 0) +
        raw.length;
      if (size > limit) throw new Error('quota exceeded');
      values.set(key, raw);
    });
    const snapshot = Object.fromEntries(
      [...getSlotDataKeys(1), ARCHIVE, JOURNAL].map((key) => [key, values.get(key) ?? null]),
    );
    expect(discardExportedSlot(1, snapshot, true).ok).toBe(true);
    expect(readSlotArchive(1)).toMatchObject({ externalCopy: true, state: 'archived' });
    expect(values.has(conflictKey)).toBe(false);
  });

  it('keeps a failed conflict-anchor discard reserved even with readable progression', () => {
    const conflictKey = 'emblem_rogue_slot_1_cloud_conflict';
    values.set(META, JSON.stringify({ totalValor: 91, totalSupply: 17 }));
    values.set(conflictKey, 'x'.repeat(MAX_SLOT_ARCHIVE_BYTES));
    const snapshot = Object.fromEntries(
      [...getSlotDataKeys(1), ARCHIVE, JOURNAL].map((key) => [key, values.get(key) ?? null]),
    );
    storage.setItem.mockImplementation((key, raw) => {
      if (key === ARCHIVE) throw new Error('disk full');
      values.set(key, raw);
    });
    expect(discardExportedSlot(1, snapshot, true).ok).toBe(false);
    expect(getSlotSummary(1)).toMatchObject({ recoveryRequired: true, valor: 91, supply: 17 });
    expect(getNextAvailableSlot()).toBe(2);
  });

  it('can recover an ownership-only residue when retirement deletion fails', () => {
    seedDamagedSave();
    expect(archiveAndDiscardSlot(1).ok).toBe(true);
    const ownerKey = 'emblem_rogue_slot_1_recovery_owner';
    const owner = JSON.stringify({ version: 1, userId: 'account-a' });
    values.set(ownerKey, owner);
    storage.removeItem.mockImplementation((key) => {
      if (key === ownerKey) throw new Error('delete blocked');
      values.delete(key);
    });
    expect(retireSlotArchive(1)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Archive and discard'),
    });
    expect(values.has(ARCHIVE)).toBe(false);
    expect(values.get(ownerKey)).toBe(owner);
    expect(getSlotSummary(1)).toMatchObject({ recoveryRequired: true });
    expect(getNextAvailableSlot()).toBe(2);
    storage.removeItem.mockImplementation((key) => values.delete(key));
    expect(archiveAndDiscardSlot(1).ok).toBe(true);
    expect(readSlotArchive(1).values[ownerKey]).toBe(owner);
    expect(retireSlotArchive(1).ok).toBe(true);
    expect(getNextAvailableSlot()).toBe(1);
  });

  it('can discard a verified export when storage has no room for a second full copy', () => {
    seedDamagedSave();
    values.set(
      META,
      JSON.stringify({
        totalValor: 900,
        totalSupply: 350,
        purchases: { leadership: 3 },
        savedAt: 10,
      }),
    );
    values.set(RUN, 'x'.repeat(MAX_SLOT_ARCHIVE_BYTES));
    const limit = [...values.values()].reduce((sum, raw) => sum + raw.length, 0);
    storage.setItem.mockImplementation((key, raw) => {
      const size =
        [...values].reduce((sum, [k, value]) => sum + (k === key ? 0 : value.length), 0) +
        raw.length;
      if (size > limit) throw new Error('quota exceeded');
      values.set(key, raw);
    });
    const keys = [...getSlotDataKeys(1), ARCHIVE, JOURNAL];
    const snapshot = Object.fromEntries(keys.map((key) => [key, values.get(key) ?? null]));
    expect(archiveAndDiscardSlot(1).ok).toBe(false);
    expect(discardExportedSlot(1, snapshot, true).ok).toBe(true);
    expect(readSlotArchive(1)).toMatchObject({ externalCopy: true, state: 'archived' });
    expect(values.get('unrelated')).toBe('untouched');
  });

  it.each(['reservation', 'deletion'])(
    'retains a damaged/reserved slot if exported discard fails during %s',
    (stage) => {
      seedDamagedSave();
      values.set(
        META,
        JSON.stringify({
          totalValor: 900,
          totalSupply: 350,
          purchases: { leadership: 3 },
          savedAt: 10,
        }),
      );
      values.set(RUN, 'x'.repeat(MAX_SLOT_ARCHIVE_BYTES));
      const keys = [...getSlotDataKeys(1), ARCHIVE, JOURNAL];
      const snapshot = Object.fromEntries(keys.map((key) => [key, values.get(key) ?? null]));
      if (stage === 'reservation')
        storage.setItem.mockImplementation((key, raw) => {
          if (key === ARCHIVE) throw new Error('disk full');
          values.set(key, raw);
        });
      else
        storage.removeItem.mockImplementation((key) => {
          if (key === RUN) throw new Error('delete blocked');
          values.delete(key);
        });
      expect(discardExportedSlot(1, snapshot, true).ok).toBe(false);
      expect(getSlotSummary(1)).toMatchObject({ recoveryRequired: true });
      expect(getNextAvailableSlot()).toBe(2);
      expect(retireSlotArchive(1).ok).toBe(false);
      expect(snapshot[RUN]).toBe('x'.repeat(MAX_SLOT_ARCHIVE_BYTES));
    },
  );

  it('permits oversized discard only after an explicitly verified, unchanged external export', () => {
    seedDamagedSave();
    values.set(RUN, 'x'.repeat(MAX_SLOT_ARCHIVE_BYTES));
    const snapshot = Object.fromEntries(
      [
        META,
        RUN,
        ARCHIVE,
        JOURNAL,
        'emblem_rogue_slot_1_run_clock_floor',
        'emblem_rogue_slot_1_meta_clock_floor',
        'emblem_rogue_slot_1_cloud_conflict',
        'emblem_rogue_slot_1_hints',
        'emblem_rogue_slot_1_recovery_owner',
      ].map((key) => [key, values.get(key) ?? null]),
    );
    const before = new Map(values);
    expect(discardExportedSlot(1, snapshot, false).ok).toBe(false);
    expect(values).toEqual(before);
    expect(discardExportedSlot(1, snapshot, true).ok).toBe(true);
    expect(values.has(RUN)).toBe(false);
    expect(readSlotArchive(1)).toMatchObject({ externalCopy: true, state: 'archived' });
    expect(getNextAvailableSlot()).toBe(2);
    expect(retireSlotArchive(1).ok).toBe(true);
    expect(getNextAvailableSlot()).toBe(1);
  });

  it('refuses external discard when new data arrived after export', () => {
    seedDamagedSave();
    const snapshot = {};
    const before = new Map(values);
    expect(discardExportedSlot(1, snapshot, true).ok).toBe(false);
    expect(values).toEqual(before);
  });
  it('retakes changed pending data only before any deletion has started', () => {
    seedDamagedSave();
    storage.removeItem.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    // Preparing alone (such as a cancelled native acknowledgement) permits retake.
    const originalRemove = storage.removeItem;
    values.set(
      ARCHIVE,
      JSON.stringify({
        version: 1,
        slot: 1,
        state: 'archiving',
        values: Object.fromEntries(
          [
            META,
            RUN,
            'emblem_rogue_slot_1_run_clock_floor',
            'emblem_rogue_slot_1_meta_clock_floor',
            'emblem_rogue_slot_1_cloud_conflict',
            'emblem_rogue_slot_1_hints',
          ].map((key) => [key, values.get(key) ?? null]),
        ),
      }),
    );
    values.set(RUN, '{"gold":888}');
    expect(retakeSlotArchive(1).ok).toBe(true);
    expect(readSlotArchive(1).values[RUN]).toBe('{"gold":888}');
    expect(archiveAndDiscardSlot(1).ok).toBe(false);
    expect(retakeSlotArchive(1).ok).toBe(false);
    expect(values.get(RUN)).toBe('{"gold":888}');
    expect(originalRemove).toHaveBeenCalled();
  });

  it('refuses oversized archives without removing the raw originals', () => {
    seedDamagedSave();
    values.set(RUN, 'x'.repeat(MAX_SLOT_ARCHIVE_BYTES));
    const before = new Map(values);
    expect(archiveAndDiscardSlot(1)).toMatchObject({ ok: false });
    expect(values).toEqual(before);
  });

  it('can explicitly forget malformed recovery evidence without touching canonical or cloud bytes', () => {
    seedDamagedSave();
    values.set(ARCHIVE, '{bad archive');
    const before = new Map(values);
    expect(forgetSlotArchive(1)).toEqual({ ok: true });
    before.delete(ARCHIVE);
    expect(values).toEqual(before);
  });
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
      expect(readSlotArchive(1).values).toEqual({
        ...originals,
        emblem_rogue_slot_1_recovery_owner: null,
      });
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

  it('logout clears healthy cache but keeps damaged and archived recovery evidence', () => {
    seedDamagedSave();
    values.set('emblem_rogue_slot_2_meta', '{"totalValor":250}');
    const before = new Map(values);
    expect(clearAllSlotData()).toBe(false);
    before.delete('emblem_rogue_slot_2_meta');
    expect(values).toEqual(before);
    archiveAndDiscardSlot(1);
    const afterDiscard = new Map(values);
    expect(clearAllSlotData()).toBe(false);
    expect(values).toEqual(afterDiscard);
  });
});
