import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import {
  validateBlessingsConfig,
  selectBlessingOptionsWithTelemetry,
  createSeededRng,
} from '../src/engine/BlessingEngine.js';
import { getForgeCost } from '../src/engine/ForgeSystem.js';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function activeBlessing(id, rolledCost = null) {
  return { id, rolledCost };
}

describe('Blessing Expansion v2 � data validation', () => {
  it('blessings.json passes validation with 23 entries', () => {
    const gameData = loadGameData();
    const result = validateBlessingsConfig(gameData.blessings);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(gameData.blessings.blessings).toHaveLength(23);
  });

  it('tier distribution is 5/6/6/6', () => {
    const gameData = loadGameData();
    const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const blessing of gameData.blessings.blessings) tiers[blessing.tier]++;
    expect(tiers[1]).toBe(5);
    expect(tiers[2]).toBe(6);
    expect(tiers[3]).toBe(6);
    expect(tiers[4]).toBe(6);
  });

  it('tier2+ blessings use runtime rolled costs only', () => {
    const gameData = loadGameData();
    for (const blessing of gameData.blessings.blessings) {
      expect(Array.isArray(blessing.costs)).toBe(true);
      expect(blessing.costs).toHaveLength(0);
    }
    expect(Object.keys(gameData.blessings.costPools).sort()).toEqual(['2', '3', '4']);
    expect(gameData.blessings.costPools['2'].length).toBeGreaterThan(0);
    expect(gameData.blessings.costPools['3'].length).toBeGreaterThan(0);
    expect(gameData.blessings.costPools['4'].length).toBeGreaterThan(0);
  });
});

describe('Blessing Expansion v2 � selection and exclusions', () => {
  it('keeps exclusion pairs bidirectional', () => {
    const gameData = loadGameData();
    const index = new Map(gameData.blessings.blessings.map((b) => [b.id, b]));
    expect(index.get('frugal_smith').excludes).toContain('merchant_bane');
    expect(index.get('merchant_bane').excludes).toContain('frugal_smith');
    expect(index.get('nomad_pact').excludes).toContain('scout_blessing');
    expect(index.get('scout_blessing').excludes).toContain('nomad_pact');
  });

  it('selection never co-offers excluded blessings and rolls runtime costs for tier2+', () => {
    const gameData = loadGameData();
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createSeededRng(seed);
      const { selected } = selectBlessingOptionsWithTelemetry(gameData.blessings, rng, {
        count: 4,
        allowTier4: true,
      });
      const ids = new Set(selected.map((b) => b.id));
      if (ids.has('frugal_smith')) expect(ids.has('merchant_bane')).toBe(false);
      if (ids.has('merchant_bane')) expect(ids.has('frugal_smith')).toBe(false);
      if (ids.has('nomad_pact')) expect(ids.has('scout_blessing')).toBe(false);
      if (ids.has('scout_blessing')) expect(ids.has('nomad_pact')).toBe(false);

      for (const blessing of selected) {
        if (blessing.tier >= 2) expect(blessing.rolledCost).toBeTruthy();
      }
    }
  });
});

describe('Blessing Expansion v2 � effect handlers', () => {
  it('frugal_smith applies forge_cost_multiplier as a discount', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = [activeBlessing('frugal_smith')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getForgeCostDiscount()).toBeCloseTo(0.2, 5);
    const weapon = rm.roster[0].weapon;
    if (weapon) {
      const baseCost = getForgeCost(weapon, 'might');
      const discountedCost = Math.max(1, Math.floor(baseCost * (1 - rm.getForgeCostDiscount())));
      expect(discountedCost).toBeLessThan(baseCost);
    }
  });

  it('quartermaster_cache grants vulneraries to lords with convoy overflow handling', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const lordConsumableCounts = rm.roster.filter((u) => u.isLord).map((u) => u.consumables.length);
    rm.activeBlessings = [activeBlessing('quartermaster_cache')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster
      .filter((u) => u.isLord)
      .forEach((unit, idx) => {
        expect(unit.consumables.length).toBeGreaterThanOrEqual(lordConsumableCounts[idx]);
        expect(unit.consumables.some((item) => item.name === 'Vulnerary')).toBe(true);
      });
  });

  it('focused_curriculum applies targeted lord growths and updates growth bonus APIs', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const beforeLord = rm.roster
      .filter((u) => u.isLord)
      .map((u) => ({ SPD: u.growths.SPD, SKL: u.growths.SKL }));
    const beforeRecruit = rm.roster
      .filter((u) => !u.isLord)
      .map((u) => ({ SPD: u.growths.SPD, SKL: u.growths.SKL }));

    rm.activeBlessings = [activeBlessing('focused_curriculum')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster
      .filter((u) => u.isLord)
      .forEach((unit, idx) => {
        expect(unit.growths.SPD).toBe(beforeLord[idx].SPD + 12);
        expect(unit.growths.SKL).toBe(beforeLord[idx].SKL + 12);
      });
    rm.roster
      .filter((u) => !u.isLord)
      .forEach((unit, idx) => {
        expect(unit.growths.SPD).toBe(beforeRecruit[idx].SPD);
        expect(unit.growths.SKL).toBe(beforeRecruit[idx].SKL);
      });

    const recruitBonuses = rm.getEffectiveRecruitGrowthBonuses() || {};
    const lordBonuses = rm.getEffectiveLordGrowthBonuses() || {};
    expect(recruitBonuses.SPD || 0).toBe(0);
    expect(lordBonuses.SPD || 0).toBe(12);
    expect(lordBonuses.SKL || 0).toBe(12);
  });

  it('blood_forge uses starting_weapon_forge_delta and increases lord weapon forge level', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const before = rm.roster
      .filter((u) => u.isLord)
      .map((u) => (u.weapon ? u.weapon._forgeLevel || 0 : 0));

    rm.activeBlessings = [activeBlessing('blood_forge')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster
      .filter((u) => u.isLord)
      .forEach((unit, idx) => {
        if (!unit.weapon) return;
        expect(unit.weapon._forgeLevel || 0).toBeGreaterThanOrEqual(before[idx] + 1);
      });
  });

  it('starting_scroll grants deterministic scrolls for same seed', () => {
    const gameData = loadGameData();
    const a = new RunManager(gameData);
    const b = new RunManager(gameData);

    a.startRun({ runSeed: 777 });
    b.startRun({ runSeed: 777 });

    a.activeBlessings = [activeBlessing('scroll_archive')];
    b.activeBlessings = [activeBlessing('scroll_archive')];
    a._runStartBlessingsApplied = false;
    b._runStartBlessingsApplied = false;
    a.applyRunStartBlessingEffects();
    b.applyRunStartBlessingEffects();

    expect(a.scrolls.map((s) => s.name)).toEqual(b.scrolls.map((s) => s.name));
  });
});
