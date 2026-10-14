// Unfathomed: the Entity's innate skill. A unit fighting the Entity triggers its combat skills
// (on-attack, on-defend, Astra) at half their usual odds, and crits it at half its crit rate
// (that half was already the rule, ENTITY_CRIT_RATE_MULT; the skill names it on the card).
// 'always' skills are no procs and keep their 100. The Entity's own procs are never halved.
//
// Odds worked by hand: Luna and Pavise trigger at SKL; Astra at floor(SKL / 2).
//   SKL 30: 30% plain, 15% against the Entity. The battle RNG is pinned at 0.2 (a roll of 20),
//   which triggers a 30% skill and not a 15% one. Hit: Iron Sword 95 + 60 + 0 against Avoid 0
//   is a sure hit at any roll; crit: floor(30 / 2) + 0 - LCK 40 is 0.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { resolveCombat } from '../src/engine/Combat.js';
import {
  checkAstra,
  getActivationChance,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { createEnemyUnit } from '../src/engine/UnitManager.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

const unit = (name, stats, extra = {}) => ({
  name,
  faction: 'player',
  col: 0,
  row: 0,
  level: 10,
  currentHP: stats.HP ?? 200,
  stats: { HP: 200, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  weaponRank: 'Prof',
  moveType: 'Infantry',
  skills: [],
  ...extra,
});

const hero = (skills, stats = {}) => {
  const u = unit('Hero', { STR: 10, SKL: 30, ...stats }, { skills });
  u.weapon = weapon('Iron Sword');
  u.inventory = [u.weapon];
  return u;
};
// The Entity (or a plain boss with the same numbers): DEF 0 so damage is never 0, LCK 40.
const foe = (entity, extra = {}) =>
  unit(
    'Foe',
    { DEF: 0, LCK: 40, SKL: 0 },
    {
      faction: 'enemy',
      isBoss: true,
      ...(entity ? { isEntity: true, skills: ['unfathomed'] } : {}),
      ...extra,
    },
  );

const skillCtx = (atkMods = null) => ({
  atkMods,
  defMods: null,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  skillsData: data.skills,
});

const fight = (attacker, defender, ctx = skillCtx()) => {
  vi.spyOn(Math, 'random').mockReturnValue(0.2);
  return resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon || null,
    1,
    null,
    null,
    ctx,
  );
};
const activations = (result, side) =>
  result.events
    .filter((e) => e.type === 'strike' && e.attackerSide === side)
    .flatMap((e) => (e.skillActivations || []).map((a) => a.id));

afterEach(() => vi.restoreAllMocks());

describe('Unfathomed data', () => {
  it("is the Entity's innate passive and no one else's", () => {
    const skill = data.skills.find((s) => s.id === 'unfathomed');
    expect(skill).toMatchObject({ name: 'Unfathomed', trigger: 'passive', classInnate: 'Entity' });
    expect(skill.description).toMatch(/half as often/);
    expect(data.classes.find((c) => c.name === 'Entity')).toBeTruthy();
  });

  it('an Entity built for a battle knows it, and learning it draws nothing', () => {
    const cls = data.classes.find((c) => c.name === 'Entity');
    const spy = vi.spyOn(Math, 'random');
    const entity = createEnemyUnit(cls, 20, data.weapons, 1, data.skills, 'finalBoss');
    const withSkills = spy.mock.calls.length;
    expect(entity.skills).toEqual(['unfathomed']);
    // No skills data, no skill, and the same number of draws (the battle stream never moves).
    expect(createEnemyUnit(cls, 20, data.weapons, 1, null, 'finalBoss').skills).toEqual([]);
    expect(spy.mock.calls.length - withSkills).toBe(withSkills);
  });
});

describe('getActivationChance below 1', () => {
  it("halves a proc's odds, floored, and leaves an 'always' skill at 100", () => {
    const u = unit('U', { SKL: 31, LCK: 9, SPD: 21 });
    expect(getActivationChance(u, 'SKL', 0.5)).toBe(15);
    expect(getActivationChance(u, 'SKL_HALF', 0.5)).toBe(7);
    expect(getActivationChance(u, 'LCK_THIRD', 0.5)).toBe(1);
    expect(getActivationChance(u, 'SPD', 0.5)).toBe(10);
    expect(getActivationChance(u, 'always', 0.5)).toBe(100);
    expect(getActivationChance(u, 'SKL', 1)).toBe(31);
  });
});

describe('Unfathomed in combat', () => {
  it("halves an attacker's on-attack proc against the Entity: Luna 30% fires, 15% does not", () => {
    expect(activations(fight(hero(['luna']), foe(false)), 'attacker')).toContain('luna');
    expect(activations(fight(hero(['luna']), foe(true)), 'attacker')).not.toContain('luna');
  });

  it('halves Astra against the Entity (SKL 60: 30% plain, 15% here)', () => {
    const astra = (result) => result.events.some((e) => e.type === 'skill' && e.name === 'Astra');
    expect(astra(fight(hero(['astra'], { SKL: 60 }), foe(false)))).toBe(true);
    expect(astra(fight(hero(['astra'], { SKL: 60 }), foe(true)))).toBe(false);
  });

  it("halves the defender's on-defend proc when the Entity attacks: Pavise", () => {
    const struck = (entity) => {
      const attacker = foe(entity, { faction: 'enemy' });
      attacker.stats.STR = 20;
      attacker.stats.SKL = 30;
      attacker.weapon = weapon('Iron Sword');
      attacker.inventory = [attacker.weapon];
      const defender = hero(['pavise']);
      defender.stats.LCK = 40; // the Entity's crit: 15 + 0 - 40 is 0
      defender.weapon = null; // no counter
      defender.inventory = [];
      return fight(attacker, defender);
    };
    expect(activations(struck(false), 'attacker')).toContain('pavise');
    expect(activations(struck(true), 'attacker')).not.toContain('pavise');
  });

  it("composes with Gambler's Edge: 30 x 1.5 x 0.5 = 22, so a roll of 20 still fires", () => {
    const result = fight(hero(['luna']), foe(true), skillCtx({ procChanceMultiplier: 1.5 }));
    expect(activations(result, 'attacker')).toContain('luna');
  });

  it("leaves the Entity's own procs alone (Luna at SKL 30 still 30% for it)", () => {
    const attacker = foe(true);
    attacker.skills = ['unfathomed', 'luna'];
    attacker.stats.STR = 20;
    attacker.stats.SKL = 30;
    attacker.weapon = weapon('Iron Sword');
    attacker.inventory = [attacker.weapon];
    const defender = hero([]);
    defender.stats.LCK = 40;
    defender.weapon = null;
    defender.inventory = [];
    expect(activations(fight(attacker, defender), 'attacker')).toContain('luna');
  });
});
