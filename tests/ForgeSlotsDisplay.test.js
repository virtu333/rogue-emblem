// A kept NG+ weapon's sleeping forges take forge slots, so a weapon reading "+2" can be fully
// forged. Every forge view says so (playtest: "I had weapons I thought weren't finished but they
// were finished"): the slots spent with the sleeping ones counted, and why a stone is refused.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  applyForge,
  forgeFullText,
  forgeProgressText,
  forgeSlots,
  forgeStatBlock,
  forgeStatProgressText,
  forgeStatusLine,
} from '../src/engine/ForgeSystem.js';
import { lullForges } from '../src/engine/KeptForges.js';
import {
  rewardWeaponBlock,
  rewardWeaponCandidates,
  rewardWeaponEligible,
} from '../src/engine/LootRewardCommands.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const whetstone = (forgeStat) => ({ name: 'Whetstone', type: 'Whetstone', forgeStat });

/** A Silver Sword forged `stats` in order, then kept with `awake` of them awake. */
function keptSword(stats, awake) {
  const sword = { ...catalog('Silver Sword'), uid: 'itm_kept' };
  for (const stat of stats) expect(applyForge(sword, stat, 0, { free: true }).success).toBe(true);
  lullForges(sword, awake);
  return sword;
}

// 15 forges: might x5, hit x4, crit x4, weight x2 (a Silver Sword weighs enough for two).
const FULL = [
  ...Array(5).fill('might'),
  ...Array(4).fill('hit'),
  ...Array(4).fill('crit'),
  'weight',
  'weight',
];

describe('forge slots count sleeping forges', () => {
  it('a fully forged kept weapon with 2 awake reads as 15/15, not 2/15', () => {
    // Failure: the label reads the awake level only, so the weapon looks unfinished.
    const sword = keptSword(FULL, 2);
    expect(sword.name).toBe('Silver Sword +2');
    expect(forgeSlots(sword)).toEqual({ awake: 2, asleep: 13, total: 15, max: 15, full: true });
    expect(forgeProgressText(sword)).toBe('15/15 · 13 asleep');
    expect(forgeStatusLine(sword)).toBe('Fully forged 15/15 · 13 asleep');
    expect(forgeFullText(sword)).toBe('Fully forged (15/15 · 13 asleep).');
  });

  it('a weapon with room says how much is spent; an unforged one says nothing', () => {
    const sword = keptSword(['might', 'hit', 'crit', 'might'], 2);
    expect(forgeStatusLine(sword)).toBe('Forges 4/15 · 2 asleep');
    const plain = { ...catalog('Iron Sword'), uid: 'itm_plain' };
    expect(forgeStatusLine(plain)).toBe('');
    applyForge(plain, 'hit', 0, { free: true });
    expect(forgeStatusLine(plain)).toBe('Forges 1/15');
    expect(forgeStatusLine(catalog('Heal'))).toBe('');
  });

  it('a stat full with sleeping forges names the stat and its sleepers', () => {
    // Failure: a Might whetstone is refused on a "+2" weapon with no reason the player can see.
    const sword = keptSword(['might', 'hit', 'might', 'might', 'might', 'might'], 2);
    expect(forgeStatProgressText(sword, 'might')).toBe('5/5 · 4 asleep');
    expect(forgeStatBlock(sword, 'might')).toBe('Might is at its forge limit (5/5 · 4 asleep).');
    expect(forgeStatBlock(sword, 'hit')).toBe('');
  });
});

describe('a whetstone reward shows full weapons with the reason', () => {
  it('lists every forgeable weapon, full ones blocked with why', () => {
    // Failure: a full weapon vanishes from the list, so the stone looks broken.
    const full = keptSword(FULL, 2);
    const mightCapped = keptSword(['might', 'might', 'might', 'might', 'might'], 2);
    const staff = catalog('Heal');
    const weapons = [full, mightCapped, staff];
    expect(rewardWeaponCandidates(whetstone('might'), weapons)).toEqual([full, mightCapped]);

    expect(rewardWeaponEligible(whetstone('choice'), full)).toBe(false);
    expect(rewardWeaponBlock(whetstone('choice'), full)).toBe('Fully forged (15/15 · 13 asleep).');
    expect(rewardWeaponBlock(whetstone('might'), mightCapped)).toBe(
      'Might is at its forge limit (5/5 · 3 asleep).',
    );
    expect(rewardWeaponBlock(whetstone('hit'), mightCapped)).toBe('');
    expect(rewardWeaponBlock(whetstone('choice'), mightCapped)).toBe('');
  });
});
