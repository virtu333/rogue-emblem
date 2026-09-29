// UnitHealth: every HP change settles HP accessory debt by itself, so the outcome
// never depends on whether (or how often) an HP bar is drawn. Expected values are
// worked by hand from the rule: the debt is forgiven when the unit stands at full HP
// or is down, and otherwise stays until an HP bonus pays it back.
import { describe, it, expect } from 'vitest';
import {
  applyCombatHP,
  damageUnit,
  healUnit,
  healUnitFully,
  setUnitHP,
  settleAccessoryHpOwed,
} from '../src/engine/UnitHealth.js';

/** A 20-max-HP unit at `hp` that owes 5 HP (took a +5 HP accessory off at 1 HP). */
const debtor = (hp) => ({ name: 'Mage', stats: { HP: 20 }, currentHP: hp, _accessoryHpOwed: 5 });

describe('healUnit / damageUnit / setUnitHP', () => {
  it('heals up to max and reports what it restored', () => {
    const u = debtor(12);
    expect(healUnit(u, 5)).toBe(5);
    expect(u.currentHP).toBe(17);
    expect(u._accessoryHpOwed).toBe(5); // not full: the debt stands
    expect(healUnit(u, 10)).toBe(3);
    expect(u.currentHP).toBe(20);
    expect(u._accessoryHpOwed).toBeUndefined(); // full: forgiven
  });

  it('never lowers HP when healing a unit already above max', () => {
    const u = { stats: { HP: 20 }, currentHP: 22 };
    expect(healUnit(u, 5)).toBe(0);
    expect(u.currentHP).toBe(22);
  });

  it('heals fully', () => {
    const u = debtor(3);
    expect(healUnitFully(u)).toBe(17);
    expect([u.currentHP, u._accessoryHpOwed]).toEqual([20, undefined]);
  });

  it('damages down to its floor and reports what it took', () => {
    const u = debtor(10);
    expect(damageUnit(u, 4)).toBe(4);
    expect(u.currentHP).toBe(6);
    expect(u._accessoryHpOwed).toBe(5);
    expect(damageUnit(u, 50, { floor: 1 })).toBe(5);
    expect(u.currentHP).toBe(1);
    expect(damageUnit(u, 3, { floor: 1 })).toBe(0); // at the floor already
    expect(damageUnit(u, 50)).toBe(1);
    expect([u.currentHP, u._accessoryHpOwed]).toEqual([0, undefined]); // down: forgiven
  });

  it('setUnitHP writes what the caller computed and settles', () => {
    const u = debtor(4);
    expect(setUnitHP(u, 9)).toEqual({ prev: 4, hp: 9, delta: 5 });
    expect(u._accessoryHpOwed).toBe(5);
    setUnitHP(u, 20);
    expect(u._accessoryHpOwed).toBeUndefined();
  });

  it('settling is idempotent', () => {
    const u = debtor(10);
    for (let i = 0; i < 5; i++) settleAccessoryHpOwed(u);
    expect(u._accessoryHpOwed).toBe(5);
  });
});

describe('applyCombatHP', () => {
  const strike = (side, fields) => ({ type: 'strike', attackerSide: side, miss: false, ...fields });

  it('settles a side that stood at full HP mid-combat, though it ends hurt', () => {
    // Attacker 16/20 drains 4 back to 20/20, then the counter leaves it at 13.
    const a = debtor(16);
    const d = { stats: { HP: 40 }, currentHP: 40 };
    applyCombatHP(a, d, {
      events: [
        strike('attacker', { targetHPAfter: 30, heal: 4, strikerHealTo: 20 }),
        strike('defender', { targetHPAfter: 13 }),
      ],
      attackerHP: 13,
      defenderHP: 30,
    });
    expect([a.currentHP, d.currentHP]).toEqual([13, 30]);
    expect(a._accessoryHpOwed).toBeUndefined();
  });

  it('keeps the debt when the side never reached full HP', () => {
    const a = debtor(12);
    const d = { stats: { HP: 40 }, currentHP: 40 };
    applyCombatHP(a, d, {
      events: [
        strike('attacker', { targetHPAfter: 30, heal: 3, strikerHealTo: 15 }),
        strike('defender', { targetHPAfter: 8 }),
      ],
      attackerHP: 8,
      defenderHP: 30,
    });
    expect([a.currentHP, a._accessoryHpOwed]).toEqual([8, 5]);
  });

  it('settles the defender side from its own peaks, and reads reflected HP', () => {
    const a = { stats: { HP: 30 }, currentHP: 30 };
    const d = debtor(18);
    applyCombatHP(a, d, {
      events: [
        strike('attacker', { targetHPAfter: 14 }),
        strike('defender', { targetHPAfter: 26, heal: 6, strikerHealTo: 20, strikerHPAfter: 19 }),
      ],
      attackerHP: 26,
      defenderHP: 19,
    });
    expect([d.currentHP, d._accessoryHpOwed]).toEqual([19, undefined]);
  });

  it('ignores misses and skill events', () => {
    const a = debtor(12);
    const d = { stats: { HP: 40 }, currentHP: 40 };
    applyCombatHP(a, d, {
      events: [
        { type: 'skill', targetHPAfter: 20 },
        { type: 'strike', attackerSide: 'defender', miss: true, targetHPAfter: 12 },
      ],
      attackerHP: 12,
      defenderHP: 40,
    });
    expect(a._accessoryHpOwed).toBe(5);
  });
});
