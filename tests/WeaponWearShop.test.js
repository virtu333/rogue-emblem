// Repair at a village forge, as a shop command (docs/specs/worn-weapons.md). The ways it can
// fail: gold is spent but the weapon is not mended (or the reverse), a refused repair still
// charges or mutates, the shop's forge limit is ignored, a stale or foreign weapon is mended,
// and the forge discount is not applied. Costs are worked out by hand (Steel = base price:
// might 400 x 0.5 = 200, hit 250 x 0.5 = 125).
import { beforeEach, describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import {
  shopRepairBlock,
  repairShopWeapon,
  forgeShopWeapon,
  shopOwnedItems,
} from '../src/engine/ShopCommands.js';
import { applyWear, wearCount } from '../src/engine/WeaponWear.js';

const data = loadGameData();
const clone = (value) => structuredClone(value);
let run, unit, weapon;
const state = () => JSON.stringify({ gold: run.gold, roster: run.roster, convoy: run.convoy });
const options = (overrides = {}) => ({
  forgesUsed: 0,
  forgeLimit: 2,
  discount: 0,
  expectedWear: wearCount(weapon),
  ...overrides,
});

beforeEach(() => {
  run = new RunManager(data);
  run.gold = 1000;
  weapon = { ...clone(data.weapons.find((w) => w.name === 'Steel Sword')), uid: 'w1' };
  applyWear(weapon, 'might');
  applyWear(weapon, 'hit');
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

describe('a repair at the forge', () => {
  it('spends the repair cost once, mends the most recent step and names the result', () => {
    const might = weapon.might;
    const hit = weapon.hit;
    const result = repairShopWeapon(run, weapon, options());
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Repaired Steel Sword -1 for 125G.');
    expect(run.gold).toBe(1000 - 125);
    expect(weapon.hit).toBe(hit + 5);
    expect(weapon.might).toBe(might);
    expect(weapon.name).toBe('Steel Sword -1');
    expect(wearCount(weapon)).toBe(1);
  });

  it('repairs the last step too, leaving an unworn weapon the forge accepts again', () => {
    repairShopWeapon(run, weapon, options());
    expect(repairShopWeapon(run, weapon, options({ forgesUsed: 1 })).ok).toBe(true);
    expect(run.gold).toBe(1000 - 125 - 200);
    expect(weapon.name).toBe('Steel Sword');
    expect(forgeShopWeapon(run, weapon, 'might', { ...options({ forgesUsed: 0 }), expectedLevel: 0 }).ok).toBe(true); // prettier-ignore
  });

  it('applies the shop forge discount to the repair, at least 1 gold', () => {
    const result = repairShopWeapon(run, weapon, options({ discount: 0.2 }));
    expect(result.ok).toBe(true);
    expect(run.gold).toBe(1000 - 100); // floor(125 x 0.8)
    // The next step (might, 200) at a 99.95% discount floors to 0 gold: the shop still charges 1.
    run.gold = 1000;
    expect(repairShopWeapon(run, weapon, options({ discount: 0.9995, forgesUsed: 1 })).ok).toBe(
      true,
    );
    expect(run.gold).toBe(999);
  });

  it('repairs a weapon held by the convoy or in a spare slot, not only the equipped one', () => {
    const spare = { ...clone(data.weapons.find((w) => w.name === 'Iron Lance')), uid: 'w2' };
    applyWear(spare, 'crit');
    run.convoy.weapons.push(spare);
    expect(shopOwnedItems(run).some((row) => row.item === spare)).toBe(true);
    expect(repairShopWeapon(run, spare, options({ expectedWear: 1 })).ok).toBe(true);
    expect(spare.name).toBe('Iron Lance');
    expect(run.gold).toBe(1000 - 90); // Iron crit: 300 x 0.6 x 0.5
  });
});

describe('a repair that is refused changes nothing', () => {
  it.each([
    ['not enough gold', () => (run.gold = 124), 'Not enough gold.'],
    ['no forges remain', (o) => (o.forgesUsed = o.forgeLimit), 'No forges remain at this shop.'],
    ['a stale weapon', (o) => (o.expectedWear = 1), 'Weapon changed. Review it again.'],
    ['an invalid discount', (o) => (o.discount = 1), 'Invalid repair.'],
    ['a weapon the run no longer holds', () => (unit.inventory[0] = clone(weapon)), 'This weapon is no longer available.'], // prettier-ignore
  ])('%s', (_label, arrange, reason) => {
    const opts = options();
    arrange(opts);
    const before = state();
    const copy = clone(weapon);
    expect(shopRepairBlock(run, weapon, opts)).toBe(reason);
    expect(repairShopWeapon(run, weapon, opts)).toEqual({ ok: false, reason });
    expect(state()).toBe(before);
    expect(weapon).toEqual(copy);
  });

  it('an unworn weapon is not repairable', () => {
    const plain = { ...clone(data.weapons.find((w) => w.name === 'Iron Sword')), uid: 'w3' };
    unit.inventory.push(plain);
    const before = state();
    expect(repairShopWeapon(run, plain, options({ expectedWear: undefined }))).toEqual({
      ok: false,
      reason: 'This weapon is not worn.',
    });
    expect(state()).toBe(before);
  });

  it('exactly enough gold repairs; one short does not', () => {
    run.gold = 125;
    expect(repairShopWeapon(run, weapon, options()).ok).toBe(true);
    expect(run.gold).toBe(0);
    run.gold = 199;
    expect(repairShopWeapon(run, weapon, options({ forgesUsed: 1 })).ok).toBe(false);
    expect(run.gold).toBe(199);
  });

  it('a worn weapon cannot be forged at the shop, with the repair-first reason', () => {
    const before = state();
    const result = forgeShopWeapon(run, weapon, 'might', { ...options(), expectedLevel: 0 });
    expect(result).toEqual({ ok: false, reason: 'Repair this weapon before forging it.' });
    expect(state()).toBe(before);
  });
});
