// Owner decision 2026-10-02: Foresight extends counter range. A unit counters with the
// range it attacks with (Combat.getEffectiveWeaponRange: weapon range + range skills),
// so Kira's Fire (1–2) with Foresight counters at 1–3. Everything that predicts a
// counter reads the one rule (Combat.counterBlocker): the forecast, resolution, the
// enemy AI's counter risk (through its forecast), whatever the defender's faction.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canCounter,
  getCombatForecast,
  getEffectiveWeaponRange,
  resolveCombat,
} from '../src/engine/Combat.js';
import { getAttackRange } from '../src/engine/AttackOptions.js';
import { getSkillCombatMods, rollStrikeSkills, checkAstra } from '../src/engine/SkillSystem.js';
import { AIController } from '../src/engine/AIController.js';
import { createEnemyUnit, createLordUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const FORESIGHT = data.skills.find((s) => s.id === 'foresight');
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const cls = (name) => data.classes.find((c) => c.name === name);

afterEach(() => vi.restoreAllMocks());

function kira(col = 0, row = 0) {
  const lord = data.lords.find((l) => l.name === 'Kira');
  const unit = createLordUnit(lord, cls(lord.class), data.weapons);
  unit.weapon = unit.inventory.find((w) => w.name === 'Fire') || weapon('Fire');
  if (!unit.inventory.includes(unit.weapon)) unit.inventory.unshift(unit.weapon);
  return Object.assign(unit, { col, row });
}

function archer(col, row) {
  const unit = createEnemyUnit(cls('Archer'), 5, data.weapons, 1.0, null, 'act2');
  unit.weapon = weapon('Longbow'); // 2–3
  unit.inventory = [unit.weapon];
  return Object.assign(unit, { col, row });
}

/** The battle's skill context (as BattleScene.buildSkillCtx, without timed buffs). */
function battleCtx(attacker, defender) {
  return {
    atkMods: getSkillCombatMods(
      attacker,
      defender,
      [attacker],
      [defender],
      data.skills,
      null,
      true,
    ),
    defMods: getSkillCombatMods(defender, attacker, [defender], [attacker], data.skills, null),
    rollStrikeSkills,
    checkAstra,
    skillsData: data.skills,
    imbuesData: data.imbues,
  };
}

function exchange(attacker, defender, distance, { random = 0.999999 } = {}) {
  const ctx = battleCtx(attacker, defender);
  const forecast = getCombatForecast(
    structuredClone(attacker),
    attacker.weapon,
    structuredClone(defender),
    defender.weapon,
    distance,
    null,
    null,
    ctx,
  );
  vi.spyOn(Math, 'random').mockReturnValue(random);
  const result = resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    distance,
    null,
    null,
    ctx,
  );
  vi.restoreAllMocks();
  const counters = result.events.filter(
    (e) => e.type === 'strike' && e.attackerSide === 'defender',
  );
  return { forecast, result, counters };
}

describe('Foresight extends counter range', () => {
  it('data: Foresight adds 1 to a tome’s range, and Kira carries it with Fire 1–2', () => {
    expect(FORESIGHT.effects.tomeRangeBonus).toBe(1);
    const unit = kira();
    expect(unit.skills).toContain('foresight');
    expect(unit.weapon.range).toBe('1-2');
    expect(getEffectiveWeaponRange(unit, unit.weapon, { skillsData: data.skills })).toEqual({
      min: 1,
      max: 3,
    });
    // The range she attacks with is the range she counters with.
    expect(getAttackRange(unit, unit.weapon, { skillsData: data.skills })).toEqual({
      min: 1,
      max: 3,
    });
  });

  it('Kira at distance 3, attacked by a 2–3 archer, counters: forecast and resolution', () => {
    const defender = kira(3, 0);
    const attacker = archer(0, 0);
    const { forecast, counters } = exchange(attacker, defender, 3);
    expect(forecast.defender.canCounter).toBe(true);
    expect(forecast.display.counterReason).toBeNull();
    expect(forecast.defender.attackCount).toBeGreaterThan(0);
    // Every strike misses at c ≈ 1, so each planned counter is struck (and shown).
    expect(counters).toHaveLength(forecast.defender.attackCount);
    expect(canCounter(defender, defender.weapon, 3, { skillsData: data.skills })).toBe(true);
  });

  it('a landed counter deals the forecast damage', () => {
    const defender = kira(3, 0);
    const attacker = archer(0, 0);
    const probe = exchange(structuredClone(attacker), structuredClone(defender), 3).forecast;
    // Land every strike without a crit: c just above both crit chances, below both hits.
    const c = Math.max(probe.attacker.crit, probe.defender.crit) + 0.5;
    expect(c).toBeLessThan(Math.min(probe.attacker.hit, probe.defender.hit));
    const { counters } = exchange(attacker, defender, 3, { random: c / 100 });
    expect(counters[0]).toMatchObject({ miss: false, isCrit: false });
    expect(counters[0].damage).toBe(probe.defender.damage);
  });

  it('without Foresight she cannot counter at 3 (forecast and resolution)', () => {
    const defender = kira(3, 0);
    defender.skills = defender.skills.filter((id) => id !== 'foresight');
    const { forecast, counters } = exchange(archer(0, 0), defender, 3);
    expect(forecast.defender.canCounter).toBe(false);
    expect(forecast.display.counterReason).toBe('Target is outside weapon range');
    expect(counters).toEqual([]);
  });

  it('Foresight reaches 3, not 4', () => {
    const attacker = archer(0, 0);
    attacker.weapon = weapon('Breachbolt'); // 3–10, so the archer stands at 4
    attacker.proficiencies = [{ type: 'Tome', rank: 'Mast' }];
    attacker.inventory = [attacker.weapon];
    const { forecast, counters } = exchange(attacker, kira(4, 0), 4);
    expect(forecast.defender.canCounter).toBe(false);
    expect(counters).toEqual([]);
  });

  it('a defender of any faction: an enemy with Foresight counters at 3 too', () => {
    const mage = createEnemyUnit(cls('Mage'), 5, data.weapons, 1.0, null, 'act2');
    mage.weapon = weapon('Fire');
    mage.inventory = [mage.weapon];
    Object.assign(mage, { col: 3, row: 0, skills: ['foresight'] });
    const player = archer(0, 0);
    player.faction = 'player';
    const { forecast, counters } = exchange(player, mage, 3);
    expect(forecast.defender.canCounter).toBe(true);
    expect(counters).toHaveLength(forecast.defender.attackCount);
  });

  it('the enemy AI counts the counter it would take (counter risk)', () => {
    const ai = new AIController(
      { getTerrainAt: () => null, mapLayout: null },
      { skills: data.skills, imbues: data.imbues },
    );
    const enemy = archer(0, 0);
    const withSkill = kira(3, 0);
    const without = kira(3, 0);
    without.skills = without.skills.filter((id) => id !== 'foresight');
    // Same target, same blow; only the counter differs, so the score drops by its risk.
    expect(ai._scoreAttackTarget(enemy, withSkill)).toBeLessThan(
      ai._scoreAttackTarget(enemy, without),
    );
  });
});

describe('skillsData must reach the counter rule', () => {
  it('a forecast or resolution without it, for a defender with a range skill, throws', () => {
    const defender = kira(3, 0);
    const attacker = archer(0, 0);
    const ctx = { ...battleCtx(attacker, defender), skillsData: undefined };
    expect(() => getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 3, null, null, ctx)).toThrow(/skillsData/); // prettier-ignore
    expect(() => resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 3, null, null, ctx)).toThrow(/skillsData/); // prettier-ignore
    expect(() => getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 3)).toThrow(/skillsData/); // prettier-ignore
    // Skills data that lacks the skill is the same mistake (an AI built with no data).
    expect(() => canCounter(defender, defender.weapon, 3, { skillsData: [] })).toThrow(/foresight/);
    expect(() => getAttackRange(defender, defender.weapon)).toThrow(/skillsData/);
  });

  it('a unit without a range skill needs no skills data', () => {
    const attacker = kira(0, 0);
    attacker.skills = [];
    const defender = archer(2, 0);
    expect(canCounter(defender, defender.weapon, 2)).toBe(true);
    expect(canCounter(defender, defender.weapon, 1)).toBe(false);
    const f = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 2);
    expect(f.defender.canCounter).toBe(true);
  });
});
