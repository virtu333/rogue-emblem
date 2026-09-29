import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { addToInventory } from '../src/engine/UnitManager.js';
import {
  rosterItemAction,
  rosterItemBlock,
  rosterItemWarnings,
  rosterAccessoryAction,
} from '../src/engine/RosterInventory.js';
import { loadGameData } from './testData.js';
function fixture() {
  const run = new RunManager(loadGameData());
  run.startRun();
  return { run, unit: run.roster[0] };
}
describe('roster inventory actions', () => {
  it('equips a withdrawn combat weapon only when the equipped slot is empty', () => {
    const { run, unit } = fixture();
    run.addToConvoy(unit.weapon);
    unit.inventory = [];
    unit.weapon = null;
    const item = run.getConvoyItems().weapons[0];
    expect(rosterItemAction(run, unit, item, 'withdraw')).toBe('');
    expect(unit.weapon).toBe(unit.inventory[0]);
    const equipped = unit.weapon;
    run.addToConvoy(equipped);
    expect(rosterItemAction(run, unit, run.getConvoyItems().weapons[0], 'withdraw')).toBe('');
    expect(unit.weapon).toBe(equipped);
  });

  it('withdraws a cloned convoy snapshot exactly once, preserving identity and uses', () => {
    const { run, unit } = fixture();
    const item = { name: 'Potion', type: 'Consumable', effect: 'heal', value: 10, uses: 2 };
    unit.consumables = [];
    run.addToConvoy(item);
    const snapshot = run.getConvoyItems().consumables[0];
    expect(rosterItemAction(run, unit, snapshot, 'withdraw')).toBe('');
    expect(unit.consumables[0]).toMatchObject({ uid: snapshot.uid, uses: 2 });
    expect(run.getConvoyCounts().consumables).toBe(0);
    expect(rosterItemAction(run, unit, snapshot, 'withdraw')).toContain('no longer');
    expect(unit.consumables).toHaveLength(1);
  });
  it('does not remove convoy items when recipient fills before activation', () => {
    const { run, unit } = fixture();
    run.addToConvoy(unit.weapon);
    const item = run.getConvoyItems().weapons[0];
    while (unit.inventory.length < 5) addToInventory(unit, unit.weapon);
    expect(rosterItemAction(run, unit, item, 'withdraw')).toBe('Equipment full.');
    expect(run.getConvoyCounts().weapons).toBe(1);
  });
  it('stores a spare without duplication, and warns only for the last weapon', () => {
    const { run, unit } = fixture();
    unit.inventory = [unit.weapon];
    addToInventory(unit, unit.weapon);
    const [equipped, spare] = unit.inventory;
    // Two usable copies: storing either leaves a combat weapon, so no warning.
    expect(rosterItemWarnings(run, unit, spare, 'store')).toEqual([]);
    expect(rosterItemAction(run, unit, spare, 'store')).toBe('');
    expect(rosterItemAction(run, unit, spare, 'store')).toContain('no longer');
    expect(rosterItemWarnings(run, unit, spare, 'store')).toEqual([]); // blocked: no warning
    expect(run.getConvoyCounts().weapons).toBe(1);
    expect(unit.inventory).toEqual([equipped]);
    expect(unit.weapon).toBe(equipped);
  });
  it('stores the last combat weapon: allowed, warned, and the unit is left unarmed', () => {
    const { run, unit } = fixture();
    const weapon = unit.weapon;
    unit.inventory = [weapon];
    expect(rosterItemBlock(run, unit, weapon, 'store')).toBe('');
    expect(rosterItemWarnings(run, unit, weapon, 'store')).toEqual([
      { code: 'leaves_unarmed', unit },
    ]);
    expect(rosterItemAction(run, unit, weapon, 'store')).toBe('');
    expect(unit.inventory).toEqual([]);
    expect(unit.weapon).toBeNull();
    expect(run.getConvoyCounts().weapons).toBe(1);
    expect(run.getConvoyItems().weapons[0].uid).toBe(weapon.uid);
  });
  it('storing the last combat weapon beside a usable staff equips the staff', () => {
    const { run, unit } = fixture();
    const weapon = unit.weapon;
    const staff = { name: 'Heal', type: 'Staff', rankRequired: 'Prof', uses: 3, uid: 'heal-1' };
    unit.proficiencies = [...unit.proficiencies, { type: 'Staff', rank: 'Prof' }];
    unit.inventory = [weapon, staff];
    expect(rosterItemWarnings(run, unit, weapon, 'store')).toEqual([
      { code: 'leaves_unarmed', unit },
    ]);
    expect(rosterItemAction(run, unit, weapon, 'store')).toBe('');
    expect(unit.inventory).toEqual([staff]);
    expect(unit.weapon).toBe(staff);
  });
  it('supplies and non-store actions carry no unarmed warning', () => {
    const { run, unit } = fixture();
    const potion = { name: 'Potion', type: 'Consumable', effect: 'heal', value: 10, uses: 1 };
    unit.inventory = [unit.weapon];
    unit.consumables = [potion];
    expect(rosterItemWarnings(run, unit, potion, 'store')).toEqual([]);
    expect(rosterItemWarnings(run, unit, unit.weapon, 'equip')).toEqual([]);
  });
  it('consumes healing only when damaged and removes the exhausted item', () => {
    const { run, unit } = fixture();
    const item = { name: 'Potion', type: 'Consumable', effect: 'heal', value: 10, uses: 1 };
    unit.consumables = [item];
    unit.currentHP = unit.stats.HP;
    expect(rosterItemAction(run, unit, item, 'heal')).toContain('already full');
    expect(item.uses).toBe(1);
    unit.currentHP -= 3;
    expect(rosterItemAction(run, unit, item, 'heal')).toBe('');
    expect(unit.currentHP).toBe(unit.stats.HP);
    expect(unit.consumables).toHaveLength(0);
  });
  it('swaps accessories without duplicating pool entries', () => {
    const { run, unit } = fixture();
    const item = { name: 'Test ring', effects: { DEF: 2 } };
    run.accessories = [item];
    expect(rosterAccessoryAction(run, unit, item)).toBe('');
    expect(run.accessories).not.toContain(item);
    expect(unit.accessory).toBe(item);
    expect(rosterAccessoryAction(run, unit, item)).toContain('no longer');
    expect(rosterAccessoryAction(run, unit)).toBe('');
    expect(run.accessories.filter((a) => a === item)).toHaveLength(1);
  });
  it.each(loadGameData().consumables.filter((i) => i.effect === 'statBoost'))(
    'uses $name exactly once, with permanent stats surviving serialization',
    (base) => {
      const { run, unit } = fixture();
      const item = structuredClone(base);
      unit.consumables = [item];
      const before = unit.stats[item.stat],
        hp = unit.currentHP;
      expect(rosterItemAction(run, unit, item, 'use')).toBe('');
      expect(unit.stats[item.stat]).toBe(before + item.value);
      if (item.stat === 'HP') expect(unit.currentHP).toBe(hp + item.value);
      if (item.stat === 'MOV') expect(unit.mov).toBe(unit.stats.MOV);
      expect(unit.consumables).toEqual([]);
      expect(rosterItemAction(run, unit, item, 'use')).toContain('no longer');
      expect(unit.stats[item.stat]).toBe(before + item.value);
      const restored = RunManager.fromJSON(
        JSON.parse(JSON.stringify(run.toJSON())),
        loadGameData(),
      );
      expect(restored.roster[0].stats[item.stat]).toBe(before + item.value);
      expect(restored.roster[0].consumables).toEqual([]);
    },
  );
  it('refuses exhausted or transferred boosters and invalid stats', () => {
    const { run, unit } = fixture();
    const item = { type: 'Consumable', effect: 'statBoost', stat: 'MAG', value: 2, uses: 0 };
    unit.consumables = [item];
    expect(rosterItemAction(run, unit, item, 'use')).toBe('No uses remaining.');
    item.uses = 1;
    item.stat = 'invalid';
    expect(rosterItemAction(run, unit, item, 'use')).toBe('Invalid stat booster.');
    expect(item.uses).toBe(1);
    unit.consumables = [];
    expect(rosterItemAction(run, unit, item, 'use')).toContain('no longer');
  });
  it('cures conditions and lets Remedy heal without a condition, without wasting healthy uses', () => {
    const { run, unit } = fixture();
    const herb = { type: 'Consumable', effect: 'cure', uses: 2 };
    const remedy = { type: 'Consumable', effect: 'cureHeal', value: 10, uses: 1 };
    unit.consumables = [herb, remedy];
    expect(rosterItemAction(run, unit, herb, 'use')).toContain('No status');
    expect(rosterItemAction(run, unit, remedy, 'use')).toContain('HP is full');
    unit._conditions = [{ id: 'poison', turnsRemaining: 2 }];
    expect(rosterItemAction(run, unit, herb, 'use')).toBe('');
    expect(unit._conditions).toEqual([]);
    expect(herb.uses).toBe(1);
    unit.currentHP -= 3;
    expect(rosterItemAction(run, unit, remedy, 'use')).toBe('');
    expect(unit.currentHP).toBe(unit.stats.HP);
    expect(unit.consumables).toEqual([herb]);
  });
});

// Between battles, heals, boosters and seals work straight from the convoy on a
// chosen unit (playtest 2026-09-28): no free bag slot, no withdraw-then-use.
describe('using consumables from the convoy', () => {
  const liveConvoyItem = (run) => run.convoy.consumables.at(-1);

  it('a heal from the convoy mends the unit and spends a use there; the last use leaves', () => {
    const { run, unit } = fixture();
    unit.consumables = [];
    unit.currentHP = unit.stats.HP - 15;
    run.addToConvoy({ name: 'Potion', type: 'Consumable', effect: 'heal', value: 10, uses: 2 });
    const potion = liveConvoyItem(run);
    expect(rosterItemAction(run, unit, potion, 'use')).toBe('');
    expect(unit.currentHP).toBe(unit.stats.HP - 5);
    expect(potion.uses).toBe(1);
    expect(run.convoy.consumables).toContain(potion);
    expect(unit.consumables).toEqual([]);
    expect(rosterItemAction(run, unit, potion, 'use')).toBe('');
    expect(unit.currentHP).toBe(unit.stats.HP);
    expect(run.convoy.consumables).not.toContain(potion);
    expect(rosterItemAction(run, unit, potion, 'use')).toContain('no longer');
  });

  it('works with a full bag, and never for a full-HP unit or a convoy weapon', () => {
    const { run, unit } = fixture();
    const vulnerary = { name: 'Poultice', type: 'Consumable', effect: 'heal', value: 10, uses: 3 };
    unit.consumables = [0, 1, 2].map(() => structuredClone(vulnerary));
    run.addToConvoy({ ...vulnerary, uses: 1 });
    const stored = liveConvoyItem(run);
    expect(rosterItemBlock(run, unit, stored, 'use')).toBe('HP is already full.');
    unit.currentHP = 1;
    expect(rosterItemAction(run, unit, stored, 'use')).toBe('');
    expect(unit.currentHP).toBe(11);
    expect(unit.consumables.map((c) => c.uses)).toEqual([3, 3, 3]);
    run.addToConvoy(unit.weapon);
    expect(rosterItemBlock(run, unit, run.convoy.weapons.at(-1), 'use')).toContain('no longer');
    // Storing is still only for what the unit carries.
    run.addToConvoy({ ...vulnerary });
    expect(rosterItemBlock(run, unit, liveConvoyItem(run), 'store')).toContain('no longer');
  });

  it('a booster from the convoy raises the stat once', () => {
    const { run, unit } = fixture();
    run.addToConvoy({
      name: 'Mightroot',
      type: 'Consumable',
      effect: 'statBoost',
      stat: 'STR',
      value: 2,
      uses: 1,
    });
    const drop = liveConvoyItem(run);
    const str = unit.stats.STR;
    expect(rosterItemAction(run, unit, drop, 'use')).toBe('');
    expect(unit.stats.STR).toBe(str + 2);
    expect(run.convoy.consumables).not.toContain(drop);
    expect(rosterItemAction(run, unit, drop, 'use')).toContain('no longer');
    expect(unit.stats.STR).toBe(str + 2);
  });
});
