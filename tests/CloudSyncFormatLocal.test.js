// The cloud hold-back for runs in a newer format (docs/specs/large-maps/04-set-pieces.md §12.1
// step 5, tests 19 and 23): a client from before the run-format guard cannot honour its marker,
// so while such clients may still be in use a run that holds a capability stays on its device,
// by the prologue's own predicate (CloudSync.isLocalOnlyRunSave, CLOUD_SAFE_RUN_FORMAT 1): never
// pushed, a stale cloud copy of it retired (only while the row is itself such a run), left out
// of logout's backup and named `newFormat`, and never pushed as the chosen side of a conflict.
// The slot's meta still syncs. The prologue keeps its own kind and reason.
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
  isLocalOnlyRunSave,
  listLocalOnlySaves,
  pushAllLocalSlots,
  pushChosenLocalRun,
  pushRunSave,
} from '../src/cloud/CloudSync.js';

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
