import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MetaProgressionManager,
  calculateCurrencies,
} from '../src/engine/MetaProgressionManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const upgradesData = gameData.metaUpgrades;
const getUpgrade = (id) => upgradesData.find((u) => u.id === id);

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
vi.stubGlobal('localStorage', localStorageMock);

function clearStore() {
  for (const key of Object.keys(store)) delete store[key];
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
}

describe('MetaProgressionManager', () => {
  beforeEach(() => {
    clearStore();
  });

  it('starts with 0 valor, 0 supply, and no upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalValor()).toBe(0);
    expect(meta.getTotalSupply()).toBe(0);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
  });

  it('loads saved dual-currency state from localStorage', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 300,
      totalSupply: 500,
      purchasedUpgrades: { recruit_hp_growth: 3 },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalValor()).toBe(300);
    expect(meta.getTotalSupply()).toBe(500);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(3);
  });

  it('migrates old totalRenown to both currencies', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalRenown: 500,
      purchasedUpgrades: { recruit_hp_growth: 2 },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalValor()).toBe(500);
    expect(meta.getTotalSupply()).toBe(500);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(2);
  });

  it('does not migrate if totalValor already present', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100,
      totalSupply: 200,
      totalRenown: 999, // stale field should be ignored
      purchasedUpgrades: {},
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalValor()).toBe(100);
    expect(meta.getTotalSupply()).toBe(200);
  });

  it('addValor increases valor and persists', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.addValor(100);
    expect(meta.getTotalValor()).toBe(100);
    expect(meta.getTotalSupply()).toBe(0);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('addSupply increases supply and persists', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.addSupply(75);
    expect(meta.getTotalSupply()).toBe(75);
    expect(meta.getTotalValor()).toBe(0);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('getNextCost returns correct cost for each level of 5-tier recruit growth upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const upgrade = getUpgrade('recruit_hp_growth');
    expect(upgrade).toBeTruthy();
    expect(meta.getNextCost('recruit_hp_growth')).toBe(upgrade.costs[0]);
    meta.purchasedUpgrades.recruit_hp_growth = 1;
    expect(meta.getNextCost('recruit_hp_growth')).toBe(upgrade.costs[1]);
    meta.purchasedUpgrades.recruit_hp_growth = 4;
    expect(meta.getNextCost('recruit_hp_growth')).toBe(upgrade.costs[4]);
    meta.purchasedUpgrades.recruit_hp_growth = 5;
    expect(meta.getNextCost('recruit_hp_growth')).toBeNull();
  });

  it('getNextCost returns correct cost for 3-tier flat upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const upgrade = getUpgrade('recruit_hp_flat');
    expect(upgrade).toBeTruthy();
    expect(meta.getNextCost('recruit_hp_flat')).toBe(upgrade.costs[0]);
    meta.purchasedUpgrades.recruit_hp_flat = 2;
    expect(meta.getNextCost('recruit_hp_flat')).toBe(upgrade.costs[2]);
    meta.purchasedUpgrades.recruit_hp_flat = 3;
    expect(meta.getNextCost('recruit_hp_flat')).toBeNull();
  });

  it('getNextCost returns null for unknown upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getNextCost('nonexistent')).toBeNull();
  });

  // --- Currency routing ---

  it('getCurrencyForUpgrade returns valor for lord categories', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getCurrencyForUpgrade('lord_hp_growth')).toBe('valor');
    expect(meta.getCurrencyForUpgrade('weapon_forge')).toBe('valor');
    expect(meta.getCurrencyForUpgrade('unlock_sol')).toBe('valor');
  });

  it('getCurrencyForUpgrade returns supply for army categories', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getCurrencyForUpgrade('recruit_hp_growth')).toBe('supply');
    expect(meta.getCurrencyForUpgrade('starting_gold')).toBe('supply');
    expect(meta.getCurrencyForUpgrade('deploy_limit')).toBe('supply');
  });

  it('canAfford checks correct currency for valor upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalValor = 100;
    meta.totalSupply = 0;
    expect(meta.canAfford('lord_hp_growth')).toBe(true); // costs 100V
    expect(meta.canAfford('recruit_hp_growth')).toBe(false); // costs 75S, but supply is 0
  });

  it('canAfford checks correct currency for supply upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalValor = 0;
    meta.totalSupply = 75;
    expect(meta.canAfford('recruit_hp_growth')).toBe(true); // costs 75S
    expect(meta.canAfford('lord_hp_growth')).toBe(false); // costs 100V, but valor is 0
  });

  it('canAfford returns false for maxed upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalValor = 9999;
    meta.totalSupply = 9999;
    meta.purchasedUpgrades.deploy_limit = 1; // maxLevel = 1
    expect(meta.canAfford('deploy_limit')).toBe(false);
  });

  it('isMaxed detects maxed upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.isMaxed('deploy_limit')).toBe(false);
    meta.purchasedUpgrades.deploy_limit = 1;
    expect(meta.isMaxed('deploy_limit')).toBe(true);
  });

  it('isMaxed detects maxed 5-tier upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.isMaxed('recruit_hp_growth')).toBe(false);
    meta.purchasedUpgrades.recruit_hp_growth = 5;
    expect(meta.isMaxed('recruit_hp_growth')).toBe(true);
  });

  it('isMaxed returns false for unknown upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.isMaxed('nonexistent')).toBe(false);
  });

  it('purchaseUpgrade deducts from supply for recruit upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const expectedCost = getUpgrade('recruit_hp_growth').costs[0];
    meta.totalSupply = 300;
    meta.totalValor = 300;
    const result = meta.purchaseUpgrade('recruit_hp_growth');
    expect(result).toBe(true);
    expect(meta.getTotalSupply()).toBe(300 - expectedCost);
    expect(meta.getTotalValor()).toBe(300);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(1);
  });

  it('purchaseUpgrade deducts from valor for lord upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const expectedCost = getUpgrade('lord_hp_growth').costs[0];
    meta.totalSupply = 300;
    meta.totalValor = 300;
    const result = meta.purchaseUpgrade('lord_hp_growth');
    expect(result).toBe(true);
    expect(meta.getTotalValor()).toBe(300 - expectedCost);
    expect(meta.getTotalSupply()).toBe(300);
    expect(meta.getUpgradeLevel('lord_hp_growth')).toBe(1);
  });

  it('purchaseUpgrade fails with insufficient currency', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 10;
    meta.totalValor = 10;
    const result = meta.purchaseUpgrade('recruit_hp_growth');
    expect(result).toBe(false);
    expect(meta.getTotalSupply()).toBe(10);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
  });

  it('purchaseUpgrade fails when already maxed', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalValor = 9999;
    meta.totalSupply = 9999;
    meta.purchasedUpgrades.deploy_limit = 1;
    const result = meta.purchaseUpgrade('deploy_limit');
    expect(result).toBe(false);
    expect(meta.getTotalSupply()).toBe(9999);
  });

  it('getActiveEffects returns growth bonuses for recruit growth upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.recruit_hp_growth = 1;
    meta.purchasedUpgrades.recruit_str_growth = 3;
    const effects = meta.getActiveEffects();
    expect(effects.growthBonuses.HP).toBe(5);
    expect(effects.growthBonuses.STR).toBe(15);
    // No flat stat bonuses from growth upgrades
    expect(effects.statBonuses.HP).toBeUndefined();
    expect(effects.statBonuses.STR).toBeUndefined();
  });

  it('getActiveEffects returns flat bonuses for recruit flat upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.recruit_hp_flat = 2;
    meta.purchasedUpgrades.recruit_str_flat = 1;
    const effects = meta.getActiveEffects();
    expect(effects.statBonuses.HP).toBe(5);
    expect(effects.statBonuses.STR).toBe(1);
    // No growth bonuses from flat upgrades
    expect(effects.growthBonuses.HP).toBeUndefined();
  });

  it('getActiveEffects aggregates split growth + flat upgrades correctly', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.recruit_hp_growth = 4; // +20% growth
    meta.purchasedUpgrades.recruit_hp_flat = 3; // +10 HP
    const effects = meta.getActiveEffects();
    expect(effects.growthBonuses.HP).toBe(20);
    expect(effects.statBonuses.HP).toBe(10);
  });

  it('getActiveEffects returns lord growth bonuses', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.lord_hp_growth = 2;
    meta.purchasedUpgrades.lord_str_growth = 1;
    const effects = meta.getActiveEffects();
    expect(effects.lordGrowthBonuses.HP).toBe(10);
    expect(effects.lordGrowthBonuses.STR).toBe(5);
    expect(effects.lordStatBonuses.HP).toBeUndefined();
  });

  it('getActiveEffects returns lord flat bonuses', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.lord_hp_flat = 2;
    meta.purchasedUpgrades.lord_def_flat = 1;
    const effects = meta.getActiveEffects();
    expect(effects.lordStatBonuses.HP).toBe(5);
    expect(effects.lordStatBonuses.DEF).toBe(1);
  });

  it('getActiveEffects supports lord SPD, SKL, and RES growth upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.lord_spd_growth = 3;
    meta.purchasedUpgrades.lord_skl_growth = 2;
    meta.purchasedUpgrades.lord_res_growth = 2;
    const effects = meta.getActiveEffects();
    expect(effects.lordGrowthBonuses.SPD).toBe(15);
    expect(effects.lordGrowthBonuses.SKL).toBe(10);
    expect(effects.lordGrowthBonuses.RES).toBe(10);
  });

  it('getActiveEffects supports lord SPD, SKL, and RES flat upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.lord_spd_flat = 2;
    meta.purchasedUpgrades.lord_skl_flat = 3;
    meta.purchasedUpgrades.lord_res_flat = 3;
    const effects = meta.getActiveEffects();
    expect(effects.lordStatBonuses.SPD).toBe(3);
    expect(effects.lordStatBonuses.SKL).toBe(5);
    expect(effects.lordStatBonuses.RES).toBe(5);
  });

  it('getActiveEffects returns economy effects', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.starting_gold = 2;
    meta.purchasedUpgrades.battle_gold = 1;
    meta.purchasedUpgrades.starting_vulnerary = 1;
    meta.purchasedUpgrades.loot_quality = 1;
    const effects = meta.getActiveEffects();
    expect(effects.goldBonus).toBe(1000);
    expect(effects.battleGoldMultiplier).toBe(0.1);
    expect(effects.extraVulnerary).toBe(1);
    expect(effects.lootWeaponQualityBonus).toBe(10);
    expect(effects.lootCategoryWeightBonuses.weapon).toBe(10);
  });

  it('maps legacy lootWeaponWeightBonus into lootWeaponQualityBonus and weapon loot table bonus', () => {
    const legacyUpgrades = [
      {
        id: 'legacy_loot_quality',
        name: 'Legacy Loot Quality',
        category: 'economy',
        maxLevel: 1,
        effects: [{ lootWeaponWeightBonus: 15 }],
        costs: [1],
      },
    ];
    const meta = new MetaProgressionManager(legacyUpgrades);
    meta.purchasedUpgrades.legacy_loot_quality = 1;
    const effects = meta.getActiveEffects();
    expect(effects.lootWeaponQualityBonus).toBe(15);
    expect(effects.lootCategoryWeightBonuses.weapon).toBe(15);
  });

  it('normalizes explicit lootCategoryWeightBonuses as additive map modifiers', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.studied_training = 1;
    meta.purchasedUpgrades.trinket_collector = 1;
    const effects = meta.getActiveEffects();
    expect(effects.lootCategoryWeightBonuses.skillScroll).toBe(1);
    expect(effects.lootCategoryWeightBonuses.weaponArtScroll).toBe(1);
    expect(effects.lootCategoryWeightBonuses.accessory).toBe(2);
    expect(effects.lootCategoryWeightBonuses.healing).toBe(-2);
    expect(effects.lootCategoryWeightBonuses.statBooster).toBe(-2);
    expect(effects.lootCategoryWeightBonuses.gold).toBe(-2);
  });

  it('getActiveEffects returns capacity effects', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.deploy_limit = 1;
    meta.purchasedUpgrades.roster_cap = 1;
    meta.purchasedUpgrades.vision_charges_2 = 1;
    meta.purchasedUpgrades.recruit_field_supplies = 1;
    meta.purchasedUpgrades.veteran_recruits = 3;
    meta.purchasedUpgrades.extra_starting_unit_pool = 3;
    meta.purchasedUpgrades.lethal_armory = 1;
    meta.purchasedUpgrades.lethal_armory_killer = 1;
    meta.purchasedUpgrades.lethal_armory_silver = 1;
    const effects = meta.getActiveEffects();
    expect(effects.deployBonus).toBe(1);
    expect(effects.rosterCapBonus).toBe(3);
    expect(effects.visionChargesBonus).toBe(1);
    expect(effects.recruitStartingVulnerary).toBe(1);
    expect(effects.recruitPromotionChanceBonus).toBe(0.24);
    expect(effects.extraStartingUnitTier).toBe(3);
    expect(effects.lethalArmoryTier).toBe(3);
  });

  it('vision_charges_3 overrides vision bonus to 2 when purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.vision_charges_2 = 1;
    meta.purchasedUpgrades.vision_charges_3 = 1;
    const effects = meta.getActiveEffects();
    expect(effects.visionChargesBonus).toBe(2);
  });

  it('getActiveEffects returns defaults when no upgrades purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const effects = meta.getActiveEffects();
    expect(effects.statBonuses).toEqual({});
    expect(effects.growthBonuses).toEqual({});
    expect(effects.lordStatBonuses).toEqual({});
    expect(effects.lordGrowthBonuses).toEqual({});
    expect(effects.goldBonus).toBe(0);
    expect(effects.battleGoldMultiplier).toBe(0);
    expect(effects.deployBonus).toBe(0);
    expect(effects.rosterCapBonus).toBe(0);
    expect(effects.visionChargesBonus).toBe(0);
    expect(effects.recruitStartingVulnerary).toBe(0);
    expect(effects.recruitPromotionChanceBonus).toBe(0);
    expect(effects.extraStartingUnitTier).toBe(0);
    expect(effects.lethalArmoryTier).toBe(0);
    expect(effects.lootCategoryWeightBonuses).toEqual({});
  });

  it('starts with 0 runsCompleted', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getRunsCompleted()).toBe(0);
  });

  it('incrementRunsCompleted increments and persists', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.incrementRunsCompleted();
    expect(meta.getRunsCompleted()).toBe(1);
    meta.incrementRunsCompleted();
    expect(meta.getRunsCompleted()).toBe(2);
    const saved = JSON.parse(store['emblem_rogue_meta_save']);
    expect(saved.runsCompleted).toBe(2);
  });

  it('loads runsCompleted from localStorage', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100,
      totalSupply: 100,
      purchasedUpgrades: {},
      runsCompleted: 5,
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getRunsCompleted()).toBe(5);
  });

  it('defaults runsCompleted to 0 for old saves without it', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100,
      totalSupply: 100,
      purchasedUpgrades: {},
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getRunsCompleted()).toBe(0);
  });

  it('reset clears all data including runsCompleted and persists', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalValor = 999;
    meta.totalSupply = 888;
    meta.purchasedUpgrades.recruit_hp_growth = 3;
    meta.runsCompleted = 7;
    meta.reset();
    expect(meta.getTotalValor()).toBe(0);
    expect(meta.getTotalSupply()).toBe(0);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
    expect(meta.getRunsCompleted()).toBe(0);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('handles corrupted localStorage gracefully', () => {
    store['emblem_rogue_meta_save'] = 'not valid json{{{';
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalValor()).toBe(0);
    expect(meta.getTotalSupply()).toBe(0);
  });

  it('silently ignores old upgrade IDs in saved state', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 500,
      totalSupply: 500,
      purchasedUpgrades: { recruit_hp: 2, lord_hp: 1 },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalValor()).toBe(500);
    // Old IDs load into purchasedUpgrades but getActiveEffects ignores them
    // since they don't match any upgradesData entry
    const effects = meta.getActiveEffects();
    expect(effects.growthBonuses.HP).toBeUndefined();
    expect(effects.lordGrowthBonuses.HP).toBeUndefined();
  });

  it('saves payload with totalValor and totalSupply (not totalRenown)', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.addValor(100);
    meta.addSupply(200);
    const saved = JSON.parse(store['emblem_rogue_meta_save']);
    expect(saved.totalValor).toBe(100);
    expect(saved.totalSupply).toBe(200);
    expect(saved.totalRenown).toBeUndefined();
    expect(Number.isFinite(saved.savedAt)).toBe(true);
  });

  it('has 60 total upgrades in data', () => {
    expect(upgradesData.length).toBe(60);
  });

  it('has correct category distribution', () => {
    const byCategory = {};
    for (const u of upgradesData) {
      byCategory[u.category] = (byCategory[u.category] || 0) + 1;
    }
    expect(byCategory.recruit_stats).toBe(12);
    expect(byCategory.lord_bonuses).toBe(14);
    expect(byCategory.economy).toBe(7);
    expect(byCategory.capacity).toBe(9);
    expect(byCategory.starting_equipment).toBe(8);
    expect(byCategory.starting_skills).toBe(10);
  });

  // --- Starting Equipment effects ---

  it('getActiveEffects returns starting equipment effects', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.weapon_forge = 2;
    meta.purchasedUpgrades.weapon_tier = 1;
    meta.purchasedUpgrades.weapon_tier_silver = 1;
    meta.purchasedUpgrades.starting_accessory = 3;
    meta.purchasedUpgrades.staff_upgrade = 1;
    const effects = meta.getActiveEffects();
    expect(effects.startingWeaponForge).toBe(2);
    expect(effects.deadlyArsenalTier).toBe(2);
    expect(effects.startingAccessoryTier).toBe(3);
    expect(effects.startingStaffTier).toBe(1);
  });

  it('getActiveEffects returns 0/false for unpurchased equipment upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const effects = meta.getActiveEffects();
    expect(effects.startingWeaponForge).toBe(0);
    expect(effects.deadlyArsenalTier).toBe(0);
    expect(effects.startingAccessoryTier).toBe(0);
    expect(effects.startingStaffTier).toBe(0);
    expect(effects.recruitRandomSkill).toBe(false);
  });

  it('getActiveEffects returns recruitRandomSkill when purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.recruit_skill = 1;
    const effects = meta.getActiveEffects();
    expect(effects.recruitRandomSkill).toBe(true);
  });

  it('getActiveEffects returns lordRecruitChanceBonus for heros_call', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.heros_call = 2;
    const effects = meta.getActiveEffects();
    expect(effects.lordRecruitChanceBonus).toBe(0.16);
  });

  it('getActiveEffects returns 0 lordRecruitChanceBonus when unpurchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const effects = meta.getActiveEffects();
    expect(effects.lordRecruitChanceBonus).toBe(0);
  });

  it('getActiveEffects returns recruitPromotionChanceBonus for veteran_recruits', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.veteran_recruits = 2;
    const effects = meta.getActiveEffects();
    expect(effects.recruitPromotionChanceBonus).toBe(0.16);
  });

  it('getActiveEffects returns 0 recruitPromotionChanceBonus when unpurchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const effects = meta.getActiveEffects();
    expect(effects.recruitPromotionChanceBonus).toBe(0);
  });

  // --- Skill assignment methods ---

  it('getUnlockedSkills returns empty when no skill upgrades purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getUnlockedSkills()).toEqual([]);
  });

  it('getUnlockedSkills returns purchased skill IDs', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.purchasedUpgrades.unlock_vantage = 1;
    const unlocked = meta.getUnlockedSkills();
    expect(unlocked).toContain('sol');
    expect(unlocked).toContain('vantage');
    expect(unlocked.length).toBe(2);
  });

  it('getUnlockedWeaponArts resolves explicit IDs and weapon-type bundles in stable order', () => {
    const customUpgrades = [
      {
        id: 'meta_bundle',
        category: 'starting_equipment',
        maxLevel: 1,
        costs: [100],
        effects: [{ unlockWeaponArtsByWeaponType: ['Sword', 'Bow'] }],
      },
      {
        id: 'meta_explicit',
        category: 'starting_equipment',
        maxLevel: 1,
        costs: [100],
        effects: [
          {
            unlockWeaponArt: 'legend_gemini_tempest',
            unlockWeaponArts: ['legend_starfall_volley'],
          },
        ],
      },
    ];
    const meta = new MetaProgressionManager(customUpgrades);
    meta.purchasedUpgrades.meta_bundle = 1;
    meta.purchasedUpgrades.meta_explicit = 1;
    const unlocked = meta.getUnlockedWeaponArts(gameData.weaponArts.arts);
    const expected = [];
    for (const weaponType of ['Sword', 'Bow']) {
      expected.push(
        ...gameData.weaponArts.arts
          .filter((art) => art.weaponType === weaponType)
          .map((art) => art.id),
      );
    }
    if (!expected.includes('legend_gemini_tempest')) expected.push('legend_gemini_tempest');
    if (!expected.includes('legend_starfall_volley')) expected.push('legend_starfall_volley');
    expect(unlocked).toEqual(expected);
  });

  it('getUnlockedWeaponArts fails closed on unknown IDs', () => {
    const customUpgrades = [
      {
        id: 'meta_bad_id',
        category: 'starting_equipment',
        maxLevel: 1,
        costs: [100],
        effects: [{ unlockWeaponArt: 'not_real_art', unlockWeaponArts: ['also_not_real'] }],
      },
    ];
    const meta = new MetaProgressionManager(customUpgrades);
    meta.purchasedUpgrades.meta_bad_id = 1;
    expect(meta.getUnlockedWeaponArts(gameData.weaponArts.arts)).toEqual([]);
  });

  it('assignSkill adds skill to lord', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    const result = meta.assignSkill('Edric', 'sol');
    expect(result).toBe(true);
    expect(meta.getSkillAssignments().Edric).toEqual(['sol']);
  });

  it('assignSkill fails if skill not unlocked', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const result = meta.assignSkill('Edric', 'sol');
    expect(result).toBe(false);
  });

  it('assignSkill rejects 2nd skill without extra_skill_slot purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.purchasedUpgrades.unlock_luna = 1;
    meta.assignSkill('Edric', 'sol');
    const result = meta.assignSkill('Edric', 'luna');
    expect(result).toBe(false);
    expect(meta.getSkillAssignments().Edric.length).toBe(1);
  });

  it('assignSkill allows 2nd skill after extra_skill_slot purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.purchasedUpgrades.unlock_luna = 1;
    meta.purchasedUpgrades.unlock_vantage = 1;
    meta.purchasedUpgrades.extra_skill_slot = 1;
    meta.assignSkill('Edric', 'sol');
    meta.assignSkill('Edric', 'luna');
    const result = meta.assignSkill('Edric', 'vantage');
    expect(result).toBe(false);
    expect(meta.getSkillAssignments().Edric.length).toBe(2);
  });

  it('assignSkill fails if skill already assigned to same lord', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.assignSkill('Edric', 'sol');
    const result = meta.assignSkill('Edric', 'sol');
    expect(result).toBe(false);
  });

  it('same skill can be assigned to multiple lords', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    expect(meta.assignSkill('Edric', 'sol')).toBe(true);
    expect(meta.assignSkill('Sera', 'sol')).toBe(true);
    expect(meta.getSkillAssignments().Edric).toEqual(['sol']);
    expect(meta.getSkillAssignments().Sera).toEqual(['sol']);
  });

  it('unassignSkill removes skill from lord', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.assignSkill('Edric', 'sol');
    const result = meta.unassignSkill('Edric', 'sol');
    expect(result).toBe(true);
    expect(meta.getSkillAssignments().Edric).toBeUndefined();
  });

  it('unassignSkill returns false for non-assigned skill', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.unassignSkill('Edric', 'sol')).toBe(false);
  });

  it('skillAssignments persists in localStorage', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.assignSkill('Edric', 'sol');
    const saved = JSON.parse(store['emblem_rogue_meta_save']);
    expect(saved.skillAssignments.Edric).toEqual(['sol']);
  });

  it('skillAssignments loads from localStorage', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100,
      totalSupply: 100,
      purchasedUpgrades: { unlock_sol: 1 },
      skillAssignments: { Edric: ['sol'] },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getSkillAssignments().Edric).toEqual(['sol']);
  });

  it('getStartingSkillSlots returns 1 by default, 2 after purchase', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getStartingSkillSlots()).toBe(1);
    meta.purchasedUpgrades.extra_skill_slot = 1;
    expect(meta.getStartingSkillSlots()).toBe(2);
  });

  it('getStartingSkillSlots clamps corrupted save data to MAX_STARTING_SKILLS', () => {
    const meta = new MetaProgressionManager(upgradesData);
    // Oversized positive values
    meta.purchasedUpgrades.extra_skill_slot = 5;
    expect(meta.getStartingSkillSlots()).toBe(2);
    meta.purchasedUpgrades.extra_skill_slot = 99;
    expect(meta.getStartingSkillSlots()).toBe(2);
    // Negative values
    meta.purchasedUpgrades.extra_skill_slot = -5;
    expect(meta.getStartingSkillSlots()).toBe(1);
    // Non-numeric strings
    meta.purchasedUpgrades.extra_skill_slot = 'abc';
    expect(meta.getStartingSkillSlots()).toBe(1);
    meta.purchasedUpgrades.extra_skill_slot = '-1';
    expect(meta.getStartingSkillSlots()).toBe(1);
    // Other non-finite values
    meta.purchasedUpgrades.extra_skill_slot = NaN;
    expect(meta.getStartingSkillSlots()).toBe(1);
    meta.purchasedUpgrades.extra_skill_slot = Infinity;
    expect(meta.getStartingSkillSlots()).toBe(1);
  });

  it('purchaseUpgrade normalizes corrupted stored value before incrementing', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 9999;
    // Corrupt the stored value to a string
    meta.purchasedUpgrades.recruit_hp_growth = '1';
    // getUpgradeLevel treats non-finite as 0
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
    // Purchase should normalize to 0 then increment to 1, not concatenate to '11'
    meta.purchaseUpgrade('recruit_hp_growth');
    expect(meta.purchasedUpgrades.recruit_hp_growth).toBe(1);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(1);
  });

  it('getActiveEffects includes startingSkills from assignments', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.assignSkill('Edric', 'sol');
    const effects = meta.getActiveEffects();
    expect(effects.startingSkills.Edric).toEqual(['sol']);
  });

  it('getActiveEffects trims startingSkills to slot count', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.purchasedUpgrades.unlock_luna = 1;
    meta.purchasedUpgrades.extra_skill_slot = 1;
    // Assign 2 skills
    meta.assignSkill('Edric', 'sol');
    meta.assignSkill('Edric', 'luna');
    expect(meta.getActiveEffects().startingSkills.Edric).toEqual(['sol', 'luna']);
    // Now remove the upgrade — raw assignments preserved, but effects trimmed to 1
    delete meta.purchasedUpgrades.extra_skill_slot;
    expect(meta.getSkillAssignments().Edric).toEqual(['sol', 'luna']); // raw preserved
    expect(meta.getActiveEffects().startingSkills.Edric).toEqual(['sol']); // trimmed
  });

  it('getActiveEffects includes extraSkillSlot when purchased', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getActiveEffects().extraSkillSlot).toBe(0);
    meta.purchasedUpgrades.extra_skill_slot = 1;
    expect(meta.getActiveEffects().extraSkillSlot).toBe(1);
  });

  it('getActiveEffects includes metaUnlockedWeaponArts when catalog is provided', () => {
    const customUpgrades = [
      {
        id: 'meta_unlock_one',
        category: 'starting_equipment',
        maxLevel: 1,
        costs: [100],
        effects: [{ unlockWeaponArt: 'legend_gemini_tempest' }],
      },
    ];
    const meta = new MetaProgressionManager(customUpgrades);
    meta.purchasedUpgrades.meta_unlock_one = 1;
    const effects = meta.getActiveEffects({ weaponArtCatalog: gameData.weaponArts.arts });
    expect(effects.metaUnlockedWeaponArts).toEqual(['legend_gemini_tempest']);
  });

  it('migrates legacy weapon_art_infusion ownership to iron_arms + steel_arms', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.weapon_art_infusion = 1;
    // Constructor migration handles saved state; mirror it directly for this unit test path.
    meta._migrateLegacyWeaponArtUpgradeState();

    const effects = meta.getActiveEffects({ weaponArtCatalog: gameData.weaponArts.arts });
    expect(effects.ironArms).toBe(1);
    expect(effects.steelArms).toBe(1);
  });

  it('migrates pre-split deadly arsenal buyers to include silver tier', () => {
    store.emblem_rogue_meta_save = JSON.stringify({
      totalValor: 1000,
      totalSupply: 1000,
      purchasedUpgrades: { weapon_tier: 1 },
      savedAt: Date.UTC(2026, 1, 1),
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getUpgradeLevel('weapon_tier')).toBe(1);
    expect(meta.getUpgradeLevel('weapon_tier_silver')).toBe(1);
    expect(meta.getActiveEffects().deadlyArsenalTier).toBe(2);
  });

  it('does not auto-grant silver tier for post-split tier-1 purchases', () => {
    store.emblem_rogue_meta_save = JSON.stringify({
      totalValor: 1000,
      totalSupply: 1000,
      purchasedUpgrades: { weapon_tier: 1 },
      savedAt: Date.UTC(2026, 1, 20),
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getUpgradeLevel('weapon_tier')).toBe(1);
    expect(meta.getUpgradeLevel('weapon_tier_silver')).toBe(0);
    expect(meta.getActiveEffects().deadlyArsenalTier).toBe(1);
  });

  it('reset clears skillAssignments', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.assignSkill('Edric', 'sol');
    meta.reset();
    expect(meta.getSkillAssignments()).toEqual({});
  });

  // --- Milestone methods ---

  it('starts with no milestones', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.hasMilestone('beatAct1')).toBe(false);
    expect(meta.getMilestones()).toEqual([]);
  });

  it('recordMilestone adds and persists a milestone', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.recordMilestone('beatAct1');
    expect(meta.hasMilestone('beatAct1')).toBe(true);
    expect(meta.getMilestones()).toEqual(['beatAct1']);
    const saved = JSON.parse(store['emblem_rogue_meta_save']);
    expect(saved.milestones).toEqual(['beatAct1']);
  });

  it('recordMilestone is idempotent', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.recordMilestone('beatAct1');
    meta.recordMilestone('beatAct1');
    expect(meta.getMilestones()).toEqual(['beatAct1']);
  });

  it('loads milestones from localStorage', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100,
      totalSupply: 100,
      purchasedUpgrades: {},
      milestones: ['beatAct1', 'beatAct2'],
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.hasMilestone('beatAct1')).toBe(true);
    expect(meta.hasMilestone('beatAct2')).toBe(true);
    expect(meta.hasMilestone('beatAct3')).toBe(false);
  });

  it('defaults milestones to empty for old saves without milestones field', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100,
      totalSupply: 100,
      purchasedUpgrades: {},
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getMilestones()).toEqual([]);
    expect(meta.hasMilestone('beatAct1')).toBe(false);
  });

  it('reset clears milestones', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.recordMilestone('beatAct1');
    meta.reset();
    expect(meta.hasMilestone('beatAct1')).toBe(false);
    expect(meta.getMilestones()).toEqual([]);
  });

  // --- Prerequisite methods ---

  it('meetsPrerequisites returns true for upgrades with no requires field', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.meetsPrerequisites('recruit_hp_growth')).toBe(true);
    expect(meta.meetsPrerequisites('starting_gold')).toBe(true);
  });

  it('meetsPrerequisites checks upgrade level requirement', () => {
    const meta = new MetaProgressionManager(upgradesData);
    // recruit_hp_flat requires recruit_hp_growth level 3
    expect(meta.meetsPrerequisites('recruit_hp_flat')).toBe(false);
    meta.purchasedUpgrades.recruit_hp_growth = 2;
    expect(meta.meetsPrerequisites('recruit_hp_flat')).toBe(false);
    meta.purchasedUpgrades.recruit_hp_growth = 3;
    expect(meta.meetsPrerequisites('recruit_hp_flat')).toBe(true);
  });

  it('meetsPrerequisites checks milestone requirement', () => {
    const meta = new MetaProgressionManager(upgradesData);
    // loot_quality requires beatAct1
    expect(meta.meetsPrerequisites('loot_quality')).toBe(false);
    meta.recordMilestone('beatAct1');
    expect(meta.meetsPrerequisites('loot_quality')).toBe(true);
  });

  it('meetsPrerequisites checks combined upgrade + milestone requirements', () => {
    const meta = new MetaProgressionManager(upgradesData);
    // lord_str_flat requires lord_str_growth level 3 + beatAct1
    expect(meta.meetsPrerequisites('lord_str_flat')).toBe(false);
    meta.purchasedUpgrades.lord_str_growth = 3;
    expect(meta.meetsPrerequisites('lord_str_flat')).toBe(false); // still missing beatAct1
    meta.recordMilestone('beatAct1');
    expect(meta.meetsPrerequisites('lord_str_flat')).toBe(true);
  });

  it('meetsPrerequisites returns true for unknown upgrade ID', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.meetsPrerequisites('nonexistent')).toBe(true);
  });

  it('purchaseUpgrade blocked by unmet prerequisites', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 9999;
    // recruit_hp_flat requires recruit_hp_growth level 3
    const result = meta.purchaseUpgrade('recruit_hp_flat');
    expect(result).toBe(false);
    expect(meta.getUpgradeLevel('recruit_hp_flat')).toBe(0);
    expect(meta.getTotalSupply()).toBe(9999); // no deduction
  });

  it('purchaseUpgrade succeeds when prerequisites are met', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 9999;
    meta.purchasedUpgrades.recruit_hp_growth = 3;
    const result = meta.purchaseUpgrade('recruit_hp_flat');
    expect(result).toBe(true);
    expect(meta.getUpgradeLevel('recruit_hp_flat')).toBe(1);
  });

  it('purchaseUpgrade blocked by unmet milestone', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 9999;
    // deploy_limit requires beatAct2
    const result = meta.purchaseUpgrade('deploy_limit');
    expect(result).toBe(false);
    expect(meta.getUpgradeLevel('deploy_limit')).toBe(0);
  });

  it('purchaseUpgrade succeeds when milestone is met', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 9999;
    meta.recordMilestone('beatAct2');
    const result = meta.purchaseUpgrade('deploy_limit');
    expect(result).toBe(true);
    expect(meta.getUpgradeLevel('deploy_limit')).toBe(1);
  });

  it('getPrerequisiteInfo returns met:true for upgrades with no prereqs', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const info = meta.getPrerequisiteInfo('recruit_hp_growth');
    expect(info.met).toBe(true);
    expect(info.missing).toEqual([]);
  });

  it('getPrerequisiteInfo returns missing upgrade names', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const info = meta.getPrerequisiteInfo('recruit_hp_flat');
    expect(info.met).toBe(false);
    expect(info.missing).toContain('Hardy Recruits Lv3');
  });

  it('getPrerequisiteInfo returns missing milestone labels', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const info = meta.getPrerequisiteInfo('loot_quality');
    expect(info.met).toBe(false);
    expect(info.missing).toContain('Beat Act 1');
  });

  it('getPrerequisiteInfo returns combined missing info', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const info = meta.getPrerequisiteInfo('lord_str_flat');
    expect(info.met).toBe(false);
    expect(info.missing).toContain('Lord Combat Training Lv3');
    expect(info.missing).toContain('Beat Act 1');
  });

  it('lord_res_flat has no milestone requirement (only upgrade prereq)', () => {
    const meta = new MetaProgressionManager(upgradesData);
    // lord_res_flat requires lord_res_growth level 3 but no milestone
    meta.purchasedUpgrades.lord_res_growth = 3;
    expect(meta.meetsPrerequisites('lord_res_flat')).toBe(true);
  });

  it('lord_skl_flat has no milestone requirement (only upgrade prereq)', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.meetsPrerequisites('lord_skl_flat')).toBe(false);
    meta.purchasedUpgrades.lord_skl_growth = 2;
    expect(meta.meetsPrerequisites('lord_skl_flat')).toBe(false);
    meta.purchasedUpgrades.lord_skl_growth = 3;
    expect(meta.meetsPrerequisites('lord_skl_flat')).toBe(true);
  });

  it('deploy_limit requires beatAct2 milestone', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.meetsPrerequisites('deploy_limit')).toBe(false);
    meta.recordMilestone('beatAct1');
    expect(meta.meetsPrerequisites('deploy_limit')).toBe(false); // needs beatAct2
    meta.recordMilestone('beatAct2');
    expect(meta.meetsPrerequisites('deploy_limit')).toBe(true);
  });

  // --- beatGame milestone ---

  it('beatGame milestone is separate from beatAct3', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.recordMilestone('beatAct3');
    expect(meta.hasMilestone('beatAct3')).toBe(true);
    expect(meta.hasMilestone('beatGame')).toBe(false);
  });

  it('beatGame milestone can be recorded independently', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.recordMilestone('beatGame');
    expect(meta.hasMilestone('beatGame')).toBe(true);
    expect(meta.hasMilestone('beatAct3')).toBe(false);
  });

  it('getPrerequisiteInfo shows beatGame label', () => {
    const meta = new MetaProgressionManager(upgradesData);
    // Manually create a fake upgrade with beatGame prerequisite to test the label
    const fakeUpgrades = [
      ...upgradesData,
      {
        id: 'test_beatgame',
        category: 'economy',
        maxLevel: 1,
        costs: [100],
        effects: [{ goldBonus: 1 }],
        requires: { milestones: ['beatGame'] },
      },
    ];
    const meta2 = new MetaProgressionManager(fakeUpgrades);
    const info = meta2.getPrerequisiteInfo('test_beatgame');
    expect(info.met).toBe(false);
    expect(info.missing).toContain('Beat the Game');
  });

  // --- Refund methods ---

  describe('getDependentUpgrades', () => {
    it('returns correct dependent for recruit_hp_growth → recruit_hp_flat', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const deps = meta.getDependentUpgrades('recruit_hp_growth');
      expect(deps.length).toBeGreaterThanOrEqual(1);
      const flat = deps.find((d) => d.id === 'recruit_hp_flat');
      expect(flat).toBeTruthy();
      expect(flat.requiredLevel).toBe(3);
    });

    it('returns empty array for upgrade with no dependents', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const deps = meta.getDependentUpgrades('deploy_limit');
      expect(deps).toEqual([]);
    });

    it('returns correct dependent for vision_charges_2 → vision_charges_3', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const deps = meta.getDependentUpgrades('vision_charges_2');
      const vc3 = deps.find((d) => d.id === 'vision_charges_3');
      expect(vc3).toBeTruthy();
      expect(vc3.requiredLevel).toBe(1);
    });
  });

  describe('canRefund', () => {
    it('returns not_purchased for level 0', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const result = meta.canRefund('recruit_hp_growth');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('not_purchased');
    });

    it('returns insufficient_fee when balance < 20', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.purchasedUpgrades.recruit_hp_growth = 1;
      meta.totalSupply = 10; // below REFUND_FEE of 20
      const result = meta.canRefund('recruit_hp_growth');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('insufficient_fee');
    });

    it('returns success with refundAmount and refundFee for valid refund', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.purchasedUpgrades.recruit_hp_growth = 2;
      meta.totalSupply = 100;
      const result = meta.canRefund('recruit_hp_growth');
      expect(result.success).toBe(true);
      const upgrade = getUpgrade('recruit_hp_growth');
      expect(result.refundAmount).toBe(upgrade.costs[1]);
      expect(result.refundFee).toBe(20);
    });

    it('returns unknown_upgrade for nonexistent id', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const result = meta.canRefund('nonexistent');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('unknown_upgrade');
    });
  });

  describe('refundUpgrade', () => {
    it('happy path: refunds tier and returns correct shape', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const upgrade = getUpgrade('recruit_hp_growth');
      meta.totalSupply = 500;
      meta.purchasedUpgrades.recruit_hp_growth = 2;
      const result = meta.refundUpgrade('recruit_hp_growth');
      expect(result.success).toBe(true);
      expect(result.refundAmount).toBe(upgrade.costs[1]);
      expect(result.refundFee).toBe(20);
      expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(1);
    });

    it('net currency correct: balance = original - 20 + tierCost', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const upgrade = getUpgrade('recruit_hp_growth');
      const tierCost = upgrade.costs[0]; // cost of tier 1
      meta.totalSupply = 100;
      meta.purchasedUpgrades.recruit_hp_growth = 1;
      meta.refundUpgrade('recruit_hp_growth');
      expect(meta.getTotalSupply()).toBe(100 - 20 + tierCost);
    });

    it('fee deducted from valor for lord upgrades', () => {
      const meta = new MetaProgressionManager(upgradesData);
      const upgrade = getUpgrade('lord_hp_growth');
      const tierCost = upgrade.costs[0];
      meta.totalValor = 100;
      meta.totalSupply = 500;
      meta.purchasedUpgrades.lord_hp_growth = 1;
      meta.refundUpgrade('lord_hp_growth');
      expect(meta.getTotalValor()).toBe(100 - 20 + tierCost);
      expect(meta.getTotalSupply()).toBe(500); // supply unchanged
    });

    it('returns not_purchased when level 0', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalSupply = 500;
      const result = meta.refundUpgrade('recruit_hp_growth');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('not_purchased');
    });

    it('returns insufficient_fee when balance < 20, no side effects', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.purchasedUpgrades.recruit_hp_growth = 2;
      meta.totalSupply = 10;
      const result = meta.refundUpgrade('recruit_hp_growth');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('insufficient_fee');
      expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(2);
      expect(meta.getTotalSupply()).toBe(10);
    });

    it('returns blocked_by_dependent when dependent would break', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalSupply = 500;
      meta.purchasedUpgrades.recruit_hp_growth = 3;
      meta.purchasedUpgrades.recruit_hp_flat = 1; // requires growth lv3
      const result = meta.refundUpgrade('recruit_hp_growth');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('blocked_by_dependent');
      expect(result.detail).toContain('requires this at Lv3');
    });

    it('allowed when level is above dependent required level', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalSupply = 500;
      meta.purchasedUpgrades.recruit_hp_growth = 4;
      meta.purchasedUpgrades.recruit_hp_flat = 1; // requires growth lv3
      const result = meta.refundUpgrade('recruit_hp_growth');
      expect(result.success).toBe(true);
      expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(3);
    });

    it('allowed when dependent has level 0 (not purchased)', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalSupply = 500;
      meta.purchasedUpgrades.recruit_hp_growth = 3;
      // recruit_hp_flat NOT purchased
      const result = meta.refundUpgrade('recruit_hp_growth');
      expect(result.success).toBe(true);
      expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(2);
    });

    it('multi-lord skill unassign on skill unlock refund', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalValor = 500;
      meta.purchasedUpgrades.unlock_sol = 1;
      meta.skillAssignments = { Edric: ['sol'], Sera: ['sol'] };
      const result = meta.refundUpgrade('unlock_sol');
      expect(result.success).toBe(true);
      expect(meta.getUpgradeLevel('unlock_sol')).toBe(0);
      expect(meta.getSkillAssignments().Edric).toBeUndefined();
      expect(meta.getSkillAssignments().Sera).toBeUndefined();
    });

    it('persists to localStorage', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalSupply = 500;
      meta.purchasedUpgrades.recruit_hp_growth = 2;
      meta.refundUpgrade('recruit_hp_growth');
      const saved = JSON.parse(store['emblem_rogue_meta_save']);
      expect(saved.purchasedUpgrades.recruit_hp_growth).toBe(1);
    });

    it('chain blocks: vision_charges_2 blocked by vision_charges_3', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalValor = 500;
      meta.purchasedUpgrades.vision_charges_2 = 1;
      meta.purchasedUpgrades.vision_charges_3 = 1;
      meta.recordMilestone('beatAct2');
      const result = meta.refundUpgrade('vision_charges_2');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('blocked_by_dependent');
    });

    it('chain blocks: iron_arms blocked by steel_arms', () => {
      const meta = new MetaProgressionManager(upgradesData);
      meta.totalValor = 500;
      meta.purchasedUpgrades.iron_arms = 1;
      meta.purchasedUpgrades.steel_arms = 1;
      const result = meta.refundUpgrade('iron_arms');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('blocked_by_dependent');
    });
  });
});

describe('calculateCurrencies', () => {
  it('awards currencies per act reached', () => {
    const { valor, supply } = calculateCurrencies(2, 0, false);
    expect(valor).toBe(100); // 2 * 50
    expect(supply).toBe(100);
  });

  it('awards currencies per battle completed', () => {
    const { valor, supply } = calculateCurrencies(0, 5, false);
    expect(valor).toBe(75); // 5 * 15
    expect(supply).toBe(75);
  });

  it('awards victory bonus to both currencies', () => {
    const { valor, supply } = calculateCurrencies(0, 0, true);
    expect(valor).toBe(100);
    expect(supply).toBe(100);
  });

  it('combines all components', () => {
    // 3 acts * 50 + 10 battles * 15 + 100 victory = 150 + 150 + 100 = 400
    const { valor, supply } = calculateCurrencies(3, 10, true);
    expect(valor).toBe(400);
    expect(supply).toBe(400);
  });

  it('returns 0 for act 0, 0 battles, no victory', () => {
    const { valor, supply } = calculateCurrencies(0, 0, false);
    expect(valor).toBe(0);
    expect(supply).toBe(0);
  });

  it('applies difficulty currency multiplier', () => {
    const { valor, supply } = calculateCurrencies(2, 4, false, 1.25);
    // Base = (2*50) + (4*15) = 160, scaled = 200
    expect(valor).toBe(200);
    expect(supply).toBe(200);
  });
});
