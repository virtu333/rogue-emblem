// Pins how a unit's skills are read today, so the move to one read (engine/EffectiveSkills.js,
// docs/specs/phase3.md 3A) cannot change a unit that has no bound skill. Every test here passes
// before and after the change: a legendary weapon's `_grantedSkill` on the four combat paths
// that read it, and a skill in `unit.skills` on every battle path.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkAstra,
  getSkillCombatMods,
  getTerrainCostReduction,
  getTurnStartEffects,
  getWeaponRangeBonus,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { getActionAbilities } from '../src/engine/ActionAbilitySystem.js';
import { cantoRuleFor } from '../src/engine/CantoRule.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const skills = data.skills;

const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5, hit: 90, crit: 0 };
const tome = { name: 'Fire', type: 'Tome', range: '1-2', might: 5, hit: 90, crit: 0 };

function unit(overrides = {}) {
  return {
    name: 'Unit',
    faction: 'player',
    className: 'Myrmidon',
    skills: [],
    weapon: { ...sword },
    col: 4,
    row: 4,
    currentHP: 20,
    stats: { HP: 20, STR: 8, MAG: 4, SKL: 20, SPD: 10, DEF: 4, RES: 3, LCK: 10 },
    ...overrides,
  };
}
const granted = (id, base = sword) => ({ ...base, _grantedSkill: id });

afterEach(() => vi.restoreAllMocks());

describe('a legendary weapon’s _grantedSkill, read today', () => {
  it('Sol procs on a strike (Math.random stubbed to a certain proc)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attacker = unit({ weapon: granted('sol') });
    const r = rollStrikeSkills(attacker, 7, unit({ faction: 'enemy' }), skills);
    expect(r.heal).toBe(7);
    expect(r.activated.map((a) => a.id)).toEqual(['sol']);
  });

  it('Luna procs on a strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attacker = unit({ weapon: granted('luna') });
    const r = rollStrikeSkills(attacker, 7, unit({ faction: 'enemy' }), skills);
    expect(r.luna).toBe(true);
    expect(r.activated.map((a) => a.id)).toEqual(['luna']);
  });

  it('neither procs when the roll misses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const attacker = unit({ weapon: granted('sol') });
    const r = rollStrikeSkills(attacker, 7, unit({ faction: 'enemy' }), skills);
    expect(r.heal).toBe(0);
    expect(r.activated).toEqual([]);
  });

  it('Vantage applies its opening effect below half HP', () => {
    const u = unit({ weapon: granted('vantage'), currentHP: 5 });
    const foe = unit({ faction: 'enemy', col: 5 });
    const mods = getSkillCombatMods(u, foe, [u], [foe], skills, null, false);
    expect(mods.vantage).toBe(true);
    expect(mods.activated.map((a) => a.id)).toEqual(['vantage']);
  });

  it('Vantage does not apply above half HP', () => {
    const u = unit({ weapon: granted('vantage'), currentHP: 20 });
    const foe = unit({ faction: 'enemy', col: 5 });
    const mods = getSkillCombatMods(u, foe, [u], [foe], skills, null, false);
    expect(mods.vantage).toBe(false);
  });

  it('Wrath adds its crit below half HP', () => {
    const u = unit({ weapon: granted('wrath'), currentHP: 5 });
    const foe = unit({ faction: 'enemy', col: 5 });
    const mods = getSkillCombatMods(u, foe, [u], [foe], skills, null, false);
    expect(mods.critBonus).toBe(30);
  });

  it('the weapon in context.weapon is the one whose grant is read', () => {
    const u = unit({ weapon: { ...sword }, currentHP: 5 });
    const foe = unit({ faction: 'enemy', col: 5 });
    const ctx = { weapon: granted('vantage') };
    expect(getSkillCombatMods(u, foe, [u], [foe], skills, null, false, null, ctx).vantage).toBe(
      true,
    );
    const equipped = unit({ weapon: granted('vantage'), currentHP: 5 });
    const bare = { weapon: { ...sword } };
    expect(
      getSkillCombatMods(equipped, foe, [equipped], [foe], skills, null, false, null, bare).vantage,
    ).toBe(false);
  });

  it('a defensive grant is read on the defense path', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const defender = unit({ weapon: granted('pavise') });
    expect(rollDefenseSkills(defender, 10, true, skills).modifiedDamage).toBe(5);
  });

  it('Astra is read from the weapon', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(checkAstra(unit({ weapon: granted('astra') }), skills).triggered).toBe(true);
  });

  it('the forecast warns of a counter proc carried by the weapon passed in', () => {
    const a = unit({ name: 'A' });
    const d = unit({ name: 'D', faction: 'enemy' });
    const f = getCombatForecast(a, a.weapon, d, granted('luna'), 1, null, null, {
      skillsData: skills,
    });
    expect(f.display.counterHasDamageProc).toBe(true);
    const plain = getCombatForecast(a, a.weapon, d, d.weapon, 1, null, null, {
      skillsData: skills,
    });
    expect(plain.display.counterHasDamageProc).toBe(false);
  });

  it('the forecast keeps a proc-carrying exchange from projecting HP', () => {
    const a = unit({ name: 'A' });
    const d = unit({ name: 'D', faction: 'enemy' });
    const f = getCombatForecast(a, a.weapon, d, granted('pavise'), 1, null, null, {
      skillsData: skills,
    });
    expect(f.display.simpleExchange).toBe(false);
    const plain = getCombatForecast(a, a.weapon, d, d.weapon, 1, null, null, {
      skillsData: skills,
    });
    expect(plain.display.simpleExchange).toBe(true);
  });

  it('a granted duplicate of a known skill procs once', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attacker = unit({ weapon: granted('sol'), skills: ['sol'] });
    const r = rollStrikeSkills(attacker, 7, unit({ faction: 'enemy' }), skills);
    expect(r.activated.filter((a) => a.id === 'sol')).toHaveLength(1);
  });
});

describe('a skill in unit.skills, read on every battle path', () => {
  it('on-combat-start: Death Blow adds STR when initiating', () => {
    const u = unit({ skills: ['death_blow'] });
    const foe = unit({ faction: 'enemy', col: 5 });
    expect(getSkillCombatMods(u, foe, [u], [foe], skills, null, true).atkBonus).toBe(6);
    expect(getSkillCombatMods(u, foe, [u], [foe], skills, null, false).atkBonus).toBe(0);
  });

  it('passive: Pathfinder skill data is read for terrain cost', () => {
    expect(getTerrainCostReduction(unit({ skills: ['pathfinder'] }), skills)).toBe(1);
    expect(getTerrainCostReduction(unit(), skills)).toBe(0);
  });

  it('on-attack: Sol procs from the list', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const r = rollStrikeSkills(unit({ skills: ['sol'] }), 7, unit({ faction: 'enemy' }), skills);
    expect(r.heal).toBe(7);
  });

  it('on-defend: Pavise halves physical damage', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(rollDefenseSkills(unit({ skills: ['pavise'] }), 10, true, skills).modifiedDamage).toBe(
      5,
    );
  });

  it('Astra from the list', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(checkAstra(unit({ skills: ['astra'] }), skills).triggered).toBe(true);
    expect(checkAstra(unit(), skills).triggered).toBe(false);
  });

  it('ally aura: Charisma gives an ally within 2 tiles +10 Hit, +5 Avoid', () => {
    const leader = unit({ name: 'Leader', skills: ['charisma'], col: 4, row: 4 });
    const u = unit({ col: 6, row: 4 });
    const foe = unit({ faction: 'enemy', col: 7, row: 4 });
    const mods = getSkillCombatMods(u, foe, [leader, u], [foe], skills, null, false);
    expect(mods.hitBonus).toBe(10);
    expect(mods.avoidBonus).toBe(5);
  });

  it('enemy aura: Draconic Aura debuffs a unit within 1-2 tiles', () => {
    const wyvern = unit({ name: 'W', faction: 'enemy', skills: ['draconic_aura'], col: 6, row: 4 });
    const u = unit({ col: 4, row: 4 });
    const mods = getSkillCombatMods(u, wyvern, [u], [wyvern], skills, null, false);
    expect(mods.hitBonus).toBe(-10);
    expect(mods.atkBonus).toBe(-1);
  });

  it('turn start: Renewal heals 10% of max HP', () => {
    const u = unit({ skills: ['renewal'], currentHP: 10, stats: { ...unit().stats, HP: 30 } });
    const fx = getTurnStartEffects([u], skills);
    expect(fx).toEqual([expect.objectContaining({ type: 'heal', target: u, amount: 3 })]);
  });

  it('range: Foresight adds 1 to a tome, not a sword', () => {
    const u = unit({ skills: ['foresight'] });
    expect(getWeaponRangeBonus(u, tome, skills)).toBe(1);
    expect(getWeaponRangeBonus(u, sword, skills)).toBe(0);
  });

  it('action abilities: Blink is listed, Shove (no actionAbility) is not', () => {
    const u = unit({ skills: ['blink', 'shove'] });
    expect(getActionAbilities(u, skills).map((s) => s.id)).toEqual(['blink']);
  });

  it('Canto: any, or noncombat, or none', () => {
    expect(cantoRuleFor(unit({ skills: ['canto'] }), skills)).toBe('any');
    expect(cantoRuleFor(unit({ skills: ['measured_step'] }), skills)).toBe('noncombat');
    expect(cantoRuleFor(unit(), skills)).toBe(null);
  });
});
