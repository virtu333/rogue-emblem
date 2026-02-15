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
    effects: [{ battleGoldMultiplier: 0.2 }, { battleGoldMultiplier: 0.4 }],
  },
  {
    id: 'loot_quality',
    category: 'economy',
    maxLevel: 2,
    effects: [{ lootWeaponQualityBonus: 10 }, { lootWeaponQualityBonus: 20 }],
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
    });
  });

  it('maps tier 1 purchases to starting_gold L1 and battle_gold L1 only', () => {
    expect(META_TIER_PURCHASES[1]).toEqual({ starting_gold: 1, battle_gold: 1 });
    expect(getMetaEffects(1, baseMetaUpgrades)).toEqual({
      goldBonus: 500,
      battleGoldMultiplier: 0.2,
      lootWeaponQualityBonus: 0,
    });
  });

  it('maps tier 2 purchases to starting_gold L2, battle_gold L2, loot_quality L1', () => {
    expect(META_TIER_PURCHASES[2]).toEqual({ starting_gold: 2, battle_gold: 2, loot_quality: 1 });
    expect(getMetaEffects(2, baseMetaUpgrades)).toEqual({
      goldBonus: 1000,
      battleGoldMultiplier: 0.4,
      lootWeaponQualityBonus: 10,
    });
  });

  it('uses all-maxed fallback at tier 3+', () => {
    expect(getMetaEffects(3, baseMetaUpgrades)).toEqual({
      goldBonus: 1500,
      battleGoldMultiplier: 0.4,
      lootWeaponQualityBonus: 20,
    });
    expect(getMetaEffects(4, baseMetaUpgrades)).toEqual({
      goldBonus: 1500,
      battleGoldMultiplier: 0.4,
      lootWeaponQualityBonus: 20,
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
    expect(getMetaEffects(2, legacy).lootWeaponQualityBonus).toBe(11);
    expect(getMetaEffects(3, legacy).lootWeaponQualityBonus).toBe(22);
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
