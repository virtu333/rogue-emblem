import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  },
}));

import {
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  fetchAllToLocalStorage,
  pushRunSave,
} from '../src/cloud/CloudSync.js';

function makeTableApi({ slotMap = {}, selectError = null, upsertError = null, deleteError = null } = {}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (selectError) return { data: null, error: selectError };
          return { data: { data: slotMap }, error: null };
        }),
      })),
    })),
    upsert: vi.fn(async () => ({ error: upsertError })),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: deleteError })),
    })),
  };
}

describe('CloudSync write queue hardening', () => {
  beforeEach(() => {
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    mocked.fromMock.mockReset();
    __resetCloudSyncQueuesForTests();
  });

  it('reports async error when run slot upsert returns a Supabase error', async () => {
    const runApi = makeTableApi({
      slotMap: { '1': { version: 1 } },
      upsertError: new Error('upsert-failed'),
    });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.upsert).toHaveBeenCalledTimes(1);
    expect(mocked.reportAsyncError).toHaveBeenCalledWith(
      'cloud_update_slot',
      expect.any(Error),
      expect.objectContaining({ table: 'run_saves', slot: 1, operation: 'upsert' }),
    );
  });

  it('does not report async error on successful run slot upsert', async () => {
    const runApi = makeTableApi({ slotMap: { '1': { version: 1 } } });
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') return runApi;
      return makeTableApi();
    });

    pushRunSave('user-1', 1, { version: 2 });
    await __flushCloudSyncQueuesForTests();

    expect(runApi.upsert).toHaveBeenCalledTimes(1);
    expect(mocked.reportAsyncError).not.toHaveBeenCalled();
  });

  it('reports fetch-table failures during cloud bootstrap', async () => {
    mocked.fromMock.mockImplementation(() => makeTableApi({ selectError: new Error('select-failed') }));

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    const fetchCalls = mocked.reportAsyncError.mock.calls.filter(([tag]) => tag === 'cloud_fetch_table');
    expect(fetchCalls.length).toBe(3);
  });
});
