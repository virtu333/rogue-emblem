// A small loot pool must offer every distinct item it has before falling back
// to a gold card. The draw used to pick from the whole pool and retry on a
// repeat, spending one of count * 5 attempts each time: with two names left,
// all nine retries could repeat (0.2% of rewards), leaving a gold filler card
// although an unused item remained. (This also made
// ImbueLootSerialization.test.js fail about once in 300 runs.)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => vi.restoreAllMocks());

function forgeOnly(forge) {
  return {
    act2: {
      weapons: [],
      healing: [],
      statBooster: [],
      promotion: [],
      skillScroll: [],
      weaponArtScroll: [],
      legendaryWeapon: [],
      accessories: [],
      forge,
      weights: { forge: 100, gold: 0 },
      goldRange: [0, 0],
    },
  };
}

const draw = (tables, count) =>
  generateLootChoices(
    'act2',
    tables,
    data.weapons,
    data.consumables,
    count,
    0,
    data.accessories,
    data.whetstones,
    null,
    false,
    null,
    false,
    null,
    { imbues: data.imbues },
  );

describe('loot draws never waste an attempt on a repeat', () => {
  it('offers both items of a two-item pool even when every roll lands on the first', () => {
    // The worst case, forced: every random draw returns the first entry.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const choices = draw(forgeOnly(['Prismatic Stone', 'Vampiric Imbuing Stone']), 2);
    expect(choices.map((c) => c.type)).toEqual(['forge', 'forge']);
    expect(choices.map((c) => c.item.name).sort()).toEqual([
      'Prismatic Stone',
      'Vampiric Imbuing Stone',
    ]);
  });

  it('keeps a duplicated entry weighted among the names not offered yet', () => {
    // 'Silver Whetstone' listed twice (as lootTables does to weight it): once it is
    // offered, its copies leave the draw together.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const choices = draw(forgeOnly(['Silver Whetstone', 'Silver Whetstone', 'Prismatic Stone']), 2);
    expect(choices.map((c) => c.item?.name)).toEqual(['Silver Whetstone', 'Prismatic Stone']);
  });

  it('still fills with gold once the pool has no unused names', () => {
    const choices = draw(forgeOnly(['Prismatic Stone']), 2);
    expect(choices.map((c) => c.type)).toEqual(['forge', 'gold']);
  });
});
