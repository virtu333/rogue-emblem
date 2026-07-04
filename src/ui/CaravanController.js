// CaravanController -- Merchant Caravan battle-scene wiring, extracted per the
// BattleScene decomposition rule (never inline multi-step flows). Owns spawn,
// the 1-tile-per-turn greedy movement toward the nearest map edge, exit
// removal, and the escaped/destroyed toast. Pure movement/creation logic
// lives in engine/CaravanSystem.js; this controller is the Phaser-facing shim.

import { createCaravanUnit, computeCaravanStep, isCaravanAtEdge } from '../engine/CaravanSystem.js';
import { showMinorHint } from './HintDisplay.js';

const CARAVAN_RING_COLOR = 0xffcc33;

export class CaravanController {
  constructor(scene) {
    this.scene = scene;
  }

  /** Spawn the caravan NPC from battleConfig.caravanSpawn, if present. Skipped on resume (checkpoint restores it). */
  spawnIfConfigured() {
    const scene = this.scene;
    const spawnTile = scene.battleConfig?.caravanSpawn;
    if (!spawnTile || scene._resumeCheckpoint) return;

    const act = scene.battleParams?.act || 'act1';
    const unit = createCaravanUnit(act, spawnTile);
    scene.npcUnits.push(unit);
    scene.addUnitGraphic(unit);
    this._applyCaravanTint(unit);

    const hints = scene.registry.get('hints');
    if (hints?.shouldShow('battle_caravan')) {
      showMinorHint(
        scene,
        'A merchant caravan is caught in the fighting -- if it survives, it will trade with you.',
      );
    }
  }

  /** Re-tint an already-spawned caravan (e.g. after suspend/resume restore). */
  retintIfPresent() {
    const unit = this._findCaravanUnit();
    if (unit) this._applyCaravanTint(unit);
  }

  _applyCaravanTint(unit) {
    // Distinct gold ring so the caravan doesn't read as a recruit NPC (green).
    if (unit.factionIndicator?.setStrokeStyle) {
      unit.factionIndicator.setStrokeStyle(2, CARAVAN_RING_COLOR, 0.9);
    }
  }

  _findCaravanUnit() {
    const scene = this.scene;
    return (scene.npcUnits || []).find((u) => u.isCaravan && u.currentHP > 0);
  }

  /**
   * Step the caravan 1 tile toward the nearest column edge. Called at the very
   * start of startEnemyPhase, before AI acts, so enemies can react to the new
   * position (per spec). No-op if no live caravan or already exited.
   */
  stepTurn() {
    const scene = this.scene;
    if (scene._caravanExited) return;
    const unit = this._findCaravanUnit();
    if (!unit) return;

    const occupied = new Set();
    for (const u of [...scene.playerUnits, ...scene.enemyUnits, ...scene.npcUnits]) {
      if (u === unit || u.currentHP <= 0) continue;
      occupied.add(`${u.col},${u.row}`);
    }

    const step = computeCaravanStep(
      unit,
      scene.grid.mapLayout,
      scene.grid.cols,
      scene.grid.rows,
      scene.grid.terrainData,
      occupied,
    );
    if (step) {
      unit.col = step.col;
      unit.row = step.row;
      const pos = scene.grid.gridToPixel(unit.col, unit.row);
      if (unit.graphic) {
        unit.graphic.x = pos.x;
        unit.graphic.y = pos.y;
      }
      if (unit.label) {
        unit.label.x = pos.x;
        unit.label.y = pos.y;
      }
      if (unit.factionIndicator) {
        unit.factionIndicator.x = pos.x;
        unit.factionIndicator.y = pos.y + 6;
      }
      if (unit.hpBar) {
        const barY = pos.y - 14;
        if (unit.hpBar.bg) {
          unit.hpBar.bg.x = pos.x;
          unit.hpBar.bg.y = barY;
        }
        if (unit.hpBar.fill) {
          unit.hpBar.fill.y = barY;
        }
        scene.updateHPBar?.(unit);
      }
    }

    if (isCaravanAtEdge(unit, scene.grid.cols)) {
      this._handleExit(unit);
    }
  }

  _handleExit(unit) {
    const scene = this.scene;
    scene._caravanExited = true;
    const idx = scene.npcUnits.indexOf(unit);
    if (idx !== -1) scene.npcUnits.splice(idx, 1);
    scene.removeUnitGraphic?.(unit);
    scene.showBriefBanner?.('Caravan escaped!', '#ffcc33')?.catch?.(() => {});
  }

  /** True if the caravan survived (alive on the field, or already exited). Used by PostCombatController on victory. */
  caravanSurvived() {
    const scene = this.scene;
    if (scene._caravanExited) return true;
    return Boolean(this._findCaravanUnit());
  }

  /** True if this battle ever had a caravan (spawned in config), regardless of outcome. */
  hadCaravan() {
    return Boolean(this.scene.battleConfig?.caravanSpawn);
  }

  destroy() {
    this.scene = null;
  }
}
