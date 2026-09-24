import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  signOut: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/cloud/CloudSync.js', () => ({
  backupAllLocalSlots: mocks.flush,
  getCloudSyncStatus: vi.fn(),
  pushMeta: vi.fn(),
}));
vi.mock('../src/cloud/supabaseClient.js', () => ({ signOut: mocks.signOut }));
vi.mock('../src/engine/SlotManager.js', () => ({
  MAX_SLOTS: 3,
  clearAllSlotData: mocks.clear,
  getSlotCount: vi.fn(),
  getNextAvailableSlot: vi.fn(),
  getMetaKey: vi.fn(),
  setActiveSlot: vi.fn(),
}));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: () => false }));
import { TitleScene } from '../src/scenes/TitleScene.js';
let scene, values, reload;
beforeEach(() => {
  vi.resetAllMocks();
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
  it('will not log out while a retained device/cloud conflict remains unresolved', async () => {
    values.set(
      'emblem_rogue_slot_1_cloud_conflict',
      JSON.stringify({ localRun: { gold: 213 }, cloudRun: { gold: 987 } }),
    );
    await scene._handleLogout({ userId: 'tester' });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(values.has('save')).toBe(true);
    expect(values.has('emblem_rogue_slot_1_cloud_conflict')).toBe(true);
  });
  it('retries the backup after each failure, never treating an earlier failure as consent', async () => {
    mocks.flush.mockResolvedValue(false);
    await scene._handleLogout({ userId: 'tester' });
    await scene._handleLogout({ userId: 'tester' });
    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(values.get('save')).toBe('precious progress');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it('keeps local data and releases the blocking menu if signout fails after backup', async () => {
    mocks.flush.mockResolvedValue(true);
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
    finish(true);
    await first;
    expect(values.size).toBe(0);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
