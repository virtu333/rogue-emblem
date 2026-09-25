/**
 * FxMotePool — pooled pixel motes (embers, gilt light, crimson drain, verdigris heal,
 * unlight ink) for combat presentation.
 *
 * One fixed set of Image objects on the FX atlas, created lazily up to `capacity` and
 * reused; a mote is a record rewritten in place, so spawning and updating allocate
 * nothing. Motion is a function of normalized life (eased displacement, sway, colour
 * ramp, alpha), driven by one scene 'update' listener that exists only while motes are
 * alive. Times come from the scene clock, so pauses and scene shutdown stop them.
 *
 * Presentation only: callers pass seeded parameters (strikePlan.fxRandom); nothing
 * here reads Math.random or battle state.
 */
import Phaser from 'phaser';
import { lerpColor } from '../art/combatFx/fxPalette.js';

const FRAMES = ['fx_mote/0', 'fx_mote/1', 'fx_mote/2', 'fx_mote/3'];
const TAU = Math.PI * 2;

export class FxMotePool {
  constructor(scene, { capacity = 120, depth = 251, atlas = 'fx_atlas' } = {}) {
    this.scene = scene;
    this.capacity = capacity;
    this.depth = depth;
    this.atlas = atlas;
    this.records = [];
    this.live = 0;
    this.peak = 0;
    this._listening = false;
    this._onUpdate = () => this.update();
  }

  get liveCount() {
    return this.live;
  }

  _available() {
    return Boolean(this.scene?.add?.image && this.scene?.textures?.exists?.(this.atlas));
  }

  _record() {
    for (const r of this.records) if (!r.active) return r;
    if (this.records.length >= this.capacity) return null;
    const image = this.scene.add.image(0, 0, this.atlas, FRAMES[0]);
    image.setVisible(false).setDepth(this.depth).setOrigin(0.5, 0.5);
    const r = {
      image,
      active: false,
      x0: 0,
      y0: 0,
      dx: 0,
      dy: 0,
      curve: 0,
      sway: 0,
      cycles: 0,
      phase: 0,
      born: 0,
      life: 1,
      c0: 0xffffff,
      c1: 0xffffff,
      c2: 0xffffff,
      a0: 1,
      a1: 0,
    };
    this.records.push(r);
    return r;
  }

  /**
   * Spawn one mote. spec: { x, y, dx, dy, curve (0 linear, 1 ease-out, 2 ease-in),
   *   sway, cycles, phase, delayMs, lifeMs, size (0..3), colors [c0, c1, c2],
   *   alpha [a0, a1], blend 'add'|'normal' }
   * Returns false when the pool is full or the atlas is missing (never throws).
   */
  spawn(spec) {
    if (!this._available()) return false;
    const r = this._record();
    if (!r) return false;
    const now = this.scene.time?.now ?? 0;
    r.active = true;
    r.x0 = spec.x;
    r.y0 = spec.y;
    r.dx = spec.dx || 0;
    r.dy = spec.dy || 0;
    r.curve = spec.curve || 0;
    r.sway = spec.sway || 0;
    r.cycles = spec.cycles || 0;
    r.phase = spec.phase || 0;
    r.born = now + Math.max(0, spec.delayMs || 0);
    r.life = Math.max(1, spec.lifeMs || 400);
    const colors = spec.colors || [0xffffff];
    r.c0 = colors[0];
    r.c1 = colors[1] ?? colors[0];
    r.c2 = colors[2] ?? r.c1;
    r.a0 = spec.alpha?.[0] ?? 1;
    r.a1 = spec.alpha?.[1] ?? 0;
    const img = r.image;
    img.setFrame(FRAMES[Math.max(0, Math.min(3, spec.size | 0))]);
    img.setBlendMode(spec.blend === 'normal' ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
    img.setTint(r.c0);
    img.setAlpha(r.a0);
    img.setPosition(r.x0, r.y0);
    img.setVisible(false);
    this.live++;
    if (this.live > this.peak) this.peak = this.live;
    if (!this._listening && this.scene.events?.on) {
      this.scene.events.on('update', this._onUpdate);
      this._listening = true;
    }
    return true;
  }

  update() {
    const now = this.scene?.time?.now ?? 0;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      if (!r.active) continue;
      const u = (now - r.born) / r.life;
      const img = r.image;
      if (u < 0) {
        img.setVisible(false);
        continue;
      }
      if (u >= 1 || !img.scene) {
        this._retire(r);
        continue;
      }
      const e = r.curve === 1 ? 1 - (1 - u) * (1 - u) : r.curve === 2 ? u * u : u;
      const s = r.sway ? Math.sin(r.phase + u * r.cycles * TAU) * r.sway : 0;
      img.setPosition(r.x0 + r.dx * e + s, r.y0 + r.dy * e);
      img.setTint(
        u < 0.3 ? lerpColor(r.c0, r.c1, u / 0.3) : lerpColor(r.c1, r.c2, (u - 0.3) / 0.7),
      );
      img.setAlpha(r.a0 + (r.a1 - r.a0) * u * u);
      img.setVisible(true);
    }
    if (this.live <= 0) this._stopListening();
  }

  _retire(r) {
    if (!r.active) return;
    r.active = false;
    r.image?.setVisible?.(false);
    this.live = Math.max(0, this.live - 1);
  }

  _stopListening() {
    if (this._listening) this.scene?.events?.off?.('update', this._onUpdate);
    this._listening = false;
  }

  /** Hide every mote now (checkpoint restore, rewind); images stay pooled. */
  releaseAll() {
    for (const r of this.records) this._retire(r);
    this.live = 0;
    this._stopListening();
  }

  destroy() {
    this.releaseAll();
    for (const r of this.records) r.image?.destroy?.();
    this.records.length = 0;
  }
}
