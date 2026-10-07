// The Gold Pouch (docs/specs/phase3.md 3G): what a Thief steals when a foe carried gold.
// Using it pays the army its value; selling it pays the same; it is never worth more one
// way than the other, never an item a shop stocks or a loot roll draws.
//   - Use from the bag or straight from the convoy pays the figure on this pouch, once;
//   - an invalid pouch is refused and costs nothing;
//   - selling pays exactly the value (so no gain from the choice);
//   - the catalog's pouch is never edited by making a stronger one;
//   - the pouch never enters shop stock or the loot pools.
import { describe, expect, it } from 'vitest';

import { RunManager } from '../src/engine/RunManager.js';
import { rosterItemAction, rosterItemBlock } from '../src/engine/RosterInventory.js';
import { sellShopItem } from '../src/engine/ShopCommands.js';
import { GOLD_POUCH_NAME, goldPouchPriceFor, goldPouchValue, isGoldPouch, makeGoldPouch } from '../src/engine/GoldPouch.js'; // prettier-ignore
import { getConsumableDescription } from '../src/utils/consumableText.js';
import { getSellPrice } from '../src/engine/LootSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const template = data.consumables.find((c) => c.name === GOLD_POUCH_NAME);
const pouch = (value, uid = `itm_pouch_${value}`) => ({ ...makeGoldPouch(template, value), uid });

function runWith(items = []) {
  const run = new RunManager(data);
  const unit = {
    name: 'Edric',
    currentHP: 20,
    stats: { HP: 20, STR: 5 },
    inventory: [],
    consumables: items,
    _conditions: [],
  };
  run.roster = [unit];
  return { run, unit };
}

describe('using a Gold Pouch', () => {
  it('pays its value once, from the bag, and is spent', () => {
    for (const value of [300, 500, 800]) {
      const item = pouch(value);
      const { run, unit } = runWith([item]);
      const gold = run.gold;
      expect(rosterItemBlock(run, unit, item, 'use')).toBe('');
      expect(rosterItemAction(run, unit, item, 'use')).toBe('');
      expect(run.gold).toBe(gold + value);
      expect(unit.consumables).toEqual([]);
      // Used up: a second use is refused and pays nothing.
      expect(rosterItemAction(run, unit, item, 'use')).toBe(
        'Item is no longer carried by this unit.',
      );
      expect(run.gold).toBe(gold + value);
    }
  });

  it('works straight from the convoy, and it is spent from there', () => {
    const item = pouch(500);
    const { run, unit } = runWith();
    expect(run.addToConvoy(item)).toBe(true);
    const inConvoy = run.convoy.consumables.find((c) => c.uid === item.uid);
    const gold = run.gold;
    expect(rosterItemBlock(run, unit, inConvoy, 'use')).toBe('');
    expect(rosterItemAction(run, unit, inConvoy, 'use')).toBe('');
    expect(run.gold).toBe(gold + 500);
    expect(run.convoy.consumables.filter((c) => c.uid === item.uid)).toEqual([]);
  });

  it('is refused with a bad value, and then nothing is paid or spent', () => {
    const bad = { ...pouch(300), value: 0 };
    const { run, unit } = runWith([bad]);
    const gold = run.gold;
    expect(rosterItemBlock(run, unit, bad, 'use')).toBe('Invalid Gold Pouch.');
    expect(rosterItemAction(run, unit, bad, 'use')).toBe('Invalid Gold Pouch.');
    expect(run.gold).toBe(gold);
    expect(unit.consumables).toEqual([bad]);
  });

  it("is not a healing item: Heal is refused, whatever the unit's HP", () => {
    const item = pouch(300);
    const { run, unit } = runWith([item]);
    unit.currentHP = 1;
    expect(rosterItemBlock(run, unit, item, 'heal')).toBe(
      'Use the dedicated action for this item.',
    );
  });
});

describe('selling and the catalog', () => {
  it('a sale pays exactly what use pays', () => {
    for (const value of [300, 500, 800]) {
      const item = pouch(value);
      expect(getSellPrice(item)).toBe(value);
      const { run, unit } = runWith([item]);
      const gold = run.gold;
      const sold = sellShopItem(run, { kind: 'consumable', unit, item });
      expect(sold.ok).toBe(true);
      expect(run.gold).toBe(gold + value);
      expect(unit.consumables).toEqual([]);
    }
  });

  it('making a pouch never edits the catalog, and the figures are exact', () => {
    const before = structuredClone(template);
    const big = makeGoldPouch(template, 800);
    expect(template).toEqual(before);
    expect(big).toMatchObject({ value: 800, price: 1600, effect: 'gold', uses: 1 });
    expect(goldPouchPriceFor(300)).toBe(600);
    expect(isGoldPouch(big)).toBe(true);
    expect(isGoldPouch({ ...big, type: 'Sword' })).toBe(false);
    expect(goldPouchValue(big)).toBe(800);
    expect(goldPouchValue({ name: 'Vulnerary', effect: 'heal', value: 10, type: 'Consumable' })).toBe(0); // prettier-ignore
  });

  it('says what it is worth', () => {
    expect(getConsumableDescription(pouch(500))).toBe('Worth 500 G: use it or sell it');
  });

  it('never enters a shop or a loot roll: only a carrier holds one', () => {
    for (const [act, table] of Object.entries(data.lootTables)) {
      if (act === 'accessorySkills') continue;
      for (const key of ['healing', 'statBooster', 'promotion', 'weapons', 'forge']) {
        expect(table[key] || [], `${act}.${key}`).not.toContain(GOLD_POUCH_NAME);
      }
    }
  });
});
