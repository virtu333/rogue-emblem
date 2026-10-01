import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ durable: vi.fn(), native: vi.fn(), deleteCloud: vi.fn() }));
vi.mock('../src/cloud/CloudSync.js', () => ({ deleteSlotCloud: mocks.deleteCloud }));
vi.mock('../src/utils/nativeSaveMirror.js', () => ({
  nativeCapacitor: mocks.native,
  getNativeSaveMirror: () => ({ ensureDurable: mocks.durable }),
}));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: () => false }));
import { showSlotRecovery } from '../src/ui/SlotRecoveryDialog.js';

let values, scene, buttons;
const META = 'emblem_rogue_slot_1_meta';
const RUN = 'emblem_rogue_slot_1_run';
const ARCHIVE = 'emblem_rogue_slot_1_quarantine';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockReturnValue({});
  values = new Map([
    [META, '{bad'],
    [RUN, '{"gold":137}'],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, raw) => values.set(key, raw),
    removeItem: (key) => values.delete(key),
  });
  const display = (copy) => {
    const object = { copy, destroy: vi.fn(), handlers: {} };
    for (const key of ['setOrigin', 'setDepth', 'setInteractive']) object[key] = () => object;
    object.on = (event, act) => {
      object.handlers[event] = act;
      return object;
    };
    return object;
  };
  scene = {
    cameras: { main: { centerX: 320, centerY: 240 } },
    sys: { isActive: () => true },
    add: { rectangle: () => display(), text: (_x, _y, copy) => display(copy) },
    registry: { get: () => null },
    drawSlots: vi.fn(),
    requestCancel: () => {
      scene.confirmDialog = null;
    },
    _setDialogFocus: (entries) => {
      buttons = entries;
    },
  };
});
afterEach(() => vi.unstubAllGlobals());
function activate(label) {
  const button = buttons.find((b) => b.copy === `[ ${label} ]`);
  expect(button, label).toBeDefined();
  button.handlers.pointerdown();
}
function confirmDiscard() {
  showSlotRecovery(scene, 1);
  activate('Archive and discard…');
  activate('Archive and discard');
}

describe('native recovery discard', () => {
  it.each([false, true])(
    'frees an owned archived copy, including legacy archives (%s)',
    async (legacy) => {
      mocks.durable.mockResolvedValue(true);
      confirmDiscard();
      await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
      const ownerKey = 'emblem_rogue_slot_1_recovery_owner';
      const owner = JSON.stringify({ version: 1, userId: 'account-a' });
      values.set(ownerKey, owner);
      if (legacy) {
        const archive = JSON.parse(values.get(ARCHIVE));
        delete archive.values[ownerKey];
        values.set(ARCHIVE, JSON.stringify(archive));
      }
      mocks.durable.mockClear();
      showSlotRecovery(scene, 1);
      activate('Free slot…');
      activate('Delete copy and free slot');
      await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
      expect(values.has(ARCHIVE)).toBe(false);
      expect(values.has(ownerKey)).toBe(false);
      expect(mocks.durable.mock.calls.map(([key, value]) => [key, value]).sort()).toEqual(
        [
          ['emblem_rogue_slot_1_meta', null],
          ['emblem_rogue_slot_1_run', null],
          ['emblem_rogue_slot_1_run_clock_floor', null],
          ['emblem_rogue_slot_1_meta_clock_floor', null],
          ['emblem_rogue_slot_1_cloud_conflict', null],
          ['emblem_rogue_slot_1_hints', null],
        ].sort(),
      );
    },
  );

  it.each(['cancel', 'acknowledgement failure', 'copy changed', 'owner changed'])(
    'retains recovery ownership through a failed or cancelled Free (%s)',
    async (failure) => {
      mocks.durable.mockResolvedValue(true);
      confirmDiscard();
      await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
      const ownerKey = 'emblem_rogue_slot_1_recovery_owner';
      const owner = JSON.stringify({ version: 1, userId: 'account-a' });
      values.set(ownerKey, owner);
      const originalArchive = values.get(ARCHIVE);
      let resolve;
      mocks.durable.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      showSlotRecovery(scene, 1);
      activate('Free slot…');
      activate('Delete copy and free slot');
      expect(values.get(ownerKey)).toBe(owner);
      if (failure === 'cancel') scene.requestCancel();
      if (failure === 'copy changed') {
        const changed = JSON.parse(originalArchive);
        changed.values[RUN] = 'a different preserved run';
        values.set(ARCHIVE, JSON.stringify(changed));
      }
      if (failure === 'owner changed')
        values.set(ownerKey, JSON.stringify({ version: 1, userId: 'account-b' }));
      const expected = new Map(values);
      // Resolve the first bounded acknowledgement, then let remaining proofs complete.
      const finish = resolve;
      mocks.durable.mockResolvedValue(true);
      finish(failure !== 'acknowledgement failure');
      await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
      expect(values).toEqual(expected);
      expect(values.has(ARCHIVE)).toBe(true);
      expect(values.has(ownerKey)).toBe(true);
    },
  );

  it('frees only local recovery data and retains the cloud copy', async () => {
    scene.registry.get = (key) => (key === 'cloud' ? { userId: 'original-account' } : null);
    mocks.durable.mockResolvedValue(true);
    confirmDiscard();
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    activate('Free slot…');
    activate('Delete copy and free slot');
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    expect(values.has(ARCHIVE)).toBe(false);
    expect(values.has(META)).toBe(false);
    expect(values.has(RUN)).toBe(false);
    expect(mocks.deleteCloud).not.toHaveBeenCalled();
  });

  it('ignores a stale discard confirmation after the dialog was cancelled', () => {
    showSlotRecovery(scene, 1);
    activate('Archive and discard…');
    const oldConfirm = buttons.find((b) => b.copy === '[ Archive and discard ]').handlers
      .pointerdown;
    scene.requestCancel();
    showSlotRecovery(scene, 1);
    const before = new Map(values);
    oldConfirm();
    expect(values).toEqual(before);
    expect(mocks.durable).not.toHaveBeenCalled();
  });

  it('ignores a stale free confirmation after a different recovery dialog opens', async () => {
    mocks.durable.mockResolvedValue(true);
    confirmDiscard();
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    activate('Free slot…');
    const oldConfirm = buttons.find((b) => b.copy === '[ Delete copy and free slot ]').handlers
      .pointerdown;
    scene.requestCancel();
    showSlotRecovery(scene, 1);
    const before = new Map(values);
    oldConfirm();
    expect(values).toEqual(before);
  });
  it('can retake a changed pending copy after cancelling native acknowledgement', async () => {
    let resolve;
    mocks.durable.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    confirmDiscard();
    scene.requestCancel();
    resolve(false);
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    values.set(RUN, '{"gold":999}');
    showSlotRecovery(scene, 1);
    activate('Retake pending copy');
    expect(JSON.parse(values.get(ARCHIVE)).values[RUN]).toBe('{"gold":999}');
    mocks.durable.mockResolvedValue(true);
    activate('Archive and discard…');
    activate('Archive and discard');
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    expect(values.has(RUN)).toBe(false);
    expect(JSON.parse(values.get(ARCHIVE)).state).toBe('archived');
  });

  it('freeing the slot leaves the cloud copy available', async () => {
    mocks.durable.mockResolvedValue(true);
    confirmDiscard();
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    const cloud = { userId: 'tester' };
    scene.registry.get = () => cloud;
    activate('Free slot…');
    expect(scene.confirmDialog.some((o) => o.copy?.includes('Cloud saves are kept'))).toBe(true);
    activate('Delete copy and free slot');
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    expect(values.has(ARCHIVE)).toBe(false);
  });
  it('waits for disk acknowledgement and keeps the original save if that write fails', async () => {
    let resolve;
    mocks.durable.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    confirmDiscard();
    expect(values.get(META)).toBe('{bad');
    expect(values.get(RUN)).toBe('{"gold":137}');
    expect(JSON.parse(values.get(ARCHIVE)).values[META]).toBe('{bad');
    resolve(false);
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    expect(values.get(META)).toBe('{bad');
    expect(values.get(RUN)).toBe('{"gold":137}');
    expect(scene.confirmDialog.some((o) => o.copy?.includes('could not be verified'))).toBe(true);
  });

  it('removes canonical keys only after the acknowledged copy matches exactly', async () => {
    mocks.durable.mockResolvedValue(true);
    confirmDiscard();
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    expect(values.has(META)).toBe(false);
    expect(values.has(RUN)).toBe(false);
    expect(JSON.parse(values.get(ARCHIVE))).toMatchObject({
      state: 'archived',
      values: { [META]: '{bad', [RUN]: '{"gold":137}' },
    });
  });

  it.each(['cancel', 'restart'])(
    'does not delete after %s while the disk write is in flight',
    async (kind) => {
      let resolve;
      mocks.durable.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      confirmDiscard();
      if (kind === 'cancel') scene.requestCancel();
      else {
        scene._recoveryAttempt = null;
        scene.confirmDialog = [];
      }
      resolve(true);
      await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
      expect(values.get(META)).toBe('{bad');
      expect(values.get(RUN)).toBe('{"gold":137}');
    },
  );
});
