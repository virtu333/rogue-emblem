import { battleSession, isCurrentBattleSession } from './BattleSession.js';
// ZombieRemainsController — the battle side of a fallen Zombie's remains
// (rules: engine/ZombieRemains.js; drawing: RemainsMarkerController).
//
//   onEnemyFell   at an enemy's death (BattleScene.removeUnit): leave remains
//   noteSeen      after each fog update (BattleScene.updateEnemyVisibility)
//   processRevival  at each enemy-phase start: tick, rise, drop
//   Smash         a unit's action: SELECTING_REMAINS_TARGET, the Break verb's tile
//                 flow. Always succeeds: no hit roll, no counter, no forecast, no RNG
//                 draw, no XP, and it ends the action (no Canto).
//
// State lives on the scene (`scene._zombieTombstones`, the name saves and Vision
// snapshots already carry); this controller keeps only the current target list.
// BattleScene owns one instance (create / sync from update / destroy).

import {
  buildRisenUnit,
  createRemains,
  knownRemainsTiles,
  leavesRemains,
  noteRemainsSeen,
  remainsInReach,
  remainsInfoLine,
  riseTile,
  smashRemains,
  tickRemains,
} from '../engine/ZombieRemains.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { isUnitSeenAt } from '../engine/BattleInformation.js';
import { RemainsMarkerController } from './RemainsMarkerController.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

export const SMASH_TARGET_STATE = 'SELECTING_REMAINS_TARGET';

export class ZombieRemainsController {
  constructor(scene) {
    this.scene = scene;
    this.session = battleSession(scene);
    this.targets = [];
    this.markers = new RemainsMarkerController(scene);
  }

  create() {
    this.markers.create();
    return this;
  }

  /** Per frame: markers follow the records and the fog. */
  sync() {
    this.markers.sync();
  }

  destroy() {
    this.markers.destroy();
    this.targets = [];
    this.scene = null;
  }

  get records() {
    return this.scene?._zombieTombstones || [];
  }

  /** The ground's sight (remains are a record on a tile, not a unit). */
  isVisible(col, row) {
    const grid = this.scene?.grid;
    return typeof grid?.isVisible === 'function' ? Boolean(grid.isVisible(col, row)) : true;
  }

  /**
   * An enemy fell on `tile` (killer: null for poison, lava, a death burst…). Its remains are known
   * when the player saw it fall (isUnitSeenAt: under Seer's Eye every foe's fall is seen, so a
   * pile in the fog keeps its marker and countdown).
   */
  onEnemyFell(unit, killer, tile) {
    if (!leavesRemains(unit, killer)) return null;
    const seen = isUnitSeenAt(this.scene?.grid, unit, tile.col, tile.row);
    const record = createRemains(unit, tile, { seen });
    this.scene._zombieTombstones = [...this.records, record];
    return record;
  }

  /** Remains on tiles the player sees now become known (they stay known in fog). */
  noteSeen() {
    const scene = this.scene;
    if (!scene?._zombieTombstones?.length) return;
    scene._zombieTombstones = noteRemainsSeen(scene._zombieTombstones, (c, r) =>
      this.isVisible(c, r),
    );
  }

  /** Remains the player knows of, one entry per tile. */
  knownTiles() {
    return knownRemainsTiles(this.records, (c, r) => this.isVisible(c, r));
  }

  /** Tile-inspect line ("Zombie remains · rises in 2 enemy phases"), or null. */
  infoLine(col, row) {
    return remainsInfoLine(this.records, col, row, (c, r) => this.isVisible(c, r));
  }

  /** Remains `unit` can Smash from its tile (known, visible, open, in weapon reach). */
  findTargets(unit) {
    const scene = this.scene;
    if (!unit || unit.faction !== 'player') return [];
    return remainsInReach(unit, this.records, {
      skillsData: scene.gameData?.skills || null,
      isVisible: (c, r) => this.isVisible(c, r),
      isOccupied: (c, r) => Boolean(scene.getUnitAt?.(c, r)),
    });
  }

  // ── Smash ─────────────────────────────────────────────────────

  begin(unit) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.battleState = SMASH_TARGET_STATE;
    this.targets = this.findTargets(unit);
    scene.grid.showAttackRange(
      this.targets.map((t) => ({ col: t.col, row: t.row })),
      UI_HEX.warn,
      0.45,
    );
    scene.refreshEndTurnControl?.();
  }

  /** A tap / click / cursor confirm on (col, row) while choosing remains. */
  handleClick(gp) {
    const target = this.targets.find((t) => t.col === gp?.col && t.row === gp?.row);
    if (!target) return false;
    this.scene.grid.clearAttackHighlights();
    this.execute(this.scene.selectedUnit, target);
    return true;
  }

  /** Back out of target selection (the caller reopens the unit's menu). */
  cancel() {
    this.scene?.grid?.clearAttackHighlights?.();
    this.targets = [];
  }

  execute(unit, target) {
    const scene = this.scene;
    const session = battleSession(scene);
    this.targets = [];
    scene.hideActionMenu();
    const { list, smashed } = smashRemains(this.records, target);
    if (!unit || !smashed) {
      if (unit) scene.showActionMenu(unit);
      return false;
    }
    scene.commitVisionSnapshotIfPending?.();
    scene._zombieTombstones = list;
    scene.registry?.get?.('audio')?.playSFX?.('sfx_hit');
    observeHistoryAction(
      scene,
      'smashed remains',
      unit,
      null,
      `column ${target.col + 1}, row ${target.row + 1}`,
    );
    const pos = scene.grid.gridToPixel(target.col, target.row);
    scene.showMinorHintAt?.(pos.x, pos.y, 'Smashed!', UI_PALETTE.accentText);
    this.markers.sync();
    scene.updateObjectiveText?.();
    // The last remains of a Rout: the battle is won here (as a killing blow is).
    if (scene.checkBattleEnd?.()) return true;
    scene.finishUnitAction(unit, { skipCanto: true, session: session });
    return true;
  }

  // ── Enemy phase ───────────────────────────────────────────────

  /**
   * Enemy-phase start (after turn-start effects, before the AI): every record ticks;
   * those at 0 rise on their tile or an open neighbour, or are dropped.
   */
  async processRevival() {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    if (!isCurrentBattleSession(scene, session)) return;
    if (!scene?._zombieTombstones?.length) return;
    const { kept, rising } = tickRemains(scene._zombieTombstones);
    scene._zombieTombstones = kept;
    const cols = scene.battleConfig?.cols ?? scene.grid?.cols ?? 0;
    const rows = scene.battleConfig?.rows ?? scene.grid?.rows ?? 0;
    for (const record of rising) {
      const tile = riseTile(record, {
        cols,
        rows,
        isOccupied: (c, r) => Boolean(scene.getUnitAt(c, r)),
        moveCostAt: (c, r, moveType) => scene.grid.getTerrainAt(c, r)?.moveCost?.[moveType],
      });
      if (!tile) continue; // no room to rise: the remains crumble
      const unit = buildRisenUnit(record, tile);
      scene.enemyUnits.push(unit);
      scene.addUnitGraphic(unit);
      if (scene.grid?.fogEnabled) scene.updateEnemyVisibility?.();
      observeHistoryAction(scene, 'revived', unit);
      // Seen rising only where the player sees it stand (isUnitSeenAt: Seer's Eye shows it).
      if (isUnitSeenAt(scene.grid, unit))
        await scene.showBriefBanner(`${unit.className} has risen!`, UI_PALETTE.rarityEpic);
      if (!isCurrentBattleSession(scene, session)) return;
    }
    this.markers.sync();
    scene.updateObjectiveText?.();
    if (rising.length > 0) scene.checkBattleEnd();
  }
}
