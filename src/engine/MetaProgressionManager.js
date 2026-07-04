// MetaProgressionManager.js — Pure class: persistent meta-progression (dual currency + upgrades)
// No Phaser deps. Follows SettingsManager pattern.

import {
  VALOR_PER_ACT,
  VALOR_PER_BATTLE,
  VALOR_VICTORY_BONUS,
  SUPPLY_PER_ACT,
  SUPPLY_PER_BATTLE,
  SUPPLY_VICTORY_BONUS,
  CATEGORY_CURRENCY,
  REFUND_FEE,
  MAX_STARTING_SKILLS,
} from '../utils/constants.js';
import { DEFAULT_STARTING_LORD_NAMES, defaultPartnerFor } from './Commander.js';

const DEFAULT_LORD_SELECTION = Object.freeze({
  commander: DEFAULT_STARTING_LORD_NAMES[0],
  partner: DEFAULT_STARTING_LORD_NAMES[1],
});

function normalizeLordSelection(raw) {
  const commander =
    typeof raw?.commander === 'string' && raw.commander.length > 0
      ? raw.commander
      : DEFAULT_LORD_SELECTION.commander;
  let partner =
    typeof raw?.partner === 'string' && raw.partner.length > 0
      ? raw.partner
      : defaultPartnerFor(commander);
  if (partner === commander) partner = defaultPartnerFor(commander);
  return { commander, partner };
}

function defaultStoryFlags() {
  return { bossSlain: {}, defeatedBy: {}, lordFalls: {}, lastRun: null };
}

function normalizeStoryCountMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (count > 0) out[name] = count;
  }
  return out;
}

function normalizeLastRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = raw.result === 'victory' || raw.result === 'defeat' ? raw.result : null;
  if (!result) return null;
  return {
    result,
    act: typeof raw.act === 'string' ? raw.act : null,
    difficultyId: typeof raw.difficultyId === 'string' ? raw.difficultyId : 'normal',
    defeatedBy: typeof raw.defeatedBy === 'string' ? raw.defeatedBy : null,
    endedAt: Number.isFinite(raw.endedAt) ? raw.endedAt : 0,
  };
}

function normalizeStoryFlags(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultStoryFlags();
  return {
    bossSlain: normalizeStoryCountMap(raw.bossSlain),
    defeatedBy: normalizeStoryCountMap(raw.defeatedBy),
    lordFalls: normalizeStoryCountMap(raw.lordFalls),
    lastRun: normalizeLastRun(raw.lastRun),
  };
}

const DEFAULT_STORAGE_KEY = 'emblem_rogue_meta_save';
const DEADLY_ARSENAL_SPLIT_MIGRATION_CUTOFF = Date.UTC(2026, 1, 14);
const LOOT_CATEGORY_WEIGHT_BONUS_KEYS = new Set([
  'weapon',
  'healing',
  'statBooster',
  'promotion',
  'skillScroll',
  'weaponArtScroll',
  'legendaryWeapon',
  'accessory',
  'forge',
  'gold',
]);

function normalizeLootCategoryWeight(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeLootCategoryWeightBonuses(rawMap) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return null;
  const out = {};
  let added = false;
  for (const [key, rawValue] of Object.entries(rawMap)) {
    if (!LOOT_CATEGORY_WEIGHT_BONUS_KEYS.has(key)) continue;
    const value = normalizeLootCategoryWeight(rawValue);
    if (value === 0) continue;
    out[key] = (out[key] || 0) + value;
    added = true;
  }
  return added ? out : null;
}

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
    this.runsStarted = 0;
    this.skillAssignments = {}; // { "Edric": ["sol", "vantage"], "Sera": ["miracle"] }
    this.lordSelection = { ...DEFAULT_LORD_SELECTION }; // commander-choice picks, persisted
    this.milestones = new Set(); // e.g. "beatAct1", "beatAct2", "beatAct3"
    this.storyFlags = defaultStoryFlags(); // run-aware narrative memory

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const saved = JSON.parse(raw);

        // Migration: old single-currency saves have totalRenown but no totalValor
        if (typeof saved.totalRenown === 'number' && saved.totalValor === undefined) {
          // Give full renown to BOTH currencies
          this.totalValor = Number.isFinite(saved.totalRenown)
            ? Math.max(0, Math.floor(saved.totalRenown))
            : 0;
          this.totalSupply = Number.isFinite(saved.totalRenown)
            ? Math.max(0, Math.floor(saved.totalRenown))
            : 0;
        } else {
          if (Number.isFinite(saved.totalValor))
            this.totalValor = Math.max(0, Math.floor(saved.totalValor));
          if (Number.isFinite(saved.totalSupply))
            this.totalSupply = Math.max(0, Math.floor(saved.totalSupply));
        }

        if (saved.purchasedUpgrades) this.purchasedUpgrades = { ...saved.purchasedUpgrades };
        this._migrateLegacyWeaponArtUpgradeState();
        this._migrateLegacyDeadlyArsenalUpgradeState(saved);
        if (typeof saved.runsCompleted === 'number') this.runsCompleted = saved.runsCompleted;
        if (typeof saved.runsStarted === 'number')
          this.runsStarted = Math.max(0, Math.floor(saved.runsStarted));
        // Migration: saves predating the started counter — every finished run
        // was started, so the completed count is a floor.
        if (this.runsStarted < this.runsCompleted) this.runsStarted = this.runsCompleted;
        if (saved.skillAssignments) this.skillAssignments = saved.skillAssignments;
        if (saved.lordSelection) this.lordSelection = normalizeLordSelection(saved.lordSelection);
        if (Number.isFinite(saved.savedAt)) this.savedAt = saved.savedAt;
        // Migration: old saves without milestones default to empty
        if (Array.isArray(saved.milestones)) this.milestones = new Set(saved.milestones);
        // Migration: old saves without storyFlags default to empty memory
        if (saved.storyFlags) this.storyFlags = normalizeStoryFlags(saved.storyFlags);
      }
    } catch (_) {
      /* incognito / quota exceeded */
    }
  }

  _migrateLegacyWeaponArtUpgradeState() {
    const legacyLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_art_infusion) || 0);
    if (legacyLevel <= 0) return;

    // Legacy Arcane Etching mapped to both Iron and Steel Arms.
    this.purchasedUpgrades.iron_arms = Math.max(
      legacyLevel,
      Number(this.purchasedUpgrades?.iron_arms) || 0,
    );
    this.purchasedUpgrades.steel_arms = Math.max(
      legacyLevel,
      Number(this.purchasedUpgrades?.steel_arms) || 0,
    );
  }

  _migrateLegacyDeadlyArsenalUpgradeState(saved = null) {
    const legacyLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_tier) || 0);
    const splitLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_tier_silver) || 0);
    if (legacyLevel <= 0 || splitLevel > 0) return;

    const savedAt = Number(saved?.savedAt);
    const shouldGrantSplitTier =
      !Number.isFinite(savedAt) || savedAt < DEADLY_ARSENAL_SPLIT_MIGRATION_CUTOFF;
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
    if (!Number.isFinite(amount)) return;
    const current = Number.isFinite(this.totalValor) ? this.totalValor : 0;
    this.totalValor = Math.max(0, Math.floor(current + amount));
    this._save();
  }

  addSupply(amount) {
    if (!Number.isFinite(amount)) return;
    const current = Number.isFinite(this.totalSupply) ? this.totalSupply : 0;
    this.totalSupply = Math.max(0, Math.floor(current + amount));
    this._save();
  }

  getRunsCompleted() {
    return this.runsCompleted;
  }

  incrementRunsCompleted() {
    this.runsCompleted += 1;
    // A finished run was necessarily started (covers runs begun before the
    // started counter existed, or counted on another device).
    if (this.runsStarted < this.runsCompleted) this.runsStarted = this.runsCompleted;
    this._save();
  }

  getRunsStarted() {
    return this.runsStarted;
  }

  incrementRunsStarted() {
    this.runsStarted += 1;
    this._save();
  }

  getUpgradeLevel(id) {
    const raw = this.purchasedUpgrades[id];
    return Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 0);
  }

  getNextCost(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade) return null;
    const level = this.getUpgradeLevel(id);
    if (level >= upgrade.maxLevel) return null;
    return upgrade.costs[level];
  }

  /** Get the currency type ('valor' or 'supply') for an upgrade by its ID. */
  getCurrencyForUpgrade(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
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
    const upgrade = this.upgradesData.find((u) => u.id === id);
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

  // --- Story flag methods (run-aware narrative memory) ---

  getStoryFlags() {
    return this.storyFlags;
  }

  getBossSlainCount(name) {
    return Math.max(0, Math.floor(Number(this.storyFlags?.bossSlain?.[name]) || 0));
  }

  getDefeatedByCount(name) {
    return Math.max(0, Math.floor(Number(this.storyFlags?.defeatedBy?.[name]) || 0));
  }

  recordBossSlain(name) {
    if (typeof name !== 'string' || !name.trim()) return;
    const key = name.trim();
    this.storyFlags.bossSlain[key] = this.getBossSlainCount(key) + 1;
    this._save();
  }

  /**
   * Record how a run ended. Called exactly once per run, from
   * RunManager._applySettledRewardsToMeta (under its appliedToMeta guard).
   * defeatedBy is only counted when the fatal battle was a boss fight.
   */
  recordRunEnd({
    result,
    act = null,
    difficultyId = 'normal',
    defeatedBy = null,
    wasBossDefeat = false,
    lordFalls = [],
  } = {}) {
    if (result !== 'victory' && result !== 'defeat') return;
    const foe = typeof defeatedBy === 'string' && defeatedBy ? defeatedBy : null;
    this.storyFlags.lastRun = {
      result,
      act: typeof act === 'string' ? act : null,
      difficultyId: typeof difficultyId === 'string' ? difficultyId : 'normal',
      defeatedBy: foe,
      endedAt: Date.now(),
    };
    if (result === 'defeat' && wasBossDefeat && foe) {
      this.storyFlags.defeatedBy[foe] = this.getDefeatedByCount(foe) + 1;
    }
    if (Array.isArray(lordFalls)) {
      for (const lordName of lordFalls) {
        if (typeof lordName !== 'string' || !lordName) continue;
        const current = Math.max(0, Math.floor(Number(this.storyFlags.lordFalls[lordName]) || 0));
        this.storyFlags.lordFalls[lordName] = current + 1;
      }
    }
    this._save();
  }

  // --- Prerequisite methods ---

  /**
   * Check if all prerequisites for an upgrade are met.
   * @param {string} id - upgrade ID
   * @returns {boolean}
   */
  meetsPrerequisites(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
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
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade || !upgrade.requires) return { met: true, missing: [] };

    const missing = [];
    const reqs = upgrade.requires;

    if (reqs.upgrades) {
      for (const req of reqs.upgrades) {
        if (this.getUpgradeLevel(req.id) < req.level) {
          const reqUpgrade = this.upgradesData.find((u) => u.id === req.id);
          const isPurchased = this.getUpgradeLevel(req.id) > 0;
          const name = !reqUpgrade
            ? req.id
            : this.isMilestoneLocked(reqUpgrade) && !isPurchased
              ? '???'
              : reqUpgrade.name;
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
        beatHard: 'Beat the Game on Hard',
        beatLunatic: 'Beat the Game on Lunatic',
      };
      for (const m of reqs.milestones) {
        if (!this.milestones.has(m)) {
          missing.push(MILESTONE_LABELS[m] || m);
        }
      }
    }

    return { met: missing.length === 0, missing };
  }

  isMilestoneLocked(upgrade) {
    if (!upgrade?.requires?.milestones) return false;
    return upgrade.requires.milestones.some((milestone) => !this.milestones.has(milestone));
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
    this.purchasedUpgrades[id] = this.getUpgradeLevel(id) + 1;
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
      if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.length > 0);
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

  /** Number of starting skill slots available (1 base + extra_skill_slot upgrade). */
  getStartingSkillSlots() {
    return Math.min(1 + this.getUpgradeLevel('extra_skill_slot'), MAX_STARTING_SKILLS);
  }

  /** Assign a skill to a lord (max getStartingSkillSlots() per lord). Returns true on success. */
  assignSkill(lordName, skillId) {
    if (!this.skillAssignments[lordName]) this.skillAssignments[lordName] = [];
    const slots = this.skillAssignments[lordName];
    if (slots.length >= this.getStartingSkillSlots()) return false;
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

  // --- Commander choice methods ---

  /** Highest commanderChoiceTier across purchased upgrades (0 = not purchased). */
  getCommanderChoiceTier() {
    let tier = 0;
    for (const upgrade of this.upgradesData) {
      const level = this.getUpgradeLevel(upgrade.id);
      if (level === 0) continue;
      const effectTier = Number(upgrade.effects[level - 1]?.commanderChoiceTier) || 0;
      if (effectTier > tier) tier = effectTier;
    }
    return tier;
  }

  /**
   * The starting pair after tier gating: tier 0 forces the default pair,
   * tier 1 honors the commander and forces the default partner, tier 2
   * honors both. Lord-name existence is enforced by the consumer
   * (RunManager falls back to the default pair for unknown names).
   */
  getLordSelection() {
    const tier = this.getCommanderChoiceTier();
    if (tier <= 0) return { ...DEFAULT_LORD_SELECTION };
    const stored = normalizeLordSelection(this.lordSelection);
    if (tier === 1)
      return { commander: stored.commander, partner: defaultPartnerFor(stored.commander) };
    return stored;
  }

  /**
   * Pick the commander (requires tier >= 1). If the pick collides with the
   * stored partner, the partner resets to the default for that commander.
   */
  setCommander(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    if (this.getCommanderChoiceTier() < 1) return false;
    const partner =
      this.lordSelection?.partner === name ? defaultPartnerFor(name) : this.lordSelection?.partner;
    this.lordSelection = normalizeLordSelection({ commander: name, partner });
    this._save();
    return true;
  }

  /** Pick the partner (requires tier >= 2; must differ from the commander). */
  setPartner(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    if (this.getCommanderChoiceTier() < 2) return false;
    if (this.lordSelection?.commander === name) return false;
    this.lordSelection = normalizeLordSelection({
      commander: this.lordSelection?.commander,
      partner: name,
    });
    this._save();
    return true;
  }

  /**
   * Compute flat object of all active effects from purchased upgrades.
   * Returns: { statBonuses, growthBonuses, lordStatBonuses, lordGrowthBonuses,
   *            goldBonus, battleGoldMultiplier, extraVulnerary, lootWeaponQualityBonus, lootCategoryWeightBonuses,
   *            lordRecruitChanceBonus, recruitPromotionChanceBonus,
   *            deployBonus, rosterCapBonus, visionChargesBonus, caravanChanceBonus, recruitRandomSkill, recruitStartingVulnerary, extraStartingUnitTier,
   *            lethalArmoryTier,
   *            startingWeaponForge, deadlyArsenalTier,
   *            ironArms, steelArms, artAdept, startingAccessoryTier, startingStaffTier,
   *            startingReclassSeal,
   *            startingSkills, metaUnlockedWeaponArts,
   *            commanderChoiceTier, startingLords }
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
      lootCategoryWeightBonuses: {},
      lootWeaponQualityBonus: 0,
      lordRecruitChanceBonus: 0,
      recruitPromotionChanceBonus: 0,
      deployBonus: 0,
      rosterCapBonus: 0,
      visionChargesBonus: 0,
      caravanChanceBonus: 0,
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
      startingReclassSeal: 0,
      extraSkillSlot: 0,
      masterOfArms: false,
      thirdLordMode: null,
      commanderChoiceTier: 0,
      startingLords: null,
      startingSkills: {},
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
      if (effect.battleGoldMultiplier !== undefined)
        effects.battleGoldMultiplier = effect.battleGoldMultiplier;
      if (effect.extraVulnerary !== undefined) effects.extraVulnerary = effect.extraVulnerary;
      if (effect.lootCategoryWeightBonuses) {
        const mapped = normalizeLootCategoryWeightBonuses(effect.lootCategoryWeightBonuses);
        if (mapped) {
          for (const [category, delta] of Object.entries(mapped)) {
            effects.lootCategoryWeightBonuses[category] =
              normalizeLootCategoryWeight(effects.lootCategoryWeightBonuses[category]) + delta;
          }
        }
      }
      if (
        effect.lootWeaponWeightBonus !== undefined ||
        effect.lootWeaponQualityBonus !== undefined
      ) {
        const bonus = normalizeLootCategoryWeight(
          effect.lootWeaponQualityBonus ?? effect.lootWeaponWeightBonus,
        );
        if (bonus !== 0) {
          effects.lootWeaponQualityBonus = bonus;
          effects.lootCategoryWeightBonuses.weapon =
            normalizeLootCategoryWeight(effects.lootCategoryWeightBonuses.weapon) + bonus;
        }
      }
      if (effect.lordRecruitChanceBonus !== undefined)
        effects.lordRecruitChanceBonus = effect.lordRecruitChanceBonus;
      if (effect.recruitPromotionChanceBonus !== undefined)
        effects.recruitPromotionChanceBonus = effect.recruitPromotionChanceBonus;
      if (effect.deployBonus !== undefined) effects.deployBonus = effect.deployBonus;
      if (effect.rosterCapBonus !== undefined) effects.rosterCapBonus = effect.rosterCapBonus;
      if (effect.visionChargesBonus !== undefined)
        effects.visionChargesBonus = effect.visionChargesBonus;
      if (effect.caravanChanceBonus !== undefined)
        effects.caravanChanceBonus = effect.caravanChanceBonus;
      if (effect.recruitRandomSkill) effects.recruitRandomSkill = true;
      if (effect.recruitStartingVulnerary !== undefined)
        effects.recruitStartingVulnerary = effect.recruitStartingVulnerary;
      if (effect.extraStartingUnitTier !== undefined)
        effects.extraStartingUnitTier = effect.extraStartingUnitTier;
      if (effect.lethalArmoryTier !== undefined) {
        effects.lethalArmoryTier = Math.max(
          effects.lethalArmoryTier,
          Number(effect.lethalArmoryTier) || 0,
        );
      }
      // Starting equipment effects
      if (effect.startingWeaponForge !== undefined)
        effects.startingWeaponForge = effect.startingWeaponForge;
      if (effect.deadlyArsenalTier !== undefined) {
        effects.deadlyArsenalTier = Math.max(
          effects.deadlyArsenalTier,
          Number(effect.deadlyArsenalTier) || 0,
        );
      }
      if (effect.deadlyArsenal !== undefined && Number(effect.deadlyArsenal) > 0) {
        effects.deadlyArsenalTier = Math.max(effects.deadlyArsenalTier, 2);
      }
      if (effect.ironArms !== undefined)
        effects.ironArms = Math.max(effects.ironArms, Number(effect.ironArms) || 0);
      if (effect.steelArms !== undefined)
        effects.steelArms = Math.max(effects.steelArms, Number(effect.steelArms) || 0);
      if (effect.artAdept !== undefined)
        effects.artAdept = Math.max(effects.artAdept, Number(effect.artAdept) || 0);
      if (effect.startingAccessoryTier !== undefined)
        effects.startingAccessoryTier = effect.startingAccessoryTier;
      if (effect.startingStaffTier !== undefined)
        effects.startingStaffTier = effect.startingStaffTier;
      if (effect.startingReclassSeal !== undefined)
        effects.startingReclassSeal = effect.startingReclassSeal;
      if (effect.extraSkillSlot !== undefined) effects.extraSkillSlot = effect.extraSkillSlot;
      if (effect.masterOfArms) effects.masterOfArms = true;
      if (effect.thirdLordMode !== undefined) effects.thirdLordMode = effect.thirdLordMode;
      if (effect.commanderChoiceTier !== undefined) {
        effects.commanderChoiceTier = Math.max(
          effects.commanderChoiceTier,
          Number(effect.commanderChoiceTier) || 0,
        );
      }
    }

    // Starting pair from the commander-choice selection (tier-gated; null when unpurchased)
    if (effects.commanderChoiceTier > 0) {
      effects.startingLords = this.getLordSelection();
    }

    // Trim startingSkills per lord to available slot count
    const maxSlots = this.getStartingSkillSlots();
    const rawAssignments = this.getSkillAssignments();
    for (const [lord, skills] of Object.entries(rawAssignments)) {
      if (Array.isArray(skills) && skills.length > 0) {
        effects.startingSkills[lord] = skills.slice(0, maxSlots);
      }
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
    const upgrade = this.upgradesData.find((u) => u.id === id);
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

    const upgrade = this.upgradesData.find((u) => u.id === id);
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
      // Commander-choice refund: snap the stored selection back to what the
      // remaining tier supports (tier 1 -> default partner, tier 0 -> default pair).
      if (Number(effect?.commanderChoiceTier) > 0) {
        this.lordSelection = this.getLordSelection();
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
    this.runsStarted = 0;
    this.skillAssignments = {};
    this.lordSelection = { ...DEFAULT_LORD_SELECTION };
    this.milestones = new Set();
    this.storyFlags = defaultStoryFlags();
    this._save();
  }

  /**
   * Read the per-slot clock floor CloudSync records on remote-newer conflicts.
   * Key derivation must match SlotManager.getMetaClockFloorKey(slot), which is
   * getMetaKey(slot) + '_clock_floor'; storageKey IS getMetaKey(slot) for slot
   * saves, so appending the suffix here stays in sync.
   */
  _readClockFloorSavedAt() {
    try {
      const raw = localStorage.getItem(`${this.storageKey}_clock_floor`);
      if (raw == null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * If another writer (cloud fetch merge, fresh-local heal) has put a newer
   * payload on disk since this manager last read/wrote it, our in-memory state
   * is a stale lineage. Adopt the disk state via a conservative max-merge so a
   * fresh session can never erase restored progression by saving over it.
   */
  _adoptForeignDiskStateIfNewer() {
    let disk = null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) disk = JSON.parse(raw);
    } catch (_) {
      return;
    }
    const diskSavedAt = Number(disk?.savedAt);
    if (!Number.isFinite(diskSavedAt) || diskSavedAt <= this.savedAt) return;

    this.totalValor = Math.max(this.totalValor, Math.floor(Number(disk.totalValor) || 0));
    this.totalSupply = Math.max(this.totalSupply, Math.floor(Number(disk.totalSupply) || 0));
    this.runsCompleted = Math.max(this.runsCompleted, Number(disk.runsCompleted) || 0);
    this.runsStarted = Math.max(
      this.runsStarted,
      Number(disk.runsStarted) || 0,
      this.runsCompleted,
    );
    if (disk.purchasedUpgrades && typeof disk.purchasedUpgrades === 'object') {
      for (const [id, level] of Object.entries(disk.purchasedUpgrades)) {
        const diskLevel = Number(level) || 0;
        const localLevel = Number(this.purchasedUpgrades[id]) || 0;
        this.purchasedUpgrades[id] = Math.max(localLevel, diskLevel);
      }
    }
    if (Array.isArray(disk.milestones)) {
      for (const m of disk.milestones) this.milestones.add(m);
    }
    if (disk.skillAssignments && typeof disk.skillAssignments === 'object') {
      for (const [lord, slots] of Object.entries(disk.skillAssignments)) {
        if (this.skillAssignments[lord] === undefined) this.skillAssignments[lord] = slots;
      }
    }
    // Adopt-if-default: a still-default local selection takes the disk's picks.
    if (
      disk.lordSelection &&
      this.lordSelection.commander === DEFAULT_LORD_SELECTION.commander &&
      this.lordSelection.partner === DEFAULT_LORD_SELECTION.partner
    ) {
      this.lordSelection = normalizeLordSelection(disk.lordSelection);
    }
    if (disk.storyFlags && typeof disk.storyFlags === 'object') {
      const diskFlags = normalizeStoryFlags(disk.storyFlags);
      // Counters are monotonic, so per-name max can only over-remember —
      // it can never resurrect a reverted event.
      for (const mapKey of ['bossSlain', 'defeatedBy', 'lordFalls']) {
        for (const [name, count] of Object.entries(diskFlags[mapKey])) {
          const local = Math.max(0, Math.floor(Number(this.storyFlags[mapKey][name]) || 0));
          this.storyFlags[mapKey][name] = Math.max(local, count);
        }
      }
      const diskEndedAt = Number(diskFlags.lastRun?.endedAt) || 0;
      const localEndedAt = Number(this.storyFlags.lastRun?.endedAt) || 0;
      if (diskFlags.lastRun && diskEndedAt > localEndedAt) {
        this.storyFlags.lastRun = diskFlags.lastRun;
      }
    }
    this.savedAt = diskSavedAt;
  }

  _save() {
    this._adoptForeignDiskStateIfNewer();
    const floor = this._readClockFloorSavedAt();
    this.savedAt = Math.max(Date.now(), this.savedAt + 1, Number.isFinite(floor) ? floor + 1 : 0);
    const payload = {
      totalValor: this.totalValor,
      totalSupply: this.totalSupply,
      purchasedUpgrades: this.purchasedUpgrades,
      runsCompleted: this.runsCompleted,
      runsStarted: this.runsStarted,
      skillAssignments: this.skillAssignments,
      lordSelection: this.lordSelection,
      milestones: [...this.milestones],
      storyFlags: this.storyFlags,
      savedAt: this.savedAt,
    };
    let localOk = false;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
      localOk = true;
    } catch (err) {
      console.warn('[MetaProgression] localStorage write failed:', err?.message || err);
    }

    if (localOk && this.onSave) {
      try {
        this.onSave(payload);
      } catch (err) {
        console.warn('[MetaProgression] onSave callback error:', err?.message || err);
      }
    }

    return { ok: localOk };
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
  const valorBase =
    actIndex * VALOR_PER_ACT +
    completedBattles * VALOR_PER_BATTLE +
    (isVictory ? VALOR_VICTORY_BONUS : 0);
  const supplyBase =
    actIndex * SUPPLY_PER_ACT +
    completedBattles * SUPPLY_PER_BATTLE +
    (isVictory ? SUPPLY_VICTORY_BONUS : 0);
  const valor = Math.floor(valorBase * multiplier);
  const supply = Math.floor(supplyBase * multiplier);
  return { valor, supply };
}
