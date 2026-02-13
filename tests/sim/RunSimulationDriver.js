// RunSimulationDriver.js - Full run simulation driver (node traversal + battles + economy).

import { RunManager } from '../../src/engine/RunManager.js';
import { generateShopInventory } from '../../src/engine/LootSystem.js';
import {
  canPromote,
  promoteUnit,
  canEquip,
  addToInventory,
  addToConsumables,
} from '../../src/engine/UnitManager.js';
import { CHURCH_PROMOTE_COST, DEPLOY_LIMITS, NODE_TYPES } from '../../src/utils/constants.js';
import { GameDriver } from '../harness/GameDriver.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import {
  chooseNode,
  chooseDeployRoster,
  chooseChurchPlan,
  chooseShopPurchases,
} from './RunPolicies.js';

function keyForUnit(unit) {
  return `${unit.name}::${unit.className}`;
}

function cloneUnit(unit) {
  return structuredClone(unit);
}

export class RunSimulationDriver {
  constructor(gameData, options = {}) {
    this.gameData = gameData;
    this.options = {
      runOptions: {},
      maxNodes: 300,
      maxBattleActions: 2600,
      reviveCost: 1000,
      invincibility: false,
      battleAgentFactory: (driver) => new ScriptedAgent(driver),
      ...options,
    };

    this.runManager = null;
    this.trace = [];
    this.metrics = {
      nodesVisited: 0,
      battles: 0,
      victories: 0,
      defeats: 0,
      timeouts: 0,
      actsAdvanced: 0,
      shopNodes: 0,
      churchNodes: 0,
      recruitsGained: 0,
      unitsLost: 0,
      totalTurns: 0,
      totalGoldEarnedFromBattles: 0,
      shopGoldSpent: 0,
      churchGoldSpent: 0,
      promotions: 0,
      invalidShopEntries: 0,
      forcedBattleWins: 0,
    };
  }

  init() {
    this.runManager = new RunManager(this.gameData);
    this.runManager.startRun(this.options.runOptions || {});
  }

  async run() {
    if (!this.runManager) this.init();

    for (let step = 0; step < this.options.maxNodes; step++) {
      if (this.runManager.isRunComplete()) {
        return this._buildResult('victory');
      }

      const available = this.runManager.getAvailableNodes();
      if (!available || available.length === 0) {
        this.runManager.failRun();
        return this._buildResult('stuck');
      }

      const node = chooseNode(available);
      if (!node) {
        this.runManager.failRun();
        return this._buildResult('stuck');
      }

      this.metrics.nodesVisited++;
      const nodeEvent = {
        i: this.trace.length,
        act: this.runManager.currentAct,
        nodeId: node.id,
        nodeType: node.type,
      };

      let nodeResult;
      if (node.type === NODE_TYPES.BATTLE || node.type === NODE_TYPES.BOSS || node.type === NODE_TYPES.RECRUIT) {
        nodeResult = await this._runBattleNode(node);
      } else if (node.type === NODE_TYPES.SHOP) {
        nodeResult = this._runShopNode(node);
      } else if (node.type === NODE_TYPES.CHURCH) {
        nodeResult = this._runChurchNode(node);
      } else {
        this.runManager.markNodeComplete(node.id);
        nodeResult = { result: 'skipped' };
      }

      this.trace.push({ ...nodeEvent, ...nodeResult });

      if (nodeResult.result === 'defeat' || nodeResult.result === 'timeout') {
        this.runManager.failRun();
        return this._buildResult(nodeResult.result);
      }

      if (this.runManager.isActComplete()) {
        if (this.runManager.isRunComplete()) {
          return this._buildResult('victory');
        }
        this.runManager.advanceAct();
        this.metrics.actsAdvanced++;
      }
    }

    this.runManager.failRun();
    return this._buildResult('timeout');
  }

  _buildResult(result) {
    return {
      result,
      status: this.runManager.status,
      act: this.runManager.currentAct,
      actIndex: this.runManager.actIndex,
      completedBattles: this.runManager.completedBattles,
      gold: this.runManager.gold,
      rosterSize: this.runManager.roster.length,
      fallenCount: this.runManager.fallenUnits.length,
      metrics: { ...this.metrics },
      trace: [...this.trace],
    };
  }

  async _runBattleNode(node) {
    this.metrics.battles++;

    const battleParams = this.runManager.getBattleParams(node) || {};
    const deployLimits = DEPLOY_LIMITS[this.runManager.currentAct] || { min: 1, max: 4 };
    const deployBonus = this.runManager.getDeployBonus();
    const deployMax = Math.max(1, Math.min(this.runManager.roster.length, deployLimits.max + deployBonus));
    const deployCount = Math.max(deployLimits.min, deployMax);
    battleParams.deployCount = Math.min(deployCount, this.runManager.roster.length);

    const fullRoster = this.runManager.getRoster();
    const deployed = chooseDeployRoster(fullRoster, battleParams.deployCount);
    const deployedKeys = new Set(deployed.map(keyForUnit));

    const driver = new GameDriver(this.gameData, battleParams, deployed.map(cloneUnit));
    driver.init();
    this._enableInvincibilityIfConfigured(driver);

    const battleAgent = this.options.battleAgentFactory(driver);
    let timedOut = true;

    for (let i = 0; i < this.options.maxBattleActions; i++) {
      if (driver.isTerminal()) {
        timedOut = false;
        break;
      }
      const legal = driver.listLegalActions();
      if (!legal || legal.length === 0) {
        timedOut = false;
        break;
      }
      const action = battleAgent.chooseAction(legal);
      if (!action) {
        timedOut = false;
        break;
      }
      await driver.step(action);
      if (this.options.invincibility) this._patchPlayerHP(driver);
    }

    if (timedOut && !driver.isTerminal()) {
      this.metrics.timeouts++;
      if (!this.options.invincibility) {
        return { result: 'timeout', reason: 'battle_action_budget_exhausted' };
      }

      const survivors = driver.battle.playerUnits.map(cloneUnit);
      const bench = fullRoster.filter((unit) => !deployedKeys.has(keyForUnit(unit)));
      const merged = [...survivors, ...bench];
      this.runManager.completeBattle(merged, node.id, driver.battle.goldEarned || 0);
      this.metrics.forcedBattleWins++;
      return {
        result: 'victory_timeout_forced',
        reason: 'battle_action_budget_exhausted',
        turns: driver.battle.turnManager?.turnNumber || 0,
      };
    }

    const terminal = driver.getTerminalResult();
    const result = terminal || (driver.battle.enemyUnits.length === 0 ? 'victory' : 'defeat');

    this.metrics.totalTurns += driver.battle.turnManager?.turnNumber || 0;
    this.metrics.totalGoldEarnedFromBattles += driver.battle.goldEarned || 0;

    if (result !== 'victory') {
      this.metrics.defeats++;
      return { result: 'defeat', battleResult: result };
    }

    this.metrics.victories++;

    const survivors = driver.battle.playerUnits.map(cloneUnit);
    const bench = fullRoster.filter((unit) => !deployedKeys.has(keyForUnit(unit)));
    const merged = [...survivors, ...bench];

    const beforeNames = new Set(this.runManager.roster.map(keyForUnit));
    this.runManager.completeBattle(merged, node.id, driver.battle.goldEarned || 0);
    const afterNames = new Set(this.runManager.roster.map(keyForUnit));

    const recruitsGained = [...afterNames].filter((id) => !beforeNames.has(id)).length;
    const unitsLost = [...beforeNames].filter((id) => !afterNames.has(id)).length;
    this.metrics.recruitsGained += recruitsGained;
    this.metrics.unitsLost += unitsLost;

    return {
      result: 'victory',
      turns: driver.battle.turnManager?.turnNumber || 0,
      goldEarned: driver.battle.goldEarned || 0,
      recruitsGained,
      unitsLost,
    };
  }

  _runShopNode(node) {
    this.metrics.shopNodes++;

    if (this.runManager.consumeSkipFirstShop()) {
      this.runManager.markNodeComplete(node.id);
      return { result: 'shop_skipped', reason: 'skip_first_shop_blessing' };
    }

    const roster = this.runManager.roster;
    const inventory = generateShopInventory(
      this.runManager.currentAct,
      this.gameData.lootTables,
      this.gameData.weapons,
      this.gameData.consumables,
      this.gameData.accessories,
      roster
    );

    // Apply blessing shop count delta after inventory generation.
    const delta = this.runManager.getShopItemCountDelta();
    const adjusted = delta >= 0
      ? inventory
      : inventory.slice(0, Math.max(0, inventory.length + delta));

    let purchases = 0;
    let spent = 0;
    const picks = chooseShopPurchases(this.runManager, adjusted);
    for (const entry of picks) {
      if (!Number.isFinite(entry?.price) || entry.price <= 0) {
        this.metrics.invalidShopEntries++;
        continue;
      }
      if (entry.price > this.runManager.gold) continue;
      if (!this.runManager.spendGold(entry.price)) continue;

      const recipient = this._findBestRecipient(entry.item);
      if (!recipient) {
        this.runManager.addGold(entry.price);
        continue;
      }

      let added = false;
      if (entry.item.type === 'Consumable') {
        added = addToConsumables(recipient, entry.item);
      } else {
        added = addToInventory(recipient, entry.item);
        if (added && canEquip(recipient, recipient.inventory[recipient.inventory.length - 1])) {
          recipient.weapon = recipient.inventory[recipient.inventory.length - 1];
        }
      }

      if (!added) {
        this.runManager.addGold(entry.price);
        continue;
      }
      purchases++;
      spent += entry.price;
    }

    this.metrics.shopGoldSpent += spent;
    this.runManager.markNodeComplete(node.id);
    return { result: 'shop_done', purchases, spent, offered: adjusted.length };
  }

  _runChurchNode(node) {
    this.metrics.churchNodes++;

    const plan = chooseChurchPlan(this.runManager, {
      reviveCost: this.options.reviveCost,
      promoteCost: CHURCH_PROMOTE_COST,
    });

    let revived = null;
    if (plan.revive && this.runManager.fallenUnits.length > 0) {
      const pick = this.runManager.fallenUnits[0];
      if (this.runManager.reviveFallenUnit(pick.name, this.options.reviveCost)) {
        revived = pick.name;
        this.metrics.churchGoldSpent += this.options.reviveCost;
      }
    }

    let promoted = null;
    if (plan.promote) {
      promoted = this._tryChurchPromotion();
      if (promoted) {
        this.metrics.churchGoldSpent += CHURCH_PROMOTE_COST;
        this.metrics.promotions++;
      }
    }

    // Church always heals at end of visit in this sim.
    this.runManager.rest(node.id);

    return { result: 'church_done', revived, promoted };
  }

  _tryChurchPromotion() {
    if (this.runManager.gold < CHURCH_PROMOTE_COST) return null;

    const target = this.runManager.roster.find(u => canPromote(u));
    if (!target) return null;

    const lords = this.gameData.lords || [];
    const classes = this.gameData.classes || [];
    const lordDef = lords.find(l => l.name === target.name);

    let promotedClassName = null;
    let promotionBonuses = null;

    if (lordDef) {
      promotedClassName = lordDef.promotedClass;
      promotionBonuses = lordDef.promotionBonuses || {};
    } else {
      const classDef = classes.find(c => c.name === target.className);
      promotedClassName = classDef?.promotesTo || null;
      const promotedDef = classes.find(c => c.name === promotedClassName);
      promotionBonuses = promotedDef?.promotionBonuses || {};
    }

    if (!promotedClassName) return null;
    const promotedClassData = classes.find(c => c.name === promotedClassName);
    if (!promotedClassData) return null;

    if (!this.runManager.spendGold(CHURCH_PROMOTE_COST)) return null;
    promoteUnit(target, promotedClassData, promotionBonuses, this.gameData.skills);
    return target.name;
  }

  _findBestRecipient(item) {
    if (!item) return null;
    if (item.type === 'Consumable') {
      return this.runManager.roster.find(u => (u.consumables || []).length < 3) || null;
    }
    for (const unit of this.runManager.roster) {
      if ((unit.inventory || []).length >= 5) continue;
      if (canEquip(unit, item)) return unit;
    }
    return this.runManager.roster.find(u => (u.inventory || []).length < 5) || null;
  }

  _enableInvincibilityIfConfigured(driver) {
    if (!this.options.invincibility) return;

    const battle = driver.battle;
    const originalRemove = battle._removeUnit.bind(battle);
    battle._removeUnit = (unit) => {
      if (unit?.faction === 'player') {
        unit.currentHP = Math.max(1, unit.currentHP || 1);
        return;
      }
      originalRemove(unit);
    };
    this._patchPlayerHP(driver);
  }

  _patchPlayerHP(driver) {
    for (const unit of driver.battle.playerUnits) {
      if (unit.currentHP <= 0) unit.currentHP = 1;
      if (unit.currentHP > unit.stats.HP) unit.currentHP = unit.stats.HP;
    }
  }
}
