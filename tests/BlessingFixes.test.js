// Blessing fixes: a forge price that charges what it says,
// a church or event blessing that never grows a price on reload, and the pause menu's list
// of the blessings a run holds.
//
// Ways this can fail, a test each:
//   1. a "+20% forge costs" price charges the base price (the shop clamped it away), or a
//      shop refuses to forge at all under it;
//   2. a forge discount or a liberated village's discount stops composing;
//   3. a repair under the price is refused, or charges the base price;
//   4. an out-of-range discount is accepted;
//   5. a mid-run tier III blessing (the Twin Altar's) shows a price after a save and load;
//   6. a save from before the flag keeps that phantom price, or loses the real run-start one;
//   7. the pause list hides a held blessing, misnames a pact, or invents a price.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  FORGE_DISCOUNT_MIN,
  forgeShopWeapon,
  shopForgeDiscount,
  repairShopWeapon,
  shopRepairBlock,
} from '../src/engine/ShopCommands.js';
import { applyWear, wearCount } from '../src/engine/WeaponWear.js';
import { getForgeCost } from '../src/engine/ForgeSystem.js';
import { resolvePriceOption } from '../src/engine/BlessingEngine.js';
import { heldBlessingEntries } from '../src/ui/heldBlessingsModel.js';
import { pauseBlessingList } from '../src/ui/MobilePauseMenu.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const clone = (value) => structuredClone(value);

/** A run whose start pick carries `rolledCost` (applied as the shrine would). */
function runWithPrice(id, rolledCost) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 11 });
  rm.activeBlessings = [{ id, rolledCost }];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const FORGE_PRICE = (value) => ({
  label: `+${Math.round(value * 100)}% forge costs`,
  effects: [{ type: 'forge_cost_multiplier', params: { value } }],
});

function withSword(rm) {
  const sword = clone(data.weapons.find((w) => w.name === 'Iron Sword'));
  const unit = {
    name: 'Edric',
    stats: { HP: 22 },
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    inventory: [sword],
    weapon: sword,
    consumables: [],
  };
  rm.roster = [unit];
  rm.gold = 10000;
  return sword;
}

describe('forge prices from blessings', () => {
  it('a +20% forge price makes every forge cost 20% more', () => {
    const rm = runWithPrice('iron_oath', FORGE_PRICE(0.2));
    const sword = withSword(rm);
    // Iron tier is x0.6 of the 400 gold first Might step.
    expect(getForgeCost(sword, 'might')).toBe(240);
    const discount = shopForgeDiscount(rm);
    expect(discount).toBeCloseTo(-0.2, 10);
    const gold = rm.gold;
    const result = forgeShopWeapon(rm, sword, 'might', {
      forgesUsed: 0,
      forgeLimit: 2,
      discount,
      expectedLevel: 0,
    });
    expect(result.ok).toBe(true);
    expect(rm.gold).toBe(gold - 288);
  });

  it('a +35% price and a forge discount each charge what they say', () => {
    const dear = runWithPrice('iron_oath', FORGE_PRICE(0.35));
    expect(shopForgeDiscount(dear)).toBeCloseTo(-0.35, 10);
    // No card gives a forge discount now; the effect type stays (events, old saves), so the
    // charge is checked with a synthetic 30% off.
    const frugal = new RunManager(data);
    frugal.startRun({ runSeed: 11 });
    frugal._applySingleRunStartBlessingEffect('synthetic', {
      type: 'forge_cost_multiplier',
      params: { value: -0.3 },
    });
    expect(shopForgeDiscount(frugal)).toBeCloseTo(0.3, 10);
    const sword = withSword(frugal);
    const gold = frugal.gold;
    forgeShopWeapon(frugal, sword, 'might', {
      forgesUsed: 0,
      forgeLimit: 3,
      discount: shopForgeDiscount(frugal),
      expectedLevel: 0,
    });
    expect(frugal.gold).toBe(gold - 168);
  });

  it("a liberated village's 20% off composes with either", () => {
    const dear = runWithPrice('iron_oath', FORGE_PRICE(0.2));
    // 1.2 x 0.8 = 0.96 of the price.
    expect(shopForgeDiscount(dear, { ambushDiscount: true })).toBeCloseTo(0.04, 10);
    const plain = new RunManager(data);
    plain.startRun({ runSeed: 11 });
    expect(shopForgeDiscount(plain, { ambushDiscount: true })).toBeCloseTo(0.2, 10);
  });

  it('a repair under the price repairs the weapon and charges the surcharge', () => {
    // Iron tier: the Might step's first forge price is 400 x 0.6 = 240, a repair half that.
    for (const [ambushDiscount, charged] of [
      [false, 144], // 120 x 1.2
      [true, 115], // 120 x 1.2 x 0.8 = 115.2
    ]) {
      const rm = runWithPrice('iron_oath', FORGE_PRICE(0.2));
      const sword = withSword(rm);
      const might = sword.might;
      expect(applyWear(sword, 'might').success).toBe(true);
      expect(sword.might).toBe(might - 1);
      const options = {
        forgesUsed: 0,
        forgeLimit: 2,
        discount: shopForgeDiscount(rm, { ambushDiscount }),
      };
      expect(shopRepairBlock(rm, sword, options)).toBe('');
      const gold = rm.gold;
      const result = repairShopWeapon(rm, sword, options);
      expect(result.ok).toBe(true);
      expect(rm.gold).toBe(gold - charged);
      expect(wearCount(sword)).toBe(0);
      expect(sword.might).toBe(might);
      expect(sword.name).toBe('Iron Sword');
    }
  });

  it('refuses a discount outside the range', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 11 });
    const sword = withSword(rm);
    const options = { forgesUsed: 0, forgeLimit: 2, expectedLevel: 0 };
    for (const discount of [FORGE_DISCOUNT_MIN - 0.5, 1, Number.NaN]) {
      const gold = rm.gold;
      expect(forgeShopWeapon(rm, sword, 'might', { ...options, discount }).ok).toBe(false);
      expect(rm.gold).toBe(gold);
    }
  });
});

describe('blessings taken mid-run', () => {
  const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);

  it('a tier III blessing from an event keeps no price through a save and load', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 11 });
    // A pact card (tier IV) is never granted mid-run: its price would never be paid.
    expect(rm.addBlessingMidRun('scholar_vow')).toBe(false);
    expect(rm.addBlessingMidRun('iron_oath')).toBe(true);
    const restored = roundTrip(roundTrip(rm));
    const entry = restored.activeBlessings.find((b) => b.id === 'iron_oath');
    expect(entry.rolledCost).toBeNull();
    expect(entry.midRun).toBe(true);
    expect(heldBlessingEntries(restored).find((b) => b.id === 'iron_oath').price).toBeNull();
  });

  it('an older save drops the phantom price and keeps the run-start one', () => {
    let rm, picked;
    for (let seed = 1; seed < 200 && !picked; seed++) {
      rm = new RunManager(data);
      rm.startRun({ runSeed: seed, applyBlessingsAtStart: false });
      picked = rm.getBlessingOptions().find((b) => b.tier >= 2 && b.rolledCost && !b.pact);
    }
    expect(picked).toBeTruthy();
    expect(rm.chooseBlessing(picked.id)).toBe(true);
    const startPrice = rm.activeBlessings[0].rolledCost.label;
    const other = data.blessings.blessings.find(
      (b) => b.tier === 3 && b.id !== picked.id && !b.intrinsicPrice && !b.pact,
    );
    rm.addBlessingMidRun(other.id);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    // As an older client saved it: no flag, and a price the load once rolled for it.
    const legacy = saved.activeBlessings.find((b) => b.id === other.id);
    delete legacy.midRun;
    legacy.rolledCost = clone(data.blessings.costPools['3'][0]);
    const restored = RunManager.fromJSON(saved, data);
    expect(restored.activeBlessings.find((b) => b.id === other.id).rolledCost).toBeNull();
    expect(restored.activeBlessings.find((b) => b.id === picked.id).rolledCost.label).toBe(
      startPrice,
    );
  });
});

describe('the pause menu lists held blessings', () => {
  beforeEach(() => installFakeDom(vi));
  afterEach(() => vi.unstubAllGlobals());

  it('names each blessing, its tier and what it cost', () => {
    const tome = data.blessings.blessings.find((b) => b.id === 'forbidden_tome');
    const pact = resolvePriceOption(data.blessings, tome.pact, { kind: 'pact' });
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 11 });
    rm.activeBlessings = [{ id: 'forbidden_tome', rolledCost: pact }];
    rm.addBlessingMidRun('field_medic');
    rm.addBlessingMidRun('iron_oath');
    const entries = heldBlessingEntries(rm);
    expect(entries.map((e) => [e.label, e.tier, e.priceKind, e.price])).toEqual([
      ['Forbidden Tome', 'IV', 'Pact', pact.label],
      ['Field Medic', 'I', null, null],
      ['Iron Oath', 'III', null, null],
    ]);
    const list = pauseBlessingList(entries);
    expect(list.getAttribute('aria-label')).toBe('Blessings');
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('strong').textContent).toBe('Forbidden Tome · IV');
    expect(items[0].textContent).toContain(`Pact: ${pact.label}`);
    // The price's words open on a tap: touch has no hover.
    expect(items[0].querySelector('summary').textContent).toBe(`Pact: ${pact.label}`);
    expect(items[0].querySelector('.mp-blessing-terms').textContent).toContain(
      'A pact is a fixed price',
    );
    expect(items[1].textContent).not.toContain('Cost:');
  });

  it('shows nothing for a run with no blessings, and skips an unknown id', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 11 });
    rm.activeBlessings = [];
    expect(pauseBlessingList(heldBlessingEntries(rm))).toBeNull();
    rm.activeBlessings = [{ id: 'retired_blessing' }, { id: 'steady_hands' }];
    expect(heldBlessingEntries(rm).map((e) => e.id)).toEqual(['steady_hands']);
  });
});
