// Intrinsic prices (docs/blessings_contract.md §3.1 item 8): a tier II-III blessing whose own
// boon carries its cost names `intrinsicPrice` { label, points } instead of catalog `prices`.
//
// Ways this can fail, a test each:
//   1. the validator accepts an intrinsic price on a free tier I or a pact tier IV, beside
//      prices or a pact, outside the tier's band, with no label or points, or in a v2 config;
//   2. an intrinsic card spends a different number of price draws than a pact, so the cards
//      offered beside it roll different prices for the same seed;
//   3. a save and load invents a pool price for an intrinsic blessing (the reload path rolls a
//      v2 costPools price for any tier II+ blessing it finds without one), or loses its label;
//   4. the shrine, the pause list or the card call the price a "Cost" (or hide it) so it reads
//      as "None: a clean gift";
//   5. an event or a church could hand the card out later, where the cost would never be paid.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  validateBlessingsConfig,
  rollPriceForBlessing,
  selectBlessingOptionsWithTelemetry,
  createSeededRng,
} from '../src/engine/BlessingEngine.js';
import { isSafeEventBlessing } from '../src/engine/EventSystem.js';
import { blessingCardContent, blessingPriceKind } from '../src/ui/choiceContent.js';
import { heldBlessingEntries } from '../src/ui/heldBlessingsModel.js';
import { pauseBlessingList } from '../src/ui/MobilePauseMenu.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = data.blessings;
const byId = (id) => catalog.blessings.find((b) => b.id === id);
const errorsOf = (mutate) => {
  const copy = structuredClone(catalog);
  mutate(copy);
  return validateBlessingsConfig(copy).errors.join('\n');
};

/** A fresh run whose shrine offered `id` (first seed that does), with `id` taken. */
function runHolding(id, { difficultyId = 'dusk' } = {}) {
  for (let seed = 1; seed <= 600; seed++) {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
    if (!rm.getBlessingOptions().some((o) => o.id === id)) continue;
    expect(rm.chooseBlessing(id)).toBe(true);
    return rm;
  }
  throw new Error(`no seed offers ${id}`);
}

describe('the validator and intrinsic prices', () => {
  it('ships valid, and the two intrinsic cards sit inside their tier bands', () => {
    expect(validateBlessingsConfig(catalog).errors).toEqual([]);
    for (const id of ['slow_fuse', 'gamblers_toss']) {
      const b = byId(id);
      const [lo, hi] = catalog.tierBands[String(b.tier)];
      expect(b.intrinsicPrice.points, id).toBeGreaterThanOrEqual(lo);
      expect(b.intrinsicPrice.points, id).toBeLessThanOrEqual(hi);
      expect(b.prices, id).toBeUndefined();
      expect(b.pact, id).toBeUndefined();
    }
  });

  it('refuses an intrinsic price beside prices or a pact', () => {
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'slow_fuse').prices = ['staff_heal_down'];
      }),
    ).toMatch(/slow_fuse: an intrinsic price replaces prices and pact/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'gamblers_toss').pact = ['debt_large'];
      }),
    ).toMatch(/gamblers_toss: an intrinsic price replaces prices and pact/);
  });

  it('refuses an intrinsic price on a free tier I or on a tier IV (which carries a pact)', () => {
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'field_medic').intrinsicPrice = {
          label: 'Free is free',
          points: 1,
        };
      }),
    ).toMatch(/field_medic: a tier 1 blessing is a free gift/);
    expect(
      errorsOf((c) => {
        const tome = c.blessings.find((b) => b.id === 'forbidden_tome');
        delete tome.pact;
        tome.intrinsicPrice = { label: 'Its own', points: 5 };
      }),
    ).toMatch(/forbidden_tome: a tier 4 blessing carries a fixed pact/);
  });

  it('refuses an intrinsic price outside its tier band', () => {
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'slow_fuse').intrinsicPrice.points = 3;
      }),
    ).toMatch(/slow_fuse\.intrinsicPrice costs 3 points, outside tier 2's band 1-2/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'gamblers_toss').intrinsicPrice.points = 1;
      }),
    ).toMatch(/gamblers_toss\.intrinsicPrice costs 1 points, outside tier 3's band 2.5-3.5/);
  });

  it('refuses an intrinsic price with no label, no points or the wrong shape', () => {
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'slow_fuse').intrinsicPrice.label = '  ';
      }),
    ).toMatch(/slow_fuse\.intrinsicPrice\.label must be a non-empty string/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'slow_fuse').intrinsicPrice.points = 0;
      }),
    ).toMatch(/slow_fuse\.intrinsicPrice\.points must be a positive number/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'slow_fuse').intrinsicPrice = 'cheap';
      }),
    ).toMatch(/slow_fuse\.intrinsicPrice must be \{ label, points \}/);
  });

  it('a blessing with neither prices nor an intrinsic price is still refused', () => {
    expect(
      errorsOf((c) => {
        delete c.blessings.find((b) => b.id === 'slow_fuse').intrinsicPrice;
      }),
    ).toMatch(/slow_fuse\.prices must name the blessing's candidate prices/);
  });

  it('a v2 config cannot carry one (its rolled pools would ignore it)', () => {
    const v2 = structuredClone(catalog);
    v2.version = 2;
    expect(validateBlessingsConfig(v2).errors.join('\n')).toMatch(
      /blessings\[\d+\]\.intrinsicPrice needs contract v3/,
    );
  });
});

describe('an intrinsic price in the offer', () => {
  it('rolls as one draw, like a pact, and stores no effects', () => {
    let draws = 0;
    const rand = createSeededRng(7);
    const counting = () => {
      draws++;
      return rand();
    };
    const price = rollPriceForBlessing(catalog, byId('slow_fuse'), counting);
    expect(draws).toBe(1);
    expect(price).toEqual({
      label: 'The Act 1 dip',
      effects: [],
      points: 2,
      kind: 'intrinsic',
    });
    draws = 0;
    rollPriceForBlessing(catalog, byId('forbidden_tome'), counting);
    expect(draws).toBe(1);
  });

  it("an intrinsic card does not shift its neighbours' price rolls", () => {
    // The same offer, with Slow Fuse's price swapped for one catalog price: both spend one
    // draw, so the tier III card beside it must roll the same price for every seed.
    const only = (config) => {
      for (const b of config.blessings) {
        if (!['steady_hands', 'slow_fuse', 'merchant_bane'].includes(b.id)) b.weight = 0;
      }
      return config;
    };
    const intrinsic = only(structuredClone(catalog));
    const catalogPriced = only(structuredClone(catalog));
    const fuse = catalogPriced.blessings.find((b) => b.id === 'slow_fuse');
    delete fuse.intrinsicPrice;
    fuse.prices = ['staff_heal_down'];
    for (let seed = 1; seed <= 60; seed++) {
      const a = selectBlessingOptionsWithTelemetry(intrinsic, createSeededRng(seed), {
        difficultyId: 'dusk',
      }).selected;
      const b = selectBlessingOptionsWithTelemetry(catalogPriced, createSeededRng(seed), {
        difficultyId: 'dusk',
      }).selected;
      expect(
        a.map((o) => o.id),
        `seed ${seed}`,
      ).toEqual(b.map((o) => o.id));
      const bane = (list) => list.find((o) => o.id === 'merchant_bane')?.rolledCost?.label;
      expect(bane(a), `seed ${seed}`).toBe(bane(b));
    }
  });
});

describe('a held intrinsic price survives the run', () => {
  it('is stored as an intrinsic price with no effects, and a reload keeps exactly that', () => {
    const rm = runHolding('slow_fuse');
    const held = rm.activeBlessings.find((b) => b.id === 'slow_fuse');
    expect(held.rolledCost).toEqual({
      label: 'The Act 1 dip',
      effects: [],
      kind: 'intrinsic',
    });
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(restored.activeBlessings.find((b) => b.id === 'slow_fuse').rolledCost).toEqual(
      held.rolledCost,
    );
  });

  it('a load never invents a pool price for it, even from a save that stored none', () => {
    const rm = runHolding('gamblers_toss');
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.activeBlessings.find((b) => b.id === 'gamblers_toss').rolledCost = null;
    const restored = RunManager.fromJSON(saved, data);
    const price = restored.activeBlessings.find((b) => b.id === 'gamblers_toss').rolledCost;
    expect(price?.kind).toBe('intrinsic');
    expect(price?.label).toBe('Half your victories pay a third');
    // No v2 pool label ("Ill Omen", "Hunted", ...) anywhere in the held list.
    expect(heldBlessingEntries(restored).find((e) => e.id === 'gamblers_toss').price).toBe(
      'Half your victories pay a third',
    );
  });

  it('an offer taken from a card with no stored price still shows the intrinsic one', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    const resolved = rm._resolveBlessingOfferForSelection(byId('slow_fuse'), 0, 'test');
    expect(resolved.rolledCost).toMatchObject({ label: 'The Act 1 dip', kind: 'intrinsic' });
  });

  it('a mid-run grant never carries one (no phantom price after a load)', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    rm.activeBlessings = [];
    rm.addBlessingMidRun('slow_fuse');
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(restored.activeBlessings.find((b) => b.id === 'slow_fuse').rolledCost).toBeNull();
  });
});

describe('the shrine calls it a Price, not a Cost or a clean gift', () => {
  beforeEach(() => installFakeDom(vi));
  afterEach(() => vi.unstubAllGlobals());

  it('the card reads "Price: The Act 1 dip"', () => {
    const offer = { ...structuredClone(byId('slow_fuse')), rolledCost: null };
    // Even before a price is rolled onto it, the catalog's own label is the card's cost line.
    expect(blessingCardContent(offer)).toMatchObject({
      costLabel: 'Price',
      cost: 'The Act 1 dip',
      pact: false,
    });
    const rolled = rollPriceForBlessing(catalog, offer, createSeededRng(1));
    expect(blessingCardContent({ ...offer, rolledCost: rolled })).toMatchObject({
      costLabel: 'Price',
      cost: 'The Act 1 dip',
    });
    // A rolled cost and a pact keep their own words.
    expect(blessingPriceKind({ rolledCost: { kind: 'pact' } })).toBe('Pact');
    expect(blessingPriceKind(byId('forbidden_tome'))).toBe('Pact');
    expect(blessingPriceKind({ rolledCost: { label: 'x' } })).toBe('Cost');
    expect(blessingPriceKind(null)).toBe('Cost');
  });

  it('the held list and the pause menu say "Price: The Act 1 dip"', () => {
    const rm = runHolding('slow_fuse');
    const entry = heldBlessingEntries(rm).find((e) => e.id === 'slow_fuse');
    expect(entry).toMatchObject({ price: 'The Act 1 dip', priceKind: 'Price', tier: 'II' });
    const list = pauseBlessingList([entry]);
    expect(list.querySelector('li').textContent).toContain('Price: The Act 1 dip');
    expect(list.querySelector('li').textContent).not.toContain('Cost:');
  });
});

describe('an event or a church never hands one out', () => {
  it('a blessing with an intrinsic price is unsafe even when every boon type is safe', () => {
    const safeBoons = [{ type: 'lord_stat_bonus', params: { stat: 'STR', value: 1 } }];
    expect(isSafeEventBlessing({ boons: safeBoons })).toBe(true);
    expect(
      isSafeEventBlessing({ boons: safeBoons, intrinsicPrice: { label: 'x', points: 2 } }),
    ).toBe(false);
    expect(isSafeEventBlessing(byId('slow_fuse'))).toBe(false);
    expect(isSafeEventBlessing(byId('gamblers_toss'))).toBe(false);
  });
});
