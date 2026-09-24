import { hasDOMHost } from '../utils/domUI.js';
import { runResultMenu } from '../ui/RunFlowMenus.js';
import { UI_PALETTE, applyTextResolution } from '../utils/uiStyles.js';
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
import { CeremonyController } from '../ui/CeremonyController.js';

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
    this.cameras.main.setBackgroundColor(UI_PALETTE.bg);
    this.isTransitioning = false;
    const lifetime = {};
    this._runResultLifetime = lifetime;
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
      this._runResultLifetime = null;
      this.runResultMenu?.destroy();
      this.runResultMenu = null;
      this._ceremonies?.destroy();
      this._ceremonies = null;
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
      popInputScope(this);
      this._onInputActionBound = null;
      if (this._menuFocus) {
        this._menuFocus.destroy();
        this._menuFocus = null;
      }
    });

    // Canvas fallback only; live browsers use the shared result surface.
    if (!hasDOMHost())
      applyTextResolution(
        this.add.text(cx, cy - 80, isVictory ? 'RUN COMPLETE!' : 'GAME OVER', {
          fontFamily: 'Arial',
          fontSize: '32px',
          color: isVictory ? UI_PALETTE.accent : UI_PALETTE.bad,
          fontStyle: 'bold',
        }),
      ).setOrigin(0.5);

    let overlay;
    let card = null;
    try {
      const dialogueEntries = this._getRunCompleteDialogue();
      // THE THREAD IS CUT (or its gold counterpart) frames the farewell lines.
      card = hasDOMHost()
        ? (this._ceremonies = new CeremonyController(this)).showRunEnd(this._runEndContext(), {
            withLines: Boolean(dialogueEntries),
          })
        : null;
      if (dialogueEntries) {
        overlay = new DialogueOverlay(this);
        await overlay.showSequence(dialogueEntries);
      }
    } catch (err) {
      console.warn('[RunCompleteScene] Dialogue failed, continuing:', err);
    } finally {
      if (overlay) overlay.destroy();
    }
    if (card && this._runResultLifetime === lifetime) {
      try {
        if (overlay) await card.close();
        else await card.finish();
      } catch (err) {
        console.warn('[RunCompleteScene] Result card failed, continuing:', err);
      }
    }

    if (this._runResultLifetime !== lifetime) return;
    if (hasDOMHost()) {
      this.runResultMenu = runResultMenu(this, rewards, meta);
      return;
    }

    // Rewards were settled above, before the save was cleared.
    const actReached = rm.actIndex + 1;
    const { valor, supply, currencyMultiplier } = rewards;

    // Stats
    const statsLines = [
      `Battles Won: ${rm.completedBattles}`,
      `Act Reached: ${actReached} / ${rm.actSequence?.length || 4}`,
    ];
    const statsText = statsLines.join('\n');

    applyTextResolution(
      this.add.text(cx, cy - 20, statsText, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.text,
        align: 'center',
        lineSpacing: 6,
      }),
    ).setOrigin(0.5);

    // Difficulty line (colored separately)
    const diffLabel = rm.difficultyModifiers?.label || rm.difficultyId || 'normal';
    const diffColor = rm.difficultyModifiers?.color || '#44cc44';
    applyTextResolution(
      this.add.text(cx, cy + 4, `${diffLabel} Mode  (x${currencyMultiplier.toFixed(2)} currency)`, {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: diffColor,
        align: 'center',
      }),
    ).setOrigin(0.5);

    // Currency earned display
    let curY = cy + 14;
    applyTextResolution(
      this.add.text(cx, curY, `Valor Earned: +${valor}`, {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: UI_PALETTE.accentText,
        align: 'center',
      }),
    ).setOrigin(0.5);
    curY += 18;
    applyTextResolution(
      this.add.text(cx, curY, `Supply Earned: +${supply}`, {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: UI_PALETTE.info,
        align: 'center',
      }),
    ).setOrigin(0.5);

    if (meta) {
      curY += 20;
      applyTextResolution(
        this.add.text(
          cx,
          curY,
          `Total: ${meta.getTotalValor()} Valor  |  ${meta.getTotalSupply()} Supply`,
          {
            fontFamily: 'Arial',
            fontSize: '11px',
            color: UI_PALETTE.muted,
            align: 'center',
          },
        ),
      ).setOrigin(0.5);
    }

    // Home Base button (primary)
    const homeBtn = applyTextResolution(
      this.add.text(cx - 110, cy + 80, '[ Home Base ]', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: UI_PALETTE.info,
        backgroundColor: '#000000aa',
        padding: { x: 16, y: 8 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    homeBtn.on('pointerover', () => homeBtn.setColor(UI_PALETTE.accent));
    homeBtn.on('pointerout', () => homeBtn.setColor(UI_PALETTE.info));
    homeBtn.on('pointerdown', () => {
      void this._attemptSceneTransition('HomeBase', TRANSITION_REASONS.RETURN_HOME);
    });

    // Back to Title button (secondary)
    const titleBtn = applyTextResolution(
      this.add.text(cx + 110, cy + 80, '[ Title ]', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: UI_PALETTE.text,
        backgroundColor: '#000000aa',
        padding: { x: 16, y: 8 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    titleBtn.on('pointerover', () => titleBtn.setColor(UI_PALETTE.accent));
    titleBtn.on('pointerout', () => titleBtn.setColor(UI_PALETTE.text));
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
        color: UI_PALETTE.info,
        onActivate: () => this._attemptSceneTransition('HomeBase', TRANSITION_REASONS.RETURN_HOME),
      },
      {
        button: titleBtn,
        color: UI_PALETTE.text,
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

  /** Where and when the run ended, for the result card (presentation only). */
  _runEndContext() {
    const rm = this.runManager;
    let commander = null;
    try {
      commander = rm?.getStartingLordNames?.()?.[0] || null;
    } catch {
      commander = null;
    }
    const report = rm?.lastBattleReport;
    const lastEntry = Array.isArray(report?.entries) ? report.entries.at(-1) : null;
    const turn = Number.isFinite(lastEntry?.turnNumber)
      ? lastEntry.turnNumber
      : Number.isFinite(report?.currentTurn)
        ? report.currentTurn
        : null;
    return {
      result: this.result,
      commander,
      actId: rm?.currentAct,
      // The report's last turn is where the run died; an abandoned run has none.
      turn: this.result !== 'victory' && rm?.defeatContext ? turn : null,
      defeatContext: rm?.defeatContext || null,
      battlesWon: rm?.completedBattles,
    };
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
