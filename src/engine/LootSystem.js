// LootSystem.js â€” Pure functions: gold calculation, loot generation, shop inventory
// No Phaser deps.

import {
  GOLD_PER_KILL_BASE,
  GOLD_PER_LEVEL_BONUS,
  GOLD_BATTLE_BONUS,
  GOLD_BOSS_BONUS,
  GOLD_PER_KILL_SOFT_CAP,
  GOLD_PER_KILL_EXCESS_RATE,
  GOLD_PROMOTED_BONUS_START_LEVEL,
  GOLD_PROMOTED_BONUS_PER_LEVEL,
  GOLD_PROMOTED_BONUS_MAX,
  GOLD_SKIP_LOOT_MULTIPLIER,
  SHOP_SELL_RATIO,
  LOOT_CHOICES,
  SHOP_ITEM_COUNT,
  NODE_GOLD_MULTIPLIER,
  LOOT_GOLD_TEAM_XP,
  GOLD_BATTLE_REWARD_MULTIPLIER,
  GOLD_LOOT_REWARD_MULTIPLIER,
} from '../utils/constants.js';
import { ensureItemUid } from '../utils/itemUid.js';
import { getWeaponArtAllowedTypes } from './WeaponArtSystem.js';

const META_INNATE_TIERS = new Set(['Iron', 'Steel', 'Silver']);
const META_INNATE_WEAPON_TYPES = new Set(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light']);
const LOOT_WEAPON_TIER_UPGRADE_ORDER = ['Iron', 'Steel', 'Silver', 'Legend'];
const LOOT_WEAPON_TIER_INDEX = new Map(
  LOOT_WEAPON_TIER_UPGRADE_ORDER.map((tier, idx) => [tier, idx]),
);

/**
 * Weapon quality progression tuning (chained per-tier chance).
 * Bonus is interpreted as: chance per upgrade step to jump one tier up.
 *
 * Lv1 = 10%:
 * - Iron -> 90.00% Iron, 9.00% Steel, 0.90% Silver, 0.09% Legend
 * - Steel -> 90.00% Steel, 9.00% Silver, 0.90% Legend
 * - Silver -> 90.00% Silver, 10.00% Legend
 *
 * Lv2 = 20%:
 * - Iron -> 80.00% Iron, 18.00% Steel, 1.80% Silver, 0.80% Legend
 * - Steel -> 80.00% Steel, 16.00% Silver, 4.00% Legend
 * - Silver -> 80.00% Silver, 20.00% Legend
 */

/**
 * Calculate gold earned from killing an enemy.
 * @param {{ level: number, tier?: string, isBoss?: boolean }} enemy
 * @returns {number}
 */
export function calculateKillGold(enemy) {
  const level = Math.max(1, Math.trunc(Number(enemy?.level) || 1));
  const baseRaw = GOLD_PER_KILL_BASE + level * GOLD_PER_LEVEL_BONUS;
  const baseSoft =
    baseRaw <= GOLD_PER_KILL_SOFT_CAP
      ? baseRaw
      : GOLD_PER_KILL_SOFT_CAP +
        Math.floor((baseRaw - GOLD_PER_KILL_SOFT_CAP) * GOLD_PER_KILL_EXCESS_RATE);
  const promotedBonus =
    enemy?.tier === 'promoted'
      ? Math.min(
          GOLD_PROMOTED_BONUS_MAX,
          Math.max(0, level - GOLD_PROMOTED_BONUS_START_LEVEL) * GOLD_PROMOTED_BONUS_PER_LEVEL,
        )
      : 0;
  return baseSoft + promotedBonus + (enemy?.isBoss ? GOLD_BOSS_BONUS : 0);
}

/**
 * Calculate attributed kill reward, including flat accessory bounty bonus.
 * @param {{ faction?: string, level: number, isBoss?: boolean }} enemy
 * @param {{ accessory?: { combatEffects?: object } } | null} killer
 * @param {{ rewardMultiplier?: number, pressureGoldMultiplier?: number }} [options]
 * @returns {number}
 */
export function calculateKillReward(enemy, killer = null, options = {}) {
  if (!enemy || enemy.faction !== 'enemy') return 0;
  const rewardMultiplier = Number.isFinite(Number(options.rewardMultiplier))
    ? Math.max(0, Number(options.rewardMultiplier))
    : 1;
  const pressureGoldMultiplier = Number.isFinite(Number(options.pressureGoldMultiplier))
    ? Math.max(0, Number(options.pressureGoldMultiplier))
    : 1;
  const adjustedGold = Math.max(
    0,
    Math.floor(calculateKillGold(enemy) * rewardMultiplier * pressureGoldMultiplier),
  );

  const combatEffects = killer?.accessory?.combatEffects || null;
  const bountyRaw = Number.isFinite(Number(combatEffects?.goldPerKill))
    ? Number(combatEffects.goldPerKill)
    : Number(combatEffects?.bountyGoldOnKill);
  const bountyBonus = Math.max(0, Math.trunc(bountyRaw || 0));
  return adjustedGold + bountyBonus;
}

/**
 * Calculate total battle gold (sum of kill gold + completion bonus).
 * @param {number} killGold - accumulated gold from individual kills
 * @param {string} [nodeType] - node type for gold multiplier (battle/recruit/boss)
 * @param {number} [completionGoldOverride] - override default completion bonus (used by late-pressure system)
 * @returns {number}
 */
export function calculateBattleGold(killGold, nodeType, completionGoldOverride) {
  const multiplier = (nodeType && NODE_GOLD_MULTIPLIER[nodeType]) || 1.0;
  const completionGold = Number.isFinite(completionGoldOverride)
    ? completionGoldOverride
    : GOLD_BATTLE_BONUS;
  return Math.floor(
    (Math.floor(killGold * multiplier) + completionGold) * GOLD_BATTLE_REWARD_MULTIPLIER,
  );
}

/**
 * Calculate bonus gold for skipping loot selection.
 * @param {number} battleGold - total battle gold (from calculateBattleGold)
 * @returns {number}
 */
export function calculateSkipLootBonus(battleGold) {
  return Math.floor(battleGold * (GOLD_SKIP_LOOT_MULTIPLIER - 1));
}

/**
 * Calculate sell price for an item.
 * @param {{ price?: number }} item
 * @returns {number}
 */
export function getSellPrice(item) {
  return Math.floor((item.price || 0) * SHOP_SELL_RATIO);
}

/**
 * Pick a weighted random category from a weights object.
 * @param {{ [category: string]: number }} weights - e.g. { weapon: 55, consumable: 35, gold: 10 }
 * @returns {string} chosen category
 */
function weightedRandom(weights) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [category, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return category;
  }
  return entries[entries.length - 1]?.[0] || null;
}

function normalizeLootArray(value) {
  return Array.isArray(value) ? value : [];
}

function isCombatWeaponType(type) {
  return ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff', 'Breath'].includes(type);
}

/**
 * Look up an item by name from weapons, consumables, accessories, or whetstones arrays.
 * @returns {{ ...itemData }} a copy of the item data, or null
 */
function findItem(name, allWeapons, consumables, allAccessories, allWhetstones) {
  const weapon = allWeapons.find((w) => w.name === name);
  if (weapon) return ensureItemUid({ ...weapon });
  const consumable = consumables.find((c) => c.name === name);
  if (consumable) return ensureItemUid({ ...consumable });
  if (allAccessories) {
    const accessory = allAccessories.find((a) => a.name === name);
    if (accessory) return ensureItemUid({ ...accessory });
  }
  if (allWhetstones) {
    const whetstone = allWhetstones.find((w) => w.name === name);
    if (whetstone) return ensureItemUid({ ...whetstone });
  }
  return null;
}

/**
 * Collect the set of weapon types the roster can equip.
 * @param {Array} roster - array of unit objects with proficiencies
 * @returns {Set<string>} e.g. Set('Sword', 'Lance', 'Axe')
 */
function getRosterWeaponTypes(roster) {
  const types = new Set();
  for (const unit of roster) {
    if (unit.proficiencies) {
      for (const prof of unit.proficiencies) {
        types.add(prof.type);
      }
    }
  }
  return types;
}

/**
 * Filter a list of weapon names to only those whose type matches roster proficiencies.
 * Non-weapon items (consumables, scrolls, accessories, whetstones) pass through.
 * @param {string[]} names - item names from loot/shop pool
 * @param {Set<string>} rosterTypes - weapon types the roster can equip
 * @param {Array} allWeapons - weapons.json array
 * @returns {string[]}
 */
function filterByRosterTypes(names, rosterTypes, allWeapons, categoriesToFilter = null) {
  const filterSet = Array.isArray(categoriesToFilter) ? new Set(categoriesToFilter) : null;
  return names.filter((name) => {
    const item = allWeapons.find((w) => w.name === name);
    if (!item) return true;
    if (filterSet && !filterSet.has(item.type)) return true;
    if (!isCombatWeaponType(item.type)) {
      if (
        item.type === 'Scroll' &&
        Array.isArray(item.allowedWeaponTypes) &&
        item.allowedWeaponTypes.length > 0
      ) {
        return item.allowedWeaponTypes.some((type) => rosterTypes.has(type));
      }
      return true;
    }
    return rosterTypes.has(item.type);
  });
}
function normalizeSpawnTier(value) {
  const tier = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (tier === 'iron') return 'Iron';
  if (tier === 'steel') return 'Steel';
  if (tier === 'silver') return 'Silver';
  return null;
}

function buildWeaponUpgradePools(allWeapons, rosterTypes = null) {
  const poolsByType = new Map();
  for (const weapon of allWeapons) {
    const name = typeof weapon?.name === 'string' ? weapon.name : null;
    const type = typeof weapon?.type === 'string' ? weapon.type : null;
    const tier = typeof weapon?.tier === 'string' ? weapon.tier : null;
    if (!name || !type || !LOOT_WEAPON_TIER_INDEX.has(tier)) continue;
    if (rosterTypes && !rosterTypes.has(type)) continue;

    if (!poolsByType.has(type)) poolsByType.set(type, new Map());
    const typeBuckets = poolsByType.get(type);
    const bucket = typeBuckets.get(tier) || [];
    bucket.push(name);
    typeBuckets.set(tier, bucket);
  }
  return poolsByType;
}

function boostWeaponQuality(baseWeapon, allWeapons, qualityBonusPercent, bonusPoolsByType) {
  if (!baseWeapon || qualityBonusPercent <= 0) return baseWeapon;

  const baseType = typeof baseWeapon.type === 'string' ? baseWeapon.type : null;
  const baseTierIndex = LOOT_WEAPON_TIER_INDEX.get(baseWeapon.tier);
  if (!baseType || baseTierIndex === undefined) return baseWeapon;

  const typeBuckets = bonusPoolsByType.get(baseType);
  if (!typeBuckets) return baseWeapon;

  const bonus = Number(qualityBonusPercent) || 0;
  let currentWeapon = baseWeapon;
  let currentTierIndex = baseTierIndex;

  while (currentTierIndex < LOOT_WEAPON_TIER_UPGRADE_ORDER.length - 1) {
    const nextTier = LOOT_WEAPON_TIER_UPGRADE_ORDER[currentTierIndex + 1];
    const nextPool = typeBuckets.get(nextTier) || [];
    if (nextPool.length === 0) break;
    if (Math.random() * 100 >= bonus) break;

    const nextName = nextPool[Math.floor(Math.random() * nextPool.length)];
    const nextWeapon = allWeapons.find((w) => w.name === nextName);
    if (!nextWeapon) break;

    currentWeapon = nextWeapon;
    currentTierIndex += 1;
    if (currentWeapon.tier === 'Legend') break;
  }

  return currentWeapon;
}

function resolveSpawnTierFromArt(art) {
  const explicitTier = normalizeSpawnTier(art?.spawnTier || art?.tierAffinity);
  if (explicitTier) return explicitTier;
  const unlockAct = typeof art?.unlockAct === 'string' ? art.unlockAct.trim().toLowerCase() : '';
  if (unlockAct === 'act1') return 'Iron';
  if (unlockAct === 'act2') return 'Steel';
  if (unlockAct === 'act3') return 'Silver';
  return null;
}

function isPlayerEligibleSpawnArt(art) {
  if (!art?.id) return false;
  if (art.legacy === true) return false;
  if (Array.isArray(art.legendaryWeaponIds) && art.legendaryWeaponIds.length > 0) return false;
  if (Array.isArray(art.allowedFactions) && art.allowedFactions.length > 0) {
    const factions = new Set(art.allowedFactions.map((f) => String(f).toLowerCase()));
    if (!factions.has('player')) return false;
  }
  if (Array.isArray(art.allowedOwners) && art.allowedOwners.length > 0) {
    const owners = new Set(art.allowedOwners.map((f) => String(f).toLowerCase()));
    if (!owners.has('player') && !owners.has('any')) return false;
  }
  return true;
}

function buildLegacyMetaInnateArtByWeaponType(weaponArtSpawnConfig) {
  const unlockedIds = Array.isArray(weaponArtSpawnConfig?.unlockedWeaponArtIds)
    ? weaponArtSpawnConfig.unlockedWeaponArtIds
    : [];
  const catalog = Array.isArray(weaponArtSpawnConfig?.weaponArtCatalog)
    ? weaponArtSpawnConfig.weaponArtCatalog
    : [];
  if (unlockedIds.length <= 0 || catalog.length <= 0) return null;
  const unlockedSet = new Set(
    unlockedIds
      .filter((id) => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (unlockedSet.size <= 0) return null;

  const byType = new Map();
  for (const art of catalog) {
    if (!art?.id || !unlockedSet.has(art.id)) continue;
    const weaponTypes = getWeaponArtAllowedTypes(art).filter((weaponType) =>
      META_INNATE_WEAPON_TYPES.has(weaponType),
    );
    if (weaponTypes.length <= 0) continue;
    if (!isPlayerEligibleSpawnArt(art)) continue;
    for (const weaponType of weaponTypes) {
      if (!byType.has(weaponType)) byType.set(weaponType, art.id);
    }
  }
  return byType.size > 0 ? byType : null;
}

function buildMetaInnateArtPoolsByTier(weaponArtSpawnConfig) {
  const catalog = Array.isArray(weaponArtSpawnConfig?.weaponArtCatalog)
    ? weaponArtSpawnConfig.weaponArtCatalog
    : [];
  if (catalog.length <= 0) return null;

  const enabledTiers = new Set();
  if (weaponArtSpawnConfig?.enableIron || weaponArtSpawnConfig?.ironArms) enabledTiers.add('Iron');
  if (weaponArtSpawnConfig?.enableSteel || weaponArtSpawnConfig?.steelArms)
    enabledTiers.add('Steel');
  if (weaponArtSpawnConfig?.enableSilver || weaponArtSpawnConfig?.silverInnate)
    enabledTiers.add('Silver');
  if (enabledTiers.size <= 0) return null;

  const poolsByTier = new Map();
  for (const art of catalog) {
    if (!isPlayerEligibleSpawnArt(art)) continue;
    const weaponTypes = getWeaponArtAllowedTypes(art).filter((weaponType) =>
      META_INNATE_WEAPON_TYPES.has(weaponType),
    );
    if (weaponTypes.length <= 0) continue;
    const tier = resolveSpawnTierFromArt(art);
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

function buildMetaInnateArtConfig(weaponArtSpawnConfig) {
  const poolsByTier = buildMetaInnateArtPoolsByTier(weaponArtSpawnConfig);
  if (poolsByTier) return { mode: 'tier_pools', value: poolsByTier };
  const legacy = buildLegacyMetaInnateArtByWeaponType(weaponArtSpawnConfig);
  if (legacy) return { mode: 'legacy_map', value: legacy };
  return null;
}

function hasAnyBoundArt(item) {
  if (!item || typeof item !== 'object') return false;
  if (
    Array.isArray(item.weaponArtIds) &&
    item.weaponArtIds.some((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    return true;
  }
  return typeof item.weaponArtId === 'string' && item.weaponArtId.trim().length > 0;
}

function writeMetaInnateArt(item, artId) {
  item.weaponArtIds = [artId];
  item.weaponArtSources = ['meta_innate'];
  item.weaponArtId = artId;
  item.weaponArtSource = 'meta_innate';
}

function applyMetaInnateArtToItem(item, artConfig) {
  if (!item || !artConfig) return item;
  if (!META_INNATE_WEAPON_TYPES.has(item.type)) return item;
  if (!META_INNATE_TIERS.has(item.tier)) return item;
  if (hasAnyBoundArt(item)) return item;

  if (artConfig.mode === 'legacy_map') {
    const artId = artConfig.value.get(item.type);
    if (!artId) return item;
    writeMetaInnateArt(item, artId);
    return item;
  }

  if (artConfig.mode === 'tier_pools') {
    const tierPools = artConfig.value.get(item.tier);
    const pool = tierPools?.get(item.type) || [];
    if (pool.length <= 0) return item;
    const artId = pool[Math.floor(Math.random() * pool.length)];
    if (!artId) return item;
    writeMetaInnateArt(item, artId);
    return item;
  }

  return item;
}

// --- Random Legendary Weapon ---

const LEGENDARY_NAMES = [
  'Zenith',
  'Tempest',
  'Eclipse',
  'Solstice',
  'Exodus',
  'Apex',
  'Nemesis',
  'Harbinger',
  'Radiance',
  'Terminus',
];

const SILVER_BASES = {
  Sword: 'Silver Sword',
  Lance: 'Silver Lance',
  Axe: 'Silver Axe',
  Bow: 'Silver Bow',
  Tome: 'Bolganone',
  Light: 'Aura',
};

const LEGENDARY_SKILL_POOL = ['sol', 'luna', 'vantage', 'wrath', 'adept'];

/**
 * Generate a random legendary weapon for a run.
 * Picks a random name, type, clones the silver base, and applies a random bonus.
 * @param {Array} allWeapons - weapons.json array
 * @returns {object} a unique legendary weapon object
 */
export function generateRandomLegendary(allWeapons) {
  const name = LEGENDARY_NAMES[Math.floor(Math.random() * LEGENDARY_NAMES.length)];
  const types = Object.keys(SILVER_BASES);
  const type = types[Math.floor(Math.random() * types.length)];
  const baseName = SILVER_BASES[type];
  const base = allWeapons.find((w) => w.name === baseName);
  if (!base) return null;

  const weapon = structuredClone(base);
  weapon.name = name;
  weapon.type = type;
  weapon.tier = 'Legend';
  weapon.rankRequired = 'Prof';
  weapon.price = 0;
  weapon.might += 1;
  weapon.hit += 5;
  weapon.weight = Math.max(0, weapon.weight - 1);
  weapon._isRandomLegendary = true;

  // Roll random bonus category (equal chance: stat boost, ability, skill grant)
  const bonusType = Math.floor(Math.random() * 3);

  if (bonusType === 0) {
    // Stat boost: +2 to +5 of a random stat when equipped
    const physStats = ['STR', 'SKL', 'SPD', 'DEF'];
    const magStats = ['MAG', 'SKL', 'SPD', 'RES'];
    const statPool =
      type === 'Tome' || type === 'Light' || type === 'Breath' ? magStats : physStats;
    const stat = statPool[Math.floor(Math.random() * statPool.length)];
    const value = 2 + Math.floor(Math.random() * 4); // 2-5
    weapon.special = `+${value} ${stat} when equipped`;
  } else if (bonusType === 1) {
    // Ability: Brave, Drain, or 1-2 range (melee only)
    const isMelee = weapon.range === '1';
    const abilities = isMelee ? ['brave', 'drain', 'throwable'] : ['brave', 'drain'];
    const ability = abilities[Math.floor(Math.random() * abilities.length)];
    if (ability === 'brave') {
      weapon.special = 'Attacks twice consecutively';
      weapon.might = Math.max(1, weapon.might - 3);
      weapon.weight += 3;
    } else if (ability === 'drain') {
      weapon.special = 'Drains HP equal to damage dealt';
    } else {
      weapon.special = 'Throwable, lower stats';
      weapon.range = '1-2';
      weapon.might = Math.max(1, weapon.might - 2);
      weapon.hit -= 5;
    }
  } else {
    // Skill grant: embed a skill from pool
    const skillId = LEGENDARY_SKILL_POOL[Math.floor(Math.random() * LEGENDARY_SKILL_POOL.length)];
    const skillNames = {
      sol: 'Sol',
      luna: 'Luna',
      vantage: 'Vantage',
      wrath: 'Wrath',
      adept: 'Adept',
    };
    weapon.special = `Grants ${skillNames[skillId]} to wielder`;
    weapon._grantedSkill = skillId;
  }

  return ensureItemUid(weapon);
}

/**
 * Generate N loot choices from act's loot table.
 * Each choice: { type: 'weapon'|'consumable'|'rare'|'gold'|'accessory'|'forge', item?, goldAmount? }
 * @param {string} actId
 * @param {object} lootTables - keyed by act
 * @param {Array} allWeapons - weapons.json array
 * @param {Array} consumables - consumables.json array
 * @param {number} count
 * @param {number} lootWeaponQualityBonus - percent chance per tier upgrade
 * @param {Array} [allAccessories] - accessories.json array
 * @param {Array} [allWhetstones] - whetstones.json array
 * @param {Array} [roster] - current roster for weapon type filtering
 * @param {boolean} [isBoss=false] - shift weights toward rare/accessory/forge for boss battles
 * @returns {Array}
 */
const LOOT_CATEGORY_KEYS = [
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
];
const LOOT_ROSTER_FILTER_CATEGORIES = new Set([
  'weapon',
  'skillScroll',
  'weaponArtScroll',
  'legendaryWeapon',
]);
const LOOT_LEGACY_CONSUMABLE_WEIGHTS = {
  healing: 0.6,
  statBooster: 0.3,
  promotion: 0.1,
};
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
const BOSS_LOOT_WEIGHT_SHIFT = {
  skillScroll: 3,
  weaponArtScroll: 3,
  legendaryWeapon: 4,
  accessory: 5,
  forge: 5,
  weapon: -10,
  healing: -5,
  statBooster: -3,
  promotion: -2,
};
const ELITE_LOOT_WEIGHT_SHIFT = {
  skillScroll: 2,
  weaponArtScroll: 2,
  legendaryWeapon: 1,
  accessory: 3,
  forge: 3,
  weapon: -5,
  healing: -3,
  statBooster: -1,
  promotion: -1,
};

function normalizeLootNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getValidGoldRange(table) {
  const range = Array.isArray(table?.goldRange) ? table.goldRange : [];
  const rawMin = Math.trunc(normalizeLootNumber(range[0]));
  const rawMax = Math.trunc(normalizeLootNumber(range[1]));
  const min = Math.max(0, rawMin);
  const max = Math.max(0, rawMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 0];
  return [Math.min(min, max), Math.max(min, max)];
}

function rollGoldAmountFromRange(min, max) {
  const safeMin = Number.isFinite(min) ? Math.max(0, Math.trunc(min)) : 0;
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : 0;
  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);
  const span = Math.max(0, high - low);
  return Math.floor((low + Math.floor(Math.random() * (span + 1))) * GOLD_LOOT_REWARD_MULTIPLIER);
}

function splitWeightByPoolCounts(totalWeight, categoryPools, fallbackRatios = null) {
  const categories = Object.keys(categoryPools);
  const poolCounts = {};
  let countTotal = 0;

  for (const category of categories) {
    const count = Array.isArray(categoryPools[category]) ? categoryPools[category].length : 0;
    poolCounts[category] = count;
    countTotal += count;
  }

  const result = {};
  const base = normalizeLootNumber(totalWeight);
  if (base <= 0) {
    for (const category of categories) result[category] = 0;
    return result;
  }

  if (countTotal > 0) {
    for (const category of categories) {
      result[category] = base * (poolCounts[category] / countTotal);
    }
    return result;
  }

  const fallbackTotal = fallbackRatios
    ? Object.values(fallbackRatios).reduce((sum, val) => sum + val, 0)
    : 0;
  if (fallbackTotal <= 0) {
    const even = base / Math.max(categories.length, 1);
    for (const category of categories) {
      result[category] = even;
    }
    return result;
  }

  for (const category of categories) {
    result[category] = base * ((fallbackRatios[category] || 0) / fallbackTotal);
  }
  return result;
}

function getConsumableLootCategory(item) {
  if (!item) return null;
  if (item.effect === 'heal' || item.effect === 'healFull') return 'healing';
  if (item.effect === 'cure' || item.effect === 'cureHeal') return 'healing';
  if (item.effect === 'promote') return 'promotion';
  if (item.effect === 'statBoost') return 'statBooster';
  return null;
}

function splitLegacyConsumablesPool(consumablesPool, allWeapons, consumablesCatalog) {
  const split = {
    healing: [],
    statBooster: [],
    promotion: [],
  };

  for (const name of normalizeLootArray(consumablesPool)) {
    const item = findItem(name, allWeapons, consumablesCatalog);
    const category = getConsumableLootCategory(item);
    if (category) split[category].push(name);
  }

  return split;
}

function splitLegacyRarePool(rarePool, allWeapons, consumablesCatalog) {
  const split = {
    skillScroll: [],
    weaponArtScroll: [],
    legendaryWeapon: [],
  };

  for (const name of normalizeLootArray(rarePool)) {
    const item = findItem(name, allWeapons, consumablesCatalog);
    if (!item) continue;
    if (item.type === 'Scroll') {
      const isWeaponArt = !!(
        item.teachesWeaponArtId ||
        (Array.isArray(item.allowedWeaponTypes) && item.allowedWeaponTypes.length > 0)
      );
      if (isWeaponArt) split.weaponArtScroll.push(name);
      else split.skillScroll.push(name);
      continue;
    }
    if (item.tier === 'Legend') {
      split.legendaryWeapon.push(name);
      continue;
    }
    split.skillScroll.push(name);
  }

  return split;
}

function hasSplitLootLayout(table) {
  return (
    Array.isArray(table?.healing) ||
    Array.isArray(table?.statBooster) ||
    Array.isArray(table?.promotion) ||
    Array.isArray(table?.skillScroll) ||
    Array.isArray(table?.weaponArtScroll) ||
    Array.isArray(table?.legendaryWeapon)
  );
}

function buildLootTablesFromAct(lootTable, allWeapons, consumablesCatalog) {
  const table = lootTable || {};
  const weights = table.weights || {};
  const hasSplitLayout = hasSplitLootLayout(table);

  const legacyConsumables = normalizeLootArray(table.consumables);
  const legacyRare = normalizeLootArray(table.rare);
  const legacyConsumablesByCategory = splitLegacyConsumablesPool(
    legacyConsumables,
    allWeapons,
    consumablesCatalog,
  );
  const legacyRareByCategory = splitLegacyRarePool(legacyRare, allWeapons, consumablesCatalog);

  const pools = {
    weapon: normalizeLootArray(table.weapon ?? table.weapons),
    healing: hasSplitLayout
      ? normalizeLootArray(table.healing)
      : legacyConsumablesByCategory.healing,
    statBooster: hasSplitLayout
      ? normalizeLootArray(table.statBooster)
      : legacyConsumablesByCategory.statBooster,
    promotion: hasSplitLayout
      ? normalizeLootArray(table.promotion)
      : legacyConsumablesByCategory.promotion,
    skillScroll: hasSplitLayout
      ? normalizeLootArray(table.skillScroll)
      : legacyRareByCategory.skillScroll,
    weaponArtScroll: hasSplitLayout
      ? normalizeLootArray(table.weaponArtScroll)
      : legacyRareByCategory.weaponArtScroll,
    legendaryWeapon: hasSplitLayout
      ? normalizeLootArray(table.legendaryWeapon)
      : legacyRareByCategory.legendaryWeapon,
    accessory: normalizeLootArray(table.accessory ?? table.accessories),
    forge: normalizeLootArray(table.forge),
    gold: [],
  };

  const resolvedWeights = {};
  for (const key of LOOT_CATEGORY_KEYS) {
    resolvedWeights[key] = normalizeLootNumber(weights[key]);
  }

  if (!hasSplitLayout) {
    const consumableSplit = splitWeightByPoolCounts(
      weights.consumable,
      {
        healing: legacyConsumablesByCategory.healing,
        statBooster: legacyConsumablesByCategory.statBooster,
        promotion: legacyConsumablesByCategory.promotion,
      },
      LOOT_LEGACY_CONSUMABLE_WEIGHTS,
    );

    const rareSplit = splitWeightByPoolCounts(weights.rare, {
      skillScroll: legacyRareByCategory.skillScroll,
      weaponArtScroll: legacyRareByCategory.weaponArtScroll,
      legendaryWeapon: legacyRareByCategory.legendaryWeapon,
    });

    Object.assign(resolvedWeights, consumableSplit, rareSplit);
    resolvedWeights.healing = normalizedLootNumberFromWeights(resolvedWeights.healing);
    resolvedWeights.statBooster = normalizedLootNumberFromWeights(resolvedWeights.statBooster);
    resolvedWeights.promotion = normalizedLootNumberFromWeights(resolvedWeights.promotion);
    resolvedWeights.skillScroll = normalizedLootNumberFromWeights(resolvedWeights.skillScroll);
    resolvedWeights.weaponArtScroll = normalizedLootNumberFromWeights(
      resolvedWeights.weaponArtScroll,
    );
    resolvedWeights.legendaryWeapon = normalizedLootNumberFromWeights(
      resolvedWeights.legendaryWeapon,
    );
  }

  return {
    pools,
    weights: resolvedWeights,
  };
}

function normalizedLootNumberFromWeights(value) {
  return normalizeLootNumber(value);
}

function applyWeightShift(weights, shifts) {
  for (const [category, delta] of Object.entries(shifts)) {
    weights[category] = normalizeLootNumber(weights[category]) + normalizeLootNumber(delta);
    if (weights[category] < 0) weights[category] = 0;
  }
}

function applyMetaWeightBonuses(weights, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return;
  const bonusMap =
    options.lootCategoryWeightBonuses || options.weightBonuses || options.lootWeightBonuses;
  if (!bonusMap || typeof bonusMap !== 'object') return;

  for (const [category, rawDelta] of Object.entries(bonusMap)) {
    if (!LOOT_CATEGORY_WEIGHT_BONUS_KEYS.has(category)) continue;
    weights[category] = normalizeLootNumber(weights[category]) + normalizeLootNumber(rawDelta);
    if (weights[category] < 0) weights[category] = 0;
  }
}

function applyFinalBossWeaponBonus(rollsForCategory, category, actId, randomLegendary, basePool) {
  if (
    category !== 'legendaryWeapon' ||
    (actId !== 'act3' && actId !== 'finalBoss') ||
    !randomLegendary
  ) {
    return basePool;
  }
  return [...basePool, randomLegendary.name];
}

function shopEntryTypeForItem(item) {
  if (!item) return 'weapon';
  if (item.type === 'Consumable') return 'consumable';
  if (item.type === 'Accessory') return 'accessory';
  if (item.type === 'Scroll') return 'scroll';
  return 'weapon';
}

/**
 * Generate N loot choices from act's loot table.
 * Each choice: { type: 'weapon'|'healing'|'statBooster'|'promotion'|'skillScroll'| ... ,'|'gold', item?, goldAmount? }
 * @param {string} actId
 * @param {object} lootTables - keyed by act
 * @param {Array} allWeapons - weapons.json array
 * @param {Array} consumables - consumables.json array
 * @param {number} count
 * @param {number} lootWeaponQualityBonus - percent chance per tier upgrade
 * @param {Array} [allAccessories] - accessories.json array
 * @param {Array} [allWhetstones] - whetstones.json array
 * @param {Array} [roster] - current roster for weapon type filtering
 * @param {boolean} [isBoss=false] - shift weights toward high value drops for boss battles
 * @param {object|null} randomLegendary - prebuilt legendary to inject
 * @param {boolean} [isElite=false] - lighter boss-like shift
 * @param {object|null} weaponArtSpawnConfig - meta-art spawn settings
 * @param {object} [options={}] - optional settings, eg { lootCategoryWeightBonuses: { ... } }
 * @returns {Array}
 */
export function generateLootChoices(
  actId,
  lootTables,
  allWeapons,
  consumables,
  count = LOOT_CHOICES,
  lootWeaponQualityBonus = 0,
  allAccessories = null,
  allWhetstones = null,
  roster = null,
  isBoss = false,
  randomLegendary = null,
  isElite = false,
  weaponArtSpawnConfig = null,
  generateOptions = {},
) {
  const table = lootTables[actId] || lootTables.act3;
  const [baseGoldMin, baseGoldMax] = getValidGoldRange(table);
  const metaInnateArtConfig = buildMetaInnateArtConfig(weaponArtSpawnConfig);
  const qualityBonusPercent = normalizeLootNumber(lootWeaponQualityBonus);
  const { pools, weights } = buildLootTablesFromAct(table, allWeapons, consumables);
  const options = generateOptions || {};

  const adjustedWeights = { ...weights };
  if (options.lootCategoryWeightBonuses || options.weightBonuses) {
    applyMetaWeightBonuses(adjustedWeights, options);
  }

  if (isBoss) {
    applyWeightShift(adjustedWeights, BOSS_LOOT_WEIGHT_SHIFT);
  } else if (isElite) {
    applyWeightShift(adjustedWeights, ELITE_LOOT_WEIGHT_SHIFT);
  }

  const choices = [];
  const usedNames = new Set();
  const maxAttempts = count * 5;
  let attempts = 0;

  const rosterTypes = roster ? getRosterWeaponTypes(roster) : null;
  const qualityPoolsByType = buildWeaponUpgradePools(allWeapons, rosterTypes);

  while (choices.length < count && attempts < maxAttempts) {
    attempts++;
    const category = weightedRandom(adjustedWeights);
    if (!category) break;

    if (category === 'gold') {
      if (choices.some((c) => c.type === 'gold')) continue;
      let min = baseGoldMin;
      let max = baseGoldMax;
      if (isBoss) {
        min = Math.floor(min * 1.5);
        max = Math.floor(max * 1.5);
      } else if (isElite) {
        min = Math.floor(min * 1.25);
        max = Math.floor(max * 1.25);
      }
      const goldAmount = rollGoldAmountFromRange(min, max);
      const xpAmount = LOOT_GOLD_TEAM_XP[actId] || LOOT_GOLD_TEAM_XP.act3 || 0;
      choices.push({ type: 'gold', goldAmount, xpAmount });
      continue;
    }

    let pool = normalizeLootArray(pools[category]);
    if (!pool.length) continue;
    pool = applyFinalBossWeaponBonus(pool, category, actId, randomLegendary, pool);

    if (rosterTypes && LOOT_ROSTER_FILTER_CATEGORIES.has(category)) {
      pool = filterByRosterTypes(pool, rosterTypes, allWeapons);
      if (!pool.length) continue;
    }

    let name = pool[Math.floor(Math.random() * pool.length)];
    if (category === 'weapon' && qualityBonusPercent > 0) {
      const baseWeapon = allWeapons.find(
        (w) => w.name === name && LOOT_WEAPON_TIER_INDEX.has(w.tier),
      );
      const upgradedWeapon = boostWeaponQuality(
        baseWeapon,
        allWeapons,
        qualityBonusPercent,
        qualityPoolsByType,
      );
      if (upgradedWeapon) name = upgradedWeapon.name;
    }
    if (usedNames.has(name)) continue;

    let item;
    if (randomLegendary && name === randomLegendary.name) {
      item = ensureItemUid(structuredClone(randomLegendary));
    } else {
      item = findItem(name, allWeapons, consumables, allAccessories, allWhetstones);
    }
    if (!item) continue;
    applyMetaInnateArtToItem(item, metaInnateArtConfig);

    usedNames.add(name);
    choices.push({ type: category, item });
  }

  while (choices.length < count) {
    const goldAmount = rollGoldAmountFromRange(baseGoldMin, baseGoldMax);
    const xpAmount = LOOT_GOLD_TEAM_XP[actId] || LOOT_GOLD_TEAM_XP.act3 || 0;
    choices.push({ type: 'gold', goldAmount, xpAmount });
  }

  return choices;
}

/**
 * Generate random shop inventory for current act.
 * @param {string} actId
 * @param {object} lootTables
 * @param {Array} allWeapons
 * @param {Array} consumables
 * @param {Array} [allAccessories] - accessories.json array
 * @param {Array} [roster] - current roster for weapon type filtering
 * @param {object|null} weaponArtSpawnConfig - meta-art spawn settings
 * @param {object} [options={}] - future extension for loot effects
 * @returns {Array<{ item: object, price: number, type: string }>}
 */
export function generateShopInventory(
  actId,
  lootTables,
  allWeapons,
  consumables,
  allAccessories = null,
  roster = null,
  weaponArtSpawnConfig = null,
  generateOptions = {},
) {
  const table = lootTables[actId] || lootTables.act3;
  const { pools } = buildLootTablesFromAct(table, allWeapons, consumables);
  const bonusItems = Math.trunc(generateOptions?.itemCountBonus || 0);
  const baseCount =
    SHOP_ITEM_COUNT.min +
    Math.floor(Math.random() * (SHOP_ITEM_COUNT.max - SHOP_ITEM_COUNT.min + 1));
  const itemCount = Math.max(1, baseCount + bonusItems);
  const metaInnateArtConfig = buildMetaInnateArtConfig(weaponArtSpawnConfig);

  const inventory = [];
  const usedNames = new Set();

  const rosterTypes = roster ? getRosterWeaponTypes(roster) : null;
  const filteredWeapons = rosterTypes
    ? filterByRosterTypes(normalizeLootArray(pools.weapon), rosterTypes, allWeapons)
    : normalizeLootArray(pools.weapon);
  const filteredForRoster = (category, pool) => {
    const source = normalizeLootArray(pool);
    if (!rosterTypes || !LOOT_ROSTER_FILTER_CATEGORIES.has(category)) return source;
    return filterByRosterTypes(source, rosterTypes, allWeapons);
  };
  const filteredSkillScrolls = filteredForRoster('skillScroll', pools.skillScroll);
  const filteredWeaponArtScrolls = filteredForRoster('weaponArtScroll', pools.weaponArtScroll);
  const filteredLegendaryWeapons = filteredForRoster('legendaryWeapon', pools.legendaryWeapon);
  const filteredAccessories = normalizeLootArray(pools.accessory);
  const filteredForge = normalizeLootArray(pools.forge);

  const addByName = (name, forcedType = null) => {
    if (usedNames.has(name)) return false;
    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (!item) return false;
    if (item.price <= 0) return false;

    usedNames.add(name);
    const finalItem =
      applyMetaInnateArtToItem(structuredClone(item), metaInnateArtConfig) || structuredClone(item);
    ensureItemUid(finalItem);
    const type = forcedType || shopEntryTypeForItem(finalItem);
    inventory.push({ item: finalItem, price: finalItem.price, type });
    return true;
  };

  // Guarantee at least one weapon.
  if (filteredWeapons.length > 0) {
    const weaponName = filteredWeapons[Math.floor(Math.random() * filteredWeapons.length)];
    addByName(weaponName);
  }

  const shopConsumables = [
    ...normalizeLootArray(pools.healing),
    ...normalizeLootArray(pools.promotion),
  ];

  if (shopConsumables.length > 0) {
    const consumableName = shopConsumables[Math.floor(Math.random() * shopConsumables.length)];
    addByName(consumableName, 'consumable');
  }

  const guaranteedConsumables = ['Vulnerary', 'Elixir'];
  for (const name of guaranteedConsumables) {
    if (usedNames.has(name)) continue;
    const inHealingOrPromotion = [
      ...normalizeLootArray(pools.healing),
      ...normalizeLootArray(pools.promotion),
    ].includes(name);
    if (!inHealingOrPromotion) continue;
    addByName(name, 'consumable');
  }

  const combinedPool = [
    ...filteredWeapons,
    ...shopConsumables,
    ...filteredAccessories,
    ...filteredSkillScrolls,
    ...filteredWeaponArtScrolls,
    ...filteredLegendaryWeapons,
    ...filteredForge,
  ];
  const maxAttempts = itemCount * 5;
  let attempts = 0;

  while (inventory.length < itemCount && attempts < maxAttempts) {
    attempts++;
    if (combinedPool.length === 0) break;
    const name = combinedPool[Math.floor(Math.random() * combinedPool.length)];
    if (usedNames.has(name)) continue;

    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (!item || item.price <= 0) continue;

    usedNames.add(name);
    const finalItem = ensureItemUid(structuredClone(item));
    applyMetaInnateArtToItem(finalItem, metaInnateArtConfig);
    inventory.push({
      item: finalItem,
      price: finalItem.price,
      type: shopEntryTypeForItem(finalItem),
    });
  }

  // Append cure items (Herb + Remedy + Restore staff) if shop cure gating is
  // active for this act, so a gated shop always stocks the full reactive kit.
  const shopCureGating = generateOptions?.shopCureGating;
  if (shopCureGating && shopCureGating[actId]) {
    for (const cureName of ['Herb', 'Remedy', 'Restore']) {
      if (usedNames.has(cureName)) continue;
      const cureItem = findItem(cureName, allWeapons, consumables, allAccessories);
      if (cureItem && cureItem.price > 0) {
        usedNames.add(cureName);
        inventory.push({
          item: ensureItemUid(structuredClone(cureItem)),
          price: cureItem.price,
          type: shopEntryTypeForItem(cureItem),
        });
      }
    }
  }

  return inventory;
}
