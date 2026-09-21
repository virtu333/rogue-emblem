import { it, expect } from 'vitest';
import { actShopPrice } from '../src/engine/ShopEconomy.js';
import { generateShopInventory, getSellPrice } from '../src/engine/LootSystem.js';
import { loadGameData } from './testData.js';
it('preserves opening prices and marks up only new later-act offers, not resale values', () => {
  expect(actShopPrice(1000, 'act1')).toBe(1000);
  expect(actShopPrice(1000, 'act3')).toBe(1300);
  const data = loadGameData();
  const stock = generateShopInventory(
    'act3',
    data.lootTables,
    data.weapons,
    data.consumables,
    data.accessories,
  );
  expect(stock.length).toBeGreaterThan(0);
  for (const row of stock) {
    expect(row.price).toBe(actShopPrice(row.item.price, 'act3'));
    expect(getSellPrice(row.item)).toBeLessThan(row.item.price);
  }
  expect(JSON.parse(JSON.stringify(stock))).toEqual(stock);
});
