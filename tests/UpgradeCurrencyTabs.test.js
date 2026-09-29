// Army upgrades: each tab sits under the currency it spends (Dave's playtest: Valor
// and Supply read the same). The groups come from CATEGORY_CURRENCY, so a category
// moved to the other currency moves its tab too.
import { describe, expect, it } from 'vitest';
import { CURRENCY_TAB_GROUPS, currencyName } from '../src/ui/MobileUpgradeMenu.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('upgrade tabs by currency', () => {
  it('Valor holds the lord tabs and Supply the army tabs', () => {
    const labels = Object.fromEntries(
      CURRENCY_TAB_GROUPS.map((g) => [g.currency, g.categories.map(([, label]) => label)]),
    );
    expect(labels).toEqual({
      valor: ['Lords', 'Equipment', 'Skills'],
      supply: ['Recruits', 'Economy', 'Battalion'],
    });
  });

  it('every upgrade category in the data has exactly one tab', () => {
    const tabbed = CURRENCY_TAB_GROUPS.flatMap((g) => g.categories.map(([id]) => id));
    const inData = new Set(gameData.metaUpgrades.map((u) => u.category));
    expect(new Set(tabbed).size).toBe(tabbed.length);
    expect(new Set(tabbed)).toEqual(inData);
  });

  it('names the currencies with a capital, as the balances do', () => {
    expect(currencyName('valor')).toBe('Valor');
    expect(currencyName('supply')).toBe('Supply');
  });
});
