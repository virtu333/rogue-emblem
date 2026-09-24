let nextSession = 1;

// A session outlives the viewer/confirmation swap. All mutation here is UI-only.
export class BattleHistorySession {
  constructor(host) {
    this.host = host;
    this.key = `BattleHistory-${nextSession++}`;
    this.wasActive = host.scene?.isActive?.() === true;
    this.generation = 0;
    this.cleanups = [];
    this.wrapper = globalThis.document?.getElementById('game-wrapper');
    this.cameraState = host.cameras?.main
      ? { x: host.cameras.main.scrollX, y: host.cameras.main.scrollY, zoom: host.cameras.main.zoom }
      : null;
    this.wasVisible = host.scene?.isVisible?.() !== false;
    host.scene?.setVisible?.(false);
    this.wrapper?.classList.add('battle-history-active');
    host._mobileBattleHud?.lab?.resize();
    this.shutdown = () => this.destroy({ resume: false });
    host.events?.once('shutdown', this.shutdown);
    // ScenePlugin.pause/resume queue their work until the next game tick.
    // Acquire/release synchronously so closing before that tick cannot strand a pause.
    if (this.wasActive) host.game.scene.pause(host.scene.key);
    this.ready = import('../scenes/BattleHistoryScene.js')
      .then(({ BattleHistoryScene }) => {
        if (this.destroyed) return null;
        return new Promise((resolve) => {
          this.resolveReady = resolve;
          host.game.scene.add(
            this.key,
            new BattleHistoryScene(this.key, (scene) => {
              if (this.destroyed) {
                host.game.scene.remove(this.key);
                resolve(null);
                return;
              }
              this.scene = scene;
              resolve(scene);
            }),
            true,
          );
        });
      })
      .catch(() => null);
  }
  attach(element) {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.element = element;
    const listen = (name, fn) => {
      element.addEventListener(name, fn);
      this.cleanups.push(() => element.removeEventListener(name, fn));
    };
    const touches = new Map();
    let last = null,
      pinch = null,
      dragged = false;
    listen('pointerdown', (e) => {
      e.preventDefault();
      element.setPointerCapture?.(e.pointerId);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY };
      dragged = false;
    });
    listen('pointermove', (e) => {
      if (!touches.has(e.pointerId) || !this.scene) return;
      const old = touches.get(e.pointerId);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        const [a, b] = [...touches.values()],
          d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom(d / pinch);
        pinch = d;
        dragged = true;
      } else {
        const canvas = this.host.game.canvas.getBoundingClientRect();
        const ratio = this.host.scale.width / canvas.width;
        if (Math.hypot(e.clientX - (last?.x ?? old.x), e.clientY - (last?.y ?? old.y)) > 8)
          dragged = true;
        if (dragged) this.pan((old.x - e.clientX) * ratio, (old.y - e.clientY) * ratio);
      }
    });
    const release = (e) => {
      if (!dragged && e.type === 'pointerup') this.inspect(e);
      touches.delete(e.pointerId);
      pinch = null;
      last = [...touches.values()][0] || null;
    };
    listen('pointerup', release);
    listen('pointercancel', release);
    listen('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    });
    this.observer?.disconnect();
    if (globalThis.ResizeObserver) {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(element);
    }
    this.layout();
  }
  layout() {
    if (!this.scene || !this.element || this.destroyed) return;
    const canvas = this.host.game.canvas.getBoundingClientRect(),
      box = this.element.getBoundingClientRect();
    const rx = this.host.scale.width / canvas.width,
      ry = this.host.scale.height / canvas.height;
    const x = Math.max(canvas.left, box.left),
      y = Math.max(canvas.top, box.top);
    const width = Math.max(1, Math.min(canvas.right, box.right) - x),
      height = Math.max(1, Math.min(canvas.bottom, box.bottom) - y);
    this.scene.cameras.main.setViewport(
      (x - canvas.left) * rx,
      (y - canvas.top) * ry,
      width * rx,
      height * ry,
    );
    this.bounds();
  }
  async show(frame, transition, onSettled) {
    const generation = ++this.generation;
    const scene = await this.ready;
    if (this.destroyed || generation !== this.generation) return;
    if (!scene) {
      onSettled(false);
      return;
    }
    scene.scene.setVisible(true);
    this.frame = frame;
    this.layout();
    this.bounds();
    const restoreView = this.returnCamera;
    this.returnCamera = null;
    try {
      scene.renderer.show(frame, transition, () => {
        if (generation !== this.generation || this.destroyed) return;
        if (restoreView)
          scene.cameras.main.setZoom(restoreView.zoom).setScroll(restoreView.x, restoreView.y);
        onSettled(true);
      });
    } catch {
      onSettled(false);
    }
  }
  hide() {
    this.generation++;
    this.scene?.scene.setVisible(false);
    this.scene?.renderer.cancel();
  }
  rememberView(ui = null) {
    this.returnUi = ui;
    const c = this.scene?.cameras.main;
    if (c) this.returnCamera = { x: c.scrollX, y: c.scrollY, zoom: c.zoom };
  }
  bounds() {
    const c = this.scene?.cameras.main;
    if (!c || !this.frame) return;
    const width = this.frame.cols * 32,
      height = this.frame.rows * 32;
    const x = Math.max(0, (c.width / c.zoom - width) / 2),
      y = Math.max(0, (c.height / c.zoom - height) / 2);
    c.setBounds(-x, -y, width + 2 * x, height + 2 * y);
  }
  pan(dx, dy) {
    const c = this.scene?.cameras.main;
    if (c) c.setScroll(c.scrollX + dx / c.zoom, c.scrollY + dy / c.zoom);
  }
  zoom(factor) {
    const c = this.scene?.cameras.main;
    if (c) {
      c.setZoom(Math.max(0.65, Math.min(3, c.zoom * factor)));
      this.bounds();
    }
  }
  focus(beats) {
    if (this.frame) this.scene?.renderer.focus(this.frame, beats);
  }
  inspect(event) {
    if (!this.scene || !this.frame) return;
    const r = this.host.game.canvas.getBoundingClientRect();
    const p = this.scene.cameras.main.getWorldPoint(
      ((event.clientX - r.left) * this.host.scale.width) / r.width,
      ((event.clientY - r.top) * this.host.scale.height) / r.height,
    );
    const u = this.frame.units.find(
      (u) =>
        p.x >= u.col * 32 &&
        p.x < (u.col + u.size) * 32 &&
        p.y >= u.row * 32 &&
        p.y < (u.row + u.size) * 32,
    );
    const col = Math.floor(p.x / 32),
      row = Math.floor(p.y / 32);
    const tile =
      col >= 0 && col < this.frame.cols && row >= 0 && row < this.frame.rows
        ? this.frame.tiles[row * this.frame.cols + col]
        : null;
    this.onInspect?.(
      u
        ? `${u.name} · ${u.className} · ${u.hp}/${u.maxHP} HP · ${u.weapon || 'Unarmed'}${u.conditions.length ? ` · ${u.conditions.join(', ')}` : ''}${u.buffs?.length ? ` · ${u.buffs.join(', ')}` : ''}`
        : tile
          ? `${tile.label}${tile.details?.length ? ` · ${tile.details.join(' · ')}` : ''}`
          : '',
    );
  }
  destroy({ resume = true } = {}) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.resolveReady?.(null);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.observer?.disconnect();
    this.host.events?.off('shutdown', this.shutdown);
    if (this.host.game.scene.keys[this.key]) this.host.game.scene.remove(this.key);
    this.wrapper?.classList.remove('battle-history-active');
    if (resume) {
      this.host._mobileBattleHud?.lab?.resize();
      if (this.cameraState)
        this.host.cameras.main
          .setZoom(this.cameraState.zoom)
          .setScroll(this.cameraState.x, this.cameraState.y);
      this.host.scene?.setVisible?.(this.wasVisible);
    }
    if (resume && this.wasActive && this.host.scene?.isPaused?.())
      this.host.game.scene.resume(this.host.scene.key);
  }
}
