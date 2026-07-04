// VillageController — Village & bandit secondary objective battle-scene
// wiring, extracted per the BattleScene decomposition rule (never inline
// multi-step flows). Owns the village marker, the visit reward flow (gold into
// scene.goldEarned + one convoy item, never XP), the bandit raze, and the
// banners/hints. Pure state-machine/reward logic lives in
// engine/VillageSystem.js; this controller is the Phaser-facing shim
// (mirrors CaravanController).
//
// State stays on BattleScene (scene._villageState — persisted by
// BattleSuspendController); the controller owns only its Phaser objects.

import {
  createVillageState,
  visitVillage,
  razeVillage,
  clearSeekTileBandits,
  getVillageGoldReward,
  rollVillageRewardItem,
  VILLAGE_STATUS,
} from '../engine/VillageSystem.js';
import { TERRAIN, TILE_SIZE } from '../utils/constants.js';
import { showMinorHint } from './HintDisplay.js';

export class VillageController {
  constructor(scene) {
    this.scene = scene;
    this.markers = [];
  }

  /**
   * Initialize village state from battleConfig.villageTile. Fresh battles get
   * a new intact state; on resume the suspend checkpoint has already restored
   * scene._villageState, so only re-render (and re-apply resolved terrain —
   * the locked map still carries the Village tile).
   */
  create() {
    const scene = this.scene;
    const tile = scene.battleConfig?.villageTile;
    if (!tile) return;

    if (scene._resumeCheckpoint) {
      if (!scene._villageState) scene._villageState = createVillageState(tile);
      if (scene._villageState.status !== VILLAGE_STATUS.INTACT) {
        // Resolved before the suspend: keep the tile mundane on resume.
        scene.grid?.setTerrainAt?.(tile.col, tile.row, TERRAIN.Plain);
        return;
      }
      this._renderMarker();
      return;
    }

    scene._villageState = createVillageState(tile);
    this._renderMarker();

    const hints = scene.registry?.get?.('hints');
    if (hints?.shouldShow('battle_village')) {
      showMinorHint(
        scene,
        "A village lies on this map. End a unit's action on it for gold and supplies -- before bandits raze it.",
      );
    }
  }

  hadVillage() {
    return Boolean(this.scene?.battleConfig?.villageTile);
  }

  /** Objective subtext while the village is still worth racing for. */
  getObjectiveSuffix() {
    if (this.scene?._villageState?.status === VILLAGE_STATUS.INTACT) {
      return 'Village: Visit before bandits!';
    }
    return null;
  }

  /**
   * Post-action hook (called from finishUnitAction, once the action is final):
   * a player unit that ends its action on the intact village tile visits it.
   * Reward is granted immediately — before the suspend checkpoint captures —
   * so a refresh can never undo or double it.
   * @returns {boolean} true when a visit resolved
   */
  handleUnitActionEnd(unit) {
    const scene = this.scene;
    const state = scene?._villageState;
    if (!state || state.status !== VILLAGE_STATUS.INTACT) return false;
    if (!unit || unit.faction !== 'player' || unit.currentHP <= 0) return false;
    if (unit.col !== state.col || unit.row !== state.row) return false;
    if (!visitVillage(state)) return false;

    this._resolveTile(state);

    const act = scene.battleParams?.act || 'act1';
    const gold = getVillageGoldReward(act);
    scene.goldEarned = (scene.goldEarned || 0) + gold;

    let grantedItemName = null;
    const item = rollVillageRewardItem(
      act,
      scene.gameData?.lootTables,
      scene.gameData?.consumables,
    );
    if (item && scene.runManager?.addToConvoy?.(item)) {
      grantedItemName = item.name;
    }

    this._showFloat(unit, `+${gold}g`);
    const message = grantedItemName
      ? `Village saved! +${gold}g, ${grantedItemName} sent to convoy`
      : `Village saved! +${gold}g`;
    scene.showBriefBanner?.(message, '#a6ffb0')?.catch?.(() => {});

    clearSeekTileBandits(scene.enemyUnits);
    scene.updateObjectiveText?.();
    return true;
  }

  /**
   * Enemy post-action hook (called from the enemy-phase onUnitDone callback):
   * a seek_tile bandit that ends its move on the intact village tile razes it.
   * Only bandits raze — a regular chase enemy incidentally parking on the tile
   * does nothing.
   * @returns {boolean} true when a raze resolved
   */
  handleEnemyUnitDone(enemy) {
    const scene = this.scene;
    const state = scene?._villageState;
    if (!state || state.status !== VILLAGE_STATUS.INTACT) return false;
    if (!enemy || enemy.currentHP <= 0 || enemy.aiMode !== 'seek_tile') return false;
    if (enemy.col !== state.col || enemy.row !== state.row) return false;
    if (!razeVillage(state)) return false;

    this._resolveTile(state);
    clearSeekTileBandits(scene.enemyUnits);
    scene.showBriefBanner?.('Village razed!', '#ff8888')?.catch?.(() => {});
    scene.updateObjectiveText?.();
    return true;
  }

  /**
   * A seek_tile spawn arriving after the village already resolved (visited or
   * razed before its wave landed) has nothing to race for — revert it to the
   * default chase AI immediately so it can never park on a mundane tile.
   */
  sanitizeSpawnedEnemy(enemy) {
    if (!enemy || enemy.aiMode !== 'seek_tile') return;
    const state = this.scene?._villageState;
    if (!state || state.status !== VILLAGE_STATUS.INTACT) {
      enemy.aiMode = 'chase';
      delete enemy.aiTargetTile;
    }
  }

  /**
   * Called when reinforcement application spawned seek_tile bandits this turn:
   * telegraph the race instead of the generic reinforcement banner.
   */
  showBanditArrivalBanner() {
    const scene = this.scene;
    if (scene?._villageState?.status !== VILLAGE_STATUS.INTACT) return;
    scene.showBriefBanner?.('Bandits! They head for the village!', '#ff8888')?.catch?.(() => {});
  }

  /** Convert the tile to Plain (visited/razed must not re-trigger) and clear the marker. */
  _resolveTile(state) {
    this.scene?.grid?.setTerrainAt?.(state.col, state.row, TERRAIN.Plain);
    this._destroyMarkers();
  }

  _renderMarker() {
    const scene = this.scene;
    const state = scene?._villageState;
    if (!state || !scene.grid || !scene.add) return;
    try {
      const pos = scene.grid.gridToPixel(state.col, state.row);
      const highlight = scene.add
        .rectangle(pos.x, pos.y, TILE_SIZE - 2, TILE_SIZE - 2, 0xffd966, 0.28)
        .setDepth(5);
      const label = scene.add
        .text(pos.x, pos.y - 10, 'VILLAGE', {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#ffe9a6',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(5);
      this.markers.push(highlight, label);
      if (!scene._isReducedEffects?.()) {
        scene.tweens?.add?.({
          targets: highlight,
          alpha: 0.08,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } catch (_) {
      /* cosmetic only */
    }
  }

  _showFloat(unit, message) {
    const scene = this.scene;
    try {
      const pos = scene.grid.gridToPixel(unit.col, unit.row);
      const txt = scene.add
        .text(pos.x, pos.y - 16, message, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffd966',
          fontStyle: 'bold',
          backgroundColor: '#00000088',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(320);
      if (scene._isReducedEffects?.()) {
        scene.time.delayedCall(700, () => txt.destroy());
      } else {
        scene.tweens.add({
          targets: txt,
          y: pos.y - 36,
          alpha: 0,
          duration: 1100,
          onComplete: () => txt.destroy(),
        });
      }
    } catch (_) {
      /* cosmetic only */
    }
  }

  _destroyMarkers() {
    for (const obj of this.markers) {
      try {
        this.scene?.tweens?.killTweensOf?.(obj);
        obj.destroy();
      } catch (_) {
        /* already destroyed */
      }
    }
    this.markers = [];
  }

  destroy() {
    this._destroyMarkers();
    this.scene = null;
  }
}
