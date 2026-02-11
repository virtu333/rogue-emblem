import { describe, it, expect, beforeAll } from 'vitest';
import { loadGameData } from './testData.js';
import {
  getWeaponTriangleBonus,
  getWeaponStatBonuses,
  usesMagic,
  calculateAttack,
  calculateDefense,
  calculateDamage,
  getCombatForecast,
  resolveCombat,
  getPerBattleMaxUses,
  getPerBattleRemainingUses,
  spendPerBattleUse,
  isPhysical,
  isMagical,
} from '../src/engine/Combat.js';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
} from '../src/engine/SkillSystem.js';
import {
  getClassInnateSkills,
  createLordUnit,
  checkLevelUpSkills,
  learnSkill,
} from '../src/engine/UnitManager.js';
import { generateRandomLegendary, generateLootChoices } from '../src/engine/LootSystem.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';

let data;

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    className: 'Myrmidon',
    tier: 'base',
    level: 1,
    isLord: false,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
    currentHP: 20,
    faction: 'player',
    weapon: structuredClone(data.weapons.find(w => w.name === 'Iron Sword')),
    inventory: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    col: 0, row: 0,
    ...overrides,
  };
}

beforeAll(() => {
  data = loadGameData();
});

// ─── Wave 2: Combat Engine Extensions ───

describe('Reaver weapons', () => {
  it('Lancereaver reverses sword vs lance triangle', () => {
    const lancereaver = data.weapons.find(w => w.name === 'Lancereaver');
    const ironLance = data.weapons.find(w => w.name === 'Iron Lance');
    // Normally sword has advantage vs axe and disadvantage vs lance
    // Lancereaver (sword) should swap: advantage vs lance
    const bonus = getWeaponTriangleBonus(lancereaver, ironLance, 'Prof');
    expect(bonus.hit).toBeGreaterThan(0);
    expect(bonus.damage).toBeGreaterThan(0);
  });

  it('Swordreaver reverses lance vs axe triangle', () => {
    const swordreaver = data.weapons.find(w => w.name === 'Swordreaver');
    const ironAxe = data.weapons.find(w => w.name === 'Iron Axe');
    // Normally Lance loses to Axe (Axe>Lance). Swordreaver (Lance) reverses → beats Axe
    // Actually: Axe>Lance, so Lance is disadvantaged vs Axe.
    // With reaver: disadvantage swaps to advantage
    const bonus = getWeaponTriangleBonus(swordreaver, ironAxe, 'Prof');
    expect(bonus.hit).toBeGreaterThan(0);
    expect(bonus.damage).toBeGreaterThan(0);
  });

  it('Axereaver reverses axe vs sword triangle', () => {
    const axereaver = data.weapons.find(w => w.name === 'Axereaver');
    const ironSword = data.weapons.find(w => w.name === 'Iron Sword');
    // Normally Axe loses to Sword (Sword>Axe). Axereaver reverses → beats Sword
    const bonus = getWeaponTriangleBonus(axereaver, ironSword, 'Prof');
    expect(bonus.hit).toBeGreaterThan(0);
    expect(bonus.damage).toBeGreaterThan(0);
  });
});

describe('Triangle ignore', () => {
  it('Ruin clamps negative triangle to 0', () => {
    const ruin = data.weapons.find(w => w.name === 'Ruin');
    const ironSword = data.weapons.find(w => w.name === 'Iron Sword');
    // Axe vs Sword is normally disadvantage
    const bonus = getWeaponTriangleBonus(ruin, ironSword, 'Prof');
    expect(bonus.hit).toBeGreaterThanOrEqual(0);
    expect(bonus.damage).toBeGreaterThanOrEqual(0);
  });
});

describe('Weapon stat bonuses (array)', () => {
  it('returns array for Stormbreaker with DEF+RES', () => {
    const storm = data.weapons.find(w => w.name === 'Stormbreaker');
    const bonuses = getWeaponStatBonuses(storm);
    expect(Array.isArray(bonuses)).toBe(true);
    expect(bonuses.length).toBe(2);
    expect(bonuses.find(b => b.stat === 'DEF')?.value).toBe(5);
    expect(bonuses.find(b => b.stat === 'RES')?.value).toBe(5);
  });

  it('returns array for Ragnarok with DEF only', () => {
    const ragnarok = data.weapons.find(w => w.name === 'Ragnarok');
    const bonuses = getWeaponStatBonuses(ragnarok);
    expect(bonuses.length).toBe(1);
    expect(bonuses[0].stat).toBe('DEF');
    expect(bonuses[0].value).toBe(5);
  });

  it('returns empty array for weapons without specials', () => {
    const ironSword = data.weapons.find(w => w.name === 'Iron Sword');
    const bonuses = getWeaponStatBonuses(ironSword);
    expect(bonuses).toEqual([]);
  });
});

describe('Magic sword (Levin Sword)', () => {
  it('usesMagic returns true for Levin Sword', () => {
    const levin = data.weapons.find(w => w.name === 'Levin Sword');
    expect(usesMagic(levin)).toBe(true);
  });

  it('usesMagic returns false for regular sword', () => {
    const iron = data.weapons.find(w => w.name === 'Iron Sword');
    expect(usesMagic(iron)).toBe(false);
  });

  it('Levin Sword uses MAG for attack', () => {
    const levin = data.weapons.find(w => w.name === 'Levin Sword');
    const unit = makeUnit({ stats: { ...makeUnit().stats, STR: 5, MAG: 15 } });
    const atk = calculateAttack(unit, levin);
    // Should use MAG (15) not STR (5)
    expect(atk).toBe(15 + levin.might);
  });

  it('Levin Sword targets RES for defense', () => {
    const levin = data.weapons.find(w => w.name === 'Levin Sword');
    const defender = makeUnit({ stats: { ...makeUnit().stats, DEF: 10, RES: 2 } });
    const def = calculateDefense(defender, levin);
    // Should use RES (2) not DEF (10)
    expect(def).toBe(2);
  });
});

// ─── Wave 3: Bolting Per-Battle Uses ───

describe('Per-battle weapon uses (Bolting)', () => {
  it('Bolting has perBattleUses flag', () => {
    const bolting = data.weapons.find(w => w.name === 'Bolting');
    expect(bolting.perBattleUses).toBe(true);
    expect(bolting.uses).toBe(1);
  });

  it('getPerBattleMaxUses includes MAG bonus', () => {
    const bolting = structuredClone(data.weapons.find(w => w.name === 'Bolting'));
    const unit = makeUnit({ stats: { ...makeUnit().stats, MAG: 14 } });
    const maxUses = getPerBattleMaxUses(bolting, unit);
    // Base 1 + bonuses at MAG 8 (+1) and MAG 14 (+1) = 3
    expect(maxUses).toBe(3);
  });

  it('spendPerBattleUse tracks usage', () => {
    const bolting = structuredClone(data.weapons.find(w => w.name === 'Bolting'));
    const unit = makeUnit({ stats: { ...makeUnit().stats, MAG: 5 } });
    expect(getPerBattleRemainingUses(bolting, unit)).toBe(1);
    spendPerBattleUse(bolting);
    expect(getPerBattleRemainingUses(bolting, unit)).toBe(0);
  });
});

// ─── Wave 3: New Combat Skills ───

describe('isInitiating combat mods', () => {
  it('Death Blow gives +6 ATK when initiating', () => {
    const unit = makeUnit({ skills: ['death_blow'], col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, true);
    expect(mods.atkBonus).toBe(6);
  });

  it('Death Blow gives 0 ATK when defending', () => {
    const unit = makeUnit({ skills: ['death_blow'], col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, false);
    expect(mods.atkBonus).toBe(0);
  });

  it('Darting Blow gives +6 SPD when initiating', () => {
    const unit = makeUnit({ skills: ['darting_blow'], col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, true);
    expect(mods.spdBonus).toBe(6);
  });

  it('Spell Harmony gives +ATK per adjacent allied player unit when initiating', () => {
    const unit = makeUnit({ skills: ['spell_harmony'], col: 0, row: 0, faction: 'player' });
    const allyA = makeUnit({ name: 'AllyA', col: 1, row: 0, faction: 'player' });
    const allyB = makeUnit({ name: 'AllyB', col: 0, row: 1, faction: 'player' });
    const allyFar = makeUnit({ name: 'AllyFar', col: 3, row: 3, faction: 'player' });
    const allyNpc = makeUnit({ name: 'NpcAlly', col: -1, row: 0, faction: 'npc' });
    const enemy = makeUnit({ faction: 'enemy', col: 2, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit, allyA, allyB, allyFar, allyNpc], [enemy], data.skills, null, true);
    expect(mods.atkBonus).toBe(2);
  });
});

describe('Desperation combat mod', () => {
  it('activates below 50% HP', () => {
    const unit = makeUnit({ skills: ['desperation'], currentHP: 5, col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, true);
    expect(mods.desperation).toBe(true);
  });

  it('does not activate above 50% HP', () => {
    const unit = makeUnit({ skills: ['desperation'], currentHP: 20, col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, true);
    expect(mods.desperation).toBe(false);
  });
});

describe('Quick Riposte combat mod', () => {
  it('activates above 50% HP when defending', () => {
    const unit = makeUnit({ skills: ['quick_riposte'], currentHP: 20, col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, false);
    expect(mods.quickRiposte).toBe(true);
  });

  it('does not activate when initiating', () => {
    const unit = makeUnit({ skills: ['quick_riposte'], currentHP: 20, col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, true);
    expect(mods.quickRiposte).toBe(false);
  });

  it('does not activate below 50% HP', () => {
    const unit = makeUnit({ skills: ['quick_riposte'], currentHP: 5, col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, false);
    expect(mods.quickRiposte).toBe(false);
  });
});

describe('Cancel on-defend skill', () => {
  it('rollDefenseSkills includes cancelFollowUp field', () => {
    const defender = makeUnit({ skills: ['cancel'], stats: { ...makeUnit().stats, SPD: 100 } });
    // With SPD=100, cancel should almost certainly trigger (SPD% chance)
    let triggered = false;
    for (let i = 0; i < 100; i++) {
      const result = rollDefenseSkills(defender, 10, true, data.skills);
      if (result.cancelFollowUp) { triggered = true; break; }
    }
    expect(triggered).toBe(true);
  });
});

// ─── Wave 3: Aura stat expansion ───

describe('Tactical Advantage aura', () => {
  it('applies all stat bonuses to adjacent allies', () => {
    const auraUnit = makeUnit({ name: 'Kira', skills: ['tactical_advantage'], col: 0, row: 0 });
    const ally = makeUnit({ name: 'Ally', skills: [], col: 1, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 3, row: 0 });
    const mods = getSkillCombatMods(ally, enemy, [auraUnit, ally], [enemy], data.skills, null, true);
    expect(mods.atkBonus).toBe(3);
    expect(mods.defBonus).toBe(3);
    expect(mods.resBonus).toBe(3);
    expect(mods.hitBonus).toBe(6);
    expect(mods.avoidBonus).toBe(6);
    expect(mods.critBonus).toBe(1);
  });
});

// ─── Wave 4: Canto / ClassInnate Array ───

describe('getClassInnateSkills with array classInnate', () => {
  it('returns canto for Paladin', () => {
    const skills = getClassInnateSkills('Paladin', data.skills);
    expect(skills).toContain('canto');
  });

  it('returns canto for Falcon Knight', () => {
    const skills = getClassInnateSkills('Falcon Knight', data.skills);
    expect(skills).toContain('canto');
  });

  it('does not return canto for Swordmaster', () => {
    const skills = getClassInnateSkills('Swordmaster', data.skills);
    expect(skills).not.toContain('canto');
  });

  it('still returns string classInnate skills correctly', () => {
    const skills = getClassInnateSkills('Swordmaster', data.skills);
    expect(skills).toContain('crit_plus_15');
  });
});

// ─── Wave 5: Random Legendary Weapon ───

describe('generateRandomLegendary', () => {
  it('generates a weapon with Legend tier', () => {
    const weapon = generateRandomLegendary(data.weapons);
    expect(weapon).not.toBeNull();
    expect(weapon.tier).toBe('Legend');
    expect(weapon.rankRequired).toBe('Prof');
    expect(weapon.price).toBe(0);
    expect(weapon._isRandomLegendary).toBe(true);
  });

  it('generates a valid weapon type', () => {
    const validTypes = ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light'];
    for (let i = 0; i < 20; i++) {
      const weapon = generateRandomLegendary(data.weapons);
      expect(validTypes).toContain(weapon.type);
    }
  });

  it('has a name from the legendary name pool', () => {
    const names = ['Zenith', 'Tempest', 'Eclipse', 'Solstice', 'Exodus',
      'Apex', 'Nemesis', 'Harbinger', 'Radiance', 'Terminus'];
    for (let i = 0; i < 20; i++) {
      const weapon = generateRandomLegendary(data.weapons);
      expect(names).toContain(weapon.name);
    }
  });

  it('has a special effect', () => {
    for (let i = 0; i < 20; i++) {
      const weapon = generateRandomLegendary(data.weapons);
      expect(weapon.special).toBeTruthy();
    }
  });

  it('skill-grant weapons have _grantedSkill', () => {
    let found = false;
    for (let i = 0; i < 200; i++) {
      const weapon = generateRandomLegendary(data.weapons);
      if (weapon._grantedSkill) {
        found = true;
        expect(['sol', 'luna', 'vantage', 'wrath', 'adept']).toContain(weapon._grantedSkill);
        expect(weapon.special).toMatch(/Grants .+ to wielder/);
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe('Random legendary in RunManager', () => {
  it('startRun generates randomLegendary', () => {
    const rm = new RunManager(data);
    rm.startRun();
    expect(rm.randomLegendary).not.toBeNull();
    expect(rm.randomLegendary.tier).toBe('Legend');
  });

  it('serializes and deserializes randomLegendary', () => {
    const rm = new RunManager(data);
    rm.startRun();
    const json = rm.toJSON();
    expect(json.randomLegendary).toBeDefined();
    const rm2 = RunManager.fromJSON(json, data);
    expect(rm2.randomLegendary).toEqual(rm.randomLegendary);
  });
});

describe('Random legendary in loot', () => {
  it('can appear in act3 loot choices', () => {
    const legend = generateRandomLegendary(data.weapons);
    let found = false;
    for (let i = 0; i < 200; i++) {
      const choices = generateLootChoices(
        'act3', data.lootTables, data.weapons, data.consumables,
        3, 0, data.accessories, data.whetstones, null, false, legend
      );
      if (choices.some(c => c.item?.name === legend.name)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

// ─── Wave 5: Weapon-granted skills ───

describe('Weapon-granted skills in combat', () => {
  it('rollStrikeSkills checks weapon._grantedSkill', () => {
    const weapon = structuredClone(data.weapons.find(w => w.name === 'Iron Sword'));
    weapon._grantedSkill = 'sol';
    const attacker = makeUnit({ weapon, skills: [], stats: { ...makeUnit().stats, SKL: 100 } });
    const target = makeUnit({ faction: 'enemy' });
    // With SKL=100, Sol should always trigger
    const result = rollStrikeSkills(attacker, 10, target, data.skills);
    expect(result.heal).toBe(10);
    expect(result.activated.some(a => a.id === 'sol')).toBe(true);
  });

  it('getSkillCombatMods checks weapon._grantedSkill', () => {
    const weapon = structuredClone(data.weapons.find(w => w.name === 'Iron Sword'));
    weapon._grantedSkill = 'vantage';
    const unit = makeUnit({ weapon, skills: [], currentHP: 5, col: 0, row: 0 });
    const enemy = makeUnit({ faction: 'enemy', col: 1, row: 0 });
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, null, false);
    expect(mods.vantage).toBe(true);
  });

  it('checkAstra checks weapon._grantedSkill', () => {
    const weapon = structuredClone(data.weapons.find(w => w.name === 'Iron Sword'));
    weapon._grantedSkill = 'astra';
    const attacker = makeUnit({ weapon, skills: [], stats: { ...makeUnit().stats, SKL: 200 } });
    const result = checkAstra(attacker, data.skills);
    expect(result.triggered).toBe(true);
  });

  it('does not duplicate skill if unit already has it', () => {
    const weapon = structuredClone(data.weapons.find(w => w.name === 'Iron Sword'));
    weapon._grantedSkill = 'sol';
    const attacker = makeUnit({ weapon, skills: ['sol'], stats: { ...makeUnit().stats, SKL: 100 } });
    const target = makeUnit({ faction: 'enemy' });
    // Should trigger once, not twice
    const result = rollStrikeSkills(attacker, 10, target, data.skills);
    const solCount = result.activated.filter(a => a.id === 'sol').length;
    expect(solCount).toBeLessThanOrEqual(1);
  });
});

// ─── Wave 6: Level 20 Personal Skills ───

describe('Level 20 personal skills in lords.json', () => {
  it('each lord has personalSkillL20 data', () => {
    for (const lord of data.lords) {
      expect(lord.personalSkillL20).toBeDefined();
      expect(lord.personalSkillL20.skillId).toBeTruthy();
      expect(lord.personalSkillL20.level).toBe(20);
    }
  });

  it('Edric has commanders_gambit', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    expect(edric.personalSkillL20.skillId).toBe('commanders_gambit');
  });

  it('Kira has tactical_advantage', () => {
    const kira = data.lords.find(l => l.name === 'Kira');
    expect(kira.personalSkillL20.skillId).toBe('tactical_advantage');
  });

  it('Voss has aether', () => {
    const voss = data.lords.find(l => l.name === 'Voss');
    expect(voss.personalSkillL20.skillId).toBe('aether');
  });

  it('Sera has flare', () => {
    const sera = data.lords.find(l => l.name === 'Sera');
    expect(sera.personalSkillL20.skillId).toBe('flare');
  });
});

describe('L20 skill learning', () => {
  it('createLordUnit stores _personalSkillL20', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    const cls = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, cls, data.weapons);
    expect(unit._personalSkillL20).toEqual({ skillId: 'commanders_gambit', level: 20 });
  });

  it('checkLevelUpSkills learns personal skill at base class level 20', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    const cls = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, cls, data.weapons);
    unit.level = 20;
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).toContain('commanders_gambit');
    expect(unit.skills).toContain('commanders_gambit');
  });

  it('checkLevelUpSkills learns personal skill at promoted class level 10', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    const cls = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, cls, data.weapons);
    unit.tier = 'promoted';
    unit.level = 10;
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).toContain('commanders_gambit');
    expect(unit.skills).toContain('commanders_gambit');
  });

  it('does not learn personal skill below base level 20', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    const cls = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, cls, data.weapons);
    unit.level = 19;
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).not.toContain('commanders_gambit');
  });

  it('does not learn personal skill below promoted level 10', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    const cls = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, cls, data.weapons);
    unit.tier = 'promoted';
    unit.level = 9;
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).not.toContain('commanders_gambit');
  });

  it('does not double-learn if already known', () => {
    const edric = data.lords.find(l => l.name === 'Edric');
    const cls = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, cls, data.weapons);
    unit.level = 20;
    unit.skills.push('commanders_gambit');
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).not.toContain('commanders_gambit');
    // Should still only have one copy
    expect(unit.skills.filter(s => s === 'commanders_gambit').length).toBe(1);
  });
});

// ─── Wave 6: Aether / Flare / Commander's Gambit in rollStrikeSkills ───

describe('Aether skill', () => {
  it('triggers Sol heal + extra strike flag', () => {
    const attacker = makeUnit({ skills: ['aether'], stats: { ...makeUnit().stats, SKL: 100 } });
    const target = makeUnit({ faction: 'enemy' });
    const result = rollStrikeSkills(attacker, 10, target, data.skills);
    expect(result.heal).toBe(10); // Sol heal
    expect(result.extraStrike).toBe(true);
    expect(result.aetherLuna).toBe(true);
    expect(result.activated.some(a => a.id === 'aether')).toBe(true);
  });
});

describe('Flare skill', () => {
  it('negates RES and drains HP', () => {
    const attacker = makeUnit({ skills: ['flare'], stats: { ...makeUnit().stats, SKL: 100 } });
    const target = makeUnit({ faction: 'enemy', stats: { ...makeUnit().stats, RES: 8 } });
    const result = rollStrikeSkills(attacker, 10, target, data.skills);
    expect(result.modifiedDamage).toBe(10 + 8); // normalDamage + target RES
    expect(result.heal).toBe(18); // drain equal to modified damage
    expect(result.activated.some(a => a.id === 'flare')).toBe(true);
  });
});

describe("Commander's Gambit skill", () => {
  it('sets commandersGambit flag', () => {
    const attacker = makeUnit({ skills: ['commanders_gambit'], stats: { ...makeUnit().stats, SKL: 200 } });
    const target = makeUnit({ faction: 'enemy' });
    const result = rollStrikeSkills(attacker, 10, target, data.skills);
    expect(result.commandersGambit).toBe(true);
    expect(result.activated.some(a => a.id === 'commanders_gambit')).toBe(true);
  });
});

// ─── Wave 1: Weapon Data Verification ───

describe('Sword hit +5 applied', () => {
  it('Iron Sword has hit 95', () => {
    const w = data.weapons.find(w => w.name === 'Iron Sword');
    expect(w.hit).toBe(95);
  });

  it('Steel Sword has hit 85', () => {
    const w = data.weapons.find(w => w.name === 'Steel Sword');
    expect(w.hit).toBe(85);
  });
});

describe('Brave weapon weight increase', () => {
  it('Brave Sword weight is 8', () => {
    const w = data.weapons.find(w => w.name === 'Brave Sword');
    expect(w.weight).toBe(8);
  });

  it('Brave Lance weight is 11', () => {
    const w = data.weapons.find(w => w.name === 'Brave Lance');
    expect(w.weight).toBe(11);
  });
});

describe('New standard weapons exist', () => {
  const expected = ['Wo Dao', 'Wind Sword', 'Tempest Blade', 'Short Axe', 'Killer Axe', 'Killer Bow'];
  for (const name of expected) {
    it(`${name} exists in weapons data`, () => {
      expect(data.weapons.find(w => w.name === name)).toBeTruthy();
    });
  }
});

describe('Renamed weapons', () => {
  it('Ragnarok exists with might 14', () => {
    const w = data.weapons.find(w => w.name === 'Ragnarok');
    expect(w).toBeTruthy();
    expect(w.might).toBe(14);
  });

  it('Soulreaver exists', () => {
    expect(data.weapons.find(w => w.name === 'Soulreaver')).toBeTruthy();
  });

  it('Venin Blade exists with might 8', () => {
    const w = data.weapons.find(w => w.name === 'Venin Blade');
    expect(w).toBeTruthy();
    expect(w.might).toBe(8);
  });

  it('old names do not exist', () => {
    expect(data.weapons.find(w => w.name === 'Ragnell')).toBeFalsy();
    expect(data.weapons.find(w => w.name === 'Runesword')).toBeFalsy();
    expect(data.weapons.find(w => w.name === 'Venin Edge')).toBeFalsy();
  });
});

// ─── Data Integrity ───

describe('Skills data integrity', () => {
  const expectedSkills = [
    'cancel', 'desperation', 'quick_riposte', 'death_blow', 'darting_blow',
    'shove', 'pull', 'canto',
    'commanders_gambit', 'tactical_advantage', 'aether', 'flare', 'spell_harmony',
  ];
  for (const id of expectedSkills) {
    it(`skill ${id} exists in skills.json`, () => {
      expect(data.skills.find(s => s.id === id)).toBeTruthy();
    });
  }
});

describe('Scroll weapons exist for new skills', () => {
  const expectedScrolls = [
    'Cancel Scroll', 'Desperation Scroll', 'Quick Riposte Scroll',
    'Death Blow Scroll', 'Darting Blow Scroll', 'Shove Scroll', 'Pull Scroll',
  ];
  for (const name of expectedScrolls) {
    it(`${name} exists as a scroll weapon`, () => {
      const w = data.weapons.find(w => w.name === name);
      expect(w).toBeTruthy();
      expect(w.type).toBe('Scroll');
    });
  }
});
