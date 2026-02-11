// MetaProgressionManager.js — Pure class: persistent meta-progression (dual currency + upgrades)
// No Phaser deps. Follows SettingsManager pattern.

import {
  VALOR_PER_ACT, VALOR_PER_BATTLE, VALOR_VICTORY_BONUS,
  SUPPLY_PER_ACT, SUPPLY_PER_BATTLE, SUPPLY_VICTORY_BONUS,
  CATEGORY_CURRENCY, MAX_STARTING_SKILLS
} from '../utils/constants.js';

const DEFAULT_STORAGE_KEY = 'emblem_rogue_meta_save';

export class MetaProgressionManager {
  /**
   * @param {Array} upgradesData - metaUpgrades.json array
   * @param {string} [storageKey] - localStorage key (defaults to legacy key)
   */
  constructor(upgradesData, storageKey = DEFAULT_STORAGE_KEY) {
    this.onSave = null;
    this.upgradesData = upgradesData;
    this.storageKey = storageKey;
    this.totalValor = 0;
    this.totalSupply = 0;
    this.purchasedUpgrades = {};
    this.runsCompleted = 0;
    this.skillAssignments = {};  // { "Edric": ["sol", "vantage"], "Sera": ["miracle"] }
    this.milestones = new Set();  // e.g. "beatAct1", "beatAct2", "beatAct3"

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const saved = JSON.parse(raw);

        // Migration: old single-currency saves have totalRenown but no totalValor
        if (typeof saved.totalRenown === 'number' && saved.totalValor === undefined) {
          // Give full renown to BOTH currencies
          this.totalValor = saved.totalRenown;
          this.totalSupply = saved.totalRenown;
        } else {
          if (typeof saved.totalValor === 'number') this.totalValor = saved.totalValor;
          if (typeof saved.totalSupply === 'number') this.totalSupply = saved.totalSupply;
        }

        if (saved.purchasedUpgrades) this.purchasedUpgrades = saved.purchasedUpgrades;
        if (typeof saved.runsCompleted === 'number') this.runsCompleted = saved.runsCompleted;
        if (saved.skillAssignments) this.skillAssignments = saved.skillAssignments;
        // Migration: old saves without milestones default to empty
        if (Array.isArray(saved.milestones)) this.milestones = new Set(saved.milestones);
      }
    } catch (_) { /* incognito / quota exceeded */ }
  }

  getTotalValor() {
    return this.totalValor;
  }

  getTotalSupply() {
    return this.totalSupply;
  }

  addValor(amount) {
    this.totalValor += amount;
    this._save();
  }

  addSupply(amount) {
    this.totalSupply += amount;
    this._save();
  }

  getRunsCompleted() {
    return this.runsCompleted;
  }

  incrementRunsCompleted() {
    this.runsCompleted += 1;
    this._save();
  }

  getUpgradeLevel(id) {
    return this.purchasedUpgrades[id] || 0;
  }

  getNextCost(id) {
    const upgrade = this.upgradesData.find(u => u.id === id);
    if (!upgrade) return null;
    const level = this.getUpgradeLevel(id);
    if (level >= upgrade.maxLevel) return null;
    return upgrade.costs[level];
  }

  /** Get the currency type ('valor' or 'supply') for an upgrade by its ID. */
  getCurrencyForUpgrade(id) {
    const upgrade = this.upgradesData.find(u => u.id === id);
    if (!upgrade) return 'supply';
    return CATEGORY_CURRENCY[upgrade.category] || 'supply';
  }

  canAfford(id) {
    const cost = this.getNextCost(id);
    if (cost === null) return false;
    const currency = this.getCurrencyForUpgrade(id);
    const balance = currency === 'valor' ? this.totalValor : this.totalSupply;
    return balance >= cost;
  }

  isMaxed(id) {
    const upgrade = this.upgradesData.find(u => u.id === id);
    if (!upgrade) return false;
    return this.getUpgradeLevel(id) >= upgrade.maxLevel;
  }

  // --- Milestone methods ---

  hasMilestone(milestone) {
    return this.milestones.has(milestone);
  }

  recordMilestone(milestone) {
    if (this.milestones.has(milestone)) return;
    this.milestones.add(milestone);
    this._save();
  }

  getMilestones() {
    return [...this.milestones];
  }

  // --- Prerequisite methods ---

  /**
   * Check if all prerequisites for an upgrade are met.
   * @param {string} id - upgrade ID
   * @returns {boolean}
   */
  meetsPrerequisites(id) {
    const upgrade = this.upgradesData.find(u => u.id === id);
    if (!upgrade || !upgrade.requires) return true;
    const reqs = upgrade.requires;

    if (reqs.upgrades) {
      for (const req of reqs.upgrades) {
        if (this.getUpgradeLevel(req.id) < req.level) return false;
      }
    }
    if (reqs.milestones) {
      for (const m of reqs.milestones) {
        if (!this.milestones.has(m)) return false;
      }
    }
    return true;
  }

  /**
   * Get structured info about prerequisites for UI display.
   * @param {string} id - upgrade ID
   * @returns {{ met: boolean, missing: string[] }} - missing is human-readable list
   */
  getPrerequisiteInfo(id) {
    const upgrade = this.upgradesData.find(u => u.id === id);
    if (!upgrade || !upgrade.requires) return { met: true, missing: [] };

    const missing = [];
    const reqs = upgrade.requires;

    if (reqs.upgrades) {
      for (const req of reqs.upgrades) {
        if (this.getUpgradeLevel(req.id) < req.level) {
          const reqUpgrade = this.upgradesData.find(u => u.id === req.id);
          const name = reqUpgrade ? reqUpgrade.name : req.id;
          missing.push(`${name} Lv${req.level}`);
        }
      }
    }
    if (reqs.milestones) {
      const MILESTONE_LABELS = {
        beatAct1: 'Beat Act 1',
        beatAct2: 'Beat Act 2',
        beatAct3: 'Beat Act 3',
      };
      for (const m of reqs.milestones) {
        if (!this.milestones.has(m)) {
          missing.push(MILESTONE_LABELS[m] || m);
        }
      }
    }

    return { met: missing.length === 0, missing };
  }

  purchaseUpgrade(id) {
    if (!this.meetsPrerequisites(id)) return false;
    if (!this.canAfford(id)) return false;
    const cost = this.getNextCost(id);
    const currency = this.getCurrencyForUpgrade(id);
    if (currency === 'valor') {
      this.totalValor -= cost;
    } else {
      this.totalSupply -= cost;
    }
    this.purchasedUpgrades[id] = (this.purchasedUpgrades[id] || 0) + 1;
    this._save();
    return true;
  }

  // --- Skill assignment methods ---

  /** Get list of skill IDs unlocked via purchased unlock_* upgrades. */
  getUnlockedSkills() {
    const unlocked = [];
    for (const upgrade of this.upgradesData) {
      if (this.getUpgradeLevel(upgrade.id) === 0) continue;
      const effect = upgrade.effects[0];
      if (effect?.unlockSkill) unlocked.push(effect.unlockSkill);
    }
    return unlocked;
  }

  /** Get the skill assignments object: { lordName: [skillId, ...] } */
  getSkillAssignments() {
    return this.skillAssignments;
  }

  /** Assign a skill to a lord (max MAX_STARTING_SKILLS per lord). Returns true on success. */
  assignSkill(lordName, skillId) {
    if (!this.skillAssignments[lordName]) this.skillAssignments[lordName] = [];
    const slots = this.skillAssignments[lordName];
    if (slots.length >= MAX_STARTING_SKILLS) return false;
    if (slots.includes(skillId)) return false;
    // Must be an unlocked skill
    if (!this.getUnlockedSkills().includes(skillId)) return false;
    slots.push(skillId);
    this._save();
    return true;
  }

  /** Unassign a skill from a lord. Returns true if found and removed. */
  unassignSkill(lordName, skillId) {
    const slots = this.skillAssignments[lordName];
    if (!slots) return false;
    const idx = slots.indexOf(skillId);
    if (idx === -1) return false;
    slots.splice(idx, 1);
    if (slots.length === 0) delete this.skillAssignments[lordName];
    this._save();
    return true;
  }

  /**
   * Compute flat object of all active effects from purchased upgrades.
   * Returns: { statBonuses, growthBonuses, lordStatBonuses, lordGrowthBonuses,
   *            goldBonus, battleGoldMultiplier, extraVulnerary, lootWeaponWeightBonus,
   *            deployBonus, rosterCapBonus, recruitRandomSkill, startingWeaponForge, deadlyArsenal,
   *            startingAccessoryTier, startingStaffTier, startingSkills }
   */
  getActiveEffects() {
    const effects = {
      statBonuses: {},
      growthBonuses: {},
      lordStatBonuses: {},
      lordGrowthBonuses: {},
      goldBonus: 0,
      battleGoldMultiplier: 0,
      extraVulnerary: 0,
      lootWeaponWeightBonus: 0,
      deployBonus: 0,
      rosterCapBonus: 0,
      recruitRandomSkill: false,
      startingWeaponForge: 0,
      deadlyArsenal: 0,
      startingAccessoryTier: 0,
      startingStaffTier: 0,
      startingSkills: this.getSkillAssignments(),
    };

    for (const upgrade of this.upgradesData) {
      const level = this.getUpgradeLevel(upgrade.id);
      if (level === 0) continue;

      const effect = upgrade.effects[level - 1];
      if (!effect) continue;

      // Recruit flat stat bonuses
      if (effect.stat !== undefined) {
        effects.statBonuses[effect.stat] = (effects.statBonuses[effect.stat] || 0) + effect.value;
      }
      // Recruit growth bonuses
      if (effect.recruitGrowth !== undefined) {
        effects.growthBonuses[effect.recruitGrowth] =
          (effects.growthBonuses[effect.recruitGrowth] || 0) + effect.growthValue;
      }
      // Lord flat stat bonuses
      if (effect.lordStat !== undefined) {
        effects.lordStatBonuses[effect.lordStat] =
          (effects.lordStatBonuses[effect.lordStat] || 0) + effect.value;
      }
      // Lord growth bonuses
      if (effect.lordGrowth !== undefined) {
        effects.lordGrowthBonuses[effect.lordGrowth] =
          (effects.lordGrowthBonuses[effect.lordGrowth] || 0) + effect.growthValue;
      }
      if (effect.goldBonus !== undefined) effects.goldBonus = effect.goldBonus;
      if (effect.battleGoldMultiplier !== undefined) effects.battleGoldMultiplier = effect.battleGoldMultiplier;
      if (effect.extraVulnerary !== undefined) effects.extraVulnerary = effect.extraVulnerary;
      if (effect.lootWeaponWeightBonus !== undefined) effects.lootWeaponWeightBonus = effect.lootWeaponWeightBonus;
      if (effect.deployBonus !== undefined) effects.deployBonus = effect.deployBonus;
      if (effect.rosterCapBonus !== undefined) effects.rosterCapBonus = effect.rosterCapBonus;
      if (effect.recruitRandomSkill) effects.recruitRandomSkill = true;
      // Starting equipment effects
      if (effect.startingWeaponForge !== undefined) effects.startingWeaponForge = effect.startingWeaponForge;
      if (effect.deadlyArsenal !== undefined) effects.deadlyArsenal = effect.deadlyArsenal;
      if (effect.startingAccessoryTier !== undefined) effects.startingAccessoryTier = effect.startingAccessoryTier;
      if (effect.startingStaffTier !== undefined) effects.startingStaffTier = effect.startingStaffTier;
    }

    return effects;
  }

  reset() {
    this.totalValor = 0;
    this.totalSupply = 0;
    this.purchasedUpgrades = {};
    this.runsCompleted = 0;
    this.skillAssignments = {};
    this.milestones = new Set();
    this._save();
  }

  _save() {
    const payload = {
      totalValor: this.totalValor,
      totalSupply: this.totalSupply,
      purchasedUpgrades: this.purchasedUpgrades,
      runsCompleted: this.runsCompleted,
      skillAssignments: this.skillAssignments,
      milestones: [...this.milestones],
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (_) { /* incognito / quota exceeded */ }
    if (this.onSave) this.onSave(payload);
  }
}

/**
 * Calculate currencies earned from a run.
 * Both currencies earn at the same rate (intentionally doubles effective spending power).
 * @param {number} actIndex - 0-based act reached
 * @param {number} completedBattles - total battles won
 * @param {boolean} isVictory - whether the run was won
 * @param {number} [currencyMultiplier=1] - run difficulty currency multiplier
 * @returns {{ valor: number, supply: number }}
 */
export function calculateCurrencies(actIndex, completedBattles, isVictory, currencyMultiplier = 1) {
  const multiplier = Number.isFinite(currencyMultiplier) ? currencyMultiplier : 1;
  const valorBase = actIndex * VALOR_PER_ACT
    + completedBattles * VALOR_PER_BATTLE
    + (isVictory ? VALOR_VICTORY_BONUS : 0);
  const supplyBase = actIndex * SUPPLY_PER_ACT
    + completedBattles * SUPPLY_PER_BATTLE
    + (isVictory ? SUPPLY_VICTORY_BONUS : 0);
  const valor = Math.floor(valorBase * multiplier);
  const supply = Math.floor(supplyBase * multiplier);
  return { valor, supply };
}
