import { describe, it, expect, vi } from 'vitest';

// Scenes import Phaser at module load; a bare base class is enough.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { RunCompleteScene } from '../src/scenes/RunCompleteScene.js';
import { TitleScene } from '../src/scenes/TitleScene.js';
import { SlotPickerScene } from '../src/scenes/SlotPickerScene.js';
import { InputAction } from '../src/utils/InputActions.js';

function menuFocusMock() {
  return { move: vi.fn(), activate: vi.fn(), isActive: true, items: [], index: 0 };
}

describe('RunCompleteScene gamepad routing', () => {
  it('NAVIGATE (dx or dy) moves focus; CONFIRM activates', () => {
    const s = { _menuFocus: menuFocusMock() };
    RunCompleteScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: 0, dy: 1 });
    expect(s._menuFocus.move).toHaveBeenCalledWith(1);
    RunCompleteScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: -1, dy: 0 });
    expect(s._menuFocus.move).toHaveBeenCalledWith(-1);
    RunCompleteScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    expect(s._menuFocus.activate).toHaveBeenCalledTimes(1);
  });
});

describe('TitleScene gamepad routing', () => {
  it('routes NAVIGATE.dy / CONFIRM to the menu focus when no overlay is open', () => {
    const s = {
      isTransitioning: false,
      _menuFocus: menuFocusMock(),
      _titleOverlayOpen: TitleScene.prototype._titleOverlayOpen,
    };
    TitleScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dy: 1 });
    expect(s._menuFocus.move).toHaveBeenCalledWith(1);
    TitleScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    expect(s._menuFocus.activate).toHaveBeenCalledTimes(1);
  });

  it('ignores input while a title overlay is open (not yet gamepad-wired)', () => {
    const s = {
      isTransitioning: false,
      settingsOverlay: { visible: true },
      _menuFocus: menuFocusMock(),
      _titleOverlayOpen: TitleScene.prototype._titleOverlayOpen,
    };
    TitleScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dy: 1 });
    TitleScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    expect(s._menuFocus.move).not.toHaveBeenCalled();
    expect(s._menuFocus.activate).not.toHaveBeenCalled();
  });

  it('ignores input while transitioning', () => {
    const s = {
      isTransitioning: true,
      _menuFocus: menuFocusMock(),
      _titleOverlayOpen: TitleScene.prototype._titleOverlayOpen,
    };
    TitleScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    expect(s._menuFocus.activate).not.toHaveBeenCalled();
  });
});

describe('SlotPickerScene gamepad routing', () => {
  function baseScene(overrides = {}) {
    return {
      confirmDialog: null,
      _dialogFocus: null,
      _slotFocus: {
        move: vi.fn(),
        activate: vi.fn(),
        isActive: true,
        index: 0,
        items: [{ slot: 2 }],
      },
      _refreshSlotFocus: vi.fn(),
      requestCancel: vi.fn(),
      confirmDelete: vi.fn(),
      ...overrides,
    };
  }

  it('routes NAVIGATE/CONFIRM to the slot focus when no modal is open', () => {
    const s = baseScene();
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: 1 });
    expect(s._slotFocus.move).toHaveBeenCalledWith(1);
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    expect(s._slotFocus.activate).toHaveBeenCalledTimes(1);
  });

  it('DANGER deletes the focused slot', () => {
    const s = baseScene();
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.DANGER);
    expect(s.confirmDelete).toHaveBeenCalledWith(2);
  });

  it('routes to the dialog focus while a modal is open and CANCEL stays in the dialog', () => {
    const dialogFocus = { move: vi.fn(), activate: vi.fn() };
    const s = baseScene({ confirmDialog: [{}], _dialogFocus: dialogFocus });
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dy: 1 });
    expect(dialogFocus.move).toHaveBeenCalledWith(1);
    expect(s._slotFocus.move).not.toHaveBeenCalled();
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.CONFIRM);
    expect(dialogFocus.activate).toHaveBeenCalledTimes(1);
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.CANCEL);
    expect(s.requestCancel).toHaveBeenCalledWith({ allowExit: false });
  });

  it('CANCEL with no modal exits to title (allowExit true)', () => {
    const s = baseScene();
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.CANCEL);
    expect(s.requestCancel).toHaveBeenCalledWith({ allowExit: true });
  });

  it('tears down a stale dialog focus once its modal has closed', () => {
    const dialogFocus = { move: vi.fn(), activate: vi.fn(), destroy: vi.fn() };
    const s = baseScene({ confirmDialog: null, _dialogFocus: dialogFocus });
    SlotPickerScene.prototype._onInputAction.call(s, InputAction.NAVIGATE, { dx: 1 });
    expect(dialogFocus.destroy).toHaveBeenCalledTimes(1);
    expect(s._dialogFocus).toBeNull();
    expect(s._refreshSlotFocus).toHaveBeenCalledTimes(1);
    expect(s._slotFocus.move).toHaveBeenCalledWith(1); // fell through to base focus
  });
});
