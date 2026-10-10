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
  it('blessings.json passes validation with 44 entries (40 offered, 4 earned)', () => {
    const gameData = loadGameData();
    const result = validateBlessingsConfig(gameData.blessings);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(gameData.blessings.blessings).toHaveLength(44);
    expect(gameData.blessings.blessings.filter((b) => b.earned)).toHaveLength(4);
  });

  it('tier distribution is 4/15/15/6', () => {
    const gameData = loadGameData();
    const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
    // Earned blessings have no tier; they are not part of the offered split.
    for (const blessing of gameData.blessings.blessings.filter((b) => !b.earned))
      tiers[blessing.tier]++;
    expect(tiers[1]).toBe(4);
    expect(tiers[2]).toBe(15);
    expect(tiers[3]).toBe(15);
    expect(tiers[4]).toBe(6);
  });

  // Blessings v3 (docs/specs/blessings-v3.md §4): retiered by what they are worth, every
  // tier IV a pact, Armory Stash out of the offers, Blessed Vigor +4.
  it('the 2026-10-09 blessing pass', () => {
    const index = new Map(loadGameData().blessings.blessings.map((b) => [b.id, b]));
    const tierOf = (id) => index.get(id).tier;
    for (const id of ['scout_blessing', 'blood_forge', 'pilgrim_coin'])
      expect(tierOf(id), id).toBe(2);
    for (const id of ['iron_oath', 'war_veteran']) expect(tierOf(id), id).toBe(3);
    expect(tierOf('scholar_vow')).toBe(4);
    expect(index.get('scholar_vow').pact).toEqual(['recruits_level_down', 'debt_large']);
    expect(index.get('armory_stash').weight).toBe(0);
    expect(index.get('blessed_vigor').boons[0].params.value).toBe(4);
    // Hold the Line (was Terrain Mastery): a unit that has not moved gets +2 DEF and +10 Avoid.
    expect(index.get('terrain_mastery').name).toBe('Hold the Line');
    expect(index.get('terrain_mastery').boons).toEqual([
      { type: 'stationary_combat_bonus', params: { defBonus: 2, avoidBonus: 10 } },
    ]);
    expect(index.get('steady_hands').name).toBe('Keen Eye');
    expect(index.get('steady_hands').boons).toEqual([
      { type: 'first_strike_hit_bonus', params: { value: 10 } },
    ]);
    expect(index.get('nomad_pact').boons[0].params.value).toBe(2);
    for (const b of index.values()) {
      if (b.tier === 4) expect(Array.isArray(b.pact), b.id).toBe(true);
      // A tier II-III card names candidate prices, or carries its cost in its own boon.
      if (b.tier === 2 || b.tier === 3)
        expect((b.prices?.length || 0) + (b.intrinsicPrice ? 1 : 0), b.id).toBeGreaterThan(0);
    }
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
  it('forge_cost_multiplier is still a discount (an effect of its own, no card carries it now)', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm._applySingleRunStartBlessingEffect('synthetic', {
      type: 'forge_cost_multiplier',
      params: { value: -0.3 },
    });

    expect(rm.getForgeCostDiscount()).toBeCloseTo(0.3, 5);
    const weapon = rm.roster[0].weapon;
    if (weapon) {
      const baseCost = getForgeCost(weapon, 'might');
      const discountedCost = Math.max(1, Math.floor(baseCost * (1 - rm.getForgeCostDiscount())));
      expect(discountedCost).toBeLessThan(baseCost);
    }
  });

  it("frugal_smith (Smith's Mark) frees each shop's first forge and adds a forge, with no discount", () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = [activeBlessing('frugal_smith')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getFreeForgesPerShop()).toBe(1);
    expect(rm.blessingRuntimeModifiers.forgeLimitDelta).toBe(1);
    expect(rm.getForgeCostDiscount()).toBe(0);
  });

  it('quartermaster_cache puts an Elixir in the convoy at once, not in the lords bags', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const lordBags = rm.roster.filter((u) => u.isLord).map((u) => u.consumables.length);
    rm.activeBlessings = [activeBlessing('quartermaster_cache')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getConvoyItems().consumables.map((item) => item.name)).toEqual(['Elixir']);
    expect(rm.roster.filter((u) => u.isLord).map((u) => u.consumables.length)).toEqual(lordBags);
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

  it('blood_forge forges each starting lord’s strongest weapon twice and nothing else', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const steel = edric.inventory.find((w) => w.name === 'Steel Sword');

    rm.activeBlessings = [activeBlessing('blood_forge')];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(steel._forgeLevel).toBe(2);
    expect(steel.might).toBe(10);
    expect(edric.inventory.find((w) => w.name === 'Iron Sword').might).toBe(5);
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
