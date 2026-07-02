// Lore content contract — every item/class/boss ships with a flavor blurb that
// fits its UI surfaces. Budgets are derived from real layout constraints:
//  - items: one ellipsized Compendium row line (530px ≈ 88 chars incl. quotes)
//    and ≤3 wrapped lines in the narrowest tooltip (UnitDetailOverlay, 192px)
//  - classes: two wrapped Foes-tab lines at 84 chars
//  - bosses: three wrapped Foes-tab lines at 84 chars
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

const ITEM_BUDGET = 85;
const CLASS_BUDGET = 160;
const BOSS_BUDGET = 240;

function expectValidLore(entry, budget, label) {
  expect(typeof entry.lore, `${label}: lore must be a string`).toBe('string');
  expect(entry.lore.trim().length, `${label}: lore must be non-empty`).toBeGreaterThan(0);
  expect(entry.lore.length, `${label}: lore exceeds ${budget} chars`).toBeLessThanOrEqual(budget);
  expect(entry.lore.includes('\n'), `${label}: lore must be single-line`).toBe(false);
}

describe('lore content contract', () => {
  it('every weapon (incl. scrolls) has lore within the item budget', () => {
    expect(gameData.weapons.length).toBeGreaterThan(0);
    for (const weapon of gameData.weapons) {
      expectValidLore(weapon, ITEM_BUDGET, `weapon "${weapon.name}"`);
    }
  });

  it('every consumable has lore within the item budget', () => {
    expect(gameData.consumables.length).toBeGreaterThan(0);
    for (const item of gameData.consumables) {
      expectValidLore(item, ITEM_BUDGET, `consumable "${item.name}"`);
    }
  });

  it('every accessory has lore within the item budget', () => {
    expect(gameData.accessories.length).toBeGreaterThan(0);
    for (const item of gameData.accessories) {
      expectValidLore(item, ITEM_BUDGET, `accessory "${item.name}"`);
    }
  });

  it('every whetstone has lore within the item budget', () => {
    expect(gameData.whetstones.length).toBeGreaterThan(0);
    for (const item of gameData.whetstones) {
      expectValidLore(item, ITEM_BUDGET, `whetstone "${item.name}"`);
    }
  });

  it('every blessing has lore distinct from its mechanical description', () => {
    const blessings = gameData.blessings.blessings;
    expect(blessings.length).toBeGreaterThan(0);
    for (const blessing of blessings) {
      expectValidLore(blessing, ITEM_BUDGET, `blessing "${blessing.name}"`);
      expect(
        blessing.lore,
        `blessing "${blessing.name}": lore must not repeat description`,
      ).not.toBe(blessing.description);
    }
  });

  it('every class has lore distinct from its mechanical description', () => {
    expect(gameData.classes.length).toBeGreaterThan(0);
    for (const klass of gameData.classes) {
      expectValidLore(klass, CLASS_BUDGET, `class "${klass.name}"`);
      expect(klass.lore, `class "${klass.name}": lore must not repeat description`).not.toBe(
        klass.description,
      );
    }
  });

  it('all 11 bosses (incl. both finalBoss variants) have lore', () => {
    const bosses = Object.values(gameData.enemies.bosses).flat();
    expect(bosses.length).toBe(11);
    for (const boss of bosses) {
      expectValidLore(boss, BOSS_BUDGET, `boss "${boss.name}"`);
    }
    const finalBosses = gameData.enemies.bosses.finalBoss;
    expect(finalBosses.some((b) => b.difficultyFilter?.includes('normal'))).toBe(true);
    expect(finalBosses.some((b) => b.difficultyFilter?.includes('lunatic'))).toBe(true);
  });
});
