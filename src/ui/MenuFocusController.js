// Keyboard/gamepad focus for a flat list of menu buttons (the in-battle action
// menu in PR 1; other lists in later phases). The buttons are the existing Phaser
// text objects — we just drive a focus highlight over them and invoke the focused
// item's callback on confirm, so no selection logic is duplicated.
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
      const it = this.items[i];
      const color = i === this.index ? FOCUS_COLOR : it.color || DEFAULT_COLOR;
      it.button?.setColor?.(color);
    }
  }

  _restoreColors() {
    for (const it of this.items) it.button?.setColor?.(it.color || DEFAULT_COLOR);
  }
}
