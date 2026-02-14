// MetaProgressionManager.js — Pure class: persistent meta-progression (dual currency + upgrades)
// No Phaser deps. Follows SettingsManager pattern.

import {
  VALOR_PER_ACT, VALOR_PER_BATTLE, VALOR_VICTORY_BONUS,
  SUPPLY_PER_ACT, SUPPLY_PER_BATTLE, SUPPLY_VICTORY_BONUS,
  CATEGORY_CURRENCY, MAX_STARTING_SKILLS, REFUND_FEE
} from '../utils/constants.js';

const DEFAULT_STORAGE_KEY = 'emblem_rogue_meta_save';
const DEADLY_ARSENAL_SPLIT_MIGRATION_CUTOFF = Date.UTC(2026, 1, 14);

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
    this.savedAt = 0;
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

        if (saved.purchasedUpgrades) this.purchasedUpgrades = { ...saved.purchasedUpgrades };
        this._migrateLegacyWeaponArtUpgradeState();
        this._migrateLegacyDeadlyArsenalUpgradeState(saved);
        if (typeof saved.runsCompleted === 'number') this.runsCompleted = saved.runsCompleted;
        if (saved.skillAssignments) this.skillAssignments = saved.skillAssignments;
        if (Number.isFinite(saved.savedAt)) this.savedAt = saved.savedAt;
        // Migration: old saves without milestones default to empty
        if (Array.isArray(saved.milestones)) this.milestones = new Set(saved.milestones);
      }
    } catch (_) { /* incognito / quota exceeded */ }
  }

  _migrateLegacyWeaponArtUpgradeState() {
    const legacyLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_art_infusion) || 0);
    if (legacyLevel <= 0) return;

    // Legacy Arcane Etching mapped to both Iron and Steel Arms.
    this.purchasedUpgrades.iron_arms = Math.max(
      legacyLevel,
      Number(this.purchasedUpgrades?.iron_arms) || 0
    );
    this.purchasedUpgrades.steel_arms = Math.max(
      legacyLevel,
      Number(this.purchasedUpgrades?.steel_arms) || 0
    );
  }

  _migrateLegacyDeadlyArsenalUpgradeState(saved = null) {
    const legacyLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_tier) || 0);
    const splitLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_tier_silver) || 0);
    if (legacyLevel <= 0 || splitLevel > 0) return;

    const savedAt = Number(saved?.savedAt);
    const shouldGrantSplitTier = !Number.isFinite(savedAt) || savedAt < DEADLY_ARSENAL_SPLIT_MIGRATION_CUTOFF;
    if (!shouldGrantSplitTier) return;

    // Preserve old Deadly Arsenal value after split: prior buyers receive both new tiers.
    this.purchasedUpgrades.weapon_tier_silver = 1;
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
        beatGame: 'Beat the Game',
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

  /**
   * Resolve weapon-art unlocks from purchased meta upgrades.
   * Supports:
   * - effect.unlockWeaponArt: string
   * - effect.unlockWeaponArts: string[]
   * - effect.unlockWeaponArtsByWeaponType: string | string[]
   * Returns a stable, de-duplicated ID list and fails closed for unknown IDs.
   */
  getUnlockedWeaponArts(weaponArtCatalog = null) {
    const catalog = Array.isArray(weaponArtCatalog) ? weaponArtCatalog : [];
    const validArtIds = new Set();
    const artIdsByWeaponType = new Map();

    for (const art of catalog) {
      if (!art?.id) continue;
      validArtIds.add(art.id);
      const weaponType = typeof art.weaponType === 'string' ? art.weaponType : null;
      if (!weaponType) continue;
      if (!artIdsByWeaponType.has(weaponType)) artIdsByWeaponType.set(weaponType, []);
      artIdsByWeaponType.get(weaponType).push(art.id);
    }

    const unlocked = [];
    const seen = new Set();
    const pushIfValid = (artId) => {
      if (typeof artId !== 'string' || artId.length <= 0) return;
      if (!validArtIds.has(artId)) return;
      if (seen.has(artId)) return;
      seen.add(artId);
      unlocked.push(artId);
    };
    const toStringList = (value) => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v.length > 0);
      return [];
    };

    for (const upgrade of this.upgradesData) {
      const level = this.getUpgradeLevel(upgrade.id);
      if (level === 0) continue;
      const effect = upgrade.effects[level - 1];
      if (!effect) continue;

      pushIfValid(effect.unlockWeaponArt);
      for (const artId of toStringList(effect.unlockWeaponArts)) pushIfValid(artId);
      for (const weaponType of toStringList(effect.unlockWeaponArtsByWeaponType)) {
        const bundle = artIdsByWeaponType.get(weaponType) || [];
        for (const artId of bundle) pushIfValid(artId);
      }
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
   *            goldBonus, battleGoldMultiplier, extraVulnerary, lootWeaponQualityBonus,
   *            deployBonus, rosterCapBonus, visionChargesBonus, recruitRandomSkill, recruitStartingVulnerary, extraStartingUnitTier,
   *            lethalArmoryTier,
   *            startingWeaponForge, deadlyArsenalTier,
   *            ironArms, steelArms, artAdept, startingAccessoryTier, startingStaffTier,
   *            startingSkills, metaUnlockedWeaponArts }
   */
  getActiveEffects(options = {}) {
    const effects = {
      statBonuses: {},
      growthBonuses: {},
      lordStatBonuses: {},
      lordGrowthBonuses: {},
      goldBonus: 0,
      battleGoldMultiplier: 0,
      extraVulnerary: 0,
      lootWeaponQualityBonus: 0,
      deployBonus: 0,
      rosterCapBonus: 0,
      visionChargesBonus: 0,
      recruitRandomSkill: false,
      recruitStartingVulnerary: 0,
      extraStartingUnitTier: 0,
      lethalArmoryTier: 0,
      startingWeaponForge: 0,
      deadlyArsenalTier: 0,
      ironArms: 0,
      steelArms: 0,
      artAdept: 0,
      startingAccessoryTier: 0,
      startingStaffTier: 0,
      startingSkills: this.getSkillAssignments(),
      metaUnlockedWeaponArts: this.getUnlockedWeaponArts(options.weaponArtCatalog || []),
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
      if (effect.lootWeaponWeightBonus !== undefined) effects.lootWeaponQualityBonus = effect.lootWeaponWeightBonus;
      if (effect.lootWeaponQualityBonus !== undefined) effects.lootWeaponQualityBonus = effect.lootWeaponQualityBonus;
      if (effect.deployBonus !== undefined) effects.deployBonus = effect.deployBonus;
      if (effect.rosterCapBonus !== undefined) effects.rosterCapBonus = effect.rosterCapBonus;
      if (effect.visionChargesBonus !== undefined) effects.visionChargesBonus = effect.visionChargesBonus;
      if (effect.recruitRandomSkill) effects.recruitRandomSkill = true;
      if (effect.recruitStartingVulnerary !== undefined) effects.recruitStartingVulnerary = effect.recruitStartingVulnerary;
      if (effect.extraStartingUnitTier !== undefined) effects.extraStartingUnitTier = effect.extraStartingUnitTier;
      if (effect.lethalArmoryTier !== undefined) {
        effects.lethalArmoryTier = Math.max(effects.lethalArmoryTier, Number(effect.lethalArmoryTier) || 0);
      }
      // Starting equipment effects
      if (effect.startingWeaponForge !== undefined) effects.startingWeaponForge = effect.startingWeaponForge;
      if (effect.deadlyArsenalTier !== undefined) {
        effects.deadlyArsenalTier = Math.max(effects.deadlyArsenalTier, Number(effect.deadlyArsenalTier) || 0);
      }
      if (effect.deadlyArsenal !== undefined && Number(effect.deadlyArsenal) > 0) {
        effects.deadlyArsenalTier = Math.max(effects.deadlyArsenalTier, 2);
      }
      if (effect.ironArms !== undefined) effects.ironArms = Math.max(effects.ironArms, Number(effect.ironArms) || 0);
      if (effect.steelArms !== undefined) effects.steelArms = Math.max(effects.steelArms, Number(effect.steelArms) || 0);
      if (effect.artAdept !== undefined) effects.artAdept = Math.max(effects.artAdept, Number(effect.artAdept) || 0);
      if (effect.startingAccessoryTier !== undefined) effects.startingAccessoryTier = effect.startingAccessoryTier;
      if (effect.startingStaffTier !== undefined) effects.startingStaffTier = effect.startingStaffTier;
    }

    return effects;
  }

  /**
   * Find upgrades that directly depend on `id` via their requires.upgrades[] field.
   * Checks direct edges only — does not perform transitive graph traversal.
   * This is intentional; the prerequisite graph is shallow (max depth 1).
   * @param {string} id - upgrade ID
   * @returns {Array<{ id: string, name: string, requiredLevel: number }>}
   */
  getDependentUpgrades(id) {
    const dependents = [];
    for (const upgrade of this.upgradesData) {
      if (!upgrade.requires?.upgrades) continue;
      for (const req of upgrade.requires.upgrades) {
        if (req.id === id) {
          dependents.push({ id: upgrade.id, name: upgrade.name, requiredLevel: req.level });
        }
      }
    }
    return dependents;
  }

  /**
   * Check whether an upgrade tier can be refunded.
   * @param {string} id - upgrade ID
   * @returns {{ success: boolean, reason?: string, detail?: string, refundAmount?: number, refundFee?: number }}
   */
  canRefund(id) {
    const upgrade = this.upgradesData.find(u => u.id === id);
    if (!upgrade) return { success: false, reason: 'unknown_upgrade' };

    const level = this.getUpgradeLevel(id);
    if (level <= 0) return { success: false, reason: 'not_purchased' };

    const currency = this.getCurrencyForUpgrade(id);
    const balance = currency === 'valor' ? this.totalValor : this.totalSupply;
    if (balance < REFUND_FEE) return { success: false, reason: 'insufficient_fee' };

    // Check if any purchased dependent would break
    const newLevel = level - 1;
    const dependents = this.getDependentUpgrades(id);
    for (const dep of dependents) {
      if (this.getUpgradeLevel(dep.id) > 0 && newLevel < dep.requiredLevel) {
        return {
          success: false,
          reason: 'blocked_by_dependent',
          detail: `${dep.name} requires this at Lv${dep.requiredLevel}`,
        };
      }
    }

    const refundAmount = upgrade.costs[level - 1];
    return { success: true, refundAmount, refundFee: REFUND_FEE };
  }

  /**
   * Refund one tier of an upgrade. Deducts REFUND_FEE, refunds tier cost, decrements level.
   * If a skill-unlock is refunded to 0, auto-unassigns that skill from all lords.
   * @param {string} id - upgrade ID
   * @returns {{ success: boolean, reason?: string, detail?: string, refundAmount?: number, refundFee?: number }}
   */
  refundUpgrade(id) {
    const check = this.canRefund(id);
    if (!check.success) return check;

    const upgrade = this.upgradesData.find(u => u.id === id);
    const level = this.getUpgradeLevel(id);
    const currency = this.getCurrencyForUpgrade(id);
    const refundAmount = upgrade.costs[level - 1];

    // Deduct fee + refund tier cost
    if (currency === 'valor') {
      this.totalValor = this.totalValor - REFUND_FEE + refundAmount;
    } else {
      this.totalSupply = this.totalSupply - REFUND_FEE + refundAmount;
    }

    // Decrement level
    this.purchasedUpgrades[id] = level - 1;
    if (this.purchasedUpgrades[id] <= 0) delete this.purchasedUpgrades[id];

    // If skill unlock refunded to 0, auto-unassign from all lords
    if (level === 1) {
      const effect = upgrade.effects[0];
      const skillId = effect?.unlockSkill;
      if (skillId) {
        for (const lordName of Object.keys(this.skillAssignments)) {
          const slots = this.skillAssignments[lordName];
          const idx = slots.indexOf(skillId);
          if (idx !== -1) {
            slots.splice(idx, 1);
            if (slots.length === 0) delete this.skillAssignments[lordName];
          }
        }
      }
    }

    this._save();
    return { success: true, refundAmount, refundFee: REFUND_FEE };
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
    this.savedAt = Date.now();
    const payload = {
      totalValor: this.totalValor,
      totalSupply: this.totalSupply,
      purchasedUpgrades: this.purchasedUpgrades,
      runsCompleted: this.runsCompleted,
      skillAssignments: this.skillAssignments,
      milestones: [...this.milestones],
      savedAt: this.savedAt,
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
