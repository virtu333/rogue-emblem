// effectiveSkills: the one read of a unit's skills in battle (docs/specs/phase3.md 3A).
// A skill lent by the weapon in use or by the equipped accessory has every effect a learned
// skill has, on every battle path; a benched skill has none; a lent copy of a skill the
// unit already knows counts once. The bound sources here are test-only grants: no catalog
// weapon or ring lends Renewal, Charisma, Blink or Shove yet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectiveSkills, hasEffectiveSkill } from '../src/engine/EffectiveSkills.js';
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
import { specialistJob } from '../src/engine/Guidance.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { knowsSkill } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const skills = loadGameData().skills;

const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5, hit: 90, crit: 0 };
const tome = { name: 'Fire', type: 'Tome', range: '1-2', might: 5, hit: 90, crit: 0 };
const lends = (id, base = sword) => ({ ...base, _grantedSkill: id });
const ring = (id) => ({ name: 'Bond Ring', _boundSkill: id });

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

afterEach(() => vi.restoreAllMocks());

describe('effectiveSkills', () => {
  it('lists unit.skills, then the weapon’s grant, then the accessory’s bound skill', () => {
    const u = unit({ skills: ['wrath', 'sol'], weapon: lends('luna'), accessory: ring('canto') });
    expect(effectiveSkills(u)).toEqual(['wrath', 'sol', 'luna', 'canto']);
  });

  it('counts a lent copy of a known skill once, keeping the known skill’s place', () => {
    const u = unit({ skills: ['sol', 'wrath'], weapon: lends('sol'), accessory: ring('wrath') });
    expect(effectiveSkills(u)).toEqual(['sol', 'wrath']);
    const both = unit({ weapon: lends('sol'), accessory: ring('sol') });
    expect(effectiveSkills(both)).toEqual(['sol']);
  });

  it('never includes a benched skill', () => {
    const u = unit({ skills: ['wrath'], benchedSkills: ['renewal', 'canto'] });
    expect(effectiveSkills(u)).toEqual(['wrath']);
    expect(hasEffectiveSkill(u, 'renewal')).toBe(false);
  });

  it('a benched skill is still not effective when a lent copy is absent, and is when lent', () => {
    const u = unit({ benchedSkills: ['renewal'], weapon: lends('renewal') });
    expect(hasEffectiveSkill(u, 'renewal')).toBe(true);
    expect(u.benchedSkills).toEqual(['renewal']);
  });

  it('reads the equipped weapon by default, a passed weapon instead, and none for null', () => {
    const u = unit({ weapon: lends('sol') });
    expect(effectiveSkills(u)).toEqual(['sol']);
    expect(effectiveSkills(u, { weapon: lends('luna') })).toEqual(['luna']);
    expect(effectiveSkills(u, { weapon: { ...sword } })).toEqual([]);
    expect(effectiveSkills(u, { weapon: null })).toEqual([]);
    expect(effectiveSkills(u, {})).toEqual(['sol']);
  });

  it('lends, never teaches: unit.skills, the cap and knowsSkill do not see a bound skill', () => {
    const u = unit({ skills: ['wrath'], weapon: lends('sol'), accessory: ring('canto') });
    effectiveSkills(u);
    expect(u.skills).toEqual(['wrath']);
    expect(knowsSkill(u, 'sol')).toBe(false);
    expect(knowsSkill(u, 'canto')).toBe(false);
    expect(knowsSkill(u, 'wrath')).toBe(true);
    // the bound skill leaves with the ring and the weapon
    u.accessory = null;
    u.weapon = { ...sword };
    expect(effectiveSkills(u)).toEqual(['wrath']);
  });

  it('survives a unit with no list, no weapon, no accessory, or no unit', () => {
    expect(effectiveSkills(null)).toEqual([]);
    expect(effectiveSkills({})).toEqual([]);
    expect(effectiveSkills({ skills: undefined, weapon: null, accessory: null })).toEqual([]);
    expect(hasEffectiveSkill(undefined, 'sol')).toBe(false);
  });

  it('ignores an empty or non-string grant, and reads {id} entries as their id', () => {
    expect(effectiveSkills(unit({ weapon: lends(''), accessory: ring(undefined) }))).toEqual([]);
    expect(effectiveSkills(unit({ skills: [{ id: 'wrath' }, 'sol', 7, null] }))).toEqual([
      'wrath',
      'sol',
    ]);
  });
});

describe('a bound skill is effective on every battle path', () => {
  it('combat start: Death Blow lent by a weapon adds STR when initiating', () => {
    const u = unit({ weapon: lends('death_blow') });
    const foe = unit({ faction: 'enemy', col: 5 });
    expect(getSkillCombatMods(u, foe, [u], [foe], skills, null, true).atkBonus).toBe(6);
  });

  it('combat start: Wrath lent by an accessory adds crit below half HP', () => {
    const u = unit({ accessory: ring('wrath'), currentHP: 5 });
    const foe = unit({ faction: 'enemy', col: 5 });
    expect(getSkillCombatMods(u, foe, [u], [foe], skills, null, false).critBonus).toBe(30);
  });

  it('a silenced unit gets nothing from a lent skill, as from a known one', () => {
    const foe = unit({ faction: 'enemy', col: 5 });
    const lent = unit({ accessory: ring('wrath'), currentHP: 5 });
    expect(applyCondition(lent, 'silence', 2)).toBe(true);
    expect(getSkillCombatMods(lent, foe, [lent], [foe], skills, null, false).critBonus).toBe(0);
    const known = unit({ skills: ['wrath'], currentHP: 5 });
    applyCondition(known, 'silence', 2);
    expect(getSkillCombatMods(known, foe, [known], [foe], skills, null, false).critBonus).toBe(0);
    const heal = unit({ weapon: lends('renewal'), currentHP: 10 });
    applyCondition(heal, 'silence', 2);
    expect(getTurnStartEffects([heal], skills)).toEqual([]);
  });

  it('on-attack: a ring’s Sol procs on a strike; a ring’s Pavise halves a blow', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const foe = unit({ faction: 'enemy' });
    expect(rollStrikeSkills(unit({ accessory: ring('sol') }), 9, foe, skills).heal).toBe(9);
    expect(
      rollDefenseSkills(unit({ accessory: ring('pavise') }), 10, true, skills).modifiedDamage,
    ).toBe(5);
    expect(checkAstra(unit({ accessory: ring('astra') }), skills).triggered).toBe(true);
  });

  it('ally aura: Charisma lent by an ally’s weapon gives +10 Hit, +5 Avoid within 2 tiles', () => {
    const leader = unit({ name: 'Leader', weapon: lends('charisma'), col: 4, row: 4 });
    const near = unit({ col: 6, row: 4 });
    const far = unit({ col: 7, row: 4 });
    const foe = unit({ faction: 'enemy', col: 6, row: 5 });
    const nearMods = getSkillCombatMods(near, foe, [leader, near, far], [foe], skills);
    expect(nearMods.hitBonus).toBe(10);
    expect(nearMods.avoidBonus).toBe(5);
    expect(getSkillCombatMods(far, foe, [leader, near, far], [foe], skills).hitBonus).toBe(0);
  });

  it('ally aura: lent by an accessory too', () => {
    const leader = unit({ name: 'Leader', accessory: ring('charisma'), col: 4, row: 4 });
    const near = unit({ col: 5, row: 4 });
    const foe = unit({ faction: 'enemy', col: 6, row: 5 });
    expect(getSkillCombatMods(near, foe, [leader, near], [foe], skills).hitBonus).toBe(10);
  });

  it('one aura is one aura: a lent Charisma on a leader who knows it counts once', () => {
    const near = unit({ col: 5, row: 4 });
    const foe = unit({ faction: 'enemy', col: 6, row: 5 });
    const known = unit({ name: 'L1', skills: ['charisma'], col: 4, row: 4 });
    const lentToo = unit({
      name: 'L2',
      skills: ['charisma'],
      weapon: lends('charisma'),
      accessory: ring('charisma'),
      col: 4,
      row: 4,
    });
    const once = getSkillCombatMods(near, foe, [known, near], [foe], skills);
    const dup = getSkillCombatMods(near, foe, [lentToo, near], [foe], skills);
    expect(once.hitBonus).toBe(10);
    expect(dup.hitBonus).toBe(10);
    expect(dup.avoidBonus).toBe(5);
  });

  it('enemy aura: Draconic Aura lent by an enemy’s weapon debuffs a unit 1-2 tiles away', () => {
    const wyvern = unit({ faction: 'enemy', weapon: lends('draconic_aura'), col: 6, row: 4 });
    const u = unit({ col: 4, row: 4 });
    const mods = getSkillCombatMods(u, wyvern, [u], [wyvern], skills);
    expect(mods.hitBonus).toBe(-10);
    expect(mods.atkBonus).toBe(-1);
    const afar = unit({ col: 1, row: 4 });
    expect(getSkillCombatMods(afar, wyvern, [afar], [wyvern], skills).hitBonus).toBe(0);
  });

  it('turn start: Renewal lent by a weapon or a ring heals 10% of max HP (3 of 30)', () => {
    const stats = { ...unit().stats, HP: 30 };
    for (const lent of [{ weapon: lends('renewal') }, { accessory: ring('renewal') }]) {
      const u = unit({ currentHP: 10, stats, ...lent });
      expect(getTurnStartEffects([u], skills)).toEqual([
        expect.objectContaining({ type: 'heal', target: u, amount: 3 }),
      ]);
    }
  });

  it('turn start: a lent Renewal on a unit that knows it heals once', () => {
    const stats = { ...unit().stats, HP: 30 };
    const u = unit({ currentHP: 10, stats, skills: ['renewal'], weapon: lends('renewal') });
    expect(getTurnStartEffects([u], skills)).toHaveLength(1);
  });

  it('turn start: Renewal Aura lent by a weapon heals an adjacent ally', () => {
    const healer = unit({ name: 'H', weapon: lends('renewal_aura'), col: 4, row: 4 });
    const hurt = unit({ name: 'Hurt', currentHP: 10, col: 5, row: 4 });
    const fx = getTurnStartEffects([healer, hurt], skills);
    expect(fx.some((e) => e.target === hurt && e.amount > 0)).toBe(true);
  });

  it('range: Foresight lent by the tome in hand, or a ring, adds 1 to a tome', () => {
    const wielder = unit({ weapon: lends('foresight', tome) });
    expect(getWeaponRangeBonus(wielder, wielder.weapon, skills)).toBe(1);
    const ringed = unit({ weapon: { ...tome }, accessory: ring('foresight') });
    expect(getWeaponRangeBonus(ringed, ringed.weapon, skills)).toBe(1);
    expect(getWeaponRangeBonus(ringed, sword, skills)).toBe(0);
  });

  it('range: a grant counts for the weapon being asked about, not the one in hand', () => {
    const u = unit({ weapon: { ...sword } });
    expect(getWeaponRangeBonus(u, lends('foresight', tome), skills)).toBe(1);
    expect(getWeaponRangeBonus(u, tome, skills)).toBe(0);
  });

  it('terrain cost: Pathfinder lent by a weapon or a ring reduces cost by 1', () => {
    expect(getTerrainCostReduction(unit({ weapon: lends('pathfinder') }), skills)).toBe(1);
    expect(getTerrainCostReduction(unit({ accessory: ring('pathfinder') }), skills)).toBe(1);
    expect(getTerrainCostReduction(unit(), skills)).toBe(0);
  });

  it('action abilities: Blink lent by a weapon or a ring is listed, once', () => {
    expect(getActionAbilities(unit({ weapon: lends('blink') }), skills).map((s) => s.id)).toEqual([
      'blink',
    ]);
    expect(getActionAbilities(unit({ accessory: ring('blink') }), skills).map((s) => s.id)).toEqual(
      ['blink'],
    );
    const dup = unit({ skills: ['blink'], weapon: lends('blink'), accessory: ring('blink') });
    expect(getActionAbilities(dup, skills)).toHaveLength(1);
  });

  it('action abilities: a benched Blink is not offered', () => {
    expect(getActionAbilities(unit({ benchedSkills: ['blink'] }), skills)).toEqual([]);
  });

  it('Canto: lent by a weapon or a ring, and a benched Canto is nothing', () => {
    expect(cantoRuleFor(unit({ weapon: lends('canto') }), skills)).toBe('any');
    expect(cantoRuleFor(unit({ accessory: ring('measured_step') }), skills)).toBe('noncombat');
    expect(cantoRuleFor(unit({ benchedSkills: ['canto'] }), skills)).toBe(null);
  });

  it('Canto: the strongest rule wins across a known and a lent skill', () => {
    const u = unit({ skills: ['measured_step'], accessory: ring('canto') });
    expect(cantoRuleFor(u, skills)).toBe('any');
  });

  it('action menu: Shove, Pull and Dance are offered when the weapon lends them', () => {
    // BattleScene's menu and MovementActionController's validation both ask this.
    for (const id of ['shove', 'pull', 'dance']) {
      expect(hasEffectiveSkill(unit({ weapon: lends(id) }), id)).toBe(true);
      expect(hasEffectiveSkill(unit({ accessory: ring(id) }), id)).toBe(true);
      expect(hasEffectiveSkill(unit({ benchedSkills: [id] }), id)).toBe(false);
      expect(hasEffectiveSkill(unit(), id)).toBe(false);
    }
  });

  it('the specialist note sees a lent Dance', () => {
    expect(specialistJob(unit({ weapon: lends('dance') }))).toBe('dance');
    expect(specialistJob(unit())).toBe(null);
  });

  it('forecast: a counter proc lent by the defender’s ring warns, and keeps HP unprojected', () => {
    const a = unit({ name: 'A' });
    const plain = unit({ name: 'D', faction: 'enemy' });
    const lent = unit({ name: 'D', faction: 'enemy', accessory: ring('luna') });
    const ctx = { skillsData: skills };
    const base = getCombatForecast(a, a.weapon, plain, plain.weapon, 1, null, null, ctx);
    const warned = getCombatForecast(a, a.weapon, lent, lent.weapon, 1, null, null, ctx);
    expect(base.display.counterHasDamageProc).toBe(false);
    expect(base.display.simpleExchange).toBe(true);
    expect(warned.display.counterHasDamageProc).toBe(true);
    expect(warned.display.simpleExchange).toBe(false);
  });

  it('forecast: a proc lent by the attacker’s weapon in the forecast keeps HP unprojected', () => {
    const a = unit({ name: 'A' });
    const d = unit({ name: 'D', faction: 'enemy' });
    const planned = lends('aegis');
    const f = getCombatForecast(a, planned, d, d.weapon, 1, null, null, { skillsData: skills });
    expect(f.display.simpleExchange).toBe(false);
  });
});
