// RunCompleteScene — End-of-run screen (victory or defeat)

import Phaser from 'phaser';
import { clearSavedRun } from '../engine/RunManager.js';
import { MUSIC } from '../utils/musicConfig.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { recordBlessingRunOutcome } from '../utils/blessingAnalytics.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { DialogueOverlay } from '../ui/DialogueOverlay.js';
import { adaptDialogueEntries } from '../engine/DialogueCast.js';
import { buildNarrativeContext, selectDialogueEntries } from '../engine/NarrativeDirector.js';
import { MenuFocusController } from '../ui/MenuFocusController.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';

export class RunCompleteScene extends Phaser.Scene {
  constructor() {
    super('RunComplete');
  }

  init(data) {
    this.gameData = data.gameData;
    this.runManager = data.runManager;
    this.result = data.result || 'defeat';
  }

  async create() {
    this.isTransitioning = false;
    this._resultMusicKey = this.result === 'victory' ? MUSIC.runWin : MUSIC.defeat;

    // Settle rewards BEFORE deleting the run save: once the save is cleared
    // there is nothing left to recover from, so valor/supply/milestones must
    // already be committed to meta (settleEndRunRewards is idempotent — the
    // victory path pre-settles in PostCombatController).
    const rm = this.runManager;
    recordBlessingRunOutcome({
      activeBlessings: rm.getActiveBlessingIds
        ? rm.getActiveBlessingIds()
        : rm.activeBlessings || [],
      result: this.result,
      actIndex: rm.actIndex,
      completedBattles: rm.completedBattles,
    });
    const meta = this.registry.get('meta');
    const rewards = rm.settleEndRunRewards(meta, this.result);

    const cloud = this.registry.get('cloud');
    const slot = this.registry.get('activeSlot');
    clearSavedRun(cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null, slot);

    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    const isVictory = this.result === 'victory';

    const audio = this.registry.get('audio');
    if (audio) {
      audio.playMusic(this._resultMusicKey, this, 500);
    }

    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
      popInputScope(this);
      this._onInputActionBound = null;
      if (this._menuFocus) {
        this._menuFocus.destroy();
        this._menuFocus = null;
      }
    });

    // Title
    this.add
      .text(cx, cy - 80, isVictory ? 'RUN COMPLETE!' : 'GAME OVER', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: isVictory ? '#ffdd44' : '#cc3333',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    let overlay;
    try {
      const dialogueEntries = this._getRunCompleteDialogue();
      if (dialogueEntries) {
        overlay = new DialogueOverlay(this);
        await overlay.showSequence(dialogueEntries);
      }
    } catch (err) {
      console.warn('[RunCompleteScene] Dialogue failed, continuing:', err);
    } finally {
      if (overlay) overlay.destroy();
    }

    // Rewards were settled above, before the save was cleared.
    const actReached = rm.actIndex + 1;
    const { valor, supply, currencyMultiplier } = rewards;

    // Stats
    const statsLines = [`Battles Won: ${rm.completedBattles}`, `Act Reached: ${actReached} / 4`];
    const statsText = statsLines.join('\n');

    this.add
      .text(cx, cy - 20, statsText, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e0e0e0',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    // Difficulty line (colored separately)
    const diffLabel = rm.difficultyModifiers?.label || rm.difficultyId || 'normal';
    const diffColor = rm.difficultyModifiers?.color || '#44cc44';
    this.add
      .text(cx, cy + 4, `${diffLabel} Mode  (x${currencyMultiplier.toFixed(2)} currency)`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: diffColor,
        align: 'center',
      })
      .setOrigin(0.5);

    // Currency earned display
    let curY = cy + 14;
    this.add
      .text(cx, curY, `Valor Earned: +${valor}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffcc44',
        align: 'center',
      })
      .setOrigin(0.5);
    curY += 18;
    this.add
      .text(cx, curY, `Supply Earned: +${supply}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#44ccbb',
        align: 'center',
      })
      .setOrigin(0.5);

    if (meta) {
      curY += 20;
      this.add
        .text(
          cx,
          curY,
          `Total: ${meta.getTotalValor()} Valor  |  ${meta.getTotalSupply()} Supply`,
          {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#888888',
            align: 'center',
          },
        )
        .setOrigin(0.5);
    }

    // Home Base button (primary)
    const homeBtn = this.add
      .text(cx - 110, cy + 80, '[ Home Base ]', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#88ccff',
        backgroundColor: '#000000aa',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    homeBtn.on('pointerover', () => homeBtn.setColor('#ffdd44'));
    homeBtn.on('pointerout', () => homeBtn.setColor('#88ccff'));
    homeBtn.on('pointerdown', () => {
      void this._attemptSceneTransition('HomeBase', TRANSITION_REASONS.RETURN_HOME);
    });

    // Back to Title button (secondary)
    const titleBtn = this.add
      .text(cx + 110, cy + 80, '[ Title ]', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#e0e0e0',
        backgroundColor: '#000000aa',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    titleBtn.on('pointerover', () => titleBtn.setColor('#ffdd44'));
    titleBtn.on('pointerout', () => titleBtn.setColor('#e0e0e0'));
    titleBtn.on('pointerdown', () => {
      void this._attemptSceneTransition('Title', TRANSITION_REASONS.RETURN_TITLE);
    });

    // Gamepad: drive a focus highlight over the two buttons (reusing their pointer
    // onClick callbacks) and claim the input-focus scope. Built last, after the
    // optional dialogue await, so the buttons exist.
    this._menuFocus = new MenuFocusController(this);
    this._menuFocus.setItems([
      {
        button: homeBtn,
        color: '#88ccff',
        onActivate: () => this._attemptSceneTransition('HomeBase', TRANSITION_REASONS.RETURN_HOME),
      },
      {
        button: titleBtn,
        color: '#e0e0e0',
        onActivate: () => this._attemptSceneTransition('Title', TRANSITION_REASONS.RETURN_TITLE),
      },
    ]);
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
  }

  _onInputAction(action, payload) {
    switch (action) {
      case InputAction.NAVIGATE: {
        // Two buttons sit side by side; left/right or up/down both cycle focus.
        const d = payload?.dx || payload?.dy;
        if (d) this._menuFocus?.move(d);
        break;
      }
      case InputAction.CONFIRM:
        this._menuFocus?.activate();
        break;
    }
  }

  async _attemptSceneTransition(targetScene, reason) {
    if (this.isTransitioning) return false;
    this.isTransitioning = true;
    const audio = this.registry.get('audio');
    if (audio) audio.stopMusic(this, 0);

    try {
      const transitioned =
        reason === TRANSITION_REASONS.RETURN_HOME
          ? await transitionToScene(
              this,
              targetScene,
              { gameData: this.gameData },
              { reason: TRANSITION_REASONS.RETURN_HOME },
            )
          : await transitionToScene(
              this,
              targetScene,
              { gameData: this.gameData },
              { reason: TRANSITION_REASONS.RETURN_TITLE },
            );
      if (transitioned === true) return true;
      this.isTransitioning = false;
      if (audio && this._resultMusicKey) audio.playMusic(this._resultMusicKey, this, 0);
      if (import.meta?.env?.DEV) {
        console.debug(
          '[RunCompleteScene] Transition blocked, ready for retry:',
          targetScene,
          reason,
        );
      }
      return false;
    } catch (err) {
      this.isTransitioning = false;
      if (audio && this._resultMusicKey) audio.playMusic(this._resultMusicKey, this, 0);
      if (import.meta?.env?.DEV) {
        console.debug(
          '[RunCompleteScene] Transition failed, ready for retry:',
          targetScene,
          reason,
          err,
        );
      }
      return false;
    }
  }

  _getRunCompleteDialogue() {
    const dialogue = this.gameData?.dialogue?.runComplete;
    if (!dialogue) return null;
    const key =
      this.result === 'victory' ? `victory_${this.runManager?.difficultyId || 'normal'}` : 'defeat';
    // Settle has already run on both paths, so ctx.lastRunResult refers to
    // THIS run — runComplete variants should gate on firstClear / commander /
    // minRunsCompleted, never lastRunResult.
    const entries = selectDialogueEntries(
      dialogue[key],
      buildNarrativeContext({
        meta: this.registry.get('meta'),
        runManager: this.runManager,
      }),
    );
    if (!Array.isArray(entries) || entries.length <= 0) return null;
    return adaptDialogueEntries(entries, this.runManager?.getStartingLordNames?.());
  }
}
