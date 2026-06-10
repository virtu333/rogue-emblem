// Regression tests for the follow-up-wave combat fixes:
// 1. Entity crit damage (1.5x multiplier) must be floored — fractional damage
//    was leaving units at HP values like "33.5".
// 2. Adept/Aether bonus strikes must still run on-defend skills and affixes
//    (Pavise, Aegis, Miracle, Shielded, Thorns) — the old code passed a null
//    strike context, so bonus strikes killed straight through Miracle.
// 3. getCombatForecast must clamp damage at zero BEFORE adding statScaling /
//    vengeance bonuses, exactly like resolveCombat does — otherwise the
//    forecast shows 0 where resolution actually deals damage.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { rollDefenseSkills, rollStrikeSkills } from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const ironSword = gameData.weapons.find((w) => w.name === 'Iron Sword');

function makeUnit(overrides = {}) {
  return {
    name: 'Unit',
    skills: [],
    stats: { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 10, DEF: 5, RES: 5, LCK: 0, MOV: 4 },
    currentHP: 30,
    faction: 'player',
    col: 0,
    row: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Entity crit damage flooring', () => {
  it('floors the 1.5x Entity crit multiplier so HP never goes fractional', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // hit lands, crit fires

    // Crit rate: SKL/2 + weapon crit - enemy LCK, then halved vs Entity.
    const attacker = makeUnit({
      name: 'Attacker',
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 20, SPD: 10, DEF: 5, RES: 5, LCK: 0, MOV: 4 },
      weapon: { ...ironSword, crit: 10 },
    });
    const entity = makeUnit({
      name: 'Entity',
      isEntity: true,
      faction: 'enemy',
      weapon: null, // cannot counter
      col: 1,
      stats: { HP: 60, STR: 10, MAG: 0, SKL: 5, SPD: 10, DEF: 8, RES: 5, LCK: 0, MOV: 0 },
      currentHP: 60,
    });

    // Per-hit damage is odd so 1.5x produces a fraction without the floor.
    const baseDmg = 10 + (ironSword.might || 0) - 8;
    expect(baseDmg % 2).toBe(1);

    const result = resolveCombat(attacker, attacker.weapon, entity, null, 1, null, null, null);

    const strikes = result.events.filter((e) => e.type === 'strike' && !e.miss);
    expect(strikes.length).toBeGreaterThanOrEqual(1);
    for (const strike of strikes) {
      expect(strike.isCrit).toBe(true);
      expect(Number.isInteger(strike.damage)).toBe(true);
      expect(strike.damage).toBe(Math.floor(baseDmg * 1.5));
      expect(Number.isInteger(strike.targetHPAfter)).toBe(true);
    }
    expect(Number.isInteger(result.defenderHP)).toBe(true);
  });
});

describe('Adept bonus strikes vs on-defend skills', () => {
  function makeAdeptAttacker() {
    return makeUnit({
      name: 'Adept Attacker',
      skills: ['adept'],
      faction: 'enemy',
      // SPD 10 procs Adept (SPD% with mocked roll 0) without doubling vs SPD 6.
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 10, DEF: 5, RES: 5, LCK: 0, MOV: 4 },
      weapon: { ...ironSword, crit: 0 },
    });
  }

  it('applies Pavise to the Adept bonus strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // hits land, all procs fire, crit 0

    const attacker = makeAdeptAttacker();
    const defender = makeUnit({
      name: 'Pavise Defender',
      skills: ['pavise'],
      weapon: null,
      col: 1,
      stats: { HP: 40, STR: 5, MAG: 0, SKL: 20, SPD: 6, DEF: 2, RES: 5, LCK: 0, MOV: 4 },
      currentHP: 40,
    });

    const fullDmg = 10 + (ironSword.might || 0) - 2;
    const result = resolveCombat(attacker, attacker.weapon, defender, null, 1, null, null, {
      skillsData: gameData.skills,
      rollStrikeSkills,
      rollDefenseSkills,
    });

    const bonus = result.events.find((e) => e.adeptStrike);
    expect(bonus).toBeTruthy();
    expect(bonus.miss).toBe(false);
    // Pavise halves physical damage on the bonus strike too.
    expect(bonus.damage).toBe(Math.floor(fullDmg / 2));
    expect(bonus.skillActivations.some((a) => a.id === 'pavise')).toBe(true);
  });

  it('lets Miracle save the defender from a lethal Adept bonus strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const attacker = makeAdeptAttacker();
    const fullDmg = 10 + (ironSword.might || 0) - 2;
    // Survives the first strike with less HP than the bonus strike deals.
    const startHP = fullDmg + 3;
    expect(fullDmg).toBeGreaterThan(3);
    const defender = makeUnit({
      name: 'Miracle Defender',
      skills: ['miracle'],
      weapon: null,
      col: 1,
      stats: { HP: 40, STR: 5, MAG: 0, SKL: 0, SPD: 6, DEF: 2, RES: 5, LCK: 30, MOV: 4 },
      currentHP: startHP,
    });

    const result = resolveCombat(attacker, attacker.weapon, defender, null, 1, null, null, {
      skillsData: gameData.skills,
      rollStrikeSkills,
      rollDefenseSkills,
    });

    const bonus = result.events.find((e) => e.adeptStrike);
    expect(bonus).toBeTruthy();
    expect(bonus.skillActivations.some((a) => a.id === 'miracle')).toBe(true);
    expect(result.defenderHP).toBe(1);
    expect(result.defenderDied).toBe(false);
  });
});

describe('forecast/resolution damage clamp parity', () => {
  it('forecast matches resolution when mods push base damage negative before statScaling', () => {
    // Base damage 0 (DEF towers over attack), defBonus drags the sum to -5,
    // then statScaling adds back +3. Resolution clamps before adding scaling,
    // so the real per-strike damage is 3 — the forecast must agree.
    const attacker = makeUnit({
      name: 'Scaler',
      stats: { HP: 30, STR: 0, MAG: 0, SKL: 3, SPD: 10, DEF: 5, RES: 5, LCK: 0, MOV: 4 },
      weapon: { ...ironSword, crit: 0 },
    });
    // LCK 30 zeroes the attacker's crit (SKL 3 would otherwise crit with the
    // mocked roll of 0) while leaving hit comfortably above avoid.
    const defender = makeUnit({
      name: 'Wall',
      faction: 'enemy',
      weapon: null,
      col: 1,
      stats: { HP: 30, STR: 5, MAG: 0, SKL: 0, SPD: 10, DEF: 30, RES: 5, LCK: 30, MOV: 4 },
    });
    const skillCtx = {
      atkMods: { statScaling: { stat: 'SKL', divisor: 1 } },
      defMods: { defBonus: 5 },
    };

    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      null,
      1,
      null,
      null,
      skillCtx,
    );

    vi.spyOn(Math, 'random').mockReturnValue(0); // strike lands
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      null,
      1,
      null,
      null,
      skillCtx,
    );
    const strike = result.events.find((e) => e.type === 'strike' && !e.miss);

    expect(strike).toBeTruthy();
    expect(strike.damage).toBe(3);
    expect(forecast.attacker.damage).toBe(strike.damage);
  });
});
