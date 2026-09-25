import { canInspectUnit } from '../engine/BattleInformation.js';
import { DangerZoneOverlay } from './DangerZoneOverlay.js';

// Presentation-only references: never serialized or consulted by enemy AI.
export class PinnedThreatController {
  constructor(scene) {
    this.scene = scene;
    this.enemies = new Set();
    this.overlay = new DangerZoneOverlay(scene, scene.grid, {
      color: 0xd8342c,
      depth: 4.5,
      variant: 'pinned',
    });
    this.dirty = false;
  }

  eligible(unit) {
    return (
      unit?.currentHP > 0 &&
      this.scene.enemyUnits?.includes(unit) &&
      canInspectUnit(this.scene.grid, unit)
    );
  }

  toggle(unit) {
    if (!this.eligible(unit)) return false;
    if (this.enemies.has(unit)) this.enemies.delete(unit);
    else {
      if (this.enemies.size >= 5) this.enemies.delete(this.enemies.values().next().value);
      this.enemies.add(unit);
    }
    this.invalidate();
    this.refresh();
    return true;
  }

  invalidate() {
    this.dirty = true;
  }

  refresh() {
    // Fog and death must remove information immediately, even with global danger off.
    for (const unit of this.enemies) {
      if (!this.eligible(unit)) {
        this.enemies.delete(unit);
        this.dirty = true;
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    const tiles = new Map();
    for (const unit of this.enemies) {
      for (const tile of this.scene.calculateDangerZone(unit)) {
        const key = `${tile.col},${tile.row}`;
        const previous = tiles.get(key);
        tiles.set(key, {
          ...tile,
          count: (previous?.count || 0) + tile.count,
          damageThreat: previous?.damageThreat || tile.damageThreat,
          statusThreat: previous?.statusThreat || tile.statusThreat,
        });
      }
    }
    if (tiles.size) this.overlay.show([...tiles.values()]);
    else this.overlay.hide();
  }

  destroy() {
    this.enemies.clear();
    this.overlay.destroy();
  }
}
