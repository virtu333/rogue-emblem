// RunManager.js — Pure class: run state (roster, node map, act progression, unit serialization)
// No Phaser deps.

import {
  ACT_SEQUENCE, ACT_CONFIG, STARTING_GOLD, MAX_SKILLS,
  DEADLY_ARSENAL_POOL, STARTING_ACCESSORY_TIERS, STARTING_STAFF_TIERS,
} from '../utils/constants.js';
import { generateNodeMap } from './NodeMapGenerator.js';
import { createLordUnit, addToInventory, addToConsumables, equipAccessory } from './UnitManager.js';
import { applyForge } from './ForgeSystem.js';
import { calculateBattleGold } from './LootSystem.js';
import { getRunKey, getActiveSlot } from './SlotManager.js';

// Phaser-specific fields that must be stripped for serialization
const PHASER_FIELDS = ['graphic', 'label', 'hpBar'];

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
    this.nodeMap = null;
    this.currentNodeId = null;    // last completed node (null = start of act)
    this.completedBattles = 0;
    this.gold = STARTING_GOLD + (metaEffects?.goldBonus || 0);
    this.accessories = [];  // team accessory pool (unequipped accessories)
    this.scrolls = [];      // team scroll pool (skill teaching items)
  }

  get currentAct() {
    return ACT_SEQUENCE[this.actIndex];
  }

  get currentActConfig() {
    return ACT_CONFIG[this.currentAct];
  }

  /** Initialize a new run: create starting roster + first act node map. */
  startRun() {
    this.roster = this.createInitialRoster();
    this.nodeMap = generateNodeMap(this.currentAct, this.currentActConfig);
    this.currentNodeId = null;
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
    return node.battleParams;
  }

  /** Get a deep copy of the roster for deployment. */
  getRoster() {
    return JSON.parse(JSON.stringify(this.roster));
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
    this.roster = survivingUnits.map(u => serializeUnit(u));
    this.completedBattles++;
    const node = this.nodeMap?.nodes.find(n => n.id === nodeId);
    this.markNodeComplete(nodeId);
    const battleGold = calculateBattleGold(goldEarned, node?.type);
    const multiplied = Math.floor(battleGold * (1 + (this.metaEffects?.battleGoldMultiplier || 0)));
    this.addGold(multiplied);
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
    this.actIndex++;
    if (this.actIndex >= ACT_SEQUENCE.length) return; // shouldn't happen, use isRunComplete
    this.nodeMap = generateNodeMap(this.currentAct, this.currentActConfig);
    this.currentNodeId = null;
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
      nodeMap: this.nodeMap,
      currentNodeId: this.currentNodeId,
      completedBattles: this.completedBattles,
      gold: this.gold,
      metaEffects: this.metaEffects,
      accessories: this.accessories,
      scrolls: this.scrolls,
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
    rm.nodeMap = saved.nodeMap;
    rm.currentNodeId = saved.currentNodeId;
    rm.completedBattles = saved.completedBattles;
    rm.gold = saved.gold;
    rm.accessories = saved.accessories || [];
    rm.scrolls = saved.scrolls || [];

    // Migrate old save format if needed
    RunManager.migrateInventorySplit(rm);

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
