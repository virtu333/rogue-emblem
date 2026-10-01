// strikeDamage: one strike's damage before crits, procs and multi-hit. The forecast and
// resolveCombat both read it, and area blows (AoE weapon arts) will. Expected numbers are
// worked by hand from the formula in CLAUDE.md and the catalog stats quoted inline.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  getCombatForecast,
  mergeCombatMods,
  resolveCombat,
  strikeDamage,
} from '../src/engine/Combat.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);
const forest = data.terrain.find((t) => t.name === 'Forest'); // DEF +1

const unit = (name, stats, extra = {}) => ({
  name,
  faction: extra.faction || 'player',
  col: 0,
  row: 0,
  level: 5,
  currentHP: stats.HP,
  stats: { HP: 30, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  weaponRank: 'Prof',
  moveType: 'Infantry',
  ...extra,
});

describe('strikeDamage', () => {
  it('physical: STR + might + triangle − DEF − terrain', () => {
    const swordsman = unit('A', { STR: 12 });
    const fighter = unit('B', { DEF: 4 }, { faction: 'enemy' });
    // Iron Sword 5 might; sword beats axe: +1 damage. 12 + 5 + 1 − 4 = 14.
    expect(strikeDamage(swordsman, weapon('Iron Sword'), fighter, weapon('Iron Axe'), null)).toBe(
      14,
    );
    // On a forest (DEF +1): 13. Against a lance (disadvantage −1) on plains: 12.
    expect(strikeDamage(swordsman, weapon('Iron Sword'), fighter, weapon('Iron Axe'), forest)).toBe(
      13,
    );
    expect(strikeDamage(swordsman, weapon('Iron Sword'), fighter, weapon('Iron Lance'), null)).toBe(
      12,
    );
  });

  it("magic reads RES, and a defender's weapon stat bonus counts", () => {
    const mage = unit('M', { MAG: 10 });
    const knight = unit('K', { DEF: 20, RES: 3 }, { faction: 'enemy' });
    // Fire 4 might: 10 + 4 − RES 3 = 11 (DEF 20 never enters).
    expect(strikeDamage(mage, weapon('Fire'), knight, null, null)).toBe(11);
    // Tidebreaker gives its wielder +5 DEF. Iron Sword against that axe (+1 triangle):
    // 12 + 5 + 1 − (4 + 5) = 9.
    const brute = unit('T', { DEF: 4 }, { faction: 'enemy' });
    expect(
      strikeDamage(unit('A', { STR: 12 }), weapon('Iron Sword'), brute, weapon('Tidebreaker')),
    ).toBe(9);
  });

  it('art mods and effectiveness, with an optional lower effectiveness cap', () => {
    const sage = unit('S', { MAG: 20 });
    const pegasus = unit('P', { RES: 5 }, { faction: 'enemy', moveType: 'Flying' });
    const tempest = mergeCombatMods(null, art('legend_tempest').combatMods);
    // Firstwind 12 might, 3× vs fliers; Tempest adds 3× vs flying and +5 Attack.
    // Combined 9× caps at 5×: 20 + 60 + 5 − 5 = 80. Area cap 3×: 20 + 36 + 5 − 5 = 56.
    expect(strikeDamage(sage, weapon('Firstwind'), pegasus, null, null, tempest)).toBe(80);
    expect(
      strikeDamage(sage, weapon('Firstwind'), pegasus, null, null, tempest, null, {
        effectivenessCap: 3,
      }),
    ).toBe(56);
    // A foot soldier is not effective-against: 20 + 12 + 5 − 5 = 32 either way.
    const footman = unit('F', { RES: 5 }, { faction: 'enemy' });
    expect(strikeDamage(sage, weapon('Firstwind'), footman, null, null, tempest)).toBe(32);
  });

  it('is what the forecast shows and what resolveCombat deals on a plain hit', () => {
    const swordsman = unit('A', { STR: 12, SKL: 30, SPD: 5, LCK: 0 });
    const fighter = unit('B', { DEF: 4, SPD: 5, LCK: 30 }, { faction: 'enemy' });
    const sword = weapon('Iron Sword');
    const axe = weapon('Iron Axe');
    const forecast = getCombatForecast(swordsman, sword, fighter, axe, 1, null, null);
    expect(forecast.attacker.damage).toBe(14);
    // LCK 30 leaves no crit (SKL/2 = 15 < 30); SKL 30 makes the hit certain.
    const prev = Math.random;
    Math.random = () => 0.01;
    try {
      const result = resolveCombat(swordsman, sword, fighter, axe, 1, null, null);
      const first = result.events.find((e) => e.type === 'strike' && e.attackerSide !== 'defender');
      expect(first).toMatchObject({ miss: false, isCrit: false, damage: 14 });
    } finally {
      Math.random = prev;
    }
  });
});
