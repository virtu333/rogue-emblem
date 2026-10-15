// The move preview's red attack fringe (ThreatForecast.unitReach) must match what Attack lets a
// player unit initiate (AttackOptions.getAttackWeapons / getAttackRange): Foresight's tome range,
// Siegebreaker's reach, Silence and spent per-battle weapons. Counter reach is a separate query
// (Combat.canCounter) and Foresight gives none.
import { describe, expect, it } from 'vitest';
import { unitReach } from '../src/engine/ThreatForecast.js';
import { getAttackRange, getAttackWeapons } from '../src/engine/AttackOptions.js';
import { canCounter } from '../src/engine/Combat.js';
import { RANGED_REACH_FIELD } from '../src/engine/WeaponReach.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const skillsData = data.skills;
const catalogWeapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

const SIZE = 14;
const grid = {
  cols: SIZE,
  rows: SIZE,
  getMovementRange: () => new Map([['5,5', { cost: 0 }]]),
  getAttackRange(col, row, weapon) {
    const [min, max] = String(weapon.range).split('-').map(Number);
    const hi = Number.isFinite(max) ? max : min;
    const out = [];
    for (let c = 0; c < SIZE; c++)
      for (let r = 0; r < SIZE; r++) {
        const d = Math.abs(c - col) + Math.abs(r - row);
        if (d >= min && d <= hi) out.push({ col: c, row: r });
      }
    return out;
  },
};

function mage(weaponNames, { skills = [], extra = {} } = {}) {
  const inventory = weaponNames.map(catalogWeapon);
  const types = [...new Set(inventory.map((w) => w.type))];
  return {
    name: 'Mage',
    level: 5,
    tier: 'base',
    faction: 'player',
    col: 5,
    row: 5,
    xp: 0,
    currentHP: 30,
    stats: { HP: 30, STR: 3, MAG: 10, SKL: 8, SPD: 8, DEF: 3, RES: 7, LCK: 5, MOV: 5 },
    moveType: 'Infantry',
    className: 'Mage',
    growths: {},
    weaponRank: 'Mast',
    weapon: inventory[0],
    inventory,
    consumables: [],
    proficiencies: types.map((type) => ({ type, rank: 'Mast' })),
    skills,
    accessory: null,
    affixes: [],
    ...extra,
  };
}

const distances = (unit, options = { skillsData }) =>
  new Set(
    unitReach(grid, unit, { mov: 0, ...options }).attackTiles.map(
      (t) => Math.abs(t.col - 5) + Math.abs(t.row - 5),
    ),
  );

// Every distance Attack would let the unit strike from its tile, by the planning query.
const legalDistances = (unit) => {
  const legal = new Set();
  for (let d = 1; d <= 12; d++)
    if (
      getAttackWeapons(unit).some((w) => {
        const { min, max } = getAttackRange(unit, w, { skillsData });
        return d >= min && d <= max;
      })
    )
      legal.add(d);
  return legal;
};

const sorted = (set) => [...set].sort((a, b) => a - b);

describe('the attack fringe agrees with legal initiation range', () => {
  it('an ordinary tome reaches its printed range', () => {
    const unit = mage(['Fire']);
    expect(sorted(distances(unit))).toEqual([1, 2]);
    expect(distances(unit)).toEqual(legalDistances(unit));
  });

  it('Foresight adds a tile to the fringe (and only to a tome)', () => {
    const unit = mage(['Fire'], { skills: ['foresight'] });
    expect(sorted(distances(unit))).toEqual([1, 2, 3]);
    expect(distances(unit)).toEqual(legalDistances(unit));
    const bowman = mage(['Iron Bow'], { skills: ['foresight'] });
    expect(sorted(distances(bowman))).toEqual([2]);
  });

  it('Siegebreaker adds a tile, and with Foresight two', () => {
    const siege = mage(['Fire'], { extra: { [RANGED_REACH_FIELD]: 1 } });
    expect(sorted(distances(siege))).toEqual([1, 2, 3]);
    const both = mage(['Fire'], { skills: ['foresight'], extra: { [RANGED_REACH_FIELD]: 1 } });
    expect(sorted(distances(both))).toEqual([1, 2, 3, 4]);
    expect(distances(both)).toEqual(legalDistances(both));
  });

  it('without skill data the preview falls back to the printed range (and Siegebreaker)', () => {
    const unit = mage(['Fire'], { skills: ['foresight'] });
    expect(sorted(distances(unit, {}))).toEqual([1, 2]);
  });

  it('Silence removes a tome from the fringe but not a sword or bow', () => {
    const silenced = mage(['Fire'], {
      skills: ['foresight'],
      extra: { _conditions: [{ id: 'silence', turns: 2 }] },
    });
    expect(distances(silenced).size).toBe(0);
    expect(legalDistances(silenced).size).toBe(0);
    const mixed = mage(['Fire', 'Iron Bow'], {
      extra: { _conditions: [{ id: 'silence', turns: 2 }] },
    });
    expect(sorted(distances(mixed))).toEqual([2]);
    expect(distances(mixed)).toEqual(legalDistances(mixed));
  });

  it('a spent per-battle weapon no longer reaches; its bag mate does', () => {
    const fresh = mage(['Breachbolt', 'Fire']);
    expect(sorted(distances(fresh))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const spent = mage(['Breachbolt', 'Fire']);
    spent.weapon._usesSpent = 99;
    expect(sorted(distances(spent))).toEqual([1, 2]);
    expect(distances(spent)).toEqual(legalDistances(spent));
    const onlySpent = mage(['Breachbolt']);
    onlySpent.weapon._usesSpent = 99;
    expect(distances(onlySpent).size).toBe(0);
  });

  it('a foe keeps the printed range of its weapon (the AI reads no Foresight)', () => {
    const foe = mage(['Fire'], { skills: ['foresight'], extra: { faction: 'enemy' } });
    expect(sorted(distances(foe))).toEqual([1, 2]);
  });

  it('counter reach stays distinct: Foresight gives no extra counter distance', () => {
    const unit = mage(['Fire'], { skills: ['foresight'] });
    expect(distances(unit).has(3)).toBe(true);
    expect(canCounter(unit, unit.weapon, 3)).toBe(false);
    expect(canCounter(unit, unit.weapon, 2)).toBe(true);
  });
});
