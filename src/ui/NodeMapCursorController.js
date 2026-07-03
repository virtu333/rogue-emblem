// Gamepad/keyboard cursor for the branching node map.
//
// The player can only ever pick an *available* (unlocked) node, so the cursor
// simply steps through the available nodes (ordered bottom-to-top, left-to-right)
// rather than walking the full graph. Confirm reuses scene.onNodeClick — the exact
// path a mouse click takes — and focus reuses the existing node tooltip, so nothing
// is duplicated. The whole map is scaled to fit the viewport, so no camera-follow
// is needed.

const RING_RADIUS = 17; // NODE_SIZE (24) / 2 + a compact focus margin
const RING_COLOR = 0xffdd44;
const RING_DEPTH = 5; // above nodes (NODE_DEPTH 1) and aura, below tooltips

export class NodeMapCursorController {
  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
    this.positions = null;
    this.index = -1;
    this.marker = null;
  }

  destroy() {
    if (this.marker?.scene) this.marker.destroy();
    this.marker = null;
    this.scene = null;
  }

  /**
   * Adopt the current frame's available nodes and their screen positions. Called
   * at the end of drawMap(), which has just wiped every child (so the previous
   * marker is already gone) — the highlight is recreated on the next _render.
   * @param {Array} nodes  available (clickable) node objects
   * @param {Map<string,{x:number,y:number}>} positions  node id -> screen point
   */
  setNodes(nodes, positions) {
    this.positions = positions || null;
    this.nodes = (Array.isArray(nodes) ? nodes.slice() : []).sort(
      (a, b) => a.row - b.row || a.col - b.col,
    );
    if (this.marker?.scene) this.marker.destroy();
    this.marker = null; // drawMap's children.removeAll already destroyed it
    if (this.nodes.length === 0) this.index = -1;
    else this.index = Math.min(Math.max(this.index, 0), this.nodes.length - 1);
    this._render();
  }

  /** Step through the available nodes; any direction advances the sorted list. */
  move(dx = 0, dy = 0) {
    const n = this.nodes.length;
    if (n === 0) return;
    const step = dx || dy;
    if (!step) return;
    this.index = (((this.index + (step > 0 ? 1 : -1)) % n) + n) % n;
    this._render();
  }

  /** Confirm at the focused node — same seam as a mouse click. */
  confirm() {
    const node = this.nodes[this.index];
    if (node && typeof this.scene?.onNodeClick === 'function') this.scene.onNodeClick(node);
  }

  current() {
    return this.nodes[this.index] || null;
  }

  _render() {
    const scene = this.scene;
    const node = this.nodes[this.index];
    if (!scene || !node) {
      scene?.hideNodeTooltip?.();
      if (this.marker?.setVisible) this.marker.setVisible(false);
      return;
    }
    const pos = this.positions?.get?.(node.id);
    if (!pos) return;
    if (!this.marker || this.marker.scene == null) {
      this.marker = scene.add
        .circle(pos.x, pos.y, RING_RADIUS, 0x000000, 0)
        .setStrokeStyle(2, RING_COLOR)
        .setDepth(RING_DEPTH);
    } else {
      this.marker.setPosition(pos.x, pos.y).setVisible(true);
    }
    scene.showNodeTooltip?.(node, pos);
  }
}
