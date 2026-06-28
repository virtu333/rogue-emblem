import { isTouchPointer } from './runtimeFlags.js';

const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 3;
const DEFAULT_RESET_EPSILON = 0.95;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export class BattleCameraController {
  constructor(camera, options = {}) {
    this.camera = camera;
    this.getBounds = typeof options.getBounds === 'function' ? options.getBounds : () => null;
    this.minZoom = Number.isFinite(options.minZoom) ? options.minZoom : DEFAULT_MIN_ZOOM;
    this.maxZoom = Number.isFinite(options.maxZoom) ? options.maxZoom : DEFAULT_MAX_ZOOM;
    this.resetPinchScaleThreshold = Number.isFinite(options.resetPinchScaleThreshold)
      ? options.resetPinchScaleThreshold
      : DEFAULT_RESET_EPSILON;
    this.onViewChanged = typeof options.onViewChanged === 'function' ? options.onViewChanged : null;

    this._touches = new Map();
    this._gestureActive = false;
    this._gestureStartDistance = 0;
    this._gestureStartZoom = this.minZoom;
    this._gestureAnchorWorld = { x: 0, y: 0 };
    this._pinchOutResetRequested = false;
  }

  destroy() {
    this.clearTouches();
    this._pinchOutResetRequested = false;
  }

  getZoom() {
    return Number(this.camera?.zoom || 1);
  }

  hasActiveTouches() {
    return this._touches.size > 0;
  }

  getTouchCount() {
    return this._touches.size;
  }

  clearTouches() {
    const hadTouches = this._touches.size > 0;
    this._touches.clear();
    this._gestureActive = false;
    this._gestureStartDistance = 0;
    this._pinchOutResetRequested = false;
    return hadTouches;
  }

  pruneInactiveTouches(pointer) {
    const pointers = pointer?.manager?.pointers;
    if (!Array.isArray(pointers) || pointers.length <= 0) return;
    const activeTouchIds = new Set();
    for (const ref of pointers) {
      if (!isTouchPointer(ref) || !ref.isDown) continue;
      activeTouchIds.add(ref.id);
    }
    for (const id of [...this._touches.keys()]) {
      if (!activeTouchIds.has(id)) this._touches.delete(id);
    }
  }

  // Phaser cameras zoom around their center: the visible world rect is centered on
  // (scrollX + width/2, scrollY + height/2), so at zoom > 1 the visible left/top edge
  // is scrollX/scrollY plus this offset — scroll is NOT the visible edge.
  _zoomOffsets(zoom) {
    const cam = this.camera;
    const z = Number.isFinite(zoom) && zoom > 0 ? zoom : Number(cam?.zoom) || 1;
    return {
      x: ((Number(cam?.width) || 0) / 2) * (1 - 1 / z),
      y: ((Number(cam?.height) || 0) / 2) * (1 - 1 / z),
    };
  }

  screenToWorld(x, y) {
    const cam = this.camera;
    if (!cam || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const relX = x - (cam.x || 0);
    const relY = y - (cam.y || 0);
    const zoom = Number(cam.zoom) || 1;
    const off = this._zoomOffsets(zoom);
    return {
      x: (Number(cam.scrollX) || 0) + off.x + relX / zoom,
      y: (Number(cam.scrollY) || 0) + off.y + relY / zoom,
    };
  }

  worldToScreen(x, y) {
    const cam = this.camera;
    if (!cam || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const zoom = Number(cam.zoom) || 1;
    const off = this._zoomOffsets(zoom);
    return {
      x: (x - (Number(cam.scrollX) || 0) - off.x) * zoom + (cam.x || 0),
      y: (y - (Number(cam.scrollY) || 0) - off.y) * zoom + (cam.y || 0),
    };
  }

  resetView() {
    const cam = this.camera;
    if (!cam) return;
    cam.setZoom(this.minZoom);
    const scroll = this._defaultScrollForZoom(this.minZoom);
    cam.setScroll(scroll.x, scroll.y);
    this.clampToBounds();
    this._emitViewChanged();
  }

  clampToBounds() {
    const cam = this.camera;
    const bounds = this.getBounds();
    if (!cam || !bounds) return;

    const zoom = Number(cam.zoom) || 1;
    const viewWidth = cam.width / zoom;
    const viewHeight = cam.height / zoom;
    const off = this._zoomOffsets(zoom);

    const visibleLeft = (Number(cam.scrollX) || 0) + off.x;
    const visibleTop = (Number(cam.scrollY) || 0) + off.y;
    const nextX = this._clampAxis(visibleLeft, bounds.left, bounds.width, viewWidth) - off.x;
    const nextY = this._clampAxis(visibleTop, bounds.top, bounds.height, viewHeight) - off.y;
    cam.setScroll(nextX, nextY);
  }

  // Pan the camera the minimum amount so a world-space point sits at least
  // `margin` world-units inside the visible rect, then clamp to bounds. Used by
  // the gamepad grid cursor to keep itself on-screen as it moves. Returns true if
  // it scrolled. Accounts for zoom: at zoom > 1 the visible edge is scroll + off,
  // not scroll (see _zoomOffsets), so the cursor doesn't slip under the bezel.
  ensureWorldVisible(worldX, worldY, margin = 0) {
    const cam = this.camera;
    if (!cam || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    const zoom = Number(cam.zoom) || 1;
    const off = this._zoomOffsets(zoom);
    const viewWidth = (Number(cam.width) || 0) / zoom;
    const viewHeight = (Number(cam.height) || 0) / zoom;
    // Don't let the margin exceed half the view, or the left/right (and top/bottom)
    // conditions would contradict each other.
    const mx = Math.max(0, Math.min(margin, viewWidth / 2 - 1));
    const my = Math.max(0, Math.min(margin, viewHeight / 2 - 1));

    const startX = Number(cam.scrollX) || 0;
    const startY = Number(cam.scrollY) || 0;
    let scrollX = startX;
    let scrollY = startY;
    const visibleLeft = startX + off.x;
    const visibleTop = startY + off.y;
    const visibleRight = visibleLeft + viewWidth;
    const visibleBottom = visibleTop + viewHeight;

    if (worldX < visibleLeft + mx) scrollX += worldX - (visibleLeft + mx);
    else if (worldX > visibleRight - mx) scrollX += worldX - (visibleRight - mx);
    if (worldY < visibleTop + my) scrollY += worldY - (visibleTop + my);
    else if (worldY > visibleBottom - my) scrollY += worldY - (visibleBottom - my);

    if (scrollX === startX && scrollY === startY) return false;
    cam.setScroll(scrollX, scrollY);
    this.clampToBounds();
    this._emitViewChanged();
    return true;
  }

  handlePointerDown(pointer, allowed = true) {
    if (!isTouchPointer(pointer))
      return { consumed: false, beganGesture: false, touchCount: this._touches.size };
    this.pruneInactiveTouches(pointer);
    if (this._gestureActive && this._touches.size < 2) this._endGesture();
    this._touches.set(pointer.id, { x: pointer.x, y: pointer.y });
    const touchCount = this._touches.size;
    if (!allowed) return { consumed: false, beganGesture: false, touchCount };

    if (this._touches.size >= 2) {
      this._beginGesture();
      return { consumed: true, beganGesture: true, touchCount };
    }
    return { consumed: false, beganGesture: false, touchCount };
  }

  handlePointerMove(pointer, allowed = true) {
    if (!isTouchPointer(pointer)) return { consumed: false };
    this.pruneInactiveTouches(pointer);
    if (this._touches.has(pointer.id)) {
      this._touches.set(pointer.id, { x: pointer.x, y: pointer.y });
    } else if (pointer.isDown) {
      this._touches.set(pointer.id, { x: pointer.x, y: pointer.y });
    }
    if (this._gestureActive && this._touches.size < 2) {
      this._endGesture();
      return { consumed: true };
    }
    if (!allowed || !this._gestureActive || this._touches.size < 2) return { consumed: false };

    const points = [...this._touches.values()];
    const a = points[0];
    const b = points[1];
    const dist = distance(a, b);
    if (!Number.isFinite(dist) || dist <= 0 || this._gestureStartDistance <= 0) {
      return { consumed: true };
    }

    const scale = dist / this._gestureStartDistance;
    const nextZoom = clamp(this._gestureStartZoom * scale, this.minZoom, this.maxZoom);
    const mid = midpoint(a, b);
    const anchor = this._gestureAnchorWorld;

    this.camera.setZoom(nextZoom);
    const off = this._zoomOffsets(nextZoom);
    this.camera.setScroll(
      anchor.x - off.x - (mid.x - (this.camera.x || 0)) / nextZoom,
      anchor.y - off.y - (mid.y - (this.camera.y || 0)) / nextZoom,
    );
    this.clampToBounds();

    this._pinchOutResetRequested =
      scale < this.resetPinchScaleThreshold && nextZoom <= this.minZoom + 0.001;
    this._emitViewChanged();
    return { consumed: true };
  }

  handlePointerUp(pointer) {
    if (!isTouchPointer(pointer)) return { consumed: false, endedGesture: false };
    this._touches.delete(pointer.id);
    this.pruneInactiveTouches(pointer);
    if (!this._gestureActive) return { consumed: false, endedGesture: false };

    if (this._touches.size < 2) {
      const shouldReset = this._pinchOutResetRequested;
      this._endGesture();
      if (shouldReset) this.resetView();
      return { consumed: true, endedGesture: true };
    }
    return { consumed: true, endedGesture: false };
  }

  _defaultScrollForZoom(zoom) {
    const bounds = this.getBounds();
    const cam = this.camera;
    if (!bounds || !cam) return { x: 0, y: 0 };
    const viewWidth = cam.width / zoom;
    const viewHeight = cam.height / zoom;
    const off = this._zoomOffsets(zoom);
    return {
      x: this._clampAxis(bounds.left, bounds.left, bounds.width, viewWidth) - off.x,
      y: this._clampAxis(bounds.top, bounds.top, bounds.height, viewHeight) - off.y,
    };
  }

  _clampAxis(scroll, mapStart, mapSize, viewSize) {
    if (!Number.isFinite(mapSize) || mapSize <= 0) return 0;
    if (viewSize >= mapSize) {
      return mapStart + (mapSize - viewSize) / 2;
    }
    const min = mapStart;
    const max = mapStart + mapSize - viewSize;
    return clamp(scroll, min, max);
  }

  _beginGesture() {
    const points = [...this._touches.values()];
    const a = points[0];
    const b = points[1];
    this._gestureStartDistance = distance(a, b);
    this._gestureStartZoom = this.getZoom();
    const mid = midpoint(a, b);
    const world = this.screenToWorld(mid.x, mid.y) || { x: 0, y: 0 };
    this._gestureAnchorWorld = world;
    this._gestureActive = true;
    this._pinchOutResetRequested = false;
  }

  _endGesture() {
    this._gestureActive = false;
    this._gestureStartDistance = 0;
    this._pinchOutResetRequested = false;
  }

  _emitViewChanged() {
    if (!this.onViewChanged) return;
    this.onViewChanged(this.getZoom());
  }
}
