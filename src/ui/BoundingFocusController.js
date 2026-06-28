// Gamepad/keyboard focus for a heterogeneous set of interactive Phaser objects
// (tabs, cost buttons, list rows, bottom buttons) that don't share a colour scheme.
//
// Instead of recolouring each object (MenuFocusController's model), this draws a
// single gold ring around the focused object's bounds — a uniform, console-style
// highlight that works regardless of the object's own hover styling. Confirm
// re-emits the object's own 'pointerdown', so the existing click handler runs and
// nothing is duplicated. Objects are supplied already ordered (typically reading
// order); the caller rebuilds the list after each redraw.

const RING_COLOR = 0xffdd44;
const RING_PAD_X = 10;
const RING_PAD_Y = 8;

export class BoundingFocusController {
  constructor(scene, depth = 950) {
    this.scene = scene;
    this.depth = depth;
    this.objects = [];
    this.index = -1;
    this.ring = null;
  }

  destroy() {
    if (this.ring?.scene) this.ring.destroy();
    this.ring = null;
    this.scene = null;
  }

  get isActive() {
    return this.objects.length > 0 && this.index >= 0;
  }

  /**
   * Adopt a freshly ordered object list. By default the focus index is kept in
   * range; pass resetIndex=true to snap focus back to the first item (used when
   * swapping to a different menu, e.g. a confirm modal, rather than redrawing the
   * same one).
   */
  setObjects(objects, resetIndex = false) {
    this.objects = Array.isArray(objects) ? objects.filter(Boolean) : [];
    if (this.ring && this.ring.scene == null) this.ring = null; // wiped by a redraw
    if (resetIndex) this.index = this.objects.length ? 0 : -1;
    else
      this.index = this.objects.length
        ? Math.min(Math.max(this.index, 0), this.objects.length - 1)
        : -1;
    this._render();
  }

  clear() {
    this.objects = [];
    this.index = -1;
    if (this.ring?.setVisible) this.ring.setVisible(false);
  }

  /** Step focus; any direction advances the flat (reading-order) list. */
  move(delta) {
    const n = this.objects.length;
    if (n === 0 || !delta) return;
    this.index = (((this.index + (delta > 0 ? 1 : -1)) % n) + n) % n;
    this._render();
  }

  /** Re-render the ring at the current index (e.g. after the focused object moved). */
  refresh() {
    this._render();
  }

  /** Activate the focused object by re-emitting its own pointerdown. */
  activate() {
    const o = this.objects[this.index];
    if (o?.emit) {
      o.emit('pointerdown', { button: 0 });
      return true;
    }
    return false;
  }

  current() {
    return this.objects[this.index] || null;
  }

  _render() {
    if (this.ring && this.ring.scene == null) this.ring = null;
    const o = this.objects[this.index];
    if (!this.scene || !o || typeof o.getBounds !== 'function') {
      if (this.ring?.setVisible) this.ring.setVisible(false);
      return;
    }
    const b = o.getBounds();
    const w = b.width + RING_PAD_X;
    const h = b.height + RING_PAD_Y;
    if (!this.ring) {
      this.ring = this.scene.add
        .rectangle(b.centerX, b.centerY, w, h, 0x000000, 0)
        .setStrokeStyle(2, RING_COLOR)
        .setDepth(this.depth);
    } else {
      this.ring.setPosition(b.centerX, b.centerY).setSize(w, h).setVisible(true);
    }
  }
}
