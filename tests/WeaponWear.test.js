// WeaponWear.test.js — worn weapons (docs/specs/worn-weapons.md). The ways it can fail:
//   - a step moves the wrong stat, or by the wrong amount (it must be one forge step reversed)
//   - repair does not restore the weapon exactly (stats, price, name, instance fields)
//   - a weight-0 weapon or a tiny price loses a point on the round trip
//   - wear leaks into the forge's fields (cap, history, deforge refunds)
//   - a worn weapon can still be forged, or a forged one can wear
//   - the cost formula is off for a tier or a stat, or repairs the wrong (oldest) step
//   - an imbue breaks the name on the way in or out
// Expected numbers are worked out by hand from the spec, never by re-running the engine.
import { describe, it, expect } from 'vitest';
import {
  WEAR_STATS,
  WEAR_LABELS,
  applyWear,
  canWear,
  wearBlock,
  wearableStats,
  wearCount,
  isWorn,
  repairCost,
  repairPrice,
  repairWeapon,
  wearDisplay,
  wearLine,
  wearStatDelta,
  nextRepairStat,
} from '../src/engine/WeaponWear.js';
import {
  canForge,
  forgeStatBlock,
  applyForge,
  deforgeWeapon,
  isForged,
} from '../src/engine/ForgeSystem.js';
import { canImbue, applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import {
  WEAR_MAX_STEPS,
  WEAR_PRICE_PENALTY_PER_STEP,
  REPAIR_COST_RATIO,
  FORGE_BONUSES,
} from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const clone = (value) => structuredClone(value);
const catalog = (name) => clone(data.weapons.find((w) => w.name === name));
const sword = (overrides = {}) => ({ ...catalog('Iron Sword'), ...overrides });
const UNWEARABLE = ['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone'];
const combatWeapons = data.weapons.filter((w) => !UNWEARABLE.includes(w.type));

describe('constants', () => {
  it('are the designed values', () => {
    expect(WEAR_MAX_STEPS).toBe(3);
    expect(WEAR_PRICE_PENALTY_PER_STEP).toBe(0.15);
    expect(REPAIR_COST_RATIO).toBe(0.5);
  });
});

describe('one wear step is one forge step reversed', () => {
  // Hand-derived from the design: Dulled -1 Mt, Bent -5 Hit, Notched -5 Crit, Rusted +1 Weight.
  it.each([
    ['might', 'Dulled', { might: 4 }],
    ['hit', 'Bent', { hit: 85 }],
    ['crit', 'Notched', { crit: 5 }],
    ['weight', 'Rusted', { weight: 6 }],
  ])('%s is %s and changes only that stat', (stat, label, expected) => {
    const weapon = sword({ might: 5, hit: 90, crit: 10, weight: 5 });
    const before = clone(weapon);
    const result = applyWear(weapon, stat);
    expect(result).toMatchObject({ success: true, stat });
    expect(WEAR_LABELS[stat]).toBe(label);
    for (const key of ['might', 'hit', 'crit', 'weight'])
      expect(weapon[key]).toBe(expected[key] ?? before[key]);
  });

  it('a forge step and a wear step on the same stat cancel (sizes come from FORGE_BONUSES)', () => {
    for (const stat of WEAR_STATS) {
      const base = sword({ might: 6, hit: 80, crit: 10, weight: 7 });
      const forged = clone(base);
      applyForge(forged, stat);
      const worn = clone(base);
      applyWear(worn, stat);
      // base + (forged - base) + (worn - base) === base
      expect(forged[stat] - base[stat] + (worn[stat] - base[stat]), stat).toBe(0);
      expect(Math.abs(worn[stat] - base[stat]), stat).toBe(Math.abs(FORGE_BONUSES[stat]));
    }
  });

  it('crit may go below zero: combat adds SKL/2 and clamps', () => {
    const weapon = sword({ crit: 0 });
    expect(applyWear(weapon, 'crit').success).toBe(true);
    expect(weapon.crit).toBe(-5);
  });
});

describe('name and instance fields', () => {
  it('reads "<base> -N" with an ASCII hyphen and keeps _baseName the way forging does', () => {
    const weapon = sword();
    applyWear(weapon, 'might');
    expect(weapon.name).toBe('Iron Sword -1');
    expect(weapon._baseName).toBe('Iron Sword');
    applyWear(weapon, 'hit');
    expect(weapon.name).toBe('Iron Sword -2');
    expect(weapon._baseName).toBe('Iron Sword');
    expect(weapon.name).toMatch(/^[\x20-\x7e]+$/);
  });

  it('never touches the forge fields', () => {
    const weapon = sword();
    applyWear(weapon, 'might');
    applyWear(weapon, 'crit');
    expect(weapon._forgeLevel).toBeUndefined();
    expect(weapon._forgeBonuses).toBeUndefined();
    expect(weapon._forgeHistory).toBeUndefined();
    expect(isForged(weapon)).toBe(false);
  });

  it('records one entry per step in order, as plain data', () => {
    const weapon = sword();
    applyWear(weapon, 'hit');
    applyWear(weapon, 'might');
    expect(wearCount(weapon)).toBe(2);
    expect(weapon._wear.map((step) => step.stat)).toEqual(['hit', 'might']);
    expect(JSON.parse(JSON.stringify(weapon))).toEqual(weapon);
  });

  it('catalog weapons never carry wear fields', () => {
    for (const w of data.weapons) expect(Object.hasOwn(w, '_wear'), w.name).toBe(false);
  });
});

describe('the price', () => {
  it.each([
    [500, [425, 350, 275]],
    [1000, [850, 700, 550]],
    [2000, [1700, 1400, 1100]],
    // floor of 7 x 0.85, 0.70, 0.55
    [7, [5, 4, 3]],
    // 15% of 1 is under a gold: it floors to nothing, never below 0
    [1, [0, 0, 0]],
    [0, [0, 0, 0]],
  ])('a %i G weapon sells for %j G at one, two and three steps', (price, expected) => {
    const weapon = sword({ price });
    const seen = [];
    for (const stat of ['might', 'hit', 'crit']) {
      applyWear(weapon, stat);
      seen.push(weapon.price);
    }
    expect(seen).toEqual(expected);
  });

  it('is restored exactly by repair, step by step', () => {
    for (const price of [500, 7, 1, 0, 1234]) {
      const weapon = sword({ price });
      const trail = [weapon.price];
      applyWear(weapon, 'might');
      trail.push(weapon.price);
      applyWear(weapon, 'hit');
      trail.push(weapon.price);
      applyWear(weapon, 'crit');
      repairWeapon(weapon);
      expect(weapon.price, `${price} after one repair`).toBe(trail[2]);
      repairWeapon(weapon);
      expect(weapon.price, `${price} after two repairs`).toBe(trail[1]);
      repairWeapon(weapon);
      expect(weapon.price, `${price} after all repairs`).toBe(trail[0]);
    }
  });
});

describe('the cap', () => {
  it('refuses a fourth step and changes nothing', () => {
    const weapon = sword();
    for (const stat of ['might', 'hit', 'crit']) expect(applyWear(weapon, stat).success).toBe(true);
    const frozen = clone(weapon);
    const result = applyWear(weapon, 'weight');
    expect(result.success).toBe(false);
    expect(weapon).toEqual(frozen);
    expect(canWear(weapon, 'weight')).toBe(false);
    expect(wearableStats(weapon)).toEqual([]);
  });

  it('allows the same stat more than once', () => {
    const weapon = sword({ might: 6 });
    applyWear(weapon, 'might');
    applyWear(weapon, 'might');
    applyWear(weapon, 'might');
    expect(weapon.might).toBe(3);
    expect(wearStatDelta(weapon, 'might')).toBe(-3);
  });

  it('refuses an unknown stat and a weapon missing the stat, changing nothing', () => {
    const weapon = sword();
    const frozen = clone(weapon);
    expect(applyWear(weapon, 'luck').success).toBe(false);
    expect(applyWear(weapon, undefined).success).toBe(false);
    expect(applyWear(weapon, 'toString').success).toBe(false);
    expect(applyWear({ ...weapon, crit: undefined }, 'crit').success).toBe(false);
    expect(weapon).toEqual(frozen);
    expect(wearBlock(null, 'might')).toBeTruthy();
  });
});

describe('exact round trips', () => {
  const SEQUENCES = [
    ['might'],
    ['hit'],
    ['crit'],
    ['weight'],
    ['might', 'might', 'might'],
    ['weight', 'weight', 'weight'],
    ['crit', 'weight', 'hit'],
    ['hit', 'might'],
  ];

  it('every catalog weapon repairs to a deep-equal copy of itself, for every sequence', () => {
    expect(combatWeapons.length).toBeGreaterThan(40);
    for (const original of combatWeapons) {
      for (const sequence of SEQUENCES) {
        const weapon = clone(original);
        for (const stat of sequence) expect(applyWear(weapon, stat).success).toBe(true);
        expect(wearCount(weapon)).toBe(sequence.length);
        for (let i = 0; i < sequence.length; i++) expect(repairWeapon(weapon).success).toBe(true);
        expect(weapon, `${original.name} ${sequence}`).toEqual(original);
        expect(Object.hasOwn(weapon, '_wear')).toBe(false);
        expect(Object.hasOwn(weapon, '_baseName')).toBe(false);
      }
    }
  });

  it('repair unwinds the most recent step first', () => {
    const weapon = sword({ might: 5, hit: 90, crit: 10, weight: 5 });
    applyWear(weapon, 'might');
    applyWear(weapon, 'hit');
    expect(nextRepairStat(weapon)).toBe('hit');
    expect(repairWeapon(weapon)).toMatchObject({ success: true, stat: 'hit' });
    expect(weapon).toMatchObject({ might: 4, hit: 90, name: 'Iron Sword -1' });
    expect(repairWeapon(weapon)).toMatchObject({ success: true, stat: 'might' });
    expect(weapon).toMatchObject({ might: 5, name: 'Iron Sword' });
  });

  it('a weight-0 weapon rusted then repaired returns to 0, not below and not stuck at 1', () => {
    const catalogZero = data.weapons.filter((w) => !UNWEARABLE.includes(w.type) && w.weight === 0);
    expect(catalogZero.length).toBeGreaterThan(0);
    for (const original of [...catalogZero.map(clone), sword({ weight: 0 })]) {
      const weapon = clone(original);
      expect(applyWear(weapon, 'weight').success).toBe(true);
      expect(weapon.weight).toBe(1);
      expect(repairWeapon(weapon).success).toBe(true);
      expect(weapon.weight).toBe(0);
      expect(weapon).toEqual(original);
    }
  });

  it('restores what the step really did, even if a step was recorded against a floor', () => {
    // A hand-built step (an older client, a test) that took only 2 of the weight.
    const weapon = sword({ weight: 4, _baseName: 'Iron Sword', name: 'Iron Sword -1' });
    weapon._wear = [{ stat: 'weight', delta: 2, priceLoss: 0 }];
    repairWeapon(weapon);
    expect(weapon.weight).toBe(2);
  });

  it('a step without a recorded delta falls back to the forge-sized step', () => {
    const weapon = sword({ crit: 0, _baseName: 'Iron Sword', name: 'Iron Sword -1' });
    weapon._wear = [{ stat: 'crit' }];
    expect(wearStatDelta(weapon, 'crit')).toBe(-5);
    repairWeapon(weapon);
    expect(weapon.crit).toBe(5);
  });

  it('repair leaves unrelated instance state alone', () => {
    const weapon = sword({ uid: 'abc', _strikes: 14, _kills: 3, _usesSpent: 2 });
    applyWear(weapon, 'might');
    repairWeapon(weapon);
    expect(weapon).toMatchObject({ uid: 'abc', _strikes: 14, _kills: 3, _usesSpent: 2 });
  });

  it('fails cleanly on an unworn weapon', () => {
    const weapon = sword();
    const frozen = clone(weapon);
    expect(repairWeapon(weapon)).toEqual({ success: false });
    expect(repairWeapon(null)).toEqual({ success: false });
    expect(weapon).toEqual(frozen);
    expect(repairCost(weapon)).toBe(-1);
    expect(repairPrice(weapon)).toBe(-1);
  });
});

describe('wear and the forge never mix', () => {
  it('canForge is false while worn and true again after repair', () => {
    const weapon = sword();
    expect(canForge(weapon)).toBe(true);
    applyWear(weapon, 'might');
    expect(canForge(weapon)).toBe(false);
    repairWeapon(weapon);
    expect(canForge(weapon)).toBe(true);
  });

  it('every forge stat is blocked with a repair-first reason, and applyForge changes nothing', () => {
    const weapon = sword();
    applyWear(weapon, 'hit');
    const frozen = clone(weapon);
    for (const stat of Object.keys(FORGE_BONUSES)) {
      expect(forgeStatBlock(weapon, stat), stat).toMatch(/repair/i);
      expect(applyForge(weapon, stat).success, stat).toBe(false);
    }
    expect(weapon).toEqual(frozen);
  });

  it('a forged weapon does not wear', () => {
    const weapon = sword();
    applyForge(weapon, 'might');
    const frozen = clone(weapon);
    expect(applyWear(weapon, 'hit').success).toBe(false);
    expect(wearableStats(weapon)).toEqual([]);
    expect(weapon).toEqual(frozen);
  });

  it('a forge then a deforge leaves a weapon that can wear', () => {
    const weapon = sword();
    applyForge(weapon, 'might');
    deforgeWeapon(weapon);
    expect(applyWear(weapon, 'hit').success).toBe(true);
    expect(weapon.name).toBe('Iron Sword -1');
  });

  it('deforge refuses a worn weapon and leaves it as it was', () => {
    const weapon = sword();
    applyWear(weapon, 'crit');
    const frozen = clone(weapon);
    expect(deforgeWeapon(weapon)).toEqual({ success: false });
    expect(weapon).toEqual(frozen);
  });

  it('wears exactly the item types that forge and imbue', () => {
    for (const w of data.weapons) {
      const fresh = clone(w);
      const forgeable = canForge(fresh);
      expect(canWear(fresh, 'might'), w.name).toBe(forgeable);
      expect(canImbue(fresh), w.name).toBe(forgeable);
    }
    for (const type of UNWEARABLE) expect(canWear({ ...sword(), type }, 'might'), type).toBe(false);
  });
});

describe('repair cost', () => {
  // round(FORGE_COSTS[stat][0] x tier multiplier x 0.5), worked by hand from the tables:
  // first forge prices might 400, crit 300, hit 250, weight 250; Iron 0.6, Steel 1, Silver 1.5,
  // Legend 2; a tier the table does not list (Rare) pays the base.
  it.each([
    ['Iron', 'might', 120],
    ['Iron', 'crit', 90],
    ['Iron', 'hit', 75],
    ['Iron', 'weight', 75],
    ['Steel', 'might', 200],
    ['Steel', 'crit', 150],
    ['Steel', 'hit', 125],
    ['Steel', 'weight', 125],
    ['Silver', 'might', 300],
    ['Silver', 'crit', 225],
    ['Silver', 'hit', 188], // 187.5 rounds up
    ['Silver', 'weight', 188],
    ['Legend', 'might', 400],
    ['Legend', 'crit', 300],
    ['Legend', 'hit', 250],
    ['Legend', 'weight', 250],
    ['Rare', 'might', 200],
  ])('%s %s costs %i', (tier, stat, expected) => {
    const weapon = sword({ tier });
    applyWear(weapon, stat);
    expect(repairCost(weapon)).toBe(expected);
    expect(repairPrice(weapon)).toBe(expected);
  });

  it('prices the most recent step, and the next repair is the one before it', () => {
    const weapon = sword({ tier: 'Steel' });
    applyWear(weapon, 'might'); // 200
    applyWear(weapon, 'hit'); // 125
    expect(repairCost(weapon)).toBe(125);
    expect(repairWeapon(weapon)).toMatchObject({ success: true, cost: 125, stat: 'hit' });
    expect(repairCost(weapon)).toBe(200);
    expect(repairWeapon(weapon)).toMatchObject({ success: true, cost: 200, stat: 'might' });
  });

  it('does not depend on the weapon being cheap or dear (price is wear-reduced)', () => {
    const weapon = sword({ tier: 'Steel', price: 3 });
    applyWear(weapon, 'might');
    expect(repairCost(weapon)).toBe(200);
  });

  it('a shop discount lowers the price, never below 1 gold; the plain cost is unchanged', () => {
    const weapon = sword({ tier: 'Steel' });
    applyWear(weapon, 'might');
    expect(repairPrice(weapon, 0.25)).toBe(150);
    expect(repairPrice(weapon, 0.999)).toBe(1);
    expect(repairCost(weapon)).toBe(200);
    expect(repairWeapon(weapon, 0.25)).toMatchObject({ success: true, cost: 150 });
  });
});

describe('imbues coexist with wear', () => {
  const vampiric = getImbueById(data.imbues, 'vampiric');

  it('imbuing a worn weapon keeps the "-N" and a repair keeps the imbued name', () => {
    const weapon = sword();
    applyWear(weapon, 'might');
    applyWear(weapon, 'hit');
    expect(canImbue(weapon)).toBe(true);
    expect(applyImbue(weapon, vampiric).success).toBe(true);
    expect(weapon.name).toBe('Vampiric Iron Sword -2');
    expect(weapon._baseName).toBe('Vampiric Iron Sword');
    expect(weapon._imbueId).toBe('vampiric');
    repairWeapon(weapon);
    expect(weapon.name).toBe('Vampiric Iron Sword -1');
    repairWeapon(weapon);
    expect(weapon.name).toBe('Vampiric Iron Sword');
    expect(weapon._imbueId).toBe('vampiric');
    expect(Object.hasOwn(weapon, '_baseName')).toBe(false);
    expect(Object.hasOwn(weapon, '_wear')).toBe(false);
  });

  it('wearing an imbued weapon names it from the imbued base', () => {
    const weapon = sword();
    applyImbue(weapon, vampiric);
    applyWear(weapon, 'crit');
    expect(weapon.name).toBe('Vampiric Iron Sword -1');
    expect(weapon._baseName).toBe('Vampiric Iron Sword');
    repairWeapon(weapon);
    expect(weapon.name).toBe('Vampiric Iron Sword');
  });

  it('a worn then repaired imbued weapon equals the imbued weapon that never wore', () => {
    const plain = sword();
    applyImbue(plain, vampiric);
    const weapon = sword();
    applyImbue(weapon, vampiric);
    applyWear(weapon, 'weight');
    applyWear(weapon, 'might');
    repairWeapon(weapon);
    repairWeapon(weapon);
    expect(weapon).toEqual(plain);
  });

  it('forging then imbuing still names the forged level, wear untouched by it', () => {
    const weapon = sword();
    applyForge(weapon, 'might');
    applyImbue(weapon, vampiric);
    expect(weapon.name).toBe('Vampiric Iron Sword +1');
  });
});

describe('display', () => {
  it('names each step in order with what it did', () => {
    const weapon = sword();
    applyWear(weapon, 'might');
    applyWear(weapon, 'hit');
    applyWear(weapon, 'weight');
    const info = wearDisplay(weapon);
    expect(info.count).toBe(3);
    expect(info.max).toBe(3);
    expect(info.labels).toEqual(['Dulled', 'Bent', 'Rusted']);
    expect(info.steps.map((s) => s.effect)).toEqual(['−1 Might', '−5 Hit', '+1 Weight']);
    expect(info.steps.map((s) => s.restore)).toEqual(['+1 Might', '+5 Hit', '−1 Weight']);
    expect(info.text).toBe('Dulled · Bent · Rusted');
    expect(info.deltas).toEqual({ might: -1, hit: -5, crit: 0, weight: 1 });
    expect(wearLine(weapon)).toBe('Worn 3/3: Dulled (−1 Might), Bent (−5 Hit), Rusted (+1 Weight)');
  });

  it('says nothing for an unworn weapon', () => {
    const info = wearDisplay(sword());
    expect(info).toMatchObject({ count: 0, labels: [], text: '' });
    expect(wearLine(sword())).toBe('');
    expect(isWorn(sword())).toBe(false);
    expect(isWorn(null)).toBe(false);
  });
});
