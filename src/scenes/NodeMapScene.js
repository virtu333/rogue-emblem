// NodeMapScene — Visual node map with navigation + roster display

import Phaser from 'phaser';
import { RunManager, saveRun, clearSavedRun, getReviveCost } from '../engine/RunManager.js';
import {
  ACT_CONFIG,
  NODE_TYPES,
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  SHOP_REROLL_COST,
  SHOP_REROLL_ESCALATION,
  SHOP_FORGE_LIMITS,
  FORGE_MAX_LEVEL,
  FORGE_COSTS,
  FORGE_STAT_CAP,
  CHURCH_PROMOTE_COST,
  SAFE_BOTTOM_Y,
  AMBUSH_SHOP_DISCOUNT,
} from '../utils/constants.js';
import { generateShopInventory, getSellPrice } from '../engine/LootSystem.js';
import {
  addToInventory,
  removeFromInventory,
  removeFromConsumables,
  isLastCombatWeapon,
  hasProficiency,
  isProficiencyRelevantItemType,
  addToConsumables,
  canPromote,
  promoteUnit,
  resolvePromotionTargets,
  getDisplayLevel,
} from '../engine/UnitManager.js';
import {
  canForge,
  canForgeStat,
  applyForge,
  isForged,
  getForgeCost,
  getStatForgeCount,
} from '../engine/ForgeSystem.js';
import { PauseOverlay } from '../ui/PauseOverlay.js';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { RosterOverlay } from '../ui/RosterOverlay.js';
import { DialogueOverlay } from '../ui/DialogueOverlay.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { pushRunSave, deleteRunSave } from '../cloud/CloudSync.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import { DEBUG_MODE } from '../utils/debugMode.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { markStartup } from '../utils/startupTelemetry.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { showTransitionRecoveryPrompt } from '../ui/TransitionRecoveryPrompt.js';
import { hasWeaponArt, getWeaponArtTooltipLines } from '../ui/WeaponArtVisibility.js';
import { consumeEscEvent, isEscConsumed } from '../utils/escPriority.js';
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';
import { isTouchPointer } from '../utils/runtimeFlags.js';

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
const SHOP_LIST_TOP_Y = 105;
const SHOP_LIST_BOTTOM_Y = 390;
const SHOP_SCROLL_STEP = 24;
const UNIT_PICKER_SCROLL_STEP = 30;
const CHURCH_ITEM_HEIGHT = 30;
const CHURCH_LIST_TOP_Y = 160; // Below heal button + status message area
const CHURCH_VIEW_MAP_Y = SAFE_BOTTOM_Y - 36; // View Map button Y (matches showChurchOverlay)
const CHURCH_LIST_BOTTOM_Y = CHURCH_VIEW_MAP_Y - 20; // 20px gap above View Map button to prevent overlap
const CHURCH_SCROLL_STEP = CHURCH_ITEM_HEIGHT; // Row-height-aligned for deterministic scrolling

function getWeaponArtCatalogForScene(scene) {
  if (scene && typeof scene._getWeaponArtCatalog === 'function') {
    return scene._getWeaponArtCatalog();
  }
  return scene?.gameData?.weaponArts?.arts || [];
}

function isProficiencyCheckRelevant(item) {
  return isProficiencyRelevantItemType(item?.type);
}

function truncateUnitNameForCapacityLabel(name, maxChars = 14) {
  const safeName = String(name || '');
  if (!Number.isInteger(maxChars) || maxChars < 4 || safeName.length <= maxChars) return safeName;
  return `${safeName.slice(0, maxChars - 3)}...`;
}

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

function trackSceneTimer(scene, timer) {
  if (!timer) return null;
  if (!scene._sceneTimers || typeof scene._sceneTimers.add !== 'function') {
    scene._sceneTimers = new Set();
  }
  scene._sceneTimers.add(timer);
  return timer;
}

function clearTrackedSceneTimer(scene, timer) {
  if (!timer) return;
  if (scene?._sceneTimers && typeof scene._sceneTimers.delete === 'function') {
    scene._sceneTimers.delete(timer);
  }
  try {
    timer.remove?.();
  } catch (_) {}
}

function clearAllSceneTimers(scene) {
  if (!scene?._sceneTimers || typeof scene._sceneTimers.values !== 'function') return;
  for (const timer of Array.from(scene._sceneTimers.values())) {
    clearTrackedSceneTimer(scene, timer);
  }
}

const OVERLAY_PANEL_W = 560;
const OVERLAY_PANEL_H = 425; // overlay panel height (px) — independent of button safety margin
const OVERLAY_PANEL_DEPTH = 301;
const OVERLAY_CONTENT_DEPTH = 302;

const NODE_ICONS = {
  [NODE_TYPES.BATTLE]: '\u2694', // ⚔
  [NODE_TYPES.BOSS]: '\u2620', // ☠
  [NODE_TYPES.SHOP]: '$',
  [NODE_TYPES.RECRUIT]: '!',
  [NODE_TYPES.CHURCH]: '\u271D', // ✝
  [NODE_TYPES.COLOSSEUM]: '\u039B', // Λ
};

const NODE_COLORS = {
  [NODE_TYPES.BATTLE]: COLOR_BATTLE,
  [NODE_TYPES.BOSS]: COLOR_BOSS,
  [NODE_TYPES.SHOP]: COLOR_SHOP,
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
    this._unbindInputHandlers();
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
          const entries = this.gameData?.dialogue?.actTransitions?.runStart;
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
              await this.dialogueOverlay.showSequence(entries);
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
  }

  _setChurchOverlayVisibility(visible) {
    this._setOverlayVisibility(this.churchOverlay, visible);
    this._setOverlayVisibility(this.churchContentGroup, visible);
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
    this._setChurchOverlayVisibility(true);
    this._churchViewingMap = false;
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
        this._setShopOverlayVisibility(true);
        this._shopViewingMap = false;
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
    );
    if (!result.ok) {
      showMinorHint(this, 'Save failed — storage may be full');
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
          const ok = await transitionToScene(
            this,
            'Title',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.SAVE_EXIT },
          );
          if (!ok) {
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
          clearSavedRun(cloud ? () => deleteRunSave(cloud.userId, slot) : null);
          this.runManager.failRun();
          const audio = this.registry.get('audio');
          if (audio) audio.stopMusic(this, 0);
          markStartup('pause_transition_attempt', { scene: 'NodeMap', reason: 'ABANDON_RUN' });
          const ok = await transitionToScene(
            this,
            'Title',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.ABANDON_RUN },
          );
          if (!ok) {
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
      let spriteKey = node.type === NODE_TYPES.CHURCH ? 'node_rest' : `node_${node.type}`;
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
        );
        if (!result.ok) {
          showMinorHint(this, 'Save failed — storage may be full');
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
    } else if (node.type === NODE_TYPES.SHOP) {
      label = 'Village — Buy, sell, and forge';
    } else if (node.type === NODE_TYPES.RECRUIT) {
      label = 'Recruit — Battle with potential ally';
    } else if (node.type === NODE_TYPES.COLOSSEUM) {
      label = 'Colosseum - Arena and Mercenary Board';
    } else if (node.battleParams?.isElite) {
      label = 'Elite Battle (Seize) — Harder fight, better loot';
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
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.rest), this, 300); // Peaceful music

    this._churchPromotionsThisVisit = this.runManager.getChurchPromotionCount(node.id);
    this._currentChurchNodeId = node.id;
    this.showChurchOverlay(node);
  }

  showChurchOverlay(node) {
    this.churchOverlay = [];
    this.churchContentGroup = [];
    this._churchNode = node;
    this._churchViewingMap = false;
    this.churchScrollOffset = 0;
    this.churchScrollMax = 0;
    this._churchScrollItems = null;

    // Tutorial hint for church
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('nodemap_church')) {
      showMinorHint(this, 'Heal, revive fallen allies, or promote units.');
    }

    // Dark overlay background
    const bg = this.add.rectangle(320, 240, 640, 480, 0x000000, 0.9).setDepth(300);
    this.churchOverlay.push(bg);

    // Centered panel container
    const panel = this.add
      .rectangle(320, 240, OVERLAY_PANEL_W, OVERLAY_PANEL_H, 0x111111, 0.95)
      .setDepth(OVERLAY_PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    this.churchOverlay.push(panel);

    // Title
    const title = this.add
      .text(320, 40, 'Church', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#cccccc',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    this.churchOverlay.push(title);

    // Gold display
    this.churchGoldText = this.add
      .text(320, 70, `Gold: ${this.runManager.gold}G`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    this.churchOverlay.push(this.churchGoldText);

    const rm = this.runManager;

    // Service 1: Heal All (Free) — fixed, not scrollable
    const healBtn = this.add
      .text(320, 110, '[ Heal All Units ] (Free)', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#44ff44',
        backgroundColor: '#222222',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    healBtn.on('pointerover', () => healBtn.setBackgroundColor('#333333'));
    healBtn.on('pointerout', () => healBtn.setBackgroundColor('#222222'));
    healBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      for (const unit of rm.roster) {
        unit.currentHP = unit.stats.HP;
      }
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_heal');
      this.showChurchMessage('All units healed!', '#44ff44');
    });
    this.churchOverlay.push(healBtn);

    // View Map button — fixed
    const viewMapBtn = this.add
      .text(320, CHURCH_VIEW_MAP_Y, '[ View Map ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    viewMapBtn.on('pointerover', () => viewMapBtn.setColor('#ffdd44'));
    viewMapBtn.on('pointerout', () => viewMapBtn.setColor('#aaddff'));
    viewMapBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._enterChurchMapView();
    });
    this.churchOverlay.push(viewMapBtn);

    // Roster button — fixed
    const rosterBtn = this.add
      .text(180, SAFE_BOTTOM_Y, '[ Roster ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    rosterBtn.on('pointerover', () => rosterBtn.setColor('#ffdd44'));
    rosterBtn.on('pointerout', () => rosterBtn.setColor('#aaddff'));
    rosterBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._touchScrollDrag = null;
      this._setChurchOverlayVisibility(false);
      this._churchViewingRoster = true;
      this._openRoster();
      if (this.rosterOverlay) {
        const baseOnClose = this.rosterOverlay.onClose;
        this.rosterOverlay.onClose = () => {
          if (baseOnClose) baseOnClose();
          this._churchViewingRoster = false;
          this._setChurchOverlayVisibility(true);
        };
      } else {
        // _openRoster() hit an early return — roll back
        this._churchViewingRoster = false;
        this._setChurchOverlayVisibility(true);
      }
    });
    this.churchOverlay.push(rosterBtn);

    // Leave button — fixed
    const leaveBtn = this.add
      .text(320, SAFE_BOTTOM_Y, '[ Leave Church ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerover', () => leaveBtn.setColor('#ffdd44'));
    leaveBtn.on('pointerout', () => leaveBtn.setColor('#e0e0e0'));
    leaveBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this.leaveChurchNode();
    });
    this.churchOverlay.push(leaveBtn);

    // Build scrollable item descriptors
    const items = [];
    let localY = 0;

    // Service 2: Revive Fallen Unit (1000g)
    if (rm.fallenUnits.length > 0) {
      items.push({
        type: 'label',
        text: 'Revive Fallen Unit:',
        color: '#cccccc',
        y: localY,
      });
      localY += 25;
      for (const fallen of rm.fallenUnits) {
        items.push({ type: 'revive', unit: fallen, cost: getReviveCost(fallen), y: localY });
        localY += CHURCH_ITEM_HEIGHT;
      }
      localY += 10;
    }

    // Service 3: Promote Unit
    const promoLimit = rm.getDifficultyModifier('churchPromotionLimit', -1);
    const promoRemaining =
      promoLimit >= 0 ? promoLimit - (this._churchPromotionsThisVisit || 0) : -1;
    const promoLimitText = promoRemaining >= 0 ? ` [${promoRemaining} left]` : '';
    items.push({
      type: 'label',
      text: `Promote Unit (${CHURCH_PROMOTE_COST}G):${promoLimitText}`,
      color: '#cccccc',
      y: localY,
    });
    localY += 25;

    const eligibleUnits = rm.roster.filter((u) => canPromote(u));
    if (promoRemaining === 0) {
      items.push({ type: 'none', text: '(Promotion limit reached)', y: localY });
      localY += CHURCH_ITEM_HEIGHT;
    } else if (eligibleUnits.length === 0) {
      items.push({ type: 'none', text: '(No units eligible for promotion)', y: localY });
      localY += CHURCH_ITEM_HEIGHT;
    } else {
      for (const unit of eligibleUnits) {
        items.push({ type: 'promote', unit, y: localY });
        localY += CHURCH_ITEM_HEIGHT;
      }
    }

    this._churchScrollItems = items;
    const availableHeight = CHURCH_LIST_BOTTOM_Y - CHURCH_LIST_TOP_Y;
    this.churchScrollMax = Math.max(0, localY - availableHeight);
    this.churchScrollOffset = 0;

    this.drawChurchScrollContent();
  }

  drawChurchScrollContent() {
    // Destroy previous scroll content
    if (this.churchContentGroup) this.churchContentGroup.forEach((o) => o.destroy());
    this.churchContentGroup = [];

    const items = this._churchScrollItems;
    if (!items) return;

    const offset = this.churchScrollOffset || 0;
    const rm = this.runManager;
    const node = this._churchNode;

    for (const item of items) {
      const y = CHURCH_LIST_TOP_Y + item.y - offset;
      // Keep row/button bounds out of fixed controls; use half-row guard at bottom.
      if (
        y < CHURCH_LIST_TOP_Y - CHURCH_ITEM_HEIGHT ||
        y > CHURCH_LIST_BOTTOM_Y - CHURCH_ITEM_HEIGHT / 2
      )
        continue;

      if (item.type === 'label') {
        const label = this.add
          .text(320, y, item.text, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: item.color,
          })
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.churchContentGroup.push(label);
      } else if (item.type === 'none') {
        const noneText = this.add
          .text(320, y, item.text, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#888888',
          })
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.churchContentGroup.push(noneText);
      } else if (item.type === 'revive') {
        const fallen = item.unit;
        const cost = item.cost;
        const unitBtn = this.add
          .text(
            320,
            y,
            `${fallen.name} (Lv${getDisplayLevel(fallen)} ${fallen.className}) — ${cost}G`,
            {
              fontFamily: 'monospace',
              fontSize: '14px',
              color: '#e0e0e0',
              backgroundColor: '#222222',
              padding: { x: 10, y: 4 },
            },
          )
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH)
          .setInteractive({ useHandCursor: true });
        unitBtn.on('pointerover', () => {
          if (rm.gold >= cost) unitBtn.setColor('#ffdd44');
          unitBtn.setBackgroundColor('#333333');
        });
        unitBtn.on('pointerout', () => {
          unitBtn.setColor('#e0e0e0');
          unitBtn.setBackgroundColor('#222222');
        });
        unitBtn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (rm.reviveFallenUnit(fallen.name, cost)) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_heal');
            let functionalMessage = `${fallen.name} revived!`;
            if (!rm.hasShownDialogue('revive_convoy_hint')) {
              rm.markDialogueShown('revive_convoy_hint');
              functionalMessage = `${fallen.name} revived! (Gear stored in convoy \u2014 re-equip via Roster)`;
            }
            this._showChurchSuccessMessage(node, functionalMessage, '#44ff44', 'revival');
          } else {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Not enough gold or roster full!', '#ff4444');
          }
        });
        this.churchContentGroup.push(unitBtn);
      } else if (item.type === 'promote') {
        const unit = item.unit;
        const unitBtn = this.add
          .text(320, y, `${unit.name} (Lv${getDisplayLevel(unit)} ${unit.className})`, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#e0e0e0',
            backgroundColor: '#222222',
            padding: { x: 10, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH)
          .setInteractive({ useHandCursor: true });
        unitBtn.on('pointerover', () => {
          if (rm.gold >= CHURCH_PROMOTE_COST) unitBtn.setColor('#ffdd44');
          unitBtn.setBackgroundColor('#333333');
        });
        unitBtn.on('pointerout', () => {
          unitBtn.setColor('#e0e0e0');
          unitBtn.setBackgroundColor('#222222');
        });
        unitBtn.on('pointerdown', async (pointer) => {
          if (pointer?.button !== 0) return;
          const _promoLimit = rm.getDifficultyModifier('churchPromotionLimit', -1);
          if (_promoLimit >= 0 && (this._churchPromotionsThisVisit || 0) >= _promoLimit) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Promotion limit reached!', '#ff4444');
            return;
          }
          if (rm.gold < CHURCH_PROMOTE_COST) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Not enough gold!', '#ff4444');
            return;
          }

          const lordData = this.gameData.lords.find((l) => l.name === unit.name);
          const targets = resolvePromotionTargets(unit, this.gameData.classes, this.gameData.lords);
          if (!targets?.length) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Promotion unavailable for this unit.', '#ff4444');
            return;
          }

          // Choose class first, THEN charge gold (cancel must not spend)
          let promotedClassData;
          if (targets.length === 1) {
            promotedClassData = targets[0];
          } else {
            const { PromotionChoicePanel } = await import('../ui/PromotionChoicePanel.js');
            const panel = new PromotionChoicePanel(this, unit, targets, this.gameData.skills);
            promotedClassData = await panel.show();
            if (!promotedClassData) {
              // Cancelled — no gold spent
              return;
            }
          }

          const promotionBonuses = lordData?.promotionBonuses || promotedClassData.promotionBonuses;
          if (!promotionBonuses) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Promotion data missing.', '#ff4444');
            return;
          }

          // Charge gold only after successful selection
          if (!rm.spendGold(CHURCH_PROMOTE_COST)) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Not enough gold!', '#ff4444');
            return;
          }

          promoteUnit(unit, promotedClassData, promotionBonuses, this.gameData.skills);
          this._churchPromotionsThisVisit = (this._churchPromotionsThisVisit || 0) + 1;
          this.runManager.setChurchPromotionCount(
            this._currentChurchNodeId,
            this._churchPromotionsThisVisit,
          );

          if (typeof this.sound?.stopByKey === 'function') this.sound.stopByKey('sfx_levelup');
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_levelup');
          this._showChurchSuccessMessage(
            node,
            `${unit.name} promoted to ${promotedClassData.name}!`,
            '#ffdd44',
            'promotion',
          );
        });
        this.churchContentGroup.push(unitBtn);
      }
    }

    // Scroll hint when content overflows
    if ((this.churchScrollMax || 0) > 0) {
      const percent =
        this.churchScrollMax > 0 ? Math.round((offset / this.churchScrollMax) * 100) : 0;
      const hint = this.add
        .text(445, CHURCH_LIST_BOTTOM_Y + 2, `Scroll: ${percent}%`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#888888',
          backgroundColor: '#222222',
          padding: { x: 4, y: 2 },
        })
        .setDepth(OVERLAY_CONTENT_DEPTH);
      this.churchContentGroup.push(hint);
    }
  }

  leaveChurchNode() {
    if (!this.churchOverlay) return;
    if (typeof this.sound?.stopByKey === 'function') this.sound.stopByKey('sfx_levelup');
    const node = this._churchNode;
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
    this.closeChurchOverlay();
    if (node) {
      this.runManager.markNodeComplete(node.id);
      this.checkActComplete();
    }
  }

  _showChurchSuccessMessage(node, functionalMessage, functionalColor, flavorType) {
    this.refreshChurchOverlay(node);
    this.showChurchMessage(functionalMessage, functionalColor);
    try {
      this._scheduleChurchFlavor(flavorType);
    } catch (_) {
      /* best-effort flavor — don't block functional message */
    }
  }

  _scheduleChurchFlavor(flavorType, delayMs = 600) {
    clearTrackedSceneTimer(this, this._churchFlavorTimer);
    this._churchFlavorTimer = null;
    const act = this.runManager?.currentAct || 'act1';
    const pool =
      this.gameData?.dialogue?.churchFlavor?.[flavorType]?.[act] ||
      this.gameData?.dialogue?.churchFlavor?.[flavorType]?.['act3'];
    if (!Array.isArray(pool) || pool.length === 0) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    this._churchFlavorTimer = trackSceneTimer(
      this,
      this.time?.delayedCall?.(delayMs, () => {
        this._churchFlavorTimer = null;
        if (this.scene?.isActive && !this.scene.isActive()) return;
        if (!Array.isArray(this.churchOverlay)) return;
        this.showChurchMessage(line, '#aabbcc');
      }),
    );
  }

  showChurchMessage(text, color) {
    if (this.scene?.isActive && !this.scene.isActive()) return;
    if (!Array.isArray(this.churchOverlay)) return;
    if (this.churchMessage) this.churchMessage.destroy();
    clearTrackedSceneTimer(this, this._churchMessageTimer);
    this._churchMessageTimer = null;
    this.churchMessage = this.add
      .text(320, 95, text, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#000000dd',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(302);
    this.churchOverlay.push(this.churchMessage);

    this._churchMessageTimer = trackSceneTimer(
      this,
      this.time?.delayedCall?.(2000, () => {
        this._churchMessageTimer = null;
        if (this.churchMessage) {
          this.churchMessage.destroy();
          this.churchMessage = null;
        }
      }),
    );
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
    this.closeChurchOverlay();
    this.showChurchOverlay(node);
  }

  closeChurchOverlay() {
    this._churchViewingRoster = false;
    clearTrackedSceneTimer(this, this._churchMessageTimer);
    this._churchMessageTimer = null;
    clearTrackedSceneTimer(this, this._churchFlavorTimer);
    this._churchFlavorTimer = null;
    if (this.churchOverlay) {
      this.churchOverlay.forEach((o) => o.destroy());
      this.churchOverlay = null;
    }
    if (this.churchContentGroup) {
      this.churchContentGroup.forEach((o) => o.destroy());
      this.churchContentGroup = null;
    }
    if (this.churchMessage) {
      this.churchMessage.destroy();
      this.churchMessage = null;
    }
    this.churchGoldText = null;
    this._churchNode = null;
    this._churchViewingMap = false;
    if (this._churchReturnBtn) {
      this._churchReturnBtn.destroy();
      this._churchReturnBtn = null;
    }
    this._churchMapViewSuppressCancel = false;
    this.churchScrollOffset = 0;
    this.churchScrollMax = 0;
    this._churchScrollItems = null;
    this._touchScrollDrag = null;
  }

  handleShop(node, options = {}) {
    const pendingAmbush = this._isPendingAmbushNode?.(node) === true;
    const ambushDiscount =
      options?.ambushDiscount === true ||
      pendingAmbush ||
      (node?.isAmbush === true && node?.ambushCleared === true);
    if (this.runManager.consumeSkipFirstShop()) {
      showMinorHint(this, 'Blessing effect: first shop skipped.');
      this.runManager.markNodeComplete(node.id);
      if (pendingAmbush) this._clearPendingAmbushForNode?.(node);
      this.checkActComplete();
      return;
    }

    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.shop), this, 300);

    const rm = this.runManager;
    const cachedShop = rm.getShopState?.(node.id);
    let shopItems;
    if (cachedShop) {
      shopItems = cachedShop.items;
    } else {
      const shopItemDelta = rm.getShopItemCountDelta();
      shopItems = generateShopInventory(
        rm.currentAct,
        this.gameData.lootTables,
        this.gameData.weapons,
        this.gameData.consumables,
        this.gameData.accessories,
        rm.roster,
        rm.getWeaponArtSpawnConfig(),
        {
          itemCountBonus: shopItemDelta,
          shopCureGating: rm.difficultyModifiers?.shopCureGating,
        },
      );
      shopItems = this.applyDifficultyShopPricing(shopItems);
      if (ambushDiscount) {
        shopItems = this.applyAmbushDiscount(shopItems);
      }
    }
    this.showShopOverlay(node, shopItems, {
      ambushDiscount: cachedShop?.ambushDiscountActive ?? ambushDiscount,
      pendingAmbush: !cachedShop && pendingAmbush,
      cachedShop,
    });
  }

  applyDifficultyShopPricing(items) {
    const diffMult = this.runManager?.getDifficultyModifier?.('shopPriceMultiplier', 1) || 1;
    const blessingDiscount = this.runManager?.getShopPriceDiscount?.() || 0;
    const multiplier = Math.max(0.1, diffMult * (1 - blessingDiscount));
    if (!Array.isArray(items)) return [];
    return items.map((entry) => ({
      ...entry,
      price: Math.max(1, Math.floor((entry.price || 0) * multiplier)),
    }));
  }

  applyAmbushDiscount(items) {
    if (!Array.isArray(items)) return [];
    return items.map((entry) => ({
      ...entry,
      price: Math.max(1, Math.floor((entry?.price || 0) * AMBUSH_SHOP_DISCOUNT)),
    }));
  }

  showShopOverlay(node, shopItems, options = {}) {
    this.shopOverlay = [];
    this.shopContentGroup = [];
    this.activeShopTab = 'buy';
    const cachedShop = options?.cachedShop;
    this.shopForgesUsed = cachedShop?.forgesUsed || 0;
    this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollMax = 0;
    this._shopViewingMap = false;
    this._currentShopHasAmbushDiscount =
      options?.ambushDiscount === true || options?.pendingAmbush === true;

    // Tutorial hint for shop
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('nodemap_shop')) {
      showMinorHint(this, 'Buy, Sell, and Forge tabs available.');
    }

    // Dark overlay background
    const bg = this.add.rectangle(320, 240, 640, 480, 0x000000, 0.9).setDepth(300);
    this.shopOverlay.push(bg);

    // Centered panel container
    const panel = this.add
      .rectangle(320, 240, OVERLAY_PANEL_W, OVERLAY_PANEL_H, 0x111111, 0.95)
      .setDepth(OVERLAY_PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    this.shopOverlay.push(panel);

    // Title
    const titleLabel = this._currentShopHasAmbushDiscount
      ? 'Village (Liberated - 20% Off)'
      : 'Village';
    const title = this.add
      .text(320, 30, titleLabel, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: this._currentShopHasAmbushDiscount ? '#88ff88' : '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopOverlay.push(title);

    // Gold display
    this.shopGoldText = this.add
      .text(320, 58, `Gold: ${this.runManager.gold}G`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopOverlay.push(this.shopGoldText);

    const viewMapBtn = this.add
      .text(320, SAFE_BOTTOM_Y - 36, '[ View Map ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    viewMapBtn.on('pointerover', () => viewMapBtn.setColor('#ffdd44'));
    viewMapBtn.on('pointerout', () => viewMapBtn.setColor('#aaddff'));
    viewMapBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._enterShopMapView();
    });
    this.shopOverlay.push(viewMapBtn);

    // Roster button
    const shopRosterBtn = this.add
      .text(180, SAFE_BOTTOM_Y, '[ Roster ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    shopRosterBtn.on('pointerover', () => shopRosterBtn.setColor('#ffdd44'));
    shopRosterBtn.on('pointerout', () => shopRosterBtn.setColor('#aaddff'));
    shopRosterBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this._touchScrollDrag = null;
      this._hideForgeTooltip();
      this._hideShopItemTooltip();
      this._setShopOverlayVisibility(false);
      this._shopViewingRoster = true;
      this._openRoster();
      if (this.rosterOverlay) {
        const baseOnClose = this.rosterOverlay.onClose;
        this.rosterOverlay.onClose = () => {
          if (baseOnClose) baseOnClose();
          this._shopViewingRoster = false;
          this._setShopOverlayVisibility(true);
          this.drawActiveTabContent();
        };
      } else {
        // _openRoster() hit an early return — roll back
        this._shopViewingRoster = false;
        this._setShopOverlayVisibility(true);
      }
    });
    this.shopOverlay.push(shopRosterBtn);

    this.shopBuyItems = shopItems.map((entry, i) => ({ ...entry, index: i }));
    this._shopOriginalSlotCount = cachedShop?.originalSlotCount || this.shopBuyItems.length;
    this._shopNode = node;
    this.shopRerollCount = cachedShop?.rerollCount || 0;

    // Tab bar
    this.drawShopTabs();

    // Draw active tab content
    this.drawActiveTabContent();

    // Leave button
    const leaveBtn = this.add
      .text(320, SAFE_BOTTOM_Y, '[ Leave Village ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerover', () => leaveBtn.setColor('#ffdd44'));
    leaveBtn.on('pointerout', () => leaveBtn.setColor('#e0e0e0'));
    leaveBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this.leaveShopNode();
    });
    this.shopOverlay.push(leaveBtn);

    // Shop entry flavor
    try {
      const shopAct = this.runManager?.currentAct || 'act1';
      const shopPool =
        this.gameData?.dialogue?.shopFlavor?.[shopAct] ||
        this.gameData?.dialogue?.shopFlavor?.['act3'];
      if (Array.isArray(shopPool) && shopPool.length > 0) {
        this.showShopBanner(shopPool[Math.floor(Math.random() * shopPool.length)], '#aabbcc');
      }
    } catch (_) {
      /* best-effort flavor — don't block overlay */
    }
  }

  leaveShopNode() {
    if (!this.shopOverlay) return;
    const node = this._shopNode;
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
    this.closeShopOverlay();
    if (node) {
      this._clearPendingAmbushForNode?.(node);
      this.runManager.markNodeComplete(node.id);
      this.runManager?.clearShopState?.(node.id);
      this.checkActComplete();
    }
  }

  drawShopTabs() {
    // Destroy old tab objects
    if (this.shopTabObjects) this.shopTabObjects.forEach((o) => o.destroy());
    this.shopTabObjects = [];

    const tabs = [
      { key: 'buy', label: 'Buy' },
      { key: 'sell', label: 'Sell' },
      { key: 'forge', label: 'Forge' },
    ];
    const tabY = 80;
    const tabW = 80;
    const startX = 320 - (tabs.length * tabW) / 2 + tabW / 2;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tx = startX + i * tabW;
      const isActive = this.activeShopTab === tab.key;
      const color = isActive ? '#ffdd44' : '#888888';
      const tabText = this.add
        .text(tx, tabY, tab.label, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color,
          backgroundColor: isActive ? '#333355' : '#222222',
          padding: { x: 12, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(OVERLAY_CONTENT_DEPTH)
        .setInteractive({ useHandCursor: true });

      tabText.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        if (this.activeShopTab === tab.key) return;
        this.activeShopTab = tab.key;
        this.drawShopTabs();
        this.drawActiveTabContent();
      });

      this.shopTabObjects.push(tabText);
      this.shopOverlay.push(tabText);
    }
  }

  drawActiveTabContent() {
    // Clear previous tab content + reset touch preview latch
    this._touchPreviewedShopEntry = null;
    this._hideForgeTooltip();
    this._hideShopItemTooltip();
    if (this.shopContentGroup) this.shopContentGroup.forEach((o) => o.destroy());
    this.shopContentGroup = [];

    if (this.activeShopTab === 'buy') {
      this.drawShopBuyList();
      this.drawRerollButton();
    } else if (this.activeShopTab === 'sell') {
      this.drawShopSellList();
    } else if (this.activeShopTab === 'forge') {
      this.drawShopForgeList();
    }

    this.drawShopScrollHint();
  }

  _getWeaponArtCatalog() {
    return this.gameData?.weaponArts?.arts || [];
  }

  drawShopBuyList() {
    const startY = 105;
    const lineH = 24;
    this.shopScrollMax = Math.max(
      0,
      this.shopBuyItems.length * lineH - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y),
    );
    if (!this.shopScrollOffsets) this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollOffsets.buy = Phaser.Math.Clamp(
      this.shopScrollOffsets.buy || 0,
      0,
      this.shopScrollMax,
    );
    const offset = this.shopScrollOffsets.buy;

    this.shopBuyItems.forEach((entry, i) => {
      const y = startY + i * lineH - offset;
      if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) return;
      const affordable = this.runManager.gold >= entry.price;
      const affordableColor = this._currentShopHasAmbushDiscount ? '#88ff88' : '#e0e0e0';
      const color = affordable ? affordableColor : '#666666';
      const marker = hasWeaponArt(entry?.item, getWeaponArtCatalogForScene(this)) ? ' *' : '';
      const text = this.add
        .text(60, y, `${entry.item.name}${marker}  ${entry.price}G`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color,
        })
        .setDepth(OVERLAY_CONTENT_DEPTH);

      text.setInteractive({ useHandCursor: affordable });
      text.on('pointerover', () => {
        text.setColor('#ffdd44');
        this._showShopItemTooltip(entry, text.x + text.width + 10, text.y);
      });
      text.on('pointerout', () => {
        text.setColor(color);
        this._hideShopItemTooltip();
      });
      if (affordable) {
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (isTouchPointer(pointer)) {
            this._touchDownLatchKind = 'shop';
            this._showShopItemTooltip(entry, text.x + text.width + 10, text.y);
            // Record tap start for scroll-vs-tap validation on pointerup
            text._touchBuyStart = { x: pointer.x, y: pointer.y };
            return;
          }
          this.onBuyItem(entry);
        });
        text.on('pointerup', (pointer) => {
          if (!isTouchPointer(pointer)) return;
          const start = text._touchBuyStart;
          text._touchBuyStart = null;
          if (!start) return;
          // Reject if finger moved (scroll gesture) — also disarm buy latch
          const dx = pointer.x - start.x;
          const dy = pointer.y - start.y;
          if (dx * dx + dy * dy > 144) {
            this._touchPreviewedShopEntry = null;
            return;
          }
          // Two-tap: first tap = preview, second tap = buy
          const now = Date.now();
          if (
            this._touchPreviewedShopEntry === entry &&
            now - (this._touchPreviewedShopAt || 0) < 3000
          ) {
            this._touchPreviewedShopEntry = null;
            this.onBuyItem(entry);
          } else {
            this._touchPreviewedShopEntry = entry;
            this._touchPreviewedShopAt = now;
          }
        });
      } else {
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (isTouchPointer(pointer)) {
            this._touchDownLatchKind = 'shop';
            this._touchPreviewedShopEntry = null; // disarm buy latch on unaffordable tap
            this._showShopItemTooltip(entry, text.x + text.width + 10, text.y);
          }
        });
      }

      this.shopContentGroup.push(text);
      this.shopOverlay.push(text);
    });
  }

  onBuyItem(entry) {
    const rm = this.runManager;
    if (rm.gold < entry.price) return;

    // Path 1: Scrolls go to team pool
    if (entry.type === 'scroll') {
      rm.spendGold(entry.price);
      if (!rm.scrolls) rm.scrolls = [];
      rm.scrolls.push({ ...entry.item });
      const idx = this.shopBuyItems.indexOf(entry);
      if (idx !== -1) this.shopBuyItems.splice(idx, 1);
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      this.refreshShop();
      this.showShopBanner(`Got ${entry.item.name}! Added to Scroll Pool.`, '#88ff88');
      return;
    }

    // Path 2: Accessories go to team pool
    if (entry.type === 'accessory') {
      rm.spendGold(entry.price);
      if (!rm.accessories) rm.accessories = [];
      rm.accessories.push({ ...entry.item });
      const idx = this.shopBuyItems.indexOf(entry);
      if (idx !== -1) this.shopBuyItems.splice(idx, 1);
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      this.refreshShop();
      this.showShopBanner(`Got ${entry.item.name}! Added to Accessory Pool.`, '#88ff88');
      return;
    }

    // Path 3a: Consumables use consumables limit
    if (entry.item.type === 'Consumable') {
      this.showUnitPicker(
        (unitIndex) => {
          const unit = rm.roster[unitIndex];
          const consumableCount = unit.consumables ? unit.consumables.length : 0;
          if (consumableCount >= CONSUMABLE_MAX) {
            if (!rm.spendGold(entry.price)) {
              this.showShopBanner('Not enough gold.', '#ff8888');
              return;
            }
            if (!rm.addToConvoy(entry.item)) {
              if (typeof rm.addGold === 'function') rm.addGold(entry.price);
              this.showShopBanner(`${unit.name}'s consumables are full!`, '#ff8888');
              return;
            }
            const idx = this.shopBuyItems.indexOf(entry);
            if (idx !== -1) this.shopBuyItems.splice(idx, 1);
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.refreshShop();
            this.showShopBanner(`${entry.item.name} sent to convoy.`, '#88ccff');
            return;
          }
          rm.spendGold(entry.price);
          addToConsumables(unit, { ...entry.item });
          const idx = this.shopBuyItems.indexOf(entry);
          if (idx !== -1) this.shopBuyItems.splice(idx, 1);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          this.refreshShop();
          this.showShopBanner(`${unit.name} got ${entry.item.name}!`, '#88ff88');
        },
        { itemTypeContext: 'consumable' },
      );
      return;
    }

    // Path 3b: Weapons/staves use main inventory limit
    this.showUnitPicker(
      (unitIndex) => {
        const unit = rm.roster[unitIndex];
        if (unit.inventory.length >= INVENTORY_MAX) {
          if (!rm.spendGold(entry.price)) {
            this.showShopBanner('Not enough gold.', '#ff8888');
            return;
          }
          if (!rm.addToConvoy(entry.item)) {
            if (typeof rm.addGold === 'function') rm.addGold(entry.price);
            this.showShopBanner(`${unit.name}'s inventory is full!`, '#ff8888');
            return;
          }
          const idx = this.shopBuyItems.indexOf(entry);
          if (idx !== -1) this.shopBuyItems.splice(idx, 1);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          this.refreshShop();
          this.showShopBanner(`${entry.item.name} sent to convoy.`, '#88ccff');
          return;
        }
        rm.spendGold(entry.price);
        addToInventory(unit, { ...entry.item });
        const idx = this.shopBuyItems.indexOf(entry);
        if (idx !== -1) this.shopBuyItems.splice(idx, 1);
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        this.refreshShop();
        this.showShopBanner(`${unit.name} got ${entry.item.name}!`, '#88ff88');
      },
      { profCheckItem: entry.item, itemTypeContext: 'inventory' },
    );
  }

  drawShopSellList() {
    const startY = 105;
    const lineH = 22;
    const rm = this.runManager;
    const previewAwardedSellGold = (amount) => {
      const normalized = Math.max(0, Math.trunc(Number(amount) || 0));
      return normalized;
    };
    const rowModel = [];
    for (const unit of rm.roster) {
      rowModel.push({ kind: 'unit', unit });
      const inventory = unit.inventory || [];
      const consumables = unit.consumables || [];
      for (const item of inventory) {
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'inventory', unit, item, sellPrice });
      }
      for (const item of consumables) {
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'consumable', unit, item, sellPrice });
      }
    }
    // Convoy items
    const convoyWeapons = rm.convoy?.weapons || [];
    const convoyConsumables = rm.convoy?.consumables || [];
    const hasConvoySellable =
      convoyWeapons.some((w) => getSellPrice(w) > 0) ||
      convoyConsumables.some((c) => getSellPrice(c) > 0);
    if (hasConvoySellable) {
      rowModel.push({ kind: 'convoy_header' });
      for (let ci = 0; ci < convoyWeapons.length; ci++) {
        const item = convoyWeapons[ci];
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'convoy_weapon', item, sellPrice, convoyIndex: ci });
      }
      for (let ci = 0; ci < convoyConsumables.length; ci++) {
        const item = convoyConsumables[ci];
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'convoy_consumable', item, sellPrice, convoyIndex: ci });
      }
    }
    const rowTotal = rowModel.length;
    this.shopScrollMax = Math.max(0, rowTotal * lineH - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!this.shopScrollOffsets) this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollOffsets.sell = Phaser.Math.Clamp(
      this.shopScrollOffsets.sell || 0,
      0,
      this.shopScrollMax,
    );
    const offset = this.shopScrollOffsets.sell;

    for (let row = 0; row < rowModel.length; row++) {
      const rowData = rowModel[row];
      const y = startY + row * lineH - offset;
      if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) continue;

      if (rowData.kind === 'unit') {
        const nameText = this.add
          .text(60, y, `${rowData.unit.name}:`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(nameText);
        this.shopOverlay.push(nameText);
        continue;
      }

      if (rowData.kind === 'inventory') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const unit = rowData.unit;
        const locked = isLastCombatWeapon(unit, item);
        const equipped = item === unit.weapon ? '\u25b6' : ' ';
        const marker = hasWeaponArt(item, getWeaponArtCatalogForScene(this)) ? ' *' : '';
        const wpnColor = locked ? '#666666' : isForged(item) ? '#44ff88' : '#e0e0e0';
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const text = this.add
          .text(
            70,
            y,
            `${equipped}${item.name}${marker}  ${locked ? '(last weapon)' : '+' + awardedSellPrice + 'G'}`,
            {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: wpnColor,
            },
          )
          .setDepth(OVERLAY_CONTENT_DEPTH);

        if (!locked) {
          text.setInteractive({ useHandCursor: true });
          text.on('pointerover', () => text.setColor('#ffdd44'));
          text.on('pointerout', () => text.setColor(wpnColor));
          text.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
            else rm.addGold(sellPrice);
            removeFromInventory(unit, item);
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.refreshShop();
            this.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
          });
        }

        this.shopContentGroup.push(text);
        this.shopOverlay.push(text);
        continue;
      }

      if (rowData.kind === 'consumable') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const unit = rowData.unit;
        const usesText = Number.isFinite(item.uses) ? ` (${item.uses})` : '';
        const baseColor = '#88ff88';
        const text = this.add
          .text(70, y, ` ${item.name}${usesText}  +${awardedSellPrice}G`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: baseColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(baseColor));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
          else rm.addGold(sellPrice);
          removeFromConsumables(unit, item);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          this.refreshShop();
          this.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
        });

        this.shopContentGroup.push(text);
        this.shopOverlay.push(text);
        continue;
      }

      if (rowData.kind === 'convoy_header') {
        const hdr = this.add
          .text(60, y, 'Convoy:', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(hdr);
        this.shopOverlay.push(hdr);
        continue;
      }

      if (rowData.kind === 'convoy_weapon') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const convoyIdx = rowData.convoyIndex;
        const marker = hasWeaponArt(item, getWeaponArtCatalogForScene(this)) ? ' *' : '';
        const wpnColor = isForged(item) ? '#44ff88' : '#e0e0e0';
        const text = this.add
          .text(70, y, ` ${item.name}${marker}  +${awardedSellPrice}G`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: wpnColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(wpnColor));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          rm.takeFromConvoy('weapon', convoyIdx);
          if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
          else rm.addGold(sellPrice);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          this.refreshShop();
          this.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
        });
        this.shopContentGroup.push(text);
        this.shopOverlay.push(text);
        continue;
      }

      if (rowData.kind === 'convoy_consumable') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const convoyIdx = rowData.convoyIndex;
        const usesText = Number.isFinite(item.uses) ? ` (${item.uses})` : '';
        const baseColor = '#88ff88';
        const text = this.add
          .text(70, y, ` ${item.name}${usesText}  +${awardedSellPrice}G`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: baseColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(baseColor));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          rm.takeFromConvoy('consumable', convoyIdx);
          if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
          else rm.addGold(sellPrice);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          this.refreshShop();
          this.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
        });
        this.shopContentGroup.push(text);
        this.shopOverlay.push(text);
      }
    }
  }

  drawShopForgeList() {
    this._hideForgeTooltip();
    const startY = 105;
    const lineH = 20;
    const rm = this.runManager;
    const baseForgeLimit = SHOP_FORGE_LIMITS[rm.currentAct] || 2;
    const forgeLimit = baseForgeLimit + (rm.blessingRuntimeModifiers?.forgeLimitDelta || 0);
    let row = 0;
    let rowTotal = 1.5;
    for (const unit of rm.roster) {
      const forgeableWeapons = unit.inventory.filter((w) => canForge(w));
      if (forgeableWeapons.length === 0) continue;
      rowTotal += 1 + forgeableWeapons.length;
    }
    const convoyForgeWeapons = (rm.convoy?.weapons || []).filter((w) => canForge(w));
    if (convoyForgeWeapons.length > 0) rowTotal += 1 + convoyForgeWeapons.length;
    this.shopScrollMax = Math.max(0, rowTotal * lineH - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!this.shopScrollOffsets) this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollOffsets.forge = Phaser.Math.Clamp(
      this.shopScrollOffsets.forge || 0,
      0,
      this.shopScrollMax,
    );
    const offset = this.shopScrollOffsets.forge;

    // Header: forges remaining
    const headerY = startY - offset;
    if (headerY >= SHOP_LIST_TOP_Y - lineH && headerY <= SHOP_LIST_BOTTOM_Y) {
      const header = this.add
        .text(60, headerY, `Forges remaining: ${forgeLimit - this.shopForgesUsed}/${forgeLimit}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ff8844',
        })
        .setDepth(OVERLAY_CONTENT_DEPTH);
      this.shopContentGroup.push(header);
      this.shopOverlay.push(header);
    }
    row += 1.5;

    const limitReached = this.shopForgesUsed >= forgeLimit;

    for (const unit of rm.roster) {
      const forgeableWeapons = unit.inventory.filter((w) => canForge(w));
      if (forgeableWeapons.length === 0) continue;

      const nameY = startY + row * lineH - offset;
      if (nameY >= SHOP_LIST_TOP_Y - lineH && nameY <= SHOP_LIST_BOTTOM_Y) {
        const nameText = this.add
          .text(60, nameY, `${unit.name}:`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(nameText);
        this.shopOverlay.push(nameText);
      }
      row++;

      for (const wpn of forgeableWeapons) {
        const y = startY + row * lineH - offset;
        const level = wpn._forgeLevel || 0;
        const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';
        const marker = hasWeaponArt(wpn, getWeaponArtCatalogForScene(this)) ? ' *' : '';
        const label = `  ${wpn.name}${marker}  [${level}/${FORGE_MAX_LEVEL}]`;
        if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) {
          row++;
          continue;
        }
        const wpnText = this.add
          .text(70, y, label, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: wpnColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(wpnText);
        this.shopOverlay.push(wpnText);

        // Hover tooltip for weapon stats (+ touch tap)
        wpnText.setInteractive({ useHandCursor: false });
        wpnText.on('pointerover', () => {
          this._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
        });
        wpnText.on('pointerout', () => this._hideForgeTooltip());
        wpnText.on('pointerdown', (pointer) => {
          if (isTouchPointer(pointer)) {
            this._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
          }
        });

        if (level >= FORGE_MAX_LEVEL) {
          const maxLabel = this.add
            .text(350, y, 'MAX', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#888888',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          this.shopContentGroup.push(maxLabel);
          this.shopOverlay.push(maxLabel);
        } else if (limitReached) {
          const limitLabel = this.add
            .text(350, y, '(limit)', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#666666',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          this.shopContentGroup.push(limitLabel);
          this.shopOverlay.push(limitLabel);
        } else {
          const forgeBtn = this.add
            .text(350, y, '[ Forge ]', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#ff8844',
              backgroundColor: '#333333',
              padding: { x: 4, y: 1 },
            })
            .setDepth(OVERLAY_CONTENT_DEPTH)
            .setInteractive({ useHandCursor: true });
          forgeBtn.on('pointerover', () => forgeBtn.setColor('#ffdd44'));
          forgeBtn.on('pointerout', () => forgeBtn.setColor('#ff8844'));
          forgeBtn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            this.showForgeStatPicker(wpn);
          });
          this.shopContentGroup.push(forgeBtn);
          this.shopOverlay.push(forgeBtn);
        }

        row++;
      }
    }

    // Convoy forgeable weapons
    if (convoyForgeWeapons.length > 0) {
      const convoyHeaderY = startY + row * lineH - offset;
      if (convoyHeaderY >= SHOP_LIST_TOP_Y - lineH && convoyHeaderY <= SHOP_LIST_BOTTOM_Y) {
        const hdr = this.add
          .text(60, convoyHeaderY, 'Convoy:', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(hdr);
        this.shopOverlay.push(hdr);
      }
      row++;

      for (const wpn of convoyForgeWeapons) {
        const y = startY + row * lineH - offset;
        const level = wpn._forgeLevel || 0;
        const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';
        const marker = hasWeaponArt(wpn, getWeaponArtCatalogForScene(this)) ? ' *' : '';
        const label = `  ${wpn.name}${marker}  [${level}/${FORGE_MAX_LEVEL}]`;
        if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) {
          row++;
          continue;
        }
        const wpnText = this.add
          .text(70, y, label, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: wpnColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(wpnText);
        this.shopOverlay.push(wpnText);

        wpnText.setInteractive({ useHandCursor: false });
        wpnText.on('pointerover', () => {
          this._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
        });
        wpnText.on('pointerout', () => this._hideForgeTooltip());
        wpnText.on('pointerdown', (pointer) => {
          if (isTouchPointer(pointer)) {
            this._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
          }
        });

        if (level >= FORGE_MAX_LEVEL) {
          const maxLabel = this.add
            .text(350, y, 'MAX', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#888888',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          this.shopContentGroup.push(maxLabel);
          this.shopOverlay.push(maxLabel);
        } else if (limitReached) {
          const limitLabel = this.add
            .text(350, y, '(limit)', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#666666',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          this.shopContentGroup.push(limitLabel);
          this.shopOverlay.push(limitLabel);
        } else {
          const forgeBtn = this.add
            .text(350, y, '[ Forge ]', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#ff8844',
              backgroundColor: '#333333',
              padding: { x: 4, y: 1 },
            })
            .setDepth(OVERLAY_CONTENT_DEPTH)
            .setInteractive({ useHandCursor: true });
          forgeBtn.on('pointerover', () => forgeBtn.setColor('#ffdd44'));
          forgeBtn.on('pointerout', () => forgeBtn.setColor('#ff8844'));
          forgeBtn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            this.showForgeStatPicker(wpn);
          });
          this.shopContentGroup.push(forgeBtn);
          this.shopOverlay.push(forgeBtn);
        }

        row++;
      }
    }

    if (row <= 1.5 && convoyForgeWeapons.length === 0) {
      const emptyY = startY + row * lineH - offset;
      if (emptyY >= SHOP_LIST_TOP_Y - lineH && emptyY <= SHOP_LIST_BOTTOM_Y) {
        const emptyText = this.add
          .text(60, emptyY, 'No forgeable weapons in roster.', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#888888',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(emptyText);
        this.shopOverlay.push(emptyText);
      }
    }
  }

  drawShopScrollHint() {
    if (!this.shopOverlay || !this.shopContentGroup) return;
    if ((this.shopScrollMax || 0) <= 0) return;
    const offset = this.shopScrollOffsets?.[this.activeShopTab] || 0;
    const percent = this.shopScrollMax > 0 ? Math.round((offset / this.shopScrollMax) * 100) : 0;
    const hint = this.add
      .text(445, 392, `Scroll: ${percent}%`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
        backgroundColor: '#222222',
        padding: { x: 4, y: 2 },
      })
      .setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopContentGroup.push(hint);
    this.shopOverlay.push(hint);
  }

  _getShopItemDetailText(entry) {
    const item = entry?.item || {};
    const entryType = entry?.type || item.type;

    if (entryType === 'accessory' || item.type === 'Accessory') {
      return formatAccessoryDetail(item, { fallback: 'Accessory' }) || 'Accessory';
    }

    if (entryType === 'consumable' || item.type === 'Consumable') {
      if (item.effect === 'heal') {
        const uses = Number.isFinite(Number(item.uses)) ? Number(item.uses) : 1;
        return `Heals ${Number(item.value) || 0} HP (${uses} use${uses === 1 ? '' : 's'})`;
      }
      if (item.effect === 'healFull') {
        const uses = Number.isFinite(Number(item.uses)) ? Number(item.uses) : 1;
        return `Fully heals HP (${uses} use${uses === 1 ? '' : 's'})`;
      }
      if (item.effect === 'statBoost') {
        const stat = item.stat || 'STAT';
        const value = Number(item.value) || 0;
        return `Permanently +${value} ${stat}`;
      }
      if (item.effect === 'promote') return 'Use at Lv 10+ to promote a unit';
      if (item.effect === 'reclass') {
        const label = item.subEffect === 'mounted' ? 'mounted' : 'infantry';
        return `Reclass a unit to a ${label} class`;
      }
      if (item.effect === 'cure') {
        const uses = Number.isFinite(Number(item.uses)) ? Number(item.uses) : 1;
        return `Cures all conditions (${uses} use${uses === 1 ? '' : 's'})`;
      }
      if (item.effect === 'cureHeal') {
        const uses = Number.isFinite(Number(item.uses)) ? Number(item.uses) : 1;
        return `Cures conditions & heals ${Number(item.value) || 0} HP (${uses} use${uses === 1 ? '' : 's'})`;
      }
      return item.special || 'Consumable';
    }

    if (entryType === 'scroll' || item.type === 'Scroll') {
      const header = item.special || 'Teaches a skill';
      const skillDef = this.gameData?.skills?.find((s) => s.id === item.skillId);
      const desc = skillDef?.description || '';
      return desc ? `${header}\n${desc}` : header;
    }

    if (item.type === 'Whetstone') {
      if (item.forgeStat === 'choice') return 'Forge: choose a stat boost';
      if (item.forgeStat === 'might') return 'Forge: +1 Mt';
      if (item.forgeStat === 'crit') return 'Forge: +5 Crit';
      if (item.forgeStat === 'hit') return 'Forge: +5 Hit';
      if (item.forgeStat === 'weight') return 'Forge: -1 Wt';
      return 'Forge item';
    }

    const mt = Number.isFinite(Number(item.might)) ? Number(item.might) : 0;
    const hit = Number.isFinite(Number(item.hit)) ? Number(item.hit) : 0;
    const crt = Number.isFinite(Number(item.crit)) ? Number(item.crit) : 0;
    const wt = Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0;
    const rng = item.range ?? '1';
    const artCatalog = getWeaponArtCatalogForScene(this);

    const lines = [];
    if (item.type) lines.push(item.type);
    lines.push(`Mt: ${mt}   Hit: ${hit}   Crt: ${crt}`);
    lines.push(`Wt: ${wt}   Rng: ${rng}`);
    if (item.special) lines.push(`Special: ${item.special}`);
    lines.push(...getWeaponArtTooltipLines(item, artCatalog));
    return lines.join('\n');
  }

  _showShopItemTooltip(entry, anchorX, anchorY) {
    this._hideShopItemTooltip();
    const detail = this._getShopItemDetailText(entry);
    if (!detail) return;
    this.shopItemTooltip = [];

    const padX = 8;
    const padY = 6;
    const maxTextW = 304; // 320 - padX*2

    // Create text first with wordWrap so Phaser computes accurate dimensions
    const detailText = this.add
      .text(0, 0, detail, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e0e0e0',
        lineSpacing: 4,
        wordWrap: { width: maxTextW },
      })
      .setDepth(311);

    const boxW = Phaser.Math.Clamp(detailText.width + padX * 2, 150, 320);
    const boxH = detailText.height + padY * 2;

    let tx = anchorX;
    let ty = anchorY;
    if (tx + boxW > 635) tx = anchorX - boxW - 20;
    if (ty + boxH > 475) ty = 475 - boxH;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = 5;

    const bg = this.add
      .rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, 0x111122, 0.95)
      .setDepth(310)
      .setStrokeStyle(1, 0x336666);
    detailText.setPosition(tx + padX, ty + padY);

    this.shopItemTooltip.push(bg, detailText);
  }

  _hideShopItemTooltip() {
    if (this.shopItemTooltip) {
      this.shopItemTooltip.forEach((o) => o.destroy());
      this.shopItemTooltip = null;
    }
  }

  showForgeStatPicker(weapon) {
    if (this.forgePicker) this.forgePicker.forEach((o) => o.destroy());
    this.forgePicker = [];

    const cx = 320;
    const cy = 240;
    const level = weapon._forgeLevel || 0;

    const pickerBg = this.add
      .rectangle(cx, cy, 320, 220, 0x222233, 0.97)
      .setDepth(450)
      .setStrokeStyle(2, 0xff8844)
      .setInteractive();
    this.forgePicker.push(pickerBg);

    const title = this.add
      .text(cx, cy - 88, `Forge ${weapon.name} (${level}/${FORGE_MAX_LEVEL})`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(451);
    this.forgePicker.push(title);

    const stats = [
      { key: 'might', label: '+1 Mt' },
      { key: 'crit', label: '+5 Crit' },
      { key: 'hit', label: '+5 Hit' },
      { key: 'weight', label: '-1 Wt' },
    ];

    const btnStartY = cy - 50;
    const btnH = 32;
    const blessingDiscountRaw = this.runManager?.getForgeCostDiscount?.() || 0;
    const blessingDiscount = Math.max(0, Math.min(0.95, blessingDiscountRaw));
    const ambushDiscount = this._currentShopHasAmbushDiscount
      ? 1 - (1 - blessingDiscount) * AMBUSH_SHOP_DISCOUNT
      : blessingDiscount;
    const discount = Math.max(0, Math.min(0.95, ambushDiscount));

    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const statCount = getStatForgeCount(weapon, stat.key);
      const atStatCap = statCount >= FORGE_STAT_CAP;
      const baseCost = getForgeCost(weapon, stat.key);
      const cost = Math.max(1, Math.floor(baseCost * (1 - discount)));
      const affordable = cost > 0 && this.runManager.gold >= cost;
      const by = btnStartY + i * btnH;
      const affordableColor = this._currentShopHasAmbushDiscount ? '#88ff88' : '#e0e0e0';
      const color = atStatCap ? '#666666' : affordable ? affordableColor : '#666666';

      const costLabel = atStatCap ? 'MAX' : `${cost}G`;
      const btn = this.add
        .text(cx, by, `${stat.label}  (${statCount}/${FORGE_STAT_CAP})  ${costLabel}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color,
          backgroundColor: affordable && !atStatCap ? '#444444' : '#333333',
          padding: { x: 16, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(451);

      if (affordable && !atStatCap) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor('#ffdd44'));
        btn.on('pointerout', () => btn.setColor(color));
        btn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          const result = applyForge(weapon, stat.key, discount);
          if (result.success) {
            this.runManager.spendGold(result.cost);
            this.shopForgesUsed++;
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.closeForgeStatPicker();
            this.refreshShop();
            this.showShopBanner(`Forged ${weapon.name}!`, '#ff8844');
          }
        });
      }

      this.forgePicker.push(btn);
    }

    // Cancel button
    const cancelBtn = this.add
      .text(cx, btnStartY + stats.length * btnH + 10, 'Cancel', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        backgroundColor: '#333333',
        padding: { x: 12, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(451)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this.closeForgeStatPicker();
    });
    this.forgePicker.push(cancelBtn);
  }

  closeForgeStatPicker() {
    if (this.forgePicker) {
      this.forgePicker.forEach((o) => o.destroy());
      this.forgePicker = null;
    }
  }

  _showForgeTooltip(wpn, anchorX, anchorY) {
    this._hideForgeTooltip();
    this.forgeTooltip = [];

    const line1 = `Mt: ${wpn.might}   Hit: ${wpn.hit}   Crt: ${wpn.crit}`;
    const line2 = `Wt: ${wpn.weight}   Rng: ${wpn.range}`;
    const mtCount = getStatForgeCount(wpn, 'might');
    const crCount = getStatForgeCount(wpn, 'crit');
    const htCount = getStatForgeCount(wpn, 'hit');
    const wtCount = getStatForgeCount(wpn, 'weight');
    const line3 = `Forge: Mt(${mtCount}/${FORGE_STAT_CAP}) Cr(${crCount}/${FORGE_STAT_CAP}) Ht(${htCount}/${FORGE_STAT_CAP}) Wt(${wtCount}/${FORGE_STAT_CAP})`;

    const lineDefs = [
      { text: line1, color: '#e0e0e0' },
      { text: line2, color: '#e0e0e0' },
      { text: line3, color: '#ff8844' },
    ];
    if (wpn.special) lineDefs.push({ text: `Special: ${wpn.special}`, color: '#88ccff' });
    const artLines = getWeaponArtTooltipLines(wpn, getWeaponArtCatalogForScene(this));
    for (const line of artLines) lineDefs.push({ text: line, color: '#ffcc88' });

    const padX = 8;
    const padY = 6;
    const maxTextW = 320;
    const lineSpacing = 3;
    const detailLines = lineDefs.map(({ text, color }) =>
      this.add
        .text(0, 0, text, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color,
          wordWrap: { width: maxTextW },
        })
        .setDepth(311),
    );
    const textW = detailLines.reduce((max, lineObj) => Math.max(max, lineObj.width || 0), 0);
    const textH =
      detailLines.reduce((sum, lineObj) => sum + (lineObj.height || 0), 0) +
      Math.max(0, detailLines.length - 1) * lineSpacing;
    const boxW = Phaser.Math.Clamp(textW + padX * 2, 220, 340);
    const boxH = textH + padY * 2;

    // Clamp to canvas (640x480)
    let tx = anchorX;
    let ty = anchorY;
    if (tx + boxW > 635) tx = anchorX - boxW - 20;
    if (ty + boxH > 475) ty = 475 - boxH;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = 5;

    const bg = this.add
      .rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, 0x111122, 0.95)
      .setDepth(310)
      .setStrokeStyle(1, 0x4466aa);
    this.forgeTooltip.push(bg);
    let lineY = ty + padY;
    for (const lineObj of detailLines) {
      lineObj.setPosition(tx + padX, lineY);
      this.forgeTooltip.push(lineObj);
      lineY += (lineObj.height || 0) + lineSpacing;
    }
  }

  _hideForgeTooltip() {
    if (this.forgeTooltip) {
      this.forgeTooltip.forEach((o) => o.destroy());
      this.forgeTooltip = null;
    }
  }

  _saveShopState() {
    const node = this._shopNode;
    if (!node) return;
    this.runManager?.saveShopState?.(node.id, {
      items: (this.shopBuyItems || []).map(({ index, ...rest }) => rest),
      forgesUsed: this.shopForgesUsed || 0,
      rerollCount: this.shopRerollCount || 0,
      originalSlotCount: this._shopOriginalSlotCount || 0,
      ambushDiscountActive: this._currentShopHasAmbushDiscount || false,
    });
  }

  refreshShop() {
    this._touchPreviewedShopEntry = null;
    this.shopGoldText.setText(`Gold: ${this.runManager.gold}G`);
    this.drawActiveTabContent();
    this.drawShopTabs();
    this._saveShopState();
  }

  drawRerollButton() {
    const cost = SHOP_REROLL_COST + this.shopRerollCount * SHOP_REROLL_ESCALATION;
    const affordable = this.runManager.gold >= cost;
    const color = affordable ? '#aaddff' : '#666666';
    const rerollBtn = this.add
      .text(60, 410, `[ Reroll ${cost}G ]`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#333333',
        padding: { x: 8, y: 4 },
      })
      .setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopContentGroup.push(rerollBtn);
    this.shopOverlay.push(rerollBtn);

    if (affordable) {
      rerollBtn.setInteractive({ useHandCursor: true });
      rerollBtn.on('pointerover', () => rerollBtn.setColor('#ffdd44'));
      rerollBtn.on('pointerout', () => rerollBtn.setColor(color));
      rerollBtn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        this.runManager.spendGold(cost);
        this.shopRerollCount++;
        const targetCount = Math.max(
          0,
          Number(this._shopOriginalSlotCount) || this.shopBuyItems.length || 0,
        );
        const currentItems = Array.isArray(this.shopBuyItems) ? this.shopBuyItems.slice() : [];
        const hasPurchasedAny = currentItems.length < targetCount;
        const baseItems = hasPurchasedAny ? currentItems : [];
        const itemKey = (entry) =>
          `${entry?.type || entry?.item?.type || ''}|${entry?.item?.name || ''}`;
        const generatePricedItems = () => {
          const generated = generateShopInventory(
            this.runManager.currentAct,
            this.gameData.lootTables,
            this.gameData.weapons,
            this.gameData.consumables,
            this.gameData.accessories,
            this.runManager.roster,
            this.runManager.getWeaponArtSpawnConfig(),
            {
              shopCureGating: this.runManager.difficultyModifiers?.shopCureGating,
            },
          );
          let priced = this.applyDifficultyShopPricing(generated);
          if (this._currentShopHasAmbushDiscount) {
            priced = this.applyAmbushDiscount(priced);
          }
          return Array.isArray(priced) ? priced : [];
        };

        const fillToTarget = (items, preferUnique, fallbackSeedItems = []) => {
          const result = items.slice(0, targetCount);
          const deferred = [];
          const seen = new Set(result.map((entry) => itemKey(entry)).filter(Boolean));
          const uniquePasses = Math.max(4, targetCount * 4);
          for (let pass = 0; result.length < targetCount && pass < uniquePasses; pass++) {
            const batch = generatePricedItems();
            for (const entry of batch) {
              if (result.length >= targetCount) break;
              const key = itemKey(entry);
              if (preferUnique && key && seen.has(key)) {
                deferred.push(entry);
                continue;
              }
              result.push(entry);
              if (key) seen.add(key);
            }
          }
          while (result.length < targetCount && deferred.length > 0) {
            result.push(deferred.shift());
          }
          const fallbackPasses = Math.max(4, targetCount * 4);
          for (let pass = 0; result.length < targetCount && pass < fallbackPasses; pass++) {
            const batch = generatePricedItems();
            for (const entry of batch) {
              if (result.length >= targetCount) break;
              result.push(entry);
            }
          }
          if (result.length < targetCount) {
            const seedSource = result.length > 0 ? result : fallbackSeedItems;
            if (seedSource.length > 0) {
              const seed = seedSource[0];
              while (result.length < targetCount) {
                result.push({ ...seed, item: seed?.item ? { ...seed.item } : seed.item });
              }
            }
          }
          return result.slice(0, targetCount);
        };

        const nextItems = fillToTarget(baseItems, hasPurchasedAny, currentItems);
        this.shopBuyItems = nextItems.map((entry, i) => ({ ...entry, index: i }));
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        this.refreshShop();
        this.showShopBanner('Shop restocked!', '#aaddff');
      });
    }
  }

  showUnitPicker(callback, pickerOptionsOrItem) {
    this.closeUnitPicker();

    const rm = this.runManager;
    const viewportHeight = 280;
    const contentHeight = rm.roster.length * 30;
    const maxOffset = Math.max(0, contentHeight - viewportHeight);
    const pickerOptions =
      pickerOptionsOrItem &&
      typeof pickerOptionsOrItem === 'object' &&
      ('profCheckItem' in pickerOptionsOrItem || 'itemTypeContext' in pickerOptionsOrItem)
        ? pickerOptionsOrItem
        : { profCheckItem: pickerOptionsOrItem, itemTypeContext: null };
    const profCheckItem = pickerOptions?.profCheckItem || null;
    const itemTypeContext = pickerOptions?.itemTypeContext || null;

    this.unitPickerState = {
      callback,
      profCheckItem,
      itemTypeContext,
      offset: 0,
      maxOffset,
      viewportTop: 120,
      viewportBottom: 120 + viewportHeight,
    };
    this.renderUnitPicker();
  }

  renderUnitPicker() {
    if (!this.unitPickerState) return;
    if (this.unitPicker) this.unitPicker.forEach((o) => o.destroy());
    this.unitPicker = [];

    const rm = this.runManager;
    const state = this.unitPickerState;
    const cx = 320;
    const panelY = 260;
    const panelW = 360;
    const panelH = 360;
    const listTop = state.viewportTop;
    const listBottom = state.viewportBottom;
    const offset = state.offset || 0;

    const pickerBg = this.add
      .rectangle(cx, panelY, panelW, panelH, 0x222222, 0.95)
      .setDepth(400)
      .setStrokeStyle(1, 0x888888)
      .setInteractive();
    this.unitPicker.push(pickerBg);

    const pickerTitle = this.add
      .text(cx, 102, 'Give to:', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(401);
    this.unitPicker.push(pickerTitle);

    const clipTop = this.add.rectangle(cx, listTop, panelW - 20, 1, 0x555555, 0.6).setDepth(401);
    const clipBottom = this.add
      .rectangle(cx, listBottom, panelW - 20, 1, 0x555555, 0.6)
      .setDepth(401);
    this.unitPicker.push(clipTop, clipBottom);

    rm.roster.forEach((unit, i) => {
      const y = listTop + i * 30 - offset + 15;
      if (y < listTop - 15 || y > listBottom + 15) return;
      const profCheckItem = state.profCheckItem || null;
      const shouldCheckProficiency = isProficiencyCheckRelevant(profCheckItem);
      const noProf = shouldCheckProficiency && !hasProficiency(unit, profCheckItem);
      const inventoryCount = (unit.inventory || []).length;
      const consumableCount = (unit.consumables || []).length;
      const inventoryFull = inventoryCount >= INVENTORY_MAX;
      const consumablesFull = consumableCount >= CONSUMABLE_MAX;
      const fullSuffix =
        state.itemTypeContext === 'consumable'
          ? consumablesFull
            ? ' consumables full'
            : ''
          : state.itemTypeContext === 'inventory'
            ? inventoryFull
              ? ' inventory full'
              : ''
            : '';
      const displayName = truncateUnitNameForCapacityLabel(unit.name, 16);
      const label = `${displayName} (Inventory ${inventoryCount}/${INVENTORY_MAX} | Consumables ${consumableCount}/${CONSUMABLE_MAX})${noProf ? ' no prof' : ''}${fullSuffix}`;
      const color = noProf ? '#cc8844' : '#e0e0e0';
      const btn = this.add
        .text(cx, y, label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color,
          backgroundColor: '#444444',
          padding: { x: 12, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(401)
        .setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor(color));
      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        const cb = state.callback;
        this.closeUnitPicker();
        cb(i);
      });

      this.unitPicker.push(btn);
    });

    if (state.maxOffset > 0) {
      const pct = Math.round((offset / state.maxOffset) * 100);
      const hint = this.add
        .text(cx + panelW / 2 - 10, 102, `${pct}%`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#888888',
        })
        .setOrigin(1, 0.5)
        .setDepth(401);
      this.unitPicker.push(hint);
    }

    const cancelBtn = this.add
      .text(cx, 430, '[ Cancel ]', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#bbbbbb',
        backgroundColor: '#333333',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(401)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#bbbbbb'));
    cancelBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this.closeUnitPicker();
    });
    this.unitPicker.push(cancelBtn);
  }

  closeUnitPicker() {
    if (this.unitPicker) {
      this.unitPicker.forEach((o) => o.destroy());
      this.unitPicker = null;
    }
    this.unitPickerState = null;
  }

  showShopBanner(msg, color) {
    const banner = this.add
      .text(320, 400, msg, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(500)
      .setAlpha(0);

    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 200,
      yoyo: true,
      hold: 800,
      onComplete: () => banner.destroy(),
    });
  }

  showWeaponArtsUnlockedBanner(artIds = []) {
    if (!Array.isArray(artIds) || artIds.length <= 0) return;
    const catalog = this.gameData?.weaponArts?.arts || [];
    const names = artIds
      .map((id) => catalog.find((art) => art?.id === id)?.name || id)
      .filter(Boolean);
    if (names.length <= 0) return;
    const suffix = names.length > 1 ? 's' : '';
    const label =
      names.length > 2
        ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
        : names.join(', ');
    this.showShopBanner(`Weapon Art${suffix} unlocked: ${label}`, '#88ddff');
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

  async _showSkillDisplacementWarning(displacedSkills) {
    if (!displacedSkills || Object.keys(displacedSkills).length === 0) return;
    const skillsData = this.gameData?.skills || [];
    const getName = (id) => skillsData.find((s) => s.id === id)?.name || id;
    const lines = Object.entries(displacedSkills).map(
      ([unitName, { displaced, replacedBy }]) =>
        `${unitName}: ${getName(replacedBy)} replaced ${getName(displaced)}`,
    );
    const message = `Personal skills restored!\n${lines.join('\n')}`;
    await showImportantHint(this, message);
  }

  closeShopOverlay() {
    this._shopViewingRoster = false;
    this._touchPreviewedShopEntry = null;
    this.closeForgeStatPicker();
    this._hideForgeTooltip();
    this._hideShopItemTooltip();
    if (this.shopOverlay) {
      this.shopOverlay.forEach((o) => o.destroy());
      this.shopOverlay = null;
    }
    if (this.shopContentGroup) {
      this.shopContentGroup.forEach((o) => o.destroy());
      this.shopContentGroup = null;
    }
    if (this.shopTabObjects) {
      this.shopTabObjects.forEach((o) => o.destroy());
      this.shopTabObjects = null;
    }
    if (this.unitPicker) {
      this.closeUnitPicker();
    }
    this._shopViewingMap = false;
    this._shopOriginalSlotCount = 0;
    this._shopNode = null;
    this._currentShopHasAmbushDiscount = false;
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
