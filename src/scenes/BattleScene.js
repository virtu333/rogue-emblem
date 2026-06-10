// BattleScene -- Phase 3: multi-unit tactical combat with unit system

import Phaser from 'phaser';
import { isTouchPointer } from '../utils/runtimeFlags.js';
import { Grid, computeEffectivePath } from '../engine/Grid.js';
import { TurnManager } from '../engine/TurnManager.js';
import { AIController } from '../engine/AIController.js';
import {
  getCombatForecast,
  resolveCombat,
  resolveHeal,
  gridDistance,
  calculateEffectiveSpeed,
  parseRange,
  isInRange,
  isStaff,
  getEffectivenessMultiplier,
  getStaffRemainingUses,
  getStaffMaxUses,
  getEffectiveStaffRange,
  spendStaffUse,
} from '../engine/Combat.js';
import {
  isEntity,
  getFootprint,
  getFootprintKeys,
  combatDistance,
  rollSplashTiles,
  rollSplashDamage,
  getEntityCenter,
} from '../engine/EntitySystem.js';
import {
  createLordUnit,
  createEnemyUnit as createEnemyUnitFromClass,
  createPromotedEnemyUnit,
  createRecruitUnit,
  calculateCombatXP,
  gainExperience,
  levelUp,
  addToInventory,
  addToConsumables,
  removeFromConsumables,
  equipWeapon,
  hasStaff,
  getStaffWeapon,
  getCombatWeapons,
  canPromote,
  promoteUnit,
  resolvePromotionTargets,
  resolvePromotionTargetClass,
  grantLethalArmoryWeapon,
  grantSecondaryWeapons,
  checkLevelUpSkills,
  learnSkill,
  removeFromInventory,
  hasProficiency,
  canEquip,
  applyStatBoost,
  getClassInnateSkills,
  canReclass,
  getReclassTargets,
  reclassUnit,
} from '../engine/UnitManager.js';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  getTurnStartEffects,
  getWeaponRangeBonus,
  getTerrainCostReduction,
  checkPhoenixBrooch,
  resolveGamblerDelta,
  applyAccessoryPhaseCombatMods,
} from '../engine/SkillSystem.js';
import {
  getTurnStartAffixes,
  getOnDeathAffixes,
  getAttackAffixes,
  rollDefenseAffixes,
  getWarpCandidates,
  getAffixMovBonus,
} from '../engine/AffixSystem.js';
import { shouldAllowUndoMove } from '../engine/TradeFlow.js';
import {
  getWeaponArtCombatMods,
  recordWeaponArtUse,
  applyWeaponArtCost,
  resetWeaponArtTurnUsage,
} from '../engine/WeaponArtSystem.js';
import {
  didCombatSideLandHit,
  getPostCombatPipelineSteps,
  resolvePostCombatMove,
} from '../engine/WeaponArtPostCombat.js';
import { LevelUpPopup } from '../ui/LevelUpPopup.js';
import { UnitInspectionPanel } from '../ui/UnitInspectionPanel.js';
import { UnitDetailOverlay } from '../ui/UnitDetailOverlay.js';
import { DialogueOverlay } from '../ui/DialogueOverlay.js';
import { DangerZoneOverlay } from '../ui/DangerZoneOverlay.js';
import {
  TILE_SIZE,
  FACTION_COLORS,
  MAX_SKILLS,
  BOSS_STAT_BONUS,
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  LOOT_CHOICES,
  ELITE_LOOT_CHOICES,
  ROSTER_CAP,
  DEPLOY_LIMITS,
  TERRAIN,
  TERRAIN_HEAL_PERCENT,
  FORT_HEAL_DECAY_MULTIPLIERS,
  ANTI_TURTLE_NO_PROGRESS_TURNS,
  RECRUIT_SKILL_POOL,
  XP_STAT_NAMES,
  SUNDER_WEAPON_BY_TYPE,
  POISON_WEAPON_BY_TYPE,
  XP_BASE_DANCE,
  XP_BASE_HEAL,
  XP_SPECIAL_ENEMY_MULTIPLIER,
  BASE_CLASS_LEVEL_CAP,
  LAVA_CRACK_DAMAGE,
  GOLD_LOOT_REWARD_MULTIPLIER,
  RECRUIT_NODE_LORD_CHANCE,
  ZOMBIE_CLASSES,
  filterClassPoolByDifficulty,
  ENTITY_SPLASH_COUNT,
  ENTITY_FOOTPRINT,
  ENTITY_PRIMARY_ATTACK_RANGE,
  ENTITY_WEAPON_NAMES,
} from '../utils/constants.js';
import { getHPBarColor, applyTextResolution, TEXT_RESOLUTION } from '../utils/uiStyles.js';
import { generateBattle } from '../engine/MapGenerator.js';
import {
  computeAcidDamage,
  computeLavaCrackHp,
  isAcidTerrainIndex,
  isLavaCrackTerrainIndex,
} from '../engine/TerrainHazards.js';
import {
  applyCondition,
  isSleeping,
  isSilenced,
  isAcidPoisoned,
  removeCondition,
  clearAllConditions,
  resolveStatusStaff,
  processConditionRecovery,
  isStatusStaff,
  isHealStaff,
  hasCondition,
  parseStaffRange,
} from '../engine/StatusConditionSystem.js';
import { clearSavedRun } from '../engine/RunManager.js';
import {
  calculateKillReward,
  generateLootChoices,
  calculateSkipLootBonus,
} from '../engine/LootSystem.js';
import {
  calculatePar,
  getRating,
  getLatePressureState,
  isBossEnrageActive,
  getParXpMultiplier,
  formatParTooltip,
} from '../engine/TurnBonusCalculator.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { PauseOverlay } from '../ui/PauseOverlay.js';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { MUSIC, getMusicKey } from '../utils/musicConfig.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import {
  generateBossRecruitCandidates,
  getAvailableLords,
  createBossLordUnit,
  getRecruitPoolEntries,
} from '../engine/BossRecruitSystem.js';
import {
  RECRUIT_PROMOTION_CONTEXT,
  isPromotedRecruitSource,
  rollRecruitPromotion,
  getFailBaseLevel,
} from '../engine/RecruitPromotion.js';
import { resolveRecruitScalingTargets, resolveTeamAverageLevel } from '../engine/RecruitScaling.js';
import { DEBUG_MODE, debugState } from '../utils/debugMode.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { RosterOverlay } from '../ui/RosterOverlay.js';
import { createSeededRng } from '../engine/BlessingEngine.js';
import { scheduleReinforcementsForTurn } from '../engine/ReinforcementScheduler.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import {
  buildTutorialBattleConfig as _buildTutorialBattleConfig,
  buildTutorialRoster as _buildTutorialRoster,
} from '../engine/TutorialHelpers.js';
import { resetTransitionLocks, ensureSceneLoaded } from '../utils/sceneLoader.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { markStartup } from '../utils/startupTelemetry.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { showTransitionRecoveryPrompt } from '../ui/TransitionRecoveryPrompt.js';
import { BattleCameraController } from '../utils/BattleCameraController.js';
import { DeployScreenOverlay } from '../ui/DeployScreenOverlay.js';
import { ForecastOverlay } from '../ui/ForecastOverlay.js';
import { InputController } from '../ui/InputController.js';
import { LootFlowController } from '../ui/LootFlowController.js';
import { LootScreenController } from '../ui/LootScreenController.js';
import { PostCombatController } from '../ui/PostCombatController.js';
import { TransitionRecoveryController } from '../ui/TransitionRecoveryController.js';
import { VisionRewindController } from '../ui/VisionRewindController.js';
import { WeaponArtController } from '../ui/WeaponArtController.js';
import { consumeEscEvent, isEscConsumed } from '../utils/escPriority.js';
import {
  summarizeWeaponArtEffect,
  hasWeaponArt,
  getWeaponArtTooltipLines,
} from '../ui/WeaponArtVisibility.js';
import {
  selectBallistaTarget,
  resolveBallistaStrike,
  getBallistaRange,
  getBallistaDangerTiles,
  isBallistaTile,
} from '../engine/BallistaEngine.js';

function dimColor(color, factor = 0.3) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

const TIER5_BUFF_CORE_STATS = new Set(['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV']);
const TIER5_BUFF_COMBAT_MOD_BY_STAT = {
  HIT: 'hitBonus',
  CRIT: 'critBonus',
  AVOID: 'avoidBonus',
  ATK: 'atkBonus',
  DEF_BONUS: 'defBonus',
  RES_BONUS: 'resBonus',
  SPD_BONUS: 'spdBonus',
};
const PAUSE_TRANSITION_TIMEOUT_MS = 6000;
/** Reset per-battle state on a unit at deploy time. */
export function resetUnitForBattle(unit) {
  unit.hasMoved = false;
  unit.hasActed = false;
  unit._miracleUsed = false;
  unit._gambitUsedThisTurn = false;
  unit._conditions = [];
  for (const w of unit.inventory || []) {
    if (w.perBattleUses) w._usesSpent = 0;
  }
}

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
  }

  isDevToolsEnabled() {
    return DEBUG_MODE || this.registry.get('devToolsEnabled') === true;
  }

  init(data) {
    if (!data) {
      console.error('[BattleScene] init() called without data:', data);
      throw new Error('BattleScene requires data');
    }
    this.gameData = data.gameData || data;
    if (!this.gameData.skills) this.gameData.skills = [];
    this.runManager = data.runManager || null;
    this.battleParams = data.battleParams || { act: 'act1', objective: 'rout' };
    this.roster = data.roster || null;
    this.nodeId = data.nodeId || null;
    this.isBoss = data.isBoss || false;
    this.isElite = data.isElite || false;
    this.isTransitioningOut = false;
    this.visionSnapshot = null;
    this.pendingVisionSnapshot = null;
    this.visionDialog = null;
    this.visionBaseSeed = null;
    this._battleRandomRestore = null;
    this.isMobileInput = false;
    this.mobileCameraEnabled = false;
    this._battleCamera = null;
    this._cameraGestureTapSuppressed = false;
    this._uiCamera = null;
    this._pinnedUiObjects = new Set();
    this._cameraFilterDirty = false;
    this._lastChildrenCount = -1;
    this._displayListDirtyHandler = null;
    this._battleCanvasTouchActionPrev = null;
    this._scaleResizeHandler = null;
    this.inspectMode = false;
    this._touchHoldTimer = null;
    this._touchHoldStart = null;
    this._touchHoldTriggered = false;
    this.reinforcementTemplatePool = null;
    this.lastReinforcementSchedule = null;
    this.appliedHybridOverrideTurns = new Set();
    this.lastHybridOverrideResult = null;
    this._tutorialStrictGateReleased = !this.battleParams?.tutorialMode;
    this._tutorialBlockingPromptActive = false;
    this._tutorialEdricGuide = null;
    this._tutorialFortGuide = null;
    this._tutorialVisionIntroShown = false;
    this._storyDialogueActive = false;
    this._bossName = null;
    this._postLootTransitionStarted = false;
    this._postLootTransitionCompleted = false;
    this._postLootTransitionStartedAt = 0;
    this._postLootTransitionTimer = null;
    this._transitionAfterBattlePromise = null;
    this._levelUpSfxKey = null;
    this.pauseTransitionRecovery = null;
    this._sceneShutdownCleanupRegistered = false;
    this._sceneShutdownCleanedUp = false;
    this._gameplayKeyHandlers = null;
    this._devToggleKey = null;
    this._onDevToggleKeyDown = null;
    this._mobileHandlers = null;
    this._lootCleanupTimeout = null;
    this._managedSceneTimers = new Set();
    this._lifecycleAwaitGuards = new Set();
    this._reinforcementsPendingThisTurn = false;
    this.lootSettingsOverlay = null;
    this.lootRosterVisible = false;
    this.defeatRecoveryPrompt = null;
    this.victoryRecoveryPrompt = null;
    this.debugOverlay = null;
    this.lootGroup = null;
    this.pauseOverlay = null;
  }

  create() {
    this._registerSceneShutdownCleanup();

    // Determine deploy limits for this act (+ meta upgrade bonus)
    const act = this.battleParams.act || 'act1';
    const baseLimits = DEPLOY_LIMITS[act] || DEPLOY_LIMITS.act1;
    const deployBonus = this.runManager?.getDeployBonus?.() || 0;
    const limits = { min: baseLimits.min + deployBonus, max: baseLimits.max + deployBonus };

    if (!this.roster) {
      // Standalone mode -- no deploy screen
      this.beginBattle(null);
    } else if (this.roster.length <= limits.max) {
      // Small roster -- auto-deploy all
      this.beginBattle(this.roster);
    } else {
      // Roster exceeds max -- show deploy selection
      this.showDeployScreen(this.roster, limits, (selectedRoster) => {
        this.beginBattle(selectedRoster);
      });
    }

    // Opportunistic preload -- cache RunComplete chunk while player fights.
    // Errors swallowed; real recovery happens at transition time (Layer 1/2).
    ensureSceneLoaded(this, 'RunComplete').catch(() => {});
  }

  _registerSceneShutdownCleanup() {
    if (this._sceneShutdownCleanupRegistered) return;
    this._sceneShutdownCleanupRegistered = true;
    this.events.once('shutdown', () => this._runSceneShutdownCleanup());
  }

  _runSceneShutdownCleanup() {
    if (this._sceneShutdownCleanedUp) return;
    this._sceneShutdownCleanedUp = true;

    const audio = this.registry.get('audio');
    if (audio) audio.releaseMusic(this, 0);

    this._stopLevelUpSfx();
    this._clearTutorialGuideHighlights();
    this.cancelTouchInspectHold();
    this._hideMenuTooltip();
    this._restoreBattleRng();
    this._clearPostLootTransitionFallback();
    if (typeof this._clearManagedSceneTimers === 'function') this._clearManagedSceneTimers();
    if (typeof this._cancelLifecycleAwaits === 'function') {
      this._cancelLifecycleAwaits('scene_shutdown');
    }
    if (this._lootCleanupTimeout) {
      clearTimeout(this._lootCleanupTimeout);
      this._lootCleanupTimeout = null;
    }
    try {
      this.tweens?.killAll?.();
    } catch (_) {}
    try {
      this.time?.removeAllEvents?.();
    } catch (_) {}
    this._unbindGameplayKeyboardHandlers();

    if (this._deployOverlay) {
      this._deployOverlay._cleanup();
      this._deployOverlay = null;
    }

    this.hideForecast();
    this.closeVisionDialog();
    if (this._postCombatController) {
      this._postCombatController.destroy();
      this._postCombatController = null;
    }
    if (this._recoveryController) {
      this._recoveryController.destroy();
      this._recoveryController = null;
    }
    if (this._lootFlowController) {
      this._lootFlowController.destroy();
      this._lootFlowController = null;
    }
    if (this._weaponArtController) {
      this._weaponArtController.destroy();
      this._weaponArtController = null;
    }
    if (this._inputController) {
      this._inputController.destroy();
      this._inputController = null;
    }

    if (this.dialogueOverlay) {
      this.dialogueOverlay.destroy();
      this.dialogueOverlay = null;
    }

    if (this.pauseOverlay?.hideForTransition) this.pauseOverlay.hideForTransition();
    this.pauseOverlay = null;
    this.lootSettingsOverlay = null;
    this.debugOverlay = null;

    if (this._mobileHandlers) {
      const ge = this.game?.events;
      if (ge?.off) {
        for (const [action, handler] of Object.entries(this._mobileHandlers)) {
          ge.off(`mobile:${action}`, handler);
        }
      }
      this._mobileHandlers = null;
    }
    // Always reset mobile context on shutdown to prevent stale buttons surviving scene transition
    if (this.isMobileInput) {
      const ge = this.game?.events;
      if (ge?.emit) ge.emit('mobile:setContext', { context: 'none', resetStack: true });
    }

    this._teardownBattleCameraSystem();
  }

  _isSceneActiveForAsync() {
    return Boolean(this.scene?.isActive?.());
  }

  _trackManagedSceneTimer(timer) {
    if (!timer) return null;
    (this._managedSceneTimers ||= new Set()).add(timer);
    return timer;
  }

  _removeManagedSceneTimer(timer) {
    if (!timer || !this._managedSceneTimers) return;
    this._managedSceneTimers.delete(timer);
  }

  _clearManagedSceneTimers() {
    if (!this._managedSceneTimers || this._managedSceneTimers.size === 0) return;
    for (const timer of this._managedSceneTimers) {
      try {
        timer?.remove?.(false);
      } catch (_) {}
    }
    this._managedSceneTimers.clear();
  }

  _createLifecycleAwaitGuard({ label = 'battle_await', timeoutMs = 1500, onCancel = null } = {}) {
    let settled = false;
    let resolvePromise = null;
    let timeoutHandle = null;
    const guard = {
      label,
      resolve: null,
      cancel: null,
    };
    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      this._lifecycleAwaitGuards?.delete?.(guard);
    };
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    guard.resolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(value);
    };
    guard.cancel = (reason = 'cancelled') => {
      if (settled) return;
      if (typeof onCancel === 'function') {
        try {
          onCancel(reason);
        } catch (err) {
          reportAsyncError('battle_lifecycle_cancel_error', err, {
            label,
            reason,
            battleState: this.battleState || null,
          });
        }
      }
      guard.resolve();
    };
    (this._lifecycleAwaitGuards ||= new Set()).add(guard);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        reportAsyncError('battle_lifecycle_timeout', new Error('lifecycle await timeout'), {
          label,
          timeoutMs,
          battleState: this.battleState || null,
        });
        guard.cancel('timeout');
      }, timeoutMs);
      if (typeof timeoutHandle?.unref === 'function') timeoutHandle.unref();
    }
    return { promise, guard };
  }

  _cancelLifecycleAwaits(reason = 'cancelled') {
    if (!this._lifecycleAwaitGuards || this._lifecycleAwaitGuards.size === 0) return;
    for (const guard of [...this._lifecycleAwaitGuards]) {
      guard.cancel(reason);
    }
  }

  async _awaitSceneDelay(delayMs, { label = 'scene_delay', timeoutMs = null } = {}) {
    const safeDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    if (safeDelay <= 0 || !this._isSceneActiveForAsync()) return;
    let timer = null;
    const { promise, guard } = this._createLifecycleAwaitGuard({
      label,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : Math.max(500, safeDelay + 400),
      onCancel: () => {
        try {
          timer?.remove?.(false);
        } catch (_) {}
        this._removeManagedSceneTimer(timer);
      },
    });
    try {
      timer = this.time?.delayedCall?.(safeDelay, () => {
        this._removeManagedSceneTimer(timer);
        guard.resolve();
      });
      this._trackManagedSceneTimer(timer);
      if (!timer) guard.resolve();
    } catch (err) {
      this._removeManagedSceneTimer(timer);
      reportAsyncError('battle_delay_schedule_error', err, {
        label,
        delayMs: safeDelay,
        battleState: this.battleState || null,
      });
      guard.resolve();
    }
    await promise;
  }

  async _awaitSceneTween(
    tweenConfig,
    { label = 'scene_tween', timeoutMs = null, onCancel = null } = {},
  ) {
    if (!tweenConfig) return;
    if (!this._isSceneActiveForAsync()) {
      if (typeof onCancel === 'function') onCancel('inactive');
      return;
    }
    const duration = Number(tweenConfig.duration) || 0;
    const delay = Number(tweenConfig.delay) || 0;
    const hold = Number(tweenConfig.hold) || 0;
    const computedTimeout = Math.max(900, duration + delay + hold + 700);
    let tween = null;
    const { promise, guard } = this._createLifecycleAwaitGuard({
      label,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : computedTimeout,
      onCancel: (reason) => {
        if (typeof onCancel === 'function') onCancel(reason);
        try {
          if (tween?.remove) tween.remove();
          else tween?.stop?.();
        } catch (_) {}
      },
    });
    const wrappedConfig = { ...tweenConfig };
    const originalOnComplete = wrappedConfig.onComplete;
    const originalOnStop = wrappedConfig.onStop;
    wrappedConfig.onComplete = (...args) => {
      try {
        originalOnComplete?.(...args);
      } finally {
        guard.resolve();
      }
    };
    wrappedConfig.onStop = (...args) => {
      try {
        originalOnStop?.(...args);
      } finally {
        guard.resolve();
      }
    };
    try {
      tween = this.tweens?.add?.(wrappedConfig);
      if (!tween) guard.resolve();
    } catch (err) {
      reportAsyncError('battle_tween_schedule_error', err, {
        label,
        battleState: this.battleState || null,
      });
      guard.resolve();
    }
    await promise;
  }

  _scheduleSafeDelayedAsync(
    delayMs,
    label,
    callback,
    { phase = null, turn = null, onError = null } = {},
  ) {
    const safeDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    const run = async () => {
      if (!this._isSceneActiveForAsync()) return;
      try {
        await callback();
      } catch (err) {
        reportAsyncError('battle_delayed_async_error', err, {
          label,
          phase,
          turn,
          battleState: this.battleState || null,
        });
        if (typeof onError === 'function') {
          try {
            await onError(err);
          } catch (recoveryErr) {
            reportAsyncError('battle_delayed_async_recovery_error', recoveryErr, {
              label,
              phase,
              turn,
              battleState: this.battleState || null,
            });
          }
        }
      }
    };

    let timer = null;
    try {
      timer = this.time?.delayedCall?.(safeDelay, () => {
        this._removeManagedSceneTimer(timer);
        return run();
      });
      this._trackManagedSceneTimer(timer);
    } catch (err) {
      reportAsyncError('battle_delayed_async_schedule_error', err, {
        label,
        phase,
        turn,
        battleState: this.battleState || null,
      });
      return null;
    }
    return timer;
  }

  async _withTutorialHintState(fn) {
    const prevState = this.battleState;
    this.battleState = 'TUTORIAL_HINT';
    try {
      return await fn();
    } finally {
      if (this.battleState === 'TUTORIAL_HINT') {
        this.battleState = prevState;
      }
    }
  }

  _bindGameplayKeyboardHandlers() {
    const keyboard = this.input?.keyboard;
    if (!keyboard?.on) return;

    this._unbindGameplayKeyboardHandlers();

    this._gameplayKeyHandlers = {
      viewUnit: () => {
        if (this.isStoryInputLocked()) return;
        if (this.inspectionPanel.visible && this.inspectionPanel._unit) {
          this.openUnitDetailOverlay();
        }
      },
      forceEndTurn: () => {
        if (this.isStoryInputLocked()) return;
        this.forceEndTurn();
      },
      cancel: (event) => {
        if (event?.repeat) return;
        if (isEscConsumed(this, event)) return;
        if (this.isStoryInputLocked()) return;
        const handled = this.requestCancel();
        if (handled) consumeEscEvent(this, event);
      },
      rewindAndLootRoster: () => {
        if (this.isStoryInputLocked()) return;
        this.requestVisionRewind();
        // Loot roster toggle during BATTLE_END (click button shouldn't trigger this)
        if (this.battleState === 'BATTLE_END' && this.lootGroup && this.runManager) {
          if (this.lootRosterVisible) {
            this.hideLootRoster();
          } else {
            this._hideLootTooltip();
            this.showLootRoster();
          }
        }
        this.refreshEndTurnControl();
      },
      roster: () => {
        if (this.isStoryInputLocked()) return;
        this._onRosterClick();
      },
      danger: () => {
        if (this.isStoryInputLocked()) return;
        this._onDangerClick();
      },
      wait: () => {
        if (this.isStoryInputLocked()) return;
        if (this.battleState === 'CANTO_MOVING' && this.selectedUnit) {
          this.grid.clearHighlights();
          this.cantoRange = null;
          const unit = this.selectedUnit;
          this.dimUnit(unit);
          this.selectedUnit = null;
          this.battleState = 'PLAYER_IDLE';
          this.turnManager.unitActed(unit);
        }
      },
      previousForecastWeapon: () => {
        if (this.isStoryInputLocked()) return;
        if (this.unitDetailOverlay?.visible) return;
        this._cycleForecastWeapon(-1);
      },
      nextForecastWeapon: () => {
        if (this.isStoryInputLocked()) return;
        if (this.unitDetailOverlay?.visible) return;
        this._cycleForecastWeapon(1);
      },
    };

    keyboard.on('keydown-V', this._gameplayKeyHandlers.viewUnit);
    keyboard.on('keydown-E', this._gameplayKeyHandlers.forceEndTurn);
    keyboard.on('keydown-ESC', this._gameplayKeyHandlers.cancel);
    keyboard.on('keydown-R', this._gameplayKeyHandlers.rewindAndLootRoster);
    keyboard.on('keydown-O', this._gameplayKeyHandlers.roster);
    keyboard.on('keydown-D', this._gameplayKeyHandlers.danger);
    keyboard.on('keydown-W', this._gameplayKeyHandlers.wait);
    keyboard.on('keydown-LEFT', this._gameplayKeyHandlers.previousForecastWeapon);
    keyboard.on('keydown-RIGHT', this._gameplayKeyHandlers.nextForecastWeapon);
  }

  _unbindGameplayKeyboardHandlers() {
    const keyboard = this.input?.keyboard;
    if (keyboard?.off && this._gameplayKeyHandlers) {
      keyboard.off('keydown-V', this._gameplayKeyHandlers.viewUnit);
      keyboard.off('keydown-E', this._gameplayKeyHandlers.forceEndTurn);
      keyboard.off('keydown-ESC', this._gameplayKeyHandlers.cancel);
      keyboard.off('keydown-R', this._gameplayKeyHandlers.rewindAndLootRoster);
      keyboard.off('keydown-O', this._gameplayKeyHandlers.roster);
      keyboard.off('keydown-D', this._gameplayKeyHandlers.danger);
      keyboard.off('keydown-W', this._gameplayKeyHandlers.wait);
      keyboard.off('keydown-LEFT', this._gameplayKeyHandlers.previousForecastWeapon);
      keyboard.off('keydown-RIGHT', this._gameplayKeyHandlers.nextForecastWeapon);
    }
    this._gameplayKeyHandlers = null;

    if (this._devToggleKey?.off && this._onDevToggleKeyDown) {
      this._devToggleKey.off('down', this._onDevToggleKeyDown);
    }
    this._devToggleKey = null;
    this._onDevToggleKeyDown = null;
  }

  _bindDevToggleKey() {
    const key = this.input?.keyboard?.addKey?.(192);
    if (!key?.on) return;

    if (this._devToggleKey?.off && this._onDevToggleKeyDown) {
      this._devToggleKey.off('down', this._onDevToggleKeyDown);
    }

    this._devToggleKey = key;
    this._onDevToggleKeyDown = () => {
      if (this.battleState === 'COMBAT_RESOLVING' || this.battleState === 'DEPLOY_SELECTION')
        return;
      this.debugOverlay.toggle();
    };
    this._devToggleKey.on('down', this._onDevToggleKeyDown);
  }

  async beginBattle(deployedRoster) {
    try {
      const startupFlags = this.registry.get('startupFlags');
      this.isMobileInput = Boolean(startupFlags?.isMobile);
      const mobileCameraFlag =
        typeof startupFlags?.MOBILE_CAMERA_ENABLED === 'boolean'
          ? startupFlags.MOBILE_CAMERA_ENABLED
          : startupFlags?.mobileCameraEnabled;
      this.mobileCameraEnabled = Boolean(
        typeof mobileCameraFlag === 'boolean' ? mobileCameraFlag : this.isMobileInput,
      );
      this.inspectMode = false;
      this._playerDeathsThisBattle = 0;

      // Track non-deployed units for merging back on victory
      if (!this.battleParams?.tutorialMode && this.roster && deployedRoster) {
        const deployedNames = new Set(deployedRoster.map((u) => u.name));
        this.nonDeployedUnits = this.roster.filter((u) => !deployedNames.has(u.name));
      } else {
        this.nonDeployedUnits = [];
      }

      // Set deployCount for MapGenerator spawn generation
      const deployCount = this.battleParams?.tutorialMode
        ? 2
        : deployedRoster
          ? deployedRoster.length
          : 2;
      this.battleParams.deployCount = deployCount;
      this.battleParams.isBoss = !!this.isBoss;

      // Generate or reuse locked encounter for this node.
      if (this.battleParams?.tutorialMode) {
        this.battleConfig = this.buildTutorialBattleConfig();
      } else {
        const lockedConfig = this.runManager?.getLockedBattleConfig?.(this.nodeId);
        if (lockedConfig) {
          this.battleConfig = lockedConfig;
        } else {
          const battleSeed = Number.isFinite(this.battleParams?.battleSeed)
            ? this.battleParams.battleSeed
            : this.deriveBattleSeed();
          this.battleConfig = this.withBattleSeed(battleSeed, () =>
            generateBattle(this.battleParams, this.gameData),
          );
          this.runManager?.lockBattleConfig?.(this.nodeId, this.battleConfig);
        }
      }
      const bc = this.battleConfig;

      // Build the grid from generated map (with optional fog of war)
      const fogEnabled = this.battleParams.fogEnabled || false;
      this.grid = new Grid(
        this,
        bc.cols,
        bc.rows,
        this.gameData.terrain,
        bc.mapLayout,
        fogEnabled,
        bc.biome || null,
      );

      // Unit arrays
      this.playerUnits = [];
      this.enemyUnits = [];
      this.npcUnits = [];
      this.ballistas = (this.battleConfig?.ballistas || []).map((b) => ({ ...b }));
      this._zombieTombstones = [];

      // Input lockout to prevent menu clicks bleeding through to map
      this._uiClickBlocked = false;

      // Gold tracking for loot system
      this.goldEarned = 0;
      this._latePressureWarningShown = false;
      this._completionGoldAward = null;
      this._victoryPressureState = null;
      this.initializeAntiTurtleState();
      this.aiPhaseStatsHistory = [];
      this.lastEnemyPhaseAiStats = null;
      this.currentEnemyPhaseAiStats = null;
      this.initializeVisionState();
      this.installBattleRng();

      // Create player units.
      // tutorialMode is authoritative for tutorial composition/loadout.
      if (this.battleParams?.tutorialMode) {
        const tutorialRoster = this.buildTutorialRoster();
        for (let i = 0; i < tutorialRoster.length && i < bc.playerSpawns.length; i++) {
          const unit = tutorialRoster[i];
          unit.col = bc.playerSpawns[i].col;
          unit.row = bc.playerSpawns[i].row;
          resetUnitForBattle(unit);
          this.playerUnits.push(unit);
          this.addUnitGraphic(unit);
        }
      } else if (deployedRoster) {
        for (let i = 0; i < deployedRoster.length && i < bc.playerSpawns.length; i++) {
          const unit = deployedRoster[i];
          unit.col = bc.playerSpawns[i].col;
          unit.row = bc.playerSpawns[i].row;
          resetUnitForBattle(unit);
          this.playerUnits.push(unit);
          this.addUnitGraphic(unit);
        }
      } else {
        // Standalone fallback -- create lords directly
        const edric = this.gameData.lords.find((l) => l.name === 'Edric');
        const edricClass = this.gameData.classes.find((c) => c.name === edric.class);
        const playerUnit1 = createLordUnit(edric, edricClass, this.gameData.weapons);
        playerUnit1.col = bc.playerSpawns[0].col;
        playerUnit1.row = bc.playerSpawns[0].row;
        const steelSword = this.gameData.weapons.find((w) => w.name === 'Steel Sword');
        if (steelSword) addToInventory(playerUnit1, steelSword);
        const vulnerary = this.gameData.consumables.find((c) => c.name === 'Vulnerary');
        if (vulnerary) addToConsumables(playerUnit1, vulnerary);
        this.playerUnits.push(playerUnit1);
        this.addUnitGraphic(playerUnit1);

        const sera = this.gameData.lords.find((l) => l.name === 'Sera');
        const seraClass = this.gameData.classes.find((c) => c.name === sera.class);
        const playerUnit2 = createLordUnit(sera, seraClass, this.gameData.weapons);
        playerUnit2.col = bc.playerSpawns[1].col;
        playerUnit2.row = bc.playerSpawns[1].row;
        playerUnit2.proficiencies.push({ type: 'Staff', rank: 'Prof' });
        const healStaff = this.gameData.weapons.find((w) => w.name === 'Heal');
        if (healStaff) addToInventory(playerUnit2, healStaff);
        const vulnerary2 = this.gameData.consumables.find((c) => c.name === 'Vulnerary');
        if (vulnerary2) addToConsumables(playerUnit2, vulnerary2);
        this.playerUnits.push(playerUnit2);
        this.addUnitGraphic(playerUnit2);
      }

      // Create enemies from generated spawns
      for (const spawn of bc.enemySpawns) {
        this.addEnemyFromSpawn(spawn);
      }
      this._bossName = this._resolveBossDialogueName(
        this.enemyUnits.find((unit) => unit.isBoss)?.name || null,
      );

      // Spawn NPC for recruit battles
      if (bc.npcSpawn) {
        const npcSpawn = bc.npcSpawn;
        const recruitLevelBonus = this.runManager?.getRecruitLevelBonus?.() || 0;
        const teamAvgLevel = resolveTeamAverageLevel(this.playerUnits);
        const { dynamicPromotionLevel, promotedLevelTarget } = resolveRecruitScalingTargets(
          this.playerUnits,
        );
        const act = this.battleParams?.act || 'act1';
        const actPool = this.gameData?.enemies?.pools?.[act];
        const actMinLevel = actPool?.levelRange?.[0] || 1;
        const nodeTargetLevel = Math.max(
          actMinLevel,
          teamAvgLevel - (Math.random() < 0.5 ? 1 : 0) + recruitLevelBonus,
        );
        npcSpawn.level = nodeTargetLevel;

        // Lord roll: chance to spawn a lord (Kira/Voss) instead of a regular recruit
        let spawnedLord = false;
        const rosterForLordCheck = this.runManager?.roster || [];
        const fallenForLordCheck = this.runManager?.fallenUnits || [];
        const availLords = getAvailableLords(
          rosterForLordCheck,
          this.gameData.lords || [],
          fallenForLordCheck,
        );

        const metaEffects = this.runManager?.getEffectiveMetaEffects?.() || null;
        const promotionContext = {
          type: RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE,
          classesData: this.gameData.classes || [],
        };
        const lordChanceBonus = metaEffects?.lordRecruitChanceBonus || 0;
        const effectiveLordChance = Math.min(
          1,
          Math.max(0, RECRUIT_NODE_LORD_CHANCE + lordChanceBonus),
        );
        if (availLords.length > 0 && Math.random() < effectiveLordChance) {
          const lordDef = availLords[Math.floor(Math.random() * availLords.length)];
          const lordClassData = this.gameData.classes.find((c) => c.name === lordDef.class);
          const actRecruitPool = getRecruitPoolEntries(
            this.gameData.recruits,
            act,
            this.gameData.classes,
          );
          const recruitPoolClassData = actRecruitPool
            .map((entry) => this.gameData.classes.find((c) => c.name === entry.className))
            .find((c) => isPromotedRecruitSource(c, this.gameData.classes));
          const lordPromotedClassData =
            typeof lordDef?.promotedClass === 'string'
              ? this.gameData.classes.find((c) => c.name === lordDef.promotedClass)
              : null;
          const canPromoteLord = Boolean(
            lordPromotedClassData &&
            (lordDef?.promotionBonuses || lordPromotedClassData?.promotionBonuses),
          );
          const lordRoll =
            canPromoteLord && recruitPoolClassData
              ? rollRecruitPromotion(
                  promotionContext,
                  recruitPoolClassData,
                  metaEffects,
                  Math.random,
                )
              : { eligible: false, promote: false };
          if (lordClassData) {
            const npc = createBossLordUnit(
              lordDef,
              lordClassData,
              this.gameData.weapons,
              npcSpawn.level,
              metaEffects,
              {
                promoteLord: canPromoteLord && lordRoll.promote,
                classes: this.gameData.classes || [],
                skills: this.gameData.skills || [],
                dynamicPromotionLevel,
                promotedLevelTarget,
                baseLevelOverride: null,
              },
            );
            npc.faction = 'npc';
            npc.col = npcSpawn.col;
            npc.row = npcSpawn.row;
            this.npcUnits.push(npc);
            this.addUnitGraphic(npc);
            spawnedLord = true;
          }
        }

        if (!spawnedLord) {
          const npcClassData = this.gameData.classes.find((c) => c.name === npcSpawn.className);
          if (npcClassData) {
            const recruitStatBonuses = this.runManager?.metaEffects?.statBonuses || null;
            const recruitGrowthBonuses =
              this.runManager?.getEffectiveRecruitGrowthBonuses() || null;
            const recruitSkillPool = this.runManager?.metaEffects?.recruitRandomSkill
              ? RECRUIT_SKILL_POOL
              : null;

            let npc;
            if (npcClassData.tier === 'promoted') {
              const promotionRoll = rollRecruitPromotion(
                promotionContext,
                npcClassData,
                metaEffects,
                Math.random,
              );
              if (promotionRoll.eligible && promotionRoll.promote) {
                // Promoted recruit: create from base class, then promote.
                const baseClassData = this.gameData.classes.find(
                  (c) => c.name === npcClassData.promotesFrom,
                );
                if (baseClassData) {
                  const baseDef = {
                    ...npcSpawn,
                    className: baseClassData.name,
                    level: Math.min(npcSpawn.level, dynamicPromotionLevel, BASE_CLASS_LEVEL_CAP),
                  };
                  npc = createRecruitUnit(
                    baseDef,
                    baseClassData,
                    this.gameData.weapons,
                    recruitStatBonuses,
                    recruitGrowthBonuses,
                    recruitSkillPool,
                    this.gameData.classes,
                  );
                  for (const sid of getClassInnateSkills(
                    baseClassData.name,
                    this.gameData.skills,
                  )) {
                    learnSkill(npc, sid);
                  }
                  promoteUnit(
                    npc,
                    npcClassData,
                    npcClassData.promotionBonuses,
                    this.gameData.skills,
                  );
                  const promotedLevels = Math.max(0, promotedLevelTarget - 1);
                  for (let i = 0; i < promotedLevels; i++) {
                    const result = levelUp(npc);
                    if (result) {
                      npc.level = result.newLevel;
                      for (const stat of XP_STAT_NAMES) npc.stats[stat] += result.gains[stat];
                      npc.currentHP += result.gains.HP;
                    }
                  }
                  checkLevelUpSkills(npc, this.gameData.classes);
                } else {
                  // Safety fallback: create from promoted class directly rather than aborting battle load.
                  npc = createRecruitUnit(
                    npcSpawn,
                    npcClassData,
                    this.gameData.weapons,
                    recruitStatBonuses,
                    recruitGrowthBonuses,
                    recruitSkillPool,
                    this.gameData.classes,
                  );
                  console.warn(
                    'Promoted recruit missing base class mapping:',
                    npcClassData.name,
                    npcClassData.promotesFrom,
                  );
                }
              } else if (promotionRoll.eligible && !promotionRoll.promote) {
                const baseClassData = this.gameData.classes.find(
                  (c) => c.name === promotionRoll.baseClassName,
                );
                if (baseClassData) {
                  const baseDef = {
                    ...npcSpawn,
                    className: baseClassData.name,
                    level: getFailBaseLevel(npcSpawn.level, dynamicPromotionLevel),
                  };
                  npc = createRecruitUnit(
                    baseDef,
                    baseClassData,
                    this.gameData.weapons,
                    recruitStatBonuses,
                    recruitGrowthBonuses,
                    recruitSkillPool,
                    this.gameData.classes,
                  );
                  for (const sid of getClassInnateSkills(
                    baseClassData.name,
                    this.gameData.skills,
                  )) {
                    learnSkill(npc, sid);
                  }
                } else {
                  npc = createRecruitUnit(
                    npcSpawn,
                    npcClassData,
                    this.gameData.weapons,
                    recruitStatBonuses,
                    recruitGrowthBonuses,
                    recruitSkillPool,
                    this.gameData.classes,
                  );
                  console.warn(
                    'Promoted recruit roll fallback missing base class mapping:',
                    npcClassData.name,
                    promotionRoll.baseClassName,
                  );
                }
              } else {
                // Safety fallback: invalid promoted-source mapping uses direct class spawn.
                const baseDef = {
                  ...npcSpawn,
                  className: npcClassData.name,
                  level: Math.min(npcSpawn.level, BASE_CLASS_LEVEL_CAP),
                };
                npc = createRecruitUnit(
                  baseDef,
                  npcClassData,
                  this.gameData.weapons,
                  recruitStatBonuses,
                  recruitGrowthBonuses,
                  recruitSkillPool,
                  this.gameData.classes,
                );
                console.warn(
                  'Promoted recruit source not eligible for promotion roll:',
                  npcClassData.name,
                  npcClassData.promotesFrom,
                );
              }
            } else {
              npc = createRecruitUnit(
                npcSpawn,
                npcClassData,
                this.gameData.weapons,
                recruitStatBonuses,
                recruitGrowthBonuses,
                recruitSkillPool,
                this.gameData.classes,
              );
              // Assign base-class innate skills (e.g. Dancer gets 'dance')
              for (const sid of getClassInnateSkills(npcClassData.name, this.gameData.skills)) {
                learnSkill(npc, sid);
              }
            }

            const npcSpawnTier = npc.weapon?.tier || 'Iron';
            if (this.runManager?.metaEffects?.lethalArmoryTier) {
              grantLethalArmoryWeapon(
                npc,
                this.gameData.weapons,
                this.runManager.metaEffects.lethalArmoryTier,
              );
            }
            if (this.runManager?.metaEffects?.masterOfArms) {
              grantSecondaryWeapons(npc, this.gameData.weapons, npcSpawnTier);
            }
            if (this.runManager?.metaEffects?.recruitStartingVulnerary) {
              const vulnerary = this.gameData.consumables.find((c) => c.name === 'Vulnerary');
              if (vulnerary) addToConsumables(npc, vulnerary);
            }

            npc.col = npcSpawn.col;
            npc.row = npcSpawn.row;
            this.npcUnits.push(npc);
            this.addUnitGraphic(npc);
          }
        }
      }

      for (const unit of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
        unit._phoenixBroochUsed = false;
      }

      // Throne marker for Seize objective
      if (bc.objective === 'seize' && bc.thronePos) {
        const tp = this.grid.gridToPixel(bc.thronePos.col, bc.thronePos.row);
        this.add
          .text(tp.x, tp.y - 10, 'SEIZE', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#ffdd44',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(5);
      }

      // Calculate turn par (for turn bonus system)
      this.turnPar = null;
      this.turnBonusConfig = this.gameData.turnBonus;
      if (this.turnBonusConfig && this.battleConfig) {
        const mapParams = {
          cols: this.battleConfig.cols,
          rows: this.battleConfig.rows,
          enemyCount: this.enemyUnits.length,
          objective: this.battleConfig.objective,
          mapLayout: this.battleConfig.mapLayout,
          terrainData: this.gameData.terrain,
          parBonus: this.battleConfig.parBonus || 0,
        };
        this.turnPar = calculatePar(
          mapParams,
          this.turnBonusConfig,
          this.battleParams?.difficultyId,
        );
      }

      // Battle state machine
      this.battleState = 'PLAYER_IDLE';
      this.tutorialStep = this.battleParams.tutorialMode ? 0 : -1;
      this.selectedUnit = null;
      this.movementRange = null;
      this.preMoveLoc = null;
      this.attackTargets = [];
      this.healTargets = [];
      this.forecastTarget = null;
      this.forecastObjects = null;
      this._forecastWeaponArt = null;
      this._forecastGamblerLine = null;
      this.actionMenu = null;
      this.inEquipMenu = false;
      this.tradeMutatedThisSession = false;
      this._selectedWeaponArt = null;
      this._lastPathPreviewKey = null;
      this._touchTapDown = null;
      this._tapMoveThreshold = 12;
      this._touchHoldTimer = null;
      this._touchHoldStart = null;
      this._touchHoldTriggered = false;
      this._cameraGestureTapSuppressed = false;
      this._combatRollSession = null;

      this._setupBattleCameraSystem();

      // Turn manager
      this.turnManager = new TurnManager({
        onPhaseChange: (phase, turn) => this.onPhaseChange(phase, turn),
        onVictory: () => this.onVictory(),
        onDefeat: () => this.onDefeat(),
        checkBattleEnd: () => this.checkBattleEnd(),
      });
      this.turnManager.init(this.playerUnits, this.enemyUnits, this.npcUnits, bc.objective);

      // AI controller
      this.aiController = new AIController(this.grid, this.gameData, {
        objective: bc.objective,
        thronePos: bc.thronePos,
      });

      // Cursor highlight
      this.cursorHighlight = this.add
        .rectangle(0, 0, TILE_SIZE - 1, TILE_SIZE - 1, 0xffffff, 0.15)
        .setVisible(false)
        .setDepth(50);

      // Terrain/unit info (top-left)
      this.infoText = this.add
        .text(8, 8, '', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e0e0e0',
          backgroundColor: '#000000aa',
          padding: { x: 4, y: 2 },
        })
        .setDepth(100);

      // Objective display (top-right) -- dynamic
      this.objectiveText = this.add
        .text(this.cameras.main.width - 8, 8, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#ffdd44',
          backgroundColor: '#000000aa',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(1, 0)
        .setDepth(100);
      this.updateObjectiveText();

      // Turn counter (top-left corner, below info text)
      this.turnCounterText = this.add
        .text(8, 28, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#e0e0e0',
          backgroundColor: '#000000aa',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0, 0)
        .setDepth(100);

      // Par tooltip on hover (desktop only)
      this.turnCounterText.setInteractive({ useHandCursor: false });
      this.parTooltipText = this.add
        .text(8, 0, '', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#e0e0e0',
          backgroundColor: '#000000cc',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0, 0)
        .setDepth(140)
        .setVisible(false);
      this.turnCounterText.on('pointerover', () => {
        if (this.turnPar == null || !this.turnBonusConfig) return;
        const turn = this.getCurrentTurnNumber();
        const text = formatParTooltip(turn, this.turnPar, this.turnBonusConfig);
        if (!text) return;
        this.parTooltipText.setText(text);
        const tcY = this.turnCounterText.y + this.turnCounterText.height + 2;
        this.parTooltipText.setY(tcY);
        this.parTooltipText.setVisible(true);
      });
      this.turnCounterText.on('pointerout', () => {
        this.parTooltipText.setVisible(false);
      });

      this.updateTopLeftHudLayout();

      // Bottom command bar -- Row 1: clickable action buttons, Row 2: info text
      const hw = this.cameras.main.width / 2;
      const hh = this.cameras.main.height;
      const commandRowY = hh - 58;
      const helpRowY = hh - 40;
      const btnStyle = { fontFamily: 'monospace', fontSize: '11px', color: '#e0e0e0' };
      const makeButton = (x, label, handler) => {
        const btn = this.add
          .text(x, commandRowY, label, btnStyle)
          .setOrigin(0.5)
          .setDepth(101)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor('#ffdd44'));
        btn.on('pointerout', () => btn.setColor('#e0e0e0'));
        btn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          this._uiClickBlocked = true;
          handler();
        });
        return btn;
      };
      this.dangerButton = makeButton(hw - 140, '[D] Danger', () => this._onDangerClick());
      this.rosterButton = makeButton(hw, '[O] Roster', () => this._onRosterClick());
      this.endTurnButton = makeButton(hw + 140, '[E] End Turn', () => this.forceEndTurn());
      this.cancelButton = makeButton(this.cameras.main.width - 72, '[X] Cancel', () =>
        this.requestCancel({ allowPause: false }),
      );
      if (this.isMobileInput) {
        this.inspectButton = makeButton(72, '[Inspect: OFF]', () => this.toggleInspectMode());
      } else {
        this.inspectButton = null;
      }
      this.instructionText2 = this.add
        .text(
          hw,
          helpRowY,
          this.isMobileInput
            ? '[R] Vision  [Inspect]/long-press unit: Details  |  [X]/off-map tap: cancel'
            : '[R] Vision  [V] Right-click Unit: Details  |  ESC/[X]/off-map tap: cancel',
          { fontFamily: 'monospace', fontSize: '11px', color: '#9ed8ff' },
        )
        .setOrigin(0.5)
        .setDepth(100);

      // Hide in-canvas buttons on mobile (HTML overlay provides them)
      if (this.isMobileInput) {
        this.dangerButton.setVisible(false);
        this.rosterButton.setVisible(false);
        this.endTurnButton.setVisible(false);
        this.cancelButton.setVisible(false);
        if (this.inspectButton) this.inspectButton.setVisible(false);
        this.instructionText2.setVisible(false);
      }
      this._pinToScreen([
        this.infoText,
        this.objectiveText,
        this.turnCounterText,
        this.parTooltipText,
        this.dangerButton,
        this.rosterButton,
        this.endTurnButton,
        this.cancelButton,
        this.inspectButton,
        this.instructionText2,
      ]);

      // Tutorial skip button (bottom-right)
      if (this.battleParams.tutorialMode) {
        const cam = this.cameras.main;
        const skipBtn = this.add
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
          this._handleTutorialSkipRequested();
        });
        this._pinToScreen(skipBtn);
      }

      // Unit inspection tooltip (right-click shows name + "View Unit [V]")
      this.inspectionPanel = new UnitInspectionPanel(this);
      // Full unit detail overlay (V key or click tooltip)
      this.unitDetailOverlay = new UnitDetailOverlay(this, this.gameData);
      this.dialogueOverlay = new DialogueOverlay(this);

      // Danger zone overlay
      this.dangerZone = new DangerZoneOverlay(this, this.grid);
      this.dangerZoneCache = null;
      this.dangerZoneStale = true;

      // Disable browser context menu
      this.input.mouse.disableContextMenu();

      // Input handlers
      this.input.on('pointermove', (pointer) => this.onPointerMove(pointer));
      this.input.on('pointerdown', (pointer) => this.onPointerDown(pointer));
      this.input.on('pointerup', (pointer) => this.onPointerUp(pointer));
      this.input.on('pointerupoutside', (pointer) => this.onPointerUpOutside(pointer));
      this._bindGameplayKeyboardHandlers();

      // Mobile virtual control listeners
      if (this.isMobileInput) {
        const ge = this.game.events;
        this._mobileHandlers = {
          cancel: () => {
            if (this.isStoryInputLocked()) return;
            this.requestCancel({ allowPause: false });
          },
          menu: () => {
            if (this.isStoryInputLocked()) return;
            if (this.battleState === 'CANTO_MOVING' && this.selectedUnit) {
              this.grid.clearHighlights();
              this.cantoRange = null;
              const unit = this.selectedUnit;
              this.dimUnit(unit);
              this.selectedUnit = null;
              this.battleState = 'PLAYER_IDLE';
              this.turnManager.unitActed(unit);
              this.refreshEndTurnControl();
            } else {
              this.requestCancel();
            }
          },
          danger: () => {
            if (this.isStoryInputLocked()) return;
            this._onDangerClick();
          },
          roster: () => {
            if (this.isStoryInputLocked()) return;
            if (this.battleState === 'BATTLE_END' && this.lootGroup && this.runManager) {
              this._hideLootTooltip();
              if (this.lootRosterVisible) this.hideLootRoster();
              else this.showLootRoster();
            } else {
              this._onRosterClick();
            }
          },
          objective: () => {
            if (this.isStoryInputLocked()) return;
            this.requestVisionRewind();
          },
          inspect: () => {
            if (this.isStoryInputLocked()) return;
            this.toggleInspectMode();
          },
          endTurn: () => {
            if (this.isStoryInputLocked()) return;
            this.forceEndTurn();
          },
          prevWeapon: () => {
            if (this.isStoryInputLocked()) return;
            this._cycleForecastWeapon(-1);
          },
          nextWeapon: () => {
            if (this.isStoryInputLocked()) return;
            this._cycleForecastWeapon(1);
          },
          resetView: () => {
            if (this.isStoryInputLocked()) return;
            this.resetBattleCameraView();
          },
        };
        for (const [action, handler] of Object.entries(this._mobileHandlers)) {
          ge.on(`mobile:${action}`, handler);
        }
      }

      // Start battle music -- per-act tracks
      const audio = this.registry.get('audio');
      if (audio) {
        const act = this.battleParams?.act || 'act1';
        const key = this.isBoss ? getMusicKey('boss', act) : getMusicKey('battle', act);
        if (this.battleParams?.tutorialMode) {
          audio.releaseMusic(this, 0);
        }
        audio.playMusic(key, this, 800);
      }

      // Initial fog of war update
      if (this.grid.fogEnabled) {
        this.grid.updateFogOfWar(this.playerUnits);
        this.updateEnemyVisibility();
      }

      // D1: Recruit NPC fog hint marker -- pulsing "?" visible through fog
      this.recruitFogMarker = null;
      if (this.grid.fogEnabled && this.battleParams.isRecruitBattle && this.npcUnits.length > 0) {
        const npc = this.npcUnits[0];
        const npcPixel = this.grid.gridToPixel(npc.col, npc.row);
        this.recruitFogMarker = this.add
          .text(npcPixel.x, npcPixel.y, '?', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#ffdd44',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(4); // depth 4 = above fog (3) but below highlights (5)
        if (!this._isReducedEffects()) {
          this.tweens.add({
            targets: this.recruitFogMarker,
            alpha: { from: 0.4, to: 1.0 },
            duration: 1500,
            yoyo: true,
            repeat: -1,
          });
        }
      }

      // FOG OF WAR indicator
      if (this.grid.fogEnabled) {
        const fogLabel = this.add
          .text(8, this.cameras.main.height - 72, 'FOG OF WAR', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#ffaa44',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 },
          })
          .setDepth(100);
        this._pinToScreen(fogLabel);

        const hints = this.registry.get('hints');
        if (hints?.shouldShow('battle_fog')) {
          showMinorHint(this, 'Fog of War \u2014 enemies beyond vision range are hidden.');
        }
      }

      this.visionHudText = this.add
        .text(8, 48, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#9ed8ff',
          backgroundColor: '#000000aa',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0, 0)
        .setDepth(100);
      this._pinToScreen(this.visionHudText);
      this.updateVisionHud();

      if (this.mobileCameraEnabled) {
        const hints = this.registry.get('hints');
        if (hints?.shouldShow('battle_mobile_camera')) {
          showMinorHint(
            this,
            'Use two fingers to pan and pinch to zoom. Pinch out or tap Reset to restore view.',
          );
        }
      }

      // Debug overlay (dev-only)
      if (this.isDevToolsEnabled()) {
        this.debugOverlay = new DebugOverlay(this);
        this._bindDevToggleKey();
      }

      if (this.isBoss && this._bossName && this.runManager) {
        const bossName = this._resolveBossDialogueName(this._bossName);
        const dialogueKey = `boss_pre_${bossName}`;
        const entries = this.gameData?.dialogue?.bossEncounters?.[bossName]?.preBattle;
        try {
          await this._showStoryDialogueOnce(dialogueKey, entries);
        } catch (err) {
          console.warn('[BattleScene] boss pre-battle dialogue failed:', err);
        }
      }

      // Start the battle
      this.turnManager.startBattle();
      this.refreshEndTurnControl();
    } catch (err) {
      console.error('BattleScene.beginBattle failed:', err);
      const reason = String(err?.message || 'unknown_error').slice(0, 140);
      const cam = this.cameras.main;
      const toast = this.add
        .text(cam.centerX, cam.centerY, `Battle failed to load (${reason}). Returning to map...`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ff4444',
          backgroundColor: '#000000',
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5)
        .setDepth(999);
      this.time.delayedCall(2000, () => {
        toast.destroy();
        if (this.runManager) {
          void transitionToScene(
            this,
            'NodeMap',
            {
              gameData: this.gameData,
              runManager: this.runManager,
            },
            { reason: TRANSITION_REASONS.BACK },
          );
        } else {
          void transitionToScene(this, 'Title', undefined, { reason: TRANSITION_REASONS.BACK });
        }
      });
    }
  }

  deriveBattleSeed() {
    const runSeed = Number(this.runManager?.runSeed || 0) >>> 0;
    const nodePart = String(this.nodeId || this.battleParams?.act || 'battle');
    let h = 2166136261 >>> 0;
    const input = `${runSeed}:${nodePart}`;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  isStoryInputLocked() {
    return Boolean(this._storyDialogueActive || this.dialogueOverlay?.visible);
  }

  _resolveBossDialogueName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed === 'Dark Champion') return 'The Lieutenant';
    return trimmed;
  }

  async _showStorySequence(entries) {
    if (!Array.isArray(entries) || entries.length <= 0 || !this.dialogueOverlay) return;
    this._storyDialogueActive = true;
    try {
      await this.dialogueOverlay.showSequence(entries);
    } finally {
      this._storyDialogueActive = false;
      this.refreshEndTurnControl();
    }
  }

  async _showStoryDialogueOnce(dialogueKey, entries) {
    if (!this.runManager || typeof dialogueKey !== 'string' || !dialogueKey) return;
    if (this.runManager.hasShownDialogue(dialogueKey)) return;
    if (!Array.isArray(entries) || entries.length <= 0) return;
    this.runManager.markDialogueShown(dialogueKey);
    await this._showStorySequence(entries);
  }

  _clearPostLootTransitionFallback() {
    (this._lootFlowController ||= new LootFlowController(this))._clearPostLootTransitionFallback();
  }

  _startPostLootTransition() {
    (this._lootFlowController ||= new LootFlowController(this))._startPostLootTransition();
  }

  buildTutorialBattleConfig() {
    return _buildTutorialBattleConfig();
  }

  buildTutorialRoster() {
    return _buildTutorialRoster(this.gameData);
  }

  _isTutorialStrictGateActive() {
    const step = Number(this.tutorialStep);
    return Boolean(
      this.battleParams?.tutorialMode &&
      !this._tutorialStrictGateReleased &&
      Number.isFinite(step) &&
      step >= 2,
    );
  }

  _getTutorialEdricUnit() {
    if (!Array.isArray(this.playerUnits)) return null;
    return this.playerUnits.find((unit) => unit?.name === 'Edric') || null;
  }

  _getTutorialFortTile() {
    const mapLayout =
      this.battleConfig?.mapLayout ||
      this.grid?.mapLayout ||
      this.buildTutorialBattleConfig?.()?.mapLayout ||
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

  async _showTutorialBlockingInstruction(text) {
    if (this._tutorialBlockingPromptActive) return false;
    this._tutorialBlockingPromptActive = true;
    try {
      await this._withTutorialHintState(async () => {
        await showImportantHint(this, text);
      });
    } finally {
      this._tutorialBlockingPromptActive = false;
      this.refreshEndTurnControl();
    }
    return true;
  }

  _getVisionRewindIntroHint() {
    return this.isMobileInput
      ? 'Use the Eye button to spend 1 Vision and rewind the current turn if you want.\nYou do not have to use it.'
      : 'Use Eye [R] to spend 1 Vision and rewind the current turn if you want.\nYou do not have to use it.';
  }

  _setTutorialGuideHighlight(mode) {
    this._clearTutorialGuideHighlights();
    if (!this.battleParams?.tutorialMode || !this.grid || !this.add) return;
    const draw = (col, row, color) => {
      const pos = this.grid.gridToPixel(col, row);
      const marker = this.add
        .rectangle(pos.x, pos.y, TILE_SIZE - 2, TILE_SIZE - 2, 0x000000, 0)
        .setStrokeStyle(2, color, 1)
        .setDepth(52);
      if (!this._isReducedEffects()) {
        this.tweens.add({
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
      const edric = this._getTutorialEdricUnit();
      if (!edric) return;
      this._tutorialEdricGuide = draw(edric.col, edric.row, 0x4aa3ff);
      return;
    }
    if (mode === 'fort') {
      const fort = this._getTutorialFortTile();
      if (!fort) return;
      this._tutorialFortGuide = draw(fort.col, fort.row, 0xffdd44);
    }
  }

  _clearTutorialGuideHighlights() {
    if (this._tutorialEdricGuide?.destroy) this._tutorialEdricGuide.destroy();
    if (this._tutorialFortGuide?.destroy) this._tutorialFortGuide.destroy();
    this._tutorialEdricGuide = null;
    this._tutorialFortGuide = null;
  }

  _transitionTutorialToTitle() {
    const audio = this.registry.get('audio');
    if (audio) audio.releaseMusic(this, 0);
    return transitionToScene(
      this,
      'Title',
      { gameData: this.gameData },
      { reason: TRANSITION_REASONS.BACK },
    );
  }

  _handleTutorialSkipRequested() {
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('Skip tutorial and return to title?')
        : true;
    if (!confirmed) return false;
    void this._transitionTutorialToTitle();
    return true;
  }

  withBattleSeed(seed, fn) {
    const prevRandom = Math.random;
    const seeded = createSeededRng(seed >>> 0);
    Math.random = seeded;
    try {
      return fn();
    } finally {
      Math.random = prevRandom;
    }
  }

  installBattleRng() {
    const fallbackSeed = this.deriveBattleSeed();
    const currentSeed = Number.isFinite(this.runManager?.rngSeed)
      ? this.runManager.rngSeed >>> 0
      : fallbackSeed >>> 0;
    if (this.runManager) this.runManager.rngSeed = currentSeed;
    this.visionBaseSeed = currentSeed;
    const prevRandom = Math.random;
    Math.random = createSeededRng(currentSeed);
    this._battleRandomRestore = () => {
      Math.random = prevRandom;
      this._battleRandomRestore = null;
    };
  }

  _restoreBattleRng() {
    if (this._battleRandomRestore) this._battleRandomRestore();
  }

  reseedBattleRng(seed) {
    const resolved = Number(seed) >>> 0;
    if (this.runManager) this.runManager.rngSeed = resolved;
    Math.random = createSeededRng(resolved);
  }

  initializeVisionState() {
    this._visionController = new VisionRewindController(this, this.runManager);
    this._visionController.initialize();
  }

  getEnemyDifficultyConfig() {
    return {
      multiplier: this.battleParams.difficultyMod || 1.0,
      enemyStatBonus: Math.trunc(this.battleParams.enemyStatBonus || 0),
      enemyEquipTierShift: Math.trunc(this.battleParams.enemyEquipTierShift || 0),
    };
  }

  getReinforcementSeed() {
    const configuredSeed = this.battleParams?.battleSeed;
    if (Number.isFinite(configuredSeed)) return configuredSeed >>> 0;
    if (Number.isFinite(this.visionBaseSeed)) return this.visionBaseSeed >>> 0;
    return this.deriveBattleSeed() >>> 0;
  }

  getEnemySpawnFallbackLevel() {
    const nonBossLevels = (this.battleConfig?.enemySpawns || [])
      .filter((spawn) => spawn && !spawn.isBoss)
      .map((spawn) => Math.trunc(Number(spawn.level) || 0))
      .filter((level) => level > 0);
    if (nonBossLevels.length > 0) {
      const total = nonBossLevels.reduce((sum, level) => sum + level, 0);
      return Math.max(1, Math.round(total / nonBossLevels.length));
    }
    const byAct = { act1: 3, act2: 6, act3: 9, act4: 12, finalBoss: 14 };
    return byAct[this.battleParams?.act] || 3;
  }

  getReinforcementTemplatePool() {
    if (
      Array.isArray(this.reinforcementTemplatePool) &&
      this.reinforcementTemplatePool.length > 0
    ) {
      return this.reinforcementTemplatePool;
    }

    const templates = [];
    const seen = new Set();
    for (const spawn of this.battleConfig?.enemySpawns || []) {
      if (!spawn || spawn.isBoss || typeof spawn.className !== 'string') continue;
      const classData = this.gameData.classes.find(
        (candidate) => candidate.name === spawn.className,
      );
      if (!classData) continue;
      const level = Math.max(
        1,
        Math.trunc(Number(spawn.level) || this.getEnemySpawnFallbackLevel()),
      );
      const key = `${spawn.className}:${level}:${spawn.sunderWeapon ? 's' : 'n'}:${spawn.poisonWeapon ? 'p' : 'n'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      templates.push({
        className: spawn.className,
        level,
        sunderWeapon: Boolean(spawn.sunderWeapon),
        poisonWeapon: Boolean(spawn.poisonWeapon),
        aiMode: spawn.aiMode || null,
        affixes: Array.isArray(spawn.affixes) ? [...spawn.affixes] : [],
      });
    }

    if (templates.length === 0) {
      const fallbackLevel = this.getEnemySpawnFallbackLevel();
      const act = this.battleParams?.act || 'act1';
      const pool = this.gameData?.enemies?.pools?.[act];
      const classNames = [
        ...(Array.isArray(pool?.base) ? pool.base : []),
        ...(Array.isArray(pool?.promoted) ? pool.promoted : []),
      ];
      const filteredNames = filterClassPoolByDifficulty(
        classNames,
        this.battleParams?.difficultyId,
      );
      for (const className of filteredNames) {
        if (typeof className !== 'string') continue;
        const classData = this.gameData.classes.find((candidate) => candidate.name === className);
        if (!classData) continue;
        templates.push({
          className,
          level: fallbackLevel,
          sunderWeapon: false,
          poisonWeapon: false,
          aiMode: null,
          affixes: [],
        });
      }
    }

    this.reinforcementTemplatePool = templates;
    return templates;
  }

  normalizeEnemyRewardMultiplier(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(1, value));
  }

  getEnemyRewardMultiplier(enemyUnit) {
    if (!enemyUnit?._isReinforcement) return 1;
    const rewardMultiplier = Number.isFinite(enemyUnit._reinforcementRewardMultiplier)
      ? enemyUnit._reinforcementRewardMultiplier
      : enemyUnit._reinforcementXpMultiplier;
    return this.normalizeEnemyRewardMultiplier(rewardMultiplier);
  }

  getEnemyXpMultiplier(enemyUnit) {
    const rewardMultiplier = this.getEnemyRewardMultiplier(enemyUnit);
    const isSpecialEnemy = Boolean(enemyUnit?.isBoss || enemyUnit?.isElite);
    if (!isSpecialEnemy) return rewardMultiplier;
    return rewardMultiplier * XP_SPECIAL_ENEMY_MULTIPLIER;
  }

  _hashReinforcementTemplateChoice(spawn, spawnOrdinal = 0) {
    let hash = this.getReinforcementSeed() >>> 0;
    const waveIndex = Math.trunc(Number(spawn?.waveIndex) || 0) + 1;
    const col = Math.trunc(Number(spawn?.col) || 0) + 1;
    const row = Math.trunc(Number(spawn?.row) || 0) + 1;
    const ordinal = Math.trunc(Number(spawnOrdinal) || 0) + 1;
    hash ^= Math.imul(waveIndex, 0x9e3779b1);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash ^= Math.imul(col, 0xc2b2ae35);
    hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2d);
    hash ^= Math.imul(row, 0x165667b1);
    hash ^= Math.imul(ordinal, 0x1b873593);
    return (hash ^ (hash >>> 16)) >>> 0;
  }

  buildReinforcementSpawnSpec(scheduledSpawn, spawnOrdinal = 0) {
    const classOverride =
      scheduledSpawn && typeof scheduledSpawn.className === 'string'
        ? scheduledSpawn.className
        : null;

    let template = null;
    if (!classOverride) {
      const templates = this.getReinforcementTemplatePool();
      if (!Array.isArray(templates) || templates.length === 0) return null;
      const pickIndex =
        this._hashReinforcementTemplateChoice(scheduledSpawn, spawnOrdinal) % templates.length;
      template = templates[pickIndex];
      if (!template || typeof template.className !== 'string') return null;
    }

    const className = classOverride || template.className;
    const hasLevelOverride = Number.isFinite(scheduledSpawn?.level);
    const baseLevel = template ? template.level : this.getEnemySpawnFallbackLevel();
    return {
      className,
      level: Math.max(
        1,
        Math.trunc(
          Number(hasLevelOverride ? scheduledSpawn.level : baseLevel) ||
            this.getEnemySpawnFallbackLevel(),
        ),
      ),
      col: scheduledSpawn.col,
      row: scheduledSpawn.row,
      sunderWeapon:
        typeof scheduledSpawn?.sunderWeapon === 'boolean'
          ? scheduledSpawn.sunderWeapon
          : Boolean(template?.sunderWeapon),
      poisonWeapon:
        typeof scheduledSpawn?.poisonWeapon === 'boolean'
          ? scheduledSpawn.poisonWeapon
          : Boolean(template?.poisonWeapon),
      aiMode:
        typeof scheduledSpawn?.aiMode === 'string'
          ? scheduledSpawn.aiMode
          : template?.aiMode || null,
      affixes: Array.isArray(scheduledSpawn?.affixes)
        ? [...scheduledSpawn.affixes]
        : Array.isArray(template?.affixes)
          ? [...template.affixes]
          : [],
    };
  }

  addEnemyFromSpawn(spawn, options = {}) {
    if (!spawn || typeof spawn.className !== 'string') return null;
    const classData = this.gameData.classes.find((candidate) => candidate.name === spawn.className);
    if (!classData) return null;

    const spawnLevel = Math.max(
      1,
      Math.trunc(Number(spawn.level) || this.getEnemySpawnFallbackLevel()),
    );
    const difficultyConfig = this.getEnemyDifficultyConfig();

    let enemy;
    if (classData.tier === 'promoted') {
      enemy = createPromotedEnemyUnit(
        classData,
        spawnLevel,
        this.gameData.weapons,
        difficultyConfig,
        this.gameData.skills,
        this.battleParams.act,
        this.gameData.classes,
      );
    } else {
      enemy = createEnemyUnitFromClass(
        classData,
        spawnLevel,
        this.gameData.weapons,
        difficultyConfig,
        this.gameData.skills,
        this.battleParams.act,
      );
    }
    if (!enemy) return null;

    enemy.col = spawn.col;
    enemy.row = spawn.row;
    enemy._hitByPlayerThisPhase = false;
    enemy.isElite = Boolean(spawn.isElite || this.isElite);
    if (Array.isArray(spawn.affixes) && spawn.affixes.length > 0) {
      enemy.affixes = [...spawn.affixes];
      // Apply MOV bonus from passive affixes to authoritative stats.MOV at spawn
      const affixMovBonus = getAffixMovBonus(enemy.affixes, this.gameData.affixes);
      if (affixMovBonus !== 0) {
        enemy.stats.MOV = Math.max(1, (enemy.stats.MOV || 0) + affixMovBonus);
        enemy.mov = enemy.stats.MOV;
      }
    }
    if (spawn.isBoss) {
      enemy.isBoss = true;
      enemy.name = spawn.name || enemy.name;
      for (const stat of Object.keys(enemy.stats)) {
        enemy.stats[stat] += BOSS_STAT_BONUS;
      }
      enemy.currentHP = enemy.stats.HP;
    }
    if (spawn.isEntity) {
      enemy.isEntity = true;
      // Dual weapon assignment -- Entity gets both Eldritch Grasp and Twisting Vortex
      const entityWeapons = this.gameData.weapons
        .filter((w) => ENTITY_WEAPON_NAMES.includes(w.name))
        .map((w) => structuredClone(w));
      if (entityWeapons.length === 0) {
        console.warn('Entity spawn missing expected weapons:', ENTITY_WEAPON_NAMES);
      } else if (entityWeapons.length > 0) {
        enemy.inventory = entityWeapons;
        enemy.weapon = entityWeapons[0];
      }
    }
    if (spawn.sunderWeapon) {
      const primaryType = enemy.proficiencies?.[0]?.type;
      const sunderName = primaryType ? SUNDER_WEAPON_BY_TYPE[primaryType] : null;
      if (sunderName) {
        const sunderData = this.gameData.weapons.find((weapon) => weapon.name === sunderName);
        if (sunderData) {
          const sunderClone = structuredClone(sunderData);
          enemy.weapon = sunderClone;
          enemy.inventory = [sunderClone];
        }
      }
    } else if (spawn.poisonWeapon) {
      const primaryType = enemy.proficiencies?.[0]?.type;
      const poisonName = primaryType ? POISON_WEAPON_BY_TYPE[primaryType] : null;
      if (poisonName) {
        const poisonData = this.gameData.weapons.find((weapon) => weapon.name === poisonName);
        if (poisonData) {
          const poisonClone = structuredClone(poisonData);
          enemy.weapon = poisonClone;
          enemy.inventory = [poisonClone];
        }
      }
    }
    // Siege weapon assignment (enemy-only, replaces combat weapon)
    if (spawn.siegeWeapon) {
      const siegeData = this.gameData.weapons.find((w) => w.name === spawn.siegeWeapon);
      if (siegeData) {
        const siegeClone = structuredClone(siegeData);
        enemy.weapon = siegeClone;
        enemy.inventory = [siegeClone];
      }
    }
    // Status staff assignment (enemy-only, separate from combat weapon)
    if (spawn.statusStaff) {
      const staffName = spawn.statusStaff === 'sleep' ? 'Sleep Staff' : 'Silence Staff';
      const staffData = this.gameData.weapons.find((w) => w.name === staffName);
      if (staffData) {
        enemy.statusStaff = structuredClone(staffData);
      }
    }

    // Grant secondary weapons for multi-proficiency enemies on Hard/Lunatic
    if (!spawn.sunderWeapon && !spawn.poisonWeapon && !spawn.siegeWeapon && !spawn.isEntity) {
      const diffId = this.battleParams?.difficultyId;
      if (diffId === 'hard' || diffId === 'lunatic') {
        grantSecondaryWeapons(enemy, this.gameData.weapons, enemy.weapon?.tier || 'Iron');
      }
    }

    if (spawn.aiMode) enemy.aiMode = spawn.aiMode;

    const reinforcementMeta = options.reinforcementMeta || null;
    if (reinforcementMeta) {
      enemy._isReinforcement = true;
      enemy._reinforcementWaveIndex = Math.trunc(Number(reinforcementMeta.waveIndex) || 0);
      enemy._reinforcementSpawnTurn = Math.trunc(Number(reinforcementMeta.scheduledTurn) || 0);
      const rewardMultiplier = this.normalizeEnemyRewardMultiplier(
        Number(reinforcementMeta.xpMultiplier),
      );
      enemy._reinforcementRewardMultiplier = rewardMultiplier;
      // Backward compatibility for legacy field name.
      enemy._reinforcementXpMultiplier = rewardMultiplier;
    }

    this.enemyUnits.push(enemy);
    this.addUnitGraphic(enemy);
    return enemy;
  }

  getReinforcementOccupiedTiles() {
    const tiles = [];
    for (const unit of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      if (!unit || !Number.isFinite(unit.col) || !Number.isFinite(unit.row)) continue;
      if (isEntity(unit)) {
        for (const t of getFootprint(unit)) tiles.push(t);
      } else {
        tiles.push({ col: unit.col, row: unit.row });
      }
    }
    return tiles;
  }

  resolveReinforcementsForTurn(turn) {
    if (!this.battleConfig?.reinforcements) {
      return { spawns: [], dueWaves: [], blockedSpawns: 0 };
    }
    return scheduleReinforcementsForTurn({
      turn,
      seed: this.getReinforcementSeed(),
      reinforcements: this.battleConfig.reinforcements,
      mapLayout: this.battleConfig.mapLayout,
      terrain: this.gameData.terrain,
      occupied: this.getReinforcementOccupiedTiles(),
      difficultyId: this.battleParams?.difficultyId || this.runManager?.difficultyId || 'normal',
      difficultyTurnOffset: Math.trunc(Number(this.battleParams?.reinforcementTurnOffset) || 0),
      enemyCountBonus: Math.trunc(Number(this.battleParams?.enemyCountBonus) || 0),
    });
  }

  applyReinforcementsForTurn(turn) {
    const schedule = this.resolveReinforcementsForTurn(turn);
    this.lastReinforcementSchedule = schedule;
    if (!Array.isArray(schedule.spawns) || schedule.spawns.length === 0)
      return { ...schedule, spawned: 0 };

    let spawned = 0;
    const successfulWaveKeys = new Set();
    for (let i = 0; i < schedule.spawns.length; i++) {
      const scheduledSpawn = schedule.spawns[i];
      const spec = this.buildReinforcementSpawnSpec(scheduledSpawn, i);
      if (!spec) continue;
      const enemy = this.addEnemyFromSpawn(spec, { reinforcementMeta: scheduledSpawn });
      if (enemy) {
        spawned++;
        if (scheduledSpawn.waveIndex != null) {
          successfulWaveKeys.add(
            `${scheduledSpawn.waveType || 'procedural'}:${scheduledSpawn.waveIndex}`,
          );
        }
      }
    }

    if (spawned > 0) {
      this.dangerZoneStale = true;
      if (this.grid.fogEnabled) this.updateEnemyVisibility();
      this.updateObjectiveText();
      this.showReinforcementBanner(spawned);

      // Bump par for each wave that actually instantiated enemies
      if (Number.isFinite(this.turnPar) && successfulWaveKeys.size > 0) {
        this.turnPar += successfulWaveKeys.size;
      }
    }

    return { ...schedule, spawned };
  }

  applyDueHybridOverridesForTurn(turn) {
    const normalizedTurn = Math.trunc(Number(turn) || 0);
    const overrides = this.battleConfig?.phaseTerrainOverrides;
    if (normalizedTurn <= 0 || !Array.isArray(overrides) || overrides.length === 0) {
      const none = { turn: normalizedTurn, dueOverrides: 0, appliedOverrides: 0, changedTiles: 0 };
      this.lastHybridOverrideResult = none;
      return none;
    }

    if (!(this.appliedHybridOverrideTurns instanceof Set)) {
      this.appliedHybridOverrideTurns = new Set();
    }

    const dueOverrides = overrides.filter(
      (entry) =>
        Number.isInteger(entry?.turn) &&
        entry.turn === normalizedTurn &&
        !this.appliedHybridOverrideTurns.has(entry.turn),
    );
    if (dueOverrides.length === 0) {
      const none = { turn: normalizedTurn, dueOverrides: 0, appliedOverrides: 0, changedTiles: 0 };
      this.lastHybridOverrideResult = none;
      return none;
    }

    let changedTiles = 0;
    const anchors = this.battleConfig?.hybridAnchors || {};
    for (const entry of dueOverrides) {
      if (!Array.isArray(entry?.setTiles)) continue;
      for (const setTile of entry.setTiles) {
        const target = Array.isArray(setTile?.coord)
          ? { col: setTile.coord[0], row: setTile.coord[1] }
          : anchors?.[setTile?.anchor];
        if (!target || !Number.isInteger(target.col) || !Number.isInteger(target.row)) continue;
        const terrainIndex = this.gameData.terrain.findIndex(
          (terrain) => terrain?.name === setTile?.terrain,
        );
        if (terrainIndex < 0) continue;
        const didSet = this.grid?.setTerrainAt?.(target.col, target.row, terrainIndex);
        if (didSet) changedTiles++;
      }
      this.appliedHybridOverrideTurns.add(entry.turn);
    }

    if (changedTiles > 0) {
      this.dangerZoneStale = true;
      if (this.grid?.fogEnabled) this.updateEnemyVisibility();
      this.updateObjectiveText();
    }

    const result = {
      turn: normalizedTurn,
      dueOverrides: dueOverrides.length,
      appliedOverrides: dueOverrides.length,
      changedTiles,
    };
    this.lastHybridOverrideResult = result;
    return result;
  }

  showReinforcementBanner(spawnedCount) {
    if (!Number.isFinite(spawnedCount) || spawnedCount <= 0) return;
    const label =
      spawnedCount === 1 ? 'Reinforcement arrives!' : `${spawnedCount} reinforcements arrive!`;
    const banner = this.add
      .text(this.cameras.main.centerX, 38, label, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffbb55',
        backgroundColor: '#000000dd',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(520)
      .setAlpha(0);
    this._pinToScreen(banner);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 180,
      yoyo: true,
      hold: 700,
      onComplete: () => banner.destroy(),
    });
  }

  getVisionChargesRemaining() {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).getChargesRemaining();
  }

  // -- Vision Rewind shims (delegated to VisionRewindController) --

  captureVisionSnapshot() {
    (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).captureSnapshot();
  }

  activatePendingVisionSnapshot() {
    (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    ))._activatePendingSnapshot();
  }

  commitVisionSnapshotIfPending() {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).commitSnapshotIfPending();
  }

  applyVisionSnapshot() {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    ))._applySnapshot();
  }

  playVisionRewindEffect() {
    (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).playRewindEffect();
  }

  canUseVisionNow() {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).canUseNow();
  }

  requestVisionRewind({ force = false } = {}) {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).requestRewind({ force });
  }

  showLordDeathVisionPrompt() {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).showLordDeathPrompt();
  }

  showVisionDialog(opts) {
    (this._visionController ||= new VisionRewindController(this, this.runManager)).showDialog(opts);
  }

  confirmVisionDialog() {
    (this._visionController ||= new VisionRewindController(this, this.runManager)).confirmDialog();
  }

  cancelVisionDialog() {
    (this._visionController ||= new VisionRewindController(this, this.runManager)).cancelDialog();
  }

  closeVisionDialog() {
    if (this._visionController) {
      this._visionController.closeDialog();
    } else if (this.visionDialog) {
      for (const obj of this.visionDialog.group) obj.destroy();
      this.visionDialog = null;
    }
  }

  executeVisionRewind() {
    return (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    )).executeRewind();
  }

  initializeAntiTurtleState() {
    this.antiTurtleState = {
      noProgressTurns: 0,
      aggressiveMode: false,
      turnEnrageActive: false,
      bestEnemyCount: this.enemyUnits.length,
      bestLordThroneDistance: this.getBestLordThroneDistance(),
    };
  }

  getBestLordThroneDistance() {
    if (this.battleConfig?.objective !== 'seize' || !this.battleConfig?.thronePos) return Infinity;
    const lords = (this.playerUnits || []).filter((u) => u.isLord && u.currentHP > 0);
    if (!lords.length) return Infinity;
    const throne = this.battleConfig.thronePos;
    return Math.min(...lords.map((u) => gridDistance(u.col, u.row, throne.col, throne.row)));
  }

  getCurrentTurnNumber(turnOverride = null) {
    if (Number.isFinite(turnOverride)) return Math.max(0, Math.trunc(turnOverride));
    return Math.max(0, Math.trunc(Number(this.turnManager?.turnNumber) || 0));
  }

  getTurnPressureState(turnOverride = null) {
    const turn = this.getCurrentTurnNumber(turnOverride);
    return getLatePressureState(turn, this.turnPar, this.turnBonusConfig);
  }

  formatPressureMultiplier(value) {
    const safe = Number.isFinite(value) ? value : 1;
    return `x${safe.toFixed(2)}`;
  }

  getTurnPressureSummary(turnOverride = null) {
    const pressure = this.getTurnPressureState(turnOverride);
    if (!pressure.active) return '';
    return ` | Pressure: XP ${this.formatPressureMultiplier(pressure.xpMultiplier)} Gold ${this.formatPressureMultiplier(pressure.goldMultiplier)}`;
  }

  updateAntiTurtlePressure(turnOverride = null) {
    if (!this.antiTurtleState) return;
    const enemyCount = this.enemyUnits.length;
    const lordThroneDist = this.getBestLordThroneDistance();
    const enemyProgress = enemyCount < this.antiTurtleState.bestEnemyCount;
    const seizeProgress = lordThroneDist < this.antiTurtleState.bestLordThroneDistance;
    const progressed = enemyProgress || seizeProgress;

    if (progressed) {
      this.antiTurtleState.noProgressTurns = 0;
      this.antiTurtleState.bestEnemyCount = Math.min(
        this.antiTurtleState.bestEnemyCount,
        enemyCount,
      );
      this.antiTurtleState.bestLordThroneDistance = Math.min(
        this.antiTurtleState.bestLordThroneDistance,
        lordThroneDist,
      );
    } else {
      this.antiTurtleState.noProgressTurns++;
    }

    const currentTurn = this.getCurrentTurnNumber(turnOverride);
    const hasLivingBoss = this.enemyUnits.some((u) => u?.isBoss && u.currentHP > 0);
    const turnEnrageActive =
      hasLivingBoss && isBossEnrageActive(currentTurn, this.turnPar, this.turnBonusConfig);
    const shouldAggro =
      this.antiTurtleState.noProgressTurns >= ANTI_TURTLE_NO_PROGRESS_TURNS || turnEnrageActive;
    this.antiTurtleState.aggressiveMode = shouldAggro;
    this.antiTurtleState.turnEnrageActive = turnEnrageActive;
    this.aiController?.setAggressiveMode?.(shouldAggro);
  }

  createEnemyPhaseAiStats() {
    return {
      turn: this.turnManager?.turnNumber || 0,
      enemyCountAtStart: this.enemyUnits.length,
      byReason: {},
      noPathUnits: [],
    };
  }

  recordEnemyAiDecision(enemy, decision) {
    if (!this.currentEnemyPhaseAiStats) return;
    const reason = decision?.reason || 'unknown';
    const bucket = this.currentEnemyPhaseAiStats.byReason;
    bucket[reason] = (bucket[reason] || 0) + 1;

    if (reason === 'no_reachable_move') {
      this.currentEnemyPhaseAiStats.noPathUnits.push({
        name: enemy.name || null,
        className: enemy.className || null,
        col: enemy.col,
        row: enemy.row,
        detail: decision?.detail || null,
      });
    }
  }

  finalizeEnemyPhaseAiStats() {
    if (!this.currentEnemyPhaseAiStats) return;
    this.lastEnemyPhaseAiStats = this.currentEnemyPhaseAiStats;
    this.aiPhaseStatsHistory.push(this.currentEnemyPhaseAiStats);
    if (this.aiPhaseStatsHistory.length > 20) this.aiPhaseStatsHistory.shift();

    const noPathCount = this.currentEnemyPhaseAiStats.byReason.no_reachable_move || 0;
    if (noPathCount > 0) {
      console.warn('[AI] Enemy phase summary (no-path detected)', this.currentEnemyPhaseAiStats);
    } else if (this.isDevToolsEnabled()) {
      console.debug('[AI] Enemy phase summary', this.currentEnemyPhaseAiStats);
    }
    this.currentEnemyPhaseAiStats = null;
  }

  resetFortHealStreak(unit) {
    if (unit) unit._fortHealStreak = 0;
  }

  // --- Deploy selection screen ---

  showDeployScreen(roster, limits, onConfirm, initialSelectedNames = null) {
    this.battleState = 'DEPLOY_SELECTION';
    const overlay = new DeployScreenOverlay(this, this.runManager, this.gameData);
    this._deployOverlay = overlay;
    overlay.show(roster, limits, onConfirm, initialSelectedNames);
  }

  // --- Unit rendering ---

  getSpriteKey(unit) {
    const classKey = unit.className.toLowerCase().replace(/ /g, '_');
    if (unit.faction === 'enemy') {
      const defaultEnemySpriteKey = `enemy_${classKey}`;
      if (unit.isBoss && unit.name === 'The Emperor' && this.textures?.exists?.('enemy_emperor')) {
        return 'enemy_emperor';
      }
      return defaultEnemySpriteKey;
    }
    // Lords: Edric has tier-specific sprites; others use name-based lookup
    if (unit.isLord) {
      if (unit.name === 'Edric') {
        const edricKey = unit.tier === 'promoted' ? 'greatlordedric' : 'lordedric';
        if (this.textures.exists(edricKey)) return edricKey;
      }
      const lordKey = unit.name.toLowerCase();
      if (this.textures.exists(lordKey)) return lordKey;
    }
    // NPCs use player sprites (same as non-lord player units)
    return classKey;
  }

  getWeaponSFX(unit) {
    const weapon = unit.weapon;
    if (!weapon) return 'sfx_hit';
    switch (weapon.type) {
      case 'Sword':
        return 'sfx_sword';
      case 'Lance':
        return 'sfx_lance';
      case 'Axe':
        return 'sfx_axe';
      case 'Bow':
        return 'sfx_bow';
      case 'Staff':
        return 'sfx_heal';
      case 'Tome':
        if (weapon.name.includes('Fire') || weapon.name.includes('Bolganone')) return 'sfx_fire';
        if (weapon.name.includes('Thunder') || weapon.name.includes('Lightning'))
          return 'sfx_thunder';
        if (weapon.name.includes('Excalibur')) return 'sfx_ice';
        return 'sfx_fire';
      case 'Light':
        return 'sfx_light';
      case 'Breath':
        return 'sfx_fire';
      default:
        return 'sfx_hit';
    }
  }

  addUnitGraphic(unit) {
    const color = FACTION_COLORS[unit.faction];

    // Entity: 3x3 footprint, center graphic on middle tile
    if (isEntity(unit)) {
      const center = getEntityCenter(unit);
      const cPos = this.grid.gridToPixel(center.col, center.row);
      const entitySize = TILE_SIZE * ENTITY_FOOTPRINT.width;
      const spriteKey = this.getSpriteKey(unit);
      if (this.textures.exists(spriteKey)) {
        unit.graphic = this.add.image(cPos.x, cPos.y, spriteKey);
        unit.graphic.setDisplaySize(entitySize - 4, entitySize - 4);
        unit.label = null;
      } else {
        unit.graphic = this.add.rectangle(cPos.x, cPos.y, entitySize - 4, entitySize - 4, 0x440066);
        unit.label = this.add
          .text(cPos.x, cPos.y, 'E', {
            fontFamily: 'monospace',
            fontSize: '24px',
            color: '#cc88ff',
          })
          .setOrigin(0.5)
          .setDepth(11);
      }
      unit.graphic.setDepth(10);
      const ringY = cPos.y + entitySize / 2 - 10;
      unit.factionIndicator = this.add
        .ellipse(cPos.x, ringY, entitySize - 8, 14, 0x000000, 0)
        .setStrokeStyle(2, color, 0.7)
        .setDepth(8);
      const barWidth = entitySize - 8;
      const barHeight = 4;
      const barY = cPos.y + entitySize / 2 - 4;
      unit.hpBar = {
        bg: this.add
          .rectangle(cPos.x, barY, barWidth, barHeight, dimColor(color, 0.3))
          .setDepth(12),
        fill: this.add
          .rectangle(cPos.x, barY, barWidth, barHeight, 0xcc4444)
          .setOrigin(0.5)
          .setDepth(13),
      };
      this.updateHPBar(unit);
      unit.affixPips = [];
      this.updateAffixPips(unit);
      return;
    }

    const pos = this.grid.gridToPixel(unit.col, unit.row);

    // Try sprite first, fall back to colored rectangle
    const spriteKey = this.getSpriteKey(unit);
    if (this.textures.exists(spriteKey)) {
      unit.graphic = this.add.image(pos.x, pos.y, spriteKey);
      unit.graphic.setDisplaySize(TILE_SIZE - 2, TILE_SIZE - 2);
      unit.label = null;
    } else {
      unit.graphic = this.add.rectangle(pos.x, pos.y, TILE_SIZE - 4, TILE_SIZE - 4, color);
      unit.label = this.add
        .text(pos.x, pos.y, unit.name[0], {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(11);
    }
    unit.graphic.setDepth(10);

    // Faction indicator ring (blue=player, red=enemy, green=npc)
    const ringY = pos.y + 6;
    unit.factionIndicator = this.add
      .ellipse(pos.x, ringY, 24, 12, 0x000000, 0)
      .setStrokeStyle(2, color, 0.7)
      .setDepth(8);

    // HP bar
    const barWidth = TILE_SIZE - 6;
    const barHeight = 3;
    const barX = pos.x - barWidth / 2;
    const barY = pos.y + TILE_SIZE / 2 - 4;
    unit.hpBar = {
      bg: this.add.rectangle(pos.x, barY, barWidth, barHeight, dimColor(color, 0.3)).setDepth(12),
      fill: this.add
        .rectangle(
          barX + barWidth / 2,
          barY,
          barWidth,
          barHeight,
          unit.faction === 'enemy' ? 0xcc4444 : 0x44cc44,
        )
        .setOrigin(0.5)
        .setDepth(13),
    };
    this.updateHPBar(unit);

    // Affix pips
    unit.affixPips = [];
    this.updateAffixPips(unit);
  }

  updateAffixPips(unit) {
    if (unit.affixPips) {
      unit.affixPips.forEach((p) => p.destroy());
    }
    unit.affixPips = [];
    if (!unit.affixes || unit.affixes.length === 0) return;

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const pipY = pos.y - TILE_SIZE / 2 + 4;
    const pipSize = 4;
    const gap = 2;
    const totalW = pipSize * unit.affixes.length + gap * (unit.affixes.length - 1);
    let startX = pos.x - totalW / 2 + pipSize / 2;

    for (const affixId of unit.affixes) {
      const affix = this.gameData.affixes?.affixes?.find((a) => a.id === affixId);
      const tier = affix?.tier || 1;
      const color = tier === 2 ? 0xff4444 : 0xffdd44;
      const pip = this.add
        .rectangle(startX, pipY, pipSize, pipSize, color)
        .setStrokeStyle(1, 0x000000)
        .setDepth(14);
      unit.affixPips.push(pip);
      startX += pipSize + gap;
    }
  }

  updateUnitPosition(unit) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    unit.graphic.setPosition(pos.x, pos.y);
    if (unit.label) unit.label.setPosition(pos.x, pos.y);
    if (unit.factionIndicator) unit.factionIndicator.setPosition(pos.x, pos.y + 6);
    this.updateHPBar(unit);
    this.updateAffixPips(unit);
    this._updateConditionIconPositions(unit);
  }

  updateHPBar(unit) {
    let pos, barWidth, barHeight;
    if (isEntity(unit)) {
      const center = getEntityCenter(unit);
      pos = this.grid.gridToPixel(center.col, center.row);
      barWidth = TILE_SIZE * ENTITY_FOOTPRINT.width - 8;
      barHeight = 4;
    } else {
      pos = this.grid.gridToPixel(unit.col, unit.row);
      barWidth = TILE_SIZE - 6;
      barHeight = 3;
    }
    const entityH = isEntity(unit) ? TILE_SIZE * ENTITY_FOOTPRINT.height : TILE_SIZE;
    const barY = pos.y + entityH / 2 - 4;
    const ratio = Math.max(0, unit.currentHP / unit.stats.HP);
    const fillWidth = barWidth * ratio;

    unit.hpBar.bg.setPosition(pos.x, barY);
    unit.hpBar.fill.setPosition(pos.x - barWidth / 2 + fillWidth / 2, barY);
    unit.hpBar.fill.setSize(fillWidth, barHeight);
    unit.hpBar.fill.setFillStyle(getHPBarColor(ratio));
  }

  removeUnitGraphic(unit) {
    if (unit.graphic) {
      unit.graphic.destroy();
      unit.graphic = null;
    }
    if (unit.label) {
      unit.label.destroy();
      unit.label = null;
    }
    if (unit.factionIndicator) {
      unit.factionIndicator.destroy();
      unit.factionIndicator = null;
    }
    if (unit.hpBar) {
      if (unit.hpBar.bg) unit.hpBar.bg.destroy();
      if (unit.hpBar.fill) unit.hpBar.fill.destroy();
      unit.hpBar = null;
    }
    if (unit.affixPips) {
      unit.affixPips.forEach((p) => p.destroy());
      unit.affixPips = [];
    }
    this._removeAllConditionIcons(unit);
  }

  dimUnit(unit) {
    if (unit.graphic && unit.graphic.setTint) {
      unit.graphic.setTint(0x888888);
    }
    if (unit.label) unit.label.setAlpha(0.5);
    if (unit.factionIndicator) unit.factionIndicator.setAlpha(0.5);
    if (unit.affixPips) {
      unit.affixPips.forEach((p) => p.setAlpha(0.5));
    }
  }

  undimUnit(unit) {
    if (unit.graphic && unit.graphic.clearTint) {
      unit.graphic.clearTint();
    }
    if (unit.label) unit.label.setAlpha(1);
    if (unit.factionIndicator) unit.factionIndicator.setAlpha(1);
    if (unit.affixPips) {
      unit.affixPips.forEach((p) => p.setAlpha(1));
    }
  }

  // --- Position tracking ---

  getUnitAt(col, row) {
    const all = [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits];
    return (
      all.find((u) => {
        if (!u || u.currentHP <= 0 || u._removing) return false;
        if (isEntity(u)) return getFootprintKeys(u).includes(`${col},${row}`);
        return u.col === col && u.row === row;
      }) || null
    );
  }

  buildUnitPositionMap(moverFaction) {
    const map = new Map();
    for (const u of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      if (!u || u._removing || u.currentHP <= 0) continue;
      if (isEntity(u)) {
        for (const tile of getFootprint(u)) {
          map.set(`${tile.col},${tile.row}`, { faction: u.faction });
        }
      } else {
        map.set(`${u.col},${u.row}`, { faction: u.faction });
      }
    }
    return map;
  }

  buildOccupiedSet(excludeUnit = null) {
    const occupied = new Set();
    for (const unit of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      if (!unit || unit === excludeUnit || unit._removing || unit.currentHP <= 0) continue;
      if (isEntity(unit)) {
        for (const tile of getFootprint(unit)) {
          occupied.add(`${tile.col},${tile.row}`);
        }
      } else {
        occupied.add(`${unit.col},${unit.row}`);
      }
    }
    return occupied;
  }

  /** Get terrain cost reduction for a unit from passive skills (e.g. Pathfinder). */
  _getCostModifier(unit) {
    return getTerrainCostReduction(unit, this.gameData?.skills);
  }

  calculatePathMovementCost(path, moveType, endStepIndex = path.length - 1, costModifier = 0) {
    if (!Array.isArray(path) || path.length < 2) return 0;
    let cost = 0;
    for (let i = 1; i <= endStepIndex && i < path.length; i++) {
      const stepCost = this.grid.getMoveCost(path[i].col, path[i].row, moveType, costModifier);
      if (!Number.isFinite(stepCost)) break;
      cost += stepCost;
    }
    return cost;
  }

  // --- Pointer / click handling ---

  _isTouchPointer(pointer) {
    return isTouchPointer(pointer);
  }

  onPointerMove(pointer) {
    (this._inputController ||= new InputController(this)).onPointerMove(pointer);
  }

  onPointerDown(pointer) {
    (this._inputController ||= new InputController(this)).onPointerDown(pointer);
  }

  onPointerUpOutside(pointer) {
    (this._inputController ||= new InputController(this)).onPointerUpOutside(pointer);
  }

  startTouchInspectHold(pointer) {
    (this._inputController ||= new InputController(this)).startTouchInspectHold(pointer);
  }

  updateTouchInspectHold(pointer) {
    (this._inputController ||= new InputController(this)).updateTouchInspectHold(pointer);
  }

  cancelTouchInspectHold() {
    (this._inputController ||= new InputController(this)).cancelTouchInspectHold();
  }

  clearInspectionVisuals() {
    (this._inputController ||= new InputController(this)).clearInspectionVisuals();
  }

  _showInspectionAtPixel(px, py) {
    return (this._inputController ||= new InputController(this))._showInspectionAtPixel(px, py);
  }

  toggleInspectMode() {
    (this._inputController ||= new InputController(this)).toggleInspectMode();
  }

  handleInspectModeTap(pointer, px, py) {
    return (this._inputController ||= new InputController(this)).handleInspectModeTap(
      pointer,
      px,
      py,
    );
  }

  updateTopLeftHudLayout() {
    (this._inputController ||= new InputController(this)).updateTopLeftHudLayout();
  }

  updateVisionHud() {
    (this._visionController ||= new VisionRewindController(this, this.runManager)).updateHud();
  }

  update() {
    if (!this._uiCamera) return;
    const childCount = this.children?.list?.length || 0;
    if (!this._cameraFilterDirty && childCount === this._lastChildrenCount) return;
    this._syncPinnedUiCameraFilters();
  }

  _getBattleMapBounds() {
    if (!this.grid) return null;
    return {
      left: this.grid.offsetX,
      top: this.grid.offsetY,
      width: this.grid.cols * TILE_SIZE,
      height: this.grid.rows * TILE_SIZE,
    };
  }

  _setupBattleCameraSystem() {
    this._battleCamera?.destroy?.();
    this._battleCamera = null;
    this._cameraGestureTapSuppressed = false;
    this._pinnedUiObjects = new Set();
    this._cameraFilterDirty = false;
    this._lastChildrenCount = -1;

    if (!this.mobileCameraEnabled) return;

    // Keep extra touch pointer allocation battle-scoped so other scenes are unaffected.
    if (typeof this.input?.addPointer === 'function' && !this.input.pointer2) {
      this.input.addPointer(1);
    }

    this._setupUiCamera();
    this._battleCamera = new BattleCameraController(this.cameras.main, {
      minZoom: 1,
      maxZoom: 3,
      getBounds: () => this._getBattleMapBounds(),
      onViewChanged: () => {
        this._syncMobileResetViewButton();
      },
    });
    this._battleCamera.resetView();
    this._setBattleCanvasTouchAction(true);
    this._syncMobileResetViewButton();
    if (!this._scaleResizeHandler && this.scale?.on) {
      this._scaleResizeHandler = () => {
        if (!this._uiCamera) return;
        const worldCam = this.cameras?.main;
        if (!worldCam) return;
        this._uiCamera.setSize(worldCam.width, worldCam.height);
      };
      this.scale.on('resize', this._scaleResizeHandler);
    }
  }

  _teardownBattleCameraSystem() {
    this._setBattleCanvasTouchAction(false);
    if (this._scaleResizeHandler) {
      this.scale?.off?.('resize', this._scaleResizeHandler);
      this._scaleResizeHandler = null;
    }

    if (this._battleCamera) {
      this._battleCamera.destroy();
      this._battleCamera = null;
    }
    this._cameraGestureTapSuppressed = false;

    if (this._uiCamera && this.cameras?.remove) {
      this.cameras.remove(this._uiCamera);
    }
    if (this._displayListDirtyHandler && this.events) {
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this._displayListDirtyHandler);
      this.events.off(Phaser.Scenes.Events.REMOVED_FROM_SCENE, this._displayListDirtyHandler);
      this._displayListDirtyHandler = null;
    }
    this._uiCamera = null;
    this._pinnedUiObjects = new Set();
    this._cameraFilterDirty = false;
    this._lastChildrenCount = -1;

    const cam = this.cameras?.main;
    if (cam) {
      cam.setZoom(1);
      cam.setScroll(0, 0);
    }

    if (this.isMobileInput && this.game?.events) {
      this.game.events.emit('mobile:setButtonVisible', { action: 'resetView', visible: false });
    }
  }

  _setupUiCamera() {
    if (!this.mobileCameraEnabled) return;
    if (this._uiCamera) return;
    const worldCam = this.cameras.main;
    this._uiCamera = this.cameras.add(0, 0, worldCam.width, worldCam.height);
    if (typeof this._uiCamera.setRoundPixels === 'function') {
      this._uiCamera.setRoundPixels(worldCam.roundPixels);
    }
    if (!this._displayListDirtyHandler && this.events) {
      this._displayListDirtyHandler = () => {
        this._cameraFilterDirty = true;
      };
      this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this._displayListDirtyHandler);
      this.events.on(Phaser.Scenes.Events.REMOVED_FROM_SCENE, this._displayListDirtyHandler);
    }
    this._cameraFilterDirty = true;
    this._lastChildrenCount = -1;
    this._syncPinnedUiCameraFilters();
  }

  _isAutoPinCandidate(obj) {
    if (!obj || typeof obj.depth !== 'number') return false;
    if (obj._forceWorldCamera === true) return false;
    if (obj.depth >= 500) return true;
    if (obj.depth >= 100 && obj.depth <= 200) {
      return (
        obj === this.infoText ||
        obj === this.objectiveText ||
        obj === this.turnCounterText ||
        obj === this.visionHudText ||
        obj === this.instructionText2 ||
        obj === this.inspectButton ||
        obj === this.dangerButton ||
        obj === this.rosterButton ||
        obj === this.endTurnButton ||
        obj === this.cancelButton ||
        obj === this.inspectionPanel?.objects?.[0] ||
        obj === this.inspectionPanel?.objects?.[1] ||
        obj === this.inspectionPanel?.objects?.[2]
      );
    }
    return false;
  }

  _syncPinnedUiCameraFilters() {
    if (!this._uiCamera) return;
    const list = this.children?.list || [];
    const uiCameraId = this._uiCamera.id;
    const worldCameraId = this.cameras?.main?.id;
    if (!uiCameraId || !worldCameraId) return;

    const livePinned = new Set();
    for (const obj of list) {
      if (!obj || typeof obj !== 'object') continue;
      const autoPin = this._isAutoPinCandidate(obj);
      const pinned = this._pinnedUiObjects.has(obj) || autoPin;
      if (pinned) {
        livePinned.add(obj);
        obj.cameraFilter = ((obj.cameraFilter || 0) | worldCameraId) & ~uiCameraId;
      } else {
        obj.cameraFilter = ((obj.cameraFilter || 0) | uiCameraId) & ~worldCameraId;
      }
    }
    this._pinnedUiObjects = livePinned;
    this._cameraFilterDirty = false;
    this._lastChildrenCount = list.length;
  }

  _walkDisplayObjectTree(objOrArray, visitor) {
    if (!objOrArray) return;
    if (Array.isArray(objOrArray)) {
      for (const obj of objOrArray) this._walkDisplayObjectTree(obj, visitor);
      return;
    }
    visitor(objOrArray);
    if (Array.isArray(objOrArray.list)) {
      for (const child of objOrArray.list) this._walkDisplayObjectTree(child, visitor);
    }
  }

  _pinToScreen(objOrArray) {
    if (!objOrArray || !this._uiCamera) return objOrArray;
    this._walkDisplayObjectTree(objOrArray, (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (typeof obj.setScrollFactor === 'function') obj.setScrollFactor(0);
      this._pinnedUiObjects.add(obj);
    });
    this._syncPinnedUiCameraFilters();
    return objOrArray;
  }

  _setBattleCanvasTouchAction(enabled) {
    if (!this.mobileCameraEnabled) return;
    const canvas = this.game?.canvas;
    if (!canvas?.style) return;
    if (enabled) {
      if (this._battleCanvasTouchActionPrev == null) {
        this._battleCanvasTouchActionPrev = canvas.style.touchAction ?? '';
      }
      canvas.style.touchAction = 'none';
      return;
    }
    if (this._battleCanvasTouchActionPrev != null) {
      canvas.style.touchAction = this._battleCanvasTouchActionPrev;
      this._battleCanvasTouchActionPrev = null;
    }
  }

  _syncMobileResetViewButton() {
    if (!this.isMobileInput || !this.game?.events) return;
    const visible = Boolean(
      this.mobileCameraEnabled && this._battleCamera && this._battleCamera.getZoom() > 1.001,
    );
    this.game.events.emit('mobile:setButtonVisible', { action: 'resetView', visible });
  }

  resetBattleCameraView() {
    if (!this.mobileCameraEnabled || !this._battleCamera) return false;
    this._battleCamera.resetView();
    this._syncMobileResetViewButton();
    return true;
  }

  isCameraGestureAllowed() {
    if (!this.mobileCameraEnabled || !this._battleCamera) return false;
    if (this.isStoryInputLocked()) return false;
    if (this._isTutorialStrictGateActive()) return false;
    if (this.pauseOverlay?.visible || this.unitDetailOverlay?.visible || this.visionDialog)
      return false;
    if (this.rosterOverlay?.visible) return false;
    if (this.lootSettingsOverlay || this.lootRosterVisible) return false;

    const allowedStates = new Set([
      'PLAYER_IDLE',
      'UNIT_SELECTED',
      'SELECTING_TARGET',
      'SHOWING_FORECAST',
      'ENEMY_PHASE',
      'COMBAT_RESOLVING',
      'HEAL_RESOLVING',
      'CANTO_MOVING',
    ]);
    return allowedStates.has(this.battleState);
  }

  _handleCameraGesturePointerDown(pointer) {
    return (this._inputController ||= new InputController(this))._handleCameraGesturePointerDown(
      pointer,
    );
  }

  _handleCameraGesturePointerMove(pointer) {
    return (this._inputController ||= new InputController(this))._handleCameraGesturePointerMove(
      pointer,
    );
  }

  _handleCameraGesturePointerUp(pointer) {
    return (this._inputController ||= new InputController(this))._handleCameraGesturePointerUp(
      pointer,
    );
  }

  _screenToWorld(x, y) {
    return (this._inputController ||= new InputController(this))._screenToWorld(x, y);
  }

  _worldToScreen(x, y) {
    return (this._inputController ||= new InputController(this))._worldToScreen(x, y);
  }

  _pointerToWorld(pointer) {
    return (this._inputController ||= new InputController(this))._pointerToWorld(pointer);
  }

  _pointerToGrid(pointer) {
    return (this._inputController ||= new InputController(this))._pointerToGrid(pointer);
  }

  onClick(pointer, clickPos = null) {
    (this._inputController ||= new InputController(this)).onClick(pointer, clickPos);
  }

  onRightClick(pointer) {
    (this._inputController ||= new InputController(this)).onRightClick(pointer);
  }

  _isPointerOverInteractive(pointer) {
    return (this._inputController ||= new InputController(this))._isPointerOverInteractive(pointer);
  }

  isCancelableBattleState() {
    const cancelStates = [
      'UNIT_SELECTED',
      'UNIT_ACTION_MENU',
      'SELECTING_TARGET',
      'SHOWING_FORECAST',
      'SELECTING_HEAL_TARGET',
      'SELECTING_CURE_TARGET',
      'SELECTING_SHOVE_TARGET',
      'SELECTING_PULL_TARGET',
      'SELECTING_TRADE_TARGET',
      'SELECTING_SWAP_TARGET',
      'SELECTING_DANCE_TARGET',
      'SELECTING_BREAK_TARGET',
      'TRADING',
      'CANTO_MOVING',
    ];
    return cancelStates.includes(this.battleState);
  }

  canRequestCancel({ allowPause = true } = {}) {
    if (this.isStoryInputLocked()) return false;
    if (this.isDevToolsEnabled() && this.debugOverlay?.visible) return true;
    if (this.visionDialog) return true;
    if (this.unitDetailOverlay?.visible) return true;
    if (this.inspectionPanel?.visible) return true;
    if (this.isMobileInput && this.inspectMode) return true;
    if (this.pauseOverlay?.visible) return true;
    if (this.lootRosterVisible) return true;
    if (this.battleState === 'BATTLE_END' && this.lootGroup) return true;
    if (this.isCancelableBattleState()) return true;
    if (allowPause && this.battleState === 'PLAYER_IDLE') return true;
    return false;
  }

  requestCancel({ allowPause = true } = {}) {
    if (this.isStoryInputLocked()) return true;
    if (this._isTutorialStrictGateActive()) {
      if (this.battleState !== 'TUTORIAL_HINT') {
        void this._showTutorialBlockingInstruction('Finish the tutorial movement step first.');
      }
      return true;
    }
    if (!this.canRequestCancel({ allowPause })) return false;
    if (this.isDevToolsEnabled() && this.debugOverlay?.visible) {
      this.debugOverlay.hide();
      this.refreshEndTurnControl();
      return true;
    }
    if (this.visionDialog) {
      this.cancelVisionDialog();
      return true;
    }
    if (this.unitDetailOverlay?.visible) {
      this.unitDetailOverlay.hide();
    } else if (
      this.inspectionPanel?.visible &&
      !(this.isMobileInput && allowPause && this.battleState === 'PLAYER_IDLE')
    ) {
      if (this.isMobileInput) this.inspectMode = false;
      this.clearInspectionVisuals();
    } else if (this.pauseOverlay?.visible) {
      if (!this.pauseOverlay.closeActiveSubOverlay()) {
        this.pauseOverlay.hide();
      }
    } else if (this.lootRosterVisible) {
      this.hideLootRoster();
    } else if (!allowPause && this.isMobileInput && this.inspectMode) {
      this.inspectMode = false;
      this.clearInspectionVisuals();
      return true;
    } else if (this.battleState === 'BATTLE_END' && this.lootGroup) {
      // Toggle: a second ESC closes the open settings overlay instead of
      // stacking another one on top of it.
      if (this.lootSettingsOverlay?.visible) {
        this.lootSettingsOverlay.hide();
        this.lootSettingsOverlay = null;
      } else {
        this._hideLootTooltip();
        this.lootSettingsOverlay = new SettingsOverlay(this, () => {
          this.lootSettingsOverlay = null;
        });
        this.lootSettingsOverlay.show();
      }
    } else if (this.isCancelableBattleState()) {
      this.handleCancel();
    } else if (allowPause && this.battleState === 'PLAYER_IDLE') {
      if (this.isMobileInput && (this.inspectMode || this.inspectionPanel?.visible)) {
        this.inspectMode = false;
        if (this.inspectionPanel?.visible) this.inspectionPanel.hide();
        this.grid?.clearHighlights?.();
        this.grid?.clearAttackHighlights?.();
      }
      this.showPauseMenu();
    }
    this.refreshEndTurnControl();
    return true;
  }

  openUnitDetailOverlay() {
    (this._inputController ||= new InputController(this)).openUnitDetailOverlay();
  }

  handleCancel() {
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    if (this.battleState === 'SHOWING_FORECAST') {
      this.hideForecast();
      this._clearCombatRollSession();
      this.battleState = 'SELECTING_TARGET';
    } else if (this.battleState === 'SELECTING_TARGET') {
      this.grid.clearAttackHighlights();
      this.attackTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_HEAL_TARGET') {
      this.grid.clearAttackHighlights();
      this.healTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_CURE_TARGET') {
      this.grid.clearAttackHighlights();
      this.healTargets = [];
      this._pendingCureItem = null;
      this._pendingCureUser = null;
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_SHOVE_TARGET') {
      this.grid.clearAttackHighlights();
      this.shoveTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_PULL_TARGET') {
      this.grid.clearAttackHighlights();
      this.pullTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_TRADE_TARGET') {
      this.grid.clearAttackHighlights();
      this.tradeTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_SWAP_TARGET') {
      this.grid.clearAttackHighlights();
      this.swapTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_DANCE_TARGET') {
      this.grid.clearAttackHighlights();
      this.danceTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_BREAK_TARGET') {
      this.grid.clearAttackHighlights();
      this.breakTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'TRADING') {
      this.cleanupTradeUI();
      const tradeMutated = this.tradeMutatedThisSession;
      this.showActionMenu(this.selectedUnit);
      this.tradeMutatedThisSession = tradeMutated;
    } else if (this.battleState === 'CANTO_MOVING') {
      // Skip Canto -- end unit's turn
      this.grid.clearHighlights();
      this.cantoRange = null;
      this._resetCantoPreInitFaultTracking();
      const cantoUnit = this.selectedUnit;
      this.dimUnit(cantoUnit);
      this.selectedUnit = null;
      this.battleState = 'PLAYER_IDLE';
      this.turnManager.unitActed(cantoUnit);
    } else if (this.battleState === 'UNIT_ACTION_MENU') {
      if (this.inEquipMenu) {
        this.inEquipMenu = false;
        this.showActionMenu(this.selectedUnit);
      } else {
        this.hideActionMenu();
        if (this.tradeMutatedThisSession) {
          const tradeMutated = this.tradeMutatedThisSession;
          this.showActionMenu(this.selectedUnit);
          this.tradeMutatedThisSession = tradeMutated;
        } else {
          this._clearSelectedWeaponArt();
          this.undoMove(this.selectedUnit);
        }
      }
    } else if (this.battleState === 'UNIT_SELECTED') {
      this.deselectUnit();
    }
    this.refreshEndTurnControl();
  }

  canForceEndTurn() {
    if (this.isStoryInputLocked()) return false;
    const playerInputStates = [
      'PLAYER_IDLE',
      'UNIT_SELECTED',
      'UNIT_ACTION_MENU',
      'SHOWING_FORECAST',
      'SELECTING_TARGET',
      'SELECTING_HEAL_TARGET',
      'SELECTING_CURE_TARGET',
      'SELECTING_SHOVE_TARGET',
      'SELECTING_PULL_TARGET',
      'SELECTING_TRADE_TARGET',
      'SELECTING_SWAP_TARGET',
      'SELECTING_DANCE_TARGET',
      'TRADING',
      'CANTO_MOVING',
    ];
    return (
      playerInputStates.includes(this.battleState) &&
      this.turnManager?.currentPhase === 'player' &&
      !this.pauseOverlay?.visible &&
      !this.unitDetailOverlay?.visible &&
      !this.lootSettingsOverlay &&
      this.battleState !== 'BATTLE_END'
    );
  }

  _emitMobileContext() {
    if (!this.isMobileInput) return;
    if (this.isStoryInputLocked()) {
      this.game.events.emit('mobile:setContext', { context: 'none' });
      return;
    }
    const s = this.battleState;
    let ctx = 'none';
    if (s === 'PLAYER_IDLE') ctx = 'battle_player_idle';
    else if (s === 'UNIT_SELECTED') ctx = 'battle_unit_selected';
    // States where roster IS allowed (matches _onRosterClick rosterStates)
    else if (s === 'UNIT_ACTION_MENU' || s === 'SELECTING_TARGET' || s === 'SELECTING_HEAL_TARGET')
      ctx = 'battle_action';
    // States where roster is NOT allowed
    else if (
      s === 'UNIT_MOVED' ||
      s === 'SELECTING_CURE_TARGET' ||
      s === 'SELECTING_SHOVE_TARGET' ||
      s === 'SELECTING_PULL_TARGET' ||
      s === 'SELECTING_TRADE_TARGET' ||
      s === 'SELECTING_SWAP_TARGET' ||
      s === 'SELECTING_DANCE_TARGET' ||
      s === 'SELECTING_BREAK_TARGET' ||
      s === 'TRADING' ||
      s === 'CANTO_MOVING'
    )
      ctx = 'battle_selected';
    // SHOWING_FORECAST: roster is technically allowed per _onRosterClick rosterStates,
    // but forecast mobile context prioritises weapon navigation buttons. Users can
    // B-cancel out of forecast to access roster -- acceptable UX tradeoff.
    else if (s === 'SHOWING_FORECAST' || s === 'CONFIRMING_ATTACK') ctx = 'battle_forecast';
    else if (s === 'BATTLE_END') ctx = 'battle_end';
    this.game.events.emit('mobile:setContext', { context: ctx });
  }

  refreshEndTurnControl() {
    if (this.isMobileInput) {
      this._emitMobileContext();
      if (typeof this._syncMobileResetViewButton === 'function') this._syncMobileResetViewButton();
      return; // Skip in-canvas button management on mobile
    }
    if (this.inspectButton) {
      const enabled =
        this.battleState !== 'ENEMY_PHASE' &&
        this.battleState !== 'BATTLE_END' &&
        this.battleState !== 'DEPLOY_SELECTION' &&
        this.battleState !== 'PAUSED' &&
        !this.pauseOverlay?.visible &&
        !this.unitDetailOverlay?.visible &&
        !this.lootSettingsOverlay;
      this.inspectButton.setVisible(enabled);
      this.inspectButton.setText(this.inspectMode ? '[Inspect: ON]' : '[Inspect: OFF]');
      if (enabled) {
        this.inspectButton.setColor(this.inspectMode ? '#ffdd44' : '#e0e0e0');
        this.inspectButton.setInteractive({ useHandCursor: true });
      } else {
        this.inspectButton.disableInteractive();
      }
    }

    if (this.endTurnButton) {
      const enabled = this.canForceEndTurn();
      this.endTurnButton.setVisible(enabled);
      if (enabled) {
        this.endTurnButton.setColor('#e0e0e0');
        this.endTurnButton.setInteractive({ useHandCursor: true });
      } else {
        this.endTurnButton.disableInteractive();
      }
    }

    if (this.cancelButton) {
      const canCancel = this.canRequestCancel({ allowPause: false });
      this.cancelButton.setVisible(canCancel);
      if (canCancel) {
        this.cancelButton.setColor('#e0e0e0');
        this.cancelButton.setInteractive({ useHandCursor: true });
      } else {
        this.cancelButton.disableInteractive();
      }
    }
  }

  _onDangerClick() {
    if (this.isStoryInputLocked()) return;
    if (this.battleState === 'PLAYER_IDLE' || this.battleState === 'UNIT_SELECTED') {
      if (this.dangerZoneStale || !this.dangerZoneCache) {
        this.dangerZoneCache = this.calculateDangerZone();
        this.dangerZoneStale = false;
      }
      this.dangerZone.toggle(this.dangerZoneCache);
    }
  }

  _onRosterClick() {
    if (this.isStoryInputLocked()) return;
    const rosterStates = [
      'PLAYER_IDLE',
      'UNIT_SELECTED',
      'UNIT_ACTION_MENU',
      'SHOWING_FORECAST',
      'SELECTING_TARGET',
      'SELECTING_HEAL_TARGET',
    ];
    if (
      !rosterStates.includes(this.battleState) ||
      !this.playerUnits ||
      this.pauseOverlay?.visible ||
      this.lootSettingsOverlay
    )
      return;
    if (this.unitDetailOverlay?.visible) {
      this.unitDetailOverlay.hide();
      this.refreshEndTurnControl();
      return;
    }
    const living = this.playerUnits.filter((u) => u.currentHP > 0);
    if (living.length === 0) return;
    let defaultIdx = 0;
    const inspected = this.inspectionPanel?._unit;
    if (inspected && inspected.faction === 'player' && living.includes(inspected)) {
      defaultIdx = living.indexOf(inspected);
    } else if (this.selectedUnit && living.includes(this.selectedUnit)) {
      defaultIdx = living.indexOf(this.selectedUnit);
    } else {
      const lordIdx = living.findIndex((u) => u.isLord);
      if (lordIdx >= 0) defaultIdx = lordIdx;
    }
    const unit = living[defaultIdx];
    const terrainIdx = this.grid?.mapLayout?.[unit.row]?.[unit.col];
    const terrain = terrainIdx != null ? this.gameData.terrain[terrainIdx] : null;
    this.unitDetailOverlay.show(unit, terrain, this.gameData, {
      rosterUnits: living,
      rosterIndex: defaultIdx,
    });
    if (this.inspectionPanel?.visible) this.inspectionPanel.hide();
    this.refreshEndTurnControl();
  }

  forceEndTurn() {
    if (this.isStoryInputLocked()) return;
    if (this._isTutorialStrictGateActive()) {
      if (this.battleState !== 'TUTORIAL_HINT') {
        void this._showTutorialBlockingInstruction('Finish the tutorial movement step first.');
      }
      return;
    }
    if (!this.canForceEndTurn()) return;
    this.commitVisionSnapshotIfPending();
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');

    // Collapse active selection/menu states before ending phase.
    this.hideForecast();
    this._clearCombatRollSession();
    this.hideActionMenu();
    this.cleanupTradeUI();
    this.inEquipMenu = false;
    this.attackTargets = [];
    this.healTargets = [];
    this.shoveTargets = [];
    this.pullTargets = [];
    this.tradeTargets = [];
    this.swapTargets = [];
    this.danceTargets = [];
    this._clearSelectedWeaponArt();
    this.preMoveLoc = null;
    this._preFogSnapshot = null;
    this.movementRange = null;
    this.unitPositions = null;
    this.cantoRange = null;
    this.grid.clearHighlights();
    this.grid.clearAttackHighlights();
    this.grid.clearPath();
    if (this.selectedUnit?.graphic?.clearTint) this.selectedUnit.graphic.clearTint();
    this.selectedUnit = null;
    if (this.inspectionPanel?.visible) this.inspectionPanel.hide();

    for (const unit of this.playerUnits) {
      if (!unit.hasActed) {
        unit.hasActed = true;
        this.dimUnit(unit);
      }
    }
    this.battleState = 'PLAYER_IDLE';
    this.turnManager.endPlayerPhase();
    this.refreshEndTurnControl();
  }

  showPauseMenu() {
    this.prePauseState = this.battleState;
    this.battleState = 'PAUSED';
    const transitionToTitleWithWatchdog = async (reason) => {
      markStartup('pause_transition_attempt', { scene: 'Battle', reason });
      const timeoutToken = Symbol('pause_transition_timeout');
      let timeoutHandle = null;
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutToken), PAUSE_TRANSITION_TIMEOUT_MS);
        if (typeof timeoutHandle?.unref === 'function') timeoutHandle.unref();
      });
      let result;
      try {
        result = await Promise.race([
          transitionToScene(this, 'Title', { gameData: this.gameData }, { reason }),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
      if (result === timeoutToken) {
        markStartup('pause_transition_timeout', {
          scene: 'Battle',
          reason,
          timeoutMs: PAUSE_TRANSITION_TIMEOUT_MS,
        });
        return false;
      }
      return result === true;
    };
    const abandonCb = this.runManager
      ? async () => {
          try {
            const cloud = this.registry.get('cloud');
            const slot = this.registry.get('activeSlot');
            clearSavedRun(
              cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null,
              slot,
            );
            this.clearBattleScopedDeltas(this.playerUnits);
            this.clearBattleScopedDeltas(this.nonDeployedUnits || []);
            this.runManager.failRun();
            this.runManager.settleEndRunRewards(this.registry.get('meta'), 'defeat');
            const audio = this.registry.get('audio');
            if (audio) audio.stopMusic(this, 0);
            const ok = await transitionToTitleWithWatchdog(TRANSITION_REASONS.ABANDON_RUN);
            if (!ok) {
              markStartup('pause_transition_fallback', { scene: 'Battle', reason: 'ABANDON_RUN' });
              resetTransitionLocks(this);
              try {
                this.scene.start('Title', { gameData: this.gameData }); // scene-router-bypass
              } catch (err) {
                markStartup('pause_transition_double_failure', {
                  scene: 'Battle',
                  reason: 'ABANDON_RUN',
                });
                this.showPauseTransitionRecovery(TRANSITION_REASONS.ABANDON_RUN);
              }
            }
          } catch (err) {
            reportAsyncError('Battle-pause-abandon', err);
            this.showPauseTransitionRecovery(TRANSITION_REASONS.ABANDON_RUN);
          }
        }
      : null;
    const saveExitCb = this.runManager
      ? async () => {
          try {
            // Return to title -- last NodeMap auto-save preserved. Battle progress lost.
            this.clearBattleScopedDeltas(this.playerUnits);
            this.clearBattleScopedDeltas(this.nonDeployedUnits || []);
            const audio = this.registry.get('audio');
            if (audio) audio.stopMusic(this, 0);
            const ok = await transitionToTitleWithWatchdog(TRANSITION_REASONS.SAVE_EXIT);
            if (!ok) {
              markStartup('pause_transition_fallback', { scene: 'Battle', reason: 'SAVE_EXIT' });
              resetTransitionLocks(this);
              try {
                this.scene.start('Title', { gameData: this.gameData }); // scene-router-bypass
              } catch (err) {
                markStartup('pause_transition_double_failure', {
                  scene: 'Battle',
                  reason: 'SAVE_EXIT',
                });
                this.showPauseTransitionRecovery(TRANSITION_REASONS.SAVE_EXIT);
              }
            }
          } catch (err) {
            reportAsyncError('Battle-pause-save-exit', err);
            this.showPauseTransitionRecovery(TRANSITION_REASONS.SAVE_EXIT);
          }
        }
      : null;
    const campaignMapData = this.runManager?.nodeMap
      ? {
          nodeMap: this.runManager.nodeMap,
          currentNodeId: this.runManager.currentNodeId,
          actId: this.runManager.currentAct,
          activeNodeId: this.nodeId,
        }
      : null;
    this.pauseOverlay = new PauseOverlay(this, {
      onResume: () => {
        this.battleState = this.prePauseState || 'PLAYER_IDLE';
        this.pauseOverlay = null;
        this.refreshEndTurnControl();
      },
      onSaveAndExit: saveExitCb,
      onSaveAndExitWarning: 'Battle Progress Will Be Lost',
      onAbandon: abandonCb,
      campaignMapData,
      gameData: this.gameData,
    });
    this.pauseOverlay.show();
    this.refreshEndTurnControl();
  }

  handleIdleClick(gp) {
    (this._inputController ||= new InputController(this)).handleIdleClick(gp);
  }

  handleSelectedClick(gp) {
    (this._inputController ||= new InputController(this)).handleSelectedClick(gp);
  }

  handleActionMenuClick(gp) {
    (this._inputController ||= new InputController(this)).handleActionMenuClick(gp);
  }

  handleTargetClick(gp) {
    (this._inputController ||= new InputController(this)).handleTargetClick(gp);
  }

  handleForecastClick(gp) {
    (this._inputController ||= new InputController(this)).handleForecastClick(gp);
  }

  confirmForecastCombat() {
    if (!this.forecastTarget || !this.selectedUnit || this.battleState !== 'SHOWING_FORECAST')
      return;
    // Final legality guard: silenced units cannot confirm with a magic weapon
    const w = this.selectedUnit.weapon;
    if (
      isSilenced(this.selectedUnit) &&
      w &&
      (w.type === 'Tome' || w.type === 'Light' || w.type === 'Staff' || w.type === 'Breath')
    ) {
      this.hideForecast();
      return;
    }
    const target = this.forecastTarget;
    this.commitVisionSnapshotIfPending();
    this.hideForecast();
    this.executeCombat(this.selectedUnit, target);
  }

  // --- Unit selection & movement ---

  selectUnit(unit) {
    if (this._isTutorialStrictGateActive() && this.tutorialStep === 2) {
      const edric = this._getTutorialEdricUnit();
      if (unit !== edric) {
        void this._showTutorialBlockingInstruction('Select Edric first to continue the tutorial.');
        return;
      }
    }
    if (this.unitDetailOverlay?.visible) this.unitDetailOverlay.hide();
    this.inspectionPanel.hide();
    this.dangerZone.hide();
    this._clearCombatRollSession();
    this._clearSelectedWeaponArt();
    this.selectedUnit = unit;
    this.battleState = 'UNIT_SELECTED';

    if (unit.graphic.setTint) {
      unit.graphic.setTint(0xaaaaff);
    }

    this.unitPositions = this.buildUnitPositionMap(unit.faction);
    this.movementRange = this.grid.getMovementRange(
      unit.col,
      unit.row,
      unit.mov,
      unit.moveType,
      this.unitPositions,
      unit.faction,
      this._getCostModifier(unit),
    );
    this.grid.showMovementRange(this.movementRange, unit.col, unit.row);

    if (this.battleParams.tutorialMode && this.tutorialStep === 2) {
      this._setTutorialGuideHighlight('fort');
      this.tutorialStep = 3;
      const verb = this.isMobileInput ? 'Tap' : 'Click';
      void this._withTutorialHintState(async () => {
        await showImportantHint(this, `${verb} the highlighted Fort tile with Edric to continue.`);
      });
    }
  }

  deselectUnit() {
    if (this.selectedUnit && this.selectedUnit.graphic?.clearTint) {
      this.selectedUnit.graphic.clearTint();
    }
    this.selectedUnit = null;
    this._clearCombatRollSession();
    this._clearSelectedWeaponArt();
    this.movementRange = null;
    this.unitPositions = null;
    this.battleState = 'PLAYER_IDLE';
    this.grid.clearHighlights();
    this.grid.clearAttackHighlights();
  }

  _recoverFromMovementFault(
    unit,
    {
      context = 'moveUnit',
      reason = 'unknown movement failure',
      error = null,
      rollbackTo = null,
      rollbackMovementSpent,
    } = {},
  ) {
    const prefix = `[${context}]`;
    if (context === 'handleCantoClick') this._resetCantoPreInitFaultTracking();
    if (error) {
      console.error(`${prefix} ${reason}`, error);
    } else {
      console.warn(`${prefix} ${reason}`);
    }

    this.grid?.clearHighlights?.();
    this.grid?.clearAttackHighlights?.();
    this.grid?.clearPath?.();

    if (rollbackTo) {
      // Keep gameplay state coherent even if visual sync fails.
      unit.col = rollbackTo.col;
      unit.row = rollbackTo.row;
      unit.hasMoved = false;
      if (typeof rollbackMovementSpent === 'undefined') delete unit._movementSpent;
      else unit._movementSpent = rollbackMovementSpent;
      this.preMoveLoc = null;
      this.cantoRange = null;
      this.selectedUnit = unit;
      this.battleState = 'UNIT_SELECTED';

      if (this.grid?.fogEnabled && unit.faction === 'player') {
        try {
          this.grid.restoreFogState(this._preFogSnapshot);
          this._preFogSnapshot = null;
          this.grid.updateFogOfWar(this.playerUnits);
          this.updateEnemyVisibility();
        } catch (fogErr) {
          console.error(`${prefix} failed to restore fog state during rollback`, fogErr);
        }
      } else {
        this._preFogSnapshot = null;
      }

      try {
        this.updateUnitPosition(unit);
      } catch (posErr) {
        console.error(`${prefix} failed to sync unit position visuals during rollback`, posErr);
      }

      try {
        this.selectUnit(unit);
      } catch (selectErr) {
        console.error(`${prefix} failed to re-select unit after rollback`, selectErr);
        this.selectedUnit = null;
        this.movementRange = null;
        this.unitPositions = null;
        this.battleState = 'PLAYER_IDLE';
      }
      return;
    }

    this.preMoveLoc = null;
    this.cantoRange = null;
    this._preFogSnapshot = null;
    this.selectedUnit = null;
    this.battleState = 'PLAYER_IDLE';

    try {
      this.updateUnitPosition(unit);
    } catch (posErr) {
      console.error(`${prefix} failed to sync unit position visuals`, posErr);
    }

    try {
      this.dimUnit(unit);
    } catch (dimErr) {
      console.error(`${prefix} failed to dim unit during recovery`, dimErr);
    }

    try {
      this.turnManager?.unitActed?.(unit);
    } catch (actErr) {
      console.error(`${prefix} failed to finalize unit action during recovery`, actErr);
    }
  }

  _resetCantoPreInitFaultTracking() {
    this._cantoPreInitFaultUnit = null;
    this._cantoPreInitFaultCount = 0;
  }

  _recordCantoPreInitFault(unit) {
    if (this._cantoPreInitFaultUnit !== unit) {
      this._cantoPreInitFaultUnit = unit;
      this._cantoPreInitFaultCount = 1;
      return this._cantoPreInitFaultCount;
    }
    this._cantoPreInitFaultCount = (this._cantoPreInitFaultCount || 0) + 1;
    return this._cantoPreInitFaultCount;
  }

  moveUnit(unit, toCol, toRow) {
    const from = { col: unit.col, row: unit.row };
    const to = { col: toCol, row: toRow };
    let path;
    try {
      // Prefer Dijkstra reconstruction for ice-aware paths
      path = this.grid.reconstructIcePath(this.movementRange, unit.col, unit.row, toCol, toRow);
      if (!path) {
        path = this.grid.findPath(
          unit.col,
          unit.row,
          toCol,
          toRow,
          unit.moveType,
          this.unitPositions,
          unit.faction,
          this._getCostModifier(unit),
        );
      }
    } catch (err) {
      console.error('[moveUnit] Error during path initialization', {
        unit: unit?.name || unit?.id || '<unknown>',
        from,
        to,
        battleState: this.battleState,
        stack: err?.stack || null,
      });
      this.deselectUnit();
      return;
    }
    if (!path || path.length < 2) {
      console.warn('[moveUnit] findPath returned null/short path for tile in movementRange', {
        from,
        to,
      });
      this.deselectUnit();
      return;
    }

    let effective;
    try {
      const occupied = this.buildOccupiedSet(unit);
      effective = computeEffectivePath(
        path,
        this.grid.mapLayout,
        this.grid.terrainData,
        this.grid.cols,
        this.grid.rows,
        unit.moveType,
        occupied,
        this._getCostModifier(unit),
      );
    } catch (err) {
      console.error('[moveUnit] Error during effective path initialization', {
        unit: unit?.name || unit?.id || '<unknown>',
        from,
        to,
        battleState: this.battleState,
        stack: err?.stack || null,
      });
      this.deselectUnit();
      return;
    }
    const finalPath = effective.effectivePath;
    if (!finalPath || finalPath.length < 2) {
      console.warn('[moveUnit] effectivePath returned null/short path', {
        from,
        to,
      });
      this.deselectUnit();
      return;
    }
    const finalDest = finalPath[finalPath.length - 1];
    const rollbackLoc = { col: unit.col, row: unit.row };
    const rollbackMovementSpent = unit._movementSpent;

    // Animate step-by-step along path
    const targets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];

    let recoveryTriggered = false;
    let finalizeTriggered = false;
    const failMove = (reason, error = null) => {
      if (recoveryTriggered) return;
      recoveryTriggered = true;
      this._recoverFromMovementFault(unit, {
        context: 'moveUnit',
        reason,
        error,
        rollbackTo: rollbackLoc,
        rollbackMovementSpent,
      });
    };

    const finalizeMove = () => {
      if (finalizeTriggered || recoveryTriggered) return;
      finalizeTriggered = true;
      unit.col = finalDest.col;
      unit.row = finalDest.row;
      unit.hasMoved = true;
      try {
        this.updateUnitPosition(unit);
      } catch (err) {
        failMove('Error while finalizing move position update', err);
        return;
      }
      Promise.resolve(this.afterMove(unit)).catch((err) => {
        failMove('Error while resolving afterMove', err);
      });
    };

    const animateStep = (stepIndex) => {
      if (recoveryTriggered) return;
      if (stepIndex >= finalPath.length) {
        finalizeMove();
        return;
      }
      try {
        const pos = this.grid.gridToPixel(finalPath[stepIndex].col, finalPath[stepIndex].row);
        const isSlide = effective.slideSegments.some(
          (seg) => stepIndex >= seg.startIndex && stepIndex < seg.startIndex + seg.slidePath.length,
        );
        const duration = isSlide ? 60 : 80;
        this.tweens.add({
          targets,
          x: pos.x,
          y: pos.y,
          duration,
          ease: 'Linear',
          onComplete: () => {
            try {
              animateStep(stepIndex + 1);
            } catch (err) {
              failMove('Error during move tween completion', err);
            }
          },
        });
      } catch (err) {
        failMove('Error while creating move tween', err);
      }
    };

    try {
      this.battleState = 'UNIT_MOVING';
      this.preMoveLoc = { ...rollbackLoc };
      this._preFogSnapshot = null;
      this._preFogSnapshot = this.grid.snapshotFogState();
      unit._movementSpent = effective.movementCost;

      this.grid.clearHighlights();
      if (unit.graphic.clearTint) unit.graphic.clearTint();

      // Safety net: if a tween completion callback is dropped, finalize movement anyway.
      // This must be armed before starting animation setup to avoid hard locks on throws.
      const fallbackMs = Math.max(500, finalPath.length * 140);
      this.time.delayedCall(fallbackMs, () => {
        if (!finalizeTriggered && !recoveryTriggered && this.scene?.isActive?.()) {
          console.warn('[moveUnit] Fallback timer triggered - movement animation stalled');
          finalizeMove();
        }
      });

      animateStep(1);
    } catch (err) {
      failMove('Error during movement animation setup', err);
    }
  }

  async afterMove(unit) {
    // Update fog of war after player movement
    if (this.grid.fogEnabled && unit.faction === 'player') {
      this.grid.updateFogOfWar(this.playerUnits);
      this.updateEnemyVisibility();
    }
    if (this.battleParams.tutorialMode && this.tutorialStep === 3) {
      this.tutorialStep = 4;
      this._clearTutorialGuideHighlights();
      const infoHint = this.isMobileInput
        ? 'Fort tile reached.\nCheck terrain in the top-left panel to view terrain effects, which can aid or hinder you in battle.\nUse Danger Zone to view enemy threat range.\nTap an enemy to see its range.\nUse Inspect or long-press any unit for details.'
        : 'Fort tile reached.\nCheck terrain in the top-left panel to view terrain effects, which can aid or hinder you in battle.\nUse [D] Danger Zone to view enemy threat range.\nRight-click any unit to inspect, then press [V] for details.';
      await this._withTutorialHintState(async () => {
        await showImportantHint(this, infoHint);
      });
      if (!this.scene?.isActive?.()) return;
      this._tutorialStrictGateReleased = true;
    }
    this.showActionMenu(unit);
  }

  _getCombatRangeForUnitWeapon(unit, weapon, weaponArt = null) {
    const { min: baseMin, max: baseMax } = parseRange(weapon.range);
    const skillBonus = getWeaponRangeBonus(unit, weapon, this.gameData.skills);
    let min = Math.max(1, baseMin);
    let max = Math.max(min, baseMax + skillBonus);
    if (weaponArt) {
      const mods = getWeaponArtCombatMods(weaponArt);
      if (mods.rangeOverride) {
        min = Math.max(1, Number(mods.rangeOverride.min) || min);
        max = Math.max(min, Number(mods.rangeOverride.max) || min);
      } else if (mods.rangeBonus) {
        max = Math.max(min, max + mods.rangeBonus);
      }
    }
    return { min, max };
  }

  _isDistanceInWeaponRange(unit, weapon, distance, weaponArt = null) {
    const range = this._getCombatRangeForUnitWeapon(unit, weapon, weaponArt);
    return distance >= range.min && distance <= range.max;
  }

  findAttackTargets(unit, options = {}) {
    const targets = [];
    const selectedWeapon = options.weapon || null;
    const selectedArt = options.weaponArt || null;
    let combatWeapons = selectedWeapon ? [selectedWeapon] : getCombatWeapons(unit);
    // Silenced units cannot attack with magic weapons
    if (isSilenced(unit)) {
      combatWeapons = combatWeapons.filter(
        (w) => w.type !== 'Tome' && w.type !== 'Light' && w.type !== 'Staff' && w.type !== 'Breath',
      );
    }
    if (combatWeapons.length === 0) return targets;
    const enemies = unit.faction === 'player' ? this.enemyUnits : this.playerUnits;
    // Check all combat weapons in inventory for range (with skill bonuses)
    for (const enemy of enemies) {
      // In fog mode, player can only target visible enemies
      if (this.grid.fogEnabled && unit.faction === 'player') {
        const fogVis = isEntity(enemy)
          ? getFootprint(enemy).some((t) => this.grid.isVisible(t.col, t.row))
          : this.grid.isVisible(enemy.col, enemy.row);
        if (!fogVis) continue;
      }
      const dist = combatDistance(unit, enemy);
      if (
        combatWeapons.some((w) => {
          const art = selectedWeapon === w ? selectedArt : null;
          return this._isDistanceInWeaponRange(unit, w, dist, art);
        })
      ) {
        targets.push(enemy);
      }
    }
    return targets;
  }

  /** Auto-swap to a combat weapon that can reach the given distance. */
  ensureValidWeaponForRange(unit, dist, options = {}) {
    const selectedArt = options.weaponArt || null;
    const magicBlocked =
      isSilenced(unit) &&
      unit.weapon &&
      (unit.weapon.type === 'Tome' ||
        unit.weapon.type === 'Light' ||
        unit.weapon.type === 'Staff' ||
        unit.weapon.type === 'Breath');
    if (
      !magicBlocked &&
      unit.weapon &&
      this._isDistanceInWeaponRange(unit, unit.weapon, dist, selectedArt)
    )
      return;
    if (selectedArt) return;
    if (!magicBlocked && unit.weapon) {
      if (this._isDistanceInWeaponRange(unit, unit.weapon, dist)) return;
    }
    // Find first combat weapon that can reach (skip magic if silenced)
    let swapCandidates = getCombatWeapons(unit);
    if (isSilenced(unit)) {
      swapCandidates = swapCandidates.filter(
        (w) => w.type !== 'Tome' && w.type !== 'Light' && w.type !== 'Staff' && w.type !== 'Breath',
      );
    }
    const validWeapon = swapCandidates.find((w) => {
      return this._isDistanceInWeaponRange(unit, w, dist);
    });
    if (validWeapon) equipWeapon(unit, validWeapon);
  }

  finishUnitAction(unit, { skipCanto = false } = {}) {
    this.commitVisionSnapshotIfPending();
    this._clearCombatRollSession();
    this.hideActionMenu();
    this.grid.clearAttackHighlights();
    this.attackTargets = [];
    this.healTargets = [];
    this.inEquipMenu = false;
    this.tradeMutatedThisSession = false;
    this._clearSelectedWeaponArt();

    // Check for Canto: use remaining movement after acting
    if (!skipCanto) {
      const hasCanto = unit.skills?.includes('canto');
      const movSpent = unit._movementSpent || 0;
      const remaining = unit.stats.MOV - movSpent;
      if (hasCanto && remaining > 0 && unit.faction === 'player') {
        unit.hasActed = true;
        this.selectedUnit = unit;
        this.preMoveLoc = null;
        this._preFogSnapshot = null;
        this.startCantoMove(unit, remaining);
        return;
      }
    }

    unit.hasActed = true;
    this.dimUnit(unit);
    this.selectedUnit = null;
    this.preMoveLoc = null;
    this._preFogSnapshot = null;
    this.battleState = 'PLAYER_IDLE';
    this.turnManager.unitActed(unit);
  }

  // --- Shove / Pull / Canto ---

  findShoveTargets(unit) {
    const targets = [];
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      // Must be an ally at that position
      const ally = this.playerUnits.find((u) => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;
      const destC = ac + dc;
      const destR = ar + dr;
      if (destC < 0 || destC >= this.grid.cols || destR < 0 || destR >= this.grid.rows) continue;
      const moveCost = this.grid.getMoveCost(destC, destR, ally.moveType);
      if (moveCost === Infinity) continue;
      if (this.getUnitAt(destC, destR)) continue;
      targets.push({ ally, destCol: destC, destRow: destR, dc, dr });
    }
    return targets;
  }

  findPullTargets(unit) {
    const targets = [];
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find((u) => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;
      // Unit retreats opposite direction
      const retreatC = unit.col - dc;
      const retreatR = unit.row - dr;
      if (retreatC < 0 || retreatC >= this.grid.cols || retreatR < 0 || retreatR >= this.grid.rows)
        continue;
      const retreatCost = this.grid.getMoveCost(retreatC, retreatR, unit.moveType);
      if (retreatCost === Infinity) continue;
      // Ally moves to unit's old position -- passable for ally?
      const allyDestCost = this.grid.getMoveCost(unit.col, unit.row, ally.moveType);
      if (allyDestCost === Infinity) continue;
      if (this.getUnitAt(retreatC, retreatR)) continue;
      targets.push({ ally, retreatCol: retreatC, retreatRow: retreatR, dc, dr });
    }
    return targets;
  }

  findTradeTargets(unit) {
    const targets = [];
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find((u) => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;

      // Both units must have items OR space for items
      const unitHasItems = (unit.inventory?.length || 0) + (unit.consumables?.length || 0) > 0;
      const allyHasItems = (ally.inventory?.length || 0) + (ally.consumables?.length || 0) > 0;
      const unitHasSpace =
        (unit.inventory?.length || 0) < INVENTORY_MAX ||
        (unit.consumables?.length || 0) < CONSUMABLE_MAX;
      const allyHasSpace =
        (ally.inventory?.length || 0) < INVENTORY_MAX ||
        (ally.consumables?.length || 0) < CONSUMABLE_MAX;

      if ((unitHasItems && allyHasSpace) || (allyHasItems && unitHasSpace)) {
        targets.push({ ally });
      }
    }
    return targets;
  }

  findSwapTargets(unit) {
    const targets = [];
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find((u) => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;

      // Check if both positions are walkable by both units
      const unitCanWalkToAlly = this.grid.getMoveCost(ac, ar, unit.moveType) !== Infinity;
      const allyCanWalkToUnit =
        this.grid.getMoveCost(unit.col, unit.row, ally.moveType) !== Infinity;

      if (unitCanWalkToAlly && allyCanWalkToUnit) {
        targets.push({ ally });
      }
    }
    return targets;
  }

  findDanceTargets(unit) {
    const targets = [];
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find((u) => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;

      // Must have acted AND not be another dancer
      if (ally.hasActed && !ally.skills?.includes('dance')) {
        targets.push({ ally });
      }
    }
    return targets;
  }

  findBreakTargets(unit) {
    const targets = [];
    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const { dc, dr } of dirs) {
      const col = unit.col + dc;
      const row = unit.row + dr;
      if (col < 0 || col >= this.grid.cols || row < 0 || row >= this.grid.rows) continue;
      if (this.getUnitAt(col, row)) continue;
      if (this.grid.isTemporaryTerrainAt?.(col, row, TERRAIN.Wall)) {
        targets.push({ col, row });
      }
    }
    return targets;
  }

  executeShove(unit, target) {
    this.commitVisionSnapshotIfPending();
    this.hideActionMenu();
    const pos = this.grid.gridToPixel(target.destCol, target.destRow);
    const targets = target.ally.label
      ? [target.ally.graphic, target.ally.label]
      : [target.ally.graphic];
    this.tweens.add({
      targets,
      x: pos.x,
      y: pos.y,
      duration: 80,
      ease: 'Linear',
      onComplete: () => {
        target.ally.col = target.destCol;
        target.ally.row = target.destRow;
        this.updateUnitPosition(target.ally);
        this.finishUnitAction(unit);
      },
    });
  }

  executePull(unit, target) {
    this.commitVisionSnapshotIfPending();
    this.hideActionMenu();
    // Move both simultaneously: unit retreats, ally moves to unit's old spot
    const unitPos = this.grid.gridToPixel(target.retreatCol, target.retreatRow);
    const allyPos = this.grid.gridToPixel(unit.col, unit.row);
    const unitTargets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];
    const allyTargets = target.ally.label
      ? [target.ally.graphic, target.ally.label]
      : [target.ally.graphic];
    const allyDestCol = unit.col;
    const allyDestRow = unit.row;
    this.tweens.add({
      targets: unitTargets,
      x: unitPos.x,
      y: unitPos.y,
      duration: 80,
      ease: 'Linear',
    });
    this.tweens.add({
      targets: allyTargets,
      x: allyPos.x,
      y: allyPos.y,
      duration: 80,
      ease: 'Linear',
      onComplete: () => {
        unit.col = target.retreatCol;
        unit.row = target.retreatRow;
        target.ally.col = allyDestCol;
        target.ally.row = allyDestRow;
        this.updateUnitPosition(unit);
        this.updateUnitPosition(target.ally);
        this.finishUnitAction(unit);
      },
    });
  }

  startBreakTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_BREAK_TARGET';
    this.breakTargets = this.findBreakTargets(unit);
    const tiles = this.breakTargets.map((t) => ({ col: t.col, row: t.row }));
    this.grid.showAttackRange(tiles, 0xffaa44, 0.45);
  }

  handleBreakTargetClick(gp) {
    const target = this.breakTargets?.find((t) => t.col === gp.col && t.row === gp.row);
    if (!target) return;
    this.grid.clearAttackHighlights();
    this.executeBreak(this.selectedUnit, target);
  }

  executeBreak(unit, target) {
    this.hideActionMenu();
    const removed = this.grid.clearTemporaryTerrainAt?.(target.col, target.row);
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_hit');
    if (removed) {
      const pos = this.grid.gridToPixel(target.col, target.row);
      this.showMinorHintAt(pos.x, pos.y, 'Break!', '#ffcc66');
    }
    this.finishUnitAction(unit, { skipCanto: true });
  }

  startTradeTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_TRADE_TARGET';
    this.tradeTargets = this.findTradeTargets(unit);
    const tiles = this.tradeTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  executeTrade(unit, target) {
    this.hideActionMenu();
    this.tradeMutatedThisSession = false;
    this.showBattleTradeUI(unit, target.ally);
  }

  showBattleTradeUI(unitA, unitB) {
    if (this.inspectionPanel) this.inspectionPanel.hide();
    const cam = this.cameras.main;
    this.battleState = 'TRADING';

    // Dark overlay
    const overlay = this.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.7)
      .setDepth(400)
      .setInteractive();
    this.tradeUIObjects = [overlay];

    // Title
    const title = this.add
      .text(cam.centerX, 30, 'TRADE ITEMS', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(401);
    this.tradeUIObjects.push(title);

    // Unit names
    const leftName = this.add
      .text(160, 60, unitA.name, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#e0e0e0',
      })
      .setOrigin(0.5)
      .setDepth(401);
    const rightName = this.add
      .text(480, 60, unitB.name, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#e0e0e0',
      })
      .setOrigin(0.5)
      .setDepth(401);
    const leftCounts = this.add
      .text(
        160,
        76,
        `Inventory ${(unitA.inventory || []).length}/${INVENTORY_MAX} | Consumables ${(unitA.consumables || []).length}/${CONSUMABLE_MAX}`,
        { fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa' },
      )
      .setOrigin(0.5)
      .setDepth(401);
    const rightCounts = this.add
      .text(
        480,
        76,
        `Inventory ${(unitB.inventory || []).length}/${INVENTORY_MAX} | Consumables ${(unitB.consumables || []).length}/${CONSUMABLE_MAX}`,
        { fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa' },
      )
      .setOrigin(0.5)
      .setDepth(401);
    this.tradeUIObjects.push(leftName, rightName, leftCounts, rightCounts);

    // Two-column item lists (weapons + consumables)
    let yOffset = 90;
    const drawItems = (unit, x, otherUnit) => {
      const inventory = unit.inventory || [];
      const consumables = unit.consumables || [];

      // Weapons
      inventory.forEach((item, i) => {
        const hasCapacity = (otherUnit.inventory?.length || 0) < INVENTORY_MAX;
        const noProf = !hasProficiency(otherUnit, item);
        const suffix = noProf ? ' (no prof)' : '';
        const color = hasCapacity ? (noProf ? '#cc8844' : '#e0e0e0') : '#666666';
        const btn = this.add
          .text(x, yOffset + i * 20, item.name + suffix, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color,
            backgroundColor: '#222222',
            padding: { x: 6, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(401);

        if (hasCapacity) {
          btn.setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#ffdd44'));
          btn.on('pointerout', () => btn.setColor(color));
          btn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            if ((otherUnit.inventory?.length || 0) < INVENTORY_MAX) {
              removeFromInventory(unit, item);
              addToInventory(otherUnit, item);
              if (!this.tradeMutatedThisSession) {
                this.tradeMutatedThisSession = true;
                this.preMoveLoc = null;
                this.commitVisionSnapshotIfPending();
              }
              this.cleanupTradeUI();
              this.showBattleTradeUI(unitA, unitB);
            }
          });
        }
        this.tradeUIObjects.push(btn);
      });

      // Consumables (below weapons)
      const consumableOffset = inventory.length * 20;
      consumables.forEach((item, i) => {
        const hasCapacity = (otherUnit.consumables?.length || 0) < CONSUMABLE_MAX;
        const color = hasCapacity ? '#88ccff' : '#666666';
        const suffix = hasCapacity ? '' : ' (consumables full)';
        const btn = this.add
          .text(x, yOffset + consumableOffset + i * 20, `${item.name}${suffix}`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color,
            backgroundColor: '#222222',
            padding: { x: 6, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(401);

        if (hasCapacity) {
          btn.setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#ffdd44'));
          btn.on('pointerout', () => btn.setColor(color));
          btn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            const idx = unit.consumables.indexOf(item);
            if (idx !== -1) unit.consumables.splice(idx, 1);
            if (!otherUnit.consumables) otherUnit.consumables = [];
            otherUnit.consumables.push(item);
            if (!this.tradeMutatedThisSession) {
              this.tradeMutatedThisSession = true;
              this.preMoveLoc = null;
              this.commitVisionSnapshotIfPending();
            }
            this.cleanupTradeUI();
            this.showBattleTradeUI(unitA, unitB);
          });
        }
        this.tradeUIObjects.push(btn);
      });
    };

    drawItems(unitA, 160, unitB);
    drawItems(unitB, 480, unitA);

    // Done button
    const doneBtn = this.add
      .text(cam.centerX, cam.height - 40, '[ Done ]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 16, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(401)
      .setInteractive({ useHandCursor: true });
    doneBtn.on('pointerover', () => doneBtn.setColor('#ffdd44'));
    doneBtn.on('pointerout', () => doneBtn.setColor('#e0e0e0'));
    doneBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      this.cleanupTradeUI();
      const tradeMutated = this.tradeMutatedThisSession;
      this.showActionMenu(unitA);
      this.tradeMutatedThisSession = tradeMutated;
    });
    this.tradeUIObjects.push(doneBtn);
    this._pinToScreen(this.tradeUIObjects);
  }

  cleanupTradeUI() {
    if (this.tradeUIObjects) {
      this.tradeUIObjects.forEach((obj) => obj.destroy());
      this.tradeUIObjects = null;
    }
  }

  startSwapTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_SWAP_TARGET';
    this.swapTargets = this.findSwapTargets(unit);
    const tiles = this.swapTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  executeSwap(unit, target) {
    this.commitVisionSnapshotIfPending();
    this.hideActionMenu();
    const unitPos = this.grid.gridToPixel(target.ally.col, target.ally.row);
    const allyPos = this.grid.gridToPixel(unit.col, unit.row);
    const unitTargets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];
    const allyTargets = target.ally.label
      ? [target.ally.graphic, target.ally.label]
      : [target.ally.graphic];

    // Store positions for swap
    const unitOldCol = unit.col,
      unitOldRow = unit.row;
    const allyOldCol = target.ally.col,
      allyOldRow = target.ally.row;

    // Animate both units simultaneously
    this.tweens.add({
      targets: unitTargets,
      x: unitPos.x,
      y: unitPos.y,
      duration: 120,
      ease: 'Quad.easeInOut',
    });
    this.tweens.add({
      targets: allyTargets,
      x: allyPos.x,
      y: allyPos.y,
      duration: 120,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        const allyWasActed = target.ally.hasActed;
        unit.col = allyOldCol;
        unit.row = allyOldRow;
        target.ally.col = unitOldCol;
        target.ally.row = unitOldRow;
        this.updateUnitPosition(unit);
        this.updateUnitPosition(target.ally);
        this.finishUnitAction(unit);
        if (allyWasActed) this.dimUnit(target.ally);
      },
    });
  }

  startDanceTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_DANCE_TARGET';
    this.danceTargets = this.findDanceTargets(unit);
    const tiles = this.danceTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff88, 0.4);
  }

  async executeDance(unit, target) {
    this.commitVisionSnapshotIfPending();
    this.hideActionMenu();
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');

    // Visual feedback: brief sparkle/glow on target
    const pos = this.grid.gridToPixel(target.ally.col, target.ally.row);
    const sparkle = this.add
      .circle(pos.x, pos.y, 20, 0x44ff88, this._isReducedEffects() ? 0.4 : 0.6)
      .setDepth(200);
    if (this._isReducedEffects()) {
      this.time.delayedCall(120, () => sparkle.destroy());
    } else {
      this.tweens.add({
        targets: sparkle,
        alpha: 0,
        scale: 1.5,
        duration: 400,
        ease: 'Quad.easeOut',
        onComplete: () => sparkle.destroy(),
      });
    }

    // Reset target's action state
    target.ally.hasMoved = false;
    target.ally.hasActed = false;
    this.undimUnit(target.ally);

    try {
      await this.awardScaledXP(unit, XP_BASE_DANCE);
    } finally {
      // Dancer ends turn
      this.finishUnitAction(unit);
    }
  }

  startShoveTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_SHOVE_TARGET';
    this.shoveTargets = this.findShoveTargets(unit);
    const tiles = this.shoveTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  startPullTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_PULL_TARGET';
    this.pullTargets = this.findPullTargets(unit);
    const tiles = this.pullTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  startCantoMove(unit, remainingMov) {
    this._resetCantoPreInitFaultTracking();
    this.battleState = 'CANTO_MOVING';
    const positions = this.buildUnitPositionMap(unit.faction);
    const moveRange = this.grid.getMovementRange(
      unit.col,
      unit.row,
      remainingMov,
      unit.moveType,
      positions,
      unit.faction,
      this._getCostModifier(unit),
    );
    this.grid.showMovementRange(moveRange, unit.col, unit.row, 0x44aaff, 0.3);
    this.cantoRange = moveRange;
  }

  handleShoveTargetClick(gp) {
    const target = this.shoveTargets.find((t) => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      this.grid.clearAttackHighlights();
      this.executeShove(this.selectedUnit, target);
    }
  }

  handlePullTargetClick(gp) {
    const target = this.pullTargets.find((t) => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      this.grid.clearAttackHighlights();
      this.executePull(this.selectedUnit, target);
    }
  }

  handleTradeTargetClick(gp) {
    const target = this.tradeTargets.find((t) => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      this.grid.clearAttackHighlights();
      this.executeTrade(this.selectedUnit, target);
    }
  }

  handleSwapTargetClick(gp) {
    const target = this.swapTargets.find((t) => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      this.grid.clearAttackHighlights();
      this.executeSwap(this.selectedUnit, target);
    }
  }

  async handleDanceTargetClick(gp) {
    const target = this.danceTargets.find((t) => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      this.grid.clearAttackHighlights();
      await this.executeDance(this.selectedUnit, target);
    }
  }

  handleCantoClick(gp) {
    const unit = this.selectedUnit;
    // Click own tile or W key = skip Canto
    if (gp.col === unit.col && gp.row === unit.row) {
      this.grid.clearHighlights();
      this.cantoRange = null;
      this._resetCantoPreInitFaultTracking();
      this.dimUnit(unit);
      this.selectedUnit = null;
      this.battleState = 'PLAYER_IDLE';
      this.turnManager.unitActed(unit);
      return;
    }
    const key = `${gp.col},${gp.row}`;
    const cantoEntry = this.cantoRange?.get(key);
    if (!cantoEntry || cantoEntry.stoppable === false) return;
    // Animate Canto movement
    const from = { col: unit.col, row: unit.row };
    const to = { col: gp.col, row: gp.row };
    let path;
    try {
      // Prefer Dijkstra reconstruction from cantoRange (ice-aware)
      path = this.grid.reconstructIcePath(this.cantoRange, unit.col, unit.row, gp.col, gp.row);
      if (!path || path.length < 2) {
        // Fallback to A* for non-ice paths
        const positions = this.buildUnitPositionMap(unit.faction);
        path = this.grid.findPath(
          unit.col,
          unit.row,
          gp.col,
          gp.row,
          unit.moveType,
          positions,
          unit.faction,
          this._getCostModifier(unit),
        );
      }
    } catch (err) {
      const retryCount = this._recordCantoPreInitFault(unit);
      console.error('[handleCantoClick] Error during canto path initialization', {
        unit: unit?.name || unit?.id || '<unknown>',
        from,
        to,
        battleState: this.battleState,
        retryCount,
        stack: err?.stack || null,
      });
      if (retryCount >= 2) {
        console.error(
          '[handleCantoClick] Failing closed after repeated canto path initialization errors',
          {
            unit: unit?.name || unit?.id || '<unknown>',
            from,
            to,
            battleState: this.battleState,
            retryCount,
          },
        );
        this._recoverFromMovementFault(unit, {
          context: 'handleCantoClick',
          reason: 'Repeated canto path initialization errors',
          error: err,
        });
      }
      return;
    }
    this._resetCantoPreInitFaultTracking();
    if (!path || path.length < 2) {
      console.warn('[handleCantoClick] findPath returned null/short path for canto destination', {
        unit: unit?.name || unit?.id || '<unknown>',
        from,
        to,
        battleState: this.battleState,
      });
      return;
    }
    // Apply computeEffectivePath for ice slides
    const cantoOccupied = this.buildOccupiedSet(unit);
    const cantoEffective = computeEffectivePath(
      path,
      this.grid.mapLayout,
      this.grid.terrainData,
      this.grid.cols,
      this.grid.rows,
      unit.moveType,
      cantoOccupied,
      this._getCostModifier(unit),
    );
    const cantoFinalPath = cantoEffective.effectivePath;
    if (!cantoFinalPath || cantoFinalPath.length < 2) {
      console.warn('[handleCantoClick] effectivePath returned null/short path', { from, to });
      return;
    }
    this.battleState = 'UNIT_MOVING';
    const targets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];
    const cantoDest = cantoFinalPath[cantoFinalPath.length - 1];
    const destCol = cantoDest.col;
    const destRow = cantoDest.row;
    let recoveryTriggered = false;
    let finalizeTriggered = false;
    const failCantoMove = (reason, error = null) => {
      if (recoveryTriggered) return;
      recoveryTriggered = true;
      this._recoverFromMovementFault(unit, {
        context: 'handleCantoClick',
        reason,
        error,
      });
    };
    const finalizeCantoMove = () => {
      if (finalizeTriggered || recoveryTriggered) return;
      finalizeTriggered = true;
      unit.col = destCol;
      unit.row = destRow;
      try {
        this.updateUnitPosition(unit);
        if (this.grid.fogEnabled) {
          this.grid.updateFogOfWar(this.playerUnits);
          this.updateEnemyVisibility();
        }
        this.cantoRange = null;
        this._resetCantoPreInitFaultTracking();
        this.dimUnit(unit);
        this.selectedUnit = null;
        this.battleState = 'PLAYER_IDLE';
        this.turnManager.unitActed(unit);
      } catch (err) {
        failCantoMove('Error while finalizing canto move', err);
      }
    };
    const animateStep = (stepIndex) => {
      if (recoveryTriggered) return;
      if (stepIndex >= cantoFinalPath.length) {
        finalizeCantoMove();
        return;
      }
      try {
        const pos = this.grid.gridToPixel(
          cantoFinalPath[stepIndex].col,
          cantoFinalPath[stepIndex].row,
        );
        const isSlide = cantoEffective.slideSegments.some(
          (seg) => stepIndex >= seg.startIndex && stepIndex < seg.startIndex + seg.slidePath.length,
        );
        const duration = isSlide ? 60 : 80;
        this.tweens.add({
          targets,
          x: pos.x,
          y: pos.y,
          duration,
          ease: 'Linear',
          onComplete: () => {
            try {
              animateStep(stepIndex + 1);
            } catch (err) {
              failCantoMove('Error during canto tween completion', err);
            }
          },
        });
      } catch (err) {
        failCantoMove('Error while creating canto tween', err);
      }
    };
    try {
      this.grid.clearHighlights();
      const fallbackMs = Math.max(500, path.length * 140);
      this.time.delayedCall(fallbackMs, () => {
        if (!finalizeTriggered && !recoveryTriggered && this.scene?.isActive?.()) {
          console.warn('[handleCantoClick] Fallback timer triggered - canto animation stalled');
          finalizeCantoMove();
        }
      });
      animateStep(1);
    } catch (err) {
      failCantoMove('Error during canto animation setup', err);
    }
  }

  // --- Action Menu ---

  _clampMenuPosition(preferredX, preferredY, menuWidth, menuHeight) {
    const pad = 4;
    const cam = this.cameras.main;
    const maxX = cam.width - menuWidth - pad;
    const maxY = cam.height - menuHeight - pad;
    const screenPos =
      typeof this._worldToScreen === 'function'
        ? this._worldToScreen(preferredX, preferredY) || { x: preferredX, y: preferredY }
        : { x: preferredX, y: preferredY };
    const clampedScreenX = Math.max(pad, Math.min(screenPos.x, maxX));
    const clampedScreenY = Math.max(pad, Math.min(screenPos.y, maxY));
    return {
      x: clampedScreenX,
      y: clampedScreenY,
    };
  }

  _makeMenuTextButton(x, y, label, textStyle, defaultColor, onClick, options = {}) {
    const {
      depth = 401,
      originX = 0.5,
      originY = 0.5,
      hitWidth = 0,
      hitHeight = 28,
      hoverColor = '#ffdd44',
      clickOnPointerUp = false,
    } = options;

    const text = this.add.text(x, y, label, textStyle).setOrigin(originX, originY).setDepth(depth);

    if (hitWidth > 0) {
      text.setInteractive(
        new Phaser.Geom.Rectangle(-hitWidth * originX, -hitHeight * originY, hitWidth, hitHeight),
        Phaser.Geom.Rectangle.Contains,
      );
    } else {
      text.setInteractive({ useHandCursor: true });
    }
    text.on('pointerover', () => text.setColor(hoverColor));
    text.on('pointerout', () => text.setColor(defaultColor));
    if (clickOnPointerUp) {
      text._armedPointerUpClick = false;
      text.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        text.setColor(hoverColor);
        this._uiClickBlocked = true;
        text._armedPointerUpClick = true;
      });
      text.on('pointerout', () => {
        text._armedPointerUpClick = false;
      });
      text.on('pointerup', (pointer) => {
        if (pointer?.button !== 0) return;
        if (!text._armedPointerUpClick) return;
        text._armedPointerUpClick = false;
        if (text._suppressNextClick) {
          text._suppressNextClick = false;
          return;
        }
        onClick();
      });
    } else {
      text.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        text.setColor(hoverColor);
        this._uiClickBlocked = true;
        onClick();
      });
    }
    return text;
  }

  _clearMenuTooltipTimer(key) {
    const timer = this[key];
    if (!timer) return;
    timer.remove(false);
    this[key] = null;
  }

  _hideMenuTooltip() {
    this._clearMenuTooltipTimer('_menuTooltipHoverTimer');
    this._clearMenuTooltipTimer('_menuTooltipPressTimer');
    if (this._menuTooltip) {
      this._menuTooltip.destroy();
      this._menuTooltip = null;
    }
  }

  _showWeaponDetailTooltip(wpn, menuRect, itemY) {
    if (!wpn) return;
    this._hideWeaponDetailTooltip();
    const might = Number.isFinite(Number(wpn?.might)) ? Number(wpn.might) : 0;
    const hit = Number.isFinite(Number(wpn?.hit)) ? Number(wpn.hit) : 0;
    const crit = Number.isFinite(Number(wpn?.crit)) ? Number(wpn.crit) : 0;
    const weight = Number.isFinite(Number(wpn?.weight)) ? Number(wpn.weight) : 0;
    const range =
      typeof wpn?.range === 'string' && wpn.range.trim().length > 0 ? wpn.range.trim() : '1';
    const lines = [];
    if (wpn.type) lines.push(wpn.type);
    lines.push(`${might}Mt ${hit}Hit ${crit}Crt`);
    lines.push(`${weight}Wt Rng${range}`);
    if (wpn.special) {
      const specialLines = this._formatSpecialLinesForUi(wpn.special, 28, 2);
      lines.push(...specialLines);
    }
    lines.push(...getWeaponArtTooltipLines(wpn, this._getWeaponArtCatalog()));
    const body = lines.join('\n');
    const padding = 6;
    const maxWidth = 160;
    const txt = this.add
      .text(0, 0, body, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e0e0e0',
        wordWrap: { width: maxWidth - padding * 2 },
      })
      .setDepth(450);
    const bg = this.add
      .rectangle(0, 0, txt.width + padding * 2, txt.height + padding * 2, 0x222222, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0x666666)
      .setDepth(449);
    const box = this.add.container(0, 0, [bg, txt]).setDepth(449);
    txt.setPosition(padding, padding);
    let x = menuRect.x + menuRect.width + 4;
    let y = itemY - bg.height / 2;
    if (x + bg.width > this.cameras.main.width - 4) x = menuRect.x - bg.width - 4;
    if (x < 4) x = 4;
    if (y + bg.height > this.cameras.main.height - 4) y = this.cameras.main.height - bg.height - 4;
    if (y < 4) y = 4;
    box.setPosition(x, y);
    this._pinToScreen(box);
    this._weaponDetailTooltip = box;
  }

  _hideWeaponDetailTooltip() {
    if (this._weaponDetailTooltip) {
      this._weaponDetailTooltip.destroy();
      this._weaponDetailTooltip = null;
    }
  }

  _showWeaponArtTooltip(anchorText, art) {
    (this._weaponArtController ||= new WeaponArtController(this))._showWeaponArtTooltip(
      anchorText,
      art,
    );
  }

  _wireWeaponArtTooltip(text, art) {
    (this._weaponArtController ||= new WeaponArtController(this))._wireWeaponArtTooltip(text, art);
  }

  _isReducedEffects() {
    const settings = this.registry.get('settings');
    return !!settings?.getReducedEffects?.();
  }

  showActionMenu(unit) {
    this.hideActionMenu();
    this.inEquipMenu = false;
    this.tradeMutatedThisSession = false;
    this.battleState = 'UNIT_ACTION_MENU';

    const normalAttackTargets = this.findAttackTargets(unit);
    const usableStaves = this.getUsableStaves(unit);
    const healOptions = usableStaves
      .map((staff) => ({ staff, targets: this.findHealTargets(unit, staff) }))
      .filter((option) => option.targets.length > 0);
    const preferredHealOption =
      healOptions.find((option) => option.staff === unit.weapon) || healOptions[0] || null;

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = unit.col < this.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 60;
    const menuY = pos.y - 10;

    this.actionMenu = [];

    // Build dynamic item list
    const items = [];
    const silenced = isSilenced(unit);
    // Silence blocks Attack if unit only has magic weapons (Tome/Light)
    if (normalAttackTargets.length > 0) {
      const combatWeapons = getCombatWeapons(unit);
      const hasPhysical = combatWeapons.some(
        (w) => w.type !== 'Tome' && w.type !== 'Light' && w.type !== 'Staff' && w.type !== 'Breath',
      );
      if (!silenced || hasPhysical) items.push('Attack');
    }
    const artWeapon =
      unit.weapon && !isStaff(unit.weapon) ? unit.weapon : getCombatWeapons(unit)[0];
    // Silence blocks weapon arts
    if (!silenced && this._hasUsableWeaponArtTargets(unit, artWeapon, { isInitiating: true })) {
      const activeArt = this._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
      items.push(activeArt ? `Weapon Art: ${activeArt.name}` : 'Weapon Art');
    }
    // Silence blocks staff healing
    if (!silenced && preferredHealOption) {
      const staff = preferredHealOption.staff;
      const rem = getStaffRemainingUses(staff, unit);
      const max = getStaffMaxUses(staff, unit);
      items.push(`Heal (${rem}/${max})`);
    }
    const equipMenuItems = unit.inventory.filter(
      (item) =>
        item.type !== 'Consumable' &&
        item.type !== 'Scroll' &&
        (canEquip(unit, item) || !hasProficiency(unit, item)),
    );
    if (equipMenuItems.length >= 2) items.push('Equip');
    if (
      canPromote(unit) &&
      resolvePromotionTargetClass(unit, this.gameData.classes, this.gameData.lords) &&
      this.getPromotionConsumable(unit)
    )
      items.push('Promote');
    const usableReclassSeals = this.getUsableReclassConsumables(unit);
    if (usableReclassSeals.length === 1) items.push('Reclass');
    // Item: show if unit has consumables
    const consumables = unit.consumables || [];
    if (consumables.length > 0) items.push('Item');
    // Shove/Pull: show if unit has skill and valid targets exist
    if (unit.skills?.includes('shove') && this.findShoveTargets(unit).length > 0)
      items.push('Shove');
    if (unit.skills?.includes('pull') && this.findPullTargets(unit).length > 0) items.push('Pull');
    // Trade: show if adjacent ally with items/space exists
    if (this.findTradeTargets(unit).length > 0) items.push('Trade');
    // Swap: show if adjacent ally on walkable terrain exists
    if (this.findSwapTargets(unit).length > 0) items.push('Swap');
    // Dance: show if unit has skill and valid targets exist
    if (unit.skills?.includes('dance') && this.findDanceTargets(unit).length > 0)
      items.push('Dance');
    // Break: adjacent temporary wall terrain (Waller)
    if (this.findBreakTargets(unit).length > 0) items.push('Break');
    // Talk: Lord adjacent to NPC, roster not full
    if (unit.isLord && this.npcUnits.length > 0) {
      const talkTarget = this.findTalkTarget(unit);
      const rosterCap =
        this.runManager?.getRosterCap?.() ??
        ROSTER_CAP + (this.runManager?.metaEffects?.rosterCapBonus || 0);
      const fullRosterCount =
        (this.runManager?.roster?.length ?? this.playerUnits.length) -
        (this._playerDeathsThisBattle || 0);
      if (talkTarget && fullRosterCount < rosterCap) {
        items.push('Talk');
      }
    }
    // Seize: Lord on throne, boss dead
    if (this.battleConfig.objective === 'seize' && unit.isLord) {
      const throne = this.battleConfig.thronePos;
      const bossAlive = this.enemyUnits.some((u) => u.isBoss && u.currentHP > 0);
      if (throne && unit.col === throne.col && unit.row === throne.row && !bossAlive) {
        items.push('Seize');
      }
    }
    // Capture: unit on enemy ballista tile
    if (this.ballistas?.length > 0) {
      const ballista = this.ballistas.find(
        (b) => b.col === unit.col && b.row === unit.row && b.owner === 'enemy',
      );
      if (ballista) items.push('Capture');
    }
    items.push('Wait');

    const longestLabel = Math.max(...items.map((l) => l.length));
    const menuWidth = Math.max(70, longestLabel * 8 + 16);
    let itemHeight = this.isMobileInput ? 38 : 28;
    let menuHeight = items.length * itemHeight + 8;
    // Overflow guard: shrink rows if menu exceeds viewport
    if (this.isMobileInput) {
      const maxMenuH = this.cameras.main.height - 16;
      if (menuHeight > maxMenuH) {
        itemHeight = Math.max(24, Math.floor((maxMenuH - 8) / items.length));
        menuHeight = items.length * itemHeight + 8;
      }
    }
    const menuPos = this._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);

    const bg = this.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.85,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    items.forEach((label, i) => {
      const itemY = menuPos.y + 4 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + menuWidth / 2;
      const text = this._makeMenuTextButton(
        itemX,
        itemY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#e0e0e0',
        },
        '#e0e0e0',
        () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          if (label === 'Attack') {
            // Auto-equip first combat weapon if staff is currently equipped
            if (unit.weapon && isStaff(unit.weapon)) {
              const combatWpn = getCombatWeapons(unit)[0];
              if (combatWpn) {
                equipWeapon(unit, combatWpn);
                this.showAutoSwitchTooltip(unit, combatWpn);
              }
            }
            this._clearSelectedWeaponArtIfInvalid(unit);
            this._beginAttackSelection(unit);
          } else if (label.startsWith('Weapon Art')) {
            if (unit.weapon && isStaff(unit.weapon)) {
              const combatWpn = getCombatWeapons(unit)[0];
              if (combatWpn) {
                equipWeapon(unit, combatWpn);
                this.showAutoSwitchTooltip(unit, combatWpn);
              }
            }
            this.showWeaponArtPicker(unit);
          } else if (label.startsWith('Heal')) {
            this.hideActionMenu();
            if (healOptions.length >= 2) {
              this.showStaffPicker(
                unit,
                healOptions.map((option) => option.staff),
              );
            } else if (healOptions.length === 1) {
              const option = healOptions[0];
              this.startHealTargetSelection(unit, option.targets, option.staff);
            } else {
              this.showActionMenu(unit);
            }
          } else if (label === 'Equip') {
            this.showEquipMenu(unit);
          } else if (label === 'Promote') {
            this.hideActionMenu();
            this.executePromotion(unit, this.getPromotionConsumable(unit));
          } else if (label === 'Reclass') {
            this.hideActionMenu();
            const [soleSeal] = this.getUsableReclassConsumables(unit);
            if (soleSeal) this.showReclassClassPicker(unit, soleSeal);
            else this.showActionMenu(unit);
          } else if (label === 'Item') {
            this.showItemMenu(unit);
          } else if (label === 'Talk') {
            this.hideActionMenu();
            this.executeTalk(unit);
          } else if (label === 'Seize') {
            this.hideActionMenu();
            this.commitVisionSnapshotIfPending();
            this.onVictory();
          } else if (label === 'Capture') {
            this.hideActionMenu();
            this.commitVisionSnapshotIfPending();
            const ballista = this.ballistas?.find((b) => b.col === unit.col && b.row === unit.row);
            if (ballista) {
              ballista.owner = 'player';
              ballista.captured = true;
              this.dangerZoneStale = true;
              if (this.dangerZone?.visible) {
                this.dangerZoneCache = this.calculateDangerZone();
                this.dangerZoneStale = false;
                this.dangerZone.show(this.dangerZoneCache);
              }
            }
            unit.hasActed = true;
            this.finishUnitAction(unit);
          } else if (label === 'Shove') {
            this.startShoveTargetSelection(unit);
          } else if (label === 'Pull') {
            this.startPullTargetSelection(unit);
          } else if (label === 'Trade') {
            this.startTradeTargetSelection(unit);
          } else if (label === 'Swap') {
            this.startSwapTargetSelection(unit);
          } else if (label === 'Dance') {
            this.startDanceTargetSelection(unit);
          } else if (label === 'Break') {
            this.startBreakTargetSelection(unit);
          } else if (label === 'Wait') {
            this.finishUnitAction(unit, { skipCanto: true });
          }
        },
        { hitWidth: menuWidth - 10, hitHeight: itemHeight },
      );

      this.actionMenu.push(text);
    });
    this._pinToScreen(this.actionMenu);
  }

  hideActionMenu() {
    this._hideMenuTooltip();
    this._hideWeaponDetailTooltip();
    this._weaponPreviewedItem = null;
    if (this._actionMenuWheelHandler && this.input?.off) {
      this.input.off('wheel', this._actionMenuWheelHandler);
      this._actionMenuWheelHandler = null;
    }
    if (this.actionMenu) {
      this.actionMenu.forEach((obj) => obj.destroy());
      this.actionMenu = null;
    }
  }

  getPromotionConsumable(unit) {
    if (!unit?.consumables?.length) return null;
    return (
      unit.consumables.find((item) => item?.effect === 'promote' && (item.uses ?? 0) > 0) || null
    );
  }

  getReclassConsumable(unit) {
    if (!unit?.consumables?.length) return null;
    return (
      unit.consumables.find((item) => item?.effect === 'reclass' && (item.uses ?? 0) > 0) || null
    );
  }

  getReclassConsumables(unit) {
    if (!unit?.consumables?.length) return [];
    return unit.consumables.filter((item) => item?.effect === 'reclass' && (item.uses ?? 0) > 0);
  }

  getUsableReclassConsumables(unit) {
    if (!canReclass(unit)) return [];
    return this.getReclassConsumables(unit).filter(
      (seal) => getReclassTargets(unit, this.gameData.classes, seal.subEffect).length > 0,
    );
  }

  undoMove(unit) {
    if (!shouldAllowUndoMove(this.preMoveLoc, this.tradeMutatedThisSession)) {
      this.deselectUnit();
      return;
    }

    // Return unit to original position
    const { col, row } = this.preMoveLoc;
    unit.col = col;
    unit.row = row;
    unit.hasMoved = false;
    unit._movementSpent = 0;
    this.updateUnitPosition(unit);
    if (this.grid.fogEnabled && unit.faction === 'player') {
      this.grid.restoreFogState(this._preFogSnapshot);
      this._preFogSnapshot = null;
      this.grid.updateFogOfWar(this.playerUnits);
      this.updateEnemyVisibility();
    }

    // Re-select the unit so they can choose again
    this.preMoveLoc = null;
    this.selectUnit(unit);
  }

  // --- Talk / Recruit ---

  findTalkTarget(unit) {
    for (const npc of this.npcUnits) {
      const dist = Math.abs(unit.col - npc.col) + Math.abs(unit.row - npc.row);
      if (dist === 1) return npc;
    }
    return null;
  }

  async executeTalk(lord) {
    const npc = this.findTalkTarget(lord);
    if (!npc) {
      this.finishUnitAction(lord);
      return;
    }

    this.battleState = 'COMBAT_RESOLVING'; // block input

    // Show recruitment dialogue -- lords get personal lines, others use class-based
    const lordLines = npc.isLord ? this.gameData.dialogue?.lordRecruitLines?.[npc.name] : null;
    const recruitLines = lordLines ||
      this.gameData.dialogue?.recruitLines?.[npc.className] || ['Joined the army!'];
    const line = recruitLines[Math.floor(Math.random() * recruitLines.length)];
    const portraitKey = this._getPortraitKey(npc);
    await this.dialogueOverlay.show(npc.name, line, portraitKey);

    // Remove from NPC array
    const npcIdx = this.npcUnits.indexOf(npc);
    if (npcIdx !== -1) this.npcUnits.splice(npcIdx, 1);

    // Convert faction
    npc.faction = 'player';

    // Destroy and re-create graphics (correct sprite key + tint + HP bar color)
    this.removeUnitGraphic(npc);
    this.addUnitGraphic(npc);

    // Add to player units
    this.playerUnits.push(npc);
    // Recruit can move + act this turn (FE convention); force fresh action flags.
    npc.hasMoved = false;
    npc.hasActed = false;

    this.finishUnitAction(lord);
  }

  // --- Heal flow ---

  getUsableStaves(unit) {
    return unit.inventory.filter(
      (w) => w.type === 'Staff' && canEquip(unit, w) && getStaffRemainingUses(w, unit) > 0,
    );
  }

  onPointerUp(pointer) {
    (this._inputController ||= new InputController(this)).onPointerUp(pointer);
  }

  getActiveHealStaff(unit, usableStaves = null) {
    const usable = usableStaves || this.getUsableStaves(unit);
    if (usable.length === 0) return null;
    if (unit.weapon && usable.includes(unit.weapon)) return unit.weapon;
    return usable[0];
  }

  findHealTargets(unit, staffOverride = null) {
    if (!hasStaff(unit)) return [];
    const staff = staffOverride || this.getActiveHealStaff(unit);
    if (!staff) return [];
    const range = getEffectiveStaffRange(staff, unit);
    const targets = [];
    for (const ally of this.playerUnits) {
      if (ally === unit) continue; // Can't heal self
      if (ally.currentHP >= ally.stats.HP) continue; // Full HP
      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist >= range.min && dist <= range.max) {
        targets.push(ally);
      }
    }
    return targets;
  }

  startHealTargetSelection(unit, targets, chosenStaff = null) {
    // Auto-equip staff
    const staff = chosenStaff || this.getActiveHealStaff(unit);
    if (staff) equipWeapon(unit, staff);
    if (!staff) {
      this.showActionMenu(unit);
      return;
    }

    // First-heal tutorial hint (one-time per save slot)
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('battle_heal_uses')) {
      showMinorHint(
        this,
        'Staves have limited uses per battle. Uses reset each battle. Higher MAG grants bonus uses.',
      );
    }

    // Fortify: auto-heal all targets, no selection needed
    if (staff.healAll) {
      this.executeHealAll(unit, targets);
      return;
    }

    this.healTargets = targets;
    const healTiles = targets.map((a) => ({ col: a.col, row: a.row }));
    this.grid.showHealRange(healTiles);
    this.battleState = 'SELECTING_HEAL_TARGET';
  }

  _handleCureTargetClick(gp) {
    const target = (this.healTargets || []).find((t) => t.col === gp.col && t.row === gp.row);
    if (!target) return;
    this.grid.clearAttackHighlights();
    this.healTargets = [];
    const item = this._pendingCureItem;
    const user = this._pendingCureUser;
    this._pendingCureItem = null;
    this._pendingCureUser = null;
    if (!item || !user) return;
    this._pendingCureTarget = target;
    this.useConsumable(user, item);
  }

  _startCureTargetSelection(unit, item) {
    this.hideActionMenu();
    this.inEquipMenu = false;
    // Find valid cure targets: self (if has conditions) + adjacent allies with conditions
    const targets = [];
    if ((unit._conditions || []).length > 0) targets.push(unit);
    for (const ally of this.playerUnits) {
      if (
        ally !== unit &&
        ally.currentHP > 0 &&
        !ally._removing &&
        gridDistance(unit.col, unit.row, ally.col, ally.row) === 1 &&
        (ally._conditions || []).length > 0
      ) {
        targets.push(ally);
      }
    }
    if (targets.length === 0) {
      this.showActionMenu(unit);
      return;
    }
    if (targets.length === 1) {
      // Single target -- use immediately
      this._pendingCureTarget = targets[0];
      this.useConsumable(unit, item);
      return;
    }
    // Multiple targets -- show selection highlights
    this._pendingCureItem = item;
    this._pendingCureUser = unit;
    this.healTargets = targets;
    const healTiles = targets.map((a) => ({ col: a.col, row: a.row }));
    this.grid.showHealRange(healTiles);
    this.battleState = 'SELECTING_CURE_TARGET';
  }

  showStaffPicker(unit, usableStaves) {
    this.hideActionMenu();
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = unit.col < this.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 210;
    const menuY = pos.y - 10;

    this.actionMenu = [];
    const menuWidth = 210;
    const itemHeight = this.isMobileInput ? 42 : 36;
    const menuHeight = usableStaves.length * itemHeight + 12;
    const menuPos = this._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);

    const bg = this.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.85,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    usableStaves.forEach((staff, i) => {
      const itemY = menuPos.y + 6 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + 8;
      const marker = staff === unit.weapon ? '\u25b6 ' : '  ';
      const rem = getStaffRemainingUses(staff, unit);
      const max = getStaffMaxUses(staff, unit);
      const rng = getEffectiveStaffRange(staff, unit);
      const label = `${marker}${staff.name}\n   ${rem}/${max} uses  Rng ${rng.min}-${rng.max}`;
      const defaultColor = staff === unit.weapon ? '#ffdd44' : '#e0e0e0';

      const text = this._makeMenuTextButton(
        itemX,
        itemY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: defaultColor,
          lineSpacing: 1,
        },
        defaultColor,
        async () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          equipWeapon(unit, staff);
          const healTargets = this.findHealTargets(unit, staff);
          if (healTargets.length === 0) {
            await this.showBriefBanner('No heal targets in range for that staff.', '#ff8888');
            this.showStaffPicker(unit, usableStaves);
            return;
          }
          this.inEquipMenu = false;
          this.hideActionMenu();
          this.startHealTargetSelection(unit, healTargets, staff);
        },
        { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
      );

      this.actionMenu.push(text);
    });
    this._pinToScreen(this.actionMenu);
  }

  handleHealTargetClick(gp) {
    const target = this.healTargets.find((a) => a.col === gp.col && a.row === gp.row);
    if (target) {
      this.executeHeal(this.selectedUnit, target);
    }
  }

  async executeHeal(healer, target) {
    this.battleState = 'HEAL_RESOLVING';
    this.grid.clearAttackHighlights();

    const staff = healer.weapon; // Should already be equipped
    const healOpts = {
      healingMultiplier:
        this.runManager?.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
    };
    const result = resolveHeal(staff, healer, target, healOpts);

    // Apply heal
    target.currentHP = result.targetHPAfter;
    this.updateHPBar(target);

    // Animate
    await this.animateHeal(target, result.healAmount);

    // Spend a use and check depletion
    spendStaffUse(staff);
    if (getStaffRemainingUses(staff, healer) <= 0) {
      const combatWpn = getCombatWeapons(healer)[0];
      if (combatWpn) equipWeapon(healer, combatWpn);
    }

    try {
      await this.awardScaledXP(healer, XP_BASE_HEAL);
    } finally {
      this.finishUnitAction(healer);
    }
  }

  async executeHealAll(healer, targets) {
    this.battleState = 'HEAL_RESOLVING';
    this.grid.clearAttackHighlights();

    const staff = healer.weapon;
    const healOpts = {
      healingMultiplier:
        this.runManager?.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
    };

    for (const target of targets) {
      const result = resolveHeal(staff, healer, target, healOpts);
      target.currentHP = result.targetHPAfter;
      this.updateHPBar(target);
      await this.animateHeal(target, result.healAmount);
    }

    // Single use spent for all targets
    spendStaffUse(staff);
    if (getStaffRemainingUses(staff, healer) <= 0) {
      const combatWpn = getCombatWeapons(healer)[0];
      if (combatWpn) equipWeapon(healer, combatWpn);
    }

    try {
      await this.awardScaledXP(healer, XP_BASE_HEAL);
    } finally {
      this.finishUnitAction(healer);
    }
  }

  async animateHeal(target, healAmount) {
    const reduced = this._isReducedEffects();
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    // Flash target green
    if (target.graphic.setTint) target.graphic.setTint(0x44ff44);

    const pos = this.grid.gridToPixel(target.col, target.row);
    const healText = this.add
      .text(pos.x, pos.y - 16, `+${healAmount}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#44ff44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);

    this.tweens.add({
      targets: healText,
      y: pos.y - 36,
      alpha: 0,
      duration: reduced ? 260 : 600,
      onComplete: () => healText.destroy(),
    });

    await this._awaitSceneDelay(reduced ? 120 : 250, { label: 'animate_heal_tint_clear' });
    if (target.graphic.clearTint) target.graphic.clearTint();
    await this._awaitSceneDelay(reduced ? 100 : 250, { label: 'animate_heal_tail' });
  }

  // --- Weapon picker (pre-attack) ---

  showWeaponArtPicker(unit) {
    (this._weaponArtController ||= new WeaponArtController(this)).showWeaponArtPicker(unit);
  }

  showWeaponPicker(unit, attackTargets) {
    this.hideActionMenu();
    this._weaponPreviewedItem = null;
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';

    let combatWeapons = getCombatWeapons(unit);
    // Silenced units cannot use magic weapons
    if (isSilenced(unit)) {
      combatWeapons = combatWeapons.filter(
        (w) => w.type !== 'Tome' && w.type !== 'Light' && w.type !== 'Staff' && w.type !== 'Breath',
      );
    }
    // Edge case: if silence filtering removed all weapons, return to action menu
    if (combatWeapons.length === 0) {
      this.inEquipMenu = false;
      this.showActionMenu(unit);
      return;
    }
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 130;
    const menuX = unit.col < this.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    this.actionMenu = [];

    const itemHeight = this.isMobileInput ? 36 : 20;
    const wpnFontSize = this.isMobileInput ? '13px' : '11px';
    const menuHeight = combatWeapons.length * itemHeight + 12;
    const menuPos = this._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);
    const menuRect = { x: menuPos.x, y: menuPos.y, width: menuWidth, height: menuHeight };

    const bg = this.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.85,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    combatWeapons.forEach((wpn, i) => {
      const itemY = menuPos.y + 6 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + 8;
      const marker = wpn === unit.weapon ? '\u25b6 ' : '  ';
      const artMarker = hasWeaponArt(wpn, this._getWeaponArtCatalog()) ? '*' : '';
      const label = `${marker}${wpn?.name || 'Weapon'}${artMarker}`;
      const defaultColor = wpn === unit.weapon ? '#ffdd44' : '#e0e0e0';

      const text = this._makeMenuTextButton(
        itemX,
        itemY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: wpnFontSize,
          color: defaultColor,
          lineSpacing: 1,
        },
        defaultColor,
        () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          equipWeapon(unit, wpn);
          this._clearSelectedWeaponArtIfInvalid(unit);
          this.inEquipMenu = false;
          this.hideActionMenu();
          this.attackTargets = this.findAttackTargets(unit);
          const attackTiles = this.attackTargets.map((e) => ({ col: e.col, row: e.row }));
          this.grid.showAttackRange(attackTiles);
          this.battleState = 'SELECTING_TARGET';
        },
        { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
      );

      text.on('pointerover', () => {
        this._showWeaponDetailTooltip(wpn, menuRect, itemY);
      });
      text.on('pointerout', (pointer) => {
        if (!this._isTouchPointer(pointer)) {
          this._hideWeaponDetailTooltip();
        }
      });

      this.actionMenu.push(text);
    });

    // Auto-show tooltip for equipped weapon
    const equippedWpn = combatWeapons.find((w) => w === unit.weapon) || combatWeapons[0];
    if (equippedWpn) {
      const eqIdx = combatWeapons.indexOf(equippedWpn);
      const autoY = menuPos.y + 6 + eqIdx * itemHeight + itemHeight / 2;
      this._showWeaponDetailTooltip(equippedWpn, menuRect, autoY);
      this._weaponPreviewedItem = equippedWpn;
    }
    this._pinToScreen(this.actionMenu);
  }

  // --- Equip sub-menu ---

  showEquipMenu(unit) {
    this.hideActionMenu();
    this._weaponPreviewedItem = null;
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 155;
    const menuX = unit.col < this.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    this.actionMenu = [];

    const displayWeapons = unit.inventory.filter(
      (item) =>
        item.type !== 'Consumable' &&
        item.type !== 'Scroll' &&
        (canEquip(unit, item) || !hasProficiency(unit, item)),
    );
    const itemHeight = this.isMobileInput ? 36 : 20;
    const menuPadding = 8;
    const contentHeight = displayWeapons.length * itemHeight;
    const fullMenuHeight = contentHeight + menuPadding;
    const maxMenuHeight = Math.max(itemHeight + menuPadding, this.cameras.main.height - 8);
    const menuHeight = Math.min(fullMenuHeight, maxMenuHeight);
    const menuPos = this._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);
    const menuRect = { x: menuPos.x, y: menuPos.y, width: menuWidth, height: menuHeight };

    const bg = this.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.85,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    const rows = [];
    displayWeapons.forEach((wpn, i) => {
      const itemY = menuPos.y + 4 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + menuWidth / 2;
      const isNonProficient = !hasProficiency(unit, wpn);
      const canEquipNow = canEquip(unit, wpn);
      const marker = wpn === unit.weapon ? '\u25b6 ' : '  ';
      const artMarker = hasWeaponArt(wpn, this._getWeaponArtCatalog()) ? '*' : '';
      const label = `${marker}${wpn?.name || 'Weapon'}${artMarker}${isNonProficient ? ' (no prof)' : ''}`;
      const defaultColor = isNonProficient
        ? '#888888'
        : wpn === unit.weapon
          ? '#ffdd44'
          : '#e0e0e0';

      const equipFontSize = this.isMobileInput ? '13px' : '9px';
      const text = this._makeMenuTextButton(
        itemX,
        itemY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: equipFontSize,
          color: defaultColor,
          lineSpacing: 1,
        },
        defaultColor,
        () => {
          if (!canEquipNow) return;
          equipWeapon(unit, wpn);
          this.showActionMenu(unit);
        },
        {
          hitWidth: menuWidth - 10,
          hitHeight: itemHeight,
          hoverColor: isNonProficient ? '#999999' : '#ffdd44',
        },
      );

      text.on('pointerover', () => {
        this._showWeaponDetailTooltip(wpn, menuRect, text.y);
      });
      text.on('pointerout', (pointer) => {
        if (!this._isTouchPointer(pointer)) {
          this._hideWeaponDetailTooltip();
        }
      });

      rows.push({ text, baseY: itemY, rowHeight: itemHeight });
      this.actionMenu.push(text);
    });

    const viewHeight = menuHeight - menuPadding;
    let hasOverflow = false;
    if (contentHeight > viewHeight && rows.length > 0 && this.input?.on) {
      hasOverflow = true;
      const topY = menuPos.y + 4;
      const bottomY = menuPos.y + menuHeight - 4;
      const minScroll = viewHeight - contentHeight;
      let scrollY = 0;
      const applyScroll = () => {
        for (const row of rows) {
          const centerY = row.baseY + scrollY;
          row.text.y = centerY;
          const visible =
            centerY + row.rowHeight / 2 >= topY && centerY - row.rowHeight / 2 <= bottomY;
          if (typeof row.text.setVisible === 'function') row.text.setVisible(visible);
          if (row.text.input) row.text.input.enabled = visible;
        }
      };
      applyScroll();

      const onWheel = (_pointer, _gameObjects, _deltaX, deltaY) => {
        if (!this.inEquipMenu || this.battleState !== 'UNIT_ACTION_MENU' || !this.actionMenu)
          return;
        if (!Number.isFinite(deltaY) || deltaY === 0) return;
        scrollY = Phaser.Math.Clamp(scrollY - Math.sign(deltaY) * 16, minScroll, 0);
        applyScroll();
      };
      this._actionMenuWheelHandler = onWheel;
      this.input.on('wheel', onWheel);

      const hint = this.add
        .text(menuPos.x + menuWidth / 2, menuPos.y + menuHeight - 2, 'Scroll', {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#777777',
        })
        .setOrigin(0.5, 1)
        .setDepth(401);
      this.actionMenu.push(hint);
    }

    // Auto-show tooltip for equipped weapon (skip if overflowing -- equipped row may be off-screen)
    if (!hasOverflow) {
      const equippedWpn = displayWeapons.find((w) => w === unit.weapon) || displayWeapons[0];
      if (equippedWpn) {
        const eqIdx = displayWeapons.indexOf(equippedWpn);
        const autoY = menuPos.y + 4 + eqIdx * itemHeight + itemHeight / 2;
        this._showWeaponDetailTooltip(equippedWpn, menuRect, autoY);
        this._weaponPreviewedItem = equippedWpn;
      }
    }
    this._pinToScreen(this.actionMenu);
  }

  /** DEPRECATED: Scrolls now handled in team pool via RosterOverlay. */
  // async useSkillScroll(unit, scroll) {
  //   const result = learnSkill(unit, scroll.skillId);
  //   if (result.learned) {
  //     removeFromInventory(unit, scroll);
  //     this.hideActionMenu();
  //     const skillData = this.gameData.skills.find(s => s.id === scroll.skillId);
  //     const skillName = skillData ? skillData.name : scroll.skillId;
  //     await this.showSkillLearnedBanner(unit, skillName);
  //     this.showActionMenu(unit);
  //   } else {
  //     // Show feedback for failure
  //     this.hideActionMenu();
  //     const reason = result.reason === 'at_cap'
  //       ? `${unit.name} already knows ${MAX_SKILLS} skills!`
  //       : `${unit.name} already knows this skill!`;
  //     await this.showBriefBanner(reason, '#ff8888');
  //     this.showEquipMenu(unit);
  //   }
  // }

  // --- Item Menu (Consumables) ---

  showItemMenu(unit) {
    this.hideActionMenu();
    this.actionMenu = [];
    this.inEquipMenu = true; // reuse flag to block other input

    // Use consumables array instead of filtering inventory
    const consumables = unit.consumables || [];
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = unit.col < this.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 120;
    const menuY = pos.y - 10;

    const itemHeight = this.isMobileInput ? 38 : 28;
    const menuWidth = 120;
    const menuHeight = (consumables.length + 1) * itemHeight + 8; // +1 for Back
    const menuPos = this._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);

    const bg = this.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.85,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    consumables.forEach((item, i) => {
      const iy = menuPos.y + 4 + i * itemHeight + itemHeight / 2;
      const ix = menuPos.x + menuWidth / 2;

      // Check usability
      const isHeal = item.effect === 'heal' || item.effect === 'healFull';
      const isCure = item.effect === 'cure' || item.effect === 'cureHeal';
      const isPromote = item.effect === 'promote';
      const isReclass = item.effect === 'reclass';
      const canUsePromote =
        canPromote(unit) &&
        Boolean(resolvePromotionTargetClass(unit, this.gameData.classes, this.gameData.lords)) &&
        this.getPromotionConsumable(unit) === item;
      const canUseReclass =
        canReclass(unit) &&
        getReclassTargets(unit, this.gameData.classes, item.subEffect).length > 0;
      // Cure usability: self or adjacent allies have conditions
      let canUseCure = false;
      if (isCure) {
        const hasSelfCond = (unit._conditions || []).length > 0;
        const adjAllies = this.playerUnits.filter(
          (a) =>
            a !== unit &&
            a.currentHP > 0 &&
            !a._removing &&
            gridDistance(unit.col, unit.row, a.col, a.row) === 1 &&
            (a._conditions || []).length > 0,
        );
        canUseCure = hasSelfCond || adjAllies.length > 0;
      }
      const usable =
        !(isHeal && unit.currentHP >= unit.stats.HP) &&
        !(isCure && !canUseCure) &&
        !(isPromote && !canUsePromote) &&
        !(isReclass && !canUseReclass);

      let label = item.name;
      if (item.uses !== undefined) label += ` (${item.uses})`;

      const color = usable ? '#88ff88' : '#666666';
      const text = this.add
        .text(ix, iy, label, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color,
        })
        .setOrigin(0.5)
        .setDepth(401);

      if (usable) {
        text.setInteractive(
          new Phaser.Geom.Rectangle(
            -(menuWidth - 10) / 2,
            -itemHeight / 2,
            menuWidth - 10,
            itemHeight,
          ),
          Phaser.Geom.Rectangle.Contains,
        );
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor('#88ff88'));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          text.setColor('#ffdd44');
          const isCure = item.effect === 'cure' || item.effect === 'cureHeal';
          if (isCure) {
            this._startCureTargetSelection(unit, item);
          } else {
            this.useConsumable(unit, item);
          }
        });
      }
      this.actionMenu.push(text);
    });

    // Back button
    const backY = menuPos.y + 4 + consumables.length * itemHeight + itemHeight / 2;
    const backText = this._makeMenuTextButton(
      menuPos.x + menuWidth / 2,
      backY,
      'Back',
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaaa',
      },
      '#aaaaaa',
      () => {
        this.hideActionMenu();
        this.inEquipMenu = false;
        this.showActionMenu(unit);
      },
      { hitWidth: menuWidth - 10, hitHeight: itemHeight },
    );
    this.actionMenu.push(backText);
    this._pinToScreen(this.actionMenu);
  }

  async useConsumable(unit, item) {
    this.hideActionMenu();
    this.inEquipMenu = false;

    if (item.effect === 'promote') {
      const didPromote = await this.executePromotion(unit, item);
      if (!didPromote) return;
      return;
    } else if (item.effect === 'reclass') {
      this.showReclassClassPicker(unit, item);
      return;
    }

    this.commitVisionSnapshotIfPending();

    if (item.effect === 'heal') {
      const oldHP = unit.currentHP;
      unit.currentHP = Math.min(unit.stats.HP, unit.currentHP + item.value);
      const healed = unit.currentHP - oldHP;
      this.updateHPBar(unit);
      await this.showBriefBanner(`${unit.name} healed ${healed} HP!`, '#88ff88');
    } else if (item.effect === 'healFull') {
      unit.currentHP = unit.stats.HP;
      this.updateHPBar(unit);
      await this.showBriefBanner(`${unit.name} fully healed!`, '#88ff88');
    } else if (item.effect === 'cure' || item.effect === 'cureHeal') {
      // Use on the cure target (self or adjacent ally)
      const target = this._pendingCureTarget || unit;
      this._pendingCureTarget = null;
      clearAllConditions(target);
      this._removeAllConditionIcons(target);
      this.undimUnit(target);
      if (item.effect === 'cureHeal' && item.value > 0) {
        const oldHP = target.currentHP;
        target.currentHP = Math.min(target.stats.HP, target.currentHP + item.value);
        const healed = target.currentHP - oldHP;
        this.updateHPBar(target);
        await this.showBriefBanner(`${target.name} cured and healed ${healed} HP!`, '#88ff88');
      } else {
        await this.showBriefBanner(`${target.name}'s conditions cured!`, '#88ff88');
      }
    }

    // Decrement uses, remove if depleted
    item.uses--;
    if (item.uses <= 0) removeFromConsumables(unit, item);

    this.finishUnitAction(unit);
  }

  async showSkillLearnedBanner(unit, skillName) {
    const banner = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY,
        `${unit.name} learned ${skillName}!`,
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#88ffff',
          backgroundColor: '#000000cc',
          padding: { x: 16, y: 8 },
        },
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    this._pinToScreen(banner);

    await this._awaitSceneTween(
      {
        targets: banner,
        alpha: 1,
        duration: 300,
        yoyo: true,
        hold: 1200,
        onComplete: () => {
          banner.destroy();
        },
      },
      {
        label: 'show_skill_learned_banner',
        onCancel: () => banner.destroy(),
      },
    );
  }

  async showBriefBanner(message, color = '#ffdd44') {
    const banner = this.add
      .text(this.cameras.main.centerX, this.cameras.main.centerY, message, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    this._pinToScreen(banner);

    await this._awaitSceneTween(
      {
        targets: banner,
        alpha: 1,
        duration: 200,
        yoyo: true,
        hold: 800,
        onComplete: () => {
          banner.destroy();
        },
      },
      {
        label: 'show_brief_banner',
        onCancel: () => banner.destroy(),
      },
    );
  }

  // --- Promotion ---

  async executePromotion(unit, promotionItem = null) {
    const seal = promotionItem || this.getPromotionConsumable(unit);
    if (!seal) {
      await this.showBriefBanner('Master Seal required to promote.', '#ff8888');
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return false;
    }

    // Find promotion targets
    const lordData = this.gameData.lords.find((l) => l.name === unit.name);
    const targets = resolvePromotionTargets(unit, this.gameData.classes, this.gameData.lords);
    if (!targets?.length) {
      await this.showBriefBanner('Promotion to that class is currently unavailable.', '#ff8888');
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return false;
    }

    let promotedClassData;
    if (targets.length === 1) {
      promotedClassData = targets[0];
    } else {
      this.battleState = 'COMBAT_RESOLVING'; // block gameplay hotkeys while chooser is open
      // Show promotion choice panel
      const { PromotionChoicePanel } = await import('../ui/PromotionChoicePanel.js');
      const panel = new PromotionChoicePanel(this, unit, targets, this.gameData.skills);
      promotedClassData = await panel.show();
      if (!promotedClassData) {
        // Cancelled -- return to action menu
        this.battleState = 'UNIT_ACTION_MENU';
        this.showActionMenu(unit);
        return false;
      }
    }

    this.battleState = 'COMBAT_RESOLVING'; // block input during promotion

    let promotionBonuses, promotionWeapons;

    if (lordData) {
      promotionBonuses = lordData.promotionBonuses;
      promotionWeapons = lordData.promotionWeapons;
    } else {
      promotionBonuses = promotedClassData.promotionBonuses;
    }

    if (!promotionBonuses) {
      await this.showBriefBanner('Promotion data missing for this unit.', '#ff8888');
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return false;
    }

    // Track pre-promotion weapon types to detect new proficiencies
    const oldTypes = new Set(unit.proficiencies.map((p) => p.type));

    // Apply promotion
    promoteUnit(unit, promotedClassData, promotionBonuses, this.gameData.skills);

    // Refresh sprite to show promoted class
    this.removeUnitGraphic(unit);
    this.addUnitGraphic(unit);

    // Grant Iron weapons for any new weapon proficiencies gained
    if (promotionWeapons) {
      // Lords get specific promotion weapons (e.g. "Lances (P)")
      const newType = promotionWeapons.match(/(\w+)/)?.[1];
      const typeMap = {
        Swords: 'Sword',
        Lances: 'Lance',
        Axes: 'Axe',
        Bows: 'Bow',
        Tomes: 'Tome',
        Staves: 'Staff',
        Light: 'Light',
      };
      const wpnType = typeMap[newType] || newType;
      const newWeapon = this.gameData.weapons.find((w) => w.type === wpnType && w.tier === 'Iron');
      if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
        addToInventory(unit, newWeapon);
      }
    } else {
      // Non-Lord: grant Iron weapon for each newly gained proficiency type
      for (const prof of unit.proficiencies) {
        if (oldTypes.has(prof.type)) continue;
        const tier = 'Iron';
        const newWeapon = this.gameData.weapons.find(
          (w) => w.type === prof.type && w.tier === tier,
        );
        if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
          addToInventory(unit, newWeapon);
        }
      }
    }

    // Update HP bar (max HP increased)
    this.updateHPBar(unit);

    // Show promotion banner
    await this.showPromotionBanner(unit, promotedClassData.name);

    // Show stat gains as a level-up style popup
    const gains = { gains: { ...promotionBonuses }, newLevel: 1 };
    delete gains.gains.MOV; // MOV isn't shown in level-up popup
    const popup = new LevelUpPopup(
      this,
      unit,
      gains,
      true,
      [],
      promotedClassData.growthBonuses || null,
    );
    await popup.show();

    // Consume Master Seal on successful promotion
    seal.uses = (seal.uses ?? 1) - 1;
    if (seal.uses <= 0) removeFromConsumables(unit, seal);

    this.finishUnitAction(unit);
    return true;
  }

  async showPromotionBanner(unit, newClassName) {
    const banner = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY,
        `${unit.name} promoted to ${newClassName}!`,
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ffdd44',
          backgroundColor: '#000000cc',
          padding: { x: 16, y: 8 },
        },
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    this._pinToScreen(banner);

    await this._awaitSceneTween(
      {
        targets: banner,
        alpha: 1,
        duration: 300,
        yoyo: true,
        hold: 1200,
        onComplete: () => {
          banner.destroy();
        },
      },
      {
        label: 'show_promotion_banner',
        onCancel: () => banner.destroy(),
      },
    );
  }

  // --- Reclass ---

  showReclassClassPicker(unit, sealItem) {
    if (!sealItem || !canReclass(unit)) {
      this.showBriefBanner('Cannot reclass this unit.', '#ff8888');
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return;
    }
    const targets = getReclassTargets(unit, this.gameData.classes, sealItem.subEffect);
    if (targets.length === 0) {
      this.showBriefBanner('No valid reclass targets.', '#ff8888');
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return;
    }

    this.battleState = 'RECLASS_PICKER';
    this.hideActionMenu();

    const menuWidth = 200;
    const totalRows = targets.length + 1; // +1 for Back row
    let itemHeight = this.isMobileInput ? 38 : 24;
    let menuHeight = totalRows * itemHeight + 8;
    // Overflow guard: shrink rows if menu exceeds viewport
    if (this.isMobileInput) {
      const maxMenuH = this.cameras.main.height - 16;
      if (menuHeight > maxMenuH) {
        itemHeight = Math.max(24, Math.floor((maxMenuH - 8) / totalRows));
        menuHeight = totalRows * itemHeight + 8;
      }
    }
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;
    const menuPos = this._clampMenuPosition(
      cx - menuWidth / 2,
      cy - menuHeight / 2,
      menuWidth,
      menuHeight,
    );

    this.actionMenu = [];

    const bg = this.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.9,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    targets.forEach((cls, i) => {
      const iy = menuPos.y + 4 + i * itemHeight + itemHeight / 2;
      const ix = menuPos.x + menuWidth / 2;
      const text = this._makeMenuTextButton(
        ix,
        iy,
        cls.name,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#88ff88',
        },
        '#88ff88',
        () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          this.executeReclass(unit, sealItem, cls);
        },
        { hitWidth: menuWidth - 10, hitHeight: itemHeight },
      );
      this.actionMenu.push(text);
    });

    // Back button
    const backY = menuPos.y + 4 + targets.length * itemHeight + itemHeight / 2;
    const backText = this._makeMenuTextButton(
      menuPos.x + menuWidth / 2,
      backY,
      'Back',
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaaa',
      },
      '#aaaaaa',
      () => {
        this.hideActionMenu();
        this.battleState = 'UNIT_ACTION_MENU';
        this.showActionMenu(unit);
      },
      { hitWidth: menuWidth - 10, hitHeight: itemHeight },
    );
    this.actionMenu.push(backText);
    this._pinToScreen(this.actionMenu);
  }

  async executeReclass(unit, sealItem, newClassData) {
    this.hideActionMenu();
    this.battleState = 'COMBAT_RESOLVING'; // block input

    const oldClassData = this.gameData.classes.find((c) => c.name === unit.className);
    if (!oldClassData) {
      await this.showBriefBanner('Reclass data missing.', '#ff8888');
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return;
    }

    // Track old proficiency types to detect new ones
    const oldTypes = new Set(unit.proficiencies.map((p) => p.type));

    reclassUnit(unit, newClassData, oldClassData, this.gameData.classes, this.gameData.skills);

    // Refresh sprite
    this.removeUnitGraphic(unit);
    this.addUnitGraphic(unit);

    // Grant Iron weapons for newly gained proficiency types
    for (const prof of unit.proficiencies) {
      if (oldTypes.has(prof.type)) continue;
      const newWeapon = this.gameData.weapons.find(
        (w) => w.type === prof.type && w.tier === 'Iron',
      );
      if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
        addToInventory(unit, newWeapon);
      }
    }

    this.updateHPBar(unit);

    await this.showBriefBanner(`${unit.name} reclassed to ${newClassData.name}!`, '#88ffff');

    // Consume seal
    sealItem.uses = (sealItem.uses ?? 1) - 1;
    if (sealItem.uses <= 0) removeFromConsumables(unit, sealItem);

    this.finishUnitAction(unit);
  }

  _getCombatRollSessionKey(attacker, defender) {
    const phase = this.turnManager?.currentPhase || 'player';
    const turn = Math.max(1, Math.trunc(Number(this.turnManager?.turnNumber) || 1));
    return `${phase}:${turn}:${String(attacker?.name || '')}:${String(defender?.name || '')}:${attacker?.col},${attacker?.row}:${defender?.col},${defender?.row}`;
  }

  _ensureCombatRollSession(attacker, defender) {
    if (!attacker || !defender) return null;
    const key = this._getCombatRollSessionKey(attacker, defender);
    const existing = this._combatRollSession;
    if (
      existing &&
      existing.key === key &&
      existing.attacker === attacker &&
      existing.defender === defender
    ) {
      return existing;
    }
    const next = {
      key,
      attacker,
      defender,
      gamblerAtkDeltaByUnit: new Map(),
    };
    this._combatRollSession = next;
    return next;
  }

  _clearCombatRollSession() {
    this._combatRollSession = null;
    this._forecastGamblerLine = null;
  }

  _getGamblerAtkDelta(unit, session = null) {
    return resolveGamblerDelta(unit, session || this._combatRollSession, Math.random);
  }

  _applyAccessoryPhaseCombatMods(unit, mods, session = null) {
    applyAccessoryPhaseCombatMods(unit, mods, {
      turnNumber: this.turnManager?.turnNumber,
      rollSession: session || this._combatRollSession,
      rng: Math.random,
    });
  }

  _resolveWeaponArtCostValues(unit, art) {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._resolveWeaponArtCostValues(unit, art);
  }

  _formatWeaponArtCostLabel(unit, art) {
    return (this._weaponArtController ||= new WeaponArtController(this))._formatWeaponArtCostLabel(
      unit,
      art,
    );
  }

  _applyRecoilGuardAfterArtUse(unit, art) {
    if (!unit || !art) return;
    const combatEffects = unit.accessory?.combatEffects || {};
    const recoilGuard = combatEffects.recoilGuard;
    const hasRecoilGuard = Boolean(recoilGuard) || Boolean(combatEffects.weaponArtDefBuff);
    if (!hasRecoilGuard) return;
    const rawStats =
      recoilGuard?.stats && typeof recoilGuard.stats === 'object'
        ? recoilGuard.stats
        : {
            DEF: Number.isFinite(Number(combatEffects?.buffDEF))
              ? Number(combatEffects.buffDEF)
              : 3,
            RES: Number.isFinite(Number(combatEffects?.buffRES))
              ? Number(combatEffects.buffRES)
              : 3,
          };
    const stats = {};
    for (const [rawStat, rawValue] of Object.entries(rawStats)) {
      const stat = String(rawStat || '')
        .trim()
        .toUpperCase();
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      stats[stat] = value;
    }
    if (Object.keys(stats).length <= 0) return;
    const { expiryPhase, expiryTurn } = this._resolveTier5BuffExpiry(unit, 1);
    this._applyTier5TimedBuffEntry(unit, {
      key: `recoil_guard::${String(unit.name || '')}`,
      artId: art.id || null,
      sourceName: unit.name || null,
      sourceFaction: unit.faction || null,
      expiryPhase,
      expiryTurn,
      stats,
    });
  }

  async _checkPhoenixBrooch(unit) {
    if (!unit || unit.currentHP <= 0) return false;
    const result = checkPhoenixBrooch(unit);
    if (!result?.triggered) return false;
    this.updateHPBar(unit);
    if (typeof this.animateHeal === 'function') {
      await this.animateHeal(unit, result.amount);
    }
    return true;
  }

  _applyKillRewards(defeatedUnit, killer = null) {
    if (!this.runManager || defeatedUnit?.faction !== 'enemy') return;
    if (defeatedUnit._noXP) return;
    this.goldEarned += calculateKillReward(defeatedUnit, killer, {
      rewardMultiplier: this.getEnemyRewardMultiplier(defeatedUnit),
      pressureGoldMultiplier: this.getTurnPressureState().goldMultiplier,
    });
  }

  // --- Skill context builder ---

  buildSkillCtx(attacker, defender, weaponArt = null) {
    const rollSession = this._ensureCombatRollSession(attacker, defender);
    const skills = this.gameData.skills;
    const getAllies = (unit) => {
      if (unit.faction === 'player') return this.playerUnits;
      if (unit.faction === 'npc') return [unit]; // NPC has no allies for aura purposes
      return this.enemyUnits;
    };
    const getEnemies = (unit) => {
      if (unit.faction === 'player') return this.enemyUnits;
      if (unit.faction === 'npc') return this.enemyUnits;
      return this.playerUnits;
    };

    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);

    const affixes = this.gameData.affixes;
    const atkMods = getSkillCombatMods(
      attacker,
      defender,
      getAllies(attacker),
      getEnemies(attacker),
      skills,
      atkTerrain,
      true,
      affixes,
    );
    const defMods = getSkillCombatMods(
      defender,
      attacker,
      getAllies(defender),
      getEnemies(defender),
      skills,
      defTerrain,
      false,
      affixes,
    );
    atkMods.hitBonus += this.runManager?.getActHitBonusForUnit?.(attacker) || 0;
    defMods.hitBonus += this.runManager?.getActHitBonusForUnit?.(defender) || 0;
    const atkTimedBuffMods = this._getTimedWeaponArtCombatBuffMods(attacker);
    const defTimedBuffMods = this._getTimedWeaponArtCombatBuffMods(defender);
    atkMods.hitBonus += atkTimedBuffMods.hitBonus || 0;
    atkMods.critBonus += atkTimedBuffMods.critBonus || 0;
    atkMods.avoidBonus += atkTimedBuffMods.avoidBonus || 0;
    atkMods.atkBonus += atkTimedBuffMods.atkBonus || 0;
    atkMods.defBonus += atkTimedBuffMods.defBonus || 0;
    atkMods.resBonus += atkTimedBuffMods.resBonus || 0;
    atkMods.spdBonus += atkTimedBuffMods.spdBonus || 0;
    defMods.hitBonus += defTimedBuffMods.hitBonus || 0;
    defMods.critBonus += defTimedBuffMods.critBonus || 0;
    defMods.avoidBonus += defTimedBuffMods.avoidBonus || 0;
    defMods.atkBonus += defTimedBuffMods.atkBonus || 0;
    defMods.defBonus += defTimedBuffMods.defBonus || 0;
    defMods.resBonus += defTimedBuffMods.resBonus || 0;
    defMods.spdBonus += defTimedBuffMods.spdBonus || 0;
    this._applyAccessoryPhaseCombatMods(attacker, atkMods, rollSession);
    this._applyAccessoryPhaseCombatMods(defender, defMods, rollSession);

    // Blessing terrain combat bonuses
    const terrainBonuses = this.runManager?.getTerrainCombatBonuses?.() || [];
    if (terrainBonuses.length > 0) {
      const applyTerrainBonus = (mods, unit, terrain) => {
        if (!terrain?.name || unit?.faction !== 'player') return;
        for (const bonus of terrainBonuses) {
          if (Array.isArray(bonus.terrains) && bonus.terrains.includes(terrain.name)) {
            mods.avoidBonus += bonus.avoidBonus || 0;
            mods.defBonus += bonus.defBonus || 0;
          }
        }
      };
      applyTerrainBonus(atkMods, attacker, atkTerrain);
      applyTerrainBonus(defMods, defender, defTerrain);
    }

    const atkWeaponArtMods = weaponArt ? getWeaponArtCombatMods(weaponArt) : null;

    return {
      atkMods,
      defMods,
      atkWeaponArtMods,
      rollStrikeSkills,
      rollDefenseSkills,
      rollDefenseAffixes,
      getAttackAffixes,
      checkAstra,
      affixData: affixes,
      skillsData: skills,
    };
  }

  _getWeaponArtCatalog() {
    return (this._weaponArtController ||= new WeaponArtController(this))._getWeaponArtCatalog();
  }

  _collectWeaponBoundArts(weapon) {
    return (this._weaponArtController ||= new WeaponArtController(this))._collectWeaponBoundArts(
      weapon,
    );
  }

  _getAvailableWeaponArtEntriesForUnit(unit) {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._getAvailableWeaponArtEntriesForUnit(unit);
  }

  _getAvailableWeaponArtCatalogForUnit(unit) {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._getAvailableWeaponArtCatalogForUnit(unit);
  }

  _getWeaponArtHpAfterCost(unit, art) {
    return (this._weaponArtController ||= new WeaponArtController(this))._getWeaponArtHpAfterCost(
      unit,
      art,
    );
  }

  _setSelectedWeaponArt(unit, artId = null, weapon = null) {
    (this._weaponArtController ||= new WeaponArtController(this))._setSelectedWeaponArt(
      unit,
      artId,
      weapon,
    );
  }

  _clearSelectedWeaponArt() {
    (this._weaponArtController ||= new WeaponArtController(this))._clearSelectedWeaponArt();
  }

  _resolveSelectedWeaponArtEntry(unit) {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._resolveSelectedWeaponArtEntry(unit);
  }

  _getSelectedWeaponArtForUnit(unit, context = {}) {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._getSelectedWeaponArtForUnit(unit, context);
  }

  _clearSelectedWeaponArtIfInvalid(unit, context = {}) {
    (this._weaponArtController ||= new WeaponArtController(this))._clearSelectedWeaponArtIfInvalid(
      unit,
      context,
    );
  }

  _getWeaponArtChoices(unit, weapon = null, context = {}, options = {}) {
    return (this._weaponArtController ||= new WeaponArtController(this))._getWeaponArtChoices(
      unit,
      weapon,
      context,
      options,
    );
  }

  _hasUsableWeaponArtTargets(unit, weapon = null, context = {}) {
    return (this._weaponArtController ||= new WeaponArtController(this))._hasUsableWeaponArtTargets(
      unit,
      weapon,
      context,
    );
  }

  _scoreEnemyWeaponArt(unit, art) {
    return (this._weaponArtController ||= new WeaponArtController(this))._scoreEnemyWeaponArt(
      unit,
      art,
    );
  }

  _getEnemyWeaponArtDifficultyId() {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._getEnemyWeaponArtDifficultyId();
  }

  _getEnemyWeaponArtTuning() {
    return (this._weaponArtController ||= new WeaponArtController(this))._getEnemyWeaponArtTuning();
  }

  _selectEnemyWeaponArt(unit, target) {
    return (this._weaponArtController ||= new WeaponArtController(this))._selectEnemyWeaponArt(
      unit,
      target,
    );
  }

  _rollEnemyWeaponArtChance() {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._rollEnemyWeaponArtChance();
  }

  _weaponArtReasonLabel(reason) {
    return (this._weaponArtController ||= new WeaponArtController(this))._weaponArtReasonLabel(
      reason,
    );
  }

  _getWeaponArtUsageCounts(unit, art) {
    return (this._weaponArtController ||= new WeaponArtController(this))._getWeaponArtUsageCounts(
      unit,
      art,
    );
  }

  _getWeaponArtStatusLine(unit, art, availability = null) {
    return (this._weaponArtController ||= new WeaponArtController(this))._getWeaponArtStatusLine(
      unit,
      art,
      availability,
    );
  }

  _beginAttackSelection(unit) {
    const selectedArt = this._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
    const selectedEntry = selectedArt ? this._resolveSelectedWeaponArtEntry(unit) : null;
    const attackTargets = selectedEntry
      ? this.findAttackTargets(unit, { weapon: selectedEntry.weapon, weaponArt: selectedArt })
      : this.findAttackTargets(unit);
    if (attackTargets.length <= 0) {
      this.showActionMenu(unit);
      return;
    }
    if (selectedEntry) {
      this.hideActionMenu();
      this.attackTargets = attackTargets;
      const attackTiles = attackTargets.map((e) => ({ col: e.col, row: e.row }));
      this.grid.showAttackRange(attackTiles);
      this.battleState = 'SELECTING_TARGET';
      return;
    }
    const combatWeapons = getCombatWeapons(unit);
    if (combatWeapons.length >= 2) {
      this.showWeaponPicker(unit, attackTargets);
      return;
    }
    this.hideActionMenu();
    this.attackTargets = attackTargets;
    const attackTiles = attackTargets.map((e) => ({ col: e.col, row: e.row }));
    this.grid.showAttackRange(attackTiles);
    this.battleState = 'SELECTING_TARGET';
  }

  _buildForecastSkillCtx(attacker, defender, weaponArt = null) {
    if (!weaponArt) return this.buildSkillCtx(attacker, defender, null);
    const hadPhoenixFlag = Object.prototype.hasOwnProperty.call(attacker, '_phoenixBroochUsed');
    const hadTimedBuffs = Object.prototype.hasOwnProperty.call(
      attacker,
      '_battleTimedWeaponArtBuffs',
    );
    const hadTimedAppliedStats = Object.prototype.hasOwnProperty.call(
      attacker,
      '_battleTimedWeaponArtAppliedStats',
    );
    const hadTimedAppliedCombatMods = Object.prototype.hasOwnProperty.call(
      attacker,
      '_battleTimedWeaponArtAppliedCombatMods',
    );
    const hadMov = Object.prototype.hasOwnProperty.call(attacker, 'mov');

    const originalHP = attacker.currentHP;
    const originalPhoenixFlag = attacker._phoenixBroochUsed;
    const originalMov = attacker.mov;
    const originalStats =
      attacker?.stats && typeof attacker.stats === 'object' ? { ...attacker.stats } : null;
    const originalTimedBuffs = Array.isArray(attacker._battleTimedWeaponArtBuffs)
      ? attacker._battleTimedWeaponArtBuffs.map((entry) => ({
          ...(entry || {}),
          stats: { ...(entry?.stats || {}) },
        }))
      : attacker._battleTimedWeaponArtBuffs;
    const originalTimedAppliedStats = attacker._battleTimedWeaponArtAppliedStats
      ? { ...attacker._battleTimedWeaponArtAppliedStats }
      : attacker._battleTimedWeaponArtAppliedStats;
    const originalTimedAppliedCombatMods = attacker._battleTimedWeaponArtAppliedCombatMods
      ? { ...attacker._battleTimedWeaponArtAppliedCombatMods }
      : attacker._battleTimedWeaponArtAppliedCombatMods;

    attacker.currentHP = this._getWeaponArtHpAfterCost(attacker, weaponArt);
    this._applyRecoilGuardAfterArtUse(attacker, weaponArt);
    checkPhoenixBrooch(attacker);
    try {
      return this.buildSkillCtx(attacker, defender, weaponArt);
    } finally {
      attacker.currentHP = originalHP;
      if (originalStats && attacker?.stats && typeof attacker.stats === 'object') {
        for (const key of Object.keys(attacker.stats)) {
          if (!Object.prototype.hasOwnProperty.call(originalStats, key)) {
            delete attacker.stats[key];
          }
        }
        Object.assign(attacker.stats, originalStats);
      } else if (originalStats) {
        attacker.stats = { ...originalStats };
      }

      if (hadMov) attacker.mov = originalMov;
      else delete attacker.mov;

      if (hadPhoenixFlag) attacker._phoenixBroochUsed = originalPhoenixFlag;
      else delete attacker._phoenixBroochUsed;

      if (hadTimedBuffs) attacker._battleTimedWeaponArtBuffs = originalTimedBuffs;
      else delete attacker._battleTimedWeaponArtBuffs;

      if (hadTimedAppliedStats)
        attacker._battleTimedWeaponArtAppliedStats = originalTimedAppliedStats;
      else delete attacker._battleTimedWeaponArtAppliedStats;

      if (hadTimedAppliedCombatMods)
        attacker._battleTimedWeaponArtAppliedCombatMods = originalTimedAppliedCombatMods;
      else delete attacker._battleTimedWeaponArtAppliedCombatMods;
    }
  }

  // --- Combat ---

  _cycleForecastWeapon(direction) {
    if (this.isStoryInputLocked()) return;
    if (this.battleState !== 'SHOWING_FORECAST' || !this.selectedUnit) return;
    const validWeapons = this._forecastValidWeapons;
    if (!validWeapons || validWeapons.length < 2) return;

    const currentIdx = validWeapons.indexOf(this.selectedUnit.weapon);
    if (currentIdx < 0) return;
    const nextIdx = (currentIdx + direction + validWeapons.length) % validWeapons.length;
    equipWeapon(this.selectedUnit, validWeapons[nextIdx]);
    this._clearSelectedWeaponArtIfInvalid(this.selectedUnit);

    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');

    // Rebuild forecast with new weapon
    const target = this.forecastTarget;
    this.hideForecast();
    this.showForecast(this.selectedUnit, target);
  }

  _getPortraitKey(unit) {
    const lordData = this.gameData.lords.find((l) => l.name === unit.name);
    if (lordData) return `portrait_lord_${unit.name.toLowerCase()}`;
    const classNorm = unit.className.toLowerCase().replace(/ /g, '_');
    // Enemy-faction units: try enemy-specific portrait first
    if (unit.faction === 'enemy') {
      const enemyKey = `portrait_enemy_${classNorm}`;
      if (this.textures.exists(enemyKey)) return enemyKey;
      const classData = this.gameData.classes.find((c) => c.name === unit.className);
      if (classData?.promotesFrom) {
        const baseEnemyKey = `portrait_enemy_${classData.promotesFrom.toLowerCase().replace(/ /g, '_')}`;
        if (this.textures.exists(baseEnemyKey)) return baseEnemyKey;
      }
    }
    const classKey = `portrait_generic_${classNorm}`;
    if (this.textures.exists(classKey)) return classKey;
    const classData = this.gameData.classes.find((c) => c.name === unit.className);
    if (classData?.promotesFrom) {
      const baseKey = `portrait_generic_${classData.promotesFrom.toLowerCase().replace(/ /g, '_')}`;
      if (this.textures.exists(baseKey)) return baseKey;
    }
    return null;
  }

  async showForecast(attacker, defender) {
    this.forecastTarget = defender;
    this.battleState = 'SHOWING_FORECAST';
    this._clearSelectedWeaponArtIfInvalid(attacker);

    // Shared context: distance, terrain, roll session, weapon art selection
    const {
      dist,
      atkTerrain,
      defTerrain,
      selectedArt: weaponArt,
      rollSession,
    } = this._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });

    // Forecast-specific: weapon entry resolution + auto-swap
    const selectedEntry = weaponArt ? this._resolveSelectedWeaponArtEntry(attacker) : null;
    // Auto-swap only for normal attacks; art attacks stay bound to selected weapon + art range.
    this.ensureValidWeaponForRange(attacker, dist, { weaponArt });
    if (selectedEntry && attacker.weapon !== selectedEntry.weapon) {
      equipWeapon(attacker, selectedEntry.weapon);
    }

    this._forecastWeaponArt = weaponArt;
    if (
      attacker?.accessory?.combatEffects?.gambler ||
      attacker?.accessory?.combatEffects?.gamblerCoin
    ) {
      const delta = this._getGamblerAtkDelta(attacker, rollSession);
      const signed = delta >= 0 ? `+${delta}` : `${delta}`;
      this._forecastGamblerLine = `GAMBLER: ATK ${signed} (locked)`;
    } else {
      this._forecastGamblerLine = null;
    }
    const skillCtx = this._buildForecastSkillCtx(attacker, defender, weaponArt);

    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      dist,
      atkTerrain,
      defTerrain,
      skillCtx,
    );

    // Compute valid weapons for cycling (weapons that can reach this target)
    const validWeapons = selectedEntry
      ? [selectedEntry.weapon]
      : getCombatWeapons(attacker).filter((w) => {
          if (
            isSilenced(attacker) &&
            (w.type === 'Tome' || w.type === 'Light' || w.type === 'Staff' || w.type === 'Breath')
          )
            return false;
          return this._isDistanceInWeaponRange(attacker, w, dist);
        });
    this._forecastValidWeapons = validWeapons;

    // Delegate rendering to ForecastOverlay
    this._forecastOverlay = new ForecastOverlay(this);
    this._forecastOverlay.render({
      attacker,
      defender,
      forecast,
      weaponArt: this._forecastWeaponArt,
      gamblerLine: this._forecastGamblerLine,
      validWeapons,
    });
    this.forecastObjects = this._forecastOverlay.displayObjects;
    this._pinToScreen(this.forecastObjects);

    if (this.battleParams?.tutorialMode && this.tutorialStep === 4) {
      this.tutorialStep = 5;
      await this._withTutorialHintState(async () => {
        await showImportantHint(
          this,
          'The forecast shows damage, hit %, and crit %.\nConfirm to attack, or press ESC to cancel.',
        );
      });
    }
  }

  hideForecast() {
    if (this._forecastOverlay) {
      this._forecastOverlay.destroy();
      this._forecastOverlay = null;
    }
    this.forecastObjects = null;
    this.forecastTarget = null;
    this._forecastValidWeapons = null;
    this._forecastWeaponArt = null;
    this._forecastGamblerLine = null;
  }

  /**
   * Shared combat context setup: distance, terrain, roll session, weapon art.
   * Used by executeCombat, executeEnemyCombat, and showForecast.
   * @param {object} attacker
   * @param {object} defender
   * @param {{ isPlayerInitiator?: boolean }} opts
   * @returns {{ dist: number, atkTerrain: object, defTerrain: object, selectedArt: object|null, rollSession: object }}
   */
  _prepareCombatContext(attacker, defender, { isPlayerInitiator = true } = {}) {
    const dist =
      isEntity(attacker) || isEntity(defender)
        ? combatDistance(attacker, defender)
        : gridDistance(attacker.col, attacker.row, defender.col, defender.row);
    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    const rollSession = this._ensureCombatRollSession(attacker, defender);
    const selectedArt = isPlayerInitiator
      ? this._getSelectedWeaponArtForUnit(attacker, { isInitiating: true })
      : this._selectEnemyWeaponArt(attacker, defender);
    return { dist, atkTerrain, defTerrain, selectedArt, rollSession };
  }

  /**
   * Shared combat resolution core: art cost, skill context, resolve, animate,
   * HP application, debug invincibility, HP bars, post-combat effects, phoenix.
   * Callers handle pre-resolution (battleState, highlights) and post-resolution
   * (XP award, unit removal, battle end, gambit, entity splash) themselves.
   * @param {object} attacker
   * @param {object} defender
   * @param {{ dist: number, atkTerrain: object, defTerrain: object, selectedArt: object|null }} ctx
   * @returns {Promise<{ result: object, selectedArt: object|null }>}
   */
  async _runCombatResolution(attacker, defender, ctx) {
    const { dist, atkTerrain, defTerrain, selectedArt } = ctx;

    // Apply weapon art cost if selected
    if (selectedArt) {
      const artCostOpts = {
        weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      };
      applyWeaponArtCost(attacker, selectedArt, artCostOpts);
      recordWeaponArtUse(attacker, selectedArt, { turnNumber: this.turnManager?.turnNumber });
      this._applyRecoilGuardAfterArtUse(attacker, selectedArt);
      this.updateHPBar(attacker);
      await this._checkPhoenixBrooch(attacker);
    }

    const skillCtx = this.buildSkillCtx(attacker, defender, selectedArt);

    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      dist,
      atkTerrain,
      defTerrain,
      skillCtx,
    );

    // Animate events
    for (const event of result.events) {
      if (event.type === 'skill') {
        await this.animateSkillActivation(event);
      } else {
        await this.animateStrike(event, attacker, defender);
        if (!event.miss && attacker.faction === 'player' && defender.faction === 'enemy') {
          defender._hitByPlayerThisPhase = true;
        }
      }
    }

    // Apply final HP
    attacker.currentHP = result.attackerHP;
    defender.currentHP = result.defenderHP;

    // Debug invincibility: restore player-faction units to full HP
    if (this.isDevToolsEnabled() && debugState.invincible) {
      if (attacker.faction === 'player') {
        attacker.currentHP = attacker.stats.HP;
        result.attackerDied = false;
      }
      if (defender.faction === 'player') {
        defender.currentHP = defender.stats.HP;
        result.defenderDied = false;
      }
    }

    this.updateHPBar(attacker);
    this.updateHPBar(defender);

    await this._applyResolvedCombatPostEffects({
      attacker,
      defender,
      result,
      attackerWeaponArt: selectedArt,
      defenderWeaponArt: null,
    });
    await this._checkPhoenixBrooch(attacker);
    await this._checkPhoenixBrooch(defender);

    return { result, selectedArt };
  }

  async executeCombat(attacker, defender) {
    this.battleState = 'COMBAT_RESOLVING';
    this.grid.clearAttackHighlights();
    this.resetFortHealStreak(attacker);
    const defenderHpAtStart = Math.max(0, Math.trunc(Number(defender?.currentHP) || 0));

    try {
      const ctx = this._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
      const { result } = await this._runCombatResolution(attacker, defender, ctx);

      if (attacker.faction === 'player' && attacker.currentHP > 0) {
        const damageDealt = Math.max(
          0,
          defenderHpAtStart - Math.max(0, Math.trunc(Number(result.defenderHP) || 0)),
        );
        await this.awardXP(
          attacker,
          defender,
          defender.currentHP <= 0,
          damageDealt,
          defenderHpAtStart,
        );
      }

      if (this.battleParams?.tutorialMode && this.tutorialStep === 5) {
        this.tutorialStep = 6;
        await this._withTutorialHintState(async () => {
          await showImportantHint(
            this,
            'Nice! Units gain XP from combat.\nLevel up to grow stronger. Now finish the fight!',
          );
        });
        if (!this.scene?.isActive?.()) return;
        this.battleState = 'COMBAT_RESOLVING';
      }

      if (defender.currentHP <= 0) {
        await this.removeUnit(defender, { killer: attacker });
      }
      if (attacker.currentHP <= 0) {
        await this.removeUnit(attacker, { killer: defender });
      }

      if (this.checkBattleEnd()) {
        return;
      }

      if (attacker.currentHP <= 0) {
        this.selectedUnit = null;
        this.battleState = 'PLAYER_IDLE';
        this.grid.clearAttackHighlights();
        this.attackTargets = [];
        return;
      }

      if (!attacker._gambitUsedThisTurn) {
        const gambitTriggered = result.events.some((e) =>
          e.skillActivations?.some((s) => s.id === 'commanders_gambit'),
        );
        if (gambitTriggered) {
          attacker._gambitUsedThisTurn = true;
          const unitsToRefresh = [attacker];
          for (const ally of this.playerUnits) {
            if (ally === attacker || ally.currentHP <= 0) continue;
            if (gridDistance(attacker.col, attacker.row, ally.col, ally.row) <= 1) {
              unitsToRefresh.push(ally);
            }
          }
          for (const u of unitsToRefresh) {
            u.hasActed = false;
            u.hasMoved = false;
            u._movementSpent = 0;
            if (u.graphic?.clearTint) u.graphic.clearTint();
          }
          this.selectedUnit = null;
          this.battleState = 'PLAYER_IDLE';
          this.grid.clearAttackHighlights();
          this.attackTargets = [];
          return;
        }
      }

      this.finishUnitAction(attacker);
    } catch (err) {
      console.error('[BattleScene] combat error:', err);
      // Best-effort: reconcile dead units to prevent zombie state
      try {
        if (defender?.currentHP <= 0) await this.removeUnit(defender, { killer: attacker });
        if (attacker?.currentHP <= 0) await this.removeUnit(attacker, { killer: defender });
        this.checkBattleEnd();
      } catch (cleanupErr) {
        console.error('[BattleScene] combat cleanup error:', cleanupErr);
      }
      if (this.battleState !== 'BATTLE_END') {
        // Consume the attacker's action to prevent double-acting after error
        const shouldConsumeAction =
          attacker?.faction === 'player' && attacker.currentHP > 0 && !attacker.hasActed;
        if (shouldConsumeAction) {
          attacker.hasActed = true;
          try {
            this.dimUnit(attacker);
          } catch (_) {
            /* best-effort visual */
          }
        }
        // Reset state BEFORE unitActed -- matches finishUnitAction order so
        // unitActed's phase transition (if triggered) takes final precedence
        this.battleState = 'PLAYER_IDLE';
        this.grid.clearHighlights();
        this.grid.clearAttackHighlights();
        this.attackTargets = [];
        this.selectedUnit = null;
        if (shouldConsumeAction) {
          this.turnManager?.unitActed(attacker);
        }
      }
    } finally {
      this._clearCombatRollSession();
      this._clearSelectedWeaponArt();
    }
  }

  async applyOnAttackAffixes(attacker, defender, events, sourceSide = null) {
    if (!attacker || !defender || defender.currentHP <= 0) return;
    const inferredSide = sourceSide || null;
    const didLandHit = inferredSide
      ? didCombatSideLandHit(
          events,
          inferredSide,
          inferredSide === 'attacker' ? attacker : defender,
          inferredSide === 'attacker' ? defender : attacker,
        )
      : events.some((e) => e.type === 'strike' && !e.miss && e.attacker === attacker.name);
    if (!didLandHit || !attacker.affixes?.length) return;
    const affixResult = getAttackAffixes(attacker, this.gameData.affixes);

    if (affixResult.poisonDamage > 0 && defender.currentHP > 0) {
      defender.currentHP = Math.max(1, defender.currentHP - affixResult.poisonDamage);
      this.updateHPBar(defender);
      await this.showPoisonDamage(defender, affixResult.poisonDamage);
    }

    if (affixResult.debuffStat && defender.currentHP > 0) {
      this.applyBattleDebuff(defender, affixResult.debuffStat, affixResult.debuffValue);
      const pos = this.grid.gridToPixel(defender.col, defender.row);
      this.showMinorHintAt(
        pos.x,
        pos.y,
        `-${Math.abs(affixResult.debuffValue)} ${affixResult.debuffStat}`,
        '#ff8888',
      );
    }
  }

  async _applyResolvedCombatPostEffects({
    attacker,
    defender,
    result,
    attackerWeaponArt = null,
    defenderWeaponArt = null,
  }) {
    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      result,
      attackerWeaponArt,
      defenderWeaponArt,
    });

    for (const step of steps) {
      const sourceUnit = step.sourceSide === 'defender' ? defender : attacker;
      const targetUnit = step.targetSide
        ? step.targetSide === 'attacker'
          ? attacker
          : defender
        : step.sourceSide === 'defender'
          ? attacker
          : defender;
      switch (step.type) {
        case 'affix':
          await this.applyOnAttackAffixes(sourceUnit, targetUnit, result.events, step.sourceSide);
          break;
        case 'poison':
          if (targetUnit && targetUnit.currentHP > 0) {
            await this.showPoisonDamage(targetUnit, step.damage);
          }
          break;
        case 'debuff':
          if (!targetUnit || targetUnit.currentHP <= 0) break;
          for (const [stat, val] of Object.entries(step.debuffs || {})) {
            this.applyBattleDebuff(targetUnit, stat, val);
          }
          {
            const pos = this.grid.gridToPixel(targetUnit.col, targetUnit.row);
            this.showMinorHintAt(pos.x, pos.y, 'Intimidated!', '#ff6600');
          }
          break;
        case 'divine_charge':
          await this._applyDivineChargeHealStep(step, attacker, defender);
          break;
        case 'tier2_damage':
          if (!targetUnit || targetUnit.currentHP <= 0) break;
          {
            const hpFloor = step.nonLethal ? 1 : 0;
            const prevHP = targetUnit.currentHP;
            targetUnit.currentHP = Math.max(hpFloor, targetUnit.currentHP - step.amount);
            const actualDamage = prevHP - targetUnit.currentHP;
            if (actualDamage > 0) {
              this.updateHPBar(targetUnit);
              await this.showPoisonDamage(targetUnit, actualDamage);
            }
          }
          break;
        case 'tier2_debuff':
          if (!targetUnit || targetUnit.currentHP <= 0) break;
          this.applyBattleDebuff(targetUnit, step.stat, step.amount);
          {
            const pos = this.grid.gridToPixel(targetUnit.col, targetUnit.row);
            this.showMinorHintAt(pos.x, pos.y, `-${Math.abs(step.amount)} ${step.stat}`, '#ff8888');
          }
          break;
        case 'tier2_pierce':
          await this._applyTier2PierceStep(step, sourceUnit, targetUnit);
          break;
        case 'tier2_move':
          await this._applyTier2MoveStep(sourceUnit, targetUnit, step);
          break;
        case 'tier2_set_hp':
          this._applyTier2SetHpStep(step, sourceUnit, targetUnit);
          break;
        case 'tier5_aoe_splash':
          await this._applyTier5AoeSplashStep(step, sourceUnit, targetUnit);
          break;
        case 'tier5_ally_buff':
          await this._applyTier5AllyBuffStep(step, sourceUnit);
          break;
        default:
          break;
      }
    }
  }

  async _applyDivineChargeHealStep(step, attacker, defender) {
    const caster = step.side === 'defender' ? defender : attacker;
    if (!caster || caster.currentHP <= 0) return;
    const healAmount = Math.floor((step.damageDealt * step.percent) / 100);
    if (healAmount <= 0) return;
    const allies = this.getDivineChargeAllies(caster).filter(
      (u) =>
        u.currentHP > 0 &&
        u.currentHP < u.stats.HP &&
        u !== caster &&
        gridDistance(caster.col, caster.row, u.col, u.row) <= step.range,
    );
    if (allies.length === 0) return;
    allies.sort((a, b) => a.currentHP / a.stats.HP - b.currentHP / b.stats.HP);
    const healTarget = allies[0];
    const prevHP = healTarget.currentHP;
    healTarget.currentHP = Math.min(healTarget.stats.HP, healTarget.currentHP + healAmount);
    const actualHeal = healTarget.currentHP - prevHP;
    this.updateHPBar(healTarget);
    if (actualHeal > 0) {
      const pos = this.grid.gridToPixel(healTarget.col, healTarget.row);
      this.showMinorHintAt(pos.x, pos.y, `+${actualHeal} HP`, '#00ff00');
    }
  }

  async _applyTier2MoveStep(sourceUnit, targetUnit, step) {
    if (!sourceUnit) return;
    const moveResult = resolvePostCombatMove({
      sourceUnit,
      targetUnit,
      mode: step.mode,
      distance: step.distance,
      cols: this.grid.cols,
      rows: this.grid.rows,
      getMoveCost: (col, row, moveType) => this.grid.getMoveCost(col, row, moveType),
      getUnitAt: (col, row) => this.getUnitAt(col, row),
    });
    if (!moveResult.ok) return;

    const movedUnits = [];
    for (const assignment of moveResult.assignments) {
      assignment.unit.col = assignment.col;
      assignment.unit.row = assignment.row;
      movedUnits.push(assignment.unit);
    }
    for (const unit of movedUnits) {
      this.updateUnitPosition(unit);
    }
    this._refreshPostCombatMovementState(movedUnits);
  }

  _resolveTier2PierceTarget(sourceUnit, primaryTarget) {
    if (!sourceUnit || !primaryTarget) return null;
    const dc = primaryTarget.col - sourceUnit.col;
    const dr = primaryTarget.row - sourceUnit.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return null;
    const secondaryCol = primaryTarget.col + dc;
    const secondaryRow = primaryTarget.row + dr;
    if (
      secondaryCol < 0 ||
      secondaryCol >= this.grid.cols ||
      secondaryRow < 0 ||
      secondaryRow >= this.grid.rows
    ) {
      return null;
    }
    const candidate = this.getUnitAt(secondaryCol, secondaryRow);
    if (!candidate || candidate.currentHP <= 0) return null;
    if (!this._getTier5HostileUnitsFor(sourceUnit).includes(candidate)) return null;
    return candidate;
  }

  async _applyTier2PierceStep(step, sourceUnit, primaryTarget) {
    if (!sourceUnit) return;
    if (!primaryTarget) return;
    const strikeDamages = Array.isArray(step?.damages) ? step.damages : [];
    if (strikeDamages.length <= 0) return;
    const target = this._resolveTier2PierceTarget(sourceUnit, primaryTarget);
    if (!target) return;

    for (const rawDamage of strikeDamages) {
      if (target.currentHP <= 0) break;
      const damage = Math.max(0, Math.trunc(Number(rawDamage) || 0));
      if (damage <= 0) continue;
      const prevHP = target.currentHP;
      target.currentHP = Math.max(0, target.currentHP - damage);
      const actualDamage = prevHP - target.currentHP;
      if (actualDamage <= 0) continue;
      this.updateHPBar(target);
      const pos = this.grid.gridToPixel(target.col, target.row);
      this.showMinorHintAt(pos.x, pos.y, `Pierce -${actualDamage}`, '#ff7777');
      if (target.currentHP <= 0) {
        await this.removeUnit(target, { killer: sourceUnit });
        break;
      }
    }
  }

  _applyTier2SetHpStep(step, sourceUnit, targetUnit) {
    if (!sourceUnit || sourceUnit.currentHP <= 0) return;
    if (!targetUnit || targetUnit.currentHP <= 0) return;
    const value = Math.max(1, Math.trunc(Number(step?.value) || 0));
    if (value <= 0) return;
    const maxHp = Math.max(1, Math.trunc(Number(targetUnit.stats?.HP) || 1));
    const nextHp = Math.min(maxHp, value);
    if (targetUnit.currentHP === nextHp) return;
    targetUnit.currentHP = nextHp;
    this.updateHPBar(targetUnit);
    const pos = this.grid.gridToPixel(targetUnit.col, targetUnit.row);
    this.showMinorHintAt(pos.x, pos.y, `HP -> ${nextHp}`, '#ffaa66');
  }

  _collectTier5SplashTargets(step, sourceUnit, primaryTarget) {
    if (!sourceUnit || !primaryTarget) return [];
    const radius = Math.max(0, Math.trunc(Number(step?.radius) || 0));
    if (radius <= 0) return [];
    const candidates = this._getTier5HostileUnitsFor(sourceUnit)
      .filter((unit) => unit && unit !== primaryTarget && unit.currentHP > 0)
      .filter(
        (unit) => gridDistance(primaryTarget.col, primaryTarget.row, unit.col, unit.row) <= radius,
      );
    const maxTargets = Math.max(0, Math.trunc(Number(step?.maxTargets) || 0));
    if (maxTargets === 1) {
      candidates.sort((a, b) => {
        const aHpPct = (Number(a.currentHP) || 0) / Math.max(1, Number(a.stats?.HP) || 1);
        const bHpPct = (Number(b.currentHP) || 0) / Math.max(1, Number(b.stats?.HP) || 1);
        if (aHpPct !== bHpPct) return aHpPct - bHpPct;
        if (a.row !== b.row) return a.row - b.row;
        if (a.col !== b.col) return a.col - b.col;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      return candidates.slice(0, 1);
    }
    candidates.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      if (a.col !== b.col) return a.col - b.col;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return maxTargets > 0 ? candidates.slice(0, maxTargets) : candidates;
  }

  _getTier5HostileUnitsFor(sourceUnit) {
    if (!sourceUnit) return [];
    if (sourceUnit.faction === 'enemy') return this.playerUnits || [];
    return this.enemyUnits || [];
  }

  _getTier5SplashDamage(step) {
    const damageKind = String(step?.damageKind || '').toLowerCase();
    if (damageKind === 'fixed') {
      return Math.max(0, Math.trunc(Number(step?.fixedDamage) || 0));
    }
    let multiplier = Number(step?.damageMultiplier) || 0;
    if (multiplier > 1) multiplier /= 100;
    const basisDamage = Math.max(0, Math.trunc(Number(step?.basisDamage) || 0));
    return Math.max(0, Math.floor(basisDamage * Math.max(0, multiplier)));
  }

  async _applyTier5AoeSplashStep(step, sourceUnit, primaryTarget) {
    if (!sourceUnit || sourceUnit.currentHP <= 0) return;
    if (!primaryTarget) return;
    const targets = this._collectTier5SplashTargets(step, sourceUnit, primaryTarget);
    if (targets.length <= 0) return;
    const splashDamage = this._getTier5SplashDamage(step);
    if (splashDamage <= 0) return;
    for (const target of targets) {
      if (!target || target.currentHP <= 0) continue;
      const hpFloor = step?.nonLethal ? 1 : 0;
      const prevHP = target.currentHP;
      target.currentHP = Math.max(hpFloor, target.currentHP - splashDamage);
      const actualDamage = prevHP - target.currentHP;
      if (actualDamage <= 0) continue;
      this.updateHPBar(target);
      const pos = this.grid.gridToPixel(target.col, target.row);
      this.showMinorHintAt(pos.x, pos.y, `Splash -${actualDamage}`, '#ff9966');
      if (target.currentHP <= 0) {
        await this.removeUnit(target, { killer: sourceUnit });
      }
    }
  }

  _applyTier5TimedBuffEntry(unit, entry) {
    if (!unit) return;
    if (!Array.isArray(unit._battleTimedWeaponArtBuffs)) unit._battleTimedWeaponArtBuffs = [];
    const key = String(entry?.key || '');
    if (key) {
      const existing = unit._battleTimedWeaponArtBuffs.find((buff) => buff?.key === key);
      if (existing) {
        existing.stats = { ...(entry.stats || {}) };
        existing.expiryPhase = entry.expiryPhase;
        existing.expiryTurn = entry.expiryTurn;
        existing.artId = entry.artId || null;
        existing.sourceName = entry.sourceName || null;
        existing.sourceFaction = entry.sourceFaction || null;
        this._recomputeTimedWeaponArtBuffState(unit);
        return;
      }
    }
    unit._battleTimedWeaponArtBuffs.push({
      key: key || null,
      artId: entry?.artId || null,
      sourceName: entry?.sourceName || null,
      sourceFaction: entry?.sourceFaction || null,
      expiryPhase: entry?.expiryPhase || null,
      expiryTurn: Math.max(1, Math.trunc(Number(entry?.expiryTurn) || 1)),
      stats: { ...(entry?.stats || {}) },
    });
    this._recomputeTimedWeaponArtBuffState(unit);
  }

  _recomputeTimedWeaponArtBuffState(unit) {
    if (!unit) return;
    const buffs = Array.isArray(unit._battleTimedWeaponArtBuffs)
      ? unit._battleTimedWeaponArtBuffs.filter(
          (entry) => entry && entry.stats && typeof entry.stats === 'object',
        )
      : [];
    unit._battleTimedWeaponArtBuffs = buffs;

    const strongestByStat = {};
    for (const entry of buffs) {
      for (const [rawStat, rawValue] of Object.entries(entry.stats || {})) {
        const stat = String(rawStat || '')
          .trim()
          .toUpperCase();
        if (!stat) continue;
        const value = Math.trunc(Number(rawValue) || 0);
        if (value === 0) continue;
        const prev = strongestByStat[stat];
        if (!Number.isFinite(prev) || value > prev) strongestByStat[stat] = value;
      }
    }

    const prevApplied = unit._battleTimedWeaponArtAppliedStats || {};
    const nextApplied = {};
    const allCoreStats = new Set([
      ...Object.keys(prevApplied),
      ...Object.keys(strongestByStat).filter((stat) => TIER5_BUFF_CORE_STATS.has(stat)),
    ]);

    for (const stat of allCoreStats) {
      const prevValue = Math.trunc(Number(prevApplied[stat]) || 0);
      const nextValue = TIER5_BUFF_CORE_STATS.has(stat)
        ? Math.trunc(Number(strongestByStat[stat]) || 0)
        : 0;
      const delta = nextValue - prevValue;
      if (delta !== 0) {
        unit.stats[stat] = (unit.stats[stat] || 0) + delta;
        if (stat === 'MOV') unit.stats[stat] = Math.max(1, unit.stats[stat] || 1);
        else unit.stats[stat] = Math.max(0, unit.stats[stat] || 0);
        if (stat === 'MOV') unit.mov = unit.stats.MOV;
      }
      if (nextValue !== 0) nextApplied[stat] = nextValue;
    }

    const combatMods = {};
    for (const [stat, value] of Object.entries(strongestByStat)) {
      const modKey = TIER5_BUFF_COMBAT_MOD_BY_STAT[stat];
      if (!modKey) continue;
      const normalized = Math.trunc(Number(value) || 0);
      if (normalized === 0) continue;
      const prev = combatMods[modKey] || 0;
      if (normalized > prev) combatMods[modKey] = normalized;
    }

    if (Object.keys(nextApplied).length > 0) unit._battleTimedWeaponArtAppliedStats = nextApplied;
    else delete unit._battleTimedWeaponArtAppliedStats;

    if (Object.keys(combatMods).length > 0)
      unit._battleTimedWeaponArtAppliedCombatMods = combatMods;
    else delete unit._battleTimedWeaponArtAppliedCombatMods;

    if (unit._battleTimedWeaponArtBuffs.length <= 0) {
      delete unit._battleTimedWeaponArtBuffs;
    }
  }

  _resolveTier5BuffExpiry(sourceUnit, durationPhases = 1) {
    const phase = sourceUnit?.faction === 'enemy' ? 'enemy' : 'player';
    const currentTurn = Math.max(1, Math.trunc(Number(this.turnManager?.turnNumber) || 1));
    const duration = Math.max(1, Math.trunc(Number(durationPhases) || 1));
    return {
      expiryPhase: phase,
      expiryTurn: currentTurn + duration,
    };
  }

  async _applyTier5AllyBuffStep(step, sourceUnit) {
    if (!sourceUnit || sourceUnit.currentHP <= 0) return;
    const range = Math.max(0, Math.trunc(Number(step?.range) || 0));
    if (range <= 0) return;
    const rawStats = step?.stats;
    if (!rawStats || typeof rawStats !== 'object') return;
    const stats = {};
    for (const [rawStat, rawValue] of Object.entries(rawStats)) {
      const stat = String(rawStat || '')
        .trim()
        .toUpperCase();
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      stats[stat] = value;
    }
    if (Object.keys(stats).length <= 0) return;

    const includeSelf = step?.includeSelf === true;
    const allies = this.getDivineChargeAllies(sourceUnit)
      .filter((ally) => ally && ally.currentHP > 0)
      .filter((ally) => includeSelf || ally !== sourceUnit)
      .filter((ally) => gridDistance(sourceUnit.col, sourceUnit.row, ally.col, ally.row) <= range);
    if (allies.length <= 0) return;

    const { expiryPhase, expiryTurn } = this._resolveTier5BuffExpiry(
      sourceUnit,
      step?.durationPhases,
    );
    const keyRoot = `${String(step?.artId || 'tier5_buff')}::${String(sourceUnit.name || '')}`;
    for (const ally of allies) {
      this._applyTier5TimedBuffEntry(ally, {
        key: `${keyRoot}::${String(ally.name || '')}`,
        artId: step?.artId || null,
        sourceName: sourceUnit.name || null,
        sourceFaction: sourceUnit.faction || null,
        expiryPhase,
        expiryTurn,
        stats,
      });
      const pos = this.grid.gridToPixel(ally.col, ally.row);
      this.showMinorHintAt(pos.x, pos.y, 'Buffed!', '#66ff99');
    }
  }

  _expireTimedWeaponArtBuffs(phase, turn) {
    const normalizedPhase = phase === 'enemy' ? 'enemy' : 'player';
    const normalizedTurn = Math.max(1, Math.trunc(Number(turn) || 1));
    const units = [
      ...(this.playerUnits || []),
      ...(this.enemyUnits || []),
      ...(this.npcUnits || []),
    ];
    for (const unit of units) {
      if (
        !Array.isArray(unit?._battleTimedWeaponArtBuffs) ||
        unit._battleTimedWeaponArtBuffs.length <= 0
      )
        continue;
      const previousCount = unit._battleTimedWeaponArtBuffs.length;
      unit._battleTimedWeaponArtBuffs = unit._battleTimedWeaponArtBuffs.filter((entry) => {
        const expiryPhase = entry?.expiryPhase === 'enemy' ? 'enemy' : 'player';
        const expiryTurn = Math.max(1, Math.trunc(Number(entry?.expiryTurn) || 1));
        const expiresNow = expiryPhase === normalizedPhase && normalizedTurn >= expiryTurn;
        return !expiresNow;
      });
      if (unit._battleTimedWeaponArtBuffs.length !== previousCount) {
        this._recomputeTimedWeaponArtBuffState(unit);
      }
    }
  }

  _getTimedWeaponArtCombatBuffMods(unit) {
    const mods = unit?._battleTimedWeaponArtAppliedCombatMods;
    if (!mods || typeof mods !== 'object') {
      return {
        hitBonus: 0,
        critBonus: 0,
        avoidBonus: 0,
        atkBonus: 0,
        defBonus: 0,
        resBonus: 0,
        spdBonus: 0,
      };
    }
    return {
      hitBonus: Math.trunc(Number(mods.hitBonus) || 0),
      critBonus: Math.trunc(Number(mods.critBonus) || 0),
      avoidBonus: Math.trunc(Number(mods.avoidBonus) || 0),
      atkBonus: Math.trunc(Number(mods.atkBonus) || 0),
      defBonus: Math.trunc(Number(mods.defBonus) || 0),
      resBonus: Math.trunc(Number(mods.resBonus) || 0),
      spdBonus: Math.trunc(Number(mods.spdBonus) || 0),
    };
  }

  _refreshPostCombatMovementState(movedUnits) {
    if (!Array.isArray(movedUnits) || movedUnits.length <= 0) return;
    this.dangerZoneStale = true;
    if (this.grid.fogEnabled) {
      this.grid.updateFogOfWar(this.playerUnits);
      this.updateEnemyVisibility();
    }
  }

  async animateStrike(event, attacker, defender) {
    const reduced = this._isReducedEffects();
    const strikerIsAttacker =
      event.attackerSide === 'attacker' || event.attackerSide === 'defender'
        ? event.attackerSide === 'attacker'
        : event.attacker === attacker.name;
    const striker = strikerIsAttacker ? attacker : defender;
    const target = strikerIsAttacker ? defender : attacker;

    if (event.skillActivations?.length) {
      const names = event.skillActivations.map((s) => s.name).join(', ');
      const sPos = this.grid.gridToPixel(striker.col, striker.row);
      const skillText = this.add
        .text(sPos.x, sPos.y - 24, names, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#88ffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(301);
      this.tweens.add({
        targets: skillText,
        y: sPos.y - 40,
        alpha: 0,
        duration: reduced ? 260 : 700,
        onComplete: () => skillText.destroy(),
      });
    }

    const audio = this.registry.get('audio');
    if (striker.graphic?.setTint) striker.graphic.setTint(0xffffff);
    if (audio && !event.miss) audio.playSFX(this.getWeaponSFX(striker));
    await this._awaitSceneDelay(reduced ? 70 : 120, { label: 'animate_strike_attacker_flash' });
    if (striker.graphic?.clearTint) striker.graphic.clearTint();

    if (event.miss) {
      const pos = this.grid.gridToPixel(target.col, target.row);
      const missText = this.add
        .text(pos.x, pos.y - 16, 'MISS', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#aaaaaa',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(300);
      this.tweens.add({
        targets: missText,
        y: pos.y - 32,
        alpha: 0,
        duration: reduced ? 220 : 500,
        onComplete: () => missText.destroy(),
      });
      await this._awaitSceneDelay(reduced ? 200 : 300, { label: 'animate_strike_miss_hold' });
      return;
    }

    if (target.graphic?.setTint) target.graphic.setTint(0xff4444);
    if (audio) audio.playSFX(event.isCrit ? 'sfx_crit' : 'sfx_hit');
    const pos = this.grid.gridToPixel(target.col, target.row);
    const dmgText = this.add
      .text(pos.x, pos.y - 16, event.isCrit ? `${event.damage}!` : `${event.damage}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: event.isCrit ? '#ffff00' : '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);
    this.tweens.add({
      targets: dmgText,
      y: pos.y - 32,
      alpha: 0,
      duration: reduced ? 260 : 600,
      onComplete: () => dmgText.destroy(),
    });

    target.currentHP = event.targetHPAfter;
    this.updateHPBar(target);

    // Sleep: wake on damage -- remove Zzz icon and un-dim immediately
    if (event.wokeFromSleep) {
      this._removeConditionIcon(target, 'sleep');
      this.undimUnit(target);
    }

    if (event.heal > 0 && event.strikerHealTo !== undefined) {
      striker.currentHP = event.strikerHealTo;
      this.updateHPBar(striker);
      const sPos = this.grid.gridToPixel(striker.col, striker.row);
      const healText = this.add
        .text(sPos.x + 12, sPos.y - 8, `+${event.heal}`, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#44ff44',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(300);
      this.tweens.add({
        targets: healText,
        y: sPos.y - 28,
        alpha: 0,
        duration: reduced ? 260 : 600,
        onComplete: () => healText.destroy(),
      });
    }

    if (event.reflectDamage > 0 && striker.currentHP > 0) {
      striker.currentHP = Math.max(1, striker.currentHP - event.reflectDamage);
      this.updateHPBar(striker);
      const sPos = this.grid.gridToPixel(striker.col, striker.row);
      const refText = this.add
        .text(sPos.x, sPos.y - 16, `${event.reflectDamage}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ff4444',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(300);
      this.tweens.add({
        targets: refText,
        y: sPos.y - 32,
        alpha: 0,
        duration: reduced ? 260 : 600,
        onComplete: () => refText.destroy(),
      });
    }

    await this._awaitSceneDelay(reduced ? 80 : 150, { label: 'animate_strike_hit_hold' });
    if (target.graphic?.clearTint) target.graphic.clearTint();

    if (event.warpRange > 0 && target.currentHP > 0) {
      await this.executeWarp(target, event.warpRange, striker);
    }
  }

  /** Execute warp for Teleporter affix. Target is the unit warping. */
  async executeWarp(unit, range, attacker) {
    const bestPicks = getWarpCandidates(unit, range, attacker, this.grid, (c, r) =>
      this.getUnitAt(c, r),
    );
    if (bestPicks.length === 0) return;
    const pick = bestPicks[Math.floor(Math.random() * bestPicks.length)];
    const targets = [
      unit.graphic,
      unit.label,
      unit.factionIndicator,
      unit.hpBar.bg,
      unit.hpBar.fill,
    ].filter(Boolean);
    if (targets.length <= 0) return;

    await this._awaitSceneTween(
      {
        targets,
        alpha: 0,
        duration: 180,
      },
      { label: 'execute_warp_fade_out' },
    );
    unit.col = pick.col;
    unit.row = pick.row;
    this.updateUnitPosition(unit);
    await this._awaitSceneTween(
      {
        targets,
        alpha: unit.hasActed ? 0.5 : 1,
        duration: 180,
      },
      { label: 'execute_warp_fade_in' },
    );
  }
  /** Animate a skill activation event (Vantage, Astra banner) */
  async animateSkillActivation(event) {
    const text = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY - 40,
        `${event.unit} -- ${event.name}!`,
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#88ffff',
          backgroundColor: '#000000cc',
          padding: { x: 10, y: 4 },
        },
      )
      .setOrigin(0.5)
      .setDepth(500)
      .setAlpha(0);
    this._pinToScreen(text);

    await this._awaitSceneTween(
      {
        targets: text,
        alpha: 1,
        duration: 150,
        yoyo: true,
        hold: 400,
        onComplete: () => {
          text.destroy();
        },
      },
      {
        label: 'animate_skill_activation',
        onCancel: () => text.destroy(),
      },
    );
  }

  /** Flash a brief tooltip when auto-switching from Staff to combat weapon. */
  showAutoSwitchTooltip(unit, weapon) {
    if (!unit.graphic) return;
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const text = this.add
      .text(pos.x, pos.y - 20, `Switched to ${weapon.name}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88ccff',
        backgroundColor: '#000000cc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(301);
    this.tweens.add({
      targets: text,
      alpha: 0,
      y: pos.y - 36,
      duration: 1200,
      delay: 400,
      onComplete: () => text.destroy(),
    });
  }

  /** Show poison damage floating text. */
  async showPoisonDamage(unit, damage) {
    const reduced = this._isReducedEffects();
    if (!unit.graphic) return;
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const text = this.add
      .text(pos.x, pos.y - 16, `Poison -${damage}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#cc66ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(301);
    this.updateHPBar(unit);
    await this._awaitSceneTween(
      {
        targets: text,
        y: pos.y - 32,
        alpha: 0,
        duration: reduced ? 260 : 600,
        onComplete: () => {
          text.destroy();
        },
      },
      {
        label: 'show_poison_damage',
        onCancel: () => text.destroy(),
      },
    );
  }

  /** Award XP to a player unit after combat. Shows floating text + level-up popups. */
  async awardXP(playerUnit, opponent, opponentDied, damageDealt = null, defenderHpAtStart = null) {
    if (opponent?._noXP) return;
    let baseXp = calculateCombatXP(playerUnit, opponent, opponentDied);
    if (!opponentDied && Number.isFinite(damageDealt) && Number.isFinite(defenderHpAtStart)) {
      const safeDamage = Math.max(0, Math.trunc(damageDealt));
      const safeStartHp = Math.max(1, Math.trunc(defenderHpAtStart));
      if (safeDamage <= 0) return;
      const damageRatio = Math.min(1, safeDamage / safeStartHp);
      baseXp = Math.floor(baseXp * damageRatio);
      if (baseXp <= 0) return;
    }
    const rewardMultiplier = this.getEnemyXpMultiplier(opponent);
    const pressureXpMultiplier = this.getTurnPressureState().xpMultiplier;
    const adjustedBaseXp = Math.floor(baseXp * rewardMultiplier * pressureXpMultiplier);
    if (adjustedBaseXp <= 0) return;
    await this.awardScaledXP(playerUnit, adjustedBaseXp);
  }

  _playLevelUpSfx() {
    this._stopLevelUpSfx();
    const audio = this.registry.get('audio');
    if (!audio) return;
    this._levelUpSfxKey = 'sfx_levelup';
    audio.playSFX(this._levelUpSfxKey);
  }

  _stopLevelUpSfx() {
    if (!this._levelUpSfxKey) return;
    if (typeof this.sound?.stopByKey === 'function') {
      this.sound.stopByKey(this._levelUpSfxKey);
    }
    this._levelUpSfxKey = null;
  }

  async awardScaledXP(playerUnit, baseXp) {
    const hasTurnInfo = typeof this.getCurrentTurnNumber === 'function';
    const turnsTaken = hasTurnInfo ? this.getCurrentTurnNumber() : 0;
    const parXpMult = hasTurnInfo
      ? getParXpMultiplier(turnsTaken, this.turnPar, this.turnBonusConfig)
      : 1;
    const xpMultiplier = Number.isFinite(this.battleParams?.xpMultiplier)
      ? this.battleParams.xpMultiplier
      : 1;
    const blessingXpDelta = this.runManager?.getXpMultiplierDelta?.() || 0;
    const xp = Math.max(1, Math.floor(baseXp * parXpMult * (xpMultiplier + blessingXpDelta)));

    // Show floating XP text
    const pos = this.grid.gridToPixel(playerUnit.col, playerUnit.row);
    const xpText = this.add
      .text(pos.x, pos.y - 20, `+${xp} XP`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#88ccff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);

    this.tweens.add({
      targets: xpText,
      y: pos.y - 44,
      alpha: 0,
      duration: 800,
      onComplete: () => xpText.destroy(),
    });

    // Apply XP and check for level-ups
    const extendedLevelingEnabled =
      this.runManager?.getDifficultyModifier('extendedLevelingEnabled', false) || false;
    const result = gainExperience(playerUnit, xp, { extendedLevelingEnabled });

    // Show level-up popups sequentially
    for (const lvUp of result.levelUps) {
      this._playLevelUpSfx();
      // Update HP bar after level-up (maxHP may have increased)
      this.updateHPBar(playerUnit);
      // Check for new skills learned at this level
      const learnedIds = checkLevelUpSkills(playerUnit, this.gameData.classes);
      const learnedNames = learnedIds.map((id) => {
        const skill = this.gameData.skills.find((s) => s.id === id);
        return skill ? skill.name : id;
      });
      const popup = new LevelUpPopup(this, playerUnit, lvUp, false, learnedNames);
      try {
        await popup.show();
      } finally {
        this._stopLevelUpSfx();
      }
    }
  }

  async removeUnit(unit, options = {}) {
    if (!unit || unit._removing) return;
    const killer = options?.killer || null;
    unit._removing = true;
    const deathCol = unit.col;
    const deathRow = unit.row;

    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_death');
    this.removeUnitGraphic(unit);
    // Splice in-place so TurnManager's reference stays valid
    if (unit.faction === 'player') {
      const idx = this.playerUnits.indexOf(unit);
      if (idx !== -1) {
        this.playerUnits.splice(idx, 1);
        this._playerDeathsThisBattle = (this._playerDeathsThisBattle || 0) + 1;
        // Lord farewell dialogue (non-Edric; Edric death triggers game over elsewhere)
        if (unit.isLord && unit.name !== 'Edric') {
          const farewellPool = this.gameData?.dialogue?.lordFarewell?.[unit.name];
          if (Array.isArray(farewellPool) && farewellPool.length > 0) {
            const line = farewellPool[Math.floor(Math.random() * farewellPool.length)];
            const portraitKey = this._getPortraitKey(unit);
            try {
              await this.dialogueOverlay?.show(unit.name, line, portraitKey);
            } catch (_) {}
          }
        }
      }
    } else if (unit.faction === 'npc') {
      const idx = this.npcUnits.indexOf(unit);
      if (idx !== -1) this.npcUnits.splice(idx, 1);
    } else {
      const idx = this.enemyUnits.indexOf(unit);
      if (idx !== -1) this.enemyUnits.splice(idx, 1);
      this._applyKillRewards(unit, killer);
      // Zombie revival: create tombstone if killed by non-Light weapon
      if (ZOMBIE_CLASSES.has(unit.className) && !unit._revived && !unit.isBoss) {
        const killerWeaponType = killer?.weapon?.type;
        if (killerWeaponType !== 'Light') {
          this._zombieTombstones = this._zombieTombstones || [];
          this._zombieTombstones.push({
            col: deathCol,
            row: deathRow,
            turnsRemaining: 3,
            snapshot: {
              className: unit.className,
              level: unit.level,
              weapon: structuredClone(unit.weapon),
              inventory: structuredClone(unit.inventory || []),
              skills: [...(unit.skills || [])],
              stats: { ...unit.stats },
              moveType: unit.moveType,
              proficiencies: structuredClone(unit.proficiencies || []),
              tier: unit.tier || 'base',
              mov: unit.mov,
            },
          });
        }
      }
    }
    this.dangerZoneStale = true;
    // Detect boss death on seize maps -- show prominent notification
    if (unit.isBoss && unit.faction === 'enemy' && this.battleConfig.objective === 'seize') {
      this._showBossDefeatedBanner();
    }
    this.updateObjectiveText();

    const deathEffects = getOnDeathAffixes(unit, this.gameData.affixes);
    const hasAoEDeathEffect = deathEffects.some((effect) => effect?.type === 'aoe_damage');
    if (hasAoEDeathEffect) {
      this._deathAffixChainDepth = (this._deathAffixChainDepth || 0) + 1;
    }
    try {
      for (const effect of deathEffects) {
        if (effect.type !== 'aoe_damage') continue;
        const victims = [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits].filter(
          (other) => gridDistance(deathCol, deathRow, other.col, other.row) <= (effect.range || 1),
        );
        for (const victim of victims) {
          if (victim.currentHP <= 0) continue;
          victim.currentHP = Math.max(0, victim.currentHP - effect.amount);
          this.updateHPBar(victim);
          const pos = this.grid.gridToPixel(victim.col, victim.row);
          const txt = this.add
            .text(pos.x, pos.y - 16, `${effect.amount}`, {
              fontFamily: 'monospace',
              fontSize: '12px',
              color: '#ff8844',
              fontStyle: 'bold',
            })
            .setOrigin(0.5)
            .setDepth(320);
          this.tweens.add({
            targets: txt,
            y: pos.y - 32,
            alpha: 0,
            duration: 500,
            onComplete: () => txt.destroy(),
          });
          if (victim.currentHP <= 0) {
            await this.removeUnit(victim, { killer: unit });
          }
        }
        await this._awaitSceneDelay(150, { label: 'death_affix_chain_tick' });
      }
    } finally {
      if (hasAoEDeathEffect) {
        this._deathAffixChainDepth = Math.max(0, (this._deathAffixChainDepth || 1) - 1);
        if (this._deathAffixChainDepth === 0 && this.battleState !== 'BATTLE_END') {
          this.checkBattleEnd();
        }
      }
    }

    // Clear any temporary walls owned by this unit (waller affix cleanup)
    this.grid?.clearTemporaryTerrainsBySource?.(unit);

    unit._removing = false;
  }

  // --- Phase management ---

  onPhaseChange(phase, turn) {
    const scheduleSafeDelayedAsync =
      typeof this._scheduleSafeDelayedAsync === 'function'
        ? (delayMs, label, callback, options) =>
            this._scheduleSafeDelayedAsync(delayMs, label, callback, options)
        : (delayMs, label, callback, options = {}) => {
            if (typeof this.time?.delayedCall !== 'function') return null;
            const { phase: callbackPhase = phase, turn: callbackTurn = turn, onError } = options;
            return this.time.delayedCall(delayMs, () => {
              Promise.resolve()
                .then(() => callback?.())
                .catch(async (error) => {
                  reportAsyncError(`BattleScene-${label}`, error, {
                    scene: 'BattleScene',
                    phase: callbackPhase,
                    turn: callbackTurn,
                    battleState: this.battleState ?? null,
                  });
                  if (typeof onError === 'function') {
                    await onError(error);
                  }
                });
            });
          };
    const isSceneActiveForAsync =
      typeof this._isSceneActiveForAsync === 'function'
        ? () => this._isSceneActiveForAsync()
        : () => true;
    const withTutorialHintState =
      typeof this._withTutorialHintState === 'function'
        ? (fn) => this._withTutorialHintState(fn)
        : async (fn) => {
            await fn();
          };
    if (typeof this._clearCombatRollSession === 'function') this._clearCombatRollSession();
    if (this.isMobileInput) {
      this.inspectMode = false;
      if (this.inspectionPanel?.visible) this.inspectionPanel.hide();
      this.grid?.clearHighlights?.();
      this.grid?.clearAttackHighlights?.();
    }
    this.showPhaseBanner(phase, turn);
    this.dangerZoneStale = true;
    this.dangerZone.hide();
    if (typeof this._expireTimedWeaponArtBuffs === 'function') {
      this._expireTimedWeaponArtBuffs(phase, turn);
    }

    if (phase === 'player') {
      // Reset player units for new turn
      for (const u of this.playerUnits) {
        u.hasMoved = false;
        u.hasActed = false;
        u._movementSpent = 0;
        u._gambitUsedThisTurn = false;
        resetWeaponArtTurnUsage(u, { turnNumber: turn });
        this.undimUnit(u);
      }
      this.battleState = 'PLAYER_IDLE';

      // Condition recovery runs FIRST so sleeping/silenced units get their chance
      // before the all-sleeping auto-advance check
      const earlyRecovery = processConditionRecovery(this.playerUnits);
      for (const evt of earlyRecovery) {
        const labelByCondition = {
          sleep: 'woke up',
          silence: 'recovered from Silence',
          acid: 'recovered from Acid',
        };
        const label = labelByCondition[evt.conditionId] || `recovered from ${evt.conditionId}`;
        this.showBriefBanner(`${evt.unit.name} ${label}!`, '#88ff88');
        this._removeConditionIcon(evt.unit, evt.conditionId);
        this.undimUnit(evt.unit);
      }

      // Sleeping units stay dimmed / can't act
      for (const u of this.playerUnits) {
        if (isSleeping(u)) this.dimUnit(u);
      }

      // All-sleeping auto-advance: run normal turn-start pipeline, then skip phase.
      const allSleeping = this.playerUnits.every((u) => !u || u.currentHP <= 0 || isSleeping(u));
      const shouldAutoAdvance = allSleeping && this.playerUnits.some((u) => u && u.currentHP > 0);

      // Reset first-hit flag for Shielded affix
      for (const enemy of this.enemyUnits) {
        enemy._hitByPlayerThisPhase = false;
      }

      // Update turn counter at start of each player phase
      if (this.turnCounterText && this.turnPar !== null) {
        const rating = getRating(turn, this.turnPar, this.turnBonusConfig);
        const colors = { S: '#44ff44', A: '#88ccff', B: '#ffaa55', C: '#cc3333' };
        const pressureSuffix = this.getTurnPressureSummary(turn);
        this.turnCounterText.setText(
          `Turn: ${turn} / Par: ${this.turnPar} (${rating.rating})${pressureSuffix}`,
        );
        this.turnCounterText.setColor(colors[rating.rating] || '#e0e0e0');
      } else if (this.turnCounterText) {
        const pressureSuffix = this.getTurnPressureSummary(turn);
        this.turnCounterText.setText(`Turn: ${turn}${pressureSuffix}`);
        this.turnCounterText.setColor('#e0e0e0');
      }
      const latePressure = this.getTurnPressureState(turn);
      if (latePressure.active && !this._latePressureWarningShown) {
        this._latePressureWarningShown = true;
        showMinorHint(this, 'Taking too long reduces rewards.');
      }

      // Update fog of war at start of player phase
      if (this.grid.fogEnabled) {
        this.grid.updateFogOfWar(this.playerUnits);
        this.updateEnemyVisibility();
      }
      this.captureVisionSnapshot();
      this.updateVisionHud();

      // Process turn-start effects (skills + affixes) (after banner settles)
      scheduleSafeDelayedAsync(
        1200,
        'player_phase_turn_start_pipeline',
        async () => {
          // A fast End Turn (E within the banner delay) flips to the enemy
          // phase before this fires — player heals/ballista fire must not land
          // in the middle of enemy actions.
          if (
            this.turnManager?.currentPhase !== 'player' ||
            this.turnManager?.turnNumber !== turn ||
            this.battleState === 'BATTLE_END'
          ) {
            return;
          }
          await this.processTurnStartEffects(this.playerUnits, { skipRecovery: true });
          await this.processBallistaFire(this.enemyUnits, 'player');
          if (shouldAutoAdvance && this.battleState === 'PLAYER_IDLE') {
            this.turnManager.endPlayerPhase();
          }
        },
        {
          phase: 'player',
          turn,
          onError: async () => {
            // All-sleeping auto-advance must remain deterministic even if effects fail.
            if (
              shouldAutoAdvance &&
              isSceneActiveForAsync() &&
              this.battleState === 'PLAYER_IDLE'
            ) {
              this.turnManager.endPlayerPhase();
            }
          },
        },
      );

      if (!shouldAutoAdvance) {
        // Tutorial hints (after phase banner fades)
        if (this.battleParams.tutorialMode && this.tutorialStep === 0) {
          scheduleSafeDelayedAsync(
            1500,
            'tutorial_intro_turn_start',
            async () => {
              if (!isSceneActiveForAsync()) return;
              await withTutorialHintState(async () => {
                await showImportantHint(
                  this,
                  'Welcome to the tutorial!\nLearn the basics of tactical combat.',
                );
                if (!isSceneActiveForAsync()) return;
                this.tutorialStep = 1;
                const verb = this.isMobileInput ? 'Tap' : 'Click';
                await showImportantHint(
                  this,
                  `${verb} a blue unit to select it.\nBlue tiles show where it can move.`,
                );
                if (!isSceneActiveForAsync()) return;
                this.tutorialStep = 2;
                this._setTutorialGuideHighlight('edric');
              });
            },
            { phase: 'player', turn },
          );
        } else if (
          this.battleParams.tutorialMode &&
          !this._tutorialVisionIntroShown &&
          turn === 3
        ) {
          this._tutorialVisionIntroShown = true;
          scheduleSafeDelayedAsync(
            1500,
            'tutorial_vision_intro',
            async () => {
              if (!isSceneActiveForAsync()) return;
              await withTutorialHintState(async () => {
                await showImportantHint(this, this._getVisionRewindIntroHint());
              });
            },
            { phase: 'player', turn },
          );
        } else if (this.battleParams.tutorialMode) {
          // Suppress normal hints during tutorial -- do nothing
        } else {
          const hints = this.registry.get('hints');
          if (hints && turn === 1) {
            scheduleSafeDelayedAsync(
              1500,
              'battle_first_turn_hints',
              async () => {
                if (!isSceneActiveForAsync()) return;
                if (hints.shouldShow('battle_first_turn')) {
                  const inspectHint = this.isMobileInput
                    ? 'Tap a blue unit to move, then choose an action.\nTap an enemy to see its range.\nUse Inspect or long-press any unit for details.'
                    : 'Click a blue unit to move, then choose an action.\nRight-click any unit to inspect.';
                  await showImportantHint(this, inspectHint);
                }
                if (this.npcUnits.length > 0 && hints.shouldShow('battle_recruit')) {
                  await showImportantHint(
                    this,
                    'Move a Lord adjacent to the green NPC\nand select Talk to recruit them!',
                  );
                }
                if (this.battleParams.objective === 'seize' && hints.shouldShow('battle_seize')) {
                  await showImportantHint(
                    this,
                    'Defeat the boss, then move a Lord\nto the throne and select Seize!',
                  );
                }
              },
              { phase: 'player', turn },
            );
          } else if (hints && turn === 2) {
            this.time.delayedCall(1500, () => {
              if (hints.shouldShow('battle_danger_zone')) {
                showMinorHint(this, 'Press [D] to show enemy threat range.');
              }
            });
          }
        } // end else (non-tutorial hints)
      }
    } else if (phase === 'enemy') {
      this.battleState = 'ENEMY_PHASE';
      this.updateAntiTurtlePressure(turn);
      this.grid.tickTemporaryTerrains?.();
      for (const u of this.enemyUnits) {
        resetWeaponArtTurnUsage(u, { turnNumber: turn });
      }
      // End-of-player-phase terrain hazards, then enemy turn start effects.
      scheduleSafeDelayedAsync(
        1400,
        'enemy_phase_turn_start_pipeline',
        async () => {
          // Symmetric guard: bail if this enemy phase was superseded (battle
          // end or Vision rewind) during the banner delay.
          if (
            this.turnManager?.currentPhase !== 'enemy' ||
            this.turnManager?.turnNumber !== turn ||
            this.battleState === 'BATTLE_END'
          ) {
            return;
          }
          await this.processTerrainDamage(this.playerUnits);
          await this.processTurnStartEffects(this.enemyUnits);
          await this.processZombieRevival();
          await this.processBallistaFire(this.playerUnits, 'enemy');
          this.applyDueHybridOverridesForTurn(turn);
          await this.startEnemyPhase();
        },
        { phase: 'enemy', turn },
      );
    }
    this.refreshEndTurnControl();
  }

  /** Apply all turn-start effects (skills, affixes, terrain) in unified sequence */
  async processTurnStartEffects(units, { skipRecovery = false } = {}) {
    // 0. Status condition recovery (sleep/silence)
    // Player-phase recovery runs early (before all-sleeping check), so skip here
    if (!skipRecovery) {
      const recoveryEvents = processConditionRecovery(units);
      for (const evt of recoveryEvents) {
        const labelByCondition = {
          sleep: 'woke up',
          silence: 'recovered from Silence',
          acid: 'recovered from Acid',
        };
        const label = labelByCondition[evt.conditionId] || `recovered from ${evt.conditionId}`;
        await this.showBriefBanner(`${evt.unit.name} ${label}!`, '#88ff88');
        this._removeConditionIcon(evt.unit, evt.conditionId);
        this.undimUnit(evt.unit);
      }
    }

    // 0b. Acid tick damage (non-lethal, maxHP-scaled)
    await this._processAcidTicks(units);

    // 1. Skill effects (e.g. Renewal)
    const skillEffects = getTurnStartEffects(units, this.gameData.skills);
    for (const effect of skillEffects) {
      if (effect.type === 'heal' && effect.amount > 0) {
        effect.target.currentHP = Math.min(
          effect.target.stats.HP,
          effect.target.currentHP + effect.amount,
        );
        this.updateHPBar(effect.target);
        await this.animateHeal(effect.target, effect.amount);
      }
    }

    // 2. Affix effects (e.g. Regenerator, Waller)
    const affixEffects = getTurnStartAffixes(units, this.gameData.affixes);
    for (const effect of affixEffects) {
      if (effect.type === 'heal' && effect.amount > 0) {
        effect.target.currentHP = Math.min(
          effect.target.stats.HP,
          effect.target.currentHP + effect.amount,
        );
        this.updateHPBar(effect.target);
        await this.animateHeal(effect.target, effect.amount);
      } else if (effect.type === 'spawn_terrain') {
        await this.executeWallerSpawn(effect);
      }
    }

    // 3. Terrain healing (Fort/Throne)
    await this.processTerrainHealing(units);
  }

  async _processAcidTicks(units) {
    for (const unit of units) {
      if (!unit || unit.currentHP <= 0 || !isAcidPoisoned(unit)) continue;
      const tickDamage = computeAcidDamage(unit.stats?.HP);
      const nextHP = Math.max(1, unit.currentHP - tickDamage);
      const appliedDamage = unit.currentHP - nextHP;
      if (appliedDamage <= 0) continue;
      unit.currentHP = nextHP;
      this.updateHPBar(unit);
      await this.showAcidDamage(unit, appliedDamage);
    }
  }

  /** Backward-compatible alias for older call sites/cherry-picks. */
  async processTurnStartSkills(units) {
    return this.processTurnStartEffects(units);
  }

  async processBallistaFire(targetUnits, owner) {
    if (!this.ballistas || this.ballistas.length === 0) return;
    const reduced = this._isReducedEffects();
    for (const ballista of this.ballistas) {
      if (ballista.owner !== owner) continue;
      const target = selectBallistaTarget(ballista, targetUnits);
      if (!target) continue;
      const result = resolveBallistaStrike(ballista, target);
      if (result.didHit) {
        target.currentHP = Math.max(0, target.currentHP - result.damage);
        this.updateHPBar(target);
        if (target.graphic) {
          const pos = this.grid.gridToPixel(target.col, target.row);
          const txt = this.add
            .text(pos.x, pos.y - 16, `${result.damage}`, {
              fontFamily: 'monospace',
              fontSize: '13px',
              color: '#ff8844',
              fontStyle: 'bold',
            })
            .setOrigin(0.5)
            .setDepth(301);
          await this._awaitSceneTween(
            {
              targets: txt,
              y: pos.y - 32,
              alpha: 0,
              duration: reduced ? 260 : 600,
              onComplete: () => {
                txt.destroy();
              },
            },
            {
              label: 'ballista_hit_float',
              onCancel: () => txt.destroy(),
            },
          );
        }
        if (target.currentHP <= 0) {
          await this.removeUnit(target, { killer: null });
          this.checkBattleEnd();
          if (this.battleState === 'BATTLE_END') return;
        }
      } else if (target.graphic) {
        const pos = this.grid.gridToPixel(target.col, target.row);
        const txt = this.add
          .text(pos.x, pos.y - 16, 'Miss', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(301);
        await this._awaitSceneTween(
          {
            targets: txt,
            y: pos.y - 32,
            alpha: 0,
            duration: reduced ? 260 : 600,
            onComplete: () => {
              txt.destroy();
            },
          },
          {
            label: 'ballista_miss_float',
            onCancel: () => txt.destroy(),
          },
        );
      }
    }
  }

  async processZombieRevival() {
    if (!this._zombieTombstones || this._zombieTombstones.length === 0) return;
    const revived = [];
    this._zombieTombstones = this._zombieTombstones.filter((tomb) => {
      tomb.turnsRemaining--;
      if (tomb.turnsRemaining > 0) return true;
      revived.push(tomb);
      return false;
    });
    for (const tomb of revived) {
      const snap = tomb.snapshot;
      // Find spawn position -- original tile or nearest passable+empty
      let spawnCol = tomb.col;
      let spawnRow = tomb.row;
      const deathTerrain = this.grid.getTerrainAt(spawnCol, spawnRow);
      const deathMc = deathTerrain?.moveCost?.[snap.moveType];
      const deathImpassable = deathMc === '--' || deathMc == null;
      if (deathImpassable || this.getUnitAt(spawnCol, spawnRow)) {
        const dirs = [
          { dc: -1, dr: 0 },
          { dc: 1, dr: 0 },
          { dc: 0, dr: -1 },
          { dc: 0, dr: 1 },
        ];
        let found = false;
        for (const { dc, dr } of dirs) {
          const nc = spawnCol + dc;
          const nr = spawnRow + dr;
          if (
            nc >= 0 &&
            nc < this.battleConfig.cols &&
            nr >= 0 &&
            nr < this.battleConfig.rows &&
            !this.getUnitAt(nc, nr)
          ) {
            const t = this.grid.getTerrainAt(nc, nr);
            const mc = t?.moveCost?.[snap.moveType];
            if (mc === '--' || mc == null) continue; // impassable -> skip
            spawnCol = nc;
            spawnRow = nr;
            found = true;
            break;
          }
        }
        if (!found) continue; // no room -- skip revival
      }
      const unit = {
        name: snap.className,
        className: snap.className,
        tier: snap.tier || 'base',
        level: snap.level,
        xp: 0,
        isLord: false,
        personalGrowths: null,
        growths: {},
        proficiencies: structuredClone(snap.proficiencies || []),
        skills: [...snap.skills],
        col: spawnCol,
        row: spawnRow,
        mov: snap.mov || snap.stats.MOV || 4,
        moveType: snap.moveType || 'Infantry',
        stats: { ...snap.stats },
        currentHP: Math.max(1, Math.floor(snap.stats.HP / 2)),
        faction: 'enemy',
        weapon: snap.weapon ? structuredClone(snap.weapon) : null,
        inventory: snap.weapon ? [structuredClone(snap.weapon)] : [],
        consumables: [],
        affixes: [],
        accessory: null,
        weaponRank: snap.proficiencies?.[0]?.rank || 'Prof',
        hasMoved: false,
        hasActed: false,
        _revived: true,
        _noXP: true,
        isBoss: false,
        graphic: null,
        label: null,
        hpBar: null,
      };
      this.enemyUnits.push(unit);
      this.addUnitGraphic(unit);
      await this.showBriefBanner(`${unit.className} has risen!`, '#cc66cc');
    }
    if (revived.length > 0) this.checkBattleEnd();
  }

  /** Handle the Waller affix terrain creation */
  async executeWallerSpawn(effect) {
    const unit = effect.sourceUnit;
    const range = effect.range || 1;
    const moveType = unit.moveType || 'Infantry';

    // Find valid adjacent tiles: empty, no combat stats (Plain/Floor usually)
    const candidates = [];
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (Math.abs(dr) + Math.abs(dc) > range) continue;
        const col = unit.col + dc;
        const row = unit.row + dr;

        if (col < 0 || col >= this.grid.cols || row < 0 || row >= this.grid.rows) continue;
        if (this.getUnitAt(col, row)) continue;

        const terrain = this.grid.getTerrainAt(col, row);
        if (!terrain) continue;

        // Explicitly protect Fort and Throne tiles from being overwritten
        if (terrain.name === 'Fort' || terrain.name === 'Throne') continue;

        // Only spawn on "boring" terrain (no DEF/AVO bonus) to avoid destroying tactical spots
        const hasCombatBonus =
          (parseInt(terrain?.avoidBonus) || 0) !== 0 || (parseInt(terrain?.defBonus) || 0) !== 0;
        if (!hasCombatBonus) {
          candidates.push({ col, row });
        }
      }
    }

    if (candidates.length === 0) return;

    // Anti-self-trap: filter out candidates that would leave waller with 0 walkable neighbors
    const safeCandidates = candidates.filter((c) => {
      // Simulate placing a wall at this candidate -- count remaining walkable neighbors
      let walkable = 0;
      for (const [dc, dr] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nc = unit.col + dc;
        const nr = unit.row + dr;
        if (nc < 0 || nc >= this.grid.cols || nr < 0 || nr >= this.grid.rows) continue;
        // This candidate would become a wall
        if (nc === c.col && nr === c.row) continue;
        const neighbor = this.grid.getTerrainAt(nc, nr);
        if (!neighbor) continue;
        const cost = neighbor.moveCost?.[moveType];
        if (cost === '--') continue;
        // Check occupancy (another unit blocking), but waller itself is OK
        const occupant = this.getUnitAt(nc, nr);
        if (occupant && occupant !== unit) continue;
        walkable++;
      }
      return walkable > 0;
    });

    const pool = safeCandidates.length > 0 ? safeCandidates : [];
    if (pool.length === 0) return;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (this.grid.setTemporaryTerrain) {
      this.grid.setTemporaryTerrain(pick.col, pick.row, effect.terrainType, effect.duration, unit);
      // Visual feedback
      const pos = this.grid.gridToPixel(pick.col, pick.row);
      this.showMinorHintAt(pos.x, pos.y, 'Wall!', '#ffffff');
    }
  }

  showMinorHintAt(x, y, message, color = '#ffdd44') {
    const text = this.add
      .text(x, y, message, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(1000);
    text._forceWorldCamera = true;

    this.tweens.add({
      targets: text,
      y: y - 20,
      alpha: 0,
      delay: 800,
      duration: 600,
      onComplete: () => text.destroy(),
    });
  }

  /** Apply a battle-scoped stat debuff (e.g. Corrosive) with flooring guards. */
  applyBattleDebuff(unit, stat, value) {
    if (!unit._battleDeltas) unit._battleDeltas = {};
    if (!unit._battleDeltas[stat]) unit._battleDeltas[stat] = 0;

    const oldVal = unit.stats[stat];
    // Apply delta
    unit.stats[stat] = Math.max(0, unit.stats[stat] + value);
    // Special guard for MOV: minimum 1
    if (stat === 'MOV') unit.stats[stat] = Math.max(1, unit.stats[stat]);

    // Store the actual delta applied (in case value was clamped by floor)
    const actualDelta = unit.stats[stat] - oldVal;
    unit._battleDeltas[stat] += actualDelta;

    if (stat === 'MOV') unit.mov = unit.stats.MOV;
  }

  clearBattleScopedDeltas(units) {
    if (!Array.isArray(units)) return;
    for (const unit of units) {
      if (!unit?._battleDeltas) continue;
      for (const [stat, delta] of Object.entries(unit._battleDeltas)) {
        if (!Number.isFinite(delta) || delta === 0) continue;
        unit.stats[stat] = (unit.stats[stat] || 0) - delta;
        if (stat === 'MOV') unit.stats[stat] = Math.max(1, unit.stats[stat] || 1);
        else unit.stats[stat] = Math.max(0, unit.stats[stat] || 0);
      }
      unit.mov = unit.stats.MOV;
      delete unit._battleDeltas;
    }
  }

  /** Heal units standing on Fort or Throne at turn start */
  async processTerrainHealing(units) {
    for (const unit of units) {
      const terrainIdx = this.grid.mapLayout[unit.row]?.[unit.col];
      const onFort = terrainIdx === TERRAIN.Fort || terrainIdx === TERRAIN.Throne;
      if (!onFort) {
        unit._fortHealStreak = 0;
        continue;
      }
      if (unit.currentHP >= unit.stats.HP) continue;
      const streak = Math.max(0, unit._fortHealStreak || 0);
      const decayIdx = Math.min(streak, FORT_HEAL_DECAY_MULTIPLIERS.length - 1);
      const decayMult = FORT_HEAL_DECAY_MULTIPLIERS[decayIdx];
      const baseHeal = Math.max(1, Math.floor(unit.stats.HP * TERRAIN_HEAL_PERCENT));
      const healAmount = Math.floor(baseHeal * decayMult);
      unit._fortHealStreak = streak + 1;
      if (healAmount <= 0) continue;
      unit.currentHP = Math.min(unit.stats.HP, unit.currentHP + healAmount);
      this.updateHPBar(unit);
      await this.animateHeal(unit, healAmount);
    }
  }

  async processTerrainDamage(units) {
    for (const unit of [...units]) {
      if (!unit || unit._removing || unit.currentHP <= 0) continue;
      if (isEntity(unit)) continue; // Entity immune to terrain hazards
      const terrainIdx = this.grid.mapLayout[unit.row]?.[unit.col];
      if (isLavaCrackTerrainIndex(terrainIdx)) {
        const { nextHP, appliedDamage } = computeLavaCrackHp(unit.currentHP, LAVA_CRACK_DAMAGE);
        if (appliedDamage <= 0) continue;
        unit.currentHP = nextHP;
        this.updateHPBar(unit);
        await this.showTerrainDamage(unit, appliedDamage);
        // Lava damage wakes sleeping units
        if (isSleeping(unit)) {
          removeCondition(unit, 'sleep');
          this._removeConditionIcon(unit, 'sleep');
          this.undimUnit(unit);
          await this.showBriefBanner(`${unit.name} woke up from lava damage!`, '#ff8844');
        }
        await this._checkPhoenixBrooch(unit);
        continue;
      }

      if (!isAcidTerrainIndex(terrainIdx)) continue;
      if (unit.moveType === 'Flying') continue;
      if (unit.poisonImmune || unit.terrainHazardImmune) continue;

      applyCondition(unit, 'acid');
      this._addConditionIcon(unit, 'acid');
      await this.showBriefBanner(`${unit.name} is corroded by acid!`, '#88cc44');
    }
  }

  async showTerrainDamage(unit, damage) {
    const wasTinted = Boolean(unit.graphic?.isTinted);
    const previousTint = unit.graphic?.tintTopLeft;
    if (unit.graphic?.setTint) unit.graphic.setTint(0xff4400);

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const text = this.add
      .text(pos.x, pos.y - 16, `Lava -${damage}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ff8844',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(320);

    this.tweens.add({
      targets: text,
      y: pos.y - 32,
      alpha: 0,
      duration: 450,
      onComplete: () => text.destroy(),
    });

    await this._awaitSceneDelay(120, { label: 'terrain_damage_tint_clear' });
    if (unit.graphic) {
      if (wasTinted && unit.graphic.setTint && previousTint != null)
        unit.graphic.setTint(previousTint);
      else if (unit.graphic.clearTint) unit.graphic.clearTint();
    }
    await this._awaitSceneDelay(60, { label: 'terrain_damage_tail' });
  }

  async showAcidDamage(unit, damage) {
    const wasTinted = Boolean(unit.graphic?.isTinted);
    const previousTint = unit.graphic?.tintTopLeft;
    if (unit.graphic?.setTint) unit.graphic.setTint(0x88cc44);

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const text = this.add
      .text(pos.x, pos.y - 16, `Acid -${damage}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#88cc44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(320);

    this.tweens.add({
      targets: text,
      y: pos.y - 32,
      alpha: 0,
      duration: 450,
      onComplete: () => text.destroy(),
    });

    await this._awaitSceneDelay(120, { label: 'acid_damage_tint_clear' });
    if (unit.graphic) {
      if (wasTinted && unit.graphic.setTint && previousTint != null)
        unit.graphic.setTint(previousTint);
      else if (unit.graphic.clearTint) unit.graphic.clearTint();
    }
    await this._awaitSceneDelay(60, { label: 'acid_damage_tail' });
  }

  async startEnemyPhase() {
    // Epoch token: a Vision rewind restores a player-phase snapshot while this
    // async pipeline may still be in flight (AI loop or the tail below). Every
    // step re-checks the epoch so a superseded phase can never act on, or
    // advance, the rewound state.
    this._enemyPhaseEpoch = (this._enemyPhaseEpoch || 0) + 1;
    const phaseEpoch = this._enemyPhaseEpoch;
    const phaseSuperseded = () =>
      phaseEpoch !== this._enemyPhaseEpoch || this.battleState === 'BATTLE_END';
    // Defer rout victory until after reinforcements are applied (cleared below)
    this._reinforcementsPendingThisTurn = true;
    try {
      // Debug: skip enemy phase entirely
      if (this.isDevToolsEnabled() && this._debugSkipEnemyPhase) {
        this._debugSkipEnemyPhase = false;
        if (this.battleState !== 'BATTLE_END') {
          this.applyReinforcementsForTurn(this.turnManager.turnNumber);
          this._reinforcementsPendingThisTurn = false;
          const ended = this.checkBattleEnd();
          if (!ended && this.battleState !== 'BATTLE_END') this.turnManager.endEnemyPhase();
        }
        return;
      }

      this.currentEnemyPhaseAiStats = this.createEnemyPhaseAiStats();
      try {
        await this.aiController.processEnemyPhase(
          this.enemyUnits,
          this.playerUnits,
          this.npcUnits,
          {
            onMoveUnit: (enemy, path) => {
              if (this.visionDialog || phaseSuperseded()) return Promise.resolve();
              return this.animateEnemyMove(enemy, path);
            },
            onStatusStaff: (enemy, target) => {
              if (this.visionDialog || phaseSuperseded()) return Promise.resolve();
              return this.executeEnemyStatusStaff(enemy, target);
            },
            onAttack: (enemy, target) => {
              if (this.visionDialog || phaseSuperseded()) return Promise.resolve();
              return this.executeEnemyCombat(enemy, target);
            },
            onBreak: (enemy, tile) => {
              if (this.visionDialog || phaseSuperseded()) return Promise.resolve();
              return this.executeEnemyBreak(enemy, tile);
            },
            onDecision: (enemy, decision) => this.recordEnemyAiDecision(enemy, decision),
            onUnitDone: (enemy) => {
              enemy.hasActed = true;
              this.dimUnit(enemy);
            },
          },
        );
      } finally {
        this.finalizeEnemyPhaseAiStats();
      }

      // End enemy phase. Skip the whole tail when the battle ended, when a
      // lord-death Vision prompt is pending (its outcome — rewind or defeat —
      // supersedes the tail), or when a rewind already replaced this phase.
      if (!phaseSuperseded() && !this.visionDialog) {
        await this.processTerrainDamage(this.enemyUnits);
        // Re-check after the await: terrain damage can kill Edric and open the
        // Vision prompt, and a rewind clicked during the animations invalidates
        // this phase entirely.
        if (!phaseSuperseded() && !this.visionDialog) {
          this.applyReinforcementsForTurn(this.turnManager.turnNumber);
          this._reinforcementsPendingThisTurn = false;
          const ended = this.checkBattleEnd();
          if (!ended && !phaseSuperseded() && !this.visionDialog) {
            this.turnManager.endEnemyPhase();
          }
        }
      }
    } finally {
      this._reinforcementsPendingThisTurn = false;
    }
  }

  async animateEnemyMove(enemy, path) {
    if (!path || path.length < 2) return;

    const occupied = this.buildOccupiedSet(enemy);
    const effective = computeEffectivePath(
      path,
      this.grid.mapLayout,
      this.grid.terrainData,
      this.grid.cols,
      this.grid.rows,
      enemy.moveType,
      occupied,
      this._getCostModifier(enemy),
    );
    const finalPath = effective.effectivePath;
    if (!finalPath || finalPath.length < 2) return;

    const targets = enemy.label ? [enemy.graphic, enemy.label] : [enemy.graphic];

    for (let stepIndex = 1; stepIndex < finalPath.length; stepIndex++) {
      const pos = this.grid.gridToPixel(finalPath[stepIndex].col, finalPath[stepIndex].row);
      const isSlide = effective.slideSegments.some(
        (seg) => stepIndex >= seg.startIndex && stepIndex < seg.startIndex + seg.slidePath.length,
      );
      const duration = isSlide ? 60 : 80;
      await this._awaitSceneTween(
        {
          targets,
          x: pos.x,
          y: pos.y,
          duration,
          ease: 'Linear',
        },
        { label: 'animate_enemy_move_step', timeoutMs: duration + 700 },
      );
      if (!this._isSceneActiveForAsync()) return;
    }

    const dest = finalPath[finalPath.length - 1];
    enemy.col = dest.col;
    enemy.row = dest.row;
    this.updateUnitPosition(enemy);
    if (this.grid.fogEnabled) this.updateEnemyVisibility();
  }

  async executeEnemyStatusStaff(enemy, target) {
    const staff = enemy.statusStaff;
    if (!staff) return;
    const result = resolveStatusStaff(staff, enemy, target);
    spendStaffUse(staff);
    const hitPct = Math.round(result.hitChance);
    if (result.hit) {
      const statusText =
        result.conditionId === 'sleep'
          ? `${target.name} fell asleep!`
          : `${target.name} was silenced!`;
      await this.showBriefBanner(
        `${enemy.name} used ${staff.name}! ${statusText} (${hitPct}%)`,
        '#ff6666',
      );
      this._addConditionIcon(target, result.conditionId);
    } else {
      await this.showBriefBanner(`${enemy.name} used ${staff.name}! Miss! (${hitPct}%)`, '#aaaaaa');
    }
  }

  _addConditionIcon(unit, conditionId) {
    if (!unit?.graphic) return;
    // Remove existing icon for this condition
    this._removeConditionIcon(unit, conditionId);
    if (!unit._conditionIcons) unit._conditionIcons = {};
    const x = unit.graphic.x;
    const y = unit.graphic.y - 20;
    const iconMap = {
      sleep: { label: 'Zzz', color: '#6688ff' },
      silence: { label: 'X', color: '#cc66cc' },
      acid: { label: 'Ac', color: '#88cc44' },
    };
    const iconStyle = iconMap[conditionId] || { label: '?', color: '#dddddd' };
    const icon = this.add
      .text(x, y, iconStyle.label, {
        fontSize: '10px',
        fontFamily: 'monospace',
        color: iconStyle.color,
      })
      .setOrigin(0.5)
      .setDepth(200);
    unit._conditionIcons[conditionId] = icon;
    // Reflow all icons so multi-status doesn't overlap
    this._updateConditionIconPositions(unit);
  }

  _removeConditionIcon(unit, conditionId) {
    const icon = unit?._conditionIcons?.[conditionId];
    if (icon) {
      icon.destroy();
      delete unit._conditionIcons[conditionId];
      // Reflow remaining icons so spacing stays correct
      this._updateConditionIconPositions(unit);
    }
  }

  _removeAllConditionIcons(unit) {
    if (!unit?._conditionIcons) return;
    for (const key of Object.keys(unit._conditionIcons)) {
      unit._conditionIcons[key]?.destroy();
    }
    unit._conditionIcons = {};
  }

  _updateConditionIconPositions(unit) {
    if (!unit?.graphic || !unit?._conditionIcons) return;
    const x = unit.graphic.x;
    const y = unit.graphic.y - 20;
    let offset = 0;
    for (const icon of Object.values(unit._conditionIcons)) {
      if (icon) {
        icon.setPosition(x + offset, y);
        offset += 14;
      }
    }
  }

  async executeEnemyCombat(enemy, target) {
    this.resetFortHealStreak(enemy);
    const enemyHpAtStart = Math.max(0, Math.trunc(Number(enemy?.currentHP) || 0));

    try {
      const ctx = this._prepareCombatContext(enemy, target, { isPlayerInitiator: false });
      const { result } = await this._runCombatResolution(enemy, target, ctx);

      // Award XP to player defender if they survived
      if (target.faction === 'player' && target.currentHP > 0) {
        const counterDamage = Math.max(
          0,
          enemyHpAtStart - Math.max(0, Math.trunc(Number(result.attackerHP) || 0)),
        );
        await this.awardXP(target, enemy, enemy.currentHP <= 0, counterDamage, enemyHpAtStart);
      }

      if (target.currentHP <= 0) await this.removeUnit(target, { killer: enemy });
      if (enemy.currentHP <= 0) await this.removeUnit(enemy, { killer: target });

      // Entity splash damage on adjacent tiles after primary attack
      if (isEntity(enemy) && enemy.currentHP > 0) {
        await this._applyEntitySplash(enemy, target);
      }

      this.checkBattleEnd();
    } catch (err) {
      console.error('[BattleScene] enemy combat error:', err);
      try {
        if (target?.currentHP <= 0) await this.removeUnit(target, { killer: enemy });
        if (enemy?.currentHP <= 0) await this.removeUnit(enemy, { killer: target });
        this.checkBattleEnd();
      } catch (cleanupErr) {
        console.error('[BattleScene] enemy combat cleanup error:', cleanupErr);
      }
    } finally {
      this._clearCombatRollSession();
    }
  }

  /** Apply Entity AoE splash -- 0-2 random tiles within Manhattan 1 of primary target */
  async _applyEntitySplash(entity, primaryTarget) {
    const tiles = rollSplashTiles(
      primaryTarget.col,
      primaryTarget.row,
      entity,
      this.grid.cols,
      this.grid.rows,
      ENTITY_SPLASH_COUNT,
    );
    for (const tile of tiles) {
      const victim = this.getUnitAt(tile.col, tile.row);
      if (!victim || victim === primaryTarget || victim.currentHP <= 0) continue;
      if (victim.faction === 'enemy') continue; // Don't splash allies
      const dmg = rollSplashDamage();
      victim.currentHP = Math.max(0, victim.currentHP - dmg);
      this.updateHPBar(victim);
      const pos = this.grid.gridToPixel(tile.col, tile.row);
      this.showMinorHintAt(pos.x, pos.y, `Splash -${dmg}`, '#cc66ff');
      await this._awaitSceneDelay(200, { label: 'entity_splash_tick' });
      if (victim.currentHP <= 0) {
        await this.removeUnit(victim, { killer: entity });
        this.checkBattleEnd();
        if (this.battleState === 'BATTLE_END') return;
      }
    }
  }

  async executeEnemyBreak(enemy, tile) {
    if (!tile) return;
    this.grid.clearTemporaryTerrainAt?.(tile.col, tile.row);
    const pos = this.grid.gridToPixel(tile.col, tile.row);
    this.showMinorHintAt(pos.x, pos.y, 'Break!', '#ffcc66');
    await this._awaitSceneDelay(120, { label: 'enemy_break_hold' });
  }

  showPhaseBanner(phase, turn) {
    const label = phase === 'player' ? 'Player Phase' : 'Enemy Phase';
    const color = phase === 'player' ? '#3366cc' : '#cc3333';
    const banner = this.add
      .text(this.cameras.main.centerX, this.cameras.main.centerY, `Turn ${turn} - ${label}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    this._pinToScreen(banner);

    if (this._isReducedEffects()) {
      banner.setAlpha(1);
      this.time.delayedCall(420, () => banner.destroy());
    } else {
      this.tweens.add({
        targets: banner,
        alpha: 1,
        duration: 300,
        yoyo: true,
        hold: 800,
        onComplete: () => banner.destroy(),
      });
    }
  }

  _showBossDefeatedBanner() {
    const banner = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY - 30,
        'Boss defeated!\nSeize the throne with a Lord!',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#66ff66',
          backgroundColor: '#000000dd',
          padding: { x: 16, y: 8 },
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    this._pinToScreen(banner);

    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 400,
      yoyo: true,
      hold: 1800,
      onComplete: () => banner.destroy(),
    });

    // Pulse the objective text to draw attention
    if (this.objectiveText) {
      this.tweens.add({
        targets: this.objectiveText,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 300,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** Faction-aware ally pool for Divine Charge heals (enemy->enemy, player->player, npc->player+npc) */
  getDivineChargeAllies(caster) {
    if (caster.faction === 'enemy') return this.enemyUnits;
    if (caster.faction === 'npc') return [...this.playerUnits, ...(this.npcUnits || [])];
    return this.playerUnits;
  }

  // --- Win/lose ---

  checkBattleEnd() {
    // Idempotence: once the battle has ended (or a lord-death Vision prompt is
    // awaiting the player's decision) a late call from an in-flight pipeline
    // must not re-trigger defeat or stack a second prompt.
    if (this.battleState === 'BATTLE_END') return true;
    if (this.visionDialog) return true;
    // Edric defeat = immediate loss (permadeath rule -- other lords can fall)
    const edricAlive = this.playerUnits.some((u) => u.name === 'Edric');
    if (!edricAlive || this.playerUnits.length === 0) {
      if (this.turnManager?.currentPhase === 'enemy' && this.showLordDeathVisionPrompt()) {
        return true;
      }
      this.onDefeat();
      return true;
    }
    // Rout: all enemies dead = victory
    // Defer during enemy phase until reinforcements have been applied
    if (
      this.battleConfig.objective === 'rout' &&
      this.enemyUnits.length === 0 &&
      !(this._zombieTombstones?.length > 0)
    ) {
      if (this._reinforcementsPendingThisTurn) return false;
      this.onVictory();
      return true;
    }
    // Seize victory triggers via action menu 'Seize' button
    return false;
  }

  updateObjectiveText() {
    if (!this.objectiveText) return;
    let label;
    let color = '#ffdd44'; // default gold
    if (this.battleConfig.objective === 'seize') {
      const bossAlive = this.enemyUnits.some((u) => u.isBoss && u.currentHP > 0);
      if (bossAlive) {
        label = 'Seize: Defeat boss, then capture throne';
        color = '#ff6666'; // red -- boss still alive
      } else {
        label = 'Seize: Capture throne with a Lord!';
        color = '#66ff66'; // green -- ready to seize
      }
    } else {
      const tombCount = this._zombieTombstones?.length || 0;
      label =
        tombCount > 0
          ? `Rout: ${this.enemyUnits.length} enemies + ${tombCount} reviving`
          : `Rout: ${this.enemyUnits.length} enemies remaining`;
    }
    if (this.npcUnits.length > 0) {
      label += '\nRecruit: Talk to green unit';
    }
    this.objectiveText.setText(label);
    this.objectiveText.setColor(color);
  }

  calculateDangerZone() {
    const threatened = new Set();
    for (const enemy of this.enemyUnits) {
      if (this.grid.fogEnabled) {
        const fogVis = isEntity(enemy)
          ? getFootprint(enemy).some((t) => this.grid.isVisible(t.col, t.row))
          : this.grid.isVisible(enemy.col, enemy.row);
        if (!fogVis) continue;
      }

      // Entity: stationary, compute attack range from all body tiles using all weapons
      if (isEntity(enemy)) {
        for (const tile of getFootprint(enemy)) {
          const atkTiles = this.grid.getAttackRange(tile.col, tile.row, {
            range: `1-${ENTITY_PRIMARY_ATTACK_RANGE}`,
          });
          for (const t of atkTiles) {
            threatened.add(`${t.col},${t.row}`);
          }
        }
        continue;
      }

      const positions = this.buildUnitPositionMap(enemy.faction);
      const moveRange = this.grid.getMovementRange(
        enemy.col,
        enemy.row,
        enemy.mov || enemy.stats.MOV,
        enemy.moveType,
        positions,
        enemy.faction,
        this._getCostModifier(enemy),
      );
      for (const [key, entry] of moveRange) {
        if (entry.stoppable === false) continue;
        const [mc, mr] = key.split(',').map(Number);
        // Get attack tiles from this position based on enemy weapon
        if (enemy.weapon) {
          const atkTiles = this.grid.getAttackRange(mc, mr, enemy.weapon);
          for (const t of atkTiles) {
            threatened.add(`${t.col},${t.row}`);
          }
        }
      }
    }
    if (this.ballistas?.length > 0) {
      for (const ballista of this.ballistas) {
        if (ballista.owner !== 'enemy') continue;
        if (this.grid.fogEnabled && !this.grid.isVisible(ballista.col, ballista.row)) continue;
        const tiles = getBallistaDangerTiles(ballista, this.grid.cols, this.grid.rows);
        for (const t of tiles) {
          threatened.add(`${t.col},${t.row}`);
        }
      }
    }
    return Array.from(threatened).map((k) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row };
    });
  }

  /** Hide/show enemy and NPC graphics based on fog visibility. */
  updateEnemyVisibility() {
    if (!this.grid.fogEnabled) return;
    this.dangerZoneStale = true;
    for (const enemy of this.enemyUnits) {
      let vis;
      if (isEntity(enemy)) {
        vis = getFootprint(enemy).some((t) => this.grid.isVisible(t.col, t.row));
      } else {
        vis = this.grid.isVisible(enemy.col, enemy.row);
      }
      if (enemy.graphic) enemy.graphic.setVisible(vis);
      if (enemy.label) enemy.label.setVisible(vis);
      if (enemy.factionIndicator) enemy.factionIndicator.setVisible(vis);
      if (enemy.hpBar) {
        enemy.hpBar.bg.setVisible(vis);
        enemy.hpBar.fill.setVisible(vis);
      }
      if (enemy.affixPips) {
        enemy.affixPips.forEach((p) => p.setVisible(vis));
      }
    }
    for (const npc of this.npcUnits) {
      const vis = this.grid.isVisible(npc.col, npc.row);
      if (npc.graphic) npc.graphic.setVisible(vis);
      if (npc.label) npc.label.setVisible(vis);
      if (npc.factionIndicator) npc.factionIndicator.setVisible(vis);
      if (npc.hpBar) {
        npc.hpBar.bg.setVisible(vis);
        npc.hpBar.fill.setVisible(vis);
      }
      if (npc.affixPips) {
        npc.affixPips.forEach((p) => p.setVisible(vis));
      }
      // D1: Destroy recruit fog marker once NPC tile is in player vision
      if (vis && this.recruitFogMarker) {
        this.recruitFogMarker.destroy();
        this.recruitFogMarker = null;
      }
    }
  }

  onVictory() {
    (this._postCombatController ||= new PostCombatController(this)).onVictory();
  }

  /** Award turn-bonus gold without showing the loot UI. */
  _awardTurnBonusGold() {
    return (this._postCombatController ||= new PostCombatController(this))._awardTurnBonusGold();
  }

  /** Transition to the next scene after loot selection. */
  async transitionAfterBattle() {
    return (this._postCombatController ||= new PostCombatController(this)).transitionAfterBattle();
  }

  async forceTransitionAfterBattle() {
    return (this._postCombatController ||= new PostCombatController(
      this,
    )).forceTransitionAfterBattle();
  }

  /** Show boss recruit selection: pick 1 of 3 recruits or skip, then proceed to loot. */
  showBossRecruitScreen() {
    (this._postCombatController ||= new PostCombatController(this)).showBossRecruitScreen();
  }

  /** Show third lord arrival overlay (Power of Friendship meta upgrade). */
  _showThirdLordArrival() {
    (this._postCombatController ||= new PostCombatController(this))._showThirdLordArrival();
  }

  /** Show post-battle loot selection. Normal: pick 1 of 3. Elite: pick 2 of 4. */
  showLootScreen() {
    (this._postCombatController ||= new PostCombatController(this)).showLootScreen();
  }

  getLootCardDetailLines(choice, item, cardWidth = 110) {
    return LootScreenController.getCardDetailLines(this, choice, item, cardWidth);
  }

  /** Format accessory effects for loot card display. */
  getAccessoryDetailText(item) {
    return formatAccessoryDetail(item, {
      separator: '\n',
      statSeparator: '/',
      fallback: 'Equip for passive bonus',
    });
  }

  // -- Loot card hover tooltip ------------------------------------

  _getLootTooltipText(choice, item) {
    return LootScreenController.getTooltipText(this, choice, item);
  }

  _showLootTooltip(choice, item, cx, cardY, cardH) {
    (this._lootFlowController ||= new LootFlowController(this))._showLootTooltip(
      choice,
      item,
      cx,
      cardY,
      cardH,
    );
  }

  _hideLootTooltip() {
    (this._lootFlowController ||= new LootFlowController(this))._hideLootTooltip();
  }

  _clearLootTooltipTimer() {
    (this._lootFlowController ||= new LootFlowController(this))._clearLootTooltipTimer();
  }

  // -- End loot tooltip ------------------------------------------

  /** Simple text wrapping helper. */
  wrapText(text, maxChars) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    const width = Math.max(1, Math.floor(Number(maxChars) || 0));
    if (value.length <= width) return value;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    const lines = [];
    let line = '';
    for (const word of words) {
      let remaining = word;
      while (remaining.length > width) {
        if (line.length > 0) {
          lines.push(line);
          line = '';
        }
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      if (!remaining) continue;
      if (line.length === 0) {
        line = remaining;
      } else if (line.length + remaining.length + 1 > width) {
        lines.push(line);
        line = remaining;
      } else {
        line = `${line} ${remaining}`;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  normalizeSpecialText(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\r\n?/g, '\n').trim();
  }

  _wrapTextLinesPreserveNewlines(text, maxChars) {
    const normalized = this.normalizeSpecialText(text);
    if (!normalized) return [];
    const lines = [];
    for (const segment of normalized.split('\n')) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      const wrapped = this.wrapText(trimmed, maxChars);
      lines.push(
        ...wrapped
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
    }
    return lines;
  }

  _formatSpecialLinesForUi(text, maxChars, maxLines = 2) {
    const lineWidth = Math.max(1, Math.floor(Number(maxChars) || 0));
    const wrappedLines = this._wrapTextLinesPreserveNewlines(text, lineWidth);
    if (wrappedLines.length <= maxLines) return wrappedLines;
    const trimmed = wrappedLines.slice(0, maxLines);
    const lastIndex = trimmed.length - 1;
    const ellipsis = lineWidth <= 3 ? '.'.repeat(lineWidth) : '...';
    const roomForText = Math.max(0, lineWidth - ellipsis.length);
    const lastLine = String(trimmed[lastIndex] || '').trimEnd();
    const head = roomForText > 0 ? lastLine.slice(0, roomForText).trimEnd() : '';
    trimmed[lastIndex] = `${head}${ellipsis}`;
    return trimmed;
  }

  _setupLootPickerScroller({
    pickerGroup,
    rows,
    topY,
    bottomY,
    rowHeight,
    listLeft,
    listRight,
    onBack = null,
  }) {
    const setVisibleSafe = (obj, visible) => {
      if (!obj) return;
      if (typeof obj.setVisible === 'function') obj.setVisible(visible);
      else obj.visible = visible;
    };

    const setInteractiveSafe = (obj, enabled) => {
      if (!obj) return;
      if (enabled) {
        if (typeof obj.setInteractive === 'function') obj.setInteractive({ useHandCursor: true });
        else if (obj.input) obj.input.enabled = true;
        return;
      }
      if (typeof obj.disableInteractive === 'function') obj.disableInteractive();
      else if (obj.input) obj.input.enabled = false;
    };

    const normalizedRowHeight = Math.max(1, Math.floor(rowHeight || 1));
    const availableHeight = Math.max(0, (bottomY || 0) - (topY || 0));
    const maxVisibleRows = Math.max(1, Math.floor(availableHeight / normalizedRowHeight));
    const maxScrollOffset = Math.max(0, rows.length - maxVisibleRows);
    const canScroll = maxScrollOffset > 0;
    const rowBottomBound = topY + maxVisibleRows * normalizedRowHeight;
    let scrollOffset = 0;
    const detachHandlers = [];

    let scrollUp = null;
    let scrollDown = null;

    const setArrowEnabled = (arrow, enabled) => {
      if (!arrow) return;
      if (typeof arrow.setAlpha === 'function') arrow.setAlpha(enabled ? 1 : 0.45);
      if (typeof arrow.setColor === 'function') arrow.setColor(enabled ? '#88ccff' : '#666666');
    };

    const updateScrollArrows = () => {
      if (!canScroll) return;
      setArrowEnabled(scrollUp, scrollOffset > 0);
      setArrowEnabled(scrollDown, scrollOffset < maxScrollOffset);
    };

    const applyLayout = () => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const visibleIndex = i - scrollOffset;
        const visible = visibleIndex >= 0 && visibleIndex < maxVisibleRows;
        const centerY = topY + visibleIndex * normalizedRowHeight + normalizedRowHeight / 2;
        if (typeof row?.setCenterY === 'function') row.setCenterY(centerY);
        const objects = Array.isArray(row?.objects) ? row.objects : [];
        for (const obj of objects) setVisibleSafe(obj, visible);
        if (row?.inputTarget && row?.selectable) {
          setInteractiveSafe(row.inputTarget, visible);
        }
      }
      updateScrollArrows();
    };

    const setScrollOffset = (nextOffset) => {
      const clamped = Math.max(0, Math.min(maxScrollOffset, nextOffset));
      if (clamped === scrollOffset) return;
      scrollOffset = clamped;
      applyLayout();
    };

    if (canScroll) {
      const camWidth = Number(this.cameras?.main?.width) || 640;
      const arrowX = Math.min(listRight + 18, camWidth - 10);
      scrollUp = this.add
        .text(arrowX, topY + 10, '^', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#88ccff',
        })
        .setOrigin(0.5)
        .setDepth(713)
        .setInteractive({ useHandCursor: true });
      scrollDown = this.add
        .text(arrowX, rowBottomBound - 10, 'v', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#88ccff',
        })
        .setOrigin(0.5)
        .setDepth(713)
        .setInteractive({ useHandCursor: true });
      const hint = this.add
        .text(arrowX, rowBottomBound + 2, 'Scroll', {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#777777',
        })
        .setOrigin(0.5, 0)
        .setDepth(713);
      pickerGroup.push(scrollUp, scrollDown, hint);

      scrollUp.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        setScrollOffset(scrollOffset - 1);
      });
      scrollDown.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        setScrollOffset(scrollOffset + 1);
      });

      if (this.input?.on && this.input?.off) {
        const wheelHandler = (pointer, _gameObjects, _deltaX, deltaY) => {
          if (!pointer || !Number.isFinite(deltaY) || deltaY === 0) return;
          if (pointer.x < listLeft || pointer.x > listRight) return;
          if (pointer.y < topY || pointer.y > rowBottomBound) return;
          setScrollOffset(scrollOffset + (deltaY > 0 ? 1 : -1));
        };
        this.input.on('wheel', wheelHandler);
        detachHandlers.push(() => this.input.off('wheel', wheelHandler));
      }
    }

    if (this.input?.keyboard?.on && this.input?.keyboard?.off) {
      const keyHandler = (event) => {
        const key = String(event?.key ?? event?.code ?? '').toLowerCase();
        if (!key) return;
        if ((key === 'escape' || key === 'esc') && typeof onBack === 'function') {
          if (typeof event?.preventDefault === 'function') event.preventDefault();
          onBack();
          return;
        }
        if (!canScroll) return;

        let nextOffset = scrollOffset;
        if (key === 'arrowdown' || key === 'down') nextOffset += 1;
        else if (key === 'arrowup' || key === 'up') nextOffset -= 1;
        else if (key === 'pagedown') nextOffset += maxVisibleRows;
        else if (key === 'pageup') nextOffset -= maxVisibleRows;
        else if (key === 'home') nextOffset = 0;
        else if (key === 'end') nextOffset = maxScrollOffset;
        else return;

        if (typeof event?.preventDefault === 'function') event.preventDefault();
        setScrollOffset(nextOffset);
      };
      this.input.keyboard.on('keydown', keyHandler);
      detachHandlers.push(() => this.input.keyboard.off('keydown', keyHandler));
    }

    applyLayout();

    return () => {
      for (const detach of detachHandlers) detach();
    };
  }

  showForgeLootPicker(whetstone, lootGroup, cardIdx) {
    LootScreenController.renderForgePicker(this, whetstone, lootGroup, cardIdx);
  }

  /** Step 2: pick which weapon to forge. */
  showForgeWeaponPicker(whetstone, unit, lootGroup, cardIdx) {
    (this._lootFlowController ||= new LootFlowController(this)).showForgeWeaponPicker(
      whetstone,
      unit,
      lootGroup,
      cardIdx,
    );
  }

  /** Step 3 (Silver Whetstone only): pick which stat to forge. */
  showForgeStatPickerLoot(whetstone, weapon, lootGroup, cardIdx) {
    (this._lootFlowController ||= new LootFlowController(this)).showForgeStatPickerLoot(
      whetstone,
      weapon,
      lootGroup,
      cardIdx,
    );
  }

  /** Show unit picker to give a loot item to a roster unit. */
  showLootUnitPicker(item, lootGroup, cardIdx) {
    LootScreenController.renderUnitPicker(this, item, lootGroup, cardIdx);
  }

  /** Show unit picker for stat boost items. */
  showStatBoostUnitPicker(item, lootGroup, cardIdx) {
    LootScreenController.renderStatBoostPicker(this, item, lootGroup, cardIdx);
  }

  showConsumableUnitPicker(item, lootGroup, cardIdx) {
    LootScreenController.renderConsumableUnitPicker(this, item, lootGroup, cardIdx);
  }

  /** Show compact read-only roster viewer during loot screen. */
  showLootRoster() {
    (this._lootFlowController ||= new LootFlowController(this)).showLootRoster();
  }

  /** Hide loot roster viewer. */
  hideLootRoster() {
    (this._lootFlowController ||= new LootFlowController(this)).hideLootRoster();
  }

  /**
   * Unified exit path for all loot picks. Handles elite pick-2 counter.
   * Non-elite: immediate cleanup. Elite: gray out card, decrement, cleanup at 0.
   */
  finalizeLootPick(lootGroup, cardIndex) {
    (this._lootFlowController ||= new LootFlowController(this)).finalizeLootPick(
      lootGroup,
      cardIndex,
    );
  }

  /** Clean up loot screen and transition. */
  cleanupLootScreen(lootGroup) {
    (this._lootFlowController ||= new LootFlowController(this)).cleanupLootScreen(lootGroup);
  }

  scheduleLootCleanup(lootGroup) {
    (this._lootFlowController ||= new LootFlowController(this)).scheduleLootCleanup(lootGroup);
  }

  showLootStatus(message, color = '#ff8888') {
    (this._postCombatController ||= new PostCombatController(this)).showLootStatus(message, color);
  }

  reportLootError(context, err, extra = {}) {
    (this._postCombatController ||= new PostCombatController(this)).reportLootError(
      context,
      err,
      extra,
    );
  }

  onDefeat() {
    (this._postCombatController ||= new PostCombatController(this)).onDefeat();
  }

  async transitionToRunCompleteWithRetry(result = 'defeat') {
    return (this._postCombatController ||= new PostCombatController(
      this,
    )).transitionToRunCompleteWithRetry(result);
  }

  showDefeatTransitionRecovery() {
    (this._recoveryController ||= new TransitionRecoveryController(this)).showDefeatRecovery();
  }

  showVictoryTransitionRecovery() {
    (this._recoveryController ||= new TransitionRecoveryController(this)).showVictoryRecovery();
  }

  showPauseTransitionRecovery(reason = TRANSITION_REASONS.SAVE_EXIT) {
    showTransitionRecoveryPrompt(this, {
      reason,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      overlayKey: 'pauseOverlay',
      titleData: { gameData: this.gameData },
    });
  }
}
