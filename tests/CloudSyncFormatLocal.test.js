// The cloud hold-back for runs in a newer format (docs/specs/large-maps/04-set-pieces.md §12.1
// step 5, tests 19 and 23): a client from before the run-format guard cannot honour its marker,
// so while such clients may still be in use a run that holds a capability stays on its device,
// by the prologue's own predicate (CloudSync.isLocalOnlyRunSave, CLOUD_SAFE_RUN_FORMAT 1): never
// pushed, a stale cloud copy of it retired (a row that is itself such a run, or the same run's
// older-format copy: same `runRecordId`), left out of logout's backup and named `newFormat`,
// never pushed as the chosen side of a conflict, and never replaced at login by its own
// older-format copy. The slot's meta still syncs. The prologue keeps its own kind and reason.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetaKey, getRunKey } from '../src/engine/SlotManager.js';

const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  writable: true,
});

const mocked = vi.hoisted(() => ({ from: vi.fn(), report: vi.fn() }));
vi.mock('../src/cloud/supabaseClient.js', () => ({ supabase: { from: mocked.from } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.report }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: vi.fn() }));

import {
  CLOUD_SAFE_RUN_FORMAT,
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  backupAllLocalSlots,
  fetchAllToLocalStorage,
  isLocalOnlyRunSave,
  listLocalOnlySaves,
  pushAllLocalSlots,
  pushChosenLocalRun,
  pushRunSave,
  shouldPreferLocalRun,
} from '../src/cloud/CloudSync.js';
import { cloudConflictKey } from '../src/engine/CloudSaveConflict.js';

/** One user's row of a slot table, held in memory with its revision. */
function table(initial = null) {
  const t = {
    row: initial ? { data: structuredClone(initial), updated_at: 'rev-0' } : null,
    reads: 0,
    writes: 0,
  };
  let rev = 0;
  const filtered = (run) => {
    const filters = [];
    const chain = {
      eq: (field, value) => (filters.push({ field, value }), chain),
      is: (field, value) => (filters.push({ field, value }), chain),
      select: () => chain,
      maybeSingle: async () => run(filters.find((f) => f.field === 'updated_at')?.value),
    };
    return chain;
  };
  t.api = {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          t.reads++;
          return { data: t.row && { data: t.row.data, updated_at: t.row.updated_at }, error: null };
        },
      }),
    }),
    insert: async (payload) => {
      t.writes++;
      if (t.row) return { error: { code: '23505', message: 'duplicate key' } };
      t.row = { data: payload.data, updated_at: `rev-${++rev}` };
      return { error: null };
    },
    update: (payload) =>
      filtered(async (expected) => {
        t.writes++;
        if (!t.row || (expected !== undefined && expected !== t.row.updated_at))
          return { data: null, error: null };
        t.row = { data: payload.data, updated_at: `rev-${++rev}` };
        return { data: { updated_at: t.row.updated_at }, error: null };
      }),
    delete: () =>
      filtered(async (expected) => {
        t.writes++;
        if (!t.row || (expected !== undefined && expected !== t.row.updated_at))
          return { data: null, error: null };
        t.row = null;
        return { data: { user_id: 'u' }, error: null };
      }),
    upsert: async () => ({ error: null }),
  };
  return t;
}

let runs;
let metas;
let settings;
function cloud({ run = null, meta = null } = {}) {
  runs = table(run);
  metas = table(meta);
  settings = table(null);
  mocked.from.mockImplementation((name) =>
    name === 'run_saves' ? runs.api : name === 'meta_progression' ? metas.api : settings.api,
  );
}

const standardRun = (extra = {}) => ({
  version: 1,
  mode: 'standard',
  runRecordId: 'standard-run',
  actIndex: 0,
  roster: [{ name: 'Edric' }],
  savedAt: 400,
  ...extra,
});
// Test 23's shape: kits on for the run (First Light, no set piece), and no marker at all, so
// only the payload says it is format 2.
const kitRun = (extra = {}) =>
  standardRun({
    runRecordId: 'kit-run',
    difficultyId: 'normal',
    difficultyModifiers: { bossKits: { enabled: true } },
    ...extra,
  });
// A ratcheted run: its configs pruned, only the marker holds it.
const markedRun = (extra = {}) =>
  standardRun({ runRecordId: 'marked-run', requiresClient: 2, requiresCapabilities: ['bossKit'], ...extra }); // prettier-ignore
const prologueRun = () => ({ ...standardRun({ runRecordId: 'p' }), mode: 'prologue' });
const meta = { savedAt: 300, runsStarted: 1, runsCompleted: 0 };

beforeEach(() => {
  store.clear();
  mocked.from.mockReset();
  mocked.report.mockReset();
  __resetCloudSyncQueuesForTests();
  __resetCloudSyncStatusForTests();
});

describe('a run newer than the cloud may hold stays on the device', () => {
  it('is local-only by its payload or its marker, and a format-1 run is not', () => {
    expect(CLOUD_SAFE_RUN_FORMAT).toBe(1);
    expect(isLocalOnlyRunSave(kitRun())).toBe(true);
    expect(isLocalOnlyRunSave(markedRun())).toBe(true);
    expect(isLocalOnlyRunSave(standardRun())).toBe(false);
    expect(isLocalOnlyRunSave(prologueRun())).toBe(true);
  });

  it('is never written to run_saves', async () => {
    cloud();
    expect(pushRunSave('u', 1, kitRun())).toEqual({ queued: false, reason: 'format_local' });
    expect(pushRunSave('u', 1, markedRun())).toEqual({ queued: false, reason: 'format_local' });
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
    expect(runs.writes).toBe(0);
  });

  it('retires a stale copy of such a run, never a format-1 run in the row', async () => {
    cloud({ run: { 1: kitRun({ savedAt: 100 }), 2: standardRun() } });
    pushRunSave('u', 1, kitRun({ savedAt: 700 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 2: standardRun() });

    __resetCloudSyncQueuesForTests();
    cloud({ run: { 1: standardRun({ savedAt: 900 }) } });
    pushRunSave('u', 1, kitRun());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: standardRun({ savedAt: 900 }) });
  });

  it('"Use this device save" deletes the cloud run it was chosen over instead of pushing', async () => {
    const replaced = standardRun({ savedAt: 900 });
    cloud({ run: { 1: replaced } });
    store.set(getMetaKey(1), JSON.stringify(meta));
    pushChosenLocalRun('u', 1, kitRun({ savedAt: 901 }), replaced);
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
    expect(pushChosenLocalRun('u', 1, kitRun(), null)).toEqual({
      queued: false,
      reason: 'format_local',
    });
  });

  it("logout's backup leaves it out, backs up the meta, and names it newFormat", async () => {
    cloud();
    store.set(getRunKey(1), JSON.stringify(kitRun()));
    store.set(getMetaKey(1), JSON.stringify(meta));
    store.set(getRunKey(2), JSON.stringify(prologueRun()));
    store.set(getMetaKey(2), JSON.stringify(meta));
    expect(listLocalOnlySaves()).toEqual([
      { slot: 1, kind: 'newFormat' },
      { slot: 2, kind: 'prologue' },
    ]);
    expect(await backupAllLocalSlots('u')).toEqual({
      ok: true,
      localOnly: [
        { slot: 1, kind: 'newFormat' },
        { slot: 2, kind: 'prologue' },
      ],
    });
    expect(runs.row).toBeNull();
    expect(metas.row.data).toEqual({ 1: meta, 2: meta });
    pushAllLocalSlots('u');
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });
});

// A Descent run turns local-only partway through (RunManager._buildActNodeMap raises its floor
// as it builds the route), so the cloud still holds the same run's last cloud-safe save. Left
// there, another device can load it and play on (a fork), and its newer savedAt would win the
// next login here (a rollback).
describe('a run that turns local-only takes its own older cloud copy with it', () => {
  // The same run before and after route entry: one runRecordId, format 1 then 2.
  const actFour = (extra = {}) =>
    standardRun({ runRecordId: 'descent-run', actIndex: 3, savedAt: 600, ...extra });
  const descent = (extra = {}) =>
    actFour({ requiresClient: 2, requiresCapabilities: ['descent'], actIndex: 4, savedAt: 700, ...extra }); // prettier-ignore
  const offline = () => ({
    ...runs.api,
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('offline') }) }) }), // prettier-ignore
  });

  it('the first local-only push retires the same run, whatever its savedAt, once a session', async () => {
    expect(isLocalOnlyRunSave(actFour())).toBe(false);
    expect(isLocalOnlyRunSave(descent())).toBe(true);
    // Another device played the forked copy on: newer than this device's save.
    cloud({ run: { 1: actFour({ savedAt: 900 }), 2: standardRun() } });
    expect(pushRunSave('u', 1, descent())).toEqual({ queued: false, reason: 'format_local' });
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 2: standardRun() });
    const { reads, writes } = runs;
    pushRunSave('u', 1, descent({ savedAt: 800 }));
    await __flushCloudSyncQueuesForTests();
    expect([runs.reads, runs.writes]).toEqual([reads, writes]);
  });

  it('another run in the row is kept, and checked once a session', async () => {
    const other = standardRun({ runRecordId: 'other-run', savedAt: 900 });
    cloud({ run: { 1: other } });
    pushRunSave('u', 1, descent());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: other });
    const { reads, writes } = runs;
    pushRunSave('u', 1, descent({ savedAt: 800 }));
    await __flushCloudSyncQueuesForTests();
    expect([runs.reads, runs.writes]).toEqual([reads, writes]);
  });

  it('a row with no runRecordId is never taken for the same run, even beside a save with none', async () => {
    const { runRecordId: _id, ...legacy } = actFour({ savedAt: 900 });
    cloud({ run: { 1: legacy } });
    pushRunSave('u', 1, descent());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: legacy });

    __resetCloudSyncQueuesForTests();
    cloud({ run: { 1: legacy } });
    const { runRecordId: _local, ...unnamed } = descent();
    pushRunSave('u', 1, unnamed);
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: legacy });
  });

  it('a retire that failed offline is tried again on the next save', async () => {
    cloud({ run: { 1: actFour() } });
    const failing = offline();
    mocked.from.mockImplementation((name) => (name === 'run_saves' ? failing : metas.api));
    pushRunSave('u', 1, descent());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: actFour() });
    mocked.from.mockImplementation((name) => (name === 'run_saves' ? runs.api : metas.api));
    pushRunSave('u', 1, descent({ savedAt: 800 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });

  it('a later run in the slot is checked on its own, in the same session', async () => {
    const other = standardRun({ runRecordId: 'other-run', savedAt: 900 });
    cloud({ run: { 1: other } });
    pushRunSave('u', 1, kitRun()); // checked: another run, kept
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: other });
    // The next run in the slot syncs as format 1, then enters the Descent.
    pushRunSave('u', 1, actFour({ savedAt: 1000 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: actFour({ savedAt: 1000 }) });
    pushRunSave('u', 1, descent({ savedAt: 1100 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });

  it('a later login with a stale copy of the same run keeps the local save, then retires the copy', async () => {
    // Its retire never reached the cloud (offline), and another device saved the copy since.
    const stale = actFour({ savedAt: 900 });
    expect(shouldPreferLocalRun(descent(), stale)).toBe(true);
    // Another run, or the same run's local-only copy, still goes by savedAt.
    expect(shouldPreferLocalRun(descent(), standardRun({ savedAt: 900 }))).toBe(false);
    expect(shouldPreferLocalRun(descent(), descent({ savedAt: 900 }))).toBe(false);
    const { runRecordId: _id, ...legacy } = stale;
    expect(shouldPreferLocalRun(descent(), legacy)).toBe(false);

    cloud({ run: { 1: stale }, meta: { 1: meta } });
    store.set(getRunKey(1), JSON.stringify(descent()));
    store.set(getMetaKey(1), JSON.stringify(meta));
    await fetchAllToLocalStorage('u', { timeoutMs: 50 });
    expect(JSON.parse(store.get(getRunKey(1)))).toEqual(descent());
    expect(store.has(cloudConflictKey(1))).toBe(false);
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });

  it('a later login with another, newer run still offers the cloud one as before', async () => {
    const other = standardRun({ runRecordId: 'other-run', savedAt: 900 });
    cloud({ run: { 1: other }, meta: { 1: meta } });
    store.set(getRunKey(1), JSON.stringify(descent()));
    store.set(getMetaKey(1), JSON.stringify(meta));
    await fetchAllToLocalStorage('u', { timeoutMs: 50 });
    expect(JSON.parse(store.get(getRunKey(1)))).toEqual(other);
    expect(JSON.parse(store.get(cloudConflictKey(1))).localRun).toEqual(descent());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: other });
  });
});
