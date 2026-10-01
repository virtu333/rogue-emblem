import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ mirror: null }));
vi.mock('../src/utils/nativeSaveMirror.js', async () => ({
  ...(await vi.importActual('../src/utils/nativeSaveMirror.js')),
  nativeCapacitor: () => true,
  getNativeSaveMirror: () => mocked.mirror,
}));
vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              data:
                table === 'run_saves'
                  ? { 1: { runRecordId: 'cloud-healthy', gold: 731, savedAt: 100 } }
                  : table === 'meta_progression'
                    ? { 1: { totalValor: 347, savedAt: 100 } }
                    : null,
            },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
import {
  NativeSaveMirror,
  planRestore,
  recordFileNames,
  encodeRecord,
  decodeRecord,
} from '../src/utils/nativeSaveMirror.js';
import {
  getMetaKey,
  getRunKey,
  getSlotCloudPendingKey,
  inspectSlot,
} from '../src/engine/SlotManager.js';
import { stampPendingCloudPair } from '../src/engine/CloudPendingRecovery.js';
import { fetchAllToLocalStorage, __resetCloudSyncStatusForTests } from '../src/cloud/CloudSync.js';
let local, storage, files, mirror;
const META = getMetaKey(1),
  RUN = getRunKey(1),
  PENDING = getSlotCloudPendingKey(1);
const reservation = JSON.stringify({ version: 1, userId: 'account-a', savedAt: 200 });
function diskRecords() {
  const records = new Map();
  for (const raw of files.values()) {
    const record = decodeRecord(raw);
    if (record && (!records.has(record.key) || records.get(record.key).seq < record.seq))
      records.set(record.key, record);
  }
  return records;
}
beforeEach(() => {
  local = new Map([[PENDING, reservation]]);
  files = new Map();
  storage = {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key),
  };
  vi.stubGlobal('localStorage', storage);
  __resetCloudSyncStatusForTests();
  mirror = new NativeSaveMirror({
    storage,
    backend: { write: async (name, raw) => files.set(name, raw) },
  });
  mirror.active = true;
  for (const key of [META, RUN]) {
    const [name] = recordFileNames(key);
    files.set(name, encodeRecord({ key, seq: 10, value: null, deletedSavedAt: 1000 }));
    mirror.records.set(key, { seq: 10, value: null, slot: name, pending: 0, deletedSavedAt: 1000 });
    mirror.stamps.set(key, 1000);
  }
  const [name] = recordFileNames(PENDING);
  files.set(name, encodeRecord({ key: PENDING, seq: 1, value: reservation }));
  mirror.records.set(PENDING, { seq: 1, value: reservation, slot: name, pending: 0 });
  mocked.mirror = mirror;
});
afterEach(() => vi.unstubAllGlobals());
describe('native cloud Free recovery across process kill', () => {
  it('recovered stamps outrank both tombstones and a future live native record', () => {
    mirror.stamps.set(RUN, 5000);
    mirror.records.set(RUN, { value: JSON.stringify({ savedAt: 7000 }), deletedSavedAt: 6000 });
    const pair = stampPendingCloudPair(
      1,
      { runRecordId: 'cloud-healthy', savedAt: 100 },
      { totalValor: 347, savedAt: 100 },
      storage,
      mirror,
      50,
    );
    expect(JSON.parse(pair.find(([key]) => key === RUN)[1]).savedAt).toBe(7001);
    expect(JSON.parse(pair.find(([key]) => key === META)[1]).savedAt).toBe(1001);
  });
  it.each(['reservation', 'meta', 'run', 'retirement', 'success'])(
    'preserves a playable pair or its reservation when disk acknowledgement %s fails',
    async (failure) => {
      const durable = mirror.ensureDurable.bind(mirror);
      mirror.ensureDurable = vi.fn(async (key, value) => {
        if (
          (failure === 'reservation' && key === PENDING && value !== null) ||
          (failure === 'meta' && key === META) ||
          (failure === 'run' && key === RUN) ||
          (failure === 'retirement' && key === PENDING && value === null)
        )
          return false;
        return durable(key, value);
      });
      await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
      const native = diskRecords();
      const intact = planRestore({ local: new Map(local), sentinelPresent: true, records: native });
      expect(intact.remove).not.toContain(RUN);
      expect(intact.remove).not.toContain(META);
      const evicted = planRestore({ local: new Map(), sentinelPresent: false, records: native });
      const restored = new Map(evicted.restore);
      if (failure === 'success') {
        expect(local.has(PENDING)).toBe(false);
        expect(restored.has(PENDING)).toBe(false);
        expect(JSON.parse(restored.get(RUN))).toMatchObject({
          runRecordId: 'cloud-healthy',
          gold: 731,
        });
        expect(JSON.parse(restored.get(META)).totalValor).toBe(347);
        expect(JSON.parse(local.get(RUN)).savedAt).toBeGreaterThan(1000);
      } else {
        expect(local.get(PENDING)).toBe(reservation);
        expect(restored.get(PENDING)).toBe(reservation);
        expect(inspectSlot(1).status).toBe('recovery-required');
        mirror.ensureDurable = durable;
        await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
        expect(local.has(PENDING)).toBe(false);
        expect(JSON.parse(local.get(RUN))).toMatchObject({
          runRecordId: 'cloud-healthy',
          gold: 731,
        });
        expect(JSON.parse(local.get(META)).totalValor).toBe(347);
      }
      clearTimeout(mirror.timer);
      clearTimeout(mirror.maxTimer);
    },
  );
});
