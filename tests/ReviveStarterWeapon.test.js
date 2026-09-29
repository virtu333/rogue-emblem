// A revived unit's gear went to the convoy when it fell; if it has nothing to fight
// (or heal) with, the church hands it the Iron weapon of its main type.
import { describe, it, expect } from 'vitest';
import {
  createUnit,
  reviveStarterWeapon,
  grantReviveStarterWeapon,
  withIndefiniteArticle,
} from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const make = (className) => {
  const unit = createUnit(
    data.classes.find((c) => c.name === className),
    3,
    data.weapons,
    { name: `Test ${className}` },
  );
  unit.inventory = [];
  unit.weapon = null;
  return unit;
};
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

describe('reviveStarterWeapon', () => {
  it('an unarmed fighter gets the Iron weapon of its first combat type, equipped', () => {
    const fighter = make('Fighter');
    const carried = grantReviveStarterWeapon(fighter, data.weapons);
    expect(carried.name).toBe('Iron Axe');
    expect(fighter.weapon).toBe(carried);
    expect(fighter.inventory).toEqual([carried]);
  });

  it('a staff-only healer without a staff gets Heal', () => {
    const cleric = make('Cleric');
    expect(cleric.proficiencies.every((p) => p.type === 'Staff')).toBe(true);
    const carried = grantReviveStarterWeapon(cleric, data.weapons);
    expect(carried.name).toBe('Heal');
    expect(cleric.inventory).toEqual([carried]);
  });

  it('an armed unit, a healer with a staff, or a full bag gets nothing', () => {
    const armed = make('Fighter');
    armed.inventory = [weapon('Steel Axe')];
    expect(reviveStarterWeapon(armed, data.weapons)).toBeNull();
    const cleric = make('Cleric');
    cleric.inventory = [weapon('Solace')];
    expect(reviveStarterWeapon(cleric, data.weapons)).toBeNull();
    // Five items it cannot fight with: no room for a sixth.
    const full = make('Fighter');
    full.inventory = Array.from({ length: 5 }, () => weapon('Iron Sword'));
    expect(reviveStarterWeapon(full, data.weapons)).toBeNull();
    expect(grantReviveStarterWeapon(full, data.weapons)).toBeNull();
    expect(full.inventory).toHaveLength(5);
  });

  it('names an item with its article', () => {
    expect(withIndefiniteArticle('Iron Axe')).toBe('an Iron Axe');
    expect(withIndefiniteArticle('Heal')).toBe('a Heal');
  });
});
