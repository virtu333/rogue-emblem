import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ durable: vi.fn(), native: vi.fn() }));
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
