import { DangerZoneOverlay } from './DangerZoneOverlay.js';
import { canInspectUnit } from '../engine/BattleInformation.js';
import { computeEffectivePath } from '../engine/Grid.js';
import { getBallistaDangerTiles, isBallistaTile } from '../engine/BallistaEngine.js';
import {
  isSleeping,
  isRooted,
  willRemainRootedNextPhase,
} from '../engine/StatusConditionSystem.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import {
  TOOLTIP_LONG_PRESS_MS,
  TOOLTIP_LONG_PRESS_MOVE_THRESHOLD,
} from '../utils/tooltipTiming.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { combatDistance, getFootprintKeys } from '../engine/EntitySystem.js';
import { chooseAttackTile } from '../engine/AttackOptions.js';

/** Battle states where a long press on a unit opens its detail sheet (planning only). */
const HOLD_DETAIL_STATES = new Set([
  'PLAYER_IDLE',
  'UNIT_SELECTED',
  'UNIT_ACTION_MENU',
  'SELECTING_TARGET',
]);

// A tap on any tile of a (possibly multi-tile) unit.
const occupies = (unit, gp) =>
  Boolean(unit) && getFootprintKeys(unit).includes(`${gp.col},${gp.row}`);

export class InputController {
  constructor(scene) {
    this.scene = scene;
    this._ballistaRangeShown = false;
  }

  onPointerMove(pointer) {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return;
    if (scene._isTouchPointer(pointer) && this._handleCameraGesturePointerMove(pointer)) {
      scene._cameraGestureTapSuppressed = true;
      this.cancelTouchInspectHold();
      return;
    }
    this.updateTouchInspectHold(pointer);
    if (scene.battleState === 'BATTLE_END') {
      if (scene.cursorHighlight) scene.cursorHighlight.setVisible(false);
      if (scene.infoText) scene.infoText.setText('');
      this.updateTopLeftHudLayout();
      return;
    }
    if (scene._isTouchPointer(pointer)) return;
    const gp = this._pointerToGrid(pointer);
    if (!gp) {
      scene._threatFocusTile = null;
      scene.cursorHighlight.setVisible(false);
      scene.infoText.setText('');
      this.updateTopLeftHudLayout();
      return;
    }

    const { x, y } = scene.grid.gridToPixel(gp.col, gp.row);
    scene.cursorHighlight.setPosition(x, y).setVisible(true);
    this.refreshTileInfo(gp.col, gp.row);
    this.updatePathPreview(gp.col, gp.row);
  }

  // Build and display the terrain/unit summary for a tile in the top-left info
  // panel. Shared by mouse hover (onPointerMove) and the gamepad grid cursor
  // (BattleScene._onGridCursorMoved).
  refreshTileInfo(col, row) {
    const scene = this.scene;
    if (!scene.grid || !scene.infoText) return;
    const terrain = scene.grid.getTerrainAt(col, row);
    scene._mobileTerrainFocus = { col, row };
    let info = terrain.name;
    const hovered = scene.getUnitAt(col, row);
    // Fog gate BEFORE any per-unit info: a hidden enemy's moveType must not leak
    // through the Move-cost line (e.g. a fogged flier showing Forest "Move: 1").
    const hoveredVisible = canInspectUnit(scene.grid, hovered);
    const moveType = hoveredVisible ? hovered.moveType : 'Infantry';
    const moveCost = terrain.moveCost[moveType];
    info += ` | Move: ${moveCost}`;
    const avoidBonus = parseInt(terrain.avoidBonus, 10);
    if (avoidBonus) info += ` | Avo ${avoidBonus > 0 ? '+' : ''}${avoidBonus}`;
    if (parseInt(terrain.defBonus)) info += ` | Def +${terrain.defBonus}`;
    const specialText = typeof terrain.special === 'string' ? terrain.special.trim() : '';
    if (specialText) info += `\n${specialText}`;

    const threat = scene._threatSight?.describe(col, row);
    if (threat) info += `\nThreat: ${threat}`;

    if (hoveredVisible) {
      const lvl = getDisplayLevel(hovered);
      const cls = hovered.className || '';
      info += `\n${hovered.name} Lv${lvl} ${cls} | HP ${hovered.currentHP}/${hovered.stats.HP}`;
      if (hovered.weapon) info += ` | ${hovered.weapon.name}`;
      if (hovered.faction === 'player' && hovered.xp !== undefined) {
        info += ` | XP ${hovered.xp}/100`;
      }
    }
    scene.infoText.setText(info);
    this.updateTopLeftHudLayout();
  }

  // While a unit is selected, preview the movement path to (col,row) — or clear it
  // when the tile isn't a stoppable destination. Shared by mouse hover and the
  // gamepad grid cursor. Memoized on _lastPathPreviewKey to skip recomputes.
  updatePathPreview(col, row) {
    const scene = this.scene;
    // Threat sight follows the same hover/grid-cursor tile as the path preview.
    scene._threatFocusTile = { col, row };
    scene._threatSight?.sync();
    if (scene.battleState === 'UNIT_SELECTED' && scene.selectedUnit && scene.movementRange) {
      const key = `${col},${row}`;
      const previewEntry = scene.movementRange.get(key);
      const unit = scene.selectedUnit;
      let dest = null;
      if (previewEntry && previewEntry.stoppable !== false && key !== `${unit.col},${unit.row}`)
        dest = { col, row, key };
      else {
        // Hovering an enemy it can reach by moving: preview the walk to the attack tile.
        const tile = this.attackApproach({ col, row })?.tile;
        if (tile && (tile.col !== unit.col || tile.row !== unit.row))
          dest = { col: tile.col, row: tile.row, key: `attack:${key}` };
      }
      if (dest) {
        if (scene._lastPathPreviewKey === dest.key) return;
        this._showPreviewPath(unit, dest.col, dest.row);
        scene._lastPathPreviewKey = dest.key;
      } else {
        scene.grid.clearPath();
        scene._lastPathPreviewKey = null;
      }
    }
  }

  _showPreviewPath(unit, col, row) {
    const scene = this.scene;
    const icePath = scene.grid.reconstructIcePath(
      scene.movementRange,
      unit.col,
      unit.row,
      col,
      row,
    );
    const path =
      icePath ||
      scene.grid.findPath(
        unit.col,
        unit.row,
        col,
        row,
        unit.moveType,
        scene.unitPositions,
        unit.faction,
        scene._getCostModifier(unit),
      );
    if (!path) return;
    const occupied = scene.buildOccupiedSet(unit);
    const effective = computeEffectivePath(
      path,
      scene.grid.mapLayout,
      scene.grid.terrainData,
      scene.grid.cols,
      scene.grid.rows,
      unit.moveType,
      occupied,
      scene._getCostModifier(unit),
    );
    scene.grid.showPath(effective.effectivePath);
    for (const seg of effective.slideSegments) {
      scene.grid.showSlidePath(seg.slidePath);
    }
  }

  onPointerDown(pointer) {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return;
    if (scene._isTouchPointer(pointer)) {
      scene._battleCamera?.pruneInactiveTouches?.(pointer);
      if (!scene._battleCamera?.hasActiveTouches?.()) {
        scene._cameraGestureTapSuppressed = false;
      }
      if (this._handleCameraGesturePointerDown(pointer)) {
        scene._cameraGestureTapSuppressed = true;
        this.cancelTouchInspectHold();
        scene._touchTapDown = null;
        return;
      }
    }
    scene._touchTapDown = { x: pointer.x, y: pointer.y };
    this.startTouchInspectHold(pointer);
    if (pointer?.rightButtonDown && pointer.rightButtonDown()) this.onRightClick(pointer);
  }

  onPointerUp(pointer) {
    const scene = this.scene;
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;
    const uiClickBlocked = Boolean(scene._uiClickBlocked);
    if (uiClickBlocked) scene._uiClickBlocked = false;

    if (scene._isTouchPointer(pointer)) {
      const wasTouchCanceled = Boolean(
        pointer.wasCanceled || pointer?.event?.type === 'touchcancel',
      );
      if (wasTouchCanceled) {
        const hadTouches = Boolean(scene._battleCamera?.clearTouches?.());
        scene._cameraGestureTapSuppressed = true;
        this.cancelTouchInspectHold();
        scene._touchTapDown = null;
        if (hadTouches) scene._syncMobileResetViewButton();
        return;
      }
      if (this._handleCameraGesturePointerUp(pointer)) {
        scene._cameraGestureTapSuppressed = true;
        this.cancelTouchInspectHold();
        scene._touchTapDown = null;
        return;
      }
      if (scene._cameraGestureTapSuppressed) {
        if (!scene._battleCamera?.hasActiveTouches?.()) scene._cameraGestureTapSuppressed = false;
        this.cancelTouchInspectHold();
        scene._touchTapDown = null;
        return;
      }
    }

    if (scene.isStoryInputLocked()) {
      this.cancelTouchInspectHold();
      scene._touchTapDown = null;
      return;
    }

    if (uiClickBlocked) {
      this.cancelTouchInspectHold();
      scene._touchTapDown = null;
      return;
    }

    this.cancelTouchInspectHold();
    let clickPos = null;
    if (scene._isTouchPointer(pointer) && scene._touchTapDown) {
      if (scene._touchHoldTriggered) {
        scene._touchHoldTriggered = false;
        scene._touchTapDown = null;
        return;
      }
      const dx = pointer.x - scene._touchTapDown.x;
      const dy = pointer.y - scene._touchTapDown.y;
      if (dx * dx + dy * dy > scene._tapMoveThreshold * scene._tapMoveThreshold) {
        scene._touchTapDown = null;
        return;
      }
      clickPos = { x: scene._touchTapDown.x, y: scene._touchTapDown.y };
    }
    scene._touchTapDown = null;
    this.onClick(pointer, clickPos);
  }

  /**
   * Release outside the canvas: reset touch/gesture state only. This must
   * never fall through to onClick — an off-grid release reads as Cancel and
   * closed menus/target selection on desktop drag-out (the same bug was fixed
   * separately in NodeMapScene and HomeBaseScene; BattleScene routed
   * pointerupoutside to onPointerUp until now).
   */
  onPointerUpOutside(pointer) {
    const scene = this.scene;
    if (scene._isTouchPointer(pointer)) {
      const hadTouches = Boolean(scene._battleCamera?.clearTouches?.());
      scene._cameraGestureTapSuppressed = true;
      if (hadTouches) scene._syncMobileResetViewButton();
    }
    this.cancelTouchInspectHold();
    scene._touchTapDown = null;
    scene._touchHoldTriggered = false;
  }

  onRightClick(pointer) {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return;
    if (scene.battleState === 'BATTLE_END') return;
    if (scene.requestCancel({ allowPause: false })) {
      return;
    }

    if (scene.inspectionPanel.visible) {
      this.clearInspectionVisuals();
      return;
    }
    if (this._ballistaRangeShown) {
      this._ballistaRangeShown = false;
      this.clearInspectionVisuals();
      return;
    }
    const world = this._pointerToWorld(pointer);
    if (world && this._showInspectionAtPixel(world.x, world.y)) return;
    scene.refreshEndTurnControl();
  }

  onClick(pointer, clickPos = null) {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return;
    if (pointer?.rightButtonDown && pointer.rightButtonDown()) return;
    if (scene.unitDetailOverlay?.visible) return;
    if (
      scene.battleState === 'ENEMY_PHASE' ||
      scene.battleState === 'BATTLE_END' ||
      scene.battleState === 'UNIT_MOVING' ||
      scene.battleState === 'COMBAT_RESOLVING' ||
      scene.battleState === 'HEAL_RESOLVING' ||
      scene.battleState === 'DEPLOY_SELECTION' ||
      scene.battleState === 'TUTORIAL_HINT' ||
      scene.battleState === 'PAUSED'
    )
      return;

    const screenX = clickPos?.x ?? pointer?.x;
    const screenY = clickPos?.y ?? pointer?.y;
    const world = this._screenToWorld(screenX, screenY);
    if (!world) return;
    const px = world.x;
    const py = world.y;
    if (scene.isMobileInput && scene.inspectMode) {
      if (this.handleInspectModeTap(pointer, px, py)) return;
    }
    const gp = scene.grid.pixelToGrid(px, py);
    if (!gp) {
      if (!this._isPointerOverInteractive(pointer)) {
        scene.requestCancel({ allowPause: false });
      }
      return;
    }

    if (scene.isMobileInput) this.refreshTileInfo(gp.col, gp.row);

    switch (scene.battleState) {
      case 'PLAYER_IDLE':
        this.handleIdleClick(gp);
        break;
      case 'UNIT_SELECTED':
        this.handleSelectedClick(gp);
        break;
      case 'UNIT_ACTION_MENU':
        this.handleActionMenuClick(gp);
        break;
      case 'SELECTING_TARGET':
        this.handleTargetClick(gp);
        break;
      case 'SHOWING_FORECAST':
        this.handleForecastClick(gp);
        break;
      case 'SELECTING_HEAL_TARGET':
        scene.handleHealTargetClick(gp);
        break;
      case 'SELECTING_CURE_TARGET':
        scene._handleCureTargetClick(gp);
        break;
      case 'SELECTING_STAFF_ALLY':
        scene.handleStaffAllyClick(gp);
        break;
      case 'SELECTING_STAFF_TILE':
        scene.handleStaffTileClick(gp);
        break;
      case 'SELECTING_SHOVE_TARGET':
        scene.handleShoveTargetClick(gp);
        break;
      case 'SELECTING_PULL_TARGET':
        scene.handlePullTargetClick(gp);
        break;
      case 'SELECTING_TRADE_TARGET':
        scene.handleTradeTargetClick(gp);
        break;
      case 'SELECTING_SWAP_TARGET':
        scene.handleSwapTargetClick(gp);
        break;
      case 'SELECTING_DANCE_TARGET':
        scene.handleDanceTargetClick(gp);
        break;
      case 'SELECTING_BREAK_TARGET':
        scene.handleBreakTargetClick(gp);
        break;
      case 'SELECTING_ABILITY_TILE':
        scene.handleAbilityTileClick(gp);
        break;
      case 'CANTO_MOVING':
        scene.handleCantoClick(gp);
        break;
    }
  }

  handleIdleClick(gp) {
    const scene = this.scene;
    if (scene.unitDetailOverlay?.visible) scene.unitDetailOverlay.hide();
    const unit = scene.getUnitAt(gp.col, gp.row);
    if (unit && unit.faction === 'player' && !unit.hasActed && !isSleeping(unit)) {
      scene.inspectionPanel.hide();
      scene.grid.clearHighlights();
      scene.grid.clearAttackHighlights();
      scene.selectUnit(unit);
      // Native battle controls expose actions immediately, without sacrificing
      // the existing unit → destination movement gesture. Tutorial movement
      // gates and the canvas-only UI keep their guided selection flow.
      if (
        scene.isMobileInput &&
        scene._mobileBattleHud?.available() &&
        scene.battleState === 'UNIT_SELECTED' &&
        scene.selectedUnit === unit &&
        !scene._isTutorialStrictGateActive?.()
      ) {
        scene.preMoveLoc = { col: unit.col, row: unit.row };
        scene._preFogSnapshot = scene.grid.snapshotFogState();
        scene.showActionMenu(unit);
        this.registerSelectionMenu(unit);
      }
      // The desktop footer shows [X] Cancel and the selection hint from the first click.
      scene.refreshEndTurnControl?.();
      return;
    }
    if (unit?.faction === 'player' && isSleeping(unit)) {
      const point = scene.grid.gridToPixel(unit.col, unit.row);
      this._showInspectionAtPixel(point.x, point.y);
      scene._mobileBattleHud?.sync();
      return;
    }
    // Mobile: touch has no hover or right-click, so a plain tap on a visible
    // non-player unit toggles its inspection panel + threat range
    if (
      scene.isMobileInput &&
      unit &&
      unit.faction !== 'player' &&
      canInspectUnit(scene.grid, unit)
    ) {
      if (scene.inspectionPanel?.visible && scene.inspectionPanel._unit === unit) {
        this.clearInspectionVisuals();
        return;
      }
      const { x, y } = scene.grid.gridToPixel(gp.col, gp.row);
      if (this._showInspectionAtPixel(x, y)) return;
    }
    scene.inspectionPanel.hide();
    scene.grid.clearHighlights();
    scene.grid.clearAttackHighlights();
  }

  isPlanningSelection() {
    const s = this.scene;
    const u = s.selectedUnit;
    return Boolean(
      u &&
      !u.hasMoved &&
      !u.hasActed &&
      !u._movementCommitted &&
      !s.tradeMutatedThisSession &&
      !s._isTutorialStrictGateActive?.() &&
      (s.battleState === 'UNIT_SELECTED' || this.isSelectionMenu()),
    );
  }

  handlePlanningUnitTap(gp) {
    const s = this.scene;
    if (!this.isPlanningSelection()) return false;
    const target = s.getUnitAt(gp.col, gp.row);
    if (!target || target === s.selectedUnit || !canInspectUnit(s.grid, target)) return false;
    if (target.faction === 'player' && !target.hasActed && !isSleeping(target)) {
      this.clearPlanningInspection();
      if (this.isSelectionMenu()) s.hideActionMenu();
      this._selectionMenu = null;
      s.deselectUnit();
      this.handleIdleClick(gp);
      return true;
    }
    if (s.isMobileInput) {
      if (s.inspectionPanel?.visible && s.inspectionPanel._unit === target) {
        this.clearPlanningInspection();
      } else {
        const pixel = s.grid.gridToPixel(gp.col, gp.row);
        this._showInspectionAtPixel(pixel.x, pixel.y);
      }
      return true;
    }
    return false;
  }

  clearPlanningInspection() {
    if (!this._planningInspection) return;
    this._planningInspection = false;
    this._planningThreat?.hide();
    this.scene.inspectionPanel?.hide();
    this.scene._mobileBattleHud?.sync?.();
  }

  handleSelectedClick(gp) {
    const scene = this.scene;
    // A move-then-attack intent belongs only to the move that tryAttackFromSelection starts.
    this._pendingMoveAttack = null;
    if (scene.selectedUnit?._movementCommitted) {
      scene.showActionMenu(scene.selectedUnit);
      return;
    }
    if (!scene.selectedUnit) {
      scene.deselectUnit();
      return;
    }
    if (scene._isTutorialStrictGateActive() && scene.tutorialStep === 3) {
      const fort = scene._getTutorialFortTile();
      const isFortTile = Boolean(fort && gp.col === fort.col && gp.row === fort.row);
      const key = `${gp.col},${gp.row}`;
      const rangeEntry = scene.movementRange?.get(key);
      const canMoveToTile = Boolean(rangeEntry && rangeEntry.stoppable !== false);
      if (!isFortTile || !canMoveToTile) {
        void scene._showTutorialBlockingInstruction(
          'Move Edric to the highlighted Fort tile to continue.',
        );
        return;
      }
    }

    if (this.handlePlanningUnitTap(gp)) return;
    this.clearPlanningInspection();

    if (gp.col === scene.selectedUnit.col && gp.row === scene.selectedUnit.row) {
      scene.grid.clearHighlights();
      if (scene.selectedUnit.graphic?.clearTint) scene.selectedUnit.graphic.clearTint();
      scene.preMoveLoc = { col: scene.selectedUnit.col, row: scene.selectedUnit.row };
      scene._preFogSnapshot = scene.grid.snapshotFogState();
      scene.showActionMenu(scene.selectedUnit);
      if (scene.isMobileInput && scene._mobileBattleHud?.available()) {
        this.registerSelectionMenu(scene.selectedUnit);
      }
      return;
    }

    if (this.tryAttackFromSelection(gp)) return;

    const key = `${gp.col},${gp.row}`;
    const moveEntry = scene.movementRange?.get(key);
    if (moveEntry && moveEntry.stoppable !== false) {
      scene.moveUnit(scene.selectedUnit, gp.col, gp.row);
    } else {
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      scene.deselectUnit();
    }
  }

  /**
   * Desktop pre-move selection: the enemy on `gp` and the tile the selected unit would
   * attack it from (its own tile when it already reaches), or null. Touch keeps
   * tap-to-inspect for enemies (docs/specs/attack-flow.md), so this is pointer/pad only.
   */
  attackApproach(gp) {
    const s = this.scene;
    if (!gp || s.isMobileInput || !this.isPlanningSelection()) return null;
    const unit = s.selectedUnit;
    const target = s.getUnitAt(gp.col, gp.row);
    if (
      !target ||
      !s.enemyUnits?.includes(target) ||
      !(target.currentHP > 0) ||
      !canInspectUnit(s.grid, target)
    )
      return null;
    const tile = chooseAttackTile(unit, target, s.movementRange, {
      distanceFrom: (col, row) => combatDistance({ col, row }, target),
      isFree: (col, row) => !s.getUnitAt(col, row),
      terrainScore: (col, row) => {
        const terrain = s.grid.getTerrainAt(col, row);
        return (parseInt(terrain?.defBonus, 10) || 0) + (parseInt(terrain?.avoidBonus, 10) || 0);
      },
      skillsData: s.gameData?.skills || null,
    });
    return tile ? { unit, target, tile } : null;
  }

  /**
   * Desktop: with a unit selected (movement shown), clicking an enemy it can attack —
   * from where it stands or from a reachable tile — goes straight to that enemy's
   * forecast (target-first flow), moving first when needed. Cancel/Back unwind as
   * after any move (forecast → targets → action menu → undo move). Enemies it cannot
   * reach this turn keep the old behaviour.
   */
  tryAttackFromSelection(gp) {
    const s = this.scene;
    const approach = this.attackApproach(gp);
    if (!approach) return false;
    const { unit, target, tile } = approach;
    if (tile.col === unit.col && tile.row === unit.row) {
      // Same as clicking the unit's own tile, then tapping the enemy in its menu.
      s.grid.clearHighlights();
      unit.graphic?.clearTint?.();
      s.preMoveLoc = { col: unit.col, row: unit.row };
      s._preFogSnapshot = s.grid.snapshotFogState();
      s.showActionMenu(unit);
      this.tryDirectAttack({ col: target.col, row: target.row });
      return true;
    }
    this._pendingMoveAttack = { unit, target };
    s.moveUnit(unit, tile.col, tile.row);
    return true;
  }

  /**
   * After a move that tryAttackFromSelection started (BattleScene.afterMove, once the
   * action menu is up): open the forecast when the target is still attackable from
   * where the unit actually stopped. Otherwise the ordinary post-move menu stays.
   */
  resumeMoveAttack(unit) {
    const pending = this._pendingMoveAttack;
    this._pendingMoveAttack = null;
    const s = this.scene;
    if (
      !pending ||
      pending.unit !== unit ||
      s.selectedUnit !== unit ||
      s.battleState !== 'UNIT_ACTION_MENU' ||
      !(pending.target.currentHP > 0)
    )
      return false;
    return this.tryDirectAttack({ col: pending.target.col, row: pending.target.row });
  }

  registerSelectionMenu(unit) {
    const s = this.scene;
    this._selectionMenu = null;
    if (
      !s.isMobileInput ||
      !s._mobileBattleHud?.available() ||
      s.selectedUnit !== unit ||
      s.battleState !== 'UNIT_ACTION_MENU' ||
      unit.hasMoved ||
      unit.hasActed ||
      unit._movementCommitted ||
      s.tradeMutatedThisSession ||
      s._isTutorialStrictGateActive?.()
    )
      return;
    this._selectionMenu = { unit, objects: s.actionMenu };
    s.grid.showMovementRange?.(s.movementRange, unit.col, unit.row);
  }

  isSelectionMenu() {
    const s = this.scene;
    const menu = this._selectionMenu;
    return Boolean(
      menu &&
      s.battleState === 'UNIT_ACTION_MENU' &&
      s.actionMenu === menu.objects &&
      s.selectedUnit === menu.unit &&
      !menu.unit.hasMoved &&
      !menu.unit._movementCommitted &&
      !menu.unit.hasActed &&
      !s.tradeMutatedThisSession,
    );
  }

  commitSelectionMenu(objects) {
    if (!this.isSelectionMenu() || this._selectionMenu.objects !== objects) return;
    this.clearPlanningInspection();
    this._selectionMenu = null;
    this.scene.grid.clearHighlights();
    this.scene.selectedUnit.graphic?.clearTint?.();
  }

  handleActionMenuClick(gp) {
    // After moving, tapping an attackable enemy skips Attack → target: it opens
    // that enemy's forecast directly (Cancel then returns to target selection).
    if (this.tryDirectAttack(gp)) return;
    // Only the initial, uncommitted native action menu accepts destinations.
    // A submenu, trade, or post-movement menu must never grant another move.
    if (!this.isSelectionMenu()) return;
    const s = this.scene;
    if (s._isTutorialStrictGateActive?.()) return;
    if (this.handlePlanningUnitTap(gp)) return;
    this.clearPlanningInspection();
    if (gp.col === s.selectedUnit.col && gp.row === s.selectedUnit.row) return;
    const entry = s.movementRange?.get(`${gp.col},${gp.row}`);
    if (!entry || entry.stoppable === false) {
      const occupant = s.getUnitAt(gp.col, gp.row);
      if (occupant && canInspectUnit(s.grid, occupant)) return;
      this._selectionMenu = null;
      s.hideActionMenu();
      s.registry.get('audio')?.playSFX('sfx_cancel');
      s.deselectUnit();
      return;
    }
    this._selectionMenu = null;
    s.hideActionMenu();
    s.battleState = 'UNIT_SELECTED';
    this.handleSelectedClick(gp);
  }

  /**
   * Post-move action menu: a tap/click on an enemy this unit can attack starts
   * the Attack flow on that target. Not for the unmoved selection menu (a tap
   * there plans/inspects) nor for submenus, and only when Attack is offered.
   */
  tryDirectAttack(gp) {
    const s = this.scene;
    if (s.battleState !== 'UNIT_ACTION_MENU' || s.inEquipMenu || !s.selectedUnit) return false;
    if (this.isSelectionMenu() || s._isTutorialStrictGateActive?.()) return false;
    const attack = (s.actionMenu || []).find(
      (o) => o?.text === 'Attack' && typeof o._action === 'function' && !o._menuDisabled,
    );
    if (!attack) return false;
    const target = s.getUnitAt(gp.col, gp.row);
    if (!target || target.faction === 'player' || !canInspectUnit(s.grid, target)) return false;
    const unit = s.selectedUnit;
    if (!s.findAttackTargets(unit).includes(target)) return false;
    this.clearPlanningInspection();
    s._attackFlow().begin(unit, { target });
    return true;
  }

  handleTargetClick(gp) {
    const scene = this.scene;
    const target = scene.attackTargets.find((t) => occupies(t, gp));
    if (target) {
      if (scene._attackFlow) scene._attackFlow().openForecast(scene.selectedUnit, target);
      else scene.showForecast(scene.selectedUnit, target);
    }
  }

  handleForecastClick(gp) {
    const scene = this.scene;
    if (scene._mobileBattleHud?.forecast) return;
    const current = scene.forecastTarget;
    if (current && occupies(current, gp)) {
      scene.confirmForecastCombat();
      return;
    }
    // Another highlighted target: switch the forecast to it (equipped weapon first).
    const other = (scene.attackTargets || []).find((t) => occupies(t, gp));
    if (other && scene._attackFlow) scene._attackFlow().switchForecastTarget(other);
  }

  startTouchInspectHold(pointer) {
    const scene = this.scene;
    if (!scene._isTouchPointer(pointer)) return;
    this.cancelTouchInspectHold();
    scene._touchHoldTriggered = false;
    scene._touchHoldStart = { x: pointer.x, y: pointer.y, id: pointer.id };
    scene._touchHoldTimer = scene.time.delayedCall(TOOLTIP_LONG_PRESS_MS, () => {
      const start = scene._touchHoldStart;
      scene._touchHoldTimer = null;
      if (!start) return;
      if (
        scene.unitDetailOverlay?.visible ||
        scene.pauseOverlay?.visible ||
        scene.lootSettingsOverlay
      )
        return;
      const world = this._screenToWorld(start.x, start.y);
      if (world && this._showInspectionAtPixel(world.x, world.y)) {
        scene._touchHoldTriggered = true;
        // A long press on a unit (yours or an enemy's) opens its full details while
        // you plan; a tap keeps its meaning (select an ally, glance at a foe).
        if (HOLD_DETAIL_STATES.has(scene.battleState)) this.openHeldUnitDetails(world);
      }
    });
  }

  /** The unit under a long press: its detail sheet (roster paging within its side). */
  openHeldUnitDetails(world) {
    const scene = this.scene;
    const gp = scene.grid.pixelToGrid(world.x, world.y);
    const unit = gp ? scene.getUnitAt(gp.col, gp.row) : null;
    if (!unit || scene.inspectionPanel?._unit !== unit || !scene.unitDetailOverlay) return false;
    this.openUnitDetailOverlay();
    scene._mobileBattleHud?.sync?.();
    return Boolean(scene.unitDetailOverlay.visible);
  }

  updateTouchInspectHold(pointer) {
    const scene = this.scene;
    if (!scene._isTouchPointer(pointer)) return;
    if (!scene._touchHoldTimer || !scene._touchHoldStart) return;
    if (pointer.id !== scene._touchHoldStart.id) return;
    const dx = pointer.x - scene._touchHoldStart.x;
    const dy = pointer.y - scene._touchHoldStart.y;
    const threshold = TOOLTIP_LONG_PRESS_MOVE_THRESHOLD;
    if (dx * dx + dy * dy > threshold * threshold) {
      this.cancelTouchInspectHold();
    }
  }

  cancelTouchInspectHold() {
    const scene = this.scene;
    if (scene._touchHoldTimer) {
      scene._touchHoldTimer.remove(false);
      scene._touchHoldTimer = null;
    }
    scene._touchHoldStart = null;
  }

  _screenToWorld(x, y) {
    const scene = this.scene;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (scene._battleCamera) return scene._battleCamera.screenToWorld(x, y);
    const cam = scene.cameras?.main;
    if (!cam) return null;
    if (typeof cam.getWorldPoint === 'function') {
      return cam.getWorldPoint(x, y);
    }
    // Phaser zooms around the camera center, so the visible edge is offset from scroll
    const zoom = Number(cam.zoom) || 1;
    const offX = ((Number(cam.width) || 0) / 2) * (1 - 1 / zoom);
    const offY = ((Number(cam.height) || 0) / 2) * (1 - 1 / zoom);
    return {
      x: (Number(cam.scrollX) || 0) + offX + (x - (cam.x || 0)) / zoom,
      y: (Number(cam.scrollY) || 0) + offY + (y - (cam.y || 0)) / zoom,
    };
  }

  _worldToScreen(x, y) {
    const scene = this.scene;
    if (scene._battleCamera) return scene._battleCamera.worldToScreen(x, y);
    const cam = scene.cameras?.main;
    if (!cam) return null;
    const zoom = Number(cam.zoom) || 1;
    const offX = ((Number(cam.width) || 0) / 2) * (1 - 1 / zoom);
    const offY = ((Number(cam.height) || 0) / 2) * (1 - 1 / zoom);
    return {
      x: (x - (Number(cam.scrollX) || 0) - offX) * zoom + (cam.x || 0),
      y: (y - (Number(cam.scrollY) || 0) - offY) * zoom + (cam.y || 0),
    };
  }

  _pointerToWorld(pointer) {
    if (!pointer) return null;
    return this._screenToWorld(pointer.x, pointer.y);
  }

  _pointerToGrid(pointer) {
    const scene = this.scene;
    const world = this._pointerToWorld(pointer);
    if (!world || !scene.grid) return null;
    return scene.grid.pixelToGrid(world.x, world.y);
  }

  _handleCameraGesturePointerDown(pointer) {
    const scene = this.scene;
    if (!scene._battleCamera || !scene._isTouchPointer(pointer)) return false;
    const result = scene._battleCamera.handlePointerDown(pointer, scene.isCameraGestureAllowed());
    if (result?.beganGesture || result?.touchCount >= 2) {
      this.cancelTouchInspectHold();
      scene._touchHoldTriggered = false;
    }
    return Boolean(result?.consumed || result?.touchCount >= 2);
  }

  _handleCameraGesturePointerMove(pointer) {
    const scene = this.scene;
    if (!scene._battleCamera || !scene._isTouchPointer(pointer)) return false;
    const result = scene._battleCamera.handlePointerMove(pointer, scene.isCameraGestureAllowed());
    return Boolean(result?.consumed);
  }

  _handleCameraGesturePointerUp(pointer) {
    const scene = this.scene;
    if (!scene._battleCamera || !scene._isTouchPointer(pointer)) return false;
    const result = scene._battleCamera.handlePointerUp(pointer);
    if (result?.endedGesture) scene._syncMobileResetViewButton();
    return Boolean(result?.consumed);
  }

  _showInspectionAtPixel(px, py) {
    const scene = this.scene;
    const gp = scene.grid.pixelToGrid(px, py);
    if (!gp) return false;
    const unit = scene.getUnitAt(gp.col, gp.row);
    if (!unit) {
      if (scene.battleState === 'PLAYER_IDLE') {
        const terrainIndex = scene.grid.mapLayout?.[gp.row]?.[gp.col];
        if (isBallistaTile(terrainIndex)) {
          const ballista = scene.ballistas?.find((b) => b.col === gp.col && b.row === gp.row);
          if (ballista && ballista.owner === 'enemy') {
            if (scene.grid.fogEnabled && !scene.grid.isVisible(gp.col, gp.row)) return false;
            if (scene.inspectionPanel?.visible) scene.inspectionPanel.hide();
            scene.grid.clearHighlights?.();
            const tiles = getBallistaDangerTiles(ballista, scene.grid.cols, scene.grid.rows);
            scene.grid.showAttackRange(tiles);
            this._ballistaRangeShown = true;
            scene.refreshEndTurnControl();
            return true;
          }
        }
      }
      return false;
    }
    if (!canInspectUnit(scene.grid, unit)) return false;
    this._ballistaRangeShown = false;
    const planning = this.isPlanningSelection();
    if (!planning) scene.grid.clearAttackHighlights?.();
    const terrain = scene.grid.getTerrainAt(unit.col, unit.row);
    scene.inspectionPanel.show(unit, terrain, scene.gameData);
    if (typeof scene._pinToScreen === 'function')
      scene._pinToScreen(scene.inspectionPanel?.objects);

    if (planning) {
      this._planningInspection = true;
      this._planningThreat ||= new DangerZoneOverlay(scene, scene.grid, { variant: 'focus' });
      this._planningThreat.show(unit.faction === 'enemy' ? scene.calculateDangerZone(unit) : []);
      scene._mobileBattleHud?.sync?.();
    }
    if (scene.battleState === 'PLAYER_IDLE') {
      const isPlayer = unit.faction === 'player';
      const moveColor = isPlayer ? 0x3366cc : UI_HEX.dangerLine;
      const moveAlpha = isPlayer ? 0.4 : 0.35;
      const positions = scene.buildUnitPositionMap(unit.faction);
      // Player units already ticked recovery this phase (isRooted is current);
      // other factions act next phase, so preview their post-recovery state.
      const rootedForPreview =
        unit.faction === 'player' ? isRooted(unit) : willRemainRootedNextPhase(unit);
      const asleepPlayer = unit.faction === 'player' && isSleeping(unit);
      const mov = rootedForPreview || asleepPlayer ? 0 : (unit.mov ?? unit.stats?.MOV ?? 0);
      const moveRange = scene.grid.getMovementRange(
        unit.col,
        unit.row,
        mov,
        unit.moveType,
        positions,
        unit.faction,
        scene._getCostModifier(unit),
      );
      scene.grid.showMovementRange(moveRange, unit.col, unit.row, moveColor, moveAlpha);

      if (unit.weapon && !asleepPlayer) {
        const attackTiles = new Set();
        for (const [key, entry] of moveRange) {
          if (entry.stoppable === false) continue;
          const [mc, mr] = key.split(',').map(Number);
          for (const t of scene.grid.getAttackRange(mc, mr, unit.weapon)) {
            const tk = `${t.col},${t.row}`;
            if (!moveRange.has(tk)) attackTiles.add(tk);
          }
        }
        const tiles = Array.from(attackTiles).map((k) => {
          const [col, row] = k.split(',').map(Number);
          return { col, row };
        });
        scene.grid.showAttackRange(tiles);
      }
      if (unit.faction === 'enemy') this._showInspectedThreat(unit);
    }

    scene.refreshEndTurnControl();
    return true;
  }

  // Idle inspection of an enemy: its whole threat gets the Danger language's crisp
  // edge (focus variant) over the move/attack ranges. Self-clearing: the overlay
  // hides the frame the inspection panel stops showing that enemy, however the
  // inspection ended, so no clear path can leave a stale outline behind.
  _showInspectedThreat(unit) {
    const scene = this.scene;
    if (!scene?.grid || typeof scene.calculateDangerZone !== 'function') return;
    this._idleThreat ||= new DangerZoneOverlay(scene, scene.grid, { variant: 'focus', depth: 4.2 });
    this._idleThreat.show(scene.calculateDangerZone(unit));
    this._idleThreatUnit = unit;
    if (this._idleThreatTick) return;
    this._idleThreatTick = () => {
      const s = this.scene;
      const current =
        s?.battleState === 'PLAYER_IDLE' &&
        s.inspectionPanel?.visible &&
        s.inspectionPanel._unit === this._idleThreatUnit &&
        this._idleThreatUnit?.currentHP > 0;
      if (current) return;
      this._idleThreat?.hide();
      this._idleThreatUnit = null;
      s?.events?.off?.('update', this._idleThreatTick);
      this._idleThreatTick = null;
    };
    scene.events?.on?.('update', this._idleThreatTick);
  }

  clearInspectionVisuals() {
    if (this._planningInspection) {
      this.clearPlanningInspection();
      this.scene.refreshEndTurnControl();
      return;
    }
    const scene = this.scene;
    this._ballistaRangeShown = false;
    if (scene.inspectionPanel?.visible) scene.inspectionPanel.hide();
    scene.grid.clearHighlights();
    scene.grid.clearAttackHighlights();
    scene.refreshEndTurnControl();
  }

  toggleInspectMode() {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return;
    if (!scene.isMobileInput) return;
    scene.inspectMode = !scene.inspectMode;
    if (!scene.inspectMode) this.clearInspectionVisuals();
    scene.refreshEndTurnControl();
  }

  handleInspectModeTap(pointer, px, py) {
    const scene = this.scene;
    const gp = scene.grid.pixelToGrid(px, py);
    if (!gp) {
      if (this._isPointerOverInteractive(pointer)) return false;
      this.clearInspectionVisuals();
      return true;
    }
    if (this._showInspectionAtPixel(px, py)) {
      if (scene.inspectionPanel?._unit) {
        this.openUnitDetailOverlay();
        scene.inspectMode = false;
        this.clearInspectionVisuals();
      }
      return true;
    }
    this.clearInspectionVisuals();
    return true;
  }

  _isPointerOverInteractive(pointer) {
    const scene = this.scene;
    if (!scene.input || !pointer) return false;
    let hit = [];
    if (typeof scene.input.hitTestPointer === 'function') {
      hit = scene.input.hitTestPointer(pointer) || [];
    } else if (scene.input.manager?.hitTest) {
      hit = scene.input.manager.hitTest(pointer, scene.children.list, scene.cameras.main) || [];
      if (scene._uiCamera) {
        hit = hit.concat(
          scene.input.manager.hitTest(pointer, scene.children.list, scene._uiCamera) || [],
        );
      }
    }
    return (
      Array.isArray(hit) &&
      hit.some((obj) => obj && obj.visible !== false && obj.active !== false && obj.input?.enabled)
    );
  }

  updateTopLeftHudLayout() {
    const scene = this.scene;
    // The restyled desktop HUD owns its plate layout (turn/Eye fixed, hover info below).
    if (scene._desktopHud?.active) {
      scene._desktopHud.layout();
      return;
    }
    if (!scene.infoText || !scene.turnCounterText) return;
    const hasInfo = Boolean(scene.infoText.text);
    const baseY = 28;
    const stackedY = scene.infoText.y + scene.infoText.height + 4;
    const turnY = hasInfo ? Math.max(baseY, stackedY) : baseY;
    scene.turnCounterText.setY(turnY);
    if (scene.visionHudText) {
      scene.visionHudText.setY(turnY + scene.turnCounterText.height + 2);
    }
  }

  openUnitDetailOverlay() {
    const scene = this.scene;
    const { _unit, _terrain, _gameData } = scene.inspectionPanel;
    if (!canInspectUnit(scene.grid, _unit)) {
      scene.inspectionPanel.hide();
      return;
    }
    let pool;
    if (scene.enemyUnits?.includes(_unit)) {
      pool = scene.enemyUnits.filter((u) => u.currentHP > 0 && canInspectUnit(scene.grid, u));
    } else if (scene.npcUnits?.includes(_unit)) {
      pool = scene.npcUnits.filter((u) => u.currentHP > 0 && canInspectUnit(scene.grid, u));
    } else {
      pool = (scene.playerUnits || []).filter(
        (u) => u.currentHP > 0 && canInspectUnit(scene.grid, u),
      );
    }
    const rosterIndex = pool.indexOf(_unit) !== -1 ? pool.indexOf(_unit) : 0;
    const rosterOptions = pool.length > 0 ? { rosterUnits: pool, rosterIndex } : undefined;
    scene.unitDetailOverlay.show(_unit, _terrain, _gameData, rosterOptions);
    scene.refreshEndTurnControl();
  }

  destroy() {
    this._planningThreat?.hide();
    this._idleThreat?.hide();
    if (this._idleThreatTick) this.scene?.events?.off?.('update', this._idleThreatTick);
    this._idleThreatTick = null;
    this.scene = null;
  }
}
