import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRunKey } from '../src/engine/SlotManager.js';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => { store[key] = String(val); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const mocked = vi.hoisted(() => ({
  fromMock: vi.fn(),
  reportAsyncError: vi.fn(),
  markStartup: vi.fn(),
}));

vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: {
    from: mocked.fromMock,
  },
}));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.reportAsyncError }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: mocked.markStartup }));

import {
  __resetCloudSyncStatusForTests,
  fetchAllToLocalStorage,
  getCloudSyncStatus,
  shouldPreferLocalMeta,
  shouldPreferLocalRun,
} from '../src/cloud/CloudSync.js';

function makeTableApi({ data = null, selectError = null } = {}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (selectError) return { data: null, error: selectError };
          return { data: data == null ? null : { data }, error: null };
        }),
      })),
    })),
    upsert: vi.fn(async () => ({ error: null })),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  };
}

function mockCloudBootstrap({ runData = null, metaData = null, settingsData = null } = {}) {
  mocked.fromMock.mockImplementation((table) => {
    if (table === 'run_saves') return makeTableApi({ data: runData });
    if (table === 'meta_progression') return makeTableApi({ data: metaData });
    if (table === 'user_settings') return makeTableApi({ data: settingsData });
    return makeTableApi();
  });
}

describe('CloudSync run merge guard', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    mocked.fromMock.mockReset();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    __resetCloudSyncStatusForTests();
  });

  it('does not delete local run slot when cloud slot is missing', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: {} });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('keeps local run slot when cloud savedAt is older', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 300 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { '1': cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when cloud savedAt is newer', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 100 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { '1': cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('keeps local run slot when either side timestamp is missing/invalid', async () => {
    const key = getRunKey(1);
    const scenarios = [
      {
        local: { marker: 'local-no-ts' },
        cloud: { marker: 'cloud', savedAt: 200 },
      },
      {
        local: { marker: 'local-ts', savedAt: 200 },
        cloud: { marker: 'cloud-no-ts' },
      },
      {
        local: { marker: 'local-invalid-ts', savedAt: '200' },
        cloud: { marker: 'cloud', savedAt: 300 },
      },
    ];

    for (const scenario of scenarios) {
      for (const storeKey of Object.keys(store)) delete store[storeKey];
      localStorage.setItem(key, JSON.stringify(scenario.local));
      mockCloudBootstrap({ runData: { '1': scenario.cloud } });

      await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

      expect(JSON.parse(store[key])).toEqual(scenario.local);
    }
  });

  it('keeps local run slot on equal savedAt tie-break', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 200 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { '1': cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when local slot is absent', async () => {
    const key = getRunKey(1);
    const cloud = { marker: 'cloud', savedAt: 200 };
    mockCloudBootstrap({ runData: { '1': cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('heals malformed local run slot from cloud data', async () => {
    const key = getRunKey(1);
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, '{not-json');
    mockCloudBootstrap({ runData: { '1': cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });
});

describe('CloudSync auth-expiry status', () => {
  beforeEach(() => {
    mocked.fromMock.mockReset();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    __resetCloudSyncStatusForTests();
  });

  it('marks shared cloud status when fetch hits auth expiry', async () => {
    const authError = { message: 'JWT expired', status: 401, code: 'PGRST301' };
    mocked.fromMock.mockImplementation(() => makeTableApi({ selectError: authError }));

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(true);
    expect(status.mode).toBe('auth_expired');
    expect(status.message).toContain('local saves only');
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_fetch_table',
      authError,
      expect.objectContaining({ authExpired: true }),
    );
  });

  it('clears shared cloud status after a successful fetch', async () => {
    const authError = { message: 'JWT expired', status: 401, code: 'PGRST301' };
    let failAuth = true;
    mocked.fromMock.mockImplementation(() => (
      failAuth
        ? makeTableApi({ selectError: authError })
        : makeTableApi({ data: null })
    ));

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect(getCloudSyncStatus().authExpired).toBe(true);

    failAuth = false;
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(false);
    expect(status.mode).toBe('ok');
    expect(status.message).toBe('');
  });

  it('keeps auth-expired status when a fetch cycle has mixed auth failure and success', async () => {
    const authError = { message: 'JWT expired', status: 401, code: 'PGRST301' };
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return makeTableApi({ selectError: authError });
      return makeTableApi({ data: null });
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(true);
    expect(status.mode).toBe('auth_expired');
    expect(status.message).toContain('local saves only');
  });
});

describe('CloudSync merge helpers', () => {
  it('prefers local meta when local savedAt is newer', () => {
    const local = { totalValor: 120, totalSupply: 90, savedAt: 200 };
    const cloud = { totalValor: 50, totalSupply: 30, savedAt: 100 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(true);
  });

  it('does not prefer local meta when cloud is newer', () => {
    const local = { totalValor: 120, totalSupply: 90, savedAt: 100 };
    const cloud = { totalValor: 150, totalSupply: 110, savedAt: 200 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(false);
  });

  it('does not prefer local meta when timestamps are missing', () => {
    const local = { totalValor: 120, totalSupply: 90 };
    const cloud = { totalValor: 150, totalSupply: 110, savedAt: 200 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(false);
  });

  it('prefers local run slot when local savedAt is equal to cloud', () => {
    const local = { savedAt: 200 };
    const cloud = { savedAt: 200 };
    expect(shouldPreferLocalRun(local, cloud)).toBe(true);
  });
});
