import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mergeRunRecords } from '../src/engine/RunRecords.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
const record = (id, endedAt = 1) => ({
  id,
  endedAt,
  difficulty: 'normal',
  roster: [{ name: 'Sera', className: 'Light Priestess', level: 12, isLord: true }],
});
beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  });
});
describe('victory archive', () => {
  it('deduplicates cloud/local wins and bounds archive to newest 50', () => {
    const records = Array.from({ length: 60 }, (_, i) => record(String(i), i));
    const merged = mergeRunRecords(records, records, [null, {}]);
    expect(merged).toHaveLength(50);
    expect(merged[0].id).toBe('59');
    expect(merged.at(-1).id).toBe('10');
  });
  it('preserves victory metadata when an old record lacks a valid roster', () => {
    for (const roster of [undefined, null, {}, 'invalid']) {
      const merged = mergeRunRecords([{ ...record('old-win'), roster }]);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ id: 'old-win', endedAt: 1, roster: [] });
      expect(mergeRunRecords(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
    }
  });
  it('persists wins and roster snapshots, excludes defeats and tolerates old saves', () => {
    const meta = new MetaProgressionManager([]);
    expect(meta.runRecords).toEqual([]);
    const win = record('run-1');
    meta.recordRunEnd({ result: 'victory', victoryRecord: win });
    win.roster[0].level = 99;
    meta.recordRunEnd({ result: 'defeat', victoryRecord: record('run-2') });
    const loaded = new MetaProgressionManager([]);
    expect(loaded.runRecords).toHaveLength(1);
    expect(loaded.runRecords[0].roster[0].level).toBe(12);
  });
});
