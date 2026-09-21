import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { HintManager } from '../src/engine/HintManager.js';
import { getRunKey, getMetaKey } from '../src/engine/SlotManager.js';

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
  pushSettings,
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

  it('normalizes cloud effects settings with the same OS-based migration', async () => {
    mockCloudBootstrap({
      settingsData: { musicVolume: 0.2, reducedEffects: true, effectsQuality: 'high' },
    });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect(JSON.parse(store.emblem_rogue_settings)).toMatchObject({
      hints: true,
      musicVolume: 0.2,
      sfxVolume: 0.7,
      reduceMotion: false,
      effectsQuality: 'high',
      battleSpeed: 'normal',
    });
  });

  it.each([null, { reducedEffects: true }, { savedAt: 99, battleSpeed: 'normal' }])(
    'keeps newer explicit preferences over missing/legacy/stale cloud settings',
    async (settingsData) => {
      const local = {
        savedAt: 100,
        battleSpeed: 'fast',
        reduceMotion: false,
        effectsQuality: 'high',
      };
      store.emblem_rogue_settings = JSON.stringify(local);
      mockCloudBootstrap({ settingsData });
      await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
      expect(JSON.parse(store.emblem_rogue_settings)).toEqual(local);
    },
  );
  it('accepts newer cloud preferences', async () => {
    store.emblem_rogue_settings = JSON.stringify({ savedAt: 100, battleSpeed: 'fast' });
    mockCloudBootstrap({ settingsData: { savedAt: 200, battleSpeed: 'instant' } });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect(JSON.parse(store.emblem_rogue_settings)).toMatchObject({
      savedAt: 200,
      battleSpeed: 'instant',
    });
  });

  it('keeps merged archive records through a save by an already-open manager', async () => {
    const key = getMetaKey(1);
    store[key] = JSON.stringify({ savedAt: 200, runRecords: [] });
    const meta = new MetaProgressionManager([], key);
    mockCloudBootstrap({
      metaData: {
        1: {
          savedAt: 100,
          runRecords: [{ id: 'cloud-win', endedAt: 50, difficulty: 'normal', roster: [] }],
        },
      },
    });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    meta._save();
    expect(JSON.parse(store[key]).runRecords.map((r) => r.id)).toEqual(['cloud-win']);
  });
  it('reconciles a live hint manager with newer cloud lessons and resets', async () => {
    const key = getMetaKey(1);
    store[key] = JSON.stringify({ savedAt: 100, hintState: { updatedAt: 100, seen: ['local'] } });
    const meta = new MetaProgressionManager([], key);
    const hints = new HintManager(1, () => true, meta);
    mockCloudBootstrap({
      metaData: { 1: { savedAt: 200, hintState: { updatedAt: 200, seen: ['local', 'cloud'] } } },
    });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    hints.markSeen('next');
    expect(JSON.parse(store[key]).hintState.seen).toEqual(['local', 'cloud', 'next']);
    const disk = JSON.parse(store[key]);
    disk.savedAt++;
    disk.hintState = { updatedAt: disk.savedAt, seen: [] };
    store[key] = JSON.stringify(disk);
    expect(hints.hasSeen('cloud')).toBe(false);
  });

  it('does not upload stale settings after a failed startup pull', async () => {
    const api = makeTableApi({ data: { savedAt: 200, battleSpeed: 'instant' } });
    mocked.fromMock.mockReturnValue(api);
    await pushSettings('user-1', { savedAt: 100, battleSpeed: 'normal' });
    expect(api.upsert).not.toHaveBeenCalled();
    expect(JSON.parse(store.emblem_rogue_settings)).toMatchObject({
      savedAt: 200,
      battleSpeed: 'instant',
    });
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
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when cloud savedAt is newer', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 100 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('does not apply remote meta if the corresponding run write fails', async () => {
    const runKey = getRunKey(1),
      metaKey = getMetaKey(1);
    const local = { savedAt: 100, gold: 9 },
      cloud = { savedAt: 200, gold: 90 };
    const meta = { savedAt: 100, totalValor: 5 };
    store[runKey] = JSON.stringify(local);
    store[metaKey] = JSON.stringify(meta);
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 200, totalValor: 50 } },
    });
    const implementation = localStorageMock.setItem.getMockImplementation();
    localStorageMock.setItem.mockImplementation((key, value) => {
      if (key === runKey) throw new Error('quota');
      implementation(key, value);
    });
    try {
      await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
      expect(JSON.parse(store[runKey])).toEqual(local);
      expect(JSON.parse(store[metaKey])).toEqual(meta);
    } finally {
      localStorageMock.setItem.mockImplementation(implementation);
    }
  });

  it('keeps local run slot when local timestamp is valid and cloud timestamp is missing', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-ts', savedAt: 200 };
    const cloud = { marker: 'cloud-no-ts' };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when local timestamp is missing and cloud timestamp is valid', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-no-ts' };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('applies cloud run slot when local timestamp is invalid and cloud timestamp is valid', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-invalid-ts', savedAt: '200' };
    const cloud = { marker: 'cloud', savedAt: 300 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('applies cloud run slot and emits telemetry when both timestamps are invalid', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-no-ts' };
    const cloud = { marker: 'cloud-no-ts' };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
    expect(mocked.markStartup).toHaveBeenCalledWith('cloud_run_merge_no_savedAt', { slot: 1 });
  });

  it('keeps local run slot on equal savedAt tie-break', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 200 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when local slot is absent', async () => {
    const key = getRunKey(1);
    const cloud = { marker: 'cloud', savedAt: 200 };
    mockCloudBootstrap({ runData: { 1: cloud } });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('keeps the local run and progression together when the cloud progression fetch fails', async () => {
    const local = { savedAt: 100, gold: 2 },
      meta = { savedAt: 100, totalValor: 3 };
    store[getRunKey(1)] = JSON.stringify(local);
    store[getMetaKey(1)] = JSON.stringify(meta);
    mocked.fromMock.mockImplementation((table) =>
      table === 'meta_progression'
        ? makeTableApi({ selectError: new Error('offline') })
        : makeTableApi({ data: table === 'run_saves' ? { 1: { savedAt: 200, gold: 9 } } : null }),
    );
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect(JSON.parse(store[getRunKey(1)])).toEqual(local);
    expect(JSON.parse(store[getMetaKey(1)])).toEqual(meta);
  });
  it('heals malformed local run slot from cloud data', async () => {
    const key = getRunKey(1);
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, '{not-json');
    mockCloudBootstrap({ runData: { 1: cloud } });

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
    mocked.fromMock.mockImplementation(() =>
      failAuth ? makeTableApi({ selectError: authError }) : makeTableApi({ data: null }),
    );

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

describe('CloudSync auth-expiry message-only matching', () => {
  beforeEach(() => {
    mocked.fromMock.mockReset();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    __resetCloudSyncStatusForTests();
  });

  it('marks auth expired for "session expired" message without status code', async () => {
    const msgOnlyError = { message: 'session expired' };
    mocked.fromMock.mockImplementation(() => makeTableApi({ selectError: msgOnlyError }));

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(true);
    expect(status.mode).toBe('auth_expired');
  });

  it('marks auth expired for "session has expired" message without status code', async () => {
    const msgOnlyError = { message: 'Your session has expired, please log in again' };
    mocked.fromMock.mockImplementation(() => makeTableApi({ selectError: msgOnlyError }));

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(true);
    expect(status.mode).toBe('auth_expired');
  });

  it('does not misclassify a transient DB error as auth expiry', async () => {
    const dbError = { message: 'could not serialize access due to concurrent session update' };
    mocked.fromMock.mockImplementation(() => makeTableApi({ selectError: dbError }));

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const status = getCloudSyncStatus();
    expect(status.authExpired).toBe(false);
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

  it('prefers local run slot when local savedAt is newer', () => {
    const local = { savedAt: 300 };
    const cloud = { savedAt: 200 };
    expect(shouldPreferLocalRun(local, cloud)).toBe(true);
  });

  it('does not prefer local run slot when cloud savedAt is newer', () => {
    const local = { savedAt: 100 };
    const cloud = { savedAt: 200 };
    expect(shouldPreferLocalRun(local, cloud)).toBe(false);
  });

  it('prefers local run slot when local savedAt ties cloud', () => {
    const local = { savedAt: 200 };
    const cloud = { savedAt: 200 };
    expect(shouldPreferLocalRun(local, cloud)).toBe(true);
  });

  it('prefers local run slot when local timestamp is valid and cloud timestamp is missing', () => {
    const local = { savedAt: 200 };
    const cloud = {};
    expect(shouldPreferLocalRun(local, cloud)).toBe(true);
  });

  it('does not prefer local run slot when local timestamp is missing and cloud timestamp is valid', () => {
    const local = {};
    const cloud = { savedAt: 200 };
    expect(shouldPreferLocalRun(local, cloud)).toBe(false);
  });

  it('does not prefer local run slot when both timestamps are missing', () => {
    expect(shouldPreferLocalRun({}, {})).toBe(false);
  });

  it('emits telemetry when both run timestamps are missing and slot is known', () => {
    mocked.markStartup.mockReset();
    expect(shouldPreferLocalRun({}, {}, 2)).toBe(false);
    expect(mocked.markStartup).toHaveBeenCalledWith('cloud_run_merge_no_savedAt', { slot: 2 });
  });
});
