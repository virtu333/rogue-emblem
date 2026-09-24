import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  preserveCloudConflict,
  getCloudSaveConflict,
  resolveCloudSaveConflict,
  hasMaterialRunDifference,
  describeSavedRun,
  cloudConflictKey,
} from '../src/engine/CloudSaveConflict.js';
import { getRunKey, getMetaKey, getSlotSummary, deleteSlot } from '../src/engine/SlotManager.js';
let storage;
beforeEach(() => {
  const values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: (key) => values.delete(key),
  };
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());
const local = {
  savedAt: 1,
  gold: 200,
  roster: [{ name: 'Sera' }],
  actIndex: 0,
  battleInProgress: { checkpoint: {} },
};
const cloud = { savedAt: 2, gold: 500, roster: [{ name: 'Edric' }], actIndex: 1 };

describe('cloud save recovery', () => {
  it('ignores timestamp-only and object key ordering changes', () => {
    expect(
      hasMaterialRunDifference(
        { gold: 2, savedAt: 1, roster: [] },
        { savedAt: 4, roster: [], gold: 2 },
      ),
    ).toBe(false);
  });
  it('preserves original local progress and metadata across repeated cloud pulls', () => {
    storage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 50, savedAt: 1 }));
    expect(preserveCloudConflict(1, local, cloud)).toBe(true);
    preserveCloudConflict(1, cloud, { ...cloud, gold: 700, savedAt: 3 });
    expect(getCloudSaveConflict(1).localRun).toEqual(local);
    expect(getCloudSaveConflict(1).localMeta.totalValor).toBe(50);
    expect(getCloudSaveConflict(1).cloudRun.gold).toBe(700);
  });
  it('restores a coherent device run and meta pair with a fresh clock for syncing', () => {
    storage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 50, savedAt: 1 }));
    preserveCloudConflict(1, local, cloud);
    storage.setItem(getRunKey(1), JSON.stringify(cloud));
    storage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 100, savedAt: 2 }));
    const result = resolveCloudSaveConflict(1, 'local');
    expect(result.ok).toBe(true);
    expect(result.run.gold).toBe(200);
    expect(result.meta.totalValor).toBe(50);
    expect(result.run.savedAt).toBeGreaterThan(2);
    expect(getCloudSaveConflict(1)).toBeNull();
  });
  it('explicitly applies the retained cloud pair when automatic run write never happened', () => {
    const deviceMeta = { totalValor: 50, savedAt: 1 };
    const cloudMeta = { totalValor: 100, savedAt: 2 };
    storage.setItem(getRunKey(1), JSON.stringify(local));
    storage.setItem(getMetaKey(1), JSON.stringify(deviceMeta));
    preserveCloudConflict(1, local, cloud, cloudMeta);
    // The fetch's later run write failed; live keys still contain the device pair.
    const result = resolveCloudSaveConflict(1, 'cloud');
    expect(result.ok).toBe(true);
    expect(result.run).toEqual(cloud);
    expect(result.meta).toEqual(cloudMeta);
    expect(JSON.parse(storage.getItem(getRunKey(1)))).toEqual(cloud);
    expect(getCloudSaveConflict(1)).toBeNull();
  });
  it('rolls back a failed cloud-meta choice and permits a coherent retry', () => {
    const deviceMeta = { totalValor: 50, savedAt: 1 };
    const cloudMeta = { totalValor: 100, savedAt: 2 };
    storage.setItem(getRunKey(1), JSON.stringify(local));
    storage.setItem(getMetaKey(1), JSON.stringify(deviceMeta));
    preserveCloudConflict(1, local, cloud, cloudMeta);
    const set = storage.setItem.getMockImplementation();
    storage.setItem.mockImplementation((key, value) => {
      if (key === getMetaKey(1) && JSON.parse(value).totalValor === 100) throw new Error('quota');
      return set(key, value);
    });
    expect(resolveCloudSaveConflict(1, 'cloud').ok).toBe(false);
    expect(JSON.parse(storage.getItem(getRunKey(1)))).toEqual(local);
    expect(JSON.parse(storage.getItem(getMetaKey(1)))).toEqual(deviceMeta);
    expect(getCloudSaveConflict(1).cloudRun).toEqual(cloud);
    storage.setItem.mockImplementation(set);
    expect(resolveCloudSaveConflict(1, 'cloud')).toMatchObject({
      ok: true,
      run: cloud,
      meta: cloudMeta,
    });
  });
  it('refuses overwrite if the backup cannot be written', () => {
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(preserveCloudConflict(1, local, cloud)).toBe(false);
  });
  it('rolls back both keys and keeps recovery data when the selected meta cannot be written', () => {
    storage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 50, savedAt: 1 }));
    preserveCloudConflict(1, local, cloud);
    storage.setItem(getRunKey(1), JSON.stringify(cloud));
    storage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 100, savedAt: 2 }));
    const set = storage.setItem.getMockImplementation();
    storage.setItem.mockImplementation((key, value) => {
      if (key === getMetaKey(1) && JSON.parse(value).totalValor === 50) throw new Error('quota');
      return set(key, value);
    });
    expect(resolveCloudSaveConflict(1, 'local').ok).toBe(false);
    expect(JSON.parse(storage.getItem(getRunKey(1)))).toEqual(cloud);
    expect(JSON.parse(storage.getItem(getMetaKey(1))).totalValor).toBe(100);
    expect(getCloudSaveConflict(1).localRun).toEqual(local);
  });
  it('retains recovery data instead of selecting a cloud run without progression', () => {
    storage.setItem(getMetaKey(1), JSON.stringify({ savedAt: 1, totalValor: 50 }));
    preserveCloudConflict(1, local, cloud, null);
    storage.setItem(getRunKey(1), JSON.stringify(local));
    expect(resolveCloudSaveConflict(1, 'cloud')).toMatchObject({ ok: false });
    expect(getCloudSaveConflict(1)).not.toBeNull();
    expect(JSON.parse(storage.getItem(getRunKey(1)))).toEqual(local);
  });
  it('slot deletion also removes the retained backup', () => {
    preserveCloudConflict(1, local, cloud);
    deleteSlot(1);
    expect(storage.getItem(cloudConflictKey(1))).toBeNull();
  });
  it('makes suspended saves identifiable in slot summaries', () => {
    storage.setItem(getMetaKey(1), '{}');
    storage.setItem(getRunKey(1), JSON.stringify(local));
    expect(getSlotSummary(1)).toMatchObject({
      savedAt: 1,
      rosterNames: ['Sera'],
      battleSuspended: true,
      completedBattles: 0,
    });
    expect(describeSavedRun(local)).toContain('Battle suspended');
  });
});
