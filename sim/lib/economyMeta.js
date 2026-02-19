// Meta-progression helpers for economy simulations.

// Explicit purchase maps per tier (matching sim/economy.js help text):
//   L0: nothing
//   L1: starting_gold L1, battle_gold L1
//   L2: starting_gold L2, battle_gold L2, loot_quality L1
//   L3: all maxed
export const META_TIER_PURCHASES = {
  1: { starting_gold: 1, battle_gold: 1 },
  2: { starting_gold: 2, battle_gold: 2, loot_quality: 1 },
  3: null,
};

/**
 * Resolve economy meta effects for a given abstract level.
 * @param {number} level
 * @param {Array<object>} metaUpgrades
 * @returns {{
 *   goldBonus: number,
 *   battleGoldMultiplier: number,
 *   lootWeaponQualityBonus: number,
 *   lootCategoryWeightBonuses: Record<string, number>
 * }}
 */
export function getMetaEffects(level, metaUpgrades = []) {
  const effects = {
    goldBonus: 0,
    battleGoldMultiplier: 0,
    lootWeaponQualityBonus: 0,
    lootCategoryWeightBonuses: {},
  };
  if (level <= 0) return effects;

  const econUpgrades = metaUpgrades.filter((u) => u.category === 'economy');
  const purchases = META_TIER_PURCHASES[level];

  for (const upgrade of econUpgrades) {
    const buyLevel = purchases ? purchases[upgrade.id] || 0 : Math.min(level, upgrade.maxLevel); // L3+: all maxed
    if (buyLevel <= 0) continue;
    const effect = upgrade.effects?.[buyLevel - 1];
    if (!effect) continue;

    if (effect.goldBonus !== undefined) effects.goldBonus = effect.goldBonus;
    if (effect.battleGoldMultiplier !== undefined)
      effects.battleGoldMultiplier = effect.battleGoldMultiplier;
    const lootBonus = effect.lootWeaponQualityBonus ?? effect.lootWeaponWeightBonus;
    if (lootBonus !== undefined) {
      const normalizedLootBonus = Number(lootBonus);
      if (Number.isFinite(normalizedLootBonus)) {
        effects.lootWeaponQualityBonus = normalizedLootBonus;
        if (normalizedLootBonus !== 0) {
          effects.lootCategoryWeightBonuses.weapon =
            (effects.lootCategoryWeightBonuses.weapon || 0) + normalizedLootBonus;
        }
      }
    }
    if (effect.lootCategoryWeightBonuses && typeof effect.lootCategoryWeightBonuses === 'object') {
      for (const [key, rawValue] of Object.entries(effect.lootCategoryWeightBonuses)) {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value === 0) continue;
        effects.lootCategoryWeightBonuses[key] =
          (effects.lootCategoryWeightBonuses[key] || 0) + value;
      }
    }
  }

  return effects;
}
