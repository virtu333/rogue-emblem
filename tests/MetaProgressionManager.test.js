import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaProgressionManager, calculateCurrencies } from '../src/engine/MetaProgressionManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const upgradesData = gameData.metaUpgrades;

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
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
    expect(meta.getNextCost('recruit_hp_growth')).toBe(75);   // L0 → cost[0]
    meta.purchasedUpgrades.recruit_hp_growth = 1;
    expect(meta.getNextCost('recruit_hp_growth')).toBe(100);  // L1 → cost[1]
    meta.purchasedUpgrades.recruit_hp_growth = 4;
    expect(meta.getNextCost('recruit_hp_growth')).toBe(350);  // L4 → cost[4]
    meta.purchasedUpgrades.recruit_hp_growth = 5;
    expect(meta.getNextCost('recruit_hp_growth')).toBeNull();  // maxed
  });

  it('getNextCost returns correct cost for 3-tier flat upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getNextCost('recruit_hp_flat')).toBe(200);
    meta.purchasedUpgrades.recruit_hp_flat = 2;
    expect(meta.getNextCost('recruit_hp_flat')).toBe(1000);
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
    expect(meta.canAfford('lord_hp_growth')).toBe(true);  // costs 100V
    expect(meta.canAfford('recruit_hp_growth')).toBe(false); // costs 75S, but supply is 0
  });

  it('canAfford checks correct currency for supply upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalValor = 0;
    meta.totalSupply = 75;
    expect(meta.canAfford('recruit_hp_growth')).toBe(true);  // costs 75S
    expect(meta.canAfford('lord_hp_growth')).toBe(false);    // costs 100V, but valor is 0
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
    meta.totalSupply = 300;
    meta.totalValor = 300;
    const result = meta.purchaseUpgrade('recruit_hp_growth');
    expect(result).toBe(true);
    expect(meta.getTotalSupply()).toBe(225); // 300 - 75
    expect(meta.getTotalValor()).toBe(300);  // untouched
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(1);
  });

  it('purchaseUpgrade deducts from valor for lord upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalSupply = 300;
    meta.totalValor = 300;
    const result = meta.purchaseUpgrade('lord_hp_growth');
    expect(result).toBe(true);
    expect(meta.getTotalValor()).toBe(200);  // 300 - 100
    expect(meta.getTotalSupply()).toBe(300); // untouched
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
    meta.purchasedUpgrades.recruit_hp_growth = 4;  // +20% growth
    meta.purchasedUpgrades.recruit_hp_flat = 3;     // +10 HP
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

  it('getActiveEffects supports lord SPD and RES growth upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.lord_spd_growth = 3;
    meta.purchasedUpgrades.lord_res_growth = 2;
    const effects = meta.getActiveEffects();
    expect(effects.lordGrowthBonuses.SPD).toBe(15);
    expect(effects.lordGrowthBonuses.RES).toBe(10);
  });

  it('getActiveEffects supports lord SPD and RES flat upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.lord_spd_flat = 2;
    meta.purchasedUpgrades.lord_res_flat = 3;
    const effects = meta.getActiveEffects();
    expect(effects.lordStatBonuses.SPD).toBe(3);
    expect(effects.lordStatBonuses.RES).toBe(5);
  });

  it('getActiveEffects returns economy effects', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.starting_gold = 2;
    meta.purchasedUpgrades.battle_gold = 1;
    meta.purchasedUpgrades.starting_vulnerary = 1;
    const effects = meta.getActiveEffects();
    expect(effects.goldBonus).toBe(200);
    expect(effects.battleGoldMultiplier).toBe(0.2);
    expect(effects.extraVulnerary).toBe(1);
  });

  it('getActiveEffects returns capacity effects', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.deploy_limit = 1;
    meta.purchasedUpgrades.roster_cap = 1;
    const effects = meta.getActiveEffects();
    expect(effects.deployBonus).toBe(1);
    expect(effects.rosterCapBonus).toBe(2);
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
  });

  it('has 41 total upgrades in data', () => {
    expect(upgradesData.length).toBe(41);
  });

  it('has correct category distribution', () => {
    const byCategory = {};
    for (const u of upgradesData) {
      byCategory[u.category] = (byCategory[u.category] || 0) + 1;
    }
    expect(byCategory.recruit_stats).toBe(12);
    expect(byCategory.lord_bonuses).toBe(10);
    expect(byCategory.economy).toBe(4);
    expect(byCategory.capacity).toBe(3);
    expect(byCategory.starting_equipment).toBe(4);
    expect(byCategory.starting_skills).toBe(8);
  });

  // --- Starting Equipment effects ---

  it('getActiveEffects returns starting equipment effects', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.weapon_forge = 2;
    meta.purchasedUpgrades.weapon_tier = 1;
    meta.purchasedUpgrades.starting_accessory = 3;
    meta.purchasedUpgrades.staff_upgrade = 1;
    const effects = meta.getActiveEffects();
    expect(effects.startingWeaponForge).toBe(2);
    expect(effects.deadlyArsenal).toBe(1);
    expect(effects.startingAccessoryTier).toBe(3);
    expect(effects.startingStaffTier).toBe(1);
  });

  it('getActiveEffects returns 0/false for unpurchased equipment upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    const effects = meta.getActiveEffects();
    expect(effects.startingWeaponForge).toBe(0);
    expect(effects.deadlyArsenal).toBe(0);
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

  it('assignSkill fails if lord already has max starting skills', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.purchasedUpgrades.unlock_luna = 1;
    meta.purchasedUpgrades.unlock_vantage = 1;
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

  it('getActiveEffects includes startingSkills from assignments', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.purchasedUpgrades.unlock_sol = 1;
    meta.assignSkill('Edric', 'sol');
    const effects = meta.getActiveEffects();
    expect(effects.startingSkills.Edric).toEqual(['sol']);
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
      totalValor: 100, totalSupply: 100,
      purchasedUpgrades: {}, milestones: ['beatAct1', 'beatAct2'],
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.hasMilestone('beatAct1')).toBe(true);
    expect(meta.hasMilestone('beatAct2')).toBe(true);
    expect(meta.hasMilestone('beatAct3')).toBe(false);
  });

  it('defaults milestones to empty for old saves without milestones field', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 100, totalSupply: 100,
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
    const fakeUpgrades = [...upgradesData, {
      id: 'test_beatgame', category: 'economy', maxLevel: 1,
      costs: [100], effects: [{ goldBonus: 1 }],
      requires: { milestones: ['beatGame'] },
    }];
    const meta2 = new MetaProgressionManager(fakeUpgrades);
    const info = meta2.getPrerequisiteInfo('test_beatgame');
    expect(info.met).toBe(false);
    expect(info.missing).toContain('Beat the Game');
  });
});

describe('calculateCurrencies', () => {
  it('awards currencies per act reached', () => {
    const { valor, supply } = calculateCurrencies(2, 0, false);
    expect(valor).toBe(100);  // 2 * 50
    expect(supply).toBe(100);
  });

  it('awards currencies per battle completed', () => {
    const { valor, supply } = calculateCurrencies(0, 5, false);
    expect(valor).toBe(75);  // 5 * 15
    expect(supply).toBe(75);
  });

  it('awards victory bonus to both currencies', () => {
    const { valor, supply } = calculateCurrencies(0, 0, true);
    expect(valor).toBe(200);
    expect(supply).toBe(200);
  });

  it('combines all components', () => {
    // 3 acts * 50 + 10 battles * 15 + 200 victory = 150 + 150 + 200 = 500
    const { valor, supply } = calculateCurrencies(3, 10, true);
    expect(valor).toBe(500);
    expect(supply).toBe(500);
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
