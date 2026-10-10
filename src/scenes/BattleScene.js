import { MovementActionController } from '../ui/MovementActionController.js';
import { cantoRuleFor } from '../engine/CantoRule.js';
import {
  specialCharacterRefusalText,
  speakSpecialCharacterRefusal,
} from '../engine/SpecialCharacterDialogue.js';
import { battleItemBrief, ITEM_ACTION_NOTE } from '../ui/battleItemSummary.js';
import {
  historyUnitVisible,
  observeHistoryAction,
  rememberHistoryPath,
  discardHistoryPath,
  resetHistoryRecording,
} from '../ui/BattleHistoryRecorder.js';
import { hydrateBattleTimeline } from '../engine/BattleTimeline.js';
import { bannerHoldFact, combatTimelineFacts } from '../engine/BattleTimelineFacts.js';
import { createBattleRng, keyedBattleRandom } from '../engine/BattleRng.js';
import { AttackFlowController } from '../ui/AttackFlowController.js';
import {
  getAttackRange,
  getAttackWeapons,
  isSilenceBlockedWeapon,
} from '../engine/AttackOptions.js';
import { EQUIPPED_MARKER } from '../ui/equippedBadge.js';
import { attackSpeedDelta, attackSpeedValue, weaponAttackSpeed } from '../ui/battleItemSummary.js';
import { PinnedThreatController } from '../ui/PinnedThreatController.js';
import { battlePlace } from '../ui/placeDisplay.js';
import { levelUpDisplayResults } from '../ui/progressionDisplay.js';
import { presentationText, isolateBattleTextFactory } from '../utils/presentationText.js';
import { safeBattlePresentation } from '../ui/safeBattlePresentation.js';
import { presentTeleporterWarp } from '../ui/WarpPresentation.js';
import { hasBattleDefeat } from '../engine/BattleDefeat.js';
import { applyBlessingCombatMods, stampTurnAnchors } from '../engine/BlessingCombatMods.js';
import {
  isRoutComplete,
  isRoutFieldClear,
  pendingRequiredRecruits,
  routObjectiveLabel,
} from '../engine/RoutObjective.js';
import { battleSpeed, waitDuration, waitTween } from '../utils/combatTiming.js';
import {
  getWeaponArtIds,
  killMoveRefreshesActor,
  weaponArtRunOptions,
} from '../engine/WeaponArtSystem.js';
import {
  canInspectUnit,
  carriedItemInfo,
  seenTileOccupant,
  statusStaffThreat,
} from '../engine/BattleInformation.js';
import { fogMoveCut } from '../engine/FogAmbush.js';
import { playerKnowledgeOf } from '../ui/battleKnowledge.js';
import { forcedMoveProbes } from '../ui/forcedMoveProbes.js';
import { presentSettledMoves } from '../ui/ActionMovementPresentation.js';
import { findShoveTargets as shoveTargetsOf } from '../engine/ForcedMovement.js';
import {
  CANTO_CONFIRM_STATE,
  canUseDanger,
  isObjectiveCommand,
  isUnitMenuState,
  menuRow,
  railOwnsMenus,
  rowText,
} from '../ui/battleMenuModel.js';
import { revivalStoneCount } from '../engine/RevivalStones.js';
import { applyDueHybridOverrides } from '../engine/TerrainPhases.js';
import RevivalStoneController from '../ui/RevivalStoneController.js';
import UnbrokenBannerController from '../ui/UnbrokenBannerController.js';
import {
  WHISTLE_NAME,
  battleBlessingsAtStart,
  blessingTurnStartEffects,
} from '../engine/BattleBlessings.js';
import {
  AREA_XP_LIVE,
  actionXpAwards,
  applyXpGain,
  combatHpLost,
  scaledXp,
} from '../engine/BattleXp.js';
import { postCombatEffects, allyBuff } from '../engine/PostCombatEffects.js';
import {
  applyTimedBuffEntry,
  expireTimedBuffs,
  resolveTimedBuffExpiry,
  timedBuffCombatMods,
} from '../engine/TimedWeaponArtBuffs.js';
import {
  applyBattleDebuff,
  applyBattleStartDebuffs,
  clearBattleScopedDeltas,
} from '../engine/BattleStatDeltas.js';
import { staffRunOptions } from '../engine/StaffBlessings.js';
import {
  applyCombatHP,
  applyStrikeHP,
  damageUnit,
  damageUnitDetailed,
  healUnit,
  healUnitFully,
  setUnitHP,
} from '../engine/UnitHealth.js';
import { applyEnemySpawnGear, applySpawnLoadout } from '../engine/EnemySpawnGear.js';
import { resetFortHealStreak, settleTerrainHeal } from '../engine/TerrainHealing.js';
import { spendCombatShots, swapSpentWeapons } from '../engine/PerBattleWeapons.js';
import {
  advanceTurnPressure,
  bestLordEscapeDistance,
  bestLordThroneDistance,
  createTurnPressureState,
  measureTurnPressure,
} from '../engine/TurnPressure.js';
import { applyDevScenario } from '../utils/devScenarios.js';
import { battleContrastEnabled, contrastSpriteKey } from '../ui/BattleContrast.js';
import { hasDOMHost } from '../utils/domUI.js';
import { BattleTradeMenu } from '../ui/BattleTradeMenu.js';
import { battleTradeController } from '../ui/BattleTradeController.js';
import { canTradeBetween, unitHolder } from '../engine/ItemTrade.js';
import { routeMobileAction } from '../utils/overlayStack.js';
import { canUseTouchUI } from '../utils/domUI.js';
import { unitPortraitKey } from '../ui/RebuiltPortraits.js';
import { placeBattlePortrait } from '../ui/BattlePortraitVariants.js';
import { battleUnitSpriteKey } from '../ui/BattleUnitVisuals.js';
import { startTracedIdle } from '../ui/TracedSprites.js';
import { BATTLEFIELD_LAB_MAPS } from '../utils/battlefieldLabMaps.js';
import { paintBattlefieldTerrain, battlefieldSpriteArtEnabled } from '../ui/BattlefieldArt.js';
import { AtmosphereController } from '../ui/AtmosphereController.js';
import { DesktopBattleHud } from '../ui/DesktopBattleHud.js';
import { EclipseHudController } from '../ui/EclipseHudController.js';
import { ContractHudController } from '../ui/ContractHudController.js';
import { createFactionRing, setFactionRingActed, RING_OFFSET_Y } from '../ui/FactionRings.js';
import { createBattlefieldLabFixture } from '../utils/battlefieldLabFixture.js';
import { inputHint } from '../utils/inputHint.js';
// BattleScene -- Phase 3: multi-unit tactical combat with unit system

import Phaser from 'phaser';
import { isTouchPointer } from '../utils/runtimeFlags.js';
import { Grid, computeEffectivePath } from '../engine/Grid.js';
import { TurnManager } from '../engine/TurnManager.js';
import { AIController } from '../engine/AIController.js';
import {
  getCombatForecast,
  resolveCombat,
  gridDistance,
  calculateEffectiveSpeed,
  isInRange,
  isStaff,
  getEffectivenessMultiplier,
  getStaffRemainingUses,
  getStaffMaxUses,
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
  entityHealth,
} from '../engine/EntitySystem.js';
import { bindEnemyAreaArt } from '../engine/EnemyAreaArts.js';
import {
  createLordUnit,
  createEnemyUnit as createEnemyUnitFromClass,
  createPromotedEnemyUnit,
  enemyDifficultyConfigFromParams,
  addToInventory,
  addToConsumables,
  removeFromConsumables,
  equipWeapon,
  normalizeEquippedFirst,
  getStaffWeapon,
  getCombatWeapons,
  canPromote,
  resolvePromotionTargetClass,
  hasProficiency,
  canEquip,
  applyStatBoost,
  canReclass,
  getReclassTargets,
  inventoryDisplayOrder,
} from '../engine/UnitManager.js';
import { getTraitXpMultiplier } from '../engine/MasterySystem.js';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  getTurnStartEffects,
  getTerrainCostReduction,
  checkPhoenixBrooch,
  resolveGamblerDelta,
  applyAccessoryPhaseCombatMods,
} from '../engine/SkillSystem.js';
import { hasEffectiveSkill } from '../engine/EffectiveSkills.js';
import { movementOptionsFor, passesHiddenUnit } from '../engine/PassMovement.js';
import { findDanceRefreshTargets } from '../engine/ActionAbilitySystem.js';
import {
  getTurnStartAffixes,
  getOnDeathAffixes,
  getAttackAffixes,
  rollDefenseAffixes,
  settleTeleporterWarp,
  getAffixMovBonus,
} from '../engine/AffixSystem.js';
import { shouldAllowUndoMove } from '../engine/TradeFlow.js';
import { completeBattleAction, revealSettledVision } from '../ui/BattleActionCompletion.js';
import {
  getWeaponArtCombatMods,
  recordWeaponArtUse,
  applyWeaponArtCost,
  resetWeaponArtTurnUsage,
} from '../engine/WeaponArtSystem.js';
import {
  presentQueuedProgress,
  completeResolvedAction,
} from '../ui/BattlePresentationCheckpoint.js';
import { xpGaugeRecord } from '../ui/xpGaugeModel.js';
import { UnitInspectionPanel } from '../ui/UnitInspectionPanel.js';
import { UnitDetailOverlay } from '../ui/UnitDetailOverlay.js';
import { DialogueOverlay } from '../ui/DialogueOverlay.js';
import { DangerZoneOverlay } from '../ui/DangerZoneOverlay.js';
import { computeDangerTiles } from '../engine/ThreatForecast.js';
import { ThreatSightController } from '../ui/ThreatSightController.js';
import { GuidanceController } from '../ui/GuidanceController.js';
import {
  TILE_SIZE,
  FACTION_COLORS,
  MAX_SKILLS,
  BOSS_STAT_BONUS,
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  LOOT_CHOICES,
  ELITE_LOOT_CHOICES,
  DEPLOY_LIMITS,
  TERRAIN,
  LAVA_CRACK_DAMAGE,
  GOLD_LOOT_REWARD_MULTIPLIER,
  ENTITY_SPLASH_COUNT,
  ENTITY_FOOTPRINT,
  ENTITY_PRIMARY_ATTACK_RANGE,
} from '../utils/constants.js';
import { displayEdge, hasRoomRightOf } from '../utils/boardOrientation.js';
import {
  getHPBarColor,
  applyTextResolution,
  TEXT_RESOLUTION,
  UI_PALETTE,
  UI_HEX,
} from '../utils/uiStyles.js';
import { generateBattle, reconcileRecruitSpawnTile } from '../engine/MapGenerator.js';
import {
  computeAcidDamage,
  computeLavaCrackHp,
  isAcidTerrainIndex,
  isLavaCrackTerrainIndex,
  lavaBurnsUnit,
  lavaBurnBanner,
} from '../engine/TerrainHazards.js';
import {
  applyCondition,
  isSleeping,
  isSilenced,
  isWounded,
  isAcidPoisoned,
  isRooted,
  willRemainRootedNextPhase,
  removeCondition,
  clearAllConditions,
  resolveStatusStaff,
  processConditionRecovery,
  isStatusStaff,
  hasCondition,
  parseStaffRange,
} from '../engine/StatusConditionSystem.js';
import {
  clearSavedRun,
  endRunPayoutPending,
  saveRun,
  settleAndPersistEndRun,
} from '../engine/RunManager.js';
import {
  calculateKillReward,
  generateLootChoices,
  calculateSkipLootBonus,
} from '../engine/LootSystem.js';
import {
  calculatePar,
  battleParMapParams,
  getRating,
  getLatePressureState,
  getBossEnrageTurn,
  getParXpMultiplier,
  formatParTooltip,
} from '../engine/TurnBonusCalculator.js';
import { deleteRunSave, pushRunSave } from '../cloud/CloudSync.js';
import { PauseOverlay } from '../ui/PauseOverlay.js';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import BattleMusicController from '../ui/BattleMusicController.js';
import { battleMusicContext } from '../engine/BattleMusicSelection.js';
import { LEVEL_UP_CUE_WAIT_MS, levelUpCue, playCue, stopCues } from '../ui/ceremonyMusic.js';
import {
  showImportantHint,
  showMinorHint,
  showContextualHint,
  mobileBattleHint,
} from '../ui/HintDisplay.js';
import { generateBossRecruitCandidates } from '../engine/BossRecruitSystem.js';
import { stampCommanderFlag } from '../engine/Commander.js';
import { buildRecruitNodeUnit, spawnTilesForDeployment } from '../engine/RecruitNodeSystem.js';
import { battleDeployCount, resolveDeployLimits } from '../engine/BattleDeployCount.js';
import {
  adaptDialogueEntries,
  adaptDialogueLine,
  resolveDialogueCast,
} from '../engine/DialogueCast.js';
import { fallenLine, voiceContext } from '../engine/UnitVoice.js';
import { armyAndNpcAllies, hasRecruitNpc, isRecruitNpc } from '../engine/RecruitNpc.js';
import { isSameUnit } from '../engine/UnitIdentity.js';
import { BattleBeatsController } from '../ui/BattleBeatsController.js';
import { deedsFor } from '../ui/DeedController.js';
import { unitEpithet } from '../engine/DeedTitles.js';
import { DEBUG_MODE, debugState } from '../utils/debugMode.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { RosterOverlay } from '../ui/RosterOverlay.js';
import { createSeededRng } from '../engine/BlessingEngine.js';
import { parRaiseForArrivals } from '../engine/ReinforcementScheduler.js';
import {
  buildReinforcementSpawnSpec,
  buildReinforcementTemplatePool,
  enemyRewardMultiplier,
  enemySpawnFallbackLevel,
  enemyXpMultiplier,
  normalizeEnemyRewardMultiplier,
  occupiedUnitTiles,
  resolveBattleReinforcements,
  stampReinforcementMeta,
} from '../engine/ReinforcementSpawns.js';
import { routLadderObjectiveLine, routLadderStatus } from '../engine/RoutLadder.js';
import { applyHoldSpawn } from '../engine/HoldActivation.js';
import { settleArtilleryStances } from '../engine/SiegeArtillery.js';
import {
  transitionToScene,
  transitionToSceneWithBlockedRetry,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../utils/SceneRouter.js';
import {
  buildPrologueBattleConfig,
  buildPrologueNpcUnit,
  prologueDeployRule,
  battleRequiredRecruits,
} from '../engine/Prologue.js';
import { showPrologueDeployNote } from '../ui/PrologueDeployNote.js';
import {
  isScriptedBattle,
  isStandaloneScriptedBattle,
  isPrologueRun,
  prologueChapterOf,
} from '../engine/ScriptedBattle.js';
import { resetTransitionLocks, ensureSceneLoaded } from '../utils/sceneLoader.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { markStartup } from '../utils/startupTelemetry.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { settleAndPresent } from '../ui/BattleActionSettlement.js';
import { validateConsumable, settleConsumable } from '../engine/ConsumableSettlement.js';
import { battleSession, isCurrentBattleSession } from '../ui/BattleSession.js';
import { showTransitionRecoveryPrompt } from '../ui/TransitionRecoveryPrompt.js';
import { BattleCameraController } from '../utils/BattleCameraController.js';
import { DeployScreenOverlay } from '../ui/DeployScreenOverlay.js';
import { MobileBattleHUD } from '../ui/MobileBattleHUD.js';
import { CaravanController } from '../ui/CaravanController.js';
import { VillageController } from '../ui/VillageController.js';
import { RecruitBeaconController } from '../ui/RecruitBeaconController.js';
import { SMASH_TARGET_STATE, ZombieRemainsController } from '../ui/ZombieRemainsController.js';
import { NecromancyController } from '../ui/NecromancyController.js';
import { isNecromancer } from '../engine/Necromancy.js';
import { HealController } from '../ui/HealController.js';
import { InputController } from '../ui/InputController.js';
import { LootFlowController } from '../ui/LootFlowController.js';
import { BoundingFocusController } from '../ui/BoundingFocusController.js';
import { LootScreenController } from '../ui/LootScreenController.js';
import { PostCombatController } from '../ui/PostCombatController.js';
import { PromotionController } from '../ui/PromotionController.js';
import { ReclassController } from '../ui/ReclassController.js';
import { TransitionRecoveryController } from '../ui/TransitionRecoveryController.js';
import { PrologueController } from '../ui/PrologueController.js';
import { locateUnit, nextReadyUnit } from '../ui/UnitLocator.js';
import {
  registerBattleEntity,
  resetBattleIdentities,
  findBattleEntity,
} from '../engine/BattleEntityIdentity.js';
import { VisionRewindController } from '../ui/VisionRewindController.js';
import { SaveRetryController } from '../ui/SaveRetryController.js';
import { BattleSuspendController } from '../ui/BattleSuspendController.js';
import { PortraitBattleController } from '../ui/PortraitBattleController.js';
import { EscapeObjectiveController } from '../ui/EscapeObjectiveController.js';
import { WeaponArtController } from '../ui/WeaponArtController.js';
import { AbilityController } from '../ui/AbilityController.js';
import { AREA_CENTER_STATE, AreaTargetingController } from '../ui/AreaTargetingController.js';
import { GridCursorController } from '../ui/GridCursorController.js';
import { FormationController, FORMATION_STATE } from '../ui/FormationController.js';
import { MenuFocusController } from '../ui/MenuFocusController.js';
import { CombatFxController } from '../ui/CombatFxController.js';
import { CombatChoreography } from '../ui/CombatChoreography.js';
import { CeremonyController } from '../ui/CeremonyController.js';
import { ReinforcementPresenter } from '../ui/ReinforcementPresenter.js';
import { createStatusBadge, STATUS_BADGE_SPACING } from '../ui/StatusBadges.js';
import { BossPresenceController } from '../ui/BossPresenceController.js';
import { noticeTone, shouldShowFelled } from '../ui/ceremonyContent.js';
import { ProcBannerController } from '../ui/ProcBannerController.js';
import {
  splitStrikeActivations,
  dominantCategory,
  findLegendaryArtActivation,
  sigFxForWeaponType,
  PROC_CATEGORY,
} from '../ui/ProcVisualTheme.js';
import { consumeEscEvent, isEscConsumed } from '../utils/escPriority.js';
import { hasOpenOverlay, routeCancel } from '../utils/overlayStack.js';
import { InputAction } from '../utils/InputActions.js';
import { pauseBurdenEntries } from '../ui/eventMenuModel.js';
import { heldBlessingEntries } from '../ui/heldBlessingsModel.js';
import { pushInputScope, popInputScope, hasInputFocus } from '../utils/inputFocus.js';
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

// Post-combat floating labels by tone (engine/PostCombatEffects.js beats).
const POST_COMBAT_HINT_COLORS = {
  intimidate: '#ff6600',
  bad: UI_PALETTE.bad,
  good: UI_PALETTE.good,
  status: UI_PALETTE.rarityEpic,
  bloodlust: '#ff6699',
  pierce: '#ff7777',
  warn: UI_PALETTE.warn,
  splash: '#ff9966',
  buff: '#66ff99',
  heal: '#00ff00',
  mark: UI_PALETTE.mark,
  muted: UI_PALETTE.muted,
};
const PAUSE_TRANSITION_TIMEOUT_MS = 6000;

/** The battle's Zombie remains (ZombieRemainsController), made on first use. */
function remainsOf(scene) {
  return (scene._remainsCtrl ||= new ZombieRemainsController(scene));
}

/** The battle's Necromancer raises and crumbles (NecromancyController), made on first use. */
function necromancyOf(scene) {
  return (scene._necromancyCtrl ||= new NecromancyController(scene));
}

/** Reset per-battle state on a unit at deploy time. */
export function resetUnitForBattle(unit) {
  delete unit._legendaryGraceTurn;
  delete unit._turnAnchor;
  unit._removing = false;
  unit.hasMoved = false;
  unit._movementCommitted = false;
  unit.hasActed = false;
  unit._miracleUsed = false;
  unit._gambitUsedThisTurn = false;
  unit._conditions = [];
  delete unit._speedtakerStacks;
  for (const w of unit.inventory || []) {
    if (w.perBattleUses) w._usesSpent = 0;
  }
}

function resetPlayerUnitsForTurn(scene, turn) {
  for (const u of scene.playerUnits) {
    u.hasMoved = false;
    u._movementCommitted = false;
    u.hasActed = false;
    u._movementSpent = 0;
    u._gambitUsedThisTurn = false;
  }
  // Hold the Line reads where each unit stood as this player phase began. Stamped before any
  // presentation call so a throw in the undim below cannot leave a unit without an anchor.
  stampTurnAnchors(scene.playerUnits, turn);
  for (const u of scene.playerUnits) {
    resetWeaponArtTurnUsage(u, { turnNumber: turn });
    scene.undimUnit(u);
  }
}

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
    this._battleSession = 0;
  }

  isDevToolsEnabled() {
    return DEBUG_MODE || this.registry.get('devToolsEnabled') === true;
  }

  init(data) {
    // Never reset this identity: Phaser restarts reuse the same Scene instance.
    this._cancelLifecycleAwaits('scene_replaced');
    this._battleSession = (this._battleSession || 0) + 1;
    this._saveRetry?.destroy();
    this._saveRetry = null;
    this._checkpointPersistenceResult = null;
    this._saveFailureReported = false;
    this._cloudPushErrorReported = false;
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
    this._resumeCheckpoint = data.resumeCheckpoint || null;
    // Re-opened in the other orientation (portrait battles), not a player resume.
    this._presentationSwitch = data.presentationSwitch === true;
    this._portraitBattle = null;
    this._fatalResumeParked = false;
    this._battleSuspendController = null;
    this.escapedUnits = [];
    this._escapeController = null;
    this._villageState = null;
    this.isTransitioningOut = false;
    this.visionSnapshot = null;
    this.pendingVisionSnapshot = null;
    this.visionDialog = null;
    this.visionBaseSeed = null;
    this._standaloneVisionState = null;
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
    this.pendingHybridOverrideTiles = [];
    this.lastHybridOverrideResult = null;
    // A prologue chapter's teaching (PrologueController), created with the HUD.
    this._prologue = null;
    // This battle's deploy screen confirmation (create), read once by PrologueController.
    // Phaser reuses the scene object: a later battle with no deploy screen (auto-deploy,
    // a resume, a replay) must not inherit an earlier one's.
    this._deployConfirmation = null;
    this._storyDialogueActive = false;
    this._ceremonies = null;
    this._bossPresence = null;
    this._fallenCommander = null;
    this._deedController = null;
    this._newDeeds = null;
    this._bossName = null;
    this._commanderKillerName = null;
    this._battleCommanderName = null;
    this._postLootTransitionStarted = false;
    this._postLootTransitionCompleted = false;
    this._postLootTransitionStartedAt = 0;
    this._postLootTransitionTimer = null;
    // An earned-blessing pick open when the last battle's scene shut down never cleared its
    // hold on the post-loot fallback (PostCombatController._presentEarnedPick).
    this._earnedPickActive = false;
    this._transitionAfterBattlePromise = null;
    this._levelUpSfxKey = null;
    this._pendingLevelUpPopups = [];
    this._pendingXpGauges = [];
    this._pendingCureTarget = null;
    this._pendingCureItem = null;
    this._pendingCureUser = null;
    this._pendingActionCompletion = null;
    this._pendingCommittedAction = null;
    // Cancelled operations may never reach their finally blocks.
    this._deathAffixChainDepth = 0;
    this._combatSpeedSnapshot = undefined;
    this.pauseTransitionRecovery = null;
    this._sceneShutdownCleanupRegistered = false;
    this._sceneShutdownCleanedUp = false;
    this._gameplayKeyHandlers = null;
    this._devToggleKey = null;
    this._onDevToggleKeyDown = null;
    this._mobileHandlers = null;
    this._lootCleanupTimeout = null;
    this._lootCleanupScheduled = false;
    this._lootResolving = false;
    this._lootCleanedUp = false;
    this._managedSceneTimers = new Set();
    this._lifecycleAwaitGuards = new Set();
    this._reinforcementsPendingThisTurn = false;
    // Turn whose ladder wave this enemy phase resolved (objective line only).
    this._ladderResolvedTurn = 0;
    this._enemyPhaseReinforcedTurn = null;
    this._playerTurnStartPipelineTurn = null;
    this.lootSettingsOverlay = null;
    this.lootRosterVisible = false;
    this.defeatRecoveryPrompt = null;
    this.victoryRecoveryPrompt = null;
    this.debugOverlay = null;
    this.lootGroup = null;
    this.pauseOverlay = null;
    this.fogOfWarLabel = null;
  }

  create() {
    this._registerSceneShutdownCleanup();
    this._setupGamepadInput();

    // Determine deploy limits for this act (+ meta upgrade bonus)
    const act = this.battleParams.act || 'act1';
    // A re-entered battle keeps its locked map, so it deploys no more units than that
    // map has spawns (resolveDeployLimits). A prologue chapter with a deploy rule (P4)
    // fields one unit per authored spawn and at least its own minimum, in the run and
    // in a replay alike.
    const chapter = prologueChapterOf(this.battleParams, this.gameData);
    const deployRule = prologueDeployRule(chapter);
    const chapterSpawns = chapter?.playerSpawns?.length || 0;
    const limits = deployRule
      ? {
          min: Math.min(deployRule.min, chapterSpawns),
          max: chapterSpawns,
          lockedTo: null,
        }
      : resolveDeployLimits({
          base: DEPLOY_LIMITS[act] || DEPLOY_LIMITS.act1,
          deployBonus: this.runManager?.getDeployBonus?.() || 0,
          lockedSpawnCount: isStandaloneScriptedBattle(this.battleParams, this.runManager)
            ? null
            : this.runManager?.getLockedSpawnCount?.(this.nodeId),
        });

    if (this._resumeCheckpoint) {
      // Resuming a suspended battle -- units come from the checkpoint
      this.beginBattle(null);
    } else if (!this.roster) {
      // Standalone mode -- no deploy screen
      this.beginBattle(null);
    } else if (this.roster.length <= limits.max) {
      // Small roster -- auto-deploy all
      this.beginBattle(this.roster);
    } else {
      // Roster exceeds max -- show deploy selection
      this.showDeployScreen(this.roster, limits, (selectedRoster) => {
        // The choice was made here (a prologue chapter's deploy lesson reads it).
        this._deployConfirmation = { count: selectedRoster.length };
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
    this._saveRetry?.destroy();
    this._saveRetry = null;

    const audio = this.registry.get('audio');
    // Turning the phone re-opens the battle from its checkpoint; the re-opened scene
    // asks for the same track, which then plays on from where it was.
    if (audio && !this._portraitBattle?.switching) audio.releaseMusic(this, 0);
    this._musicCtrl?.destroy();
    this._musicCtrl = null;
    this._formation?.destroy();
    this._formation = null;

    this._stopLevelUpSfx();
    this.battleTradeMenu?.destroy();
    this.battleTradeMenu = null;
    this._tradeController?.destroy();
    this._tradeController = null;
    const menuCleanup = this._actionMenuCleanup;
    this._actionMenuCleanup = null;
    menuCleanup?.();
    // Guide highlights are cleaned by the PrologueController destroy below.
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
    this._mobileBattleHud?.destroy();
    this._mobileBattleHud = null;
    this._portraitBattle?.destroy();
    this._portraitBattle = null;
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
    if (this._abilityController) {
      this._abilityController.destroy();
      this._abilityController = null;
    }
    this._attackFlowController?.destroy();
    this._attackFlowController = null;
    this._areaTargetingController?.destroy();
    this._areaTargetingController = null;
    this._combatFx?.destroy?.();
    this._combatFx = null;
    this._stoneFx?.destroy?.();
    this._stoneFx = null;
    this._bannerFx?.destroy?.();
    this._bannerFx = null;
    this._combatSpeedSnapshot = undefined;
    if (this._procBanner) {
      this._procBanner.destroy();
      this._procBanner = null;
    }
    this._ceremonies?.destroy();
    this._ceremonies = null;
    this._growthCeremonies?.destroy();
    this._growthCeremonies = null;
    this._xpGauge?.destroy?.();
    this._xpGauge = null;
    this._pendingXpGauges = [];
    this._reinforcements?.destroy();
    this._reinforcements = null;
    this._bossPresence?.destroy();
    this._bossPresence = null;
    if (this._battleBeats) {
      this._battleBeats.destroy();
      this._battleBeats = null;
    }
    if (this._healController) {
      this._healController.destroy();
      this._healController = null;
    }
    if (this._caravanController) {
      this._caravanController.destroy();
      this._caravanController = null;
    }
    if (this._villageController) {
      this._villageController.destroy();
      this._villageController = null;
    }
    if (this._recruitBeacon) {
      this._recruitBeacon.destroy();
      this._recruitBeacon = null;
    }
    if (this._remainsCtrl) {
      this._remainsCtrl.destroy();
      this._remainsCtrl = null;
    }
    if (this._necromancyCtrl) {
      this._necromancyCtrl.destroy();
      this._necromancyCtrl = null;
    }
    if (this._promotionController) {
      this._promotionController.destroy();
      this._promotionController = null;
    }
    if (this._reclassController) {
      this._reclassController.destroy();
      this._reclassController = null;
    }
    this._pinnedThreats?.destroy();
    this._pinnedThreats = null;
    if (this._inputController) {
      this._inputController.destroy();
      this._inputController = null;
    }
    if (this._battleSuspendController) {
      this._battleSuspendController.destroy();
      this._battleSuspendController = null;
    }
    if (this._escapeController) {
      this._escapeController.destroy();
      this._escapeController = null;
    }
    if (this._prologue) {
      this._prologue.destroy();
      this._prologue = null;
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

    // Gamepad action-bus teardown: the global reader keeps emitting across scenes,
    // so this scene MUST release its input-focus scope or it would act on a dead scene.
    if (this._onInputActionBound) {
      popInputScope(this);
      this._onInputActionBound = null;
    }
    if (this._gridCursor) {
      this._gridCursor.destroy();
      this._gridCursor = null;
    }
    if (this._menuFocus) {
      this._menuFocus.destroy();
      this._menuFocus = null;
    }

    // Always reset mobile context on shutdown to prevent stale buttons surviving scene transition
    if (this.isMobileInput) {
      const ge = this.game?.events;
      if (ge?.emit) ge.emit('mobile:setContext', { context: 'none', resetStack: true });
    }

    this._atmosphere?.destroy();
    this._atmosphere = null;
    this._desktopHud?.destroy();
    this._desktopHud = null;
    this._eclipseHud?.destroy();
    this._eclipseHud = null;
    this._contractHud?.destroy();
    this._contractHud = null;
    this._battlefieldTerrain?.destroy();
    this._battlefieldTerrain = null;
    this._teardownBattleCameraSystem();
  }

  _setupGamepadInput() {
    this._gridCursor = new GridCursorController(this);
    this._menuFocus = new MenuFocusController(this);
    // Register a scope on the LIFO input-focus stack. While this scene is the
    // topmost scope it receives action-bus events; an overlay opened later pushes
    // above it and captures the pad until it closes. Popped in shutdown cleanup.
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
  }

  // Route device-independent input actions (from the global gamepad reader) into
  // the SAME methods mouse/keyboard use. NAVIGATE/CONFIRM are context-sensitive:
  // they drive the action-menu focus while it is open, else the grid cursor.
  _onInputAction(action, payload) {
    if (this.isStoryInputLocked()) return;
    if (
      (this.battleState === 'SELECTING_TARGET' || this.battleState === 'SHOWING_FORECAST') &&
      this._attackFlow().handleInputAction(action, payload, InputAction)
    )
      return;
    if (
      this.battleState === AREA_CENTER_STATE &&
      this._areaTargeting().handleInputAction(action, InputAction)
    )
      return;
    const inMenu = isUnitMenuState(this.battleState);
    // The battle is over: the mouse path hides the cursor/info at BATTLE_END
    // (onPointerMove), so don't let the pad re-show the tile highlight or pan
    // the camera under the victory/defeat banner either.
    const battleOver = this.battleState === 'BATTLE_END';
    switch (action) {
      case InputAction.NAVIGATE:
        if (inMenu) {
          if (payload?.dy) this._menuFocus?.move(payload.dy);
        } else if (!battleOver) {
          this._gridCursor?.move(payload?.dx || 0, payload?.dy || 0);
        }
        break;
      case InputAction.CONFIRM:
        if (inMenu) this._menuFocus?.activate();
        else if (!battleOver) this._gridCursor?.confirm();
        break;
      case InputAction.CANCEL:
      case InputAction.PAUSE:
        routeCancel(this);
        break;
      case InputAction.DANGER:
        this._onDangerClick();
        break;
      case InputAction.ROSTER:
        this._onRosterClick();
        break;
      case InputAction.PREV_UNIT:
        this._cycleCursorToUnit(-1);
        break;
      case InputAction.NEXT_UNIT:
        this._cycleCursorToUnit(1);
        break;
      case InputAction.INSPECT:
        this._inspectAtCursor();
        break;
    }
  }

  // Gamepad L1/R1: step the grid cursor through living, un-acted player units,
  // the classic "next unit" affordance. Only while the player can freely move
  // the cursor (PLAYER_IDLE); cursor snap pans the camera + highlights the tile.
  _cycleCursorToUnit(dir) {
    if (this.isStoryInputLocked()) return;
    if (this.battleState !== 'PLAYER_IDLE') return;
    const cursor = this._gridCursor;
    if (!cursor) return;
    const units = (this.playerUnits || [])
      .filter((u) => u && u.currentHP > 0 && !u.hasActed && !isSleeping(u))
      .sort((a, b) => a.row - b.row || a.col - b.col);
    if (units.length === 0) return;
    // Anchor on the unit already under the cursor so cycling is relative to it.
    const anchor = units.findIndex((u) => u.col === cursor.cursorCol && u.row === cursor.cursorRow);
    const start = anchor === -1 ? (dir > 0 ? -1 : 0) : anchor;
    const next = (((start + dir) % units.length) + units.length) % units.length;
    cursor.snapTo(units[next].col, units[next].row);
  }

  // Gamepad L2: the right-click "inspect" affordance, anchored to the grid cursor
  // instead of the pointer. Toggles the inspection panel + enemy/ballista range.
  _inspectAtCursor() {
    if (this.isStoryInputLocked()) return;
    if (this.battleState === 'BATTLE_END') return;
    const ic = (this._inputController ||= new InputController(this));
    if (this.inspectionPanel?.visible || ic._ballistaRangeShown) {
      this.clearInspectionVisuals();
      return;
    }
    const cursor = this._gridCursor;
    if (!cursor || !this.grid) return;
    const world = this.grid.gridToPixel(cursor.cursorCol, cursor.cursorRow);
    if (!world) return;
    this._showInspectionAtPixel(world.x, world.y);
  }

  // Gamepad cursor analogue of a mouse hover: whenever the grid cursor lands on a
  // tile (d-pad move, L1/R1 snap, select snap), refresh the top-left terrain/unit
  // info panel and — while a unit is selected — the movement path preview.
  _onGridCursorMoved(col, row) {
    if (this.battleState === 'BATTLE_END') return;
    const ic = (this._inputController ||= new InputController(this));
    ic.refreshTileInfo(col, row);
    ic.updatePathPreview(col, row);
  }

  _isSceneActiveForAsync(session) {
    return isCurrentBattleSession(this, session);
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
    const session = battleSession(this);
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
      if (!isCurrentBattleSession(this, session)) {
        settled = true;
        cleanup();
        return; // Park obsolete work, including its catch/finally blocks.
      }
      settled = true;
      cleanup();
      resolvePromise(value || { status: 'completed' });
    };
    guard.cancel = (reason = 'cancelled') => {
      if (settled) return;
      guard.cancelled = true;
      if (reason === 'timeout' && isCurrentBattleSession(this, session))
        guard.resolve({ status: 'timed_out' });
      else {
        // Cancellation releases resources, never the continuation. A rejected
        // promise would run old error recovery and finally against the restart.
        settled = true;
        cleanup();
      }
      // Mark cancellation before removing the tween: Phaser can synchronously
      // invoke onStop during remove(), which must not release parked work.
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
    const session = battleSession(this);
    const safeDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    if (!this._isSceneActiveForAsync(session)) return new Promise(() => {});
    if (this.scene?.isActive?.() === false) return { status: 'skipped_paused' };
    if (safeDelay <= 0) return { status: 'completed' };
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
      timer = this.time?.delayedCall?.(waitDuration(this, label, safeDelay), () => {
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
    const outcome = await promise;
    if (!isCurrentBattleSession(this, session)) return new Promise(() => {});
    return outcome;
  }

  async _awaitSceneTween(
    tweenConfig,
    {
      label = 'scene_tween',
      timeoutMs = null,
      onCancel = null,
      session = battleSession(this),
    } = {},
  ) {
    if (!tweenConfig) return;
    if (!this._isSceneActiveForAsync(session)) return new Promise(() => {});
    if (this.scene?.isActive?.() === false) {
      if (typeof onCancel === 'function') onCancel('paused');
      return { status: 'skipped_paused' };
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
    const wrappedConfig = waitTween(this, label, tweenConfig);
    const originalOnComplete = wrappedConfig.onComplete;
    const originalOnStop = wrappedConfig.onStop;
    wrappedConfig.onComplete = (...args) => {
      if (guard.cancelled || !this._isSceneActiveForAsync(session)) return;
      try {
        originalOnComplete?.(...args);
      } finally {
        guard.resolve();
      }
    };
    wrappedConfig.onStop = (...args) => {
      if (guard.cancelled || !this._isSceneActiveForAsync(session)) return;
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
    const outcome = await promise;
    if (!isCurrentBattleSession(this, session)) return new Promise(() => {});
    return outcome;
  }

  _scheduleSafeDelayedAsync(
    delayMs,
    label,
    callback,
    { phase = null, turn = null, onError = null } = {},
  ) {
    const session = battleSession(this);
    const safeDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    const run = async () => {
      if (!this._isSceneActiveForAsync(session)) return;
      try {
        await callback();
      } catch (err) {
        if (!this._isSceneActiveForAsync(session)) return;
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

    if (!isCurrentBattleSession(this, session)) return null;
    // Paused scenes retain this session: settle immediately rather than queue
    // a Phaser timer that cannot fire until resume. Shutdown still rejects above.
    if (this.scene?.isActive?.() === false) return run();
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

  _bindGameplayKeyboardHandlers() {
    const session = battleSession(this);
    const keyboard = this.input?.keyboard;
    if (!keyboard?.on) return;

    this._unbindGameplayKeyboardHandlers();

    this._gameplayKeyHandlers = {
      menuNavigation: (event) => {
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !isUnitMenuState(this.battleState) ||
          !hasInputFocus(this) ||
          hasOpenOverlay(this) ||
          this.isStoryInputLocked()
        )
          return;
        if (event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]'))
          return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          this._menuFocus?.move(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter' && !event.repeat) {
          event.preventDefault();
          this._menuFocus?.activate();
        }
      },
      pinThreat: (event) => {
        if (
          event?.repeat ||
          event?.defaultPrevented ||
          event?.altKey ||
          event?.ctrlKey ||
          event?.metaKey ||
          !hasInputFocus(this) ||
          hasOpenOverlay(this) ||
          this.isStoryInputLocked()
        )
          return;
        if (event?.target?.closest?.('input, textarea, select, button, [contenteditable="true"]'))
          return;
        if (!['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU'].includes(this.battleState))
          return;
        const panel = this.inspectionPanel;
        if (panel?.visible && this.togglePinnedThreat(panel._unit)) {
          panel.show(panel._unit, panel._terrain, panel._gameData);
        }
      },
      nextReady: (event) => {
        if (
          event?.repeat ||
          event?.altKey ||
          event?.ctrlKey ||
          event?.metaKey ||
          !hasInputFocus(this) ||
          hasOpenOverlay(this) ||
          this.isStoryInputLocked() ||
          this.battleState !== 'PLAYER_IDLE' ||
          this._isPrologueGateActive()
        )
          return;
        const unit = nextReadyUnit(this, this._lastLocatedUnit);
        if (unit && locateUnit(this, unit)) this._lastLocatedUnit = unit;
      },
      viewUnit: () => {
        if (this.isStoryInputLocked()) return;
        if (this.inspectionPanel.visible && this.inspectionPanel._unit) {
          this.openUnitDetailOverlay();
        }
      },
      forceEndTurn: () => {
        if (this.isStoryInputLocked()) return;
        // Aiming a chosen-center art, E steps to the next foe (AreaTargetingController).
        if (this.battleState === AREA_CENTER_STATE) return;
        this.forceEndTurn();
      },
      cancel: (event) => {
        if (event?.repeat) return;
        if (isEscConsumed(this, event)) return;
        // A stacked overlay (help, campaign map, promotion choice, …) owns
        // ESC while open; its own handler closes it top-down.
        if (hasOpenOverlay(this)) return;
        if (this.isStoryInputLocked()) return;
        const handled = this.requestCancel();
        if (handled) consumeEscEvent(this, event);
      },
      rewindAndLootRoster: () => {
        if (this.isStoryInputLocked()) return;
        this.requestVisionRewind();
        // Loot roster toggle during BATTLE_END (click button shouldn't trigger this)
        if (
          this.battleState === 'BATTLE_END' &&
          this.lootGroup?.length > 0 &&
          !this.isTransitioningOut &&
          this.runManager
        ) {
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
        if (this.battleState === CANTO_CONFIRM_STATE && this.selectedUnit) {
          this.confirmCantoMove();
        } else if (this.battleState === 'CANTO_MOVING' && this.selectedUnit) {
          this.grid.clearHighlights();
          completeBattleAction(this, this.selectedUnit, { session: session });
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
      // Target-first attack: arrows cycle targets, Enter/Space open/confirm.
      attackFlow: (event) => {
        if (
          !hasInputFocus(this) ||
          hasOpenOverlay(this) ||
          this.isStoryInputLocked() ||
          this.unitDetailOverlay?.visible
        )
          return;
        if (this.battleState === AREA_CENTER_STATE && this._areaTargeting().handleKey(event))
          return;
        this._attackFlow().handleKey(event);
      },
    };

    keyboard.on('keydown', this._gameplayKeyHandlers.menuNavigation);
    keyboard.on('keydown', this._gameplayKeyHandlers.attackFlow);
    keyboard.on('keydown-T', this._gameplayKeyHandlers.pinThreat);
    keyboard.on('keydown-N', this._gameplayKeyHandlers.nextReady);
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
      keyboard.off('keydown', this._gameplayKeyHandlers.menuNavigation);
      keyboard.off('keydown', this._gameplayKeyHandlers.attackFlow);
      keyboard.off('keydown-T', this._gameplayKeyHandlers.pinThreat);
      keyboard.off('keydown-N', this._gameplayKeyHandlers.nextReady);
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
    const session = battleSession(this);
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
      this._battleRecruits = [];
      this._fallenBattleRecords = []; // DeedController.onUnitRemoved
      // The run's earned blessings that act in battle (engine/BattleBlessings.js), read once
      // here: null when it holds none. A resume's snapshot puts back what they had spent.
      this._battleBlessings = battleBlessingsAtStart({
        run: this.runManager,
        battleParams: this.battleParams,
      });

      // Track non-deployed units for merging back on victory
      if (
        !isStandaloneScriptedBattle(this.battleParams, this.runManager) &&
        this.roster &&
        deployedRoster
      ) {
        // By unit identity: a benched unit that shares a deployed unit's name must
        // still come back on victory (UnitIdentity.js).
        const deployed = new Set(deployedRoster);
        this.nonDeployedUnits = this.roster.filter(
          (u) => !deployed.has(u) && !deployedRoster.some((d) => isSameUnit(d, u)),
        );
      } else {
        this.nonDeployedUnits = [];
      }

      // deployCount: MapGenerator spawn generation and the Last deed at victory.
      const deployCount = battleDeployCount({
        deployedRoster,
        resuming: Boolean(this._resumeCheckpoint),
        recorded: this.battleParams?.deployCount,
      });
      this.battleParams.deployCount = deployCount;
      this.battleParams.isBoss = !!this.isBoss;

      // Generate or reuse locked encounter for this node. The prologue run's chapters
      // are pre-locked at startPrologue (the same authored config every entry); a
      // standalone chapter builds the authored map, never generated or locked.
      const lockedConfig = this.runManager?.getLockedBattleConfig?.(this.nodeId);
      const prologueChapter = lockedConfig
        ? null
        : prologueChapterOf(this.battleParams, this.gameData);
      if (lockedConfig) {
        this.battleConfig = lockedConfig;
      } else if (prologueChapter) {
        this.battleConfig = buildPrologueBattleConfig(prologueChapter, this.gameData.terrain);
      } else {
        const battleSeed = Number.isFinite(this.battleParams?.battleSeed)
          ? this.battleParams.battleSeed
          : this.deriveBattleSeed();
        this.battleConfig = this.withBattleSeed(battleSeed, () =>
          generateBattle(this.battleParams, this.gameData),
        );
        this.runManager?.lockBattleConfig?.(this.nodeId, this.battleConfig);
      }
      if (
        import.meta.env.DEV &&
        new URLSearchParams(globalThis.location?.search || '').get('battleLab') === '1' &&
        !isScriptedBattle(this.battleParams) &&
        !this._resumeCheckpoint
      ) {
        const labQuery = new URLSearchParams(globalThis.location?.search || '');
        const templateId = labQuery.get('labMap');
        const labMap = BATTLEFIELD_LAB_MAPS.find((map) => map.id === templateId);
        if (labMap) {
          const seed = Number(labQuery.get('seed') || 42);
          this.battleConfig = this.withBattleSeed(Number.isFinite(seed) ? seed : 42, () =>
            generateBattle(
              { act: labMap.act, objective: 'rout', templateId, deployCount },
              this.gameData,
            ),
          );
        } else {
          this.battleConfig = createBattlefieldLabFixture(this.battleConfig, this.gameData.terrain);
        }
      }
      const bc = this.battleConfig;

      // Build the grid from generated map (with optional fog of war)
      const fogEnabled = this.battleParams.fogEnabled || false;
      // Portrait battles: an upright phone draws the board turned a quarter.
      this._portraitBattle?.destroy();
      this._portraitBattle = new PortraitBattleController(this);
      const boardPresentation = this._portraitBattle.resolvePresentation(bc);
      this.grid = new Grid(
        this,
        bc.cols,
        bc.rows,
        this.gameData.terrain,
        bc.mapLayout,
        fogEnabled,
        bc.biome || null,
        boardPresentation,
      );
      this._portraitBattle.create();
      this._battlefieldTerrain?.destroy();
      this._battlefieldTerrain = paintBattlefieldTerrain(this, this.grid);

      resetBattleIdentities(this, this._resumeCheckpoint?.nextEntityId);
      for (const unit of this.nonDeployedUnits || []) registerBattleEntity(this, unit);

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
      this._battleTimeline = hydrateBattleTimeline(this.runManager?.battleInProgress?.timeline);
      this._timelineCurrentEntryId =
        this.runManager?.battleInProgress?.timelineCurrentEntryId || null;
      this._fatalDecision = null;
      this._fatalCapturePending = false;
      this._defeatDecision = null;
      this._timelineFacts = [];
      resetHistoryRecording(this);
      this._timelineBoundary = null;
      this.initializeVisionState();
      this._battleRewindPolicy = this._resumeCheckpoint
        ? this.runManager?.battleInProgress?.rewindPolicy || 'legacy-v1'
        : 'fixed-v1';
      this.installBattleRng();

      // Anti-refresh suspend: persist a battle-in-progress flag (plus the
      // locked encounter and entry-time Vision/RNG values) so an interrupted
      // battle offers Resume-or-Revert on continue instead of silently
      // rewinding to the pre-battle NodeMap auto-save. Placed after the RNG
      // install so the recorded reinforcement seed matches live play.
      if (this.runManager && !this._resumeCheckpoint) {
        this.runManager.lastDeployment = (deployedRoster || []).map((unit) => unit.name);
        this.runManager.beginBattleInProgress?.(this.nodeId, {
          battleParams: { ...this.battleParams, battleSeed: this.getReinforcementSeed() },
          isBoss: this.isBoss,
          isElite: this.isElite,
        });
        this._persistBattleRunState?.(null, { session: session });
      }

      // Create player units. A prologue chapter's authored roster (built by the title)
      // takes the deployed-roster path: one unit per authored spawn, in order.
      if (this._resumeCheckpoint) {
        // Resume: all units (player/enemy/npc + benched) come from the
        // suspend checkpoint, exactly as they stood at capture time.
        (this._battleSuspendController ||= new BattleSuspendController(this)).applyUnits(
          this._resumeCheckpoint,
        );
      } else if (deployedRoster) {
        // Recruit battles: lords (who alone can Talk) take the spawns nearest the recruit.
        const tiles = spawnTilesForDeployment(deployedRoster, bc.playerSpawns, {
          lordsFirst: Boolean(bc.npcSpawn),
        });
        for (let i = 0; i < deployedRoster.length; i++) {
          const unit = deployedRoster[i];
          if (!tiles[i]) {
            // No spawn left for this unit: bench it rather than lose it. A unit on
            // neither the field nor the bench is counted as fallen at victory.
            console.warn(`[BattleScene] No spawn tile for ${unit?.name}; benched.`);
            this.nonDeployedUnits.push(unit);
            registerBattleEntity(this, unit);
            continue;
          }
          unit.col = tiles[i].col;
          unit.row = tiles[i].row;
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

      // Commander flag must exist before the first checkBattleEnd — the
      // defeat/escape checks are strict on it, and prologue/standalone
      // rosters (and legacy resume checkpoints) never pass through RunManager.
      if (this._resumeCheckpoint?.commanderEntityId) {
        this._battleCommanderId = this._resumeCheckpoint.commanderEntityId;
        for (const unit of [...this.playerUnits, ...(this.escapedUnits || [])])
          unit.isCommander = unit.battleEntityId === this._battleCommanderId;
      } else {
        const commander = stampCommanderFlag([...this.playerUnits, ...(this.escapedUnits || [])]);
        this._battleCommanderId = commander?.battleEntityId || null;
      }

      // Create enemies from generated spawns
      if (!this._resumeCheckpoint) {
        for (const spawn of bc.enemySpawns) {
          this.addEnemyFromSpawn(spawn);
        }
        // The anti-turtle clock measures from the populated field (the reset above ran
        // on empty unit arrays, which made kills never count as progress).
        this.initializeAntiTurtleState();
      }
      this._bossName = this._resolveBossDialogueName(
        this.enemyUnits.find((unit) => unit.isBoss)?.name || null,
      );

      // Merchant Caravan: spawn from battleConfig.caravanSpawn if rolled for
      // this node (resume restores it from the suspend checkpoint instead).
      (this._caravanController ||= new CaravanController(this)).spawnIfConfigured();
      if (this._resumeCheckpoint) {
        this._caravanController.retintIfPresent();
      }

      // Village & bandit secondary objective: marker + state from
      // battleConfig.villageTile (resume restores state from the suspend
      // checkpoint; the controller only re-renders/re-applies terrain).
      (this._villageController ||= new VillageController(this)).create();

      // Spawn NPC for recruit battles. RecruitNodeSystem builds the exact recruit the
      // Loom previewed (own seeded stream, so the battle RNG is not consumed).
      if (bc.npcSpawn && !this._resumeCheckpoint) {
        const npcSpawn = bc.npcSpawn;
        const preview = { className: npcSpawn.className, name: npcSpawn.name };
        const node = this.runManager?.nodeMap?.nodes?.find((n) => n.id === this.nodeId) || null;
        // An authored green unit (P3's Sera) is built from its prologue spec, never as
        // a rolled recruit (the harness uses the same builder).
        const built = npcSpawn.prologueUnit
          ? { unit: buildPrologueNpcUnit(npcSpawn, this.gameData) }
          : this.runManager && node
            ? this.runManager.getRecruitNodeUnit(node, { preview })
            : buildRecruitNodeUnit({
                preview,
                nodeId: this.nodeId || 'recruit',
                runSeed: this.battleParams?.battleSeed ?? 0,
                act: this.battleParams?.act || 'act1',
                roster: this.playerUnits,
                gameData: this.gameData,
                metaEffects:
                  this.runManager?.getEffectiveMetaEffects?.() ??
                  (this.runManager?.metaEffects
                    ? {
                        ...this.runManager.metaEffects,
                        growthBonuses:
                          this.runManager.getEffectiveRecruitGrowthBonuses?.() ||
                          this.runManager.metaEffects.growthBonuses ||
                          null,
                      }
                    : null),
              });
        const npc = built?.unit || null;
        if (npc) {
          // The tile must suit the unit that actually spawned (a lord roll can turn a
          // Myrmidon preview into Cavalry Rowan); RNG-free re-seat if it does not. An
          // authored tile is validated with its data and never moves.
          if (!npcSpawn.prologueUnit)
            reconcileRecruitSpawnTile(bc, {
              moveType: npc.moveType || 'Infantry',
              terrainData: this.gameData.terrain,
              classesData: this.gameData.classes,
              weaponsData: this.gameData.weapons,
            });
          npc.col = npcSpawn.col;
          npc.row = npcSpawn.row;
          // Run identity from the start, so a fallen-recruit record and a living
          // namesake are never confused (UnitIdentity.js).
          this.runManager?.assignUnitUid?.(npc);
          this.npcUnits.push(npc);
          this.addUnitGraphic(npc);
        }
      }

      if (!this._resumeCheckpoint) {
        for (const unit of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
          unit._phoenixBroochUsed = false;
        }
        // The Lingering Injury burden (id `wounded`, engine/Burdens.js) and Cavalier's Hour (by move
        // type, engine/ShrineBoons.js): battle stat deltas applied once, here, so the first forecast
        // already shows them. A resume's units carry them already.
        applyBattleStartDebuffs(this.playerUnits, this.battleParams?.battleDebuffs);
      }

      // Throne marker for Seize objective
      if (bc.objective === 'seize' && bc.thronePos) {
        const tp = this.grid.gridToPixel(bc.thronePos.col, bc.thronePos.row);
        this.add
          .text(tp.x, tp.y - 10, 'SEIZE', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: UI_PALETTE.accentText,
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(5);
      }

      // Escape square markers for Escape objective
      if (bc.objective === 'escape' && bc.escapeTiles?.length) {
        this._escapeController = new EscapeObjectiveController(this);
        this._escapeController.create();
      }

      // Calculate turn par (for turn bonus system). A chapter whose data hides par
      // (prologue `showPar: false`) has none: no HUD Par, no turn bonus, no pressure.
      this.turnPar = null;
      this.turnBonusConfig = this.gameData.turnBonus;
      if (this.turnBonusConfig && this.battleConfig && !this.battleConfig.hidePar) {
        // One builder with the harness (Patient Dawn's turns ride battleParams).
        const mapParams = battleParMapParams(this.battleConfig, {
          enemyCount: this.enemyUnits.length,
          terrainData: this.gameData.terrain,
          battleParams: this.battleParams,
        });
        this.turnPar = calculatePar(
          mapParams,
          this.turnBonusConfig,
          this.battleParams?.difficultyId,
        );
      }

      // Battle state machine
      this.battleState = 'PLAYER_IDLE';
      this.selectedUnit = null;
      this.movementRange = null;
      this.preMoveLoc = null;
      this.attackTargets = [];
      this.healTargets = [];
      this.staffRelocateTargets = [];
      this.staffRelocateAlly = null;
      this.staffRelocateTiles = [];
      this.forecastTarget = null;
      this.forecastObjects = null;
      // The weapon the open forecast plans to attack with. Scene-only: it is
      // never equipped before confirm and never saved.
      this._forecastWeapon = null;
      this._forecastWeaponArt = null;
      this._forecastGamblerLine = null;
      this.actionMenu = null;
      this._actionMenuPublished = null;
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
      startTracedIdle(this);

      // Turn manager
      this.turnManager = new TurnManager({
        onPhaseChange: (phase, turn) => this.onPhaseChange(phase, turn),
        onVictory: () => this.onVictory(),
        onDefeat: () => this.onDefeat(),
        checkBattleEnd: () => this.checkBattleEnd(),
        onRejectedTransition: (transition) =>
          console.warn('[BattleScene] rejected phase transition:', {
            ...transition,
            battleState: this.battleState,
          }),
      });
      this.turnManager.init(this.playerUnits, this.enemyUnits, this.npcUnits, bc.objective);

      // AI controller
      this.aiController = new AIController(this.grid, this.gameData, {
        objective: bc.objective,
        thronePos: bc.thronePos,
      });
      // Holders wake on the Danger overlay's tiles: the board as the player knows it.
      this.aiController.setHoldContext?.(() => this.threatContext());

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
          color: UI_PALETTE.text,
          backgroundColor: '#000000aa',
          padding: { x: 4, y: 2 },
        })
        .setDepth(100);

      // Objective display (top-right) -- dynamic
      this.objectiveText = this.add
        .text(this.cameras.main.width - 8, 8, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: UI_PALETTE.accentText,
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
          color: UI_PALETTE.text,
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
          color: UI_PALETTE.text,
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
      // Show turn 1 and par from the first frame: boss cards, pre-battle lines and
      // deployment all play before the first player phase refreshes it.
      try {
        this.renderTurnCounter(Math.max(1, this.getCurrentTurnNumber()));
      } catch (err) {
        if (!isCurrentBattleSession(this, session)) return;
        console.warn('[BattleScene] initial turn counter failed:', err);
      }

      this.updateTopLeftHudLayout();

      // Bottom command bar -- Row 1: clickable action buttons, Row 2: info text
      const hw = this.cameras.main.width / 2;
      const hh = this.cameras.main.height;
      const commandRowY = hh - 58;
      const helpRowY = hh - 40;
      const btnStyle = { fontFamily: 'monospace', fontSize: '11px', color: UI_PALETTE.text };
      const makeButton = (x, label, handler) => {
        const btn = this.add
          .text(x, commandRowY, label, btnStyle)
          .setOrigin(0.5)
          .setDepth(101)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor(UI_PALETTE.accentText));
        btn.on('pointerout', () => btn.setColor(UI_PALETTE.text));
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
            ? 'Vision: rewind  |  Inspect: unit details  |  Cancel: go back'
            : '[R] Rewind  [V] Right-click Unit: Details  |  ESC/[X]/off-map tap: cancel',
          { fontFamily: 'monospace', fontSize: '11px', color: UI_PALETTE.info },
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

      // A prologue chapter's coach, gates and notes (PrologueController).
      if (isScriptedBattle(this.battleParams)) {
        this._prologue = new PrologueController(this);
        this._prologue.create();
      }

      // Unit inspection tooltip (right-click shows name + "View Unit [V]")
      this.inspectionPanel = new UnitInspectionPanel(this);
      // Full unit detail overlay (V key or click tooltip)
      this.unitDetailOverlay = new UnitDetailOverlay(this, this.gameData);
      this.dialogueOverlay = new DialogueOverlay(this);

      // Danger zone overlay
      this.dangerZone = new DangerZoneOverlay(this, this.grid);
      this.keepDangerVisible = false;
      this._pinnedThreats = new PinnedThreatController(this);
      this.pinnedThreatEnemies = this._pinnedThreats.enemies;
      this.dangerZoneCache = null;
      this.dangerZoneStale = true;
      this._pinnedThreats?.invalidate();
      // Who can reach the tile a selected unit is heading for (eye + line + count).
      this._threatSight = new ThreatSightController(this).create();
      // One-time field notes for new players (Guidance setting).
      this._guidance = new GuidanceController(this).create();

      // Disable browser context menu
      this.input.mouse.disableContextMenu();

      // Input handlers
      this.input.on('pointermove', (pointer) => this.onPointerMove(pointer));
      this.input.on('gameout', () => this._inputController?.clearHoverInfo());
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
            if (this.battleState === CANTO_CONFIRM_STATE && this.selectedUnit) {
              this.confirmCantoMove();
              this.refreshEndTurnControl();
            } else if (this.battleState === 'CANTO_MOVING' && this.selectedUnit) {
              this.grid.clearHighlights();
              completeBattleAction(this, this.selectedUnit, { session: session });
              this.refreshEndTurnControl();
            } else if (this.canOpenPauseFromMenu()) {
              this.showPauseMenu();
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
            if (
              this.battleState === 'BATTLE_END' &&
              this.lootGroup?.length > 0 &&
              !this.isTransitioningOut &&
              this.runManager
            ) {
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
            this._mobileBattleHud?.requestEndTurn();
          },
          prevWeapon: () => {
            if (this.isStoryInputLocked()) return;
            this._cycleForecastWeapon(-1);
          },
          prevFoe: () => {
            if (this.isStoryInputLocked()) return;
            this._areaTargeting().cycle(-1);
          },
          nextFoe: () => {
            if (this.isStoryInputLocked()) return;
            this._areaTargeting().cycle(1);
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
          const routed = () => routeMobileAction(this, action, handler);
          this._mobileHandlers[action] = routed;
          ge.on(`mobile:${action}`, routed);
        }
      }

      this._mobileBattleHud?.destroy();
      this._mobileBattleHud = null;
      if (canUseTouchUI(this)) {
        this._mobileBattleHud = new MobileBattleHUD(this);
      }

      // Start battle music: per-act tracks, the antagonists' own themes, and
      // the calm/full layers of adaptive battle themes.
      this._musicCtrl?.destroy();
      this._musicCtrl = new BattleMusicController(this, {
        playersInDanger: () => this._anyPlayerInDanger(),
        bossEnraged: () => Boolean(this.antiTurtleState?.turnEnrageActive),
        entityHealth: () => entityHealth(this.enemyUnits),
        onFinale: (beat) =>
          (this._battleBeats ||= new BattleBeatsController(this)).entityRally(beat),
      });
      this._musicCtrl.create({
        act: this.battleParams?.act || 'act1',
        isBoss: this.isBoss,
        bossName: (this.enemyUnits || []).find((unit) => unit.isBoss)?.name || null,
        objective: this.battleConfig?.objective || null,
        context: battleMusicContext({
          battleParams: this.battleParams,
          battleConfig: this.battleConfig,
          runSeed: this.runManager?.runSeed,
          isElite: this.isElite,
        }),
        releaseFirst: isScriptedBattle(this.battleParams),
        // After a turn of the phone the track plays on: ease its calm/full level.
        intensityFadeMs: this._presentationSwitch ? 600 : 0,
      });

      // Initial fog of war update
      if (this.grid.fogEnabled) {
        this.grid.updateFogOfWar(this.playerUnits);
        this.updateEnemyVisibility();
      }

      // Recruit battles: a banner marks the recruit from turn 1, through fog too
      // (RecruitBeaconController replaces the old fog-only "?" marker).
      (this._recruitBeacon ||= new RecruitBeaconController(this)).create();
      // Zombie remains: a bone pile and countdown on each seen record (ZombieRemains).
      remainsOf(this).create();

      // FOG OF WAR indicator
      if (this.grid.fogEnabled) {
        const fogLabel = (this.fogOfWarLabel = this.add
          .text(8, this.cameras.main.height - 72, 'FOG OF WAR', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: UI_PALETTE.warn,
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 },
          })
          .setDepth(100));
        this._pinToScreen(fogLabel);

        const hints = this.registry.get('hints');
        if (hints && !hints.hasSeen('battle_fog')) {
          showContextualHint(
            this,
            'battle_fog',
            'Fog of War \u2014 enemies beyond sight are hidden. The fog lifts when an action ends.',
          );
        }
      }

      this.visionHudText = this.add
        .text(8, 48, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: UI_PALETTE.info,
          backgroundColor: '#000000aa',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0, 0)
        .setDepth(100);
      this._pinToScreen(this.visionHudText);
      this.updateVisionHud();

      // Presentation: the Eclipse projection, reliquary desktop HUD plates, then the
      // act mood (grade + night).
      this._eclipseHud?.destroy();
      this._eclipseHud = new EclipseHudController(this).create();
      this._contractHud?.destroy();
      this._contractHud = new ContractHudController(this).create();
      this._desktopHud?.destroy();
      this._desktopHud = new DesktopBattleHud(this).create();
      this._atmosphere?.destroy();
      this._atmosphere = new AtmosphereController(this).create();

      // Not in a recruit battle: it would open as a dialog there (see battle_first_turn_hints).
      if (this.mobileCameraEnabled && !hasRecruitNpc(this.npcUnits)) {
        const hints = this.registry.get('hints');
        // Upright, Recenter is not on the rail (portraitBattle.css): the lesson names
        // Overview, and a later upright battle says the phone can turn sideways.
        const hint =
          hints &&
          mobileBattleHint({
            hasSeen: (id) => hints.hasSeen(id),
            upright:
              typeof document !== 'undefined' &&
              document.documentElement.classList.contains('portrait-battle'),
          });
        if (hint) showContextualHint(this, hint.id, hint.message);
      }

      // Debug overlay (dev-only)
      if (this.isDevToolsEnabled()) {
        this.debugOverlay = new DebugOverlay(this);
        this._bindDevToggleKey();
      }

      // Formation (3+ units): the army leaves the field and waits for the player to
      // place it; the boss card and pre-battle lines play over the empty tiles.
      this._formation?.destroy();
      this._formation = null;
      if (FormationController.shouldRun(this)) {
        this._formation = new FormationController(this);
        this._formation.lift();
      }

      await this._presentBossEncounter();
      if (!isCurrentBattleSession(this, session)) return;

      if (this.isBoss && this._bossName && this.runManager) {
        const bossName = this._resolveBossDialogueName(this._bossName);
        const dialogueKey = `boss_pre_${bossName}`;
        // preBattle entries + the commander's reply (loop-aware bosses only)
        const entries = (this._battleBeats ||= new BattleBeatsController(
          this,
        )).getBossPreBattleEntries(bossName);
        try {
          await this._showStoryDialogueOnce(dialogueKey, entries);
          if (!isCurrentBattleSession(this, session)) return;
          await this._showStoryDialogueOnce(
            'lieutenant_vision',
            this._battleBeats.getLieutenantVisionEntries(),
          );
          if (!isCurrentBattleSession(this, session)) return;
        } catch (err) {
          if (!isCurrentBattleSession(this, session)) return;
          console.warn('[BattleScene] boss pre-battle dialogue failed:', err);
        }
      }

      // Start the battle (or pick a suspended one back up mid-turn)
      if (this._resumeCheckpoint) {
        try {
          (this._battleSuspendController ||= new BattleSuspendController(this)).finalizeResume(
            this._resumeCheckpoint,
          );
        } catch (err) {
          if (!isCurrentBattleSession(this, session)) return;
          // A checkpoint that cannot be restored must not trap the player in
          // a resume loop — revert it (or park a fatal one) and persist.
          this._abandonUnrestorableResume();
          throw err;
        }
        this._resumeCheckpoint = null;
        this._bossPresence?.sync({ silent: true });
      } else {
        if (this._formation?.active) {
          await this._formation.run();
          if (!isCurrentBattleSession(this, session)) return;
          if (!this._isSceneActiveForAsync(session)) return;
        }
        // Dev/preview review setups only (devStartup sets battleParams.devScenario).
        if (this.battleParams?.devScenario) applyDevScenario(this);
        this._bossPresence?.sync();
        this.turnManager.startBattle();
      }
      this.refreshEndTurnControl();
    } catch (err) {
      if (!isCurrentBattleSession(this, session)) return;
      console.error('BattleScene.beginBattle failed:', err);
      let fatalResumeParked = this._fatalResumeParked === true;
      if (this._resumeCheckpoint) {
        // Unrestorable checkpoint — scrub the suspend so the next continue
        // goes back to the map instead of retrying a broken resume forever.
        this._resumeCheckpoint = null;
        fatalResumeParked = this._abandonUnrestorableResume() === 'fatal';
      }
      const reason = String(err?.message || 'unknown_error').slice(0, 140);
      // A parked fatal checkpoint must be settled from the slot screen; the
      // route map would let a new battle overwrite the recorded defeat.
      const toMap = Boolean(this.runManager) && !fatalResumeParked;
      const cam = this.cameras.main;
      const toast = this.add
        .text(
          cam.centerX,
          cam.centerY,
          `Battle failed to load (${reason}). Returning to ${toMap ? 'map' : 'title'}...`,
          {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: UI_PALETTE.bad,
            backgroundColor: '#000000',
            padding: { x: 10, y: 6 },
          },
        )
        .setOrigin(0.5)
        .setDepth(999);
      this.time.delayedCall(2000, () => {
        toast.destroy();
        if (toMap) {
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
          void transitionToScene(
            this,
            'Title',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.BACK },
          );
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
    return Boolean(
      this._saveRetry?.isBlocking() ||
      this._storyDialogueActive ||
      this._ceremonies?.isBlocking?.() ||
      this.dialogueOverlay?.visible ||
      this.battleState === 'TURN_START_RESOLVING',
    );
  }

  /**
   * Boss presence at battle start: the boss bar (restored silently on resume)
   * and, on a fresh boss battle only, the encounter card before the
   * pre-battle lines. Never replays on resume/reload.
   */
  async _presentBossEncounter() {
    this._bossPresence?.destroy();
    this._bossPresence = new BossPresenceController(this).create();
    // Resume: the bar is raised silently once the checkpoint is fully restored.
    if (this._resumeCheckpoint) return;
    if (!this.isBoss || !this._bossName || !this.runManager) return;
    try {
      await this._getCeremonies().showBossIntro({
        unit: (this.enemyUnits || []).find((unit) => unit.isBoss),
        // A prologue chapter's boss card reads "Prologue", not the act it borrows.
        actId: isScriptedBattle(this.battleParams) ? 'prologue' : this.battleParams?.act,
      });
    } catch (err) {
      console.warn('[BattleScene] boss encounter card failed:', err);
    }
  }

  /** Scene-owned ceremony presenter (DOM); callers fall back when absent. */
  _getCeremonies() {
    if (!this._ceremonies || this._ceremonies.destroyed)
      this._ceremonies = new CeremonyController(this);
    return this._ceremonies;
  }

  _resolveBossDialogueName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed === 'Dark Champion') return 'The Lieutenant';
    return trimmed;
  }

  async _showStorySequence(entries, options = {}) {
    const session = battleSession(this);
    if (!Array.isArray(entries) || entries.length <= 0 || !this.dialogueOverlay) return;
    this._storyDialogueActive = true;
    try {
      await this.dialogueOverlay.showSequence(
        adaptDialogueEntries(entries, this.runManager?.getStartingLordNames?.()),
        options,
      );
      if (!isCurrentBattleSession(this, session)) return;
    } finally {
      if (isCurrentBattleSession(this, session)) {
        this._storyDialogueActive = false;
        this.refreshEndTurnControl();
      }
    }
  }

  async _showStoryDialogueOnce(dialogueKey, entries, options = {}) {
    const session = battleSession(this);
    if (!this.runManager || typeof dialogueKey !== 'string' || !dialogueKey) return;
    if (this.runManager.hasShownDialogue(dialogueKey)) return;
    if (!Array.isArray(entries) || entries.length <= 0) return;
    this.runManager.markDialogueShown(dialogueKey);
    await this._showStorySequence(entries, { ...options, key: dialogueKey });
    if (!isCurrentBattleSession(this, session)) return;
  }

  _clearPostLootTransitionFallback() {
    (this._lootFlowController ||= new LootFlowController(this))._clearPostLootTransitionFallback();
  }

  _startPostLootTransition() {
    (this._lootFlowController ||= new LootFlowController(this))._startPostLootTransition();
  }

  /** A prologue chapter's guided step (select / move) still blocks free play. */
  _isPrologueGateActive() {
    return Boolean(this._prologue?.isGateActive());
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
    this._battleRng = createBattleRng(currentSeed);
    Math.random = this._battleRng;
    const restoreText =
      this._battleRewindPolicy === 'fixed-v1' ? isolateBattleTextFactory(this) : () => {};
    this._battleRandomRestore = () => {
      Math.random = prevRandom;
      restoreText();
      this._battleRng = null;
      this._battleRandomRestore = null;
    };
  }

  _restoreBattleRng() {
    if (this._battleRandomRestore) this._battleRandomRestore();
  }

  reseedBattleRng(seed, state = null) {
    const resolved = Number(seed) >>> 0;
    if (this.runManager) this.runManager.rngSeed = resolved;
    this._battleRng = createBattleRng(resolved, state);
    Math.random = this._battleRng;
  }

  initializeVisionState() {
    this._visionController = new VisionRewindController(this, this.runManager);
    this._visionController.initialize();
  }

  getEnemyDifficultyConfig() {
    return enemyDifficultyConfigFromParams(this.battleParams);
  }

  getReinforcementSeed() {
    const configuredSeed = this.battleParams?.battleSeed;
    if (Number.isFinite(configuredSeed)) return configuredSeed >>> 0;
    if (Number.isFinite(this.visionBaseSeed)) return this.visionBaseSeed >>> 0;
    return this.deriveBattleSeed() >>> 0;
  }

  getEnemySpawnFallbackLevel() {
    return enemySpawnFallbackLevel(this.battleConfig, this.battleParams?.act);
  }

  /** What arrivals copy (engine/ReinforcementSpawns.js), cached for the battle. */
  getReinforcementTemplatePool() {
    if (
      Array.isArray(this.reinforcementTemplatePool) &&
      this.reinforcementTemplatePool.length > 0
    ) {
      return this.reinforcementTemplatePool;
    }
    this.reinforcementTemplatePool = buildReinforcementTemplatePool({
      battleConfig: this.battleConfig,
      battleParams: this.battleParams,
      gameData: this.gameData,
    });
    return this.reinforcementTemplatePool;
  }

  normalizeEnemyRewardMultiplier(value) {
    return normalizeEnemyRewardMultiplier(value);
  }

  getEnemyRewardMultiplier(enemyUnit) {
    return enemyRewardMultiplier(enemyUnit);
  }

  getEnemyXpMultiplier(enemyUnit) {
    return enemyXpMultiplier(enemyUnit);
  }

  buildReinforcementSpawnSpec(scheduledSpawn, spawnOrdinal = 0) {
    return buildReinforcementSpawnSpec({
      scheduledSpawn,
      spawnOrdinal,
      seed: this.getReinforcementSeed(),
      templates: this.getReinforcementTemplatePool(),
      battleConfig: this.battleConfig,
      battleParams: this.battleParams,
      gameData: this.gameData,
    });
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
    if (spawn.isEntity) enemy.isEntity = true;
    // Entity weapons, Sunder/Poison, siege (own weapons kept behind it), status staff,
    // Nightfall+ secondaries: shared with the headless harness.
    applyEnemySpawnGear(enemy, spawn, {
      weapons: this.gameData.weapons,
      difficultyId: this.battleParams?.difficultyId,
      // A carrier's item, as this run acquires it (the Vulnerary recipe), with a uid that
      // never draws Math.random (engine/EnemyCarry.js).
      consumables: this.runManager?.getConsumableCatalog?.() ?? this.gameData.consumables,
      battleKey: String(this.deriveBattleSeed()),
    });
    // An authored spawn's own weapon, skills and id win (prologue chapters).
    applySpawnLoadout(enemy, spawn, {
      weapons: this.gameData.weapons,
      skills: this.gameData.skills,
    });

    if (spawn.areaArt) bindEnemyAreaArt(enemy, spawn.areaArt, this.gameData.weaponArts?.arts);
    if (spawn.aiMode) enemy.aiMode = spawn.aiMode;
    // A garrison holder keeps its post until its pack wakes (HoldActivation).
    applyHoldSpawn(enemy, spawn);
    if (
      spawn.aiTargetTile &&
      Number.isFinite(spawn.aiTargetTile.col) &&
      Number.isFinite(spawn.aiTargetTile.row)
    ) {
      enemy.aiTargetTile = { col: spawn.aiTargetTile.col, row: spawn.aiTargetTile.row };
    }
    // Village bandits that spawn after the village resolved revert to chase.
    this._villageController?.sanitizeSpawnedEnemy(enemy);

    if (options.reinforcementMeta) stampReinforcementMeta(enemy, options.reinforcementMeta);

    this.enemyUnits.push(enemy);
    this.addUnitGraphic(enemy);
    return enemy;
  }

  getReinforcementOccupiedTiles() {
    return occupiedUnitTiles([...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]);
  }

  resolveReinforcementsForTurn(turn) {
    return resolveBattleReinforcements({
      turn,
      seed: this.getReinforcementSeed(),
      battleConfig: this.battleConfig,
      battleParams: this.battleParams,
      gameData: this.gameData,
      templates: this.getReinforcementTemplatePool(),
      playerUnits: this.playerUnits,
      enemyUnits: this.enemyUnits,
      npcUnits: this.npcUnits,
      occupied: this.getReinforcementOccupiedTiles(),
      fallbackDifficultyId: this.runManager?.difficultyId || 'normal',
    });
  }

  applyReinforcementsForTurn(turn) {
    // A rout whose field is already clear (the last enemy fell in this enemy phase)
    // takes no more waves: the battle ends at this phase's end (RoutObjective).
    if (this.isRoutFieldClear()) {
      const cleared = { turn, spawns: [], spawned: 0, cancelledByClear: true };
      this.lastReinforcementSchedule = cleared;
      return cleared;
    }
    const schedule = this.resolveReinforcementsForTurn(turn);
    this.lastReinforcementSchedule = schedule;
    // The ladder's objective line counts this turn's wave as resolved for the rest of
    // this enemy phase, even when every tile it wanted was blocked.
    if (this.battleConfig?.reinforcements?.ladder) {
      this._ladderResolvedTurn = Math.trunc(Number(turn) || 0);
      this.updateObjectiveText();
    }
    if (!Array.isArray(schedule.spawns) || schedule.spawns.length === 0)
      return { ...schedule, spawned: 0 };

    let spawned = 0;
    let banditSpawned = 0;
    const spawnedUnits = [];
    const arrived = [];
    for (let i = 0; i < schedule.spawns.length; i++) {
      const scheduledSpawn = schedule.spawns[i];
      const spec = this.buildReinforcementSpawnSpec(scheduledSpawn, i);
      if (!spec) continue;
      const enemy = this.addEnemyFromSpawn(spec, { reinforcementMeta: scheduledSpawn });
      if (enemy) {
        observeHistoryAction(this, 'arrived as a reinforcement', enemy);
        spawned++;
        spawnedUnits.push(enemy);
        if (enemy.aiMode === 'seek_tile') banditSpawned++;
        arrived.push(scheduledSpawn);
      }
    }

    if (spawned > 0) {
      this.dangerZoneStale = true;
      this._pinnedThreats?.invalidate();
      if (this.grid.fogEnabled) this.updateEnemyVisibility();
      this.updateObjectiveText();
      // One crimson band names the arrivals (bandits race the village);
      // visible arrival tiles are marked (ReinforcementPresenter).
      (this._reinforcements ||= new ReinforcementPresenter(this)).present(spawnedUnits, {
        bandits: banditSpawned,
      });

      // +1 par per wave that actually instantiated enemies, except waves that are the
      // clock itself (repeating pursuit, ladder): ReinforcementScheduler.waveRaisesPar.
      const parRaise = parRaiseForArrivals(arrived);
      if (Number.isFinite(this.turnPar) && parRaise > 0) this.turnPar += parRaise;
    }

    return { ...schedule, spawned };
  }

  // Hybrid arena walls (engine/TerrainPhases.js, the one applier the harness shares): a
  // tile a unit stands on and could not stand on after the change waits, and is retried
  // at each later enemy-phase start (pendingHybridOverrideTiles, saved with the battle).
  applyDueHybridOverridesForTurn(turn) {
    if (!(this.appliedHybridOverrideTurns instanceof Set)) {
      this.appliedHybridOverrideTurns = new Set();
    }
    const { result, pendingTiles } = applyDueHybridOverrides({
      grid: this.grid,
      battleConfig: this.battleConfig,
      turn,
      occupants: [
        ...(this.playerUnits || []),
        ...(this.enemyUnits || []),
        ...(this.npcUnits || []),
      ],
      appliedTurns: this.appliedHybridOverrideTurns,
      pendingTiles: this.pendingHybridOverrideTiles,
    });
    this.pendingHybridOverrideTiles = pendingTiles;

    if (result.changedTiles > 0) {
      this.dangerZoneStale = true;
      this._pinnedThreats?.invalidate();
      if (this.grid?.fogEnabled) this.updateEnemyVisibility();
      this.updateObjectiveText();
    }
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
    const session = battleSession(this);
    const applied = (this._visionController ||= new VisionRewindController(
      this,
      this.runManager,
    ))._applySnapshot();
    // Re-checkpoint the rewound state so a refresh resumes at the restored
    // turn start (with the Vision charge spend locked in alongside it).
    if (applied) this._captureSuspendCheckpoint?.({ session: session });
    return applied;
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

  /** Back/ESC request against the open Vision dialog (see dismissDialog). */
  cancelVisionDialog() {
    (this._visionController ||= new VisionRewindController(this, this.runManager)).dismissDialog();
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
    this.antiTurtleState = createTurnPressureState(this._measureTurnPressure());
  }

  /** What the anti-turtle clock measures progress against (engine/TurnPressure.js). */
  _measureTurnPressure() {
    return {
      ...measureTurnPressure({
        enemyUnits: this.enemyUnits,
        escapedUnits: this.escapedUnits,
        battleConfig: this.battleConfig,
      }),
      lordThroneDistance: this.getBestLordThroneDistance(),
      lordEscapeDistance: this.getBestLordEscapeDistance(),
    };
  }

  getBestLordThroneDistance() {
    return bestLordThroneDistance(this.playerUnits, this.battleConfig);
  }

  getBestLordEscapeDistance() {
    return bestLordEscapeDistance(this.playerUnits, this.battleConfig);
  }

  getCurrentTurnNumber(turnOverride = null) {
    if (Number.isFinite(turnOverride)) return Math.max(0, Math.trunc(turnOverride));
    return Math.max(0, Math.trunc(Number(this.turnManager?.turnNumber) || 0));
  }

  getTurnPressureState(turnOverride = null) {
    const turn = this.getCurrentTurnNumber(turnOverride);
    // Late pressure (XP/gold decay past par) applies alongside the Eclipse.
    return getLatePressureState(turn, this.turnPar, this.turnBonusConfig);
  }

  formatPressureMultiplier(value) {
    const safe = Number.isFinite(value) ? value : 1;
    return `x${safe.toFixed(2)}`;
  }

  getBossPressureWarning(turnOverride = null) {
    if (!(this.enemyUnits || []).some((u) => u.isBoss && u.currentHP > 0)) return '';
    const threshold = getBossEnrageTurn(this.turnPar, this.turnBonusConfig);
    if (!Number.isFinite(threshold)) return '';
    const turn = this.getCurrentTurnNumber(turnOverride);
    if (this.antiTurtleState?.turnEnrageActive) return 'Boss enraged · advancing aggressively';
    if (turn >= threshold) return 'Boss enrages this enemy phase';
    if (turn + 1 === threshold) return `Boss enrages next turn (turn ${threshold})`;
    return '';
  }

  /** Turn / par / rating text read by both HUDs (the phone rail parses it). */
  renderTurnCounter(turnArg) {
    if (!this.turnCounterText) return;
    const turn = turnArg ?? this.getCurrentTurnNumber?.() ?? 1;
    const pressureSuffix = this.getTurnPressureSummary(turn);
    if (this.turnPar !== null && this.turnPar !== undefined) {
      const rating = getRating(turn, this.turnPar, this.turnBonusConfig);
      const colors = {
        S: UI_PALETTE.good,
        A: UI_PALETTE.info,
        B: UI_PALETTE.warn,
        C: UI_PALETTE.bad,
      };
      this.turnCounterText.setText(
        `Turn: ${turn} / Par: ${this.turnPar} (${rating.rating})${pressureSuffix}`,
      );
      this.turnCounterText.setColor(colors[rating.rating] || UI_PALETTE.text);
    } else {
      this.turnCounterText.setText(`Turn: ${turn}${pressureSuffix}`);
      this.turnCounterText.setColor(UI_PALETTE.text);
    }
  }

  getTurnPressureSummary(turnOverride = null) {
    const pressure = this.getTurnPressureState(turnOverride);
    const warning = this.getBossPressureWarning?.(turnOverride);
    const bonus = pressure.active
      ? ` | Pressure: XP ${this.formatPressureMultiplier(pressure.xpMultiplier)} Gold ${this.formatPressureMultiplier(pressure.goldMultiplier)}`
      : '';
    return bonus + (warning ? ` | ${warning}` : '');
  }

  updateAntiTurtlePressure(turnOverride = null) {
    if (!this.antiTurtleState) return;
    const step = advanceTurnPressure(this.antiTurtleState, this._measureTurnPressure(), {
      turn: this.getCurrentTurnNumber(turnOverride),
      par: this.turnPar,
      turnBonusConfig: this.turnBonusConfig,
    });
    this.antiTurtleState = step.state;
    this.aiController?.setAggressiveMode?.(step.aggressiveMode);
    this.aiController?.setBossEnraged?.(step.turnEnrageActive);
    if (step.becameEnraged) this._playBossEnrageFx();
    this._bossPresence?.sync();
  }

  /** Flame aura on living bosses the moment turn-pressure enrage kicks in. */
  _playBossEnrageFx() {
    this._musicCtrl?.onBossEnrage();
    const fx = (this._combatFx ||= new CombatFxController(this));
    for (const boss of this.enemyUnits) {
      if (!boss?.isBoss || boss.currentHP <= 0 || !boss.graphic) continue;
      fx.playEnrage(boss);
    }
    // Headless/stub scenes (tests) have no display list -- fx above no-ops too
    if (this.add?.text) {
      this.showBriefBanner('The boss is enraged!', '#ff5544').catch(() => {});
    }
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
    resetFortHealStreak(unit);
  }

  // --- Deploy selection screen ---

  showDeployScreen(roster, limits, onConfirm, initialSelectedNames = null) {
    this.battleState = 'DEPLOY_SELECTION';
    const overlay = new DeployScreenOverlay(this, this.runManager, this.gameData);
    this._deployOverlay = overlay;
    overlay.show(roster, limits, onConfirm, initialSelectedNames);
    // A prologue chapter's first deploy screen opens with its note (P4).
    showPrologueDeployNote(this, limits);
  }

  // --- Unit rendering ---

  getSpriteKey(unit) {
    return battleUnitSpriteKey(this, unit);
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
      case 'Tome': {
        // The element is in the tome's name (Fire, Wildfire, Breachbolt, Firstwind).
        const name = String(weapon.name || '').toLowerCase();
        if (/thunder|bolt/.test(name)) return 'sfx_thunder';
        if (/wind|gust|vortex/.test(name)) return 'sfx_ice';
        return 'sfx_fire';
      }
      case 'Light':
        return 'sfx_light';
      case 'Breath':
        return 'sfx_fire';
      default:
        return 'sfx_hit';
    }
  }

  addUnitGraphic(unit) {
    registerBattleEntity(this, unit);
    placeBattlePortrait(this, unit); // stable face per unit (portrait variety)
    const color = FACTION_COLORS[unit.faction];

    // Entity: 3x3 footprint, center graphic on middle tile
    if (isEntity(unit)) {
      const center = getEntityCenter(unit);
      const cPos = this.grid.gridToPixel(center.col, center.row);
      const entitySize = TILE_SIZE * ENTITY_FOOTPRINT.width;
      const spriteKey = this.getSpriteKey(unit);
      if (this.textures.exists(spriteKey)) {
        unit.graphic = this.add.image(cPos.x, cPos.y, contrastSpriteKey(this, spriteKey));
        // rebuilt / traced Entity textures are 128 world px with their own foot baseline
        const baked = spriteKey.startsWith('rebuilt-') || spriteKey.startsWith('traced-');
        unit.graphic.setDisplaySize(baked ? 128 : entitySize - 4, baked ? 128 : entitySize - 4);
        unit.label = null;
      } else {
        unit.graphic = this.add.rectangle(cPos.x, cPos.y, entitySize - 4, entitySize - 4, 0x440066);
        unit.label = this.add
          .text(cPos.x, cPos.y, 'E', {
            fontFamily: 'monospace',
            fontSize: '24px',
            color: UI_PALETTE.rarityEpic,
          })
          .setOrigin(0.5)
          .setDepth(11);
      }
      unit.graphic.setDepth(10);
      const ringY = cPos.y + entitySize / 2 - 10;
      unit.factionIndicator = createFactionRing(this, unit, cPos.x, ringY, {
        color,
        entityWidthTiles: ENTITY_FOOTPRINT.width,
      });
      const barWidth = entitySize - 8;
      const barHeight = 4;
      const barY = cPos.y + entitySize / 2 - 4;
      unit.hpBar = {
        bg: this.add
          .rectangle(cPos.x, barY, barWidth, barHeight, dimColor(color, 0.3))
          .setDepth(12),
        fill: this.add
          .rectangle(cPos.x, barY, barWidth, barHeight, UI_HEX.dangerLine)
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
      unit.graphic = this.add.image(pos.x, pos.y, contrastSpriteKey(this, spriteKey));
      const src = this.textures.get(spriteKey).getSourceImage();
      if (spriteKey.startsWith('rebuilt-') || spriteKey.startsWith('traced-')) {
        unit.graphic.setDisplaySize(64, 64);
      } else if (src && src.width > TILE_SIZE && src.width <= TILE_SIZE * 1.5) {
        // Hi-res overhang sprite (48px art on 32px tiles). The anchor is
        // baked into the texture — feet sit 8px above the bottom edge — so
        // centering on the tile keeps feet at the tile bottom while the head
        // overhangs the tile above. Tile-center positioning stays valid.
        // Textures beyond 1.5x tile (e.g. unprocessed hi-res art) fall back
        // to the classic tile fit rather than covering the map.
        unit.graphic.setDisplaySize(src.width, src.height);
      } else {
        unit.graphic.setDisplaySize(TILE_SIZE - 2, TILE_SIZE - 2);
      }
      if (
        !spriteKey.startsWith('rebuilt-') &&
        !spriteKey.startsWith('traced-') &&
        battlefieldSpriteArtEnabled() &&
        unit.graphic.displayHeight > TILE_SIZE * 1.15
      ) {
        const ratio = (TILE_SIZE * 1.15) / unit.graphic.displayHeight;
        unit.graphic.setDisplaySize(unit.graphic.displayWidth * ratio, TILE_SIZE * 1.15);
      }
      unit.label = null;
    } else {
      unit.graphic = this.add.rectangle(pos.x, pos.y, TILE_SIZE - 4, TILE_SIZE - 4, color);
      unit.label = this.add
        .text(pos.x, pos.y, unit.name[0], {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: UI_PALETTE.text,
        })
        .setOrigin(0.5)
        .setDepth(11);
    }
    unit.graphic.setDepth(this._unitGraphicDepth(unit));

    // Faction ground ring (steel-blue player, crimson enemy/boss, verdigris NPC)
    unit.factionIndicator = createFactionRing(this, unit, pos.x, pos.y + RING_OFFSET_Y, {
      color,
    });

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
          unit.faction === 'enemy' ? UI_HEX.dangerLine : UI_HEX.hpHigh,
        )
        .setOrigin(0.5)
        .setDepth(13),
    };
    this.updateHPBar(unit);

    // Affix pips
    unit.affixPips = [];
    this.updateAffixPips(unit);
  }

  /**
   * The pips over a unit's tile: a square per affix, then a gem per Revival Stone it still
   * holds (engine/RevivalStones.js). One row, so fog, dimming, moves and removal treat them
   * as the one set of pips they already handle.
   */
  updateAffixPips(unit) {
    if (unit.affixPips) {
      unit.affixPips.forEach((p) => p.destroy());
    }
    unit.affixPips = [];
    // Pip row, left to right: Revival Stone gems (a boss), affix pips, then the sack of a
    // carrier (EnemyCarry.js: the item a Thief's Steal would take). A boss never carries, so
    // the gems and the sack never share a unit; the count below still sums all three so the
    // row stays centred whichever mix a unit wears. Each hides with its unit in fog.
    const affixIds = Array.isArray(unit.affixes) ? unit.affixes : [];
    const stones = revivalStoneCount(unit).remaining;
    const carries = Boolean(carriedItemInfo(unit));
    const count = affixIds.length + stones + (carries ? 1 : 0);
    if (count === 0) return;

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const pipY = pos.y - TILE_SIZE / 2 + 4;
    const pipSize = 4;
    const gap = 2;
    const totalW = pipSize * count + gap * (count - 1);
    let startX = pos.x - totalW / 2 + pipSize / 2;
    const inView = canInspectUnit(this.grid, unit);

    for (let i = 0; i < stones; i++) {
      const gem = this.add
        .rectangle(startX, pipY, pipSize, pipSize, UI_HEX.info)
        .setStrokeStyle(1, UI_HEX.void)
        .setAngle(45)
        .setDepth(14)
        .setVisible(inView);
      unit.affixPips.push(gem);
      startX += pipSize + gap;
    }

    for (const affixId of affixIds) {
      const affix = this.gameData.affixes?.affixes?.find((a) => a.id === affixId);
      const tier = affix?.tier || 1;
      const color = tier === 2 ? UI_HEX.dangerLine : UI_HEX.accent;
      const pip = this.add
        .rectangle(startX, pipY, pipSize, pipSize, color)
        .setStrokeStyle(1, 0x000000)
        .setDepth(14);
      unit.affixPips.push(pip);
      startX += pipSize + gap;
    }
    if (carries) {
      const sack = this.add
        .rectangle(startX, pipY, pipSize, pipSize + 1, UI_HEX.emberPale)
        .setStrokeStyle(1, 0x000000)
        .setDepth(14)
        .setVisible(canInspectUnit(this.grid, unit));
      unit.affixPips.push(sack);
    }
  }

  /**
   * Units lower on the map draw over units above them so 48px overhang
   * sprites overlap naturally. Stays within [10, 11) — below labels (11)
   * and HP bars (12/13).
   */
  _unitGraphicDepth(unit) {
    return 10 + Math.min(unit.row ?? 0, 90) * 0.01;
  }

  updateUnitPosition(unit) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    unit.graphic?.setPosition(pos.x, pos.y);
    unit.graphic?.setDepth(this._unitGraphicDepth(unit));
    if (unit.label) unit.label.setPosition(pos.x, pos.y);
    if (unit.factionIndicator) unit.factionIndicator.setPosition(pos.x, pos.y + RING_OFFSET_Y);
    this.updateHPBar(unit);
    this.updateAffixPips(unit);
    this._updateConditionIconPositions(unit);
    this.refreshVisibleDangerZone?.();
  }

  /**
   * Draw a unit's HP bar. Presentation only: HP rules live in UnitHealth.js.
   * `ratio` shows a fill other than the unit's HP for a moment (a broken Revival Stone's
   * refill, RevivalStoneController); the bar is redrawn from HP as soon as it is dropped.
   */
  updateHPBar(unit, { ratio: shownRatio = null } = {}) {
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
    const ratio = shownRatio ?? Math.max(0, unit.currentHP / unit.stats.HP);
    const fillWidth = barWidth * ratio;

    unit.hpBar?.bg?.setPosition(pos.x, barY);
    unit.hpBar?.fill?.setPosition(pos.x - barWidth / 2 + fillWidth / 2, barY);
    unit.hpBar?.fill?.setSize(fillWidth, barHeight);
    unit.hpBar?.fill?.setFillStyle(getHPBarColor(ratio));
    if (shownRatio !== null) return;
    if (unit.isBoss) this._bossPresence?.onUnitHp(unit);
    this._inputController?.refreshHoverInfo();
  }

  removeUnitGraphic(unit, { skipFxRelease = false } = {}) {
    // A class change already released these resources against the live identity.
    // Other removals free presentation tied to the graphic first.
    if (!skipFxRelease) this._combatFx?.releaseUnit?.(unit);
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
      unit.graphic.setTint(battleContrastEnabled() ? 0xb8b8b8 : UI_HEX.lineStrong);
    }
    if (unit.label) unit.label.setAlpha(0.5);
    setFactionRingActed(unit.factionIndicator, true);
    if (unit.affixPips) {
      unit.affixPips.forEach((p) => p.setAlpha(0.5));
    }
  }

  undimUnit(unit) {
    if (unit.graphic && unit.graphic.clearTint) {
      unit.graphic.clearTint();
    }
    if (unit.label) unit.label.setAlpha(1);
    setFactionRingActed(unit.factionIndicator, false);
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

  /**
   * Where the units the player knows of stand, for planning and threat previews
   * (blue ranges, Danger, inspected reach). In fog the player plans around what
   * they can see (FogAmbush.js). There is deliberately no omniscient variant:
   * execution uses buildOccupiedSet and the enemy AI builds its own map.
   */
  buildUnitPositionMap() {
    return playerKnowledgeOf(this).positions();
  }

  /**
   * Tiles other units stand on. `seenOnly` limits it to the units the player knows
   * of (previews, and a player's move before its ambush check); without it this is
   * the world, for resolving moves that have been committed.
   */
  buildOccupiedSet(excludeUnit = null, { seenOnly = false } = {}) {
    if (seenOnly) return playerKnowledgeOf(this).occupied(excludeUnit);
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

  /** A live unit the player does not know of (PlayerKnowledge.js), e.g. fog-hidden. */
  _isHiddenUnit(unit) {
    return Boolean(unit) && !playerKnowledgeOf(this).isKnown(unit);
  }

  /**
   * Cut a player's planned path where it runs into a unit hidden in the fog
   * (FogAmbush.js): an enemy, or an NPC the fog hides. Returns the path to walk,
   * its movement cost and the unit that stopped it. The plan's slides ride along so a
   * hidden unit inside a slide holds it, exactly as a seen one would (IceMovement.js).
   * `allowance` is the movement the unit has to spend (the move's MOV, or Canto's rest).
   */
  _ambushCut(unit, effective, { allowance = null } = {}) {
    const path = effective.effectivePath;
    if (unit?.faction !== 'player' || !this.grid?.fogEnabled)
      return { path, cost: effective.movementCost, ambusher: null };
    const occupant = (col, row) =>
      [...this.enemyUnits, ...this.playerUnits, ...this.npcUnits].find(
        (u) =>
          u &&
          u !== unit &&
          !u._removing &&
          u.currentHP > 0 &&
          (isEntity(u)
            ? getFootprint(u).some((t) => t.col === col && t.row === row)
            : u.col === col && u.row === row),
      ) || null;
    const knowledge = playerKnowledgeOf(this);
    const costMod = this._getCostModifier(unit);
    const cut = fogMoveCut(path, effective.slideSegments, effective.movementCost, {
      hiddenAt: (col, row) => {
        const found = occupant(col, row);
        return found && !knowledge.isKnown(found) ? found : null;
      },
      blockedAt: (col, row) => Boolean(occupant(col, row)),
      // Pass: a hidden foe on the way is walked through, as a seen one; only one on the
      // last tile (where the unit would stand) or inside an ice slide (which it holds) stops
      // the walk.
      passes: (hidden) => passesHiddenUnit(unit, hidden),
      costAt: (col, row) => this.grid.getMoveCost(col, row, unit.moveType, costMod),
      allowance,
    });
    return { path: cut.path, cost: cut.cost, ambusher: cut.ambusher };
  }

  /**
   * A move stopped by a hidden enemy: the move is locked in (no undo: it has shown
   * something), the fog lifts from where the unit stands and from the unit it ran into,
   * and the save records it. The unit may still act.
   */
  _resolveAmbush(unit, ambusher, { canto = false } = {}) {
    const session = battleSession(this);
    // The unit that stopped the move is shown for the rest of the phase, even when the cut
    // left the mover past its vision (a Pass unit backed off over occupied tiles, or one
    // that could not pay for the repriced route: FogAmbush.fogMoveCut).
    this.grid.revealContact?.(getFootprint(ambusher));
    // A hidden NPC stops the move the same way, but it is no ambush.
    const hostile = ambusher.faction === 'enemy';
    if (hostile) observeHistoryAction(this, 'was ambushed by', unit, ambusher);
    if (this._inputController) this._inputController._pendingMoveAttack = null;
    const pos = this.grid.gridToPixel(ambusher.col, ambusher.row);
    this.showMinorHintAt?.(
      pos.x,
      pos.y,
      hostile ? 'Ambush!' : 'Blocked',
      hostile ? UI_PALETTE.bad : UI_PALETTE.text,
    );
    if (canto) return; // Canto's end completes the action, which lifts the fog and saves.
    unit._movementCommitted = true;
    this.preMoveLoc = null;
    this._preFogSnapshot = null;
    this.commitVisionSnapshotIfPending?.();
    revealSettledVision(this);
    this._captureSuspendCheckpoint?.({ session: session });
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
    this._saveRetry?.update();
    if (this.dangerZone?.visible && this.dangerZoneStale) this.refreshVisibleDangerZone();
    this._pinnedThreats?.refresh();
    this._recruitBeacon?.sync();
    this._remainsCtrl?.sync();
    this._mobileBattleHud?.sync();
    this._portraitBattle?.update();
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
      width: this.grid.mapPixelWidth,
      height: this.grid.mapPixelHeight,
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
      // A prologue coach docked over the map: the map pans out from under it.
      getInsets: () => this._prologue?.coveredInsets?.() || null,
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
        // The phone battle layout owns the UI camera's band (portrait battles).
        const lab = this._mobileBattleHud?.lab;
        if (lab && !lab.destroyed) {
          lab.syncUiCamera();
          return;
        }
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
    if (this._isPrologueGateActive()) return false;
    if (this.pauseOverlay?.visible || this.unitDetailOverlay?.visible || this.visionDialog)
      return false;
    if (this.rosterOverlay?.visible) return false;
    if (this.lootSettingsOverlay || this.lootRosterVisible) return false;

    if (this._inputController?.isSelectionMenu() || this.battleState?.startsWith('SELECTING_'))
      return true;
    const allowedStates = new Set([
      'PLAYER_IDLE',
      FORMATION_STATE,
      'UNIT_SELECTED',
      'SELECTING_TARGET',
      'SHOWING_FORECAST',
      'ENEMY_PHASE',
      'COMBAT_RESOLVING',
      'HEAL_RESOLVING',
      'CANTO_MOVING',
      CANTO_CONFIRM_STATE,
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
      'SELECTING_STAFF_ALLY',
      'SELECTING_STAFF_TILE',
      'SELECTING_SHOVE_TARGET',
      'SELECTING_PULL_TARGET',
      'SELECTING_TRADE_TARGET',
      'SELECTING_SWAP_TARGET',
      'SELECTING_DANCE_TARGET',
      'SELECTING_BREAK_TARGET',
      SMASH_TARGET_STATE,
      'SELECTING_ABILITY_TILE',
      AREA_CENTER_STATE,
      'TRADING',
      'CANTO_MOVING',
      CANTO_CONFIRM_STATE,
    ];
    return cancelStates.includes(this.battleState);
  }

  /** The rail's Menu opens the pause menu whenever a turn is being planned; Back cancels. */
  canOpenPauseFromMenu() {
    // Placement too, once nothing of its own (its menu, a unit's options) is open.
    const placing =
      this.battleState === FORMATION_STATE &&
      Boolean(this._formation?.ready) &&
      !this._formation.menu &&
      !this._formation.picker;
    return Boolean(
      (placing || ['UNIT_SELECTED', 'UNIT_ACTION_MENU'].includes(this.battleState)) &&
      this.turnManager?.currentPhase !== 'enemy' &&
      !this.pauseOverlay?.visible &&
      !this.visionDialog &&
      !this.unitDetailOverlay?.visible &&
      !this.isStoryInputLocked(),
    );
  }

  canRequestCancel({ allowPause = true } = {}) {
    if (this.isStoryInputLocked()) return false;
    if (this.battleState === FORMATION_STATE && this._formation?.ready) return true;
    if (this.isDevToolsEnabled() && this.debugOverlay?.visible) return true;
    if (this.visionDialog) return true;
    if (this.unitDetailOverlay?.visible) return true;
    if (this.inspectionPanel?.visible) return true;
    if (this.isMobileInput && this.inspectMode) return true;
    if (this.pauseOverlay?.visible) return true;
    if (this.lootRosterVisible) return true;
    // Only the legacy canvas loot screen fills lootGroup; the DOM reward flow's is always [].
    if (this.battleState === 'BATTLE_END' && this.lootGroup?.length > 0 && !this.isTransitioningOut)
      return true;
    if (this.isCancelableBattleState()) return true;
    if (allowPause && this.battleState === 'PLAYER_IDLE') return true;
    return false;
  }

  requestCancel({ allowPause = true } = {}) {
    if (this.isStoryInputLocked()) return true;
    if (this._isPrologueGateActive()) {
      if (this.pauseOverlay?.visible) {
        if (!this.pauseOverlay.closeActiveSubOverlay()) this.pauseOverlay.hide();
      } else if (allowPause && this._prologue?.canPause()) {
        // Pause (and its Leave Prologue exit) stays reachable during the guided step.
        this.showPauseMenu();
      } else if (this.battleState !== 'TUTORIAL_HINT') {
        this._prologue?.rejectStep();
      }
      return true;
    }
    if (!this.canRequestCancel({ allowPause })) return false;
    if (this.battleState === FORMATION_STATE && this._formation?.ready) {
      // Placement: close the detail view or inspection first, then the tile choice;
      // with nothing to back out of, Back opens the formation menu.
      if (this.unitDetailOverlay?.visible) this.unitDetailOverlay.hide();
      else if (this.inspectionPanel?.visible) this.clearInspectionVisuals();
      else if (!this._formation.cancel() && allowPause) this._formation.openMenu();
      this.refreshEndTurnControl();
      return true;
    }
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
    } else if (
      this.battleState === 'BATTLE_END' &&
      this.lootGroup?.length > 0 &&
      !this.isTransitioningOut
    ) {
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
    const session = battleSession(this);
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    if (this.battleState === 'SHOWING_FORECAST') {
      this._attackFlow().cancelForecast();
    } else if (this.battleState === 'SELECTING_TARGET') {
      this._attackFlow().cancelTargetSelection();
    } else if (this.battleState === 'SELECTING_HEAL_TARGET') {
      this._healController?.restoreCombatWeapon(this.selectedUnit);
      this.grid.clearAttackHighlights();
      this.healTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_CURE_TARGET') {
      this.grid.clearAttackHighlights();
      this.healTargets = [];
      this._pendingCureTarget = null;
      this._pendingCureItem = null;
      this._pendingCureUser = null;
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_STAFF_ALLY') {
      this._healController?.restoreCombatWeapon(this.selectedUnit);
      this.grid.clearAttackHighlights();
      this.staffRelocateTargets = [];
      this.staffRelocateAlly = null;
      this.staffRelocateTiles = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_STAFF_TILE') {
      // Back to phase 1: re-highlight the ally choices.
      this.grid.clearAttackHighlights();
      this.staffRelocateAlly = null;
      this.staffRelocateTiles = [];
      const relocateTargets = this.staffRelocateTargets || [];
      if (relocateTargets.length > 0) {
        this.grid.showHealRange(relocateTargets.map((a) => ({ col: a.col, row: a.row })));
        this.battleState = 'SELECTING_STAFF_ALLY';
      } else {
        this._healController?.restoreCombatWeapon(this.selectedUnit);
        this.staffRelocateTargets = [];
        this.showActionMenu(this.selectedUnit);
      }
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
    } else if (this.battleState === SMASH_TARGET_STATE) {
      remainsOf(this).cancel();
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_ABILITY_TILE') {
      // Blink Strike's foe step goes back to its destination step and stays here.
      if (!this._cancelAbilityTileSelection()) this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === AREA_CENTER_STATE) {
      // Prompt → aiming → the art picker (AreaTargetingController.back).
      if (!this._areaTargeting().back()) this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'TRADING') {
      this.cleanupTradeUI();
      const tradeMutated = this.tradeMutatedThisSession;
      this.showActionMenu(this.selectedUnit);
      this.tradeMutatedThisSession = tradeMutated;
    } else if (this.battleState === CANTO_CONFIRM_STATE) {
      // Back: the Canto move is not settled yet, so the unit returns to choose again.
      this.undoCantoMove();
    } else if (this.battleState === 'CANTO_MOVING') {
      // Skip Canto -- end unit's turn
      this.grid.clearHighlights();
      this.cantoRange = null;
      this._resetCantoPreInitFaultTracking();
      const cantoUnit = this.selectedUnit;
      completeBattleAction(this, cantoUnit, { session: session });
    } else if (this.battleState === 'UNIT_ACTION_MENU') {
      if (this.inEquipMenu) {
        this.inEquipMenu = false;
        this.showActionMenu(this.selectedUnit);
      } else {
        this.hideActionMenu();
        this._clearSelectedWeaponArt();
        this.undoMove(this.selectedUnit);
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
      'SELECTING_STAFF_ALLY',
      'SELECTING_STAFF_TILE',
      'SELECTING_SHOVE_TARGET',
      'SELECTING_PULL_TARGET',
      'SELECTING_TRADE_TARGET',
      'SELECTING_SWAP_TARGET',
      'SELECTING_DANCE_TARGET',
      'SELECTING_ABILITY_TILE',
      AREA_CENTER_STATE,
      'TRADING',
      'CANTO_MOVING',
      CANTO_CONFIRM_STATE,
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
    else if (s === 'CANTO_MOVING' || s === CANTO_CONFIRM_STATE) ctx = 'battle_canto';
    else if (s === 'UNIT_ACTION_MENU') ctx = 'battle_action';
    else if (
      s === 'SELECTING_TARGET' ||
      s === 'SELECTING_HEAL_TARGET' ||
      s === 'SELECTING_STAFF_ALLY' ||
      s === 'SELECTING_STAFF_TILE'
    )
      ctx = 'battle_target';
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
      s === SMASH_TARGET_STATE ||
      s === 'SELECTING_ABILITY_TILE' ||
      s === 'TRADING'
    )
      ctx = 'battle_selected';
    // Aiming a chosen-center art: ◀ Foe ▶ (and the left panel's Cancel); once a tile is
    // locked, its Fire / Back prompt stands alone.
    else if (s === AREA_CENTER_STATE)
      ctx = this._areaTargetingController?.locked ? 'battle_area_confirm' : 'battle_area_target';
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
        this.inspectButton.setColor(this.inspectMode ? UI_PALETTE.accentText : UI_PALETTE.text);
        this.inspectButton.setInteractive({ useHandCursor: true });
      } else {
        this.inspectButton.disableInteractive();
      }
    }

    if (this.endTurnButton) {
      const enabled = this.canForceEndTurn();
      this.endTurnButton.setVisible(enabled);
      if (enabled) {
        this.endTurnButton.setColor(UI_PALETTE.text);
        this.endTurnButton.setInteractive({ useHandCursor: true });
      } else {
        this.endTurnButton.disableInteractive();
      }
    }

    if (this.cancelButton) {
      const canCancel = this.canRequestCancel({ allowPause: false });
      this.cancelButton.setVisible(canCancel);
      if (canCancel) {
        this.cancelButton.setColor(UI_PALETTE.text);
        this.cancelButton.setInteractive({ useHandCursor: true });
      } else {
        this.cancelButton.disableInteractive();
      }
    }
  }

  _onDangerClick() {
    if (canUseDanger(this)) {
      if (this.dangerZoneStale || !this.dangerZoneCache) {
        this.dangerZoneCache = this.calculateDangerZone();
        this.dangerZoneStale = false;
      }
      this.dangerZone.toggle(this.dangerZoneCache);
      if (!this.dangerZone.visible) this.keepDangerVisible = false;
      this._formation?.touch?.();
    }
  }

  togglePersistentDanger() {
    if (!canUseDanger(this)) return;
    this.keepDangerVisible = !this.keepDangerVisible;
    if (this.keepDangerVisible) {
      this.dangerZoneCache = this.calculateDangerZone();
      this.dangerZoneStale = false;
      this.dangerZone.show(this.dangerZoneCache);
    }
    this._mobileBattleHud?.sync();
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
      'SELECTING_STAFF_ALLY',
      'SELECTING_STAFF_TILE',
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
    const session = battleSession(this);
    if (this.isStoryInputLocked()) return;
    if (this._isPrologueGateActive()) {
      if (this.battleState !== 'TUTORIAL_HINT') this._prologue?.rejectStep();
      return;
    }
    if (!this.canForceEndTurn()) return;
    if (this.battleState === 'PLAYER_IDLE') this._visionController?.settleParkedActivation?.();
    const cantoUnit =
      this.battleState === 'CANTO_MOVING' || this.battleState === CANTO_CONFIRM_STATE
        ? this.selectedUnit
        : null;
    // End Turn over a Canto confirm settles the move where the unit stands.
    if (this.battleState === CANTO_CONFIRM_STATE) this._recordPendingCantoPath();
    this._cantoPending = null;
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
    this.staffRelocateTargets = [];
    this.staffRelocateAlly = null;
    this.staffRelocateTiles = [];
    this.shoveTargets = [];
    this.pullTargets = [];
    this.tradeTargets = [];
    this.swapTargets = [];
    this.danceTargets = [];
    this._areaTargetingController?.clear();
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
    // Lock the end-of-turn state before handing off to the enemy phase — a
    // refresh during the enemy turn resumes here and replays it on the same
    // RNG stream.
    this._timelineFacts = [...(this._timelineFacts || []), 'End Turn. Enemies act next.'];
    this._timelineBoundary = 'player_action';
    if (cantoUnit) {
      // End Turn also skips a pending Canto. Settle its village/save obligations
      // once; all units are acted, so unitActed performs the phase transition.
      completeBattleAction(this, cantoUnit, { session: session });
    } else {
      // A moved unit that never acted ends its turn where it stands: reveal now.
      revealSettledVision(this);
      this._captureSuspendCheckpoint?.({ session: session });
      this.turnManager.endPlayerPhase();
    }
    this.refreshEndTurnControl();
  }

  showPauseMenu({ onResume = null, fromRewards = false } = {}) {
    const session = battleSession(this);
    const abandonPayout = this.runManager?.previewEndRunRewards?.();
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
        // Blocked-retry absorbs transient cooldown/in-flight locks so the
        // callers' hard fallback (lock reset + raw scene.start) only fires on
        // genuine failures.
        result = await Promise.race([
          transitionToSceneWithBlockedRetry(this, 'Title', { gameData: this.gameData }, { reason }),
          timeoutPromise,
        ]);
        if (!isCurrentBattleSession(this, session)) return;
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
      return result?.status === TRANSITION_RESULTS.STARTED;
    };
    // The prologue run is left by skipping the rest of it, never abandoned (§9).
    const abandonCb =
      this.runManager && !isPrologueRun(this.runManager)
        ? async () => {
            try {
              const cloud = this.registry.get('cloud');
              const slot = this.registry.get('activeSlot');
              this.clearBattleScopedDeltas(this.playerUnits);
              this.clearBattleScopedDeltas(this.nonDeployedUnits || []);
              // Settle (and persist the settled record) before dropping the
              // save, so the rewards are never lost with it nor paid twice.
              this.runManager.failRun();
              settleAndPersistEndRun(this.runManager, this.registry.get('meta'), 'defeat', {
                onSave: cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null,
                slot,
              });
              // A payout that did not reach disk keeps the save so it can retry.
              if (!endRunPayoutPending(this.runManager, this.registry.get('meta')))
                clearSavedRun(
                  cloud
                    ? (resolvedSlot, abandonedRun) =>
                        deleteRunSave(cloud.userId, resolvedSlot, abandonedRun)
                    : null,
                  slot,
                );
              const audio = this.registry.get('audio');
              if (audio) audio.stopMusic(this, 0);
              const ok = await transitionToTitleWithWatchdog(TRANSITION_REASONS.ABANDON_RUN);
              if (!isCurrentBattleSession(this, session)) return;
              if (!ok) {
                if (this.sys?.isActive?.() === false) {
                  // Scene already shut down -- another transition won the race;
                  // a raw start from a dead scene would stomp the live one.
                  markStartup('pause_transition_superseded', {
                    scene: 'Battle',
                    reason: 'ABANDON_RUN',
                  });
                  return;
                }
                markStartup('pause_transition_fallback', {
                  scene: 'Battle',
                  reason: 'ABANDON_RUN',
                });
                resetTransitionLocks(this);
                try {
                  this.scene.start('Title', { gameData: this.gameData }); // scene-router-bypass
                } catch (err) {
                  if (!isCurrentBattleSession(this, session)) return;
                  markStartup('pause_transition_double_failure', {
                    scene: 'Battle',
                    reason: 'ABANDON_RUN',
                  });
                  this.showPauseTransitionRecovery(TRANSITION_REASONS.ABANDON_RUN);
                }
              }
            } catch (err) {
              if (!isCurrentBattleSession(this, session)) return;
              reportAsyncError('Battle-pause-abandon', err);
              this.showPauseTransitionRecovery(TRANSITION_REASONS.ABANDON_RUN);
            }
          }
        : null;
    const saveExitCb = this.runManager
      ? async () => {
          try {
            const terminal = () =>
              this.battleState === 'BATTLE_END' ||
              this._fatalDecision ||
              this._fatalCapturePending ||
              this._defeatDecision;
            if (!isCurrentBattleSession(this, session) || terminal()) return;
            if (this._saveRetry) {
              const durable = await this._saveRetry.ensureDurableForExit({ session });
              if (!isCurrentBattleSession(this, session) || terminal()) return;
              if (!durable) {
                this.battleState = this.prePauseState || 'PLAYER_IDLE';
                this.pauseOverlay = null;
                this.refreshEndTurnControl();
                onResume?.();
                return;
              }
            }
            // Return to title -- the suspend checkpoint is already persisted,
            // so Continue will offer Resume Battle / Continue from Map.
            this.clearBattleScopedDeltas(this.playerUnits);
            this.clearBattleScopedDeltas(this.nonDeployedUnits || []);
            const audio = this.registry.get('audio');
            if (audio) audio.stopMusic(this, 0);
            const ok = await transitionToTitleWithWatchdog(TRANSITION_REASONS.SAVE_EXIT);
            if (!isCurrentBattleSession(this, session)) return;
            if (!ok) {
              if (this.sys?.isActive?.() === false) {
                // Scene already shut down -- another transition won the race;
                // a raw start from a dead scene would stomp the live one.
                markStartup('pause_transition_superseded', {
                  scene: 'Battle',
                  reason: 'SAVE_EXIT',
                });
                return;
              }
              markStartup('pause_transition_fallback', { scene: 'Battle', reason: 'SAVE_EXIT' });
              resetTransitionLocks(this);
              try {
                this.scene.start('Title', { gameData: this.gameData }); // scene-router-bypass
              } catch (err) {
                if (!isCurrentBattleSession(this, session)) return;
                markStartup('pause_transition_double_failure', {
                  scene: 'Battle',
                  reason: 'SAVE_EXIT',
                });
                this.showPauseTransitionRecovery(TRANSITION_REASONS.SAVE_EXIT);
              }
            }
          } catch (err) {
            if (!isCurrentBattleSession(this, session)) return;
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
    // Before turn 1 nothing is saved but the entry: leaving goes back to the map.
    const placing = this.prePauseState === FORMATION_STATE;
    const backToMap =
      placing && this._formation?.canReturnToMap() ? () => this._formation.returnToMap() : null;
    this.pauseOverlay = new PauseOverlay(this, {
      burdens: pauseBurdenEntries(this.runManager, this.gameData?.events),
      blessings: heldBlessingEntries(this.runManager),
      onAbandonWarning: abandonPayout
        ? `Abandon this run?\nKeep ${abandonPayout.valor} Valor and ${abandonPayout.supply} Supply. This run and its gold, items and route progress will end.`
        : null,
      onResume: () => {
        this.battleState = this.prePauseState || 'PLAYER_IDLE';
        this.pauseOverlay = null;
        this.refreshEndTurnControl();
        onResume?.();
      },
      onSaveAndExit: saveExitCb,
      onSaveAndExitWarning: this._saveRetry?.isUnsaved()
        ? 'Not saved yet. Exit tries to save it.'
        : fromRewards
          ? 'Your battle and remaining rewards are saved. Resume returns to the map, where you can reopen rewards.'
          : backToMap
            ? 'The battle has not started. Resume on the Title screen returns to the map; this battle waits there.'
            : 'Battle suspended. Choose Resume on the Title screen to pick up where you left off.',
      onBackToMap: backToMap,
      onAbandon: abandonCb,
      campaignMapData,
      gameData: this.gameData,
      prologue: this._prologue?.pauseOptions() || null,
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
    // Blink Strike's forecast: Confirm settles the warp and the attack as one action.
    if (this._warpStrike) {
      this._warpStrikeFlow().confirm();
      return;
    }
    const unit = this.selectedUnit;
    // The forecast only planned this weapon; confirming is the one place it is equipped.
    const planned = this._forecastWeapon || unit.weapon;
    // Final legality guard: silenced units cannot confirm with a magic weapon
    if (
      isSilenced(unit) &&
      planned &&
      (planned.type === 'Tome' ||
        planned.type === 'Light' ||
        planned.type === 'Staff' ||
        planned.type === 'Breath')
    ) {
      this.hideForecast({ acknowledge: true });
      this.showActionMenu(unit);
      return;
    }
    // equipWeapon fails silently: without this the attack would go ahead with
    // the old weapon if the planned one left the bag or became unusable.
    if (
      planned &&
      planned !== unit.weapon &&
      (!unit.inventory?.includes(planned) || !canEquip(unit, planned))
    ) {
      this.hideForecast({ acknowledge: true });
      this.showActionMenu(unit);
      return;
    }
    const target = this.forecastTarget;
    // Resolve the art by its pre-equip index, then re-set it with the new one.
    const artEntry =
      this._selectedWeaponArt?.unitName === unit.name
        ? this._resolveSelectedWeaponArtEntry(unit)
        : null;
    // The confirmed weapon becomes the equipped weapon and moves to the top.
    if (planned && planned !== unit.weapon) equipWeapon(unit, planned);
    else normalizeEquippedFirst(unit);
    if (artEntry) this._setSelectedWeaponArt(unit, artEntry.art.id, artEntry.weapon);
    this.commitVisionSnapshotIfPending();
    this.hideForecast({ acknowledge: true });
    this.executeCombat(unit, target);
  }

  // --- Unit selection & movement ---

  selectUnit(unit) {
    if (this.battleState === 'TURN_START_RESOLVING') return;
    // A set-aside partial action (e.g. trade) becomes its own rewind point.
    if (this.battleState === 'PLAYER_IDLE') this._visionController?.settleParkedActivation?.();
    if (this._prologue && !this._prologue.allowsSelect(unit)) {
      this._prologue.rejectSelect();
      return;
    }
    if (this.unitDetailOverlay?.visible) this.unitDetailOverlay.hide();
    this.inspectionPanel.hide();
    if (!this.keepDangerVisible) this.dangerZone.hide();
    this._clearCombatRollSession();
    this._clearSelectedWeaponArt();
    this.selectedUnit = unit;
    if (unit._movementCommitted) {
      this.preMoveLoc = null;
      this._preFogSnapshot = null;
      this.movementRange = null;
      this.grid.clearHighlights();
      this.showActionMenu(unit);
      return;
    }
    this.battleState = 'UNIT_SELECTED';

    if (unit.graphic.setTint) {
      unit.graphic.setTint(0xaaaaff);
    }

    this.unitPositions = this.buildUnitPositionMap();
    this.movementRange = this.grid.getMovementRange(
      unit.col,
      unit.row,
      isRooted(unit) ? 0 : unit.mov,
      unit.moveType,
      this.unitPositions,
      unit.faction,
      this._getCostModifier(unit),
      movementOptionsFor(unit),
    );
    this.grid.showMovementRange(this.movementRange, unit.col, unit.row);
    this._gridCursor?.snapTo(unit.col, unit.row);

    this._prologue?.onUnitSelected(unit);
  }

  deselectUnit() {
    this._inputController?.clearPlanningInspection();
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
    const session = battleSession(this);
    discardHistoryPath(this, unit);
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
      this._cantoPending = null;
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
    this._cantoPending = null;
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
      // A failed Canto animation still commits its final gameplay location.
      // Visual recovery was attempted above; do not repeat a broken dim call.
      completeBattleAction(this, unit, { skipDim: true, session: session });
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
          movementOptionsFor(unit),
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
      const occupied = this.buildOccupiedSet(unit, { seenOnly: unit.faction === 'player' });
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
    if (!effective.effectivePath || effective.effectivePath.length < 2) {
      console.warn('[moveUnit] effectivePath returned null/short path', {
        from,
        to,
      });
      this.deselectUnit();
      return;
    }
    // A hidden enemy on the way stops the move short (it may not move at all).
    const ambush = this._ambushCut(unit, effective, {
      allowance: isRooted(unit) ? 0 : unit.mov,
    });
    const finalPath = ambush.path;
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
      if (finalPath.length > 1) rememberHistoryPath(this, unit, finalPath);
      unit.col = finalDest.col;
      unit.row = finalDest.row;
      unit.hasMoved = true;
      try {
        this.updateUnitPosition(unit);
        if (ambush.ambusher) this._resolveAmbush(unit, ambush.ambusher);
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
      unit._movementSpent = ambush.cost;

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
    const session = battleSession(this);
    // No fog update here: the move can still be undone, so its vision waits until
    // the unit's action is committed (revealSettledVision).
    if (this._prologue) {
      // A chapter's note about the arrived tile reads before the action menu opens.
      await this._prologue.onAfterMove(unit);
      if (!isCurrentBattleSession(this, session)) return;
      if (!this.scene?.isActive?.()) return;
    }
    this.showActionMenu(unit);
    this._inputController?.resumeMoveAttack(unit);
    this._inputController?.refreshHoverInfo();
  }

  _getCombatRangeForUnitWeapon(unit, weapon, weaponArt = null) {
    return getAttackRange(unit, weapon, { skillsData: this.gameData?.skills, weaponArt });
  }

  _isDistanceInWeaponRange(unit, weapon, distance, weaponArt = null) {
    const range = this._getCombatRangeForUnitWeapon(unit, weapon, weaponArt);
    return distance >= range.min && distance <= range.max;
  }

  /**
   * Enemies attackable from the unit's tile: the union over every usable weapon
   * (proficiency, silence, per-battle uses — AttackOptions.getAttackWeapons), or
   * only `options.weapon` (+ its art) for a weapon-art attack.
   */
  findAttackTargets(unit, options = {}) {
    const targets = [];
    const selectedWeapon = options.weapon || null;
    const selectedArt = options.weaponArt || null;
    let combatWeapons = selectedWeapon ? [selectedWeapon] : getAttackWeapons(unit);
    // Silenced units cannot attack with magic weapons
    if (isSilenced(unit)) {
      combatWeapons = combatWeapons.filter((w) => !isSilenceBlockedWeapon(w));
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

  finishUnitAction(unit, { skipCanto = false, session } = {}) {
    if (!isCurrentBattleSession(this, session)) return false;
    // Level-up cards and EXP gauges still to show (gauges alone present too; only the
    // cards make the boundary a recovery).
    if (
      (this._pendingLevelUpPopups?.length || this._pendingXpGauges?.length) &&
      this.turnManager?.currentPhase !== 'enemy'
    ) {
      this.battleState = 'COMBAT_RESOLVING';
      const continuation = {
        kind: 'finish',
        unitName: unit.name,
        ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
        skipCanto,
      };
      return presentQueuedProgress(this, continuation, { session })
        .then(() => {
          if (!isCurrentBattleSession(this, session)) return;
          completeResolvedAction(this, continuation, { session });
        })
        .catch((error) => {
          if (!isCurrentBattleSession(this, session)) return;
          this._recoverUnitActionError(unit, 'level-up presentation', error, { session });
        });
    }
    this._pendingActionCompletion = null;
    this.commitVisionSnapshotIfPending();
    this._clearCombatRollSession();
    safeBattlePresentation('action menu cleanup', () => this.hideActionMenu(), { scene: this });
    safeBattlePresentation('action highlights', () => this.grid.clearAttackHighlights(), {
      scene: this,
    });
    this.attackTargets = [];
    this.healTargets = [];
    this.staffRelocateTargets = [];
    this.staffRelocateAlly = null;
    this.staffRelocateTiles = [];
    this.inEquipMenu = false;
    this.tradeMutatedThisSession = false;
    this._clearSelectedWeaponArt();

    // Check for Canto: use remaining movement after acting
    if (!skipCanto) {
      // Rooted units cannot use Canto (root may land mid-action via counter-art)
      const hasCanto = Boolean(cantoRuleFor(unit));
      const movSpent = unit._movementSpent || 0;
      // The same MOV the unit's move range read (selectUnit), less the terrain cost spent.
      const remaining = (Number(unit.mov ?? unit.stats?.MOV) || 0) - movSpent;
      if (hasCanto && remaining > 0 && unit.faction === 'player') {
        unit.hasActed = true;
        this.selectedUnit = unit;
        this.preMoveLoc = null;
        this._preFogSnapshot = null;
        // The turn isn't over: the fog lifts where Canto ends (completeBattleAction),
        // with the suspend save that records it.
        this.startCantoMove(unit, remaining);
        return;
      }
    }

    // A prologue chapter's note on this action reads before the action completes (and
    // before the turn can pass to the enemy).
    const hold = this._prologue?.beforeUnitActionCompletes(unit);
    if (hold) {
      hold.then(
        () => completeBattleAction(this, unit, { session }),
        () => completeBattleAction(this, unit, { session }),
      );
      return;
    }
    completeBattleAction(this, unit, { session });
  }

  /**
   * Recover from an unexpected error inside a unit-action flow (talk, heal,
   * promotion, …). Consumes the unit's action if it hasn't been consumed yet so
   * a thrown blocking state ('COMBAT_RESOLVING'/'HEAL_RESOLVING') can't softlock
   * the battle.
   */
  _recoverUnitActionError(unit, label, err, { session } = {}) {
    if (!isCurrentBattleSession(this, session)) return false;
    console.error(`[BattleScene] ${label} error:`, err);
    if (this.battleState === 'BATTLE_END') return;
    try {
      if (unit && !unit.hasActed) {
        return this.finishUnitAction(unit, { skipCanto: true, session: session });
      }
    } catch (recoveryErr) {
      console.error(`[BattleScene] ${label} recovery error:`, recoveryErr);
    }
    // Only force PLAYER_IDLE while the player phase is still running. The
    // finishUnitAction above (or the throwing flow itself) may have ended the
    // player phase before the error surfaced; stomping ENEMY_PHASE here would
    // re-enable player input mid-enemy-turn.
    if (
      this.battleState !== 'BATTLE_END' &&
      this.battleState !== 'PLAYER_IDLE' &&
      this.turnManager?.currentPhase !== 'enemy'
    ) {
      this.battleState = 'PLAYER_IDLE';
      this.selectedUnit = null;
      try {
        this.grid?.clearHighlights?.();
        this.grid?.clearAttackHighlights?.();
      } catch (_) {
        /* best-effort visual */
      }
    }
  }

  // --- Shove / Pull / Canto ---

  /**
   * Allies the unit can Shove, each with where it would end as the player knows the
   * board: one tile on, then on across any Ice it lands on (engine/ForcedMovement.js).
   */
  findShoveTargets(unit) {
    return shoveTargetsOf(unit, {
      ...forcedMoveProbes(this).preview,
      allies: this.playerUnits,
    });
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
      if (this._seenTileOccupant(retreatC, retreatR)) continue;
      targets.push({ ally, retreatCol: retreatC, retreatRow: retreatR, dc, dr });
    }
    return targets;
  }

  /** Taken as far as the player knows: a unit stands there, or fog hides the tile. */
  _seenTileOccupant(col, row) {
    return seenTileOccupant(this.grid, (c, r) => this.getUnitAt(c, r))(col, row);
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
      // Give into a free slot or swap: two full bags can still trade.
      if (ally && canTradeBetween(unit, ally)) targets.push({ ally });
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

  /** Allies Dance can refresh: the rule is engine-side (Goddess Dance reads it too). */
  findDanceTargets(unit) {
    return findDanceRefreshTargets(unit, this.playerUnits).map((ally) => ({ ally }));
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
    const session = battleSession(this);
    return (this._movementActions ||= new MovementActionController(this)).executeMove(
      'shove',
      unit,
      target,
      { session },
    );
  }

  executePull(unit, target) {
    const session = battleSession(this);
    return (this._movementActions ||= new MovementActionController(this)).executeMove(
      'pull',
      unit,
      target,
      { session },
    );
  }

  startBreakTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_BREAK_TARGET';
    this.breakTargets = this.findBreakTargets(unit);
    const tiles = this.breakTargets.map((t) => ({ col: t.col, row: t.row }));
    this.grid.showAttackRange(tiles, UI_HEX.warn, 0.45);
  }

  handleBreakTargetClick(gp) {
    const target = this.breakTargets?.find((t) => t.col === gp.col && t.row === gp.row);
    if (!target) return;
    this.grid.clearAttackHighlights();
    this.executeBreak(this.selectedUnit, target);
  }

  /** Smash: a tap on highlighted remains (ZombieRemainsController). */
  handleRemainsTargetClick(gp) {
    return remainsOf(this).handleClick(gp);
  }

  executeBreak(unit, target) {
    const session = battleSession(this);
    this.hideActionMenu();
    const removed = this.grid.clearTemporaryTerrainAt?.(target.col, target.row);
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_hit');
    if (removed) {
      observeHistoryAction(
        this,
        'broke terrain',
        unit,
        null,
        `column ${target.col + 1}, row ${target.row + 1}`,
      );
      const pos = this.grid.gridToPixel(target.col, target.row);
      this.showMinorHintAt(pos.x, pos.y, 'Break!', UI_PALETTE.accentText);
    }
    this.finishUnitAction(unit, { skipCanto: true, session: session });
  }

  startTradeTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_TRADE_TARGET';
    this.tradeTargets = this.findTradeTargets(unit);
    const tiles = this.tradeTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, UI_HEX.hpHigh, 0.4);
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
    if (hasDOMHost()) {
      this.battleTradeMenu = new BattleTradeMenu(this, unitA, unitB);
      return;
    }

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
        color: UI_PALETTE.accentText,
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
        color: UI_PALETTE.text,
      })
      .setOrigin(0.5)
      .setDepth(401);
    const rightName = this.add
      .text(480, 60, unitB.name, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: UI_PALETTE.text,
      })
      .setOrigin(0.5)
      .setDepth(401);
    const leftCounts = this.add
      .text(
        160,
        76,
        `Inventory ${(unitA.inventory || []).length}/${INVENTORY_MAX} | Consumables ${(unitA.consumables || []).length}/${CONSUMABLE_MAX}`,
        { fontFamily: 'monospace', fontSize: '10px', color: UI_PALETTE.muted },
      )
      .setOrigin(0.5)
      .setDepth(401);
    const rightCounts = this.add
      .text(
        480,
        76,
        `Inventory ${(unitB.inventory || []).length}/${INVENTORY_MAX} | Consumables ${(unitB.consumables || []).length}/${CONSUMABLE_MAX}`,
        { fontFamily: 'monospace', fontSize: '10px', color: UI_PALETTE.muted },
      )
      .setOrigin(0.5)
      .setDepth(401);
    this.tradeUIObjects.push(leftName, rightName, leftCounts, rightCounts);

    // Give-only rows (headless fallback); the write is the controller's.
    const giveCanvasItem = (giver, receiver, bag, item) => {
      const result = battleTradeController(this).commit(
        unitA,
        unitB,
        { holder: unitHolder(giver), bag, item },
        { holder: unitHolder(receiver), bag, item: null },
      );
      if (!result.ok) return;
      this.cleanupTradeUI();
      this.showBattleTradeUI(unitA, unitB);
    };

    // Two-column item lists (weapons + consumables)
    let yOffset = 90;
    const drawItems = (unit, x, otherUnit) => {
      const inventory = inventoryDisplayOrder(unit);
      const consumables = unit.consumables || [];

      // Weapons
      inventory.forEach((item, i) => {
        const hasCapacity = (otherUnit.inventory?.length || 0) < INVENTORY_MAX;
        const noProf = !hasProficiency(otherUnit, item);
        const suffix = noProf ? ` (${otherUnit.name} cannot equip)` : '';
        const color = hasCapacity
          ? noProf
            ? UI_PALETTE.warn
            : UI_PALETTE.text
          : UI_PALETTE.lineStrong;
        const btn = this.add
          .text(
            x,
            yOffset + i * 20,
            `${item === unit.weapon ? EQUIPPED_MARKER : ''}${item.name}${suffix}`,
            {
              fontFamily: 'monospace',
              fontSize: '11px',
              color,
              backgroundColor: UI_PALETTE.panel,
              padding: { x: 6, y: 2 },
            },
          )
          .setOrigin(0.5)
          .setDepth(401);

        if (hasCapacity) {
          btn.setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor(UI_PALETTE.accentText));
          btn.on('pointerout', () => btn.setColor(color));
          btn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            giveCanvasItem(unit, otherUnit, 'inventory', item);
          });
        }
        this.tradeUIObjects.push(btn);
      });

      // Consumables (below weapons)
      const consumableOffset = inventory.length * 20;
      consumables.forEach((item, i) => {
        const hasCapacity = (otherUnit.consumables?.length || 0) < CONSUMABLE_MAX;
        const color = hasCapacity ? UI_PALETTE.info : UI_PALETTE.lineStrong;
        const suffix = hasCapacity ? '' : ' (consumables full)';
        const btn = this.add
          .text(x, yOffset + consumableOffset + i * 20, `${item.name}${suffix}`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color,
            backgroundColor: UI_PALETTE.panel,
            padding: { x: 6, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(401);

        if (hasCapacity) {
          btn.setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor(UI_PALETTE.accentText));
          btn.on('pointerout', () => btn.setColor(color));
          btn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            giveCanvasItem(unit, otherUnit, 'consumables', item);
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
        color: UI_PALETTE.text,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 16, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(401)
      .setInteractive({ useHandCursor: true });
    doneBtn.on('pointerover', () => doneBtn.setColor(UI_PALETTE.accentText));
    doneBtn.on('pointerout', () => doneBtn.setColor(UI_PALETTE.text));
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
    this.battleTradeMenu?.destroy();
    this.battleTradeMenu = null;
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
    this.grid.showAttackRange(tiles, UI_HEX.hpHigh, 0.4);
  }

  executeSwap(unit, target) {
    const session = battleSession(this);
    return (this._movementActions ||= new MovementActionController(this)).executeMove(
      'swap',
      unit,
      target,
      { session },
    );
  }

  startDanceTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_DANCE_TARGET';
    this.danceTargets = this.findDanceTargets(unit);
    const tiles = this.danceTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, UI_HEX.hpHigh, 0.4);
  }

  executeDance(unit, target) {
    const session = battleSession(this);
    return (this._movementActions ||= new MovementActionController(this)).executeDance(
      unit,
      target,
      { session },
    );
  }

  startShoveTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_SHOVE_TARGET';
    this.shoveTargets = this.findShoveTargets(unit);
    const tiles = this.shoveTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, UI_HEX.hpHigh, 0.4);
  }

  startPullTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_PULL_TARGET';
    this.pullTargets = this.findPullTargets(unit);
    const tiles = this.pullTargets.map((t) => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, UI_HEX.hpHigh, 0.4);
  }

  startCantoMove(unit, remainingMov) {
    this._resetCantoPreInitFaultTracking();
    this.battleState = 'CANTO_MOVING';
    this._cantoPending = null;
    this._cantoRemaining = remainingMov;
    this._lastPathPreviewKey = null;
    const positions = this.buildUnitPositionMap();
    const moveRange = this.grid.getMovementRange(
      unit.col,
      unit.row,
      remainingMov,
      unit.moveType,
      positions,
      unit.faction,
      this._getCostModifier(unit),
      movementOptionsFor(unit),
    );
    this.cantoRange = moveRange;
    safeBattlePresentation(
      'Canto range',
      () => this.grid.showMovementRange(moveRange, unit.col, unit.row, 0x44aaff, 0.3),
      { scene: this },
    );
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
    const session = battleSession(this);
    const unit = this.selectedUnit;
    // Click own tile or W key = skip Canto
    if (gp.col === unit.col && gp.row === unit.row) {
      this.grid.clearHighlights();
      this.cantoRange = null;
      this._resetCantoPreInitFaultTracking();
      completeBattleAction(this, unit, { session: session });
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
        const positions = this.buildUnitPositionMap();
        path = this.grid.findPath(
          unit.col,
          unit.row,
          gp.col,
          gp.row,
          unit.moveType,
          positions,
          unit.faction,
          this._getCostModifier(unit),
          movementOptionsFor(unit),
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
    const cantoOccupied = this.buildOccupiedSet(unit, { seenOnly: unit.faction === 'player' });
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
    if (!cantoEffective.effectivePath || cantoEffective.effectivePath.length < 2) {
      console.warn('[handleCantoClick] effectivePath returned null/short path', { from, to });
      return;
    }
    const cantoAmbush = this._ambushCut(unit, cantoEffective, {
      allowance: this._cantoRemaining,
    });
    const cantoFinalPath = cantoAmbush.path;
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
    const cantoOrigin = { col: unit.col, row: unit.row };
    const cantoRangeAtOrigin = this.cantoRange;
    const finalizeCantoMove = () => {
      if (finalizeTriggered || recoveryTriggered) return;
      finalizeTriggered = true;
      unit.col = destCol;
      unit.row = destRow;
      try {
        this.updateUnitPosition(unit);
        this.cantoRange = null;
        this._resetCantoPreInitFaultTracking();
        if (cantoAmbush.ambusher) {
          // A hidden unit stopped the move: it has shown something, so it is locked in.
          if (cantoFinalPath.length > 1) rememberHistoryPath(this, unit, cantoFinalPath, false);
          this._resolveAmbush(unit, cantoAmbush.ambusher, { canto: true });
          // Canto's end is the turn's end: completeBattleAction lifts the fog here.
          completeBattleAction(this, unit, { session: session });
          return;
        }
        // Nothing is settled yet: Wait ends the turn here, Back returns to the choice
        // (playtest Sep 2026: a mis-tapped Canto tile cost a rewind).
        this._cantoPending = {
          unit,
          origin: cantoOrigin,
          remaining: this._cantoRemaining,
          range: cantoRangeAtOrigin,
          path: cantoFinalPath,
        };
        this.showCantoConfirmMenu(unit);
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
      this.grid.clearPath?.();
      this._lastPathPreviewKey = null;
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

  /**
   * After a Canto move: the unit stands on its new tile, but nothing is settled (no
   * fog lifted, no village visited, no save). Wait ends its turn there; Back returns it
   * to where the Canto began, to choose again.
   */
  showCantoConfirmMenu(unit) {
    this.hideActionMenu();
    this.battleState = CANTO_CONFIRM_STATE;
    this.actionMenu = [];
    const rows = [
      menuRow({
        id: 'wait',
        label: 'Wait',
        note: this._villageController?.getWaitNote(unit) || null,
        color: UI_PALETTE.text,
        invoke: () => {
          this.registry.get('audio')?.playSFX('sfx_confirm');
          this.confirmCantoMove();
        },
      }),
    ];
    if (!railOwnsMenus(this)) this._drawActionMenuRows(unit, rows);
    this._registerActionMenu(rows, { state: CANTO_CONFIRM_STATE });
    this._threatSight?.sync(true);
    this._inputController?.refreshHoverInfo();
    this.refreshEndTurnControl?.();
  }

  _recordPendingCantoPath() {
    const pending = this._cantoPending;
    if (pending?.path?.length > 1) rememberHistoryPath(this, pending.unit, pending.path, false);
  }

  /** Wait after a Canto move: the unit's turn ends where it stands. */
  confirmCantoMove() {
    const session = battleSession(this);
    const unit = this.selectedUnit;
    if (this.battleState !== CANTO_CONFIRM_STATE || !unit) return;
    this.hideActionMenu();
    this.grid.clearHighlights();
    this.grid.clearPath?.();
    this._recordPendingCantoPath();
    this._cantoPending = null;
    try {
      completeBattleAction(this, unit, { session: session });
    } catch (err) {
      // Same fail-closed path as a broken Canto animation: settle where it stands.
      this._recoverFromMovementFault(unit, {
        context: 'confirmCantoMove',
        reason: 'Error while confirming canto move',
        error: err,
      });
    }
    this.refreshEndTurnControl?.();
  }

  /** Back after a Canto move: return to the tile the Canto began on and choose again. */
  undoCantoMove() {
    const pending = this._cantoPending;
    const unit = this.selectedUnit;
    if (this.battleState !== CANTO_CONFIRM_STATE || !unit || pending?.unit !== unit) return;
    this.hideActionMenu();
    this._cantoPending = null;
    unit.col = pending.origin.col;
    unit.row = pending.origin.row;
    try {
      this.updateUnitPosition(unit);
    } catch (err) {
      // Visuals only: the unit is back on its tile, so the choice still reopens.
      console.error('[undoCantoMove] failed to sync unit position visuals', err);
    }
    this.startCantoMove(unit, pending.remaining);
    this._threatSight?.sync(true);
    this._inputController?.refreshHoverInfo();
  }

  /**
   * A tap during the Canto confirm: the unit's own tile is Wait; another tile the
   * Canto could reach moves there instead (still to be confirmed).
   */
  handleCantoConfirmClick(gp) {
    const unit = this.selectedUnit;
    const pending = this._cantoPending;
    if (!unit || !pending) return;
    if (gp.col === unit.col && gp.row === unit.row) {
      this.confirmCantoMove();
      return;
    }
    const entry = pending.range?.get(`${gp.col},${gp.row}`);
    if (!entry || entry.stoppable === false) return;
    const atOrigin = gp.col === pending.origin.col && gp.row === pending.origin.row;
    this.undoCantoMove();
    // Back on the Canto's first tile: the choice is open again (a tap there skips).
    if (!atOrigin && this.battleState === 'CANTO_MOVING') this.handleCantoClick(gp);
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
      hoverColor = UI_PALETTE.accentText,
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
    // Expose the activation callback so controller/keyboard menu focus can invoke
    // the same action the pointer does, without a synthetic pointer event.
    text._action = onClick;
    text._menuColor = defaultColor;
    text._menuDisabled = Boolean(options.disabled);
    if (text._menuDisabled) text.disableInteractive();
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

  _showWeaponDetailTooltip(wpn, menuRect, itemY, unit = null) {
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
    // Attack speed with this weapon, and the change from the one held (equip menu).
    const speed = weaponAttackSpeed(wpn, unit);
    const delta = attackSpeedDelta(speed);
    const as = speed ? ` ${attackSpeedValue(speed.as)}AS${delta ? ` (${delta})` : ''}` : '';
    lines.push(`${weight}Wt Rng${range}${as}`);
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
        color: UI_PALETTE.text,
        wordWrap: { width: maxWidth - padding * 2 },
      })
      .setDepth(450);
    const bg = this.add
      .rectangle(0, 0, txt.width + padding * 2, txt.height + padding * 2, UI_HEX.panel, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, UI_HEX.line)
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

  _reduceMotion() {
    const settings = this.registry?.get?.('settings');
    return !!settings?.getReduceMotion?.();
  }

  _effectsQuality() {
    return this.registry?.get?.('settings')?.getEffectsQuality?.() ?? 'high';
  }

  showActionMenu(unit) {
    const session = battleSession(this);
    // Back at the menu, any chosen weapon art is dropped (the attack is re-planned).
    this._clearSelectedWeaponArt();
    this.hideActionMenu();
    this.inEquipMenu = false;
    this.tradeMutatedThisSession = unit._movementCommitted === true;
    this.battleState = 'UNIT_ACTION_MENU';

    const normalAttackTargets = this.findAttackTargets(unit);
    const usableStaves = this.getUsableStaves(unit);
    const healOptions = usableStaves
      .map((staff) => ({ staff, targets: this.findHealTargets(unit, staff) }))
      .filter((option) => option.targets.length > 0);
    const preferredHealOption =
      healOptions.find((option) => option.staff === unit.weapon) || healOptions[0] || null;

    this.actionMenu = [];

    // The menu as rows (battleMenuModel): each command has a stable id, and the
    // desktop canvas and the phone rail render the same rows.
    const commands = [];
    const blockedActions = new Map(); // command id → why it is greyed
    const command = (id, label, run) => commands.push({ id, label, run });
    const offered = (id) => commands.some((entry) => entry.id === id);
    const attack = () => {
      // Target first: the weapon is chosen in the forecast.
      this._attackFlow().begin(unit);
    };
    // Nothing is equipped here, not even over a staff: an art attack equips its
    // weapon on confirm, like any forecast weapon.
    const weaponArt = () => this.showWeaponArtPicker(unit);
    const staff = () => {
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
    };
    const silenced = isSilenced(unit);
    // Silence blocks Attack if unit only has magic weapons (Tome/Light)
    if (normalAttackTargets.length > 0) {
      const combatWeapons = getCombatWeapons(unit);
      const hasPhysical = combatWeapons.some(
        (w) => w.type !== 'Tome' && w.type !== 'Light' && w.type !== 'Staff' && w.type !== 'Breath',
      );
      if (!silenced || hasPhysical) command('attack', 'Attack', attack);
    }
    // Guidance (Full): a greyed Attack row says why it is missing instead of hiding it.
    // An unarmed fighter gets its own reason (Full Guidance): nothing to attack with.
    const noReachReason = silenced
      ? null
      : this._guidance?.noTargetAttackReason?.(unit, normalAttackTargets) ||
        this._guidance?.unarmedAttackReason?.(unit) ||
        null;
    if (noReachReason && !offered('attack')) {
      command('attack', 'Attack', attack);
      blockedActions.set('attack', noReachReason);
    }
    const artWeapon =
      unit.weapon && !isStaff(unit.weapon) ? unit.weapon : getCombatWeapons(unit)[0];
    // Silence blocks weapon arts
    if (!silenced && this._hasUsableWeaponArtTargets(unit, artWeapon, { isInitiating: true })) {
      const activeArt = this._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
      command('weaponArt', activeArt ? `Weapon Art: ${activeArt.name}` : 'Weapon Art', weaponArt);
    }
    // Silence blocks staff healing
    if (!silenced && preferredHealOption) {
      const preferred = preferredHealOption.staff;
      const staffOptions = staffRunOptions(this.runManager, unit);
      const rem = getStaffRemainingUses(preferred, unit, staffOptions);
      const max = getStaffMaxUses(preferred, unit, staffOptions);
      // Warp/Rescue staves relocate instead of healing — label generically.
      const verb = preferred.relocate ? 'Staff' : 'Heal';
      command('staff', `${verb} (${rem}/${max})`, staff);
    }
    if (silenced) {
      if (
        !offered('attack') &&
        getCombatWeapons(unit).length &&
        getCombatWeapons(unit).every((w) => ['Tome', 'Light', 'Breath'].includes(w.type))
      ) {
        command('attack', 'Attack', attack);
        blockedActions.set('attack', 'Silenced: cannot use magic attacks.');
      }
      if (artWeapon && getWeaponArtIds(artWeapon).length) {
        command('weaponArt', 'Weapon Art', weaponArt);
        blockedActions.set('weaponArt', 'Silenced: cannot use weapon arts.');
      }
      if (usableStaves.length) {
        command('staff', 'Staff', staff);
        blockedActions.set('staff', 'Silenced: cannot use healing or utility staves.');
      }
    }
    const equipMenuItems = unit.inventory.filter(
      (item) =>
        item.type !== 'Consumable' &&
        item.type !== 'Scroll' &&
        (canEquip(unit, item) || !hasProficiency(unit, item)),
    );
    if (equipMenuItems.length >= 2) command('equip', 'Equip', () => this.showEquipMenu(unit));
    if (
      canPromote(unit) &&
      resolvePromotionTargetClass(unit, this.gameData.classes, this.gameData.lords) &&
      this.getPromotionConsumable(unit)
    )
      command('promote', 'Promote', () => {
        this.hideActionMenu();
        this.executePromotion(unit, this.getPromotionConsumable(unit)).catch((error) =>
          reportAsyncError('promotion_failed', error, { unit: unit.name }),
        );
      });
    const usableReclassSeals = this.getUsableReclassConsumables(unit);
    if (usableReclassSeals.length === 1)
      command('reclass', 'Reclass', () => {
        this.hideActionMenu();
        const [soleSeal] = this.getUsableReclassConsumables(unit);
        if (soleSeal) this.showReclassClassPicker(unit, soleSeal);
        else this.showActionMenu(unit);
      });
    // Item: show if unit has consumables
    const consumables = unit.consumables || [];
    if (consumables.length > 0) command('item', 'Item', () => this.showItemMenu(unit));
    // Shove/Pull: show if unit has skill and valid targets exist
    if (hasEffectiveSkill(unit, 'shove') && this.findShoveTargets(unit).length > 0)
      command('shove', 'Shove', () => this.startShoveTargetSelection(unit));
    if (hasEffectiveSkill(unit, 'pull') && this.findPullTargets(unit).length > 0)
      command('pull', 'Pull', () => this.startPullTargetSelection(unit));
    // Trade: show if adjacent ally with items/space exists
    if (this.findTradeTargets(unit).length > 0)
      command('trade', 'Trade', () => this.startTradeTargetSelection(unit));
    // Swap: show if adjacent ally on walkable terrain exists
    if (this.findSwapTargets(unit).length > 0)
      command('swap', 'Swap', () => this.startSwapTargetSelection(unit));
    // Dance: show if unit has skill and valid targets exist
    if (hasEffectiveSkill(unit, 'dance') && this.findDanceTargets(unit).length > 0)
      command('dance', 'Dance', () => this.startDanceTargetSelection(unit));
    // Ability: action-trigger skills with structured actionAbility data
    // (Blink/Rally Cry/Healing Circle/Ensnare). Keep the picker discoverable;
    // individual rows explain exhausted uses, silence, and missing targets.
    if (this._hasAbilities(unit)) command('ability', 'Ability', () => this.showAbilityPicker(unit));
    // Break: adjacent temporary wall terrain (Waller)
    if (this.findBreakTargets(unit).length > 0)
      command('break', 'Break', () => this.startBreakTargetSelection(unit));
    // Smash: known Zombie remains in reach of a usable weapon (ZombieRemainsController)
    if (remainsOf(this).findTargets(unit).length > 0)
      command('smash', 'Smash', () => remainsOf(this).begin(unit));
    // Talk: Lord adjacent to NPC (the roster has no cap)
    if (unit.isLord && this.npcUnits.length > 0) {
      const talkTarget = this.findTalkTarget(unit);
      if (talkTarget) {
        command('talk', 'Talk', () => {
          this.hideActionMenu();
          this.executeTalk(unit);
        });
      }
    }
    // Seize: Lord on throne, boss dead
    if (this.battleConfig.objective === 'seize' && unit.isLord) {
      const throne = this.battleConfig.thronePos;
      const bossAlive = this.enemyUnits.some((u) => u.isBoss && u.currentHP > 0);
      if (throne && unit.col === throne.col && unit.row === throne.row && !bossAlive) {
        command('seize', 'Seize', async () => {
          const session = battleSession(this);
          this.hideActionMenu();
          this.commitVisionSnapshotIfPending();
          // A prologue chapter's seize beats are read before the victory flow.
          if (this._prologue) {
            await safeBattlePresentation('prologue seize beats', () => this._prologue.onSeize(unit), { scene: this }); // prettier-ignore
            if (!isCurrentBattleSession(this, session)) return;
          }
          this.onVictory();
        });
      }
    }
    // Escape: any unit standing on an escape square
    if (this.battleConfig.objective === 'escape' && this._escapeController?.isOnEscapeTile(unit)) {
      command('escape', 'Escape', () => {
        this.hideActionMenu();
        this._escapeController?.executeEscape(unit);
      });
    }
    // Capture: unit on enemy ballista tile
    if (this.ballistas?.length > 0) {
      const ballista = this.ballistas.find(
        (b) => b.col === unit.col && b.row === unit.row && b.owner === 'enemy',
      );
      if (ballista) command('capture', 'Capture', () => this._captureBallista(unit));
    }
    command('wait', 'Wait', () =>
      this.finishUnitAction(unit, { skipCanto: true, session: session }),
    );

    const rows = commands.map(({ id, label, run }) => {
      const blocked = blockedActions.has(id);
      return menuRow({
        id,
        label,
        description: blockedActions.get(id) || null,
        // No Visit command exists: Wait says when ending here visits the village.
        note: id === 'wait' ? this._villageController?.getWaitNote(unit) || null : null,
        disabled: blocked,
        color: blocked
          ? UI_PALETTE.muted
          : isObjectiveCommand({ id })
            ? UI_PALETTE.good
            : UI_PALETTE.text,
        invoke: () => {
          if (blocked || isSleeping(unit)) return;
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          run();
        },
      });
    });

    if (!railOwnsMenus(this)) this._drawActionMenuRows(unit, rows);
    this._registerActionMenu(rows);
    this._inputController?.registerSelectionMenu(unit);
  }

  /** The desktop canvas menu for a unit's commands (the phone rail renders its own). */
  _drawActionMenuRows(unit, rows) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = hasRoomRightOf(this.grid, unit.col, unit.row)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - 60;
    const menuY = pos.y - 10;
    const longestLabel = Math.max(...rows.map((row) => row.label.length));
    const menuWidth = Math.max(70, longestLabel * 8 + 16);
    let itemHeight = this.isMobileInput ? 38 : 28;
    let menuHeight = rows.length * itemHeight + 8;
    // Overflow guard: shrink rows if menu exceeds viewport
    if (this.isMobileInput) {
      const maxMenuH = this.cameras.main.height - 16;
      if (menuHeight > maxMenuH) {
        itemHeight = Math.max(24, Math.floor((maxMenuH - 8) / rows.length));
        menuHeight = rows.length * itemHeight + 8;
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
      .setStrokeStyle(1, UI_HEX.line);
    this.actionMenu.push(bg);

    rows.forEach((row, i) => {
      const text = this._makeMenuTextButton(
        menuPos.x + menuWidth / 2,
        menuPos.y + 4 + i * itemHeight + itemHeight / 2,
        row.label,
        { fontFamily: 'monospace', fontSize: '13px', color: row.color },
        row.color,
        () => row.invoke(),
        { hitWidth: menuWidth - 10, hitHeight: itemHeight, disabled: row.disabled },
      );
      text._rowId = row.id;
      this.actionMenu.push(text);
    });
    this._pinToScreen(this.actionMenu);
  }

  /** Capture: the unit takes the enemy ballista it stands on, and its action ends. */
  _captureBallista(unit) {
    const session = battleSession(this);
    this.hideActionMenu();
    this.commitVisionSnapshotIfPending();
    const ballista = this.ballistas?.find((b) => b.col === unit.col && b.row === unit.row);
    if (ballista) {
      ballista.owner = 'player';
      ballista.captured = true;
      observeHistoryAction(this, 'captured a ballista', unit);
      this.dangerZoneStale = true;
      this._pinnedThreats?.invalidate();
      if (this.dangerZone?.visible) {
        this.dangerZoneCache = this.calculateDangerZone();
        this.dangerZoneStale = false;
        this.dangerZone.show(this.dangerZoneCache);
      }
    }
    unit.hasActed = true;
    this.finishUnitAction(unit, { session: session });
  }

  // Publish each completed menu once. Canvas and DOM share the same guarded
  // actions; disabled rows remain visible without becoming focus targets.
  // A menu built from rows (battleMenuModel) passes them: the rail renders the rows
  // themselves and needs no canvas object; a canvas row, when there is one, is found
  // by its row id. Older menus are read from their canvas rows.
  _registerActionMenu(rows = null, { state = 'UNIT_ACTION_MENU' } = {}) {
    const objects = this.actionMenu;
    const unit = this.selectedUnit;
    const entries = rows
      ? rows.map((row) => {
          const button = (objects || []).find((object) => object?._rowId === row.id) || null;
          return {
            id: row.id,
            label: rowText(row),
            item: row.item,
            description: row.description,
            note: row.note,
            button,
            disabled: row.disabled,
            color: row.color || UI_PALETTE.text,
            run: () => row.invoke(),
          };
        })
      : (objects || [])
          .filter((button) => typeof button?._action === 'function')
          .map((button) => ({
            id: null,
            label: button.text,
            item: button._menuItem,
            description: button._menuDescription,
            note: button._menuNote || null,
            button,
            disabled: Boolean(button._menuDisabled),
            color: button._menuColor || UI_PALETTE.text,
            run: () => button._action(),
          }));
    const items = entries.map(({ run, ...entry }) => {
      const item = {
        ...entry,
        onActivate: () => {
          if (
            this.actionMenu !== objects ||
            this.selectedUnit !== unit ||
            this.battleState !== state ||
            entry.disabled ||
            entry.button?._menuDisabled
          )
            return;
          this._inputController?.commitSelectionMenu(objects);
          return run();
        },
        onFocus: () => {
          if (this._mobileBattleHud?.menu?.objects === objects) {
            this._mobileBattleHud.focusMenuItem(item);
          } else {
            entry.button?.setColor?.(UI_PALETTE.accentText);
          }
        },
        onBlur: () => entry.button?.setColor?.(entry.button._menuColor || UI_PALETTE.text),
      };
      return item;
    });
    // The open menu's commands, whichever renderer shows them (openMenuCommand).
    this._actionMenuPublished = { objects, items };
    this._mobileBattleHud?.showMenu(items, objects);
    this._menuFocus?.setItems(items.filter((item) => !item.disabled));
  }

  hideActionMenu() {
    this._actionMenuPublished = null;
    this._mobileBattleHud?.hideMenu();
    this._menuFocus?.clear();
    const cleanup = this._actionMenuCleanup;
    this._actionMenuCleanup = null;
    cleanup?.();
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
    if (
      !shouldAllowUndoMove(
        this.preMoveLoc,
        unit?._movementCommitted || this.tradeMutatedThisSession,
      )
    ) {
      this.deselectUnit();
      return;
    }

    discardHistoryPath(this, unit);
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
      // The merchant caravan is an NPC, never a recruit (engine/RecruitNpc.js).
      if (!isRecruitNpc(npc)) continue;
      const dist = Math.abs(unit.col - npc.col) + Math.abs(unit.row - npc.row);
      if (dist === 1) return npc;
    }
    return null;
  }

  executeTalk(lord) {
    const session = battleSession(this);
    return (this._movementActions ||= new MovementActionController(this)).executeTalk(lord, {
      session,
    });
  }

  // --- Heal flow (delegates to HealController) ---

  getUsableStaves(unit) {
    return (this._healController ||= new HealController(this)).getUsableStaves(unit);
  }

  onPointerUp(pointer) {
    (this._inputController ||= new InputController(this)).onPointerUp(pointer);
  }

  getActiveHealStaff(unit, usableStaves = null) {
    return (this._healController ||= new HealController(this)).getActiveHealStaff(
      unit,
      usableStaves,
    );
  }

  findHealTargets(unit, staffOverride = null, ...options) {
    return (this._healController ||= new HealController(this)).findHealTargets(
      unit,
      staffOverride,
      ...options,
    );
  }

  startHealTargetSelection(unit, targets, chosenStaff = null) {
    (this._healController ||= new HealController(this)).startHealTargetSelection(
      unit,
      targets,
      chosenStaff,
    );
  }

  _handleCureTargetClick(gp) {
    const target = (this.healTargets || []).find((t) => t.col === gp.col && t.row === gp.row);
    if (!target) return;
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
    (this._healController ||= new HealController(this)).showStaffPicker(unit, usableStaves);
  }

  handleHealTargetClick(gp) {
    (this._healController ||= new HealController(this)).handleHealTargetClick(gp);
  }

  handleStaffAllyClick(gp) {
    (this._healController ||= new HealController(this)).handleStaffAllyClick(gp);
  }

  handleStaffTileClick(gp) {
    (this._healController ||= new HealController(this)).handleStaffTileClick(gp);
  }

  executeRelocate(healer, ally, dest) {
    return (this._healController ||= new HealController(this)).executeRelocate(healer, ally, dest);
  }

  executeHeal(healer, target) {
    return (this._healController ||= new HealController(this)).executeHeal(healer, target);
  }

  executeHealAll(healer, targets) {
    return (this._healController ||= new HealController(this)).executeHealAll(healer, targets);
  }

  /** animateHeal(target, healAmount, source?) — source (the healer) sends heal motes. */
  animateHeal(...args) {
    return (this._healController ||= new HealController(this)).animateHeal(...args);
  }

  // --- Weapon picker (pre-attack) ---

  showWeaponArtPicker(unit) {
    (this._weaponArtController ||= new WeaponArtController(this)).showWeaponArtPicker(unit);
  }

  // --- Utility abilities (Blink / Rally Cry / Healing Circle / Ensnare) ---

  showAbilityPicker(unit) {
    (this._abilityController ||= new AbilityController(this)).showAbilityPicker(unit);
  }

  handleAbilityTileClick(gp) {
    (this._abilityController ||= new AbilityController(this)).handleAbilityTileClick(gp);
  }

  _hasAbilities(unit) {
    return (this._abilityController ||= new AbilityController(this)).hasAbilities(unit);
  }

  /** @returns {boolean} true when it stepped back inside Blink Strike and the state stays */
  _cancelAbilityTileSelection() {
    return (this._abilityController ||= new AbilityController(this)).cancelTileSelection();
  }

  /** Blink Strike's flow (destination, foe, forecast, confirm): WarpStrikeController. */
  _warpStrikeFlow() {
    return (this._abilityController ||= new AbilityController(this))._warpStrike();
  }

  /** Chosen-center weapon arts (Stormcall): aiming, the prompt and the strike. */
  _areaTargeting() {
    return (this._areaTargetingController ||= new AreaTargetingController(this));
  }

  /** Save a chosen-center strike before it is applied (readCommittedAction `area_strike`). */
  _commitAreaStrikeIntent(unit, weapon, art, center) {
    return this._areaTargeting().commitIntent(unit, weapon, art, center);
  }

  /** Resume a saved chosen-center strike, or drop it when it is no longer legal. */
  resumeCommittedAreaStrike(intent) {
    return this._areaTargeting().resumeIntent(intent);
  }

  // --- Equip sub-menu ---

  showEquipMenu(unit) {
    this.hideActionMenu();
    this._weaponPreviewedItem = null;
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';
    this.actionMenu = [];

    const displayWeapons = inventoryDisplayOrder(unit).filter(
      (item) =>
        item.type !== 'Consumable' &&
        item.type !== 'Scroll' &&
        (canEquip(unit, item) || !hasProficiency(unit, item)),
    );
    // The menu as rows (battleMenuModel): the canvas and the phone rail render them.
    const rows = [
      ...displayWeapons.map((wpn, i) => {
        const isNonProficient = !hasProficiency(unit, wpn);
        const canEquipNow = canEquip(unit, wpn);
        const marker = wpn === unit.weapon ? EQUIPPED_MARKER : '  ';
        const artMarker = hasWeaponArt(wpn, this._getWeaponArtCatalog()) ? '*' : '';
        return menuRow({
          id: `weapon:${i}`,
          label: `${marker}${wpn?.name || 'Weapon'}${artMarker}${isNonProficient ? ' (no prof)' : ''}`,
          item: wpn,
          disabled: !canEquipNow,
          color: isNonProficient
            ? UI_PALETTE.muted
            : wpn === unit.weapon
              ? UI_PALETTE.accentText
              : UI_PALETTE.text,
          invoke: () => {
            if (!canEquipNow) return;
            equipWeapon(unit, wpn);
            this.showActionMenu(unit);
          },
        });
      }),
      menuRow({
        id: 'back',
        label: 'Back',
        color: UI_PALETTE.muted,
        invoke: () => {
          this.inEquipMenu = false;
          this.showActionMenu(unit);
        },
      }),
    ];
    if (!railOwnsMenus(this)) this._drawEquipMenuRows(unit, rows);
    this._registerActionMenu(rows);
  }

  /** The desktop canvas equip menu: weapon rows that scroll, stat tooltips, Back below. */
  _drawEquipMenuRows(unit, rows) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 155;
    const menuX = hasRoomRightOf(this.grid, unit.col, unit.row)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    const weaponRows = rows.filter((row) => row.id !== 'back');
    const backRow = rows.find((row) => row.id === 'back');
    const itemHeight = this.isMobileInput ? 36 : 20;
    const menuPadding = 8;
    const contentHeight = weaponRows.length * itemHeight;
    const fullMenuHeight = contentHeight + menuPadding;
    const maxMenuHeight = Math.max(itemHeight + menuPadding, this.cameras.main.height - 52);
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
      .setStrokeStyle(1, UI_HEX.line);
    this.actionMenu.push(bg);

    const scrollRows = [];
    weaponRows.forEach((row, i) => {
      const wpn = row.item;
      const itemY = menuPos.y + 4 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + menuWidth / 2;
      const isNonProficient = !hasProficiency(unit, wpn);

      const equipFontSize = this.isMobileInput ? '13px' : '9px';
      const text = this._makeMenuTextButton(
        itemX,
        itemY,
        row.label,
        {
          fontFamily: 'monospace',
          fontSize: equipFontSize,
          color: row.color,
          lineSpacing: 1,
        },
        row.color,
        () => row.invoke(),
        {
          hitWidth: menuWidth - 10,
          hitHeight: itemHeight,
          hoverColor: isNonProficient ? UI_PALETTE.muted : UI_PALETTE.accentText,
          disabled: row.disabled,
        },
      );

      text._rowId = row.id;
      text.on('pointerover', () => {
        this._showWeaponDetailTooltip(wpn, menuRect, text.y, unit);
      });
      text.on('pointerout', (pointer) => {
        if (!this._isTouchPointer(pointer)) {
          this._hideWeaponDetailTooltip();
        }
      });

      scrollRows.push({ text, baseY: itemY, rowHeight: itemHeight });
      this.actionMenu.push(text);
    });

    const viewHeight = menuHeight - menuPadding;
    let hasOverflow = false;
    if (contentHeight > viewHeight && scrollRows.length > 0 && this.input?.on) {
      hasOverflow = true;
      const topY = menuPos.y + 4;
      const bottomY = menuPos.y + menuHeight - 4;
      const minScroll = viewHeight - contentHeight;
      let scrollY = 0;
      const applyScroll = () => {
        for (const row of scrollRows) {
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
          color: UI_PALETTE.lineStrong,
        })
        .setOrigin(0.5, 1)
        .setDepth(401);
      this.actionMenu.push(hint);
    }

    // Auto-show tooltip for equipped weapon (skip if overflowing -- equipped row may be off-screen)
    if (!hasOverflow) {
      const displayWeapons = weaponRows.map((row) => row.item);
      const equippedWpn = displayWeapons.find((w) => w === unit.weapon) || displayWeapons[0];
      if (equippedWpn) {
        const eqIdx = displayWeapons.indexOf(equippedWpn);
        const autoY = menuPos.y + 4 + eqIdx * itemHeight + itemHeight / 2;
        this._showWeaponDetailTooltip(equippedWpn, menuRect, autoY, unit);
        this._weaponPreviewedItem = equippedWpn;
      }
    }
    const back = this._makeMenuTextButton(
      menuPos.x + menuWidth / 2,
      menuPos.y + menuHeight + 20,
      backRow.label,
      {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: backRow.color,
        backgroundColor: UI_PALETTE.panel,
      },
      backRow.color,
      () => backRow.invoke(),
      { hitWidth: menuWidth - 10, hitHeight: 38 },
    );
    back._rowId = backRow.id;
    this.actionMenu.push(back);
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
  //     await this.showBriefBanner(reason, UI_PALETTE.bad);
  //     this.showEquipMenu(unit);
  //   }
  // }

  // --- Item Menu (Consumables) ---

  showItemMenu(unit) {
    this.hideActionMenu();
    this.battleState = 'UNIT_ACTION_MENU';
    this.actionMenu = [];
    this.inEquipMenu = true; // reuse flag to block other input

    // Use consumables array instead of filtering inventory
    const consumables = unit.consumables || [];
    // The menu as rows (battleMenuModel): the canvas and the phone rail render them.
    const rows = [
      ...consumables.map((item, i) => {
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
        const refusal = specialCharacterRefusalText(this.gameData, unit, item.effect);
        const reason =
          item.uses !== undefined && item.uses <= 0
            ? 'No uses remaining'
            : isHeal && unit.currentHP >= unit.stats.HP
              ? 'HP already full'
              : isHeal && isWounded(unit)
                ? 'Wounded: only a staff heals'
                : isCure && !canUseCure
                  ? 'No conditions to cure'
                  : isPromote && !canUsePromote
                    ? refusal || 'Promotion unavailable'
                    : isReclass && !canUseReclass
                      ? refusal || 'No available reclass'
                      : item.effect === 'gold'
                        ? 'Use it from the roster'
                        : '';
        const usable = !reason;
        let label = item.name;
        if (item.uses !== undefined) label += ` (${item.uses})`;
        return menuRow({
          id: `item:${i}`,
          label,
          item,
          description: reason,
          disabled: !usable,
          color: usable ? UI_PALETTE.good : UI_PALETTE.lineStrong,
          invoke: () => {
            if (!unit.consumables?.includes(item) || (item.uses !== undefined && item.uses <= 0))
              return;
            if (isHeal && unit.currentHP >= unit.stats.HP) {
              this.showItemMenu(unit);
              return;
            }
            if (isCure) this._startCureTargetSelection(unit, item);
            else this.useConsumable(unit, item);
          },
        });
      }),
      menuRow({
        id: 'back',
        label: 'Back',
        color: UI_PALETTE.muted,
        invoke: () => {
          this.hideActionMenu();
          this.inEquipMenu = false;
          this.showActionMenu(unit);
        },
      }),
    ];
    if (!railOwnsMenus(this)) this._drawItemMenuRows(unit, rows);
    this._registerActionMenu(rows);
  }

  /** The desktop canvas item menu: each consumable with its brief, the action note, Back. */
  _drawItemMenuRows(unit, rows) {
    const itemRows = rows.filter((row) => row.id !== 'back');
    const backRow = rows.find((row) => row.id === 'back');
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const itemHeight = 38;
    const menuWidth = 240;
    const menuX = hasRoomRightOf(this.grid, unit.col, unit.row)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    const noteHeight = 36;
    const menuHeight = (itemRows.length + 1) * itemHeight + noteHeight + 8; // +1 for Back
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
      .setStrokeStyle(1, UI_HEX.line);
    this.actionMenu.push(bg);

    itemRows.forEach((row, i) => {
      const iy = menuPos.y + 4 + i * itemHeight + itemHeight / 2;
      const ix = menuPos.x + menuWidth / 2;
      const text = this._makeMenuTextButton(
        ix,
        iy - 4,
        row.label,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: row.color,
        },
        row.color,
        () => row.invoke(),
        { hitWidth: menuWidth - 10, hitHeight: itemHeight, disabled: row.disabled },
      );
      text._rowId = row.id;
      const brief = presentationText(
        this,
        ix,
        iy + 8,
        row.description || battleItemBrief(row.item, unit, { run: this.runManager }),
        {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: UI_PALETTE.muted,
        },
      )
        .setOrigin(0.5)
        .setDepth(401);
      this.actionMenu.push(text, brief);
    });

    const note = presentationText(
      this,
      menuPos.x + 8,
      menuPos.y + 4 + itemRows.length * itemHeight,
      ITEM_ACTION_NOTE,
      {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.muted,
        wordWrap: { width: menuWidth - 16 },
      },
    ).setDepth(401);
    this.actionMenu.push(note);

    // Back button
    const backY = menuPos.y + 4 + itemRows.length * itemHeight + noteHeight + itemHeight / 2;
    const backText = this._makeMenuTextButton(
      menuPos.x + menuWidth / 2,
      backY,
      backRow.label,
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: backRow.color,
      },
      backRow.color,
      () => backRow.invoke(),
      { hitWidth: menuWidth - 10, hitHeight: itemHeight },
    );
    backText._rowId = backRow.id;
    this.actionMenu.push(backText);
    this._pinToScreen(this.actionMenu);
  }

  async useConsumable(unit, item) {
    const session = battleSession(this);
    if (!isCurrentBattleSession(this, session)) return false;
    if (item?.effect === 'promote')
      return this.executePromotion(unit, item).catch((error) => {
        reportAsyncError('promotion_failed', error, { unit: unit.name });
        return false;
      });
    if (item?.effect === 'reclass') return this.showReclassClassPicker(unit, item);
    const target = ['cure', 'cureHeal'].includes(item?.effect)
      ? this._pendingCureTarget || unit
      : unit;
    return settleAndPresent(this, {
      session,
      unit,
      label: 'consumable',
      validate: () =>
        (this.playerUnits || []).includes(unit) &&
        unit.faction === 'player' &&
        validateConsumable(unit, item, target) &&
        (target === unit ||
          ((this.playerUnits || []).includes(target) &&
            gridDistance(unit.col, unit.row, target.col, target.row) <= 1)),
      settle: () => {
        this._pendingCureTarget = null;
        this.inEquipMenu = false;
        const facts = settleConsumable(unit, item, target);
        observeHistoryAction(this, 'used', unit, null, item.name);
        return facts;
      },
      present: async (facts) => {
        safeBattlePresentation('item menu', () => this.hideActionMenu(), { scene: this });
        if (facts.cleared.length) {
          safeBattlePresentation(
            'item condition icons',
            () => this._removeAllConditionIcons(target),
            { scene: this },
          );
          if (!target.hasActed)
            safeBattlePresentation('item undim', () => this.undimUnit(target), { scene: this });
        }
        safeBattlePresentation('item HP', () => this.updateHPBar(target), { scene: this });
        const message =
          facts.effect === 'healFull'
            ? `${target.name} fully healed!`
            : facts.effect === 'heal'
              ? `${target.name} healed ${facts.healed} HP!`
              : facts.effect === 'cureHeal'
                ? `${target.name} cured and healed ${facts.healed} HP!`
                : `${target.name}'s conditions cured!`;
        await safeBattlePresentation(
          'item banner',
          () => this.showBriefBanner(message, UI_PALETTE.good),
          { scene: this },
        );
      },
    });
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
          color: UI_PALETTE.info,
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

  /**
   * After a combat's deaths are settled (kill credit read the weapon that struck), a
   * survivor whose per-battle weapon ran dry switches to one that can still strike.
   */
  async _swapSpentWeapons(...units) {
    await this._announceWeaponSwaps(swapSpentWeapons(units));
  }

  /**
   * Tell the player when one of their units switched weapons after its tome ran dry.
   * Awaited, one banner at a time, before the combat's level-ups and the next notice.
   */
  async _announceWeaponSwaps(swaps = []) {
    for (const { unit, to } of swaps) {
      if (unit?.faction !== 'player' || !to?.name) continue;
      try {
        await this.showBriefBanner(`${unit.name} is out of shots: now wielding ${to.name}`);
      } catch {
        // A banner is presentation only; the switch already happened.
      }
    }
  }

  async showBriefBanner(message, color = UI_PALETTE.accentText) {
    // DOM: a toned notice band over the map (CeremonyController); same
    // reading window, awaited the same way. Canvas below is the fallback.
    const notice = hasDOMHost()
      ? this._getCeremonies().showNotice({ message, tone: noticeTone(color, UI_PALETTE) })
      : null;
    if (notice) return notice.done;
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

  // --- Promotion (delegates to PromotionController) ---

  executePromotion(unit, promotionItem = null) {
    return (this._promotionController ||= new PromotionController(this)).executePromotion(
      unit,
      promotionItem,
    );
  }

  showPromotionBanner(unit, newClassName) {
    return (this._promotionController ||= new PromotionController(this)).showPromotionBanner(
      unit,
      newClassName,
    );
  }

  // --- Reclass ---

  showReclassClassPicker(unit, sealItem) {
    if (!sealItem || !canReclass(unit)) {
      this.showBriefBanner(
        speakSpecialCharacterRefusal(this.gameData, unit, 'reclass', this.runManager) ||
          'Cannot reclass this unit.',
        UI_PALETTE.bad,
      );
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return;
    }
    const targets = getReclassTargets(unit, this.gameData.classes, sealItem.subEffect);
    if (targets.length === 0) {
      this.showBriefBanner('No valid reclass targets.', UI_PALETTE.bad);
      this.battleState = 'UNIT_ACTION_MENU';
      this.showActionMenu(unit);
      return;
    }

    this.hideActionMenu();
    this.battleState = 'UNIT_ACTION_MENU';
    this.inEquipMenu = true;

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
      .setStrokeStyle(1, UI_HEX.line);
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
          color: UI_PALETTE.good,
        },
        UI_PALETTE.good,
        () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          this.executeReclass(unit, sealItem, cls).catch((error) =>
            reportAsyncError('reclass_failed', error, { unit: unit.name }),
          );
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
        color: UI_PALETTE.muted,
      },
      UI_PALETTE.muted,
      () => {
        this.hideActionMenu();
        this.battleState = 'UNIT_ACTION_MENU';
        this.showActionMenu(unit);
      },
      { hitWidth: menuWidth - 10, hitHeight: itemHeight },
    );
    this.actionMenu.push(backText);
    this._pinToScreen(this.actionMenu);
    this._registerActionMenu();
  }

  executeReclass(unit, sealItem, newClassData) {
    return (this._reclassController ||= new ReclassController(this)).executeReclass(
      unit,
      sealItem,
      newClassData,
    );
  }

  _getCombatRollSessionKey(attacker, defender) {
    const phase = this.turnManager?.currentPhase || 'player';
    const turn = Math.max(1, Math.trunc(Number(this.turnManager?.turnNumber) || 1));
    return `${this._battleDecisionRngState?.cursor ?? ''}:${phase}:${turn}:${attacker?.battleEntityId || attacker?.name || ''}:${defender?.battleEntityId || defender?.name || ''}:${attacker?.col},${attacker?.row}:${defender?.col},${defender?.row}`;
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

  // Gambler's Coin: one flip per unit per turn phase, keyed on the battle seed, so
  // every combat the unit fights that phase shares it and scouting other tiles or
  // targets in the forecast cannot fish for a better roll. It draws nothing from the
  // battle stream, and resume and Vision rewind (same seed, phase and turn) replay it.
  _gamblerRandom(unit) {
    if (this._battleRewindPolicy !== 'fixed-v1') return Math.random;
    const phase = this.turnManager?.currentPhase || 'player';
    const turn = Math.max(1, Math.trunc(Number(this.turnManager?.turnNumber) || 1));
    return keyedBattleRandom(
      this.visionBaseSeed,
      `gambler:${phase}:${turn}:${unit?.battleEntityId || unit?.name || ''}`,
    );
  }

  _getGamblerAtkDelta(unit, session = null) {
    const rolls = session || this._combatRollSession;
    return resolveGamblerDelta(unit, rolls, this._gamblerRandom(unit));
  }

  _applyAccessoryPhaseCombatMods(unit, mods, session = null) {
    applyAccessoryPhaseCombatMods(unit, mods, {
      turnNumber: this.turnManager?.turnNumber,
      rollSession: session || this._combatRollSession,
      rng: this._gamblerRandom(unit),
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
    const session = battleSession(this);
    if (!unit || unit.currentHP <= 0) return false;
    const result = checkPhoenixBrooch(unit);
    if (!result?.triggered) return false;
    safeBattlePresentation('Phoenix HP', () => this.updateHPBar(unit), { scene: this });
    if (typeof this.animateHeal === 'function') {
      await safeBattlePresentation('Phoenix heal', () => this.animateHeal(unit, result.amount), {
        scene: this,
      });
      if (!isCurrentBattleSession(this, session)) return;
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

  /**
   * Skill context for `attacker` against `defender`. `options.weapon` is the
   * weapon the attacker plans to use when it is not the equipped one (the
   * forecast): its conditional bonus and granted skill replace the equipped
   * weapon's.
   */
  buildSkillCtx(attacker, defender, weaponArt = null, { weapon } = {}) {
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
    const masteryCtx = {
      classesData: this.gameData.classes,
      traitsData: this.gameData.traits || null,
    };
    const atkMods = getSkillCombatMods(
      attacker,
      defender,
      getAllies(attacker),
      getEnemies(attacker),
      skills,
      atkTerrain,
      true,
      affixes,
      weapon === undefined ? masteryCtx : { ...masteryCtx, weapon },
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
      masteryCtx,
    );
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

    // Blessings (act Hit, Keen Eye, Hold the Line): one shared rule for scene and harness.
    applyBlessingCombatMods(atkMods, defMods, {
      profile: this.runManager?.getBlessingCombatProfile?.() ?? null,
      attacker,
      defender,
      atkTerrain,
      defTerrain,
      turn: this.turnManager?.turnNumber,
      alliesOf: getAllies,
    });

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
      marksData: this.gameData.marks || null,
      imbuesData: this.gameData.imbues || null,
      // The Unbroken Banner (and the forecast's word on it): only while the run holds one.
      ...(this._battleBlessings ? { battleBlessings: this._battleBlessings } : {}),
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

  _getEnemyWeaponArtDifficultyId() {
    return (this._weaponArtController ||= new WeaponArtController(
      this,
    ))._getEnemyWeaponArtDifficultyId();
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

  _attackFlow() {
    return (this._attackFlowController ||= new AttackFlowController(this));
  }

  /** Enter target selection (also the weapon-art picker's entry point). */
  _beginAttackSelection(unit) {
    return this._attackFlow().beginTargetSelection(unit);
  }

  _buildForecastSkillCtx(attacker, defender, weaponArt = null, options = {}) {
    return this._withForecastArtState(attacker, weaponArt, () =>
      this.buildSkillCtx(attacker, defender, weaponArt, options),
    );
  }

  /**
   * The player's combat forecast, computed in the state resolution will use:
   * with a weapon art, after its HP cost, the Recoil Guard buff and a Phoenix
   * Brooch heal (see _runCombatResolutionAtSpeed). Reading the numbers after
   * that state was restored overstated a Recoil Guard art's counter damage.
   * `weapon` is the planned weapon; it need not be equipped (confirm equips it).
   */
  _computePlayerForecast(attacker, defender, weaponArt, { weapon, dist, atkTerrain, defTerrain }) {
    const planned = weapon ?? attacker.weapon;
    return this._withForecastArtState(attacker, weaponArt, () =>
      getCombatForecast(
        attacker,
        planned,
        defender,
        defender.weapon,
        dist,
        atkTerrain,
        defTerrain,
        {
          ...this.buildSkillCtx(attacker, defender, weaponArt, { weapon: planned }),
          // Pass only known units: quiet blast warnings must not disclose occupants in fog.
          visibleUnits: [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits].filter((unit) =>
            canInspectUnit(this.grid, unit),
          ),
        },
      ),
    );
  }

  /** Run `fn` with the attacker as resolution will see it after an art's cost; restore after. */
  _withForecastArtState(attacker, weaponArt, fn) {
    if (!weaponArt) return fn();
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
    // The preview's HP changes go through UnitHealth, which may settle HP accessory debt.
    const hadHpOwed = Object.prototype.hasOwnProperty.call(attacker, '_accessoryHpOwed');
    const originalHpOwed = attacker._accessoryHpOwed;

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
      return fn();
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

      if (hadHpOwed) attacker._accessoryHpOwed = originalHpOwed;
      else delete attacker._accessoryHpOwed;

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
    return this._attackFlow().cycleWeapon(direction);
  }

  _cycleForecastTarget(direction) {
    return this._attackFlow().cycleTarget(direction);
  }

  _getPortraitKey(unit) {
    // One resolver for every portrait surface (variant faces included).
    return unitPortraitKey(this, unit, this.gameData);
  }

  /** Combat forecast for a target (see AttackFlowController.showForecast). */
  showForecast(attacker, defender, options) {
    return this._attackFlow().showForecast(attacker, defender, options);
  }

  /**
   * `acknowledge`: the player confirmed or cancelled, having read the forecast's rules.
   * `cancelled`: the player backed out of it (the forecast's Cancel, Esc, right-click).
   */
  hideForecast({ acknowledge = false, cancelled = false } = {}) {
    this._attackFlowController?.closeForecast({ acknowledge });
    this._prologue?.onForecastClosed({ acknowledge, cancelled });
    if (this._forecastOverlay) {
      this._forecastOverlay.destroy();
      this._forecastOverlay = null;
    }
    this.forecastObjects = null;
    this.forecastTarget = null;
    this._forecastWeapon = null;
    this._forecastValidWeapons = null;
    this._forecastWeaponArt = null;
    this._forecastGamblerLine = null;
    // A Blink Strike forecast is only the forecast: once it closes (confirmed, cancelled,
    // End Turn, a rewind) no later forecast may read the destination it planned from.
    this._warpStrike = null;
  }

  /**
   * Shared combat context setup: distance, terrain, roll session, weapon art.
   * Used by executeCombat, executeEnemyCombat, and showForecast.
   * @param {object} attacker
   * @param {object} defender
   * `equipArtWeapon` (executeCombat only, after the intent is committed): equip
   * the selected art's weapon, which a resumed committed attack relies on. The
   * forecast never equips.
   * @param {{ isPlayerInitiator?: boolean, equipArtWeapon?: boolean }} opts
   * @returns {{ dist: number, atkTerrain: object, defTerrain: object, selectedArt: object|null, rollSession: object }}
   */
  _prepareCombatContext(
    attacker,
    defender,
    { isPlayerInitiator = true, equipArtWeapon = false } = {},
  ) {
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
    if (selectedArt && isPlayerInitiator && equipArtWeapon) {
      const artWeapon = this._resolveSelectedWeaponArtEntry(attacker)?.weapon;
      if (artWeapon && attacker.weapon !== artWeapon) equipWeapon(attacker, artWeapon);
    }
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
    const session = battleSession(this);
    safeBattlePresentation('combat music', () => this._musicCtrl?.onCombat(), { scene: this });
    const previous = this._combatSpeedSnapshot;
    this._combatSpeedSnapshot = battleSpeed(this);
    try {
      return await this._runCombatResolutionAtSpeed(attacker, defender, ctx);
    } finally {
      if (isCurrentBattleSession(this, session)) {
        safeBattlePresentation(
          'resolved combat music',
          () => this._musicCtrl?.onCombatResolved?.(),
          {
            scene: this,
          },
        );
        safeBattlePresentation(
          'strike cleanup',
          () => this._combatFx?.finishStrike?.(attacker, defender),
          { scene: this },
        );
        this._combatSpeedSnapshot = previous;
      }
    }
  }

  async _runCombatResolutionAtSpeed(attacker, defender, ctx) {
    const session = battleSession(this);
    const { dist, atkTerrain, defTerrain, selectedArt, actionLabel } = ctx;

    // Apply weapon art cost if selected
    if (selectedArt) {
      const artCostOpts = {
        ...weaponArtRunOptions(this.runManager),
        marksData: this.gameData?.marks,
      };
      const artCost = applyWeaponArtCost(attacker, selectedArt, artCostOpts);
      if (artCost.waived) this.showMarkProc(attacker, `${artCost.mark.name}: no cost`);
      recordWeaponArtUse(attacker, selectedArt, { turnNumber: this.turnManager?.turnNumber });
      this._applyRecoilGuardAfterArtUse(attacker, selectedArt);
      safeBattlePresentation('art cost HP', () => this.updateHPBar(attacker), { scene: this });
      await this._checkPhoenixBrooch(attacker);
      if (!isCurrentBattleSession(this, session)) return;
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

    if (this.runManager?.battleInProgress)
      this._timelineFacts = [
        ...(this._timelineFacts || []),
        ...combatTimelineFacts(this, attacker, defender, result),
      ];

    observeHistoryAction(
      this,
      'attacked',
      attacker,
      defender,
      selectedArt?.name || actionLabel || '',
    );
    for (const event of result.events || []) {
      if (event.type !== 'strike') continue;
      const striker = event.attackerSide === 'defender' ? defender : attacker;
      const target = striker === attacker ? defender : attacker;
      observeHistoryAction(
        this,
        event.miss ? 'missed' : event.isCrit ? 'critically hit' : 'hit',
        striker,
        target,
        event.miss ? '' : `${event.damage} damage`,
        { damage: event.damage || 0, miss: Boolean(event.miss), critical: Boolean(event.isCrit) },
      );
    }
    this._historyActor = historyUnitVisible(this, attacker) ? attacker.battleEntityId : null;

    // Animate events. Consecutive strikes by the same side (Astra flurries,
    // brave doubles, Adept bonus strikes) animate at follow-up tempo.
    let prevStrikeSide = null;
    let strikeIndex = 0;
    for (const event of result.events) {
      if (event.type === 'skill') {
        prevStrikeSide = null;
        await safeBattlePresentation('skill activation', () => this.animateSkillActivation(event), {
          scene: this,
        });
        if (!isCurrentBattleSession(this, session)) return;
      } else {
        const followUp = event.attackerSide != null && event.attackerSide === prevStrikeSide;
        prevStrikeSide = event.attackerSide ?? null;
        const striker = event.attackerSide === 'defender' ? defender : attacker;
        const target = striker === attacker ? defender : attacker;
        applyStrikeHP(striker, target, event);
        const index = strikeIndex++;
        await safeBattlePresentation(
          `strike ${index}`,
          () =>
            this.animateStrike(event, attacker, defender, {
              followUp,
              strikeIndex: index,
            }),
          { scene: this },
        );
        if (!isCurrentBattleSession(this, session)) return;
        if (event.warpRange > 0 && event.targetHPAfter > 0) {
          const warp = settleTeleporterWarp({
            unit: target,
            range: event.warpRange,
            attacker: striker,
            grid: this.grid,
            getUnitAt: (col, row) => this.getUnitAt(col, row),
          });
          if (warp) {
            this._refreshPostCombatMovementState([target]);
            await safeBattlePresentation(
              'warp',
              () => this._presentWarp(target, warp, { session }),
              { scene: this },
            );
            if (!isCurrentBattleSession(this, session)) return;
          }
        }
      }
    }

    // Shielded spends its guard on the first player hit that lands this phase. Read
    // from the result (the player's own strikes), never from the animation.
    if (
      attacker.faction === 'player' &&
      defender.faction === 'enemy' &&
      result.events.some((e) => e.type === 'strike' && !e.miss && e.attackerSide !== 'defender')
    ) {
      defender._hitByPlayerThisPhase = true;
    }

    // Apply final HP (UnitHealth: the same outcome whether or not strikes were shown)
    applyCombatHP(attacker, defender, result);
    // Per-battle weapons (Breachbolt) spend a shot for each side that struck with them
    // (the switch away from a dry weapon waits for the deaths: _swapSpentWeapons).
    spendCombatShots(attacker, defender, result);

    // Debug invincibility: restore player-faction units to full HP
    if (this.isDevToolsEnabled() && debugState.invincible) {
      if (attacker.faction === 'player') {
        healUnitFully(attacker);
        result.attackerDied = false;
      }
      if (defender.faction === 'player') {
        healUnitFully(defender);
        result.defenderDied = false;
      }
    }

    deedsFor(this).onCombat(attacker, defender, result);
    safeBattlePresentation('resolved attacker HP', () => this.updateHPBar(attacker), {
      scene: this,
    });
    safeBattlePresentation('resolved defender HP', () => this.updateHPBar(defender), {
      scene: this,
    });

    await this._applyResolvedCombatPostEffects({
      attacker,
      defender,
      result,
      attackerWeaponArt: selectedArt,
      defenderWeaponArt: null,
    });
    if (!isCurrentBattleSession(this, session)) return;
    await this._checkPhoenixBrooch(attacker);
    if (!isCurrentBattleSession(this, session)) return;
    await this._checkPhoenixBrooch(defender);
    if (!isCurrentBattleSession(this, session)) return;
    // An area art's other victims lost HP too (result.areaCredits).
    for (const { victim } of result.areaCredits || []) {
      await this._checkPhoenixBrooch(victim);
      if (!isCurrentBattleSession(this, session)) return;
    }

    return { result, selectedArt };
  }

  /**
   * Save the confirmed attack before any roll is revealed (see
   * readCommittedAction). Every later checkpoint in this action is taken after
   * the result is applied, so the intent is cleared as soon as that happens.
   */
  _commitCombatIntent(attacker, defender, { warpStrike = false } = {}) {
    const session = battleSession(this);
    this._pendingCommittedAction = null;
    if (!this.runManager?.battleInProgress) return;
    if (attacker?.faction !== 'player' || this.turnManager?.currentPhase !== 'player') return;
    if (!attacker.battleEntityId || !defender?.battleEntityId) return;
    const art =
      this._selectedWeaponArt?.unitName === attacker.name ? this._selectedWeaponArt : null;
    this._pendingCommittedAction = {
      kind: 'attack',
      unitId: attacker.battleEntityId,
      unitName: attacker.name,
      targetId: defender.battleEntityId,
      weaponArt: art
        ? {
            artId: art.artId,
            weaponIndex: art.weaponIndex,
            ...(art.weaponUid ? { weaponUid: art.weaponUid } : {}),
          }
        : null,
      // Blink Strike: the warp is already settled in this checkpoint (the unit stands on its
      // destination, the use spent); the flag only keeps a resumed replay a Blink Strike
      // (no Canto, its name in the history).
      ...(warpStrike ? { warpStrike: true } : {}),
    };
    // Gambler's Coin: the forecast already rolled the attack modifier. Legacy
    // battles roll it from the live battle stream, so a resume must reuse the
    // chosen value, not roll again (which would also shift every later roll).
    const deltas = this._ensureCombatRollSession?.(attacker, defender)?.gamblerAtkDeltaByUnit;
    const chosen = (unit) =>
      deltas instanceof Map && Number.isInteger(deltas.get(unit)) ? deltas.get(unit) : null;
    const gambler = { attacker: chosen(attacker), defender: chosen(defender) };
    if (gambler.attacker !== null || gambler.defender !== null)
      this._pendingCommittedAction.gamblerAtkDelta = gambler;
    this._captureSuspendCheckpoint?.({ commitIntent: true, session: session });
  }

  /** Put a committed attack's already-rolled Gambler's Coin modifiers back in play. */
  _restoreCommittedGamblerDeltas(intent, attacker, defender) {
    const saved = intent?.gamblerAtkDelta;
    if (!saved) return;
    const session = this._ensureCombatRollSession?.(attacker, defender);
    if (!(session?.gamblerAtkDeltaByUnit instanceof Map)) return;
    if (Number.isInteger(saved.attacker))
      session.gamblerAtkDeltaByUnit.set(attacker, saved.attacker);
    if (Number.isInteger(saved.defender))
      session.gamblerAtkDeltaByUnit.set(defender, saved.defender);
  }

  /**
   * Resume a battle whose checkpoint holds a confirmed-but-unresolved attack:
   * replay that exact attack (same target, weapon and art) from the restored
   * RNG state, so a refresh during combat reproduces the outcome rather than
   * handing the player a fresh choice. Returns false when the intent no longer
   * applies (units gone or the attacker already acted) so normal resume runs.
   */
  resumeCommittedAttack(intent) {
    const attacker = findBattleEntity(this, { unitId: intent.unitId }, ['playerUnits']);
    const defender = findBattleEntity(this, { unitId: intent.targetId }, [
      'enemyUnits',
      'npcUnits',
    ]);
    if (
      !attacker ||
      !defender ||
      attacker.hasActed ||
      attacker.currentHP <= 0 ||
      defender.currentHP <= 0
    ) {
      this._pendingCommittedAction = null;
      return false;
    }
    this._selectedWeaponArt = intent.weaponArt
      ? {
          unitName: attacker.name,
          artId: intent.weaponArt.artId,
          weaponIndex: intent.weaponArt.weaponIndex,
          ...(intent.weaponArt.weaponUid ? { weaponUid: intent.weaponArt.weaponUid } : {}),
        }
      : null;
    this.selectedUnit = attacker;
    this.battleState = 'COMBAT_RESOLVING';
    this.refreshEndTurnControl?.();
    try {
      Promise.resolve(showMinorHint(this, 'Battle resumed. Finishing your attack.')).catch(
        () => {},
      );
    } catch {
      /* cosmetic only */
    }
    const run = () => {
      // Seed the roll session right before the attack reads it.
      this._restoreCommittedGamblerDeltas(intent, attacker, defender);
      // A resumed Blink Strike is already warped (the checkpoint holds the unit on its
      // destination): the replay is the attack alone, still a Blink Strike.
      return intent.warpStrike
        ? this.executeCombat(attacker, defender, { warpStrike: {} })
        : this.executeCombat(attacker, defender);
    };
    if (typeof this._scheduleSafeDelayedAsync === 'function')
      this._scheduleSafeDelayedAsync(400, 'resume_committed_attack', run, {
        phase: 'player',
        turn: this.turnManager?.turnNumber,
      });
    else void run();
    return true;
  }

  /**
   * A player attack, from the confirmed forecast to the resolved action's checkpoint.
   * `warpStrike` marks a Blink Strike (WarpStrikeController): its warp is ALREADY settled
   * (the unit stands on its destination, the use spent, in the same synchronous turn as this
   * call), so the intent checkpoint taken here is the one durable write for the warp and
   * the attack together. `warpStrike.present` draws the warp once that checkpoint is saved
   * (absent on a resume: the unit is simply there). A Blink Strike never offers Canto.
   */
  async executeCombat(attacker, defender, { warpStrike = null } = {}) {
    const session = battleSession(this);
    this.battleState = 'COMBAT_RESOLVING';
    safeBattlePresentation('combat highlights', () => this.grid.clearAttackHighlights(), {
      scene: this,
    });
    this._commitCombatIntent(attacker, defender, { warpStrike: Boolean(warpStrike) });
    const saveGate = this._saveRetryGate(session);
    if (saveGate) {
      await saveGate;
      if (
        !isCurrentBattleSession(this, session) ||
        this.battleState === 'BATTLE_END' ||
        this._fatalDecision ||
        this._fatalCapturePending ||
        this._defeatDecision
      )
        return;
    }
    if (warpStrike?.present) {
      await safeBattlePresentation('blink strike warp', () => warpStrike.present(), {
        scene: this,
      });
      if (!isCurrentBattleSession(this, session)) return;
    }
    this.resetFortHealStreak(attacker);
    const defenderHpAtStart = Math.max(0, Math.trunc(Number(defender?.currentHP) || 0));
    const attackerHpAtStart = Math.max(0, Math.trunc(Number(attacker?.currentHP) || 0));

    try {
      const ctx = this._prepareCombatContext(attacker, defender, {
        isPlayerInitiator: true,
        equipArtWeapon: true,
      });
      // The rewind row and the history name a Blink Strike's attack by the skill.
      if (warpStrike) ctx.actionLabel = 'Blink Strike';
      const { result, selectedArt } = await this._runCombatResolution(attacker, defender, ctx);
      if (!isCurrentBattleSession(this, session)) return;
      // The outcome is applied to live state now; every checkpoint from here
      // on reflects it, so none may carry the pre-roll intent.
      this._pendingCommittedAction = null;

      if (attacker.faction === 'player' && attacker.currentHP > 0) {
        const damageDealt = combatHpLost(result, 'defender', defenderHpAtStart);
        // The area art's other victims pay too (BattleXp.AREA_XP_LIVE, the switch the
        // harness reads), each credit the attacker's own.
        await this.awardXP(
          attacker,
          defender,
          defender.currentHP <= 0,
          damageDealt,
          defenderHpAtStart,
          {
            credits: AREA_XP_LIVE
              ? (result.areaCredits || []).filter((credit) => credit.source === attacker)
              : [],
          },
        );
        if (!isCurrentBattleSession(this, session)) return;
      }

      // A prologue chapter's notes on this exchange (combat resolved, HP thresholds).
      if (this._prologue) {
        await safeBattlePresentation(
          'prologue combat notes',
          () =>
            this._prologue.onCombatResolved(attacker, defender, {
              initiator: 'player',
              hpBefore: { attacker: attackerHpAtStart, defender: defenderHpAtStart },
            }),
          { scene: this },
        );
        if (!isCurrentBattleSession(this, session)) return;
      }

      if (defender.currentHP <= 0) {
        await this.removeUnit(defender, { killer: attacker });
        if (!isCurrentBattleSession(this, session)) return;
      }
      if (attacker.currentHP <= 0) {
        await this.removeUnit(attacker, { killer: defender });
        if (!isCurrentBattleSession(this, session)) return;
      }
      await this._sweepFallenUnits();
      if (!isCurrentBattleSession(this, session)) return;
      // A fatal cascade must decide defeat before a popup can checkpoint an
      // army with no commander. Victory still waits for the combat owner's XP.
      if (hasBattleDefeat(this.playerUnits, this.escapedUnits)) {
        this.checkBattleEnd();
        return;
      }

      if (
        this._fatalDecision ||
        this._fatalCapturePending ||
        this._defeatDecision ||
        this.battleState === 'BATTLE_END'
      )
        return;
      // Every death of this combat is settled (kill credit read the weapon that
      // struck): a survivor whose per-battle weapon ran dry switches weapons.
      await this._swapSpentWeapons(attacker, defender);
      if (!isCurrentBattleSession(this, session)) return;
      await safeBattlePresentation(
        'boss half health',
        () => (this._battleBeats ||= new BattleBeatsController(this)).checkBossHalfHealth(),
        { scene: this },
      );
      if (!isCurrentBattleSession(this, session)) return;

      safeBattlePresentation(
        'chip lance',
        () =>
          (this._battleBeats ||= new BattleBeatsController(this)).onChipLance(attacker, defender),
        { scene: this },
      );
      safeBattlePresentation('attacker low health', () => this._battleBeats.onLowHealth(attacker), {
        scene: this,
      });
      const continuation = {
        kind: 'combat',
        unitName: attacker.name,
        ...(attacker.battleEntityId ? { unitId: attacker.battleEntityId } : {}),
        gambitTriggered: result.events.some((event) =>
          event.skillActivations?.some((skill) => skill.id === 'commanders_gambit'),
        ),
        // Blink Strike is an attack: no Canto after it.
        ...(warpStrike ? { skipCanto: true } : {}),
        // Galeforce: decided now, after the casualties fell; saved with the action.
        ...(killMoveRefreshesActor({ art: selectedArt, attacker, primary: defender })
          ? { refreshActor: true }
          : {}),
      };
      await presentQueuedProgress(this, continuation, { session });
      if (!isCurrentBattleSession(this, session)) return;
      completeResolvedAction(this, continuation, { session });
    } catch (err) {
      if (!isCurrentBattleSession(this, session)) return;
      this._pendingCommittedAction = null;
      reportAsyncError('battle_combat_domain_error', err, {
        battleState: this.battleState,
        phase: this.turnManager?.currentPhase,
        turn: this.turnManager?.turnNumber,
      });
      console.error('[BattleScene] combat error:', err);
      // Best-effort: reconcile dead units to prevent zombie state
      try {
        if (defender?.currentHP <= 0) await this.removeUnit(defender, { killer: attacker });
        if (!isCurrentBattleSession(this, session)) return;
        if (attacker?.currentHP <= 0) await this.removeUnit(attacker, { killer: defender });
        if (!isCurrentBattleSession(this, session)) return;
        await this._sweepFallenUnits();
        if (!isCurrentBattleSession(this, session)) return;
        this.checkBattleEnd();
      } catch (cleanupErr) {
        console.error('[BattleScene] combat cleanup error:', cleanupErr);
      }
      if (
        this.battleState !== 'BATTLE_END' &&
        !this._fatalDecision &&
        !this._fatalCapturePending &&
        !this._defeatDecision
      ) {
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
          completeBattleAction(this, attacker, { skipDim: true, session });
        }
      }
    } finally {
      if (isCurrentBattleSession(this, session)) {
        this._clearCombatRollSession();
        this._clearSelectedWeaponArt();
      }
    }
  }

  /** Everything that happens after a combat resolves (engine/PostCombatEffects.js). */
  async _applyResolvedCombatPostEffects(combat) {
    await this._playPostCombatBeats(postCombatEffects(combat, this._postCombatWorld()));
  }

  /** The battle as post-combat effects see it (PostCombatEffects `world`). */
  _postCombatWorld() {
    return {
      affixes: this.gameData?.affixes,
      cols: this.grid.cols,
      rows: this.grid.rows,
      getMoveCost: (col, row, moveType) => this.grid.getMoveCost(col, row, moveType),
      getUnitAt: (col, row) => this.getUnitAt(col, row),
      getTerrainAt: (col, row) => this.grid.getTerrainAt?.(col, row) ?? null,
      hostilesOf: (unit) => this._getTier5HostileUnitsFor(unit),
      alliesOf: (unit) => this.getDivineChargeAllies(unit),
      turnNumber: this.turnManager?.turnNumber,
      skillsData: this.gameData?.skills,
      marksData: this.gameData?.marks,
      ...(this._battleBlessings ? { battleBlessings: this._battleBlessings } : {}),
    };
  }

  /** Act on each beat the effects yield, in order: a death plays before the next effect. */
  async _playPostCombatBeats(beats) {
    const session = battleSession(this);
    for (const beat of beats) {
      if (!isCurrentBattleSession(this, session)) return;
      if (beat.kind === 'banner') this._noteBannerHold(beat.unit);
      if (beat.kind === 'remove' || beat.kind === 'moved') {
        await this._playPostCombatBeat(beat);
      } else {
        await safeBattlePresentation(
          `post-combat ${beat.kind}`,
          () => this._playPostCombatBeat(beat),
          { scene: this },
        );
      }
      if (!isCurrentBattleSession(this, session)) return;
    }
  }

  async _playPostCombatBeat(beat) {
    const unit = beat.unit;
    switch (beat.kind) {
      case 'remove':
        await this.removeUnit(unit, { killer: beat.killer });
        break;
      case 'moved':
        // A push that slid on Ice is drawn crossing its tiles (the coordinates are settled).
        if (beat.slides?.length)
          await presentSettledMoves(this, beat.slides, {
            session: battleSession(this),
            label: 'push',
            duration: 80,
          });
        for (const moved of beat.units)
          safeBattlePresentation('post-combat position', () => this.updateUnitPosition(moved), {
            scene: this,
          });
        this._refreshPostCombatMovementState(beat.units);
        break;
      case 'hp':
        this.updateHPBar(unit);
        break;
      case 'stone':
        this.updateHPBar(unit);
        this._stoneBreakFx().playBreak(unit);
        break;
      case 'banner':
        this._bannerHoldFx().playHold(unit);
        break;
      case 'poison':
        await this.showPoisonDamage(unit, beat.amount);
        break;
      case 'status': {
        const pos = this.grid.gridToPixel(unit.col, unit.row);
        this._addConditionIcon(unit, beat.status);
        (this._combatFx ||= new CombatFxController(this)).playStatus(pos.x, pos.y, beat.status);
        break;
      }
      case 'hint': {
        const pos = this.grid.gridToPixel(unit.col, unit.row);
        this.showMinorHintAt(pos.x, pos.y, beat.text, POST_COMBAT_HINT_COLORS[beat.tone]);
        break;
      }
      default:
        break;
    }
  }

  _getTier5HostileUnitsFor(sourceUnit) {
    if (!sourceUnit) return [];
    if (sourceUnit.faction === 'enemy') return this.playerUnits || [];
    return this.enemyUnits || [];
  }

  /** A Tier 5 ally buff (and the Rally ability): PostCombatEffects.allyBuff. */
  async _applyTier5AllyBuffStep(step, sourceUnit) {
    await this._playPostCombatBeats(allyBuff(step, sourceUnit, this._postCombatWorld()));
  }

  _applyTier5TimedBuffEntry(unit, entry) {
    applyTimedBuffEntry(unit, entry);
  }

  _resolveTier5BuffExpiry(sourceUnit, durationPhases = 1) {
    return resolveTimedBuffExpiry(sourceUnit, this.turnManager?.turnNumber, durationPhases);
  }

  _expireTimedWeaponArtBuffs(phase, turn) {
    expireTimedBuffs(
      [...(this.playerUnits || []), ...(this.enemyUnits || []), ...(this.npcUnits || [])],
      phase,
      turn,
    );
  }

  _getTimedWeaponArtCombatBuffMods(unit) {
    return timedBuffCombatMods(unit);
  }

  /**
   * Units moved mid-action. Combat shoves/pulls reveal at once: the attack was saved
   * as committed before it resolved. A move that is not yet saved (Blink) passes
   * revealFog: false and lifts the fog when its action completes.
   */
  _refreshPostCombatMovementState(movedUnits, { revealFog = true } = {}) {
    if (!Array.isArray(movedUnits) || movedUnits.length <= 0) return;
    safeBattlePresentation('post-combat danger', () => this.refreshVisibleDangerZone?.(), {
      scene: this,
    });
    if (revealFog && this.grid.fogEnabled) {
      this.grid.updateFogOfWar(this.playerUnits);
      this.updateEnemyVisibility();
    }
  }

  async animateStrike(event, attacker, defender, opts = {}) {
    const session = battleSession(this);
    const reduced = this._reduceMotion();
    const strikerIsAttacker =
      event.attackerSide === 'attacker' || event.attackerSide === 'defender'
        ? event.attackerSide === 'attacker'
        : event.attacker === attacker.name;
    const striker = strikerIsAttacker ? attacker : defender;
    const target = strikerIsAttacker ? defender : attacker;

    // Category-annotated procs: striker-side (arts/offense) vs target-side (defense)
    const split = splitStrikeActivations(event.skillActivations, this.gameData.skills || []);
    const banners = (this._procBanner ||= new ProcBannerController(this));
    banners.showStrikeProcChips(split, striker, target);

    const legendaryArt = findLegendaryArtActivation(
      event.skillActivations,
      this._getWeaponArtCatalog(),
    );

    // Portrait cut-in for crits and Legendary weapon arts (throttled inside;
    // skipped for follow-up strikes so flurries can't chain cut-ins).
    if (!event.miss && !opts.followUp && (event.isCrit || legendaryArt)) {
      await banners.showCutIn({
        unit: striker,
        unitName: striker.name,
        weaponName: striker.weapon?.name || '',
        portraitKey: this._getPortraitKey(striker),
        label: legendaryArt ? legendaryArt.name : 'CRITICAL HIT',
        category: legendaryArt ? 'art' : 'offense',
        side: striker.faction === 'player' ? 'left' : 'right',
      });
      if (!isCurrentBattleSession(this, session)) return;
    }

    const audio = this.registry.get('audio');
    const strikerCat = dominantCategory(split.striker);
    const windUp =
      !opts.followUp && (strikerCat === PROC_CATEGORY.ART || strikerCat === PROC_CATEGORY.OFFENSE);
    const artStrike = split.striker.some((e) => e.id === 'weapon_art');
    // Combat v2: the choreography owns motion and effects; the callbacks below are
    // the game-facing results (numbers, HP bars), shown at the moment of contact.
    await (this._combatChoreo ||= new CombatChoreography(this)).playStrike({
      event,
      striker,
      target,
      split,
      legendaryArt,
      followUp: Boolean(opts.followUp),
      windUp,
      strikeIndex: opts.strikeIndex ?? 0,
      signatureKey: legendaryArt ? sigFxForWeaponType(legendaryArt.weaponType) : null,
      artStrike,
      artCatalog: this._getWeaponArtCatalog(),
      onStrikeSound: () => {
        if (audio && !event.miss) this._combatFx?.playStrikeSound(this.getWeaponSFX(striker));
        if (!isCurrentBattleSession(this, session)) return;
      },
      onMiss: () => this._showStrikeMiss(target, reduced),
      onContact: () => {
        if (audio) this._combatFx?.playStrikeSound(event.isCrit ? 'sfx_crit' : 'sfx_hit');
        if (event.isCrit)
          (this._battleBeats ||= new BattleBeatsController(this)).onCritStrike(striker);
        this._showStrikeResult(event, striker, target, reduced);
      },
    });
  }

  /** A broken Revival Stone's presentation (RevivalStoneController), made on first use. */
  _stoneBreakFx() {
    return (this._stoneFx ||= new RevivalStoneController(this).create());
  }

  /** The Unbroken Banner's hold (UnbrokenBannerController), made on first use. */
  _bannerHoldFx() {
    return (this._bannerFx ||= new UnbrokenBannerController(this).create());
  }

  /**
   * The timeline's line for a hold outside a combat's exchange (a Deathburst, a ballista bolt,
   * the Entity's splash, a post-combat blow); the exchange's own holds are combat facts.
   */
  _noteBannerHold(unit) {
    if (this.runManager?.battleInProgress)
      this._timelineFacts = [...(this._timelineFacts || []), bannerHoldFact(unit)];
  }

  /** Floating MISS over a dodging target (strike presentation, see CombatChoreography). */
  _showStrikeMiss(target, reduced) {
    const pos = this.grid.gridToPixel(target.col, target.row);
    const missText = presentationText(this, pos.x, pos.y - 16, 'MISS', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: UI_PALETTE.muted,
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(300);
    this.tweens.add({
      targets: missText,
      y: reduced ? pos.y - 16 : pos.y - 32,
      alpha: 0,
      duration: 500,
      onComplete: () => missText.destroy(),
    });
  }

  /** Damage number, HP bars, wake, drain heal and reflect at the moment of contact. */
  _showStrikeResult(event, striker, target, reduced) {
    const pos = this.grid.gridToPixel(target.col, target.row);
    const dmgText = presentationText(
      this,
      pos.x,
      pos.y - 16,
      event.isCrit ? `${event.damage}!` : `${event.damage}`,
      {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: event.isCrit ? UI_PALETTE.accentText : UI_PALETTE.text,
        fontStyle: 'bold',
        // An ink edge keeps the number legible over bright impact frames.
        stroke: UI_PALETTE.void,
        strokeThickness: 3,
      },
    )
      .setOrigin(0.5)
      .setDepth(300);
    this.tweens.add({
      targets: dmgText,
      y: reduced ? pos.y - 16 : pos.y - 32,
      alpha: 0,
      duration: 600,
      onComplete: () => dmgText.destroy(),
    });

    this.updateHPBar(target);
    // A Revival Stone broke on this blow: the state is settled (the bar is full again),
    // so this only draws the refill (RevivalStoneController).
    if (event.stoneBroken) this._stoneBreakFx().playBreak(target);
    // The Unbroken Banner held the target at 1 HP on this blow (settled: UnbrokenBannerController).
    if (event.bannerHeld) this._bannerHoldFx().playHold(target);

    // Sleep: wake on damage -- remove Zzz icon and un-dim immediately
    if (event.wokeFromSleep) {
      this._removeConditionIcon(target, 'sleep');
      this.undimUnit(target);
    }

    if (event.heal > 0 && event.strikerHealTo !== undefined) {
      this.updateHPBar(striker);
    }
    // Show what the drain actually healed (nothing at full HP).
    if (event.healed > 0) {
      const sPos = this.grid.gridToPixel(striker.col, striker.row);
      const healText = presentationText(this, sPos.x + 12, sPos.y - 8, `+${event.healed}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: UI_PALETTE.good,
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(300);
      this.tweens.add({
        targets: healText,
        y: reduced ? sPos.y - 8 : sPos.y - 28,
        alpha: 0,
        duration: 600,
        onComplete: () => healText.destroy(),
      });
    }

    // Thorns: the combat result already carries the striker's HP after the reflection.
    if (event.reflectDamage > 0 && event.strikerHPAfter !== undefined) {
      this.updateHPBar(striker);
    }
    // Labelled, and only what the striker actually lost (Thorns leaves 1 HP).
    if (event.reflectTaken > 0) {
      const sPos = this.grid.gridToPixel(striker.col, striker.row);
      const refText = presentationText(this, sPos.x, sPos.y - 16, `−${event.reflectTaken} Thorns`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: UI_PALETTE.bad,
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(300);
      this.tweens.add({
        targets: refText,
        y: reduced ? sPos.y - 16 : sPos.y - 32,
        alpha: 0,
        duration: 600,
        onComplete: () => refText.destroy(),
      });
    }
  }

  _presentWarp(unit, warp, { session }) {
    return presentTeleporterWarp(this, unit, warp, { session });
  }
  /** Animate a pre-combat skill activation event (Vantage, Astra, Desperation). */
  async animateSkillActivation(event) {
    await (this._procBanner ||= new ProcBannerController(this)).showSkillBanner(
      event,
      this.gameData.skills || [],
    );
  }

  /** Show poison damage floating text. */
  async showPoisonDamage(unit, damage) {
    const reduced = this._reduceMotion();
    if (!unit.graphic) return;
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    (this._combatFx ||= new CombatFxController(this)).playStatus(pos.x, pos.y, 'poison');
    const text = this.add
      .text(pos.x, pos.y - 16, `Poison -${damage}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: UI_PALETTE.rarityEpic,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(301);
    this.updateHPBar(unit);
    await this._awaitSceneTween(
      {
        targets: text,
        y: reduced ? pos.y - 16 : pos.y - 32,
        alpha: 0,
        duration: 600,
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

  /**
   * Award XP to a player unit after combat. Each gain queues its EXP gauge and level-up
   * cards; presentQueuedProgress shows them once the action is settled.
   * `survivedAttack`: the unit was attacked and lived. It then earns at least
   * XP_DEFEND_SURVIVE, even unarmed, out of counter reach or with every counter
   * missed; only XP earned by damage dealt is shared by a Mentor's Band.
   */
  async awardXP(
    playerUnit,
    opponent,
    opponentDied,
    damageDealt = null,
    defenderHpAtStart = null,
    { survivedAttack = false, credits = [] } = {},
  ) {
    const session = battleSession(this);
    // Who earns what (BattleXp.actionXpAwards): the unit, then Mentor's Band shares, the
    // area art's other victims (`credits`, result.areaCredits) included.
    const awards = actionXpAwards({
      credits,
      rewardMultiplierOf: (victim) => this.getEnemyXpMultiplier(victim),
      areaXp: this.gameData?.weaponArts?.areaXp,
      unit: playerUnit,
      opponent,
      opponentDied,
      damageDealt,
      opponentHpAtStart: defenderHpAtStart,
      survivedAttack,
      rewardMultiplier: this.getEnemyXpMultiplier(opponent),
      pressureXpMultiplier: this.getTurnPressureState().xpMultiplier,
      // Training Doctrine meta upgrade: non-lord units earn bonus combat XP.
      recruitXpBonus: Number(this.runManager?.metaEffects?.recruitXpBonus) || 0,
      allies: this.playerUnits || [],
    });
    for (const award of awards) {
      // The scene may have shut down while a level-up popup was showing.
      if (!isCurrentBattleSession(this, session)) break;
      // Shares go straight to awardScaledXP: they never re-enter awardXP, so bands
      // cannot chain (allies of allies) and heal/dance XP is never shared.
      await this.awardScaledXP(award.unit, award.baseXp);
      if (!isCurrentBattleSession(this, session)) return;
    }
  }

  /** Level-up music: the cue for `kind` ('normal' | 'perfect' | 'blank' | 'promotion'). */
  _playLevelUpSfx(kind = 'normal') {
    this._stopLevelUpSfx();
    const audio = this.registry.get('audio');
    if (!audio) return;
    this._levelUpSfxKey = 'sfx_levelup';
    const cue = kind === 'promotion' ? 'promotion_crown' : levelUpCue(kind);
    // A cue still decoding (a new track's key) plays a beat late rather than
    // falling back to the plain sound effect.
    void playCue(this, cue, { fallbackSfx: this._levelUpSfxKey, waitMs: LEVEL_UP_CUE_WAIT_MS });
  }

  _stopLevelUpSfx() {
    if (!this._levelUpSfxKey) return;
    if (typeof this.sound?.stopByKey === 'function') {
      this.sound.stopByKey(this._levelUpSfxKey);
    }
    stopCues(this);
    this._levelUpSfxKey = null;
  }

  awardScaledXP(playerUnit, baseXp, { present = true } = {}) {
    const session = battleSession(this);
    const hasTurnInfo = typeof this.getCurrentTurnNumber === 'function';
    const turnsTaken = hasTurnInfo ? this.getCurrentTurnNumber() : 0;
    const xp = scaledXp(baseXp, {
      parXpMultiplier: hasTurnInfo
        ? getParXpMultiplier(turnsTaken, this.turnPar, this.turnBonusConfig)
        : 1,
      xpMultiplier: Number.isFinite(this.battleParams?.xpMultiplier)
        ? this.battleParams.xpMultiplier
        : 1,
      blessingXpDelta: this.runManager?.getXpMultiplierDelta?.() || 0,
      traitXpMultiplier: getTraitXpMultiplier(playerUnit, this.gameData?.traits || null),
    });

    // Apply XP, levels and every skill grant before any presentation (BattleXp).
    // Informational popups wait for a resolved action/turn checkpoint, never suspend
    // halfway through combat. A skill that comes due at a level reached now but finds
    // all five slots full is named on the card (once: later level-ups retry it silently).
    const extendedLevelingEnabled =
      this.runManager?.getDifficultyModifier('extendedLevelingEnabled', false) || false;
    const { statsAfterGain, levelUps, before, after, result } = applyXpGain(playerUnit, xp, {
      classes: this.gameData.classes,
      extendedLevelingEnabled,
    });
    // The EXP gauge's record (plain values), queued with the cards whatever `present`
    // says: staff and dance apply their gain in the settlement and present it later.
    // Nothing gained (the level cap) queues nothing: no gauge, no float.
    const gauge = isCurrentBattleSession(this, session)
      ? xpGaugeRecord(playerUnit, { before, after, levelUps: result?.levelUps })
      : null;
    if (gauge) (this._pendingXpGauges ||= []).push(gauge);
    const cards = levelUpDisplayResults(
      statsAfterGain,
      levelUps.map((entry) => entry.levelUp),
    );
    const skillName = (id) => this.gameData.skills.find((s) => s.id === id)?.name || id;
    for (let i = 0; i < cards.length; i++) {
      // The scene may have shut down while a previous popup was showing (its
      // shutdown hook resolves the await) -- don't build popups on a dead scene.
      if (!isCurrentBattleSession(this, session)) break;
      // Update HP bar after level-up (maxHP may have increased)
      if (present)
        safeBattlePresentation('level-up HP', () => this.updateHPBar(playerUnit), { scene: this });
      const lvUp = cards[i];
      const blockedNames = levelUps[i].blockedIds.map(skillName);
      if (blockedNames.length) lvUp.blockedSkills = blockedNames;
      (this._pendingLevelUpPopups ||= []).push({
        unitName: playerUnit.name,
        ...(playerUnit.battleEntityId ? { unitId: playerUnit.battleEntityId } : {}),
        levelUp: lvUp,
        learnedNames: levelUps[i].learnedIds.map(skillName),
      });
    }
    return xp;
  }

  /**
   * Persist the run mid-battle (anti-refresh casualty lock). Quota/storage
   * failures only degrade the lock, never gameplay — warn and continue.
   */
  /**
   * Resume failed partway (applyUnits may already have loaded the
   * checkpoint's convoy/gold into the run). Non-fatal: apply the sanctioned
   * entry revert so the save matches "Continue from Map". Fatal: keep the
   * recorded defeat, mark the checkpoint unrestorable so the slot screen
   * offers to settle it, and never hand out a free map restart.
   * @returns {'reverted'|'fatal'|'none'}
   */
  _abandonUnrestorableResume() {
    const session = battleSession(this);
    const rm = this.runManager;
    if (!rm?.battleInProgress) return 'none';
    let outcome = 'reverted';
    // The prologue never settles a defeat: even a fatal checkpoint that can't be
    // reopened reverts the chapter to its entry (it restarts from the map).
    if (isPrologueRun(rm)) {
      rm.restartPrologueBattle();
      this._persistBattleRunState?.(null, { session: session });
      return outcome;
    }
    if (!rm.revertBattleInProgressToEntry()) {
      if (rm.battleInProgress?.checkpoint) rm.battleInProgress.checkpoint.restoreFailed = true;
      outcome = 'fatal';
      this._fatalResumeParked = true;
    }
    this._persistBattleRunState?.(null, { session: session });
    return outcome;
  }

  _persistBattleRunState(candidate = null, { session } = {}) {
    if (!isCurrentBattleSession(this, session)) return { ok: false, reason: 'stale_session' };
    if (!this.runManager) return { ok: false, reason: 'missing_run' };
    try {
      const cloud = this.registry?.get?.('cloud');
      const slot = this.registry?.get?.('activeSlot');
      if (!Number.isInteger(slot)) return { ok: false, reason: 'missing_slot' }; // dev/QA route without a slot — nothing to lock
      const result = saveRun(
        this.runManager,
        cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null,
        slot,
        { candidate },
      );
      if (result.ok) {
        this._saveFailureReported = false;
        this._saveRetry?.onDurableWrite({ session });
        if (result.cloud?.reason === 'callback_error' && !this._cloudPushErrorReported) {
          this._cloudPushErrorReported = true;
          reportAsyncError('battle_cloud_push_error', new Error('callback_error'));
        }
      } else if (['quota', 'write_error'].includes(result.reason) && !this._saveFailureReported) {
        this._saveFailureReported = true;
        reportAsyncError('battle_save_failed', new Error(result.reason), {
          phase: this.turnManager?.currentPhase,
          turn: this.turnManager?.turnNumber,
          checkpointIndex: this.runManager.battleInProgress?.checkpoint?.checkpointIndex,
          policy: this._battleRewindPolicy,
        });
      }
      if (!result.ok && result.reason !== 'missing_slot') {
        console.warn('[BattleScene] battle-state save failed:', result.reason);
      }
      return result;
    } catch (err) {
      console.warn('[BattleScene] battle-state save failed:', err?.message || err);
      return { ok: false, reason: 'write_error' };
    }
  }

  _onCheckpointResult(result, options) {
    if (!isCurrentBattleSession(this, options.session)) return;
    (this._saveRetry ||= new SaveRetryController(this).create()).onCheckpointResult(
      result,
      options,
    );
  }

  _saveRetryGate(session) {
    return this._saveRetry?.whenSettled(session) || null;
  }

  /** Suspend-checkpoint shim (see BattleSuspendController). */
  _captureSuspendCheckpoint(options = {}) {
    if (!Number.isInteger(options.session)) {
      reportAsyncError(
        'battle_checkpoint_missing_session',
        new Error('Checkpoint origin session required'),
        {
          scene: this.scene?.key || 'Battle',
        },
      );
      return false;
    }
    if (!isCurrentBattleSession(this, options.session)) return false;
    return (this._battleSuspendController ||= new BattleSuspendController(this)).captureCheckpoint(
      options,
    );
  }

  async removeUnit(unit, options = {}) {
    const session = battleSession(this);
    if (!unit || unit._removing) return;
    const roster =
      unit.faction === 'player'
        ? this.playerUnits
        : unit.faction === 'npc'
          ? this.npcUnits
          : this.enemyUnits;
    if (!roster?.includes(unit)) return;
    const killer = options?.killer || null;
    // Narrative memory: remember who felled the commander so onDefeat can
    // attribute the run's end. Ephemeral scene state — a Vision rewind simply
    // orphans it, and any later fatal death overwrites it before it is read.
    if (unit.isCommander && unit.faction === 'player') {
      this._battleCommanderId ||= unit.battleEntityId;
      this._battleCommanderName = typeof unit.name === 'string' ? unit.name : null;
      this._commanderKillerName = typeof killer?.name === 'string' ? killer.name : null;
    }
    if (
      this.runManager?.battleInProgress &&
      (unit.faction === 'player' ||
        !this.grid?.fogEnabled ||
        this.grid.isVisible?.(unit.col, unit.row))
    )
      this._timelineFacts = [...(this._timelineFacts || []), `${unit.name} fell.`];
    if (killer) observeHistoryAction(this, 'defeated', killer, unit);
    else observeHistoryAction(this, 'fell', unit);
    deedsFor(this).onUnitRemoved(unit, killer);
    unit._removing = true;
    const deathCol = unit.col;
    const deathRow = unit.row;

    // Presentation only: a failed fade must never keep a fallen unit (above
    // all the commander) on the board. Its retry would return early on
    // _removing, and checkBattleEnd would never see the death.
    await safeBattlePresentation(
      'death fade',
      async () => {
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_death');
        await (this._combatFx ||= new CombatFxController(this)).deathFade(unit);
      },
      { scene: this },
    );
    if (!isCurrentBattleSession(this, session)) return;
    safeBattlePresentation('death graphic cleanup', () => this.removeUnitGraphic(unit), {
      scene: this,
    });
    // Splice in-place so TurnManager's reference stays valid
    if (unit.faction === 'player') {
      const idx = this.playerUnits.indexOf(unit);
      if (idx !== -1) {
        this.playerUnits.splice(idx, 1);
        this._playerDeathsThisBattle = (this._playerDeathsThisBattle || 0) + 1;
        // Presentation only: the FALLEN band names the commander that fell.
        if (unit.isCommander)
          this._fallenCommander = {
            name: unit.name,
            className: unit.className,
            epithet: unitEpithet(unit),
          };
        // Last words of a fallen recruit (permadeath): class + temperament voice,
        // a pure pick (never the RNG or the narrative log).
        if (!unit.isLord && !isScriptedBattle(this.battleParams)) {
          const line = fallenLine(
            unit,
            voiceContext({
              gameData: this.gameData,
              runManager: this.runManager,
              units: this.playerUnits,
            }),
          );
          if (line) {
            try {
              await this.dialogueOverlay?.show(unit.name, line, this._getPortraitKey(unit));
              if (!isCurrentBattleSession(this, session)) return;
            } catch (_) {}
            if (!isCurrentBattleSession(this, session)) return;
          }
        }
        // After the last words: a titled unit is named in full as it falls.
        deedsFor(this).announceFall(unit);
        // Lord farewell dialogue (non-commander; commander death triggers game over elsewhere).
        // A prologue chapter restarts instead ("Not this thread"): no farewell.
        if (unit.isLord && !unit.isCommander && !isScriptedBattle(this.battleParams)) {
          const farewellPool = this.gameData?.dialogue?.lordFarewell?.[unit.name];
          if (Array.isArray(farewellPool) && farewellPool.length > 0) {
            const cast = resolveDialogueCast(this.runManager?.getStartingLordNames?.());
            const line = adaptDialogueLine(
              this.runManager?.pickNarrativeLine?.(farewellPool, `farewell:${unit.name}`) ||
                farewellPool[0],
              cast,
            );
            const portraitKey = this._getPortraitKey(unit);
            try {
              await this.dialogueOverlay?.show(unit.name, line, portraitKey);
              if (!isCurrentBattleSession(this, session)) return;
            } catch (_) {}
            if (!isCurrentBattleSession(this, session)) return;
          }
        }
        // The commander's last words: the run ends with this fall (playtest
        // 2026-09-28: it used to end in silence). A prologue chapter restarts instead.
        if (unit.isLord && unit.isCommander && !isScriptedBattle(this.battleParams)) {
          const pool = this.gameData?.dialogue?.commanderFall?.[unit.name];
          if (Array.isArray(pool) && pool.length > 0) {
            const line =
              this.runManager?.pickNarrativeLine?.(pool, `commanderFall:${unit.name}`) || pool[0];
            try {
              await this.dialogueOverlay?.show(unit.name, line, this._getPortraitKey(unit));
              if (!isCurrentBattleSession(this, session)) return;
            } catch (_) {}
            if (!isCurrentBattleSession(this, session)) return;
          }
        }
        // Someone on the field answers the loss (a quip over a living lord); a prologue
        // chapter restarts instead, so nobody mourns a fall that is undone.
        if (!isScriptedBattle(this.battleParams))
          safeBattlePresentation(
            'ally fall',
            () => (this._battleBeats ||= new BattleBeatsController(this)).onAllyFall(unit),
            { scene: this },
          );
      }
    } else if (unit.faction === 'npc') {
      const idx = this.npcUnits.indexOf(unit);
      if (idx !== -1) this.npcUnits.splice(idx, 1);
    } else {
      const idx = this.enemyUnits.indexOf(unit);
      if (idx !== -1) this.enemyUnits.splice(idx, 1);
      this._applyKillRewards(unit, killer);
      safeBattlePresentation(
        'kill reaction',
        () => (this._battleBeats ||= new BattleBeatsController(this)).onKill(unit, killer),
        { scene: this },
      );
      // Zombie / Revenant remains: a tile record that rises in 3 enemy phases unless
      // smashed (engine/ZombieRemains.js, ZombieRemainsController).
      remainsOf(this).onEnemyFell(unit, killer, { col: deathCol, row: deathRow });
      // A Necromancer's Skeletons crumble with it (no killer: no gold, no XP), before any
      // battle-end check reads the roster (engine/Necromancy.js).
      if (isNecromancer(unit)) {
        await necromancyOf(this).crumble(unit);
        if (!isCurrentBattleSession(this, session)) return;
      }
    }
    safeBattlePresentation('death hover', () => this._inputController?.refreshHoverInfo(), {
      scene: this,
    });
    this.dangerZoneStale = true;
    safeBattlePresentation('death pinned threats', () => this._pinnedThreats?.invalidate(), {
      scene: this,
    });
    // Boss death: the bar drains away; FOE VANQUISHED when the battle goes on
    // (seize maps always -- the throne is still to take).
    if (unit.isBoss && unit.faction === 'enemy') {
      safeBattlePresentation('boss death', () => this._bossPresence?.onBossDefeated(), {
        scene: this,
      });
      if (
        shouldShowFelled({
          objective: this.battleConfig.objective,
          remaining: this.enemyUnits.length,
          reviving: this._zombieTombstones?.length || 0,
        })
      )
        safeBattlePresentation('boss defeated banner', () => this._showBossDefeatedBanner(), {
          scene: this,
        });
    }
    safeBattlePresentation('death objective', () => this.updateObjectiveText(), { scene: this });
    // A prologue chapter's beats on this fall (Varro: his line, then the seize note; a
    // protected unit: the chapter's restart) own this interval: the death's remaining
    // side effects, the combat that caused it and the enemy phase all wait for them.
    if (this._prologue) {
      await safeBattlePresentation('prologue fall beats', () => this._prologue.onUnitDefeated(unit), { scene: this }); // prettier-ignore
      if (!isCurrentBattleSession(this, session)) return;
    }

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
          const { stoneBroken, bannerHeld } = damageUnitDetailed(victim, effect.amount, {
            blessings: this._battleBlessings,
          });
          if (bannerHeld) this._noteBannerHold(victim);
          safeBattlePresentation(
            'Deathburst',
            () => {
              this.updateHPBar(victim);
              if (stoneBroken) this._stoneBreakFx().playBreak(victim);
              if (bannerHeld) this._bannerHoldFx().playHold(victim);
              const pos = this.grid.gridToPixel(victim.col, victim.row);
              const txt = this.add
                .text(pos.x, pos.y - 16, `${effect.amount}`, {
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: UI_PALETTE.warn,
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
            },
            { scene: this },
          );
          if (victim.currentHP <= 0) {
            await this.removeUnit(victim, { killer: unit });
            if (!isCurrentBattleSession(this, session)) return;
          }
        }
        await safeBattlePresentation(
          'Deathburst delay',
          () => this._awaitSceneDelay(150, { label: 'death_affix_chain_tick' }),
          { scene: this },
        );
        if (!isCurrentBattleSession(this, session)) return;
      }
    } finally {
      if (isCurrentBattleSession(this, session)) {
        unit._removing = false;
        this.grid?.clearTemporaryTerrainsBySource?.(unit);
        if (hasAoEDeathEffect) {
          this._deathAffixChainDepth = Math.max(0, (this._deathAffixChainDepth || 1) - 1);
          // The combat/shot owner removes its primary casualties with attribution
          // before sweeping and deciding victory. A chain must not steal that work.
        }
      }
    }
    if (!isCurrentBattleSession(this, session)) return;
    // Clear any temporary walls owned by this unit (waller affix cleanup)
    this.grid?.clearTemporaryTerrainsBySource?.(unit);
    unit._removing = false;
  }

  /** Reconcile all factions after effects/errors, through the normal death funnel. */
  async _sweepFallenUnits() {
    const session = battleSession(this);
    const fallen = [
      ...(this.playerUnits || []),
      ...(this.enemyUnits || []),
      ...(this.npcUnits || []),
    ];
    for (const unit of fallen) {
      if (!isCurrentBattleSession(this, session)) return;
      if (unit && unit.currentHP <= 0 && !unit._removing) await this.removeUnit(unit);
      if (!isCurrentBattleSession(this, session)) return;
    }
  }

  // --- Phase management ---

  onPhaseChange(phase, turn) {
    const session = battleSession(this);
    this._playerTurnStartPipelineTurn = null;
    this._playerTurnStartToken?.settle?.();
    const turnStartToken = {};
    this._playerTurnStartToken = turnStartToken;
    const rewindEpoch = this._enemyPhaseEpoch || 0;
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
        ? () => this._isSceneActiveForAsync(session)
        : () => isCurrentBattleSession(this, session);
    if (typeof this._clearCombatRollSession === 'function') this._clearCombatRollSession();
    if (this.isMobileInput) {
      this.inspectMode = false;
      if (this.inspectionPanel?.visible) this.inspectionPanel.hide();
      this.grid?.clearHighlights?.();
      this.grid?.clearAttackHighlights?.();
    }
    this.showPhaseBanner(phase, turn);
    this.dangerZoneStale = true;
    this._pinnedThreats?.invalidate();
    this._musicCtrl?.onPhaseStart(phase);
    if (!this.keepDangerVisible) this.dangerZone.hide();
    if (typeof this._expireTimedWeaponArtBuffs === 'function') {
      this._expireTimedWeaponArtBuffs(phase, turn);
    }

    if (phase === 'player') {
      // Deeds: the enemy phase that just ended (held ground, the lord's shield).
      if (turn > 1) deedsFor(this).onEnemyPhaseEnd(turn);
      resetPlayerUnitsForTurn(this, turn);
      // Input stays locked through the banner AND every awaited effect.
      this.battleState = 'TURN_START_RESOLVING';
      const isCurrentTurnStart = () =>
        this._playerTurnStartToken === turnStartToken &&
        (this._enemyPhaseEpoch || 0) === rewindEpoch &&
        isSceneActiveForAsync() &&
        this.turnManager?.currentPhase === 'player' &&
        this.turnManager?.turnNumber === turn &&
        this.battleState === 'TURN_START_RESOLVING' &&
        !this.visionDialog;

      let settleTurnStart;
      const turnStartSettled = new Promise((resolve) => {
        settleTurnStart = () => {
          this.events?.off?.('shutdown', settleTurnStart);
          resolve();
        };
      });
      turnStartToken.settle = settleTurnStart;
      this.events?.once?.('shutdown', settleTurnStart);
      const schedulePlayerHint = (delay, label, callback, options) =>
        scheduleSafeDelayedAsync(
          delay,
          label,
          async () => {
            if (!isSceneActiveForAsync()) return;
            await turnStartSettled;
            if (
              !isSceneActiveForAsync() ||
              this._playerTurnStartToken !== turnStartToken ||
              (this._enemyPhaseEpoch || 0) !== rewindEpoch ||
              this.turnManager?.currentPhase !== 'player' ||
              this.turnManager?.turnNumber !== turn ||
              this.battleState !== 'PLAYER_IDLE'
            )
              return;
            await callback();
          },
          options,
        );

      // Condition recovery runs FIRST so sleeping/silenced units get their chance
      // before the all-sleeping auto-advance check. NPC allies (the caravan,
      // recruits) share the army's turn start, after the army (armyAndNpcAllies).
      const earlyRecovery = processConditionRecovery(
        armyAndNpcAllies(this.playerUnits, this.npcUnits),
      );
      for (const evt of earlyRecovery) {
        const labelByCondition = {
          sleep: 'woke up',
          silence: 'recovered from Silence',
          acid: 'recovered from Acid',
          root: 'can move again',
        };
        const label = labelByCondition[evt.conditionId] || `recovered from ${evt.conditionId}`;
        if (this._showsTurnEffectOn(evt.unit))
          this.showBriefBanner(`${evt.unit.name} ${label}!`, UI_PALETTE.good);
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
      (this.renderTurnCounter || BattleScene.prototype.renderTurnCounter).call(this, turn);
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
      this.updateVisionHud();

      // Process turn-start effects (skills + affixes) (after banner settles).
      // NPC allies take the army's turn start with it: an aura or fort mends
      // them, acid ticks on them (armyAndNpcAllies, after the army).
      scheduleSafeDelayedAsync(
        1200,
        'player_phase_turn_start_pipeline',
        async () => {
          try {
            // A prologue chapter's note or lines still on screen (a sequence that
            // began on the enemy phase) hold the battle state: wait for them to be
            // read instead of mistaking the note's state for a superseded turn.
            await this._prologue?.idle?.();
            if (!isCurrentTurnStart()) return;
            await this.processTurnStartEffects(armyAndNpcAllies(this.playerUnits, this.npcUnits), {
              skipRecovery: true,
              isCurrent: isCurrentTurnStart,
            });
            if (!isCurrentTurnStart()) return;
            await this.processBallistaFire(this.enemyUnits, 'player', isCurrentTurnStart);
            if (!isCurrentTurnStart()) return;
            // Vision returns to the playable turn boundary: all automatic
            // effects have resolved, and none need replaying (or rerolling).
            this.captureVisionSnapshot();
            this.updateVisionHud();
            const presentedLevelUps = Boolean(this._pendingLevelUpPopups?.length);
            if (presentedLevelUps) this._captureSuspendCheckpoint?.({ session: session });
            // EXP gauges with them (or alone: presentation only, no checkpoint of their own).
            if (presentedLevelUps || this._pendingXpGauges?.length) {
              await presentQueuedProgress(this, null, { session: session });
              if (!isCurrentTurnStart()) return;
            }
            this.battleState = 'PLAYER_IDLE';
            this.refreshEndTurnControl();
            if (shouldAutoAdvance) {
              this.turnManager.endPlayerPhase();
            } else {
              // Only a fully resolved turn start is safe to resume.
              this._timelineBoundary = 'turn_start';
              this._captureSuspendCheckpoint?.({
                preserveRng: presentedLevelUps,
                session: session,
              });
            }
          } finally {
            // Errors still resolving this phase settle after the recovery below.
            if (!isCurrentTurnStart()) settleTurnStart();
          }
        },
        {
          phase: 'player',
          turn,
          onError: async () => {
            settleTurnStart();
            // Do not strand input after a reported animation/effect failure, or
            // overwrite a defeat, rewind prompt, shutdown, or replacement phase.
            if (!isCurrentTurnStart()) return;
            this.captureVisionSnapshot();
            this.updateVisionHud();
            this.battleState = 'PLAYER_IDLE';
            this.refreshEndTurnControl();
            if (shouldAutoAdvance) this.turnManager.endPlayerPhase();
            else
              this.showBriefBanner?.(
                'Turn-start effect interrupted. You may continue.',
                UI_PALETTE.warn,
              );
          },
        },
      );
      // From here the pipeline (or its onError) owns handing this turn to
      // the player; an enemy-phase recovery must not also do it.
      this._playerTurnStartPipelineTurn = turn;

      if (!shouldAutoAdvance) {
        // A prologue chapter's beats own the turn start (its coach shows once the
        // banner clears); a run battle gets its first-turn field notes.
        if (this._prologue) {
          this._prologue.onPhaseStart('player', turn, { schedule: schedulePlayerHint });
        } else {
          const hints = this.registry.get('hints');
          if (hints && turn === 1) {
            schedulePlayerHint(
              1500,
              'battle_first_turn_hints',
              async () => {
                if (!isSceneActiveForAsync() || this.battleState !== 'PLAYER_IDLE') return;
                const objective = this.battleParams.objective;
                // A recruit battle opens without a lesson dialog: the Guidance field
                // note (guide_recruit_on_map) names the recruit, never blocks, and
                // honours Guidance Off. Other first-battle lessons wait for a later fight.
                if (hasRecruitNpc(this.npcUnits)) return;
                if (objective === 'seize')
                  showContextualHint(
                    this,
                    'battle_seize',
                    'Seize: defeat the boss, then move a Lord onto the throne and choose Seize.',
                  );
                else if (objective === 'escape')
                  showContextualHint(
                    this,
                    'battle_escape',
                    'Escape: bring your Lords to the green exits. The surviving army retreats when the last Lord leaves.',
                  );
                else
                  showContextualHint(
                    this,
                    'battle_par',
                    'Par is the target turn count. Faster clears earn bonus gold; weigh that reward against keeping your army safe.',
                  );
                if (this.getVisionChargesRemaining() > 0)
                  showContextualHint(
                    this,
                    'battle_vision_scope_v2',
                    'Rewind lists every moment you can return to: before each unit acted this turn, and earlier turns. Tap one to preview it for free; Rewind here spends 1 charge. Black Sun returns to turn starts only. Repeating the same actions keeps the same outcomes. Charges last the run, with +1 after each act boss.',
                  );
              },
              { phase: 'player', turn },
            );
          } else if (hints && turn === 2) {
            this.time.delayedCall(1500, () => {
              if (!hints.hasSeen('battle_danger_zone')) {
                showContextualHint(
                  this,
                  'battle_danger_zone',
                  inputHint(
                    this,
                    'Press [D] to show enemy threat range.',
                    'Tap Danger to show enemy threat range. Hold Danger to keep it visible while planning; tap again to hide it.',
                  ),
                );
              }
            });
          }
        } // end else (run battle hints)
      }
    } else if (phase === 'enemy') {
      this.battleState = 'ENEMY_PHASE';
      // A contact (Grid.revealContact) lasts the player phase it was made in: the foes move now.
      if (this.grid?.clearContacts?.()) revealSettledVision(this);
      this._prologue?.onPhaseStart('enemy', turn);
      // Siege casters take their stance from the board the player left, before any
      // phase-start blow (hazards, ballistas) can empty a ring Danger drew (SiegeArtillery).
      settleArtilleryStances({ enemyUnits: this.enemyUnits, playerUnits: this.playerUnits, turn });
      // A fresh enemy phase (including one replayed after a Vision rewind)
      // has not applied its reinforcements yet.
      this._enemyPhaseReinforcedTurn = null;
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
          const saveGate = this._saveRetryGate(session);
          if (saveGate) {
            await saveGate;
            if (
              !isCurrentBattleSession(this, session) ||
              this.battleState === 'BATTLE_END' ||
              this._fatalDecision ||
              this._fatalCapturePending ||
              this._defeatDecision
            )
              return;
          }
          // The army's end-of-phase hazards also reach its NPC allies.
          await this.processTerrainDamage(armyAndNpcAllies(this.playerUnits, this.npcUnits));
          await this.processTurnStartEffects(this.enemyUnits);
          await this.processZombieRevival();
          await this.processNecromancy();
          await this.processBallistaFire(this.playerUnits, 'enemy');
          this.applyDueHybridOverridesForTurn(turn);
          await this.startEnemyPhase();
        },
        { phase: 'enemy', turn, onError: (err) => this._recoverEnemyPhaseError(turn, err) },
      );
    }
    this.refreshEndTurnControl();
  }

  /** Apply all turn-start effects (skills, affixes, terrain) in unified sequence */
  async processTurnStartEffects(units, { skipRecovery = false, isCurrent = () => true } = {}) {
    const session = battleSession(this);
    if (!isCurrent()) return;
    // 0. Status condition recovery (sleep/silence)
    // Player-phase recovery runs early (before all-sleeping check), so skip here
    if (!skipRecovery) {
      const recoveryEvents = processConditionRecovery(units);
      for (const evt of recoveryEvents) {
        if (!isCurrent()) return;
        const labelByCondition = {
          sleep: 'woke up',
          silence: 'recovered from Silence',
          acid: 'recovered from Acid',
          root: 'can move again',
        };
        const label = labelByCondition[evt.conditionId] || `recovered from ${evt.conditionId}`;
        if (this._showsTurnEffectOn(evt.unit))
          await this.showBriefBanner(`${evt.unit.name} ${label}!`, UI_PALETTE.good);
        if (!isCurrentBattleSession(this, session)) return;
        if (!isCurrent()) return;
        this._removeConditionIcon(evt.unit, evt.conditionId);
        this.undimUnit(evt.unit);
      }
    }

    // 0b. Acid tick damage (non-lethal, maxHP-scaled)
    await this._processAcidTicks(units, isCurrent);
    if (!isCurrentBattleSession(this, session)) return;
    if (!isCurrent()) return;

    // 1. Skill effects (e.g. Renewal)
    const skillEffects = getTurnStartEffects(
      units,
      this.gameData.skills,
      this.gameData.marks,
      this.turnManager?.turnNumber,
    );
    for (const effect of skillEffects) {
      if (!isCurrent()) return;
      if (effect.type === 'heal' && effect.amount > 0) {
        healUnit(effect.target, effect.amount);
        this.updateHPBar(effect.target);
        if (this._showsTurnEffectOn(effect.target))
          await this.animateHeal(effect.target, effect.amount);
        if (!isCurrentBattleSession(this, session)) return;
      } else if (effect.type === 'buff' && effect.entry) {
        // Mark of the Road: +1 MOV until the player phase ends (TimedWeaponArtBuffs).
        applyTimedBuffEntry(effect.target, effect.entry);
        this.showMarkProc(effect.target, `${effect.source}: +${effect.entry.stats.MOV} MOV`);
      }
    }

    // 1b. Captain's Whistle (an earned blessing): +MOV to the army on turn 1's player phase,
    // a timed buff that ends as that turn's enemy phase starts (engine/BattleBlessings.js).
    // A resume never runs this pipeline: the buff rides the checkpoint's units.
    if (!isCurrent()) return;
    const whistle = blessingTurnStartEffects(
      units,
      this._battleBlessings,
      this.turnManager?.turnNumber,
    );
    for (const effect of whistle) applyTimedBuffEntry(effect.target, effect.entry);
    if (whistle.length > 0) {
      await safeBattlePresentation(
        "Captain's Whistle",
        () =>
          this.showBriefBanner(
            `${WHISTLE_NAME}: +${whistle[0].entry.stats.MOV} Move this turn`,
            UI_PALETTE.good,
          ),
        { scene: this },
      );
      if (!isCurrentBattleSession(this, session)) return;
    }

    // 2. Affix effects (e.g. Regenerator, Waller)
    if (!isCurrent()) return;
    const affixEffects = getTurnStartAffixes(units, this.gameData.affixes);
    for (const effect of affixEffects) {
      if (!isCurrent()) return;
      if (effect.type === 'heal' && effect.amount > 0) {
        healUnit(effect.target, effect.amount);
        this.updateHPBar(effect.target);
        if (this._showsTurnEffectOn(effect.target))
          await this.animateHeal(effect.target, effect.amount);
        if (!isCurrentBattleSession(this, session)) return;
      } else if (effect.type === 'spawn_terrain') {
        await this.executeWallerSpawn(effect);
        if (!isCurrentBattleSession(this, session)) return;
      }
    }

    // 3. Terrain healing (Fort/Throne)
    if (isCurrent()) await this.processTerrainHealing(units, isCurrent);
    if (!isCurrentBattleSession(this, session)) return;
  }

  async _processAcidTicks(units, isCurrent = () => true) {
    const session = battleSession(this);
    for (const unit of units) {
      if (!isCurrent()) return;
      if (!unit || unit.currentHP <= 0 || !isAcidPoisoned(unit)) continue;
      const tickDamage = computeAcidDamage(unit.stats?.HP);
      // The ground's own damage: it never disturbs a holder (HoldDisturbance).
      const appliedDamage = damageUnit(unit, tickDamage, { floor: 1, disturbs: false });
      if (appliedDamage <= 0) continue;
      this.updateHPBar(unit);
      if (this._showsTurnEffectOn(unit)) await this.showAcidDamage(unit, appliedDamage);
      if (!isCurrentBattleSession(this, session)) return;
    }
  }

  /**
   * Whether a phase effect on `unit` (a heal, a hazard, a recovery banner) is shown.
   * The effect always applies; an NPC ally the fog hides takes it unseen, so turn
   * starts never reveal where it stands. The army's and enemies' effects show as before.
   */
  _showsTurnEffectOn(unit) {
    return unit?.faction !== 'npc' || canInspectUnit(this.grid, unit);
  }

  /** Backward-compatible alias for older call sites/cherry-picks. */
  async processTurnStartSkills(units) {
    return this.processTurnStartEffects(units);
  }

  async processBallistaFire(targetUnits, owner, isCurrent = () => true) {
    const session = battleSession(this);
    const phaseCurrent = isCurrent;
    isCurrent = () => isCurrentBattleSession(this, session) && phaseCurrent();
    if (!this.ballistas || this.ballistas.length === 0) return;
    const reduced = this._reduceMotion();
    for (const ballista of this.ballistas) {
      if (!isCurrent()) return;
      if (ballista.owner !== owner) continue;
      const target = selectBallistaTarget(ballista, targetUnits);
      if (!target) continue;
      const result = resolveBallistaStrike(ballista, target);
      const struck = result.didHit
        ? damageUnitDetailed(target, result.damage, { blessings: this._battleBlessings })
        : null;
      const stoneBroken = Boolean(struck?.stoneBroken);
      const bannerHeld = Boolean(struck?.bannerHeld);
      if (bannerHeld) this._noteBannerHold(target);
      // Presentation of the resolved shot: the bolt flies before the number shows.
      await safeBattlePresentation(
        'ballista shot',
        () =>
          (this._combatFx ||= new CombatFxController(this)).ballistaShot(ballista, target, {
            hit: result.didHit,
            seed: (this.turnManager?.turnNumber || 0) * 97 + ballista.col * 13 + ballista.row,
          }),
        { scene: this },
      );
      if (!isCurrent()) return;
      if (result.didHit) {
        await safeBattlePresentation(
          'ballista hit',
          async () => {
            this.updateHPBar(target);
            if (stoneBroken) this._stoneBreakFx().playBreak(target);
            if (bannerHeld) this._bannerHoldFx().playHold(target);
            if (target.graphic) {
              const pos = this.grid.gridToPixel(target.col, target.row);
              const txt = this.add
                .text(pos.x, pos.y - 16, `${result.damage}`, {
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: UI_PALETTE.warn,
                  fontStyle: 'bold',
                })
                .setOrigin(0.5)
                .setDepth(301);
              await this._awaitSceneTween(
                {
                  targets: txt,
                  y: reduced ? pos.y - 16 : pos.y - 32,
                  alpha: 0,
                  duration: 600,
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
          },
          { scene: this },
        );
        if (!isCurrent()) return;
        if (target.currentHP <= 0) {
          await this.removeUnit(target, { killer: null });
          if (!isCurrentBattleSession(this, session)) return;
          if (!isCurrent()) return;
          await this._sweepFallenUnits();
          if (!isCurrent()) return;
          this.checkBattleEnd();
          if (this.battleState === 'BATTLE_END') return;
        }
      } else if (target.graphic) {
        await safeBattlePresentation(
          'ballista miss',
          async () => {
            const pos = this.grid.gridToPixel(target.col, target.row);
            const txt = this.add
              .text(pos.x, pos.y - 16, 'Miss', {
                fontFamily: 'monospace',
                fontSize: '11px',
                color: UI_PALETTE.muted,
                fontStyle: 'bold',
              })
              .setOrigin(0.5)
              .setDepth(301);
            await this._awaitSceneTween(
              {
                targets: txt,
                y: reduced ? pos.y - 16 : pos.y - 32,
                alpha: 0,
                duration: 600,
                onComplete: () => {
                  txt.destroy();
                },
              },
              {
                label: 'ballista_miss_float',
                onCancel: () => txt.destroy(),
              },
            );
          },
          { scene: this },
        );
      }
    }
  }

  /** Enemy-phase start: remains tick, rise or crumble (ZombieRemainsController). */
  async processZombieRevival() {
    const session = battleSession(this);
    await remainsOf(this).processRevival();
    if (!isCurrentBattleSession(this, session)) return;
  }

  /**
   * Enemy-phase start, after the remains tick: each Necromancer with fewer than two living
   * Skeletons raises one (engine/Necromancy.js, NecromancyController).
   */
  async processNecromancy() {
    const session = battleSession(this);
    if (!this.enemyUnits.some(isNecromancer)) return;
    await necromancyOf(this).processRaises();
    if (!isCurrentBattleSession(this, session)) return;
  }

  _zombieRemains() {
    return remainsOf(this);
  }

  /** Handle the Waller affix terrain creation */
  async executeWallerSpawn(effect) {
    const session = battleSession(this);
    if (!isCurrentBattleSession(this, session)) return;
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
      if (!this.grid.fogEnabled || this.grid.isVisible(pick.col, pick.row))
        observeHistoryAction(this, 'created terrain', unit, null, effect.terrainType);
      // Visual feedback
      const pos = this.grid.gridToPixel(pick.col, pick.row);
      this.showMinorHintAt(pos.x, pos.y, 'Wall!', UI_PALETTE.text);
    }
  }

  /** A Mark's proc, floated over its bearer (Mark of the Forge, Mark of the Road). */
  showMarkProc(unit, text) {
    if (!unit || !this._showsTurnEffectOn(unit)) return;
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    safeBattlePresentation(
      'mark proc hint',
      () => this.showMinorHintAt(pos.x, pos.y, text, UI_PALETTE.mark),
      { scene: this },
    );
  }

  showMinorHintAt(x, y, message, color = UI_PALETTE.accentText) {
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
    applyBattleDebuff(unit, stat, value);
  }

  clearBattleScopedDeltas(units) {
    clearBattleScopedDeltas(units);
  }

  /** Heal units standing on Fort or Throne at turn start */
  async processTerrainHealing(units, isCurrent = () => true) {
    const session = battleSession(this);
    for (const unit of units) {
      if (!isCurrent()) return;
      // engine/TerrainHealing.js: the amount and the Fort streak (shared with the harness).
      const healAmount = settleTerrainHeal(unit, this.grid.mapLayout[unit.row]?.[unit.col]);
      if (healAmount <= 0) continue;
      healUnit(unit, healAmount);
      this.updateHPBar(unit);
      if (this._showsTurnEffectOn(unit)) await this.animateHeal(unit, healAmount);
      if (!isCurrentBattleSession(this, session)) return;
    }
  }

  async processTerrainDamage(units) {
    const session = battleSession(this);
    // Lava burns are named together once the pass is done: the floating number alone
    // was easy to miss, most of all on a phone's shrunken board.
    const burned = [];
    for (const unit of [...units]) {
      if (!unit || unit._removing || unit.currentHP <= 0) continue;
      if (isEntity(unit)) continue; // Entity immune to terrain hazards
      const terrainIdx = this.grid.mapLayout[unit.row]?.[unit.col];
      if (isLavaCrackTerrainIndex(terrainIdx)) {
        if (!lavaBurnsUnit(unit)) continue; // Fliers pass over the crack unburned
        const { nextHP, appliedDamage } = computeLavaCrackHp(unit.currentHP, LAVA_CRACK_DAMAGE);
        if (appliedDamage <= 0) continue;
        setUnitHP(unit, nextHP, { disturbs: false }); // terrain never disturbs a holder
        this.updateHPBar(unit);
        const shown = this._showsTurnEffectOn(unit);
        if (shown) {
          burned.push(`${unit.name} -${appliedDamage}`);
          await this.showTerrainDamage(unit, appliedDamage);
          if (!isCurrentBattleSession(this, session)) return;
        }
        // Lava damage wakes sleeping units
        if (isSleeping(unit)) {
          removeCondition(unit, 'sleep');
          this._removeConditionIcon(unit, 'sleep');
          // Un-dim only units that can still act — keep the acted-grey on
          // units that already moved this phase (same pattern as cures).
          if (!unit.hasActed) this.undimUnit(unit);
          if (shown)
            await this.showBriefBanner(`${unit.name} woke up from lava damage!`, UI_PALETTE.warn);
          if (!isCurrentBattleSession(this, session)) return;
        }
        await this._checkPhoenixBrooch(unit);
        if (!isCurrentBattleSession(this, session)) return;
        continue;
      }

      if (!isAcidTerrainIndex(terrainIdx)) continue;
      if (unit.moveType === 'Flying') continue;
      if (unit.poisonImmune || unit.terrainHazardImmune) continue;

      const shown = this._showsTurnEffectOn(unit);
      if (!applyCondition(unit, 'acid', undefined, { disturbs: false })) {
        // statusImmunity accessory — surface the block like the staff/art paths
        const pos = this.grid.gridToPixel(unit.col, unit.row);
        if (shown) this.showMinorHintAt(pos.x, pos.y, 'Immune!', UI_PALETTE.good);
        continue;
      }
      this._addConditionIcon(unit, 'acid');
      if (!shown) {
        // Its badge stays hidden with it until the army sees it (updateEnemyVisibility).
        unit._conditionIcons?.acid?.setVisible?.(false);
        continue;
      }
      {
        const pos = this.grid.gridToPixel(unit.col, unit.row);
        (this._combatFx ||= new CombatFxController(this)).playStatus(pos.x, pos.y, 'acid');
      }
      await this.showBriefBanner(`${unit.name} is corroded by acid!`, UI_PALETTE.good);
      if (!isCurrentBattleSession(this, session)) return;
    }
    if (burned.length) await this.showBriefBanner(lavaBurnBanner(burned), UI_PALETTE.warn);
    if (!isCurrentBattleSession(this, session)) return;
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
        color: UI_PALETTE.warn,
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
        color: UI_PALETTE.good,
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

  /**
   * An exception anywhere in the enemy-phase pipeline (turn-start effects, AI,
   * animations, the tail) used to leave battleState at ENEMY_PHASE with cancel
   * and End Turn disabled and no visible error — a permanent lock, replayed on
   * every resume. Hand the turn back to the player instead: re-sync sprites,
   * finish the tail's bookkeeping, then end the phase (or the battle).
   * No-op when something else already owns the flow (battle end, a Vision
   * prompt, a rewind that replaced this phase, or scene shutdown).
   */
  _recoverEnemyPhaseError(turn, err = null) {
    if (!this._isSceneActiveForAsync?.(battleSession(this)) || this._sceneShutdownCleanedUp)
      return false;
    if (this.battleState === 'BATTLE_END' || this.visionDialog) return false;
    // The tail's endEnemyPhase() advances turn/phase before onPhaseChange runs,
    // so a throw inside the player handoff lands here already in turn + 1.
    if (this.turnManager?.currentPhase === 'player' && this.turnManager.turnNumber === turn + 1)
      return this._recoverPlayerHandoff(turn + 1, err);
    if (this.turnManager?.currentPhase !== 'enemy' || this.turnManager.turnNumber !== turn)
      return false;
    console.error('[BattleScene] enemy phase interrupted; returning control to player:', err);
    // Supersede the failed phase so any of its still-pending awaits bail.
    this._enemyPhaseEpoch = (this._enemyPhaseEpoch || 0) + 1;
    this._enemyActionCheckpoint = false;
    this._settleUnitSpritesAfterError();
    try {
      if (this._enemyPhaseReinforcedTurn !== turn) {
        this._enemyPhaseReinforcedTurn = turn;
        this.applyReinforcementsForTurn(turn);
      }
    } catch (reinforceErr) {
      console.warn('[BattleScene] reinforcements skipped after enemy phase error:', reinforceErr);
    }
    this._reinforcementsPendingThisTurn = false;
    if (this.checkBattleEnd() || this.battleState === 'BATTLE_END' || this.visionDialog)
      return true;
    try {
      this.turnManager.endEnemyPhase();
    } catch (handoffErr) {
      if (this.turnManager?.currentPhase !== 'player') throw handoffErr;
      return this._recoverPlayerHandoff(this.turnManager.turnNumber, handoffErr);
    }
    this.showBriefBanner?.('Enemy phase interrupted. Your turn.', '#ffcc88');
    return true;
  }

  /**
   * A throw inside onPhaseChange('player') leaves the turn advanced but the
   * board still locked in ENEMY_PHASE (or TURN_START_RESOLVING) with no
   * pipeline scheduled to unlock it. Give the player the turn directly,
   * skipping the turn-start effects that could not be scheduled.
   */
  _recoverPlayerHandoff(playerTurn, err = null) {
    const session = battleSession(this);
    if (this.battleState === 'BATTLE_END' || this.visionDialog) return false;
    if (this.battleState !== 'ENEMY_PHASE' && this.battleState !== 'TURN_START_RESOLVING')
      return false;
    if (this._playerTurnStartPipelineTurn === playerTurn) return false;
    console.error('[BattleScene] player phase handoff failed; unlocking the turn:', err);
    this._enemyPhaseEpoch = (this._enemyPhaseEpoch || 0) + 1;
    this._enemyActionCheckpoint = false;
    this._reinforcementsPendingThisTurn = false;
    this._playerTurnStartToken?.settle?.();
    this._playerTurnStartPipelineTurn = playerTurn;
    this._settleUnitSpritesAfterError();
    try {
      resetPlayerUnitsForTurn(this, playerTurn);
    } catch (resetErr) {
      console.warn('[BattleScene] player unit reset incomplete after handoff error:', resetErr);
      for (const u of this.playerUnits || []) {
        u.hasMoved = false;
        u.hasActed = false;
        u._movementSpent = 0;
      }
      stampTurnAnchors(this.playerUnits || [], playerTurn);
    }
    this.captureVisionSnapshot?.();
    this.updateVisionHud?.();
    this.battleState = 'PLAYER_IDLE';
    this.refreshEndTurnControl?.();
    // Checkpoint the unlocked turn so a reload does not replay into the
    // failed handoff from the previous enemy-phase checkpoint.
    try {
      this._timelineBoundary = 'turn_start';
      this._captureSuspendCheckpoint?.({ session: session });
    } catch (checkpointErr) {
      console.warn('[BattleScene] checkpoint skipped after handoff error:', checkpointErr);
    }
    this.showBriefBanner?.('Turn start interrupted. Your turn.', '#ffcc88');
    return true;
  }

  /** Stop in-flight unit tweens, then snap every sprite to its logical tile. */
  _settleUnitSpritesAfterError() {
    try {
      this._combatFx?.finishStrike?.();
    } catch {
      /* best effort */
    }
    for (const unit of [
      ...(this.playerUnits || []),
      ...(this.enemyUnits || []),
      ...(this.npcUnits || []),
    ]) {
      try {
        if (!unit?.graphic) continue;
        const parts = [
          unit.graphic,
          unit.label,
          unit.factionIndicator,
          unit.hpBar?.bg,
          unit.hpBar?.fill,
          ...(unit.affixPips || []),
        ].filter(Boolean);
        this.tweens?.killTweensOf?.(parts);
        this.updateUnitPosition(unit);
      } catch {
        /* best effort: a broken sprite must not block recovery */
      }
    }
  }

  async startEnemyPhase({ resume = false } = {}) {
    const session = battleSession(this);
    // Epoch token: a Vision rewind restores a player-phase snapshot while this
    // async pipeline may still be in flight (AI loop or the tail below). Every
    // step re-checks the epoch so a superseded phase can never act on, or
    // advance, the rewound state.
    this._enemyPhaseEpoch = (this._enemyPhaseEpoch || 0) + 1;
    const phaseEpoch = this._enemyPhaseEpoch;
    const phaseSuperseded = () =>
      !isCurrentBattleSession(this, session) ||
      phaseEpoch !== this._enemyPhaseEpoch ||
      this.battleState === 'BATTLE_END' ||
      this._sceneShutdownCleanedUp;
    // Defer rout victory until after reinforcements are applied (cleared below)
    this._reinforcementsPendingThisTurn = true;
    try {
      // Merchant Caravan: 1-tile greedy step toward its exit edge, before
      // enemy AI acts so enemies can react to the caravan's new position.
      if (!resume) this._caravanController?.stepTurn();
      // Debug: skip enemy phase entirely
      if (this.isDevToolsEnabled() && this._debugSkipEnemyPhase) {
        this._debugSkipEnemyPhase = false;
        if (this.battleState !== 'BATTLE_END') {
          // Mark before applying: a throw mid-wave must not let the error
          // recovery spawn the same wave a second time.
          this._enemyPhaseReinforcedTurn = this.turnManager.turnNumber;
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
            isCurrent: () => !phaseSuperseded() && !this.visionDialog,
            // The hold wake check runs once per turn, so a resumed phase skips it.
            turnNumber: this.turnManager.turnNumber,
            // A garrison pack the player can see leaves its post (HoldActivation).
            onHoldersWoke: async (woken) => {
              if (this.visionDialog || phaseSuperseded()) return;
              const seen = woken.filter(({ unit }) => canInspectUnit(this.grid, unit));
              if (!seen.length) return;
              await safeBattlePresentation(
                'holders woke',
                () => this.showBriefBanner('The garrison stirs!', UI_PALETTE.warn),
                { scene: this },
              );
              if (this._prologue && !phaseSuperseded())
                await safeBattlePresentation(
                  'prologue hold notes',
                  () => this._prologue.onHoldersWoke(seen),
                  { scene: this },
                );
            },
            onMoveUnit: (enemy, path) => {
              if (this.visionDialog || phaseSuperseded()) return Promise.resolve();
              return this.animateEnemyMove(enemy, path);
            },
            onHeal: (_enemy, target, result) => {
              if (this.visionDialog || phaseSuperseded()) return Promise.resolve();
              observeHistoryAction(this, 'healed', _enemy, target, `${result.healAmount} HP`);
              this.updateHPBar(target);
              this.showBriefBanner?.(
                `${target.name} healed ${result.healAmount} HP`,
                UI_PALETTE.good,
              );
              return Promise.resolve();
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
            onUnitDone: async (enemy) => {
              if (phaseSuperseded() || this.visionDialog) return;
              enemy.hasActed = true;
              this.dimUnit(enemy);
              // Village raze: a seek_tile bandit ending its move on the
              // intact village tile burns it down.
              this._villageController?.handleEnemyUnitDone(enemy);
              if (!phaseSuperseded() && !this.visionDialog) {
                if (!(this._historyBeats || []).length) observeHistoryAction(this, 'waited', enemy);
                this._historyActor = historyUnitVisible(this, enemy) ? enemy.battleEntityId : null;
                this._timelineBoundary = 'enemy_action';
                // The completed enemy is marked acted before saving. A reload
                // resumes only the remaining enemies, never this combat or XP.
                this._enemyActionCheckpoint = true;
                try {
                  this._captureSuspendCheckpoint?.({ session: session });
                } finally {
                  this._enemyActionCheckpoint = false;
                }
                const saveGate = this._saveRetryGate(session);
                if (saveGate) {
                  await saveGate;
                  if (
                    !isCurrentBattleSession(this, session) ||
                    this.battleState === 'BATTLE_END' ||
                    this._fatalDecision ||
                    this._fatalCapturePending ||
                    this._defeatDecision
                  )
                    return;
                }
                await presentQueuedProgress(this, null, { session });
              }
            },
          },
        );
      } finally {
        if (isCurrentBattleSession(this, session)) this.finalizeEnemyPhaseAiStats();
      }

      // End enemy phase. Skip the whole tail when the battle ended, when a
      // lord-death Vision prompt is pending (its outcome — rewind or defeat —
      // supersedes the tail), or when a rewind already replaced this phase.
      if (!phaseSuperseded() && !this.visionDialog) {
        await this.processTerrainDamage(this.enemyUnits);
        // Re-check after the await: terrain damage can kill the commander and open the
        // Vision prompt, and a rewind clicked during the animations invalidates
        // this phase entirely.
        if (!phaseSuperseded() && !this.visionDialog) {
          // Mark before applying: a throw mid-wave must not let the error
          // recovery spawn the same wave a second time.
          this._enemyPhaseReinforcedTurn = this.turnManager.turnNumber;
          this.applyReinforcementsForTurn(this.turnManager.turnNumber);
          this._reinforcementsPendingThisTurn = false;
          const ended = this.checkBattleEnd();
          if (!ended && !phaseSuperseded() && !this.visionDialog) {
            this.turnManager.endEnemyPhase();
          }
        }
      }
    } finally {
      if (isCurrentBattleSession(this, session)) this._reinforcementsPendingThisTurn = false;
    }
  }

  async animateEnemyMove(enemy, path) {
    const session = battleSession(this);
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
      if (!isCurrentBattleSession(this, session)) return;
      if (!this._isSceneActiveForAsync(session)) return;
    }

    rememberHistoryPath(this, enemy, finalPath, false);
    const dest = finalPath[finalPath.length - 1];
    enemy.col = dest.col;
    enemy.row = dest.row;
    this.updateUnitPosition(enemy);
    if (this.grid.fogEnabled) this.updateEnemyVisibility();
  }

  async executeEnemyStatusStaff(enemy, target) {
    const session = battleSession(this);
    const staff = enemy.statusStaff;
    if (!staff) return;
    const result = resolveStatusStaff(staff, enemy, target);
    observeHistoryAction(
      this,
      result.immune ? 'was blocked by' : result.hit ? 'afflicted' : 'missed',
      enemy,
      target,
      result.hit ? result.conditionId : '',
      { miss: !result.hit },
    );
    spendStaffUse(staff);
    if (result.immune) {
      await this.showBriefBanner(
        `${enemy.name} used ${staff.name}! ${target.name} is protected!`,
        UI_PALETTE.good,
      );
      if (!isCurrentBattleSession(this, session)) return;
      return;
    }
    const hitPct = Math.round(result.hitChance);
    if (result.hit) {
      const statusText =
        result.conditionId === 'sleep'
          ? `${target.name} fell asleep!`
          : `${target.name} was silenced!`;
      await this.showBriefBanner(
        `${enemy.name} used ${staff.name}! ${statusText} (${hitPct}%)`,
        UI_PALETTE.bad,
      );
      if (!isCurrentBattleSession(this, session)) return;
      this._addConditionIcon(target, result.conditionId);
      {
        const pos = this.grid.gridToPixel(target.col, target.row);
        (this._combatFx ||= new CombatFxController(this)).playStatus(
          pos.x,
          pos.y,
          result.conditionId,
          {
            from: enemy.graphic?.visible ? { x: enemy.graphic.x, y: enemy.graphic.y } : null,
            seed: this.turnManager?.turnNumber || 0,
          },
        );
      }
    } else {
      await this.showBriefBanner(
        `${enemy.name} used ${staff.name}! Miss! (${hitPct}%)`,
        UI_PALETTE.muted,
      );
      if (!isCurrentBattleSession(this, session)) return;
    }
  }

  _addConditionIcon(unit, conditionId) {
    this.refreshVisibleDangerZone?.();
    if (!unit?.graphic) return;
    // Remove existing icon for this condition
    this._removeConditionIcon(unit, conditionId);
    if (!unit._conditionIcons) unit._conditionIcons = {};
    const x = unit.graphic.x;
    const y = unit.graphic.y - 20;
    const iconMap = {
      sleep: { label: 'Zzz', color: '#6688ff' },
      silence: { label: 'X', color: UI_PALETTE.rarityEpic },
      acid: { label: 'Ac', color: UI_PALETTE.good },
      root: { label: 'Rt', color: '#cc9944' },
      wounded: { label: 'Wd', color: UI_PALETTE.bad },
    };
    const iconStyle = iconMap[conditionId] || { label: '?', color: UI_PALETTE.text };
    // Pixel seal badges (StatusBadges); the lettered text is the fallback.
    const icon =
      createStatusBadge(this, conditionId, x, y, 200) ||
      this.add
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
    this.refreshVisibleDangerZone?.();
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
    const y = unit.graphic.y - 20;
    const icons = Object.values(unit._conditionIcons).filter(Boolean);
    // Centred over the head, one badge width apart (letters used to collide).
    let x = unit.graphic.x - ((icons.length - 1) * STATUS_BADGE_SPACING) / 2;
    for (const icon of icons) {
      icon.setPosition(x, y);
      x += STATUS_BADGE_SPACING;
    }
  }

  async executeEnemyCombat(enemy, target) {
    const session = battleSession(this);
    this.resetFortHealStreak(enemy);
    const enemyHpAtStart = Math.max(0, Math.trunc(Number(enemy?.currentHP) || 0));
    const targetHpAtStart = Math.max(0, Math.trunc(Number(target?.currentHP) || 0));

    try {
      const ctx = this._prepareCombatContext(enemy, target, { isPlayerInitiator: false });
      const { result } = await this._runCombatResolution(enemy, target, ctx);
      if (!isCurrentBattleSession(this, session)) return;
      // Award XP to player defender if they survived: at least the survival
      // minimum, even with no counter (unarmed, out of reach) or no damage dealt.
      if (target.faction === 'player' && target.currentHP > 0) {
        const counterDamage = combatHpLost(result, 'attacker', enemyHpAtStart);
        await this.awardXP(target, enemy, enemy.currentHP <= 0, counterDamage, enemyHpAtStart, {
          survivedAttack: true,
        });
        if (!isCurrentBattleSession(this, session)) return;
      }

      // A prologue chapter's notes on this exchange (HP thresholds on the defender).
      if (this._prologue) {
        await safeBattlePresentation(
          'prologue combat notes',
          () =>
            this._prologue.onCombatResolved(enemy, target, {
              initiator: 'enemy',
              hpBefore: { attacker: enemyHpAtStart, defender: targetHpAtStart },
            }),
          { scene: this },
        );
        if (!isCurrentBattleSession(this, session)) return;
      }

      if (target.currentHP <= 0) await this.removeUnit(target, { killer: enemy });
      if (!isCurrentBattleSession(this, session)) return;
      if (enemy.currentHP <= 0) await this.removeUnit(enemy, { killer: target });
      if (!isCurrentBattleSession(this, session)) return;

      // Entity splash damage on adjacent tiles after primary attack
      if (isEntity(enemy) && enemy.currentHP > 0) {
        await this._applyEntitySplash(enemy, target);
        if (!isCurrentBattleSession(this, session)) return;
      }
      await this._sweepFallenUnits();
      if (!isCurrentBattleSession(this, session)) return;
      // A fatal cascade must decide defeat before a popup can checkpoint an
      // army with no commander. Victory still waits for the combat owner's XP.
      if (hasBattleDefeat(this.playerUnits, this.escapedUnits)) {
        this.checkBattleEnd();
        return;
      }

      if (
        this._fatalDecision ||
        this._fatalCapturePending ||
        this._defeatDecision ||
        this.battleState === 'BATTLE_END'
      )
        return;
      // Every death of this combat is settled (kill credit read the weapon that
      // struck): a survivor whose per-battle weapon ran dry switches weapons.
      await this._swapSpentWeapons(enemy, target);
      if (!isCurrentBattleSession(this, session)) return;
      await safeBattlePresentation(
        'boss half health',
        () => (this._battleBeats ||= new BattleBeatsController(this)).checkBossHalfHealth(),
        { scene: this },
      );
      if (!isCurrentBattleSession(this, session)) return;

      safeBattlePresentation(
        'defender low health',
        () => (this._battleBeats ||= new BattleBeatsController(this)).onLowHealth(target),
        { scene: this },
      );
      // An area art's other victims (result.areaCredits) get their line too.
      for (const { victim } of result.areaCredits || [])
        safeBattlePresentation(
          'area victim low health',
          () => (this._battleBeats ||= new BattleBeatsController(this)).onLowHealth(victim),
          { scene: this },
        );
      this.checkBattleEnd();
    } catch (err) {
      if (!isCurrentBattleSession(this, session)) return;
      reportAsyncError('battle_combat_domain_error', err, {
        battleState: this.battleState,
        phase: this.turnManager?.currentPhase,
        turn: this.turnManager?.turnNumber,
      });
      console.error('[BattleScene] enemy combat error:', err);
      try {
        if (target?.currentHP <= 0) await this.removeUnit(target, { killer: enemy });
        if (!isCurrentBattleSession(this, session)) return;
        if (enemy?.currentHP <= 0) await this.removeUnit(enemy, { killer: target });
        if (!isCurrentBattleSession(this, session)) return;
        await this._sweepFallenUnits();
        if (!isCurrentBattleSession(this, session)) return;
        this.checkBattleEnd();
      } catch (cleanupErr) {
        console.error('[BattleScene] enemy combat cleanup error:', cleanupErr);
      }
    } finally {
      if (isCurrentBattleSession(this, session)) {
        this._clearCombatRollSession();
      }
    }
  }

  /** Apply Entity AoE splash -- 0-2 random tiles within Manhattan 1 of primary target */
  async _applyEntitySplash(entity, primaryTarget) {
    const session = battleSession(this);
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
      const { bannerHeld } = damageUnitDetailed(victim, dmg, { blessings: this._battleBlessings });
      if (bannerHeld) this._noteBannerHold(victim);
      await safeBattlePresentation(
        'Entity splash',
        async () => {
          this.updateHPBar(victim);
          if (bannerHeld) this._bannerHoldFx().playHold(victim);
          const pos = this.grid.gridToPixel(tile.col, tile.row);
          (this._combatFx ||= new CombatFxController(this)).playOverlay(
            'fx_sig_entity',
            pos.x,
            pos.y,
          );
          this.showMinorHintAt(pos.x, pos.y, `Splash -${dmg}`, UI_PALETTE.rarityEpic);
          await this._awaitSceneDelay(200, { label: 'entity_splash_tick' });
        },
        { scene: this },
      );
      if (!isCurrentBattleSession(this, session)) return;
      if (victim.currentHP <= 0) {
        await this.removeUnit(victim, { killer: entity });
        if (!isCurrentBattleSession(this, session)) return;
      }
    }
    await this._sweepFallenUnits();
  }

  async executeEnemyBreak(enemy, tile) {
    const session = battleSession(this);
    if (!tile) return;
    const removed = this.grid.clearTemporaryTerrainAt?.(tile.col, tile.row);
    if (removed && (!this.grid.fogEnabled || this.grid.isVisible(tile.col, tile.row)))
      observeHistoryAction(this, 'broke terrain', enemy);
    const pos = this.grid.gridToPixel(tile.col, tile.row);
    this.showMinorHintAt(pos.x, pos.y, 'Break!', UI_PALETTE.accentText);
    await this._awaitSceneDelay(120, { label: 'enemy_break_hold' });
    if (!isCurrentBattleSession(this, session)) return;
  }

  showPhaseBanner(phase, turn) {
    this._phaseBanner?.destroy();
    this._phaseBanner = null;
    const label = phase === 'player' ? 'Player Phase' : 'Enemy Phase';
    const color = phase === 'player' ? UI_PALETTE.info : '#ff9999';
    const place =
      turn === 1 && phase === 'player'
        ? battlePlace(this.gameData, this.battleConfig, this.battleParams?.act).title
        : '';
    this._bossPresence?.sync();
    const band = hasDOMHost() ? this._getCeremonies().showPhase({ phase, turn, place }) : null;
    if (band) {
      this._phaseBanner = band;
      return;
    }
    const banner = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY,
        `Turn ${turn} - ${label}${place ? `\n${place}` : ''}`,
        {
          fontFamily: 'monospace',
          fontSize: place ? '15px' : '20px',
          align: 'center',
          wordWrap: { width: Math.max(160, this.cameras.main.width - 48) },
          color,
          backgroundColor: '#000000cc',
          padding: { x: 16, y: 8 },
        },
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(500);
    this._phaseBanner = banner;
    this._pinToScreen(banner);

    if (this._reduceMotion()) {
      banner.setAlpha(1);
      this.time.delayedCall(place ? 2200 : 420, () => banner.destroy());
    } else {
      this.tweens.add({
        targets: banner,
        alpha: 1,
        duration: 300,
        yoyo: true,
        hold: place ? 1800 : 800,
        onComplete: () => banner.destroy(),
      });
    }
  }

  _showBossDefeatedBanner() {
    const objective = this.battleConfig?.objective;
    const felled = hasDOMHost()
      ? this._getCeremonies().showBossFelled({
          objective,
          remaining: this.enemyUnits?.length || 0,
        })
      : null;
    if (felled) {
      this._pulseObjectiveText();
      return;
    }
    // Canvas fallback keeps its seize-only prompt.
    if (objective !== 'seize') return;
    const banner = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY - 30,
        'Boss defeated!\nSeize the throne with a Lord!',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: UI_PALETTE.good,
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
    this._pulseObjectiveText();
  }

  /** Pulse the desktop objective text to draw attention to the new goal. */
  _pulseObjectiveText() {
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
    if (
      this.battleState === 'BATTLE_END' ||
      this._fatalDecision ||
      this._fatalCapturePending ||
      this._defeatDecision
    )
      return true;
    if (this.visionDialog) return true;
    if (this._deathAffixChainDepth > 0) return false;
    // Commander defeat = immediate loss (permadeath rule -- other lords can
    // fall). An escaped commander is alive and safe, not fallen. Strict flag
    // check: stamped at battle setup and deserialize, so a missing flag means
    // the commander has fallen.
    const commanderEscaped = (this.escapedUnits || []).some((u) => u.isCommander);
    if (hasBattleDefeat(this.playerUnits, this.escapedUnits)) {
      // A prologue chapter never loses: no lord-death prompt, no onDefeat (it restarts).
      if (this._prologue?.onDefeatIntercept()) return true;
      if (this.showLordDeathVisionPrompt()) {
        return true;
      }
      this.onDefeat();
      return true;
    }
    // Rout: all enemies dead (and every required recruit in the army) = victory.
    // In the enemy phase it waits for the phase's end, where a clear field cancels the
    // turn's wave (applyReinforcementsForTurn), so victory then follows.
    if (this.battleConfig.objective === 'rout' && isRoutComplete(this.routObjectiveState())) {
      if (this._reinforcementsPendingThisTurn) return false;
      this.onVictory();
      return true;
    }
    // Escape: every living lord is out (the rule also resolves the case where
    // the last lord still on the field falls after another already escaped).
    if (this.battleConfig.objective === 'escape') {
      const lordsOnField = this.playerUnits.some((u) => u.isLord);
      if (commanderEscaped && !lordsOnField) {
        this.onVictory();
        return true;
      }
    }
    // Seize victory triggers via action menu 'Seize' button
    return false;
  }

  /**
   * What the rout's end reads (engine/RoutObjective.js): the enemies standing, the
   * remains rising, and the recruits the battle requires in the army (a prologue
   * chapter's; a standard run requires none). The harness reads the same predicate.
   */
  routObjectiveState() {
    return {
      enemyUnits: this.enemyUnits || [],
      zombieTombstones: this._zombieTombstones || [],
      requiredRecruits: battleRequiredRecruits({
        battleConfig: this.battleConfig,
        battleParams: this.battleParams,
        gameData: this.gameData,
      }),
      playerUnits: this.playerUnits || [],
      escapedUnits: this.escapedUnits || [],
    };
  }

  /** A rout with no enemy standing or rising: no more waves come (RoutObjective). */
  isRoutFieldClear() {
    return isRoutFieldClear({
      objective: this.battleConfig?.objective,
      enemyUnits: this.enemyUnits || [],
      zombieTombstones: this._zombieTombstones || [],
    });
  }

  /** The required recruits still outside the army (RoutObjective), by name. */
  pendingRequiredRecruits() {
    const state = this.routObjectiveState();
    return pendingRequiredRecruits(state.requiredRecruits, state.playerUnits, state.escapedUnits);
  }

  /**
   * The rout ladder's objective line (engine/RoutLadder.js): waves resolved, the next
   * one's turn, its most arrivals and its edge as drawn (a portrait board is turned).
   */
  getLadderObjectiveLine() {
    const rotation = this.grid?.board?.rotation || 'none';
    return routLadderObjectiveLine(this.getLadderStatus(), (edge) => displayEdge(edge, rotation));
  }

  /** Where the rout ladder stands (null without one); see getLadderObjectiveLine. */
  getLadderStatus() {
    const turn = Math.trunc(Number(this.turnManager?.turnNumber) || 0);
    const resolvedNow =
      this.turnManager?.currentPhase === 'enemy' && this._ladderResolvedTurn === turn;
    return routLadderStatus(this.battleConfig?.reinforcements, {
      resolvedThroughTurn: resolvedNow ? turn : turn - 1,
    });
  }

  updateObjectiveText() {
    if (!this.objectiveText) return;
    let label;
    let color = UI_PALETTE.accentText; // default gold
    if (this.battleConfig.objective === 'seize') {
      const bossAlive = this.enemyUnits.some((u) => u.isBoss && u.currentHP > 0);
      if (bossAlive) {
        label = 'Seize: Defeat boss, then capture throne';
        color = UI_PALETTE.bad; // red -- boss still alive
      } else {
        label = 'Seize: Capture throne with a Lord!';
        color = UI_PALETTE.good; // green -- ready to seize
      }
    } else if (this.battleConfig.objective === 'escape' && this._escapeController) {
      label = this._escapeController.getObjectiveLabel();
      color = UI_PALETTE.good; // green -- run for the exit
    } else {
      label = routObjectiveLabel({
        remaining: this.enemyUnits.length,
        reviving: this._zombieTombstones?.length || 0,
        pendingRecruits: this.pendingRequiredRecruits(),
      });
      const ladderLine = this.getLadderObjectiveLine();
      if (ladderLine) label += `\n${ladderLine}`;
    }
    if (hasRecruitNpc(this.npcUnits)) {
      label += `\n${this._recruitBeacon?.getObjectiveSuffix() || 'Recruit: Talk to green unit'}`;
    }
    const villageSuffix = this._villageController?.getObjectiveSuffix();
    if (villageSuffix) {
      label += `\n${villageSuffix}`;
    }
    this.objectiveText.setText(label);
    this.objectiveText.setColor(color);
  }

  isThreatPinned(unit) {
    return this.pinnedThreatEnemies?.has(unit) || false;
  }

  togglePinnedThreat(unit) {
    const changed = this._pinnedThreats?.toggle(unit) || false;
    this._mobileBattleHud?.sync();
    return changed;
  }

  refreshVisibleDangerZone() {
    this.dangerZoneStale = true;
    this._pinnedThreats?.invalidate();
    if (this.dangerZone?.visible) {
      this.dangerZoneCache = this.calculateDangerZone();
      this.dangerZone.show(this.dangerZoneCache);
      this.dangerZoneStale = false;
    }
  }

  /** True when a living player unit stands inside the visible enemy threat range. */
  _anyPlayerInDanger() {
    const tiles = this.calculateDangerZone();
    if (!tiles?.length) return false;
    const threatened = new Set(tiles.map((t) => `${t.col},${t.row}`));
    return (this.playerUnits || []).some(
      (unit) => unit && unit.currentHP > 0 && threatened.has(`${unit.col},${unit.row}`),
    );
  }

  /** Read-only view of this battle for ThreatForecast (danger, pins, threat sight). */
  threatContext() {
    return {
      grid: this.grid,
      enemyUnits: this.enemyUnits || [],
      ballistas: this.ballistas || [],
      positions: () => this.buildUnitPositionMap(),
      // Who the player knows of (the hold wake rule's targets): PlayerKnowledge.
      isKnown: (unit) => playerKnowledgeOf(this).isKnown(unit),
      costModifier: (unit) => this._getCostModifier(unit),
      areaArtOf: (unit) =>
        (this._weaponArtController ||= new WeaponArtController(this)).enemyAreaArt(unit),
    };
  }

  calculateDangerZone(onlyEnemy = null) {
    return computeDangerTiles(this.threatContext(), { onlyEnemy });
  }

  /** Hide/show enemy and NPC graphics based on fog visibility. */
  updateEnemyVisibility() {
    if (!this.grid.fogEnabled) return;
    if (this._zombieTombstones?.length) remainsOf(this).noteSeen();
    safeBattlePresentation('fog danger', () => this.refreshVisibleDangerZone?.(), { scene: this });
    for (const enemy of this.enemyUnits) {
      safeBattlePresentation(
        'enemy visibility',
        () => {
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
        },
        { scene: this },
      );
    }
    for (const npc of this.npcUnits) {
      safeBattlePresentation(
        'NPC visibility',
        () => {
          // The recruit shows through fog (canInspectUnit); the caravan does not.
          const vis = canInspectUnit(this.grid, npc);
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
          // Status badges (acid ground, an enemy art) hide with the NPC they sit on.
          Object.values(npc._conditionIcons || {}).forEach((icon) => icon?.setVisible?.(vis));
        },
        { scene: this },
      );
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
      skills: this.gameData?.skills,
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
    extraFocusTargets = [],
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
      if (typeof arrow.setColor === 'function')
        arrow.setColor(enabled ? UI_PALETTE.info : UI_PALETTE.lineStrong);
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
          color: UI_PALETTE.info,
        })
        .setOrigin(0.5)
        .setDepth(713)
        .setInteractive({ useHandCursor: true });
      scrollDown = this.add
        .text(arrowX, rowBottomBound - 10, 'v', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: UI_PALETTE.info,
        })
        .setOrigin(0.5)
        .setDepth(713)
        .setInteractive({ useHandCursor: true });
      const hint = this.add
        .text(arrowX, rowBottomBound + 2, 'Scroll', {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: UI_PALETTE.lineStrong,
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

    // --- Gamepad/keyboard focus over selectable rows + extra buttons ----------
    // A ring tracks the selectable row targets (scroll follows it) plus any extra
    // buttons (Convoy / Back). The loot-card ring beneath auto-hides while this
    // picker scope is on top (inputFocus onTopChange). Torn down with the picker.
    const focusEntries = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.selectable && rows[i]?.inputTarget) {
        focusEntries.push({ target: rows[i].inputTarget, rowIndex: i });
      }
    }
    for (const extra of extraFocusTargets) {
      if (extra) focusEntries.push({ target: extra, rowIndex: -1 });
    }

    if (focusEntries.length > 0) {
      const pickerFocus = new BoundingFocusController(this, 715);
      pickerFocus.setObjects(
        focusEntries.map((e) => e.target),
        true,
      );

      const ensureRowVisible = (rowIdx) => {
        if (rowIdx < 0) return;
        if (rowIdx < scrollOffset) setScrollOffset(rowIdx);
        else if (rowIdx >= scrollOffset + maxVisibleRows) {
          setScrollOffset(rowIdx - maxVisibleRows + 1);
        }
      };

      const moveFocus = (delta) => {
        if (!delta) return;
        pickerFocus.move(delta);
        const entry = focusEntries[pickerFocus.index];
        if (entry) {
          ensureRowVisible(entry.rowIndex);
          pickerFocus.refresh();
        }
      };

      const scopeOwner = {}; // unique identity for this picker instance
      const handler = (action, payload) => {
        switch (action) {
          case InputAction.NAVIGATE:
            moveFocus(payload?.dy || 0);
            break;
          case InputAction.CONFIRM:
            pickerFocus.activate(); // -> the row/convoy/back button's pointerdown
            break;
          case InputAction.CANCEL:
          case InputAction.PAUSE:
            if (typeof onBack === 'function') onBack();
            break;
        }
      };
      pushInputScope(scopeOwner, handler);
      detachHandlers.push(() => {
        popInputScope(scopeOwner);
        pickerFocus.destroy();
      });
    }

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

  showLootStatus(message, color = UI_PALETTE.bad) {
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
