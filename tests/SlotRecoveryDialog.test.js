import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  durable: vi.fn(),
  native: vi.fn(),
  deleteCloud: vi.fn(),
  fetch: vi.fn(),
  dom: vi.fn(),
  dialog: vi.fn(),
  mirrorAvailable: true,
}));
vi.mock('../src/cloud/CloudSync.js', () => ({
  deleteSlotCloud: mocks.deleteCloud,
  fetchAllToLocalStorage: mocks.fetch,
}));
vi.mock('../src/utils/nativeSaveMirror.js', () => ({
  nativeCapacitor: mocks.native,
  getNativeSaveMirror: () => (mocks.mirrorAvailable ? { ensureDurable: mocks.durable } : null),
}));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: mocks.dom }));
vi.mock('../src/ui/RunFlowMenus.js', () => ({ slotDialog: mocks.dialog }));
import { archiveAndDiscardSlot, retireSlotArchive } from '../src/engine/SlotRecovery.js';
import { prepareRecoveryLogout } from '../src/engine/SlotManager.js';
import { showSlotRecovery } from '../src/ui/SlotRecoveryDialog.js';

let values, scene, buttons;
const META = 'emblem_rogue_slot_1_meta';
const RUN = 'emblem_rogue_slot_1_run';
const ARCHIVE = 'emblem_rogue_slot_1_quarantine';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mirrorAvailable = true;
  mocks.native.mockReturnValue({});
  mocks.dom.mockReturnValue(false);
  mocks.dialog.mockImplementation((_scene, _title, _body, actions) => ({ actions }));
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
  return button.handlers.pointerdown();
}
function confirmDiscard() {
  showSlotRecovery(scene, 1);
  activate('Archive and discard…');
  activate('Archive and discard');
}

describe('native recovery discard', () => {
  it('offers an explicit signed-in account choice for an unassigned pending slot, without automatically claiming it', async () => {
    values.clear();
    const key = 'emblem_rogue_slot_1_cloud_pending';
    values.set(key, JSON.stringify({ version: 1, userId: null }));
    scene.registry.get = () => ({ userId: 'account-b' });
    showSlotRecovery(scene, 1);
    expect(JSON.parse(values.get(key)).userId).toBeNull();
    activate('Choose this account’s cloud copy…');
    expect(JSON.parse(values.get(key)).userId).toBeNull();
    activate('Check this account’s cloud copy');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('account-b'));
    expect(JSON.parse(values.get(key)).userId).toBe('account-b');
  });
  it.each(['offline', 'different account', 'missing device backup', 'failed device backup'])(
    'offers a warned reservation exit without erasing local bytes or cloud data (%s)',
    async (kind) => {
      values.clear();
      const key = 'emblem_rogue_slot_1_cloud_pending';
      values.set(
        key,
        JSON.stringify({ version: 1, userId: kind === 'offline' ? null : 'account-a' }),
      );
      values.set(META, '{"totalValor":999}');
      values.set(RUN, '{"runRecordId":"local-live","gold":4242}');
      if (kind === 'different account') scene.registry.get = () => ({ userId: 'account-b' });
      if (kind === 'missing device backup') mocks.mirrorAvailable = false;
      mocks.durable.mockResolvedValue(kind !== 'failed device backup');
      showSlotRecovery(scene, 1);
      if (kind === 'offline')
        expect(scene.confirmDialog.some((o) => o.copy?.includes('You are playing offline'))).toBe(
          true,
        );
      activate('Release reservation…');
      expect(scene.confirmDialog.some((o) => o.copy?.includes('may replace that cloud copy'))).toBe(
        true,
      );
      expect(values.has(key)).toBe(true);
      activate('Keep reservation');
      expect(values.has(key)).toBe(true);
      if (kind === 'failed device backup') {
        activate('Release on this device only…');
        activate('Accept risk and release locally');
      } else {
        activate('Release reservation…');
        activate('Release reservation');
      }
      await vi.waitFor(() => expect(values.has(key)).toBe(false));
      expect(values.get(META)).toBe('{"totalValor":999}');
      expect(values.get(RUN)).toBe('{"runRecordId":"local-live","gold":4242}');
      expect(mocks.deleteCloud).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['durable', 'device-only', 'failed acknowledgement'])(
    'releases the orphan owner through the native dialog after Free cleanup fails (%s)',
    async (kind) => {
      const ownerKey = 'emblem_rogue_slot_1_recovery_owner';
      const pendingKey = 'emblem_rogue_slot_1_cloud_pending';
      expect(archiveAndDiscardSlot(1).ok).toBe(true);
      expect(prepareRecoveryLogout('account-a').ok).toBe(true);
      const originalOwner = values.get(ownerKey);
      localStorage.removeItem = (key) => {
        if (key === ownerKey) throw new Error('owner cleanup failed');
        values.delete(key);
      };
      expect(retireSlotArchive(1).ok).toBe(false);
      expect(values.has(ARCHIVE)).toBe(false);
      expect(values.get(ownerKey)).toBe(originalOwner);
      const pending = values.get(pendingKey);
      localStorage.removeItem = (key) => values.delete(key);
      // Canonical data saved by another writer is never part of the release.
      values.set(META, '{"totalValor":999}');
      values.set(RUN, '{"gold":4242,"runRecordId":"new-live"}');
      mocks.durable.mockImplementation(
        async (key, raw) => kind !== 'failed acknowledgement' && (values.get(key) ?? null) === raw,
      );
      showSlotRecovery(scene, 1);
      activate('Release reservation…');
      activate('Keep reservation');
      expect(values.get(ownerKey)).toBe(originalOwner);
      expect(values.get(pendingKey)).toBe(pending);
      if (kind === 'device-only') {
        activate('Release on this device only…');
        activate('Accept risk and release locally');
      } else {
        activate('Release reservation…');
        activate('Release reservation');
      }
      if (kind === 'failed acknowledgement') {
        await vi.waitFor(() =>
          expect(
            scene.confirmDialog.some((o) =>
              o.copy?.includes('Device backup could not verify release'),
            ),
          ).toBe(true),
        );
        expect(values.get(ownerKey)).toBe(originalOwner);
        expect(values.get(pendingKey)).toBe(pending);
        activate('Release on this device only…');
        activate('Accept risk and release locally');
      }
      await vi.waitFor(() => expect(values.has(pendingKey)).toBe(false));
      expect(values.has(ownerKey)).toBe(false);
      expect(values.get(META)).toBe('{"totalValor":999}');
      expect(values.get(RUN)).toBe('{"gold":4242,"runRecordId":"new-live"}');
      expect(mocks.deleteCloud).not.toHaveBeenCalled();
      if (kind === 'durable') {
        expect(mocks.durable).toHaveBeenCalledWith(ownerKey, null);
        expect(mocks.durable).toHaveBeenCalledWith(pendingKey, null);
      }
    },
  );

  it.each(['new save', 'cancel and new save', 'cancel', 'restart', 'new owner', 'new reservation'])(
    'ignores stale native release rollback after %s',
    async (kind) => {
      values.clear();
      const pendingKey = 'emblem_rogue_slot_1_cloud_pending';
      const ownerKey = 'emblem_rogue_slot_1_recovery_owner';
      values.set(pendingKey, '{"version":1,"userId":"account-a"}');
      values.set(ownerKey, '{"version":1,"userId":"account-a"}');
      let finish;
      mocks.durable.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      showSlotRecovery(scene, 1);
      activate('Release reservation…');
      const release = activate('Release reservation');
      expect(values.has(pendingKey)).toBe(false);
      expect(values.has(ownerKey)).toBe(false);
      if (kind.includes('cancel')) scene.requestCancel();
      if (kind === 'restart') {
        scene.confirmDialog = [];
        scene.sys.isActive = () => false;
      }
      if (kind.includes('new save')) {
        values.set(META, '{"totalValor":99}');
        values.set(RUN, '{"runRecordId":"new-run","gold":4242}');
      }
      if (kind === 'new owner') values.set(ownerKey, 'new ownership evidence');
      if (kind === 'new reservation') values.set(pendingKey, 'new reservation evidence');
      const current = new Map(values);
      finish(false);
      await release;
      expect(values).toEqual(current);
      expect(mocks.deleteCloud).not.toHaveBeenCalled();
    },
  );

  it('acknowledges the removed reservation using the real native current-byte contract', async () => {
    values.clear();
    const key = 'emblem_rogue_slot_1_cloud_pending';
    values.set(key, '{"version":1,"userId":"account-a"}');
    mocks.durable.mockImplementation(
      async (recordKey, raw) => (values.get(recordKey) ?? null) === raw,
    );
    showSlotRecovery(scene, 1);
    activate('Release reservation…');
    activate('Release reservation');
    await vi.waitFor(() => expect(scene.drawSlots).toHaveBeenCalled());
    expect(values.has(key)).toBe(false);
  });

  it('failed native release acknowledgement restores the marker and offers the explicit local exit', async () => {
    values.clear();
    const key = 'emblem_rogue_slot_1_cloud_pending';
    const raw = '{"version":1,"userId":"account-a"}';
    values.set(key, raw);
    mocks.durable.mockResolvedValue(false);
    showSlotRecovery(scene, 1);
    activate('Release reservation…');
    activate('Release reservation');
    await vi.waitFor(() => expect(values.get(key)).toBe(raw));
    activate('Release on this device only…');
    activate('Accept risk and release locally');
    expect(values.has(key)).toBe(false);
  });

  it('a large live save does not hide the native device-only reservation exit', () => {
    values.clear();
    values.set('emblem_rogue_slot_1_cloud_pending', '{"version":1,"userId":null}');
    values.set(RUN, 'original'.repeat(100000));
    const before = new Map(values);
    showSlotRecovery(scene, 1);
    expect(buttons.some((entry) => entry.copy === '[ Release on this device only… ]')).toBe(true);
    expect(values).toEqual(before);
  });

  it('stale reservation release does not remove a replacement reservation', async () => {
    values.clear();
    const key = 'emblem_rogue_slot_1_cloud_pending';
    values.set(key, '{"version":1,"userId":"account-a"}');
    let resolve;
    mocks.durable.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    showSlotRecovery(scene, 1);
    activate('Release reservation…');
    activate('Release reservation');
    const replacement = '{"version":1,"userId":"account-b"}';
    values.set(key, replacement);
    resolve(true);
    await Promise.resolve();
    expect(values.get(key)).toBe(replacement);
  });

  it('an archived copy can only retire through the reserved Free path', async () => {
    mocks.durable.mockResolvedValue(true);
    confirmDiscard();
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    showSlotRecovery(scene, 1);
    expect(buttons.some((entry) => entry.copy === '[ Free slot… ]')).toBe(true);
    expect(buttons.some((entry) => entry.copy === '[ Remove copy only… ]')).toBe(false);
    expect(values.has(ARCHIVE)).toBe(true);
  });
  it.each([false, true])(
    'native never offers blob export attestation, and oversized originals offer Keep only (%s)',
    (oversized) => {
      mocks.dom.mockReturnValue(true);
      if (oversized) values.set(RUN, 'original'.repeat(100000));
      const before = new Map(values);
      showSlotRecovery(scene, 1);
      const labels = scene.nativeDialog.actions.map(([label]) => label);
      expect(labels).not.toContain('Export recovery copy');
      if (oversized) expect(labels).toEqual(['Keep save']);
      expect(values).toEqual(before);
    },
  );
  it('hydrates the owned slot immediately after Free and keeps the reservation while the fetch is pending', async () => {
    mocks.durable.mockResolvedValue(true);
    scene.registry.get = () => ({ userId: 'account-a' });
    confirmDiscard();
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    showSlotRecovery(scene, 1);
    activate('Free slot…');
    activate('Delete copy and free slot');
    await vi.waitFor(() => expect(scene._recoveryAttempt).toBeNull());
    expect(mocks.fetch).toHaveBeenCalledWith('account-a');
    expect(JSON.parse(values.get('emblem_rogue_slot_1_cloud_pending')).userId).toBe('account-a');
  });

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
          ['emblem_rogue_slot_1_cloud_pending', values.get('emblem_rogue_slot_1_cloud_pending')],
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
    expect(JSON.parse(values.get(ARCHIVE)).values[RUN]).toBe('{"gold":137}');
    activate('Replace pending copy');
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
