import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getRunKey, getMetaKey } from '../src/engine/SlotManager.js';
const mocks = vi.hoisted(() => ({ from: vi.fn(), report: vi.fn() }));
vi.mock('../src/cloud/supabaseClient.js', () => ({ supabase: { from: mocks.from } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocks.report }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: vi.fn() }));
import {
  backupAllLocalSlots,
  getCloudSyncStatus,
  __resetCloudSyncStatusForTests,
} from '../src/cloud/CloudSync.js';
let store, writes;
beforeEach(() => {
  store = new Map();
  writes = [];
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  });
  mocks.from.mockReset();
  mocks.report.mockReset();
  __resetCloudSyncStatusForTests();
  store.set(getRunKey(1), JSON.stringify({ gold: 91, savedAt: 20 }));
  store.set(getMetaKey(1), JSON.stringify({ totalValor: 7, savedAt: 20 }));
});
afterEach(() => vi.unstubAllGlobals());
function api(table, { fail = false, remote = null, wait = null } = {}) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (wait) await wait;
          return { data: remote ? { data: { 1: remote }, updated_at: 'now' } : null, error: null };
        },
      }),
    }),
    insert: async (payload) => {
      writes.push({ table, payload });
      return { error: fail ? new Error('network failed') : null };
    },
  };
}
describe('durable local-save backup batch', () => {
  it('requires success for every captured run and metadata payload', async () => {
    mocks.from.mockImplementation((t) => api(t));
    expect(await backupAllLocalSlots('u')).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes.find((w) => w.table === 'run_saves').payload.data['1'].gold).toBe(91);
    expect(store.has(getRunKey(1))).toBe(true);
  });
  it('does not mistake an ordinary write failure for success when auth status stays ok', async () => {
    mocks.from.mockImplementation((t) => api(t, { fail: t === 'run_saves' }));
    expect(await backupAllLocalSlots('u')).toBe(false);
    expect(getCloudSyncStatus().mode).toBe('ok');
    expect(JSON.parse(store.get(getRunKey(1))).gold).toBe(91);
  });
  it('rejects remote-newer conflicts instead of claiming a backup exists', async () => {
    mocks.from.mockImplementation((t) =>
      api(t, { remote: t === 'run_saves' ? { gold: 3, savedAt: 99 } : null }),
    );
    expect(await backupAllLocalSlots('u')).toBe(false);
    expect(writes.some((w) => w.table === 'run_saves')).toBe(false);
  });
  it('times out without deleting local data and a subsequent successful retry can confirm', async () => {
    let release;
    const wait = new Promise((r) => (release = r));
    mocks.from.mockImplementation((t) => api(t, { wait }));
    expect(await backupAllLocalSlots('u', { timeoutMs: 5 })).toBe(false);
    expect(store.has(getRunKey(1))).toBe(true);
    release();
    mocks.from.mockImplementation((t) => api(t));
    expect(await backupAllLocalSlots('u')).toBe(true);
  });
  it('refuses to clear a local version changed while its older snapshot was uploading', async () => {
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    mocks.from.mockImplementation((table) => api(table, { wait }));
    const backup = backupAllLocalSlots('u');
    store.set(getRunKey(1), JSON.stringify({ gold: 111, savedAt: 21 }));
    release();
    expect(await backup).toBe(false);
    expect(JSON.parse(store.get(getRunKey(1))).gold).toBe(111);
  });
  it('does not schedule a partial batch when any local JSON is unreadable', async () => {
    store.set(getRunKey(2), '{broken');
    expect(await backupAllLocalSlots('u')).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
