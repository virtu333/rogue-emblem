import { InputAction } from './InputActions.js';

// Global, Phaser-free gamepad reader.
//
// Reads raw `navigator.getGamepads()` each tick, edge-detects buttons (the W3C/
// Phaser gamepad API has no `justDown`), and emits device-independent InputActions
// through an injected `dispatch` callback. Kept free of Phaser/scene references so
// it works identically under Electron, the Android WebView, and the PWA, and so it
// is exhaustively unit-testable with a fake pad + a fake clock.
//
// Trigger note: under the W3C "standard" mapping L2/R2 are analog *buttons*
// (`buttons[6]`/`buttons[7]` with a `.value`), NOT axes — we threshold the value.

// Standard-mapping button index -> abstract action (single-press, edge-detected).
const BUTTON_ACTIONS = {
  0: InputAction.CONFIRM, // A / cross
  1: InputAction.CANCEL, // B / circle
  2: InputAction.DANGER, // X / square
  3: InputAction.ROSTER, // Y / triangle
  4: InputAction.PREV_UNIT, // L1 / LB
  5: InputAction.NEXT_UNIT, // R1 / RB
  6: InputAction.INSPECT, // L2 / LT (analog button — thresholded)
  9: InputAction.PAUSE, // Start
};

// Buttons whose `.pressed` is unreliable (analog triggers) — judge by `.value`.
const TRIGGER_INDICES = new Set([6, 7]);

const DPAD = { UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const AXIS = { LX: 0, LY: 1 };

const DEFAULTS = {
  deadzone: 0.5, // analog stick threshold to register a direction
  triggerThreshold: 0.6, // analog trigger value to count as "pressed"
  dasMs: 250, // delay before a held direction starts auto-repeating
  arrMs: 85, // interval between auto-repeats while held
};

export class GamepadReader {
  /**
   * @param {object} opts
   * @param {() => (Array|object)} opts.getPads  returns navigator.getGamepads() (or a fake)
   * @param {(action: string, payload?: object) => void} opts.dispatch  emits an InputAction
   * @param {object} [opts.config]  override deadzone/triggerThreshold/dasMs/arrMs
   */
  constructor({ getPads, dispatch, config = {} } = {}) {
    if (typeof getPads !== 'function') throw new Error('GamepadReader requires a getPads function');
    if (typeof dispatch !== 'function')
      throw new Error('GamepadReader requires a dispatch function');
    this.getPads = getPads;
    this.dispatch = dispatch;
    this.cfg = { ...DEFAULTS, ...config };

    this._prevPressed = {}; // button index -> was-pressed last tick (edge detection)
    this._navDir = { dx: 0, dy: 0 }; // currently-held direction
    this._navRepeatAt = 0; // timestamp of the next auto-repeat NAVIGATE
    this._padIndex = null; // which getPads() slot we're tracking
  }

  // Pick the first usable, standard-mapped pad. Returns null if none. Reading any
  // slot (not just 0) covers controllers that enumerate at a non-zero index.
  _activePad() {
    const pads = this.getPads() || [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;
      // v1 trusts only the W3C "standard" mapping (button indices are only
      // guaranteed there); a remap screen for non-standard pads is a fast-follow.
      if (pad.mapping !== 'standard') continue;
      this._padIndex = i;
      return pad;
    }
    this._padIndex = null;
    return null;
  }

  _isPressed(pad, index) {
    const btn = pad.buttons && pad.buttons[index];
    if (!btn) return false;
    if (TRIGGER_INDICES.has(index)) return (btn.value || 0) > this.cfg.triggerThreshold;
    return btn.pressed === true || (btn.value || 0) > 0.5;
  }

  // Reset edge/repeat state so a freshly (re)connected pad doesn't replay a stuck
  // press and a held direction re-arms from scratch.
  _reset() {
    this._prevPressed = {};
    this._navDir = { dx: 0, dy: 0 };
    this._navRepeatAt = 0;
  }

  /**
   * Poll once. `nowMs` is the caller's monotonic clock (Phaser passes scene.update's
   * `time`); injected so DAS/ARR timing is deterministic under test.
   */
  poll(nowMs = 0) {
    const pad = this._activePad();
    if (!pad) {
      // Disconnected: drop held state so reconnection edge-detects cleanly.
      if (Object.keys(this._prevPressed).length || this._navDir.dx || this._navDir.dy)
        this._reset();
      return;
    }

    // --- Buttons (single-press, edge-detected) ---
    for (const idxStr of Object.keys(BUTTON_ACTIONS)) {
      const index = Number(idxStr);
      const pressed = this._isPressed(pad, index);
      if (pressed && !this._prevPressed[index]) this.dispatch(BUTTON_ACTIONS[index]);
      this._prevPressed[index] = pressed;
    }

    // --- Direction (d-pad first, else left stick), with DAS/ARR auto-repeat ---
    this._pollNavigation(pad, nowMs);
  }

  _pollNavigation(pad, nowMs) {
    let dx = 0;
    let dy = 0;
    if (this._isPressed(pad, DPAD.LEFT)) dx = -1;
    else if (this._isPressed(pad, DPAD.RIGHT)) dx = 1;
    if (this._isPressed(pad, DPAD.UP)) dy = -1;
    else if (this._isPressed(pad, DPAD.DOWN)) dy = 1;

    const axes = pad.axes || [];
    const dz = this.cfg.deadzone;
    if (dx === 0) {
      const ax = axes[AXIS.LX] || 0;
      if (ax <= -dz) dx = -1;
      else if (ax >= dz) dx = 1;
    }
    if (dy === 0) {
      const ay = axes[AXIS.LY] || 0;
      if (ay <= -dz) dy = -1;
      else if (ay >= dz) dy = 1;
    }

    if (dx === 0 && dy === 0) {
      this._navDir = { dx: 0, dy: 0 };
      this._navRepeatAt = 0;
      return;
    }

    const changed = dx !== this._navDir.dx || dy !== this._navDir.dy;
    if (changed) {
      // New direction: fire immediately, then wait the full DAS before repeating.
      this.dispatch(InputAction.NAVIGATE, { dx, dy });
      this._navDir = { dx, dy };
      this._navRepeatAt = nowMs + this.cfg.dasMs;
    } else if (nowMs >= this._navRepeatAt) {
      // Held: auto-repeat at the ARR interval.
      this.dispatch(InputAction.NAVIGATE, { dx, dy });
      this._navRepeatAt = nowMs + this.cfg.arrMs;
    }
  }
}
