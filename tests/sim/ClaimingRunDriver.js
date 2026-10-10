// ClaimingRunDriver.js - a full run that claims what blessings v3 hands out (opt-in).
//
// The stock RunSimulationDriver (and every CI sim built on it) never takes a start blessing, a
// gift or an earned pick, never claims battle loot, never steals, swaps, rewinds, makes a second
// vow, forges or fights in the arena (PR #264-#271 list those blind spots). This driver plays the
// same run loop with the claiming policies of ClaimingPolicies.js, each switchable (`claims`), so
// `npm run sim:blessings` can measure the cards those choices reach and the guard test
// (BlessingClaimPolicies.test.js) can hold each choice alive. The stock driver is unchanged.
//
// How it plays (docs/sim-reports/blessings-v3-balance.md "Method"):
// * Battles: ClaimingAgent (TacticianAgent with Steal and post-rewind caution), with the run
//   attached to the battle (HeadlessBattle `runManager`: the run's blessings act in combat) and
//   the harness's opt-in Steal.
// * Casual commander: a commander KO is counted (it would have ended the run) and the commander
//   is restored to full HP so the run can be measured to its end, as `sim:strategy` does. Every
//   other fall is real: the unit joins the fallen (a church can revive it).
// * Vision: a fall the policy judges worth a charge (ClaimingPolicies.shouldRewindForFall) spends
//   one and rewinds to the start of that turn's player phase. A rewind replays the battle from its
//   entry state with the same dice (the stateful Math.random is put back, as the game's fixed-v1
//   rewind puts its stream back), re-playing the recorded choices up to the turn, then plays that
//   turn cautiously (ClaimingAgent `caution`). The run's convoy, accessories, gold and next uid
//   are put back with it (the battle's `runBattleState`, as BattleRewindTransaction does).
// * A battle past the turn cap (30) or the action budget is completed as won and counted as a
//   stall, as `sim:strategy` does.
//
// Everything the run does goes through the engine's commands; the driver only orders them as the
// scenes do (PostCombatController: completeBattle, rewards, boss recruit, then the earned pick
// before the act advances; ChurchController; ShopController; ColosseumOverlay; EventCommands).

import { RunManager } from '../../src/engine/RunManager.js';
import { clearBattleScopedDeltas } from '../../src/engine/BattleStatDeltas.js';
import { DEPLOY_LIMITS, GOLD_BATTLE_BONUS, NODE_TYPES } from '../../src/utils/constants.js';
import { getLatePressureState } from '../../src/engine/TurnBonusCalculator.js';
import { isRecruitBattleNode } from '../../src/engine/RecruitNodeSystem.js';
import { prepareBossRecruit, resolveBossRecruit } from '../../src/engine/PendingBossRecruit.js';
import { prepareThirdLord, resolveThirdLordArrival } from '../../src/engine/PendingThirdLord.js';
import {
  arriveAtEvent,
  completeEventBattle,
  eventSpoilsOwed,
  forfeitEventSpoils,
  leaveEvent,
} from '../../src/engine/EventCommands.js';
import { contractRewardOwedAt } from '../../src/engine/Contracts.js';
import {
  deliverContractSettlement,
  forfeitContractReward,
} from '../../src/engine/ContractSettlement.js';
import { earnedLedgerEntry, twistPriceOf } from '../../src/engine/EarnedBlessings.js';
import { isSanctum } from '../../src/engine/SanctumPass.js';
import { GameDriver } from '../harness/GameDriver.js';
import { HEADLESS_STATES } from '../harness/HeadlessBattle.js';
import { ClaimingAgent } from '../../sim/lib/ClaimingAgent.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';
import { chooseDeployRoster, skipOwedEarnedPick } from './RunPolicies.js';
import {
  chooseRecruitCandidate,
  chooseStartOffer,
  claimBattleRewards,
  equipAccessories,
  forgeAtShop,
  learnScrolls,
  playChurch,
  playClaimEventChoices,
  playColosseum,
  playRuins,
  shouldRewindForFall,
  takeOwedEarnedPicks,
  useItemsBetweenBattles,
  useMasterSeals,
} from './ClaimingPolicies.js';

/**
 * The claiming policies, each on by default in this driver. `startOffer` is 'random' | 'first' |
 * 'none' (ClaimingPolicies.chooseStartOffer); the rest are booleans.
 */
export const DEFAULT_CLAIMS = Object.freeze({
  startOffer: 'random',
  gift: true,
  earnedPicks: true,
  rewards: true,
  steal: true,
  recruitSwap: true,
  vision: true,
  church: true,
  colosseum: true,
  forge: true,
  items: true,
  scrolls: true,
  accessories: true,
  seals: true,
  bossRecruit: true,
  events: true,
  ruins: true,
});

export const CLAIM_IDS = Object.freeze(Object.keys(DEFAULT_CLAIMS));

// Route priority: the stock order (RunPolicies.chooseNode) with the services this player uses.
const CLAIM_NODE_PRIORITY = Object.freeze({
  [NODE_TYPES.RECRUIT]: 5,
  [NODE_TYPES.BATTLE]: 4,
  [NODE_TYPES.SHOP]: 3,
  [NODE_TYPES.EVENT]: 3,
  [NODE_TYPES.CHURCH]: 3,
  colosseum: 3,
  ruins: 2,
  [NODE_TYPES.BOSS]: 1,
});

/**
 * The node this player travels to: the stock order, deeper rows first among equals. An Old
 * Sanctum (the route map names it, in gilt) is worth a detour for its earned card: it ranks
 * just under a recruit.
 */
export function chooseClaimNode(available, claims = DEFAULT_CLAIMS) {
  if (!available?.length) return null;
  const score = (node) => {
    let base = CLAIM_NODE_PRIORITY[node.type] || 0;
    if (node.type === 'colosseum' && !claims.colosseum) base = 0;
    if (node.type === NODE_TYPES.CHURCH && !claims.church) base = 2;
    else if (node.type === NODE_TYPES.CHURCH && claims.earnedPicks && isSanctum(node)) base = 4.5;
    return base * 100 + (node.row || 0);
  };
  return [...available].sort((a, b) => score(b) - score(a))[0];
}

const MAX_REWINDS_PER_BATTLE = 3;

const keyForUnit = (unit) => `${unit.name}::${unit.className}`;

/** What a TacticianAgent carries from turn to turn (its plan and caches are rebuilt). */
function agentState(agent) {
  return { lastContactTurn: agent?.lastContactTurn ?? null };
}

function restoreAgentState(agent, saved) {
  if (agent && saved && saved.lastContactTurn != null)
    agent.lastContactTurn = saved.lastContactTurn;
}
const ids = (run) => run.getActiveBlessingIds?.() || [];

export class ClaimingRunDriver extends RunSimulationDriver {
  /**
   * @param {object} gameData
   * @param {object} options - RunSimulationDriver's, plus `claims` (DEFAULT_CLAIMS overrides),
   *   `rng` (StatefulRNG's handle: needed for Vision rewinds; without it no rewind is made),
   *   `turnCap` (30), `runsStarted` (1: a returning player, so the shrine may offer a gift)
   */
  constructor(gameData, options = {}) {
    super(gameData, {
      maxBattleActions: 9000,
      battleAgentFactory: (driver) => new ClaimingAgent(driver, { rescue: true, objectives: true }),
      ...options,
    });
    this.claims = { ...DEFAULT_CLAIMS, ...(options.claims || {}) };
    this.rng = options.rng || null;
    this.turnCap = Number.isFinite(options.turnCap) ? options.turnCap : 30;
    this.runsStarted = Number.isFinite(options.runsStarted) ? options.runsStarted : 1;
    // What each claiming policy did (the guard test reads these).
    this.claimCounts = {
      startBlessings: 0,
      startNone: 0,
      giftsOffered: 0,
      giftsTaken: 0,
      giftRefusals: 0,
      earnedOffers: 0,
      earnedTaken: 0,
      earnedTakenBySource: {},
      eventEarnedGrants: 0,
      sanctumTaken: 0,
      rewardClaims: 0,
      lotteryCardsOffered: 0,
      lotteryCardsTaken: 0,
      dawnTitheGold: 0,
      steals: 0,
      stealsSpeedWaived: 0,
      recruitAlternatesOffered: 0,
      recruitSwaps: 0,
      talkRecruits: 0,
      visionRewinds: 0,
      visionGraceRewinds: 0,
      replayMismatches: 0,
      churchVisits: 0,
      secondVows: 0,
      cleanses: 0,
      churchBlessings: 0,
      churchPromotions: 0,
      freePromotions: 0,
      revives: 0,
      titheGold: 0,
      colosseumBouts: 0,
      colosseumWins: 0,
      ledgerFeeSaved: 0,
      freeForges: 0,
      paidForges: 0,
      itemHeals: 0,
      convoyElixirHeals: 0,
      goldPouches: 0,
      boostersUsed: 0,
      skillScrollsLearned: 0,
      artScrollsBound: 0,
      accessoriesEquipped: 0,
      sealPromotions: 0,
      sealsRefused: 0,
      bossRecruits: 0,
      ruinsRests: 0,
      bannerHolds: 0,
      lanternHeals: 0,
      staffHeals: 0,
      carriersSeen: 0,
      stalls: 0,
      battleLosses: 0,
    };
    // Per card id: how many times its own mechanic did something this run (see the report).
    this.exercise = {};
    // How each card reached the run: [{ id, how, battleIndex, act }].
    this.acquired = [];
    // Every earned offer shown: [{ id, source, key, battleIndex, act, taken }].
    this.offers = [];
    // One record per battle fought.
    this.battleLog = [];
    this.startChoice = null;
  }

  _count(key, by = 1) {
    this.claimCounts[key] = (this.claimCounts[key] || 0) + by;
  }

  _exercise(id, by = 1) {
    if (!id || !(by > 0)) return;
    this.exercise[id] = (this.exercise[id] || 0) + by;
  }

  _held(id) {
    return ids(this.runManager).includes(id);
  }

  _noteAcquired(before, how) {
    const after = ids(this.runManager);
    for (const id of after)
      if (!before.includes(id))
        this.acquired.push({
          id,
          how,
          battleIndex: this.battleLog.length,
          act: this.runManager.currentAct,
        });
  }

  init() {
    const rm = new RunManager(this.gameData, this.options.metaEffects || null);
    this.runManager = rm;
    rm.startRun({
      ...(this.options.runOptions || {}),
      runsStarted: this.claims.gift ? this.runsStarted : 0,
    });
    const mode = this.claims.startOffer || 'none';
    const gift = rm.getStartGiftOffer?.();
    if (gift) this._count('giftsOffered');
    const before = ids(rm);
    this.startChoice = chooseStartOffer(rm, { mode: mode === false ? 'none' : mode });
    if (this.startChoice.kind === 'gift' && this.startChoice.ok) this._count('giftsTaken');
    else if (this.startChoice.kind === 'blessing') this._count('startBlessings');
    else this._count('startNone');
    if (this.startChoice.refused) this._count('giftRefusals');
    this._noteAcquired(before, this.startChoice.kind === 'gift' ? 'gift' : 'start');
    // A test's setup: cards the run holds from the start without being offered them (an earned
    // one as an earned grant), through the engine's own mid-run take. The report never uses it.
    const granted = ids(rm);
    for (const id of this.options.grantBlessings || []) {
      const blessing = (this.gameData.blessings?.blessings || []).find((b) => b.id === id);
      if (!blessing) throw new Error(`grantBlessings: unknown blessing "${id}"`);
      const ok = rm.addBlessingMidRun(id, {
        earned: blessing.earned === true,
        price: blessing.earned ? twistPriceOf(blessing) : null,
        source: blessing.earned ? 'event' : null,
      });
      if (!ok && !ids(rm).includes(id))
        throw new Error(`grantBlessings: "${id}" could not be added mid-run`);
    }
    this._noteAcquired(granted, 'granted');
  }

  async run() {
    if (!this.runManager) this.init();
    const rm = this.runManager;
    for (let step = 0; step < this.options.maxNodes; step++) {
      if (rm.isRunComplete()) return this._buildResult('victory');
      const available = rm.getAvailableNodes();
      if (!available?.length) return this._buildResult('stuck');
      // A node that holds the party (an event's spoils, a contract's reward): settle it.
      const current = available.length === 1 && available[0].completed ? available[0] : null;
      if (current) {
        if (!this._releaseHeldNode(current)) return this._buildResult('stuck');
        continue;
      }
      const node = chooseClaimNode(available, this.claims);
      this.metrics.nodesVisited++;
      const entry = {
        i: this.trace.length,
        act: rm.currentAct,
        nodeId: node.id,
        nodeType: node.type,
      };
      let result;
      if ([NODE_TYPES.BATTLE, NODE_TYPES.BOSS, NODE_TYPES.RECRUIT].includes(node.type))
        result = await this._claimBattleNode(node);
      else if (node.type === NODE_TYPES.SHOP) result = await this._claimShopNode(node);
      else if (node.type === NODE_TYPES.CHURCH) result = this._claimChurchNode(node);
      else if (node.type === NODE_TYPES.EVENT) result = await this._claimEventNode(node);
      else if (node.type === 'colosseum') result = this._claimColosseumNode(node);
      else if (node.type === 'ruins') result = this._claimRuinsNode(node);
      else {
        rm.markNodeComplete(node.id);
        result = { result: 'skipped' };
      }
      this.trace.push({ ...entry, ...result });
      if (result.result === 'timeout') return this._buildResult('timeout');
      this._afterNode();
      if (rm.isActComplete()) {
        this.metrics.eclipseShadowByAct[rm.currentAct] = rm.eclipse?.shadow ?? 0;
        if (rm.isRunComplete()) return this._buildResult('victory');
        rm.advanceAct();
        this.metrics.actsAdvanced++;
        this._afterAct();
      }
    }
    return this._buildResult('timeout');
  }

  _buildResult(result) {
    const base = super._buildResult(result);
    const rm = this.runManager;
    return {
      ...base,
      difficulty: rm.difficultyId,
      actSequence: Array.isArray(rm.actSequence) ? [...rm.actSequence] : null,
      startChoice: this.startChoice
        ? {
            kind: this.startChoice.kind,
            id: this.startChoice.id,
            offered: this.startChoice.offered.map((o) => `${o.kind}:${o.id ?? '-'}`),
          }
        : null,
      startGift: rm.startGift ? { id: rm.startGift.id } : null,
      heldAtEnd: ids(rm),
      acquired: this.acquired,
      offers: this.offers,
      battleLog: this.battleLog,
      claims: { ...this.claimCounts },
      exercise: { ...this.exercise },
    };
  }

  /** What the route map does when a completed node holds the party. */
  _releaseHeldNode(node) {
    const rm = this.runManager;
    if (eventSpoilsOwed(rm, node.id)) {
      const before = ids(rm);
      const done = completeEventBattle(rm, node.id);
      this._noteAcquired(before, 'event');
      if (!done?.ok && eventSpoilsOwed(rm, node.id)) forfeitEventSpoils(rm, node.id);
      return true;
    }
    if (contractRewardOwedAt(rm, node)) {
      const done = deliverContractSettlement(rm);
      if (!done?.ok) forfeitContractReward(rm);
      return true;
    }
    return false;
  }

  /** After every node: the owed earned picks, then the army's between-battle habits. */
  _afterNode() {
    const rm = this.runManager;
    if (this.claims.earnedPicks) {
      const before = ids(rm);
      for (const pick of takeOwedEarnedPicks(rm)) {
        this._recordOffer(pick);
        if (pick.taken) {
          this._count('earnedTaken');
          const by = (this.claimCounts.earnedTakenBySource[pick.source] || 0) + 1;
          this.claimCounts.earnedTakenBySource[pick.source] = by;
        }
      }
      this._noteAcquired(before, 'earned');
    } else {
      skipOwedEarnedPick(rm);
    }
    if (this.claims.items) {
      const used = useItemsBetweenBattles(rm);
      this._count('itemHeals', used.heals.length);
      this._count('goldPouches', used.pouches);
      this._count('boostersUsed', used.boosters);
      for (const heal of used.heals) {
        if (heal.item === 'Vulnerary') this._exerciseIfHeld('field_medic');
        if (heal.item === 'Elixir') {
          this._count('convoyElixirHeals');
          this._exerciseIfHeld('quartermaster_cache');
        }
      }
    }
    if (this.claims.accessories) this._count('accessoriesEquipped', equipAccessories(rm));
    if (this.claims.scrolls) {
      const learned = learnScrolls(rm, this.gameData);
      this._count('skillScrollsLearned', learned.skills);
      this._count('artScrollsBound', learned.arts);
    }
    if (this.claims.seals) {
      const sealed = useMasterSeals(rm, this.gameData);
      this._count('sealPromotions', sealed.promoted);
      this._count('sealsRefused', sealed.refused);
      if (sealed.refused) this._exerciseIfHeld('kingmakers_oath', sealed.refused);
    }
  }

  /** Act-start effects that pay on the act advance. */
  _afterAct() {
    for (const id of ['late_bloom', 'chronicle', 'second_dawn', 'darkened_dawn', 'coin_of_fate'])
      this._exerciseIfHeld(id);
  }

  _exerciseIfHeld(id, by = 1) {
    if (this._held(id)) this._exercise(id, by);
  }

  _recordOffer(pick) {
    const rm = this.runManager;
    const entry = earnedLedgerEntry(rm, pick.key);
    const offered = pick.offered.length ? pick.offered : entry?.offered || [];
    this._count('earnedOffers');
    for (const id of offered)
      this.offers.push({
        id,
        source: pick.source,
        key: pick.key,
        battleIndex: this.battleLog.length,
        act: rm.currentAct,
        taken: pick.taken === id,
      });
  }

  // ── Battles ──────────────────────────────────────────────────────────────

  _battleParams(node) {
    const rm = this.runManager;
    const params = rm.getBattleParams(node) || {};
    params.metaEffects = structuredClone(rm.getEffectiveMetaEffects?.() ?? rm.metaEffects ?? null);
    params.extendedLevelingEnabled =
      rm.getDifficultyModifier?.('extendedLevelingEnabled', false) === true;
    params.blessingXpDelta = rm.getXpMultiplierDelta?.() || 0;
    params.fallenUnits = structuredClone(rm.fallenUnits || []);
    const limits = DEPLOY_LIMITS[rm.currentAct] || { min: 1, max: 4 };
    const deployMax = Math.max(1, Math.min(rm.roster.length, limits.max + rm.getDeployBonus()));
    params.deployCount = Math.min(Math.max(limits.min, deployMax), rm.roster.length);
    params.battleNumber = (rm.completedBattles || 0) + 1;
    return params;
  }

  async _claimBattleNode(node) {
    const rm = this.runManager;
    this.metrics.battles++;
    if (node?.eclipse) this.metrics.eclipsedBattles++;
    if (this.claims.recruitSwap && node.type === NODE_TYPES.RECRUIT) {
      const swap = chooseRecruitCandidate(rm, node);
      if (swap.offered) {
        this._count('recruitAlternatesOffered');
        this._exerciseIfHeld('open_roll');
      }
      if (swap.swapped) this._count('recruitSwaps');
    }
    const params = this._battleParams(node);
    const fullRoster = rm.getRoster();
    const deployed = chooseDeployRoster(fullRoster, params.deployCount);
    const deployedKeys = new Set(deployed.map(keyForUnit));
    const isBoss = node.type === NODE_TYPES.BOSS || params.isBoss === true;
    const heldAtStart = ids(rm);
    rm.beginBattleInProgress(node.id, {
      isBoss,
      isElite: params.isElite === true,
      battleParams: params,
    });
    const played = await this._playBattle(node, params, deployed, isBoss);
    const { driver, falls, rewinds, stalled } = played;
    const battle = driver.battle;
    const turns = Math.min(this.turnCap + 1, battle.turnManager?.turnNumber || 0);
    const commanderKOs = falls.filter((f) => f.isCommander).length;
    const unitDeaths = falls.filter((f) => !f.isCommander).length;
    const terminal = driver.getTerminalResult();
    if (terminal && terminal !== 'victory') this._count('battleLosses');
    if (stalled) this._count('stalls');
    this.metrics.totalTurns += turns;
    this.metrics.totalGoldEarnedFromBattles += battle.goldEarned || 0;
    this.metrics.victories++;
    const steals = battle.steals || [];
    this._count('steals', steals.length);
    this._count('stealsSpeedWaived', steals.filter((s) => s.speedWaived).length);
    if (steals.length) {
      this._exerciseIfHeld('cutpurses_luck', steals.length);
      this._exerciseIfHeld('thiefs_lantern', steals.filter((s) => s.speedWaived).length);
    }
    const spent = battle._battleBlessings?.spent || [];
    const banner = spent.filter((s) => s === 'banner').length;
    const lantern = spent.filter((s) => s === 'lantern').length;
    this._count('bannerHolds', banner);
    this._count('lanternHeals', lantern);
    if (banner) this._exercise('unbroken_banner', banner);
    if (lantern) this._exercise('ember_lantern', lantern);
    this._count('staffHeals', played.staffHeals);
    if (played.staffHeals) {
      this._exerciseIfHeld('saints_reserve', played.staffHeals);
      this._exerciseIfHeld('saints_reliquary', played.staffHeals);
    }
    this._count('carriersSeen', played.carriers);
    this._count('visionRewinds', rewinds.length);
    this._count('visionGraceRewinds', played.graceSpent);
    if (rewinds.length) {
      for (const id of ['second_dawn', 'darkened_dawn']) this._exerciseIfHeld(id, rewinds.length);
      if (played.graceSpent) this._exercise('watchers_grace', played.graceSpent);
    }
    if (played.talks) this._count('talkRecruits', played.talks);
    this._exerciseBattlePassives(params, played);

    // The victory commit, as PostCombatController: the army as it leaves the field, the bench.
    const survivors = [...battle.playerUnits, ...(battle.escapedUnits || [])].map((u) =>
      structuredClone(u),
    );
    const bench = fullRoster.filter((unit) => !deployedKeys.has(keyForUnit(unit)));
    const merged = [...survivors, ...bench];
    clearBattleScopedDeltas(merged);
    const pressure = getLatePressureState(turns, battle.turnPar, this.gameData.turnBonus);
    const completionGoldAward = Math.max(
      0,
      Math.floor(GOLD_BATTLE_BONUS * pressure.goldMultiplier),
    );
    const goldBefore = rm.gold;
    const beforeNames = new Set(rm.roster.map(keyForUnit));
    const applied = rm.completeBattle(merged, node.id, battle.goldEarned || 0, {
      turnCount: turns,
      turnPar: Number.isFinite(battle.turnPar) ? battle.turnPar : null,
      completionGoldOverride: completionGoldAward,
    });
    this.metrics.eclipseFalls += rm.lastEclipseCommit?.fell?.length || 0;
    const contract = applied ? rm.lastContractSettlement : null;
    if (contract) this.metrics[contract.kept ? 'contractsKept' : 'contractsBroken']++;
    if (rm.lastBattleGoldGamble?.nodeId === node.id) this._exerciseIfHeld('gamblers_toss');
    const battleGold = Math.max(0, rm.gold - goldBefore);
    // The reward screen.
    if (applied && this.claims.rewards && !rm.isRunComplete()) {
      const reward = claimBattleRewards(rm, this.gameData, {
        nodeId: node.id,
        authoredLoot: null,
        isElite: params.isElite === true,
        isBoss,
        goldEarned: battle.goldEarned || 0,
        turnPar: Number.isFinite(battle.turnPar) ? battle.turnPar : null,
        turnBonusConfig: this.gameData.turnBonus,
        turnNumber: turns,
        blessingParTurns: params.blessingParTurns || 0,
        victoryPressureState: pressure,
        completionGoldAward,
        battleCompletionAwardedGold: battleGold,
        metaEffects: rm.metaEffects,
      });
      this._noteReward(reward);
    }
    // The boss's recruit, then the third lord (PostCombatController's order).
    if (applied && this.claims.bossRecruit && isBoss && !rm.isRunComplete()) {
      const candidates = prepareBossRecruit(rm, this.gameData) || [];
      const pick = [...candidates]
        .filter((c) => c?.unit)
        .sort((a, b) => (b.unit.level || 0) - (a.unit.level || 0))[0];
      if (pick) {
        resolveBossRecruit(rm, pick.unit);
        this._count('bossRecruits');
      } else rm.pendingBossRecruit = null;
    }
    if (applied && !rm.pendingBossRecruit && rm.shouldTriggerThirdLord()) {
      const arrival = prepareThirdLord(rm, this.gameData);
      const unit = arrival?.candidates?.[0]?.unit || arrival?.candidates?.[0] || null;
      resolveThirdLordArrival(rm, unit);
    }
    const afterNames = new Set(rm.roster.map(keyForUnit));
    const recruitsGained = [...afterNames].filter((k) => !beforeNames.has(k)).length;
    this.metrics.recruitsGained += recruitsGained;
    this.metrics.unitsLost += unitDeaths;
    if (recruitsGained) {
      this._exerciseIfHeld('crest_of_the_road', recruitsGained);
      this._exerciseIfHeld('nomad_pact', recruitsGained);
    }
    this.battleLog.push({
      act: rm.nodeMap?.actId ?? rm.currentAct,
      type: node.type,
      boss: isBoss,
      elite: params.isElite === true,
      eclipsed: Boolean(node?.eclipse || params.isEclipsed),
      fog: params.fogEnabled === true,
      turns,
      par: Number.isFinite(battle.turnPar) ? battle.turnPar : null,
      commanderKOs,
      unitDeaths,
      rewinds: rewinds.length,
      stalled,
      steals: steals.length,
      gold: battleGold,
      held: heldAtStart,
    });
    return { result: 'victory', turns, commanderKOs, unitDeaths, rewinds: rewinds.length };
  }

  _noteReward(reward) {
    if (!reward) return;
    this._count('rewardClaims');
    this._count('lotteryCardsOffered', reward.lotteryOffered || 0);
    const lotteryTaken = reward.picks.filter((p) => p.choice?.lottery).length;
    this._count('lotteryCardsTaken', lotteryTaken);
    if (reward.lotteryOffered) this._exerciseIfHeld('lottery_loot', reward.lotteryOffered);
    const tithe = /Dawn Tithe: \+(\d+) gold/.exec(reward.record?.summary || '');
    if (tithe) {
      this._count('dawnTitheGold', Number(tithe[1]));
      this._exerciseIfHeld('dawn_tithe');
    }
    if (reward.picks.some((p) => p.choice?.type === 'gold'))
      this._exerciseIfHeld('hollow_sun_favor');
  }

  /** Battle-time cards whose effect needs only the battle to have its subject. */
  _exerciseBattlePassives(params, played) {
    if (Number(params.reinforcementDelay) > 0 && played.reinforcements)
      this._exerciseIfHeld('hollow_hourglass');
    if (params.fogEnabled) {
      this._exerciseIfHeld('lantern_of_the_road');
      this._exerciseIfHeld('seers_eye');
    }
    if (Number(params.blessingParTurns) > 0 && Number.isFinite(played.driver.battle.turnPar))
      this._exerciseIfHeld('patient_dawn');
  }

  /**
   * Play one battle to its end with the Vision policy: returns the final GameDriver and what
   * happened in the branch that stands (falls, rewinds made, stall).
   */
  async _playBattle(node, params, deployed, isBoss) {
    const rm = this.runManager;
    const entry = {
      rng: this.rng ? this.rng.getState() : null,
      units: structuredClone(deployed),
      params: structuredClone(params),
      domain: structuredClone({
        convoy: rm.convoy,
        accessories: rm.accessories,
        gold: rm.gold,
        nextUnitUid: rm.nextUnitUid,
        blessingRuntimeModifiers: rm.blessingRuntimeModifiers,
      }),
    };
    const grace = Math.max(0, Number(rm.battleInProgress?.bossVisionGranted) || 0);
    const visionAt = rm.visionCount || 0;
    const canRewind = this.claims.vision && Boolean(this.rng);
    let branch = this._buildBattle(node, entry);
    const actions = [];
    // Whether each recorded action was chosen cautiously (a replay that verifies plays it so too).
    const cautious = [];
    const turnStarts = new Map();
    const rewinds = [];
    const rewoundTurns = new Set();
    let cautionTurn = null;
    let stalled = false;
    let steps = 0;
    while (steps++ < this.options.maxBattleActions) {
      const { driver, agent } = branch;
      if (driver.isTerminal()) break;
      const turn = driver.battle.turnManager?.turnNumber || 0;
      if (turn > this.turnCap) {
        stalled = true;
        break;
      }
      if (driver.battle.battleState === HEADLESS_STATES.PLAYER_IDLE && !turnStarts.has(turn))
        turnStarts.set(turn, { index: actions.length, agent: agentState(agent) });
      const legal = driver.listLegalActions();
      if (!legal?.length) break;
      agent.caution = cautionTurn === turn;
      const action = agent.chooseAction(legal);
      if (!action) break;
      actions.push(action);
      cautious.push(agent.caution === true);
      const fallsBefore = branch.falls.length;
      await driver.step(action);
      const fall = branch.falls[fallsBefore];
      if (!fall || !canRewind || rewinds.length >= MAX_REWINDS_PER_BATTLE) continue;
      const graceUnspent = Math.max(0, grace - ((rm.visionCount || 0) - visionAt));
      if (!shouldRewindForFall(rm, fall, { bossBattle: isBoss, graceUnspent })) continue;
      let target = turn;
      if (rewoundTurns.has(target)) target -= 1;
      if (!turnStarts.has(target) || rewoundTurns.has(target)) continue;
      // Spend the charge as BattleRewindTransaction does, then rebuild the branch.
      rm.visionChargesRemaining -= 1;
      rm.visionCount = Math.max(0, (rm.visionCount || 0) + 1);
      rewinds.push({ turn: target, fell: fall.name, commander: fall.isCommander });
      rewoundTurns.add(target);
      const start = turnStarts.get(target);
      actions.length = start.index;
      cautious.length = start.index;
      for (const t of [...turnStarts.keys()]) if (t > target) turnStarts.delete(t);
      branch = await this._replay(node, entry, actions, start.agent, cautious);
      cautionTurn = target;
    }
    if (steps >= this.options.maxBattleActions && !branch.driver.isTerminal()) stalled = true;
    const graceSpent = Math.min(grace, Math.max(0, (rm.visionCount || 0) - visionAt));
    return {
      driver: branch.driver,
      falls: branch.falls,
      rewinds,
      stalled,
      staffHeals: branch.counts.staffHeals,
      talks: branch.counts.talks,
      carriers: branch.counts.carriers,
      reinforcements: branch.counts.reinforcements,
      graceSpent,
    };
  }

  /** A fresh battle from its entry state, with the casual-commander and counting hooks. */
  _buildBattle(node, entry) {
    const rm = this.runManager;
    if (this.rng && Number.isFinite(entry.rng)) this.rng.setState(entry.rng);
    rm.convoy = structuredClone(entry.domain.convoy);
    rm.accessories = structuredClone(entry.domain.accessories);
    rm.gold = entry.domain.gold;
    rm.nextUnitUid = entry.domain.nextUnitUid;
    rm.blessingRuntimeModifiers = structuredClone(entry.domain.blessingRuntimeModifiers);
    const driver = new GameDriver(
      this.gameData,
      structuredClone(entry.params),
      structuredClone(entry.units),
      {
        runManager: rm,
        steal: this.claims.steal,
        buildRecruit: isRecruitBattleNode(node)
          ? (preview) => rm.getRecruitNodeUnit(node, { preview })
          : undefined,
      },
    );
    driver.init();
    const battle = driver.battle;
    const falls = [];
    const counts = {
      staffHeals: 0,
      talks: 0,
      carriers: battle.enemyUnits.filter((e) => e.carriedItem).length,
      reinforcements: Boolean(battle.battleConfig?.reinforcements),
    };
    const remove = battle._removeUnit.bind(battle);
    battle._removeUnit = (unit, ...rest) => {
      if (unit?.faction === 'player') {
        falls.push({
          name: unit.name,
          isCommander: unit.isCommander === true,
          isLord: unit.isLord === true,
          turn: battle.turnManager?.turnNumber || 0,
        });
        if (unit.isCommander) {
          // Casual commander: the run would have ended here; counted, and the run goes on.
          unit.currentHP = unit.stats.HP;
          return undefined;
        }
      }
      return remove(unit, ...rest);
    };
    const heal = battle._executeHeal.bind(battle);
    battle._executeHeal = (healer, target) => {
      if (healer?.faction === 'player') counts.staffHeals++;
      return heal(healer, target);
    };
    const talk = battle._executeTalk.bind(battle);
    battle._executeTalk = (lord, npc) => {
      counts.talks++;
      return talk(lord, npc);
    };
    return { driver, falls, counts, agent: this.options.battleAgentFactory(driver) };
  }

  /**
   * Replay the battle from its entry with the same dice: the recorded actions are stepped again
   * (the harness is deterministic for the same dice and the same actions), and the agent's own
   * state is put back as it was when the target turn began. With `verifyReplay` the agent plays
   * along instead and any choice that differs from the record is counted (`replayMismatches`:
   * a replay that would diverge); the record is stepped either way.
   */
  async _replay(node, entry, actions, savedAgent, cautious = []) {
    const branch = this._buildBattle(node, entry);
    const verify = this.options.verifyReplay === true;
    for (const [i, recorded] of actions.entries()) {
      if (branch.driver.isTerminal()) break;
      if (verify) {
        branch.agent.caution = cautious[i] === true;
        const chosen = branch.agent.chooseAction(branch.driver.listLegalActions());
        if (JSON.stringify(chosen) !== JSON.stringify(recorded)) {
          this._count('replayMismatches');
          if (process.env.DEBUG_REPLAY)
            console.log(
              'MISMATCH',
              this.battleLog.length,
              branch.driver.battle.turnManager?.turnNumber,
              JSON.stringify(recorded),
              JSON.stringify(chosen),
            );
        }
      }
      await branch.driver.step(recorded);
    }
    if (!verify) restoreAgentState(branch.agent, savedAgent);
    return branch;
  }

  // ── Services ─────────────────────────────────────────────────────────────

  /** Every battle this driver fights (the stock shop's ambush too) is a claiming battle. */
  async _runBattleNode(node) {
    return this._claimBattleNode(node);
  }

  async _claimShopNode(node) {
    // A village ambush is fought on arrival, before the shop opens (the stock shop then sees it
    // cleared and goes on to its purchases).
    if (node?.isAmbush === true && node?.ambushCleared !== true) {
      this.metrics.ambushBattles++;
      await this._claimBattleNode(node);
    }
    if (this.claims.forge) {
      const forged = forgeAtShop(this.runManager, node);
      this._count('freeForges', forged.free);
      this._count('paidForges', forged.paid);
      if (forged.free) {
        this._exerciseIfHeld('frugal_smith', forged.free);
        this._exerciseIfHeld('smiths_covenant', forged.free);
      }
    }
    if (node?.pilgrimShop) this._exerciseIfHeld('pilgrim_coin');
    return super._runShopNode(node);
  }

  _claimChurchNode(node) {
    const rm = this.runManager;
    this.metrics.churchNodes++;
    if (!this.claims.church) return super._runChurchNode(node);
    this._count('churchVisits');
    const before = ids(rm);
    const visit = playChurch(rm, node, this.gameData);
    this._noteAcquired(before, visit.sanctum ? 'sanctum' : 'church');
    rm.markNodeComplete(node.id);
    if (visit.tithe) {
      this._count('titheGold', visit.tithe);
      this._exercise('tithe_box');
    }
    if (visit.sanctum) this._count('sanctumTaken');
    for (const id of visit.sanctumOffered)
      this.offers.push({
        id,
        source: 'sanctum',
        key: `sanctum:${node.id}`,
        battleIndex: this.battleLog.length,
        act: rm.currentAct,
        taken: visit.sanctum === id,
      });
    this._count('revives', visit.revived.length);
    this._count('churchPromotions', visit.promoted.length);
    this._count('freePromotions', visit.freePromotions);
    if (visit.freePromotions) this._exercise('kingmakers_oath', visit.freePromotions);
    if (visit.cleansed) this._count('cleanses');
    if (visit.blessing) this._count('churchBlessings');
    if (visit.vows.length >= 2) {
      this._count('secondVows');
      this._exerciseIfHeld('twin_chapel');
    }
    return { result: 'church_done', vows: visit.vows, sanctum: visit.sanctum };
  }

  _claimRuinsNode(node) {
    const rm = this.runManager;
    if (!this.claims.ruins) {
      rm.markNodeComplete(node.id);
      return { result: 'skipped' };
    }
    const visit = playRuins(rm, node);
    if (visit.rested) this._count('ruinsRests');
    this._count('revives', visit.revived.length);
    rm.markNodeComplete(node.id);
    return { result: 'ruins_done' };
  }

  _claimColosseumNode(node) {
    const rm = this.runManager;
    const visit = playColosseum(rm, node, this.gameData);
    this._count('colosseumBouts', visit.bouts.length);
    this._count('colosseumWins', visit.bouts.filter((b) => b.outcome === 'win').length);
    this._count('ledgerFeeSaved', visit.feeSaved);
    if (visit.feeSaved) this._exercise('mercenary_ledger', visit.bouts.length);
    // The Colosseum's own pick opens in its menu (ColosseumOverlay._openOwedEarnedPick).
    if (this.claims.earnedPicks) {
      const before = ids(rm);
      for (const pick of takeOwedEarnedPicks(rm, { sources: ['colosseum'] })) {
        this._recordOffer(pick);
        if (pick.taken) {
          this._count('earnedTaken');
          const by = (this.claimCounts.earnedTakenBySource.colosseum || 0) + 1;
          this.claimCounts.earnedTakenBySource.colosseum = by;
        }
      }
      this._noteAcquired(before, 'earned');
    }
    rm.markNodeComplete(node.id);
    return { result: 'colosseum_done', bouts: visit.bouts.length };
  }

  /** A story event through EventCommands, with the claiming event policy. */
  async _claimEventNode(node) {
    const rm = this.runManager;
    if (!this.claims.events) {
      this.options.eventPolicy = 'default';
      return super._runEventNode(node);
    }
    this.metrics.eventNodes++;
    if (!arriveAtEvent(rm, node.id)) {
      rm.markNodeComplete(node.id);
      return { result: 'event_skipped', reason: 'no_event' };
    }
    const before = ids(rm);
    const steps = playClaimEventChoices(rm, node.id);
    const last = steps.at(-1);
    for (const { plan, chosen } of steps) {
      const key = `${chosen.state?.eventId}.${plan.choiceId}`;
      this.metrics.eventsByChoice[key] = (this.metrics.eventsByChoice[key] || 0) + 1;
    }
    this.metrics.eventSteps += steps.length;
    if (!last?.chosen?.ok || last.chosen.next) {
      rm.markNodeComplete(node.id);
      return { result: 'event_skipped', reason: last?.chosen?.reason || 'no way out' };
    }
    if (last.chosen.battle) {
      this.metrics.eventBattles++;
      await this._claimBattleNode(node);
      completeEventBattle(rm, node.id);
    }
    leaveEvent(rm, node.id);
    const gained = ids(rm).filter((id) => !before.includes(id));
    const earned = gained.filter((id) =>
      (this.gameData.blessings?.blessings || []).some((b) => b.id === id && b.earned === true),
    );
    this._count('eventEarnedGrants', earned.length);
    for (const id of earned)
      this.offers.push({
        id,
        source: 'event',
        key: `event:${node.id}`,
        battleIndex: this.battleLog.length,
        act: rm.currentAct,
        taken: true,
      });
    this._noteAcquired(before, 'event');
    return { result: 'event_done', eventId: last.chosen.state?.eventId };
  }
}
