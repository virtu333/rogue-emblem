import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  signOut: vi.fn(),
  clear: vi.fn(),
  summary: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/cloud/CloudSync.js', () => ({
  backupAllLocalSlots: mocks.flush,
  listLocalOnlySaves: () => [],
  getCloudSyncStatus: vi.fn(),
  pushMeta: vi.fn(),
}));
vi.mock('../src/cloud/supabaseClient.js', () => ({ signOut: mocks.signOut }));
vi.mock('../src/engine/SlotManager.js', () => ({
  MAX_SLOTS: 3,
  clearAllSlotData: mocks.clear,
  getSlotSummary: mocks.summary,
  getSlotCount: vi.fn(),
  getNextAvailableSlot: vi.fn(),
  getMetaKey: vi.fn(),
  setActiveSlot: vi.fn(),
  prepareRecoveryLogout: mocks.prepare,
}));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: () => false }));
import { TitleScene } from '../src/scenes/TitleScene.js';
let scene, values, reload;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.prepare.mockReturnValue({ ok: true, markers: [] });
  values = new Map([['save', 'precious progress']]);
  vi.stubGlobal('localStorage', {
    getItem: (k) => values.get(k) ?? null,
    removeItem: (k) => values.delete(k),
  });
  reload = vi.fn();
  vi.stubGlobal('location', { reload });
  scene = new TitleScene();
  scene.scene = { isActive: () => true };
  scene._setLogoutNotice = vi.fn();
  scene._showLogoutProgress = vi.fn();
  scene._closeTitleMenu = vi.fn();
  mocks.clear.mockImplementation(() => values.clear());
});
afterEach(() => vi.unstubAllGlobals());
describe('logout preserves local progress unless backup and signout succeed', () => {
  it('shows a protected-slot backup notice on Title and refreshes it when the slot changes', () => {
    const status = {
      mode: 'local_only',
      message: 'Slot 1: local save kept; cloud backup paused until recovery is resolved.',
    };
    scene.registry = { get: () => ({ syncStatus: status }) };
    scene.titleView = { setCloudNotice: vi.fn() };
    scene._refreshCloudSyncStatusNotice();
    expect(scene.titleView.setCloudNotice).toHaveBeenCalledWith(status.message);
    status.message = 'Slot 2: local save kept; cloud backup paused until recovery is resolved.';
    scene._refreshCloudSyncStatusNotice();
    expect(scene.titleView.setCloudNotice).toHaveBeenLastCalledWith(status.message);
  });

  it.each([{ recoveryRequired: true }, { runCorrupt: true }])(
    'signs out while retaining recovery data (%j)',
    async (summary) => {
      mocks.summary.mockReturnValue(summary);
      mocks.flush.mockResolvedValue({ ok: true, localOnly: [] });
      mocks.clear.mockReturnValue(false);
      await scene._handleLogout({ userId: 'tester' });
      expect(mocks.flush).toHaveBeenCalledWith('tester', { skipRecovery: true });
      expect(mocks.signOut).toHaveBeenCalledOnce();
      expect(values.get('save')).toBe('precious progress');
      expect(reload).toHaveBeenCalledOnce();
    },
  );
  it('signs out without deleting unchosen device/cloud conflict evidence', async () => {
    values.set(
      'emblem_rogue_slot_1_cloud_conflict',
      JSON.stringify({ localRun: { gold: 213 }, cloudRun: { gold: 987 } }),
    );
    mocks.flush.mockResolvedValue({ ok: true, localOnly: [] });
    mocks.clear.mockReturnValue(false);
    await scene._handleLogout({ userId: 'tester' });
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(values.has('emblem_rogue_slot_1_cloud_conflict')).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
  it('retries the backup after each failure, never treating an earlier failure as consent', async () => {
    mocks.flush.mockResolvedValue({ ok: false, localOnly: [] });
    await scene._handleLogout({ userId: 'tester' });
    await scene._handleLogout({ userId: 'tester' });
    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(values.get('save')).toBe('precious progress');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it('keeps local data and releases the blocking menu if signout fails after backup', async () => {
    mocks.flush.mockResolvedValue({ ok: true, localOnly: [] });
    mocks.signOut.mockRejectedValue(new Error('offline'));
    await scene._handleLogout({ userId: 'tester' });
    expect(values.get('save')).toBe('precious progress');
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(scene._logoutInProgress).toBe(false);
    expect(scene._closeTitleMenu).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not delete data while backup is still in flight, then clears once after successful signout', async () => {
    let finish;
    mocks.flush.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = scene._handleLogout({ userId: 'tester' });
    await scene._handleLogout({ userId: 'tester' });
    expect(values.has('save')).toBe(true);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    finish({ ok: true, localOnly: [] });
    await first;
    expect(values.size).toBe(0);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
