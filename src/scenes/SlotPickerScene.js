import { applyCompletedTutorialHints } from '../ui/tutorialLessons.js';
import {
  getCloudSaveConflict,
  resolveCloudSaveConflict,
  describeSavedRun,
} from '../engine/CloudSaveConflict.js';
import { hasDOMHost } from '../utils/domUI.js';
import { slotMenu, slotDialog } from '../ui/RunFlowMenus.js';
import { UI_PALETTE, UI_HEX, applyTextResolution } from '../utils/uiStyles.js';
// SlotPickerScene — Save slot selection screen

import Phaser from 'phaser';
import {
  MAX_SLOTS,
  getSlotSummary,
  deleteSlot,
  setActiveSlot,
  getMetaKey,
} from '../engine/SlotManager.js';
import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { HintManager } from '../engine/HintManager.js';
import { loadRun, saveRun, clearBattleInProgressInSave } from '../engine/RunManager.js';
import { MUSIC } from '../utils/musicConfig.js';
import { pushMeta, pushRunSave, deleteSlotCloud } from '../cloud/CloudSync.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';
import { isTouchPointer } from '../utils/runtimeFlags.js';
import { MenuFocusController } from '../ui/MenuFocusController.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { isFirstRunSlot, startFirstRunFastPath } from '../utils/firstRunFastPath.js';

export class SlotPickerScene extends Phaser.Scene {
  constructor() {
    super('SlotPicker');
  }

  init(data) {
    this.gameData = data.gameData || data;
    this.isTransitioning = false;
    this.resumeSlot =
      Number.isInteger(data.resumeSlot) && data.resumeSlot >= 1 && data.resumeSlot <= MAX_SLOTS
        ? data.resumeSlot
        : null;
  }

  create() {
    if (Number.isInteger(this.resumeSlot)) {
      const slot = this.resumeSlot;
      this.resumeSlot = null;
      this._resumeTimer = this.time.delayedCall(0, () => {
        this._resumeTimer = null;
        if (this.sys?.isActive?.() === false) return;
        const summary = getSlotSummary(slot);
        if (summary?.hasActiveRun && !summary.runCorrupt) void this.selectSlot(slot, summary);
      });
    }
    const cx = this.cameras.main.centerX;
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;
    this._onEsc = () => this.requestCancel();

    // Keep the title theme going — Title releases its music on shutdown,
    // which used to leave this scene silent until HomeBase/NodeMap.
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.title, this, 300);

    if (!hasDOMHost())
      applyTextResolution(
        this.add.text(cx, 40, 'SELECT SAVE SLOT', {
          fontFamily: 'Arial',
          fontSize: '24px',
          color: UI_PALETTE.accent,
          fontStyle: 'bold',
        }),
      ).setOrigin(0.5);

    this._onPointerDown = (pointer) => {
      this._touchTapDown = { x: pointer.x, y: pointer.y };
    };
    this._onPointerUp = (pointer) => this.onPointerUp(pointer);

    this.events.once('shutdown', () => {
      this._resumeTimer?.remove?.();
      this._resumeTimer = null;
      this.slotMenu?.destroy();
      this.slotMenu = null;
      this.nativeDialog?.destroy();
      this.nativeDialog = null;
      this.input?.keyboard?.off?.('keydown-ESC', this._onEsc);
      this.input?.off?.('pointerdown', this._onPointerDown);
      this.input?.off?.('pointerup', this._onPointerUp);
      this._onEsc = null;
      this._onPointerDown = null;
      this._onPointerUp = null;
      popInputScope(this);
      this._onInputActionBound = null;
      if (this._slotFocus) {
        this._slotFocus.destroy();
        this._slotFocus = null;
      }
      if (this._dialogFocus) {
        this._dialogFocus.destroy();
        this._dialogFocus = null;
      }
    });

    if (hasDOMHost()) {
      this.slotMenu = slotMenu(this);
      return;
    }

    this.input.keyboard.on('keydown-ESC', this._onEsc);
    this.input.on('pointerdown', this._onPointerDown);
    this.input.on('pointerup', this._onPointerUp);

    this.drawSlots();

    // Back button
    const backBtn = applyTextResolution(
      this.add.text(cx, 420, '[ Back to Title ]', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.text,
        backgroundColor: '#000000aa',
        padding: { x: 16, y: 8 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor(UI_PALETTE.accent));
    backBtn.on('pointerout', () => backBtn.setColor(UI_PALETTE.text));
    backBtn.on('pointerdown', async () => {
      await this.runTransition(() =>
        transitionToScene(
          this,
          'Title',
          { gameData: this.gameData },
          { reason: TRANSITION_REASONS.BACK },
        ),
      );
    });

    // Gamepad: focus over each slot's Select button + Back. Built after drawSlots
    // and Back exist; rebuilt whenever the slot list redraws.
    this._backBtn = backBtn;
    this._slotFocus = new MenuFocusController(this);
    this._refreshSlotFocus();
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
  }

  // Reuse a button's own pointer hover/press visuals for controller focus.
  // Optional chaining guards against a button destroyed by a list redraw.
  _focusItem(button, slot = null) {
    return {
      button,
      slot,
      onFocus: () => button?.emit?.('pointerover'),
      onBlur: () => button?.emit?.('pointerout'),
      onActivate: () => button?.emit?.('pointerdown'),
    };
  }

  _refreshSlotFocus() {
    if (!this._slotFocus) return;
    const items = (this._slotFocusEntries || []).map((e) => this._focusItem(e.selectBtn, e.slot));
    if (this._backBtn) items.push(this._focusItem(this._backBtn));
    this._slotFocus.setItems(items);
  }

  _onInputAction(action, payload) {
    // A modal (delete confirm / suspended-battle choice) owns input while open.
    const dialogOpen = Boolean(this.confirmDialog);
    if (!dialogOpen && this._dialogFocus) {
      this._dialogFocus.destroy();
      this._dialogFocus = null;
      this._refreshSlotFocus(); // restore the base-list highlight
    }
    const focus = dialogOpen ? this._dialogFocus : this._slotFocus;
    switch (action) {
      case InputAction.NAVIGATE: {
        const d = payload?.dx || payload?.dy;
        if (d) focus?.move(d);
        break;
      }
      case InputAction.CONFIRM:
        focus?.activate();
        break;
      case InputAction.CANCEL:
        this.requestCancel({ allowExit: !dialogOpen });
        break;
      case InputAction.DANGER: {
        // X deletes the focused slot (no-op on Back or while a modal is open).
        if (dialogOpen || !this._slotFocus?.isActive) break;
        const item = this._slotFocus.items[this._slotFocus.index];
        if (item?.slot != null) this.confirmDelete(item.slot);
        break;
      }
    }
  }

  onPointerUp(pointer) {
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;
    if (isTouchPointer(pointer) && this._touchTapDown) {
      const dx = pointer.x - this._touchTapDown.x;
      const dy = pointer.y - this._touchTapDown.y;
      if (dx * dx + dy * dy > this._tapMoveThreshold * this._tapMoveThreshold) {
        this._touchTapDown = null;
        return;
      }
    }
    this._touchTapDown = null;
    if (!this.confirmDialog) return;
    if (this._isPointerOverInteractive(pointer)) return;
    this.requestCancel({ allowExit: false });
  }

  _isPointerOverInteractive(pointer) {
    if (!this.input || !pointer) return false;
    let hit = [];
    if (typeof this.input.hitTestPointer === 'function') {
      hit = this.input.hitTestPointer(pointer) || [];
    } else if (this.input.manager?.hitTest) {
      hit = this.input.manager.hitTest(pointer, this.children.list, this.cameras.main) || [];
    }
    return (
      Array.isArray(hit) &&
      hit.some((obj) => obj && obj.visible !== false && obj.active !== false && obj.input?.enabled)
    );
  }

  requestCancel({ allowExit = true } = {}) {
    if (this.isTransitioning) return false;
    if (this.nativeDialog) {
      if (this.slotMenu) this.slotMenu.root.inert = false;
      this.nativeDialog.destroy();
      this.nativeDialog = null;
      return true;
    }
    if (this.confirmDialog) {
      this.confirmDialog.forEach((o) => o.destroy());
      this.confirmDialog = null;
      return true;
    }
    if (allowExit) {
      void this.runTransition(() =>
        transitionToScene(
          this,
          'Title',
          { gameData: this.gameData },
          { reason: TRANSITION_REASONS.BACK },
        ),
      );
      return true;
    }
    return false;
  }

  drawSlots() {
    if (this.slotMenu) return this.slotMenu.render();
    // Clear previous slot cards if redrawing
    if (this.slotCards) this.slotCards.forEach((o) => o.destroy());
    this.slotCards = [];
    this._slotFocusEntries = [];

    const cx = this.cameras.main.centerX;
    const cardW = 160;
    const cardH = 200;
    const gap = 20;
    const totalW = MAX_SLOTS * cardW + (MAX_SLOTS - 1) * gap;
    const startX = cx - totalW / 2 + cardW / 2;
    const cardY = 200;

    for (let i = 1; i <= MAX_SLOTS; i++) {
      const x = startX + (i - 1) * (cardW + gap);
      this.drawSlotCard(i, x, cardY, cardW, cardH);
    }
    this._refreshSlotFocus();
  }

  drawSlotCard(slot, x, y, w, h) {
    const summary = getSlotSummary(slot);
    const isEmpty = !summary;

    // Card background
    const bg = this.add
      .rectangle(x, y, w, h, UI_HEX.panel)
      .setStrokeStyle(2, isEmpty ? UI_HEX.lineSoft : UI_HEX.lineStrong);
    this.slotCards.push(bg);

    // Slot header
    const header = applyTextResolution(
      this.add.text(x, y - h / 2 + 16, `Slot ${slot}`, {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.accent,
        fontStyle: 'bold',
      }),
    ).setOrigin(0.5);
    this.slotCards.push(header);

    if (isEmpty) {
      const emptyText = applyTextResolution(
        this.add.text(x, y, 'No save\nChoose New Game\nfrom Title', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.muted,
          align: 'center',
          lineSpacing: 6,
        }),
      ).setOrigin(0.5);
      this.slotCards.push(emptyText);
    } else {
      // Valor
      const valorText = applyTextResolution(
        this.add.text(x, y - 58, `Valor: ${summary.valor}`, {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: UI_PALETTE.accentText,
        }),
      ).setOrigin(0.5);
      this.slotCards.push(valorText);

      // Supply
      const supplyText = applyTextResolution(
        this.add.text(x, y - 42, `Supply: ${summary.supply}`, {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: UI_PALETTE.info,
        }),
      ).setOrigin(0.5);
      this.slotCards.push(supplyText);

      // Runs: started vs finished (finished = settled victories + defeats)
      const runsText = applyTextResolution(
        this.add.text(x, y - 26, `Runs: ${summary.runsStarted}`, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.text,
        }),
      ).setOrigin(0.5);
      this.slotCards.push(runsText);
      const finishedText = applyTextResolution(
        this.add.text(x, y - 12, `Finished: ${summary.runsCompleted}`, {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: UI_PALETTE.muted,
        }),
      ).setOrigin(0.5);
      this.slotCards.push(finishedText);

      // Active run status
      let runStatus;
      let statusColor;
      if (summary.runCorrupt) {
        runStatus = 'Save data corrupted';
        statusColor = UI_PALETTE.bad;
      } else if (summary.hasActiveRun) {
        runStatus = `Act ${summary.actReached} in progress`;
        statusColor = UI_PALETTE.good;
      } else {
        runStatus = 'No active run';
        statusColor = UI_PALETTE.muted;
      }
      const statusText = applyTextResolution(
        this.add.text(x, y + 6, runStatus, {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: statusColor,
        }),
      ).setOrigin(0.5);
      this.slotCards.push(statusText);

      // Select button
      const selectBtn = applyTextResolution(
        this.add.text(x, y + 40, '[ Select ]', {
          fontFamily: 'Arial',
          fontSize: '14px',
          color: UI_PALETTE.good,
          backgroundColor: UI_PALETTE.selected,
          padding: { x: 12, y: 6 },
        }),
      )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      selectBtn.on('pointerover', () => selectBtn.setColor(UI_PALETTE.accent));
      selectBtn.on('pointerout', () => selectBtn.setColor(UI_PALETTE.good));
      selectBtn.on('pointerdown', () => this.selectSlot(slot, summary));
      this.slotCards.push(selectBtn);

      // Delete button
      const deleteBtn = applyTextResolution(
        this.add.text(x, y + 72, '[ Delete ]', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.bad,
          backgroundColor: UI_PALETTE.dangerBg,
          padding: { x: 8, y: 4 },
        }),
      )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      deleteBtn.on('pointerover', () => deleteBtn.setColor(UI_PALETTE.bad));
      deleteBtn.on('pointerout', () => deleteBtn.setColor(UI_PALETTE.bad));
      deleteBtn.on('pointerdown', () => this.confirmDelete(slot));
      this.slotCards.push(deleteBtn);

      // Register the slot's Select as a controller focus target (X deletes it).
      this._slotFocusEntries.push({ slot, summary, selectBtn, deleteBtn });
    }
  }
  _showCloudChoice(slot, conflict) {
    if (this.nativeDialog) return;
    if (this.slotMenu) this.slotMenu.root.inert = true;
    const choose = (version) => {
      const result = resolveCloudSaveConflict(slot, version);
      if (!result.ok) {
        this.nativeDialog.body.append(document.createTextNode(result.reason));
        return;
      }
      const cloud = this.registry.get('cloud');
      if (version === 'local' && cloud) {
        if (result.run) pushRunSave(cloud.userId, slot, result.run);
        if (result.meta) pushMeta(cloud.userId, slot, result.meta);
      }
      this.requestCancel({ allowExit: false });
      this.slotMenu?.render();
      void this.selectSlot(slot, getSlotSummary(slot));
    };
    this.nativeDialog = slotDialog(
      this,
      'Choose save version',
      `A newer cloud save differs from this device. Both versions were preserved for this choice.\n\nThis device: ${describeSavedRun(conflict.localRun)}\n\nCloud: ${describeSavedRun(conflict.cloudRun)}\n\nChoosing a version keeps that run and its progression; the other version will be discarded.`,
      [
        ['Decide later', () => this.requestCancel({ allowExit: false }), true],
        ['Use this device save', () => choose('local')],
        ['Use cloud save', () => choose('cloud')],
      ],
    );
  }

  async selectSlot(slot, summary) {
    if (this.isTransitioning) return;
    const conflict = getCloudSaveConflict(slot);
    if (conflict && hasDOMHost()) {
      this._showCloudChoice(slot, conflict);
      return;
    }
    this.isTransitioning = true;
    if (this.input) this.input.enabled = false;

    const prevMeta = this.registry.get('meta');
    const prevHints = this.registry.get('hints');
    const prevActiveSlot = this.registry.get('activeSlot');
    const hadPrevMeta = prevMeta !== undefined;
    const hadPrevHints = prevHints !== undefined;
    const hadPrevActiveSlot = prevActiveSlot !== undefined;
    const rollbackSelectionState = () => {
      if (hadPrevMeta) this.registry.set('meta', prevMeta);
      else if (typeof this.registry.remove === 'function') this.registry.remove('meta');
      else this.registry.set('meta', undefined);

      if (hadPrevHints) this.registry.set('hints', prevHints);
      else if (typeof this.registry.remove === 'function') this.registry.remove('hints');
      else this.registry.set('hints', undefined);

      if (hadPrevActiveSlot) this.registry.set('activeSlot', prevActiveSlot);
      else if (typeof this.registry.remove === 'function') this.registry.remove('activeSlot');
      else this.registry.set('activeSlot', undefined);
    };

    // Stage slot state in registry before transition; persist active slot only on success.
    const meta = new MetaProgressionManager(this.gameData.metaUpgrades, getMetaKey(slot));
    const cloud = this.registry.get('cloud');
    if (cloud) {
      meta.onSave = (payload) => pushMeta(cloud.userId, slot, payload);
    }
    this.registry.set('activeSlot', slot);
    this.registry.set('meta', meta);
    this.registry.set(
      'hints',
      new HintManager(slot, () => this.registry.get('settings')?.getHints?.() !== false, meta),
    );
    applyCompletedTutorialHints(this.registry.get('hints'));

    try {
      await ensureAudioUnlocked(this);
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);

      let transitioned = false;
      if (summary.hasActiveRun) {
        // Resume active run directly
        const rm = loadRun(this.gameData, slot);
        if (rm && rm.status !== 'defeat' && rm.battleInProgress?.checkpoint) {
          // Suspended mid-battle — let the player choose how to continue
          // before any transition starts.
          this.isTransitioning = false;
          if (this.input) this.input.enabled = true;
          this._showSuspendedBattleChoice(slot, rm);
          return;
        }
        if (rm && rm.status === 'defeat') {
          // An interrupted battle settled into a loss on load (the commander fell with
          // no Vision charge to spend) — show the game-over flow instead of
          // resuming; RunComplete settles rewards and clears the save.
          transitioned = await transitionToScene(
            this,
            'RunComplete',
            { gameData: this.gameData, runManager: rm, result: 'defeat' },
            { reason: TRANSITION_REASONS.CONTINUE },
          );
        } else if (rm) {
          transitioned = await transitionToScene(
            this,
            'NodeMap',
            { gameData: this.gameData, runManager: rm },
            { reason: TRANSITION_REASONS.CONTINUE },
          );
        } else {
          // Run data corrupt - go to HomeBase
          transitioned = await transitionToScene(
            this,
            'HomeBase',
            { gameData: this.gameData, corruptRunDetected: true },
            { reason: TRANSITION_REASONS.CONTINUE },
          );
        }
      } else if (isFirstRunSlot(summary)) {
        // Brand-new save (fresh meta, no run started yet): skip HomeBase /
        // DifficultySelect / BlessingSelect straight to the act-1 node map.
        transitioned = await startFirstRunFastPath(this, { gameData: this.gameData, slot });
      } else {
        // No active run - go to HomeBase
        transitioned = await transitionToScene(
          this,
          'HomeBase',
          { gameData: this.gameData, corruptRunDetected: summary.runCorrupt || false },
          { reason: TRANSITION_REASONS.CONTINUE },
        );
      }
      if (transitioned === false) {
        rollbackSelectionState();
        this.isTransitioning = false;
        if (this.input) this.input.enabled = true;
      }
      if (transitioned) setActiveSlot(slot);
    } catch (err) {
      console.error('[SlotPickerScene] selectSlot transition failed:', err);
      rollbackSelectionState();
      this.isTransitioning = false;
      if (this.input) this.input.enabled = true;
    }
  }

  /**
   * Which continue paths a suspended battle allows. Resume needs a readable
   * checkpoint; the map revert is refused for a fatal-pending checkpoint (its
   * outcome must be decided); a fatal checkpoint that cannot be read can only
   * be settled as the defeat it records. Every state keeps at least one exit
   * that preserves the slot — deleting the save is never the only way out.
   */
  _suspendedBattleOptions(rm) {
    const fatal = rm.battleInProgress?.checkpoint?.recoveryKind === 'fatal_pending';
    const invalid = rm._battleRecoveryInvalid === true;
    const restoreFailed = rm._battleRecoveryRestoreFailed === true;
    return {
      fatal,
      invalid,
      restoreFailed,
      legacy: invalid && rm._battleRecoveryLegacy === true,
      canResume: !invalid,
      canRevert: !fatal,
      canAcceptDefeat: fatal && (invalid || restoreFailed),
    };
  }

  _suspendedBattleCopy(options) {
    if (options.invalid && options.fatal)
      return {
        title: 'Battle save needs recovery',
        body: 'Your commander fell in this battle, but its timeline could not be read safely, so it cannot be reviewed or rewound. Accept defeat to end this run and collect its rewards.',
      };
    if (options.fatal && options.restoreFailed)
      return {
        title: 'Battle save needs recovery',
        body: 'Your commander fell in this battle, and it could not be reopened last time. Resume to try again, or accept defeat to end this run and collect its rewards.',
      };
    if (options.legacy)
      return {
        title: 'Battle saved by an older version',
        body: 'This battle was saved before an update and can no longer be resumed exactly. Continue from Map restarts it from the route map with your pre-battle Vision charges restored. The rest of this slot is unchanged.',
      };
    if (options.invalid)
      return {
        title: 'Battle save needs recovery',
        body: 'This battle checkpoint could not be read safely, so it cannot be resumed. Continue from Map restarts the battle from the route map with your pre-battle Vision charges restored.',
      };
    if (options.fatal)
      return {
        title: 'Battle in progress',
        body: 'A fatal battle outcome awaits your decision. Resume to review the timeline or accept defeat.',
      };
    return {
      title: 'Battle in progress',
      body: 'Resume your saved turn, or return to the map to restart this battle. Returning to the map restores the Vision charges from before battle.',
    };
  }

  /**
   * Continue choice for a save suspended mid-battle: Resume Battle restores
   * the suspend checkpoint exactly; Continue from Map is the sanctioned full
   * revert (classic FE reset) — the battle resets and entry-time Vision/RNG
   * values are refunded. Registered as confirmDialog so ESC/outside-tap
   * dismisses it back to the slot list.
   */
  _showSuspendedBattleChoice(slot, rm) {
    const options = this._suspendedBattleOptions(rm);
    const copy = this._suspendedBattleCopy(options);
    const actions = [
      options.canResume && ['Resume Battle', () => this._continueSuspendedRun(slot, rm, 'battle')],
      options.canRevert && ['Continue from Map', () => this._continueSuspendedRun(slot, rm, 'map')],
      options.canAcceptDefeat && [
        'Accept defeat',
        () => this._continueSuspendedRun(slot, rm, 'defeat'),
      ],
    ].filter(Boolean);
    if (hasDOMHost()) {
      this.nativeDialog?.destroy();
      if (this.slotMenu) this.slotMenu.root.inert = true;
      this.nativeDialog = slotDialog(
        this,
        copy.title,
        copy.body,
        actions.map(([label, act], index) => [label, act, index === 0]),
      );
      return;
    }
    if (this.confirmDialog) {
      this.confirmDialog.forEach((o) => o.destroy());
      this.confirmDialog = null;
    }
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;
    const objects = [];

    const blocker = this.add
      .rectangle(cx, cy, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.75)
      .setDepth(500)
      .setInteractive();
    objects.push(blocker);
    const panel = this.add
      .rectangle(cx, cy, 380, 180, UI_HEX.panel, 0.96)
      .setDepth(501)
      .setStrokeStyle(2, UI_HEX.line, 1);
    objects.push(panel);
    objects.push(
      applyTextResolution(
        this.add.text(cx, cy - 58, copy.title, {
          fontFamily: 'Arial',
          fontSize: '16px',
          color: UI_PALETTE.accentText,
          fontStyle: 'bold',
        }),
      )
        .setOrigin(0.5)
        .setDepth(502),
    );
    objects.push(
      applyTextResolution(
        this.add.text(cx, cy - 18, copy.body, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.text,
          align: 'center',
          wordWrap: { width: 340 },
        }),
      )
        .setOrigin(0.5)
        .setDepth(502),
    );

    const focusButtons = [];
    const makeButton = (x, label, color, handler) => {
      const btn = applyTextResolution(
        this.add.text(x, cy + 52, label, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color,
          backgroundColor: '#223044',
          padding: { x: 10, y: 5 },
        }),
      )
        .setOrigin(0.5)
        .setDepth(502)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor(UI_PALETTE.accent));
      btn.on('pointerout', () => btn.setColor(color));
      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== undefined && pointer.button !== 0) return;
        handler();
      });
      objects.push(btn);
      focusButtons.push(btn);
    };
    actions.forEach(([label, act], index) => {
      const x = actions.length === 1 ? cx : index === 0 ? cx - 92 : cx + 92;
      makeButton(x, `[ ${label} ]`, index === 0 ? UI_PALETTE.good : UI_PALETTE.text, act);
    });

    this.confirmDialog = objects;
    this._setDialogFocus(focusButtons);
  }

  // Give the gamepad focus to a modal's buttons while it is open; the base slot
  // list is restored when the modal closes (reconciled in _onInputAction).
  _setDialogFocus(buttons) {
    if (!this._slotFocus) return; // gamepad path not active (e.g. headless test)
    this._slotFocus.clear(); // drop the base highlight behind the modal
    if (this._dialogFocus) this._dialogFocus.destroy();
    this._dialogFocus = new MenuFocusController(this);
    this._dialogFocus.setItems(buttons.filter(Boolean).map((b) => this._focusItem(b)));
  }

  async _continueSuspendedRun(slot, rm, mode) {
    if (this.isTransitioning) return;
    const options = this._suspendedBattleOptions(rm);
    const allowed =
      mode === 'battle'
        ? options.canResume
        : mode === 'map'
          ? options.canRevert
          : mode === 'defeat' && options.canAcceptDefeat;
    if (!allowed) {
      this._showSuspendedBattleChoice(slot, rm);
      return;
    }
    this.isTransitioning = true;
    if (this.input) this.input.enabled = false;
    if (this.confirmDialog) {
      this.confirmDialog.forEach((o) => o.destroy());
      this.confirmDialog = null;
    }
    if (this.slotMenu) this.slotMenu.root.inert = false;
    this.nativeDialog?.destroy();
    this.nativeDialog = null;
    try {
      await ensureAudioUnlocked(this);
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      const cloud = this.registry.get('cloud');
      const bip = rm.battleInProgress;
      let transitioned = false;
      if (mode === 'battle' && bip?.checkpoint) {
        transitioned = await transitionToScene(
          this,
          'Battle',
          {
            gameData: this.gameData,
            runManager: rm,
            battleParams: bip.battleParams || { act: rm.currentAct, objective: 'rout' },
            roster: rm.getRoster(),
            nodeId: bip.nodeId,
            isBoss: bip.isBoss === true,
            isElite: bip.isElite === true,
            resumeCheckpoint: bip.checkpoint,
          },
          { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
        );
      } else if (mode === 'defeat') {
        // The checkpoint recorded the commander's fall but cannot be read to
        // review it: settle the recorded defeat. Persist it first so a reload
        // lands on the same game-over, never back on a free revert.
        rm.failRun();
        const saved = saveRun(rm, cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null, slot);
        if (!saved?.ok) {
          this.isTransitioning = false;
          if (this.input) this.input.enabled = true;
          this._showSuspendedBattleChoice(slot, loadRun(this.gameData, slot) || rm);
          return;
        }
        transitioned = await transitionToScene(
          this,
          'RunComplete',
          { gameData: this.gameData, runManager: rm, result: 'defeat' },
          { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
        );
      } else {
        const reset = clearBattleInProgressInSave(
          cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null,
          slot,
        );
        if (!reset?.ok) {
          this.isTransitioning = false;
          if (this.input) this.input.enabled = true;
          this._showSuspendedBattleChoice(slot, rm);
          return;
        }
        // Full revert: restore the entry-time run state and refund Vision
        // charges and RNG seed in memory, matching the raw save scrubbed above.
        rm.revertBattleInProgressToEntry();
        transitioned = await transitionToScene(
          this,
          'NodeMap',
          { gameData: this.gameData, runManager: rm },
          { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
        );
      }
      if (transitioned === false) {
        this.isTransitioning = false;
        if (this.input) this.input.enabled = true;
      }
      if (transitioned) setActiveSlot(slot);
    } catch (err) {
      console.error('[SlotPickerScene] suspended-run continue failed:', err);
      this.isTransitioning = false;
      if (this.input) this.input.enabled = true;
    }
  }

  async runTransition(action) {
    if (this.isTransitioning) return false;
    this.isTransitioning = true;
    if (this.input) this.input.enabled = false;
    try {
      await ensureAudioUnlocked(this);
      const transitioned = await action();
      if (transitioned === false) {
        this.isTransitioning = false;
        if (this.input) this.input.enabled = true;
      }
      return transitioned;
    } catch (err) {
      console.error('[SlotPickerScene] transition failed:', err);
      this.isTransitioning = false;
      if (this.input) this.input.enabled = true;
      return false;
    }
  }

  confirmDelete(slot) {
    if (this.isTransitioning) return;
    if (hasDOMHost()) {
      this.nativeDialog?.destroy();
      if (this.slotMenu) this.slotMenu.root.inert = true;
      this.nativeDialog = slotDialog(
        this,
        `Delete Slot ${slot}?`,
        'This deletes the run and all progress in this slot. This cannot be undone.',
        [
          ['Cancel', () => this.requestCancel({ allowExit: false }), true],
          [
            'Delete save',
            () => {
              if (!this.nativeDialog || this.nativeDialog.destroyed) return;
              deleteSlot(slot);
              const cloud = this.registry.get('cloud');
              if (cloud) deleteSlotCloud(cloud.userId, slot);
              this.requestCancel({ allowExit: false });
              this.drawSlots();
            },
          ],
        ],
      );
      return;
    }
    // Show confirmation dialog
    if (this.confirmDialog) this.confirmDialog.forEach((o) => o.destroy());
    this.confirmDialog = [];

    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    const overlay = this.add
      .rectangle(cx, cy, 640, 480, 0x000000, 0.7)
      .setDepth(500)
      .setInteractive();
    overlay.on('pointerdown', () => this.requestCancel({ allowExit: false }));
    this.confirmDialog.push(overlay);

    const box = this.add
      .rectangle(cx, cy, 300, 140, UI_HEX.panel, 1)
      .setStrokeStyle(2, UI_HEX.dangerLine)
      .setDepth(501);
    this.confirmDialog.push(box);

    const msg = applyTextResolution(
      this.add.text(cx, cy - 30, `Delete Slot ${slot}?`, {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.bad,
        fontStyle: 'bold',
      }),
    )
      .setOrigin(0.5)
      .setDepth(502);
    this.confirmDialog.push(msg);

    const warning = applyTextResolution(
      this.add.text(cx, cy - 8, 'This cannot be undone.', {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: UI_PALETTE.muted,
      }),
    )
      .setOrigin(0.5)
      .setDepth(502);
    this.confirmDialog.push(warning);

    // Confirm button
    const yesBtn = applyTextResolution(
      this.add.text(cx - 60, cy + 30, '[ Delete ]', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.bad,
        backgroundColor: UI_PALETTE.dangerBg,
        padding: { x: 10, y: 6 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(502)
      .setInteractive({ useHandCursor: true });

    yesBtn.on('pointerover', () => yesBtn.setColor(UI_PALETTE.bad));
    yesBtn.on('pointerout', () => yesBtn.setColor(UI_PALETTE.bad));
    yesBtn.on('pointerdown', () => {
      deleteSlot(slot);
      const cloud = this.registry.get('cloud');
      if (cloud) deleteSlotCloud(cloud.userId, slot);
      this.confirmDialog.forEach((o) => o.destroy());
      this.confirmDialog = null;
      this.drawSlots();
    });
    this.confirmDialog.push(yesBtn);

    // Cancel button
    const noBtn = applyTextResolution(
      this.add.text(cx + 60, cy + 30, '[ Cancel ]', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.text,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 10, y: 6 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(502)
      .setInteractive({ useHandCursor: true });

    noBtn.on('pointerover', () => noBtn.setColor(UI_PALETTE.accent));
    noBtn.on('pointerout', () => noBtn.setColor(UI_PALETTE.text));
    noBtn.on('pointerdown', () => {
      this.confirmDialog.forEach((o) => o.destroy());
      this.confirmDialog = null;
    });
    this.confirmDialog.push(noBtn);

    // Focus Cancel by default (the safe choice) for controller users.
    this._setDialogFocus([noBtn, yesBtn]);
  }
}
