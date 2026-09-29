// Formation: before turn 1 the deployed army waits off the map and the player
// chooses who stands on which spawn tile (engine rules: engine/FormationPlacement.js).
//
// Lifecycle (BattleScene.beginBattle): battle setup runs exactly as before, with the
// units on their default tiles, so every system that reads them at setup still
// works. Then `lift()` takes the army off the field (out of scene.playerUnits,
// graphics hidden) and marks the spawn tiles; the boss card and pre-battle lines
// play over the empty formation; `run()` hands control to the player and resolves
// on Start, when `commit()` puts every unit on its chosen tile. Nothing is saved
// before turn 1 (the first suspend checkpoint is taken at the first player phase),
// so leaving mid-placement simply returns to the route map.
import {
  autoFill,
  clearAll,
  clearTile,
  createFormation,
  createStandingRules,
  formationActive,
  formationCushion,
  formationRng,
  isComplete,
  pickFormationSpares,
  placeUnit,
  placedCount,
  playerSpawnBounds,
  unitOnTile,
} from '../engine/FormationPlacement.js';
import { FormationPicker } from './FormationPicker.js';
import { FormationDock, renderFormationPanel } from './FormationPanel.js';
import { MenuSurface, button as menuButton } from './MenuSurface.js';
import {
  transitionToSceneWithBlockedRetry,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../utils/SceneRouter.js';
import { unitReach } from '../engine/ThreatForecast.js';
import { isRooted } from '../engine/StatusConditionSystem.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { ATTACK_RANGE_ALPHA, ATTACK_RANGE_COLOR, TILE_SIZE } from '../utils/constants.js';
import './formation.css';

export const FORMATION_STATE = 'DEPLOY_POSITIONING';

function findTemplate(mapTemplates, id) {
  for (const list of Object.values(mapTemplates || {}))
    if (Array.isArray(list)) {
      const found = list.find((t) => t?.id === id);
      if (found) return found;
    }
  return null;
}

/**
 * Dev routes (`?devScene=` / `?qaStep=`) skip placement unless `formation=1`, so
 * presets and browser specs that expect turn 1 keep starting there.
 */
export function formationDevBypass(search = globalThis.location?.search || '') {
  if (!import.meta.env?.DEV) return false;
  const params = new URLSearchParams(search);
  if (params.get('formation') === '1') return false;
  return params.has('devScene') || params.has('qaStep');
}

export class FormationController {
  static shouldRun(scene) {
    return formationActive({
      deployCount: scene.playerUnits?.length || 0,
      tutorialMode: Boolean(scene.battleParams?.tutorialMode),
      resuming: Boolean(scene._resumeCheckpoint),
      disabled:
        // Placement is a screen: headless scenes (no document) keep default tiles.
        typeof document === 'undefined' ||
        !scene.battleConfig?.playerSpawns?.length ||
        (scene.playerUnits || []).some((u) => u?.isEntity) ||
        formationDevBypass(),
    });
  }

  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.ready = false;
    this.version = 0;
    this.selectedTile = null;
    this.heldUnit = null;
    this.markers = [];
    this.picker = null;
  }

  // --- Setup -------------------------------------------------------------------

  /** Take the army off the field and mark the formation tiles. */
  lift() {
    try {
      this._lift();
    } catch (err) {
      // Placement is optional: any failure keeps the default formation.
      console.warn('[Formation] placement unavailable, using default tiles:', err);
      this.abort();
    }
  }

  /** Put the army back on its default tiles and leave placement. */
  abort() {
    const s = this.scene;
    const units = this.units || [];
    this.clearMarkers();
    this.picker?.destroy();
    this.picker = null;
    this.menu?.destroy();
    this.menu = null;
    this.dock?.destroy();
    this.dock = null;
    if (units.length) {
      for (const [i, unit] of units.entries()) {
        const tile = this.defaultTiles?.[i];
        if (tile) {
          unit.col = tile.col;
          unit.row = tile.row;
        }
      }
      s.playerUnits.length = 0;
      s.playerUnits.push(...units);
      for (const unit of units) {
        this.setUnitShown(unit, true);
        if (unit.graphic) s.updateUnitPosition?.(unit);
      }
    }
    this.active = false;
    this.ready = false;
    this.heldUnit = null;
    this.selectedTile = null;
    if (s.battleState === FORMATION_STATE) s.battleState = 'PLAYER_IDLE';
    if (s.grid?.fogEnabled) {
      s.grid.updateFogOfWar(s.playerUnits);
      s.updateEnemyVisibility?.();
    }
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }

  _lift() {
    const s = this.scene;
    const bc = s.battleConfig;
    this.units = [...s.playerUnits];
    this.defaultTiles = this.units.map((u) => ({ col: u.col, row: u.row }));
    const spawns = (bc.playerSpawns || []).map(({ col, row }) => ({ col, row }));
    const spares = this.spareTiles(spawns);
    this.tiles = [...spawns, ...spares];
    this.ctx = {
      mapLayout: s.grid.mapLayout,
      cols: s.grid.cols,
      rows: s.grid.rows,
      terrainData: s.gameData.terrain,
    };
    this.rules = createStandingRules(this.ctx, this.tiles);
    this.formation = createFormation(this.units.length, this.tiles);
    // Units with no strictly suitable tile (rare: generation guarantees foot
    // access only) fall back to any tile they can enter, then to any tile.
    this.leniency = this.units.map((u) => {
      const mt = u.moveType || 'Infantry';
      if (this.tiles.some((_, t) => !this.rules.issue(mt, t))) return 'strict';
      const enterable = this.tiles.some((t) => {
        const idx = this.ctx.mapLayout?.[t.row]?.[t.col];
        return Number.isFinite(Number(this.ctx.terrainData?.[idx]?.moveCost?.[mt]));
      });
      return enterable ? 'enter' : 'any';
    });

    for (const unit of this.units) this.setUnitShown(unit, false);
    s.playerUnits.length = 0; // same array: TurnManager holds this reference
    s.selectedUnit = null;
    this.active = true;
    s.battleState = FORMATION_STATE;
    this.drawMarkers();
    this.refreshFog();
    this.frameCamera();
    this.touch();
  }

  /** Spares from the spawn zone on their own seeded stream (same every visit). */
  spareTiles(spawns) {
    const s = this.scene;
    const bc = s.battleConfig;
    const count = formationCushion(this.units.length);
    const template = findTemplate(s.gameData.mapTemplates, bc.templateId);
    const occupied = [
      ...(s.enemyUnits || []),
      ...(s.npcUnits || []),
      bc.npcSpawn,
      bc.caravanSpawn,
      bc.villageTile,
      bc.thronePos,
      ...(bc.escapeTiles || []),
      ...(bc.ballistas || []),
    ].filter((t) => Number.isInteger(t?.col) && Number.isInteger(t?.row));
    const seed = [
      s.runManager?.runSeed ?? 0,
      s.nodeId ?? s.battleParams?.act ?? 'battle',
      bc.templateId ?? '',
      this.units.length,
      'formation',
    ].join(':');
    return pickFormationSpares({
      ...{ mapLayout: s.grid.mapLayout, cols: s.grid.cols, rows: s.grid.rows },
      terrainData: s.gameData.terrain,
      spawns,
      bounds: playerSpawnBounds(template, s.grid.cols, s.grid.rows),
      blocked: occupied,
      enemies: (s.enemyUnits || []).map((u) => ({ col: u.col, row: u.row })),
      moveTypes: this.units.map((u) => u.moveType || 'Infantry'),
      count,
      rng: formationRng(seed),
    });
  }

  /** Hand control to the player; resolves when they start the battle. */
  run() {
    if (!this.active) return Promise.resolve();
    this.ready = true;
    this.scene.battleState = FORMATION_STATE;
    // Phones place from the battle rail; everything else gets a dock.
    if (!this.scene._mobileBattleHud) this.dock ||= new FormationDock(this);
    this.touch();
    this.scene.refreshEndTurnControl?.();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  // --- Rules the screens ask about ---------------------------------------------

  /** '' when unit u may be placed on tile t, else why not. */
  issue(u, t) {
    const unit = this.units[u];
    const mode = this.leniency[u];
    if (mode === 'any') return '';
    const reason = this.rules.issue(unit.moveType || 'Infantry', t);
    if (!reason) return '';
    if (mode === 'enter' && /boxed in/.test(reason)) return '';
    return reason;
  }

  tileIndexAt(col, row) {
    return this.tiles.findIndex((t) => t.col === col && t.row === row);
  }

  unitIndex(unit) {
    return this.units.indexOf(unit);
  }

  benched() {
    return this.units.filter((_, u) => this.formation.at[u] === null);
  }

  placed() {
    return placedCount(this.formation);
  }

  /** Everyone is placed, each on a tile they may stand on. */
  complete() {
    return isComplete(this.formation) && this.formation.at.every((t, u) => !this.issue(u, t));
  }

  /** Whether placing u on t sends the unit there back to waiting (it can't take u's tile). */
  displaces(u, t) {
    const occupant = unitOnTile(this.formation, t);
    const vacated = this.formation.at[u];
    if (occupant === -1 || occupant === u) return false;
    return vacated === null || Boolean(this.issue(occupant, vacated));
  }

  // --- Player actions ----------------------------------------------------------

  /** Index of the unit in hand, or -1. */
  heldIndex() {
    return this.heldUnit ? this.unitIndex(this.heldUnit) : -1;
  }

  /** The held unit's tile, or null when nothing is held or the held unit is waiting. */
  heldTile() {
    const u = this.heldIndex();
    return u === -1 ? null : this.formation.at[u];
  }

  /**
   * A map tap (or gamepad confirm) during placement. Tap a unit to pick it up, then
   * a tile to move it there or another unit to swap; tap it again for its menu.
   * An empty tile with nothing in hand asks who stands there.
   */
  handleTileTap(gp) {
    if (!this.ready) return;
    const s = this.scene;
    const t = this.tileIndexAt(gp.col, gp.row);
    if (t === -1) {
      if (this.selectedTile !== null) this.selectTile(null);
      // Off the formation: enemies and terrain inspect as on a normal turn, and a
      // unit in hand stays there (check a threat, then set it down).
      s._inputController?.handleIdleClick?.(gp);
      return;
    }
    if (this.heldUnit) {
      const u = this.heldIndex();
      const from = this.formation.at[u];
      if (from === t) {
        this.openUnitMenu(u);
        return;
      }
      const reason = this.issue(u, t);
      if (reason) {
        this.flash(reason);
        return;
      }
      this.heldUnit = null;
      this.moveTo(u, t);
      return;
    }
    const occupant = unitOnTile(this.formation, t);
    if (occupant !== -1) {
      this.holdUnit(this.units[occupant]);
      return;
    }
    this.selectTile(t);
    this.openPicker(t);
  }

  selectTile(t) {
    this.selectedTile = t;
    this.drawMarkers();
    this.touch();
  }

  /**
   * Pick a unit up (a tile tap on a placed unit, or a waiting unit's chip); picking
   * the same unit again lets go. With a placed unit in hand, a waiting unit's chip
   * sends that unit in on its tile and the held unit waits.
   */
  holdUnit(unit) {
    if (!this.ready) return;
    const from = this.heldTile();
    const u = this.unitIndex(unit);
    if (from !== null && this.heldUnit !== unit && this.formation.at[u] === null) {
      const reason = this.issue(u, from);
      if (reason) {
        this.flash(reason);
        return;
      }
      this.heldUnit = null;
      this.assign(u, from);
      return;
    }
    this.heldUnit = this.heldUnit === unit ? null : unit;
    this.selectedTile = null;
    this.drawMarkers();
    this.touch();
  }

  /**
   * Place u on t, setting down whatever is in hand. When a placed unit moves onto
   * another that can't take its old tile, that one waits, and the rail says why.
   */
  moveTo(u, t) {
    const from = this.formation.at[u];
    const occupant = unitOnTile(this.formation, t);
    const benched = from !== null && occupant !== -1 && occupant !== u && this.displaces(u, t);
    // A refused move changes nothing: whatever is in hand stays there, tint and all.
    const reason = this.issue(u, t);
    if (reason) {
      this.flash(reason);
      return false;
    }
    this.heldUnit = null;
    if (!this.assign(u, t)) return false;
    if (benched) this.flash(`${this.units[occupant].name} waits: ${this.issue(occupant, from)}`);
    return true;
  }

  /** Set the unit in hand down where it is. */
  release() {
    if (!this.heldUnit) return;
    this.heldUnit = null;
    this.drawMarkers();
    this.touch();
  }

  openPicker(t) {
    this.picker?.destroy();
    const s = this.scene;
    this.picker = new FormationPicker(s, this, t, {
      onPick: (u) => this.assign(u, t),
      onClear: () => this.clear(t),
      onClose: () => {
        this.picker = null;
        this.selectTile(null);
      },
    });
  }

  /** A placed unit's menu: swap it with anyone, send it back to wait, or read its details. */
  openUnitMenu(u) {
    const t = this.formation.at[u];
    if (!this.ready || t === null) return;
    this.picker?.destroy();
    this.picker = new FormationPicker(this.scene, this, t, {
      subject: u,
      onPick: (v) => this.moveTo(v, t),
      onClear: () => {
        this.heldUnit = null;
        this.clear(t);
      },
      onDetails: () => this.showDetails(u),
      // Closing the menu keeps the unit in hand; Back again sets it down.
      onClose: () => {
        this.picker = null;
        this.drawMarkers();
        this.touch();
      },
    });
  }

  /**
   * The unit's detail sheet, paging through the units on the field (the sheet reads
   * terrain from where a unit stands; a waiting unit stands nowhere).
   */
  showDetails(u) {
    const s = this.scene;
    const unit = this.units[u];
    const t = this.formation.at[u];
    if (!unit || t === null || !s.unitDetailOverlay) return;
    const placed = this.units.filter((_, v) => this.formation.at[v] !== null);
    const tile = this.tiles[t];
    s.unitDetailOverlay.show(unit, s.grid?.getTerrainAt?.(tile.col, tile.row), s.gameData, {
      rosterUnits: placed,
      rosterIndex: placed.indexOf(unit),
    });
    s.refreshEndTurnControl?.();
  }

  assign(u, t) {
    if (this.issue(u, t)) return false;
    // A displaced unit only swaps onto a tile it may stand on; otherwise it waits.
    this.formation = placeUnit(this.formation, u, t, (o, tile) => !this.issue(o, tile));
    this.syncField();
    return true;
  }

  clear(t) {
    this.formation = clearTile(this.formation, t);
    this.syncField();
  }

  /** Send a placed unit back to wait. */
  unplace(u) {
    const t = this.formation.at[u];
    if (!this.ready || t === null) return;
    if (this.heldUnit === this.units[u]) this.heldUnit = null;
    this.clear(t);
  }

  clearAll() {
    if (!this.ready) return;
    this.formation = clearAll(this.formation);
    this.heldUnit = null;
    this.syncField();
  }

  /**
   * Place everyone still benched. Each unit's default tile (the one the battle
   * would have given it) is a preference, not a lock: the fill places as many
   * units as any assignment could and keeps the most of them on their defaults,
   * moving a default only when a fuller formation needs its tile. Units the player
   * placed never move.
   */
  autoPlace() {
    if (!this.ready) return;
    const seeds = this.defaultTiles.map((tile) => this.tileIndexAt(tile.col, tile.row));
    this.formation = autoFill(this.formation, (u, t) => !this.issue(u, t), { seeds });
    this.heldUnit = null;
    this.syncField();
  }

  /** Start the battle with the chosen formation. */
  start() {
    if (!this.ready || !this.complete()) return false;
    this.commit();
    return true;
  }

  commit() {
    const s = this.scene;
    this.picker?.destroy();
    this.picker = null;
    this.menu?.destroy();
    this.menu = null;
    this.ready = false;
    this.heldUnit = null;
    this.selectedTile = null;
    if (s.unitDetailOverlay?.visible) s.unitDetailOverlay.hide();
    for (const [u, unit] of this.units.entries()) {
      const tile = this.tiles[this.formation.at[u]];
      unit.col = tile.col;
      unit.row = tile.row;
    }
    s.playerUnits.length = 0;
    s.playerUnits.push(...this.units);
    for (const unit of this.units) {
      this.setUnitShown(unit, true);
      s.updateUnitPosition(unit);
    }
    this.clearMarkers();
    this.dock?.destroy();
    this.dock = null;
    this.active = false;
    s.battleState = 'PLAYER_IDLE';
    s.inspectionPanel?.hide?.();
    s.grid?.clearHighlights?.();
    s.grid?.clearAttackHighlights?.();
    if (s.grid?.fogEnabled) {
      s.grid.updateFogOfWar(s.playerUnits);
      s.updateEnemyVisibility?.();
    }
    s.dangerZoneStale = true;
    s._pinnedThreats?.invalidate?.();
    if (s.dangerZone?.visible) s.refreshVisibleDangerZone?.();
    s._recruitBeacon?.sync?.();
    s._mobileBattleHud && (s._mobileBattleHud.lastSnapshot = '');
    this.touch();
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }

  /** Keyboard / controller: Start, Auto-place and Clear without the pointer. */
  openMenu() {
    if (!this.ready || this.menu) return;
    const menu = new MenuSurface(this.scene, 'Formation', () => close(), { modal: true });
    const close = () => {
      menu.destroy();
      if (this.menu === menu) this.menu = null;
      this.touch();
    };
    this.menu = menu;
    const make = (label, action, cls = '') => {
      const b = menuButton(label, () => {
        action();
        close();
      });
      if (cls) b.className = `re-btn ${cls}`;
      return b;
    };
    renderFormationPanel(menu.body, this, make);
    // Settings, help, Save & Exit and Back to map live in the pause menu.
    menu.body.append(make('Pause menu', () => this.scene.showPauseMenu?.(), 'fm-pause'));
    menu.focusContent();
  }

  // --- Leaving before turn 1 ------------------------------------------------------

  /**
   * Back to map is offered while nothing has happened yet: a run battle whose entry
   * is recorded and that has no suspend checkpoint (the first one is taken at the
   * first player phase).
   */
  canReturnToMap() {
    const s = this.scene;
    const flag = s.runManager?.battleInProgress;
    return Boolean(
      this.ready &&
      flag &&
      !flag.checkpoint &&
      (!flag.nodeId || flag.nodeId === s.nodeId) &&
      !s.battleParams?.tutorialMode,
    );
  }

  /**
   * Leave placement for the route map, as Continue from Map would: the run goes
   * back to its entry state (Vision and RNG refunded) and is saved without the
   * battle flag. The node stays open and its battle is locked, so it is the same
   * fight when the player returns. Placement is not kept.
   */
  async returnToMap() {
    const s = this.scene;
    if (!this.canReturnToMap()) return false;
    const rm = s.runManager;
    rm.revertBattleInProgressToEntry();
    s._persistBattleRunState?.();
    s.registry?.get?.('audio')?.stopMusic?.(s, 0);
    const result = await transitionToSceneWithBlockedRetry(
      s,
      'NodeMap',
      { gameData: s.gameData, runManager: rm },
      { reason: TRANSITION_REASONS.BACK },
    );
    if (result?.status === TRANSITION_RESULTS.STARTED) return true;
    // The save already says "on the map": the title's Continue lands there.
    if (s.sys?.isActive?.() !== false) s.showPauseTransitionRecovery?.(TRANSITION_REASONS.BACK);
    return false;
  }

  /** Esc / Back / the pad's B during placement. */
  cancel() {
    if (this.menu) {
      this.menu.onClose?.();
      return true;
    }
    if (this.picker) {
      this.picker.close();
      return true;
    }
    if (this.heldUnit || this.selectedTile !== null) {
      this.heldUnit = null;
      this.selectTile(null);
      return true;
    }
    return false;
  }

  // --- Field -------------------------------------------------------------------

  /** Show each placed unit on its tile; keep benched units hidden. */
  syncField() {
    const s = this.scene;
    s.playerUnits.length = 0;
    for (const [u, unit] of this.units.entries()) {
      const t = this.formation.at[u];
      if (t === null) {
        this.setUnitShown(unit, false);
        continue;
      }
      unit.col = this.tiles[t].col;
      unit.row = this.tiles[t].row;
      s.playerUnits.push(unit);
      this.setUnitShown(unit, true);
      s.updateUnitPosition(unit);
    }
    s.dangerZoneStale = true;
    this.drawMarkers();
    this.touch();
  }

  setUnitShown(unit, shown) {
    for (const part of [
      unit.graphic,
      unit.label,
      unit.factionIndicator,
      unit.hpBar?.bg,
      unit.hpBar?.fill,
      ...(unit.affixPips || []),
      ...Object.values(unit._conditionIcons || {}),
    ])
      part?.setVisible?.(shown);
  }

  drawMarkers() {
    const s = this.scene;
    this.clearMarkers();
    if (!this.active || !s.add) return;
    const held = this.heldIndex();
    const heldTile = this.heldTile();
    this.drawReach();
    for (const [t, tile] of this.tiles.entries()) {
      const { x, y } = s.grid.gridToPixel(tile.col, tile.row);
      const occupied = unitOnTile(this.formation, t) !== -1;
      const selected = this.selectedTile === t || heldTile === t;
      const blockedForHeld = held !== -1 && heldTile !== t && Boolean(this.issue(held, t));
      const fill = s.add
        .rectangle(x, y, TILE_SIZE - 2, TILE_SIZE - 2, UI_HEX.info, occupied ? 0.16 : 0.34)
        .setDepth(6);
      fill.setStrokeStyle(
        selected ? 3 : 2,
        selected ? UI_HEX.accent : blockedForHeld ? UI_HEX.lineStrong : UI_HEX.info,
        blockedForHeld ? 0.5 : 0.95,
      );
      if (blockedForHeld) fill.setAlpha(0.45);
      this.markers.push(fill);
      if (!occupied) {
        const plus = s.add
          .text(x, y, '+', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: blockedForHeld ? '#8a7f86' : '#dbe9f5',
          })
          .setOrigin(0.5)
          .setDepth(6.5)
          .setAlpha(0.9);
        this.markers.push(plus);
      }
    }
    this.tintHeld();
  }

  /** Where the placed unit in hand could move and strike on turn 1, from its tile. */
  reachTiles() {
    const s = this.scene;
    const u = this.heldIndex();
    if (u === -1 || this.formation.at[u] === null || !s.grid?.getMovementRange) return null;
    const unit = this.units[u];
    const positions = s.buildUnitPositionMap?.('player') || new Map();
    // Fog: an unseen enemy never shapes the preview (it would give itself away).
    if (s.grid.fogEnabled)
      for (const [key, entry] of positions) {
        const [col, row] = key.split(',').map(Number);
        if (entry?.faction !== 'player' && !s.grid.isVisible(col, row)) positions.delete(key);
      }
    const { moveRange, attackTiles } = unitReach(s.grid, unit, {
      mov: isRooted(unit) ? 0 : (unit.mov ?? unit.stats?.MOV ?? 0),
      positions,
      costModifier: s._getCostModifier?.(unit) || 0,
    });
    const move = [];
    for (const [key, entry] of moveRange) {
      if (entry?.stoppable === false || key === `${unit.col},${unit.row}`) continue;
      const [col, row] = key.split(',').map(Number);
      move.push({ col, row });
    }
    return { move, attack: attackTiles };
  }

  drawReach() {
    const s = this.scene;
    const reach = this.reachTiles();
    if (!reach) return;
    const paint = (tiles, color, alpha) => {
      for (const { col, row } of tiles) {
        const { x, y } = s.grid.gridToPixel(col, row);
        this.markers.push(
          s.add.rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, color, alpha).setDepth(5),
        );
      }
    };
    paint(reach.move, 0x3366cc, 0.4);
    paint(reach.attack, ATTACK_RANGE_COLOR, ATTACK_RANGE_ALPHA);
  }

  /** The unit in hand wears the selection tint, as a selected unit does in battle. */
  tintHeld() {
    const unit = this.heldTile() === null ? null : this.heldUnit;
    if (this.tinted === unit) return;
    this.tinted?.graphic?.clearTint?.();
    this.tinted = unit;
    unit?.graphic?.setTint?.(0xaaaaff);
  }

  clearMarkers() {
    for (const marker of this.markers) marker?.destroy?.();
    this.markers = [];
    this.tinted?.graphic?.clearTint?.();
    this.tinted = null;
  }

  /** Fog during placement: what the formation tiles would see (foot vision). */
  refreshFog() {
    const s = this.scene;
    if (!s.grid?.fogEnabled) return;
    s.grid.updateFogOfWar(this.tiles.map(({ col, row }) => ({ col, row, moveType: 'Infantry' })));
    s.updateEnemyVisibility?.();
  }

  frameCamera() {
    const s = this.scene;
    if (!this.tiles.length) return;
    const xs = this.tiles.map((t) => s.grid.gridToPixel(t.col, t.row));
    const cx = xs.reduce((a, p) => a + p.x, 0) / xs.length;
    const cy = xs.reduce((a, p) => a + p.y, 0) / xs.length;
    s._battleCamera?.ensureWorldVisible?.(cx, cy, TILE_SIZE * 2);
  }

  flash(message) {
    this.notice = message;
    this.touch();
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      this.notice = '';
      this.touch();
    }, 2400);
  }

  /** Re-render the rail / dock. */
  touch() {
    this.version++;
    const s = this.scene;
    if (s._mobileBattleHud) {
      s._mobileBattleHud.lastSnapshot = '';
      s._mobileBattleHud.sync?.();
    }
    this.dock?.render();
  }

  destroy() {
    clearTimeout(this._noticeTimer);
    this.menu?.destroy();
    this.menu = null;
    this.picker?.destroy();
    this.picker = null;
    this.dock?.destroy();
    this.dock = null;
    this.clearMarkers();
    if (this.active) {
      // Scene teardown mid-placement: put the army back so shutdown cleanup sees
      // every unit (their graphics are destroyed with the scene).
      const s = this.scene;
      if (Array.isArray(s.playerUnits) && s.playerUnits.length < this.units.length) {
        s.playerUnits.length = 0;
        s.playerUnits.push(...this.units);
      }
    }
    this.active = false;
    this.ready = false;
    this.heldUnit = null;
    this.selectedTile = null;
    this.resolve = null;
  }
}
