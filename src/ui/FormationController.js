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
  tileKey,
  unitOnTile,
} from '../engine/FormationPlacement.js';
import { FormationPicker } from './FormationPicker.js';
import { FormationDock, renderFormationPanel } from './FormationPanel.js';
import { MenuSurface, button as menuButton } from './MenuSurface.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { TILE_SIZE } from '../utils/constants.js';
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

  complete() {
    return isComplete(this.formation);
  }

  // --- Player actions ----------------------------------------------------------

  /** A map tap (or gamepad confirm) during placement. */
  handleTileTap(gp) {
    if (!this.ready) return;
    const s = this.scene;
    const t = this.tileIndexAt(gp.col, gp.row);
    if (t === -1) {
      this.selectTile(null);
      // Off the formation: enemies and terrain inspect as on a normal turn.
      s._inputController?.handleIdleClick?.(gp);
      return;
    }
    if (this.heldUnit) {
      const u = this.unitIndex(this.heldUnit);
      const reason = this.issue(u, t);
      if (reason) {
        this.flash(reason);
        return;
      }
      this.heldUnit = null;
      this.assign(u, t);
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

  /** Rail: tap a benched unit, then a tile. Tapping it again lets go. */
  holdUnit(unit) {
    if (!this.ready) return;
    this.heldUnit = this.heldUnit === unit ? null : unit;
    this.selectedTile = null;
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

  assign(u, t) {
    if (this.issue(u, t)) return false;
    this.formation = placeUnit(this.formation, u, t);
    this.syncField();
    return true;
  }

  clear(t) {
    this.formation = clearTile(this.formation, t);
    this.syncField();
  }

  clearAll() {
    if (!this.ready) return;
    this.formation = clearAll(this.formation);
    this.heldUnit = null;
    this.syncField();
  }

  /**
   * Place everyone still benched: a unit first takes its default tile (the one the
   * battle would have given it), then matching fills the rest, strict rules first.
   */
  autoPlace() {
    if (!this.ready) return;
    let f = this.formation;
    for (const [u, tile] of this.defaultTiles.entries()) {
      if (f.at[u] !== null) continue;
      const t = this.tileIndexAt(tile.col, tile.row);
      if (t === -1 || unitOnTile(f, t) !== -1 || this.issue(u, t)) continue;
      f = placeUnit(f, u, t);
    }
    f = autoFill(f, (u, t) => !this.issue(u, t));
    this.formation = f;
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
    menu.focusContent();
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
    const held = this.heldUnit ? this.unitIndex(this.heldUnit) : -1;
    for (const [t, tile] of this.tiles.entries()) {
      const { x, y } = s.grid.gridToPixel(tile.col, tile.row);
      const occupied = unitOnTile(this.formation, t) !== -1;
      const selected = this.selectedTile === t;
      const blockedForHeld = held !== -1 && Boolean(this.issue(held, t));
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
  }

  clearMarkers() {
    for (const marker of this.markers) marker?.destroy?.();
    this.markers = [];
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
    this.resolve = null;
  }
}
