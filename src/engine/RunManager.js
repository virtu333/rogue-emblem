// RunManager.js — Pure class: run state (roster, node map, act progression, unit serialization)
// No Phaser deps.

import {
  ACT_SEQUENCE,
  ACT_CONFIG,
  STARTING_GOLD,
  MAX_SKILLS,
  ROSTER_CAP,
  STARTING_ACCESSORY_TIERS,
  STARTING_STAFF_TIERS,
  ELITE_GOLD_MULTIPLIER,
  XP_STAT_NAMES,
  CONVOY_WEAPON_CAPACITY,
  CONVOY_CONSUMABLE_CAPACITY,
  RECRUIT_SKILL_POOL,
  REVIVE_BASE_COST,
  REVIVE_COST_PER_LEVEL,
  REVIVE_PROMOTION_MULTIPLIER,
} from '../utils/constants.js';
import { calculateBattleGold } from './LootSystem.js';
import { calculateCurrencies } from './MetaProgressionManager.js';
import { generateNodeMap } from './NodeMapGenerator.js';
import {
  createLordUnit,
  createRecruitUnit,
  promoteUnit,
  addToInventory,
  addToConsumables,
  equipAccessory,
  canEquip,
  getClassInnateSkills,
  normalizeUnitClassState,
  grantLethalArmoryWeapon,
  grantSecondaryWeapons,
  learnSkill,
} from './UnitManager.js';
import { applyForge, canForge, canForgeStat, deforgeWeapon } from './ForgeSystem.js';
import { generateRandomLegendary } from './LootSystem.js';
import { getRunKey } from './SlotManager.js';
import {
  buildBlessingIndex,
  createSeededRng,
  rollCostForBlessing,
  selectBlessingOptionsWithTelemetry,
} from './BlessingEngine.js';
import { resolveDifficultyMode, DIFFICULTY_DEFAULTS } from './DifficultyEngine.js';
import {
  normalizeWeaponArtBinding,
  getWeaponArtBindings,
  getWeaponArtAllowedTypes,
} from './WeaponArtSystem.js';

// Phaser-specific fields that must be stripped for serialization
const PHASER_FIELDS = ['graphic', 'label', 'hpBar', 'factionIndicator', '_conditionIcons'];
const CONVOY_WEAPON_TYPES = new Set(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff']);
const WEAPON_ART_SPAWN_TIERS = new Set(['Iron', 'Steel', 'Silver']);
const WEAPON_ART_SPAWN_WEAPON_TYPES = new Set(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light']);
const KNOWN_ACT_IDS = new Set(Object.keys(ACT_CONFIG));
const EXTRA_STARTER_CLASS_POOLS = {
  1: ['Archer'],
  2: ['Archer', 'Knight'],
  3: ['Archer', 'Knight', 'Cavalier'],
  4: ['Archer', 'Knight', 'Cavalier', 'Paladin'],
};

function sanitizeActSequence(sequence, fallback = ACT_SEQUENCE) {
  const source = Array.isArray(sequence) ? sequence : fallback;
  const normalized = source.filter(
    (actId) => typeof actId === 'string' && KNOWN_ACT_IDS.has(actId),
  );
  if (normalized.length > 0) return [...new Set(normalized)];
  return [...fallback.filter((actId) => KNOWN_ACT_IDS.has(actId))];
}

export function getActTransitionKey(fromAct, toAct) {
  if (fromAct === 'act3' && toAct === 'finalBoss') return 'act3_to_finalBoss_normal';
  return `${fromAct}_to_${toAct}`;
}

function getConvoyBucket(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'Consumable') return 'consumables';
  if (CONVOY_WEAPON_TYPES.has(item.type)) return 'weapons';
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createBlessingRuntimeModifiers() {
  return {
    battleGoldMultiplierDelta: 0,
    deployCapDelta: 0,
    actHitBonusByAct: {},
    actStatDeltaAllUnits: [],
    skipFirstShop: false,
    shopItemCountDelta: 0,
    allGrowthsDelta: 0,
    allGrowthsDeltas: [],
    targetedGrowthsDeltas: [],
    disablePersonalSkillsUntilAct: null,
    blockedPersonalSkillsByUnit: {},
    xpMultiplierDelta: 0,
    forgeCostDiscount: 0,
    forgeLimitDelta: 0,
    shopPriceDiscount: 0,
    recruitLevelBonus: 0,
    terrainCombatBonuses: [],
    healingEffectivenessMultiplier: 1,
    weaponArtHpCostDelta: 0,
  };
}

function hashStringToUint32(input) {
  const text = String(input ?? '');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getBlessingEntryId(entry) {
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id.length > 0 ? id : null;
  }
  if (!isPlainObject(entry) || typeof entry.id !== 'string') return null;
  const id = entry.id.trim();
  return id.length > 0 ? id : null;
}

function normalizeBlessingCostEntry(costEntry) {
  if (!isPlainObject(costEntry)) return null;
  const label = typeof costEntry.label === 'string' ? costEntry.label.trim() : '';
  if (!label) return null;
  if (!Array.isArray(costEntry.effects) || costEntry.effects.length <= 0) return null;
  const effects = [];
  for (const effect of costEntry.effects) {
    if (!isPlainObject(effect)) continue;
    const type = typeof effect.type === 'string' ? effect.type.trim() : '';
    if (!type) continue;
    if (!isPlainObject(effect.params)) continue;
    effects.push({ type, params: { ...effect.params } });
  }
  if (effects.length <= 0) return null;
  return { label, effects };
}

function createActiveBlessingEntry(id, rolledCost = null) {
  const blessingId = typeof id === 'string' ? id.trim() : '';
  if (!blessingId) return null;
  return {
    id: blessingId,
    rolledCost: normalizeBlessingCostEntry(rolledCost),
  };
}

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
  const match = unit.inventory.find((w) => JSON.stringify(w) === weaponStr && canEquip(unit, w));
  // Fallback: first proficient weapon in inventory
  unit.weapon = match || unit.inventory.find((w) => canEquip(unit, w)) || null;
}

function parsePersonalSkillId(personalSkillStr) {
  if (!personalSkillStr) return null;
  const colonIdx = personalSkillStr.indexOf(':');
  const name = colonIdx > 0 ? personalSkillStr.slice(0, colonIdx).trim() : personalSkillStr.trim();
  return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Strip Phaser display objects from a unit, reset per-battle flags.
 */
export function serializeUnit(unit) {
  const data = { ...unit };
  if (unit?.stats && typeof unit.stats === 'object') {
    data.stats = { ...unit.stats };
  }
  // Deep-clone mutable collection fields to prevent shared-reference mutations
  if (Array.isArray(data.inventory)) data.inventory = data.inventory.map((i) => structuredClone(i));
  if (Array.isArray(data.skills)) data.skills = [...data.skills];
  if (Array.isArray(data.consumables))
    data.consumables = data.consumables.map((c) => structuredClone(c));
  if (Array.isArray(data.proficiencies))
    data.proficiencies = data.proficiencies.map((p) => ({ ...p }));
  if (data.accessory) data.accessory = structuredClone(data.accessory);
  // Relink weapon to cloned inventory item (preserves identity invariant)
  if (data.weapon && Array.isArray(data.inventory) && Array.isArray(unit.inventory)) {
    const origIdx = unit.inventory.indexOf(unit.weapon);
    if (origIdx >= 0 && origIdx < data.inventory.length) {
      data.weapon = data.inventory[origIdx];
    } else {
      // Weapon not in inventory (legacy/edge case) — deep-clone independently
      data.weapon = structuredClone(unit.weapon);
    }
  } else if (data.weapon) {
    data.weapon = structuredClone(unit.weapon);
  }
  for (const key of PHASER_FIELDS) data[key] = null;
  data.hasMoved = false;
  data.hasActed = false;
  data._miracleUsed = false;
  data._phoenixBroochUsed = false;
  const timedBuffStats = unit?._battleTimedWeaponArtAppliedStats;
  if (timedBuffStats && data.stats && typeof data.stats === 'object') {
    for (const [rawStat, rawValue] of Object.entries(timedBuffStats)) {
      const stat = typeof rawStat === 'string' ? rawStat.trim().toUpperCase() : '';
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      data.stats[stat] = (data.stats[stat] || 0) - value;
      if (stat === 'MOV') data.stats[stat] = Math.max(1, data.stats[stat] || 1);
      else data.stats[stat] = Math.max(0, data.stats[stat] || 0);
    }
    if (Object.prototype.hasOwnProperty.call(data.stats, 'MOV')) {
      data.mov = data.stats.MOV;
    }
  }
  delete data._battleDeltas;
  delete data._battleWeaponArtUsage;
  delete data._battleTimedWeaponArtBuffs;
  delete data._battleTimedWeaponArtAppliedStats;
  delete data._battleTimedWeaponArtAppliedCombatMods;
  delete data._movementSpent;
  return data;
}

function ensureSeraBaseStaffProficiency(unit) {
  if (!unit || unit.name !== 'Sera' || unit.className !== 'Light Sage') return;
  if (!Array.isArray(unit.proficiencies)) unit.proficiencies = [];
  if (unit.proficiencies.some((p) => p.type === 'Staff')) return;
  unit.proficiencies.push({ type: 'Staff', rank: 'Prof' });
}

/** Calculate level-scaled revive cost for a fallen unit. */
export function getReviveCost(unit) {
  const raw = Number(unit?.level);
  const level = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  const base = REVIVE_BASE_COST + level * REVIVE_COST_PER_LEVEL;
  return Math.round(unit?.tier === 'promoted' ? base * REVIVE_PROMOTION_MULTIPLIER : base);
}

export class RunManager {
  /**
   * @param {{ lords, classes, weapons, skills, terrain, mapSizes, mapTemplates, enemies }} gameData
   * @param {object|null} metaEffects - active effects from MetaProgressionManager
   */
  constructor(gameData, metaEffects = null) {
    this.gameData = gameData;
    this.metaEffects = metaEffects;
    this.status = 'active'; // 'active' | 'victory' | 'defeat'
    this.actIndex = 0;
    this.roster = [];
    this.fallenUnits = []; // Serialized units that died in battle
    this.nodeMap = null;
    this.currentNodeId = null; // last completed node (null = start of act)
    this.completedBattles = 0;
    this.gold = STARTING_GOLD + (metaEffects?.goldBonus || 0);
    this.accessories = []; // team accessory pool (unequipped accessories)
    this.scrolls = []; // team scroll pool (skill teaching items)
    this.convoy = { weapons: [], consumables: [] };
    this.activeBlessings = [];
    this.blessingHistory = [];
    this.blessingSelectionTelemetry = null;
    this.blessingRuntimeModifiers = createBlessingRuntimeModifiers();
    this._runStartBlessingsApplied = false;
    this.runSeed = null;
    this.rngSeed = null;
    this.visionChargesRemaining = 1;
    this.visionCount = 0;
    this.usedRecruitNames = {}; // Track used names per class: { Fighter: ['Galvin', 'Bjorn'] }
    this.battleConfigsByNodeId = {};
    this.shopStateByNodeId = {};
    this.difficultyId = 'normal';
    this.difficultyModifiers = {
      ...DIFFICULTY_DEFAULTS,
      actsIncluded: [...DIFFICULTY_DEFAULTS.actsIncluded],
    };
    this.actSequence = [...ACT_SEQUENCE];
    this.pendingAmbushNodeId = null;
    this.endRunRewards = null;
    this.metaUnlockedWeaponArts = [];
    this.actUnlockedWeaponArts = [];
    this.unlockedWeaponArts = [];
    this.winStreak = 0;
    this.maxWinStreak = 0;
    this.noMetaMode = false;
    this.shownDialogueKeys = [];
    this._churchPromotionTracker = null; // { nodeId: string, count: number }
    this.thirdLordJoined = false;
    this.thirdLordRerolled = false;
  }

  _isValidSerializedUnit(unit) {
    return !!(
      unit &&
      typeof unit === 'object' &&
      unit.name &&
      unit.stats &&
      typeof unit.stats === 'object'
    );
  }

  _sanitizeUnitPools() {
    if (!Array.isArray(this.roster)) this.roster = [];
    if (!Array.isArray(this.fallenUnits)) this.fallenUnits = [];
    this.roster = this.roster.filter((u) => this._isValidSerializedUnit(u));
    this.fallenUnits = this.fallenUnits.filter((u) => this._isValidSerializedUnit(u));
    if (!this.convoy || typeof this.convoy !== 'object')
      this.convoy = { weapons: [], consumables: [] };
    if (!Array.isArray(this.convoy.weapons)) this.convoy.weapons = [];
    if (!Array.isArray(this.convoy.consumables)) this.convoy.consumables = [];
  }

  get currentAct() {
    return this.actSequence[this.actIndex];
  }

  get currentActConfig() {
    return ACT_CONFIG[this.currentAct];
  }

  getBaseVisionCharges() {
    const visionBonus = Math.trunc(this.metaEffects?.visionChargesBonus || 0);
    return Math.max(1, 1 + visionBonus);
  }

  hasShownDialogue(key) {
    return typeof key === 'string' && this.shownDialogueKeys.includes(key);
  }

  markDialogueShown(key) {
    if (typeof key !== 'string' || !key) return;
    if (!this.shownDialogueKeys.includes(key)) this.shownDialogueKeys.push(key);
  }

  /** Initialize a new run: create starting roster + first act node map. */
  startRun(options = {}) {
    const {
      runSeed = null,
      applyBlessingsAtStart = true,
      difficultyId = this.difficultyId || 'normal',
    } = options;
    this.applyDifficultySelection(difficultyId);
    this.usedRecruitNames = {};
    this.roster = this.createInitialRoster();
    if (!Number.isFinite(this.runSeed)) {
      const initialSeed = runSeed ?? Date.now();
      this.runSeed = Number(initialSeed);
    }
    this.rngSeed = this.runSeed >>> 0;
    this.visionChargesRemaining = this.getBaseVisionCharges();
    this.visionCount = 0;
    this.randomLegendary = generateRandomLegendary(this.gameData.weapons);
    this.nodeMap = generateNodeMap(
      this.currentAct,
      this.currentActConfig,
      this.gameData.mapTemplates,
      {
        fogChanceBonus: this.getDifficultyModifier('fogChanceBonus', 0),
        halfFogChance: this.difficultyId === 'normal',
        villageAmbushChance: this.getDifficultyModifier('villageAmbushChance', 0),
        colosseumConfig: this.gameData.colosseum?.nodeGeneration ?? null,
      },
    );
    this.currentNodeId = null;
    this.pendingAmbushNodeId = null;
    this.blessingRuntimeModifiers = createBlessingRuntimeModifiers();
    this.battleConfigsByNodeId = {};
    this.shopStateByNodeId = {};
    this.metaUnlockedWeaponArts = [];
    this.actUnlockedWeaponArts = [];
    this.unlockedWeaponArts = [];
    this.shownDialogueKeys = [];
    this._syncMetaWeaponArtUnlocks();
    this._syncActWeaponArtUnlocksForCurrentAct();
    this.blessingHistory = [];
    this._runStartBlessingsApplied = false;
    this._blessingChosen = false;
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
        offeredBlessings: [],
        chosenIds: [],
        chosenBlessings: [],
        rejectionReasons: [{ blessingId: null, reason: 'missing_catalog' }],
      };
      return;
    }

    const resolvedSeed = Number(blessingSeed ?? this.runSeed);
    const rng = createSeededRng(resolvedSeed);
    const { selected, telemetry } = selectBlessingOptionsWithTelemetry(catalog, rng, {
      count: blessingOptionCount,
      forceTier1: true,
      allowTier4: true,
    });

    const offeredBlessings = selected.map((blessing) => structuredClone(blessing));
    const chosenBlessings = autoSelectBlessing
      ? offeredBlessings
          .slice(0, 1)
          .map((blessing) => this._buildActiveBlessingEntryFromOffer(blessing))
          .filter(Boolean)
      : [];
    const chosenIds = chosenBlessings.map((entry) => entry.id);
    this.activeBlessings = chosenBlessings;
    this.blessingSelectionTelemetry = {
      seed: resolvedSeed,
      candidatePoolIds: telemetry.candidatePoolIds,
      offeredIds: offeredBlessings.map((blessing) => blessing.id),
      offeredBlessings,
      chosenIds,
      chosenBlessings,
      rejectionReasons: telemetry.rejectionReasons,
      options: telemetry.options,
    };

    if (debugBlessingSelection && this.blessingSelectionTelemetry) {
      console.debug('BlessingSelection', this.blessingSelectionTelemetry);
    }
  }

  getBlessingOptions() {
    const offeredBlessings = this.blessingSelectionTelemetry?.offeredBlessings;
    if (Array.isArray(offeredBlessings)) {
      return offeredBlessings
        .map((blessing, index) =>
          this._resolveBlessingOfferForSelection(blessing, index, 'telemetry'),
        )
        .filter(Boolean);
    }

    const offeredIds = this.blessingSelectionTelemetry?.offeredIds || [];
    const catalog = this.gameData?.blessings;
    if (!catalog || !Array.isArray(catalog.blessings)) return [];
    const index = buildBlessingIndex(catalog);
    return offeredIds
      .map((id) => index.get(id))
      .filter(Boolean)
      .map((blessing, offerIndex) =>
        this._resolveBlessingOfferForSelection(blessing, offerIndex, 'legacy_ids'),
      )
      .filter(Boolean);
  }

  chooseBlessing(blessingId = null) {
    if (this._blessingChosen) return true; // idempotent — already committed
    const offeredBlessings = this.getBlessingOptions();
    const offeredIds = offeredBlessings.map((blessing) => blessing.id);
    if (blessingId !== null && !offeredIds.includes(blessingId)) return false;

    const selectedIndex = blessingId
      ? offeredBlessings.findIndex((blessing) => blessing.id === blessingId)
      : -1;
    const selectedBlessing = selectedIndex >= 0 ? offeredBlessings[selectedIndex] : null;
    const chosenBlessings = selectedBlessing
      ? [this._buildActiveBlessingEntryFromOffer(selectedBlessing, selectedIndex)].filter(Boolean)
      : [];
    const chosenIds = chosenBlessings.map((entry) => entry.id);
    this.activeBlessings = chosenBlessings;

    this.blessingHistory.push({
      timestamp: Date.now(),
      stage: 'run_start',
      eventType: 'selection',
      blessingId: blessingId ?? null,
      effectType: null,
      details: {
        offeredIds: [...offeredIds],
        chosenIds: [...chosenIds],
        skipped: chosenIds.length === 0,
      },
    });
    if (this.blessingSelectionTelemetry) {
      this.blessingSelectionTelemetry.chosenIds = chosenIds;
      this.blessingSelectionTelemetry.chosenBlessings = chosenBlessings.map((entry) =>
        structuredClone(entry),
      );
    }
    if (chosenIds.length === 0) {
      this._runStartBlessingsApplied = true;
      this._blessingChosen = true;
      return true;
    }
    this._runStartBlessingsApplied = false;
    this.applyRunStartBlessingEffects();
    this._blessingChosen = true;
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
    for (const activeBlessing of this.activeBlessings) {
      const blessingId = getBlessingEntryId(activeBlessing);
      if (!blessingId) continue;
      const blessing = blessingIndex.get(blessingId);
      if (!blessing) {
        this._recordBlessingEvent('run_start', blessingId, null, { reason: 'unknown_blessing_id' });
        continue;
      }
      const rolledCost = normalizeBlessingCostEntry(activeBlessing?.rolledCost);
      const costEffects = rolledCost?.effects?.length ? rolledCost.effects : blessing.costs || [];
      const effects = [...(blessing.boons || []), ...costEffects];
      for (const effect of effects) {
        this._applySingleRunStartBlessingEffect(blessingId, effect);
      }
    }
    this._runStartBlessingsApplied = true;
  }

  getActiveBlessingIds() {
    const ids = [];
    for (const entry of this.activeBlessings || []) {
      const id = getBlessingEntryId(entry);
      if (!id || ids.includes(id)) continue;
      ids.push(id);
    }
    return ids;
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

  _getPersonalSkillIdSet() {
    const lords = Array.isArray(this.gameData?.lords) ? this.gameData.lords : [];
    const ids = new Set();
    for (const lord of lords) {
      const id = parsePersonalSkillId(lord?.personalSkill || '');
      if (id) ids.add(id);
    }
    return ids;
  }

  _applyGrowthDeltaToUnits(units, value) {
    if (!Array.isArray(units) || !Number.isFinite(value) || value === 0) return;
    const scaled = Math.round(value * this._getGrowthBonusMultiplier());
    if (scaled === 0) return;
    for (const unit of units) {
      if (!unit.growths) unit.growths = {};
      for (const stat of XP_STAT_NAMES) {
        unit.growths[stat] = (unit.growths[stat] || 0) + scaled;
      }
    }
  }

  _applyTargetedGrowthDeltaToUnits(units, stats, value) {
    if (!Array.isArray(units) || !Array.isArray(stats) || !Number.isFinite(value) || value === 0)
      return;
    const scaled = Math.round(value * this._getGrowthBonusMultiplier());
    if (scaled === 0) return;
    for (const unit of units) {
      if (!unit.growths) unit.growths = {};
      for (const stat of stats) {
        unit.growths[stat] = (unit.growths[stat] || 0) + scaled;
      }
    }
  }

  _createBlessingRng(blessingId, contextKey = '') {
    const baseSeed = Number.isFinite(this.runSeed) ? Number(this.runSeed) : 0;
    const seed = hashStringToUint32(`${baseSeed}|${blessingId || 'none'}|${contextKey}`);
    return createSeededRng(seed);
  }

  _rollCostForBlessingWithSeed(blessing, blessingId, contextKey = 'run_start') {
    if (!blessing || blessing.tier < 2) return null;
    const pool = this.gameData?.blessings?.costPools?.[String(blessing.tier)];
    if (!Array.isArray(pool) || pool.length <= 0) return null;
    const rand = this._createBlessingRng(blessingId, `cost_roll:${contextKey}`);
    return rollCostForBlessing(pool, blessing, rand);
  }

  _resolveBlessingOfferForSelection(blessing, offerIndex = 0, contextKey = 'selection') {
    const blessingId = typeof blessing?.id === 'string' ? blessing.id.trim() : '';
    if (!blessingId) return null;
    const catalogBlessing =
      this.gameData?.blessings?.blessings?.find((entry) => entry.id === blessingId) || null;
    const resolved = catalogBlessing
      ? { ...structuredClone(catalogBlessing), ...structuredClone(blessing), id: blessingId }
      : { ...structuredClone(blessing), id: blessingId };
    resolved.rolledCost = normalizeBlessingCostEntry(blessing?.rolledCost);
    const needsV2Cost =
      resolved.tier >= 2 &&
      !resolved.rolledCost &&
      Array.isArray(resolved.costs) &&
      resolved.costs.length === 0;
    if (needsV2Cost) {
      resolved.rolledCost = this._rollCostForBlessingWithSeed(
        resolved,
        blessingId,
        `${contextKey}:${offerIndex}`,
      );
    }
    return resolved;
  }

  _buildActiveBlessingEntryFromOffer(blessing, offerIndex = 0) {
    const resolved = this._resolveBlessingOfferForSelection(blessing, offerIndex, 'choose');
    if (!resolved?.id) return null;
    return createActiveBlessingEntry(resolved.id, resolved.rolledCost || null);
  }

  _normalizeActiveBlessingsForLoad(entries = []) {
    if (!Array.isArray(entries)) return [];
    const catalog = this.gameData?.blessings;
    const blessingIndex = catalog?.blessings?.length ? buildBlessingIndex(catalog) : new Map();
    const normalized = [];

    entries.forEach((entry, index) => {
      const id = getBlessingEntryId(entry);
      if (!id) return;
      const blessing = blessingIndex.get(id);
      if (!blessing) {
        normalized.push(createActiveBlessingEntry(id, null));
        return;
      }

      let rolledCost = normalizeBlessingCostEntry(entry?.rolledCost);
      const needsV2Cost =
        blessing.tier >= 2 &&
        !rolledCost &&
        Array.isArray(blessing.costs) &&
        blessing.costs.length === 0;
      if (needsV2Cost) {
        rolledCost = this._rollCostForBlessingWithSeed(blessing, id, `migrate:${index}`);
      }
      normalized.push(createActiveBlessingEntry(id, rolledCost));
    });

    return normalized.filter(Boolean);
  }

  _suppressPersonalSkillsForCurrentRosterIfNeeded() {
    const targetAct = this.blessingRuntimeModifiers?.disablePersonalSkillsUntilAct;
    if (!targetAct) return { applied: false, removedByUnit: {} };
    const targetIndex = this.actSequence.indexOf(targetAct);
    if (targetIndex === -1 || this.actIndex >= targetIndex) {
      return { applied: false, removedByUnit: {} };
    }
    const personalSkillIds = this._getPersonalSkillIdSet();
    if (personalSkillIds.size === 0) return { applied: false, removedByUnit: {} };
    if (
      !this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit ||
      typeof this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit !== 'object'
    ) {
      this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit = {};
    }
    const blockedByUnit = this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit;
    const removedByUnit = {};
    for (const unit of this.roster) {
      if (!Array.isArray(unit?.skills) || unit.skills.length === 0) continue;
      const blocked = new Set(
        Array.isArray(blockedByUnit[unit.name]) ? blockedByUnit[unit.name] : [],
      );
      const nextSkills = [];
      const removed = [];
      for (const skillId of unit.skills) {
        if (personalSkillIds.has(skillId)) {
          blocked.add(skillId);
          removed.push(skillId);
        } else {
          nextSkills.push(skillId);
        }
      }
      if (removed.length > 0) {
        unit.skills = nextSkills;
        blockedByUnit[unit.name] = [...blocked];
        removedByUnit[unit.name] = removed;
      }
    }
    return { applied: Object.keys(removedByUnit).length > 0, removedByUnit };
  }

  _restoreDisabledPersonalSkillsIfReady(stage = 'act_transition') {
    const targetAct = this.blessingRuntimeModifiers?.disablePersonalSkillsUntilAct;
    if (!targetAct) return;
    const targetIndex = this.actSequence.indexOf(targetAct);
    if (targetIndex === -1 || this.actIndex < targetIndex) return;
    const blockedByUnit = this.blessingRuntimeModifiers?.blockedPersonalSkillsByUnit || {};
    const restoredByUnit = {};
    const displacedByUnit = {};

    // Build protection sets for displacement logic
    const personalSkillIds = this._getPersonalSkillIdSet();
    const classByName = new Map((this.gameData?.classes || []).map((c) => [c.name, c]));

    for (const unit of this.roster) {
      const blocked = Array.isArray(blockedByUnit[unit.name]) ? blockedByUnit[unit.name] : [];
      if (blocked.length === 0) continue;
      const restored = [];
      const pending = [];

      // Per-unit innate set: only this unit's class chain is protected
      const unitInnateIds = new Set();
      for (const sid of getClassInnateSkills(unit.className, this.gameData?.skills || [])) {
        unitInnateIds.add(sid);
      }
      const unitClass = classByName.get(unit.className);
      if (unitClass?.promotesFrom) {
        for (const sid of getClassInnateSkills(
          unitClass.promotesFrom,
          this.gameData?.skills || [],
        )) {
          unitInnateIds.add(sid);
        }
      }

      for (const skillId of blocked) {
        if (!Array.isArray(unit.skills)) {
          pending.push(skillId);
          continue;
        }
        if (unit.skills.includes(skillId)) {
          restored.push(skillId);
          continue;
        }

        const result = learnSkill(unit, skillId);
        if (result.learned) {
          restored.push(skillId);
          continue;
        }
        if (result.reason !== 'at_cap') {
          pending.push(skillId);
          continue;
        }

        // First pass: displace non-personal, non-innate skill
        let restoredWithDisplacement = false;
        for (let i = unit.skills.length - 1; i >= 0; i--) {
          const sid = unit.skills[i];
          if (!personalSkillIds.has(sid) && !unitInnateIds.has(sid)) {
            const displaced = unit.skills.splice(i, 1)[0];
            unit.skills.push(skillId);
            restored.push(skillId);
            displacedByUnit[unit.name] = { displaced, replacedBy: skillId };
            restoredWithDisplacement = true;
            break;
          }
        }
        // Fallback: displace class innate (recoverable) over personal (identity)
        if (!restoredWithDisplacement) {
          for (let i = unit.skills.length - 1; i >= 0; i--) {
            const sid = unit.skills[i];
            if (!personalSkillIds.has(sid)) {
              const displaced = unit.skills.splice(i, 1)[0];
              unit.skills.push(skillId);
              restored.push(skillId);
              displacedByUnit[unit.name] = { displaced, replacedBy: skillId };
              restoredWithDisplacement = true;
              break;
            }
          }
        }
        if (!restoredWithDisplacement) {
          pending.push(skillId);
        }
      }
      if (restored.length > 0) restoredByUnit[unit.name] = restored;
      if (pending.length > 0) {
        blockedByUnit[unit.name] = pending;
      } else {
        delete blockedByUnit[unit.name];
      }
    }
    this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit = blockedByUnit;
    const hasPendingBlocked = Object.values(blockedByUnit).some(
      (entries) => Array.isArray(entries) && entries.length > 0,
    );
    this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = hasPendingBlocked
      ? targetAct
      : null;
    this._lastRestorationDisplacements = displacedByUnit;
    this._recordBlessingEvent(
      stage,
      null,
      { type: 'disable_personal_skills_until_act', params: { act: targetAct } },
      { restoredInAct: this.currentAct, restoredByUnit, displacedByUnit },
    );
  }

  _resolveBlessingUnitScope(scope = 'all') {
    if (scope === 'lords') return this.roster.filter((unit) => unit.isLord);
    if (scope === 'recruits') return this.roster.filter((unit) => !unit.isLord);
    return this.roster;
  }

  _pickDeterministicBlessingItem(items, blessingId, contextKey) {
    if (!Array.isArray(items) || items.length <= 0) return null;
    const rng = this._createBlessingRng(blessingId, contextKey);
    return items[Math.floor(rng() * items.length)] || null;
  }

  _isScrollValidForCurrentLords(scroll, artById) {
    const lords = this.roster.filter((unit) => unit.isLord);
    if (lords.length <= 0) return false;

    const explicitAllowed = Array.isArray(scroll?.allowedWeaponTypes)
      ? scroll.allowedWeaponTypes.filter((type) => typeof type === 'string' && type.trim())
      : [];
    let allowedTypes = explicitAllowed;
    if (allowedTypes.length <= 0 && typeof scroll?.teachesWeaponArtId === 'string') {
      const art = artById.get(scroll.teachesWeaponArtId);
      if (art) {
        allowedTypes = getWeaponArtAllowedTypes(art);
      }
    }
    if (allowedTypes.length <= 0) return true;

    return lords.some((unit) => {
      const profs = Array.isArray(unit.proficiencies) ? unit.proficiencies : [];
      return profs.some((prof) => allowedTypes.includes(prof.type));
    });
  }

  _applySingleRunStartBlessingEffect(blessingId, effect) {
    if (!effect || !effect.type || !effect.params) return;
    const value = Number(effect.params.value || 0);
    if (!Number.isFinite(value)) return;

    if (effect.type === 'run_start_max_hp_bonus') {
      if (value === 0) return;
      const scope = effect.params.scope || 'all';
      const targetUnits = this._resolveBlessingUnitScope(scope);
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
        const profTypes = new Set((unit.proficiencies || []).map((p) => p.type));
        const candidate = allWeapons.find(
          (w) =>
            w?.tier === requestedTier &&
            profTypes.has(w.type) &&
            w.type !== 'Staff' &&
            w.type !== 'Consumable' &&
            w.type !== 'Scroll' &&
            canEquip(unit, w),
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

    if (effect.type === 'act_hit_bonus') {
      const targetAct = String(effect.params.act || '').trim();
      const delta = Math.trunc(value);
      if (!targetAct || delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_act_hit_bonus_params',
        });
        return;
      }
      if (
        !this.blessingRuntimeModifiers.actHitBonusByAct ||
        typeof this.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
      ) {
        this.blessingRuntimeModifiers.actHitBonusByAct = {};
      }
      this.blessingRuntimeModifiers.actHitBonusByAct[targetAct] =
        Math.trunc(this.blessingRuntimeModifiers.actHitBonusByAct[targetAct] || 0) + delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        act: targetAct,
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.actHitBonusByAct[targetAct],
      });
      return;
    }

    if (effect.type === 'all_act_hit_bonus') {
      const delta = Math.trunc(value);
      if (delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_all_act_hit_bonus',
        });
        return;
      }
      if (
        !this.blessingRuntimeModifiers.actHitBonusByAct ||
        typeof this.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
      ) {
        this.blessingRuntimeModifiers.actHitBonusByAct = {};
      }
      const acts = ACT_SEQUENCE;
      for (const act of acts) {
        this.blessingRuntimeModifiers.actHitBonusByAct[act] =
          Math.trunc(this.blessingRuntimeModifiers.actHitBonusByAct[act] || 0) + delta;
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        acts,
        totals: { ...this.blessingRuntimeModifiers.actHitBonusByAct },
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
      const lords = this.roster.filter((unit) => unit.isLord);
      this._applyStatDeltaToUnits(lords, stat, value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stat,
        appliedValue: value,
        appliedUnits: lords.map((u) => u.name),
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
        appliedUnits: this.roster.map((u) => u.name),
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

    if (effect.type === 'all_growths_delta') {
      const delta = Math.trunc(value);
      if (delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_all_growths_delta',
        });
        return;
      }
      this.blessingRuntimeModifiers.allGrowthsDelta += delta;
      if (!Array.isArray(this.blessingRuntimeModifiers.allGrowthsDeltas)) {
        this.blessingRuntimeModifiers.allGrowthsDeltas = [];
      }
      this.blessingRuntimeModifiers.allGrowthsDeltas.push(delta);
      this._applyGrowthDeltaToUnits(this.roster, delta);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.allGrowthsDelta,
        appliedUnits: this.roster.map((u) => u.name),
      });
      return;
    }

    if (effect.type === 'targeted_growths_delta') {
      const delta = Math.trunc(value);
      const scope =
        typeof effect.params.scope === 'string' ? effect.params.scope.trim().toLowerCase() : 'all';
      const stats = [
        ...new Set(
          (Array.isArray(effect.params.stats) ? effect.params.stats : [])
            .filter((stat) => typeof stat === 'string')
            .map((stat) => stat.trim())
            .filter((stat) => XP_STAT_NAMES.includes(stat)),
        ),
      ];
      if (delta === 0 || stats.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_targeted_growths_delta_params',
        });
        return;
      }
      if (!Array.isArray(this.blessingRuntimeModifiers.targetedGrowthsDeltas)) {
        this.blessingRuntimeModifiers.targetedGrowthsDeltas = [];
      }
      this.blessingRuntimeModifiers.targetedGrowthsDeltas.push({ stats, value: delta, scope });
      const units = this._resolveBlessingUnitScope(scope);
      this._applyTargetedGrowthDeltaToUnits(units, stats, delta);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stats,
        scope,
        appliedValue: delta,
        appliedUnits: units.map((unit) => unit.name),
      });
      return;
    }

    if (effect.type === 'disable_personal_skills_until_act') {
      const targetAct = String(effect.params.act || '').trim();
      const targetIndex = this.actSequence.indexOf(targetAct);
      if (!targetAct || targetIndex === -1) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_disable_personal_skills_until_act_params',
        });
        return;
      }
      const existingAct = this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct;
      if (!existingAct || this.actSequence.indexOf(existingAct) < targetIndex) {
        this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = targetAct;
      }
      const suppression = this._suppressPersonalSkillsForCurrentRosterIfNeeded();
      this._recordBlessingEvent('run_start', blessingId, effect, {
        targetAct: this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct,
        appliedNow: suppression.applied,
        removedByUnit: suppression.removedByUnit,
      });
      return;
    }

    if (effect.type === 'starting_consumable_all') {
      const itemName = String(effect.params.name || '').trim();
      const consumables = Array.isArray(this.gameData?.consumables)
        ? this.gameData.consumables
        : [];
      const template = consumables.find((c) => c.name === itemName);
      if (!template) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'consumable_not_found',
          requestedName: itemName,
        });
        return;
      }
      let granted = 0;
      for (const unit of this.roster) {
        if (addToConsumables(unit, template)) granted++;
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        itemName,
        grantedCount: granted,
        rosterSize: this.roster.length,
      });
      return;
    }

    if (effect.type === 'extra_consumable' || effect.type === 'extra_vulnerary') {
      const itemName =
        typeof effect.params.itemName === 'string' ? effect.params.itemName : 'Vulnerary';
      const configuredCount = effect.params.count ?? effect.params.value ?? value;
      const count = Math.max(0, Math.trunc(Number(configuredCount || 0)));
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_extra_consumable_params',
        });
        return;
      }
      const consumables = Array.isArray(this.gameData?.consumables)
        ? this.gameData.consumables
        : [];
      const template = consumables.find(
        (item) => item?.name === itemName && item.type === 'Consumable',
      );
      if (!template) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'missing_consumable_template',
          itemName,
        });
        return;
      }
      let grantedToUnits = 0;
      let grantedToConvoy = 0;
      let overflow = 0;
      const lords = this.roster.filter((unit) => unit.isLord);
      for (const unit of lords) {
        for (let i = 0; i < count; i++) {
          if (addToConsumables(unit, template)) {
            grantedToUnits++;
            continue;
          }
          if (this.addToConvoy(template)) {
            grantedToConvoy++;
          } else {
            overflow++;
          }
        }
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedCount: count,
        lordCount: lords.length,
        grantedToUnits,
        grantedToConvoy,
        overflow,
      });
      return;
    }

    if (effect.type === 'starting_random_skill') {
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      const scope =
        typeof effect.params.scope === 'string'
          ? effect.params.scope.trim().toLowerCase()
          : 'lords';
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_random_skill_count',
        });
        return;
      }

      const validSkills = new Set(
        (this.gameData?.skills || []).map((skill) => skill?.id).filter(Boolean),
      );
      const skillPool = RECRUIT_SKILL_POOL.filter((skillId) => validSkills.has(skillId));
      if (skillPool.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'empty_starting_random_skill_pool',
        });
        return;
      }

      const targets = this._resolveBlessingUnitScope(scope);
      const grantedByUnit = {};
      for (const unit of targets) {
        if (!Array.isArray(unit.skills)) unit.skills = [];
        for (let i = 0; i < count; i++) {
          if (unit.skills.length >= MAX_SKILLS) break;
          const candidates = skillPool.filter((skillId) => !unit.skills.includes(skillId));
          if (candidates.length <= 0) break;
          const picked = this._pickDeterministicBlessingItem(
            candidates,
            blessingId,
            `starting_random_skill:${unit.name}:${i}`,
          );
          if (!picked) break;
          unit.skills.push(picked);
          if (!grantedByUnit[unit.name]) grantedByUnit[unit.name] = [];
          grantedByUnit[unit.name].push(picked);
        }
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        scope,
        requestedCount: count,
        grantedByUnit,
      });
      return;
    }

    if (effect.type === 'starting_whetstones') {
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_whetstones_count',
        });
        return;
      }
      const whetstones = Array.isArray(this.gameData?.whetstones) ? this.gameData.whetstones : [];
      if (whetstones.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'missing_whetstone_catalog',
        });
        return;
      }

      const applied = [];
      const forgeStats = ['might', 'crit', 'hit', 'weight'];
      for (let rollIndex = 0; rollIndex < count; rollIndex++) {
        const options = [];
        for (const unit of this.roster) {
          if (!unit.isLord) continue;
          const weapons = [];
          for (const weapon of unit.inventory || []) {
            if (!weapon || ['Staff', 'Consumable', 'Scroll', 'Whetstone'].includes(weapon.type))
              continue;
            if (!weapons.includes(weapon)) weapons.push(weapon);
          }
          if (
            unit.weapon &&
            !['Staff', 'Consumable', 'Scroll', 'Whetstone'].includes(unit.weapon.type) &&
            !weapons.includes(unit.weapon)
          ) {
            weapons.push(unit.weapon);
          }

          for (const weapon of weapons) {
            if (!canForge(weapon)) continue;
            for (const whetstone of whetstones) {
              if (whetstone?.forgeStat === 'choice') {
                for (const stat of forgeStats) {
                  if (canForgeStat(weapon, stat)) {
                    options.push({ unit, weapon, whetstone, stat });
                  }
                }
                continue;
              }
              if (canForgeStat(weapon, whetstone?.forgeStat)) {
                options.push({ unit, weapon, whetstone, stat: whetstone.forgeStat });
              }
            }
          }
        }

        if (options.length <= 0) break;
        const choice = this._pickDeterministicBlessingItem(
          options,
          blessingId,
          `starting_whetstones:${rollIndex}`,
        );
        if (!choice) break;
        const result = applyForge(choice.weapon, choice.stat);
        if (!result.success) continue;
        applied.push({
          unit: choice.unit.name,
          weapon: choice.weapon.name,
          whetstone: choice.whetstone?.name || 'Unknown Whetstone',
          stat: choice.stat,
        });
      }

      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedCount: count,
        appliedCount: applied.length,
        applied,
      });
      return;
    }

    if (effect.type === 'starting_scroll') {
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_scroll_count',
        });
        return;
      }

      const allScrolls = (this.gameData?.weapons || []).filter(
        (item) => item?.type === 'Scroll' && typeof item.teachesWeaponArtId === 'string',
      );
      if (allScrolls.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'missing_scroll_catalog',
        });
        return;
      }
      const artById = new Map((this.gameData?.weaponArts?.arts || []).map((art) => [art?.id, art]));
      const validScrolls = allScrolls.filter((scroll) =>
        this._isScrollValidForCurrentLords(scroll, artById),
      );
      if (validScrolls.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'no_valid_scroll_for_roster',
        });
        return;
      }
      if (!Array.isArray(this.scrolls)) this.scrolls = [];
      const granted = [];
      for (let i = 0; i < count; i++) {
        const picked = this._pickDeterministicBlessingItem(
          validScrolls,
          blessingId,
          `starting_scroll:${i}`,
        );
        if (!picked) break;
        this.scrolls.push(structuredClone(picked));
        granted.push(picked.name);
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedCount: count,
        grantedCount: granted.length,
        granted,
      });
      return;
    }

    if (effect.type === 'starting_forge_lords' || effect.type === 'starting_weapon_forge_delta') {
      const forgeStat = String(effect.params.stat || 'might')
        .trim()
        .toLowerCase();
      const resolvedForgeStat = ['might', 'crit', 'hit', 'weight'].includes(forgeStat)
        ? forgeStat
        : 'might';
      const requestedDelta =
        effect.type === 'starting_forge_lords'
          ? Math.max(0, Math.trunc(Number(effect.params.count ?? 1)))
          : Math.trunc(value);
      if (!Number.isFinite(requestedDelta) || requestedDelta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_starting_weapon_forge_delta',
        });
        return;
      }
      const changedWeapons = [];
      const steps = Math.abs(requestedDelta);
      for (const unit of this.roster) {
        if (!unit.isLord) continue;
        const candidates = [];
        for (const weapon of unit.inventory || []) {
          if (!weapon || ['Staff', 'Consumable', 'Scroll'].includes(weapon.type)) continue;
          if (!candidates.includes(weapon)) candidates.push(weapon);
        }
        if (
          unit.weapon &&
          !['Staff', 'Consumable', 'Scroll'].includes(unit.weapon.type) &&
          !candidates.includes(unit.weapon)
        ) {
          candidates.push(unit.weapon);
        }
        for (const weapon of candidates) {
          for (let i = 0; i < steps; i++) {
            if (requestedDelta > 0) {
              const targetStat = resolvedForgeStat;
              if (!canForgeStat(weapon, targetStat)) break;
              const result = applyForge(weapon, targetStat);
              if (!result.success) break;
              changedWeapons.push({
                unit: unit.name,
                weapon: weapon.name,
                stat: targetStat,
                direction: 'forge',
              });
            } else {
              const result = deforgeWeapon(weapon);
              if (!result.success) break;
              changedWeapons.push({
                unit: unit.name,
                weapon: weapon.name,
                stat: result.stat || null,
                direction: 'deforge',
              });
            }
          }
        }
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedDelta,
        forgeStat: resolvedForgeStat,
        changedWeapons,
      });
      return;
    }

    if (effect.type === 'xp_multiplier_delta') {
      this.blessingRuntimeModifiers.xpMultiplierDelta += value;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: value,
        total: this.blessingRuntimeModifiers.xpMultiplierDelta,
      });
      return;
    }

    if (effect.type === 'forge_cost_discount' || effect.type === 'forge_cost_multiplier') {
      const discountDelta = effect.type === 'forge_cost_multiplier' ? -value : value;
      this.blessingRuntimeModifiers.forgeCostDiscount += discountDelta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: discountDelta,
        total: this.blessingRuntimeModifiers.forgeCostDiscount,
      });
      return;
    }

    if (effect.type === 'forge_limit_delta') {
      const delta = Math.trunc(value);
      this.blessingRuntimeModifiers.forgeLimitDelta =
        (this.blessingRuntimeModifiers.forgeLimitDelta || 0) + delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.forgeLimitDelta,
      });
      return;
    }

    if (effect.type === 'shop_price_discount') {
      const delta = Number(value) || 0;
      this.blessingRuntimeModifiers.shopPriceDiscount += delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.shopPriceDiscount,
      });
      return;
    }

    if (effect.type === 'recruit_level_bonus') {
      this.blessingRuntimeModifiers.recruitLevelBonus += Math.trunc(value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: Math.trunc(value),
        total: this.blessingRuntimeModifiers.recruitLevelBonus,
      });
      return;
    }

    if (effect.type === 'terrain_combat_bonus') {
      const terrains = Array.isArray(effect.params.terrains)
        ? effect.params.terrains.filter((t) => typeof t === 'string')
        : [];
      const avoidBonus = Math.trunc(Number(effect.params.avoidBonus) || 0);
      const defBonus = Math.trunc(Number(effect.params.defBonus) || 0);
      if (terrains.length === 0 || (avoidBonus === 0 && defBonus === 0)) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_terrain_combat_bonus_params',
        });
        return;
      }
      if (!Array.isArray(this.blessingRuntimeModifiers.terrainCombatBonuses)) {
        this.blessingRuntimeModifiers.terrainCombatBonuses = [];
      }
      this.blessingRuntimeModifiers.terrainCombatBonuses.push({ terrains, avoidBonus, defBonus });
      this._recordBlessingEvent('run_start', blessingId, effect, {
        terrains,
        avoidBonus,
        defBonus,
      });
      return;
    }

    if (effect.type === 'healing_effectiveness_delta') {
      this.blessingRuntimeModifiers.healingEffectivenessMultiplier += value;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: value,
        total: this.blessingRuntimeModifiers.healingEffectivenessMultiplier,
      });
      return;
    }

    if (effect.type === 'weapon_art_hp_cost_delta') {
      this.blessingRuntimeModifiers.weaponArtHpCostDelta += Math.trunc(value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: Math.trunc(value),
        total: this.blessingRuntimeModifiers.weaponArtHpCostDelta,
      });
      return;
    }

    this._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'unhandled_effect_type',
    });
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

  getActHitBonusForUnit(unit, actId = this.currentAct) {
    if (!unit || unit.faction !== 'player') return 0;
    const bonuses = this.blessingRuntimeModifiers?.actHitBonusByAct;
    if (!bonuses || typeof bonuses !== 'object') return 0;
    return Math.trunc(bonuses[actId] || 0);
  }

  getShopItemCountDelta() {
    return Math.trunc(this.blessingRuntimeModifiers?.shopItemCountDelta || 0);
  }

  getXpMultiplierDelta() {
    return this.blessingRuntimeModifiers?.xpMultiplierDelta || 0;
  }

  getForgeCostDiscount() {
    return this.blessingRuntimeModifiers?.forgeCostDiscount || 0;
  }

  getShopPriceDiscount() {
    return this.blessingRuntimeModifiers?.shopPriceDiscount || 0;
  }

  getRecruitLevelBonus() {
    return Math.trunc(this.blessingRuntimeModifiers?.recruitLevelBonus || 0);
  }

  getTerrainCombatBonuses() {
    return Array.isArray(this.blessingRuntimeModifiers?.terrainCombatBonuses)
      ? this.blessingRuntimeModifiers.terrainCombatBonuses
      : [];
  }

  _buildBlessingAllGrowthBonus() {
    const delta = Math.trunc(this.blessingRuntimeModifiers?.allGrowthsDelta || 0);
    if (delta === 0) return null;
    const bonus = {};
    for (const stat of XP_STAT_NAMES) bonus[stat] = delta;
    return bonus;
  }

  _buildScaledBlessingAllGrowthBonus(multiplier) {
    const merged = {};
    const entriesRaw = this.blessingRuntimeModifiers?.allGrowthsDeltas;
    const hasEntryArray = Array.isArray(entriesRaw) && entriesRaw.length > 0;
    const entries = hasEntryArray
      ? entriesRaw
      : Number.isFinite(this.blessingRuntimeModifiers?.allGrowthsDelta) &&
          Math.trunc(this.blessingRuntimeModifiers.allGrowthsDelta) !== 0
        ? [Math.trunc(this.blessingRuntimeModifiers.allGrowthsDelta)]
        : [];
    for (const rawDelta of entries) {
      const delta = Math.trunc(Number(rawDelta) || 0);
      if (delta === 0) continue;
      const scaled = Math.round(delta * multiplier);
      if (scaled === 0) continue;
      for (const stat of XP_STAT_NAMES) {
        merged[stat] = (merged[stat] || 0) + scaled;
      }
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }

  _buildBlessingTargetedGrowthBonus(scope = 'all') {
    const entries = this.blessingRuntimeModifiers?.targetedGrowthsDeltas;
    if (!Array.isArray(entries) || entries.length <= 0) return null;
    const bonus = {};
    const allowScope = new Set(scope === 'lords' ? ['all', 'lords'] : ['all', 'recruits']);
    for (const entry of entries) {
      if (!entry || !allowScope.has(entry.scope || 'all')) continue;
      for (const stat of entry.stats || []) {
        if (!XP_STAT_NAMES.includes(stat)) continue;
        bonus[stat] = (bonus[stat] || 0) + Math.trunc(entry.value || 0);
      }
    }
    return Object.keys(bonus).length > 0 ? bonus : null;
  }

  _buildScaledBlessingTargetedGrowthBonus(scope = 'all', multiplier = 1) {
    const entries = this.blessingRuntimeModifiers?.targetedGrowthsDeltas;
    if (!Array.isArray(entries) || entries.length <= 0) return null;
    const bonus = {};
    const allowScope = new Set(scope === 'lords' ? ['all', 'lords'] : ['all', 'recruits']);
    for (const entry of entries) {
      if (!entry || !allowScope.has(entry.scope || 'all')) continue;
      const delta = Math.trunc(Number(entry.value) || 0);
      if (delta === 0) continue;
      const scaled = Math.round(delta * multiplier);
      if (scaled === 0) continue;
      for (const stat of entry.stats || []) {
        if (!XP_STAT_NAMES.includes(stat)) continue;
        bonus[stat] = (bonus[stat] || 0) + scaled;
      }
    }
    return Object.keys(bonus).length > 0 ? bonus : null;
  }

  _mergeGrowthBonuses(baseBonuses, blessingBonuses) {
    const merged = {};
    for (const stat of XP_STAT_NAMES) {
      const total = (baseBonuses?.[stat] || 0) + (blessingBonuses?.[stat] || 0);
      if (total !== 0) merged[stat] = total;
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }

  getEffectiveRecruitGrowthBonuses() {
    // Scale each source independently before merging. For blessings, scale each effect entry
    // before accumulation to match run-start application order.
    const mult = this._getGrowthBonusMultiplier();
    const scaledMeta = this._scaleGrowthBonuses(this.metaEffects?.growthBonuses || null, mult);
    const scaledAll = this._buildScaledBlessingAllGrowthBonus(mult);
    const scaledTargeted = this._buildScaledBlessingTargetedGrowthBonus('recruits', mult);
    return this._mergeGrowthBonuses(
      this._mergeGrowthBonuses(scaledMeta, scaledAll),
      scaledTargeted,
    );
  }

  getEffectiveLordGrowthBonuses() {
    // Scale each source independently before merging. For blessings, scale each effect entry
    // before accumulation to match run-start application order.
    const mult = this._getGrowthBonusMultiplier();
    const scaledMeta = this._scaleGrowthBonuses(this.metaEffects?.lordGrowthBonuses || null, mult);
    const scaledAll = this._buildScaledBlessingAllGrowthBonus(mult);
    const scaledTargeted = this._buildScaledBlessingTargetedGrowthBonus('lords', mult);
    return this._mergeGrowthBonuses(
      this._mergeGrowthBonuses(scaledMeta, scaledAll),
      scaledTargeted,
    );
  }

  getEffectiveMetaEffects() {
    const base = this.metaEffects ? { ...this.metaEffects } : {};
    const recruitGrowthBonuses = this.getEffectiveRecruitGrowthBonuses();
    const lordGrowthBonuses = this.getEffectiveLordGrowthBonuses();
    base.growthBonuses = recruitGrowthBonuses || {};
    base.lordGrowthBonuses = lordGrowthBonuses || {};
    return base;
  }

  // ── Third Lord (Power of Friendship meta upgrade) ──────────────

  shouldTriggerThirdLord() {
    if (this.thirdLordJoined) return false;
    if (!this.metaEffects?.thirdLordMode) return false;
    if (this.completedBattles !== 3) return false;
    return true;
  }

  canRerollThirdLord() {
    return !this.thirdLordRerolled && this.metaEffects?.thirdLordMode === 'pick3_reroll';
  }

  consumeThirdLordReroll() {
    this.thirdLordRerolled = true;
  }

  resolveThirdLord(unit) {
    this.thirdLordJoined = true;
    if (unit) this.roster.push(unit);
  }

  consumeSkipFirstShop() {
    if (!this.blessingRuntimeModifiers?.skipFirstShop) return false;
    this.blessingRuntimeModifiers.skipFirstShop = false;
    this._recordBlessingEvent(
      'node_shop',
      null,
      { type: 'skip_first_shop', params: { enabled: true } },
      {
        consumed: true,
      },
    );
    return true;
  }

  getChurchPromotionCount(nodeId) {
    if (this._churchPromotionTracker?.nodeId === nodeId) {
      return this._churchPromotionTracker.count;
    }
    return 0;
  }

  setChurchPromotionCount(nodeId, count) {
    this._churchPromotionTracker = { nodeId, count };
  }

  getWeaponArtSpawnConfig() {
    return {
      weaponArtCatalog: this.gameData?.weaponArts?.arts || [],
      ironArms: Boolean(this.metaEffects?.ironArms),
      steelArms: Boolean(this.metaEffects?.steelArms),
      enableSilver: true,
    };
  }

  _resolveWeaponArtSpawnTier(art) {
    if (!art) return null;
    const explicitTier =
      typeof art.spawnTier === 'string'
        ? art.spawnTier.trim().toLowerCase()
        : typeof art.tierAffinity === 'string'
          ? art.tierAffinity.trim().toLowerCase()
          : '';
    if (explicitTier === 'iron') return 'Iron';
    if (explicitTier === 'steel') return 'Steel';
    if (explicitTier === 'silver') return 'Silver';

    const unlockAct = typeof art.unlockAct === 'string' ? art.unlockAct.trim().toLowerCase() : '';
    if (unlockAct === 'act1') return 'Iron';
    if (unlockAct === 'act2') return 'Steel';
    if (unlockAct === 'act3') return 'Silver';
    return null;
  }

  _buildWeaponArtSpawnPools({
    includeIron = false,
    includeSteel = false,
    includeSilver = false,
  } = {}) {
    const enabledTiers = new Set();
    if (includeIron) enabledTiers.add('Iron');
    if (includeSteel) enabledTiers.add('Steel');
    if (includeSilver) enabledTiers.add('Silver');
    if (enabledTiers.size <= 0) return null;

    const catalog = this.gameData?.weaponArts?.arts;
    if (!Array.isArray(catalog) || catalog.length <= 0) return null;

    const poolsByTier = new Map();
    for (const art of catalog) {
      if (!art?.id) continue;
      if (art.legacy === true) continue;
      if (Array.isArray(art.legendaryWeaponIds) && art.legendaryWeaponIds.length > 0) continue;
      const weaponTypes = getWeaponArtAllowedTypes(art).filter((weaponType) =>
        WEAPON_ART_SPAWN_WEAPON_TYPES.has(weaponType),
      );
      if (weaponTypes.length <= 0) continue;
      const tier = this._resolveWeaponArtSpawnTier(art);
      if (!tier || !enabledTiers.has(tier)) continue;

      if (!poolsByTier.has(tier)) poolsByTier.set(tier, new Map());
      const byType = poolsByTier.get(tier);
      for (const weaponType of weaponTypes) {
        if (!byType.has(weaponType)) byType.set(weaponType, []);
        byType.get(weaponType).push(art.id);
      }
    }

    return poolsByTier.size > 0 ? poolsByTier : null;
  }

  _appendWeaponArtBinding(weapon, artId, source = 'meta_innate') {
    if (!weapon || typeof artId !== 'string' || artId.trim().length <= 0) return false;

    const bindings = getWeaponArtBindings(weapon, { maxSlots: 3 });
    if (bindings.some((binding) => binding.id === artId)) return false;
    if (bindings.length >= 3) return false;

    bindings.push({ id: artId, source });
    weapon.weaponArtIds = bindings.map((binding) => binding.id);
    weapon.weaponArtSources = bindings.map((binding) => binding.source || 'innate');
    weapon.weaponArtId = weapon.weaponArtIds[0];
    weapon.weaponArtSource = weapon.weaponArtSources[0] || 'innate';
    return true;
  }

  _assignMetaWeaponArtsToStartingWeapons(lords) {
    const includeIron = Boolean(this.metaEffects?.ironArms);
    const includeSteel = Boolean(this.metaEffects?.steelArms);
    const addExtraArt = Boolean(this.metaEffects?.artAdept);

    const poolsByTier = this._buildWeaponArtSpawnPools({
      includeIron,
      includeSteel,
      includeSilver: true,
    });
    if (!poolsByTier) return;

    const rollFromPool = (pool) => {
      if (!Array.isArray(pool) || pool.length <= 0) return null;
      return pool[Math.floor(Math.random() * pool.length)] || null;
    };

    const candidatesForAdept = [];

    for (const unit of lords) {
      const inventory = Array.isArray(unit?.inventory) ? unit.inventory : [];
      for (const weapon of inventory) {
        if (!weapon || !WEAPON_ART_SPAWN_WEAPON_TYPES.has(weapon.type)) continue;
        const tier = typeof weapon.tier === 'string' ? weapon.tier : null;
        if (!WEAPON_ART_SPAWN_TIERS.has(tier)) continue;
        if (tier === 'Iron' && !includeIron) continue;
        if (tier === 'Steel' && !includeSteel) continue;

        const pool = poolsByTier.get(tier)?.get(weapon.type) || [];
        if (pool.length <= 0) continue;

        const firstArtId = rollFromPool(pool);
        if (firstArtId) {
          this._appendWeaponArtBinding(weapon, firstArtId, 'meta_innate');
        }

        if (addExtraArt) {
          candidatesForAdept.push({ weapon, pool });
        }
      }
    }

    if (!addExtraArt || candidatesForAdept.length <= 0) return;

    const picked = candidatesForAdept[Math.floor(Math.random() * candidatesForAdept.length)];
    if (!picked?.weapon || !Array.isArray(picked.pool) || picked.pool.length <= 0) return;

    const existingIds = new Set(
      getWeaponArtBindings(picked.weapon, { maxSlots: 3 }).map((binding) => binding.id),
    );
    const available = picked.pool.filter((id) => !existingIds.has(id));
    const extraArtId = rollFromPool(available);
    if (!extraArtId) return;
    this._appendWeaponArtBinding(picked.weapon, extraArtId, 'meta_innate');
  }

  _resolveExtraStarterClassPoolByTier(tier) {
    const numericTier = Math.max(0, Math.trunc(Number(tier) || 0));
    const clampedTier = Math.min(4, numericTier);
    const requestedPool = EXTRA_STARTER_CLASS_POOLS[clampedTier] || [];
    const validClasses = new Set(
      (this.gameData?.classes || []).map((c) => c?.name).filter(Boolean),
    );
    return requestedPool.filter((className) => validClasses.has(className));
  }

  _toRomanNumeral(value) {
    let n = Math.max(1, Math.trunc(Number(value) || 1));
    const map = [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];
    let out = '';
    for (const [amount, glyph] of map) {
      while (n >= amount) {
        out += glyph;
        n -= amount;
      }
    }
    return out;
  }

  _getTrackedRecruitNames() {
    const tracked = new Set();
    const tracker =
      this.usedRecruitNames && typeof this.usedRecruitNames === 'object'
        ? this.usedRecruitNames
        : {};

    for (const value of Object.values(tracker)) {
      if (!Array.isArray(value)) continue;
      for (const name of value) {
        if (typeof name === 'string' && name.trim().length > 0) tracked.add(name);
      }
    }

    for (const unit of this.roster || []) {
      const name = typeof unit?.name === 'string' ? unit.name.trim() : '';
      if (name) tracked.add(name);
    }

    return tracked;
  }

  _makeUniqueRecruitName(baseName, takenNames) {
    const safeBase =
      typeof baseName === 'string' && baseName.trim().length > 0 ? baseName.trim() : 'Recruit';
    if (!takenNames.has(safeBase)) return safeBase;

    for (let i = 2; i <= 99; i++) {
      const candidate = `${safeBase} ${this._toRomanNumeral(i)}`;
      if (!takenNames.has(candidate)) return candidate;
    }

    const MAX_NAME_ATTEMPTS = 10000;
    for (let i = 2; i < MAX_NAME_ATTEMPTS; i++) {
      const candidate = `${safeBase} ${i}`;
      if (!takenNames.has(candidate)) return candidate;
    }
    console.warn(
      `[RunManager] Name exhaustion for "${safeBase}" after ${MAX_NAME_ATTEMPTS} attempts`,
    );
    return `${safeBase} ${Date.now()}`;
  }

  _trackRecruitNameUse(className, name) {
    if (!this.usedRecruitNames || typeof this.usedRecruitNames !== 'object') {
      this.usedRecruitNames = {};
    }

    const classKey =
      typeof className === 'string' && className.trim().length > 0 ? className.trim() : 'Recruit';

    if (!Array.isArray(this.usedRecruitNames[classKey])) this.usedRecruitNames[classKey] = [];
    if (!this.usedRecruitNames[classKey].includes(name)) {
      this.usedRecruitNames[classKey].push(name);
    }

    if (!Array.isArray(this.usedRecruitNames.__all__)) this.usedRecruitNames.__all__ = [];
    if (!this.usedRecruitNames.__all__.includes(name)) {
      this.usedRecruitNames.__all__.push(name);
    }
  }

  _repairDuplicateRosterNames() {
    if (!Array.isArray(this.roster) || this.roster.length <= 1) return;

    const seen = new Set();
    for (const unit of this.roster) {
      if (!unit || typeof unit !== 'object') continue;

      const rawName = typeof unit.name === 'string' ? unit.name.trim() : '';
      const fallbackBase = typeof unit.className === 'string' ? unit.className.trim() : '';
      const baseName = rawName || fallbackBase || 'Recruit';
      const uniqueName = this._makeUniqueRecruitName(baseName, seen);
      unit.name = uniqueName;
      seen.add(uniqueName);
    }

    for (const unit of this.roster) {
      const name = typeof unit?.name === 'string' ? unit.name.trim() : '';
      if (!name) continue;
      this._trackRecruitNameUse(unit.className, name);
    }
  }

  _pickRecruitNameForClass(className) {
    const namePool = this.gameData?.recruits?.namePool || {};
    const classNames = Array.isArray(namePool[className]) ? namePool[className] : [];
    const usedByClass = Array.isArray(this.usedRecruitNames?.[className])
      ? this.usedRecruitNames[className]
      : [];
    const usedGlobal = this._getTrackedRecruitNames();

    let name = className;
    if (classNames.length > 0) {
      const available = classNames.filter((n) => !usedByClass.includes(n) && !usedGlobal.has(n));
      if (available.length > 0) {
        name = available[Math.floor(Math.random() * available.length)];
      } else {
        const globallyAvailable = classNames.filter((n) => !usedGlobal.has(n));
        if (globallyAvailable.length > 0) {
          name = globallyAvailable[Math.floor(Math.random() * globallyAvailable.length)];
        } else {
          const baseName = classNames[Math.floor(Math.random() * classNames.length)] || className;
          name = this._makeUniqueRecruitName(baseName, usedGlobal);
        }
      }
    } else {
      name = this._makeUniqueRecruitName(className, usedGlobal);
    }

    this._trackRecruitNameUse(className, name);
    return name;
  }

  _applyExtraStarterPaladinLoadout(unit) {
    const allWeapons = this.gameData?.weapons || [];
    const ironSword = allWeapons.find((w) => w.name === 'Iron Sword');
    const steelLance = allWeapons.find((w) => w.name === 'Steel Lance');

    unit.inventory = [];
    unit.weapon = null;
    if (ironSword) addToInventory(unit, ironSword);
    if (steelLance) addToInventory(unit, steelLance);

    unit.weapon =
      unit.inventory.find((w) => w.name === 'Steel Lance' && canEquip(unit, w)) ||
      unit.inventory.find((w) => canEquip(unit, w)) ||
      null;
  }

  _removeWeaponByName(unit, weaponName) {
    const idx = unit.inventory.findIndex((weapon) => weapon?.name === weaponName);
    if (idx === -1) return false;
    const [removed] = unit.inventory.splice(idx, 1);
    if (unit.weapon === removed || unit.weapon?.name === weaponName) {
      unit.weapon = unit.inventory.find((weapon) => canEquip(unit, weapon)) || null;
    }
    return true;
  }

  _applyDeadlyArsenalLoadout(edricUnit) {
    const tierFromNewEffect = Math.max(
      0,
      Math.trunc(Number(this.metaEffects?.deadlyArsenalTier) || 0),
    );
    const legacyDeadlyArsenal = Number(this.metaEffects?.deadlyArsenal) > 0;
    const deadlyArsenalTier = Math.max(tierFromNewEffect, legacyDeadlyArsenal ? 2 : 0);
    if (deadlyArsenalTier <= 0) return;

    const allWeapons = this.gameData?.weapons || [];
    const rapier = allWeapons.find((weapon) => weapon.name === 'Rapier');
    const silverSword = allWeapons.find((weapon) => weapon.name === 'Silver Sword');

    // Tier 1: replace the Steel Sword slot with Rapier.
    this._removeWeaponByName(edricUnit, 'Steel Sword');
    if (rapier) addToInventory(edricUnit, rapier);

    // Tier 2: add Silver Sword and auto-equip it.
    if (deadlyArsenalTier >= 2 && silverSword && addToInventory(edricUnit, silverSword)) {
      const addedSilver = edricUnit.inventory.find((weapon) => weapon?.name === 'Silver Sword');
      if (addedSilver && canEquip(edricUnit, addedSilver)) {
        edricUnit.weapon = addedSilver;
      }
    }
  }

  _createExtraStartingUnit(className) {
    const classes = this.gameData?.classes || [];
    const classData = classes.find((c) => c.name === className);
    if (!classData) return null;

    const recruitDef = {
      name: this._pickRecruitNameForClass(className),
      level: 1,
    };
    const statBonuses = this.metaEffects?.statBonuses || null;
    const growthBonuses = this._scaleGrowthBonuses(
      this.metaEffects?.growthBonuses || null,
      this._getGrowthBonusMultiplier(),
    );
    const randomSkillPool = this.metaEffects?.recruitRandomSkill ? RECRUIT_SKILL_POOL : null;

    const hasRecruitTemplate = classData?.baseStats && classData?.growthRanges;
    const recruitClassData = hasRecruitTemplate
      ? classData
      : classes.find((c) => c.name === classData.promotesFrom);
    if (!recruitClassData?.baseStats || !recruitClassData?.growthRanges) return null;

    const unit = createRecruitUnit(
      recruitDef,
      recruitClassData,
      this.gameData?.weapons || [],
      statBonuses,
      growthBonuses,
      randomSkillPool,
      classes,
    );
    if (!hasRecruitTemplate) {
      promoteUnit(unit, classData, classData.promotionBonuses || {}, this.gameData?.skills || []);
    }
    unit.faction = 'player';

    if (className === 'Paladin') {
      this._applyExtraStarterPaladinLoadout(unit);
    }
    const cadreSpawnTier = unit.weapon?.tier || 'Iron';
    grantLethalArmoryWeapon(unit, this.gameData?.weapons || [], this.metaEffects?.lethalArmoryTier);
    if (this.metaEffects?.masterOfArms) {
      grantSecondaryWeapons(unit, this.gameData?.weapons || [], cadreSpawnTier);
    }
    if (this.metaEffects?.recruitStartingVulnerary) {
      const vulnerary = this.gameData?.consumables?.find((c) => c.name === 'Vulnerary');
      if (vulnerary) addToConsumables(unit, vulnerary);
    }
    if (unit.weapon && !canEquip(unit, unit.weapon)) {
      unit.weapon = unit.inventory.find((w) => canEquip(unit, w)) || null;
    }
    return serializeUnit(unit);
  }

  /** Create Edric + Sera as the starting two lords. */
  createInitialRoster() {
    const { lords, classes, weapons, accessories } = this.gameData;
    const me = this.metaEffects;

    // Edric — Lord
    const edric = lords.find((l) => l.name === 'Edric');
    const edricClass = classes.find((c) => c.name === edric.class);
    const edricUnit = createLordUnit(edric, edricClass, weapons);
    this._applyLordMetaBonuses(edricUnit);

    // Edric's extra combat sword defaults to Steel Sword, then Deadly Arsenal tiers adjust this loadout.
    const edricSteelSword = weapons.find((w) => w.name === 'Steel Sword');
    if (edricSteelSword) addToInventory(edricUnit, edricSteelSword);
    this._applyDeadlyArsenalLoadout(edricUnit);

    edricUnit.consumables.push({
      name: 'Vulnerary',
      type: 'Consumable',
      effect: 'heal',
      value: 10,
      uses: 3,
      price: 300,
    });
    if (me?.extraVulnerary) {
      edricUnit.consumables.push({
        name: 'Vulnerary',
        type: 'Consumable',
        effect: 'heal',
        value: 10,
        uses: 3,
        price: 300,
      });
    }

    // Sera — Light Sage
    const sera = lords.find((l) => l.name === 'Sera');
    const seraClass = classes.find((c) => c.name === sera.class);
    const seraUnit = createLordUnit(sera, seraClass, weapons);
    this._applyLordMetaBonuses(seraUnit);
    seraUnit.proficiencies.push({ type: 'Staff', rank: 'Prof' });

    // Sera's staff — tier upgrade
    const staffTier = me?.startingStaffTier || 0;
    const staffName = STARTING_STAFF_TIERS[staffTier] || 'Heal';
    const staff = weapons.find((w) => w.name === staffName);
    if (staff) addToInventory(seraUnit, staff);

    seraUnit.consumables.push({
      name: 'Vulnerary',
      type: 'Consumable',
      effect: 'heal',
      value: 10,
      uses: 3,
      price: 300,
    });

    // Meta weapon-art spawns for starting weapons (Iron/Steel + Art Adept extra slot).
    this._assignMetaWeaponArtsToStartingWeapons([edricUnit, seraUnit]);

    // Apply weapon forges (unique stats via shuffle) to all lords' combat weapons
    const forgeLevels = me?.startingWeaponForge || 0;
    if (forgeLevels > 0) {
      const FORGE_STATS = ['might', 'crit', 'hit', 'weight'];
      for (const unit of [edricUnit, seraUnit]) {
        for (const w of unit.inventory) {
          if (w.type === 'Staff') continue;
          // Fisher-Yates shuffle to pick unique stats (max forgeLevels is 3, FORGE_STATS has 4)
          const shuffled = [...FORGE_STATS];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          const forgeCount = Math.min(forgeLevels, shuffled.length);
          for (let i = 0; i < forgeCount; i++) {
            applyForge(w, shuffled[i]);
          }
        }
      }
    }

    // Starting accessory for Edric
    const accTier = me?.startingAccessoryTier || 0;
    if (accTier > 0 && accessories) {
      const accName = STARTING_ACCESSORY_TIERS[accTier];
      const acc = accessories.find((a) => a.name === accName);
      if (acc) equipAccessory(edricUnit, structuredClone(acc));
    }

    // Starting reclass seal from meta upgrade
    if (me?.startingReclassSeal) {
      const reclassSeal = this.gameData?.consumables?.find((c) => c.name === 'Infantry Seal');
      if (reclassSeal) this.addToConvoy(reclassSeal);
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

    const roster = [serializeUnit(edricUnit), serializeUnit(seraUnit)];
    const extraStarterTier = Math.max(0, Math.trunc(Number(me?.extraStartingUnitTier) || 0));
    if (extraStarterTier > 0) {
      const classPool = this._resolveExtraStarterClassPoolByTier(extraStarterTier);
      if (classPool.length > 0) {
        const className = classPool[Math.floor(Math.random() * classPool.length)];
        const extraStarter = this._createExtraStartingUnit(className);
        if (extraStarter) roster.push(extraStarter);
      }
    }

    return roster;
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
      const mult = this._getGrowthBonusMultiplier();
      for (const [stat, bonus] of Object.entries(this.metaEffects.lordGrowthBonuses)) {
        unit.growths[stat] = (unit.growths[stat] || 0) + Math.round(bonus * mult);
      }
    }
  }

  /** Return nodes the player can select next. */
  getAvailableNodes() {
    if (!this.nodeMap) return [];

    // If no node completed yet, only the start node is available
    if (this.currentNodeId === null) {
      const start = this.nodeMap.nodes.find((n) => n.id === this.nodeMap.startNodeId);
      return start ? [start] : [];
    }

    const current = this.nodeMap.nodes.find((n) => n.id === this.currentNodeId);
    if (!current) return [];
    // If current node isn't completed yet, only it is available (re-entry)
    if (!current.completed) return [current];
    // Otherwise, forward edges from the completed node
    return current.edges.map((id) => this.nodeMap.nodes.find((n) => n.id === id)).filter(Boolean);
  }

  /** Mark a node as the current destination. Returns the node. */
  selectNode(nodeId) {
    const node = this.nodeMap.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    return node;
  }

  /** Get battleParams for a battle node. */
  getBattleParams(node) {
    if (!node?.battleParams) return null;
    const battleParams = structuredClone(node.battleParams);
    const isFirstBattle = this.completedBattles === 0;
    battleParams.fogEnabled = !isFirstBattle && Boolean(node.fogEnabled);
    battleParams.firstBattleFightersOnly = isFirstBattle;
    battleParams.enemyStatBonus = this.getDifficultyModifier('enemyStatBonus', 0);
    battleParams.enemyCountBonus = this.getDifficultyModifier('enemyCountBonus', 0);
    battleParams.enemyLevelBonus = this.getDifficultyModifier('enemyLevelBonus', 0);
    battleParams.enemyCountBase = this.getDifficultyModifier('enemyCountBase', 0);
    battleParams.enemyEquipTierShift = this.getDifficultyModifier('enemyEquipTierShift', 0);
    battleParams.xpMultiplier = this.getDifficultyModifier('xpMultiplier', 1);
    battleParams.goldMultiplier = this.getDifficultyModifier('goldMultiplier', 1);
    battleParams.enemyPoisonChance = this.getDifficultyModifier('enemyPoisonChance', 0);
    battleParams.reinforcementTurnOffset = this.getDifficultyModifier('reinforcementTurnOffset', 0);
    battleParams.recruitGuardianChance = this.getDifficultyModifier(
      'recruitGuardianChance',
      Number.isFinite(battleParams.recruitGuardianChance) ? battleParams.recruitGuardianChance : 0,
    );
    battleParams.difficultyId = this.difficultyId || 'normal';
    // statusStaffConfig is an object — read directly (getDifficultyModifier coerces objects)
    battleParams.statusStaffConfig = this.difficultyModifiers?.statusStaffConfig ?? null;
    battleParams.siegeWeaponConfig = this.difficultyModifiers?.siegeWeaponConfig ?? null;
    this._repairDuplicateRosterNames();
    battleParams.usedRecruitNames = this.usedRecruitNames || {};
    return battleParams;
  }

  getAmbushPendingNode() {
    const pendingNodeId =
      typeof this.pendingAmbushNodeId === 'string' ? this.pendingAmbushNodeId : null;
    if (!pendingNodeId) return null;
    if (!Array.isArray(this.nodeMap?.nodes)) return null;
    return this.nodeMap.nodes.find((node) => node?.id === pendingNodeId) || null;
  }

  clearAmbushPendingNode(nodeId = null) {
    if (!this.pendingAmbushNodeId) return false;
    if (nodeId === null || nodeId === undefined) {
      this.pendingAmbushNodeId = null;
      return true;
    }
    if (this.pendingAmbushNodeId !== nodeId) return false;
    this.pendingAmbushNodeId = null;
    return true;
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
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    if (node) node.encounterLocked = true;
  }

  getShopState(nodeId) {
    const state = this.shopStateByNodeId?.[nodeId];
    return state ? structuredClone(state) : null;
  }

  saveShopState(nodeId, state) {
    if (!nodeId || !state) return;
    if (!this.shopStateByNodeId) this.shopStateByNodeId = {};
    this.shopStateByNodeId[nodeId] = structuredClone(state);
  }

  clearShopState(nodeId) {
    if (this.shopStateByNodeId) delete this.shopStateByNodeId[nodeId];
  }

  /** Get a deep copy of the roster for deployment. */
  getRoster() {
    this._sanitizeUnitPools();
    const cloned = JSON.parse(JSON.stringify(this.roster));
    cloned.forEach((u) => relinkWeapon(u));
    return cloned;
  }

  addGold(amount) {
    this.gold += amount;
  }

  awardGold(amount) {
    const normalizedAmount = Math.trunc(Number(amount) || 0);
    if (normalizedAmount <= 0) return 0;
    this.addGold(normalizedAmount);
    return normalizedAmount;
  }

  getConvoyCapacities() {
    const bonus = Math.max(0, Math.trunc(this.metaEffects?.convoyCapacityBonus || 0));
    return {
      weapons: CONVOY_WEAPON_CAPACITY + bonus,
      consumables: CONVOY_CONSUMABLE_CAPACITY + bonus,
    };
  }

  getConvoyCounts() {
    this._sanitizeUnitPools();
    return {
      weapons: this.convoy.weapons.length,
      consumables: this.convoy.consumables.length,
    };
  }

  getConvoyItems() {
    this._sanitizeUnitPools();
    return {
      weapons: this.convoy.weapons.map((item) => structuredClone(item)),
      consumables: this.convoy.consumables.map((item) => structuredClone(item)),
    };
  }

  canAddToConvoy(item) {
    const bucket = getConvoyBucket(item);
    if (!bucket) return false;
    this._sanitizeUnitPools();
    const caps = this.getConvoyCapacities();
    if (bucket === 'consumables') return this.convoy.consumables.length < caps.consumables;
    return this.convoy.weapons.length < caps.weapons;
  }

  addToConvoy(item) {
    const bucket = getConvoyBucket(item);
    if (!bucket || !this.canAddToConvoy(item)) return false;
    const clone = structuredClone(item);
    if (bucket === 'consumables') {
      this.convoy.consumables.push(clone);
    } else {
      this.convoy.weapons.push(clone);
    }
    return true;
  }

  /**
   * Move eligible fallen-unit items into team storage.
   * Weapons/staves + consumables route to convoy if capacity allows.
   * Accessories route to the team accessory pool.
   * Items that cannot be transferred remain on the fallen unit.
   */
  _transferFallenUnitItems(fallenUnit) {
    if (!fallenUnit || typeof fallenUnit !== 'object') return;
    this._sanitizeUnitPools();
    if (!Array.isArray(this.accessories)) this.accessories = [];

    const inventory = Array.isArray(fallenUnit.inventory) ? fallenUnit.inventory : [];
    const consumables = Array.isArray(fallenUnit.consumables) ? fallenUnit.consumables : [];

    // Handle corrupted legacy data where equipped weapon is absent from inventory
    // or represented by a deep-equal-but-different object reference.
    const equipped = fallenUnit.weapon;
    if (equipped) {
      let equippedInInventory = inventory.includes(equipped);
      if (!equippedInInventory && inventory.length > 0) {
        const equippedStr = JSON.stringify(equipped);
        const equivalent = inventory.find((item) => JSON.stringify(item) === equippedStr);
        if (equivalent) {
          fallenUnit.weapon = equivalent;
          equippedInInventory = true;
        }
      }

      if (!equippedInInventory) {
        if (this.addToConvoy(equipped)) {
          fallenUnit.weapon = null;
        } else {
          // Keep blocked equipped item recoverable on revive.
          inventory.push(equipped);
        }
      }
    }

    const keptInventory = [];
    for (const item of inventory) {
      if (!this.addToConvoy(item)) keptInventory.push(item);
    }
    fallenUnit.inventory = keptInventory;

    const keptConsumables = [];
    for (const item of consumables) {
      if (!this.addToConvoy(item)) keptConsumables.push(item);
    }
    fallenUnit.consumables = keptConsumables;

    if (fallenUnit.accessory) {
      this.accessories.push(structuredClone(fallenUnit.accessory));
      fallenUnit.accessory = null;
    }

    relinkWeapon(fallenUnit);
  }

  takeFromConvoy(type, index) {
    this._sanitizeUnitPools();
    if (!Number.isInteger(index) || index < 0) return null;
    if (type === 'consumable') {
      if (index >= this.convoy.consumables.length) return null;
      return this.convoy.consumables.splice(index, 1)[0];
    }
    if (type === 'weapon') {
      if (index >= this.convoy.weapons.length) return null;
      return this.convoy.weapons.splice(index, 1)[0];
    }
    return null;
  }

  spendGold(amount) {
    if (amount > this.gold) return false;
    this.gold -= amount;
    return true;
  }

  getRosterCap() {
    return ROSTER_CAP + (this.metaEffects?.rosterCapBonus || 0);
  }

  /**
   * Called after a battle victory. Serializes surviving units back to roster.
   * @param {Array} survivingUnits - units from BattleScene (with Phaser fields)
   * @param {string} nodeId - the node that was just completed
   * @param {number} goldEarned - accumulated kill gold from battle
   * @param {{ completionGoldOverride?: number }} [options]
   * @returns {boolean} true when completion was applied; false for invalid/duplicate node
   */
  completeBattle(survivingUnits, nodeId, goldEarned = 0, options = {}) {
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    if (!node || node.completed) return false;

    this._sanitizeUnitPools();
    // Track newly fallen units before overwriting roster
    const survivingNames = new Set(survivingUnits.map((u) => u.name));
    const newlyFallen = this.roster.filter((u) => !survivingNames.has(u.name));
    for (const fallen of newlyFallen) {
      if (!this.fallenUnits.find((f) => f.name === fallen.name)) {
        const serializedFallen = serializeUnit(fallen);
        this._transferFallenUnitItems(serializedFallen);
        this.fallenUnits.push(serializedFallen);
      }
    }

    this.roster = survivingUnits.map((u) => serializeUnit(u));
    this._suppressPersonalSkillsForCurrentRosterIfNeeded();
    this.completedBattles++;
    this.winStreak++;
    if (this.winStreak > this.maxWinStreak) this.maxWinStreak = this.winStreak;
    const completionGold = Number.isFinite(options?.completionGoldOverride)
      ? Math.max(0, Math.floor(options.completionGoldOverride))
      : undefined;
    const effectiveNodeType = node?.isAmbush ? 'battle' : node?.type;
    const baseGold = calculateBattleGold(goldEarned, effectiveNodeType, completionGold);
    const eliteMult = node?.battleParams?.isElite ? ELITE_GOLD_MULTIPLIER : 1;
    const goldMult = this.getBattleGoldMultiplier();
    const difficultyGoldMult = this.getDifficultyModifier('goldMultiplier', 1);
    const finalGold = Math.floor(baseGold * eliteMult * goldMult * difficultyGoldMult);
    this.awardGold(finalGold);

    const isRewardBossNode = node.id === this.nodeMap?.bossNodeId && node.type === 'boss';
    const isRewardAct =
      this.nodeMap?.actId === 'act2' ||
      this.nodeMap?.actId === 'act3' ||
      this.nodeMap?.actId === 'act4';
    if (isRewardBossNode && isRewardAct) {
      const currentVision = Number.isFinite(this.visionChargesRemaining)
        ? Math.max(0, Math.trunc(this.visionChargesRemaining))
        : 0;
      this.visionChargesRemaining = currentVision + 1;
    }

    if (node?.isAmbush && node.ambushCleared !== true) {
      node.ambushCleared = true;
      this.pendingAmbushNodeId = nodeId;
    }
    this.markNodeComplete(nodeId);
    return true;
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
   * @param {number} cost - gold cost (scales with level/promotion)
   * @returns {boolean} true if revived, false if roster full or insufficient gold
   */
  reviveFallenUnit(unitName, cost) {
    const rosterCap = this.getRosterCap();
    if (this.roster.length >= rosterCap) return false; // Can't revive if roster full

    // Verify unit exists before spending gold (prevents burning currency on stale names)
    const idx = this.fallenUnits.findIndex((u) => u.name === unitName);
    if (idx === -1) return false;

    if (!this.spendGold(cost)) return false;

    const unit = this.fallenUnits.splice(idx, 1)[0];
    unit.currentHP = 1; // Revive at 1 HP (risky if re-deployed)

    // Normalize class state after serialization round-trip (fixes promotion eligibility)
    const classData = (this.gameData?.classes || []).find((c) => c.name === unit.className);
    if (classData) normalizeUnitClassState(unit, classData);
    ensureSeraBaseStaffProficiency(unit);
    relinkWeapon(unit);

    this.roster.push(unit);
    return true;
  }

  /** Mark a node as completed and update currentNodeId. */
  markNodeComplete(nodeId) {
    const node = this.nodeMap.nodes.find((n) => n.id === nodeId);
    if (node) node.completed = true;
    this.currentNodeId = nodeId;
  }

  /** True if the boss node of the current act is completed. */
  isActComplete() {
    if (!this.nodeMap) return false;
    const boss = this.nodeMap.nodes.find((n) => n.id === this.nodeMap.bossNodeId);
    return boss ? boss.completed : false;
  }

  /** Advance to the next act. Generates a new node map. Returns { unlockedArtIds, displacedSkills }. */
  advanceAct() {
    this._revertActScopedBlessingEffects(this.currentAct);
    if (this.actIndex >= this.actSequence.length - 1)
      return { unlockedArtIds: [], displacedSkills: {} };
    this.actIndex++;
    this._restoreDisabledPersonalSkillsIfReady('act_transition');
    this.nodeMap = generateNodeMap(
      this.currentAct,
      this.currentActConfig,
      this.gameData.mapTemplates,
      {
        fogChanceBonus: this.getDifficultyModifier('fogChanceBonus', 0),
        halfFogChance: this.difficultyId === 'normal',
        villageAmbushChance: this.getDifficultyModifier('villageAmbushChance', 0),
        colosseumConfig: this.gameData.colosseum?.nodeGeneration ?? null,
      },
    );
    this.shopStateByNodeId = {};
    const unlockedNow = this._syncActWeaponArtUnlocksForCurrentAct();
    const displacedSkills = this._lastRestorationDisplacements || {};
    this._lastRestorationDisplacements = null;
    this.currentNodeId = null;
    this.pendingAmbushNodeId = null;
    return { unlockedArtIds: unlockedNow, displacedSkills };
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
        {
          type: 'act_stat_delta_all_units',
          params: { act: tracker.act, stat: tracker.stat, value: tracker.value },
        },
        { revertedInAct: expiredAct, stat: tracker.stat, revertedValue: -tracker.value },
      );
    }
  }

  /** True if the final boss has been defeated. */
  isRunComplete() {
    return this.actIndex >= this.actSequence.length - 1 && this.isActComplete();
  }

  _getActOrderIndex(actId) {
    if (!actId) return -1;
    return this.actSequence.indexOf(String(actId));
  }

  _isWeaponArtEligibleForCurrentAct(art) {
    if (!art || !art.id) return false;
    const unlockAct = art.unlockAct || this.actSequence[0] || 'act1';
    const requiredIndex = this._getActOrderIndex(unlockAct);
    if (requiredIndex === -1) return false;
    return this.actIndex >= requiredIndex;
  }

  _getWeaponArtCatalogIds() {
    const arts = this.gameData?.weaponArts?.arts;
    if (!Array.isArray(arts) || arts.length === 0) return new Set();
    const ids = new Set();
    for (const art of arts) {
      if (typeof art?.id === 'string' && art.id.length > 0) ids.add(art.id);
    }
    return ids;
  }

  _normalizeUnlockedWeaponArtIds(ids) {
    if (!Array.isArray(ids)) return [];
    const validIds = this._getWeaponArtCatalogIds();
    const seen = new Set();
    const normalized = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id.length <= 0) continue;
      if (!validIds.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      normalized.push(id);
    }
    return normalized;
  }

  _rebuildUnlockedWeaponArts() {
    const merged = [];
    const seen = new Set();
    const pushAll = (ids) => {
      for (const id of this._normalizeUnlockedWeaponArtIds(ids)) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
      }
    };
    pushAll(this.metaUnlockedWeaponArts);
    pushAll(this.actUnlockedWeaponArts);
    this.metaUnlockedWeaponArts = this._normalizeUnlockedWeaponArtIds(this.metaUnlockedWeaponArts);
    this.actUnlockedWeaponArts = this._normalizeUnlockedWeaponArtIds(this.actUnlockedWeaponArts);
    this.unlockedWeaponArts = merged;
    return [...this.unlockedWeaponArts];
  }

  _syncMetaWeaponArtUnlocks() {
    const ids = this.metaEffects?.metaUnlockedWeaponArts;
    this.metaUnlockedWeaponArts = this._normalizeUnlockedWeaponArtIds(ids);
    return this._rebuildUnlockedWeaponArts();
  }

  _syncActWeaponArtUnlocksForCurrentAct() {
    const arts = this.gameData?.weaponArts?.arts;
    if (!Array.isArray(arts)) return [];
    const before = new Set(this.unlockedWeaponArts || []);
    const unlocked = new Set(this._normalizeUnlockedWeaponArtIds(this.actUnlockedWeaponArts));
    const addedIds = [];
    for (const art of arts) {
      if (!art?.id) continue;
      if (!this._isWeaponArtEligibleForCurrentAct(art)) continue;
      if (unlocked.has(art.id)) continue;
      unlocked.add(art.id);
      addedIds.push(art.id);
    }
    this.actUnlockedWeaponArts = [...unlocked];
    this._rebuildUnlockedWeaponArts();
    return addedIds.filter((id) => !before.has(id));
  }

  isWeaponArtUnlocked(artId) {
    if (!artId) return false;
    if (!Array.isArray(this.unlockedWeaponArts)) return false;
    return this.unlockedWeaponArts.includes(artId);
  }

  unlockWeaponArt(artId) {
    if (!artId) return false;
    const validIds = this._getWeaponArtCatalogIds();
    if (!validIds.has(artId)) return false;
    if (!Array.isArray(this.actUnlockedWeaponArts)) this.actUnlockedWeaponArts = [];
    if (this.isWeaponArtUnlocked(artId)) return false;
    this.actUnlockedWeaponArts.push(artId);
    this._rebuildUnlockedWeaponArts();
    return true;
  }

  getUnlockedWeaponArtIds() {
    return Array.isArray(this.unlockedWeaponArts) ? [...this.unlockedWeaponArts] : [];
  }

  getMetaUnlockedWeaponArtIds() {
    return Array.isArray(this.metaUnlockedWeaponArts) ? [...this.metaUnlockedWeaponArts] : [];
  }

  getActUnlockedWeaponArtIds() {
    return Array.isArray(this.actUnlockedWeaponArts) ? [...this.actUnlockedWeaponArts] : [];
  }

  getUnlockedWeaponArts(catalog = null) {
    const source = Array.isArray(catalog)
      ? catalog
      : Array.isArray(this.gameData?.weaponArts?.arts)
        ? this.gameData.weaponArts.arts
        : [];
    if (!Array.isArray(source) || source.length === 0) return [];
    const unlocked = new Set(this.getUnlockedWeaponArtIds());
    return source.filter((art) => art?.id && unlocked.has(art.id));
  }

  applyDifficultySelection(difficultyId = 'normal') {
    const resolved = resolveDifficultyMode(this.gameData?.difficulty, difficultyId);
    this.difficultyId = resolved.id;
    this.difficultyModifiers = {
      ...resolved.modifiers,
      actsIncluded: sanitizeActSequence(
        resolved.modifiers.actsIncluded || DIFFICULTY_DEFAULTS.actsIncluded,
        DIFFICULTY_DEFAULTS.actsIncluded,
      ),
    };
    this.actSequence = sanitizeActSequence(this.difficultyModifiers.actsIncluded, ACT_SEQUENCE);
    if (this.actIndex >= this.actSequence.length) {
      this.actIndex = Math.max(0, this.actSequence.length - 1);
    }
  }

  getDifficultyModifier(key, fallback = 0) {
    const value = this.difficultyModifiers?.[key];
    if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
    if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
    return Number.isFinite(value) ? value : fallback;
  }

  _getGrowthBonusMultiplier() {
    return this.getDifficultyModifier('growthBonusMultiplier', 1);
  }

  _scaleGrowthBonuses(bonuses, multiplier) {
    if (!bonuses || multiplier === 1) return bonuses;
    const scaled = {};
    for (const [stat, val] of Object.entries(bonuses)) {
      if (!Number.isFinite(val) || val === 0) continue;
      const sv = Math.round(val * multiplier);
      if (sv !== 0) scaled[stat] = sv;
    }
    return Object.keys(scaled).length > 0 ? scaled : null;
  }

  /** Mark the run as a defeat. */
  failRun() {
    this.status = 'defeat';
    this.winStreak = 0;
  }

  _applySettledRewardsToMeta(meta, summary) {
    if (!meta || !summary || summary.appliedToMeta) return;
    meta.addValor(summary.valor);
    meta.addSupply(summary.supply);
    meta.incrementRunsCompleted();
    if (this.actIndex >= 1) meta.recordMilestone('beatAct1');
    if (this.actIndex >= 2) meta.recordMilestone('beatAct2');
    if (this.actIndex >= 3) meta.recordMilestone('beatAct3');
    if (summary.result === 'victory' && this.actIndex >= 3) meta.recordMilestone('beatGame');
    if (summary.result === 'victory' && this.difficultyId === 'hard')
      meta.recordMilestone('beatHard');
    if (summary.result === 'victory' && this.difficultyId === 'lunatic')
      meta.recordMilestone('beatLunatic');
    summary.appliedToMeta = true;
  }

  /**
   * Compute and apply end-of-run rewards exactly once.
   * Safe to call repeatedly and from multiple scenes.
   */
  settleEndRunRewards(meta = null, result = this.status) {
    if (this.endRunRewards) {
      this._applySettledRewardsToMeta(meta, this.endRunRewards);
      return { ...this.endRunRewards };
    }

    const normalizedResult = result === 'victory' ? 'victory' : 'defeat';
    const currencyMultiplier = this.getDifficultyModifier('currencyMultiplier', 1) || 1;
    const { valor, supply } = calculateCurrencies(
      this.actIndex,
      this.completedBattles,
      normalizedResult === 'victory',
      currencyMultiplier,
    );

    this.endRunRewards = {
      result: normalizedResult,
      valor,
      supply,
      currencyMultiplier,
      appliedToMeta: false,
      settledAt: Date.now(),
    };
    this._applySettledRewardsToMeta(meta, this.endRunRewards);
    return { ...this.endRunRewards };
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
      winStreak: this.winStreak || 0,
      maxWinStreak: this.maxWinStreak || 0,
      gold: this.gold,
      metaEffects: this.metaEffects,
      accessories: this.accessories,
      scrolls: this.scrolls,
      convoy: this.convoy,
      randomLegendary: this.randomLegendary || null,
      activeBlessings: (this.activeBlessings || [])
        .map((entry) => {
          const id = getBlessingEntryId(entry);
          if (!id) return null;
          return createActiveBlessingEntry(id, entry?.rolledCost || null);
        })
        .filter(Boolean),
      blessingHistory: this.blessingHistory || [],
      blessingSelectionTelemetry: this.blessingSelectionTelemetry || null,
      blessingRuntimeModifiers: this.blessingRuntimeModifiers || createBlessingRuntimeModifiers(),
      runSeed: this.runSeed,
      rngSeed: this.rngSeed,
      visionChargesRemaining: this.visionChargesRemaining,
      visionCount: this.visionCount,
      usedRecruitNames: this.usedRecruitNames || {},
      battleConfigsByNodeId: this.battleConfigsByNodeId || {},
      shopStateByNodeId: this.shopStateByNodeId || {},
      difficultyId: this.difficultyId || 'normal',
      difficultyModifiers: this.difficultyModifiers || {
        ...DIFFICULTY_DEFAULTS,
        actsIncluded: [...DIFFICULTY_DEFAULTS.actsIncluded],
      },
      actSequence: this.actSequence || [...ACT_SEQUENCE],
      pendingAmbushNodeId: this.pendingAmbushNodeId || null,
      endRunRewards: this.endRunRewards || null,
      metaUnlockedWeaponArts: this.metaUnlockedWeaponArts || [],
      actUnlockedWeaponArts: this.actUnlockedWeaponArts || [],
      unlockedWeaponArts: this.unlockedWeaponArts || [],
      shownDialogueKeys: this.shownDialogueKeys || [],
      churchPromotionTracker: this._churchPromotionTracker || null,
      noMetaMode: this.noMetaMode || false,
      thirdLordJoined: this.thirdLordJoined || false,
      thirdLordRerolled: this.thirdLordRerolled || false,
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

  /**
   * Ensure units loaded from older saves have all class-innate skills.
   * Promoted units receive both promoted and base-class innates.
   */
  static migrateClassInnateSkills(runManager) {
    const classes = runManager.gameData?.classes || [];
    const skillsData = runManager.gameData?.skills || [];
    if (!classes.length || !skillsData.length) return;
    const classByName = new Map(classes.map((c) => [c.name, c]));
    const applyInnates = (unit) => {
      if (!unit) return;
      if (!Array.isArray(unit.skills)) unit.skills = [];
      const addInnatesFor = (className) => {
        for (const sid of getClassInnateSkills(className, skillsData)) {
          learnSkill(unit, sid);
        }
      };
      if (unit.className) addInnatesFor(unit.className);
      const promotedClass = classByName.get(unit.className);
      if (promotedClass?.promotesFrom) addInnatesFor(promotedClass.promotesFrom);
    };
    runManager.roster.forEach(applyInnates);
    runManager.fallenUnits.forEach(applyInnates);
  }

  /**
   * Ensure units loaded from older saves get class-learned skills under current thresholds:
   * - base classes: class learnables at their configured level
   * - promoted classes: own learnables at configured level + base-class learnables at promoted level 10+
   */
  static migrateClassLearnableSkills(runManager) {
    const classes = runManager.gameData?.classes || [];
    if (!classes.length) return;
    const classByName = new Map(classes.map((c) => [c.name, c]));

    const applyLearnables = (unit) => {
      if (!unit) return;
      if (!Array.isArray(unit.skills)) unit.skills = [];
      if (!Number.isFinite(unit.level)) return;

      const currentClass = classByName.get(unit.className);
      if (!currentClass) return;

      const tryLearn = (skillId) => {
        if (!skillId) return;
        if (unit.skills.includes(skillId)) return;
        if (unit.skills.length >= MAX_SKILLS) return;
        unit.skills.push(skillId);
      };

      for (const entry of currentClass.learnableSkills || []) {
        if (unit.level >= entry.level) {
          tryLearn(entry.skillId);
        }
      }

      if (unit.tier === 'promoted' && unit.level >= 10 && currentClass.promotesFrom) {
        const baseClass = classByName.get(currentClass.promotesFrom);
        for (const entry of baseClass?.learnableSkills || []) {
          tryLearn(entry.skillId);
        }
      }
    };

    runManager.roster.forEach(applyLearnables);
    runManager.fallenUnits.forEach(applyLearnables);
  }

  /**
   * Normalize loaded units against current class schema to prevent stale class-state drift.
   */
  static migrateUnitClassState(runManager) {
    const classByName = new Map((runManager.gameData?.classes || []).map((c) => [c.name, c]));
    if (classByName.size <= 0) return;
    const normalize = (unit) => {
      if (!unit || !unit.className) return;
      const classData = classByName.get(unit.className);
      if (!classData) return;
      normalizeUnitClassState(unit, classData);
      ensureSeraBaseStaffProficiency(unit);
    };
    runManager.roster.forEach(normalize);
    runManager.fallenUnits.forEach(normalize);
  }

  /**
   * Normalize weapon-art metadata on item instances loaded from save data.
   * Supports legacy fields and strips malformed metadata fail-closed.
   */
  static migrateWeaponArtItemState(runManager) {
    const validArtIds = new Set(
      Array.isArray(runManager.gameData?.weaponArts?.arts)
        ? runManager.gameData.weaponArts.arts.map((art) => art?.id).filter(Boolean)
        : [],
    );
    const canonicalWeaponTypeByLower = new Map(
      [...CONVOY_WEAPON_TYPES].map((type) => [type.toLowerCase(), type]),
    );

    const normalizeScrollMetadata = (item) => {
      if (!item || typeof item !== 'object') return;
      if (item.type !== 'Scroll') return;
      const teachesId =
        typeof item.teachesWeaponArtId === 'string' ? item.teachesWeaponArtId.trim() : '';
      if (!teachesId || !validArtIds.has(teachesId)) {
        delete item.teachesWeaponArtId;
      } else {
        item.teachesWeaponArtId = teachesId;
      }

      if (Array.isArray(item.allowedWeaponTypes)) {
        const clean = [
          ...new Set(
            item.allowedWeaponTypes
              .filter((type) => typeof type === 'string')
              .map((type) => type.trim())
              .filter(Boolean)
              .map((type) => canonicalWeaponTypeByLower.get(type.toLowerCase()))
              .filter(Boolean),
          ),
        ];
        if (clean.length > 0) item.allowedWeaponTypes = clean;
        else delete item.allowedWeaponTypes;
      } else {
        delete item.allowedWeaponTypes;
      }
    };

    const normalizeWeaponList = (items) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        normalizeWeaponArtBinding(item, { validArtIds });
        normalizeScrollMetadata(item);
      }
    };

    const normalizeUnit = (unit) => {
      if (!unit || typeof unit !== 'object') return;
      normalizeWeaponArtBinding(unit.weapon, { validArtIds });
      normalizeWeaponList(unit.inventory);
      normalizeWeaponList(unit.consumables);
    };

    runManager.roster.forEach(normalizeUnit);
    runManager.fallenUnits.forEach(normalizeUnit);
    normalizeWeaponList(runManager.convoy?.weapons);
    normalizeWeaponList(runManager.convoy?.consumables);
    normalizeWeaponList(runManager.scrolls);
  }

  /**
   * Normalize legacy skill strings (e.g. "Renewal Aura") to canonical skill IDs
   * so on-turn-start and passive skill logic remains reliable across old saves.
   */
  static migrateSkillIds(runManager) {
    const skillsData = runManager.gameData?.skills || [];
    const validSkillIds = new Set(skillsData.map((s) => s.id).filter(Boolean));
    if (!validSkillIds.size) return;

    const toCanonicalSkillId = (raw) => {
      if (typeof raw !== 'string') return raw;
      const value = raw.trim();
      if (!value) return value;
      if (validSkillIds.has(value)) return value;

      const toSnake = (input) =>
        input
          .toLowerCase()
          .replace(/[:].*$/, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');

      const normalized = toSnake(value);
      if (validSkillIds.has(normalized)) return normalized;
      return value;
    };

    const normalizeUnit = (unit) => {
      if (!unit || !Array.isArray(unit.skills)) return;
      const seen = new Set();
      const normalized = [];
      for (const skillId of unit.skills) {
        const canonical = toCanonicalSkillId(skillId);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        normalized.push(canonical);
      }
      unit.skills = normalized;
    };

    runManager.roster.forEach(normalizeUnit);
    runManager.fallenUnits.forEach(normalizeUnit);
  }

  /** Restore a RunManager from saved data. */
  static fromJSON(saved, gameData) {
    const rm = new RunManager(gameData, saved.metaEffects || null);
    if (
      rm.metaEffects &&
      rm.metaEffects.lootWeaponQualityBonus === undefined &&
      rm.metaEffects.lootWeaponWeightBonus !== undefined
    ) {
      const legacyLootBonus = Number(rm.metaEffects.lootWeaponWeightBonus);
      if (Number.isFinite(legacyLootBonus)) {
        rm.metaEffects.lootWeaponQualityBonus = legacyLootBonus;
        const existingCategoryBonuses =
          rm.metaEffects.lootCategoryWeightBonuses &&
          typeof rm.metaEffects.lootCategoryWeightBonuses === 'object'
            ? rm.metaEffects.lootCategoryWeightBonuses
            : {};
        const currentWeaponBonus = Number(existingCategoryBonuses.weapon);
        existingCategoryBonuses.weapon =
          (Number.isFinite(currentWeaponBonus) ? currentWeaponBonus : 0) + legacyLootBonus;
        rm.metaEffects.lootCategoryWeightBonuses = existingCategoryBonuses;
      }
    }
    rm.status = saved.status;
    rm.actIndex = saved.actIndex;
    rm.roster = Array.isArray(saved.roster)
      ? saved.roster.filter((u) => rm._isValidSerializedUnit(u))
      : [];
    rm.fallenUnits = Array.isArray(saved.fallenUnits)
      ? saved.fallenUnits.filter((u) => rm._isValidSerializedUnit(u))
      : [];

    // --- lord presence validation (only for non-empty rosters) ---
    if (rm.roster.length > 0) {
      const lordNames = new Set((gameData.lords || []).map((l) => l.name));
      const unflagged = rm.roster.filter((u) => lordNames.has(u.name) && !u.isLord);
      for (const lord of unflagged) {
        lord.isLord = true;
        console.warn('[RunManager] fromJSON: repaired missing isLord flag on', lord.name);
      }
      if (!rm.roster.some((u) => u.isLord)) {
        throw new Error(
          '[RunManager] fromJSON: no lord found in roster after filtering — save is corrupt',
        );
      }
    }

    rm.nodeMap = saved.nodeMap;
    rm.currentNodeId = saved.currentNodeId;
    rm.completedBattles = saved.completedBattles;
    const ws = saved.winStreak;
    rm.winStreak = Number.isFinite(ws) && ws >= 0 ? Math.trunc(ws) : 0;
    const mws = saved.maxWinStreak;
    rm.maxWinStreak = Number.isFinite(mws) && mws >= 0 ? Math.trunc(mws) : 0;
    rm.gold = Number.isFinite(saved.gold) && saved.gold >= 0 ? Math.floor(saved.gold) : 0;
    rm.accessories = saved.accessories || [];
    rm.scrolls = saved.scrolls || [];
    rm.convoy = saved.convoy || { weapons: [], consumables: [] };
    rm.randomLegendary = saved.randomLegendary || null;
    const rawActiveBlessings = Array.isArray(saved.activeBlessings) ? saved.activeBlessings : [];
    rm.blessingHistory = saved.blessingHistory || [];
    rm.blessingSelectionTelemetry = saved.blessingSelectionTelemetry || null;
    if (rm.blessingSelectionTelemetry && !Array.isArray(rm.blessingSelectionTelemetry.offeredIds)) {
      rm.blessingSelectionTelemetry.offeredIds = Array.isArray(
        rm.blessingSelectionTelemetry.chosenIds,
      )
        ? [...rm.blessingSelectionTelemetry.chosenIds]
        : [];
      rm.blessingSelectionTelemetry.chosenIds = [];
    }
    if (
      rm.blessingSelectionTelemetry &&
      !Array.isArray(rm.blessingSelectionTelemetry.offeredBlessings)
    ) {
      const catalog = gameData?.blessings;
      if (catalog?.blessings?.length && Array.isArray(rm.blessingSelectionTelemetry.offeredIds)) {
        const index = buildBlessingIndex(catalog);
        rm.blessingSelectionTelemetry.offeredBlessings = rm.blessingSelectionTelemetry.offeredIds
          .map((id) => index.get(id))
          .filter(Boolean)
          .map((blessing) => ({ ...structuredClone(blessing), rolledCost: null }));
      } else {
        rm.blessingSelectionTelemetry.offeredBlessings = [];
      }
    }
    if (
      rm.blessingSelectionTelemetry &&
      Array.isArray(rm.blessingSelectionTelemetry.offeredBlessings)
    ) {
      rm.blessingSelectionTelemetry.offeredBlessings =
        rm.blessingSelectionTelemetry.offeredBlessings
          .filter((blessing) => isPlainObject(blessing) && typeof blessing.id === 'string')
          .map((blessing) => ({
            ...structuredClone(blessing),
            rolledCost: normalizeBlessingCostEntry(blessing.rolledCost),
          }));
    }
    if (rm.blessingSelectionTelemetry) {
      const rawChosenBlessings = Array.isArray(rm.blessingSelectionTelemetry.chosenBlessings)
        ? rm.blessingSelectionTelemetry.chosenBlessings
        : Array.isArray(rm.blessingSelectionTelemetry.chosenIds)
          ? rm.blessingSelectionTelemetry.chosenIds
          : [];
      rm.blessingSelectionTelemetry.chosenBlessings = rawChosenBlessings
        .map((entry) => {
          const id = getBlessingEntryId(entry);
          if (!id) return null;
          return createActiveBlessingEntry(id, entry?.rolledCost || null);
        })
        .filter(Boolean);
    }
    rm.blessingRuntimeModifiers =
      saved.blessingRuntimeModifiers || createBlessingRuntimeModifiers();
    if (
      !rm.blessingRuntimeModifiers.actHitBonusByAct ||
      typeof rm.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
    ) {
      rm.blessingRuntimeModifiers.actHitBonusByAct = {};
    }
    if (!Array.isArray(rm.blessingRuntimeModifiers.actStatDeltaAllUnits)) {
      rm.blessingRuntimeModifiers.actStatDeltaAllUnits = [];
    }
    rm.blessingRuntimeModifiers.skipFirstShop = Boolean(rm.blessingRuntimeModifiers.skipFirstShop);
    rm.blessingRuntimeModifiers.shopItemCountDelta = Math.trunc(
      rm.blessingRuntimeModifiers.shopItemCountDelta || 0,
    );
    rm.blessingRuntimeModifiers.allGrowthsDelta = Math.trunc(
      rm.blessingRuntimeModifiers.allGrowthsDelta || 0,
    );
    if (!Array.isArray(rm.blessingRuntimeModifiers.allGrowthsDeltas)) {
      rm.blessingRuntimeModifiers.allGrowthsDeltas =
        rm.blessingRuntimeModifiers.allGrowthsDelta !== 0
          ? [rm.blessingRuntimeModifiers.allGrowthsDelta]
          : [];
    } else {
      rm.blessingRuntimeModifiers.allGrowthsDeltas = rm.blessingRuntimeModifiers.allGrowthsDeltas
        .map((entry) => Math.trunc(Number(entry) || 0))
        .filter((entry) => entry !== 0);
    }
    if (!Array.isArray(rm.blessingRuntimeModifiers.targetedGrowthsDeltas)) {
      rm.blessingRuntimeModifiers.targetedGrowthsDeltas = [];
    } else {
      rm.blessingRuntimeModifiers.targetedGrowthsDeltas =
        rm.blessingRuntimeModifiers.targetedGrowthsDeltas
          .map((entry) => {
            if (!isPlainObject(entry)) return null;
            const stats = [
              ...new Set(
                (Array.isArray(entry.stats) ? entry.stats : [])
                  .filter((stat) => typeof stat === 'string')
                  .map((stat) => stat.trim())
                  .filter((stat) => XP_STAT_NAMES.includes(stat)),
              ),
            ];
            const delta = Math.trunc(Number(entry.value) || 0);
            if (stats.length <= 0 || delta === 0) return null;
            const scope = typeof entry.scope === 'string' ? entry.scope : 'all';
            return { stats, value: delta, scope };
          })
          .filter(Boolean);
    }
    if (
      !rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit ||
      typeof rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit !== 'object'
    ) {
      rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit = {};
    }
    rm.blessingRuntimeModifiers.xpMultiplierDelta =
      Number(rm.blessingRuntimeModifiers.xpMultiplierDelta) || 0;
    rm.blessingRuntimeModifiers.forgeCostDiscount =
      Number(rm.blessingRuntimeModifiers.forgeCostDiscount) || 0;
    rm.blessingRuntimeModifiers.shopPriceDiscount =
      Number(rm.blessingRuntimeModifiers.shopPriceDiscount) || 0;
    rm.blessingRuntimeModifiers.recruitLevelBonus = Math.trunc(
      Number(rm.blessingRuntimeModifiers.recruitLevelBonus) || 0,
    );
    rm.blessingRuntimeModifiers.forgeLimitDelta = Math.trunc(
      Number(rm.blessingRuntimeModifiers.forgeLimitDelta) || 0,
    );
    if (!Array.isArray(rm.blessingRuntimeModifiers.terrainCombatBonuses)) {
      rm.blessingRuntimeModifiers.terrainCombatBonuses = [];
    }
    rm.blessingRuntimeModifiers.healingEffectivenessMultiplier = Number.isFinite(
      rm.blessingRuntimeModifiers.healingEffectivenessMultiplier,
    )
      ? rm.blessingRuntimeModifiers.healingEffectivenessMultiplier
      : 1;
    rm.blessingRuntimeModifiers.weaponArtHpCostDelta = Math.trunc(
      Number(rm.blessingRuntimeModifiers.weaponArtHpCostDelta) || 0,
    );
    rm.runSeed = Number.isFinite(saved.runSeed) ? Number(saved.runSeed) : null;
    rm.rngSeed = Number.isFinite(saved.rngSeed)
      ? Number(saved.rngSeed) >>> 0
      : Number.isFinite(rm.runSeed)
        ? Number(rm.runSeed) >>> 0
        : null;
    rm.activeBlessings = rm._normalizeActiveBlessingsForLoad(rawActiveBlessings);
    const defaultVisionCharges = rm.getBaseVisionCharges();
    rm.visionChargesRemaining = Number.isFinite(saved.visionChargesRemaining)
      ? Math.max(0, Math.trunc(saved.visionChargesRemaining))
      : defaultVisionCharges;
    rm.visionCount = Number.isFinite(saved.visionCount)
      ? Math.max(0, Math.trunc(saved.visionCount))
      : 0;
    rm.usedRecruitNames = saved.usedRecruitNames || {};
    rm._repairDuplicateRosterNames();
    rm.battleConfigsByNodeId = saved.battleConfigsByNodeId || {};
    rm.shopStateByNodeId = saved.shopStateByNodeId || {};
    rm.applyDifficultySelection(saved.difficultyId || 'normal');
    if (saved.difficultyModifiers && typeof saved.difficultyModifiers === 'object') {
      rm.difficultyModifiers = {
        ...DIFFICULTY_DEFAULTS,
        ...saved.difficultyModifiers,
        actsIncluded: sanitizeActSequence(
          Array.isArray(saved.difficultyModifiers.actsIncluded)
            ? saved.difficultyModifiers.actsIncluded
            : rm.difficultyModifiers.actsIncluded,
          rm.difficultyModifiers.actsIncluded,
        ),
      };
    }
    const hasSavedActSequence = Array.isArray(saved.actSequence) && saved.actSequence.length > 0;
    const hasSavedActsIncluded =
      Array.isArray(saved?.difficultyModifiers?.actsIncluded) &&
      saved.difficultyModifiers.actsIncluded.length > 0;
    const legacySafeFallback =
      hasSavedActSequence || hasSavedActsIncluded
        ? rm.difficultyModifiers?.actsIncluded || ACT_SEQUENCE
        : DIFFICULTY_DEFAULTS.actsIncluded;
    const sequenceSource = hasSavedActSequence
      ? saved.actSequence
      : hasSavedActsIncluded
        ? saved.difficultyModifiers.actsIncluded
        : legacySafeFallback;
    rm.actSequence = sanitizeActSequence(sequenceSource, legacySafeFallback);
    // Migrate stale Lunatic saves that are missing act4
    if (
      saved.difficultyId === 'lunatic' &&
      !rm.actSequence.includes('act4') &&
      gameData?.difficulty
    ) {
      const currentActId = rm.actSequence[rm.actIndex];
      const canonical = sanitizeActSequence(
        resolveDifficultyMode(gameData.difficulty, 'lunatic').modifiers.actsIncluded,
        ACT_SEQUENCE,
      );
      if (canonical.includes('act4')) {
        rm.actSequence = canonical;
        rm.difficultyModifiers = { ...rm.difficultyModifiers, actsIncluded: [...canonical] };
        const newIndex = canonical.indexOf(currentActId);
        if (newIndex >= 0) rm.actIndex = newIndex;
      }
    }
    if (rm.actIndex >= rm.actSequence.length) {
      rm.actIndex = Math.max(0, rm.actSequence.length - 1);
    }
    rm.pendingAmbushNodeId =
      typeof saved.pendingAmbushNodeId === 'string' ? saved.pendingAmbushNodeId : null;
    rm.endRunRewards = saved.endRunRewards || null;
    rm.metaUnlockedWeaponArts = Array.isArray(saved.metaUnlockedWeaponArts)
      ? rm._normalizeUnlockedWeaponArtIds(saved.metaUnlockedWeaponArts)
      : [];
    rm.actUnlockedWeaponArts = Array.isArray(saved.actUnlockedWeaponArts)
      ? rm._normalizeUnlockedWeaponArtIds(saved.actUnlockedWeaponArts)
      : [];
    if (!Array.isArray(saved.actUnlockedWeaponArts) && Array.isArray(saved.unlockedWeaponArts)) {
      rm.actUnlockedWeaponArts = rm._normalizeUnlockedWeaponArtIds(saved.unlockedWeaponArts);
    }
    rm.shownDialogueKeys = Array.isArray(saved.shownDialogueKeys)
      ? [...new Set(saved.shownDialogueKeys.filter((key) => typeof key === 'string' && key))]
      : [];
    const rawTracker = saved.churchPromotionTracker;
    rm._churchPromotionTracker =
      rawTracker && typeof rawTracker.nodeId === 'string' && Number.isFinite(rawTracker.count)
        ? { nodeId: rawTracker.nodeId, count: Math.max(0, Math.trunc(rawTracker.count)) }
        : null;
    rm.noMetaMode = saved.noMetaMode === true;
    // Legacy saves without thirdLordJoined that are past battle 3
    // default to true (already resolved) to prevent unexpected triggers
    rm.thirdLordJoined =
      saved.thirdLordJoined === true ||
      (saved.thirdLordJoined === undefined && Number(saved.completedBattles || 0) >= 3);
    rm.thirdLordRerolled = saved.thirdLordRerolled === true;
    if (!Array.isArray(saved.shownDialogueKeys)) {
      const isInProgress = Boolean(
        saved.currentNodeId ||
        Number(saved.completedBattles || 0) > 0 ||
        Number(saved.actIndex || 0) > 0 ||
        (typeof saved.status === 'string' && saved.status !== 'active'),
      );
      if (isInProgress) rm.markDialogueShown('runStart');
    }
    rm._syncMetaWeaponArtUnlocks();
    rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = rm.actSequence.includes(
      rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct,
    )
      ? rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct
      : null;
    rm._runStartBlessingsApplied = true;
    if (rm.nodeMap?.nodes && rm.battleConfigsByNodeId) {
      for (const node of rm.nodeMap.nodes) {
        if (rm.battleConfigsByNodeId[node.id]) node.encounterLocked = true;
      }
    }

    // Migrate old save format BEFORE relinking weapons
    // (migration may remove Consumables/Scrolls from inventory that relinkWeapon could pick as fallback)
    RunManager.migrateInventorySplit(rm);
    RunManager.migrateSkillIds(rm);
    RunManager.migrateClassInnateSkills(rm);
    // Normalize stale tier/proficiency/move state before class-learnable migration;
    // promoted learnables depend on unit.tier.
    RunManager.migrateUnitClassState(rm);
    RunManager.migrateWeaponArtItemState(rm);
    RunManager.migrateClassLearnableSkills(rm);

    rm.roster.forEach((u) => relinkWeapon(u));
    rm.fallenUnits.forEach((u) => relinkWeapon(u));
    rm._restoreDisabledPersonalSkillsIfReady('load');
    rm._suppressPersonalSkillsForCurrentRosterIfNeeded();
    rm._syncActWeaponArtUnlocksForCurrentAct();

    return rm;
  }
}

/** Resolve the storage key for a slot. Requires explicit slotNumber in production. */
function resolveRunKey(slotNumber) {
  if (!slotNumber) {
    console.warn('[RunManager] resolveRunKey called without slotNumber');
    return 'emblem_rogue_run_save';
  }
  return getRunKey(slotNumber);
}

function isQuotaExceededError(err) {
  if (err?.name === 'QuotaExceededError') return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.code === 22)
    return true;
  if (typeof err?.message === 'string' && /quota/i.test(err.message)) return true;
  return false;
}

export function saveRun(runManager, onSave, slotNumber) {
  const json = {
    ...runManager.toJSON(),
    savedAt: Date.now(),
  };
  const key = resolveRunKey(slotNumber);
  let localOk = false;
  try {
    localStorage.setItem(key, JSON.stringify(json));
    localOk = true;
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    console.warn('[RunManager] localStorage write failed:', err?.message || err);
    return { ok: false, reason: isQuota ? 'quota' : 'write_error', isQuotaError: isQuota };
  }

  if (localOk && onSave) {
    try {
      onSave(json);
    } catch (err) {
      console.warn('[RunManager] onSave callback error:', err?.message || err);
    }
  }

  return { ok: true };
}

export function loadRun(gameData, slotNumber) {
  const key = resolveRunKey(slotNumber);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return RunManager.fromJSON(saved, gameData);
  } catch (err) {
    console.error(
      `[RunManager] loadRun failed for slot ${slotNumber ?? '(legacy)'}:`,
      err?.message || err,
    );
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
  } catch (_) {
    /* ignore */
  }
  if (onClear) onClear();
}
