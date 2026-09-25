// ReinforcementPresenter — how enemy reinforcements arrive on screen
// (docs/art-direction/growth/README.md, mechanics audit).
//
// A crimson thread band over the map (CeremonyController.showArrival) says
// how many arrived; each arrival the player can SEE gets a crimson thread
// dropping onto its tile and a ring snapping outward — the empire's drills,
// threads that are not ours. Fogged arrivals are never marked (the band
// counts them, the map does not leak where). Presentation only: no RNG, no
// game state; the canvas fallback is the scene's old banner.
import { UI_HEX } from '../utils/uiStyles.js';
import { hasDOMHost } from '../utils/domUI.js';
import { VILLAGE_STATUS } from '../engine/VillageSystem.js';

const RING_DEPTH = 6; // above tile highlights (5), under units and HP bars

export class ReinforcementPresenter {
  constructor(scene) {
    this.scene = scene;
    this._objects = new Set();
    this._onShutdown = () => this.destroy();
    scene?.events?.once?.('shutdown', this._onShutdown);
  }

  /**
   * @param {object[]} units   enemies spawned this turn
   * @param {{bandits?: number}} [options] how many of them race the village
   */
  present(units = [], { bandits = 0 } = {}) {
    const scene = this.scene;
    if (!scene || this.destroyed) return;
    const arrivals = (units || []).filter(Boolean);
    if (!arrivals.length) return;
    const villageIntact = scene._villageState?.status === VILLAGE_STATUS.INTACT;
    const raceCount = villageIntact ? Math.max(0, Math.min(bandits, arrivals.length)) : 0;
    const band = hasDOMHost()
      ? scene._getCeremonies?.()?.showArrival({
          count: arrivals.length - raceCount,
          bandits: raceCount,
        })
      : null;
    if (!band) {
      scene.showReinforcementBanner?.(arrivals.length - bandits);
      if (bandits > 0) scene._villageController?.showBanditArrivalBanner?.();
    }
    for (const unit of arrivals) this._mark(unit);
  }

  _mark(unit) {
    const scene = this.scene;
    if (!unit?.graphic || unit.graphic.visible === false) return; // fogged: never leak
    if (typeof scene.add?.graphics !== 'function' || !scene.grid?.gridToPixel) return;
    const { x, y } = scene.grid.gridToPixel(unit.col, unit.row);
    const still = Boolean(scene._reduceMotion?.());
    // The thread: a crimson line dropping onto the tile.
    const thread = scene.add.graphics().setDepth(RING_DEPTH + 1);
    thread.lineStyle(2, UI_HEX.dangerLine, 0.95);
    thread.lineBetween(0, -64, 0, 0);
    thread.lineStyle(1, UI_HEX.bad, 0.9);
    thread.lineBetween(0, -64, 0, 0);
    thread.setPosition(x, y);
    // The ring: a tile diamond that snaps outward and fades.
    const ring = scene.add.graphics().setDepth(RING_DEPTH);
    ring.lineStyle(2, UI_HEX.bad, 1);
    ring.strokePoints(
      [
        { x: 0, y: -12 },
        { x: 14, y: 0 },
        { x: 0, y: 12 },
        { x: -14, y: 0 },
      ],
      true,
    );
    ring.setPosition(x, y);
    this._objects.add(thread);
    this._objects.add(ring);
    const drop = (obj) => {
      this._objects.delete(obj);
      obj.destroy();
    };
    if (still || typeof scene.tweens?.add !== 'function') {
      scene.time?.delayedCall?.(900, () => {
        drop(thread);
        drop(ring);
      });
      return;
    }
    thread.setScale(1, 0);
    scene.tweens.add({
      targets: thread,
      scaleY: 1,
      duration: 260,
      ease: 'Cubic.easeIn',
      onComplete: () =>
        scene.tweens.add({
          targets: thread,
          alpha: 0,
          duration: 420,
          onComplete: () => drop(thread),
        }),
    });
    ring.setAlpha(0);
    scene.tweens.add({
      targets: ring,
      alpha: { from: 1, to: 0 },
      scale: { from: 0.6, to: 1.9 },
      delay: 240,
      duration: 700,
      ease: 'Cubic.easeOut',
      // Outlasts the band, so arrivals under it are still marked after it leaves.
      repeat: 2,
      onComplete: () => drop(ring),
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    for (const obj of this._objects) obj.destroy?.();
    this._objects.clear();
    if (this.scene?._reinforcements === this) this.scene._reinforcements = null;
    this.scene = null;
  }
}
