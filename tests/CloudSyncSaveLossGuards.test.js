// Regression tests for the Wave 1 save-loss guards:
// - fresh local meta can never overwrite meaningful cloud progression
// - meta table gets the same clock-floor protection as the run table
// - pushAllLocalSlots / flushCloudSyncQueues support the logout backup flow
// - shouldPreferLocalMeta valid-side-wins symmetry with shouldPreferLocalRun

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetaClockFloorKey, getMetaKey, getRunKey } from '../src/engine/SlotManager.js';

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
}));

vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.reportAsyncError }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: mocked.markStartup }));
vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: {
    from: mocked.fromMock,
    auth: {},
  },
}));

import {
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  flushCloudSyncQueues,
  pushAllLocalSlots,
  pushMeta,
  shouldPreferLocalMeta,
} from '../src/cloud/CloudSync.js';

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

function makeSlotTableApi({ slotMap = {}, exists = true } = {}) {
  const state = {
    row: exists ? { data: { ...slotMap }, updated_at: 'rev-1' } : null,
    updateCalls: 0,
    insertCalls: 0,
  };
  return {
    state,
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (!state.row) return { data: null, error: null };
          return { data: { data: state.row.data, updated_at: state.row.updated_at }, error: null };
        }),
      })),
    })),
    insert: vi.fn(async (payload) => {
      state.insertCalls++;
      state.row = { data: payload.data ?? {}, updated_at: 'rev-insert' };
      return { error: null };
    }),
    update: vi.fn((payload) =>
      makeFilterChain(async () => {
        state.updateCalls++;
        state.row = { data: payload.data ?? {}, updated_at: `rev-${state.updateCalls + 1}` };
        return { data: { updated_at: state.row.updated_at }, error: null };
      }),
    ),
    delete: vi.fn(() =>
      makeFilterChain(async () => ({ data: { user_id: 'user-1' }, error: null })),
    ),
    upsert: vi.fn(async () => ({ error: null })),
  };
}

const MEANINGFUL_META = {
  totalValor: 4200,
  totalSupply: 3100,
  runsCompleted: 17,
  purchasedUpgrades: { hp_boost: 3 },
  milestones: ['beatAct1', 'beatAct2'],
  savedAt: 1000,
};

describe('fresh local meta overwrite guard', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    mocked.fromMock.mockReset();
    __resetCloudSyncQueuesForTests();
    __resetCloudSyncStatusForTests();
  });

  it('blocks a zero-progress meta from clobbering meaningful cloud meta and heals local', async () => {
    const metaApi = makeSlotTableApi({ slotMap: { 1: MEANINGFUL_META } });
    mocked.fromMock.mockImplementation((table) =>
      table === 'meta_progression' ? metaApi : makeSlotTableApi(),
    );

    // Fresh device booted before fetch completed, started a new game:
    // wall-clock-newer savedAt but no progression at all.
    const freshMeta = {
      totalValor: 0,
      totalSupply: 0,
      runsCompleted: 0,
      purchasedUpgrades: {},
      milestones: [],
      savedAt: 999999,
    };
    pushMeta('user-1', 1, freshMeta);
    await __flushCloudSyncQueuesForTests();

    expect(metaApi.state.updateCalls).toBe(0);
    expect(metaApi.state.row?.data?.['1']).toEqual(MEANINGFUL_META);
    // Local was healed from the remote copy and the clock floor was recorded.
    expect(JSON.parse(store[getMetaKey(1)])).toEqual(MEANINGFUL_META);
    expect(store[getMetaClockFloorKey(1)]).toBe('1000');
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_update_slot_fresh_local_blocked',
      expect.objectContaining({ code: 'CLOUD_FRESH_LOCAL_BLOCKED' }),
      expect.objectContaining({ table: 'meta_progression', slot: 1 }),
    );
  });

  it('allows a fresh local meta to overwrite an equally fresh remote slot', async () => {
    const freshRemote = { totalValor: 0, totalSupply: 0, runsCompleted: 0, savedAt: 100 };
    const metaApi = makeSlotTableApi({ slotMap: { 1: freshRemote } });
    mocked.fromMock.mockImplementation((table) =>
      table === 'meta_progression' ? metaApi : makeSlotTableApi(),
    );

    const freshLocal = { totalValor: 0, totalSupply: 0, runsCompleted: 0, savedAt: 200 };
    pushMeta('user-1', 1, freshLocal);
    await __flushCloudSyncQueuesForTests();

    expect(metaApi.state.row?.data?.['1']).toEqual(freshLocal);
    expect(mocked.reportAsyncError).not.toHaveBeenCalled();
  });

  it('allows meaningful local meta to overwrite older meaningful remote meta', async () => {
    const metaApi = makeSlotTableApi({ slotMap: { 1: MEANINGFUL_META } });
    mocked.fromMock.mockImplementation((table) =>
      table === 'meta_progression' ? metaApi : makeSlotTableApi(),
    );

    const newerLocal = { ...MEANINGFUL_META, totalValor: 4300, savedAt: 2000 };
    pushMeta('user-1', 1, newerLocal);
    await __flushCloudSyncQueuesForTests();

    expect(metaApi.state.row?.data?.['1']).toEqual(newerLocal);
    expect(mocked.reportAsyncError).not.toHaveBeenCalled();
  });

  it('records a meta clock floor on remote-newer conflict and clears it after a successful write', async () => {
    const floorKey = getMetaClockFloorKey(1);
    const metaApi = makeSlotTableApi({ slotMap: { 1: { ...MEANINGFUL_META, savedAt: 5000 } } });
    mocked.fromMock.mockImplementation((table) =>
      table === 'meta_progression' ? metaApi : makeSlotTableApi(),
    );

    // Skewed clock: locally meaningful meta with an OLDER savedAt than remote.
    pushMeta('user-1', 1, { ...MEANINGFUL_META, savedAt: 100 });
    await __flushCloudSyncQueuesForTests();
    expect(metaApi.state.updateCalls).toBe(0);
    expect(store[floorKey]).toBe('5000');

    // After the floor is consumed (savedAt stamped above remote), the write
    // succeeds and the floor is cleared.
    pushMeta('user-1', 1, { ...MEANINGFUL_META, savedAt: 5001 });
    await __flushCloudSyncQueuesForTests();
    expect(metaApi.state.row?.data?.['1']).toEqual({ ...MEANINGFUL_META, savedAt: 5001 });
    expect(store[floorKey]).toBeUndefined();
  });
});

describe('logout backup helpers', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    mocked.reportAsyncError.mockReset();
    mocked.fromMock.mockReset();
    __resetCloudSyncQueuesForTests();
    __resetCloudSyncStatusForTests();
  });

  it('pushAllLocalSlots pushes every parseable local slot to the cloud', async () => {
    const runApi = makeSlotTableApi({ exists: false });
    const metaApi = makeSlotTableApi({ exists: false });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      if (table === 'meta_progression') return metaApi;
      return makeSlotTableApi();
    });

    localStorage.setItem(getMetaKey(1), JSON.stringify({ totalValor: 10, savedAt: 100 }));
    localStorage.setItem(getRunKey(1), JSON.stringify({ runSeed: 7, savedAt: 100 }));
    localStorage.setItem(getMetaKey(2), '{corrupt');
    localStorage.setItem(getMetaKey(3), JSON.stringify({ totalValor: 30, savedAt: 300 }));

    pushAllLocalSlots('user-1');
    await __flushCloudSyncQueuesForTests();

    expect(metaApi.state.row?.data).toEqual({
      1: { totalValor: 10, savedAt: 100 },
      3: { totalValor: 30, savedAt: 300 },
    });
    expect(runApi.state.row?.data).toEqual({ 1: { runSeed: 7, savedAt: 100 } });
  });

  it('flushCloudSyncQueues resolves true when all queued writes settle in time', async () => {
    const metaApi = makeSlotTableApi({ exists: false });
    mocked.fromMock.mockImplementation(() => metaApi);

    pushMeta('user-1', 1, { totalValor: 5, savedAt: 50 });
    const flushed = await flushCloudSyncQueues(2000);
    expect(flushed).toBe(true);
  });

  it('flushCloudSyncQueues resolves false when a write outlives the timeout', async () => {
    let releaseSelect;
    const gate = new Promise((resolve) => {
      releaseSelect = resolve;
    });
    mocked.fromMock.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            await gate;
            return { data: null, error: null };
          }),
        })),
      })),
      insert: vi.fn(async () => ({ error: null })),
      update: vi.fn(() => makeFilterChain(async () => ({ data: null, error: null }))),
      delete: vi.fn(() => makeFilterChain(async () => ({ data: null, error: null }))),
      upsert: vi.fn(async () => ({ error: null })),
    }));

    pushMeta('user-1', 1, { totalValor: 5, savedAt: 50 });
    const flushed = await flushCloudSyncQueues(50);
    expect(flushed).toBe(false);
    releaseSelect();
    await __flushCloudSyncQueuesForTests();
  });
});

describe('shouldPreferLocalMeta valid-side-wins symmetry', () => {
  it('prefers valid local meta over legacy cloud meta with no savedAt', () => {
    const local = { totalValor: 120, savedAt: 200 };
    const cloud = { totalValor: 999 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(true);
  });

  it('prefers valid cloud meta when local has no savedAt', () => {
    const local = { totalValor: 120 };
    const cloud = { totalValor: 999, savedAt: 200 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(false);
  });

  it('prefers cloud when neither side has a savedAt', () => {
    expect(shouldPreferLocalMeta({ totalValor: 1 }, { totalValor: 2 })).toBe(false);
  });

  it('cloud wins savedAt ties (local must be strictly newer)', () => {
    const local = { totalValor: 120, savedAt: 200 };
    const cloud = { totalValor: 999, savedAt: 200 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(false);
  });
});
