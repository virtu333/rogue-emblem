import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  createUnit,
  resolvePromotionTargets,
  getReclassTargets,
} from '../src/engine/UnitManager.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
const data = loadGameData();
function fixture(effect = 'promote') {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    10,
    data.weapons,
    { name: 'Test fighter' },
  );
  const seal = { name: 'Seal', type: 'Consumable', effect, subEffect: 'infantry', uses: 1 };
  unit.consumables = [seal];
  return { unit, seal, run: { roster: [unit] } };
}
describe('roster class change commands', () => {
  it('promotes, grants the new proficiency weapon, consumes exactly one seal, and rejects replay', () => {
    const { unit, seal, run } = fixture();
    const target = resolvePromotionTargets(unit, data.classes, data.lords).find(
      (c) => c.name === 'Warrior',
    );
    expect(applyRosterClassChange(run, unit, seal, target, data).ok).toBe(true);
    expect(unit.className).toBe('Warrior');
    expect(unit.inventory.some((w) => w.type === 'Bow' && w.tier === 'Iron')).toBe(true);
    expect(unit.consumables).not.toContain(seal);
    const snapshot = JSON.stringify(unit);
    expect(applyRosterClassChange(run, unit, seal, target, data).ok).toBe(false);
    expect(JSON.stringify(unit)).toBe(snapshot);
  });
  it('rejects stale ownership and invalid target without mutation', () => {
    const { unit, seal, run } = fixture();
    const snapshot = JSON.stringify(unit);
    expect(applyRosterClassChange(run, unit, seal, { name: 'Mage' }, data).ok).toBe(false);
    expect(JSON.stringify(unit)).toBe(snapshot);
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    expect(applyRosterClassChange({ roster: [] }, unit, seal, target, data).ok).toBe(false);
    expect(JSON.stringify(unit)).toBe(snapshot);
  });
  it('reclasses, preserves level, grants new weapons and consumes the seal', () => {
    const { unit, seal, run } = fixture('reclass');
    const target = getReclassTargets(unit, data.classes, seal.subEffect).find(
      (c) => c.name === 'Myrmidon',
    );
    expect(applyRosterClassChange(run, unit, seal, target, data).ok).toBe(true);
    expect(unit.className).toBe('Myrmidon');
    expect(unit.level).toBe(10);
    expect(unit.inventory.some((w) => w.type === 'Sword' && w.tier === 'Iron')).toBe(true);
    expect(unit.consumables).not.toContain(seal);
  });
});

it('blocks a Dancer with no allowed promotion target without consuming the seal', () => {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Dancer'),
    10,
    data.weapons,
    { name: 'Dancer' },
  );
  const seal = { type: 'Consumable', effect: 'promote', uses: 1 };
  unit.consumables = [seal];
  const result = applyRosterClassChange({ roster: [unit] }, unit, seal, { name: 'Bard' }, data);
  expect(result).toEqual({ ok: false, reason: 'No available promotion class.' });
  expect(seal.uses).toBe(1);
});
it('reports an ungranted Iron weapon when the promoted unit bag is full', () => {
  const { unit, seal, run } = fixture();
  while (unit.inventory.length < 5) unit.inventory.push({ ...unit.inventory[0] });
  const target = resolvePromotionTargets(unit, data.classes, data.lords).find(
    (c) => c.name === 'Warrior',
  );
  expect(applyRosterClassChange(run, unit, seal, target, data).notices).toEqual([
    'Bag full: Iron Bow could not be granted.',
  ]);
});
