// A stand-in for Phaser's scene.add that keeps every object it makes (position, size, visibility,
// whether destroyed), so a test can ask what the player would see. `failNext(n)` makes the nth
// creation call from now throw once (the renderer losing a texture or its context mid-draw).

class Drawn {
  constructor(kind, args) {
    const [x = 0, y = 0, width = 0, height = 0, fill = null] = args;
    Object.assign(this, { kind, x, y, width, height, fill, visible: true, destroyed: false });
    this.depth = 0;
    this.text = kind === 'text' ? args[2] : null;
  }
  setPosition(x, y) {
    Object.assign(this, { x, y });
    return this;
  }
  setSize(width, height) {
    Object.assign(this, { width, height });
    return this;
  }
  setDisplaySize(width, height) {
    return this.setSize(width, height);
  }
  setVisible(visible) {
    this.visible = visible;
    return this;
  }
  setDepth(depth) {
    this.depth = depth;
    return this;
  }
  setFillStyle(fill) {
    this.fill = fill;
    return this;
  }
  setAlpha(alpha) {
    this.alpha = alpha;
    return this;
  }
  setOrigin() {
    return this;
  }
  setStrokeStyle() {
    return this;
  }
  setAngle() {
    return this;
  }
  setScale() {
    return this;
  }
  setResolution() {
    return this;
  }
  clearTint() {
    return this;
  }
  setTint() {
    return this;
  }
  destroy() {
    this.destroyed = true;
  }
}

export function liveRenderer(scene) {
  const made = [];
  let failIn = 0;
  let failAlways = false;
  const create =
    (kind) =>
    (...args) => {
      if (failAlways || (failIn > 0 && --failIn === 0))
        throw new Error(`Renderer unavailable: add.${kind}`);
      const object = new Drawn(kind, args);
      made.push(object);
      return object;
    };
  scene.add = Object.fromEntries(
    ['rectangle', 'text', 'image', 'ellipse', 'circle', 'graphics', 'container', 'sprite'].map(
      (kind) => [kind, create(kind)],
    ),
  );
  return {
    made,
    live: () => made.filter((object) => !object.destroyed),
    /** Fail the nth creation call from now (once); 0 disarms. */
    failNext(n) {
      failIn = n;
    },
    /** Fail every creation call from now on (`false` heals the renderer). */
    failAll(on = true) {
      failAlways = on;
      failIn = 0;
    },
  };
}
