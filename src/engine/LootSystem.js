// LootSystem.js — Pure functions: gold calculation, loot generation, shop inventory
// No Phaser deps.

import {
  GOLD_PER_KILL_BASE, GOLD_PER_LEVEL_BONUS, GOLD_BATTLE_BONUS, GOLD_BOSS_BONUS,
  GOLD_SKIP_LOOT_MULTIPLIER, SHOP_SELL_RATIO, LOOT_CHOICES, SHOP_ITEM_COUNT,
  NODE_GOLD_MULTIPLIER,
} from '../utils/constants.js';

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
    return rosterTypes.has(wpn.type);
  });
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
 * @returns {Array}
 */
export function generateLootChoices(actId, lootTables, allWeapons, consumables, count = LOOT_CHOICES, lootWeaponWeightBonus = 0, allAccessories = null, allWhetstones = null, roster = null) {
  const table = lootTables[actId] || lootTables.act3;
  const choices = [];
  const usedNames = new Set();
  const maxAttempts = count * 5;
  let attempts = 0;

  // Apply weapon weight bonus from meta upgrades
  const weights = { ...table.weights };
  if (lootWeaponWeightBonus > 0 && weights.weapon !== undefined) {
    weights.weapon += lootWeaponWeightBonus;
  }

  // Roster weapon type filter
  const rosterTypes = roster ? getRosterWeaponTypes(roster) : null;

  while (choices.length < count && attempts < maxAttempts) {
    attempts++;
    const category = weightedRandom(weights);

    if (category === 'gold') {
      if (choices.some(c => c.type === 'gold')) continue;
      const [min, max] = table.goldRange;
      const goldAmount = min + Math.floor(Math.random() * (max - min + 1));
      choices.push({ type: 'gold', goldAmount });
      continue;
    }

    const POOL_MAP = { rare: 'rare', weapon: 'weapons', consumable: 'consumables', accessory: 'accessories', forge: 'forge' };
    let pool = table[POOL_MAP[category]];
    if (!pool || pool.length === 0) continue;

    // Filter weapon-type pools by roster proficiencies
    if (rosterTypes && (category === 'weapon' || category === 'rare')) {
      pool = filterByRosterTypes(pool, rosterTypes, allWeapons);
      if (pool.length === 0) continue;
    }

    const name = pool[Math.floor(Math.random() * pool.length)];
    if (usedNames.has(name)) continue;

    const item = findItem(name, allWeapons, consumables, allAccessories, allWhetstones);
    if (!item) continue;

    usedNames.add(name);
    choices.push({ type: category, item });
  }

  // Fill remaining slots with gold if item pools were exhausted
  while (choices.length < count) {
    const [min, max] = table.goldRange;
    const goldAmount = min + Math.floor(Math.random() * (max - min + 1));
    choices.push({ type: 'gold', goldAmount });
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
export function generateShopInventory(actId, lootTables, allWeapons, consumables, allAccessories = null, roster = null) {
  const table = lootTables[actId] || lootTables.act3;
  const itemCount = SHOP_ITEM_COUNT.min + Math.floor(Math.random() * (SHOP_ITEM_COUNT.max - SHOP_ITEM_COUNT.min + 1));

  const inventory = [];
  const usedNames = new Set();

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
      usedNames.add(name);
      inventory.push({ item, price: item.price, type: 'weapon' });
    }
  }

  // Guarantee at least 1 consumable
  if (table.consumables.length > 0) {
    const name = table.consumables[Math.floor(Math.random() * table.consumables.length)];
    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (item) {
      usedNames.add(name);
      inventory.push({ item, price: item.price, type: 'consumable' });
    }
  }

  // Fill remaining slots from combined filtered weapon + consumable + accessory pools
  const accessoryPool = table.accessories || [];
  const combinedPool = [...filteredWeapons, ...table.consumables, ...accessoryPool];
  const maxAttempts = itemCount * 5;
  let attempts = 0;

  while (inventory.length < itemCount && attempts < maxAttempts) {
    attempts++;
    const name = combinedPool[Math.floor(Math.random() * combinedPool.length)];
    if (usedNames.has(name)) continue;

    const item = findItem(name, allWeapons, consumables, allAccessories);
    if (!item || item.price === 0) continue;

    usedNames.add(name);
    const type = item.type === 'Consumable' ? 'consumable' : item.type === 'Accessory' ? 'accessory' : 'weapon';
    inventory.push({ item, price: item.price, type });
  }

  return inventory;
}
