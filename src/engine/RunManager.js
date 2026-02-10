// RunManager.js — Pure class: run state (roster, node map, act progression, unit serialization)
// No Phaser deps.

import {
  ACT_SEQUENCE, ACT_CONFIG, STARTING_GOLD, MAX_SKILLS, ROSTER_CAP,
  DEADLY_ARSENAL_POOL, STARTING_ACCESSORY_TIERS, STARTING_STAFF_TIERS,
  ELITE_GOLD_MULTIPLIER,
} from '../utils/constants.js';
import { generateNodeMap } from './NodeMapGenerator.js';
import { createLordUnit, addToInventory, addToConsumables, equipAccessory, canEquip } from './UnitManager.js';
import { applyForge } from './ForgeSystem.js';
import { calculateBattleGold, generateRandomLegendary } from './LootSystem.js';
import { getRunKey, getActiveSlot } from './SlotManager.js';
import { buildBlessingIndex, createSeededRng, selectBlessingOptionsWithTelemetry } from './BlessingEngine.js';

// Phaser-specific fields that must be stripped for serialization
const PHASER_FIELDS = ['graphic', 'label', 'hpBar', 'factionIndicator'];

/** After JSON round-trip, re-link unit.weapon to matching inventory reference.
 *  Enforces proficiency: drops non-proficient equipped weapons to first valid or null. */
function relinkWeapon(unit) {
  if (!unit.weapon || !unit.inventory?.length) {
    if (!unit.inventory?.length) unit.weapon = null;
    return;
  }
  // If weapon is already in inventory AND proficient, keep it
  if (unit.inventory.includes(unit.weapon) && canEquip(unit, unit.weapon)) return;
  // Try JSON match that is also proficient
  const weaponStr = JSON.stringify(unit.weapon);
  const match = unit.inventory.find(w => JSON.stringify(w) === weaponStr && canEquip(unit, w));
  // Fallback: first proficient weapon in inventory
  unit.weapon = match || unit.inventory.find(w => canEquip(unit, w)) || null;
}

/**
 * Strip Phaser display objects from a unit, reset per-battle flags.
 */
export function serializeUnit(unit) {
  const data = { ...unit };
  for (const key of PHASER_FIELDS) data[key] = null;
  data.hasMoved = false;
  data.hasActed = false;
  data._miracleUsed = false;
  return data;
}

export class RunManager {
  /**
   * @param {{ lords, classes, weapons, skills, terrain, mapSizes, mapTemplates, enemies }} gameData
   * @param {object|null} metaEffects - active effects from MetaProgressionManager
   */
  constructor(gameData, metaEffects = null) {
    this.gameData = gameData;
    this.metaEffects = metaEffects;
    this.status = 'active';       // 'active' | 'victory' | 'defeat'
    this.actIndex = 0;
    this.roster = [];
    this.fallenUnits = [];  // Serialized units that died in battle
    this.nodeMap = null;
    this.currentNodeId = null;    // last completed node (null = start of act)
    this.completedBattles = 0;
    this.gold = STARTING_GOLD + (metaEffects?.goldBonus || 0);
    this.accessories = [];  // team accessory pool (unequipped accessories)
    this.scrolls = [];      // team scroll pool (skill teaching items)
    this.activeBlessings = [];
    this.blessingHistory = [];
    this.blessingSelectionTelemetry = null;
    this.blessingRuntimeModifiers = {
      battleGoldMultiplierDelta: 0,
      deployCapDelta: 0,
      actStatDeltaAllUnits: [],
      skipFirstShop: false,
      shopItemCountDelta: 0,
    };
    this._runStartBlessingsApplied = false;
    this.runSeed = null;
    this.battleConfigsByNodeId = {};
  }

  get currentAct() {
    return ACT_SEQUENCE[this.actIndex];
  }

  get currentActConfig() {
    return ACT_CONFIG[this.currentAct];
  }

  /** Initialize a new run: create starting roster + first act node map. */
  startRun(options = {}) {
    const {
      runSeed = null,
      applyBlessingsAtStart = true,
    } = options;
    this.roster = this.createInitialRoster();
    if (!Number.isFinite(this.runSeed)) {
      const initialSeed = runSeed ?? Date.now();
      this.runSeed = Number(initialSeed);
    }
    this.randomLegendary = generateRandomLegendary(this.gameData.weapons);
    this.nodeMap = generateNodeMap(this.currentAct, this.currentActConfig, this.gameData.mapTemplates);
    this.currentNodeId = null;
    this.blessingRuntimeModifiers = {
      battleGoldMultiplierDelta: 0,
      deployCapDelta: 0,
      actStatDeltaAllUnits: [],
      skipFirstShop: false,
      shopItemCountDelta: 0,
    };
    this.battleConfigsByNodeId = {};
    this.blessingHistory = [];
    this._runStartBlessingsApplied = false;
    this.initializeBlessingsAtRunStart(options);
    if (applyBlessingsAtStart && this.activeBlessings.length > 0) {
      this.applyRunStartBlessingEffects();
    }
  }

  initializeBlessingsAtRunStart(options = {}) {
    const {
      blessingSeed = null,
      blessingOptionCount = 3,
      autoSelectBlessing = false,
      debugBlessingSelection = false,
    } = options;
    const catalog = this.gameData?.blessings;
    if (!catalog || !Array.isArray(catalog.blessings)) {
      this.activeBlessings = [];
      this.blessingSelectionTelemetry = {
        seed: blessingSeed ?? this.runSeed,
        candidatePoolIds: [],
        offeredIds: [],
        chosenIds: [],
        rejectionReasons: [{ blessingId: null, reason: 'missing_catalog' }],
      };
      return;
    }

    const resolvedSeed = Number(blessingSeed ?? this.runSeed);
    const rng = createSeededRng(resolvedSeed);
    const { selected, telemetry } = selectBlessingOptionsWithTelemetry(
      catalog,
      rng,
      { count: blessingOptionCount, forceTier1: true, allowTier4: true }
    );

    const chosenIds = autoSelectBlessing ? selected.slice(0, 1).map(b => b.id) : [];
    this.activeBlessings = chosenIds;
    this.blessingSelectionTelemetry = {
      seed: resolvedSeed,
      candidatePoolIds: telemetry.candidatePoolIds,
      offeredIds: telemetry.chosenIds,
      chosenIds,
      rejectionReasons: telemetry.rejectionReasons,
      options: telemetry.options,
    };

    if (debugBlessingSelection && this.blessingSelectionTelemetry) {
      console.debug('BlessingSelection', this.blessingSelectionTelemetry);
    }
  }

  getBlessingOptions() {
    const offeredIds = this.blessingSelectionTelemetry?.offeredIds || [];
    const catalog = this.gameData?.blessings;
    if (!catalog || !Array.isArray(catalog.blessings)) return [];
    const index = buildBlessingIndex(catalog);
    return offeredIds.map((id) => index.get(id)).filter(Boolean);
  }

  chooseBlessing(blessingId = null) {
    const offeredIds = this.blessingSelectionTelemetry?.offeredIds || [];
    if (blessingId !== null && !offeredIds.includes(blessingId)) return false;
    const chosenIds = blessingId ? [blessingId] : [];
    this.activeBlessings = chosenIds;
    if (this.blessingSelectionTelemetry) {
      this.blessingSelectionTelemetry.chosenIds = chosenIds;
    }
    if (chosenIds.length === 0) {
      this._runStartBlessingsApplied = true;
      return true;
    }
    this._runStartBlessingsApplied = false;
    this.applyRunStartBlessingEffects();
    return true;
  }

  applyRunStartBlessingEffects() {
    if (this._runStartBlessingsApplied) return;
    if (!this.activeBlessings?.length) {
      this._runStartBlessingsApplied = true;
      return;
    }
    const catalog = this.gameData?.blessings;
    if (!catalog?.blessings?.length) {
      this._runStartBlessingsApplied = true;
      return;
    }

    const blessingIndex = buildBlessingIndex(catalog);
    for (const blessingId of this.activeBlessings) {
      const blessing = blessingIndex.get(blessingId);
      if (!blessing) {
        this._recordBlessingEvent('run_start', blessingId, null, { reason: 'unknown_blessing_id' });
        continue;
      }
      const effects = [...(blessing.boons || []), ...(blessing.costs || [])];
      for (const effect of effects) {
        this._applySingleRunStartBlessingEffect(blessingId, effect);
      }
    }
    this._runStartBlessingsApplied = true;
  }

  _recordBlessingEvent(stage, blessingId, effect, details = {}) {
    this.blessingHistory.push({
      timestamp: Date.now(),
      stage,
      eventType: 'effect_applied',
      blessingId,
      effectType: effect?.type || null,
      details,
    });
  }

  _applyStatDeltaToUnits(units, stat, value) {
    if (!Array.isArray(units) || !stat || !Number.isFinite(value) || value === 0) return;
    for (const unit of units) {
      unit.stats[stat] = (unit.stats[stat] || 0) + value;
      if (stat === 'HP') {
        if (value > 0) {
          unit.currentHP = (unit.currentHP || 0) + value;
        } else {
          unit.currentHP = Math.min(unit.currentHP || 0, unit.stats.HP || 0);
        }
      }
      if (stat === 'MOV') {
        unit.mov = (unit.mov || unit.stats.MOV || 0) + value;
      }
    }
  }

  _applySingleRunStartBlessingEffect(blessingId, effect) {
    if (!effect || !effect.type || !effect.params) return;
    const value = Number(effect.params.value || 0);
    if (!Number.isFinite(value)) return;

    if (effect.type === 'run_start_max_hp_bonus') {
      if (value === 0) return;
      const scope = effect.params.scope || 'all';
      const targetUnits = scope === 'lords'
        ? this.roster.filter(unit => unit.isLord)
        : this.roster;
      this._applyStatDeltaToUnits(targetUnits, 'HP', value);
      this._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: value, scope });
      return;
    }

    if (effect.type === 'gold_delta') {
      if (value !== 0) this.addGold(value);
      this._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: value });
      return;
    }

    if (effect.type === 'battle_gold_multiplier_delta') {
      this.blessingRuntimeModifiers.battleGoldMultiplierDelta += value;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: value,
        total: this.blessingRuntimeModifiers.battleGoldMultiplierDelta,
      });
      return;
    }

    if (effect.type === 'deploy_cap_delta') {
      this.blessingRuntimeModifiers.deployCapDelta += Math.trunc(value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: Math.trunc(value),
        total: this.blessingRuntimeModifiers.deployCapDelta,
      });
      return;
    }

    if (effect.type === 'starting_weapon_tier') {
      const requestedTier = String(effect.params.tier || '').trim();
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      if (!requestedTier || count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_weapon_tier_params',
        });
        return;
      }

      let granted = 0;
      const grantedWeapons = [];
      const allWeapons = Array.isArray(this.gameData?.weapons) ? this.gameData.weapons : [];
      for (const unit of this.roster) {
        if (granted >= count) break;
        const profTypes = new Set((unit.proficiencies || []).map(p => p.type));
        const candidate = allWeapons.find(w =>
          w?.tier === requestedTier &&
          profTypes.has(w.type) &&
          w.type !== 'Staff' &&
          w.type !== 'Consumable' &&
          w.type !== 'Scroll' &&
          canEquip(unit, w)
        );
        if (!candidate) continue;
        if (!addToInventory(unit, candidate)) continue;
        const addedWeapon = unit.inventory[unit.inventory.length - 1];
        if (addedWeapon && canEquip(unit, addedWeapon)) {
          unit.weapon = addedWeapon;
        }
        granted++;
        grantedWeapons.push({ unit: unit.name, weapon: addedWeapon?.name || candidate.name });
      }

      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedTier,
        requestedCount: count,
        grantedCount: granted,
        grantedWeapons,
      });
      return;
    }

    if (effect.type === 'act_stat_delta_all_units') {
      const targetAct = String(effect.params.act || '').trim();
      const stat = String(effect.params.stat || '').trim();
      if (!targetAct || !stat || value === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_act_stat_delta_all_units_params',
        });
        return;
      }

      if (!Array.isArray(this.blessingRuntimeModifiers.actStatDeltaAllUnits)) {
        this.blessingRuntimeModifiers.actStatDeltaAllUnits = [];
      }
      const tracker = {
        blessingId,
        act: targetAct,
        stat,
        value,
        applied: false,
        reverted: false,
      };
      if (targetAct === this.currentAct) {
        this._applyStatDeltaToUnits(this.roster, stat, value);
        tracker.applied = true;
      }
      this.blessingRuntimeModifiers.actStatDeltaAllUnits.push(tracker);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        act: targetAct,
        stat,
        appliedValue: value,
        appliedNow: tracker.applied,
      });
      return;
    }

    if (effect.type === 'lord_stat_bonus') {
      const stat = String(effect.params.stat || '').trim();
      if (!stat || value === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_lord_stat_bonus_params',
        });
        return;
      }
      const lords = this.roster.filter(unit => unit.isLord);
      this._applyStatDeltaToUnits(lords, stat, value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stat,
        appliedValue: value,
        appliedUnits: lords.map(u => u.name),
      });
      return;
    }

    if (effect.type === 'all_units_stat_delta') {
      const stat = String(effect.params.stat || '').trim();
      if (!stat || value === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_all_units_stat_delta_params',
        });
        return;
      }
      this._applyStatDeltaToUnits(this.roster, stat, value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stat,
        appliedValue: value,
        appliedUnits: this.roster.map(u => u.name),
      });
      return;
    }

    if (effect.type === 'skip_first_shop') {
      const enabled = effect.params.enabled !== false;
      this.blessingRuntimeModifiers.skipFirstShop = Boolean(enabled);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        enabled: this.blessingRuntimeModifiers.skipFirstShop,
      });
      return;
    }

    if (effect.type === 'shop_item_count_delta') {
      const delta = Math.trunc(value);
      this.blessingRuntimeModifiers.shopItemCountDelta += delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.shopItemCountDelta,
      });
      return;
    }

    this._recordBlessingEvent('run_start', blessingId, effect, { skipped: true, reason: 'unhandled_effect_type' });
  }

  getBattleGoldMultiplier() {
    const metaDelta = this.metaEffects?.battleGoldMultiplier || 0;
    const blessingDelta = this.blessingRuntimeModifiers?.battleGoldMultiplierDelta || 0;
    return Math.max(0, 1 + metaDelta + blessingDelta);
  }

  getDeployBonus() {
    const metaDelta = this.metaEffects?.deployBonus || 0;
    const blessingDelta = this.blessingRuntimeModifiers?.deployCapDelta || 0;
    return metaDelta + blessingDelta;
  }

  getShopItemCountDelta() {
    return Math.trunc(this.blessingRuntimeModifiers?.shopItemCountDelta || 0);
  }

  consumeSkipFirstShop() {
    if (!this.blessingRuntimeModifiers?.skipFirstShop) return false;
    this.blessingRuntimeModifiers.skipFirstShop = false;
    this._recordBlessingEvent('node_shop', null, { type: 'skip_first_shop', params: { enabled: true } }, {
      consumed: true,
    });
    return true;
  }

  /** Create Edric + Sera as the starting two lords. */
  createInitialRoster() {
    const { lords, classes, weapons, accessories } = this.gameData;
    const me = this.metaEffects;

    // Edric — Lord
    const edric = lords.find(l => l.name === 'Edric');
    const edricClass = classes.find(c => c.name === edric.class);
    const edricUnit = createLordUnit(edric, edricClass, weapons);
    this._applyLordMetaBonuses(edricUnit);

    // Edric's combat weapon — Deadly Arsenal (random) or default Steel Sword
    const edricProfType = edricUnit.proficiencies[0]?.type || 'Sword';
    const edricPool = me?.deadlyArsenal ? DEADLY_ARSENAL_POOL[edricProfType] : null;
    const edricWeaponName = edricPool
      ? edricPool[Math.floor(Math.random() * edricPool.length)]
      : 'Steel Sword';
    const edricWeapon = weapons.find(w => w.name === edricWeaponName);
    if (edricWeapon) addToInventory(edricUnit, edricWeapon);

    edricUnit.consumables.push({ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300 });
    if (me?.extraVulnerary) {
      edricUnit.consumables.push({ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300 });
    }

    // Sera — Light Sage
    const sera = lords.find(l => l.name === 'Sera');
    const seraClass = classes.find(c => c.name === sera.class);
    const seraUnit = createLordUnit(sera, seraClass, weapons);
    this._applyLordMetaBonuses(seraUnit);
    seraUnit.proficiencies.push({ type: 'Staff', rank: 'Prof' });

    // Sera's staff — tier upgrade
    const staffTier = me?.startingStaffTier || 0;
    const staffName = STARTING_STAFF_TIERS[staffTier] || 'Heal';
    const staff = weapons.find(w => w.name === staffName);
    if (staff) addToInventory(seraUnit, staff);

    // Sera's combat Light weapon — only if deadlyArsenal purchased
    if (me?.deadlyArsenal) {
      const seraProfType = seraUnit.proficiencies[0]?.type || 'Light';
      const seraPool = DEADLY_ARSENAL_POOL[seraProfType] || ['Aura'];
      const seraWeaponName = seraPool[Math.floor(Math.random() * seraPool.length)];
      const seraWeapon = weapons.find(w => w.name === seraWeaponName);
      if (seraWeapon) addToInventory(seraUnit, seraWeapon);
    }

    seraUnit.consumables.push({ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300 });

    // Apply weapon forges (Might) to all lords' combat weapons
    const forgeLevels = me?.startingWeaponForge || 0;
    if (forgeLevels > 0) {
      for (const unit of [edricUnit, seraUnit]) {
        for (const w of unit.inventory) {
          if (w.type === 'Staff') continue;
          for (let i = 0; i < forgeLevels; i++) applyForge(w, 'might');
        }
      }
    }

    // Starting accessory for Edric
    const accTier = me?.startingAccessoryTier || 0;
    if (accTier > 0 && accessories) {
      const accName = STARTING_ACCESSORY_TIERS[accTier];
      const acc = accessories.find(a => a.name === accName);
      if (acc) equipAccessory(edricUnit, structuredClone(acc));
    }

    // Starting skills from meta skill assignments
    const skillAssignments = me?.startingSkills || {};
    for (const unit of [edricUnit, seraUnit]) {
      const assigned = skillAssignments[unit.name] || [];
      for (const skillId of assigned) {
        if (!unit.skills.includes(skillId) && unit.skills.length < MAX_SKILLS) {
          unit.skills.push(skillId);
        }
      }
    }

    return [serializeUnit(edricUnit), serializeUnit(seraUnit)];
  }

  /** Apply lord meta-progression bonuses (stat + growth) to a lord unit. */
  _applyLordMetaBonuses(unit) {
    if (this.metaEffects?.lordStatBonuses) {
      for (const [stat, bonus] of Object.entries(this.metaEffects.lordStatBonuses)) {
        unit.stats[stat] = (unit.stats[stat] || 0) + bonus;
        if (stat === 'HP') unit.currentHP += bonus;
      }
    }
    if (this.metaEffects?.lordGrowthBonuses) {
      for (const [stat, bonus] of Object.entries(this.metaEffects.lordGrowthBonuses)) {
        unit.growths[stat] = (unit.growths[stat] || 0) + bonus;
      }
    }
  }

  /** Return nodes the player can select next. */
  getAvailableNodes() {
    if (!this.nodeMap) return [];

    // If no node completed yet, only the start node is available
    if (this.currentNodeId === null) {
      const start = this.nodeMap.nodes.find(n => n.id === this.nodeMap.startNodeId);
      return start ? [start] : [];
    }

    // Otherwise, edges from the completed node
    const current = this.nodeMap.nodes.find(n => n.id === this.currentNodeId);
    if (!current) return [];
    return current.edges
      .map(id => this.nodeMap.nodes.find(n => n.id === id))
      .filter(Boolean);
  }

  /** Mark a node as the current destination. Returns the node. */
  selectNode(nodeId) {
    const node = this.nodeMap.nodes.find(n => n.id === nodeId);
    if (!node) return null;
    return node;
  }

  /** Get battleParams for a battle node. */
  getBattleParams(node) {
    return node?.battleParams ? structuredClone(node.battleParams) : null;
  }

  getLockedBattleConfig(nodeId) {
    const cfg = this.battleConfigsByNodeId?.[nodeId];
    return cfg ? structuredClone(cfg) : null;
  }

  lockBattleConfig(nodeId, battleConfig) {
    if (!nodeId || !battleConfig) return;
    if (!this.battleConfigsByNodeId) this.battleConfigsByNodeId = {};
    if (!this.battleConfigsByNodeId[nodeId]) {
      this.battleConfigsByNodeId[nodeId] = structuredClone(battleConfig);
    }
    const node = this.nodeMap?.nodes?.find(n => n.id === nodeId);
    if (node) node.encounterLocked = true;
  }

  /** Get a deep copy of the roster for deployment. */
  getRoster() {
    const cloned = JSON.parse(JSON.stringify(this.roster));
    cloned.forEach(u => relinkWeapon(u));
    return cloned;
  }

  addGold(amount) {
    this.gold += amount;
  }

  spendGold(amount) {
    if (amount > this.gold) return false;
    this.gold -= amount;
    return true;
  }

  /**
   * Called after a battle victory. Serializes surviving units back to roster.
   * @param {Array} survivingUnits - units from BattleScene (with Phaser fields)
   * @param {string} nodeId - the node that was just completed
   * @param {number} goldEarned - accumulated kill gold from battle
   */
  completeBattle(survivingUnits, nodeId, goldEarned = 0) {
    // Track newly fallen units before overwriting roster
    const survivingNames = new Set(survivingUnits.map(u => u.name));
    const newlyFallen = this.roster.filter(u => !survivingNames.has(u.name));
    for (const fallen of newlyFallen) {
      if (!this.fallenUnits.find(f => f.name === fallen.name)) {
        this.fallenUnits.push(serializeUnit(fallen));
      }
    }

    this.roster = survivingUnits.map(u => serializeUnit(u));
    this.completedBattles++;
    const node = this.nodeMap?.nodes.find(n => n.id === nodeId);
    this.markNodeComplete(nodeId);
    const baseGold = calculateBattleGold(goldEarned, node?.type);
    const eliteMult = node?.battleParams?.isElite ? ELITE_GOLD_MULTIPLIER : 1;
    const goldMult = this.getBattleGoldMultiplier();
    const finalGold = Math.floor(baseGold * eliteMult * goldMult);
    this.addGold(finalGold);
  }

  /**
   * Rest: heal all roster units to full HP, mark node complete.
   * @param {string} nodeId - the rest node
   */
  rest(nodeId) {
    for (const unit of this.roster) {
      unit.currentHP = unit.stats.HP;
    }
    this.markNodeComplete(nodeId);
  }

  /**
   * Revive a fallen unit, restore to roster at 1 HP.
   * @param {string} unitName - name of fallen unit to revive
   * @param {number} cost - gold cost (1000g)
   * @returns {boolean} true if revived, false if roster full or insufficient gold
   */
  reviveFallenUnit(unitName, cost) {
    const rosterCap = ROSTER_CAP + (this.metaEffects?.rosterCapBonus || 0);
    if (this.roster.length >= rosterCap) return false; // Can't revive if roster full
    if (!this.spendGold(cost)) return false;

    const idx = this.fallenUnits.findIndex(u => u.name === unitName);
    if (idx === -1) return false;

    const unit = this.fallenUnits.splice(idx, 1)[0];
    unit.currentHP = 1; // Revive at 1 HP (risky if re-deployed)
    this.roster.push(unit);
    return true;
  }

  /** Mark a node as completed and update currentNodeId. */
  markNodeComplete(nodeId) {
    const node = this.nodeMap.nodes.find(n => n.id === nodeId);
    if (node) node.completed = true;
    this.currentNodeId = nodeId;
  }

  /** True if the boss node of the current act is completed. */
  isActComplete() {
    if (!this.nodeMap) return false;
    const boss = this.nodeMap.nodes.find(n => n.id === this.nodeMap.bossNodeId);
    return boss ? boss.completed : false;
  }

  /** Advance to the next act. Generates a new node map. */
  advanceAct() {
    this._revertActScopedBlessingEffects(this.currentAct);
    this.actIndex++;
    if (this.actIndex >= ACT_SEQUENCE.length) return; // shouldn't happen, use isRunComplete
    this.nodeMap = generateNodeMap(this.currentAct, this.currentActConfig, this.gameData.mapTemplates);
    this.currentNodeId = null;
  }

  _revertActScopedBlessingEffects(expiredAct) {
    const trackers = this.blessingRuntimeModifiers?.actStatDeltaAllUnits;
    if (!Array.isArray(trackers) || !expiredAct) return;
    for (const tracker of trackers) {
      if (!tracker || tracker.reverted || !tracker.applied || tracker.act !== expiredAct) continue;
      for (const unit of this.roster) {
        unit.stats[tracker.stat] = (unit.stats[tracker.stat] || 0) - tracker.value;
        if (tracker.stat === 'HP') {
          unit.currentHP = Math.min(unit.currentHP || 0, unit.stats.HP || 0);
        }
      }
      tracker.reverted = true;
      this._recordBlessingEvent(
        'act_transition',
        tracker.blessingId,
        { type: 'act_stat_delta_all_units', params: { act: tracker.act, stat: tracker.stat, value: tracker.value } },
        { revertedInAct: expiredAct, stat: tracker.stat, revertedValue: -tracker.value }
      );
    }
  }

  /** True if the final boss has been defeated. */
  isRunComplete() {
    return this.actIndex >= ACT_SEQUENCE.length - 1 && this.isActComplete();
  }

  /** Mark the run as a defeat. */
  failRun() {
    this.status = 'defeat';
  }

  /** Serialize run state to a plain object for localStorage. */
  toJSON() {
    return {
      version: 1,
      status: this.status,
      actIndex: this.actIndex,
      roster: this.roster,
      fallenUnits: this.fallenUnits,
      nodeMap: this.nodeMap,
      currentNodeId: this.currentNodeId,
      completedBattles: this.completedBattles,
      gold: this.gold,
      metaEffects: this.metaEffects,
      accessories: this.accessories,
      scrolls: this.scrolls,
      randomLegendary: this.randomLegendary || null,
      activeBlessings: this.activeBlessings || [],
      blessingHistory: this.blessingHistory || [],
      blessingSelectionTelemetry: this.blessingSelectionTelemetry || null,
      blessingRuntimeModifiers: this.blessingRuntimeModifiers || {
        battleGoldMultiplierDelta: 0,
        deployCapDelta: 0,
        actStatDeltaAllUnits: [],
        skipFirstShop: false,
        shopItemCountDelta: 0,
      },
      runSeed: this.runSeed,
      battleConfigsByNodeId: this.battleConfigsByNodeId || {},
    };
  }

  /**
   * Migrate old save format (mixed inventory) to new format (split inventory).
   * Moves consumables to unit.consumables[], scrolls to runManager.scrolls[].
   */
  static migrateInventorySplit(runManager) {
    for (const unit of runManager.roster) {
      // Skip if already migrated
      if (unit.consumables !== undefined) continue;

      // Create consumables array
      unit.consumables = [];

      // Scan inventory for items to migrate
      const toRemove = [];
      for (const item of unit.inventory) {
        if (item.type === 'Consumable') {
          unit.consumables.push(item);
          toRemove.push(item);
        } else if (item.type === 'Scroll') {
          if (!runManager.scrolls) runManager.scrolls = [];
          runManager.scrolls.push(item);
          toRemove.push(item);
        }
      }

      // Remove migrated items from old inventory
      for (const item of toRemove) {
        const idx = unit.inventory.indexOf(item);
        if (idx !== -1) unit.inventory.splice(idx, 1);
      }
    }
  }

  /** Restore a RunManager from saved data. */
  static fromJSON(saved, gameData) {
    const rm = new RunManager(gameData, saved.metaEffects || null);
    rm.status = saved.status;
    rm.actIndex = saved.actIndex;
    rm.roster = saved.roster;
    rm.fallenUnits = saved.fallenUnits || [];
    rm.nodeMap = saved.nodeMap;
    rm.currentNodeId = saved.currentNodeId;
    rm.completedBattles = saved.completedBattles;
    rm.gold = saved.gold;
    rm.accessories = saved.accessories || [];
    rm.scrolls = saved.scrolls || [];
    rm.randomLegendary = saved.randomLegendary || null;
    rm.activeBlessings = saved.activeBlessings || [];
    rm.blessingHistory = saved.blessingHistory || [];
    rm.blessingSelectionTelemetry = saved.blessingSelectionTelemetry || null;
    if (rm.blessingSelectionTelemetry && !Array.isArray(rm.blessingSelectionTelemetry.offeredIds)) {
      rm.blessingSelectionTelemetry.offeredIds = Array.isArray(rm.blessingSelectionTelemetry.chosenIds)
        ? [...rm.blessingSelectionTelemetry.chosenIds]
        : [];
      rm.blessingSelectionTelemetry.chosenIds = [];
    }
    rm.blessingRuntimeModifiers = saved.blessingRuntimeModifiers || {
      battleGoldMultiplierDelta: 0,
      deployCapDelta: 0,
      actStatDeltaAllUnits: [],
      skipFirstShop: false,
      shopItemCountDelta: 0,
    };
    if (!Array.isArray(rm.blessingRuntimeModifiers.actStatDeltaAllUnits)) {
      rm.blessingRuntimeModifiers.actStatDeltaAllUnits = [];
    }
    rm.blessingRuntimeModifiers.skipFirstShop = Boolean(rm.blessingRuntimeModifiers.skipFirstShop);
    rm.blessingRuntimeModifiers.shopItemCountDelta = Math.trunc(rm.blessingRuntimeModifiers.shopItemCountDelta || 0);
    rm.runSeed = Number.isFinite(saved.runSeed) ? Number(saved.runSeed) : null;
    rm.battleConfigsByNodeId = saved.battleConfigsByNodeId || {};
    rm._runStartBlessingsApplied = true;
    if (rm.nodeMap?.nodes && rm.battleConfigsByNodeId) {
      for (const node of rm.nodeMap.nodes) {
        if (rm.battleConfigsByNodeId[node.id]) node.encounterLocked = true;
      }
    }

    // Migrate old save format BEFORE relinking weapons
    // (migration may remove Consumables/Scrolls from inventory that relinkWeapon could pick as fallback)
    RunManager.migrateInventorySplit(rm);

    rm.roster.forEach(u => relinkWeapon(u));
    rm.fallenUnits.forEach(u => relinkWeapon(u));

    return rm;
  }
}

/** Resolve the storage key for a slot (uses active slot if not provided). */
function resolveRunKey(slotNumber) {
  const slot = slotNumber || getActiveSlot();
  if (!slot) return 'emblem_rogue_run_save'; // fallback for tests
  return getRunKey(slot);
}

export function saveRun(runManager, onSave, slotNumber) {
  const json = runManager.toJSON();
  const key = resolveRunKey(slotNumber);
  try {
    localStorage.setItem(key, JSON.stringify(json));
  } catch (_) { /* incognito / quota exceeded */ }
  if (onSave) onSave(json);
}

export function loadRun(gameData, slotNumber) {
  const key = resolveRunKey(slotNumber);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return RunManager.fromJSON(saved, gameData);
  } catch (_) {
    return null;
  }
}

export function hasSavedRun(slotNumber) {
  const key = resolveRunKey(slotNumber);
  try {
    return localStorage.getItem(key) !== null;
  } catch (_) {
    return false;
  }
}

export function clearSavedRun(onClear, slotNumber) {
  const key = resolveRunKey(slotNumber);
  try {
    localStorage.removeItem(key);
  } catch (_) { /* ignore */ }
  if (onClear) onClear();
}
