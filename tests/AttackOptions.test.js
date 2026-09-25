import { describe, expect, it, vi } from 'vitest';
import {
  canAttackWithWeapon,
  getAttackWeapons,
  getAttackRange,
  weaponsForDistance,
  pickDefaultAttackWeapon,
  planAttackTargets,
  orderAttackTargets,
  stepTarget,
} from '../src/engine/AttackOptions.js';
import { gridDistance } from '../src/engine/Combat.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const w = (name, extra = {}) => ({
  ...structuredClone(data.weapons.find((x) => x.name === name)),
  ...extra,
});

function unit(inventory, extra = {}) {
  return {
    name: 'Hero',
    faction: 'player',
    col: 5,
    row: 5,
    skills: [],
    stats: { HP: 20, STR: 8, MAG: 8, SKL: 8, SPD: 8, DEF: 4, RES: 3, LCK: 5, MOV: 5 },
    currentHP: 20,
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Bow', rank: 'Prof' },
      { type: 'Tome', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ],
    inventory,
    weapon: inventory[0] || null,
    ...extra,
  };
}
const enemy = (name, col, row) => ({ name, col, row, faction: 'enemy', currentHP: 10 });
const distanceFrom = (u) => (t) => gridDistance(u.col, u.row, t.col, t.row);

describe('AttackOptions — usable weapons', () => {
  it('keeps proficient combat weapons, equipped first, and drops staves/scrolls/non-proficient', () => {
    const sword = w('Iron Sword');
    const bow = w('Iron Bow');
    const heal = w('Heal');
    const lance = w('Iron Lance');
    const u = unit([heal, bow, lance, sword], { weapon: sword });
    expect(getAttackWeapons(u)).toEqual([sword, bow]);
    expect(canAttackWithWeapon(u, heal)).toBe(false);
    expect(canAttackWithWeapon(u, lance)).toBe(false);
  });

  it('silence removes magic; an exhausted per-battle weapon cannot attack', () => {
    const sword = w('Iron Sword');
    const fire = w('Fire');
    const bolting = w('Bolting');
    const u = unit([fire, sword, bolting], {
      proficiencies: [
        { type: 'Sword', rank: 'Prof' },
        { type: 'Tome', rank: 'Mast' },
      ],
    });
    expect(getAttackWeapons(u)).toEqual([fire, sword, bolting]);
    bolting._usesSpent = 99;
    expect(getAttackWeapons(u)).toEqual([fire, sword]);
    applyCondition(u, 'silence', 3);
    expect(getAttackWeapons(u)).toEqual([sword]);
  });

  it('`equipped` overrides which weapon leads (the pre-preview weapon)', () => {
    const sword = w('Iron Sword');
    const steel = w('Steel Sword');
    const u = unit([sword, steel]);
    expect(getAttackWeapons(u, { equipped: steel })).toEqual([steel, sword]);
  });
});

describe('AttackOptions — range', () => {
  it('matches weapon range, Foresight tome bonus and weapon-art overrides', () => {
    const fire = w('Fire');
    const u = unit([fire]);
    expect(getAttackRange(u, fire)).toEqual({ min: 1, max: 2 });
    u.skills = ['foresight'];
    expect(getAttackRange(u, fire, { skillsData: data.skills }).max).toBeGreaterThanOrEqual(3);
    u.skills = [];
    const override = { combatMods: { rangeOverride: { min: 2, max: 3 } } };
    expect(getAttackRange(u, fire, { weaponArt: override })).toEqual({ min: 2, max: 3 });
    const bonus = { combatMods: { rangeBonus: 2 } };
    expect(getAttackRange(u, fire, { weaponArt: bonus })).toEqual({ min: 1, max: 4 });
  });

  it('weaponsForDistance keeps order and filters by reach', () => {
    const sword = w('Iron Sword');
    const bow = w('Iron Bow');
    const hand = w('Hand Axe');
    const u = unit([sword, bow, hand], {
      proficiencies: [
        { type: 'Sword', rank: 'Prof' },
        { type: 'Bow', rank: 'Prof' },
        { type: 'Axe', rank: 'Prof' },
      ],
    });
    expect(weaponsForDistance(u, [sword, bow, hand], 1)).toEqual([sword, hand]);
    expect(weaponsForDistance(u, [sword, bow, hand], 2)).toEqual([bow, hand]);
  });
});

describe('AttackOptions — default weapon (FE rule)', () => {
  it('uses the equipped weapon when it can hit the target', () => {
    const sword = w('Iron Sword');
    const steel = w('Steel Sword');
    const u = unit([steel, sword], { weapon: steel });
    expect(pickDefaultAttackWeapon(u, 1)).toBe(steel);
  });

  it('otherwise the first weapon in inventory order that can', () => {
    const sword = w('Iron Sword');
    const bow = w('Iron Bow');
    const longbow = w('Longbow');
    const u = unit([sword, longbow, bow], { weapon: sword });
    // Distance 2: sword cannot reach; Longbow (2-3) precedes Iron Bow (2).
    expect(pickDefaultAttackWeapon(u, 2)).toBe(longbow);
    expect(pickDefaultAttackWeapon(u, 3)).toBe(longbow);
    expect(pickDefaultAttackWeapon(u, 4)).toBeNull();
  });

  it('a staff-equipped hybrid defaults to its first combat weapon', () => {
    const heal = w('Heal');
    const fire = w('Fire');
    const u = unit([heal, fire], { weapon: heal });
    expect(pickDefaultAttackWeapon(u, 1)).toBe(fire);
  });

  it('never mutates the unit and never draws RNG', () => {
    const sword = w('Iron Sword');
    const bow = w('Iron Bow');
    const u = unit([sword, bow]);
    const before = JSON.stringify(u);
    const random = vi.spyOn(Math, 'random');
    try {
      pickDefaultAttackWeapon(u, 2);
      planAttackTargets(u, [enemy('E', 5, 7)], { distanceTo: distanceFrom(u) });
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
    expect(JSON.stringify(u)).toBe(before);
  });
});

describe('AttackOptions — target union', () => {
  it('includes every enemy any usable weapon reaches, with the weapons per target', () => {
    const sword = w('Iron Sword');
    const bow = w('Iron Bow');
    const u = unit([sword, bow]);
    const near = enemy('Near', 6, 5);
    const far = enemy('Far', 5, 7);
    const tooFar = enemy('TooFar', 9, 9);
    const hidden = enemy('Hidden', 4, 5);
    const plan = planAttackTargets(u, [near, far, tooFar, hidden], {
      distanceTo: distanceFrom(u),
      isTargetable: (t) => t !== hidden,
    });
    expect(plan.map((p) => p.target.name)).toEqual(['Near', 'Far']);
    expect(plan[0].weapons).toEqual([sword]);
    expect(plan[1].weapons).toEqual([bow]);
  });

  it('is empty without a usable weapon', () => {
    const u = unit([w('Heal')]);
    expect(planAttackTargets(u, [enemy('E', 6, 5)], { distanceTo: distanceFrom(u) })).toEqual([]);
  });

  it('orders targets nearest-first then reading order, and steps with wrap', () => {
    const u = unit([w('Iron Bow')]);
    const a = enemy('A', 5, 7);
    const b = enemy('B', 7, 5);
    const c = enemy('C', 6, 5);
    const ordered = orderAttackTargets(u, [a, b, c], distanceFrom(u));
    expect(ordered.map((t) => t.name)).toEqual(['C', 'B', 'A']);
    expect(stepTarget(ordered, c, 1)).toBe(b);
    expect(stepTarget(ordered, a, 1)).toBe(c);
    expect(stepTarget(ordered, c, -1)).toBe(a);
    expect(stepTarget(ordered, null, 1)).toBe(c);
    expect(stepTarget(ordered, null, -1)).toBe(a);
    expect(stepTarget([], null, 1)).toBeNull();
  });
});
