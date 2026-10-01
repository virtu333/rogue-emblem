import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  signOut: vi.fn(),
  writes: [],
  native: false,
  mirror: null,
  dom: false,
}));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: () => mocks.dom }));
vi.mock('../src/ui/MenuSurface.js', async () => ({
  ...(await vi.importActual('../src/ui/MenuSurface.js')),
  element: (kind, text) => ({ kind, text }),
  button: (label, action) => ({ label, action }),
}));
vi.mock('../src/utils/nativeSaveMirror.js', async () => {
  const actual = await vi.importActual('../src/utils/nativeSaveMirror.js');
  return {
    ...actual,
    nativeCapacitor: () => mocks.native,
    getNativeSaveMirror: () => mocks.mirror,
  };
});
import { NativeSaveMirror } from '../src/utils/nativeSaveMirror.js';
vi.mock('../src/cloud/supabaseClient.js', () => ({
  signOut: mocks.signOut,
  supabase: { from: mocks.from },
}));
import { TitleScene } from '../src/scenes/TitleScene.js';
import {
  getSlotDataKeys,
  getMetaKey,
  getRunKey,
  getSlotQuarantineKey,
  getSlotRecoveryOwnerKey,
  getSlotRecoveryOwner,
  isSlotRecoveryOwnedBy,
  UNKNOWN_SLOT_RECOVERY_OWNER,
  prepareRecoveryLogout,
  inspectSlot,
} from '../src/engine/SlotManager.js';
import {
  fetchAllToLocalStorage,
  pushAllLocalSlots,
  backupAllLocalSlots,
  pushRunSave,
  pushMeta,
  flushCloudSyncQueues,
  __resetCloudSyncStatusForTests,
} from '../src/cloud/CloudSync.js';

let store, storage, scene, reload;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.writes.length = 0;
  mocks.native = false;
  mocks.mirror = null;
  mocks.dom = false;
  __resetCloudSyncStatusForTests();
  store = new Map();
  storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  vi.stubGlobal('localStorage', storage);
  reload = vi.fn();
  vi.stubGlobal('location', { reload });
  scene = new TitleScene();
  scene._logoutUserId = 'account-a';
  scene.registry = { get: () => ({ userId: 'account-a' }) };
  scene._showLogoutProgress = vi.fn();
  scene._setLogoutNotice = vi.fn();
  scene._closeTitleMenu = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function remote({ run = {}, meta = {} } = {}) {
  mocks.from.mockImplementation((table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            data: table === 'run_saves' ? run : table === 'meta_progression' ? meta : null,
          },
          error: null,
        }),
      }),
    }),
    update: (payload) => {
      const query = {
        eq: () => query,
        is: () => query,
        select: () => ({
          maybeSingle: async () => {
            mocks.writes.push({ table, payload });
            return { data: { updated_at: 'done' }, error: null };
          },
        }),
      };
      return query;
    },
    upsert: async (payload) => {
      mocks.writes.push({ table, payload });
      return { error: null };
    },
  }));
}

function slotBytes(slot = 1) {
  return Object.fromEntries(getSlotDataKeys(slot).map((key) => [key, storage.getItem(key)]));
}

describe('logout recovery ownership and subsequent cloud hydration', () => {
  it('tags a complete legacy six-key archive before logout while preserving its raw bytes', async () => {
    const key = getSlotQuarantineKey(1);
    const raw = JSON.stringify({
      version: 1,
      slot: 1,
      state: 'archived',
      values: Object.fromEntries(
        getSlotDataKeys(1)
          .filter((k) => k !== getSlotRecoveryOwnerKey(1))
          .map((k) => [k, null]),
      ),
    });
    storage.setItem(key, raw);
    expect(getSlotRecoveryOwner(1)).toBeNull();
    await scene._finishLogout();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(storage.getItem(key)).toBe(raw);
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
  });

  it.each([
    ['{bad meta', JSON.stringify({ roster: [{ name: 'Old army' }], gold: 71, savedAt: 10 })],
    [JSON.stringify({ totalValor: 83, savedAt: 10 }), '{bad run'],
  ])(
    'retains damaged canonical bytes through signout and another account login',
    async (meta, run) => {
      storage.setItem(getMetaKey(1), meta);
      storage.setItem(getRunKey(1), run);
      storage.setItem(getMetaKey(2), JSON.stringify({ totalValor: 99 }));
      await scene._finishLogout();
      expect(mocks.signOut).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
      expect(storage.getItem(getMetaKey(2))).toBeNull();
      expect(getSlotRecoveryOwner(1)).toBe('account-a');
      expect(isSlotRecoveryOwnedBy(1, 'account-b')).toBe(false);
      const before = slotBytes();
      remote({
        run: { 1: { roster: [{ name: 'Other army' }], gold: 200, savedAt: 1000 } },
        meta: { 1: { totalValor: 300, savedAt: 1000 }, 2: { totalValor: 500, savedAt: 1000 } },
      });
      await fetchAllToLocalStorage('account-b');
      expect(slotBytes()).toEqual(before);
      expect(JSON.parse(storage.getItem(getMetaKey(2))).totalValor).toBe(500);
      pushRunSave('account-b', 1, { gold: 71, savedAt: 2000 });
      pushMeta('account-b', 1, { totalValor: 83, savedAt: 2000 });
      pushAllLocalSlots('account-b');
      expect(await backupAllLocalSlots('account-b', { skipRecovery: true })).toBe(true);
      await flushCloudSyncQueues();
      expect(
        mocks.writes.every(
          ({ table, payload }) =>
            JSON.stringify(payload.data['1']) ===
            JSON.stringify(
              table === 'meta_progression'
                ? { totalValor: 300, savedAt: 1000 }
                : { roster: [{ name: 'Other army' }], gold: 200, savedAt: 1000 },
            ),
        ),
      ).toBe(true);
      expect(slotBytes()).toEqual(before);
    },
  );

  it('marks conflict-only evidence and prevents remote hydration or reassigning its owner', async () => {
    storage.setItem(
      'emblem_rogue_slot_1_cloud_conflict',
      JSON.stringify({
        localRun: { gold: 123 },
        cloudRun: { gold: 321 },
      }),
    );
    await scene._finishLogout();
    const before = slotBytes();
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
    expect(prepareRecoveryLogout('account-b').ok).toBe(true);
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
    remote({ run: { 1: { gold: 900 } }, meta: { 1: { totalValor: 900 } } });
    await fetchAllToLocalStorage('account-b');
    expect(slotBytes()).toEqual(before);
  });

  it('blocks signout when the ownership write fails without removing original data', async () => {
    storage.setItem(getMetaKey(1), '{raw damaged meta');
    storage.setItem(getRunKey(1), '{raw damaged run');
    const before = slotBytes();
    storage.setItem = () => {
      throw new Error('quota');
    };
    await scene._finishLogout();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(slotBytes()).toEqual(before);
    expect(scene._setLogoutNotice).toHaveBeenCalledWith('quota', 'bad');
  });

  it('blocks signout if ownership cannot be read back', async () => {
    storage.setItem(getRunKey(1), '{raw damaged run');
    const originalGet = storage.getItem;
    storage.getItem = (key) => (key === getSlotRecoveryOwnerKey(1) ? null : originalGet(key));
    await scene._finishLogout();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(storage.getItem(getRunKey(1))).toBe('{raw damaged run');
  });

  it('keeps signout and data retriable when the native ownership write fails', async () => {
    mocks.native = true;
    mocks.mirror = { ensureDurable: vi.fn().mockResolvedValue(false) };
    storage.setItem(getRunKey(1), '{original damaged run');
    await scene._finishLogout();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(scene._logoutInProgress).toBe(false);
    expect(storage.getItem(getRunKey(1))).toBe('{original damaged run');
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
    mocks.mirror.ensureDurable.mockResolvedValue(true);
    await scene._finishLogout();
    expect(mocks.mirror.ensureDurable).toHaveBeenCalledTimes(2);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('bounds a hung native ownership write and never signs out after a late acknowledgement', async () => {
    vi.useFakeTimers();
    let release;
    mocks.native = true;
    const mirror = new NativeSaveMirror({
      storage,
      backend: {
        write: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    });
    mirror.active = true;
    mocks.mirror = mirror;
    storage.setItem(getRunKey(1), '{original damaged run');
    const logout = scene._finishLogout();
    await vi.advanceTimersByTimeAsync(6000);
    await logout;
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(scene._logoutInProgress).toBe(false);
    expect(storage.getItem(getRunKey(1))).toBe('{original damaged run');
    release();
    await Promise.resolve();
    expect(mocks.signOut).not.toHaveBeenCalled();
    await scene._finishLogout();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('requires a fresh explicit device-only choice when the native mirror is unavailable', async () => {
    mocks.native = true;
    mocks.dom = true;
    storage.setItem(getRunKey(1), '{original damaged run');
    scene._openTitleMenu = () => {
      const menu = {
        entries: [],
        body: { append: (...entries) => menu.entries.push(...entries) },
        focusContent: vi.fn(),
      };
      scene.nativeMenu = menu;
      return menu;
    };
    scene._closeTitleMenu = () => {
      scene.nativeMenu = null;
    };
    await scene._finishLogout();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
    const cancelled = scene.nativeMenu.entries.find((entry) =>
      entry.label?.startsWith('Keep recovery data'),
    );
    scene._closeTitleMenu();
    cancelled.action();
    expect(mocks.signOut).not.toHaveBeenCalled();
    await scene._finishLogout();
    const choice = scene.nativeMenu.entries.find((entry) =>
      entry.label?.startsWith('Keep recovery data'),
    );
    choice.action();
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(storage.getItem(getRunKey(1))).toBe('{original damaged run');
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('recovers known ownership from the archive and fails closed on malformed evidence', () => {
    storage.setItem(
      getSlotQuarantineKey(1),
      JSON.stringify({
        values: {
          [getSlotRecoveryOwnerKey(1)]: JSON.stringify({ version: 1, userId: 'account-a' }),
        },
      }),
    );
    expect(getSlotRecoveryOwner(1)).toBe('account-a');
    storage.setItem(getSlotRecoveryOwnerKey(1), '{broken');
    expect(getSlotRecoveryOwner(1)).toBe(UNKNOWN_SLOT_RECOVERY_OWNER);
    expect(isSlotRecoveryOwnedBy(1, 'account-a')).toBe(false);
    storage.getItem = () => {
      throw new Error('unreadable');
    };
    expect(getSlotRecoveryOwner(1)).toBe(UNKNOWN_SLOT_RECOVERY_OWNER);
  });

  it.each([
    { roster: 7 },
    { roster: [null] },
    { nodeMap: { nodes: {} } },
    {
      roster: [],
      _exportDiscardPending: true,
    },
  ])('classifies unsafe run shapes as damaged without changing the bytes: %j', (run) => {
    storage.setItem(getMetaKey(1), '{}');
    const raw = JSON.stringify(run);
    storage.setItem(getRunKey(1), raw);
    expect(inspectSlot(1).status).toBe('damaged');
    expect(storage.getItem(getRunKey(1))).toBe(raw);
  });

  it('never uploads an orphaned run, while healthy legacy meta-only saves remain valid', async () => {
    storage.setItem(getRunKey(1), JSON.stringify({ gold: 11 }));
    storage.setItem(getMetaKey(2), JSON.stringify({ totalValor: 22 }));
    remote();
    pushAllLocalSlots('account-b');
    await backupAllLocalSlots('account-b', { skipRecovery: true });
    await flushCloudSyncQueues();
    expect(mocks.writes.length).toBeGreaterThan(0);
    expect(
      mocks.writes.every(
        ({ table, payload }) => table !== 'run_saves' && payload.data['1'] === undefined,
      ),
    ).toBe(true);
    expect(inspectSlot(2).status).toBe('valid');
  });
});
