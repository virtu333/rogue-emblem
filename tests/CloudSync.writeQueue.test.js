import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetaKey, getRunClockFloorKey } from '../src/engine/SlotManager.js';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const mocked = vi.hoisted(() => ({
  reportAsyncError: vi.fn(),
  markStartup: vi.fn(),
  fromMock: vi.fn(),
  refreshSessionMock: vi.fn(async () => ({
    data: { session: { access_token: 'new' } },
    error: null,
  })),
}));

vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.reportAsyncError }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: mocked.markStartup }));
vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: {
    from: mocked.fromMock,
    auth: {
      refreshSession: mocked.refreshSessionMock,
    },
  },
}));

import {
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  deleteRunSave,
  fetchAllToLocalStorage,
  getCloudSyncStatus,
  pushMeta,
  pushRunSave,
} from '../src/cloud/CloudSync.js';

function getRevisionExpectation(filters) {
  for (const filter of filters) {
    if (filter.field !== 'updated_at') continue;
    return filter;
  }
  return null;
}

function makeFilterChain(handler) {
  const filters = [];
  const chain = {
    eq: vi.fn((field, value) => {
      filters.push({ method: 'eq', field, value });
      return chain;
    }),
    is: vi.fn((field, value) => {
      filters.push({ method: 'is', field, value });
      return chain;
    }),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => handler(filters)),
  };
  return chain;
}

function makeSlotTableApi({
  slotMap = {},
  exists = true,
  selectError = null,
  insertError = null,
  updateError = null,
  updateErrorSequence = null,
  deleteError = null,
  conflictOnAllUpdates = false,
  injectSingleUpdateConflict = null,
} = {}) {
  const state = {
    row: exists ? { data: { ...slotMap }, updated_at: 'rev-1' } : null,
    selectCalls: 0,
    updateCalls: 0,
    deleteCalls: 0,
    insertCalls: 0,
    injectedConflict: false,
    updateErrorSequence: Array.isArray(updateErrorSequence) ? [...updateErrorSequence] : null,
  };

  function matchesRevisionFilter(expected) {
    if (!expected) return true;
    if (!state.row) return false;
    if (expected.method === 'eq') return state.row.updated_at === expected.value;
    if (expected.method === 'is') return state.row.updated_at === null;
    return false;
  }

  return {
    state,
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          state.selectCalls++;
          if (selectError) return { data: null, error: selectError };
          if (!state.row) return { data: null, error: null };
          return { data: { data: state.row.data, updated_at: state.row.updated_at }, error: null };
        }),
      })),
    })),
    insert: vi.fn(async (payload) => {
      state.insertCalls++;
      if (insertError) return { error: insertError };
      if (state.row) {
        return {
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        };
      }
      state.row = {
        data: payload.data ?? {},
        updated_at: payload.updated_at ?? `rev-${state.insertCalls + 1}`,
      };
      return { error: null };
    }),
    update: vi.fn((payload) =>
      makeFilterChain(async (filters) => {
        state.updateCalls++;
        if (state.updateErrorSequence && state.updateErrorSequence.length > 0) {
          const nextError = state.updateErrorSequence.shift();
          if (nextError) return { data: null, error: nextError };
        }
        if (updateError) return { data: null, error: updateError };
        if (!state.row) return { data: null, error: null };
        if (typeof injectSingleUpdateConflict === 'function' && !state.injectedConflict) {
          state.injectedConflict = true;
          injectSingleUpdateConflict(state);
          return { data: null, error: null };
        }
        if (conflictOnAllUpdates) return { data: null, error: null };

        const expected = getRevisionExpectation(filters);
        if (!matchesRevisionFilter(expected)) return { data: null, error: null };

        state.row = {
          data: payload.data ?? {},
          updated_at: payload.updated_at ?? `rev-${state.updateCalls + 1}`,
        };
        return { data: { updated_at: state.row.updated_at }, error: null };
      }),
    ),
    delete: vi.fn(() =>
      makeFilterChain(async (filters) => {
        state.deleteCalls++;
        if (deleteError) return { data: null, error: deleteError };
        if (!state.row) return { data: null, error: null };
        const expected = getRevisionExpectation(filters);
        if (!matchesRevisionFilter(expected)) return { data: null, error: null };
        state.row = null;
        return { data: { user_id: 'user-1' }, error: null };
      }),
    ),
    upsert: vi.fn(async () => ({ error: null })),
  };
}

function matchesRevisionFilter(row, expected) {
  if (!expected) return true;
  if (!row) return false;
  if (expected.method === 'eq') return row.updated_at === expected.value;
  if (expected.method === 'is') return row.updated_at === null;
  return false;
}

describe('CloudSync write queue hardening', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    mocked.fromMock.mockReset();
    mocked.refreshSessionMock.mockReset();
    mocked.refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: 'new' } },
      error: null,
    });
    __resetCloudSyncQueuesForTests();
    __resetCloudSyncStatusForTests();
  });

  it('reports async error when run slot update returns a Supabase error', async () => {
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 1 } },
      updateError: new Error('update-failed'),
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.update).toHaveBeenCalledTimes(1);
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_update_slot',
      expect.any(Error),
      expect.objectContaining({ table: 'run_saves', slot: 1, operation: 'upsert' }),
    );
  });

  it('retries stale conflict and preserves unrelated cloud slot data', async () => {
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 1 } },
      injectSingleUpdateConflict: (state) => {
        state.row = {
          data: {
            1: { version: 1 },
            2: { marker: 'other-tab' },
          },
          updated_at: 'rev-external',
        };
      },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.updateCalls).toBe(2);
    expect(runApi.state.row?.data).toEqual({
      1: { version: 2 },
      2: { marker: 'other-tab' },
    });
    expect(mocked.reportAsyncError).not.toHaveBeenCalled();
  });

  it('reports once when conflict retries are exhausted', async () => {
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 1 } },
      conflictOnAllUpdates: true,
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.updateCalls).toBe(3);
    const updateFailures = mocked.reportAsyncError.mock.calls.filter(
      ([context]) => context === 'cloud_update_slot',
    );
    expect(updateFailures).toHaveLength(1);
    expect(updateFailures[0][1]).toMatchObject({ code: 'CLOUD_CONFLICT_RETRY_EXHAUSTED' });
    expect(updateFailures[0][2]).toEqual(expect.objectContaining({ maxAttempts: 3 }));
  });

  it('marks shared status when write fails due to auth expiry', async () => {
    const authError = { message: 'JWT expired', status: 401, code: 'PGRST301' };
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 1 } },
      updateError: authError,
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(true);
    expect(status.mode).toBe('auth_expired');
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_update_slot',
      authError,
      expect.objectContaining({ authExpired: true }),
    );
  });

  it('refreshes session once and retries write on auth expiry', async () => {
    const authError = { message: 'JWT expired', status: 401, code: 'PGRST301' };
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 1, savedAt: 100 } },
      updateErrorSequence: [authError, null],
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 2, savedAt: 200 });
    await __flushCloudSyncQueuesForTests();

    expect(mocked.refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(runApi.state.updateCalls).toBe(2);
    expect(runApi.state.row?.data?.['1']).toEqual({ version: 2, savedAt: 200 });
    expect(getCloudSyncStatus().authExpired).toBe(false);
  });

  it('clears shared status after a later successful write', async () => {
    const authError = { message: 'JWT expired', status: 401, code: 'PGRST301' };
    const failingRunApi = makeSlotTableApi({
      slotMap: { 1: { version: 1 } },
      updateError: authError,
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return failingRunApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();
    expect(getCloudSyncStatus().authExpired).toBe(true);

    const healthyRunApi = makeSlotTableApi({
      slotMap: { 1: { version: 2 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return healthyRunApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 3 });
    await __flushCloudSyncQueuesForTests();

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(false);
    expect(status.mode).toBe('ok');
  });

  it('syncs local meta to cloud when deleteRunSave removes a run slot', async () => {
    const runApi = makeSlotTableApi({
      slotMap: { 1: { runSeed: 7 } },
    });
    const metaApi = makeSlotTableApi({
      slotMap: { 2: { totalValor: 10 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      if (table === 'meta_progression') return metaApi;
      return makeSlotTableApi();
    });

    const localMeta = { totalValor: 99, savedAt: 123 };
    localStorage.setItem(getMetaKey(1), JSON.stringify(localMeta));

    deleteRunSave('user-1', 1);
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.row).toBeNull();
    expect(metaApi.state.row?.data).toEqual({
      1: localMeta,
      2: { totalValor: 10 },
    });
  });

  it('serializes deleteRunSave with concurrent run/meta writes on shared queues', async () => {
    const runApi = makeSlotTableApi({
      slotMap: { 1: { runSeed: 7, savedAt: 100 } },
    });

    let releaseFirstMetaUpdate;
    const firstMetaUpdateGate = new Promise((resolve) => {
      releaseFirstMetaUpdate = resolve;
    });
    const metaState = {
      row: { data: { 1: { totalValor: 5, savedAt: 50 } }, updated_at: 'rev-1' },
      updateCalls: 0,
      selectCalls: 0,
    };
    const metaApi = {
      state: metaState,
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            metaState.selectCalls++;
            if (!metaState.row) return { data: null, error: null };
            return {
              data: { data: metaState.row.data, updated_at: metaState.row.updated_at },
              error: null,
            };
          }),
        })),
      })),
      insert: vi.fn(async (payload) => {
        metaState.row = {
          data: payload.data ?? {},
          updated_at: payload.updated_at ?? 'rev-insert',
        };
        return { error: null };
      }),
      update: vi.fn((payload) =>
        makeFilterChain(async (filters) => {
          metaState.updateCalls++;
          if (metaState.updateCalls === 1) await firstMetaUpdateGate;
          if (!metaState.row) return { data: null, error: null };
          const expected = getRevisionExpectation(filters);
          if (!matchesRevisionFilter(metaState.row, expected)) {
            return { data: null, error: null };
          }
          metaState.row = {
            data: payload.data ?? {},
            updated_at: payload.updated_at ?? `rev-${metaState.updateCalls + 1}`,
          };
          return { data: { updated_at: metaState.row.updated_at }, error: null };
        }),
      ),
      delete: vi.fn(() =>
        makeFilterChain(async () => ({ data: { user_id: 'user-1' }, error: null })),
      ),
      upsert: vi.fn(async () => ({ error: null })),
    };

    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      if (table === 'meta_progression') return metaApi;
      return makeSlotTableApi();
    });

    localStorage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 99, savedAt: 123 }));

    deleteRunSave('user-1', 1);
    for (let i = 0; i < 25 && metaState.updateCalls === 0; i++) await Promise.resolve();
    expect(metaState.updateCalls).toBe(1);

    pushRunSave('user-1', 1, { runSeed: 42, savedAt: 300 });
    pushMeta('user-1', 1, { totalValor: 777, savedAt: 301 });

    releaseFirstMetaUpdate();
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.row?.data?.['1']).toEqual({ runSeed: 42, savedAt: 300 });
    expect(metaState.row?.data?.['1']).toEqual({ totalValor: 777, savedAt: 301 });
    expect(metaState.updateCalls).toBe(2);
  });

  it('restores run slot when deleteRunSave meta sync fails after run delete', async () => {
    const runSlot = { runSeed: 7, savedAt: 222 };
    const runApi = makeSlotTableApi({
      slotMap: { 1: runSlot },
    });
    const metaApi = makeSlotTableApi({
      slotMap: { 1: { totalValor: 5, savedAt: 50 } },
      updateError: new Error('meta-update-failed'),
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      if (table === 'meta_progression') return metaApi;
      return makeSlotTableApi();
    });

    localStorage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 99, savedAt: 123 }));

    deleteRunSave('user-1', 1);
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.row?.data?.['1']).toEqual(runSlot);
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_delete_run',
      expect.any(Error),
      expect.objectContaining({ slot: 1 }),
    );
  });

  it('skips stale local overwrite when cloud slot has newer savedAt', async () => {
    const floorKey = getRunClockFloorKey(1);
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 'cloud', savedAt: 500 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 'local', savedAt: 100 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.updateCalls).toBe(0);
    expect(runApi.state.row?.data?.['1']).toEqual({ version: 'cloud', savedAt: 500 });
    expect(store[floorKey]).toBe('500');
    const updateFailures = mocked.reportAsyncError.mock.calls.filter(
      ([context, err]) =>
        context === 'cloud_update_slot_conflict_remote_newer' &&
        err &&
        err.code === 'CLOUD_CONFLICT_REMOTE_NEWER',
    );
    expect(updateFailures).toHaveLength(1);
  });

  it('clears run clock floor after a later successful run write', async () => {
    const floorKey = getRunClockFloorKey(1);
    store[floorKey] = '500';
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 'cloud-old', savedAt: 100 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 'local-new', savedAt: 700 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.row?.data?.['1']).toEqual({ version: 'local-new', savedAt: 700 });
    expect(store[floorKey]).toBeUndefined();
  });

  it('dedupes repeated identical remote-newer conflict warnings in one session', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 'cloud', savedAt: 500 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 'local-1', savedAt: 100 });
    pushRunSave('user-1', 1, { version: 'local-2', savedAt: 100 });
    await __flushCloudSyncQueuesForTests();

    const conflictWarns = warnSpy.mock.calls.filter(
      ([message]) => message === 'CloudSync updateSlot conflict remote newer:',
    );
    expect(conflictWarns).toHaveLength(1);
    const conflictReports = mocked.reportAsyncError.mock.calls.filter(
      ([context]) => context === 'cloud_update_slot_conflict_remote_newer',
    );
    expect(conflictReports).toHaveLength(2);
    warnSpy.mockRestore();
  });

  it('does not dedupe identical remote-newer warnings across different users', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runApi = makeSlotTableApi({
      slotMap: { 1: { version: 'cloud', savedAt: 500 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeSlotTableApi();
    });

    pushRunSave('user-1', 1, { version: 'local-1', savedAt: 100 });
    pushRunSave('user-2', 1, { version: 'local-2', savedAt: 100 });
    await __flushCloudSyncQueuesForTests();

    const conflictWarns = warnSpy.mock.calls.filter(
      ([message]) => message === 'CloudSync updateSlot conflict remote newer:',
    );
    expect(conflictWarns).toHaveLength(2);
    warnSpy.mockRestore();
  });

  it('skips deleteRunSave meta sync when local meta is malformed', async () => {
    const runApi = makeSlotTableApi({
      slotMap: { 1: { runSeed: 7 } },
    });
    const metaApi = makeSlotTableApi({
      slotMap: { 1: { totalValor: 5 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      if (table === 'meta_progression') return metaApi;
      return makeSlotTableApi();
    });

    localStorage.setItem(getMetaKey(1), '{bad-json');

    deleteRunSave('user-1', 1);
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.row).toBeNull();
    expect(metaApi.state.row?.data).toEqual({ 1: { totalValor: 5 } });
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_delete_run_meta_sync_skipped',
      expect.any(Error),
      expect.objectContaining({ slot: 1, reason: 'parse_error' }),
    );
  });

  it('skips deleteRunSave meta sync without async error when local meta is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runApi = makeSlotTableApi({
      slotMap: { 1: { runSeed: 7 } },
    });
    const metaApi = makeSlotTableApi({
      slotMap: { 1: { totalValor: 5 } },
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      if (table === 'meta_progression') return metaApi;
      return makeSlotTableApi();
    });

    deleteRunSave('user-1', 1);
    await __flushCloudSyncQueuesForTests();

    expect(runApi.state.row).toBeNull();
    expect(metaApi.state.row?.data).toEqual({ 1: { totalValor: 5 } });
    expect(mocked.reportAsyncError).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'CloudSync deleteRunSave meta sync skipped: local meta missing',
      { slot: 1 },
    );
    warnSpy.mockRestore();
  });

  it('reports fetch-table failures during cloud bootstrap', async () => {
    mocked.fromMock.mockImplementation(() =>
      makeSlotTableApi({ selectError: new Error('select-failed') }),
    );

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const fetchCalls = mocked.reportAsyncError.mock.calls.filter(
      ([tag]) => tag === 'cloud_fetch_table',
    );
    expect(fetchCalls.length).toBe(3);
  });
});
