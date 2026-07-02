// Keyboard/gamepad focus for a flat list of menu buttons (the in-battle action
// menu in PR 1; other lists in later phases). The buttons are the existing Phaser
// objects — we just drive a focus highlight over them and invoke the focused
// item's callback on confirm, so no selection logic is duplicated.
//
// Each item is { button, onActivate, color?, onFocus?, onBlur? }:
//  - Simple buttons rely on the default setColor highlight (FOCUS_COLOR when
//    focused, the item's `color` — or DEFAULT_COLOR — otherwise).
//  - Buttons with a richer hover (a redrawn background, a cursor arrow, a scale
//    tween) pass onFocus/onBlur to reuse their EXACT pointer visuals, typically
//    `() => hitZone.emit('pointerover')` / `'pointerout'`, so mouse hover and
//    controller focus are indistinguishable.
//
// FOCUS_COLOR intentionally matches the buttons' pointer-hover color, so mouse
// hover and controller focus look identical and never visibly fight.
const FOCUS_COLOR = '#ffdd44';
const DEFAULT_COLOR = '#e0e0e0';

export class MenuFocusController {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // [{ button, onActivate, color }]
    this.index = -1;
  }

  destroy() {
    this.clear();
    this.scene = null;
  }

  get isActive() {
    return this.items.length > 0 && this.index >= 0;
  }

  /** Adopt a freshly built menu; focus the first item immediately. */
  setItems(items) {
    this._restoreColors();
    this.items = Array.isArray(items) ? items.filter(Boolean) : [];
    this.index = this.items.length ? 0 : -1;
    this._render();
  }

  clear() {
    this._restoreColors();
    this.items = [];
    this.index = -1;
  }

  /** Move focus by delta (wraps). delta is typically the NAVIGATE dy (-1 up / +1 down). */
  move(delta) {
    const n = this.items.length;
    if (n === 0 || !delta) return;
    this.index = (((this.index + delta) % n) + n) % n;
    this._render();
  }

  /** Invoke the focused item's callback. Returns true if something was activated. */
  activate() {
    if (!this.isActive) return false;
    const item = this.items[this.index];
    if (item && typeof item.onActivate === 'function') {
      item.onActivate();
      return true;
    }
    return false;
  }

  _render() {
    for (let i = 0; i < this.items.length; i++) {
      if (i === this.index) this._focus(this.items[i]);
      else this._blur(this.items[i]);
    }
  }

  _restoreColors() {
    for (const it of this.items) this._blur(it);
  }

  _focus(it) {
    if (typeof it.onFocus === 'function') it.onFocus(it.button);
    else it.button?.setColor?.(FOCUS_COLOR);
  }

  _blur(it) {
    if (typeof it.onBlur === 'function') it.onBlur(it.button);
    else it.button?.setColor?.(it.color || DEFAULT_COLOR);
  }
}
