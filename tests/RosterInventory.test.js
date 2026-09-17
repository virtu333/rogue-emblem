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
});
