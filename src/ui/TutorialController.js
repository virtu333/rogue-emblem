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
      await this.withHintState(() => showImportantHint(scene, message));
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
      ? ` Defense +${Number(terrain.defBonus) || 0}, Avoid +${Number(terrain.avoidBonus) || 0}.`
      : '';
    return this.showLesson(
      `Fort tile reached.${bonuses}\nTerrain bonuses are shown in the terrain preview. Use cover to reduce damage and improve dodging.`,
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
      `${eyeRef} spends 1 charge to return to the saved player-turn start.\n` +
      'In a real run, Rewind also opens a free battle timeline. Select to preview; a separate confirmation spends a charge. Charges last the whole run.\n' +
      'Here you have none -- but fate may grant one if a lord falls.'
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
    await scene._withTutorialHintState(async () => {
      await showImportantHint(
        scene,
        `${unit.name} took a hit! If a unit falls, they are gone --\n` +
          'they can only be revived later at a Church, for gold.\n' +
          'If Edric falls, the battle is lost. In a real run, the run ends.',
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
      accent: 0xcc6666,
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
      scene._tutorialFortGuide = draw(fort.col, fort.row, 0xffdd44);
    }
  }

  clearGuideHighlights() {
    const scene = this.scene;
    if (scene._tutorialEdricGuide?.destroy) scene._tutorialEdricGuide.destroy();
    if (scene._tutorialFortGuide?.destroy) scene._tutorialFortGuide.destroy();
    scene._tutorialEdricGuide = null;
    scene._tutorialFortGuide = null;
  }

  transitionToTitle() {
    const scene = this.scene;
    const audio = scene.registry.get('audio');
    if (audio) audio.releaseMusic(scene, 0);
    return transitionToScene(
      scene,
      'Title',
      { gameData: scene.gameData },
      { reason: TRANSITION_REASONS.BACK },
    );
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

  /** Bottom-right SKIP button, created once during scene setup. */
  createSkipButton() {
    const scene = this.scene;
    const cam = scene.cameras.main;
    const skipBtn = scene.add
      .text(cam.width - 8, cam.height - 12, 'SKIP', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
        backgroundColor: '#00000088',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(1, 1)
      .setDepth(101)
      .setInteractive({ useHandCursor: true });
    skipBtn.on('pointerover', () => skipBtn.setColor('#ffffff'));
    skipBtn.on('pointerout', () => skipBtn.setColor('#888888'));
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
            await showImportantHint(scene, scene._getVisionRewindIntroHint());
          });
        },
        { phase: 'player', turn },
      );
    }
    // Any other tutorial turn: suppress the normal battle hints.
  }
}
