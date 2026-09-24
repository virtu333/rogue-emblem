import { beforeEach, describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import {
  purchaseShopItem,
  sellShopItem,
  shopOwnedItems,
  forgeShopWeapon,
} from '../src/engine/ShopCommands.js';
import { applyForge, getForgeCost } from '../src/engine/ForgeSystem.js';
import { getSellPrice } from '../src/engine/LootSystem.js';
import { FORGE_STAT_CAP, FORGE_MAX_LEVEL } from '../src/utils/constants.js';

const data = loadGameData();
const clone = (value) => structuredClone(value);
let run, unit;
const sword = () => clone(data.weapons.find((item) => item.name === 'Iron Sword'));
const supply = () => clone(data.consumables.find((item) => item.name === 'Vulnerary'));
const entryFor = (item, type = item.type === 'Consumable' ? 'consumable' : 'weapon') => ({
  item,
  type,
  price: item.price,
});
const ownedRow = (item) => shopOwnedItems(run).find((row) => row.item === item);
const state = () => JSON.stringify({ gold: run.gold, roster: run.roster, convoy: run.convoy });
const forgeOptions = (weapon, overrides = {}) => ({
  forgesUsed: 0,
  forgeLimit: 2,
  discount: 0,
  expectedLevel: weapon._forgeLevel || 0,
  ...overrides,
});
beforeEach(() => {
  run = new RunManager(data);
  run.gold = 10000;
  const weapon = sword();
  unit = {
    name: 'Edric',
    stats: { HP: 22 },
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    inventory: [weapon],
    weapon,
    consumables: [],
  };
  run.roster = [unit];
});

describe('shop purchase transaction boundaries', () => {
  it('rejects an equivalent-looking stock object and a replaced recipient identity without spending', () => {
    const entry = entryFor(sword()),
      stock = [entry];
    const before = state();
    expect(purchaseShopItem(run, stock, clone(entry), unit).ok).toBe(false);
    expect(purchaseShopItem(run, stock, entry, clone(unit)).ok).toBe(false);
    expect(state()).toBe(before);
    expect(stock).toEqual([entry]);
  });
  it('claims stock exactly once and grants an independent item', () => {
    const entry = entryFor(sword()),
      stock = [entry],
      gold = run.gold;
    expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(true);
    expect(run.gold).toBe(gold - entry.price);
    expect(unit.inventory).toHaveLength(2);
    expect(unit.inventory[1]).not.toBe(entry.item);
    const after = state();
    expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(false);
    expect(state()).toBe(after);
    expect(stock).toEqual([]);
  });
  it.each(['weapon', 'consumable'])('routes a full %s bag to the real convoy API', (type) => {
    const isSupply = type === 'consumable',
      item = isSupply ? supply() : sword();
    const bag = isSupply ? 'consumables' : 'inventory',
      cap = isSupply ? 3 : 5;
    unit[bag] = Array.from({ length: cap }, () => clone(item));
    const entry = entryFor(item, type),
      stock = [entry],
      gold = run.gold;
    expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(true);
    expect(unit[bag]).toHaveLength(cap);
    expect(run.convoy[isSupply ? 'consumables' : 'weapons']).toHaveLength(1);
    expect(run.gold).toBe(gold - entry.price);
    expect(stock).toEqual([]);
  });
  it.each(['weapon', 'consumable'])(
    'refunds failed %s convoy overflow and retains stock',
    (type) => {
      const isSupply = type === 'consumable',
        item = isSupply ? supply() : sword();
      const bag = isSupply ? 'consumables' : 'inventory',
        bucket = isSupply ? 'consumables' : 'weapons';
      unit[bag] = Array.from({ length: isSupply ? 3 : 5 }, () => clone(item));
      run.convoy[bucket] = Array.from({ length: run.getConvoyCapacities()[bucket] }, () =>
        clone(item),
      );
      const entry = entryFor(item, type),
        stock = [entry],
        before = state();
      expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(false);
      expect(state()).toBe(before);
      expect(stock).toEqual([entry]);
      expect(purchaseShopItem(run, stock, entry, 'convoy').ok).toBe(false);
      expect(state()).toBe(before);
    },
  );
  it.each(['scroll', 'accessory'])(
    'puts %s in its team pool independently of bag capacity',
    (type) => {
      const item = clone(
        type === 'scroll' ? data.weapons.find((w) => w.type === 'Scroll') : data.accessories[0],
      );
      const entry = entryFor(item, type),
        stock = [entry],
        gold = run.gold;
      const pool = type === 'scroll' ? 'scrolls' : 'accessories';
      run[pool] = [];
      expect(purchaseShopItem(run, stock, entry).ok).toBe(true);
      expect(run[pool]).toHaveLength(1);
      expect(run[pool][0]).not.toBe(item);
      expect(run[pool][0]).toMatchObject(item);
      expect(run.gold).toBe(gold - entry.price);
      expect(unit.inventory).toHaveLength(1);
      expect(stock).toEqual([]);
    },
  );
  it('rejects unaffordable or invalid prices without changing the item pools', () => {
    for (const price of [run.gold + 1, -1, NaN]) {
      const entry = { ...entryFor(sword()), price },
        stock = [entry],
        before = state();
      expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(false);
      expect(state()).toBe(before);
      expect(stock).toEqual([entry]);
    }
  });
  it('allows carrying a weapon without proficiency; possession is not equipment', () => {
    const bow = clone(data.weapons.find((w) => w.name === 'Iron Bow'));
    const entry = entryFor(bow),
      originalWeapon = unit.weapon;
    expect(purchaseShopItem(run, [entry], entry, unit).ok).toBe(true);
    expect(unit.inventory.at(-1).name).toBe('Iron Bow');
    expect(unit.weapon).toBe(originalWeapon);
  });
});

describe('shop sell ownership and equipment safety', () => {
  it('refuses the last combat weapon even when a non-proficient weapon is carried', () => {
    unit.inventory.push(clone(data.weapons.find((w) => w.name === 'Iron Bow')));
    const before = state();
    expect(sellShopItem(run, ownedRow(unit.weapon)).ok).toBe(false);
    expect(state()).toBe(before);
  });
  it('auto-equips the remaining usable weapon and prevents selling the stale row twice', () => {
    const sold = unit.weapon,
      remaining = sword();
    unit.inventory.push(remaining);
    const row = ownedRow(sold),
      gold = run.gold;
    expect(sellShopItem(run, row).ok).toBe(true);
    expect(unit.weapon).toBe(remaining);
    expect(run.gold).toBe(gold + getSellPrice(sold));
    const after = state();
    expect(sellShopItem(run, row).ok).toBe(false);
    expect(state()).toBe(after);
  });
  it('rejects a replaced item object even when its name and fields match', () => {
    const original = sword();
    unit.inventory.push(original);
    const row = ownedRow(original);
    unit.inventory[1] = clone(original);
    const before = state();
    expect(sellShopItem(run, row).ok).toBe(false);
    expect(state()).toBe(before);
  });
  it.each(['weapons', 'consumables'])(
    'sells the selected convoy %s item after its index changes',
    (bucket) => {
      const make = bucket === 'weapons' ? sword : supply;
      run.convoy[bucket] = [make(), make()];
      const selected = run.convoy[bucket][1],
        row = ownedRow(selected),
        gold = run.gold;
      run.takeFromConvoy(bucket === 'weapons' ? 'weapon' : 'consumable', 0);
      expect(sellShopItem(run, row).ok).toBe(true);
      expect(run.convoy[bucket]).toEqual([]);
      expect(run.gold).toBe(gold + getSellPrice(selected));
    },
  );
});

describe('shop forge mutation guards', () => {
  it('charges the discounted canonical cost once and blocks a repeated stale confirmation', () => {
    const weapon = unit.weapon,
      options = forgeOptions(weapon, { discount: 0.3 });
    const gold = run.gold,
      might = weapon.might;
    const cost = Math.max(1, Math.floor(getForgeCost(weapon, 'might') * 0.7));
    expect(forgeShopWeapon(run, weapon, 'might', options).ok).toBe(true);
    expect(weapon.might).toBe(might + 1);
    expect(weapon._forgeLevel).toBe(1);
    expect(run.gold).toBe(gold - cost);
    const after = state();
    expect(forgeShopWeapon(run, weapon, 'might', options).ok).toBe(false);
    expect(state()).toBe(after);
  });
  it.each([
    'gold',
    'shop-cap',
    'stat-cap',
    'total-cap',
    'stale-level',
    'stale-owner',
    'invalid-stat',
    'invalid-discount',
  ])('blocks %s before mutating gold or weapon', (reason) => {
    const weapon = unit.weapon;
    let stat = 'might';
    let options = forgeOptions(weapon);
    if (reason === 'gold') run.gold = getForgeCost(weapon, stat) - 1;
    if (reason === 'shop-cap') options.forgesUsed = options.forgeLimit;
    if (reason === 'stat-cap') {
      for (let i = 0; i < FORGE_STAT_CAP; i++) applyForge(weapon, stat);
      options = forgeOptions(weapon);
    }
    if (reason === 'total-cap') {
      weapon._forgeLevel = FORGE_MAX_LEVEL;
      options = forgeOptions(weapon);
    }
    if (reason === 'stale-level') options.expectedLevel = 1;
    if (reason === 'stale-owner') unit.inventory[0] = clone(weapon);
    if (reason === 'invalid-stat') stat = 'speed';
    if (reason === 'invalid-discount') options.discount = 1;
    const before = state(),
      weaponBefore = clone(weapon);
    expect(forgeShopWeapon(run, weapon, stat, options).ok).toBe(false);
    expect(state()).toBe(before);
    expect(weapon).toEqual(weaponBefore);
  });
});

it('does not spend gold or mutate a zero-weight weapon and leaves other forge stats available', () => {
  const weapon = unit.inventory[0];
  weapon.weight = 0;
  const before = state();
  const options = forgeOptions(weapon);
  expect(forgeShopWeapon(run, weapon, 'weight', options)).toEqual({
    ok: false,
    reason: 'Already at minimum weight.',
  });
  expect(state()).toBe(before);
  expect(options.forgesUsed).toBe(0);
  expect(forgeShopWeapon(run, weapon, 'might', options).ok).toBe(true);
});

it('buy and equip swaps the old accessory back to the pool and cannot buy twice', () => {
  const old = clone(data.accessories[0]);
  unit.accessory = old;
  const entry = entryFor(clone(data.accessories[1]), 'accessory');
  const stock = [entry];
  const gold = run.gold;
  expect(purchaseShopItem(run, stock, entry, clone(unit)).ok).toBe(false);
  expect(run.gold).toBe(gold);
  expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(true);
  expect(unit.accessory.name).toBe(entry.item.name);
  expect(run.accessories).toContain(old);
  expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(false);
  expect(run.gold).toBe(gold - entry.price);
});
