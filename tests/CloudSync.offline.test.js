import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// Mock supabase as null (offline mode)
vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: null,
}));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: vi.fn() }));

import {
  fetchAllToLocalStorage,
  pushRunSave,
  pushMeta,
  pushSettings,
  deleteRunSave,
  deleteSlotCloud,
  __flushCloudSyncQueuesForTests,
} from '../src/cloud/CloudSync.js';

describe('CloudSync offline (supabase=null)', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('fetchAllToLocalStorage returns without error when supabase is null', async () => {
    await expect(fetchAllToLocalStorage('user-1')).resolves.toBeUndefined();
  });

  it('pushRunSave does not throw when supabase is null', () => {
    expect(() => pushRunSave('user-1', 1, { test: true })).not.toThrow();
  });

  it('pushMeta does not throw when supabase is null', () => {
    expect(() => pushMeta('user-1', 1, { totalRenown: 100 })).not.toThrow();
  });

  it('pushSettings does not throw when supabase is null', () => {
    expect(() => pushSettings('user-1', { volume: 0.5 })).not.toThrow();
  });

  it('deleteRunSave does not throw when supabase is null', () => {
    expect(() => deleteRunSave('user-1', 1)).not.toThrow();
  });

  it('deleteSlotCloud does not throw when supabase is null', () => {
    expect(() => deleteSlotCloud('user-1', 1)).not.toThrow();
  });

  it('does not modify localStorage on any cloud operation', async () => {
    localStorageMock.setItem.mockClear();
    pushRunSave('user-1', 1, { data: true });
    pushMeta('user-1', 1, { data: true });
    pushSettings('user-1', { data: true });
    deleteRunSave('user-1', 1);
    await fetchAllToLocalStorage('user-1');
    await __flushCloudSyncQueuesForTests();
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});
