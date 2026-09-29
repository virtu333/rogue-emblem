// Thorns (enemy affix): an adjacent hit on the unit sends 25% of the damage back to
// the striker, rounded down, and never takes the striker's last HP. Playtest
// 2026-09-29 #3: the reflect read damage that Shielded then cancelled when the affixes
// were rolled as ['thorns', 'shielded'], a 0 reflect still showed a Thorns chip, and
// the drain shown at full HP was the raw heal, not what was healed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { rollDefenseAffixes } from '../src/engine/AffixSystem.js';
import { forecastNotes, forecastProjection } from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const affixData = gameData.affixes;
const plain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };

afterEach(() => vi.restoreAllMocks());

const sword = (extra = {}) => ({
  name: 'Iron Sword',
  type: 'Sword',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
  ...extra,
});

function unit(extra = {}) {
  return {
    name: 'Unit',
    faction: 'player',
    className: 'Myrmidon',
    stats: { HP: 20, STR: 10, MAG: 10, SKL: 0, SPD: 5, DEF: 5, RES: 5, LCK: 0, MOV: 5 },
    currentHP: 20,
    skills: [],
    affixes: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    ...extra,
  };
}

const noMods = () => ({
  hitBonus: 0,
  avoidBonus: 0,
  critBonus: 0,
  atkBonus: 0,
  defBonus: 0,
  resBonus: 0,
  activated: [],
});
const ctx = () => ({
  atkMods: noMods(),
  defMods: noMods(),
  rollStrikeSkills: (s, dmg) => ({ modifiedDamage: dmg, activated: [] }),
  rollDefenseAffixes,
  affixData,
  skillsData: [],
});

function fight(attacker, atkWeapon, defender, defWeapon, distance = 1, random = 0.01) {
  vi.spyOn(Math, 'random').mockReturnValue(random);
  return resolveCombat(attacker, atkWeapon, defender, defWeapon, distance, plain, plain, ctx());
}
const strikesBy = (result, side) =>
  result.events.filter((e) => e.type === 'strike' && e.attackerSide === side);

describe('affix order: Shielded settles before Thorns and Teleporter react', () => {
  for (const affixes of [
    ['thorns', 'shielded'],
    ['shielded', 'thorns'],
  ]) {
    it(`${affixes.join(' + ')}: a shielded hit reflects nothing; the next reflects`, () => {
      const foe = unit({ affixes });
      const blocked = rollDefenseAffixes(foe, 10, true, true, affixData);
      expect(blocked.modifiedDamage).toBe(0);
      expect(blocked.reflectDamage).toBe(0);
      expect(blocked.activated.map((a) => a.id)).toEqual(['shielded']);
      const next = rollDefenseAffixes(foe, 10, true, false, affixData);
      // floor(10 × 25%) = 2
      expect(next).toMatchObject({ modifiedDamage: 10, reflectDamage: 2 });
      expect(next.activated.map((a) => a.id)).toEqual(['thorns']);
    });
  }

  for (const affixes of [
    ['teleporter', 'shielded'],
    ['shielded', 'teleporter'],
  ]) {
    it(`${affixes.join(' + ')}: a shielded hit does not warp or spend the warp`, () => {
      const foe = unit({ affixes });
      const blocked = rollDefenseAffixes(foe, 10, true, true, affixData);
      expect(blocked.warpRange).toBe(0);
      expect(foe._teleportUsedThisCombat).toBeFalsy();
      expect(rollDefenseAffixes(foe, 10, true, false, affixData).warpRange).toBe(3);
    });
  }
});

describe('what Thorns reflects', () => {
  it('rounds down: a 3-damage hit reflects nothing and shows no Thorns proc; 4 reflects 1', () => {
    const foe = unit({ affixes: ['thorns'] });
    const three = rollDefenseAffixes(foe, 3, true, false, affixData);
    expect(three.reflectDamage).toBe(0);
    expect(three.activated).toEqual([]);
    const four = rollDefenseAffixes(foe, 4, true, false, affixData);
    expect(four.reflectDamage).toBe(1);
    expect(four.activated.map((a) => a.id)).toEqual(['thorns']);
  });

  it('counts a critical hit and overkill in full', () => {
    // 10 + 5 − 5 = 10, ×3 crit = 30 against a 20-HP foe: floor(30 × 25%) = 7.
    const attacker = unit({ name: 'A' });
    const foe = unit({ name: 'F', faction: 'enemy', affixes: ['thorns'] });
    const result = fight(attacker, sword({ crit: 100 }), foe, null);
    const [hit] = strikesBy(result, 'attacker');
    expect([hit.damage, hit.isCrit, hit.reflectDamage, hit.reflectTaken]).toEqual([30, true, 7, 7]);
    expect(result.attackerHP).toBe(13);
  });

  it('never takes the last HP, and shows only what was lost', () => {
    const atTwo = fight(
      unit({ currentHP: 2 }),
      sword(),
      unit({ faction: 'enemy', affixes: ['thorns'] }),
      null,
    );
    const [first] = strikesBy(atTwo, 'attacker');
    expect([first.reflectDamage, first.strikerHPAfter, first.reflectTaken]).toEqual([2, 1, 1]);
    expect(atTwo.attackerHP).toBe(1);

    const atOne = fight(
      unit({ currentHP: 1 }),
      sword(),
      unit({ faction: 'enemy', affixes: ['thorns'] }),
      null,
    );
    const [hit] = strikesBy(atOne, 'attacker');
    expect([hit.strikerHPAfter, hit.reflectTaken]).toEqual([1, 0]);
    expect(hit.skillActivations.some((a) => a.id === 'thorns')).toBe(false);
    expect(atOne.attackerHP).toBe(1);
  });

  it('hits the player’s counter too', () => {
    // The Thorns foe attacks; the player's sword counter deals 10 and takes 2 back.
    const foe = unit({ name: 'F', faction: 'enemy', affixes: ['thorns'] });
    const player = unit({ name: 'P' });
    const result = fight(foe, sword({ might: 0 }), player, sword());
    const [counter] = strikesBy(result, 'defender');
    expect([counter.damage, counter.reflectDamage]).toEqual([10, 2]);
    // Foe hits for 10 − 5 = 5 → 15; the counter's reflect → 13.
    expect(result.defenderHP).toBe(13);
  });

  it('"melee" means adjacent: a tome at 1 is reflected, at 2 it is not', () => {
    const fire = {
      name: 'Fire',
      type: 'Tome',
      might: 5,
      hit: 100,
      crit: 0,
      weight: 0,
      range: '1-2',
    };
    const mage = () => unit({ proficiencies: [{ type: 'Tome', rank: 'Prof' }] });
    const foe = () => unit({ faction: 'enemy', affixes: ['thorns'] });
    // 10 + 5 − 5 RES = 10 → 2 back at range 1, nothing at range 2.
    expect(strikesBy(fight(mage(), fire, foe(), null, 1), 'attacker')[0].reflectDamage).toBe(2);
    expect(strikesBy(fight(mage(), fire, foe(), null, 2), 'attacker')[0].reflectDamage).toBe(0);
  });
});

describe('drain shows what it healed', () => {
  const drainSword = sword({ name: 'Drain Sword', special: 'Drains HP' });
  it('at full HP it heals nothing', () => {
    const result = fight(unit(), drainSword, unit({ faction: 'enemy' }), null);
    const [hit] = strikesBy(result, 'attacker');
    expect([hit.strikerHealTo, hit.healed]).toEqual([20, 0]);
  });
  it('at 15/20 a 10-damage drain heals 5', () => {
    const result = fight(unit({ currentHP: 15 }), drainSword, unit({ faction: 'enemy' }), null);
    const [hit] = strikesBy(result, 'attacker');
    expect([hit.heal, hit.strikerHealTo, hit.healed]).toEqual([10, 20, 5]);
  });
});

describe('the forecast includes Thorns', () => {
  it('projects the reflect and says so', () => {
    // Player 20 HP doubles (SPD 15 vs 5): two hits of 10 on a 30-HP Thorns foe, 2 back
    // each; the foe's counter hits 10 − 5 = 5. 20 − 2 − 5 − 2 = 11; foe 30 − 20 = 10.
    const attacker = unit({ name: 'A', stats: { ...unit().stats, SPD: 15 } });
    const foe = unit({
      name: 'F',
      faction: 'enemy',
      affixes: ['thorns'],
      stats: { ...unit().stats, HP: 30 },
      currentHP: 30,
    });
    const f = getCombatForecast(
      attacker,
      sword(),
      foe,
      sword({ might: 0 }),
      1,
      plain,
      plain,
      ctx(),
    );
    expect(f.attacker.thornsReflect).toBe(2);
    expect(forecastProjection(f)).toEqual({ attackerHP: 11, defenderHP: 10 });
    expect(forecastNotes(f, true, 20)).toContain(
      'Thorns: −2 HP per hit landed (leaves at least 1)',
    );
    const resolved = fight(attacker, sword(), foe, sword({ might: 0 }));
    expect([resolved.attackerHP, resolved.defenderHP]).toEqual([11, 10]);
  });

  it('stays hidden when the context cannot resolve affixes', () => {
    const foe = unit({ faction: 'enemy', affixes: ['thorns'] });
    const bare = { atkMods: noMods(), defMods: noMods() };
    const f = getCombatForecast(unit(), sword(), foe, null, 1, plain, plain, bare);
    expect(forecastProjection(f)).toBeNull();
  });
});
