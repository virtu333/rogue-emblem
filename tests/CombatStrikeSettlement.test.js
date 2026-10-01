import { describe, expect, it, vi } from 'vitest';
import { applyStrikeHP } from '../src/engine/UnitHealth.js';
import { settleTeleporterWarp } from '../src/engine/AffixSystem.js';

describe('strike settlement before rendering', () => {
  it('forgives drain debt at full HP before Thorns wounds the striker again', () => {
    const striker = { currentHP: 16, stats: { HP: 20 }, _accessoryHpOwed: 5 };
    const target = { currentHP: 12, stats: { HP: 12 }, _accessoryHpOwed: 3 };
    applyStrikeHP(striker, target, {
      type: 'strike',
      targetHPAfter: 0,
      heal: 4,
      strikerHealTo: 20,
      reflectDamage: 3,
      strikerHPAfter: 17,
    });
    expect([striker.currentHP, target.currentHP]).toEqual([17, 0]);
    expect(striker._accessoryHpOwed).toBeUndefined();
    expect(target._accessoryHpOwed).toBeUndefined();
  });

  it('misses and skill banners leave HP and debt untouched', () => {
    const striker = { currentHP: 4, stats: { HP: 20 }, _accessoryHpOwed: 5 };
    const target = { currentHP: 12, stats: { HP: 12 } };
    for (const event of [null, { type: 'skill' }, { type: 'strike', miss: true, targetHPAfter: 0 }])
      applyStrikeHP(striker, target, event);
    expect(striker).toEqual({ currentHP: 4, stats: { HP: 20 }, _accessoryHpOwed: 5 });
    expect(target.currentHP).toBe(12);
  });
});

describe('Teleporter settlement without graphics', () => {
  const grid = { cols: 5, rows: 5, getMoveCost: () => 1 };
  const attacker = { col: 1, row: 2 };

  it('moves a sprite-less unit to a farthest legal tile with exactly one draw', () => {
    const unit = { col: 2, row: 2, moveType: 'Infantry', hpBar: null };
    const random = vi.fn(() => 0.99);
    const result = settleTeleporterWarp({
      unit,
      range: 1,
      attacker,
      grid,
      getUnitAt: () => null,
      random,
    });
    expect(random).toHaveBeenCalledTimes(1);
    expect(result.from).toEqual({ col: 2, row: 2 });
    expect(result.to).toEqual({ col: 2, row: 3 });
    expect([unit.col, unit.row]).toEqual([2, 3]);
  });

  it('does not advance RNG or move when every destination is blocked', () => {
    const unit = { col: 2, row: 2, moveType: 'Infantry' };
    const random = vi.fn(() => 0.5);
    expect(
      settleTeleporterWarp({
        unit,
        range: 1,
        attacker,
        grid,
        getUnitAt: () => ({ currentHP: 10 }),
        random,
      }),
    ).toBeNull();
    expect(random).not.toHaveBeenCalled();
    expect([unit.col, unit.row]).toEqual([2, 2]);
  });
});
