// Keen Eye (steady_hands, docs/specs/blessings-v3.md §4): +10 Hit on the first strike of every
// combat a unit starts. The bonus rides `atkMods.firstStrikeHitBonus`; Combat.resolveCombat
// spends it on the attacker's first rolled strike and every other strike rolls at plain Hit.
//
// Numbers (worked by hand): the attacker's Test Blade has 70 Hit, SKL 5 (+10), LCK 5, against a
// foe with SPD 10 (avoid 20) and LCK 5: 70 + 10 + 5 - 25 = 60 Hit. With Keen Eye the first
// strike is 70. A hit roll is the average of two draws (HitRoll.rollHit), so a constant
// Math.random of 0.65 averages 65: it lands at 70 and misses at 60.
import { afterEach, describe, expect, it } from 'vitest';
import {
  combatStrikeMods,
  forecastStrikeGroups,
  getCombatForecast,
  mergeCombatMods,
  resolveCombat,
} from '../src/engine/Combat.js';
import { forecastNotes, forecastProjection, formatSideHit } from '../src/ui/forecastDisplay.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

const blade = (extra = {}) => ({
  name: 'Test Blade',
  type: 'Sword',
  might: 3,
  hit: 70,
  crit: 0,
  weight: 1,
  range: '1',
  special: '',
  ...extra,
});

function unit(name, faction, { spd = 10, weapon = blade(), extra = {} } = {}) {
  return {
    name,
    faction,
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    stats: { HP: 100, STR: 8, MAG: 0, SKL: 5, SPD: spd, DEF: 5, RES: 3, LCK: 5, MOV: 5 },
    currentHP: 100,
    weapon,
    inventory: [weapon],
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Tome', rank: 'Prof' },
    ],
    skills: [],
    moveType: 'Infantry',
    col: faction === 'player' ? 0 : 1,
    row: 0,
    ...extra,
  };
}

const KEEN = { firstStrikeHitBonus: 10 };

function combat({
  attacker = unit('Attacker', 'player'),
  defender = unit('Defender', 'enemy'),
  atkMods = { ...KEEN },
  defMods = {},
  extraCtx = {},
} = {}) {
  const skillCtx = { atkMods, defMods, ...extraCtx };
  return { attacker, defender, skillCtx };
}

function resolveAt(percent, setup) {
  const { attacker, defender, skillCtx } = combat(setup);
  Math.random = () => percent / 100;
  return resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    1,
    null,
    null,
    skillCtx,
  );
}

const strikesBy = (result, side) =>
  result.events.filter((e) => e.type === 'strike' && e.attackerSide === side);

describe('Keen Eye in the forecast', () => {
  it('shows the first strike at 70 and every later strike at 60', () => {
    const { attacker, defender, skillCtx } = combat();
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    expect(forecast.attacker.hit).toBe(60);
    expect(forecast.attacker.firstHit).toBe(70);
  });

  it('never reports a first-strike chance on the defender (counters get nothing)', () => {
    const { attacker, defender, skillCtx } = combat({ defMods: { firstStrikeHitBonus: 30 } });
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    expect(forecast.defender.firstHit).toBeUndefined();
  });

  it('puts firstHit on strike group 0 only, so a doubled attacker lists 70 then 60', () => {
    const { attacker, defender, skillCtx } = combat({
      attacker: unit('Attacker', 'player', { spd: 20 }),
    });
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    expect(forecast.attacker.doubles).toBe(true);
    const groups = forecastStrikeGroups(forecast.attacker);
    expect(groups.map((g) => g.firstHit ?? null)).toEqual([70, null]);
    expect(groups.map((g) => g.hit)).toEqual([60, 60]);
  });

  it('clamps the first strike at 100 while the base Hit stays below it', () => {
    const { attacker, defender, skillCtx } = combat({
      attacker: unit('Attacker', 'player', { weapon: blade({ hit: 105 }) }),
    });
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    expect(forecast.attacker.hit).toBe(95);
    expect(forecast.attacker.firstHit).toBe(100);
  });

  it('reads 0 for the first strike of a silenced mage that cannot initiate', () => {
    const tome = {
      name: 'Test Tome',
      type: 'Tome',
      might: 4,
      hit: 90,
      crit: 0,
      weight: 1,
      range: '1-2',
      special: '',
    };
    const mage = unit('Attacker', 'player', { weapon: tome });
    applyCondition(mage, 'silence', 2);
    const defender = unit('Defender', 'enemy');
    const forecast = getCombatForecast(mage, tome, defender, defender.weapon, 1, null, null, {
      atkMods: { ...KEEN },
      defMods: {},
    });
    expect(forecast.attacker.hit).toBe(0);
    expect(forecast.attacker.firstHit).toBe(0);
  });

  it('keeps firstStrikeHitBonus through the art and imbue merge that every forecast runs', () => {
    const imbued = blade({ _imbueId: 'vampiric' });
    const merged = combatStrikeMods(
      {
        atkMods: { hitBonus: 2, ...KEEN },
        atkWeaponArtMods: { hitBonus: 5, weaponArt: true },
        imbuesData: data.imbues,
      },
      imbued,
    );
    expect(merged.firstStrikeHitBonus).toBe(10);
    expect(merged.hitBonus).toBe(7);
    expect(mergeCombatMods({ firstStrikeHitBonus: 4 }, { firstStrikeHitBonus: 6 })).toMatchObject({
      firstStrikeHitBonus: 10,
    });
  });
});

describe('Keen Eye in a resolved combat', () => {
  it('lands the first strike at 65 (70 with Keen Eye) and tags it', () => {
    const result = resolveAt(65);
    const [first] = strikesBy(result, 'attacker');
    expect(first.miss).toBe(false);
    expect(first.firstStrikeBonus).toBe(true);
  });

  it('misses that same roll without Keen Eye', () => {
    const result = resolveAt(65, { atkMods: {} });
    const [first] = strikesBy(result, 'attacker');
    expect(first.miss).toBe(true);
    expect(first.firstStrikeBonus).toBeUndefined();
  });

  it('rolls a doubled follow-up at base Hit: first lands, second misses', () => {
    const result = resolveAt(65, { attacker: unit('Attacker', 'player', { spd: 20 }) });
    const [first, second] = strikesBy(result, 'attacker');
    expect([first.miss, second.miss]).toEqual([false, true]);
    expect(second.firstStrikeBonus).toBeUndefined();
  });

  it("rolls a brave weapon's second blow at base Hit", () => {
    const brave = blade({ special: 'Attacks twice consecutively' });
    const result = resolveAt(65, { attacker: unit('Attacker', 'player', { weapon: brave }) });
    const [first, second] = strikesBy(result, 'attacker');
    expect([first.miss, second.miss]).toEqual([false, true]);
  });

  it("rolls a weapon art's plain follow-up at base Hit", () => {
    // SPD 25 against 10 clears the art's larger follow-up lead (10).
    const result = resolveAt(65, {
      attacker: unit('Attacker', 'player', { spd: 25 }),
      extraCtx: { atkWeaponArtMods: { weaponArt: true, activated: [{ id: 'weapon_art' }] } },
    });
    const strikes = strikesBy(result, 'attacker');
    expect(strikes).toHaveLength(2);
    expect([strikes[0].miss, strikes[1].miss]).toEqual([false, true]);
  });

  it('rolls an Adept bonus strike at base Hit', () => {
    let granted = false;
    const result = resolveAt(65, {
      extraCtx: {
        skillsData: [],
        rollStrikeSkills: (striker, damage) => {
          const extraStrike = striker.name === 'Attacker' && !granted;
          if (extraStrike) granted = true;
          return { modifiedDamage: damage, activated: [], extraStrike };
        },
      },
    });
    const strikes = strikesBy(result, 'attacker');
    expect(strikes).toHaveLength(2);
    expect(strikes[1].adeptStrike).toBe(true);
    expect([strikes[0].miss, strikes[1].miss]).toEqual([false, true]);
  });

  it("never gives the defender's counter a first-strike bonus", () => {
    // The defender hits the attacker at 60: a 65 roll misses it. A leaked +30 (defMods)
    // would turn it into 90 and land.
    const result = resolveAt(65, { defMods: { firstStrikeHitBonus: 30 } });
    const counter = strikesBy(result, 'defender');
    expect(counter).toHaveLength(1);
    expect(counter[0].miss).toBe(true);
  });

  it("still lifts the attacker's first strike when a Vantage defender strikes first", () => {
    const result = resolveAt(65, { defMods: { vantage: true } });
    expect(result.events.find((e) => e.type === 'strike').attackerSide).toBe('defender');
    const [first] = strikesBy(result, 'attacker');
    expect(first.miss).toBe(false);
    expect(first.firstStrikeBonus).toBe(true);
  });

  it('adds no hit to a silenced mage: the first strike misses even at roll 0', () => {
    const tome = {
      name: 'Test Tome',
      type: 'Tome',
      might: 4,
      hit: 90,
      crit: 0,
      weight: 1,
      range: '1-2',
      special: '',
    };
    const mage = unit('Attacker', 'player', { weapon: tome });
    applyCondition(mage, 'silence', 2);
    const result = resolveAt(0, { attacker: mage });
    const strikes = strikesBy(result, 'attacker');
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.every((e) => e.miss)).toBe(true);
  });

  it('lifts a 95-Hit first strike to 100: it lands a 99.5 roll that the base Hit misses', () => {
    const result = resolveAt(99.5, {
      attacker: unit('Attacker', 'player', { weapon: blade({ hit: 105 }) }),
    });
    expect(strikesBy(result, 'attacker')[0].miss).toBe(false);
    const dull = resolveAt(99.5, {
      attacker: unit('Attacker', 'player', { weapon: blade({ hit: 105 }) }),
      atkMods: {},
    });
    expect(strikesBy(dull, 'attacker')[0].miss).toBe(true);
  });

  it('draws the same number of random values with and without the bonus', () => {
    // 1% lands every strike and 99% misses every one, so the draws must agree.
    for (const percent of [1, 99]) {
      const counts = [{}, KEEN].map((atkMods) => {
        const { attacker, defender, skillCtx } = combat({ atkMods });
        let draws = 0;
        Math.random = () => {
          draws++;
          return percent / 100;
        };
        resolveCombat(
          attacker,
          attacker.weapon,
          defender,
          defender.weapon,
          1,
          null,
          null,
          skillCtx,
        );
        return draws;
      });
      expect(counts[1], `roll ${percent}`).toBe(counts[0]);
    }
  });
});

describe('Keen Eye in the forecast display', () => {
  const forecastFor = (setup) => {
    const { attacker, defender, skillCtx } = combat(setup);
    return getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
  };

  it('shows the first strike chance in the Hit cell', () => {
    const forecast = forecastFor();
    // 60 and 70 Hit land about 68% and 82% of the time (two averaged dice).
    expect(formatSideHit(forecast.attacker)).not.toBe(formatSideHit({ hit: 60 }));
    expect(formatSideHit(forecast.attacker)).toBe(formatSideHit({ hit: 70 }));
  });

  it('adds a "Later strikes" note when the attacker strikes more than once', () => {
    const doubled = forecastFor({ attacker: unit('Attacker', 'player', { spd: 20 }) });
    const notes = forecastNotes(doubled, true, 100);
    expect(notes.some((n) => n.startsWith('Later strikes: '))).toBe(true);
  });

  it('adds no note for a single strike', () => {
    const notes = forecastNotes(forecastFor(), true, 100);
    expect(notes.some((n) => n.startsWith('Later strikes: '))).toBe(false);
  });

  it('projects a first strike that lands only because of Keen Eye', () => {
    const side = (extra) => ({
      hp: 10,
      damage: 10,
      hit: 0,
      crit: 0,
      attackCount: 1,
      doubles: false,
      stones: 0,
      thornsReflect: 0,
      ...extra,
    });
    const projection = forecastProjection({
      display: { simpleExchange: true },
      attacker: side({ firstHit: 10 }),
      defender: side({ canCounter: false, damage: 0, attackCount: 0 }),
    });
    expect(projection.defenderHP).toBe(0);
    const without = forecastProjection({
      display: { simpleExchange: true },
      attacker: side({}),
      defender: side({ canCounter: false, damage: 0, attackCount: 0 }),
    });
    expect(without.defenderHP).toBe(10);
  });
});
