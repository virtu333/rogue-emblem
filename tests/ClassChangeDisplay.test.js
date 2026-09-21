import { it, expect, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  createUnit,
  createLordUnit,
  promoteUnit,
  getReclassTargets,
} from '../src/engine/UnitManager.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { classChangePreview } from '../src/ui/classChangeDisplay.js';
const data = loadGameData();
const fighter = () =>
  createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    10,
    data.weapons,
    { name: 'A long named veteran of the western mercenary company' },
  );
it('previews reclass without mutation or RNG, including seal, stats, growth reroll and equipment', () => {
  const unit = fighter();
  const item = {
    name: 'Second Seal',
    type: 'Consumable',
    effect: 'reclass',
    subEffect: 'infantry',
    uses: 1,
  };
  unit.consumables = [item];
  const target = data.classes.find((c) => c.name === 'Myrmidon');
  const before = JSON.stringify(unit);
  const random = vi.spyOn(Math, 'random');
  const text = classChangePreview(unit, item, target, data);
  expect(random).not.toHaveBeenCalled();
  random.mockRestore();
  expect(JSON.stringify(unit)).toBe(before);
  expect(text).toContain('Uses 1 Second Seal charge');
  expect(text).toContain('Growth rates reroll on Confirm');
  expect(text).toContain('Axe Prof → Sword Prof');
  expect(text).toContain('Iron Axe → Iron Sword');
  const result = applyRosterClassChange({ roster: [unit] }, unit, item, target, data);
  expect(result.ok).toBe(true);
  expect(text).toContain(`STR ${JSON.parse(before).stats.STR} → ${unit.stats.STR}`);
});
it('previews capped skill omissions and a full-bag unarmed reclass', () => {
  const unit = fighter();
  const warrior = data.classes.find((c) => c.name === 'Warrior');
  promoteUnit(unit, warrior, warrior.promotionBonuses, data.skills);
  unit.skills = ['adept', 'vantage', 'wrath', 'miracle', 'renewal'];
  const target = getReclassTargets(unit, data.classes, 'infantry').find((c) => c.name === 'Hero');
  const text = classChangePreview(unit, { name: 'Second Seal', effect: 'reclass' }, target, data);
  expect(text).toContain('cannot learn Vigilance');
  const base = fighter();
  while (base.inventory.length < 5) base.inventory.push({ ...base.inventory[0] });
  const full = classChangePreview(
    base,
    { effect: 'reclass' },
    data.classes.find((c) => c.name === 'Myrmidon'),
    data,
  );
  expect(full).toContain('Bag full: Iron Sword');
  expect(full).toContain('None — equip a compatible weapon');
});
it('uses lord promotion bonuses and the same starter grant rule as the command', () => {
  const lord = data.lords[0];
  const cls = data.classes.find((c) => c.name === lord.class);
  const unit = createLordUnit(lord, cls, data.weapons);
  unit.level = 10;
  const target = data.classes.find((c) => c.name === lord.promotedClass);
  const item = { name: 'Master Seal', type: 'Consumable', effect: 'promote', uses: 1 };
  unit.consumables = [item];
  const before = structuredClone(unit);
  const text = classChangePreview(unit, item, target, data);
  const result = applyRosterClassChange({ roster: [unit] }, unit, item, target, data);
  expect(result.ok).toBe(true);
  expect(text).toContain(`STR ${before.stats.STR} → ${unit.stats.STR}`);
  expect(text).toContain('Level resets to 1');
  for (const w of unit.inventory.filter(
    (w) => !before.inventory.some((old) => old.name === w.name),
  ))
    expect(text).toContain(`Starter weapon: ${w.name}`);
});
