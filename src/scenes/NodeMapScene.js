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
import {
  OVERLAY_CONTENT_DEPTH,
  SHOP_LIST_TOP_Y,
  SHOP_LIST_BOTTOM_Y,
  SHOP_SCROLL_STEP,
  UNIT_PICKER_SCROLL_STEP,
  CHURCH_LIST_TOP_Y,
  CHURCH_VIEW_MAP_Y,
  CHURCH_LIST_BOTTOM_Y,
  CHURCH_SCROLL_STEP,
} from '../ui/nodeMapOverlayLayout.js';

// Layout constants
const MAP_TOP = 60;
const MAP_BOTTOM = 400;
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
const COLOR_AVAILABLE = 0xffdd44;
const COLOR_EDGE = 0x666666;
const COLOR_EDGE_ACTIVE = 0xffdd44;
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
// Shop/church overlay layout constants now live in ../ui/nodeMapOverlayLayout.js
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

    this.pauseOverlay = null;
    this.settingsOverlay = null;
    this.rosterOverlay = null;
    this.nodeMapTransitionRecovery = null;
    this.dialogueOverlay = new DialogueOverlay(this);
    this._storyDialogueActive = false;
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;
    this._touchScrollDrag = null;
    this._shopViewingMap = false;
    this._churchViewingMap = false;
    this._shopViewingRoster = false;
    this._churchViewingRoster = false;
    this._shopOriginalSlotCount = 0;
    this._currentShopHasAmbushDiscount = false;
    this._currentShopIsRuins = false;

    // Debug overlay (dev-only)
    if (this.isDevToolsEnabled()) {
      this.debugOverlay = new DebugOverlay(this);
      this._bindDebugToggleHandler();
    }

    this.drawMap();
    this.input.enabled = false;
    void this.finalizeSceneReady(lifecycleGeneration);

    const hints = this.registry.get('hints');
    this._pendingNodeMapHints = {
      showIntro: Boolean(hints?.shouldShow('nodemap_intro')),
      showHpPersist: Boolean(
        hints?.shouldShow('nodemap_hp_persist') && this.runManager.completedBattles >= 1,
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
    this._onPointerDown = (pointer) => {
      if (this._storyDialogueActive || this.dialogueOverlay?.visible) return;
      this._touchTapDown = { x: pointer.x, y: pointer.y };
      this.onPointerDown(pointer);
    };
    this._onPointerMove = (pointer) => this.onPointerMove(pointer);
    this._onPointerUp = (pointer) => this.onPointerUp(pointer);
    this._onWheel = (pointer, gameObjects, deltaX, deltaY) => this.onWheel(pointer, deltaX, deltaY);

    if (keyboard?.on) keyboard.on('keydown-ESC', this._onEsc);
    if (input?.on) {
      input.on('pointerdown', this._onPointerDown);
      input.on('pointermove', this._onPointerMove);
      input.on('pointerup', this._onPointerUp);
      this._onPointerUpOutside = (pointer) => this.onPointerUpOutside(pointer);
      input.on('pointerupoutside', this._onPointerUpOutside);
      input.on('wheel', this._onWheel);
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
      if (this._onPointerMove) input.off('pointermove', this._onPointerMove);
      if (this._onPointerUp) input.off('pointerup', this._onPointerUp);
      if (this._onPointerUpOutside) input.off('pointerupoutside', this._onPointerUpOutside);
      if (this._onWheel) input.off('wheel', this._onWheel);
    }
  }

  _onSceneShutdown() {
    if (this._sceneShutdownCleanedUp) return;
    this._sceneShutdownCleanedUp = true;
    this._sceneShuttingDown = true;

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
          this._maybeOpenPendingAmbushShop?.(lifecycleGeneration);
        }
      }
    }
  }

  async _showPendingNodeMapHints(lifecycleGeneration = this._sceneLifecycleGeneration) {
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
    const pending = this._pendingNodeMapHints;
    this._pendingNodeMapHints = null;
    if (!pending) return;
    if (pending.showIntro) {
      this._storyDialogueActive = true;
      try {
        await showImportantHint(
          this,
          'Choose your path. Battles give loot and gold.\nVillages let you buy, sell, and forge. Churches heal and promote.',
        );
      } finally {
        if (isSceneLifecycleActive(this, lifecycleGeneration)) {
          this._storyDialogueActive = false;
        }
      }
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
    }
    if (pending.showHpPersist && isSceneLifecycleActive(this, lifecycleGeneration)) {
      void showMinorHint(this, 'HP carries between battles. Visit Rest or Church nodes to heal.');
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
      .setDepth(OVERLAY_CONTENT_DEPTH + 120)
      .setStrokeStyle(2, 0xaa3333)
      .setAlpha(0);
    const label = this.add
      .text(cx, cy, 'The village is under attack!', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff6666',
        backgroundColor: '#00000000',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH + 121)
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
    if (this._isPointerOverInteractive(pointer)) return;
    this._clearTouchPreviewLatches();
    this.requestCancel({ allowPause: false });
  }

  onPointerUpOutside(_pointer) {
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

    if (this.unitPickerState) {
      const state = this.unitPickerState;
      if (
        pointer.y >= state.viewportTop &&
        pointer.y <= state.viewportBottom &&
        (state.maxOffset || 0) > 0
      ) {
        this._touchScrollDrag = {
          type: 'unit-picker',
          startY: pointer.y,
          startOffset: state.offset || 0,
        };
      }
      return;
    }

    if (this.churchOverlay && !this._churchViewingMap) {
      if ((this.churchScrollMax || 0) <= 0) return;
      if (pointer.y < CHURCH_LIST_TOP_Y || pointer.y > CHURCH_LIST_BOTTOM_Y) return;
      this._touchScrollDrag = {
        type: 'church',
        startY: pointer.y,
        startOffset: this.churchScrollOffset || 0,
      };
      return;
    }

    if (!this.shopOverlay || this._shopViewingMap || !this.activeShopTab) return;
    if (this.forgePicker || this.unitPicker) return;
    if ((this.shopScrollMax || 0) <= 0) return;
    if (pointer.y < SHOP_LIST_TOP_Y || pointer.y > SHOP_LIST_BOTTOM_Y) return;
    this._touchScrollDrag = {
      type: 'shop',
      tab: this.activeShopTab,
      startY: pointer.y,
      startOffset: this.shopScrollOffsets?.[this.activeShopTab] || 0,
    };
  }

  onPointerMove(pointer) {
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return;
    if (!isTouchPointer(pointer)) return;
    const drag = this._touchScrollDrag;
    if (!drag) return;

    if (drag.type === 'unit-picker') {
      if (!this.unitPickerState) return;
      const max = this.unitPickerState.maxOffset || 0;
      if (max <= 0) return;
      const deltaY = pointer.y - drag.startY;
      const next = Phaser.Math.Clamp(drag.startOffset - deltaY, 0, max);
      if (next === this.unitPickerState.offset) return;
      this.unitPickerState.offset = next;
      this.renderUnitPicker();
      return;
    }

    if (drag.type === 'church') {
      if (!this.churchOverlay || this._churchViewingMap) return;
      const max = this.churchScrollMax || 0;
      if (max <= 0) return;
      const deltaY = pointer.y - drag.startY;
      const next = Phaser.Math.Clamp(drag.startOffset - deltaY, 0, max);
      if (next === this.churchScrollOffset) return;
      this.churchScrollOffset = next;
      this.drawChurchScrollContent();
      return;
    }

    if (drag.type === 'shop') {
      if (!this.shopOverlay || this._shopViewingMap || this.forgePicker || this.unitPicker) return;
      if (!this.activeShopTab || drag.tab !== this.activeShopTab) return;
      const max = this.shopScrollMax || 0;
      if (max <= 0) return;
      const deltaY = pointer.y - drag.startY;
      const next = Phaser.Math.Clamp(drag.startOffset - deltaY, 0, max);
      const current = this.shopScrollOffsets?.[drag.tab] || 0;
      if (next === current) return;
      this.shopScrollOffsets[drag.tab] = next;
      this.drawActiveTabContent();
    }
  }

  onWheel(pointer, deltaX, deltaY) {
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return;
    if (this.unitPickerState) {
      const step = Math.sign(deltaY || 0) * UNIT_PICKER_SCROLL_STEP;
      if (!step) return;
      const current = this.unitPickerState.offset || 0;
      const max = this.unitPickerState.maxOffset || 0;
      const next = Phaser.Math.Clamp(current + step, 0, max);
      if (next === current) return;
      this.unitPickerState.offset = next;
      this.renderUnitPicker();
      return;
    }

    if (this.churchOverlay && !this._churchViewingMap) {
      if (!pointer) return;
      if ((this.churchScrollMax || 0) <= 0) return;
      if (pointer.y < CHURCH_LIST_TOP_Y || pointer.y > CHURCH_LIST_BOTTOM_Y) return;
      const step = Math.sign(deltaY || 0) * CHURCH_SCROLL_STEP;
      if (!step) return;
      const next = Phaser.Math.Clamp(
        (this.churchScrollOffset || 0) + step,
        0,
        this.churchScrollMax,
      );
      if (next === this.churchScrollOffset) return;
      this.churchScrollOffset = next;
      this.drawChurchScrollContent();
      return;
    }

    if (!this.shopOverlay || this._shopViewingMap || !this.activeShopTab) return;
    if (this.forgePicker || this.unitPicker) return;
    if (!pointer) return;
    if (pointer.y < SHOP_LIST_TOP_Y || pointer.y > SHOP_LIST_BOTTOM_Y) return;
    if ((this.shopScrollMax || 0) <= 0) return;

    const step = Math.sign(deltaY || 0) * SHOP_SCROLL_STEP;
    if (!step) return;
    const key = this.activeShopTab;
    const current = this.shopScrollOffsets?.[key] || 0;
    const next = Phaser.Math.Clamp(current + step, 0, this.shopScrollMax || 0);
    if (next === current) return;
    this.shopScrollOffsets[key] = next;
    this.drawActiveTabContent();
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
    if (this.forgePicker) return true;
    if (this.unitPicker || this.unitPickerState) return true;
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
    this._setOverlayVisibility(this.shopOverlay, visible);
    this._setOverlayVisibility(this.shopContentGroup, visible);
    this._setOverlayVisibility(this.shopTabObjects, visible);
    this._setOverlayVisibility(this.unitPicker, visible);
    this._setOverlayVisibility(this.forgePicker, visible);
    this._shopController?._setShopRingVisible?.(visible);
  }

  _setChurchOverlayVisibility(visible) {
    this._setOverlayVisibility(this.churchOverlay, visible);
    this._setOverlayVisibility(this.churchContentGroup, visible);
    this._churchController?._setChurchRingVisible?.(visible);
  }

  _enterShopMapView() {
    if (!this.shopOverlay || this._shopViewingMap) return;
    this._touchScrollDrag = null;
    this._hideForgeTooltip();
    this._hideShopItemTooltip();
    this._setShopOverlayVisibility(false);
    this._shopViewingMap = true;
  }

  _enterChurchMapView() {
    if (!this.churchOverlay || this._churchViewingMap) return;
    this._touchScrollDrag = null;
    this._setChurchOverlayVisibility(false);
    this._churchViewingMap = true;
    this._churchMapViewSuppressCancel = true;
    // Persistent "Return to Church" button (not in churchOverlay so it stays visible)
    this._churchReturnBtn = this.add
      .text(320, CHURCH_VIEW_MAP_Y, '[ Return to Church ]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#aaddff',
        backgroundColor: '#222222',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    this._churchReturnBtn.on('pointerover', () => this._churchReturnBtn.setColor('#ffdd44'));
    this._churchReturnBtn.on('pointerout', () => this._churchReturnBtn.setColor('#aaddff'));
    this._churchReturnBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._exitChurchMapView();
    });
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
    if (this._storyDialogueActive || this.dialogueOverlay?.visible) return true;
    if ((Number(this._promotionChoicePanelOpen) || 0) > 0) return false;
    if (!this.canRequestCancel({ allowPause })) return false;
    if (this.isDevToolsEnabled() && this.debugOverlay?.visible) {
      this.debugOverlay.hide();
      return true;
    }
    if (this.forgePicker) {
      this.closeForgeStatPicker();
      return true;
    }
    if (this.unitPicker || this.unitPickerState) {
      this.closeUnitPicker();
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
          ? 'Save failed — storage full. Clear browser data to free space.'
          : 'Save failed — storage may be unavailable',
      );
    }
  }

  showPauseMenu() {
    if (this.pauseOverlay?.visible) return;
    this.pauseOverlay = new PauseOverlay(this, {
      onResume: () => {
        this.pauseOverlay = null;
      },
      onSaveAndExit: async () => {
        try {
          // Run is already auto-saved on NodeMap entry. Just navigate.
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
    // Clear everything
    this.children.removeAll(true);

    const rm = this.runManager;
    const nodeMap = rm.nodeMap;
    const actConfig = ACT_CONFIG[rm.currentAct];
    const availableNodes = rm.getAvailableNodes();
    const availableIds = new Set(availableNodes.map((n) => n.id));

    // Title
    this.add
      .text(this.cameras.main.centerX, 20, `Act ${rm.actIndex + 1}: ${actConfig.name}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffdd44',
      })
      .setOrigin(0.5);

    // Gold display + info labels (dynamic stacking to stay above MAP_TOP=60)
    let infoY = 14;
    const infoX = this.cameras.main.width - 20;
    this.add
      .text(infoX, infoY, `${rm.gold}G`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffdd44',
      })
      .setOrigin(1, 0);
    infoY += 12;

    // Difficulty label (non-Normal only)
    const diffLabel = rm.difficultyModifiers?.label || 'Normal';
    const diffColor = rm.difficultyModifiers?.color || '#44cc44';
    if (diffLabel !== 'Normal') {
      this.add
        .text(infoX, infoY, diffLabel, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: diffColor,
        })
        .setOrigin(1, 0);
      infoY += 11;
    }

    // No Meta indicator
    if (rm.noMetaMode === true) {
      this.add
        .text(infoX, infoY, 'NO META', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ff8800',
        })
        .setOrigin(1, 0);
      infoY += 11;
    }

    // Win streak display (only when >= 2)
    if (rm.winStreak >= 2) {
      this.add
        .text(infoX, infoY, `Streak: ${rm.winStreak}`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#88ccff',
        })
        .setOrigin(1, 0);
    }

    // Gear icon — opens settings
    const gear = this.add
      .text(20, 16, '\u2699', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#888888',
      })
      .setInteractive({ useHandCursor: true });
    gear.on('pointerover', () => gear.setColor('#ffdd44'));
    gear.on('pointerout', () => gear.setColor('#888888'));
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
        graphics.lineStyle(2, isActive ? COLOR_EDGE_ACTIVE : COLOR_EDGE, isActive ? 0.8 : 0.4);
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
        aura.setBlendMode(Phaser.BlendModes.ADD);

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
      let spriteKey =
        node.type === NODE_TYPES.CHURCH || node.type === NODE_TYPES.RUINS
          ? 'node_rest'
          : `node_${node.type}`;
      // Elite seize battles use dark fortress sprite
      if (isEliteNode) {
        spriteKey = 'node_elite';
      }
      if (node.type === NODE_TYPES.BOSS) {
        const actId = this.runManager.nodeMap.actId;
        if (actId === 'finalBoss') spriteKey = 'node_boss_final';
      }
      let nodeObj;
      if (this.textures.exists(spriteKey)) {
        nodeObj = this.add
          .image(pos.x, pos.y, spriteKey)
          .setDisplaySize(NODE_SIZE + 8, NODE_SIZE + 8)
          .setDepth(NODE_DEPTH);
        if (node.type === NODE_TYPES.RUINS) nodeObj.setTint(COLOR_RUINS);
        if (isCompleted) nodeObj.setTint(0x555555);
        if (!isAvailable && !isCompleted) nodeObj.setAlpha(isEliteNode ? 0.75 : 0.5);
      } else {
        nodeObj = this.add
          .rectangle(pos.x, pos.y, NODE_SIZE, NODE_SIZE, color)
          .setStrokeStyle(2, isAvailable ? 0xffffff : 0x888888)
          .setDepth(NODE_DEPTH);
        const icon = NODE_ICONS[node.type] || '?';
        this.add
          .text(pos.x, pos.y, icon, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: isCompleted ? '#888888' : '#ffffff',
          })
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
    this._rosterBtn = this.add
      .text(this.cameras.main.width - 20, MAP_BOTTOM + 14, '[ Roster ]', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this._rosterBtn.on('pointerover', () => this._rosterBtn.setColor('#ffdd44'));
    this._rosterBtn.on('pointerout', () => this._rosterBtn.setColor('#e0e0e0'));
    this._rosterBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._openRoster();
    });

    // Mobile virtual controls
    const flags = this.registry.get('startupFlags');
    this.isMobileInput = Boolean(flags?.isMobile);
    if (this.isMobileInput) {
      this._rosterBtn.setVisible(false);
      const ge = this.game.events;
      if (!this._mobileHandlers) {
        this._mobileHandlers = {
          cancel: () => this.requestCancel({ allowPause: false }),
          menu: () => this.requestCancel(),
          roster: () => this._openRoster(),
        };
        for (const [action, handler] of Object.entries(this._mobileHandlers)) {
          ge.on(`mobile:${action}`, handler);
        }
      }
      ge.emit('mobile:setContext', { context: 'nodemap' });
    }

    // Instructions
    this.add
      .text(this.cameras.main.centerX, MAP_BOTTOM + 20, 'Click a node to proceed', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#888888',
      })
      .setOrigin(0.5);

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
              ? 'Save failed — storage full. Clear browser data to free space.'
              : 'Save failed — storage may be unavailable',
          );
        }
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
      this.add.text(x, ROSTER_Y, label, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
      });

      // HP bar — scale width with spacing
      const barWidth = Math.min(120, spacing - 20);
      const barHeight = 8;
      const barX = x;
      const barY = ROSTER_Y + 18;
      const maxHp = Math.max(1, Number(unit.stats.HP) || 1);
      const ratio = Phaser.Math.Clamp((Number(unit.currentHP) || 0) / maxHp, 0, 1);

      this.add.rectangle(barX + barWidth / 2, barY + barHeight / 2, barWidth, barHeight, 0x333333);
      const fillColor = ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444;
      this.add.rectangle(
        barX + (barWidth * ratio) / 2,
        barY + barHeight / 2,
        barWidth * ratio,
        barHeight,
        fillColor,
      );

      // HP text (only if enough space)
      if (spacing >= 80) {
        this.add.text(barX + barWidth + 4, barY - 2, `${unit.currentHP}/${maxHp}`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#aaaaaa',
        });
      }
    }

    if (hiddenCount > 0) {
      const anchorX = Phaser.Math.Clamp(startX + shownUnits.length * spacing, 120, 560);
      this.add.text(anchorX, ROSTER_Y + 2, `+${hiddenCount} more`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaaa',
      });
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
    this.nodeTooltip = this.add
      .text(pos.x, pos.y - NODE_SIZE - 8, label, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 4, y: 2 },
      })
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

  onNodeClick(node) {
    if (this.isTransitioning) return;
    if (this.battleLaunchInFlight) return;
    if (!this.isSceneReady) {
      if (this._storyDialogueActive || this.dialogueOverlay?.visible) {
        this._pendingNodeSelection = node?.id ? { nodeId: node.id } : null;
        if (this.dialogueOverlay?.visible && typeof this.dialogueOverlay.hide === 'function') {
          this.dialogueOverlay.hide();
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
        { reason: TRANSITION_REASONS.ENTER_BATTLE },
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

  drawChurchScrollContent() {
    (this._churchController ||= new ChurchController(this)).drawChurchScrollContent();
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
    this.transientMessage = this.add
      .text(this.cameras.main.centerX, 96, text, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#000000dd',
        padding: { x: 8, y: 4 },
      })
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

  drawShopTabs() {
    return (this._shopController ||= new ShopController(this)).drawShopTabs();
  }

  drawActiveTabContent() {
    return (this._shopController ||= new ShopController(this)).drawActiveTabContent();
  }

  _getWeaponArtCatalog() {
    return (this._shopController ||= new ShopController(this))._getWeaponArtCatalog();
  }

  drawShopBuyList() {
    return (this._shopController ||= new ShopController(this)).drawShopBuyList();
  }

  onBuyItem(entry) {
    return (this._shopController ||= new ShopController(this)).onBuyItem(entry);
  }

  drawShopSellList() {
    return (this._shopController ||= new ShopController(this)).drawShopSellList();
  }

  drawShopForgeList() {
    return (this._shopController ||= new ShopController(this)).drawShopForgeList();
  }

  drawShopScrollHint() {
    return (this._shopController ||= new ShopController(this)).drawShopScrollHint();
  }

  _getShopItemDetailText(entry) {
    return (this._shopController ||= new ShopController(this))._getShopItemDetailText(entry);
  }

  _showShopItemTooltip(entry, anchorX, anchorY) {
    return (this._shopController ||= new ShopController(this))._showShopItemTooltip(
      entry,
      anchorX,
      anchorY,
    );
  }

  _hideShopItemTooltip() {
    return (this._shopController ||= new ShopController(this))._hideShopItemTooltip();
  }

  showForgeStatPicker(weapon) {
    return (this._shopController ||= new ShopController(this)).showForgeStatPicker(weapon);
  }

  closeForgeStatPicker() {
    return (this._shopController ||= new ShopController(this)).closeForgeStatPicker();
  }

  _showForgeTooltip(wpn, anchorX, anchorY) {
    return (this._shopController ||= new ShopController(this))._showForgeTooltip(
      wpn,
      anchorX,
      anchorY,
    );
  }

  _hideForgeTooltip() {
    return (this._shopController ||= new ShopController(this))._hideForgeTooltip();
  }

  _saveShopState() {
    return (this._shopController ||= new ShopController(this))._saveShopState();
  }

  refreshShop() {
    return (this._shopController ||= new ShopController(this)).refreshShop();
  }

  drawRerollButton() {
    return (this._shopController ||= new ShopController(this)).drawRerollButton();
  }

  showUnitPicker(callback, pickerOptionsOrItem) {
    return (this._shopController ||= new ShopController(this)).showUnitPicker(
      callback,
      pickerOptionsOrItem,
    );
  }

  renderUnitPicker() {
    return (this._shopController ||= new ShopController(this)).renderUnitPicker();
  }

  closeUnitPicker() {
    return (this._shopController ||= new ShopController(this)).closeUnitPicker();
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
      const line = lines[Math.floor(Math.random() * lines.length)];
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
    const banner = this.add
      .text(this.cameras.main.centerX, this.cameras.main.centerY, 'Act Complete!', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffdd44',
        backgroundColor: '#000000dd',
        padding: { x: 20, y: 10 },
      })
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
