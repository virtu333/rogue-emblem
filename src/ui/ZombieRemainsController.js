import { battleSession, isCurrentBattleSession } from './BattleSession.js';
// ZombieRemainsController — the battle side of a fallen Zombie's remains
// (rules: engine/ZombieRemains.js; drawing: RemainsMarkerController).
//
//   onEnemyFell   at an enemy's death (BattleScene.removeUnit): leave remains
//   noteSeen      after each fog update (BattleScene.updateEnemyVisibility)
//   processRevival  at each enemy-phase start: tick, rise, drop
//   Smash         a unit's action: SELECTING_REMAINS_TARGET, a target choice like a
//                 staff's (the lit piles on the board, and on the phone rail a row per
//                 pile: `targetRows`). Always succeeds: no hit roll, no counter, no
//                 forecast, no RNG draw, no XP. It is not a fight, so a unit with Canto
//                 (or Measured Step) moves on after it; it settles through
//                 settleAndPresent, so the checkpoint holds the smash before Canto opens
//                 and a resume offers the Canto again.
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
  riseText,
  riseTile,
  smashRemains,
  tickRemains,
} from '../engine/ZombieRemains.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { registerBattleEntity } from '../engine/BattleEntityIdentity.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { drawArrivalGraphic } from './arrivalGraphic.js';
import { settleAndPresent } from './BattleActionSettlement.js';
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

  /**
   * The rail's rows while choosing remains, one per lit pile: the pile ("Zombie remains",
   * "2 Zombie remains", "(underfoot)" for the pile under the smasher) and when it rises.
   */
  targetRows(unit = this.scene?.selectedUnit) {
    const known = this.knownTiles();
    return this.targets.map((target) => {
      const records = this.records.filter((r) => r.col === target.col && r.row === target.row);
      const names = new Set(records.map((r) => r.snapshot?.className).filter(Boolean));
      const kind = names.size === 1 ? [...names][0] : 'Undead';
      const count = known.find((t) => t.col === target.col && t.row === target.row)?.count || 1;
      const under = unit && unit.col === target.col && unit.row === target.row;
      return {
        target,
        label: `${count > 1 ? `${count} ` : ''}${kind} remains${under ? ' (underfoot)' : ''}`,
        // Several on one tile rise one by one: say the first (as remainsInfoLine does).
        detail: `${count > 1 ? 'first ' : ''}${riseText(target.turnsRemaining)}`,
      };
    });
  }

  /** A tap / click / cursor confirm on (col, row) while choosing remains. */
  handleClick(gp) {
    const target = this.targets.find((t) => t.col === gp?.col && t.row === gp?.row);
    if (!target) return false;
    this.scene.grid.clearAttackHighlights();
    this.execute(this.scene.selectedUnit, target);
    return true;
  }

  /** A row on the rail: the same smash as a tap on its pile. */
  choose(target) {
    const scene = this.scene;
    if (scene?.battleState !== SMASH_TARGET_STATE || !this.targets.includes(target)) return false;
    return this.handleClick(target);
  }

  /** Back out of target selection (the caller reopens the unit's menu). */
  cancel() {
    this.scene?.grid?.clearAttackHighlights?.();
    this.targets = [];
  }

  /**
   * Smash the pile on `target`. The records go and the checkpoint is saved before
   * anything is drawn (settleAndPresent); then the action ends as a staff's does,
   * Canto included, unless the last remains of a Rout won the battle.
   */
  execute(unit, target) {
    const scene = this.scene;
    const session = battleSession(scene);
    this.targets = [];
    scene.hideActionMenu();
    if (!unit) return false;
    return settleAndPresent(scene, {
      session,
      unit,
      label: 'smash',
      endsBattle: true,
      validate: () =>
        (scene.playerUnits || []).includes(unit) &&
        unit.currentHP > 0 &&
        smashRemains(this.records, target).smashed !== null,
      settle: () => {
        scene._zombieTombstones = smashRemains(this.records, target).list;
        observeHistoryAction(
          scene,
          'smashed remains',
          unit,
          null,
          `column ${target.col + 1}, row ${target.row + 1}`,
        );
        return { target };
      },
      present: () => {
        scene.registry?.get?.('audio')?.playSFX?.('sfx_hit');
        const pos = scene.grid.gridToPixel(target.col, target.row);
        scene.showMinorHintAt?.(pos.x, pos.y, 'Smashed!', UI_PALETTE.accentText);
        this.markers.sync();
        scene.updateObjectiveText?.();
      },
    });
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
      // The rise is state, whole, before anything is drawn (as the harness raises it): on
      // the roster with its battle entity id and its history beat. The records due this phase
      // are already ticked out, so a sprite or banner that throws must never stop the rest.
      scene.enemyUnits.push(unit);
      registerBattleEntity(scene, unit);
      observeHistoryAction(scene, 'revived', unit);
      drawArrivalGraphic(scene, unit, 'risen unit graphic');
      if (scene.grid?.fogEnabled)
        safeBattlePresentation('rise fog visibility', () => scene.updateEnemyVisibility?.(), {
          scene,
        });
      // Seen rising only where the player sees it stand (isUnitSeenAt: Seer's Eye shows it).
      if (isUnitSeenAt(scene.grid, unit))
        await safeBattlePresentation(
          'rise banner',
          () => scene.showBriefBanner(`${unit.className} has risen!`, UI_PALETTE.rarityEpic),
          { scene },
        );
      if (!isCurrentBattleSession(scene, session)) return;
    }
    safeBattlePresentation('remains markers', () => this.markers.sync(), { scene });
    safeBattlePresentation('rise objective', () => scene.updateObjectiveText?.(), { scene });
    if (rising.length > 0) scene.checkBattleEnd();
  }
}
