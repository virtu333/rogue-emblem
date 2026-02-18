import { describe, it, expect } from 'vitest';
import { getMetaEffects, META_TIER_PURCHASES } from '../../sim/lib/economyMeta.js';

const baseMetaUpgrades = [
  {
    id: 'starting_gold',
    category: 'economy',
    maxLevel: 3,
    effects: [{ goldBonus: 500 }, { goldBonus: 1000 }, { goldBonus: 1500 }],
  },
  {
    id: 'battle_gold',
    category: 'economy',
    maxLevel: 2,
    effects: [{ battleGoldMultiplier: 0.1 }, { battleGoldMultiplier: 0.2 }],
  },
  {
    id: 'loot_quality',
    category: 'economy',
    maxLevel: 2,
    effects: [{ lootWeaponQualityBonus: 10 }, { lootWeaponQualityBonus: 20 }],
  },
  {
    id: 'studied_training',
    category: 'economy',
    maxLevel: 2,
    effects: [
      { lootCategoryWeightBonuses: { skillScroll: 1, weaponArtScroll: 1, healing: -1 } },
      { lootCategoryWeightBonuses: { skillScroll: 2, weaponArtScroll: 2, healing: -2 } },
    ],
  },
  {
    id: 'trinket_collector',
    category: 'economy',
    maxLevel: 2,
    effects: [
      { lootCategoryWeightBonuses: { accessory: 2, healing: -1 } },
      { lootCategoryWeightBonuses: { accessory: 4, healing: -2 } },
    ],
  },
  {
    id: 'starting_vulnerary',
    category: 'economy',
    maxLevel: 1,
    effects: [{ extraVulnerary: 1 }],
  },
  {
    id: 'not_economy',
    category: 'capacity',
    maxLevel: 5,
    effects: [{ goldBonus: 99999 }],
  },
];

describe('economyMeta.getMetaEffects', () => {
  it('returns zeroed effects at tier 0', () => {
    expect(getMetaEffects(0, baseMetaUpgrades)).toEqual({
      goldBonus: 0,
      battleGoldMultiplier: 0,
      lootWeaponQualityBonus: 0,
      lootCategoryWeightBonuses: {},
    });
  });

  it('maps tier 1 purchases to starting_gold L1 and battle_gold L1 only', () => {
    expect(META_TIER_PURCHASES[1]).toEqual({ starting_gold: 1, battle_gold: 1 });
    expect(getMetaEffects(1, baseMetaUpgrades)).toEqual({
      goldBonus: 500,
      battleGoldMultiplier: 0.1,
      lootWeaponQualityBonus: 0,
      lootCategoryWeightBonuses: {},
    });
  });

  it('maps tier 2 purchases to starting_gold L2, battle_gold L2, loot_quality L1', () => {
    expect(META_TIER_PURCHASES[2]).toEqual({ starting_gold: 2, battle_gold: 2, loot_quality: 1 });
    expect(getMetaEffects(2, baseMetaUpgrades)).toEqual({
      goldBonus: 1000,
      battleGoldMultiplier: 0.2,
      lootWeaponQualityBonus: 10,
      lootCategoryWeightBonuses: { weapon: 10 },
    });
  });

  it('uses all-maxed fallback at tier 3+', () => {
    expect(getMetaEffects(3, baseMetaUpgrades)).toEqual({
      goldBonus: 1500,
      battleGoldMultiplier: 0.2,
      lootWeaponQualityBonus: 20,
      lootCategoryWeightBonuses: {
        weapon: 20,
        skillScroll: 2,
        weaponArtScroll: 2,
        accessory: 4,
        healing: -4,
      },
    });
    expect(getMetaEffects(4, baseMetaUpgrades)).toEqual({
      goldBonus: 1500,
      battleGoldMultiplier: 0.2,
      lootWeaponQualityBonus: 20,
      lootCategoryWeightBonuses: {
        weapon: 20,
        skillScroll: 2,
        weaponArtScroll: 2,
        accessory: 4,
        healing: -4,
      },
    });
  });

  it('supports legacy lootWeaponWeightBonus field', () => {
    const legacy = [
      {
        id: 'loot_quality',
        category: 'economy',
        maxLevel: 2,
        effects: [{ lootWeaponWeightBonus: 11 }, { lootWeaponWeightBonus: 22 }],
      },
    ];
    const tier2 = getMetaEffects(2, legacy);
    const tier3 = getMetaEffects(3, legacy);
    expect(tier2.lootWeaponQualityBonus).toBe(11);
    expect(tier2.lootCategoryWeightBonuses.weapon).toBe(11);
    expect(tier3.lootWeaponQualityBonus).toBe(22);
    expect(tier3.lootCategoryWeightBonuses.weapon).toBe(22);
  });

  it('prefers lootWeaponQualityBonus when both fields exist', () => {
    const mixed = [
      {
        id: 'loot_quality',
        category: 'economy',
        maxLevel: 1,
        effects: [{ lootWeaponWeightBonus: 11, lootWeaponQualityBonus: 17 }],
      },
    ];
    expect(getMetaEffects(3, mixed).lootWeaponQualityBonus).toBe(17);
  });
});
