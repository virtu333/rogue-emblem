import { it, expect } from 'vitest';
import { applyRewardTarget, applyRewardForge } from '../src/engine/LootRewardCommands.js';
function fixture() {
  const weapon = {
    name: 'Iron Sword',
    type: 'Sword',
    rankRequired: 'Prof',
    might: 5,
    hit: 90,
    crit: 0,
    weight: 5,
  };
  const unit = {
    inventory: [weapon],
    consumables: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    stats: { STR: 5 },
  };
  return { weapon, unit, run: { roster: [unit] } };
}
it('revalidates capacity and rank without awarding a blocked recipient', () => {
  const { weapon, unit, run } = fixture();
  expect(applyRewardTarget(run, { ...weapon, rankRequired: 'Mast' }, unit).ok).toBe(false);
  unit.inventory = Array(5).fill(weapon);
  expect(applyRewardTarget(run, weapon, unit).ok).toBe(false);
  expect(unit.inventory).toHaveLength(5);
  unit.inventory = [];
  expect(applyRewardTarget(run, weapon, unit).ok).toBe(true);
  expect(unit.inventory[0]).not.toBe(weapon);
  run.roster = [];
  expect(applyRewardTarget(run, weapon, unit).ok).toBe(false);
});
it('rejects stale forge ownership, invalid choices and capped stats', () => {
  const { weapon, unit, run } = fixture();
  const stone = { forgeStat: 'choice' };
  expect(applyRewardForge(run, {}, stone, unit, weapon, 'invalid').ok).toBe(false);
  expect(applyRewardForge(run, {}, stone, unit, weapon, 'might').ok).toBe(true);
  expect(weapon.might).toBe(6);
  unit.inventory = [];
  expect(applyRewardForge(run, {}, stone, unit, weapon, 'hit').ok).toBe(false);
});
it('resolves imbues from the catalog and refuses repeat imbuing', () => {
  const { weapon, unit, run } = fixture();
  const data = { imbues: [{ id: 'test', adjective: 'Blessed' }] };
  const stone = { type: 'Whetstone', imbueId: 'choice' };
  expect(applyRewardForge(run, data, stone, unit, weapon, 'missing').ok).toBe(false);
  expect(applyRewardForge(run, data, stone, unit, weapon, 'test').ok).toBe(true);
  expect(weapon.name).toBe('Blessed Iron Sword');
  expect(applyRewardForge(run, data, stone, unit, weapon, 'test').ok).toBe(false);
});

it.each(['weight', 'choice'])(
  'rejects a no-op %s reward without mutation and permits a different upgrade',
  (forgeStat) => {
    const { weapon, unit, run } = fixture();
    weapon.weight = 0;
    const before = JSON.stringify(run);
    const result = applyRewardForge(run, {}, { forgeStat }, unit, weapon, 'weight');
    expect(result).toEqual({ ok: false, reason: 'Already at minimum weight.' });
    expect(JSON.stringify(run)).toBe(before);
    expect(applyRewardForge(run, {}, { forgeStat: 'choice' }, unit, weapon, 'might').ok).toBe(true);
  },
);
