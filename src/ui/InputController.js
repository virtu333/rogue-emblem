import { computeEffectivePath } from '../engine/Grid.js';
import { isSleeping } from '../engine/StatusConditionSystem.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import {
  TOOLTIP_LONG_PRESS_MS,
  TOOLTIP_LONG_PRESS_MOVE_THRESHOLD,
} from '../utils/tooltipTiming.js';

export class InputController {
  constructor(scene) {
    this.scene = scene;
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
      scene.cursorHighlight.setVisible(false);
      scene.infoText.setText('');
      this.updateTopLeftHudLayout();
      return;
    }

    const { x, y } = scene.grid.gridToPixel(gp.col, gp.row);
    scene.cursorHighlight.setPosition(x, y).setVisible(true);

    const terrain = scene.grid.getTerrainAt(gp.col, gp.row);
    let info = terrain.name;
    const hovered = scene.getUnitAt(gp.col, gp.row);
    const moveType = hovered ? hovered.moveType : 'Infantry';
    const moveCost = terrain.moveCost[moveType];
    info += ` | Move: ${moveCost}`;
    const avoidBonus = parseInt(terrain.avoidBonus, 10);
    if (avoidBonus) info += ` | Avo ${avoidBonus > 0 ? '+' : ''}${avoidBonus}`;
    if (parseInt(terrain.defBonus)) info += ` | Def +${terrain.defBonus}`;
    const specialText = typeof terrain.special === 'string' ? terrain.special.trim() : '';
    if (specialText) info += `\n${specialText}`;

    if (hovered && scene.grid.isVisible(gp.col, gp.row)) {
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

    if (scene.battleState === 'UNIT_SELECTED' && scene.selectedUnit && scene.movementRange) {
      const key = `${gp.col},${gp.row}`;
      const previewEntry = scene.movementRange.get(key);
      if (
        previewEntry &&
        previewEntry.stoppable !== false &&
        key !== `${scene.selectedUnit.col},${scene.selectedUnit.row}`
      ) {
        if (scene._lastPathPreviewKey === key) return;
        const icePath = scene.grid.reconstructIcePath(
          scene.movementRange,
          scene.selectedUnit.col,
          scene.selectedUnit.row,
          gp.col,
          gp.row,
        );
        const path =
          icePath ||
          scene.grid.findPath(
            scene.selectedUnit.col,
            scene.selectedUnit.row,
            gp.col,
            gp.row,
            scene.selectedUnit.moveType,
            scene.unitPositions,
            scene.selectedUnit.faction,
            scene._getCostModifier(scene.selectedUnit),
          );
        if (path) {
          const occupied = scene.buildOccupiedSet(scene.selectedUnit);
          const effective = computeEffectivePath(
            path,
            scene.grid.mapLayout,
            scene.grid.terrainData,
            scene.grid.cols,
            scene.grid.rows,
            scene.selectedUnit.moveType,
            occupied,
            scene._getCostModifier(scene.selectedUnit),
          );
          scene.grid.showPath(effective.effectivePath);
          for (const seg of effective.slideSegments) {
            scene.grid.showSlidePath(seg.slidePath);
          }
        }
        scene._lastPathPreviewKey = key;
      } else {
        scene.grid.clearPath();
        scene._lastPathPreviewKey = null;
      }
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
    } else {
      scene.inspectionPanel.hide();
      scene.grid.clearHighlights();
      scene.grid.clearAttackHighlights();
    }
  }

  handleSelectedClick(gp) {
    const scene = this.scene;
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

    if (gp.col === scene.selectedUnit.col && gp.row === scene.selectedUnit.row) {
      scene.grid.clearHighlights();
      if (scene.selectedUnit.graphic?.clearTint) scene.selectedUnit.graphic.clearTint();
      scene.preMoveLoc = { col: scene.selectedUnit.col, row: scene.selectedUnit.row };
      scene._preFogSnapshot = scene.grid.snapshotFogState();
      scene.showActionMenu(scene.selectedUnit);
      return;
    }

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

  handleActionMenuClick(gp) {
    // Clicks during action menu are handled by the menu buttons, not grid clicks
  }

  handleTargetClick(gp) {
    const scene = this.scene;
    const target = scene.attackTargets.find((t) => t.col === gp.col && t.row === gp.row);
    if (target) {
      scene.showForecast(scene.selectedUnit, target);
    }
  }

  handleForecastClick(gp) {
    const scene = this.scene;
    if (
      scene.forecastTarget &&
      gp.col === scene.forecastTarget.col &&
      gp.row === scene.forecastTarget.row
    ) {
      scene.confirmForecastCombat();
    }
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
      }
    });
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
    const zoom = Number(cam.zoom) || 1;
    return {
      x: (Number(cam.scrollX) || 0) + (x - (cam.x || 0)) / zoom,
      y: (Number(cam.scrollY) || 0) + (y - (cam.y || 0)) / zoom,
    };
  }

  _worldToScreen(x, y) {
    const scene = this.scene;
    if (scene._battleCamera) return scene._battleCamera.worldToScreen(x, y);
    const cam = scene.cameras?.main;
    if (!cam) return null;
    const zoom = Number(cam.zoom) || 1;
    return {
      x: (x - (Number(cam.scrollX) || 0)) * zoom + (cam.x || 0),
      y: (y - (Number(cam.scrollY) || 0)) * zoom + (cam.y || 0),
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
    if (!unit) return false;
    const terrain = scene.grid.getTerrainAt(unit.col, unit.row);
    scene.inspectionPanel.show(unit, terrain, scene.gameData);
    if (typeof scene._pinToScreen === 'function')
      scene._pinToScreen(scene.inspectionPanel?.objects);

    if (scene.battleState === 'PLAYER_IDLE') {
      const isPlayer = unit.faction === 'player';
      const moveColor = isPlayer ? 0x3366cc : 0xcc3333;
      const moveAlpha = isPlayer ? 0.4 : 0.35;
      const positions = scene.buildUnitPositionMap(unit.faction);
      const mov = unit.mov ?? unit.stats?.MOV ?? 0;
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

      if (unit.weapon) {
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
    }

    scene.refreshEndTurnControl();
    return true;
  }

  clearInspectionVisuals() {
    const scene = this.scene;
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
    if (this._showInspectionAtPixel(px, py)) return true;
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
    if (!_unit) return;
    let pool;
    if (scene.enemyUnits?.includes(_unit)) {
      pool = scene.enemyUnits.filter((u) => u.currentHP > 0);
    } else if (scene.npcUnits?.includes(_unit)) {
      pool = scene.npcUnits.filter((u) => u.currentHP > 0);
    } else {
      pool = (scene.playerUnits || []).filter((u) => u.currentHP > 0);
    }
    const rosterIndex = pool.indexOf(_unit) !== -1 ? pool.indexOf(_unit) : 0;
    const rosterOptions = pool.length > 0 ? { rosterUnits: pool, rosterIndex } : undefined;
    scene.unitDetailOverlay.show(_unit, _terrain, _gameData, rosterOptions);
    scene.refreshEndTurnControl();
  }

  destroy() {
    this.scene = null;
  }
}
