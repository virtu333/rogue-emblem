// Smith's Mark (`frugal_smith`, docs/specs/blessings-v3.md §4): each shop's first forge USE (a
// forge or a repair) is free, and every shop forges once more. The engine decides what is free
// (ShopCommands.freeForgeAvailable); a free forge still spends the shop's use but adds nothing
// to the weapon's resale price.
//
// Ways it can fail, a test each (Steel Sword: first Might forge 400, first Hit forge 250,
// repairs are half of that: 200 and 125):
//   - the "free" forge still charges, or is blocked at 0 gold, or the second forge is free too
//   - a free forge raises the weapon's resale value (price grows by the cost, which is 0)
//   - a repair does not count as the free service, or the free forge is lost to a repair first
//   - the extra forge is missing, or a UI-supplied `free` flag buys a second free forge
//   - a dear (+35%) forge price or the village discount charges the free forge
//   - the menu shows a price for a free use, or keeps "free" once the use is spent
//   - the next shop is not free again, or re-entering the same shop forgets the spent use
//   - a save from before the card loses its fields, or a saved Mark does not survive a reload
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  forgeShopWeapon,
  repairShopWeapon,
  shopForgeBlock,
  shopForgeDiscount,
  shopForgePrice,
  shopForgeTerms,
  shopRepairBlock,
  shopRepairPrice,
} from '../src/engine/ShopCommands.js';
import { applyForge, deforgeWeapon } from '../src/engine/ForgeSystem.js';
import { applyWear, repairWeapon, wearCount } from '../src/engine/WeaponWear.js';
import { SHOP_FORGE_LIMITS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const clone = (value) => structuredClone(value);

function markedRun({ seed = 11, price = null } = {}) {
  const run = new RunManager(data);
  run.startRun({ runSeed: seed });
  run.activeBlessings = [{ id: 'frugal_smith', rolledCost: price }];
  run._runStartBlessingsApplied = false;
  run.applyRunStartBlessingEffects();
  return run;
}

function steelSwordFor(run, { worn = 0 } = {}) {
  const sword = { ...clone(data.weapons.find((w) => w.name === 'Steel Sword')), uid: 'sm1' };
  const preWearPrice = sword.price;
  for (const stat of ['might', 'hit'].slice(0, worn)) applyWear(sword, stat);
  run.roster = [
    {
      name: 'Edric',
      stats: { HP: 22 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [sword],
      weapon: sword,
      consumables: [],
    },
  ];
  run.gold = 1000;
  return { sword, preWearPrice };
}

const act1Terms = (run, forgesUsed = 0) => shopForgeTerms(run, { act: 'act1', forgesUsed });
const forgeOnce = (run, sword, forgesUsed, stat = 'might') =>
  forgeShopWeapon(run, sword, stat, {
    ...act1Terms(run, forgesUsed),
    expectedLevel: sword._forgeLevel || 0,
  });

describe("Smith's Mark: the card", () => {
  it('is the data row the brief names: a free forge use per shop and one more forge', () => {
    const row = data.blessings.blessings.find((b) => b.id === 'frugal_smith');
    expect(row.name).toBe("Smith's Mark");
    expect(row.tier).toBe(2);
    expect(row.boons).toEqual([
      { type: 'shop_first_forge_free', params: { value: 1 } },
      { type: 'forge_limit_delta', params: { value: 1 } },
    ]);
    expect(row.description.length).toBeLessThanOrEqual(90);
    // The old 30% off is gone from the card as well as the numbers.
    expect(JSON.stringify(row)).not.toMatch(/forge_cost/);
  });

  it('its lore is about a smith’s mark, not the old pilgrim discount (that is another card’s theme)', () => {
    const row = data.blessings.blessings.find((b) => b.id === 'frugal_smith');
    expect(row.lore.length).toBeLessThanOrEqual(85);
    expect(row.lore).toMatch(/mark/i);
    expect(row.lore).not.toMatch(/pilgrim|rate|discount/i);
  });

  it('applying it frees one use per shop, adds a forge and gives no discount', () => {
    const run = markedRun();
    expect(run.getFreeForgesPerShop()).toBe(1);
    expect(run.blessingRuntimeModifiers.forgeLimitDelta).toBe(1);
    expect(run.getForgeCostDiscount()).toBe(0);
  });
});

describe("Smith's Mark: the first forge", () => {
  it('costs no gold, forges the weapon, and the second forge at the shop pays in full', () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run);
    const might = sword.might;

    const first = forgeOnce(run, sword, 0);
    expect(first.ok).toBe(true);
    expect(first.free).toBe(true);
    expect(first.message).toBe("Forged Steel Sword +1 for free (Smith's Mark).");
    expect(run.gold).toBe(1000);
    expect(sword.might).toBe(might + 1);

    const second = forgeOnce(run, sword, 1);
    expect(second.ok).toBe(true);
    expect(second.free).toBe(false);
    // Second Might step: 800 gold at the Steel tier.
    expect(run.gold).toBe(1000 - 800);
    expect(sword.might).toBe(might + 2);
  });

  it('is allowed with an empty purse; the second forge with an empty purse is refused', () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run);
    run.gold = 0;
    expect(shopForgeBlock(run, sword, 'might', { ...act1Terms(run, 0), expectedLevel: 0 })).toBe(
      '',
    );
    expect(forgeOnce(run, sword, 0).ok).toBe(true);
    expect(run.gold).toBe(0);
    expect(shopForgeBlock(run, sword, 'might', { ...act1Terms(run, 1), expectedLevel: 1 })).toBe(
      'Not enough gold.',
    );
    const before = JSON.stringify(sword);
    expect(forgeOnce(run, sword, 1).ok).toBe(false);
    expect(JSON.stringify(sword)).toBe(before);
  });

  it('adds nothing to the weapon’s resale price and records a zero-cost step', () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run);
    const price = sword.price;
    forgeOnce(run, sword, 0);
    expect(sword.price).toBe(price);
    expect(sword._forgeHistory).toEqual([{ stat: 'might', cost: 0 }]);
    // A paid forge raises it by the gold paid, as before.
    forgeOnce(run, sword, 1, 'hit');
    expect(sword.price).toBe(price + 250);
    // Undoing the free step later refunds nothing for it.
    deforgeWeapon(sword); // the paid hit step
    expect(sword.price).toBe(price);
    expect(deforgeWeapon(sword).refundedCost).toBe(0);
    expect(sword.price).toBe(price);
  });

  it('is a forge use all the same: the shop still has one forge fewer', () => {
    const run = markedRun();
    expect(act1Terms(run, 0).forgeLimit).toBe(SHOP_FORGE_LIMITS.act1 + 1);
    const { sword } = steelSwordFor(run);
    run.gold = 5000;
    // Two paid-or-free forges, then the third (the +1) and no fourth.
    forgeOnce(run, sword, 0);
    forgeOnce(run, sword, 1);
    forgeOnce(run, sword, 2, 'hit');
    expect(shopForgeBlock(run, sword, 'crit', { ...act1Terms(run, 3), expectedLevel: 3 })).toBe(
      'No forges remain at this shop.',
    );
  });
});

describe("Smith's Mark: repairs", () => {
  it('a repair as the shop’s first service is free and mends the weapon in full', () => {
    const run = markedRun();
    const { sword, preWearPrice } = steelSwordFor(run, { worn: 2 });
    const hit = sword.hit;
    const result = repairShopWeapon(run, sword, {
      ...act1Terms(run, 0),
      expectedWear: wearCount(sword),
    });
    expect(result.ok).toBe(true);
    expect(result.free).toBe(true);
    expect(result.message).toBe("Repaired Steel Sword -1 for free (Smith's Mark).");
    expect(run.gold).toBe(1000);
    expect(sword.hit).toBe(hit + 5); // the most recent step (Bent) is mended
    expect(wearCount(sword)).toBe(1);
    // Mending the last step restores the resale price the wear took.
    repairShopWeapon(run, sword, { ...act1Terms(run, 1), expectedWear: 1 });
    expect(sword.price).toBe(preWearPrice);
  });

  it('after a free forge, a repair pays its price: the free use is spent', () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run, { worn: 2 });
    // Worn weapons cannot be forged; use a second, sound blade for the forge.
    const spare = { ...clone(data.weapons.find((w) => w.name === 'Steel Sword')), uid: 'sm2' };
    run.roster[0].inventory.push(spare);
    expect(forgeOnce(run, spare, 0).free).toBe(true);
    const result = repairShopWeapon(run, sword, { ...act1Terms(run, 1), expectedWear: 2 });
    expect(result.ok).toBe(true);
    expect(result.free).toBe(false);
    expect(run.gold).toBe(1000 - 125); // Bent (-5 Hit): half of the 250 first Hit step
  });

  it('a repair is allowed free with an empty purse', () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run, { worn: 1 });
    run.gold = 0;
    expect(shopRepairBlock(run, sword, { ...act1Terms(run, 0), expectedWear: 1 })).toBe('');
    expect(shopRepairBlock(run, sword, { ...act1Terms(run, 1), expectedWear: 1 })).toBe(
      'Not enough gold.',
    );
  });

  it('WeaponWear.repairWeapon({ free }) costs nothing and still mends; the default still charges', () => {
    const w1 = clone(data.weapons.find((w) => w.name === 'Steel Sword'));
    applyWear(w1, 'might');
    expect(repairWeapon(w1, 0, { free: true })).toMatchObject({ success: true, cost: 0 });
    const w2 = clone(data.weapons.find((w) => w.name === 'Steel Sword'));
    applyWear(w2, 'might');
    expect(repairWeapon(w2, 0)).toMatchObject({ success: true, cost: 200 });
  });
});

describe('the engine decides what is free, never the caller', () => {
  it('a run without the Mark charges, whatever the caller says', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 11 });
    const { sword } = steelSwordFor(run);
    const result = forgeShopWeapon(run, sword, 'might', {
      ...act1Terms(run, 0),
      free: true,
      expectedLevel: 0,
    });
    expect(result.free).toBe(false);
    expect(run.gold).toBe(1000 - 400);
  });

  it("a caller's own free flag is ignored: the engine recomputes it from the use count", () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run);
    const stale = act1Terms(run, 0); // read before the first forge
    expect(stale.free).toBe(true);
    forgeShopWeapon(run, sword, 'might', { ...stale, expectedLevel: 0 });
    // The count is the caller's (the shop menu reads it fresh); a free flag left over from
    // the first forge changes nothing once that count says a use was spent.
    const again = forgeShopWeapon(run, sword, 'hit', {
      ...stale,
      forgesUsed: 1,
      free: true,
      expectedLevel: 1,
    });
    expect(again.free).toBe(false);
    expect(run.gold).toBe(1000 - 250);
  });

  it('terms price the next forge as free only while it is', () => {
    const run = markedRun();
    const { sword } = steelSwordFor(run);
    expect(shopForgePrice(sword, 'might', act1Terms(run, 0))).toBe(0);
    expect(shopForgePrice(sword, 'might', act1Terms(run, 1))).toBe(400);
    const worn = steelSwordFor(run, { worn: 1 }).sword;
    expect(shopRepairPrice(worn, act1Terms(run, 0))).toBe(0);
    expect(shopRepairPrice(worn, act1Terms(run, 1))).toBe(200);
  });

  it('a +35% forge price and a village discount do not touch the free forge, only the paid ones', () => {
    const run = markedRun({
      price: {
        label: '+35% forge costs',
        effects: [{ type: 'forge_cost_multiplier', params: { value: 0.35 } }],
      },
    });
    const { sword } = steelSwordFor(run);
    run.gold = 5000;
    expect(shopForgeDiscount(run)).toBeCloseTo(-0.35, 10);
    expect(forgeOnce(run, sword, 0).free).toBe(true);
    expect(run.gold).toBe(5000);
    forgeOnce(run, sword, 1);
    expect(run.gold).toBe(5000 - Math.floor(800 * 1.35));
  });

  it('ForgeSystem.applyForge({ free }) still refuses a weapon at its forge cap', () => {
    const sword = clone(data.weapons.find((w) => w.name === 'Steel Sword'));
    while (applyForge(sword, 'might', 0, { free: true }).success) {
      /* forge to the per-stat cap */
    }
    expect(applyForge(sword, 'might', 0, { free: true })).toEqual({ success: false });
    expect(sword.price).toBe(1000);
  });
});

describe("Smith's Mark in a saved run", () => {
  it('survives a save and load, and an older save loads with no free forge', () => {
    const run = markedRun();
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    expect(RunManager.fromJSON(saved, data).getFreeForgesPerShop()).toBe(1);
    delete saved.blessingRuntimeModifiers.freeForgesPerShop;
    delete saved.blessingRuntimeModifiers.extraShopsPerAct;
    const old = RunManager.fromJSON(saved, data);
    expect(old.getFreeForgesPerShop()).toBe(0);
    expect(old.getExtraShopsPerAct()).toBe(0);
  });

  it('a damaged value loads as a whole non-negative number', () => {
    const run = markedRun();
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    saved.blessingRuntimeModifiers.freeForgesPerShop = -4.7;
    expect(RunManager.fromJSON(saved, data).getFreeForgesPerShop()).toBe(0);
    saved.blessingRuntimeModifiers.freeForgesPerShop = '2';
    expect(RunManager.fromJSON(saved, data).getFreeForgesPerShop()).toBe(2);
  });
});

describe("Smith's Mark in the shop menu", () => {
  let d;
  let weapon;
  const nodes = () => d.menu.surface.body.all();
  const text = () => nodes().map((n) => n.textContent).join(' | '); // prettier-ignore
  const button = (label) =>
    nodes().find(
      (n) =>
        n.tag === 'button' &&
        (label instanceof RegExp ? label.test(n.textContent) : n.textContent === label),
    );
  const openForge = () => {
    d.scene.activeShopTab = 'forge';
    d.menu.selected = weapon;
    d.menu.render();
  };

  beforeEach(async () => {
    const storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { activeElement: null });
    d = new RunDriver(storage);
    d.run.activeBlessings = [{ id: 'frugal_smith', rolledCost: null }];
    d.run._runStartBlessingsApplied = false;
    d.run.applyRunStartBlessingEffects();
    await d.step({ type: 'enter', service: 'shop' });
    weapon = { ...clone(d.data.weapons.find((w) => w.name === 'Steel Sword')), uid: 'sm-menu' };
    const owner = d.run.roster[0];
    owner.inventory = [weapon];
    owner.weapon = weapon;
    d.run.gold = 1000;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows "Free" on every stat of the first forge and the real price once it is spent', () => {
    openForge();
    expect(text()).toContain('The first is free.');
    button('Choose forge').onclick();
    const { choices, describe: describeChoice, apply } = d.menu.child.options;
    expect(choices).toHaveLength(4);
    expect(describeChoice(choices[0])).toMatch(/^Free · 0\/\d upgrades/);
    expect(describeChoice(choices[1])).toMatch(/^Free · /);
    const result = apply(choices[0]);
    expect(result.ok).toBe(true);
    // The use is spent (the scene counts it) and the gold untouched.
    expect(d.scene.shopForgesUsed).toBe(1);
    expect(d.run.gold).toBe(1000);
    d.menu.child?.close?.();
    d.menu.render();
    expect(text()).not.toMatch(/is free\./);
    button('Choose forge').onclick();
    const next = d.menu.child.options;
    expect(next.describe(next.choices[0])).toMatch(/^800 gold · 1\/\d upgrades/);
    expect(next.describe(next.choices[1])).toMatch(/^250 gold · /);
  });

  it('does not offer Free on a stat that cannot be forged (at its cap)', () => {
    // Might forged to its per-stat cap: the first forge is free, but not for that stat.
    while (applyForge(weapon, 'might', 0, { free: true }).success) {
      /* forge to the per-stat cap */
    }
    openForge();
    button('Choose forge').onclick();
    const { choices, describe: describeChoice, blocked } = d.menu.child.options;
    const might = choices.find((c) => c.key === 'might');
    const hit = choices.find((c) => c.key === 'hit');
    expect(blocked(might)).not.toBe('');
    expect(describeChoice(might)).not.toMatch(/Free/);
    expect(describeChoice(hit)).toMatch(/^Free · /);
  });

  it('lets the first forge through with an empty purse', () => {
    d.run.gold = 0;
    openForge();
    button('Choose forge').onclick();
    const { choices, blocked } = d.menu.child.options;
    expect(blocked(choices[0])).toBe('');
  });

  it('the forge tab says how many forges remain, the extra one included', () => {
    openForge();
    const limit = SHOP_FORGE_LIMITS[d.run.currentAct] + 1;
    expect(text()).toContain(`${limit} of ${limit} shop forges remaining.`);
  });

  it('a worn weapon’s Repair button and confirm read Free, then its price after one use', () => {
    applyWear(weapon, 'might');
    applyWear(weapon, 'hit');
    openForge();
    expect(button('Repair · Free')).toBeTruthy();
    button('Repair · Free').onclick();
    expect(d.menu.child.options.describe(true)).toContain("Free (Smith's Mark) and one shop forge");
    expect(d.menu.child.options.describe(true)).not.toMatch(/\d+ gold/);
    expect(d.menu.child.options.apply(true).ok).toBe(true);
    expect(d.run.gold).toBe(1000);
    expect(d.scene.shopForgesUsed).toBe(1);
    d.menu.child?.close?.();
    d.menu.render();
    expect(button(/^Repair · \d+ G$/)).toBeTruthy();
    expect(button('Repair · 200 G')).toBeTruthy();
  });

  it('the next shop is free again, and re-entering the same shop remembers the spent use', async () => {
    openForge();
    button('Choose forge').onclick();
    d.menu.child.options.apply(d.menu.child.options.choices[0]);
    d.menu.child?.close?.();
    d.leave();

    // The same shop again: the saved count of uses keeps the first one spent.
    await d.step({ type: 'enter', service: 'shop' });
    openForge();
    expect(d.scene.shopForgesUsed).toBe(1);
    expect(text()).not.toMatch(/is free\./);
    d.leave();

    // A different shop node starts from zero.
    d.run.nodeMap.nodes.push({
      id: 'journey-shop-two',
      type: 'shop',
      row: 3,
      col: 0,
      completed: false,
      connections: [],
    });
    d.service = 'shop';
    d.shop.handleShop(d.run.nodeMap.nodes.at(-1));
    expect(d.scene.shopForgesUsed).toBe(0);
    openForge();
    expect(text()).toContain('The first is free.');
    d.service = null;
  });
});
