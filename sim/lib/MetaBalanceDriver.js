// Real run/battle engines with a declared, deliberately limited decision policy.
import { RunSimulationDriver } from '../../tests/sim/RunSimulationDriver.js';
import { ScriptedAgent } from '../../tests/agents/ScriptedAgent.js';
import { RescueAgent } from './RescueAgent.js';
import { TacticianAgent } from './TacticianAgent.js';
import { deploymentCombatValue } from '../../tests/sim/RunPolicies.js';
import { prepareBossRecruit, resolveBossRecruit } from '../../src/engine/PendingBossRecruit.js';
import { prepareThirdLord, resolveThirdLordArrival } from '../../src/engine/PendingThirdLord.js';
import { prepareBattleRewards, finishRewardClaim } from '../../src/engine/PendingBattleRewards.js';
import { awardTeamXp } from '../../src/engine/TeamXp.js';
import { DEPLOY_LIMITS } from '../../src/utils/constants.js';
import { GOLD_BATTLE_BONUS } from '../../src/utils/constants.js';
import { getLatePressureState } from '../../src/engine/TurnBonusCalculator.js';
import { recordBattleParticipation } from '../../src/engine/MasterySystem.js';

export const ROUTES = {
  recruit: ['recruit', 'church', 'shop', 'battle', 'boss'],
  battle: ['battle', 'shop', 'church', 'recruit', 'boss'],
  services: ['church', 'shop', 'recruit', 'battle', 'boss'],
};

export function chooseRouteNode(nodes, route) {
  if (!ROUTES[route]) throw new Error(`Unknown route: ${route}`);
  const rank = (n) => {
    const i = ROUTES[route].indexOf(n.type);
    return i === -1 ? 99 : i;
  };
  return [...nodes].sort(
    (a, b) => rank(a) - rank(b) || (b.row || 0) - (a.row || 0) || a.id.localeCompare(b.id),
  )[0];
}

export class MetaBalanceDriver extends RunSimulationDriver {
  constructor(data, options = {}) {
    const { agent = 'rescue', route = 'recruit' } = options;
    if (!['scripted', 'rescue', 'tactician'].includes(agent))
      throw new Error(`Unknown agent: ${agent}`);
    if (!ROUTES[route]) throw new Error(`Unknown route: ${route}`);
    super(data, { ...options, invincibility: false });
    this.route = route;
    this.exposure = {
      battles: 0,
      recruitDeployments: 0,
      lordDeployments: 0,
      extraSlotFilled: 0,
      recruitSkills: 0,
      recruitAccessories: 0,
      bossRecruits: 0,
      thirdLords: 0,
      overParTurns: 0,
      commanderDeaths: 0,
      startingRecruits: 0,
      promotedRecruitDeployments: 0,
      ordinaryRecruitDeployments: 0,
      unitDeaths: 0,
    };
    this.options.battleAgentFactory = (driver) => {
      const b = driver.battle;
      this.currentBattle = b;
      b.getTurnPressureState = () =>
        getLatePressureState(b.turnManager?.turnNumber || 0, b.turnPar, this.gameData.turnBonus);
      const recruits = b.playerUnits.filter((u) => !u.isLord);
      this.exposure.ordinaryRecruitDeployments += recruits.filter(
        (u) => u.name !== 'Gaspar',
      ).length;
      this.exposure.battles++;
      this.exposure.recruitDeployments += recruits.length;
      this.exposure.lordDeployments += b.playerUnits.length - recruits.length;
      this.exposure.recruitSkills += recruits.reduce((n, u) => n + (u.skills?.length || 0), 0);
      this.exposure.recruitAccessories += recruits.filter((u) => u.accessory).length;
      this.exposure.promotedRecruitDeployments += recruits.filter(
        (u) => u.tier === 'promoted',
      ).length;
      const baseCap = DEPLOY_LIMITS[this.runManager.currentAct]?.max || 4;
      this.exposure.extraSlotFilled += Math.max(0, b.playerUnits.length - baseCap);
      const remove = b._removeUnit.bind(b);
      const removed = new Set();
      b._removeUnit = (unit, ...args) => {
        if (unit.faction === 'player' && !removed.has(unit)) {
          removed.add(unit);
          this.exposure.unitDeaths++;
          if (unit.isCommander) this.exposure.commanderDeaths++;
        }
        return remove(unit, ...args);
      };
      if (agent === 'scripted') return new ScriptedAgent(driver);
      if (agent === 'rescue') return new RescueAgent(driver);
      const tactician = new TacticianAgent(driver);
      // Seize/escape use the simple agent; retain deliberate recruit rescue there.
      tactician.fallback = new RescueAgent(driver);
      return tactician;
    };
  }

  async _runBattleNode(node) {
    const result = await super._runBattleNode(node);
    const b = this.currentBattle;
    if (b && Number.isFinite(b.turnPar))
      this.exposure.overParTurns += Math.max(0, (b.turnManager?.turnNumber || 0) - b.turnPar);
    return result;
  }

  init() {
    super.init();
    this.exposure.startingRecruits = this.runManager.roster.filter((u) => !u.isLord).length;
  }

  async run() {
    if (!this.runManager) this.init();
    for (let step = 0; step < this.options.maxNodes; step++) {
      if (this.runManager.isRunComplete()) return this._buildResult('victory');
      const node = chooseRouteNode(this.runManager.getAvailableNodes() || [], this.route);
      if (!node) {
        this.runManager.failRun();
        return this._buildResult('stuck');
      }
      this.metrics.nodesVisited++;
      let res;
      if (['battle', 'boss', 'recruit'].includes(node.type)) res = await this._runBattleNode(node);
      else if (node.type === 'shop') res = await this._runShopNode(node);
      else if (node.type === 'church') res = this._runChurchNode(node);
      else {
        this.runManager.markNodeComplete(node.id);
        res = { result: 'skipped' };
      }
      this.trace.push({
        act: this.runManager.currentAct,
        nodeId: node.id,
        nodeType: node.type,
        ...res,
      });
      if (res.result === 'defeat' || res.result === 'timeout') {
        this.runManager.failRun();
        return this._buildResult(res.result);
      }
      if (this.runManager.isActComplete()) {
        this.metrics.eclipseShadowByAct[this.runManager.currentAct] =
          this.runManager.eclipse?.shadow ?? 0;
        if (this.runManager.isRunComplete()) return this._buildResult('victory');
        this.runManager.advanceAct();
        this.metrics.actsAdvanced++;
      }
    }
    this.runManager.failRun();
    return this._buildResult('timeout');
  }

  _completeBattle(driver, merged, node) {
    const run = this.runManager;
    const beforeGold = run.gold;
    const b = driver.battle;
    for (const unit of [...b.playerUnits, ...(b.escapedUnits || [])]) {
      // Only surviving deployed units participate; carry the updated record into merged clones.
      const copy = merged.find((u) => u.unitUid === unit.unitUid && u.name === unit.name);
      if (copy) recordBattleParticipation(copy);
    }
    const pressure = b.getTurnPressureState();
    const completionGoldAward = Math.max(
      0,
      Math.floor(GOLD_BATTLE_BONUS * pressure.goldMultiplier),
    );
    const applied = run.completeBattle(merged, node.id, b.goldEarned || 0, {
      turnCount: b.turnManager?.turnNumber || 0,
      turnPar: b.turnPar,
      completionGoldOverride: completionGoldAward,
    });
    this.metrics.eclipseFalls += run.lastEclipseCommit?.fell?.length || 0;
    if (!applied) return applied;
    if (run.isRunComplete()) return applied;
    const reward = prepareBattleRewards(run, this.gameData, {
      nodeId: node.id,
      isBoss: node.type === 'boss',
      isElite: b.battleConfig?.isElite === true,
      metaEffects: run.getEffectiveMetaEffects(),
      turnNumber: b.turnManager?.turnNumber || 0,
      turnPar: b.turnPar,
      turnBonusConfig: this.gameData.turnBonus,
      victoryPressureState: pressure,
      goldEarned: b.goldEarned || 0,
      completionGoldAward,
      battleCompletionAwardedGold: run.gold - beforeGold,
    });
    // Pick highest current combat value; never select with knowledge of future RNG.
    const pick = (candidates) =>
      [...(candidates || [])]
        .map((c) => c.unit)
        .filter(Boolean)
        .sort(
          (a, z) =>
            deploymentCombatValue(z) - deploymentCombatValue(a) || a.name.localeCompare(z.name),
        )[0];
    if (node.type === 'boss') {
      const unit = pick(prepareBossRecruit(run, this.gameData));
      resolveBossRecruit(run, unit);
      if (unit) this.exposure.bossRecruits++;
    }
    if (run.shouldTriggerThirdLord()) {
      const draft = prepareThirdLord(run, this.gameData);
      resolveThirdLordArrival(run, pick(draft?.candidates));
      this.exposure.thirdLords += draft?.candidates?.length ? 1 : 0;
    }
    // Declared economic policy: take the first gold/team-XP reward, else skip.
    // This does not pretend to value loot equipment, scrolls, or consumables.
    while (run.pendingBattleReward) {
      const index = reward.choices.findIndex(
        (c, i) => c.type === 'gold' && !reward.claimed.includes(i),
      );
      if (index >= 0) {
        const choice = reward.choices[index];
        run.awardGold(choice.goldAmount || 0);
        awardTeamXp(run.roster, choice.xpAmount, this.gameData.classes, {
          extendedLevelingEnabled: run.getDifficultyModifier('extendedLevelingEnabled', false),
        });
        finishRewardClaim(run, index);
      } else {
        run.awardGold(reward.skipGold);
        finishRewardClaim(run, reward.choices.length);
      }
    }
    return applied;
  }

  _buildResult(result) {
    return { ...super._buildResult(result), exposure: { ...this.exposure } };
  }
}
