import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateLootChoices, generateShopInventory } from '../src/engine/LootSystem.js';
import { applyRewardTarget } from '../src/engine/LootRewardCommands.js';
import { purchaseShopItem, shopBuyBlock } from '../src/engine/ShopCommands.js';
import {
  ownedLegendaryNames,
  recordLegendaryGrant,
  sanitizeLegendaryGrants,
  legendaryExclusions,
} from '../src/engine/LegendaryOwnership.js';
import { RunManager } from '../src/engine/RunManager.js';
import { mulberry32 } from '../src/engine/CasterGear.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const legendNames = data.weapons.filter((w) => w.tier === 'Legend').map((w) => w.name);
const consumables = data.consumables;

let restore;
function seedRandom(seed) {
  const rng = mulberry32(seed);
  restore = vi.spyOn(Math, 'random').mockImplementation(rng);
}
afterEach(() => restore?.mockRestore());

// A roster that wields every weapon type, so no roster filter hides a legendary.
const roster = [
  {
    proficiencies: ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff'].map((type) => ({
      type,
      rank: 'Mast',
    })),
    inventory: [],
    consumables: [],
  },
];

function lootNames(excluded, seed, { bonus = 0, act = 'act3', trials = 150 } = {}) {
  seedRandom(seed);
  const seen = [];
  for (let i = 0; i < trials; i++) {
    const choices = generateLootChoices(
      act,
      data.lootTables,
      data.weapons,
      consumables,
      4,
      bonus,
      data.accessories,
      data.whetstones,
      roster,
      true,
      null,
      false,
      null,
      { excludeLegendaryNames: excluded },
    );
    for (const c of choices) if (c.item?.name) seen.push(c.item);
  }
  return seen;
}

describe('a legendary is granted once a run', () => {
  it('loot offers Ragnarok when unowned, and never once it is owned', () => {
    const before = lootNames([], 7).filter((i) => i.name === 'Ragnarok');
    expect(before.length).toBeGreaterThan(0);
    const after = lootNames(['Ragnarok'], 7).filter((i) => i.name === 'Ragnarok');
    expect(after).toHaveLength(0);
  });

  it('replaces the excluded roll with another legendary of the tier', () => {
    const seen = lootNames(['Ragnarok'], 11);
    expect(seen.some((i) => i.tier === 'Legend' && i.name !== 'Ragnarok')).toBe(true);
  });

  it('quality upgrades never land on an owned legendary', () => {
    const open = lootNames([], 3, { bonus: 100, act: 'act2' }).filter(
      (i) => i.tier === 'Legend' && i.type !== 'Staff',
    );
    expect(open.length).toBeGreaterThan(0);
    const allOwned = lootNames(legendNames, 3, { bonus: 100, act: 'act2' });
    expect(allOwned.filter((i) => i.tier === 'Legend' && i.type !== 'Staff')).toHaveLength(0);
    const one = lootNames(['Ragnarok'], 3, { bonus: 100, act: 'act2' });
    expect(one.some((i) => i.name === 'Ragnarok')).toBe(false);
  });

  it('adds no draw when nothing is owned (same seed, same cards)', () => {
    const run = (options) => {
      seedRandom(99);
      const out = generateLootChoices(
        'act3',
        data.lootTables,
        data.weapons,
        consumables,
        4,
        20,
        data.accessories,
        data.whetstones,
        roster,
        false,
        null,
        false,
        null,
        options,
      );
      restore.mockRestore();
      return out.map((c) => c.item?.name ?? `gold${c.goldAmount}`);
    };
    expect(run({ excludeLegendaryNames: [] })).toEqual(run({}));
  });

  // A sellable Legend sword: the shipped legendaries are unsellable (price 0), so the catalog
  // and the act's pool get one test blade.
  const shopCatalog = () => {
    const blade = { ...data.weapons.find((w) => w.name === 'Ragnarok'), name: 'Test Blade' };
    blade.price = 3000;
    const tables = structuredClone(data.lootTables);
    tables.act4.legendaryWeapon = ['Test Blade'];
    return { weapons: [...data.weapons, blade], tables };
  };
  const stock = (excluded) => {
    const { weapons, tables } = shopCatalog();
    seedRandom(5);
    const names = [];
    for (let i = 0; i < 300; i++)
      for (const e of generateShopInventory(
        'act4',
        tables,
        weapons,
        consumables,
        data.accessories,
        roster,
        null,
        { excludeLegendaryNames: excluded },
      ))
        names.push(e.item.name);
    return names;
  };

  it('shops stop stocking an owned legendary', () => {
    expect(stock([])).toContain('Test Blade');
    expect(stock(['Test Blade'])).not.toContain('Test Blade');
  });

  it('shops keep selling Warp Staff after one is owned', () => {
    expect(stock(['Warp Staff'])).toContain('Warp Staff');
  });
});

describe('the ledger', () => {
  const ragnarok = () => structuredClone(data.weapons.find((w) => w.name === 'Ragnarok'));

  it('keeps a legendary after it is sold or lost, under its base name', () => {
    const unit = {
      inventory: [],
      consumables: [],
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      stats: {},
    };
    const run = { roster: [unit], convoy: { weapons: [], consumables: [] } };
    const forged = { ...ragnarok(), name: 'Ragnarok +1' };
    expect(applyRewardTarget(run, forged, unit).ok).toBe(true);
    unit.inventory.length = 0;
    unit.weapon = null;
    expect([...ownedLegendaryNames(run)]).toEqual(['Ragnarok']);
  });

  it('ignores non-legendary grants and counts what the army holds without a ledger', () => {
    const run = { roster: [], convoy: { weapons: [ragnarok()], consumables: [] } };
    expect(recordLegendaryGrant(run, { name: 'Iron Sword', tier: 'Iron' })).toBe(false);
    expect(run.legendaryGrants).toBeUndefined();
    expect(ownedLegendaryNames(run).has('Ragnarok')).toBe(true);
    expect(sanitizeLegendaryGrants([1, '', 'A', 'A'])).toEqual(['A']);
  });

  it('blocks buying a legendary the run already owns, and records one it buys', () => {
    const staff = { ...data.weapons.find((w) => w.name === 'Ragnarok'), uid: 'x', price: 100 };
    const entry = { item: staff, price: 100, type: 'weapon' };
    const unit = { inventory: [], consumables: [], proficiencies: [], stats: {} };
    const run = {
      gold: 1000,
      roster: [unit],
      convoy: { weapons: [], consumables: [] },
      spendGold(n) {
        this.gold -= n;
        return true;
      },
      addGold(n) {
        this.gold += n;
      },
      addToConvoy(item) {
        this.convoy.weapons.push(item);
        return true;
      },
    };
    const stock = [entry];
    expect(purchaseShopItem(run, stock, entry, 'convoy').ok).toBe(true);
    expect(run.legendaryGrants).toEqual(['Ragnarok']);
    run.convoy.weapons.length = 0;
    const again = { ...entry, item: { ...staff } };
    expect(shopBuyBlock(run, [again], again)).toBe('Already owned this run.');
  });
});

describe('save and resume', () => {
  let storage;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips the ledger and loads an old save without one', () => {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    recordLegendaryGrant(rm, { name: 'Ragnarok', tier: 'Legend' });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(saved.legendaryGrants).toEqual(['Ragnarok']);
    expect(RunManager.fromJSON(saved, loadGameData()).legendaryGrants).toEqual(['Ragnarok']);
    delete saved.legendaryGrants;
    expect(RunManager.fromJSON(saved, loadGameData()).legendaryGrants).toEqual([]);
  });
});

describe('scope and old saves', () => {
  it('leaves Legend-tier staves repeatable', () => {
    const run = { roster: [], convoy: { weapons: [], consumables: [] } };
    expect(recordLegendaryGrant(run, { name: 'Warp Staff', tier: 'Legend', type: 'Staff' })).toBe(
      false,
    );
    run.convoy.weapons.push({ name: 'Fortify', tier: 'Legend', type: 'Staff' });
    expect(ownedLegendaryNames(run).size).toBe(0);
  });

  it('counts an imbued, forged legendary an old save holds', () => {
    const imbued = {
      name: 'Vampiric Ragnarok +1',
      _imbueId: 'vampiric',
      tier: 'Legend',
      type: 'Sword',
    };
    const run = { roster: [{ inventory: [imbued] }] };
    expect(ownedLegendaryNames(run).has('Ragnarok')).toBe(true);
    const ledger = {};
    recordLegendaryGrant(ledger, imbued);
    expect(ledger.legendaryGrants).toEqual(['Ragnarok']);
  });

  it('a corrupt ledger entry excludes nothing outside the Legend catalog', () => {
    const names = legendaryExclusions(
      ['Vulnerary', 'Iron Sword', 'Warp Staff', 'Ragnarok'],
      data.weapons,
    );
    expect([...names]).toEqual(['Ragnarok']);
  });

  it('refuses a reward card or shop entry for a legendary already owned', () => {
    const unit = {
      inventory: [],
      consumables: [],
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      stats: {},
    };
    const run = {
      roster: [unit],
      legendaryGrants: ['Ragnarok'],
      convoy: { weapons: [], consumables: [] },
    };
    const card = structuredClone(data.weapons.find((w) => w.name === 'Ragnarok'));
    expect(applyRewardTarget(run, card, unit)).toEqual({
      ok: false,
      reason: 'Already owned this run.',
    });
    const entry = { item: card, price: 999999, type: 'weapon' };
    expect(shopBuyBlock({ ...run, gold: 0 }, [entry], entry)).toBe('Already owned this run.');
  });
});
