// Blessings v3 pricing (docs/specs/blessings-v3.md §3): a named price catalog with points,
// candidate prices per blessing inside tier bands, Debt scaled by rung, offers that never show
// two cards of one tier, and the new price effects applied through the systems that own them.
//
// Ways this can fail, a test each:
//   1. the validator lets through a price outside its band, an unknown price, a gold price on a
//      gold blessing, a price sharing its boon's effect type, or a tier IV without a pact;
//   2. a Debt is not the rung's amount, or the label promises a different amount than is owed;
//   3. an offer repeats a tier in slots 2-3, drops the free tier I, or offers a weight-0 blessing;
//   4. a rolled price is not one of the blessing's own candidates, or a pact blessing rolls;
//   5. a price effect does nothing (Vision, shadow, shops, Act 1 deploys, revives, burdens);
//   6. a price that would cost this run nothing is offered (shadow with the Eclipse off, Vision
//      with no charge);
//   7. a run's prices do not survive a save and load;
//   8. a price names a burden, shadow or Vision the terms table cannot explain.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  validateBlessingsConfig,
  resolvePriceOption,
  rollPriceForBlessing,
  createSeededRng,
} from '../src/engine/BlessingEngine.js';
import { churchReviveBlock } from '../src/engine/ChurchCommands.js';
import { resolveDeployLimits } from '../src/engine/BattleDeployCount.js';
import { WOUND_STATS } from '../src/engine/Burdens.js';
import { findCommander } from '../src/engine/Commander.js';
import { blessingTerms, EXPLAINED_BURDEN_IDS } from '../src/engine/BlessingTerms.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = data.blessings;
const byId = (id) => catalog.blessings.find((b) => b.id === id);
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];

function run({ seed = 11, difficultyId = 'dusk', eclipseEnabled = true } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, eclipseEnabled, applyBlessingsAtStart: false });
  return rm;
}
/** Hold `id` at the price made of `option` (catalog ids), applied as the shrine applies it. */
function holdAt(rm, id, option, kind = 'cost') {
  const price = resolvePriceOption(catalog, option, { difficultyId: rm.difficultyId, kind });
  rm.activeBlessings = [{ id, rolledCost: price }];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return price;
}
const errorsOf = (mutate) => {
  const copy = structuredClone(catalog);
  mutate(copy);
  return validateBlessingsConfig(copy).errors.join('\n');
};

describe('the v3 catalog validates, and the validator refuses what it must', () => {
  it('ships valid', () => {
    expect(validateBlessingsConfig(catalog).errors).toEqual([]);
  });

  it('refuses a price outside its band', () => {
    const msg = errorsOf((c) => {
      c.blessings.find((b) => b.id === 'swift_instinct').prices = ['debt_heavy'];
    });
    expect(msg).toMatch(/swift_instinct\.prices\[0\] costs 5 points, outside tier 2's band 1-2/);
  });

  it('refuses an unknown price, a gold price on a gold blessing, and a price sharing its boon type', () => {
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'iron_oath').prices = ['no_such_price'];
      }),
    ).toMatch(/unknown price "no_such_price"/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'merchant_bane').prices = ['debt_large'];
      }),
    ).toMatch(/gold price on a gold blessing/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'nomad_pact').prices = [
          ['recruits_level_down', 'debt_small'],
        ];
      }),
    ).toMatch(/shares the effect type "recruit_level_bonus" with its boon/);
  });

  it('refuses a tier IV without a pact, a pact below tier IV, and a priced tier I', () => {
    expect(
      errorsOf((c) => {
        delete c.blessings.find((b) => b.id === 'arsenal_pact').pact;
      }),
    ).toMatch(/arsenal_pact: a tier 4 blessing carries a fixed pact/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'iron_oath').pact = ['debt_large'];
      }),
    ).toMatch(/only tier 4 carries a pact/);
    expect(
      errorsOf((c) => {
        c.blessings.find((b) => b.id === 'field_medic').prices = ['ill_omen'];
      }),
    ).toMatch(/field_medic: a tier 1 blessing is a free gift/);
  });
});

describe('Debt is the rung’s amount, and owed as labelled', () => {
  // Dusk amounts 1,500 / 3,000 / 5,000 x debtScale, rounded to 50 (sim:debt, spec §3.1).
  const EXPECTED = {
    debt_small: { normal: 850, dusk: 1500, hard: 1600, lunatic: 2200 },
    debt_large: { normal: 1650, dusk: 3000, hard: 3200, lunatic: 4450 },
    debt_heavy: { normal: 2750, dusk: 5000, hard: 5350, lunatic: 7400 },
  };
  for (const [id, byRung] of Object.entries(EXPECTED)) {
    it(`${id} scales by rung`, () => {
      for (const rung of RUNGS) {
        const price = resolvePriceOption(catalog, id, { difficultyId: rung });
        expect(price.effects[0].params.owed, `${id} ${rung}`).toBe(byRung[rung]);
        expect(price.label).toBe(`Debt: ${byRung[rung].toLocaleString('en-US')} gold`);
      }
    });
  }

  it('the run owes exactly the labelled amount, at the rung’s garnish', () => {
    for (const [rung, garnish] of [
      ['normal', 0.25],
      ['dusk', 0.5],
    ]) {
      const rm = run({ difficultyId: rung });
      const price = holdAt(rm, 'iron_oath', 'debt_large');
      const owed = Number(price.label.replace(/[^\d]/g, ''));
      expect(rm.burdens.find((b) => b.id === 'debt')).toEqual({ id: 'debt', owed, garnish });
    }
  });
});

describe('offers', () => {
  it('slot 1 is a free tier I; slots 2-3 are two different tiers of II-IV; Armory Stash never shows', () => {
    let tier4 = 0;
    const N = 1500;
    for (let seed = 1; seed <= N; seed++) {
      const offers = run({ seed }).getBlessingOptions();
      expect(offers).toHaveLength(3);
      expect(offers[0].tier).toBe(1);
      expect(offers[0].rolledCost).toBeNull();
      const later = offers.slice(1).map((o) => o.tier);
      expect(new Set(later).size).toBe(2);
      expect(later[0]).toBeLessThan(later[1]); // the smaller bet first
      for (const t of later) expect([2, 3, 4]).toContain(t);
      expect(offers.some((o) => o.id === 'armory_stash')).toBe(false);
      if (later.includes(4)) tier4++;
    }
    // Weights II 1 / III .8 / IV .25: P(IV in two distinct draws) = 0.316 (spec: about 30%).
    const w = { 2: 1, 3: 0.8, 4: 0.25 };
    const total = w[2] + w[3] + w[4];
    const expected =
      w[4] / total +
      (w[2] / total) * (w[4] / (w[3] + w[4])) +
      (w[3] / total) * (w[4] / (w[2] + w[4]));
    expect(tier4 / N).toBeGreaterThan(expected - 0.04);
    expect(tier4 / N).toBeLessThan(expected + 0.04);
  });

  it('every rolled price is one of the blessing’s candidates; a pact blessing always pays its pact', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rm = run({ seed });
      for (const offer of rm.getBlessingOptions()) {
        if (offer.tier === 1) continue;
        const b = byId(offer.id);
        const options = b.pact ? [b.pact] : b.prices;
        const labels = options.map(
          (o) => resolvePriceOption(catalog, o, { difficultyId: 'dusk' }).label,
        );
        expect(labels, offer.id).toContain(offer.rolledCost.label);
        if (b.pact) expect(offer.rolledCost.kind).toBe('pact');
      }
    }
  });

  it('the same seed offers the same cards at the same prices', () => {
    const a = run({ seed: 99 }).getBlessingOptions();
    const b = run({ seed: 99 }).getBlessingOptions();
    expect(b.map((o) => [o.id, o.rolledCost?.label])).toEqual(
      a.map((o) => [o.id, o.rolledCost?.label]),
    );
  });
});

describe('each price does what it says', () => {
  it('-1 Vision takes a charge now', () => {
    const rm = run();
    const before = rm.visionChargesRemaining;
    expect(before).toBeGreaterThan(0);
    holdAt(rm, 'merchant_bane', 'vision_down');
    expect(rm.visionChargesRemaining).toBe(before - 1);
  });

  it('+8 shadow darkens the sun now', () => {
    const rm = run();
    const before = rm.eclipse.shadow;
    holdAt(rm, 'swift_instinct', ['ill_omen', 'act1_hit_down']);
    expect(rm.eclipse.shadow).toBe(before);
    const rm2 = run();
    rm2.activeBlessings = [
      {
        id: 'swift_instinct',
        rolledCost: { label: '+8 shadow now', effects: catalog.priceCatalog.shadow_now.effects },
      },
    ];
    rm2._runStartBlessingsApplied = false;
    rm2.applyRunStartBlessingEffects();
    expect(rm2.eclipse.shadow).toBe(before + 8);
  });

  it('shop prices +15% is a negative shop discount', () => {
    const rm = run();
    holdAt(rm, 'war_veteran', ['act1_deploy_down', 'shops_dearer']);
    expect(rm.getShopPriceDiscount()).toBeCloseTo(-0.15, 10);
  });

  it('one fewer deploy in Act 1 only, never below the act’s minimum', () => {
    const rm = run();
    holdAt(rm, 'war_veteran', ['act1_deploy_down', 'shops_dearer']);
    expect(rm.getDeployBonus('act1')).toBe(-1);
    expect(rm.getDeployBonus('act2')).toBe(0);
    const act1 = resolveDeployLimits({
      base: DEPLOY_LIMITS.act1,
      deployBonus: rm.getDeployBonus('act1'),
    });
    expect(act1.max).toBe(DEPLOY_LIMITS.act1.max - 1);
    expect(act1.max).toBeGreaterThanOrEqual(DEPLOY_LIMITS.act1.min);
  });

  it('no church revives: the church and the Ruins refuse', () => {
    const rm = run();
    holdAt(rm, 'forbidden_tome', byId('forbidden_tome').pact, 'pact');
    const fallen = rm.roster.find((u) => !u.isCommander);
    rm.roster = rm.roster.filter((u) => u !== fallen);
    rm.fallenUnits = [fallen];
    rm.gold = 99999;
    expect(churchReviveBlock(rm, fallen)).toMatch(/fallen stay fallen/);
  });

  it('a Lingering Injury falls on the commander, on a stat the run seed picks', () => {
    const stats = new Set();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rm = run({ seed });
      holdAt(rm, 'rally_cry', 'commander_injury');
      const wound = rm.burdens.find((b) => b.id === 'wounded');
      const commander = findCommander(rm.roster);
      expect(wound).toMatchObject({ unitUid: commander.unitUid, value: -2 });
      expect(WOUND_STATS).toContain(wound.stat);
      stats.add(wound.stat);
      // Same seed, same stat.
      const again = run({ seed });
      holdAt(again, 'rally_cry', 'commander_injury');
      expect(again.burdens.find((b) => b.id === 'wounded').stat).toBe(wound.stat);
    }
    expect(stats.size).toBeGreaterThan(1);
  });

  it('Hunted, Sworn Enemy and Ill Omen become the run’s burdens', () => {
    const rm = run();
    holdAt(rm, 'iron_oath', ['hunted', 'act1_hit_down']);
    expect(rm.burdens.map((b) => b.id)).toEqual(['hunted']);
    const rm2 = run();
    holdAt(rm2, 'merchant_bane', ['sworn_enemy', 'act1_hit_down']);
    expect(rm2.burdens.map((b) => b.id)).toEqual(['sworn_enemy']);
    const rm3 = run();
    holdAt(rm3, 'frugal_smith', 'ill_omen');
    expect(rm3.burdens.map((b) => b.id)).toEqual(['ill_omen']);
  });
});

describe('a price that would cost nothing is never offered', () => {
  const shadowOnly = { ...byId('swift_instinct'), prices: ['shadow_now', 'staff_heal_down'] };
  const visionOnly = {
    ...byId('merchant_bane'),
    prices: ['vision_down', ['hunted', 'act1_def_down_1']],
  };

  it('shadow with the Eclipse off', () => {
    const rm = run({ eclipseEnabled: false });
    for (let i = 0; i < 30; i++) {
      const price = rollPriceForBlessing(catalog, shadowOnly, createSeededRng(i), {
        isApplicable: (p) => rm.isBlessingCostApplicable(p),
      });
      expect(price.label).not.toMatch(/shadow/);
    }
  });

  it('Vision with no charge to lose', () => {
    const rm = run();
    rm.visionChargesRemaining = 0;
    for (let i = 0; i < 30; i++) {
      const price = rollPriceForBlessing(catalog, visionOnly, createSeededRng(i), {
        isApplicable: (p) => rm.isBlessingCostApplicable(p),
      });
      expect(price.label).not.toMatch(/Vision/);
    }
  });
});

describe('save and load', () => {
  it('a run’s prices survive: Debt, the Act 1 deploy cut and the revive pact', () => {
    const rm = run({ difficultyId: 'hard' });
    holdAt(rm, 'war_veteran', ['act1_deploy_down', 'shops_dearer']);
    rm.activeBlessings.push({
      id: 'forbidden_tome',
      rolledCost: resolvePriceOption(catalog, byId('forbidden_tome').pact, { kind: 'pact' }),
    });
    rm._applySingleRunStartBlessingEffect('forbidden_tome', {
      type: 'church_revive_disabled',
      params: {},
    });
    rm._applySingleRunStartBlessingEffect('iron_oath', {
      type: 'burden',
      params: { id: 'debt', owed: 3200 },
    });
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(restored.getDeployBonus('act1')).toBe(-1);
    expect(restored.getShopPriceDiscount()).toBeCloseTo(-0.15, 10);
    expect(restored.isChurchReviveDisabled()).toBe(true);
    expect(restored.burdens.find((b) => b.id === 'debt')).toMatchObject({
      owed: 3200,
      garnish: 0.5,
    });
    expect(restored.activeBlessings.find((b) => b.id === 'forbidden_tome').rolledCost.kind).toBe(
      'pact',
    );
  });

  it('a save from before v3 keeps the price it was charged', () => {
    const rm = run();
    const legacy = { label: '-15% battle gold', effects: catalog.costPools['2'][0].effects };
    rm.activeBlessings = [{ id: 'swift_instinct', rolledCost: legacy }];
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(restored.activeBlessings[0].rolledCost).toEqual(legacy);
  });
});

describe('every price’s words are explained', () => {
  it('each burden in the catalog has a sentence', () => {
    for (const id of Object.keys(data.events.burdens)) expect(EXPLAINED_BURDEN_IDS).toContain(id);
  });

  it('each price that is a burden, shadow or Vision names a term the table explains', () => {
    const want = (effect) =>
      effect.type === 'burden'
        ? {
            debt: 'Debt',
            hunted: 'Hunted',
            sworn_enemy: 'Sworn Enemy',
            ill_omen: 'Ill Omen',
            wounded: 'Lingering Injury',
          }[effect.params.id]
        : effect.type === 'eclipse_shadow_delta'
          ? 'Shadow'
          : effect.type === 'vision_delta'
            ? 'Vision'
            : null;
    for (const [id, entry] of Object.entries(catalog.priceCatalog)) {
      const label = resolvePriceOption(catalog, id, { difficultyId: 'dusk' }).label;
      const terms = blessingTerms([label], { burdens: data.events.burdens, difficultyId: 'dusk' });
      for (const effect of entry.effects) {
        const term = want(effect);
        if (term)
          expect(
            terms.map((t) => t.term),
            `${id}: ${label}`,
          ).toContain(term);
      }
      for (const t of terms) expect(t.text.length, `${id} ${t.term}`).toBeGreaterThan(20);
    }
  });

  it('the sentences carry the rung’s numbers', () => {
    const fl = blessingTerms(['Debt: 850 gold', 'Ill Omen'], {
      burdens: data.events.burdens,
      difficultyId: 'normal',
    });
    expect(fl.find((t) => t.term === 'Debt').text).toMatch(/^A quarter of each victory/);
    expect(fl.find((t) => t.term === 'Ill Omen').text).toMatch(/2 victories/);
    const dusk = blessingTerms(['Debt: 1,500 gold'], {
      burdens: data.events.burdens,
      difficultyId: 'dusk',
    });
    expect(dusk[0].text).toMatch(/^Half of each victory/);
  });
});
