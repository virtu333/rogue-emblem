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
  chooseAttackTile,
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

describe('AttackOptions — chooseAttackTile (move-then-attack from a selection)', () => {
  // A 5-wide open row of tiles around the unit at (5,5); cost = walking distance.
  const range = (u, mov = 3) => {
    const map = new Map();
    for (let col = u.col - mov; col <= u.col + mov; col++)
      for (let row = u.row - mov; row <= u.row + mov; row++) {
        const cost = Math.abs(col - u.col) + Math.abs(row - u.row);
        if (cost <= mov) map.set(`${col},${row}`, { cost });
      }
    return map;
  };
  const opts = (target, extra = {}) => ({
    distanceFrom: (col, row) => gridDistance(col, row, target.col, target.row),
    ...extra,
  });

  it('stays put when the unit already reaches the target', () => {
    const u = unit([w('Iron Sword')]);
    const foe = enemy('Fighter', 6, 5);
    expect(chooseAttackTile(u, foe, range(u), opts(foe))).toEqual({ col: 5, row: 5, cost: 0 });
  });

  it('otherwise picks the closest tile, then the equipped weapon, terrain and reading order', () => {
    const sword = w('Iron Sword');
    const u = unit([sword, w('Iron Bow')]);
    const foe = enemy('Fighter', 8, 5);
    // Cost 1 at (6,5) reaches with the bow only; cost 2 at (7,5) with the sword.
    expect(chooseAttackTile(u, foe, range(u), opts(foe))).toEqual({ col: 6, row: 5, cost: 1 });
    // Only the sword: the adjacent tiles at cost 2 — (7,5) — and reading order among ties.
    const swordOnly = unit([sword]);
    expect(chooseAttackTile(swordOnly, foe, range(swordOnly), opts(foe))).toEqual({
      col: 7,
      row: 5,
      cost: 2,
    });
    // Better terrain wins a cost tie.
    const foe2 = enemy('Fighter', 7, 7);
    // (6,7) and (7,6) both cost 3: reading order picks (7,6), a forest at (6,7) wins.
    expect(chooseAttackTile(swordOnly, foe2, range(swordOnly), opts(foe2))).toEqual({
      col: 7,
      row: 6,
      cost: 3,
    });
    const forest = (col, row) => (col === 6 && row === 7 ? 21 : 0);
    expect(
      chooseAttackTile(swordOnly, foe2, range(swordOnly), opts(foe2, { terrainScore: forest })),
    ).toEqual({ col: 6, row: 7, cost: 3 });
  });

  it('prefers a tile the equipped weapon reaches when costs tie', () => {
    const sword = w('Iron Sword');
    const bow = w('Iron Bow');
    const u = unit([sword, bow], { weapon: sword });
    const foe = enemy('Fighter', 9, 5);
    // Two cost-2 tiles: (7,5) bow only (distance 2), (8,5) sword (adjacent). Reading
    // order alone would pick (7,5); the equipped sword's tile wins.
    const map = new Map([
      ['7,5', { cost: 2 }],
      ['8,5', { cost: 2 }],
    ]);
    expect(chooseAttackTile(u, foe, map, opts(foe))).toEqual({ col: 8, row: 5, cost: 2 });
    // With the bow equipped the bow tile wins instead.
    const archer = unit([bow, sword], { weapon: bow });
    expect(chooseAttackTile(archer, foe, map, opts(foe))).toEqual({ col: 7, row: 5, cost: 2 });
  });

  it('skips occupied and pass-through tiles, and returns null when nothing reaches', () => {
    const u = unit([w('Iron Sword')]);
    const foe = enemy('Fighter', 7, 5);
    const map = range(u);
    map.set('6,5', { cost: 1, stoppable: false });
    const blocked = (col, row) => !(col === 7 && row === 4);
    const tile = chooseAttackTile(u, foe, map, opts(foe, { isFree: blocked }));
    // (6,5) is pass-through only and (7,4) is occupied: (8,5) and (7,6) remain.
    expect(tile).toEqual({ col: 8, row: 5, cost: 3 });
    const far = enemy('Fighter', 15, 15);
    expect(chooseAttackTile(u, far, range(u), opts(far))).toBeNull();
    const staffOnly = unit([w('Heal')]);
    expect(chooseAttackTile(staffOnly, foe, range(staffOnly), opts(foe))).toBeNull();
  });
});
