// LootSystem.js — Pure functions: gold calculation, loot generation, shop inventory
// No Phaser deps.

import {
  GOLD_PER_KILL_BASE, GOLD_PER_LEVEL_BONUS, GOLD_BATTLE_BONUS, GOLD_BOSS_BONUS,
  GOLD_SKIP_LOOT_MULTIPLIER, SHOP_SELL_RATIO, LOOT_CHOICES, SHOP_ITEM_COUNT,
  NODE_GOLD_MULTIPLIER, LOOT_GOLD_TEAM_XP,
} from '../utils/constants.js';

const META_INNATE_TIERS = new Set(['Iron', 'Steel']);
const META_INNATE_WEAPON_TYPES = new Set(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light']);

/**
 * Calculate gold earned from killing an enemy.
 * @param {{ level: number, isBoss?: boolean }} enemy
 * @returns {number}
 */
export function calculateKillGold(enemy) {
  let gold = GOLD_PER_KILL_BASE + (enemy.level * GOLD_PER_LEVEL_BONUS);
  if (enemy.isBoss) gold += GOLD_BOSS_BONUS;
  return gold;
}

/**
 * Calculate total battle gold (sum of kill gold + completion bonus).
 * @param {number} killGold - accumulated gold from individual kills
 * @param {string} [nodeType] - node type for gold multiplier (battle/recruit/boss)
 * @returns {number}
 */
export function calculateBattleGold(killGold, nodeType) {
  const multiplier = (nodeType && NODE_GOLD_MULTIPLIER[nodeType]) || 1.0;
  return Math.floor(killGold * multiplier) + GOLD_BATTLE_BONUS;
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
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [category, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return category;
  }
  return entries[entries.length - 1][0];
}

/**
 * Look up an item by name from weapons, consumables, accessories, or whetstones arrays.
 * @returns {{ ...itemData }} a copy of the item data, or null
 */
function findItem(name, allWeapons, consumables, allAccessories, allWhetstones) {
  const weapon = allWeapons.find(w => w.name === name);
  if (weapon) return { ...weapon };
  const consumable = consumables.find(c => c.name === name);
  if (consumable) return { ...consumable };
  if (allAccessories) {
    const accessory = allAccessories.find(a => a.name === name);
    if (accessory) return { ...accessory };
  }
  if (allWhetstones) {
    const whetstone = allWhetstones.find(w => w.name === name);
    if (whetstone) return { ...whetstone };
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
function filterByRosterTypes(names, rosterTypes, allWeapons) {
  return names.filter(name => {
    const wpn = allWeapons.find(w => w.name === name);
    if (!wpn) return true; // not a weapon → keep
    if (!['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff'].includes(wpn.type)) {
      return true; // non-combat entries (e.g. scrolls) pass through
    }
    return rosterTypes.has(wpn.type);
  });
}

function buildMetaInnateArtByWeaponType(weaponArtSpawnConfig) {
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
      .filter(Boolean)
  );
  if (unlockedSet.size <= 0) return null;

  const byType = new Map();
  for (const art of catalog) {
    if (!art?.id || !unlockedSet.has(art.id)) continue;
    const weaponType = typeof art.weaponType === 'string' ? art.weaponType.trim() : '';
    if (!META_INNATE_WEAPON_TYPES.has(weaponType)) continue;
    if (Array.isArray(art.legendaryWeaponIds) && art.legendaryWeaponIds.length > 0) continue;
    if (Array.isArray(art.allowedFactions) && art.allowedFactions.length > 0) {
      const factions = new Set(art.allowedFactions.map((f) => String(f).toLowerCase()));
      if (!factions.has('player')) continue;
    }
    if (!byType.has(weaponType)) byType.set(weaponType, art.id);
  }
  return byType.size > 0 ? byType : null;
}

function applyMetaInnateArtToItem(item, artByWeaponType) {
  if (!item || !artByWeaponType) return item;
  if (!META_INNATE_WEAPON_TYPES.has(item.type)) return item;
  if (!META_INNATE_TIERS.has(item.tier)) return item;
  if (typeof item.weaponArtId === 'string' && item.weaponArtId.trim().length > 0) return item;
  const artId = artByWeaponType.get(item.type);
  if (!artId) return item;
  item.weaponArtId = artId;
  item.weaponArtSource = 'meta_innate';
  return item;
}

// --- Random Legendary Weapon ---

const LEGENDARY_NAMES = [
  'Zenith', 'Tempest', 'Eclipse', 'Solstice', 'Exodus',
  'Apex', 'Nemesis', 'Harbinger', 'Radiance', 'Terminus',
];

const SILVER_BASES = {
  Sword:  'Silver Sword',
  Lance:  'Silver Lance',
  Axe:    'Silver Axe',
  Bow:    'Silver Bow',
  Tome:   'Bolganone',
  Light:  'Aura',
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
  const base = allWeapons.find(w => w.name === baseName);
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
    const statPool = (type === 'Tome' || type === 'Light') ? magStats : physStats;
    const stat = statPool[Math.floor(Math.random() * statPool.length)];
    const value = 2 + Math.floor(Math.random() * 4); // 2-5
    weapon.special = `+${value} ${stat} when equipped`;
  } else if (bonusType === 1) {
    // Ability: Brave, Drain, or 1-2 range (melee only)
    const isMelee = weapon.range === '1';
    const abilities = isMelee
      ? ['brave', 'drain', 'throwable']
      : ['brave', 'drain'];
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
    const skillNames = { sol: 'Sol', luna: 'Luna', vantage: 'Vantage', wrath: 'Wrath', adept: 'Adept' };
    weapon.special = `Grants ${skillNames[skillId]} to wielder`;
    weapon._grantedSkill = skillId;
  }

  return weapon;
}

/**
 * Generate N loot choices from act's loot table.
 * Each choice: { type: 'weapon'|'consumable'|'rare'|'gold'|'accessory'|'forge', item?, goldAmount? }
 * @param {string} actId
 * @param {object} lootTables - keyed by act
 * @param {Array} allWeapons - weapons.json array
 * @param {Array} consumables - consumables.json array
 * @param {number} count
 * @param {number} lootWeaponWeightBonus
 * @param {Array} [allAccessories] - accessories.json array
 * @param {Array} [allWhetstones] - whetstones.json array
 * @param {Array} [roster] - current roster for weapon type filtering
 * @param {boolean} [isBoss=false] - shift weights toward rare/accessory/forge for boss battles
 * @returns {Array}
 */
export function generateLootChoices(actId, lootTables, allWeapons, consumables, count = LOOT_CHOICES, lootWeaponWeightBonus = 0, allAccessories = null, allWhetstones = null, roster = null, isBoss = false, randomLegendary = null, isElite = false, weaponArtSpawnConfig = null) {
  const table = lootTables[actId] || lootTables.act3;
  const choices = [];
  const usedNames = new Set();
  const maxAttempts = count * 5;
  let attempts = 0;
  const metaInnateArtByWeaponType = buildMetaInnateArtByWeaponType(weaponArtSpawnConfig);

  // Apply weapon weight bonus from meta upgrades
  const weights = { ...table.weights };
  if (lootWeaponWeightBonus > 0 && weights.weapon !== undefined) {
    weights.weapon += lootWeaponWeightBonus;
  }

  // Boss loot: shift weights toward rare/accessory/forge
  if (isBoss) {
    if (weights.rare !== undefined || (table.rare && table.rare.length > 0)) {
      weights.rare = (weights.rare || 0) + 10;
    }
    if (weights.accessory !== undefined) weights.accessory += 5;
    if (weights.forge !== undefined) weights.forge += 5;
    if (weights.weapon !== undefined) weights.weapon = Math.max(0, weights.weapon - 10);
    if (weights.consumable !== undefined) weights.consumable = Math.max(0, weights.consumable - 10);
  } else if (isElite) {
    // Elite loot: half-boss shifts (lighter but still meaningful)
    if (weights.rare !== undefined || (table.rare && table.rare.length > 0)) {
      weights.rare = (weights.rare || 0) + 5;
    }
    if (weights.accessory !== undefined) weights.accessory += 3;
    if (weights.forge !== undefined) weights.forge += 3;
    if (weights.weapon !== undefined) weights.weapon = Math.max(0, weights.weapon - 5);
    if (weights.consumable !== undefined) weights.consumable = Math.max(0, weights.consumable - 5);
  }

  // Roster weapon type filter
  const rosterTypes = roster ? getRosterWeaponTypes(roster) : null;

  while (choices.length < count && attempts < maxAttempts) {
    attempts++;
    const category = weightedRandom(weights);

    if (category === 'gold') {
      if (choices.some(c => c.type === 'gold')) continue;
      let [min, max] = table.goldRange;
      if (isBoss) { min = Math.floor(min * 1.5); max = Math.floor(max * 1.5); }
      else if (isElite) { min = Math.floor(min * 1.25); max = Math.floor(max * 1.25); }
      const goldAmount = min + Math.floor(Math.random() * (max - min + 1));
      const xpAmount = (LOOT_GOLD_TEAM_XP[actId] || LOOT_GOLD_TEAM_XP.act3) || 0;
      choices.push({ type: 'gold', goldAmount, xpAmount });
      continue;
    }

    const POOL_MAP = { rare: 'rare', weapon: 'weapons', consumable: 'consumables', accessory: 'accessories', forge: 'forge' };
    let pool = table[POOL_MAP[category]];
    if (!pool || pool.length === 0) continue;

    // Inject random legendary into rare pool for act3+
    if (category === 'rare' && randomLegendary && (actId === 'act3' || actId === 'finalBoss')) {
      pool = [...pool, randomLegendary.name];
    }

    // Filter weapon-type pools by roster proficiencies
    if (rosterTypes && (category === 'weapon' || category === 'rare')) {
      pool = filterByRosterTypes(pool, rosterTypes, allWeapons);
      if (pool.length === 0) continue;
    }

    const name = pool[Math.floor(Math.random() * pool.length)];
    if (usedNames.has(name)) continue;

    // Random legendary is not in allWeapons — use the object directly
    let item;
    if (randomLegendary && name === randomLegendary.name) {
      item = structuredClone(randomLegendary);
    } else {
      item = findItem(name, allWeapons, consumables, allAccessories, allWhetstones);
    }
    if (!item) continue;
    applyMetaInnateArtToItem(item, metaInnateArtByWeaponType);

    usedNames.add(name);
    choices.push({ type: category, item });
  }

  // Fill remaining slots with gold if item pools were exhausted
  while (choices.length < count) {
    const [min, max] = table.goldRange;
    const goldAmount = min + Math.floor(Math.random() * (max - min + 1));
    const xpAmount = (LOOT_GOLD_TEAM_XP[actId] || LOOT_GOLD_TEAM_XP.act3) || 0;
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
 * @returns {Array<{ item: object, price: number, type: string }>}
 */
export function generateShopInventory(actId, lootTables, allWeapons, consumables, allAccessories = null, roster = null, weaponArtSpawnConfig = null) {
  const table = lootTables[actId] || lootTables.act3;
  const itemCount = SHOP_ITEM_COUNT.min + Math.floor(Math.random() * (SHOP_ITEM_COUNT.max - SHOP_ITEM_COUNT.min + 1));
  const metaInnateArtByWeaponType = buildMetaInnateArtByWeaponType(weaponArtSpawnConfig);

  const inventory = [];
  const usedNames = new Set();
  const shopEntryTypeForItem = (item) => {
    if (!item) return 'weapon';
    if (item.type === 'Consumable') return 'consumable';
    if (item.type === 'Accessory') return 'accessory';
    if (item.type === 'Scroll') return 'scroll';
    return 'weapon';
  };

  // Roster weapon type filter
  const rosterTypes = roster ? getRosterWeaponTypes(roster) : null;
  const filteredWeapons = rosterTypes
    ? filterByRosterTypes(table.weapons, rosterTypes, allWeapons)
    : table.weapons;

  // Guarantee at least 1 weapon (from filtered pool)
  if (filteredWeapons.length > 0) {
    const name = filteredWeapons[Math.floor(Math.random() * filteredWeapons.length)];
    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (item && item.price > 0) {
      applyMetaInnateArtToItem(item, metaInnateArtByWeaponType);
      usedNames.add(name);
      inventory.push({ item, price: item.price, type: shopEntryTypeForItem(item) });
    }
  }

  // Filter stat boosters out of shop consumables (loot-only items)
  const shopConsumables = table.consumables.filter(name => {
    const c = consumables.find(x => x.name === name);
    return !c || c.effect !== 'statBoost';
  });

  // Guarantee at least 1 consumable
  if (shopConsumables.length > 0) {
    const name = shopConsumables[Math.floor(Math.random() * shopConsumables.length)];
    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (item) {
      applyMetaInnateArtToItem(item, metaInnateArtByWeaponType);
      usedNames.add(name);
      inventory.push({ item, price: item.price, type: 'consumable' });
    }
  }

  // Pin Vulnerary and Elixir in every shop
  const guaranteedConsumables = ['Vulnerary', 'Elixir'];
  for (const name of guaranteedConsumables) {
    if (usedNames.has(name)) continue; // Already picked randomly
    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (item && item.price > 0 && inventory.length < itemCount) {
      applyMetaInnateArtToItem(item, metaInnateArtByWeaponType);
      usedNames.add(name);
      inventory.push({ item, price: item.price, type: 'consumable' });
    }
  }

  // Fill remaining slots from combined filtered weapon + consumable + accessory pools
  const accessoryPool = table.accessories || [];
  const combinedPool = [...filteredWeapons, ...shopConsumables, ...accessoryPool];
  const maxAttempts = itemCount * 5;
  let attempts = 0;

  while (inventory.length < itemCount && attempts < maxAttempts) {
    attempts++;
    const name = combinedPool[Math.floor(Math.random() * combinedPool.length)];
    if (usedNames.has(name)) continue;

    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (!item || item.price === 0) continue;
    applyMetaInnateArtToItem(item, metaInnateArtByWeaponType);

    usedNames.add(name);
    inventory.push({ item, price: item.price, type: shopEntryTypeForItem(item) });
  }

  return inventory;
}
