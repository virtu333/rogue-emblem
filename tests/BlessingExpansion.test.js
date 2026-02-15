import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import { validateBlessingsConfig, selectBlessingOptionsWithTelemetry, createSeededRng } from '../src/engine/BlessingEngine.js';
import { getForgeCost } from '../src/engine/ForgeSystem.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const NEW_BLESSING_IDS = [
  'swift_instinct', 'field_medic', 'rally_cry', 'war_veteran',
  'frugal_smith', 'nomad_pact', 'terrain_mastery', 'blood_forge',
];

describe('Blessing Expansion — data validation', () => {
  it('blessings.json passes validateBlessingsConfig with all 18 entries', () => {
    const gameData = loadGameData();
    const result = validateBlessingsConfig(gameData.blessings);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(gameData.blessings.blessings).toHaveLength(18);
  });

  it('all 8 new blessings have valid schema shape', () => {
    const gameData = loadGameData();
    const index = new Map(gameData.blessings.blessings.map(b => [b.id, b]));
    for (const id of NEW_BLESSING_IDS) {
      const b = index.get(id);
      expect(b, `missing blessing: ${id}`).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect([1, 2, 3, 4]).toContain(b.tier);
      expect(b.description).toBeTruthy();
      expect(Array.isArray(b.boons)).toBe(true);
      expect(b.boons.length).toBeGreaterThan(0);
      expect(Array.isArray(b.costs)).toBe(true);
      for (const effect of [...b.boons, ...b.costs]) {
        expect(effect.type).toBeTruthy();
        expect(effect.params).toBeTruthy();
      }
    }
  });

  it('tier distribution: 5 T1, 6 T2, 5 T3, 2 T4 (18 total)', () => {
    const gameData = loadGameData();
    const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const b of gameData.blessings.blessings) tiers[b.tier]++;
    expect(tiers[1]).toBe(5);
    expect(tiers[2]).toBe(6);
    expect(tiers[3]).toBe(5);
    expect(tiers[4]).toBe(2);
  });
});

describe('Blessing Expansion — exclusion rules', () => {
  it('frugal_smith excludes merchant_bane (bidirectional)', () => {
    const gameData = loadGameData();
    const index = new Map(gameData.blessings.blessings.map(b => [b.id, b]));
    expect(index.get('frugal_smith').excludes).toContain('merchant_bane');
    expect(index.get('merchant_bane').excludes).toContain('frugal_smith');
  });

  it('nomad_pact excludes scout_blessing (bidirectional)', () => {
    const gameData = loadGameData();
    const index = new Map(gameData.blessings.blessings.map(b => [b.id, b]));
    expect(index.get('nomad_pact').excludes).toContain('scout_blessing');
    expect(index.get('scout_blessing').excludes).toContain('nomad_pact');
  });

  it('selection engine never co-offers excluded blessings', () => {
    const gameData = loadGameData();
    // Run many trials to exercise exclusion filtering
    for (let seed = 1; seed <= 100; seed++) {
      const rng = createSeededRng(seed);
      const result = selectBlessingOptionsWithTelemetry(gameData.blessings, rng, { count: 4, allowTier4: true });
      const ids = new Set(result.selected.map(b => b.id));
      if (ids.has('frugal_smith')) expect(ids.has('merchant_bane')).toBe(false);
      if (ids.has('merchant_bane')) expect(ids.has('frugal_smith')).toBe(false);
      if (ids.has('nomad_pact')) expect(ids.has('scout_blessing')).toBe(false);
      if (ids.has('scout_blessing')) expect(ids.has('nomad_pact')).toBe(false);
    }
  });
});

describe('Blessing Expansion — swift_instinct (data-only T1)', () => {
  it('lord_stat_bonus applies +1 SPD to lords only', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const lordSpds = rm.roster.filter(u => u.isLord).map(u => u.stats.SPD);

    rm.activeBlessings = ['swift_instinct'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.filter(u => u.isLord).forEach((unit, idx) => {
      expect(unit.stats.SPD).toBe(lordSpds[idx] + 1);
    });
  });
});

describe('Blessing Expansion — field_medic (starting_consumable_all)', () => {
  it('gives every roster unit a Vulnerary at run start', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseCounts = rm.roster.map(u => (u.consumables || []).length);

    rm.activeBlessings = ['field_medic'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      expect(unit.consumables.length).toBe(baseCounts[idx] + 1);
      const added = unit.consumables[unit.consumables.length - 1];
      expect(added.name).toBe('Vulnerary');
    });
  });

  it('does not crash or add if consumable already at cap', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    // Fill consumables to max (3)
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    for (const unit of rm.roster) {
      while (unit.consumables.length < 3) unit.consumables.push(structuredClone(vuln));
    }

    rm.activeBlessings = ['field_medic'];
    rm._runStartBlessingsApplied = false;
    expect(() => rm.applyRunStartBlessingEffects()).not.toThrow();
    // No overflow
    rm.roster.forEach(unit => {
      expect(unit.consumables.length).toBeLessThanOrEqual(3);
    });
  });
});

describe('Blessing Expansion — rally_cry (data-only T2)', () => {
  it('applies +2 STR in Act 1 and -10% battle gold', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseStrs = rm.roster.map(u => u.stats.STR);
    const baseMultiplier = rm.getBattleGoldMultiplier();

    rm.activeBlessings = ['rally_cry'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      expect(unit.stats.STR).toBe(baseStrs[idx] + 2);
    });
    expect(rm.getBattleGoldMultiplier()).toBeCloseTo(baseMultiplier - 0.1, 5);
  });
});

describe('Blessing Expansion — war_veteran (xp_multiplier_delta)', () => {
  it('stores xpMultiplierDelta=0.15 and subtracts 100 gold', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseGold = rm.gold;

    rm.activeBlessings = ['war_veteran'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.15, 5);
    expect(rm.gold).toBe(baseGold - 100);
  });

  it('round-trips xpMultiplierDelta through toJSON/fromJSON', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['war_veteran'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    expect(restored.getXpMultiplierDelta()).toBeCloseTo(0.15, 5);
  });
});

describe('Blessing Expansion — frugal_smith (forge_cost_discount)', () => {
  it('stores forgeCostDiscount=0.20 and reduces shop items by 1', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['frugal_smith'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getForgeCostDiscount()).toBeCloseTo(0.20, 5);
    expect(rm.getShopItemCountDelta()).toBe(-1);
  });

  it('discount reduces effective forge cost', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['frugal_smith'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    // Simulate forge cost calculation as NodeMapScene does
    const weapon = rm.roster[0].weapon;
    if (weapon) {
      const baseCost = getForgeCost(weapon, 'might');
      const discount = rm.getForgeCostDiscount();
      const discountedCost = Math.max(1, Math.floor(baseCost * (1 - discount)));
      expect(discountedCost).toBeLessThan(baseCost);
      expect(discountedCost).toBe(Math.max(1, Math.floor(baseCost * 0.8)));
    }
  });

  it('round-trips forgeCostDiscount through toJSON/fromJSON', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['frugal_smith'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    expect(restored.getForgeCostDiscount()).toBeCloseTo(0.20, 5);
  });
});

describe('Blessing Expansion — nomad_pact (recruit_level_bonus)', () => {
  it('stores recruitLevelBonus=1 and reduces deploy cap by 1', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseDeploy = rm.getDeployBonus();

    rm.activeBlessings = ['nomad_pact'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getRecruitLevelBonus()).toBe(1);
    expect(rm.getDeployBonus()).toBe(baseDeploy - 1);
  });

  it('round-trips recruitLevelBonus through toJSON/fromJSON', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['nomad_pact'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    expect(restored.getRecruitLevelBonus()).toBe(1);
  });
});

describe('Blessing Expansion — terrain_mastery (terrain_combat_bonus)', () => {
  it('stores terrain combat bonuses for Forest and Fort', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['terrain_mastery'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const bonuses = rm.getTerrainCombatBonuses();
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0].terrains).toEqual(['Forest', 'Fort']);
    expect(bonuses[0].avoidBonus).toBe(5);
    expect(bonuses[0].defBonus).toBe(1);
  });

  it('applies -2 LCK to lords as cost', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const lordLcks = rm.roster.filter(u => u.isLord).map(u => u.stats.LCK);

    rm.activeBlessings = ['terrain_mastery'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.filter(u => u.isLord).forEach((unit, idx) => {
      expect(unit.stats.LCK).toBe(lordLcks[idx] - 2);
    });
  });

  it('round-trips terrainCombatBonuses through toJSON/fromJSON', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['terrain_mastery'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    const bonuses = restored.getTerrainCombatBonuses();
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0].terrains).toEqual(['Forest', 'Fort']);
    expect(bonuses[0].avoidBonus).toBe(5);
    expect(bonuses[0].defBonus).toBe(1);
  });
});

describe('Blessing Expansion — blood_forge (starting_forge_lords T4)', () => {
  it('applies +1 might forge to each lord weapon', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const lordWeapons = rm.roster.filter(u => u.isLord && u.weapon).map(u => ({
      name: u.name,
      baseMight: u.weapon.might,
    }));

    rm.activeBlessings = ['blood_forge'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.filter(u => u.isLord && u.weapon).forEach((unit, idx) => {
      expect(unit.weapon.might).toBe(lordWeapons[idx].baseMight + 1);
      expect(unit.weapon._forgeLevel).toBeGreaterThanOrEqual(1);
    });
  });

  it('applies -2 DEF to all units in Act 1 as cost', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseDefs = rm.roster.map(u => u.stats.DEF);

    rm.activeBlessings = ['blood_forge'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      expect(unit.stats.DEF).toBe(baseDefs[idx] - 2);
    });
  });
});

describe('Blessing Expansion — serialization round-trip (all new fields)', () => {
  it('old saves without new modifier fields get safe defaults', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    delete json.blessingRuntimeModifiers.xpMultiplierDelta;
    delete json.blessingRuntimeModifiers.forgeCostDiscount;
    delete json.blessingRuntimeModifiers.recruitLevelBonus;
    delete json.blessingRuntimeModifiers.terrainCombatBonuses;

    const restored = RunManager.fromJSON(json, gameData);
    expect(restored.getXpMultiplierDelta()).toBe(0);
    expect(restored.getForgeCostDiscount()).toBe(0);
    expect(restored.getRecruitLevelBonus()).toBe(0);
    expect(restored.getTerrainCombatBonuses()).toEqual([]);
  });
});
