import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaProgressionManager, calculateRenown } from '../src/engine/MetaProgressionManager.js';
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

  it('starts with 0 renown and no upgrades', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalRenown()).toBe(0);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
  });

  it('loads saved state from localStorage', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalRenown: 500,
      purchasedUpgrades: { recruit_hp_growth: 3 },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalRenown()).toBe(500);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(3);
  });

  it('addRenown increases total and persists', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.addRenown(100);
    expect(meta.getTotalRenown()).toBe(100);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('getNextCost returns correct cost for each level of 5-tier growth upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getNextCost('recruit_hp_growth')).toBe(50);   // L0 → cost[0]
    meta.purchasedUpgrades.recruit_hp_growth = 1;
    expect(meta.getNextCost('recruit_hp_growth')).toBe(75);   // L1 → cost[1]
    meta.purchasedUpgrades.recruit_hp_growth = 4;
    expect(meta.getNextCost('recruit_hp_growth')).toBe(250);  // L4 → cost[4]
    meta.purchasedUpgrades.recruit_hp_growth = 5;
    expect(meta.getNextCost('recruit_hp_growth')).toBeNull();  // maxed
  });

  it('getNextCost returns correct cost for 3-tier flat upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getNextCost('recruit_hp_flat')).toBe(200);
    meta.purchasedUpgrades.recruit_hp_flat = 2;
    expect(meta.getNextCost('recruit_hp_flat')).toBe(700);
    meta.purchasedUpgrades.recruit_hp_flat = 3;
    expect(meta.getNextCost('recruit_hp_flat')).toBeNull();
  });

  it('getNextCost returns null for unknown upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getNextCost('nonexistent')).toBeNull();
  });

  it('canAfford returns true when enough renown', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 50;
    expect(meta.canAfford('recruit_hp_growth')).toBe(true);
  });

  it('canAfford returns false when insufficient renown', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 30;
    expect(meta.canAfford('recruit_hp_growth')).toBe(false);
  });

  it('canAfford returns false for maxed upgrade', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 9999;
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

  it('purchaseUpgrade deducts renown and increments level', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 300;
    const result = meta.purchaseUpgrade('recruit_hp_growth');
    expect(result).toBe(true);
    expect(meta.getTotalRenown()).toBe(250); // 300 - 50
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(1);
  });

  it('purchaseUpgrade fails with insufficient renown', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 30;
    const result = meta.purchaseUpgrade('recruit_hp_growth');
    expect(result).toBe(false);
    expect(meta.getTotalRenown()).toBe(30);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
  });

  it('purchaseUpgrade fails when already maxed', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 9999;
    meta.purchasedUpgrades.deploy_limit = 1;
    const result = meta.purchaseUpgrade('deploy_limit');
    expect(result).toBe(false);
    expect(meta.getTotalRenown()).toBe(9999);
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
      totalRenown: 100,
      purchasedUpgrades: {},
      runsCompleted: 5,
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getRunsCompleted()).toBe(5);
  });

  it('defaults runsCompleted to 0 for old saves without it', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalRenown: 100,
      purchasedUpgrades: {},
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getRunsCompleted()).toBe(0);
  });

  it('reset clears all data including runsCompleted and persists', () => {
    const meta = new MetaProgressionManager(upgradesData);
    meta.totalRenown = 999;
    meta.purchasedUpgrades.recruit_hp_growth = 3;
    meta.runsCompleted = 7;
    meta.reset();
    expect(meta.getTotalRenown()).toBe(0);
    expect(meta.getUpgradeLevel('recruit_hp_growth')).toBe(0);
    expect(meta.getRunsCompleted()).toBe(0);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('handles corrupted localStorage gracefully', () => {
    store['emblem_rogue_meta_save'] = 'not valid json{{{';
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalRenown()).toBe(0);
  });

  it('silently ignores old upgrade IDs in saved state', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalRenown: 500,
      purchasedUpgrades: { recruit_hp: 2, lord_hp: 1 },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.getTotalRenown()).toBe(500);
    // Old IDs load into purchasedUpgrades but getActiveEffects ignores them
    // since they don't match any upgradesData entry
    const effects = meta.getActiveEffects();
    expect(effects.growthBonuses.HP).toBeUndefined();
    expect(effects.lordGrowthBonuses.HP).toBeUndefined();
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
      totalRenown: 100,
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
});

describe('calculateRenown', () => {
  it('awards renown per act reached', () => {
    expect(calculateRenown(2, 0, false)).toBe(100); // 2 * 50
  });

  it('awards renown per battle completed', () => {
    expect(calculateRenown(0, 5, false)).toBe(75); // 5 * 15
  });

  it('awards victory bonus', () => {
    expect(calculateRenown(0, 0, true)).toBe(200);
  });

  it('combines all components', () => {
    // 3 acts * 50 + 10 battles * 15 + 200 victory = 150 + 150 + 200 = 500
    expect(calculateRenown(3, 10, true)).toBe(500);
  });

  it('returns 0 for act 0, 0 battles, no victory', () => {
    expect(calculateRenown(0, 0, false)).toBe(0);
  });
});
