// Gamepad/keyboard focus for SettingsOverlay (Slice 2D continuation). Drives the
// REAL show() draw path against a mock scene, then exercises the focus scope through
// the shared input bus (dispatchInputAction) the way GamepadReader would.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

import { SettingsOverlay } from '../src/ui/SettingsOverlay.js';

beforeEach(() => _resetInputFocus());

// Chainable display object — complete enough for BoundingFocusController (getBounds,
// setVisible, truthy `scene`) and synthetic activation (emit -> stored handler).
function makeObj(seed = {}) {
  const o = { x: 0, y: 0, width: 120, height: 16, handlers: {}, scene: {}, ...seed };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setDepth = chain();
  o.setStrokeStyle = chain();
  o.setOrigin = chain();
  o.setColor = chain();
  o.setBackgroundColor = chain();
  o.setText = chain((t) => (o.text = t));
  o.setVisible = chain((v) => (o.visible = v));
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setInteractive = chain(() => (o.input = { enabled: true }));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.getBounds = () => ({
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    centerX: o.x,
    centerY: o.y,
  });
  o.destroy = () => (o.destroyed = true);
  return o;
}

function makeSettingsState() {
  const state = { music: 0.5, sfx: 0.5, reduced: false };
  return {
    state,
    getMusicVolume: () => state.music,
    setMusicVolume: (v) => (state.music = v),
    getSFXVolume: () => state.sfx,
    setSFXVolume: (v) => (state.sfx = v),
    getReducedEffects: () => state.reduced,
    setReducedEffects: (v) => (state.reduced = v),
  };
}

function makeOverlay() {
  const settings = makeSettingsState();
  const audio = { setMusicVolume: vi.fn(), setSFXVolume: vi.fn(), playSFX: vi.fn() };
  const scene = {
    cameras: { main: { centerX: 320, centerY: 240 } },
    registry: { get: (k) => (k === 'settings' ? settings : k === 'audio' ? audio : null) },
    add: {
      rectangle: (x, y, w, h, color, alpha) =>
        makeObj({ kind: 'rect', x, y, width: w, height: h, color, alpha }),
      text: (x, y, text) => makeObj({ kind: 'text', x, y, text }),
    },
  };
  const overlay = new SettingsOverlay(scene, vi.fn());
  return { overlay, settings, audio, scene };
}

describe('SettingsOverlay gamepad focus', () => {
  it('show() claims the input stack and builds 4 rows; hide() releases it', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    expect(overlay._rows.length).toBe(4); // Music, SFX, Reduced Effects, Close
    expect(overlay._focus).toBeTruthy();
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
  });

  it('the ring starts on the first row and d-pad up/down clamps within the list', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(overlay._focusIndex).toBe(0);
    expect(overlay._focus.objects[0]).toBe(overlay._rows[0].focus);

    dispatchInputAction(InputAction.NAVIGATE, { dy: -1 }); // clamp at top
    expect(overlay._focusIndex).toBe(0);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay._focusIndex).toBe(1);
    expect(overlay._focus.objects[0]).toBe(overlay._rows[1].focus);

    for (let i = 0; i < 10; i++) dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay._focusIndex).toBe(3); // clamps at Close (last)
  });

  it('d-pad right/left adjust the focused volume slider without moving the ring', () => {
    const { overlay, settings, audio } = makeOverlay();
    overlay.show(); // row 0 = Music, starts at 0.5
    const ringTarget = overlay._focus.objects[0];

    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // +10% -> 0.6
    expect(settings.state.music).toBeCloseTo(0.6, 5);
    expect(audio.setMusicVolume).toHaveBeenLastCalledWith(0.6);
    dispatchInputAction(InputAction.NAVIGATE, { dx: -1 }); // -10% -> 0.5
    expect(settings.state.music).toBeCloseTo(0.5, 5);

    // Adjusting must NOT move the ring off the row.
    expect(overlay._focusIndex).toBe(0);
    expect(overlay._focus.objects[0]).toBe(ringTarget);
  });

  it('SFX row adjusts SFX volume and previews via sfx_confirm', () => {
    const { overlay, settings, audio } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // -> SFX row
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // +10% -> 0.6
    expect(settings.state.sfx).toBeCloseTo(0.6, 5);
    expect(audio.setSFXVolume).toHaveBeenLastCalledWith(0.6);
    expect(audio.playSFX).toHaveBeenCalledWith('sfx_confirm');
  });

  it('toggle row: left/right force OFF/ON and CONFIRM flips it', () => {
    const { overlay, settings } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // -> Reduced Effects (row 2)
    expect(settings.state.reduced).toBe(false);

    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // ON
    expect(settings.state.reduced).toBe(true);
    dispatchInputAction(InputAction.NAVIGATE, { dx: -1 }); // OFF
    expect(settings.state.reduced).toBe(false);
    dispatchInputAction(InputAction.CONFIRM); // flip -> ON
    expect(settings.state.reduced).toBe(true);
  });

  it('CONFIRM on the Close row closes the overlay', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    for (let i = 0; i < 3; i++) dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // -> Close
    expect(overlay._focusIndex).toBe(3);
    dispatchInputAction(InputAction.CONFIRM);
    expect(overlay.visible).toBe(false);
    expect(activeInputOwner()).toBe(null);
  });

  it('CANCEL / PAUSE close the overlay from any row and fire onClose', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // SFX row
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.visible).toBe(false);
    expect(overlay.onClose).toHaveBeenCalledTimes(1);
    expect(activeInputOwner()).toBe(null);
  });

  it('re-show() does not double-push the scope; teardown is idempotent', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    overlay.show(); // show() calls hide() first -> single clean scope
    expect(activeInputOwner()).toBe(overlay);
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(() => overlay._teardownFocus()).not.toThrow();
  });
});
