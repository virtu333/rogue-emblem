// ItemTrade.test.js — the pure trade engine (docs/specs/item-trade.md, "Engine").
// Units and items are hand-built; every expected bag, slot, stat and HP value
// below is worked out by hand from the spec, never by re-running the engine.
import { describe, it, expect } from 'vitest';
import {
  CONVOY_HOLDER,
  unitHolder,
  bagItems,
  bagCapacity,
  planTrade,
  applyTrade,
  planReorder,
  applyReorder,
  canTradeBetween,
  settleEquipped,
} from '../src/engine/ItemTrade.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { rosterAccessoryAction } from '../src/engine/RosterInventory.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const accessory = (name) => structuredClone(gameData.accessories.find((a) => a.name === name));

let nextUid = 0;
function weapon(name, type, rankRequired = 'Prof', extra = {}) {
  nextUid += 1;
  return { name, type, rankRequired, might: 5, uid: `w${nextUid}`, ...extra };
}
function supply(name) {
  nextUid += 1;
  return { name, type: 'Consumable', effect: 'heal', value: 10, uses: 3, uid: `c${nextUid}` };
}
/** A unit; `weapon` defaults to the first item (tests set it explicitly when it matters). */
function unit(name, profTypes, inventory = [], extra = {}) {
  return {
    name,
    faction: 'player',
    proficiencies: profTypes.map((type) => ({ type, rank: 'Prof' })),
    inventory,
    consumables: [],
    weapon: inventory[0] || null,
    accessory: null,
    stats: { HP: 20, STR: 5, MAG: 1, SKL: 5, SPD: 5, DEF: 4, RES: 1, LCK: 3, MOV: 5 },
    currentHP: 20,
    mov: 5,
    moveType: 'Infantry',
    ...extra,
  };
}
const slot = (u, bag, item) => ({ holder: unitHolder(u), bag, item });
const convoySlot = (bag, item) => ({ holder: CONVOY_HOLDER, bag, item });
const battle = { context: 'battle' };
function rosterCtx(...units) {
  return { context: 'roster', run: { roster: [...units] } };
}
/** A real run (real convoy capacity and getConvoyItems clones) holding these units. */
function realRun(...units) {
  const run = new RunManager(gameData);
  run.roster = [...units];
  return run;
}
function fillConvoyWeapons(run, count) {
  const stored = [];
  for (let i = 0; i < count; i++) {
    const item = weapon(`Stock ${i}`, 'Lance');
    run.convoy.weapons.push(item);
    stored.push(item);
  }
  return stored;
}

describe('give', () => {
  it('moves the same instance, keeps its uid and appends it', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const lance = weapon('Iron Lance', 'Lance');
    const javelin = weapon('Javelin', 'Lance');
    const edric = unit('Edric', ['Sword', 'Lance'], [sword, lance]);
    const sera = unit('Sera', ['Lance'], [javelin]);
    const result = applyTrade(
      battle,
      slot(edric, 'inventory', lance),
      slot(sera, 'inventory', null),
    );
    expect(result).toEqual({ ok: true, kind: 'give', warnings: [], detail: 'Iron Lance' });
    expect(sera.inventory).toEqual([javelin, lance]);
    expect(sera.inventory[1]).toBe(lance);
    expect(sera.inventory[1].uid).toBe(lance.uid);
    expect(sera.weapon).toBe(javelin);
    expect(edric.inventory).toEqual([sword]);
    expect(edric.weapon).toBe(sword);
  });

  it('stamps a uid on an item that has none, without cloning it', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const bare = { name: 'Old Sword', type: 'Sword', rankRequired: 'Prof' };
    const a = unit('A', ['Sword'], [sword, bare]);
    const b = unit('B', ['Sword'], []);
    expect(planTrade(battle, slot(a, 'inventory', bare), slot(b, 'inventory', null)).ok).toBe(true);
    expect(bare.uid).toBeUndefined(); // planning never mutates
    applyTrade(battle, slot(a, 'inventory', bare), slot(b, 'inventory', null));
    expect(b.inventory[0]).toBe(bare);
    expect(typeof bare.uid).toBe('string');
  });

  it('giving away the equipped weapon re-equips the next combat weapon at slot 0', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const steel = weapon('Steel Sword', 'Sword');
    const axe = weapon('Iron Axe', 'Axe'); // Edric cannot use axes
    const edric = unit('Edric', ['Sword'], [sword, axe, steel]);
    const kai = unit('Kai', ['Sword'], []);
    const result = applyTrade(
      battle,
      slot(edric, 'inventory', sword),
      slot(kai, 'inventory', null),
    );
    expect(result.warnings).toEqual([]);
    // [axe, steel] → Steel Sword is the only usable weapon → equipped and moved first.
    expect(edric.weapon).toBe(steel);
    expect(edric.inventory).toEqual([steel, axe]);
    expect(kai.weapon).toBe(sword);
  });

  it('giving away the last combat weapon leaves the giver unarmed, with a warning', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const axe = weapon('Iron Axe', 'Axe');
    const edric = unit('Edric', ['Sword'], [sword, axe]);
    const kai = unit('Kai', ['Sword'], []);
    const plan = planTrade(battle, slot(edric, 'inventory', sword), slot(kai, 'inventory', null));
    expect(plan).toEqual({
      ok: true,
      kind: 'give',
      warnings: [{ code: 'leaves_unarmed', unit: edric }],
      detail: 'Iron Sword',
    });
    expect(plan.warnings[0].unit).toBe(edric);
    applyTrade(battle, slot(edric, 'inventory', sword), slot(kai, 'inventory', null));
    expect(edric.weapon).toBeNull();
    expect(edric.inventory).toEqual([axe]);
  });

  it('an unarmed receiver equips a usable weapon it is given', () => {
    const lance = weapon('Iron Lance', 'Lance');
    const sword = weapon('Iron Sword', 'Sword');
    const giver = unit('Giver', ['Sword', 'Lance'], [sword, lance]);
    const receiver = unit('Receiver', ['Lance'], [], { weapon: null });
    const result = applyTrade(
      battle,
      slot(giver, 'inventory', lance),
      slot(receiver, 'inventory', null),
    );
    expect(result.warnings).toEqual([]);
    expect(receiver.weapon).toBe(lance);
    expect(receiver.inventory).toEqual([lance]);
  });

  it('an unusable weapon is carried, not equipped, with cannot_equip', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const steel = weapon('Steel Sword', 'Sword');
    const giver = unit('Giver', ['Sword'], [sword, steel]);
    const receiver = unit('Receiver', ['Axe'], [], { weapon: null });
    const result = applyTrade(
      battle,
      slot(giver, 'inventory', steel),
      slot(receiver, 'inventory', null),
    );
    expect(result.warnings).toEqual([{ code: 'cannot_equip', unit: receiver, item: steel }]);
    expect(receiver.inventory).toEqual([steel]);
    expect(receiver.weapon).toBeNull();
  });

  it('a rank the receiver lacks counts as unusable (cannot_equip)', () => {
    const silver = weapon('Silver Sword', 'Sword', 'Mast');
    const giver = unit('Giver', ['Sword'], [weapon('Iron Sword', 'Sword'), silver]);
    giver.proficiencies = [{ type: 'Sword', rank: 'Mast' }];
    const receiver = unit('Receiver', ['Sword'], [], { weapon: null }); // Prof only
    const result = applyTrade(
      battle,
      slot(giver, 'inventory', silver),
      slot(receiver, 'inventory', null),
    );
    expect(result.warnings).toEqual([{ code: 'cannot_equip', unit: receiver, item: silver }]);
    expect(receiver.weapon).toBeNull();
  });

  it('a staff-only unit equips a staff it receives; the giver re-equips its other staff', () => {
    const heal = weapon('Heal', 'Staff', 'Prof', { _usesSpent: 2 });
    const mend = weapon('Solace', 'Staff');
    const priest = unit('Priest', ['Staff'], [heal, mend]);
    const cleric = unit('Cleric', ['Staff'], [], { weapon: null });
    const result = applyTrade(
      battle,
      slot(priest, 'inventory', heal),
      slot(cleric, 'inventory', null),
    );
    // Neither ever had a combat weapon, so nobody is "left unarmed".
    expect(result.warnings).toEqual([]);
    expect(cleric.weapon).toBe(heal);
    expect(heal._usesSpent).toBe(2);
    expect(priest.weapon).toBe(mend);
    expect(priest.inventory).toEqual([mend]);
  });

  it('a give into a full bag is rejected and changes nothing', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const giver = unit('Giver', ['Sword'], [sword, weapon('Steel Sword', 'Sword')]);
    const full = [1, 2, 3, 4, 5].map((n) => weapon(`Lance ${n}`, 'Lance'));
    const receiver = unit('Receiver', ['Lance'], full);
    const before = structuredClone({ giver, receiver });
    const from = slot(giver, 'inventory', sword);
    const to = slot(receiver, 'inventory', null);
    expect(planTrade(battle, from, to)).toEqual({ ok: false, reason: 'Bag full.' });
    expect(applyTrade(battle, from, to)).toEqual({ ok: false, reason: 'Bag full.' });
    expect({ giver, receiver }).toEqual(before);
    expect(receiver.inventory).toBe(full);
    expect(giver.weapon).toBe(sword);
  });
});

describe('swap', () => {
  it('two 5/5 bags exchange items in place, keeping slot indices', () => {
    const a = [0, 1, 2, 3, 4].map((n) => weapon(`A${n}`, 'Sword'));
    const b = [0, 1, 2, 3, 4].map((n) => weapon(`B${n}`, 'Sword'));
    const ua = unit('A', ['Sword'], [...a]);
    const ub = unit('B', ['Sword'], [...b]);
    const result = applyTrade(battle, slot(ua, 'inventory', a[2]), slot(ub, 'inventory', b[3]));
    expect(result).toEqual({ ok: true, kind: 'swap', warnings: [], detail: 'A2 for B3' });
    expect(ua.inventory).toEqual([a[0], a[1], b[3], a[3], a[4]]);
    expect(ub.inventory).toEqual([b[0], b[1], b[2], a[2], b[4]]);
    expect(ua.inventory[2]).toBe(b[3]);
    expect(ub.inventory[3]).toBe(a[2]);
    expect(ua.weapon).toBe(a[0]);
    expect(ub.weapon).toBe(b[0]);
  });

  it('trading away the equipped weapon for a usable one equips the incoming weapon', () => {
    const aSword = weapon('Iron Sword', 'Sword');
    const aSteel = weapon('Steel Sword', 'Sword');
    const bLance = weapon('Iron Lance', 'Lance');
    const bSilver = weapon('Silver Sword', 'Sword');
    const a = unit('A', ['Sword'], [aSword, aSteel]);
    const b = unit('B', ['Sword', 'Lance'], [bLance, bSilver]);
    const result = applyTrade(battle, slot(a, 'inventory', aSword), slot(b, 'inventory', bSilver));
    expect(result.warnings).toEqual([]);
    // A: [Silver, Steel] — the incoming Silver Sword took slot 0 and is equipped.
    expect(a.inventory).toEqual([bSilver, aSteel]);
    expect(a.weapon).toBe(bSilver);
    // B keeps its deliberate Iron Lance; Iron Sword sits where Silver was.
    expect(b.inventory).toEqual([bLance, aSword]);
    expect(b.weapon).toBe(bLance);
  });

  it('trading away the equipped weapon for an unusable one re-equips the next usable weapon', () => {
    const aSword = weapon('Iron Sword', 'Sword');
    const aSteel = weapon('Steel Sword', 'Sword');
    const bAxe = weapon('Iron Axe', 'Axe');
    const bHammer = weapon('Hammer', 'Axe');
    const a = unit('A', ['Sword'], [aSword, aSteel]);
    const b = unit('B', ['Axe'], [bAxe, bHammer]);
    const result = applyTrade(battle, slot(a, 'inventory', aSword), slot(b, 'inventory', bHammer));
    // B receives the sword first, then A receives the hammer.
    expect(result.warnings).toEqual([
      { code: 'cannot_equip', unit: b, item: aSword },
      { code: 'cannot_equip', unit: a, item: bHammer },
    ]);
    // A after the write: [Hammer, Steel] → Steel is the only usable weapon → moved first.
    expect(a.weapon).toBe(aSteel);
    expect(a.inventory).toEqual([aSteel, bHammer]);
    expect(b.inventory).toEqual([bAxe, aSword]);
    expect(b.weapon).toBe(bAxe);
  });

  it('swapping the only combat weapon for an unusable one leaves that unit unarmed', () => {
    const aSword = weapon('Iron Sword', 'Sword');
    const bAxe = weapon('Iron Axe', 'Axe');
    const bHammer = weapon('Hammer', 'Axe');
    const a = unit('A', ['Sword'], [aSword]);
    const b = unit('B', ['Axe'], [bAxe, bHammer]);
    const result = applyTrade(battle, slot(a, 'inventory', aSword), slot(b, 'inventory', bHammer));
    expect(result.warnings).toEqual([
      { code: 'cannot_equip', unit: b, item: aSword },
      { code: 'cannot_equip', unit: a, item: bHammer },
      { code: 'leaves_unarmed', unit: a },
    ]);
    expect(a.inventory).toEqual([bHammer]);
    expect(a.weapon).toBeNull();
  });

  it("swapping both units' equipped weapons equips each incoming weapon", () => {
    const aSword = weapon('Iron Sword', 'Sword');
    const aLance = weapon('Iron Lance', 'Lance');
    const bLance = weapon('Steel Lance', 'Lance');
    const bSword = weapon('Steel Sword', 'Sword');
    const a = unit('A', ['Sword', 'Lance'], [aSword, aLance]);
    const b = unit('B', ['Sword', 'Lance'], [bLance, bSword]);
    const result = applyTrade(battle, slot(a, 'inventory', aSword), slot(b, 'inventory', bLance));
    expect(result.detail).toBe('Iron Sword for Steel Lance');
    expect(a.inventory).toEqual([bLance, aLance]);
    expect(a.weapon).toBe(bLance);
    expect(b.inventory).toEqual([aSword, bSword]);
    expect(b.weapon).toBe(aSword);
  });

  it('supplies at 3/3: a give is rejected, a swap exchanges slots', () => {
    const [v1, v2, v3, e1, e2, e3] = ['V1', 'V2', 'V3', 'E1', 'E2', 'E3'].map(supply);
    const sword = weapon('Iron Sword', 'Sword');
    const a = unit('A', ['Sword'], [sword], { consumables: [v1, v2, v3] });
    const b = unit('B', ['Sword'], [], { consumables: [e1, e2, e3] });
    expect(planTrade(battle, slot(a, 'consumables', v1), slot(b, 'consumables', null))).toEqual({
      ok: false,
      reason: 'Bag full.',
    });
    const result = applyTrade(battle, slot(a, 'consumables', v2), slot(b, 'consumables', e1));
    expect(result).toEqual({ ok: true, kind: 'swap', warnings: [], detail: 'V2 for E1' });
    expect(a.consumables).toEqual([v1, e1, v3]);
    expect(b.consumables).toEqual([v2, e2, e3]);
    expect(a.inventory).toEqual([sword]);
    expect(a.weapon).toBe(sword);
  });

  it('a unit with no consumables array can receive a supply', () => {
    const tonic = supply('Tonic');
    const a = unit('A', ['Sword'], [], { consumables: [tonic] });
    const b = unit('B', ['Sword'], []);
    delete b.consumables;
    expect(applyTrade(battle, slot(a, 'consumables', tonic), slot(b, 'consumables', null)).ok).toBe(
      true,
    );
    expect(b.consumables).toEqual([tonic]);
    expect(a.consumables).toEqual([]);
  });
});

describe('rejections change nothing', () => {
  function pair() {
    const sword = weapon('Iron Sword', 'Sword');
    const lance = weapon('Iron Lance', 'Lance');
    const tonic = supply('Tonic');
    const a = unit('A', ['Sword'], [sword], { consumables: [tonic] });
    const b = unit('B', ['Lance'], [lance]);
    return { a, b, sword, lance, tonic };
  }
  it.each([
    [
      'cross-bag (weapon onto a supply slot)',
      ({ a, b, sword }) => [slot(a, 'inventory', sword), slot(b, 'consumables', null)],
      'Items trade only within the same bag.',
    ],
    [
      'cross-bag swap (supply for a weapon)',
      ({ a, b, tonic, lance }) => [slot(a, 'consumables', tonic), slot(b, 'inventory', lance)],
      'Items trade only within the same bag.',
    ],
    [
      'stale source item',
      ({ a, b, lance }) => [slot(a, 'inventory', lance), slot(b, 'inventory', null)],
      'Item is no longer available.',
    ],
    [
      'stale target item',
      ({ a, b, sword }) => [slot(a, 'inventory', sword), slot(b, 'inventory', { ...sword })],
      'Item is no longer available.',
    ],
    [
      'nothing held',
      ({ a, b }) => [slot(a, 'inventory', null), slot(b, 'inventory', null)],
      'Item is no longer available.',
    ],
    [
      'same holder',
      ({ a, sword }) => [slot(a, 'inventory', sword), slot(a, 'inventory', null)],
      'Choose another unit.',
    ],
    [
      'a supply into the weapon bag',
      ({ a, b, tonic }) => {
        a.inventory.push(tonic); // corrupted bag: the type check still refuses it
        return [slot(a, 'inventory', tonic), slot(b, 'inventory', null)];
      },
      'Items trade only within the same bag.',
    ],
  ])('%s', (_label, build, reason) => {
    const f = pair();
    const [from, to] = build(f);
    const before = structuredClone({ a: f.a, b: f.b });
    expect(planTrade(battle, from, to)).toEqual({ ok: false, reason });
    expect(applyTrade(battle, from, to)).toEqual({ ok: false, reason });
    expect({ a: f.a, b: f.b }).toEqual(before);
  });

  it('applyTrade re-plans: a slot that went stale after planning is refused', () => {
    const { a, b, sword } = pair();
    const from = slot(a, 'inventory', sword);
    const to = slot(b, 'inventory', null);
    expect(planTrade(battle, from, to).ok).toBe(true);
    a.inventory = [];
    expect(applyTrade(battle, from, to)).toEqual({
      ok: false,
      reason: 'Item is no longer available.',
    });
    expect(b.inventory).toHaveLength(1);
  });
});

describe('context rules', () => {
  it('battle: no convoy, no accessories, only player units', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const ring = accessory('Power Ring');
    const a = unit('A', ['Sword'], [sword, weapon('Steel Sword', 'Sword')], { accessory: ring });
    const b = unit('B', ['Sword'], []);
    expect(planTrade(battle, slot(a, 'inventory', sword), convoySlot('inventory', null))).toEqual({
      ok: false,
      reason: 'The convoy is available between battles.',
    });
    expect(planTrade(battle, slot(a, 'accessory', ring), slot(b, 'accessory', null))).toEqual({
      ok: false,
      reason: 'Accessories can be traded between battles.',
    });
    const enemy = unit('Brigand', ['Sword'], [], { faction: 'enemy' });
    expect(planTrade(battle, slot(a, 'inventory', sword), slot(enemy, 'inventory', null)).ok).toBe(
      false,
    );
    expect(enemy.inventory).toEqual([]);
  });

  it('roster: each unit must still be on the roster (membership, not array identity)', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const a = unit('A', ['Sword'], [sword, weapon('Steel Sword', 'Sword')]);
    const b = unit('B', ['Sword'], []);
    const gone = unit('Gone', ['Sword'], []);
    const ctx = rosterCtx(a, b);
    expect(planTrade(ctx, slot(a, 'inventory', sword), slot(gone, 'inventory', null))).toEqual({
      ok: false,
      reason: 'Unit is no longer in the roster.',
    });
    expect(planTrade(ctx, slot(gone, 'inventory', null), slot(a, 'inventory', sword))).toEqual({
      ok: false,
      reason: 'Unit is no longer in the roster.',
    });
    ctx.run.roster = [b, a]; // a rebuilt roster array still holds both units
    expect(applyTrade(ctx, slot(a, 'inventory', sword), slot(b, 'inventory', null)).ok).toBe(true);
    expect(b.inventory).toEqual([sword]);
  });

  it('an unknown context or malformed slot is refused', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const a = unit('A', ['Sword'], [sword]);
    const b = unit('B', ['Sword'], []);
    expect(planTrade({}, slot(a, 'inventory', sword), slot(b, 'inventory', null)).ok).toBe(false);
    expect(planTrade(battle, slot(a, 'bag', sword), slot(b, 'bag', null)).ok).toBe(false);
    expect(planTrade(battle, null, slot(b, 'inventory', null)).ok).toBe(false);
    expect(a.inventory).toEqual([sword]);
  });
});

describe('convoy', () => {
  it('Store: the same instance joins the convoy; a full convoy refuses', () => {
    const sword = weapon('Iron Sword', 'Sword', 'Prof', { _usesSpent: 0 });
    const steel = weapon('Steel Sword', 'Sword');
    const a = unit('A', ['Sword'], [sword, steel]);
    const run = realRun(a);
    const ctx = { context: 'roster', run };
    const result = applyTrade(ctx, slot(a, 'inventory', sword), convoySlot('inventory', null));
    expect(result).toEqual({ ok: true, kind: 'give', warnings: [], detail: 'Iron Sword' });
    expect(run.convoy.weapons).toEqual([sword]);
    expect(run.convoy.weapons[0]).toBe(sword);
    expect(run.convoy.weapons[0].uid).toBe(sword.uid);
    expect(a.inventory).toEqual([steel]);
    expect(a.weapon).toBe(steel);

    // Capacity: 20 weapons (no meta bonus) — the 20th fits, the 21st does not.
    fillConvoyWeapons(run, 19);
    const spare = weapon('Spare', 'Sword');
    a.inventory.push(spare);
    expect(planTrade(ctx, slot(a, 'inventory', spare), convoySlot('inventory', null))).toEqual({
      ok: false,
      reason: 'Convoy is full.',
    });
    expect(run.convoy.weapons).toHaveLength(20);
  });

  it('Store refuses supplies once the 15-slot supply bucket is full', () => {
    const tonic = supply('Tonic');
    const a = unit('A', ['Sword'], [], { consumables: [tonic] });
    const run = realRun(a);
    for (let i = 0; i < 15; i++) run.convoy.consumables.push(supply(`S${i}`));
    expect(
      planTrade(
        { context: 'roster', run },
        slot(a, 'consumables', tonic),
        convoySlot('consumables', null),
      ),
    ).toEqual({ ok: false, reason: 'Convoy is full.' });
  });

  it('Store takes the last combat weapon with a warning, like a give between units', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const heal = weapon('Heal', 'Staff');
    const a = unit('A', ['Sword', 'Staff'], [sword, heal]);
    const b = unit('B', ['Sword'], []);
    const run = realRun(a, b);
    const ctx = { context: 'roster', run };
    const toConvoy = [slot(a, 'inventory', sword), convoySlot('inventory', null)];
    expect(planTrade(ctx, ...toConvoy)).toEqual({
      ok: true,
      kind: 'give',
      warnings: [{ code: 'leaves_unarmed', unit: a }],
      detail: 'Iron Sword',
    });
    // Between units: the same warning (unchanged).
    expect(
      planTrade(ctx, slot(a, 'inventory', sword), slot(b, 'inventory', null)).warnings,
    ).toEqual([{ code: 'leaves_unarmed', unit: a }]);
    const result = applyTrade(ctx, ...toConvoy);
    expect(result.warnings).toEqual([{ code: 'leaves_unarmed', unit: a }]);
    // The same instance is stored; A keeps [Heal], which it can use, so settleEquipped
    // (rule 4) equips the staff: A has no combat weapon, but is not empty-handed.
    expect(run.convoy.weapons).toEqual([sword]);
    expect(run.convoy.weapons[0]).toBe(sword);
    expect(a.inventory).toEqual([heal]);
    expect(a.weapon).toBe(heal);
  });

  it('Store of the only item leaves the unit carrying nothing, with weapon null', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const a = unit('A', ['Sword'], [sword]);
    const run = realRun(a);
    const result = applyTrade(
      { context: 'roster', run },
      slot(a, 'inventory', sword),
      convoySlot('inventory', null),
    );
    expect(result).toEqual({
      ok: true,
      kind: 'give',
      warnings: [{ code: 'leaves_unarmed', unit: a }],
      detail: 'Iron Sword',
    });
    expect(a.inventory).toEqual([]);
    expect(a.weapon).toBeNull();
    expect(run.convoy.weapons).toEqual([sword]);
  });

  it('a unit with no combat weapon before the trade gets no unarmed warning', () => {
    // Warned only on the change: a staff-only unit storing its staff was never armed.
    const heal = weapon('Heal', 'Staff');
    const a = unit('A', ['Staff'], [heal]);
    const run = realRun(a);
    expect(
      planTrade(
        { context: 'roster', run },
        slot(a, 'inventory', heal),
        convoySlot('inventory', null),
      ).warnings,
    ).toEqual([]);
  });

  it('a swap of the last combat weapon for a convoy staff is allowed, with a warning', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const heal = weapon('Heal', 'Staff');
    const a = unit('A', ['Sword', 'Staff'], [sword]);
    const run = realRun(a);
    run.convoy.weapons.push(heal);
    const ctx = { context: 'roster', run };
    const clone = run.getConvoyItems().weapons[0];
    const result = applyTrade(ctx, slot(a, 'inventory', sword), convoySlot('inventory', clone));
    expect(result).toEqual({
      ok: true,
      kind: 'swap',
      warnings: [{ code: 'leaves_unarmed', unit: a }],
      detail: 'Iron Sword for Heal',
    });
    // Each item takes the slot the other left; A equips the incoming staff (rule 4).
    expect(a.inventory).toEqual([heal]);
    expect(a.weapon).toBe(heal);
    expect(run.convoy.weapons).toEqual([sword]);
  });

  it('swaps when both the convoy (20/20) and the bag (5/5) are full', () => {
    const bag = [0, 1, 2, 3, 4].map((n) => weapon(`A${n}`, 'Sword'));
    const a = unit('A', ['Sword', 'Lance'], [...bag]);
    const run = realRun(a);
    const stock = fillConvoyWeapons(run, 20);
    const ctx = { context: 'roster', run };
    // The UI holds a clone from getConvoyItems; the engine finds the real item by uid.
    const clone = run.getConvoyItems().weapons[7];
    expect(clone).not.toBe(stock[7]);
    const result = applyTrade(ctx, slot(a, 'inventory', bag[2]), convoySlot('inventory', clone));
    expect(result).toEqual({ ok: true, kind: 'swap', warnings: [], detail: 'A2 for Stock 7' });
    expect(a.inventory).toEqual([bag[0], bag[1], stock[7], bag[3], bag[4]]);
    expect(a.inventory[2]).toBe(stock[7]);
    expect(run.convoy.weapons[7]).toBe(bag[2]);
    expect(run.convoy.weapons).toHaveLength(20);
    expect(a.weapon).toBe(bag[0]);
  });

  it('Withdraw moves the real convoy item (found by uid) and equips an unarmed unit', () => {
    const a = unit('A', ['Lance'], [], { weapon: null });
    const run = realRun(a);
    const stock = fillConvoyWeapons(run, 3);
    const clone = run.getConvoyItems().weapons[1];
    const result = applyTrade(
      { context: 'roster', run },
      convoySlot('inventory', clone),
      slot(a, 'inventory', null),
    );
    expect(result).toEqual({ ok: true, kind: 'give', warnings: [], detail: 'Stock 1' });
    expect(a.inventory).toEqual([stock[1]]);
    expect(a.inventory[0]).toBe(stock[1]);
    expect(a.inventory[0]).not.toBe(clone);
    expect(a.weapon).toBe(stock[1]);
    expect(run.convoy.weapons).toEqual([stock[0], stock[2]]);
  });

  it('a convoy item that is gone (by identity and uid) is stale', () => {
    const a = unit('A', ['Lance'], []);
    const run = realRun(a);
    fillConvoyWeapons(run, 2);
    const ghost = weapon('Ghost', 'Lance');
    expect(
      planTrade(
        { context: 'roster', run },
        convoySlot('inventory', ghost),
        slot(a, 'inventory', null),
      ),
    ).toEqual({ ok: false, reason: 'Item is no longer available.' });
  });

  it('bag helpers report the convoy from the run and a unit at 5 / 3 / 1', () => {
    const a = unit('A', ['Sword'], [weapon('Iron Sword', 'Sword')]);
    const run = realRun(a);
    run.metaEffects = { convoyCapacityBonus: 2 };
    const ctx = { context: 'roster', run };
    const stock = fillConvoyWeapons(run, 2);
    expect(bagItems(ctx, CONVOY_HOLDER, 'inventory')).toEqual(stock);
    expect(bagItems(ctx, CONVOY_HOLDER, 'inventory')[0]).toBe(stock[0]);
    expect(bagCapacity(ctx, CONVOY_HOLDER, 'inventory')).toBe(22);
    expect(bagCapacity(ctx, CONVOY_HOLDER, 'consumables')).toBe(17);
    expect(bagCapacity(ctx, CONVOY_HOLDER, 'accessory')).toBe(0);
    expect(bagCapacity(ctx, unitHolder(a), 'inventory')).toBe(5);
    expect(bagCapacity(ctx, unitHolder(a), 'consumables')).toBe(3);
    expect(bagCapacity(ctx, unitHolder(a), 'accessory')).toBe(1);
    expect(bagItems(ctx, unitHolder(a), 'accessory')).toEqual([]);
    a.accessory = accessory('Power Ring');
    expect(bagItems(ctx, unitHolder(a), 'accessory')).toEqual([a.accessory]);
  });
});

describe('accessories (roster)', () => {
  it('data: the values these hand-worked cases assume', () => {
    expect(accessory("Sisters' Mantle").effects).toEqual({ HP: 5 });
    expect(accessory('Power Ring').effects).toEqual({ STR: 2 });
    expect(accessory("Courier's Boots").effects).toEqual({ MOV: 1 });
    expect(accessory('Mercury Sandals').combatEffects.moveTypeOverride).toBe('Flying');
  });

  it('a swap moves stats and keeps each unit’s missing HP', () => {
    const robe = accessory("Sisters' Mantle");
    const ring = accessory('Power Ring');
    const a = unit('A', ['Sword'], [], { currentHP: 13 });
    const b = unit('B', ['Sword'], []);
    equipAccessory(a, robe); // 20→25 max, 13→18 current (7 missing)
    equipAccessory(b, ring); // STR 5→7, 20/20
    expect([a.stats.HP, a.currentHP, b.stats.STR]).toEqual([25, 18, 7]);
    const result = applyTrade(
      rosterCtx(a, b),
      slot(a, 'accessory', robe),
      slot(b, 'accessory', ring),
    );
    expect(result).toEqual({
      ok: true,
      kind: 'swap',
      warnings: [],
      detail: "Sisters' Mantle for Power Ring",
    });
    // A: robe off → 20 max, 18-5 = 13 current; ring on → STR 7.
    expect(a.accessory).toBe(ring);
    expect(a.stats).toMatchObject({ HP: 20, STR: 7 });
    expect(a.currentHP).toBe(13);
    // B: ring off → STR 5; robe on → 25 max, 20+5 = 25 current.
    expect(b.accessory).toBe(robe);
    expect(b.stats).toMatchObject({ HP: 25, STR: 5 });
    expect(b.currentHP).toBe(25);
  });

  it.each([
    ['full HP', 25, 20],
    ['wounded', 18, 13],
    ['floor at 1', 3, 1],
    ['0 HP stays 0', 0, 0],
  ])("giving away a Sisters' Mantle (%s): %i/25 → %i/20", (_label, hpBefore, hpAfter) => {
    const robe = accessory("Sisters' Mantle");
    const a = unit('A', ['Sword'], []);
    const b = unit('B', ['Sword'], []);
    equipAccessory(a, robe);
    a.currentHP = hpBefore;
    const result = applyTrade(
      rosterCtx(a, b),
      slot(a, 'accessory', robe),
      slot(b, 'accessory', null),
    );
    expect(result).toEqual({ ok: true, kind: 'give', warnings: [], detail: "Sisters' Mantle" });
    expect(a.accessory).toBeNull();
    expect(a.stats.HP).toBe(20);
    expect(a.currentHP).toBe(hpAfter);
    expect(b.stats.HP).toBe(25);
    expect(b.currentHP).toBe(25);
  });

  it('Mercury Sandals move the move type; Boots move MOV', () => {
    const sandals = accessory('Mercury Sandals');
    const boots = accessory("Courier's Boots");
    const a = unit('A', ['Sword'], []);
    const b = unit('B', ['Lance'], [], { moveType: 'Cavalry', mov: 7 });
    b.stats.MOV = 7;
    equipAccessory(a, sandals); // Infantry → Flying
    equipAccessory(b, boots); // MOV 7 → 8
    expect([a.moveType, b.mov, b.stats.MOV]).toEqual(['Flying', 8, 8]);
    expect(
      applyTrade(rosterCtx(a, b), slot(a, 'accessory', sandals), slot(b, 'accessory', boots)).ok,
    ).toBe(true);
    expect(a.moveType).toBe('Infantry');
    expect(a._baseMoveType).toBeUndefined();
    expect([a.mov, a.stats.MOV]).toEqual([6, 6]);
    expect(b.moveType).toBe('Flying');
    expect([b.mov, b.stats.MOV]).toEqual([7, 7]);
    unequipAccessory(b);
    expect(b.moveType).toBe('Cavalry');
  });

  it('a give needs an empty slot; the convoy holds no accessories', () => {
    const ring = accessory('Power Ring');
    const robe = accessory("Sisters' Mantle");
    const a = unit('A', ['Sword'], [], { accessory: ring });
    const b = unit('B', ['Sword'], [], { accessory: robe });
    const ctx = rosterCtx(a, b);
    expect(planTrade(ctx, slot(a, 'accessory', ring), slot(b, 'accessory', null))).toEqual({
      ok: false,
      reason: 'Bag full.',
    });
    ctx.run = realRun(a, b);
    expect(planTrade(ctx, slot(a, 'accessory', ring), convoySlot('accessory', null)).ok).toBe(
      false,
    );
    expect([a.accessory, b.accessory]).toEqual([ring, robe]);
    expect(a.stats.STR).toBe(5); // hand-built with the ring's stats not applied; untouched
  });

  it('no heal from an equip/unequip loop through the pool or a trade ping-pong', () => {
    const robe = accessory("Sisters' Mantle");
    const a = unit('A', ['Sword'], [], { currentHP: 10 });
    const b = unit('B', ['Sword'], [], { currentHP: 10 });
    const run = realRun(a, b);
    run.accessories = [robe];
    for (let i = 0; i < 3; i++) {
      expect(rosterAccessoryAction(run, a, robe)).toBe(''); // equip: 15/25
      expect([a.currentHP, a.stats.HP]).toEqual([15, 25]);
      expect(rosterAccessoryAction(run, a)).toBe(''); // unequip: 10/20 (was 15/20)
      expect([a.currentHP, a.stats.HP]).toEqual([10, 20]);
    }
    const ctx = { context: 'roster', run };
    run.accessories = [];
    equipAccessory(a, robe); // 15/25
    for (let i = 0; i < 3; i++) {
      applyTrade(ctx, slot(a, 'accessory', robe), slot(b, 'accessory', null));
      applyTrade(ctx, slot(b, 'accessory', robe), slot(a, 'accessory', null));
    }
    expect([a.currentHP, a.stats.HP]).toEqual([15, 25]);
    expect([b.currentHP, b.stats.HP]).toEqual([10, 20]);
  });
});

describe('an HP accessory never heals at critical HP', () => {
  it.each([
    ['1/25', 1, 1],
    ['3/25', 3, 1],
    ['5/25', 5, 1],
    ['6/25', 6, 1],
    ['7/25', 7, 2],
  ])(
    'at %s: off and on through the pool leaves HP where it was',
    (_label, hpBefore, hpWhileOff) => {
      const robe = accessory("Sisters' Mantle");
      const a = unit('A', ['Sword'], []);
      const b = unit('B', ['Sword'], []);
      const run = realRun(a, b);
      run.accessories = [];
      equipAccessory(a, robe); // 25/25
      a.currentHP = hpBefore;
      for (let i = 0; i < 3; i++) {
        expect(rosterAccessoryAction(run, a)).toBe('');
        expect([a.currentHP, a.stats.HP]).toEqual([hpWhileOff, 20]);
        expect(rosterAccessoryAction(run, a, robe)).toBe('');
        expect([a.currentHP, a.stats.HP]).toEqual([hpBefore, 25]);
      }
    },
  );

  it('a trade swap at 1 HP gives the robe away and back without healing', () => {
    const robe = accessory("Sisters' Mantle");
    const ring = accessory('Power Ring');
    const a = unit('A', ['Sword'], []);
    const b = unit('B', ['Sword'], []);
    const ctx = { context: 'roster', run: realRun(a, b) };
    equipAccessory(a, robe);
    equipAccessory(b, ring);
    a.currentHP = 1; // 1/25
    applyTrade(ctx, slot(a, 'accessory', robe), slot(b, 'accessory', ring));
    expect([a.currentHP, a.stats.HP]).toEqual([1, 20]);
    // B was at full: the robe is a real +5 for B.
    expect([b.currentHP, b.stats.HP]).toEqual([25, 25]);
    applyTrade(ctx, slot(a, 'accessory', ring), slot(b, 'accessory', robe));
    expect([a.currentHP, a.stats.HP]).toEqual([1, 25]);
    expect([b.currentHP, b.stats.HP]).toEqual([20, 20]);
  });

  it('a heal that does not fill the bar keeps the debt; a full heal clears it', () => {
    const robe = accessory("Sisters' Mantle");
    const a = unit('A', ['Sword'], []);
    equipAccessory(a, robe);
    a.currentHP = 1;
    unequipAccessory(a); // 1/20, owes 5 (1 - 5 = -4 lifted to 1)
    a.currentHP += 10; // a Poultice: 11/20
    equipAccessory(a, robe);
    // Same as healing 10 with the robe on: 1/25 → 11/25.
    expect([a.currentHP, a.stats.HP]).toEqual([11, 25]);

    a.currentHP = 1;
    unequipAccessory(a); // 1/20, owes 5 (1 - 5 = -4 lifted to 1)
    a.currentHP = a.stats.HP; // rested: 20/20
    equipAccessory(a, robe);
    expect([a.currentHP, a.stats.HP]).toEqual([25, 25]);
  });

  it('resting, a battle or revival clear a debt the unit no longer owes', () => {
    const run = new RunManager(gameData);
    run.startRun();
    const [lord] = run.roster;
    const robe = accessory("Sisters' Mantle");
    equipAccessory(lord, robe);
    lord.currentHP = 1;
    unequipAccessory(lord); // owes 5
    const max = lord.stats.HP;
    const restNode = run.nodeMap.nodes.find((n) => n.id !== run.nodeMap.startNodeId);
    run.rest(restNode.id); // full HP, node complete
    lord.currentHP = max - 8; // hurt in the next battle
    equipAccessory(lord, robe);
    expect([lord.currentHP, lord.stats.HP]).toEqual([max - 3, max + 5]);

    lord.currentHP = 1;
    unequipAccessory(lord); // owes 5 again
    lord.currentHP = lord.stats.HP; // an Elixir between nodes
    run.beginBattleInProgress(run.nodeMap.startNodeId, {});
    lord.currentHP = max - 8;
    equipAccessory(lord, robe);
    expect([lord.currentHP, lord.stats.HP]).toEqual([max - 3, max + 5]);
  });

  it('the debt survives a save and load', () => {
    const run = new RunManager(gameData);
    run.startRun();
    const lord = run.roster[0];
    const robe = accessory("Sisters' Mantle");
    equipAccessory(lord, robe);
    lord.currentHP = 1;
    unequipAccessory(lord);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), gameData);
    const again = restored.roster.find((u) => u.name === lord.name);
    equipAccessory(again, robe);
    expect(again.currentHP).toBe(1);
  });

  it('a unit that died owes nothing once revived', () => {
    const run = new RunManager(gameData);
    run.startRun();
    const lord = run.roster[1];
    const robe = accessory("Sisters' Mantle");
    equipAccessory(lord, robe);
    lord.currentHP = 1;
    unequipAccessory(lord); // owes 5
    expect(lord._accessoryHpOwed).toBe(5);
    lord.currentHP = 0; // falls in battle
    run.roster.splice(run.roster.indexOf(lord), 1);
    run.fallenUnits.push(lord);
    expect(run.reviveFallenUnit(lord, 0)).toBe(true);
    const revived = run.roster.find((u) => u.name === lord.name);
    expect(revived?._accessoryHpOwed).toBeUndefined();
    expect(revived.currentHP).toBe(1);
  });

  it('taking the robe off a unit at 0 HP neither revives it nor leaves a debt', () => {
    const robe = accessory("Sisters' Mantle");
    const a = unit('A', ['Sword'], []);
    equipAccessory(a, robe);
    a.currentHP = 0;
    unequipAccessory(a);
    expect(a.currentHP).toBe(0);
    expect(a._accessoryHpOwed).toBeUndefined();
  });
});

describe('instance fields travel with the item', () => {
  it('uid, uses, imbue, forge and weapon-art fields are deep-equal after a give and a swap', () => {
    const forged = weapon('Iron Sword', 'Sword', 'Prof', {
      _usesSpent: 1,
      _imbueId: 'frost',
      _forgeLevel: 2,
      _forgeBonuses: { might: 2, hit: 5 },
      _forgeHistory: ['might', 'hit'],
      _baseName: 'Iron Sword',
      weaponArtIds: ['sword_grounder'],
      weaponArtSources: ['meta_innate'],
    });
    const snapshot = structuredClone(forged);
    const a = unit('A', ['Sword'], [weapon('Steel Sword', 'Sword'), forged]);
    const b = unit('B', ['Sword'], [weapon('Silver Sword', 'Sword')]);
    applyTrade(battle, slot(a, 'inventory', forged), slot(b, 'inventory', null));
    expect(b.inventory[1]).toBe(forged);
    expect(forged).toEqual(snapshot);
    applyTrade(battle, slot(b, 'inventory', forged), slot(a, 'inventory', a.inventory[0]));
    expect(a.inventory[0]).toBe(forged);
    expect(forged).toEqual(snapshot);
  });
});

describe('canTradeBetween', () => {
  it('needs two distinct units', () => {
    const a = unit('A', ['Sword'], [weapon('Iron Sword', 'Sword')]);
    expect(canTradeBetween(a, a)).toBe(false);
    expect(canTradeBetween(a, null)).toBe(false);
    expect(canTradeBetween(undefined, a)).toBe(false);
  });
});

describe('settleEquipped', () => {
  it('keeps a still-carried, equippable weapon over a usable incoming one', () => {
    const iron = weapon('Iron Sword', 'Sword');
    const steel = weapon('Steel Sword', 'Sword');
    const u = unit('U', ['Sword'], [iron, steel]);
    expect(settleEquipped(u, steel)).toBe(iron);
    expect(u.inventory).toEqual([iron, steel]);
  });

  it('prefers the incoming combat weapon over the first one, then moves it to slot 0', () => {
    const iron = weapon('Iron Lance', 'Lance');
    const steel = weapon('Steel Lance', 'Lance');
    const u = unit('U', ['Lance'], [iron, steel], { weapon: null });
    expect(settleEquipped(u, steel)).toBe(steel);
    expect(u.inventory).toEqual([steel, iron]);
  });

  it('drops a weapon the unit cannot equip for the first combat weapon', () => {
    const axe = weapon('Iron Axe', 'Axe');
    const lance = weapon('Iron Lance', 'Lance');
    const u = unit('U', ['Lance'], [axe, lance], { weapon: axe });
    expect(settleEquipped(u, axe)).toBe(lance);
    expect(u.inventory).toEqual([lance, axe]);
  });

  it('falls back to an equippable staff, then to null', () => {
    const tome = weapon('Fire', 'Tome');
    const heal = weapon('Heal', 'Staff');
    const cleric = unit('Cleric', ['Staff'], [tome, heal], { weapon: null });
    expect(settleEquipped(cleric)).toBe(heal);
    expect(cleric.inventory).toEqual([heal, tome]);
    const fighter = unit('Fighter', ['Axe'], [tome, heal], { weapon: heal });
    expect(settleEquipped(fighter)).toBeNull();
    expect(fighter.weapon).toBeNull();
    expect(fighter.inventory).toEqual([tome, heal]);
  });
});

describe('fallen units', () => {
  it("returning a fallen unit's accessory to the pool reverses its stats and move type", () => {
    const robe = accessory("Sisters' Mantle");
    const sandals = accessory('Mercury Sandals');
    const boots = accessory("Courier's Boots");
    for (const [item, check] of [
      [robe, (u) => expect([u.stats.HP, u.currentHP]).toEqual([20, 0])],
      [sandals, (u) => expect([u.moveType, u._baseMoveType]).toEqual(['Infantry', undefined])],
      [boots, (u) => expect([u.mov, u.stats.MOV]).toEqual([5, 5])],
    ]) {
      const fallen = unit('Fallen', ['Sword'], []);
      const run = realRun();
      equipAccessory(fallen, item);
      fallen.currentHP = 0;
      run._transferFallenUnitItems(fallen);
      expect(fallen.accessory).toBeNull();
      expect(run.accessories.map((a) => a.name)).toEqual([item.name]);
      expect(fallen.stats).toEqual(unit('Base', ['Sword']).stats);
      check(fallen);
    }
  });
});

// Reorder: two items trade places inside one unit's own bag (display order, the
// equipped weapon first); an item moving into weapon slot 1 becomes the equipped one.
describe('reorder within a unit', () => {
  function edricBag() {
    const sword = weapon('Iron Sword', 'Sword');
    const lance = weapon('Iron Lance', 'Lance');
    const steel = weapon('Steel Sword', 'Sword');
    const rapier = weapon('Rapier', 'Sword');
    const edric = unit('Edric', ['Sword', 'Lance'], [sword, lance, steel, rapier]);
    return { edric, sword, lance, steel, rapier };
  }

  it('slot 1 ↔ slot 3 moves the third item into slot 1 and equips it, in the same array', () => {
    const { edric, sword, lance, steel, rapier } = edricBag();
    const bag = edric.inventory;
    const from = slot(edric, 'inventory', steel);
    const to = slot(edric, 'inventory', sword);
    const expected = {
      ok: true,
      kind: 'reorder',
      equips: steel,
      warnings: [],
      detail: 'Equipped Steel Sword',
    };
    expect(planReorder(battle, from, to)).toEqual(expected);
    // Planning never mutates.
    expect(edric.inventory).toEqual([sword, lance, steel, rapier]);
    expect(edric.weapon).toBe(sword);
    expect(applyReorder(battle, from, to)).toEqual(expected);
    expect(edric.inventory).toBe(bag);
    expect(edric.inventory).toEqual([steel, lance, sword, rapier]);
    expect(edric.weapon).toBe(steel);
  });

  it('the held item may be the equipped one: it moves out and the other is equipped', () => {
    const { edric, sword, lance, steel, rapier } = edricBag();
    const result = applyReorder(
      battle,
      slot(edric, 'inventory', sword),
      slot(edric, 'inventory', rapier),
    );
    expect(result).toMatchObject({ ok: true, equips: rapier, detail: 'Equipped Rapier' });
    expect(edric.inventory).toEqual([rapier, lance, steel, sword]);
    expect(edric.weapon).toBe(rapier);
  });

  it('slot 2 ↔ slot 4 changes order only and keeps the equipped weapon', () => {
    const { edric, sword, lance, steel, rapier } = edricBag();
    const result = applyReorder(
      battle,
      slot(edric, 'inventory', lance),
      slot(edric, 'inventory', rapier),
    );
    expect(result).toEqual({
      ok: true,
      kind: 'reorder',
      equips: null,
      warnings: [],
      detail: 'Swapped Iron Lance and Rapier',
    });
    expect(edric.inventory).toEqual([sword, rapier, steel, lance]);
    expect(edric.weapon).toBe(sword);
  });

  it('a weapon the unit cannot wield never moves into slot 1', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const axe = weapon('Iron Axe', 'Axe');
    const scroll = { name: 'Forestall Scroll', type: 'Scroll', skillId: 'vantage', uid: 's1' };
    const edric = unit('Edric', ['Sword'], [sword, axe, scroll]);
    for (const item of [axe, scroll]) {
      const before = structuredClone(edric);
      const from = slot(edric, 'inventory', item);
      const to = slot(edric, 'inventory', sword);
      const reason = `Edric can't wield ${item.name}.`;
      expect(planReorder(battle, from, to)).toEqual({ ok: false, reason });
      expect(applyReorder(battle, from, to)).toEqual({ ok: false, reason });
      expect(edric).toEqual(before);
      expect(edric.weapon).toBe(sword);
    }
    // Between the other slots it is only order.
    expect(
      applyReorder(battle, slot(edric, 'inventory', axe), slot(edric, 'inventory', scroll)).ok,
    ).toBe(true);
    expect(edric.inventory).toEqual([sword, scroll, axe]);
  });

  it('a staff can be equipped by a unit with its rank (as the battle Equip menu allows)', () => {
    const lance = weapon('Iron Lance', 'Lance');
    const heal = weapon('Heal', 'Staff', 'Prof', { _usesSpent: 2, uid: 'uid-heal' });
    const sera = unit('Sera', ['Lance', 'Staff'], [lance, heal]);
    const result = applyReorder(
      battle,
      slot(sera, 'inventory', heal),
      slot(sera, 'inventory', lance),
    );
    expect(result).toMatchObject({ ok: true, equips: heal });
    expect(sera.inventory).toEqual([heal, lance]);
    expect(sera.weapon).toBe(heal);
    // Without the rank it is refused.
    const kai = unit('Kai', ['Lance'], [weapon('Javelin', 'Lance'), weapon('Solace', 'Staff')]);
    const [javelin, mend] = kai.inventory;
    expect(
      planReorder(battle, slot(kai, 'inventory', mend), slot(kai, 'inventory', javelin)),
    ).toEqual({ ok: false, reason: "Kai can't wield Solace." });
  });

  it('items keep their instance: uid, spent uses, imbue and forge fields survive', () => {
    const sword = weapon('Iron Sword', 'Sword', 'Prof', {
      _imbueId: 'ember',
      _forgeLevel: 1,
      weaponArtIds: ['sword_wrath_strike'],
    });
    const heal = weapon('Heal', 'Staff', 'Prof', { _usesSpent: 2 });
    const steel = weapon('Steel Sword', 'Sword');
    const sage = unit('Sage', ['Sword', 'Staff'], [sword, heal, steel]);
    const snapshot = structuredClone([sword, heal, steel]);
    applyReorder(battle, slot(sage, 'inventory', steel), slot(sage, 'inventory', sword));
    applyReorder(battle, slot(sage, 'inventory', heal), slot(sage, 'inventory', sword));
    expect(sage.inventory).toEqual([steel, sword, heal]);
    expect(sage.inventory[0]).toBe(steel);
    expect(sage.inventory[1]).toBe(sword);
    expect(sage.inventory[2]).toBe(heal);
    expect([sword, heal, steel]).toEqual(snapshot);
  });

  it('an old save with the equipped weapon out of slot 1 swaps in display order', () => {
    const lance = weapon('Iron Lance', 'Lance');
    const rapier = weapon('Rapier', 'Sword');
    const sword = weapon('Iron Sword', 'Sword');
    // Carried [Lance, Rapier, Sword], Sword equipped: shown [Sword, Lance, Rapier].
    const legacy = () => {
      const u = unit('Edric', ['Sword', 'Lance'], [lance, rapier, sword]);
      u.weapon = sword;
      return u;
    };
    const a = legacy();
    expect(
      applyReorder(battle, slot(a, 'inventory', lance), slot(a, 'inventory', rapier)),
    ).toMatchObject({ ok: true, equips: null });
    expect(a.inventory).toEqual([sword, rapier, lance]);
    expect(a.weapon).toBe(sword);
    const b = legacy();
    expect(
      applyReorder(battle, slot(b, 'inventory', rapier), slot(b, 'inventory', sword)),
    ).toMatchObject({ ok: true, equips: rapier });
    expect(b.inventory).toEqual([rapier, lance, sword]);
    expect(b.weapon).toBe(rapier);
  });

  it('an unarmed unit equips a usable weapon moved into slot 1; other swaps are order only', () => {
    const axe = weapon('Iron Axe', 'Axe');
    const lance = weapon('Iron Lance', 'Lance');
    const sword = weapon('Iron Sword', 'Sword');
    const kai = unit('Kai', ['Sword'], [axe, lance, sword]);
    kai.weapon = null;
    expect(
      applyReorder(battle, slot(kai, 'inventory', lance), slot(kai, 'inventory', sword)),
    ).toMatchObject({ ok: true, equips: null });
    expect(kai.inventory).toEqual([axe, sword, lance]);
    expect(kai.weapon).toBeNull();
    expect(
      applyReorder(battle, slot(kai, 'inventory', sword), slot(kai, 'inventory', axe)),
    ).toMatchObject({ ok: true, equips: sword });
    expect(kai.inventory).toEqual([sword, axe, lance]);
    expect(kai.weapon).toBe(sword);
  });

  it('supplies reorder without touching the equipped weapon', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const [vulnerary, elixir, tonic] = [supply('Poultice'), supply('Elixir'), supply('Tonic')];
    const edric = unit('Edric', ['Sword'], [sword], {
      consumables: [vulnerary, elixir, tonic],
    });
    const bag = edric.consumables;
    const result = applyReorder(
      rosterCtx(edric),
      slot(edric, 'consumables', tonic),
      slot(edric, 'consumables', vulnerary),
    );
    expect(result).toEqual({
      ok: true,
      kind: 'reorder',
      equips: null,
      warnings: [],
      detail: 'Swapped Tonic and Poultice',
    });
    expect(edric.consumables).toBe(bag);
    expect(edric.consumables).toEqual([tonic, elixir, vulnerary]);
    expect(edric.weapon).toBe(sword);
  });

  describe('refusals change nothing', () => {
    function pair() {
      const sword = weapon('Iron Sword', 'Sword');
      const steel = weapon('Steel Sword', 'Sword');
      const lance = weapon('Iron Lance', 'Lance');
      const tonic = supply('Tonic');
      const ring = accessory('Power Ring');
      const a = unit('A', ['Sword'], [sword, steel], { consumables: [tonic], accessory: ring });
      const b = unit('B', ['Lance'], [lance]);
      return { a, b, sword, steel, lance, tonic, ring };
    }
    it.each([
      [
        'the convoy',
        battle,
        ({ a, sword }) => [slot(a, 'inventory', sword), convoySlot('inventory', null)],
        "Only a unit's own items can be reordered.",
      ],
      [
        'the convoy on both sides (roster)',
        null,
        ({ sword, steel }) => [convoySlot('inventory', sword), convoySlot('inventory', steel)],
        "Only a unit's own items can be reordered.",
      ],
      [
        'the accessory slot',
        null,
        ({ a, ring }) => [slot(a, 'accessory', ring), slot(a, 'accessory', ring)],
        'Only weapons and supplies can be reordered.',
      ],
      [
        'an empty slot',
        battle,
        ({ a, sword }) => [slot(a, 'inventory', sword), slot(a, 'inventory', null)],
        'Choose another item to swap with.',
      ],
      [
        'the same item',
        battle,
        ({ a, steel }) => [slot(a, 'inventory', steel), slot(a, 'inventory', steel)],
        'Choose another item to swap with.',
      ],
      [
        'two units',
        battle,
        ({ a, b, sword, lance }) => [slot(a, 'inventory', sword), slot(b, 'inventory', lance)],
        "Reorder items within one unit's bag.",
      ],
      [
        'two bags',
        battle,
        ({ a, sword, tonic }) => [slot(a, 'inventory', sword), slot(a, 'consumables', tonic)],
        'Items trade only within the same bag.',
      ],
      [
        'a stale item',
        battle,
        ({ a, sword, lance }) => [slot(a, 'inventory', lance), slot(a, 'inventory', sword)],
        'Item is no longer available.',
      ],
      [
        'an enemy in battle',
        battle,
        ({ a, sword, steel }) => {
          a.faction = 'enemy';
          return [slot(a, 'inventory', steel), slot(a, 'inventory', sword)];
        },
        'Invalid trade.',
      ],
      [
        'a unit no longer on the roster',
        'roster-without',
        ({ a, sword, steel }) => [slot(a, 'inventory', steel), slot(a, 'inventory', sword)],
        'Unit is no longer in the roster.',
      ],
    ])('%s', (_label, ctxKind, build, reason) => {
      const f = pair();
      const ctx =
        ctxKind === null
          ? rosterCtx(f.a, f.b)
          : ctxKind === 'roster-without'
            ? rosterCtx(f.b)
            : ctxKind;
      const [from, to] = build(f);
      const before = structuredClone({ a: f.a, b: f.b });
      expect(planReorder(ctx, from, to)).toEqual({ ok: false, reason });
      expect(applyReorder(ctx, from, to)).toEqual({ ok: false, reason });
      expect({ a: f.a, b: f.b }).toEqual(before);
      expect(f.a.weapon).toBe(f.sword);
    });

    it('applyReorder re-plans: an item that left after planning is refused', () => {
      const { a, sword, steel } = pair();
      const from = slot(a, 'inventory', steel);
      const to = slot(a, 'inventory', sword);
      expect(planReorder(battle, from, to).ok).toBe(true);
      a.inventory.splice(1, 1);
      expect(applyReorder(battle, from, to)).toEqual({
        ok: false,
        reason: 'Item is no longer available.',
      });
      expect(a.inventory).toEqual([sword]);
      expect(a.weapon).toBe(sword);
    });
  });

  it('a trade between two items of one unit is still refused (that is a reorder)', () => {
    const sword = weapon('Iron Sword', 'Sword');
    const steel = weapon('Steel Sword', 'Sword');
    const a = unit('A', ['Sword'], [sword, steel]);
    const from = slot(a, 'inventory', steel);
    const to = slot(a, 'inventory', sword);
    expect(planTrade(battle, from, to)).toEqual({ ok: false, reason: 'Choose another unit.' });
    expect(applyTrade(battle, from, to)).toEqual({ ok: false, reason: 'Choose another unit.' });
    expect(a.inventory).toEqual([sword, steel]);
  });
});
