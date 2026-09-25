// TutorialController — extracted from BattleScene.
// Owns the tutorial battle flows: the strict-gate movement lesson helpers,
// guide highlights, blocking instructions, the permadeath and lord-rewind
// lessons, phase-start hint scheduling, and the skip button. Tutorial state
// (tutorialStep, the _tutorial* flags, guide marker refs) stays on
// BattleScene; cross-method calls go through the scene's delegating shims so
// tests can stub individual methods exactly as before.

import { getConsumableDescription } from '../utils/consumableText.js';
import { TERRAIN, TILE_SIZE } from '../utils/constants.js';
import { showImportantHint } from './HintDisplay.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import {
  forecastTutorialLesson,
  TUTORIAL_LESSONS_KEY,
  TUTORIAL_HINT_IDS,
} from './tutorialLessons.js';
import { VisionRewindController } from './VisionRewindController.js';
import { UI_PALETTE, UI_HEX } from '../utils/uiStyles.js';
import { hasDOMHost } from '../utils/domUI.js';
import { getSlotCount } from '../engine/SlotManager.js';
import { TutorialCoach } from './TutorialCoach.js';

// States where the pause menu (and so the tutorial's exits) can open safely.
const PAUSABLE_STATES = new Set(['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU']);

export class TutorialController {
  constructor(scene) {
    this.scene = scene;
    this.taught = new Set();
    this.lessonOpen = false;
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
    this.clearGuideHighlights();
    this.coach?.destroy();
    this.coach = null;
  }

  /** The persistent objective line (DOM only; canvas builds keep the SKIP button). */
  ensureCoach() {
    const scene = this.scene;
    if (this.coach && !this.coach.destroyed) return this.coach;
    if (this.destroyed || !scene.battleParams?.tutorialMode || !hasDOMHost()) return null;
    this.coach = new TutorialCoach(scene, {
      onLeave: () => this.requestLeave(),
      onSkipStep: () => this.skipStep(),
    });
    return this.coach;
  }

  /**
   * A Field note inside the tutorial: Continue, plus a way out. Resolves like
   * showImportantHint; choosing Leave opens the leave confirmation afterwards.
   */
  async note(message) {
    const scene = this.scene;
    const actions = hasDOMHost()
      ? [
          { label: 'Continue', value: true, primary: true },
          { label: 'Leave tutorial', value: 'leave' },
        ]
      : null;
    const result = actions
      ? await showImportantHint(scene, message, { actions })
      : await showImportantHint(scene, message);
    if (result === 'leave') setTimeout(() => this.requestLeave(), 0);
    return result;
  }

  canPause() {
    const scene = this.scene;
    return Boolean(
      !this.destroyed &&
      !scene._sceneShutdownCleanedUp &&
      scene.battleParams?.tutorialMode &&
      PAUSABLE_STATES.has(scene.battleState) &&
      scene.turnManager?.currentPhase !== 'enemy' &&
      !scene.visionDialog &&
      !scene.isStoryInputLocked?.(),
    );
  }

  /** Pause menu exits for the practice battle (no run exists to save or abandon). */
  pauseOptions() {
    if (!this.scene.battleParams?.tutorialMode) return null;
    let fresh;
    try {
      fresh = getSlotCount() === 0;
    } catch {
      fresh = false;
    }
    return {
      onLeave: () => this.leave('title'),
      onStartRun: fresh ? () => this.leave('run') : null,
    };
  }

  /** Open the pause menu straight onto the leave confirmation. */
  requestLeave() {
    const scene = this.scene;
    if (!scene.pauseOverlay?.visible) {
      if (!this.canPause()) {
        this.coach?.nudge('You can leave once your turn is back.');
        return false;
      }
      scene.showPauseMenu();
    }
    return Boolean(scene.pauseOverlay?.requestLeaveTutorial?.());
  }

  /** Release the guided movement lesson (Select → Move) and play freely. */
  skipStep() {
    const scene = this.scene;
    if (!scene.battleParams?.tutorialMode || scene._tutorialStrictGateReleased) return false;
    if (scene.battleState === 'TUTORIAL_HINT') return false;
    scene._tutorialStrictGateReleased = true;
    scene.tutorialStep = Math.max(Number(scene.tutorialStep) || 0, 4);
    this.clearGuideHighlights();
    scene.refreshEndTurnControl?.();
    scene._mobileBattleHud?.sync?.();
    this.coach?.reveal();
    return true;
  }

  /** Step 2 → 3: the commander is selected; point at the Fort. */
  onCommanderSelected() {
    const scene = this.scene;
    scene._setTutorialGuideHighlight('fort');
    scene.tutorialStep = 3;
    if (this.ensureCoach()) {
      this.coach.reveal();
      return;
    }
    const verb = scene.isMobileInput ? 'Tap' : 'Click';
    void scene._withTutorialHintState(async () => {
      await showImportantHint(scene, `${verb} the highlighted Fort tile with Edric to continue.`);
    });
  }

  /** First exchange done: XP explained in passing, without stopping play. */
  async showXpLesson() {
    const scene = this.scene;
    const text = 'Units earn XP from combat — at 100 XP they level up and grow stronger.';
    if (this.ensureCoach()?.nudge(text, 'info')) return;
    await scene._withTutorialHintState(async () => {
      await showImportantHint(scene, `Nice! ${text}\nNow finish the fight!`);
    });
  }

  async withHintState(fn) {
    const scene = this.scene;
    const prevState = scene.battleState;
    scene.battleState = 'TUTORIAL_HINT';
    try {
      return await fn();
    } finally {
      if (
        !this.destroyed &&
        !scene._sceneShutdownCleanedUp &&
        scene.sys?.isActive?.() !== false &&
        scene.battleState === 'TUTORIAL_HINT'
      ) {
        scene.battleState = prevState;
      }
    }
  }

  async showLesson(message, ids) {
    const scene = this.scene;
    if (
      !scene.battleParams?.tutorialMode ||
      this.lessonOpen ||
      this.destroyed ||
      scene._sceneShutdownCleanedUp ||
      scene.sys?.isActive?.() === false ||
      !message
    )
      return false;
    this.lessonOpen = true;
    this.activeLessonId = ids[0];
    try {
      await this.withHintState(() => this.note(message));
      if (this.destroyed || scene._sceneShutdownCleanedUp || scene.sys?.isActive?.() === false)
        return false;
      for (const id of ids) this.taught.add(id);
      return true;
    } finally {
      this.lessonOpen = false;
      this.activeLessonId = null;
    }
  }

  async showFortLesson(unit) {
    const scene = this.scene;
    // Update the preview before the lesson points at it, using the arrived tile.
    scene._mobileTerrainFocus = { col: unit.col, row: unit.row };
    scene._inputController?.refreshTileInfo?.(unit.col, unit.row);
    scene._mobileBattleHud?.sync?.();
    const terrain = scene.grid?.getTerrainAt?.(unit.col, unit.row);
    const bonuses = terrain
      ? ` — Defense +${Number(terrain.defBonus) || 0}, Avoid +${Number(terrain.avoidBonus) || 0}.`
      : '.';
    const how = scene.isMobileInput ? 'tap' : 'point at';
    return this.showLesson(
      `Fort tile reached${bonuses}\nThe terrain preview shows the bonuses of any tile you ${how}. Fight from cover to take less damage and dodge more.`,
      ['battle_terrain'],
    );
  }

  showForecastLesson(forecast) {
    const { message, ids } = forecastTutorialLesson(forecast, this.taught);
    return this.showLesson(message, ids);
  }

  showResourceLesson(items) {
    if (!items?.some((entry) => ['Staff', 'Consumable'].includes(entry.item?.type)))
      return Promise.resolve(false);
    if (this.taught.has('battle_staff_scope') && this.taught.has('battle_consumable_supply'))
      return Promise.resolve(false);
    const consumable = items.find((entry) => entry.item?.type === 'Consumable')?.item;
    const effect = getConsumableDescription(consumable);
    const example = effect ? ` ${consumable.name}: ${effect}.` : '';
    return this.showLesson(
      `Staves and consumables have different lifetimes.\nStaff uses refill every battle. Consumable uses are spent permanently.${example} Check the effect and uses before choosing.`,
      ['battle_staff_scope', 'battle_heal_uses', 'battle_consumable_supply'],
    );
  }

  recordCompletion() {
    this.taught.add('battle_first_turn');
    this.recordTaught();
  }

  /**
   * Skipping into a first run also retires the tutorial's "Start here" promotion,
   * carrying only the lessons actually shown (applyCompletedTutorialHints).
   */
  recordSkip() {
    this.recordTaught();
  }

  recordTaught() {
    const ids = [...this.taught].filter((id) => TUTORIAL_HINT_IDS.has(id));
    try {
      localStorage.setItem('emblem_rogue_tutorial_completed', '1');
      const previous = JSON.parse(localStorage.getItem(TUTORIAL_LESSONS_KEY) || '[]');
      const all = [
        ...new Set([
          ...ids,
          ...(Array.isArray(previous) ? previous.filter((id) => TUTORIAL_HINT_IDS.has(id)) : []),
        ]),
      ];
      localStorage.setItem(TUTORIAL_LESSONS_KEY, JSON.stringify(all));
    } catch {
      /* Optional onboarding state must not block completion. */
    }
    for (const id of ids) this.scene.registry.get('hints')?.markSeen(id);
  }

  isStrictGateActive() {
    const scene = this.scene;
    const step = Number(scene.tutorialStep);
    return Boolean(
      scene.battleParams?.tutorialMode &&
      !scene._tutorialStrictGateReleased &&
      Number.isFinite(step) &&
      step >= 2,
    );
  }

  getEdricUnit() {
    const scene = this.scene;
    if (!Array.isArray(scene.playerUnits)) return null;
    return scene.playerUnits.find((unit) => unit?.name === 'Edric') || null;
  }

  getFortTile() {
    const scene = this.scene;
    const mapLayout =
      scene.battleConfig?.mapLayout ||
      scene.grid?.mapLayout ||
      scene.buildTutorialBattleConfig?.()?.mapLayout ||
      null;
    if (!Array.isArray(mapLayout)) return null;
    for (let row = 0; row < mapLayout.length; row++) {
      const rowData = mapLayout[row];
      if (!Array.isArray(rowData)) continue;
      for (let col = 0; col < rowData.length; col++) {
        if (rowData[col] === TERRAIN.Fort) return { col, row };
      }
    }
    return null;
  }

  async showBlockingInstruction(text) {
    const scene = this.scene;
    if (scene._tutorialBlockingPromptActive) return false;
    // With the coach on screen a gate reminder is a nudge, not a modal.
    if (this.ensureCoach()?.nudge(text)) {
      scene.refreshEndTurnControl();
      return true;
    }
    scene._tutorialBlockingPromptActive = true;
    try {
      await scene._withTutorialHintState(async () => {
        await showImportantHint(scene, text);
      });
    } finally {
      scene._tutorialBlockingPromptActive = false;
      scene.refreshEndTurnControl();
    }
    return true;
  }

  getVisionRewindIntroHint() {
    const scene = this.scene;
    const eyeRef = scene.isMobileInput ? 'Rewind' : 'Rewind [R]';
    return (
      `${eyeRef} turns back time: spend a charge to return to an earlier moment of this battle.\n` +
      'In a real run you can browse the battle timeline for free first. Charges last the whole run.\n' +
      'Here you have none — but fate may grant one if a lord falls.'
    );
  }

  /**
   * Tutorial one-time lesson: the first time a non-commander lord takes a hit
   * and survives, explain permadeath and the commander-loss rule.
   */
  async maybeShowPermadeathHint(unit, tookDamage) {
    const scene = this.scene;
    if (!scene.battleParams?.tutorialMode || scene._tutorialPermadeathHintShown) return;
    if (!tookDamage || !unit || unit.faction !== 'player' || unit.isCommander) return;
    if (unit.currentHP <= 0) return; // death has its own flow
    scene._tutorialPermadeathHintShown = true;
    const commander =
      (scene.playerUnits || []).find((u) => u?.isCommander)?.name ||
      scene._getTutorialEdricUnit?.()?.name ||
      'Edric';
    await scene._withTutorialHintState(async () => {
      await this.note(
        `${unit.name} took a hit. A unit who falls is gone for good — only a Church can revive them later, for gold — but the battle goes on.\n` +
          `${commander} is your commander: if he falls, the battle is lost, and in a real run the whole run ends.`,
      );
    });
  }

  /**
   * Tutorial lord-death follow-up, shown at the next player-phase start:
   * repeat the permadeath lesson and offer the granted Vision charge as a
   * rewind to the last turn (the kept snapshot still has the lord alive).
   */
  showLordRewindPrompt(fallenName) {
    const scene = this.scene;
    scene._tutorialLordRewindPromptPending = null;
    const finishWithoutRewind = () => {
      scene.captureVisionSnapshot();
      scene.updateVisionHud();
    };
    const stillFallen = !scene.playerUnits.some((u) => u?.name === fallenName);
    if (!stillFallen || !scene.visionSnapshot || scene.getVisionChargesRemaining() <= 0) {
      finishWithoutRewind();
      return;
    }
    scene.showVisionDialog({
      title: `${fallenName} has fallen!`,
      body:
        'Fallen units are gone for good -- only a\n' +
        'Church can revive them, for gold. But fate\n' +
        'grants one Vision: rewind to your last turn?',
      confirmLabel: 'Rewind',
      cancelLabel: 'Accept Fate',
      onConfirm: () => {
        const ok = (scene._visionController ||= new VisionRewindController(
          scene,
          scene.runManager,
        )).executeRewind();
        if (!ok) finishWithoutRewind();
      },
      onCancel: finishWithoutRewind,
      dismissible: false,
      accent: UI_HEX.dangerLine,
    });
  }

  setGuideHighlight(mode) {
    const scene = this.scene;
    scene._clearTutorialGuideHighlights();
    if (!scene.battleParams?.tutorialMode || !scene.grid || !scene.add) return;
    const draw = (col, row, color) => {
      const pos = scene.grid.gridToPixel(col, row);
      const marker = scene.add
        .rectangle(pos.x, pos.y, TILE_SIZE - 2, TILE_SIZE - 2, 0x000000, 0)
        .setStrokeStyle(2, color, 1)
        .setDepth(52);
      if (!scene._reduceMotion()) {
        scene.tweens.add({
          targets: marker,
          alpha: { from: 0.45, to: 1 },
          duration: 450,
          yoyo: true,
          repeat: -1,
        });
      }
      return marker;
    };
    if (mode === 'edric') {
      const edric = scene._getTutorialEdricUnit();
      if (!edric) return;
      scene._tutorialEdricGuide = draw(edric.col, edric.row, 0x4aa3ff);
      return;
    }
    if (mode === 'fort') {
      const fort = scene._getTutorialFortTile();
      if (!fort) return;
      scene._tutorialFortGuide = draw(fort.col, fort.row, UI_HEX.accent);
    }
  }

  /**
   * The coach's current unit anchor after the guided steps (e.g. a wounded lord):
   * a gold ring on that unit's tile, redrawn only when the unit or tile changes.
   */
  markAnchor(unit) {
    const scene = this.scene;
    const key = unit ? `${unit.name}@${unit.col},${unit.row}` : '';
    if (key === this.anchorKey) return;
    this.anchorKey = key;
    this.anchorMarker?.destroy?.();
    this.anchorMarker = null;
    if (!unit || !scene.grid?.gridToPixel || !scene.add?.rectangle) return;
    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    this.anchorMarker = scene.add
      .rectangle(pos.x, pos.y, TILE_SIZE - 2, TILE_SIZE - 2, 0x000000, 0)
      .setStrokeStyle(2, UI_HEX.accent, 1)
      .setDepth(52);
    if (!scene._reduceMotion?.()) {
      scene.tweens?.add?.({
        targets: this.anchorMarker,
        alpha: { from: 0.4, to: 1 },
        duration: 500,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  clearGuideHighlights() {
    const scene = this.scene;
    this.markAnchor(null);
    if (scene._tutorialEdricGuide?.destroy) scene._tutorialEdricGuide.destroy();
    if (scene._tutorialFortGuide?.destroy) scene._tutorialFortGuide.destroy();
    scene._tutorialEdricGuide = null;
    scene._tutorialFortGuide = null;
  }

  transitionToTitle(extra = null) {
    const scene = this.scene;
    const audio = scene.registry.get('audio');
    if (audio) audio.releaseMusic(scene, 0);
    return transitionToScene(
      scene,
      'Title',
      { gameData: scene.gameData, ...(extra || {}) },
      { reason: TRANSITION_REASONS.BACK },
    );
  }

  /**
   * Leave the practice battle. 'title' returns to the title; 'run' retires the
   * tutorial promotion and lets the title start the first run (its normal
   * new-game path, so slot staging and the first-run fast path stay in one place).
   * Nothing is saved: tutorial battles never create run or suspend state.
   */
  leave(destination = 'title') {
    if (this.leaving) return this.leaving;
    this.coach?.destroy();
    this.coach = null;
    if (destination === 'run') {
      this.recordSkip();
      this.leaving = this.scene._transitionTutorialToTitle({ autoAction: 'newGame' });
    } else this.leaving = this.scene._transitionTutorialToTitle();
    return this.leaving;
  }

  handleSkipRequested() {
    const scene = this.scene;
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('Skip tutorial and return to title?')
        : true;
    if (!confirmed) return false;
    void scene._transitionTutorialToTitle();
    return true;
  }

  /** Tutorial exit affordance, created once during scene setup: the coach's Leave
   * on DOM builds, a bottom-right SKIP on canvas-only builds. */
  createSkipButton() {
    const scene = this.scene;
    if (this.ensureCoach()) return;
    const cam = scene.cameras.main;
    const skipBtn = scene.add
      .text(cam.width - 8, cam.height - 12, 'SKIP', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: UI_PALETTE.muted,
        backgroundColor: '#00000088',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(1, 1)
      .setDepth(101)
      .setInteractive({ useHandCursor: true });
    skipBtn.on('pointerover', () => skipBtn.setColor(UI_PALETTE.text));
    skipBtn.on('pointerout', () => skipBtn.setColor(UI_PALETTE.muted));
    skipBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._handleTutorialSkipRequested();
    });
    scene._pinToScreen(skipBtn);
  }

  /**
   * Player-phase-start tutorial hints. Owns every tutorialMode branch of the
   * phase-change hint scheduling: the pending lord-rewind prompt, the intro
   * lesson at step 0, the turn-3 Vision intro, and hint suppression otherwise.
   * `scheduleSafeDelayedAsync` and `isSceneActiveForAsync` come from the
   * phase pipeline so error reporting and shutdown guards stay identical.
   */
  scheduleTurnStartHints({ turn, scheduleSafeDelayedAsync, isSceneActiveForAsync }) {
    const scene = this.scene;
    const withTutorialHintState =
      typeof scene._withTutorialHintState === 'function'
        ? (fn) => scene._withTutorialHintState(fn)
        : async (fn) => {
            await fn();
          };
    if (scene._tutorialLordRewindPromptPending) {
      const fallenName = scene._tutorialLordRewindPromptPending;
      scheduleSafeDelayedAsync(
        1500,
        'tutorial_lord_rewind_prompt',
        async () => {
          if (!isSceneActiveForAsync()) return;
          // A fast player can already be mid-action when this fires; the
          // dialog's confirm path applies a rewind snapshot, which must
          // never land during combat resolution. Pending flag stays set,
          // so the prompt re-arms at the next player-phase start.
          if (
            scene.turnManager?.currentPhase !== 'player' ||
            scene.turnManager?.turnNumber !== turn ||
            scene.battleState !== 'PLAYER_IDLE'
          ) {
            return;
          }
          scene._showTutorialLordRewindPrompt(fallenName);
        },
        { phase: 'player', turn },
      );
    } else if (scene.tutorialStep === 0 && this.ensureCoach()) {
      // Teach by doing: no welcome wall. The coach states the goal and the
      // commander's tile pulses; the movement gate is live from the first frame.
      scene.tutorialStep = 2;
      scheduleSafeDelayedAsync(
        1500,
        'tutorial_intro_turn_start',
        async () => {
          if (!isSceneActiveForAsync()) return;
          scene._setTutorialGuideHighlight('edric');
          this.coach?.reveal();
        },
        { phase: 'player', turn },
      );
    } else if (scene.tutorialStep === 0) {
      scheduleSafeDelayedAsync(
        1500,
        'tutorial_intro_turn_start',
        async () => {
          if (!isSceneActiveForAsync()) return;
          await withTutorialHintState(async () => {
            await showImportantHint(
              scene,
              'Welcome to the tutorial!\nLearn the basics of tactical combat.',
            );
            if (!isSceneActiveForAsync()) return;
            scene.tutorialStep = 1;
            const verb = scene.isMobileInput ? 'Tap' : 'Click';
            await showImportantHint(
              scene,
              `${verb} a blue unit to select it.\nBlue tiles show where it can move.`,
            );
            if (!isSceneActiveForAsync()) return;
            scene.tutorialStep = 2;
            scene._setTutorialGuideHighlight('edric');
          });
        },
        { phase: 'player', turn },
      );
    } else if (!scene._tutorialVisionIntroShown && turn === 3) {
      scene._tutorialVisionIntroShown = true;
      scheduleSafeDelayedAsync(
        1500,
        'tutorial_vision_intro',
        async () => {
          if (!isSceneActiveForAsync()) return;
          await withTutorialHintState(async () => {
            if (hasDOMHost()) await this.note(scene._getVisionRewindIntroHint());
            else await showImportantHint(scene, scene._getVisionRewindIntroHint());
          });
        },
        { phase: 'player', turn },
      );
    }
    // Any other tutorial turn: suppress the normal battle hints.
  }
}
