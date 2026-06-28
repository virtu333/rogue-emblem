/**
 * DeployScreenOverlay — extracted from BattleScene.
 * Renders the deploy unit selection UI before battle.
 * Supports scroll, commander lock, ROSTER reopen, and BACK navigation.
 */
import { getDisplayLevel } from '../engine/UnitManager.js';
import { findCommander } from '../engine/Commander.js';
import { RosterOverlay } from '../ui/RosterOverlay.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { showImportantHint } from '../ui/HintDisplay.js';
import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

export class DeployScreenOverlay {
  /**
   * @param {object} scene     — the BattleScene (or mock) that owns this overlay
   * @param {object} runManager
   * @param {object} gameData
   */
  constructor(scene, runManager, gameData) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    /** @type {object[]} Phaser display objects for cleanup tracking */
    this.displayObjects = [];
    this._closed = false;
    this._detachInputHandlers = null;
    // Gamepad focus: a ring over the rows + footer buttons; scroll follows it.
    this._focus = null;
    this._onInputActionBound = null;
  }

  /**
   * Render the deploy selection UI.
   * @param {object[]} roster
   * @param {{ min: number, max: number }} limits
   * @param {(selectedRoster: object[]) => void} onConfirm
   * @param {Set<string>|null} initialSelectedNames
   */
  show(roster, limits, onConfirm, initialSelectedNames = null) {
    const scene = this.scene;
    const deployGroup = this.displayObjects;
    const cam = scene.cameras.main;

    // Dark overlay
    const overlay = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.92)
      .setDepth(700)
      .setInteractive();
    deployGroup.push(overlay);

    // Title
    const title = scene.add
      .text(cam.centerX, 28, 'DEPLOY UNITS', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(701);
    deployGroup.push(title);

    // Track selections
    const selected = new Set();
    const rowObjects = [];
    let scrollOffset = 0;

    // The commander always deploys (locked row, no click handler).
    const commanderIdx = roster.indexOf(findCommander(roster));
    const commanderName = commanderIdx !== -1 ? roster[commanderIdx].name : null;

    const serializeSelectedUnitNames = () => {
      const names = new Set();
      for (const idx of selected) {
        const name = roster[idx]?.name;
        if (typeof name === 'string' && name.length > 0) names.add(name);
      }
      return names;
    };

    const restoreSelectedUnitNames = (selectedNames) => {
      if (!(selectedNames instanceof Set) || selectedNames.size <= 0) return;
      for (let i = 0; i < roster.length; i++) {
        if (selected.size >= limits.max) break;
        const unitName = roster[i]?.name;
        if (!unitName || unitName === commanderName) continue;
        if (selectedNames.has(unitName)) selected.add(i);
      }
    };

    // Auto-select the commander (locked)
    if (commanderIdx !== -1) selected.add(commanderIdx);
    restoreSelectedUnitNames(initialSelectedNames);

    // Counter text
    const counterText = scene.add
      .text(cam.centerX, 52, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#88ccff',
      })
      .setOrigin(0.5)
      .setDepth(701);
    deployGroup.push(counterText);

    const updateCounter = () => {
      counterText.setText(`${selected.size} / ${limits.max}`);
      const canConfirm = selected.size >= limits.min && selected.size <= limits.max;
      confirmText.setColor(canConfirm ? '#44ff44' : '#666666');
    };

    // Objective banner -- escape maps reward fast movers, so the player needs
    // to know the objective before picking who deploys.
    const objective = scene.battleParams?.objective;
    if (objective) {
      const OBJECTIVE_BANNERS = {
        rout: { text: 'ROUT: Defeat all enemies', color: '#cccccc' },
        seize: {
          text: 'SEIZE: Defeat the boss, then capture the throne with a Lord',
          color: '#ffaa66',
        },
        escape: {
          text: 'ESCAPE: Only Lords must exit — others retreat safely when they do',
          color: '#a6ffb0',
        },
      };
      const banner = OBJECTIVE_BANNERS[objective];
      if (banner) {
        const objectiveText = scene.add
          .text(cam.centerX, 74, banner.text, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: banner.color,
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(701);
        deployGroup.push(objectiveText);
      }
    }

    // Roster list
    const rowHeight = 34;
    const startY = 100;
    const listWidth = 400;
    const confirmY = cam.height - 54;
    const listBottomY = confirmY - 28;
    const maxVisibleRows = Math.max(1, Math.floor((listBottomY - startY) / rowHeight) + 1);
    const maxScrollOffset = Math.max(0, roster.length - maxVisibleRows);
    const canScrollRows = maxScrollOffset > 0;
    const listLeft = cam.centerX - listWidth / 2;
    const listRight = cam.centerX + listWidth / 2;
    const rowTopBound = startY - rowHeight / 2;
    const rowBottomBound = listBottomY + rowHeight / 2;

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const ry = startY + i * rowHeight;
      const isCommander = i === commanderIdx;

      // Row background
      const rowBg = scene.add
        .rectangle(cam.centerX, ry, listWidth, rowHeight - 2, 0x222244, 0.8)
        .setDepth(701)
        .setInteractive({ useHandCursor: !isCommander });
      deployGroup.push(rowBg);

      // Checkbox
      const checkText = scene.add
        .text(cam.centerX - listWidth / 2 + 16, ry, '', {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(702);
      deployGroup.push(checkText);

      // Unit info
      const lvl = getDisplayLevel(unit);
      const cls = unit.className || '';
      const hp =
        unit.currentHP !== undefined ? `${unit.currentHP}/${unit.stats.HP}` : `${unit.stats.HP}`;
      const infoStr = `${unit.name}  Lv${lvl} ${cls}  HP ${hp}`;
      const infoText = scene.add
        .text(cam.centerX - listWidth / 2 + 40, ry, infoStr, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e0e0e0',
        })
        .setOrigin(0, 0.5)
        .setDepth(702);
      deployGroup.push(infoText);

      // Lock label for the commander
      let lockLabel = null;
      if (isCommander) {
        lockLabel = scene.add
          .text(cam.centerX + listWidth / 2 - 16, ry, 'LOCKED', {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#ffaa44',
          })
          .setOrigin(1, 0.5)
          .setDepth(702);
        deployGroup.push(lockLabel);
      }

      const updateRow = () => {
        const isSel = selected.has(i);
        checkText.setText(isSel ? '[X]' : '[ ]');
        rowBg.setFillStyle(isSel ? 0x334466 : 0x222244, 0.8);
        infoText.setColor(isSel ? '#ffffff' : '#999999');
      };

      rowObjects.push({
        index: i,
        isCommander,
        rowBg,
        checkText,
        infoText,
        lockLabel,
        updateRow,
      });

      // Click handler (skip the commander -- always locked)
      if (!isCommander) {
        rowBg.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          const audio = scene.registry.get('audio');
          if (selected.has(i)) {
            selected.delete(i);
            if (audio) audio.playSFX('sfx_cancel');
          } else if (selected.size < limits.max) {
            selected.add(i);
            if (audio) audio.playSFX('sfx_cursor');
          }
          for (const ro of rowObjects) ro.updateRow();
          updateCounter();
        });
      }

      updateRow();
    }

    const setVisibleSafe = (obj, visible) => {
      if (!obj) return;
      if (typeof obj.setVisible === 'function') {
        obj.setVisible(visible);
      } else {
        obj.visible = visible;
      }
    };

    const setRowInteractive = (rowObj, visible) => {
      if (!rowObj || rowObj.isCommander) return;
      if (visible) {
        if (typeof rowObj.rowBg.setInteractive === 'function') {
          rowObj.rowBg.setInteractive({ useHandCursor: true });
        }
        return;
      }
      if (typeof rowObj.rowBg.disableInteractive === 'function') rowObj.rowBg.disableInteractive();
    };

    const applyRowLayout = () => {
      for (const rowObj of rowObjects) {
        const visibleIdx = rowObj.index - scrollOffset;
        const visible = visibleIdx >= 0 && visibleIdx < maxVisibleRows;
        const rowY = startY + visibleIdx * rowHeight;
        rowObj.rowBg.y = rowY;
        rowObj.checkText.y = rowY;
        rowObj.infoText.y = rowY;
        if (rowObj.lockLabel) rowObj.lockLabel.y = rowY;
        setVisibleSafe(rowObj.rowBg, visible);
        setVisibleSafe(rowObj.checkText, visible);
        setVisibleSafe(rowObj.infoText, visible);
        if (rowObj.lockLabel) setVisibleSafe(rowObj.lockLabel, visible);
        setRowInteractive(rowObj, visible);
      }
    };

    const scrollX = cam.centerX + listWidth / 2 + 26;
    const scrollUp = scene.add
      .text(scrollX, startY, '^', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#88ccff',
      })
      .setOrigin(0.5)
      .setDepth(702);
    const scrollDown = scene.add
      .text(scrollX, listBottomY, 'v', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#88ccff',
      })
      .setOrigin(0.5)
      .setDepth(702);
    deployGroup.push(scrollUp);
    deployGroup.push(scrollDown);

    const updateScrollControls = () => {
      const upEnabled = canScrollRows && scrollOffset > 0;
      const downEnabled = canScrollRows && scrollOffset < maxScrollOffset;
      setVisibleSafe(scrollUp, canScrollRows);
      setVisibleSafe(scrollDown, canScrollRows);
      scrollUp.setColor(upEnabled ? '#88ccff' : '#555577');
      scrollDown.setColor(downEnabled ? '#88ccff' : '#555577');
    };

    const setScrollOffset = (nextOffset) => {
      const clamped = Math.max(0, Math.min(maxScrollOffset, nextOffset));
      if (clamped === scrollOffset) return;
      scrollOffset = clamped;
      applyRowLayout();
      updateScrollControls();
    };

    if (canScrollRows) {
      scrollUp.setInteractive({ useHandCursor: true });
      scrollDown.setInteractive({ useHandCursor: true });
      scrollUp.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        setScrollOffset(scrollOffset - 1);
      });
      scrollDown.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        setScrollOffset(scrollOffset + 1);
      });

      if (scene.input?.on && scene.input?.off) {
        const wheelHandler = (pointer, _gameObjects, _deltaX, deltaY) => {
          if (this._closed || !pointer || !deltaY) return;
          if (pointer.x < listLeft || pointer.x > listRight) return;
          if (pointer.y < rowTopBound || pointer.y > rowBottomBound) return;
          setScrollOffset(scrollOffset + (deltaY > 0 ? 1 : -1));
        };
        scene.input.on('wheel', wheelHandler);
        this._detachInputHandlers = () => scene.input.off('wheel', wheelHandler);
      }
    }

    // Confirm button (anchored near bottom so long rosters do not push controls off-screen)
    const confirmBg = scene.add
      .rectangle(cam.centerX, confirmY, 120, 32, 0x225522, 1)
      .setStrokeStyle(2, 0x44aa44)
      .setDepth(701)
      .setInteractive({ useHandCursor: true });
    deployGroup.push(confirmBg);

    const confirmText = scene.add
      .text(cam.centerX, confirmY, 'CONFIRM', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#666666',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(702);
    deployGroup.push(confirmText);

    confirmBg.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (selected.size < limits.min || selected.size > limits.max) return;
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');

      // Build selectedRoster in original roster order
      const selectedRoster = roster.filter((_, idx) => selected.has(idx));

      this._cleanup();

      onConfirm(selectedRoster);
    });

    const backText = scene.add
      .text(cam.centerX, confirmY + 22, 'BACK', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5)
      .setDepth(702)
      .setInteractive({ useHandCursor: true });
    backText.on('pointerover', () => backText.setColor('#ffdd44'));
    backText.on('pointerout', () => backText.setColor('#aaaaaa'));
    backText.on('pointerdown', async (pointer) => {
      if (pointer?.button !== 0) return;
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      if (!this.runManager) {
        console.warn(
          '[DeployScreenOverlay] BACK ignored: missing runManager for NodeMap transition.',
        );
        return;
      }
      try {
        const transitioned = await transitionToScene(
          scene,
          'NodeMap',
          {
            gameData: this.gameData,
            runManager: this.runManager,
          },
          { reason: TRANSITION_REASONS.BACK },
        );
        if (!transitioned) {
          console.warn('[DeployScreenOverlay] BACK transition to NodeMap failed.');
          return;
        }
        this._cleanup();
      } catch (err) {
        console.error('[DeployScreenOverlay] BACK transition error:', err);
      }
    });
    deployGroup.push(backText);

    const rosterText = scene.add
      .text(cam.centerX, confirmY + 38, 'ROSTER', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#88ccff',
      })
      .setOrigin(0.5)
      .setDepth(702)
      .setInteractive({ useHandCursor: true });
    rosterText.on('pointerover', () => rosterText.setColor('#ffdd44'));
    rosterText.on('pointerout', () => rosterText.setColor('#88ccff'));
    rosterText.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (!this.runManager || !this.gameData) return;
      if (scene.rosterOverlay?.visible) return;
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      const selectedNames = serializeSelectedUnitNames();
      this._cleanup();
      scene.rosterOverlay = new RosterOverlay(scene, this.runManager, this.gameData, {
        onClose: () => {
          scene.rosterOverlay = null;
          if (!scene.scene?.isActive?.()) return;
          const refreshedRoster = this.runManager?.getRoster?.() || roster;
          scene.roster = refreshedRoster;
          // Re-open through the BattleScene shim so battleState gets set
          scene.showDeployScreen(refreshedRoster, limits, onConfirm, selectedNames);
        },
      });
      scene.rosterOverlay.show();
    });
    deployGroup.push(rosterText);

    applyRowLayout();
    updateScrollControls();
    updateCounter();
    if (typeof scene._pinToScreen === 'function') {
      scene._pinToScreen(deployGroup);
    }

    // Tutorial hint for deploy screen
    const hints = scene.registry.get('hints');
    if (hints?.shouldShow('battle_deploy')) {
      showImportantHint(
        scene,
        'Click units to deploy them.\nYour commander always deploys. Click Confirm when ready.',
      );
    }

    // --- Gamepad/keyboard focus -------------------------------------------------
    // A gold ring over the unit rows + footer buttons (Confirm / Back / Roster).
    // NAVIGATE drives it; when it lands on a row, the list scrolls that row into
    // view. CONFIRM toggles a row (the commander row has no handler, so it's a
    // safe no-op) or presses a footer button. The ring is pinned to the screen
    // like the rest of the deploy UI. Released in _cleanup().
    const footerButtons = [confirmBg, backText, rosterText];
    this._focus = new BoundingFocusController(scene, 705);
    this._focus.setObjects([...rowObjects.map((ro) => ro.rowBg), ...footerButtons], true);
    if (this._focus.ring && typeof scene._pinToScreen === 'function') {
      scene._pinToScreen(this._focus.ring);
    }

    const ensureRowVisible = (rowIdx) => {
      if (rowIdx < scrollOffset) setScrollOffset(rowIdx);
      else if (rowIdx >= scrollOffset + maxVisibleRows)
        setScrollOffset(rowIdx - maxVisibleRows + 1);
    };

    const moveFocus = (delta) => {
      if (!delta || !this._focus) return;
      this._focus.move(delta);
      const idx = this._focus.index;
      if (idx >= 0 && idx < rowObjects.length) {
        ensureRowVisible(idx); // scroll the focused row into view ...
        this._focus.refresh(); // ... then reposition the ring on its new y
      }
    };

    this._onInputActionBound = (action, payload) => {
      switch (action) {
        case InputAction.NAVIGATE:
          moveFocus(payload?.dy || 0);
          break;
        case InputAction.CONFIRM:
          this._focus?.activate(); // toggle row / press footer button
          break;
        case InputAction.CANCEL:
          backText.emit('pointerdown', { button: 0 }); // BACK to NodeMap
          break;
        case InputAction.ROSTER:
          rosterText.emit('pointerdown', { button: 0 }); // open Roster
          break;
      }
    };
    pushInputScope(this, this._onInputActionBound);
  }

  _cleanup() {
    if (this._closed) return;
    this._closed = true;
    if (this._onInputActionBound) {
      popInputScope(this);
      this._onInputActionBound = null;
    }
    if (this._focus) {
      this._focus.destroy();
      this._focus = null;
    }
    // Clear stale reference on the owning scene.
    if (this.scene?._deployOverlay === this) this.scene._deployOverlay = null;
    if (typeof this._detachInputHandlers === 'function') {
      try {
        this._detachInputHandlers();
      } catch {
        // Ignore handler teardown failures during overlay close.
      }
      this._detachInputHandlers = null;
    }
    for (const obj of this.displayObjects) {
      try {
        obj.destroy();
      } catch {
        // Ignore teardown failures from already-destroyed display objects.
      }
    }
    this.displayObjects.length = 0;
  }
}
