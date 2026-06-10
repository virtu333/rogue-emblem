// Delegation contracts for the RosterOverlay trade extraction: every trade
// method on the overlay must lazy-init RosterTradeController once and forward
// arguments/returns unchanged, and hide() must destroy the controller.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

import { RosterOverlay } from '../src/ui/RosterOverlay.js';
import { RosterTradeController } from '../src/ui/RosterTradeController.js';

function makeOverlay() {
  // Bypass the constructor — shim delegation only needs an object with the
  // RosterOverlay prototype and a controller slot.
  const overlay = Object.create(RosterOverlay.prototype);
  overlay._tradeController = null;
  return overlay;
}

describe('RosterOverlay trade shims', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('_showTradeScreen lazy-inits RosterTradeController once and reuses it', () => {
    const overlay = makeOverlay();
    const spy = vi
      .spyOn(RosterTradeController.prototype, '_showTradeScreen')
      .mockImplementation(() => {});

    overlay._showTradeScreen({ name: 'A' }, { name: 'B' });
    const firstController = overlay._tradeController;
    overlay._showTradeScreen({ name: 'A' }, { name: 'C' });

    expect(firstController).toBeInstanceOf(RosterTradeController);
    expect(overlay._tradeController).toBe(firstController);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it.each([
    ['_destroyTrade', []],
    ['_drawTradeDetailPane', [{ name: 'Iron Sword' }, { name: 'A' }, { name: 'B' }]],
    ['_showTradePicker', [{ name: 'A' }]],
    ['showUnitPicker', [vi.fn()]],
    ['_showTradeScreen', [{ name: 'A' }, { name: 'B' }]],
    ['_tradeText', [10, 20, 'hello', '#ffdd44', '12px']],
    ['_tradeTextSegments', [10, 20, [{ text: 'seg', color: '#e0e0e0' }], '10px']],
  ])('%s delegates to RosterTradeController with same args', (method, args) => {
    const overlay = makeOverlay();
    const expected = { tag: method };
    const spy = vi
      .spyOn(RosterTradeController.prototype, method)
      .mockImplementation(() => expected);

    const result = overlay[method](...args);

    expect(overlay._tradeController).toBeInstanceOf(RosterTradeController);
    expect(spy).toHaveBeenCalledWith(...args);
    expect(result).toBe(expected);
    spy.mockRestore();
  });

  it('hide() destroys the trade controller and nulls the reference', () => {
    const overlay = makeOverlay();
    overlay.visible = true;
    overlay._clearTooltipTimers = vi.fn();
    overlay._unregisterListeners = vi.fn();
    overlay._destroyDetails = vi.fn();
    overlay._destroyTrade = vi.fn();
    overlay.objects = [];
    overlay.onClose = null;
    const destroy = vi.fn();
    overlay._tradeController = { destroy };

    overlay.hide();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(overlay._tradeController).toBeNull();
    expect(overlay.visible).toBe(false);
  });
});
