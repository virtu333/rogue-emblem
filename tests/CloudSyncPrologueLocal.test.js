// The prologue's run save stays on the device (CloudSync.isLocalOnlyRunSave;
// docs/specs/prologue-chapter.md §9 "RunManager"). A client from before the prologue
// reads run_saves without knowing `mode` and would open a prologue run save as a
// standard run on the seven-node authored map, so a prologue save never reaches the
// cloud: not on save, not in logout's backup, not as the chosen side of a conflict.
// Around it: a stale prologue row an earlier build pushed is retired (only ever a
// prologue row), a later standard run pushes as before, and another device that
// fetches the slot finds no run and is offered the prologue again.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMetaKey,
  getRunKey,
  getSlotSummary,
  getSlotCloudPendingKey,
} from '../src/engine/SlotManager.js';
import { routeForSlot, PROLOGUE_ROUTES } from '../src/engine/PrologueRouting.js';

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
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  backupAllLocalSlots,
  fetchAllToLocalStorage,
  isLocalOnlyRunSave,
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

const prologueRun = (extra = {}) => ({
  version: 1,
  mode: 'prologue',
  runRecordId: 'prologue-run',
  actIndex: 0,
  roster: [{ name: 'Edric' }],
  nodeMap: { nodes: [{ id: 'prologue_0' }] },
  currentNodeId: null,
  savedAt: 500,
  ...extra,
});
const standardRun = (extra = {}) => ({
  version: 1,
  mode: 'standard',
  runRecordId: 'standard-run',
  actIndex: 0,
  roster: [{ name: 'Edric' }],
  savedAt: 400,
  ...extra,
});
const inProgressMeta = { savedAt: 300, runsStarted: 0, runsCompleted: 0, prologue: { state: 'in_progress' } }; // prettier-ignore

beforeEach(() => {
  store.clear();
  mocked.from.mockReset();
  mocked.report.mockReset();
  __resetCloudSyncQueuesForTests();
  __resetCloudSyncStatusForTests();
});

describe('the prologue run save stays on the device', () => {
  it('names the prologue run save local-only, and nothing else', () => {
    expect(isLocalOnlyRunSave(prologueRun())).toBe(true);
    expect(isLocalOnlyRunSave(standardRun())).toBe(false);
    // A save from before the prologue carries no mode: a standard run.
    expect(isLocalOnlyRunSave({ version: 1, actIndex: 2 })).toBe(false);
    expect(isLocalOnlyRunSave(null)).toBe(false);
  });

  it('a prologue save is never written to run_saves', async () => {
    cloud();
    expect(pushRunSave('u', 1, prologueRun())).toEqual({
      queued: false,
      reason: 'prologue_local',
    });
    pushRunSave('u', 1, prologueRun({ savedAt: 600 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
    expect(runs.writes).toBe(0);
  });

  it("a standard run in the slot's row (another device's) is never touched by it", async () => {
    cloud({ run: { 1: standardRun({ savedAt: 900 }) } });
    pushRunSave('u', 1, prologueRun());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: standardRun({ savedAt: 900 }) });
  });

  it('a prologue row an earlier build pushed is retired, once a session, other slots kept', async () => {
    cloud({ run: { 1: prologueRun({ savedAt: 100 }), 2: standardRun() } });
    pushRunSave('u', 1, prologueRun({ savedAt: 700 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 2: standardRun() });
    const reads = runs.reads;
    pushRunSave('u', 1, prologueRun({ savedAt: 800 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.reads).toBe(reads);
    expect(runs.row.data).toEqual({ 2: standardRun() });
  });

  it('the prologue row alone: retiring it removes the row', async () => {
    cloud({ run: { 1: prologueRun({ savedAt: 100 }) } });
    pushRunSave('u', 1, prologueRun());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });

  it('a retire that fails is tried again on the next save', async () => {
    cloud({ run: { 1: prologueRun({ savedAt: 100 }) } });
    const failing = { ...runs.api, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('offline') }) }) }) }; // prettier-ignore
    mocked.from.mockImplementation((name) => (name === 'run_saves' ? failing : metas.api));
    pushRunSave('u', 1, prologueRun());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).not.toBeNull();
    mocked.from.mockImplementation((name) => (name === 'run_saves' ? runs.api : metas.api));
    pushRunSave('u', 1, prologueRun());
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });

  it('the first real run after the prologue pushes as before', async () => {
    cloud();
    pushRunSave('u', 1, prologueRun());
    pushRunSave('u', 1, standardRun({ savedAt: 900 }));
    await __flushCloudSyncQueuesForTests();
    expect(runs.row.data).toEqual({ 1: standardRun({ savedAt: 900 }) });
  });

  it("logout's backup leaves the prologue run out, backs up the slot's meta, and names it as local-only", async () => {
    cloud();
    store.set(getRunKey(1), JSON.stringify(prologueRun()));
    store.set(getMetaKey(1), JSON.stringify(inProgressMeta));
    // The batch it could carry is confirmed; the prologue it could not is named, so
    // sign-out asks before discarding it (TitleScene._handleLogout).
    expect(await backupAllLocalSlots('u')).toEqual({
      ok: true,
      localOnly: [{ slot: 1, kind: 'prologue' }],
    });
    expect(runs.row).toBeNull();
    expect(metas.row.data).toEqual({ 1: inProgressMeta });
    // (pushAllLocalSlots, the same walk without the confirmation.)
    pushAllLocalSlots('u');
    await __flushCloudSyncQueuesForTests();
    expect(runs.row).toBeNull();
  });

  it('another device that fetches the slot finds no run and is offered the prologue again', async () => {
    // What the cloud holds after this device played P1 and part of the route: the
    // slot's meta, no run.
    cloud({ meta: { 1: inProgressMeta } });
    await fetchAllToLocalStorage('u', { timeoutMs: 50 });
    expect(store.has(getRunKey(1))).toBe(false);
    expect(store.has(getSlotCloudPendingKey(1))).toBe(false);
    const summary = getSlotSummary(1);
    expect(summary.prologue).toBe('in_progress');
    expect(routeForSlot(summary, { hasPrologue: true })).toBe(PROLOGUE_ROUTES.OFFER);
  });

  describe('"Use this device save" with the prologue run', () => {
    it('deletes the cloud run it was chosen over, and pushes no prologue', async () => {
      const replaced = standardRun({ savedAt: 900 });
      cloud({ run: { 1: replaced } });
      store.set(getMetaKey(1), JSON.stringify(inProgressMeta));
      pushChosenLocalRun('u', 1, prologueRun({ savedAt: 901 }), replaced);
      await __flushCloudSyncQueuesForTests();
      expect(runs.row).toBeNull();
    });

    it('keeps a cloud run that changed since the choice was offered', async () => {
      const replaced = standardRun({ savedAt: 900 });
      const newer = standardRun({ runRecordId: 'another-run', savedAt: 950 });
      cloud({ run: { 1: newer } });
      store.set(getMetaKey(1), JSON.stringify(inProgressMeta));
      pushChosenLocalRun('u', 1, prologueRun({ savedAt: 901 }), replaced);
      await __flushCloudSyncQueuesForTests();
      expect(runs.row.data).toEqual({ 1: newer });
    });

    it('a chosen standard run is pushed as before', async () => {
      cloud({ run: { 1: standardRun({ savedAt: 900 }) } });
      const chosen = standardRun({ runRecordId: 'local-run', savedAt: 901 });
      pushChosenLocalRun('u', 1, chosen, standardRun({ savedAt: 900 }));
      await __flushCloudSyncQueuesForTests();
      expect(runs.row.data).toEqual({ 1: chosen });
    });
  });
});
