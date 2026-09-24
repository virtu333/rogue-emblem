import { PendingRewardController } from '../ui/PendingRewardController.js';
import { CampaignMapOverlay } from '../ui/CampaignMapOverlay.js';
import { NodeMapMenu } from '../ui/NodeMapMenu.js';
import { hasDOMHost } from '../utils/domUI.js';
import { getHPBarColor } from '../utils/uiStyles.js';
import { UI_PALETTE, UI_HEX, applyTextResolution } from '../utils/uiStyles.js';
import { routeMobileAction } from '../utils/overlayStack.js';
import { inputHint } from '../utils/inputHint.js';
// NodeMapScene — Visual node map with navigation + roster display

import Phaser from 'phaser';
import { RunManager, saveRun, clearSavedRun } from '../engine/RunManager.js';
import { ACT_CONFIG, NODE_TYPES, SAFE_BOTTOM_Y } from '../utils/constants.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { PauseOverlay } from '../ui/PauseOverlay.js';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { RosterOverlay } from '../ui/RosterOverlay.js';
import { DialogueOverlay } from '../ui/DialogueOverlay.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { pushRunSave, deleteRunSave } from '../cloud/CloudSync.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import { DEBUG_MODE } from '../utils/debugMode.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import {
  transitionToScene,
  transitionToSceneWithBlockedRetry,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../utils/SceneRouter.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';
import { markStartup } from '../utils/startupTelemetry.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { showTransitionRecoveryPrompt } from '../ui/TransitionRecoveryPrompt.js';
import { consumeEscEvent, isEscConsumed } from '../utils/escPriority.js';
import { hasOpenOverlay } from '../utils/overlayStack.js';
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';
import { isTouchPointer } from '../utils/runtimeFlags.js';
import { ChurchController } from '../ui/ChurchController.js';
import { ShopController } from '../ui/ShopController.js';
import { adaptDialogueEntries } from '../engine/DialogueCast.js';
import { buildNarrativeContext, selectDialogueEntries } from '../engine/NarrativeDirector.js';
import { NodeMapCursorController } from '../ui/NodeMapCursorController.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import {
  trackSceneTimer,
  clearTrackedSceneTimer,
  clearAllSceneTimers,
} from '../utils/sceneTimers.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';

// Maps runManager.currentAct → the meta milestone recorded on node-map entry,
// which the Compendium Foes tab reads to gate each act's boss.
const ACT_REACHED_MILESTONE = {
  act1: 'reachedAct1',
  act2: 'reachedAct2',
  act3: 'reachedAct3',
  act4: 'reachedAct4',
  finalBoss: 'reachedFinalBoss',
};

// Layout constants
const MAP_TOP = 60;
const MAP_BOTTOM = 382;
const MAP_LEFT = 80;
const MAP_RIGHT = 560;
const ROSTER_Y = SAFE_BOTTOM_Y;
const NODE_SIZE = 24;

// Colors
const COLOR_BATTLE = 0xcc6633;
const COLOR_BOSS = 0xcc3333;
const COLOR_SHOP = 0xddaa33;
const COLOR_RUINS = 0x9c8b6b;
const COLOR_RECRUIT = 0x44ccaa;
const COLOR_CHURCH = 0xcccccc; // Light gray
const COLOR_COLOSSEUM = 0x9966cc; // Purple
const COLOR_ELITE = 0xcc5500; // Dark orange for elite seize battles
const COLOR_COMPLETED = 0x555555;
const COLOR_AVAILABLE = UI_HEX.accent;
const COLOR_EDGE = UI_HEX.lineStrong;
const COLOR_EDGE_ACTIVE = UI_HEX.accent;
// Aura effects for special node types
const AURA_ELITE_COLOR = 0xcc2222;
const AURA_ELITE_RADIUS = 26;
const AURA_ELITE_ALPHA = [0.26, 0.62]; // [min, max] breathing range
const AURA_ELITE_DURATION = 900; // faster = menacing
const AURA_CHURCH_COLOR = 0xfff2d0; // warm, slightly whiter gold
const AURA_CHURCH_RADIUS = 28;
const AURA_CHURCH_ALPHA = [0.2, 0.55];
const AURA_CHURCH_DURATION = 1200; // slower = calming
const AURA_LOCKED_ALPHA_SCALE = 0.85; // visible but dim for locked nodes
const AURA_DEPTH = -1; // below nodes and edges
const NODE_DEPTH = 1; // keep nodes above aura layer
// (shared with the extracted overlay controllers).

function beginSceneLifecycle(scene) {
  const nextGeneration =
    (Number.isInteger(scene?._sceneLifecycleGeneration) ? scene._sceneLifecycleGeneration : 0) + 1;
  scene._sceneLifecycleGeneration = nextGeneration;
  scene._sceneShuttingDown = false;
  scene._sceneShutdownCleanedUp = false;
  scene._sceneTimers = new Set();
  return nextGeneration;
}

function isSceneLifecycleActive(scene, generation = scene?._sceneLifecycleGeneration) {
  if (!scene || scene._sceneShuttingDown) return false;
  const currentGeneration = Number.isInteger(scene._sceneLifecycleGeneration)
    ? scene._sceneLifecycleGeneration
    : null;
  if (
    Number.isInteger(generation) &&
    Number.isInteger(currentGeneration) &&
    generation !== currentGeneration
  ) {
    return false;
  }
  return true;
}

// Scene timer tracking helpers now live in ../utils/sceneTimers.js (shared
// with the extracted overlay controllers).

const NODE_ICONS = {
  [NODE_TYPES.BATTLE]: '\u2694', // ⚔
  [NODE_TYPES.BOSS]: '\u2620', // ☠
  [NODE_TYPES.SHOP]: '$',
  [NODE_TYPES.RUINS]: '\u2302', // ⌂
  [NODE_TYPES.RECRUIT]: '!',
  [NODE_TYPES.CHURCH]: '\u271D', // ✝
  [NODE_TYPES.COLOSSEUM]: '\u039B', // Λ
};

const NODE_COLORS = {
  [NODE_TYPES.BATTLE]: COLOR_BATTLE,
  [NODE_TYPES.BOSS]: COLOR_BOSS,
  [NODE_TYPES.SHOP]: COLOR_SHOP,
  [NODE_TYPES.RUINS]: COLOR_RUINS,
  [NODE_TYPES.RECRUIT]: COLOR_RECRUIT,
  [NODE_TYPES.CHURCH]: COLOR_CHURCH,
  [NODE_TYPES.COLOSSEUM]: COLOR_COLOSSEUM,
};

export class NodeMapScene extends Phaser.Scene {
  constructor() {
    super('NodeMap');
  }

  isDevToolsEnabled() {
    return DEBUG_MODE || this.registry.get('devToolsEnabled') === true;
  }

  init(data) {
    this.gameData = data.gameData || data;
    this.isTransitioning = false;
    this.isSceneReady = false;
    this.battleLaunchInFlight = false;
    this._pendingNodeSelection = null;
    // Set only when the first-run fast path routed here (skipping Home Base /
    // Difficulty / Blessing). Used to show the one-time onboarding hint below.
    this._isFirstRunFastPath = data.firstRun === true;
    const selectedDifficulty =
      data.difficultyId || this.registry.get('selectedDifficulty') || 'normal';
    if (data.runManager) {
      this.runManager = data.runManager;
      this.registry.set('selectedDifficulty', this.runManager.difficultyId || selectedDifficulty);
    } else {
      console.warn(
        'NodeMapScene: no runManager provided, creating fallback (should not happen in normal flow)',
      );
      const meta = this.registry.get('meta');
      const metaEffects = meta
        ? meta.getActiveEffects({
            weaponArtCatalog: this.gameData?.weaponArts?.arts || [],
          })
        : null;
      this.runManager = new RunManager(this.gameData, metaEffects);
      this.runManager.startRun({ difficultyId: selectedDifficulty });
      this.registry.set('selectedDifficulty', this.runManager.difficultyId);
    }
  }

  create() {
    this._pendingRewards = null;
    const lifecycleGeneration = beginSceneLifecycle(this);
    this._promotionChoicePanelOpen = 0;

    const audio = this.registry.get('audio');
    if (audio) {
      // Fire and forget; scene readiness gate below prevents early-click races.
      void audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this);
    }

    this._bindInputHandlers();
    // Gamepad: a cursor over the available nodes, registered on the input-focus
    // stack. Refreshed by drawMap (which wipes children each redraw).
    this._nodeCursor = new NodeMapCursorController(this);
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
    this.events.once('shutdown', () => this._onSceneShutdown());

    // Auto-save on every node map entry
    this.persistRunSave();

    // Record the act reached for Compendium foe-gating (idempotent, real-time).
    this._recordActReachedMilestone();

    this.pauseOverlay = null;
    this.settingsOverlay = null;
    this.rosterOverlay = null;
    this.nodeMapTransitionRecovery = null;
    this.dialogueOverlay = new DialogueOverlay(this);
    this._storyDialogueActive = false;
    this._touchTapDown = null;
    this._pointerGesture = null;
    this._touchTooltipPointer = null;
    this._tapMoveThreshold = 12;
    this._touchScrollDrag = null;
    this._shopViewingMap = false;
    this._churchViewingMap = false;
    this._shopViewingRoster = false;
    this._churchViewingRoster = false;
    this._shopOriginalSlotCount = 0;
    this._currentShopHasAmbushDiscount = false;
    this._currentShopIsRuins = false;
    this._currentShopIsCaravan = false;

    // Debug overlay (dev-only)
    if (this.isDevToolsEnabled()) {
      this.debugOverlay = new DebugOverlay(this);
      this._bindDebugToggleHandler();
    }

    this.drawMap();
    this.input.enabled = false;
    void this.finalizeSceneReady(lifecycleGeneration).then(() => {
      if (
        this.isSceneReady &&
        this.scene?.isActive?.() &&
        this.runManager.isActComplete() &&
        !this.runManager.pendingBattleReward
      )
        this.checkActComplete();
    });

    const hints = this.registry.get('hints');
    this._pendingNodeMapHints = {
      // First-run onboarding: only when the fast path routed here, told once.
      showFirstRun: Boolean(this._isFirstRunFastPath && hints?.shouldShow('firstrun_onboarding')),
      showIntro: Boolean(hints?.shouldShow('nodemap_intro')),
      showHpPersist: Boolean(
        this.runManager.completedBattles >= 1 && hints && !hints.hasSeen('nodemap_hp_persist'),
      ),
    };
  }

  _bindInputHandlers() {
    const input = this.input;
    const keyboard = input?.keyboard;

    // Idempotent unbind to avoid stacked listeners across scene lifecycles.
    this._unbindInputHandlers();

    this._onEsc = (event) => {
      if (event?.repeat) return;
      if (isEscConsumed(this, event)) return;
      // A stacked overlay (help, promotion choice, …) owns ESC while open.
      if (hasOpenOverlay(this)) return;
      if (this._storyDialogueActive || this.dialogueOverlay?.visible) return;
      if ((Number(this._promotionChoicePanelOpen) || 0) > 0) return;
      const handled = this.requestCancel();
      if (handled) consumeEscEvent(this, event);
    };
    this._onPointerDown = (pointer, gameObjects = []) => {
      if (this._storyDialogueActive || this.dialogueOverlay?.visible) return;
      // The original hit list survives a button hiding/destroying itself on down.
      // Remember ownership until release instead of hit-testing replacement UI.
      this._pointerGesture = { pointer, owned: gameObjects.length > 0 };
      this._touchTapDown = { x: pointer.x, y: pointer.y };
      this.onPointerDown(pointer);
    };
    this._onPointerUp = (pointer) => this.onPointerUp(pointer);

    if (keyboard?.on) keyboard.on('keydown-ESC', this._onEsc);
    if (input?.on) {
      input.on('pointerdown', this._onPointerDown);
      input.on('pointerup', this._onPointerUp);
      this._onPointerUpOutside = (pointer) => this.onPointerUpOutside(pointer);
      input.on('pointerupoutside', this._onPointerUpOutside);
    }
  }

  _bindDebugToggleHandler() {
    if (!this.isDevToolsEnabled()) return;
    const keyboard = this.input?.keyboard;
    if (!keyboard?.addKey) return;

    this._unbindDebugToggleHandler();
    this._debugToggleKey = keyboard.addKey(192);
    this._onDebugToggle = () => {
      if (this.shopOverlay || this.rosterOverlay?.visible) return;
      this.debugOverlay?.toggle?.();
    };
    if (this._debugToggleKey?.on) this._debugToggleKey.on('down', this._onDebugToggle);
  }

  _unbindDebugToggleHandler() {
    if (this._debugToggleKey?.off && this._onDebugToggle) {
      this._debugToggleKey.off('down', this._onDebugToggle);
    }
    this._debugToggleKey = null;
    this._onDebugToggle = null;
  }

  _unbindInputHandlers() {
    const input = this.input;
    const keyboard = input?.keyboard;
    if (keyboard?.off && this._onEsc) keyboard.off('keydown-ESC', this._onEsc);
    this._unbindDebugToggleHandler?.();
    if (input?.off) {
      if (this._onPointerDown) input.off('pointerdown', this._onPointerDown);
      if (this._onPointerUp) input.off('pointerup', this._onPointerUp);
      if (this._onPointerUpOutside) input.off('pointerupoutside', this._onPointerUpOutside);
    }
  }

  _onSceneShutdown() {
    if (this._sceneShutdownCleanedUp) return;
    this._sceneShutdownCleanedUp = true;
    this._sceneShuttingDown = true;
    this._pendingRewards?.destroy();
    this._pendingRewards = null;

    const audio = this.registry.get('audio');
    if (audio) audio.releaseMusic(this, 0);
    if (typeof this.sound?.stopByKey === 'function') this.sound.stopByKey('sfx_levelup');
    clearAllSceneTimers(this);
    this._pendingNodeMapHints = null;
    this._storyDialogueActive = false;
    this._promotionChoicePanelOpen = 0;

    this._churchMessageTimer = null;
    this._churchFlavorTimer = null;
    this._transientMessageTimer = null;

    if (this.pauseOverlay?.visible) this.pauseOverlay.hide?.();
    this.pauseOverlay = null;
    if (this.settingsOverlay?.visible) this.settingsOverlay.hide?.();
    this.settingsOverlay = null;
    if (this.rosterOverlay?.visible) this.rosterOverlay.hide?.();
    this.rosterOverlay = null;
    if (this.debugOverlay?.visible) this.debugOverlay.hide?.();
    this.debugOverlay = null;

    if (this.shopOverlay && typeof this.closeShopOverlay === 'function') {
      this.closeShopOverlay();
    }
    if (this.churchOverlay && typeof this.closeChurchOverlay === 'function') {
      this.closeChurchOverlay();
    }
    if (this.colosseumOverlay) {
      this.colosseumOverlay.hide?.();
      this.colosseumOverlay = null;
    }
    if (this.transientMessage) {
      this.transientMessage.destroy();
      this.transientMessage = null;
    }
    if (this.churchMessage) {
      this.churchMessage.destroy();
      this.churchMessage = null;
    }
    if (this.nodeTooltip) {
      this.nodeTooltip.destroy();
      this.nodeTooltip = null;
    }

    if (this.dialogueOverlay) {
      this.dialogueOverlay.destroy();
      this.dialogueOverlay = null;
    }
    this._pendingNodeSelection = null;
    if (this._churchController) {
      this._churchController.destroy();
      this._churchController = null;
    }
    if (this._shopController) {
      this._shopController.destroy();
      this._shopController = null;
    }
    this._unbindInputHandlers();
    popInputScope(this);
    this._onInputActionBound = null;
    if (this._nodeCursor) {
      this._nodeCursor.destroy();
      this._nodeCursor = null;
    }
    if (this.isMobileInput && this._mobileHandlers) {
      const ge = this.game.events;
      for (const [action, handler] of Object.entries(this._mobileHandlers)) {
        ge.off(`mobile:${action}`, handler);
      }
      ge.emit('mobile:setContext', { context: 'none', resetStack: true });
      this._mobileHandlers = null;
    }
  }

  async finalizeSceneReady(lifecycleGeneration = this._sceneLifecycleGeneration) {
    try {
      // Give audio a short unlock window before we accept battle-node interactions.
      await ensureAudioUnlocked(this);
    } catch (_) {}
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
    if (this.input) this.input.enabled = true;

    try {
      if (this.sys?.isActive?.() !== false) {
        if (this.runManager && !this.runManager.hasShownDialogue('runStart')) {
          // Two composed beats: the seer's vision (varies by how the last
          // run ended) followed by the commander's voice line.
          const ctx = buildNarrativeContext({
            meta: this.registry.get('meta'),
            runManager: this.runManager,
          });
          const visionEntries =
            selectDialogueEntries(this.gameData?.dialogue?.actTransitions?.runStart, ctx) || [];
          const voiceEntries =
            selectDialogueEntries(
              this.gameData?.dialogue?.actTransitions?.runStartCommander,
              ctx,
            ) || [];
          const entries = [...visionEntries, ...voiceEntries];
          if (
            Array.isArray(entries) &&
            entries.length > 0 &&
            this.dialogueOverlay &&
            isSceneLifecycleActive(this, lifecycleGeneration)
          ) {
            this._storyDialogueActive = true;
            this.runManager.markDialogueShown('runStart');
            this.persistRunSave();
            try {
              await this.dialogueOverlay.showSequence(
                adaptDialogueEntries(entries, this.runManager.getStartingLordNames?.()),
                { category: 'runStart', key: 'runStart' },
              );
            } finally {
              if (isSceneLifecycleActive(this, lifecycleGeneration)) {
                this._storyDialogueActive = false;
              }
            }
          }
        }

        if (this.sys?.isActive?.() !== false && isSceneLifecycleActive(this, lifecycleGeneration)) {
          await this._showPendingNodeMapHints(lifecycleGeneration);
        } else {
          if (!this._sceneShuttingDown) {
            console.warn('[NodeMapScene] Scene inactive after dialogue - skipping hints');
          }
        }
      } else {
        if (!this._sceneShuttingDown) {
          console.warn(
            '[NodeMapScene] Scene inactive during finalizeSceneReady - skipping dialogue/hints',
          );
        }
      }
    } catch (err) {
      reportAsyncError('NodeMap-finalize-ready', err);
    } finally {
      if (isSceneLifecycleActive(this, lifecycleGeneration)) {
        this.isSceneReady = true;
        const consumedPendingSelection = this._consumePendingNodeSelection?.() === true;
        if (!consumedPendingSelection) {
          const openedAmbushShop = this._maybeOpenPendingAmbushShop?.(lifecycleGeneration) === true;
          if (!openedAmbushShop) {
            this._maybeOpenPendingCaravanShop?.(lifecycleGeneration);
          }
        }
      }
    }
  }

  async _showPendingNodeMapHints(lifecycleGeneration = this._sceneLifecycleGeneration) {
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
    const pending = this._pendingNodeMapHints;
    this._pendingNodeMapHints = null;
    if (!pending) return;
    if (pending.showFirstRun || pending.showIntro) {
      void showMinorHint(
        this,
        pending.showFirstRun
          ? 'Your first run begins here. Home Base upgrades, difficulty and blessings unlock after it ends. Tap a node to preview; Advance commits.'
          : 'Tap any node to preview it. Advance enters a connected available node. Inspect service nodes to see what this route offers.',
      );
    } else if (
      pending.showHpPersist &&
      this.registry.get('hints')?.shouldShow('nodemap_hp_persist')
    ) {
      void showMinorHint(
        this,
        'HP carries between battles. Consumables can heal from Roster; inspect service nodes for other recovery options.',
      );
    }
  }

  _maybeOpenPendingAmbushShop(lifecycleGeneration = this._sceneLifecycleGeneration) {
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return false;
    if (this.sys?.isActive?.() === false) return false;
    if (!this.isSceneReady) return false;
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return false;
    if (this.isTransitioning || this.battleLaunchInFlight) return false;
    if (
      this.shopOverlay ||
      this.churchOverlay ||
      this.rosterOverlay?.visible ||
      this.pauseOverlay?.visible ||
      this.settingsOverlay?.visible
    ) {
      return false;
    }

    const pendingNode = this.runManager?.getAmbushPendingNode?.();
    if (!pendingNode?.id) return false;

    const node = this.runManager?.nodeMap?.nodes?.find((entry) => entry?.id === pendingNode.id);
    if (!node || node.type !== NODE_TYPES.SHOP) return false;

    const currentNodeId = this.runManager?.currentNodeId;
    if (!currentNodeId || currentNodeId !== node.id) return false;

    if (typeof this.handleShop !== 'function') return false;
    this.handleShop(node, { ambushDiscount: true, pendingAmbush: true });
    return true;
  }

  /**
   * Merchant Caravan reward: unlike the ambush shop, this isn't tied to a
   * specific node -- it opens as soon as the map is safe to interact with,
   * mirroring pendingAmbushNodeId's round trip but with node=null.
   */
  _maybeOpenPendingCaravanShop(lifecycleGeneration = this._sceneLifecycleGeneration) {
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return false;
    if (this.sys?.isActive?.() === false) return false;
    if (!this.isSceneReady) return false;
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return false;
    if (this.isTransitioning || this.battleLaunchInFlight) return false;
    if (
      this.shopOverlay ||
      this.churchOverlay ||
      this.rosterOverlay?.visible ||
      this.pauseOverlay?.visible ||
      this.settingsOverlay?.visible
    ) {
      return false;
    }

    const pending = this.runManager?.getPendingCaravanShop?.();
    if (!pending) return false;

    if (typeof this.handleShop !== 'function') return false;
    this.handleShop(null, { caravan: true, caravanActId: pending.actId });
    return true;
  }

  _isPendingAmbushNode(node) {
    const nodeId = node?.id;
    if (!nodeId) return false;
    const pendingNodeId = this.runManager?.getAmbushPendingNode?.()?.id;
    return Boolean(pendingNodeId && pendingNodeId === nodeId);
  }

  _clearPendingAmbushForNode(node) {
    const nodeId = node?.id;
    if (!nodeId) return false;
    const pendingNodeId = this.runManager?.getAmbushPendingNode?.()?.id;
    if (!pendingNodeId || pendingNodeId !== nodeId) return false;
    if (typeof this.runManager?.clearAmbushPendingNode === 'function') {
      return this.runManager.clearAmbushPendingNode(nodeId);
    }
    if (typeof this.runManager?.clearPendingAmbushNode === 'function') {
      return this.runManager.clearPendingAmbushNode(nodeId);
    }
    return false;
  }

  showAmbushFlash(node, lifecycleGeneration = this._sceneLifecycleGeneration) {
    if (!node) return;
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
    if (!this.add || !this.time) {
      void this.handleBattle(node, lifecycleGeneration);
      return;
    }

    const cam = this.cameras?.main;
    const cx = cam?.centerX ?? 320;
    const cy = cam?.centerY ?? 240;
    const backdrop = this.add
      .rectangle(cx, cy, 420, 86, 0x000000, 0.86)
      .setDepth(UI_DEPTHS.NODE_EVENT)
      .setStrokeStyle(2, 0xaa3333)
      .setAlpha(0);
    const label = applyTextResolution(
      this.add.text(cx, cy, 'The village is under attack!', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#ff6666',
        backgroundColor: '#00000000',
      }),
    )
      .setOrigin(0.5)
      .setDepth(UI_DEPTHS.NODE_EVENT + 1)
      .setAlpha(0);

    if (this.tweens?.add) {
      this.tweens.add({ targets: [backdrop, label], alpha: 1, duration: 120 });
    } else {
      backdrop.setAlpha(1);
      label.setAlpha(1);
    }

    const timer = trackSceneTimer(
      this,
      this.time.delayedCall(1500, () => {
        clearTrackedSceneTimer(this, timer);
        if (backdrop?.active) backdrop.destroy();
        if (label?.active) label.destroy();
        if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
        void this.handleBattle(node, lifecycleGeneration);
      }),
    );
  }

  onPointerUp(pointer) {
    const gesture = this._pointerGesture;
    const owned = gesture?.pointer === pointer && gesture.owned;
    this._pointerGesture = null;
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) {
      this._touchDownLatchKind = null;
      return;
    }
    this._touchScrollDrag = null;
    this._touchDownLatchKind = null;
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;
    if (isTouchPointer(pointer) && this._touchTapDown) {
      const dx = pointer.x - this._touchTapDown.x;
      const dy = pointer.y - this._touchTapDown.y;
      if (dx * dx + dy * dy > this._tapMoveThreshold * this._tapMoveThreshold) {
        this._touchTapDown = null;
        this._clearTouchPreviewLatches();
        return;
      }
    }
    this._touchTapDown = null;
    if (this._churchMapViewSuppressCancel) {
      this._churchMapViewSuppressCancel = false;
      return;
    }
    if (owned || this._isPointerOverInteractive(pointer)) return;
    this._clearTouchPreviewLatches();
    this.requestCancel({ allowPause: false });
  }

  onPointerUpOutside(_pointer) {
    this._pointerGesture = null;
    this._touchTooltipPointer = null;
    this._touchScrollDrag = null;
    this._touchTapDown = null;
    this._touchDownLatchKind = null;
    this._churchMapViewSuppressCancel = false;
    this._clearTouchPreviewLatches();
  }

  onPointerDown(pointer) {
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return;
    if (!isTouchPointer(pointer)) return;

    // Kind-based latch clearing: game-object pointerdown fires BEFORE scene
    // pointerdown, so _touchDownLatchKind is set by node/shop handlers.
    // Clear only mismatched latches — preserve the one that matches this tap.
    const kind = this._touchDownLatchKind;
    this._touchDownLatchKind = null;
    if (kind !== 'node') this._touchPreviewedNodeId = null;
    if (kind !== 'shop') this._touchPreviewedShopEntry = null;
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

  _clearTouchPreviewLatches() {
    this._touchPreviewedNodeId = null;
    this._touchPreviewedShopEntry = null;
  }

  canRequestCancel({ allowPause = true } = {}) {
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return false;
    if (this.isDevToolsEnabled() && this.debugOverlay?.visible) return true;
    if (this.settingsOverlay?.visible) return true;
    if (this.rosterOverlay?.visible) return true;
    if (this.pauseOverlay?.visible) return true;
    if (this.shopOverlay) return true;
    if (this.churchOverlay) return true;
    if (this.colosseumOverlay?.visible) return true;
    if (allowPause) return true;
    return false;
  }

  _setOverlayVisibility(overlay, visible) {
    if (!Array.isArray(overlay)) return;
    for (const obj of overlay) {
      if (!obj || obj._destroyed || obj.destroyed) continue;
      try {
        if (typeof obj.setVisible === 'function') {
          obj.setVisible(visible);
        } else {
          obj.visible = visible;
        }
      } catch (_) {}
      try {
        if (obj.input && typeof obj.input === 'object') {
          obj.input.enabled = visible;
        }
      } catch (_) {}
    }
  }

  _setShopOverlayVisibility(visible) {
    this._shopController?.nativeMenu?.setVisible(visible);
    this._setOverlayVisibility(this.shopOverlay, visible);
    this._setOverlayVisibility(this.shopContentGroup, visible);
    this._setOverlayVisibility(this.shopTabObjects, visible);
    this._setOverlayVisibility(this.unitPicker, visible);
    this._setOverlayVisibility(this.forgePicker, visible);
  }

  _setChurchOverlayVisibility(visible) {
    this._churchController?.nativeMenu?.setVisible(visible);
    this._setOverlayVisibility(this.churchOverlay, visible);
    this._setOverlayVisibility(this.churchContentGroup, visible);
  }

  _showServiceMap(onClose) {
    const rm = this.runManager;
    const view = new CampaignMapOverlay(this, {
      nodeMap: rm.nodeMap,
      currentNodeId: rm.currentNodeId,
      activeNodeId: rm.currentNodeId,
      actId: rm.currentAct,
      onClose,
    });
    view.show();
  }

  _enterShopMapView() {
    if (!this.shopOverlay || this._shopViewingMap) return;
    this._touchScrollDrag = null;
    this._setShopOverlayVisibility(false);
    this._shopViewingMap = true;
    if (hasDOMHost())
      this._showServiceMap(() => {
        this._shopViewingMap = false;
        this._setShopOverlayVisibility(true);
      });
  }

  _enterChurchMapView() {
    if (!this.churchOverlay || this._churchViewingMap) return;
    this._touchScrollDrag = null;
    this._setChurchOverlayVisibility(false);
    this._churchViewingMap = true;
    this._churchMapViewSuppressCancel = true;
    this._showServiceMap(() => this._exitChurchMapView());
  }

  _exitChurchMapView() {
    if (!this._churchViewingMap) return;
    if (this._churchReturnBtn) {
      this._churchReturnBtn.destroy();
      this._churchReturnBtn = null;
    }
    // Clear the flag BEFORE restoring visibility so the visibility hook's ring
    // render isn't self-suppressed (the ring guard checks _churchViewingMap).
    this._churchViewingMap = false;
    this._setChurchOverlayVisibility(true);
  }

  requestCancel({ allowPause = true } = {}) {
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) {
      this.dialogueOverlay?.hide(true);
      return true;
    }
    if ((Number(this._promotionChoicePanelOpen) || 0) > 0) return false;
    if (!this.canRequestCancel({ allowPause })) return false;
    if (this.isDevToolsEnabled() && this.debugOverlay?.visible) {
      this.debugOverlay.hide();
      return true;
    }
    if (this.settingsOverlay?.visible) {
      this.settingsOverlay.hide();
      return true;
    }
    if (this.pauseOverlay?.visible) {
      if (!this.pauseOverlay.closeActiveSubOverlay()) {
        this.pauseOverlay.hide();
      }
      return true;
    }
    if (this.rosterOverlay?.visible) {
      this.rosterOverlay.hide();
      return true;
    }
    if (this.shopOverlay) {
      if (this._shopViewingMap) {
        // Clear the flag BEFORE restoring visibility so the visibility hook's ring
        // render isn't self-suppressed (the ring guard checks _shopViewingMap).
        this._shopViewingMap = false;
        this._setShopOverlayVisibility(true);
        return true;
      }
      // ESC closes shop without marking node complete — player can re-enter
      const audio = this.registry.get('audio');
      if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      this._saveShopState();
      this.closeShopOverlay();
      this.drawMap();
      return true;
    }
    if (this.churchOverlay) {
      if (this._churchViewingMap) {
        this._exitChurchMapView();
        return true;
      }
      // ESC closes church without marking node complete — player can re-enter
      if (typeof this.sound?.stopByKey === 'function') this.sound.stopByKey('sfx_levelup');
      const audio = this.registry.get('audio');
      if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      this.closeChurchOverlay();
      this.drawMap();
      return true;
    }
    if (this.colosseumOverlay?.visible) {
      this.colosseumOverlay.hide();
      const audio = this.registry.get('audio');
      if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      this.drawMap();
      return true;
    }
    if (allowPause) {
      this.showPauseMenu();
      return true;
    }
    return false;
  }

  persistRunSave() {
    const cloud = this.registry.get('cloud');
    const slot = this.registry.get('activeSlot');
    const result = saveRun(
      this.runManager,
      cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null,
      slot,
    );
    if (!result.ok) {
      showMinorHint(
        this,
        result.isQuotaError
          ? 'Save failed — storage full. Free device space and retry; keep this app’s saved data.'
          : 'Save failed — storage may be unavailable',
      );
    }
  }

  // Record which act this run has reached so the Compendium Foes tab can gate
  // each act's boss behind having reached it. Real-time (fires on every node-map
  // entry, incl. resumed runs and mid-run act advances), idempotent (guarded by
  // hasMilestone so it does not re-trigger meta saves), and null-safe (dev routes
  // may have no meta singleton).
  _recordActReachedMilestone() {
    const meta = this.registry.get('meta');
    if (!meta?.recordMilestone) return;
    const milestone = ACT_REACHED_MILESTONE[this.runManager?.currentAct];
    if (!milestone) return;
    if (meta.hasMilestone?.(milestone)) return;
    meta.recordMilestone(milestone);
  }

  showPauseMenu(options = {}) {
    if (this.pauseOverlay?.visible) return;
    const payout = this.runManager.previewEndRunRewards?.();
    this.pauseOverlay = new PauseOverlay(this, {
      onAbandonWarning: payout
        ? `Abandon this run?\nKeep ${payout.valor} Valor and ${payout.supply} Supply. This run and its gold, items and route progress will end.`
        : null,
      onResume: () => {
        this.pauseOverlay = null;
        options.onResume?.();
      },
      onSaveAndExit: async () => {
        try {
          // Persist the current map/service state, including an interrupted visit.
          this.persistRunSave();
          const audio = this.registry.get('audio');
          if (audio) audio.stopMusic(this, 0);
          markStartup('pause_transition_attempt', { scene: 'NodeMap', reason: 'SAVE_EXIT' });
          // Blocked-retry absorbs transient cooldown/in-flight locks; the hard
          // fallback below only runs when the transition genuinely cannot start.
          const result = await transitionToSceneWithBlockedRetry(
            this,
            'Title',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.SAVE_EXIT },
          );
          if (result.status !== TRANSITION_RESULTS.STARTED) {
            if (this.sys?.isActive?.() === false) {
              // Scene already shut down -- another transition won the race;
              // a raw start from a dead scene would stomp the live one.
              markStartup('pause_transition_superseded', {
                scene: 'NodeMap',
                reason: 'SAVE_EXIT',
              });
              return;
            }
            markStartup('pause_transition_fallback', { scene: 'NodeMap', reason: 'SAVE_EXIT' });
            resetTransitionLocks(this);
            try {
              this.scene.start('Title', { gameData: this.gameData }); // scene-router-bypass
            } catch (err) {
              markStartup('pause_transition_double_failure', {
                scene: 'NodeMap',
                reason: 'SAVE_EXIT',
              });
              this.showNodeMapTransitionRecovery(TRANSITION_REASONS.SAVE_EXIT);
            }
          }
        } catch (err) {
          reportAsyncError('NodeMap-pause-save-exit', err);
          this.showNodeMapTransitionRecovery(TRANSITION_REASONS.SAVE_EXIT);
        }
      },
      onAbandon: async () => {
        try {
          const cloud = this.registry.get('cloud');
          const slot = this.registry.get('activeSlot');
          clearSavedRun(
            cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null,
            slot,
          );
          this.runManager.failRun();
          this.runManager.settleEndRunRewards(this.registry.get('meta'), 'defeat');
          const audio = this.registry.get('audio');
          if (audio) audio.stopMusic(this, 0);
          markStartup('pause_transition_attempt', { scene: 'NodeMap', reason: 'ABANDON_RUN' });
          const result = await transitionToSceneWithBlockedRetry(
            this,
            'Title',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.ABANDON_RUN },
          );
          if (result.status !== TRANSITION_RESULTS.STARTED) {
            if (this.sys?.isActive?.() === false) {
              // Scene already shut down -- another transition won the race;
              // a raw start from a dead scene would stomp the live one.
              markStartup('pause_transition_superseded', {
                scene: 'NodeMap',
                reason: 'ABANDON_RUN',
              });
              return;
            }
            markStartup('pause_transition_fallback', { scene: 'NodeMap', reason: 'ABANDON_RUN' });
            resetTransitionLocks(this);
            try {
              this.scene.start('Title', { gameData: this.gameData }); // scene-router-bypass
            } catch (err) {
              markStartup('pause_transition_double_failure', {
                scene: 'NodeMap',
                reason: 'ABANDON_RUN',
              });
              this.showNodeMapTransitionRecovery(TRANSITION_REASONS.ABANDON_RUN);
            }
          }
        } catch (err) {
          reportAsyncError('NodeMap-pause-abandon', err);
          this.showNodeMapTransitionRecovery(TRANSITION_REASONS.ABANDON_RUN);
        }
      },
      gameData: this.gameData,
    });
    this.pauseOverlay.show();
  }

  showNodeMapTransitionRecovery(reason = TRANSITION_REASONS.SAVE_EXIT) {
    showTransitionRecoveryPrompt(this, {
      reason,
      sceneName: 'NodeMap',
      guardKey: 'nodeMapTransitionRecovery',
      overlayKey: 'pauseOverlay',
      titleData: { gameData: this.gameData },
    });
  }

  drawMap() {
    this.cameras.main.setBackgroundColor?.(UI_PALETTE.bg);
    // Clear everything
    this.children.removeAll(true);

    // Mobile virtual controls
    const flags = this.registry.get('startupFlags');
    this.isMobileInput = Boolean(flags?.isMobile);
    if (this.isMobileInput) {
      const ge = this.game.events;
      if (!this._mobileHandlers) {
        this._mobileHandlers = {
          cancel: () => this.requestCancel({ allowPause: false }),
          menu: () => this.requestCancel(),
          roster: () => this._openRoster(),
        };
        for (const [action, handler] of Object.entries(this._mobileHandlers)) {
          const routed = () => routeMobileAction(this, action, handler);
          this._mobileHandlers[action] = routed;
          ge.on(`mobile:${action}`, routed);
        }
      }
      ge.emit('mobile:setContext', { context: 'nodemap' });
    }

    if (hasDOMHost()) {
      if (!this.nodeView || this.nodeView.destroyed) this.nodeView = new NodeMapMenu(this);
      this.nodeView.render();
      return;
    }
    const rm = this.runManager;
    const nodeMap = rm.nodeMap;
    const actConfig = ACT_CONFIG[rm.currentAct];
    const availableNodes = rm.getAvailableNodes();
    const availableIds = new Set(availableNodes.map((n) => n.id));

    // Title
    applyTextResolution(
      this.add.text(this.cameras.main.centerX, 20, `Act ${rm.actIndex + 1}: ${actConfig.name}`, {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: UI_PALETTE.accent,
      }),
    ).setOrigin(0.5);

    // Gold display + info labels (dynamic stacking to stay above MAP_TOP=60)
    let infoY = 14;
    const infoX = this.cameras.main.width - 20;
    applyTextResolution(
      this.add.text(infoX, infoY, `${rm.gold}G`, {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: UI_PALETTE.accent,
      }),
    ).setOrigin(1, 0);
    infoY += 12;

    // Difficulty label (non-Normal only)
    const diffLabel = rm.difficultyModifiers?.label || 'Normal';
    const diffColor = rm.difficultyModifiers?.color || '#44cc44';
    if (diffLabel !== 'Normal') {
      applyTextResolution(
        this.add.text(infoX, infoY, diffLabel, {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: diffColor,
        }),
      ).setOrigin(1, 0);
      infoY += 11;
    }

    // No Meta indicator
    if (rm.noMetaMode === true) {
      applyTextResolution(
        this.add.text(infoX, infoY, 'NO META', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#ff8800',
        }),
      ).setOrigin(1, 0);
      infoY += 11;
    }

    // Win streak display (only when >= 2)
    if (rm.winStreak >= 2) {
      applyTextResolution(
        this.add.text(infoX, infoY, `Streak: ${rm.winStreak}`, {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#88ccff',
        }),
      ).setOrigin(1, 0);
    }

    // Gear icon — opens settings
    const gear = applyTextResolution(
      this.add.text(20, 16, '\u2699', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: UI_PALETTE.muted,
      }),
    ).setInteractive({ useHandCursor: true });
    gear.on('pointerover', () => gear.setColor(UI_PALETTE.accent));
    gear.on('pointerout', () => gear.setColor(UI_PALETTE.muted));
    gear.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (this.settingsOverlay?.visible) return;
      this.settingsOverlay = new SettingsOverlay(this, () => {
        this.settingsOverlay = null;
      });
      this.settingsOverlay.show();
    });

    // Compute node positions — bottom-to-top (row 0 at bottom, boss at top)
    // X position is determined by column lane (fixed grid 0-4), not even distribution
    const totalRows = Math.max(...nodeMap.nodes.map((n) => n.row)) + 1;
    const NUM_COLUMNS = 5; // Must match NodeMapGenerator.js
    const nodePositions = new Map();

    for (const node of nodeMap.nodes) {
      const yFrac = 1 - node.row / Math.max(totalRows - 1, 1);
      const y = MAP_TOP + yFrac * (MAP_BOTTOM - MAP_TOP);
      // Use fixed column grid (0-4) to preserve column-lane spacing
      const xFrac = node.col / (NUM_COLUMNS - 1);
      const x = MAP_LEFT + xFrac * (MAP_RIGHT - MAP_LEFT);
      nodePositions.set(node.id, { x, y });
    }

    // Draw edges
    const graphics = this.add.graphics();
    for (const node of nodeMap.nodes) {
      const from = nodePositions.get(node.id);
      for (const edgeId of node.edges) {
        const to = nodePositions.get(edgeId);
        if (!from || !to) continue;
        const isActive =
          (node.completed && availableIds.has(edgeId)) ||
          (rm.currentNodeId === null && node.id === nodeMap.startNodeId);
        graphics.lineStyle(2, isActive ? COLOR_EDGE_ACTIVE : COLOR_EDGE, isActive ? 1 : 0.7);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    // Draw nodes
    for (const node of nodeMap.nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;

      const isAvailable = availableIds.has(node.id);
      const isCompleted = node.completed;
      const isLocked = !isAvailable && !isCompleted;
      const isEliteNode = node.type === NODE_TYPES.BATTLE && node.battleParams?.isElite;
      const isChurchNode = node.type === NODE_TYPES.CHURCH;

      let color;
      if (isCompleted) {
        color = COLOR_COMPLETED;
      } else if (isAvailable) {
        color = COLOR_AVAILABLE;
      } else if (isEliteNode) {
        color = COLOR_ELITE;
      } else {
        color = NODE_COLORS[node.type] || COLOR_BATTLE;
      }

      // Special node aura (elite/church). Completed nodes intentionally hide aura.
      if (!isCompleted && (isEliteNode || isChurchNode)) {
        const auraColor = isEliteNode ? AURA_ELITE_COLOR : AURA_CHURCH_COLOR;
        const auraRadius = isEliteNode ? AURA_ELITE_RADIUS : AURA_CHURCH_RADIUS;
        const auraAlphaRange = isEliteNode ? AURA_ELITE_ALPHA : AURA_CHURCH_ALPHA;
        const auraDuration = isEliteNode ? AURA_ELITE_DURATION : AURA_CHURCH_DURATION;
        const aura = this.add
          .circle(pos.x, pos.y, auraRadius, auraColor, auraAlphaRange[0])
          .setDepth(AURA_DEPTH);
        aura.setBlendMode(Phaser.BlendModes.NORMAL);

        if (isAvailable) {
          aura.setAlpha(auraAlphaRange[0]);
          this.tweens.add({
            targets: aura,
            alpha: auraAlphaRange[1],
            duration: auraDuration,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        } else if (isLocked) {
          // Static dim aura for locked nodes to reduce background motion noise.
          const lockedAlpha = isChurchNode
            ? Math.max(auraAlphaRange[0] * AURA_LOCKED_ALPHA_SCALE, 0.18)
            : Math.max(auraAlphaRange[0] * AURA_LOCKED_ALPHA_SCALE, 0.24);
          aura.setAlpha(lockedAlpha);
        }
      }

      // Node icon — use sprite if loaded, fall back to colored rectangle + unicode
      let spriteKey = node.type === NODE_TYPES.CHURCH ? 'node_rest' : `node_${node.type}`;
      // Elite seize battles use dark fortress sprite
      if (isEliteNode) {
        spriteKey = 'node_elite';
      }
      if (node.type === NODE_TYPES.BOSS) {
        const actId = this.runManager.nodeMap.actId;
        if (actId === 'finalBoss') spriteKey = 'node_boss_final';
      }
      const weatheredFrames = {
        node_battle: 0,
        node_rest: 1,
        node_boss: 2,
        node_shop: 3,
        node_ruins: 4,
        node_recruit: 5,
        node_colosseum: 6,
        node_elite: 7,
        node_boss_final: 8,
      };
      const weatheredFrame = weatheredFrames[spriteKey];
      const hasWeathered = this.textures.get?.('weathered_nodes')?.has?.(weatheredFrame);
      let nodeObj;
      if (this.textures.exists(spriteKey)) {
        nodeObj = this.add
          .image(
            pos.x,
            pos.y,
            hasWeathered ? 'weathered_nodes' : spriteKey,
            hasWeathered ? weatheredFrame : undefined,
          )
          .setDisplaySize(NODE_SIZE + 18, NODE_SIZE + 18)
          .setDepth(NODE_DEPTH);
        if (isCompleted) nodeObj.setTint(0x555555);
        if (!isAvailable && !isCompleted) nodeObj.setAlpha(0.85);
      } else {
        nodeObj = this.add
          .rectangle(pos.x, pos.y, NODE_SIZE, NODE_SIZE, color)
          .setStrokeStyle(2, isAvailable ? 0xffffff : UI_HEX.line)
          .setDepth(NODE_DEPTH);
        const icon = NODE_ICONS[node.type] || '?';
        applyTextResolution(
          this.add.text(pos.x, pos.y, icon, {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: isCompleted ? UI_PALETTE.muted : UI_PALETTE.text,
          }),
        )
          .setOrigin(0.5)
          .setDepth(NODE_DEPTH + 1);
      }

      // Make available nodes interactive
      if (isAvailable) {
        nodeObj.setInteractive({ useHandCursor: true });

        // Pulse animation
        this.tweens.add({
          targets: nodeObj,
          scaleX: nodeObj.scaleX * 1.15,
          scaleY: nodeObj.scaleY * 1.15,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });

        this._bindNodeTouchHandlers(nodeObj, node, pos, true);
      } else if (!isCompleted) {
        // Non-available, non-completed: hover tooltip for route planning (not clickable)
        nodeObj.setInteractive();
        this._bindNodeTouchHandlers(nodeObj, node, pos, false);
      }
    }

    // Roster bar
    this.drawRoster();

    // Roster button (bottom-right, near gear icon area)
    this._rosterBtn = applyTextResolution(
      this.add.text(this.cameras.main.width - 20, MAP_BOTTOM + 14, '[ Roster ]', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: UI_PALETTE.text,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 8, y: 4 },
      }),
    )
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this._rosterBtn.on('pointerover', () => this._rosterBtn.setColor(UI_PALETTE.accent));
    this._rosterBtn.on('pointerout', () => this._rosterBtn.setColor(UI_PALETTE.text));
    this._rosterBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._openRoster();
    });

    if (this.isMobileInput) this._rosterBtn.setVisible(false);

    // Instructions
    applyTextResolution(
      this.add.text(
        this.cameras.main.centerX,
        MAP_BOTTOM + 30,
        inputHint(this, 'Click a node to proceed', 'Tap a node to proceed'),
        {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: UI_PALETTE.muted,
        },
      ),
    ).setOrigin(0.5);

    // Refresh the gamepad cursor over this frame's available nodes (the marker was
    // wiped by children.removeAll at the top of drawMap).
    this._nodeCursor?.setNodes(availableNodes, nodePositions);
  }

  // Device-independent input from the global reader (top of the input-focus stack).
  // Overlays (shop/church/roster/pause) aren't gamepad-wired yet (Phase 2D); while
  // one is open the map cursor stays inert, but CANCEL still cascades through
  // requestCancel to close it.
  _onInputAction(action, payload) {
    if (action === InputAction.CANCEL || action === InputAction.PAUSE) {
      this.requestCancel();
      return;
    }
    if (!this.isSceneReady || this.isTransitioning || this.battleLaunchInFlight) return;
    if (this._nodeMapOverlayOpen()) return;
    switch (action) {
      case InputAction.NAVIGATE:
        this._nodeCursor?.move(payload?.dx || 0, payload?.dy || 0);
        break;
      case InputAction.CONFIRM:
        this._nodeCursor?.confirm();
        break;
      case InputAction.ROSTER:
        this._openRoster();
        break;
    }
  }

  _nodeMapOverlayOpen() {
    return Boolean(
      this.shopOverlay ||
      this.churchOverlay ||
      this.colosseumOverlay?.visible ||
      this._colosseumLoading ||
      this.rosterOverlay?.visible ||
      this.pauseOverlay?.visible ||
      this.settingsOverlay?.visible ||
      this._storyDialogueActive ||
      this.dialogueOverlay?.visible,
    );
  }

  _openRoster() {
    // Advance hides the route menu, uncovering the mobile rail's Roster button
    // for the ~2s battle launch. An overlay opened now would be torn down by
    // shutdown mid-transition, so ignore it until the scene is stable again.
    if (this.isTransitioning || this.battleLaunchInFlight || this._sceneShuttingDown) return;
    if (this.rosterOverlay?.visible) return;
    if (this.shopOverlay && !this._shopViewingRoster) return;
    if (this.churchOverlay && !this._churchViewingMap && !this._churchViewingRoster) return;
    if (this.pauseOverlay?.visible || this.settingsOverlay?.visible) return;
    this.rosterOverlay = new RosterOverlay(this, this.runManager, this.gameData, {
      onClose: () => {
        this.rosterOverlay = null;
        const cloud = this.registry.get('cloud');
        const slot = this.registry.get('activeSlot');
        const result = saveRun(
          this.runManager,
          cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null,
          slot,
        );
        if (!result.ok) {
          showMinorHint(
            this,
            result.isQuotaError
              ? 'Save failed — storage full. Free device space and retry; keep this app’s saved data.'
              : 'Save failed — storage may be unavailable',
          );
        }
        // Closed by scene shutdown: the camera and display list are already
        // being torn down, so redrawing would throw inside the shutdown event
        // and stall the next scene's start.
        if (this._sceneShuttingDown || this.sys?.isActive?.() === false) return;
        if (!this.shopOverlay && !this.churchOverlay) {
          this.drawMap();
        }
      },
    });
    this.rosterOverlay.show();
  }

  drawRoster() {
    const roster = this.runManager.roster || [];
    const lordNames = new Set(
      (this.gameData?.lords || []).map((lord) => lord?.name).filter(Boolean),
    );
    const isLordUnit = (unit) => Boolean(unit?.isLord || (unit?.name && lordNames.has(unit.name)));
    const lords = roster.filter((unit) => isLordUnit(unit));
    const showingLords = lords.length > 0;
    const shownUnits = showingLords ? lords : roster.slice(0, 4);
    const hiddenCount = showingLords
      ? Math.max(0, roster.length - lords.length)
      : Math.max(0, roster.length - shownUnits.length);
    const startX = 40;
    const maxWidth = 560; // 640 - 40 margin on each side
    const spacing = Math.min(300, Math.floor(maxWidth / Math.max(shownUnits.length, 1)));
    const compact = spacing < 160;

    for (let i = 0; i < shownUnits.length; i++) {
      const unit = shownUnits[i];
      if (!unit || !unit.stats) continue;
      const x = startX + i * spacing;

      // Name and class — truncate in compact mode
      const label = compact
        ? `${unit.name} Lv${getDisplayLevel(unit)}`
        : `${unit.name} Lv${getDisplayLevel(unit)} ${unit.className}`;
      applyTextResolution(
        this.add.text(x, ROSTER_Y, label, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.text,
        }),
      );

      // HP bar — scale width with spacing
      const barWidth = Math.min(120, spacing - 20);
      const barHeight = 8;
      const barX = x;
      const barY = ROSTER_Y + 18;
      const maxHp = Math.max(1, Number(unit.stats.HP) || 1);
      const ratio = Phaser.Math.Clamp((Number(unit.currentHP) || 0) / maxHp, 0, 1);

      this.add.rectangle(
        barX + barWidth / 2,
        barY + barHeight / 2,
        barWidth,
        barHeight,
        UI_HEX.raised,
      );
      const fillColor = getHPBarColor(ratio);
      this.add.rectangle(
        barX + (barWidth * ratio) / 2,
        barY + barHeight / 2,
        barWidth * ratio,
        barHeight,
        fillColor,
      );

      // HP text (only if enough space)
      if (spacing >= 80) {
        applyTextResolution(
          this.add.text(barX + barWidth + 4, barY - 2, `${unit.currentHP}/${maxHp}`, {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: UI_PALETTE.muted,
          }),
        );
      }
    }

    if (hiddenCount > 0) {
      const anchorX = Phaser.Math.Clamp(startX + shownUnits.length * spacing, 120, 560);
      applyTextResolution(
        this.add.text(anchorX, ROSTER_Y + 2, `+${hiddenCount} more`, {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: UI_PALETTE.muted,
        }),
      );
    }
  }

  showNodeTooltip(node, pos) {
    this.hideNodeTooltip();
    let label;
    if (node.type === NODE_TYPES.BOSS) {
      label = 'Boss Battle (Seize)';
    } else if (node.type === NODE_TYPES.CHURCH) {
      label = 'Church — Heal, revive fallen, promote';
    } else if (node.type === NODE_TYPES.RUINS) {
      label = 'Ruins — Scarce wares, heal, and revive';
    } else if (node.type === NODE_TYPES.SHOP) {
      label = 'Village — Buy, sell, and forge';
    } else if (node.type === NODE_TYPES.RECRUIT) {
      label = 'Recruit — Battle with potential ally';
    } else if (node.type === NODE_TYPES.COLOSSEUM) {
      label = 'Colosseum - Arena and Mercenary Board';
    } else if (node.battleParams?.isElite) {
      const eliteObj = node.battleParams?.objective === 'escape' ? 'Escape' : 'Seize';
      label = `Elite Battle (${eliteObj}) — Harder fight, better loot`;
    } else {
      const obj = node.battleParams?.objective || 'rout';
      label = `Battle (${obj})`;
    }
    if (
      (node.type === NODE_TYPES.BATTLE ||
        node.type === NODE_TYPES.BOSS ||
        node.type === NODE_TYPES.RECRUIT) &&
      node.encounterLocked
    ) {
      label += '\nEncounter Locked';
    }
    this.nodeTooltip = applyTextResolution(
      this.add.text(pos.x, pos.y - NODE_SIZE - 8, label, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.text,
        backgroundColor: '#000000cc',
        padding: { x: 4, y: 2 },
      }),
    )
      .setOrigin(0.5, 1)
      .setDepth(100);
    const halfW = this.nodeTooltip.width * 0.5;
    const margin = 6;
    const minX = halfW + margin;
    const maxX = this.cameras.main.width - halfW - margin;
    this.nodeTooltip.x = Phaser.Math.Clamp(this.nodeTooltip.x, minX, maxX);
  }

  hideNodeTooltip() {
    if (this.nodeTooltip) {
      this.nodeTooltip.destroy();
      this.nodeTooltip = null;
    }
  }

  _bindNodeTouchHandlers(nodeObj, node, pos, isAvailable) {
    if (isAvailable) {
      nodeObj.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        if (isTouchPointer(pointer)) {
          this._touchDownLatchKind = 'node';
          // Two-tap: first tap = preview tooltip, second tap = navigate
          const now = Date.now();
          if (
            this._touchPreviewedNodeId === node.id &&
            now - (this._touchPreviewedAt || 0) < 3000
          ) {
            this._touchPreviewedNodeId = null;
            this.onNodeClick(node);
          } else {
            this._touchPreviewedNodeId = node.id;
            this._touchPreviewedAt = now;
            this.showNodeTooltip(node, pos);
          }
          return;
        }
        this.onNodeClick(node);
      });
      nodeObj.on('pointerover', () => this.showNodeTooltip(node, pos));
      nodeObj.on('pointerout', () => this.hideNodeTooltip());
    } else {
      nodeObj.on('pointerover', () => this.showNodeTooltip(node, pos));
      nodeObj.on('pointerout', () => this.hideNodeTooltip());
      // Explicit touch tooltip — pointerover may not fire reliably on all touch devices
      nodeObj.on('pointerdown', (pointer) => {
        if (isTouchPointer(pointer)) {
          this._touchDownLatchKind = 'node';
          this._touchPreviewedNodeId = null; // disarm navigation latch on locked-node tap
          this.showNodeTooltip(node, pos);
        }
      });
    }
  }

  openPendingRewards() {
    if (
      !this.isSceneReady ||
      this.isStoryInputLocked?.() ||
      !this.runManager.pendingBattleReward ||
      this._pendingRewards
    )
      return;
    this._pendingRewards = new PendingRewardController(this, {
      onLeave: () => {
        this._pendingRewards = null;
        this.drawMap();
      },
      onComplete: () => {
        this._pendingRewards = null;
        this.checkActComplete();
      },
    });
  }

  onNodeClick(node) {
    if (this.isTransitioning) return;
    if (this.battleLaunchInFlight) return;
    if (this.runManager?.pendingBattleReward) {
      this.openPendingRewards();
      return;
    }
    if (!this.isSceneReady) {
      if (this._storyDialogueActive || this.dialogueOverlay?.visible) {
        this._pendingNodeSelection = node?.id ? { nodeId: node.id } : null;
        if (this.dialogueOverlay?.visible && typeof this.dialogueOverlay.hide === 'function') {
          this.dialogueOverlay.hide(true);
        }
      }
      return;
    }
    if (
      this.shopOverlay ||
      this.churchOverlay ||
      this.colosseumOverlay?.visible ||
      this._colosseumLoading ||
      this.rosterOverlay?.visible ||
      this.pauseOverlay?.visible
    )
      return;
    if (node.type === NODE_TYPES.CHURCH) {
      this.runManager.currentNodeId = node.id;
      this.handleChurch(node);
    } else if (node.type === NODE_TYPES.RUINS) {
      this.runManager.currentNodeId = node.id;
      this.handleRuins(node);
    } else if (node.type === NODE_TYPES.COLOSSEUM) {
      this.runManager.currentNodeId = node.id;
      this.handleColosseum(node);
    } else if (node.type === NODE_TYPES.SHOP) {
      if (node?.isAmbush === true && node?.ambushCleared !== true) {
        this.battleLaunchInFlight = true;
        this.isTransitioning = true;
        this.isSceneReady = false;
        if (this.input) this.input.enabled = false;
        this.showAmbushFlash(node, this._sceneLifecycleGeneration);
        return;
      }
      this.runManager.currentNodeId = node.id;
      const pendingAmbush = this._isPendingAmbushNode?.(node) === true;
      this.handleShop(node, {
        ambushDiscount: Boolean(node?.isAmbush && (node?.ambushCleared === true || pendingAmbush)),
        pendingAmbush,
      });
    } else {
      try {
        this._showNodeFlavor?.(node);
      } catch (_) {
        /* best-effort flavor */
      }
      // Immediately lock node interactions before any async work begins.
      this.battleLaunchInFlight = true;
      this.isTransitioning = true;
      this.isSceneReady = false;
      if (this.input) this.input.enabled = false;
      void this.handleBattle(node, this._sceneLifecycleGeneration);
    }
  }

  _consumePendingNodeSelection() {
    const pending = this._pendingNodeSelection;
    if (!pending?.nodeId) return false;
    this._pendingNodeSelection = null;

    if (!this.isSceneReady || this.isTransitioning || this.battleLaunchInFlight) return false;

    const node = this.runManager?.nodeMap?.nodes?.find((entry) => entry?.id === pending.nodeId);
    if (!node) return false;

    const availableNodes = this.runManager?.getAvailableNodes?.() || [];
    const isAvailable = availableNodes.some((entry) => entry?.id === node.id);
    if (!isAvailable) return false;

    this.onNodeClick(node);
    return true;
  }

  async handleBattle(node, lifecycleGeneration = this._sceneLifecycleGeneration) {
    if (!this.battleLaunchInFlight) return;
    try {
      await ensureAudioUnlocked(this);
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);

      const rm = this.runManager;
      const battleParams = rm.getBattleParams(node);
      const roster = rm.getRoster();
      const transitioned = await transitionToScene(
        this,
        'Battle',
        {
          gameData: this.gameData,
          runManager: rm,
          battleParams,
          roster,
          nodeId: node.id,
          isBoss: node.type === NODE_TYPES.BOSS,
          isElite: battleParams?.isElite || false,
        },
        { reason: TRANSITION_REASONS.ENTER_BATTLE, retryBlocked: true },
      );
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
      if (transitioned === false) {
        this.battleLaunchInFlight = false;
        this.isTransitioning = false;
        this.isSceneReady = true;
        if (this.input) this.input.enabled = true;
        if (audio)
          void audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      }
    } catch (err) {
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
      console.error('[NodeMapScene] Failed to start battle scene:', err);
      const audio = this.registry.get('audio');
      this.battleLaunchInFlight = false;
      this.isTransitioning = false;
      this.isSceneReady = true;
      if (this.input) this.input.enabled = true;
      if (audio)
        void audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      this.showTransientMessage('Failed to enter battle. Please try again.', '#ff6666');
    }
  }

  handleColosseum(node) {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.shop), this, 300);

    // Reuse existing overlay only if same node + same act (state is still valid)
    if (
      this.colosseumOverlay &&
      this.colosseumOverlay._node?.id === node.id &&
      this.colosseumOverlay._actId === this.runManager.currentAct
    ) {
      this.colosseumOverlay.show(node, () => this.leaveColosseumNode(node));
      return;
    }

    // Different node/act or no overlay — destroy old if present, create fresh
    if (this.colosseumOverlay) {
      this.colosseumOverlay.hide();
      this.colosseumOverlay = null;
    }

    this._colosseumLoading = true;
    import('../ui/ColosseumOverlay.js')
      .then(({ ColosseumOverlay }) => {
        this._colosseumLoading = false;
        if (!this.scene?.isActive?.()) return;
        this.colosseumOverlay = new ColosseumOverlay(this, this.runManager, this.gameData);
        this.colosseumOverlay.show(node, () => this.leaveColosseumNode(node));
      })
      .catch((err) => {
        this._colosseumLoading = false;
        console.error('[NodeMapScene] Failed to load ColosseumOverlay:', err);
        if (!this.scene?.isActive?.()) return;
        const catchAudio = this.registry?.get?.('audio');
        if (catchAudio) {
          void catchAudio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
        }
        this.showTransientMessage?.('Failed to open Colosseum. Please try again.', '#ff6666');
      });
  }

  leaveColosseumNode(node) {
    if (!this.colosseumOverlay) return;
    this.colosseumOverlay = null;
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
    if (node) {
      this.runManager.markNodeComplete(node.id);
      this.persistRunSave();
      this.checkActComplete();
    }
    this.drawMap();
  }

  handleChurch(node) {
    (this._churchController ||= new ChurchController(this)).handleChurch(node);
  }

  handleRuins(node) {
    (this._churchController ||= new ChurchController(this)).handleRuins(node);
  }

  showChurchOverlay(node, options = {}) {
    (this._churchController ||= new ChurchController(this)).showChurchOverlay(node, options);
  }

  leaveChurchNode() {
    (this._churchController ||= new ChurchController(this)).leaveChurchNode();
  }

  _showChurchSuccessMessage(node, functionalMessage, functionalColor, flavorType) {
    (this._churchController ||= new ChurchController(this))._showChurchSuccessMessage(
      node,
      functionalMessage,
      functionalColor,
      flavorType,
    );
  }

  _scheduleChurchFlavor(flavorType, delayMs = 600) {
    (this._churchController ||= new ChurchController(this))._scheduleChurchFlavor(
      flavorType,
      delayMs,
    );
  }

  showChurchMessage(text, color) {
    (this._churchController ||= new ChurchController(this)).showChurchMessage(text, color);
  }

  showTransientMessage(text, color = '#ff6666') {
    if (this.transientMessage) this.transientMessage.destroy();
    clearTrackedSceneTimer(this, this._transientMessageTimer);
    this._transientMessageTimer = null;
    this.transientMessage = applyTextResolution(
      this.add.text(this.cameras.main.centerX, 96, text, {
        fontFamily: 'Arial',
        fontSize: '12px',
        color,
        backgroundColor: '#000000dd',
        padding: { x: 8, y: 4 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(400);
    this._transientMessageTimer = trackSceneTimer(
      this,
      this.time?.delayedCall?.(2200, () => {
        this._transientMessageTimer = null;
        if (this.transientMessage) {
          this.transientMessage.destroy();
          this.transientMessage = null;
        }
      }),
    );
  }

  refreshChurchOverlay(node) {
    (this._churchController ||= new ChurchController(this)).refreshChurchOverlay(node);
  }

  closeChurchOverlay() {
    (this._churchController ||= new ChurchController(this)).closeChurchOverlay();
  }

  handleShop(node, options = {}) {
    return (this._shopController ||= new ShopController(this)).handleShop(node, options);
  }

  applyDifficultyShopPricing(items) {
    return (this._shopController ||= new ShopController(this)).applyDifficultyShopPricing(items);
  }

  applyAmbushDiscount(items) {
    return (this._shopController ||= new ShopController(this)).applyAmbushDiscount(items);
  }

  applyRuinsMarkup(items) {
    return (this._shopController ||= new ShopController(this)).applyRuinsMarkup(items);
  }

  showShopOverlay(node, shopItems, options = {}) {
    return (this._shopController ||= new ShopController(this)).showShopOverlay(
      node,
      shopItems,
      options,
    );
  }

  leaveShopNode() {
    return (this._shopController ||= new ShopController(this)).leaveShopNode();
  }

  _getWeaponArtCatalog() {
    return (this._shopController ||= new ShopController(this))._getWeaponArtCatalog();
  }

  _getShopItemDetailText(entry) {
    return (this._shopController ||= new ShopController(this))._getShopItemDetailText(entry);
  }

  _saveShopState() {
    return (this._shopController ||= new ShopController(this))._saveShopState();
  }

  refreshShop() {
    return (this._shopController ||= new ShopController(this)).refreshShop();
  }

  showShopBanner(msg, color) {
    return (this._shopController ||= new ShopController(this)).showShopBanner(msg, color);
  }

  showWeaponArtsUnlockedBanner(artIds = []) {
    return (this._shopController ||= new ShopController(this)).showWeaponArtsUnlockedBanner(artIds);
  }

  _showNodeFlavor(node) {
    try {
      if (!node?.type) return;
      const typeKey = node.isElite
        ? 'elite'
        : node.type === 'boss'
          ? 'boss'
          : node.type === 'recruit'
            ? 'recruit'
            : 'battle';
      const pool = this.gameData?.dialogue?.nodeFlavor?.[typeKey];
      if (!pool) return;
      const act = this.runManager?.currentAct || 'act1';
      const lines = pool[act] || pool['act3'];
      if (!Array.isArray(lines) || lines.length === 0) return;
      const line =
        this.runManager?.pickNarrativeLine?.(lines, `node:${act}:${typeKey}`) || lines[0];
      this.showShopBanner(line, '#aabbcc');
    } catch (_) {
      /* best-effort flavor */
    }
  }

  _showSkillDisplacementWarning(displacedSkills) {
    return (this._shopController ||= new ShopController(this))._showSkillDisplacementWarning(
      displacedSkills,
    );
  }

  closeShopOverlay() {
    return (this._shopController ||= new ShopController(this)).closeShopOverlay();
  }

  checkActComplete() {
    const rm = this.runManager;
    if (rm.pendingBattleReward) {
      this.drawMap();
      return;
    }
    if (rm.isActComplete()) {
      if (rm.isRunComplete()) {
        rm.status = 'victory';
        rm.settleEndRunRewards(this.registry.get('meta'), 'victory');
        void transitionToScene(
          this,
          'RunComplete',
          {
            gameData: this.gameData,
            runManager: rm,
            result: 'victory',
          },
          { reason: TRANSITION_REASONS.VICTORY },
        );
      } else {
        this.showActCompleteBanner(async () => {
          const { unlockedArtIds, displacedSkills } = rm.advanceAct();
          this.persistRunSave();
          this.drawMap();
          this.showWeaponArtsUnlockedBanner(unlockedArtIds);
          await this._showSkillDisplacementWarning(displacedSkills);
        });
      }
    } else {
      this.drawMap();
    }
  }

  showActCompleteBanner(onComplete) {
    const banner = applyTextResolution(
      this.add.text(this.cameras.main.centerX, this.cameras.main.centerY, 'Act Complete!', {
        fontFamily: 'Arial',
        fontSize: '24px',
        color: UI_PALETTE.accent,
        backgroundColor: '#000000dd',
        padding: { x: 20, y: 10 },
      }),
    )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(200);

    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 300,
      yoyo: true,
      hold: 1200,
      onComplete: () => {
        banner.destroy();
        if (onComplete) onComplete();
      },
    });
  }
}
