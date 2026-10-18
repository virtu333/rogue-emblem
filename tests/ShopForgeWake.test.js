// A shop wakes an NG+ kept weapon's sleeping forges early (docs/specs/ng-plus.md §13.1). Real
// RunManager on the shipped data; each test names the realistic failure it catches.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { dormantForgeCount } from '../src/engine/KeptForges.js';
import { defaultNgPlusState, lordRecordId, runStartOf } from '../src/engine/NgPlusState.js';
import {
  nextDormantForge,
  shopWakeBlock,
  shopWakeLimit,
  wakePrice,
  wakeShopWeapon,
} from '../src/engine/ShopForgeWake.js';
import { twistPriceOf } from '../src/engine/EarnedBlessings.js';
import { FORGE_BONUSES } from '../src/utils/constants.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const ORDER = ['might', 'hit', 'crit', 'might', 'hit', 'crit', 'might'];

/** A Silver Sword forged +7 in ORDER. */
function forgedSword(uid = 'itm_kept_sword') {
  const sword = { ...catalog('Silver Sword'), uid };
  for (const stat of ORDER) expect(applyForge(sword, stat, 0, { free: true }).success).toBe(true);
  return sword;
}

/** The sword's catalog stats plus the first `n` forges of ORDER. */
function expectedAt(n) {
  const base = catalog('Silver Sword');
  const order = ORDER.slice(0, n);
  const plus = (stat) => order.filter((s) => s === stat).length * FORGE_BONUSES[stat];
  return {
    might: base.might + plus('might'),
    hit: base.hit + plus('hit'),
    crit: base.crit + plus('crit'),
  };
}
const read = (w) => ({ might: w.might, hit: w.hit, crit: w.crit });

function ngPlusRun({ seed = 7, gold = 20000 } = {}) {
  const state = defaultNgPlusState();
  state.barracks.push({
    id: lordRecordId('Edric'),
    kind: 'lord',
    name: 'Edric',
    keptSkills: [],
    skillKinds: {},
    keptItems: [forgedSword()],
    rides: 1,
  });
  const rm = new RunManager(data);
  rm.startRun({
    runSeed: seed,
    applyBlessingsAtStart: false,
    difficultyId: 'lunatic',
    ngPlus: runStartOf(state),
  });
  rm.gold = gold;
  return rm;
}
const keptOf = (rm) =>
  rm.roster.flatMap((u) => u.inventory || []).find((i) => i.uid === 'itm_kept_sword');
const shop = (rm, wakesUsed = 0, extra = {}) => ({
  wakesUsed,
  wakeLimit: shopWakeLimit(rm),
  discount: 0,
  ...extra,
});

describe('a shop wakes kept forges', () => {
  it('Act I wakes the next sleeping forge for its forge price, at most two a shop', () => {
    // Failure: a wake skips a step, charges the wrong price, moves the weapon's price, or a shop
    // wakes past the act's limit.
    const rm = ngPlusRun();
    const sword = keptOf(rm);
    expect(shopWakeLimit(rm)).toBe(data.difficulty.ngPlus.keptForgeAwake.act1);
    expect(shopWakeLimit(rm)).toBe(2);
    expect(read(sword)).toEqual(expectedAt(2));
    expect(dormantForgeCount(sword)).toBe(5);
    const price = sword.price;

    // The third forge is crit, the sword's first crit: crit's first forge cost × Silver 1.5.
    expect(nextDormantForge(sword)).toEqual({ stat: 'crit', label: '+5 Crit' });
    expect(wakePrice(sword)).toBe(450);
    const gold = rm.gold;
    const first = wakeShopWeapon(rm, sword, shop(rm, 0));
    expect(first).toMatchObject({ ok: true, cost: 450 });
    expect(rm.gold).toBe(gold - 450);
    expect(read(sword)).toEqual(expectedAt(3));
    expect(sword.price).toBe(price);

    // The fourth is might, the sword's second: might's second cost × 1.5.
    expect(wakePrice(sword)).toBe(1200);
    expect(wakeShopWeapon(rm, sword, shop(rm, 1)).ok).toBe(true);
    expect(read(sword)).toEqual(expectedAt(4));
    expect(rm.gold).toBe(gold - 450 - 1200);

    const before = rm.gold;
    expect(wakeShopWeapon(rm, sword, shop(rm, 2))).toEqual({
      ok: false,
      reason: 'No wakes remain at this shop.',
    });
    expect(read(sword)).toEqual(expectedAt(4));
    expect(rm.gold).toBe(before);
  });

  it('the shop discount applies to a wake', () => {
    // Failure: a liberated village's smith charges a wake in full.
    const rm = ngPlusRun();
    const sword = keptOf(rm);
    expect(wakePrice(sword, 0.2)).toBe(360);
    expect(wakeShopWeapon(rm, sword, shop(rm, 0, { discount: 0.2 })).cost).toBe(360);
  });

  it('forges woken at a shop count at the next act start, which wakes only the rest', () => {
    // Failure: the act start wakes its full count on top of the shop's, so a shop wake in Act I
    // gives Act II six awake forges instead of four.
    const rm = ngPlusRun();
    const sword = keptOf(rm);
    wakeShopWeapon(rm, sword, shop(rm, 0));
    wakeShopWeapon(rm, sword, shop(rm, 1));
    expect(read(sword)).toEqual(expectedAt(4));
    rm.advanceAct();
    expect(rm.currentAct).toBe('act2');
    expect(read(keptOf(rm))).toEqual(expectedAt(data.difficulty.ngPlus.keptForgeAwake.act2));
    expect(shopWakeLimit(rm)).toBe(4);
  });

  it('a forge the run made on top of sleeping ones survives a wake', () => {
    // Failure: waking rebuilds the weapon from its kept forges only, dropping this run's forge.
    const rm = ngPlusRun();
    const sword = keptOf(rm);
    expect(applyForge(sword, 'weight', 0, { free: true }).success).toBe(true);
    const weight = sword.weight;
    expect(wakeShopWeapon(rm, sword, shop(rm, 0)).ok).toBe(true);
    expect(read(sword)).toEqual(expectedAt(3));
    expect(sword.weight).toBe(weight);
    expect(dormantForgeCount(sword)).toBe(4);
  });

  it('refuses without changing anything: none asleep, gold short, Smith’s Exile, stale', () => {
    // Failure: a refused wake still spends gold or a step, or a stale confirmation wakes a weapon
    // that changed under it.
    const rm = ngPlusRun();
    const sword = keptOf(rm);
    const snapshot = () => ({ gold: rm.gold, sword: structuredClone(sword) });

    let before = snapshot();
    expect(wakeShopWeapon(rm, sword, shop(rm, 0, { expectedDormant: 4 })).reason).toBe(
      'Weapon changed. Review it again.',
    );
    expect(snapshot()).toEqual(before);

    rm.gold = 100;
    before = snapshot();
    expect(wakeShopWeapon(rm, sword, shop(rm, 0)).reason).toBe('Not enough gold.');
    expect(snapshot()).toEqual(before);
    rm.gold = 20000;

    const plain = rm.roster.flatMap((u) => u.inventory || []).find((i) => !i._dormantForges);
    expect(shopWakeBlock(rm, plain, shop(rm, 0))).toBe('No forges are sleeping on this weapon.');
    expect(shopWakeBlock(rm, forgedSword('itm_elsewhere'), shop(rm, 0))).toBe(
      'This weapon is no longer available.',
    );

    const exiled = ngPlusRun();
    const card = data.blessings.blessings.find((b) => b.id === 'smiths_exile');
    expect(
      exiled.addBlessingMidRun('smiths_exile', {
        earned: true,
        price: twistPriceOf(card),
        source: 'act_boss',
      }),
    ).toBe(true);
    const exiledSword = keptOf(exiled);
    const exiledBefore = structuredClone(exiledSword);
    const exiledGold = exiled.gold;
    expect(wakeShopWeapon(exiled, exiledSword, shop(exiled, 0)).reason).toBe(
      "Smith's Exile: no forging",
    );
    expect(exiledSword).toEqual(exiledBefore);
    expect(exiled.gold).toBe(exiledGold);
  });

  it('a shop’s wakes are saved with the shop and survive a reload', () => {
    // Failure: leaving and re-entering (or reloading) resets the shop's wakes, so one shop wakes
    // every forge.
    const rm = ngPlusRun();
    rm.saveShopState('act1_3_1', { items: [], forgesUsed: 0, wakesUsed: 2 });
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.shopStateByNodeId.act1_3_1.wakesUsed).toBe(2);
  });
});
