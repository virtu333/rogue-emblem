// Pull forward (docs/specs/ng-plus.md §15.1): a forge of a stat that has no room left on an NG+
// kept weapon wakes a sleeping forge of that stat instead of being refused. The cap stays 15:
// the forge is only taken early, so the act start wakes one fewer and nothing extra comes later.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  applyForge,
  forgePrice,
  forgePullsForward,
  getStatForgeCount,
} from '../src/engine/ForgeSystem.js';
import {
  carriedCopy,
  dormantForgeCount,
  lullForges,
  wakeForges,
} from '../src/engine/KeptForges.js';
import { applyRewardForge } from '../src/engine/LootRewardCommands.js';
import { FORGE_BONUSES, FORGE_COSTS, FORGE_TIER_COST_MULTIPLIER } from '../src/utils/constants.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));

// 15 forges: might x5, hit x4, crit x4, weight x2.
const FULL = [
  ...Array(5).fill('might'),
  ...Array(4).fill('hit'),
  ...Array(4).fill('crit'),
  'weight',
  'weight',
];

/** A Silver Sword forged FULL, kept, with 2 forges awake (Act I). */
function keptFull() {
  const sword = { ...catalog('Silver Sword'), uid: 'itm_kept' };
  for (const stat of FULL) applyForge(sword, stat, 0, { free: true });
  lullForges(sword, 2); // awake might, might; asleep the other 13
  return sword;
}

const fullyAwake = () => {
  const sword = { ...catalog('Silver Sword'), uid: 'itm_ref' };
  for (const stat of FULL) applyForge(sword, stat, 0, { free: true });
  return sword;
};

describe('a forge on a full kept weapon pulls a sleeping forge forward', () => {
  it('wakes the stat asked for, costs that forge, and keeps the total at 15', () => {
    // Failure: the forge is refused (the weapon reads +2 and can't be finished early), or it
    // adds a 16th forge, or it wakes some other stat than the one paid for.
    const sword = keptFull();
    const price = sword.price;
    const hitBefore = sword.hit;
    expect(forgePullsForward(sword, 'hit')).toBe(true);
    // Hit is not forged awake yet: the first Hit forge's price, the tier's multiplier on it.
    const tier = FORGE_TIER_COST_MULTIPLIER[sword.tier] ?? 1;
    const expected = Math.round((FORGE_COSTS.hit[0] * tier) / 10) * 10;
    expect(forgePrice(sword, 'hit')).toBe(expected);
    expect(applyForge(sword, 'hit')).toEqual({
      success: true,
      cost: expected,
      pulledForward: true,
    });
    expect(sword.hit).toBe(hitBefore + FORGE_BONUSES.hit);
    expect(sword._forgeLevel).toBe(3);
    expect(dormantForgeCount(sword)).toBe(12);
    expect(getStatForgeCount(sword, 'hit')).toBe(1);
    // The sleeping forge was always in the weapon's price.
    expect(sword.price).toBe(price);
  });

  it('the act start wakes one fewer, and the weapon ends exactly as forged', () => {
    // Failure: a forge woken early wakes again at the act start (a 16th forge), or the act
    // start's limit counts it as a run forge and leaves a kept forge asleep for good.
    const sword = keptFull();
    applyForge(sword, 'crit', 0, { free: true });
    expect(wakeForges(sword, 4)).toBe(1); // Act II: 4 awake, one of them pulled forward
    expect(sword._forgeLevel).toBe(4);
    wakeForges(sword, Infinity);
    const ref = fullyAwake();
    for (const key of ['might', 'hit', 'crit', 'weight', '_forgeLevel', 'name'])
      expect(sword[key]).toBe(ref[key]);
  });

  it('a pulled-forward forge is a kept forge: the ride keeps it and carries four new ones', () => {
    // Failure: the woken forge counts as one of the run's, so it eats a carry slot.
    const sword = keptFull();
    applyForge(sword, 'hit', 0, { free: true });
    const carried = carriedCopy(sword, 4);
    expect(carried._forgeLevel).toBe(15);
    expect(dormantForgeCount(carried)).toBe(0);
  });

  it('a stat with none asleep and no room is still refused', () => {
    const sword = { ...catalog('Silver Sword'), uid: 'itm_m' };
    for (let i = 0; i < 5; i++) applyForge(sword, 'might', 0, { free: true });
    expect(forgePullsForward(sword, 'might')).toBe(false);
    expect(applyForge(sword, 'might').success).toBe(false);
  });

  it('a whetstone reward finishes a kept weapon early', () => {
    const sword = keptFull();
    const unit = { name: 'Bjorn', inventory: [sword] };
    const run = { roster: [unit] };
    const stone = { name: 'Silver Whetstone', type: 'Whetstone', forgeStat: 'choice' };
    expect(applyRewardForge(run, data, stone, unit, sword, 'crit')).toEqual({
      ok: true,
      reason: '',
    });
    expect(sword._forgeLevel).toBe(3);
    expect(dormantForgeCount(sword)).toBe(12);
  });
});
