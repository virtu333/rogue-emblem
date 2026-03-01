import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveRun } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { SettingsManager } from '../src/utils/SettingsManager.js';
import {
  setActiveSlot,
  deleteSlot,
  migrateOldSaves,
  clearAllSlotData,
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

// Minimal RunManager-like object for saveRun
function makeMockRunManager() {
  return {
    toJSON() {
      return { version: 1, status: 'active', actIndex: 0, roster: [], gold: 100 };
    },
  };
}

describe('H2+H3 — Save error separation', () => {
  let warnSpy;

  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.setItem.mockClear();
    localStorageMock.getItem.mockClear();
    localStorageMock.removeItem.mockClear();
    // Reset to default implementations
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = val;
    });
    localStorageMock.removeItem.mockImplementation((key) => {
      delete store[key];
    });
    localStorageMock.getItem.mockImplementation((key) => store[key] ?? null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('RunManager.saveRun', () => {
    it('returns { ok: true } on successful save', () => {
      const result = saveRun(makeMockRunManager(), null, 1);
      expect(result).toEqual({ ok: true });
    });

    it('returns { ok: false } when localStorage throws, onSave NOT called', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      const onSave = vi.fn();
      const result = saveRun(makeMockRunManager(), onSave, 1);
      expect(result).toMatchObject({ ok: false });
      expect(onSave).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RunManager] localStorage write failed'),
        expect.any(String),
      );
    });

    it('returns isQuotaError: true for QuotaExceededError', () => {
      const err = new DOMException('quota exceeded', 'QuotaExceededError');
      localStorageMock.setItem.mockImplementation(() => {
        throw err;
      });
      const result = saveRun(makeMockRunManager(), null, 1);
      expect(result).toEqual({ ok: false, reason: 'quota', isQuotaError: true });
    });

    it('returns reason: write_error for non-quota errors', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const result = saveRun(makeMockRunManager(), null, 1);
      expect(result).toEqual({ ok: false, reason: 'write_error', isQuotaError: false });
    });

    it('returns { ok: true } when localStorage succeeds but onSave throws', () => {
      const onSave = vi.fn(() => {
        throw new Error('cloud error');
      });
      const result = saveRun(makeMockRunManager(), onSave, 1);
      expect(result).toEqual({ ok: true });
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RunManager] onSave callback error'),
        expect.any(String),
      );
    });

    it('calls onSave exactly once on success', () => {
      const onSave = vi.fn();
      saveRun(makeMockRunManager(), onSave, 1);
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('MetaProgressionManager._save', () => {
    it('returns { ok: false } when localStorage throws, onSave NOT called', () => {
      const meta = new MetaProgressionManager({ storageKey: 'test_meta_err' });
      const onSave = vi.fn();
      meta.onSave = onSave;

      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      const result = meta._save();
      expect(result).toEqual({ ok: false });
      expect(onSave).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MetaProgression] localStorage write failed'),
        expect.any(String),
      );
    });

    it('returns { ok: true } when localStorage succeeds but onSave throws', () => {
      const meta = new MetaProgressionManager({ storageKey: 'test_meta_ok' });
      meta.onSave = () => {
        throw new Error('cloud error');
      };
      const result = meta._save();
      expect(result).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MetaProgression] onSave callback error'),
        expect.any(String),
      );
    });
  });

  describe('SettingsManager._save', () => {
    it('returns { ok: false } when localStorage throws, onSave NOT called', () => {
      const settings = new SettingsManager();
      const onSave = vi.fn();
      settings.onSave = onSave;

      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      const result = settings._save();
      expect(result).toEqual({ ok: false });
      expect(onSave).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Settings] localStorage write failed'),
        expect.any(String),
      );
    });

    it('returns { ok: true } when localStorage succeeds but onSave throws', () => {
      const settings = new SettingsManager();
      settings.onSave = () => {
        throw new Error('cloud error');
      };
      const result = settings._save();
      expect(result).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Settings] onSave callback error'),
        expect.any(String),
      );
    });
  });

  describe('SlotManager write errors are logged', () => {
    it('setActiveSlot logs warning on failure', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      setActiveSlot(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SlotManager] setActiveSlot failed'),
        expect.any(String),
      );
    });

    it('deleteSlot logs warning on failure', () => {
      localStorageMock.removeItem.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      deleteSlot(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SlotManager] deleteSlot failed'),
        expect.any(String),
      );
    });

    it('migrateOldSaves skips occupied slot 1 and does not call setActiveSlot', () => {
      // Pre-occupy slot 1
      store['emblem_rogue_slot_1_meta'] = '{"existing":"meta"}';
      store['emblem_rogue_slot_1_run'] = '{"existing":"run"}';
      // Seed old-format keys
      store['emblem_rogue_meta_save'] = '{"old":"meta"}';
      store['emblem_rogue_run_save'] = '{"old":"run"}';

      localStorageMock.setItem.mockClear();
      migrateOldSaves();

      // Slot 1 data preserved — old keys cleaned up
      expect(store['emblem_rogue_slot_1_meta']).toBe('{"existing":"meta"}');
      expect(store['emblem_rogue_slot_1_run']).toBe('{"existing":"run"}');
      expect(store['emblem_rogue_meta_save']).toBeUndefined();
      expect(store['emblem_rogue_run_save']).toBeUndefined();
      // setActiveSlot should NOT have been called (migratedAny = false)
      const setItemCalls = localStorageMock.setItem.mock.calls;
      const activeSlotWrites = setItemCalls.filter(([k]) => k === 'emblem_rogue_active_slot');
      expect(activeSlotWrites).toHaveLength(0);
    });

    it('migrateOldSaves logs warning on failure', () => {
      // Seed an old key so migration attempts a write
      store['emblem_rogue_meta_save'] = '{}';
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      migrateOldSaves();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SlotManager] migrateOldSaves failed'),
        expect.any(String),
      );
    });

    it('clearAllSlotData logs warning on failure', () => {
      localStorageMock.removeItem.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      clearAllSlotData();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SlotManager] deleteSlot failed'),
        expect.any(String),
      );
    });
  });
});
