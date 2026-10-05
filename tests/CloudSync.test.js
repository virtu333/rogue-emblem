import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { HintManager } from '../src/engine/HintManager.js';
import {
  getSlotCloudPendingKey,
  getNextAvailableSlot,
  clearAllSlotData,
  getRunKey,
  getMetaKey,
} from '../src/engine/SlotManager.js';

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
  getSession: vi.fn(),
  reportAsyncError: vi.fn(),
  markStartup: vi.fn(),
}));

vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: {
    from: mocked.fromMock,
    auth: { getSession: mocked.getSession },
  },
}));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.reportAsyncError }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: mocked.markStartup }));

import { archiveAndDiscardSlot, retireSlotArchive } from '../src/engine/SlotRecovery.js';
import {
  pushRunSave,
  deleteRunSave,
  __resetCloudSyncStatusForTests,
  __resetCloudSyncQueuesForTests,
  fetchAllToLocalStorage,
  isCloudHydrationComplete,
  getCloudSyncStatus,
  pushSettings,
  shouldPreferLocalMeta,
  shouldPreferLocalRun,
} from '../src/cloud/CloudSync.js';

function makeTableApi({ data = null, selectError = null } = {}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        setHeader() {
          return this;
        },
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
    __resetCloudSyncQueuesForTests();
    mocked.getSession.mockReset().mockResolvedValue({
      data: { session: { user: { id: 'account-a' }, access_token: 'account-a-token' } },
      error: null,
    });
  });

  it.each(['healthy', 'absent', 'missing progression', 'wrong account', 'write failure'])(
    'Free reserves the cloud copy until a complete owned fetch (%s)',
    async (scenario) => {
      store[getMetaKey(1)] = '{bad';
      store[getRunKey(1)] = '{"runRecordId":"local-damaged","gold":137}';
      expect(archiveAndDiscardSlot(1).ok).toBe(true);
      expect(retireSlotArchive(1, localStorage, undefined, undefined, 'account-a').ok).toBe(true);
      const pending = store[getSlotCloudPendingKey(1)];
      clearAllSlotData();
      expect(store[getSlotCloudPendingKey(1)]).toBe(pending);
      expect(getNextAvailableSlot()).toBe(2);
      expect(pushRunSave('account-a', 1, { runRecordId: 'new-game', savedAt: 999 })).toEqual({
        queued: false,
        reason: 'protected_slot',
      });
      expect(deleteRunSave('account-a', 1, null)).toMatchObject({ queued: false });
      mockCloudBootstrap({
        runData:
          scenario === 'absent'
            ? null
            : { 1: { runRecordId: 'cloud-healthy', gold: 731, savedAt: 100 } },
        metaData: ['absent', 'missing progression'].includes(scenario)
          ? null
          : { 1: { totalValor: 347, savedAt: 100 } },
      });
      if (scenario === 'write failure')
        localStorageMock.setItem.mockImplementation((key, raw) => {
          if (key === getRunKey(1)) throw new Error('quota');
          store[key] = String(raw);
        });
      await fetchAllToLocalStorage(scenario === 'wrong account' ? 'account-b' : 'account-a', {
        timeoutMs: 50,
      });
      if (['missing progression', 'wrong account', 'write failure'].includes(scenario)) {
        expect(store[getSlotCloudPendingKey(1)]).toBe(pending);
        expect(getNextAvailableSlot()).toBe(2);
      } else {
        expect(store[getSlotCloudPendingKey(1)]).toBeUndefined();
        if (scenario === 'healthy') {
          expect(JSON.parse(store[getRunKey(1)]).runRecordId).toBe('cloud-healthy');
          expect(JSON.parse(store[getMetaKey(1)]).totalValor).toBe(347);
        } else expect(getNextAvailableSlot()).toBe(1);
      }
      localStorageMock.setItem.mockImplementation((key, raw) => {
        store[key] = String(raw);
      });
    },
  );

  it.each([{ roster: 7 }, { nodeMap: { nodes: {} } }, { _exportDiscardPending: true }])(
    'keeps cloud recovery reserved for unreadable remote run %j',
    async (run) => {
      store[getSlotCloudPendingKey(1)] = JSON.stringify({ version: 1, userId: 'account-a' });
      mockCloudBootstrap({ runData: { 1: run }, metaData: { 1: { totalValor: 731 } } });
      await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
      expect(store[getSlotCloudPendingKey(1)]).toBeDefined();
      expect(store[getRunKey(1)]).toBeUndefined();
      expect(getNextAvailableSlot()).toBe(2);
    },
  );
  it.each([[], 42, { purchasedUpgrades: 7 }, { milestones: {} }])(
    'keeps cloud recovery reserved for unreadable progression %j',
    async (meta) => {
      store[getSlotCloudPendingKey(1)] = JSON.stringify({ version: 1, userId: 'account-a' });
      mockCloudBootstrap({ runData: { 1: { runRecordId: 'cloud-run' } }, metaData: { 1: meta } });
      await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
      expect(store[getSlotCloudPendingKey(1)]).toBeDefined();
      expect(store[getRunKey(1)]).toBeUndefined();
    },
  );
  it.each(['anonymous', 'different user', 'missing bearer', 'auth error', 'dropped during fetch'])(
    'does not treat an empty RLS result as proof of absence (%s)',
    async (kind) => {
      const marker = JSON.stringify({ version: 1, userId: 'account-a' });
      store[getSlotCloudPendingKey(1)] = marker;
      mockCloudBootstrap();
      const invalid = {
        data: {
          session:
            kind === 'different user'
              ? { user: { id: 'account-b' }, access_token: 'account-b-token' }
              : kind === 'missing bearer'
                ? { user: { id: 'account-a' } }
                : null,
        },
        error: kind === 'auth error' ? new Error('expired') : null,
      };
      if (kind === 'dropped during fetch')
        mocked.getSession
          .mockResolvedValueOnce({
            data: { session: { user: { id: 'account-a' }, access_token: 'account-a-token' } },
          })
          .mockResolvedValue(invalid);
      else mocked.getSession.mockResolvedValue(invalid);
      const result = await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
      expect(isCloudHydrationComplete(result)).toBe(false);
      expect(result.deferredReservationSlots).toEqual([1]);
      expect(store).toEqual({ [getSlotCloudPendingKey(1)]: marker });
      expect(getNextAvailableSlot()).toBe(2);
    },
  );

  it.each(['rejected', 'timed out', 'anonymous'])(
    'hydrates other slots and retries when reserved-slot auth is %s',
    async (kind) => {
      const marker = '{"version":1,"userId":"account-a"}';
      store[getSlotCloudPendingKey(1)] = marker;
      store[getMetaKey(2)] = '{"totalValor":2,"savedAt":1}';
      store[getRunKey(2)] = '{"runRecordId":"older-local","gold":2,"savedAt":1}';
      mockCloudBootstrap({
        runData: {
          1: { runRecordId: 'reserved-cloud', gold: 11, savedAt: 100 },
          2: { runRecordId: 'newer-cloud', gold: 731, savedAt: 100 },
          3: { runRecordId: 'new-cloud-slot', gold: 73, savedAt: 100 },
        },
        metaData: {
          1: { totalValor: 11 },
          2: { totalValor: 347, savedAt: 100 },
          3: { totalValor: 731, savedAt: 100 },
        },
        settingsData: { masterVolume: 0.42, savedAt: 100 },
      });
      if (kind === 'timed out') vi.useFakeTimers();
      try {
        if (kind === 'rejected') mocked.getSession.mockRejectedValue(new Error('session failed'));
        else if (kind === 'timed out')
          mocked.getSession.mockImplementation(() => new Promise(() => {}));
        else mocked.getSession.mockResolvedValue({ data: { session: null } });
        const pull = fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
        if (kind === 'timed out') await vi.advanceTimersByTimeAsync(2000);
        const result = await pull;
        expect(result).toEqual({ rejectedCount: 0, deferredReservationSlots: [1] });
        expect(isCloudHydrationComplete(result)).toBe(false);
        expect(store[getSlotCloudPendingKey(1)]).toBe(marker);
        expect(store[getRunKey(1)]).toBeUndefined();
        expect(store[getMetaKey(1)]).toBeUndefined();
        expect(JSON.parse(store[getRunKey(2)]).gold).toBe(731);
        expect(
          pushRunSave('account-a', 2, { runRecordId: 'older-local', gold: 2, savedAt: 999 }),
        ).toMatchObject({ queued: false, reason: 'protected_slot' });
        expect(JSON.parse(store[getMetaKey(2)]).totalValor).toBe(2);
        expect(JSON.parse(store[getRunKey(3)]).gold).toBe(73);
        expect(JSON.parse(store[getMetaKey(3)]).totalValor).toBe(731);
        expect(JSON.parse(store.emblem_rogue_settings).savedAt).toBe(100);
        expect(mocked.reportAsyncError).toHaveBeenCalledWith(
          'cloud_pending_session_unavailable',
          expect.any(Error),
          expect.objectContaining({ slots: [1] }),
        );
        // A background retry after auth recovers must perform a fresh bound fetch.
        mocked.getSession.mockResolvedValue({
          data: {
            session: {
              user: { id: 'account-a' },
              access_token: 'account-a-token',
            },
          },
        });
        const retried = await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
        expect(isCloudHydrationComplete(retried)).toBe(true);
        expect(store[getSlotCloudPendingKey(1)]).toBeUndefined();
        expect(JSON.parse(store[getRunKey(1)]).gold).toBe(11);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('requires an explicit complete cloud result before stopping background refetch', () => {
    expect(isCloudHydrationComplete(undefined)).toBe(false);
    expect(isCloudHydrationComplete({ rejectedCount: 1 })).toBe(false);
    expect(isCloudHydrationComplete({ rejectedCount: 0 })).toBe(true);
    expect(isCloudHydrationComplete({ rejectedCount: 0, deferredReservationSlots: [1] })).toBe(
      false,
    );
  });

  it.each(['new meta', 'new run', 'quarantine', 'pair journal', 'owner'])(
    'keeps occupied reservation bytes during hydration (%s)',
    async (kind) => {
      const marker = JSON.stringify({ version: 1, userId: 'account-a' });
      store[getSlotCloudPendingKey(1)] = marker;
      const key = {
        'new meta': getMetaKey(1),
        'new run': getRunKey(1),
        quarantine: 'emblem_rogue_slot_1_quarantine',
        'pair journal': 'emblem_rogue_slot_1_pair_journal',
        owner: 'emblem_rogue_slot_1_recovery_owner',
      }[kind];
      store[key] =
        kind === 'new meta'
          ? '{"totalValor":999}'
          : kind === 'new run'
            ? '{"gold":4242,"runRecordId":"new-live-run"}'
            : 'original recovery bytes';
      const before = { ...store };
      mockCloudBootstrap({
        runData: { 1: { runRecordId: 'cloud-old', gold: 3 } },
        metaData: { 1: { totalValor: 3 } },
      });
      await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
      expect(store).toEqual(before);
    },
  );

  it('keeps the reservation when clearing it throws, then idempotently retries the complete cloud pair', async () => {
    const marker = JSON.stringify({ version: 1, userId: 'account-a' });
    store[getSlotCloudPendingKey(1)] = marker;
    mockCloudBootstrap({
      runData: { 1: { runRecordId: 'cloud-run', gold: 731 } },
      metaData: { 1: { totalValor: 347 } },
    });
    localStorageMock.removeItem.mockImplementation((key) => {
      if (key === getSlotCloudPendingKey(1)) throw new Error('clear blocked');
      delete store[key];
    });
    await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
    expect(store[getSlotCloudPendingKey(1)]).toBe(marker);
    expect(JSON.parse(store[getRunKey(1)]).gold).toBe(731);
    expect(JSON.parse(store[getMetaKey(1)]).totalValor).toBe(347);
    localStorageMock.removeItem.mockImplementation((key) => {
      delete store[key];
    });
    await fetchAllToLocalStorage('account-a', { timeoutMs: 50 });
    expect(store[getSlotCloudPendingKey(1)]).toBeUndefined();
    expect(JSON.parse(store[getRunKey(1)]).gold).toBe(731);
    expect(JSON.parse(store[getMetaKey(1)]).totalValor).toBe(347);
  });

  it.each(['quarantine', 'pair_journal'])(
    'never hydrates an occupied %s recovery slot, but hydrates other slots',
    async (suffix) => {
      store[`emblem_rogue_slot_1_${suffix}`] = 'raw recovery evidence';
      store[getRunKey(1)] = 'original run bytes';
      store[getMetaKey(1)] = 'original meta bytes';
      mockCloudBootstrap({
        runData: { 1: { gold: 999, savedAt: 200 }, 2: { gold: 57, savedAt: 200 } },
        metaData: { 1: { totalValor: 999, savedAt: 200 }, 2: { totalValor: 23, savedAt: 200 } },
      });
      await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
      expect(store[getRunKey(1)]).toBe('original run bytes');
      expect(store[getMetaKey(1)]).toBe('original meta bytes');
      expect(store[`emblem_rogue_slot_1_${suffix}`]).toBe('raw recovery evidence');
      expect(JSON.parse(store[getRunKey(2)]).gold).toBe(57);
      expect(JSON.parse(store[getMetaKey(2)]).totalValor).toBe(23);
    },
  );

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
  it('keeps lords met on either copy when one copy wins (union)', async () => {
    const key = getMetaKey(1);
    // Local is newer and kept; the cloud copy met a lord local has not.
    store[key] = JSON.stringify({ savedAt: 200, lordsMet: ['Cael', 'Edric', 'Sera'] });
    mockCloudBootstrap({ metaData: { 1: { savedAt: 100, lordsMet: ['Kira'] } } });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect(JSON.parse(store[key]).lordsMet).toEqual(['Cael', 'Edric', 'Kira', 'Sera']);

    // The cloud copy is newer and wins; local's lords (backfilled from its picks) stay.
    store[key] = JSON.stringify({
      savedAt: 100,
      lordSelection: { commander: 'Voss', partner: 'Sera' },
    });
    mockCloudBootstrap({ metaData: { 1: { savedAt: 300, lordsMet: ['Rowan'] } } });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    const adopted = JSON.parse(store[key]);
    expect(adopted.savedAt).toBe(300);
    expect(adopted.lordsMet).toEqual(['Edric', 'Rowan', 'Sera', 'Voss']);
  });

  it('merges the prologue record on either copy (further state; the grant with the kept economy)', async () => {
    const key = getMetaKey(1);
    const done = { state: 'complete', grantPaid: true, chaptersCompleted: ['p1_banner_at_dawn', 'p4_quarry_gate'], practised: ['seize'] }; // prettier-ignore
    // Local is newer and kept, but only began the prologue; the cloud copy finished it.
    // Local's economy never held the grant, so it is paid into it once.
    store[key] = JSON.stringify({
      savedAt: 200,
      prologue: { state: 'in_progress', grantPaid: false, chaptersCompleted: ['p1_banner_at_dawn'], practised: ['forecast'] }, // prettier-ignore
    });
    mockCloudBootstrap({
      metaData: { 1: { savedAt: 100, totalValor: 60, totalSupply: 40, prologue: done } },
    });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    const kept = JSON.parse(store[key]);
    expect(kept.prologue).toEqual({ ...done, practised: ['forecast', 'seize'] });
    expect([kept.totalValor, kept.totalSupply]).toEqual([60, 40]);
    // A merged-in paid grant is never paid again by the live manager.
    const meta = new MetaProgressionManager([], key);
    expect(meta.completePrologue({ grant: { valor: 60, supply: 40 } })).toMatchObject({
      paid: false,
    });
    expect([meta.totalValor, meta.totalSupply]).toEqual([60, 40]);

    // The cloud copy is newer and wins, but never knew the prologue (a client from before
    // it drops the record and keeps the currencies): local's record stays, nothing added.
    store[key] = JSON.stringify({ savedAt: 100, prologue: done });
    mockCloudBootstrap({ metaData: { 1: { savedAt: 300 } } });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    const adopted = JSON.parse(store[key]);
    expect(adopted.savedAt).toBe(300);
    expect(adopted.prologue).toEqual(done);
    expect(adopted.totalValor).toBeUndefined();

    // Neither copy has one: nothing is added to the save.
    store[key] = JSON.stringify({ savedAt: 100 });
    mockCloudBootstrap({ metaData: { 1: { savedAt: 300 } } });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect('prologue' in JSON.parse(store[key])).toBe(false);
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
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({ runData: {} });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('keeps local run slot when cloud savedAt is older', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 300 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when cloud savedAt is newer', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 100 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

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
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when local timestamp is missing and cloud timestamp is valid', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-no-ts' };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('applies cloud run slot when local timestamp is invalid and cloud timestamp is valid', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-invalid-ts', savedAt: '200' };
    const cloud = { marker: 'cloud', savedAt: 300 };
    localStorage.setItem(key, JSON.stringify(local));
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
  });

  it('applies cloud run slot and emits telemetry when both timestamps are invalid', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local-no-ts' };
    const cloud = { marker: 'cloud-no-ts' };
    localStorage.setItem(key, JSON.stringify(local));
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(cloud);
    expect(mocked.markStartup).toHaveBeenCalledWith('cloud_run_merge_no_savedAt', { slot: 1 });
  });

  it('keeps local run slot on equal savedAt tie-break', async () => {
    const key = getRunKey(1);
    const local = { marker: 'local', savedAt: 200 };
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, JSON.stringify(local));
    store[getMetaKey(1)] = JSON.stringify({ savedAt: 50, totalValor: 1 });
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(JSON.parse(store[key])).toEqual(local);
  });

  it('applies cloud run slot when local slot is absent', async () => {
    const key = getRunKey(1);
    const cloud = { marker: 'cloud', savedAt: 200 };
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

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
  it('keeps malformed local run bytes and earned progression for explicit recovery', async () => {
    const key = getRunKey(1);
    const cloud = { marker: 'cloud', savedAt: 200 };
    localStorage.setItem(key, '{not-json');
    const metaRaw = JSON.stringify({ savedAt: 50, totalValor: 27 });
    store[getMetaKey(1)] = metaRaw;
    mockCloudBootstrap({
      runData: { 1: cloud },
      metaData: { 1: { savedAt: 50, totalValor: 1 } },
    });

    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });

    expect(store[key]).toBe('{not-json');
    expect(store[getMetaKey(1)]).toBe(metaRaw);
  });

  it('never populates an empty slot with a cloud run lacking progression', async () => {
    mockCloudBootstrap({ runData: { 1: { gold: 91, savedAt: 200 } } });
    await fetchAllToLocalStorage('user-1', { timeoutMs: 50 });
    expect(store[getRunKey(1)]).toBeUndefined();
    expect(store[getMetaKey(1)]).toBeUndefined();
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
