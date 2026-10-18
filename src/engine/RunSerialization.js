// RunSerialization.js - a run as it is saved (RunManager.toJSON's plain object, before the
// run-format marker). Pure: reads the manager, writes nothing. The held blessings and the
// blessing runtime modifiers come from the manager, whose helpers own their shape.
import { normalizeDeploymentNames } from './DeploymentSelection.js';
import { PROLOGUE_RUN_MODE, STANDARD_RUN_MODE, isPrologueRun } from './ScriptedBattle.js';
import { sanitizeLegendaryGrants } from './LegendaryOwnership.js';
import { DIFFICULTY_DEFAULTS } from './DifficultyEngine.js';
import { ACT_SEQUENCE } from '../utils/constants.js';
import { createEclipseState } from './EclipseSystem.js';
import { sanitizeRite } from './Rite.js';
import { ITEM_NAMES_REVISION } from './ItemNameMigration.js';
import { sanitizeNgPlusRun } from './NgPlusRun.js';
import { sanitizeRunFeats } from './RunFeats.js';

/**
 * @param {object} rm - the RunManager
 * @param {{ activeBlessings: object[], blessingRuntimeModifiers: object }} blessings
 */
export function serializeRun(rm, blessings) {
  return {
    version: 1,
    mode: isPrologueRun(rm) ? PROLOGUE_RUN_MODE : STANDARD_RUN_MODE,
    ...(isPrologueRun(rm)
      ? {
          prologueVisionGranted: rm.prologueVisionGranted === true,
          prologueRosterLesson: rm.prologueRosterLesson
            ? structuredClone(rm.prologueRosterLesson)
            : null,
        }
      : {}),
    status: rm.status,
    actIndex: rm.actIndex,
    roster: rm.roster,
    lastDeployment: normalizeDeploymentNames(rm.lastDeployment),
    fallenUnits: rm.fallenUnits,
    nextUnitUid: rm.nextUnitUid,
    lastBattleCasualtyNotices: rm.lastBattleCasualtyNotices || [],
    nodeMap: rm.nodeMap,
    currentNodeId: rm.currentNodeId,
    completedBattles: rm.completedBattles,
    winStreak: rm.winStreak || 0,
    maxWinStreak: rm.maxWinStreak || 0,
    gold: rm.gold,
    metaEffects: rm.metaEffects,
    accessories: rm.accessories,
    scrolls: rm.scrolls,
    convoy: rm.convoy,
    randomLegendary: rm.randomLegendary || null,
    activeBlessings: blessings.activeBlessings,
    blessingHistory: rm.blessingHistory || [],
    blessingSelectionTelemetry: rm.blessingSelectionTelemetry || null,
    startGift: rm.startGift || null,
    blessingRuntimeModifiers: blessings.blessingRuntimeModifiers,
    runSeed: rm.runSeed,
    legendaryLordChance: rm.legendaryLordChance,
    runRecordId: rm.runRecordId,
    narrativeSeen: rm.narrativeSeen,
    totalTurns: rm.totalTurns,
    runLedger: rm.runLedger || null,
    rngSeed: rm.rngSeed,
    visionChargesRemaining: rm.visionChargesRemaining,
    visionCount: rm.visionCount,
    usedRecruitNames: rm.usedRecruitNames || {},
    battleConfigsByNodeId: rm.battleConfigsByNodeId || {},
    shopStateByNodeId: rm.shopStateByNodeId || {},
    ruinsChoiceByNodeId: rm.ruinsChoiceByNodeId || {},
    ruinsRevivedByNodeId: rm.ruinsRevivedByNodeId || {},
    churchRevivesByNodeId: rm.churchRevivesByNodeId || {},
    reviveDiscountAct: rm.reviveDiscountAct ?? null,
    lordRecruitOdds: rm.lordRecruitOdds || null,
    churchVowByNodeId: rm.churchVowByNodeId || {},
    churchTitheByNodeId: rm.churchTitheByNodeId || {},
    eventStateByNodeId: rm.eventStateByNodeId || {},
    eventLog: rm.eventLog || [],
    storyFlags: rm.storyFlags || {},
    burdens: rm.burdens || [],
    contract: rm.contract || null,
    contractOwed: rm.contractOwed || null,
    laidToRest: rm.laidToRest || [],
    earnedBlessingPicks: rm.earnedBlessingPicks || {},
    difficultyId: rm.difficultyId || 'normal',
    difficultyModifiers: rm.difficultyModifiers || {
      ...DIFFICULTY_DEFAULTS,
      actsIncluded: [...DIFFICULTY_DEFAULTS.actsIncluded],
    },
    actSequence: rm.actSequence || [...ACT_SEQUENCE],
    pendingAmbushNodeId: rm.pendingAmbushNodeId || null,
    pendingEventNodeId: rm.pendingEventNodeId || null,
    pendingCaravanShop: rm.pendingCaravanShop || null,
    pendingBattleReward: rm.pendingBattleReward || null,
    rewardRerollsSpent: Math.max(0, Math.trunc(Number(rm.rewardRerollsSpent) || 0)),
    legendaryGrants: sanitizeLegendaryGrants(rm.legendaryGrants),
    pendingBossRecruit: rm.pendingBossRecruit || null,
    pendingThirdLord: rm.pendingThirdLord || null,
    reachedFirstActBoss: rm.reachedFirstActBoss === true,
    metaBattlePoints: Math.max(0, Number(rm.metaBattlePoints) || 0),
    feats: sanitizeRunFeats(rm.feats),
    activeCaravanShop: rm.activeCaravanShop || null,
    endRunRewards: rm.endRunRewards || null,
    metaUnlockedWeaponArts: rm.metaUnlockedWeaponArts || [],
    actUnlockedWeaponArts: rm.actUnlockedWeaponArts || [],
    unlockedWeaponArts: rm.unlockedWeaponArts || [],
    shownDialogueKeys: rm.shownDialogueKeys || [],
    defeatContext: rm.defeatContext || null,
    runLordFalls: rm.runLordFalls || [],
    churchPromotionTracker: rm._churchPromotionTracker || null,
    noMetaMode: rm.noMetaMode || false,
    thirdLordJoined: rm.thirdLordJoined || false,
    thirdLordRerolled: rm.thirdLordRerolled || false,
    battleInProgress: rm.battleInProgress || null,
    lastBattleReport: rm.lastBattleReport || null,
    eclipse: rm.eclipse || createEclipseState(),
    rite: sanitizeRite(rm.rite),
    itemNamesRevision: ITEM_NAMES_REVISION,
    blessingBoonRevision: rm.blessingBoonRevision,
    // NG+ (engine/NgPlusRun.js): written only for an NG+ run, so every other save is unchanged.
    ...(rm.ngPlus ? { ngPlus: sanitizeNgPlusRun(rm.ngPlus) } : {}),
  };
}
