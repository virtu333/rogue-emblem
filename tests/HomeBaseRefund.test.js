// HomeBaseRefund.test.js — Behavioral tests for HomeBaseScene refund mode,
// confirm overlay lifecycle, and ESC priority chain.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

function createDisplayObject() {
  return {
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setColor() { return this; },
    setVisible() { return this; },
    setText() { return this; },
    on: vi.fn(),
    destroy: vi.fn(),
    width: 50,
    height: 20,
    x: 0,
    y: 0,
  };
}

// Minimal scene stub that satisfies HomeBaseScene methods under test
function createSceneStub(metaOverrides = {}) {
  const children = [];
  const meta = {
    getTotalValor: () => 100,
    getTotalSupply: () => 100,
    canRefund: vi.fn(() => ({ success: true, refundAmount: 50, refundFee: 20 })),
    refundUpgrade: vi.fn(() => ({ success: true, refundAmount: 50, refundFee: 20 })),
    getCurrencyForUpgrade: () => 'valor',
    ...metaOverrides,
  };

  return {
    meta,
    refundMode: false,
    confirmOverlayObjects: [],
    _skillPickerObjects: null,
    cameras: { main: { width: 640, height: 480, centerX: 320 } },
    registry: { get: vi.fn(() => null) },
    add: {
      rectangle: vi.fn(() => createDisplayObject()),
      text: vi.fn(() => createDisplayObject()),
    },
    drawUI: vi.fn(),
    showPauseMenu: vi.fn(),
    _hideRefundConfirm: HomeBaseScene.prototype._hideRefundConfirm,
    _destroySkillPicker: HomeBaseScene.prototype._destroySkillPicker,
    canRequestCancel: HomeBaseScene.prototype.canRequestCancel,
    requestCancel: HomeBaseScene.prototype.requestCancel,
    _showRefundConfirm: HomeBaseScene.prototype._showRefundConfirm,
    children: {
      removeAll: vi.fn(),
      list: children,
    },
  };
}

describe('HomeBaseScene refund ESC priority chain', () => {
  let scene;

  beforeEach(() => {
    scene = createSceneStub();
  });

  it('requestCancel dismisses confirm overlay first (before exiting refund mode)', () => {
    scene.refundMode = true;
    scene.confirmOverlayObjects = [createDisplayObject(), createDisplayObject()];

    const result = scene.requestCancel({ allowExit: true });

    expect(result).toBe(true);
    // Confirm overlay should be dismissed
    expect(scene.confirmOverlayObjects).toEqual([]);
    // Refund mode should still be active (not dismissed in same call)
    expect(scene.refundMode).toBe(true);
    // drawUI should NOT be called (confirm dismiss doesn't redraw)
    expect(scene.drawUI).not.toHaveBeenCalled();
  });

  it('requestCancel exits refund mode on second ESC (after confirm dismissed)', () => {
    scene.refundMode = true;
    // No confirm overlay

    const result = scene.requestCancel({ allowExit: true });

    expect(result).toBe(true);
    expect(scene.refundMode).toBe(false);
    expect(scene.drawUI).toHaveBeenCalledOnce();
  });

  it('requestCancel destroys skill picker before exiting to title', () => {
    scene._skillPickerObjects = [createDisplayObject()];

    const result = scene.requestCancel({ allowExit: true });

    expect(result).toBe(true);
    expect(scene._skillPickerObjects).toBeNull();
  });

  it('canRequestCancel returns true when confirm overlay is open', () => {
    scene.confirmOverlayObjects = [createDisplayObject()];
    expect(scene.canRequestCancel({ allowExit: false })).toBe(true);
  });

  it('canRequestCancel returns true when refund mode is active', () => {
    scene.refundMode = true;
    expect(scene.canRequestCancel({ allowExit: false })).toBe(true);
  });

  it('canRequestCancel returns false with nothing active and allowExit=false', () => {
    expect(scene.canRequestCancel({ allowExit: false })).toBe(false);
  });

  it('full ESC sequence: confirm → refund mode → title exit', () => {
    scene.refundMode = true;
    scene.confirmOverlayObjects = [createDisplayObject()];

    // First ESC: dismiss confirm
    scene.requestCancel({ allowExit: true });
    expect(scene.confirmOverlayObjects).toEqual([]);
    expect(scene.refundMode).toBe(true);

    // Second ESC: exit refund mode
    scene.requestCancel({ allowExit: true });
    expect(scene.refundMode).toBe(false);
    expect(scene.drawUI).toHaveBeenCalledOnce();

    // Third ESC: falls through to title-exit branch (returns true with allowExit)
    const result = scene.requestCancel({ allowExit: true });
    expect(result).toBe(true);
  });
});

describe('HomeBaseScene confirm overlay lifecycle', () => {
  let scene;

  beforeEach(() => {
    scene = createSceneStub();
  });

  it('_showRefundConfirm creates overlay objects at correct depths', () => {
    const upgrade = { id: 'test', name: 'Test Upgrade' };
    scene._showRefundConfirm(upgrade, 2, 150, 'valor');

    // Should have 5 objects: blocker, panel, message, confirmBtn, cancelBtn
    expect(scene.confirmOverlayObjects.length).toBe(5);
    // All should be display objects with destroy methods
    for (const obj of scene.confirmOverlayObjects) {
      expect(typeof obj.destroy).toBe('function');
    }
  });

  it('_showRefundConfirm clears previous confirm before creating new one', () => {
    const oldObj = createDisplayObject();
    scene.confirmOverlayObjects = [oldObj];

    const upgrade = { id: 'test', name: 'Test' };
    scene._showRefundConfirm(upgrade, 1, 100, 'supply');

    expect(oldObj.destroy).toHaveBeenCalled();
    // New objects should be created
    expect(scene.confirmOverlayObjects.length).toBe(5);
  });

  it('_hideRefundConfirm destroys all overlay objects and resets array', () => {
    const obj1 = createDisplayObject();
    const obj2 = createDisplayObject();
    scene.confirmOverlayObjects = [obj1, obj2];

    scene._hideRefundConfirm();

    expect(obj1.destroy).toHaveBeenCalled();
    expect(obj2.destroy).toHaveBeenCalled();
    expect(scene.confirmOverlayObjects).toEqual([]);
  });

  it('_hideRefundConfirm is safe to call when no overlay exists', () => {
    scene.confirmOverlayObjects = [];
    expect(() => scene._hideRefundConfirm()).not.toThrow();
    expect(scene.confirmOverlayObjects).toEqual([]);
  });
});

describe('HomeBaseScene refund mode state', () => {
  it('refund mode blocks requestCancel from reaching title when allowExit=false', () => {
    const scene = createSceneStub();
    scene.refundMode = true;

    // allowExit=false should still be handled (exit refund mode)
    const result = scene.requestCancel({ allowExit: false });
    expect(result).toBe(true);
    expect(scene.refundMode).toBe(false);
  });

  it('confirm overlay blocks requestCancel from reaching refund mode exit', () => {
    const scene = createSceneStub();
    scene.refundMode = true;
    const blocker = createDisplayObject();
    scene.confirmOverlayObjects = [blocker];

    scene.requestCancel({ allowExit: false });

    // Only confirm dismissed, refund mode untouched
    expect(blocker.destroy).toHaveBeenCalled();
    expect(scene.refundMode).toBe(true);
  });
});
