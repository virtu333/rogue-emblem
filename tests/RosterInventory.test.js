import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { addToInventory } from '../src/engine/UnitManager.js';
import { rosterItemAction, rosterAccessoryAction } from '../src/engine/RosterInventory.js';
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
  it('protects the final weapon and stores a spare without duplication', () => {
    const { run, unit } = fixture();
    unit.inventory = [unit.weapon];
    expect(rosterItemAction(run, unit, unit.weapon, 'store')).toContain('at least one');
    addToInventory(unit, unit.weapon);
    const spare = unit.inventory[1];
    expect(rosterItemAction(run, unit, spare, 'store')).toBe('');
    expect(rosterItemAction(run, unit, spare, 'store')).toContain('no longer');
    expect(run.getConvoyCounts().weapons).toBe(1);
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
