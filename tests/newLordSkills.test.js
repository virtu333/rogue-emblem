import { describe, it, expect, afterEach } from 'vitest';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
} from '../src/engine/SkillSystem.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const skillsData = gameData.skills;

function makeSkillCtx(atkSkills, defSkills, sData) {
  return {
    atkMods: null,
    defMods: null,
    rollStrikeSkills,
    rollDefenseSkills,
    skillsData: sData,
  };
}

// --- Helpers ---

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    faction: 'player',
    skills: [],
    stats: { HP: 30, STR: 10, MAG: 5, SKL: 20, SPD: 10, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
    currentHP: 30,
    level: 5,
    weapon: {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
      tier: 'Iron',
    },
    col: 0,
    row: 0,
    ...overrides,
  };
}

function makeEnemy(overrides = {}) {
  return {
    name: 'Enemy',
    faction: 'enemy',
    skills: [],
    stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 7, DEF: 6, RES: 10, LCK: 50, MOV: 5 },
    currentHP: 25,
    level: 3,
    weapon: {
      name: 'Iron Lance',
      type: 'Lance',
      might: 7,
      hit: 80,
      crit: 0,
      weight: 8,
      range: '1',
      tier: 'Iron',
    },
    col: 1,
    row: 0,
    ...overrides,
  };
}

let savedRandom;
afterEach(() => {
  if (savedRandom) {
    Math.random = savedRandom;
    savedRandom = null;
  }
});

function forceProc() {
  savedRandom = Math.random;
  Math.random = () => 0.0; // always proc (roll 0 < any positive chance)
}

function forceNoProc() {
  savedRandom = Math.random;
  Math.random = () => 0.99; // never proc
}

// --- Ride Down ---

describe('Ride Down (ride_down)', () => {
  it('grants +3 ATK when initiating with 3+ movement spent', () => {
    const unit = makeUnit({ skills: ['ride_down'], _movementSpent: 3 });
    const enemy = makeEnemy();
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, true);
    expect(mods.atkBonus).toBe(3);
    expect(mods.activated.some((a) => a.id === 'ride_down')).toBe(true);
  });

  it('no bonus with less than 3 movement spent', () => {
    const unit = makeUnit({ skills: ['ride_down'], _movementSpent: 2 });
    const enemy = makeEnemy();
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, true);
    expect(mods.atkBonus).toBe(0);
  });

  it('no bonus when defending (not initiating)', () => {
    const unit = makeUnit({ skills: ['ride_down'], _movementSpent: 5 });
    const enemy = makeEnemy();
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, false);
    expect(mods.atkBonus).toBe(0);
  });

  it('no bonus with zero movement', () => {
    const unit = makeUnit({ skills: ['ride_down'], _movementSpent: 0 });
    const enemy = makeEnemy();
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, true);
    expect(mods.atkBonus).toBe(0);
  });
});

// --- Skyward ---

describe('Skyward (skyward)', () => {
  it('grants +15 Avoid when no adjacent ally', () => {
    const unit = makeUnit({ skills: ['skyward'], col: 5, row: 5 });
    const enemy = makeEnemy({ col: 3, row: 3 });
    // No allies adjacent
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, false);
    expect(mods.avoidBonus).toBe(15);
  });

  it('no bonus when adjacent ally exists', () => {
    const unit = makeUnit({ skills: ['skyward'], col: 5, row: 5 });
    const ally = makeUnit({ name: 'Ally', col: 5, row: 4 }); // adjacent
    const enemy = makeEnemy({ col: 3, row: 3 });
    const mods = getSkillCombatMods(unit, enemy, [unit, ally], [enemy], skillsData, null, false);
    expect(mods.avoidBonus).toBe(0);
  });

  it('ally at distance 2 does not block skyward', () => {
    const unit = makeUnit({ skills: ['skyward'], col: 5, row: 5 });
    const ally = makeUnit({ name: 'Ally', col: 5, row: 3 }); // distance 2
    const enemy = makeEnemy({ col: 3, row: 3 });
    const mods = getSkillCombatMods(unit, enemy, [unit, ally], [enemy], skillsData, null, false);
    expect(mods.avoidBonus).toBe(15);
  });

  it('treats null allAllies as empty for adjacency checks', () => {
    const unit = makeUnit({ skills: ['skyward'], col: 5, row: 5 });
    const enemy = makeEnemy({ col: 3, row: 3 });
    const mods = getSkillCombatMods(unit, enemy, null, [enemy], skillsData, null, false);
    expect(mods.avoidBonus).toBe(15);
  });
});

// --- Draconic Aura ---

describe('Draconic Aura (draconic_aura)', () => {
  it('applies -10 Hit from enemy aura at distance 1', () => {
    const unit = makeUnit({ col: 1, row: 0 });
    const auraEnemy = makeEnemy({ skills: ['draconic_aura'], col: 0, row: 0 });
    const enemy = makeEnemy({ col: 4, row: 0 });
    const mods = getSkillCombatMods(
      unit,
      enemy,
      [unit],
      [auraEnemy, enemy],
      skillsData,
      null,
      true,
    );
    expect(mods.hitBonus).toBe(-10);
  });

  it('applies -10 Hit from enemy aura at distance 2', () => {
    const unit = makeUnit({ col: 2, row: 0 });
    const auraEnemy = makeEnemy({ skills: ['draconic_aura'], col: 0, row: 0 });
    const enemy = makeEnemy({ col: 4, row: 0 });
    const mods = getSkillCombatMods(
      unit,
      enemy,
      [unit],
      [auraEnemy, enemy],
      skillsData,
      null,
      true,
    );
    expect(mods.hitBonus).toBe(-10);
  });

  it('does not apply at distance 0 or beyond max range', () => {
    const onTileUnit = makeUnit({ col: 0, row: 0 });
    const farUnit = makeUnit({ col: 3, row: 0 });
    const auraEnemy = makeEnemy({ skills: ['draconic_aura'], col: 0, row: 0 });
    const enemy = makeEnemy({ col: 4, row: 0 });

    const onTileMods = getSkillCombatMods(
      onTileUnit,
      enemy,
      [onTileUnit],
      [auraEnemy, enemy],
      skillsData,
      null,
      true,
    );
    const farMods = getSkillCombatMods(
      farUnit,
      enemy,
      [farUnit],
      [auraEnemy, enemy],
      skillsData,
      null,
      true,
    );

    expect(onTileMods.hitBonus).toBe(0);
    expect(farMods.hitBonus).toBe(0);
  });

  it('stacks additively from multiple enemy aura sources', () => {
    const unit = makeUnit({ col: 1, row: 0 });
    const auraEnemyA = makeEnemy({ name: 'AuraA', skills: ['draconic_aura'], col: 0, row: 0 });
    const auraEnemyB = makeEnemy({ name: 'AuraB', skills: ['draconic_aura'], col: 2, row: 0 });
    const enemy = makeEnemy({ col: 4, row: 0 });
    const mods = getSkillCombatMods(
      unit,
      enemy,
      [unit],
      [auraEnemyA, auraEnemyB, enemy],
      skillsData,
      null,
      true,
    );
    expect(mods.hitBonus).toBe(-20);
  });
});

// --- Intimidate ---

describe('Intimidate (intimidate)', () => {
  it('activates on defend with always activation', () => {
    forceNoProc(); // even 99% roll should pass — activation is "always" (100%)
    const defender = makeUnit({ skills: ['intimidate'] });
    const result = rollDefenseSkills(defender, 10, true, skillsData);
    expect(result.debuffAttacker).toBeTruthy();
    expect(result.debuffAttacker.STR).toBe(-1);
    expect(result.debuffAttacker.MAG).toBe(-2);
    expect(result.debuffAttacker.SPD).toBe(-1);
    expect(result.activated.some((a) => a.id === 'intimidate')).toBe(true);
  });

  it('returns debuffEvents in resolveCombat', () => {
    forceProc(); // forces all hits to land; intimidate is "always" (100%) so it fires regardless
    const attacker = makeEnemy({ col: 0, row: 0 });
    const defender = makeUnit({
      skills: ['intimidate'],
      col: 1,
      row: 0,
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 20, SPD: 10, DEF: 8, RES: 6, LCK: 99, MOV: 5 },
      currentHP: 30,
    });
    const skillCtx = makeSkillCtx([], ['intimidate'], skillsData);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    expect(result.debuffEvents).toBeDefined();
    expect(result.debuffEvents.length).toBeGreaterThanOrEqual(1);
    const de = result.debuffEvents.find((d) => d.target === 'attacker');
    expect(de).toBeTruthy();
    expect(de.debuffs.STR).toBe(-1);
    expect(de.debuffs.MAG).toBe(-2);
    expect(de.debuffs.SPD).toBe(-1);
  });

  it('fires on 0-damage hit (gate fix)', () => {
    forceProc();
    // Attacker too weak to deal damage: STR 1 + might 5 = 6 atk vs DEF 20
    const attacker = makeEnemy({
      col: 0,
      row: 0,
      stats: { HP: 25, STR: 1, MAG: 4, SKL: 6, SPD: 7, DEF: 6, RES: 10, LCK: 50, MOV: 5 },
      weapon: {
        name: 'Iron Lance',
        type: 'Lance',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 8,
        range: '1',
        tier: 'Iron',
      },
    });
    const defender = makeUnit({
      skills: ['intimidate'],
      col: 1,
      row: 0,
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 20, SPD: 10, DEF: 20, RES: 6, LCK: 99, MOV: 5 },
      currentHP: 30,
    });
    const skillCtx = makeSkillCtx([], ['intimidate'], skillsData);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    // Verify 0 damage was dealt
    const strikes = result.events.filter(
      (e) => e.type === 'strike' && e.attacker === attacker.name,
    );
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes[0].damage).toBe(0);
    // Intimidate should still fire
    expect(result.debuffEvents).toBeDefined();
    expect(result.debuffEvents.length).toBeGreaterThanOrEqual(1);
    const de = result.debuffEvents.find((d) => d.target === 'attacker');
    expect(de).toBeTruthy();
    expect(de.debuffs.STR).toBe(-1);
  });
});

// --- Unyielding ---

describe('Unyielding (unyielding)', () => {
  it('sets preventEnemyDouble in combat mods', () => {
    const unit = makeUnit({ skills: ['unyielding'] });
    const enemy = makeEnemy();
    const mods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, false);
    expect(mods.preventEnemyDouble).toBe(true);
  });

  it('prevents enemy double in resolveCombat', () => {
    forceNoProc();
    // Fast enemy should normally double — 15 SPD vs 5 SPD (diff >= 5)
    const attacker = makeEnemy({
      col: 0,
      row: 0,
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 15, DEF: 6, RES: 10, LCK: 50, MOV: 5 },
    });
    const defender = makeUnit({
      skills: ['unyielding'],
      col: 1,
      row: 0,
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 10, SPD: 5, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
      currentHP: 30,
    });
    // defMods carries preventEnemyDouble from the skill
    const defMods = getSkillCombatMods(
      defender,
      attacker,
      [defender],
      [attacker],
      skillsData,
      null,
      false,
    );
    const skillCtx = { atkMods: null, defMods, rollStrikeSkills, rollDefenseSkills, skillsData };
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    const attackerStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attacker === attacker.name,
    );
    expect(attackerStrikes.length).toBe(1); // no double
  });

  it('does not prevent own doubling', () => {
    forceNoProc();
    const unit = makeUnit({
      skills: ['unyielding'],
      col: 0,
      row: 0,
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 10, SPD: 20, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
      currentHP: 30,
    });
    const enemy = makeEnemy({
      col: 1,
      row: 0,
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 5, DEF: 6, RES: 10, LCK: 50, MOV: 5 },
    });
    // atkMods has preventEnemyDouble — but that only prevents the OPPONENT from doubling the unit
    const atkMods = getSkillCombatMods(unit, enemy, [unit], [enemy], skillsData, null, true);
    const skillCtx = { atkMods, defMods: null, rollStrikeSkills, rollDefenseSkills, skillsData };
    const result = resolveCombat(unit, unit.weapon, enemy, enemy.weapon, 1, null, null, skillCtx);
    const unitStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attacker === unit.name,
    );
    expect(unitStrikes.length).toBe(2); // doubles normally
  });
});

// --- Divine Charge ---

describe('Divine Charge (divine_charge)', () => {
  it('on proc, returns divineCharge data in rollStrikeSkills', () => {
    forceProc();
    const unit = makeUnit({ skills: ['divine_charge'], stats: { ...makeUnit().stats, SKL: 30 } });
    const enemy = makeEnemy();
    const result = rollStrikeSkills(unit, 10, enemy, skillsData);
    expect(result.divineCharge).toBeTruthy();
    expect(result.divineCharge.percent).toBe(50);
    expect(result.divineCharge.range).toBe(3);
    expect(result.activated.some((a) => a.id === 'divine_charge')).toBe(true);
  });

  it('no proc when roll fails', () => {
    forceNoProc();
    const unit = makeUnit({ skills: ['divine_charge'], stats: { ...makeUnit().stats, SKL: 30 } });
    const enemy = makeEnemy();
    const result = rollStrikeSkills(unit, 10, enemy, skillsData);
    expect(result.divineCharge).toBeUndefined();
  });

  it('returns divineChargeHeals in resolveCombat on proc', () => {
    forceProc();
    const attacker = makeUnit({
      skills: ['divine_charge'],
      col: 0,
      row: 0,
      stats: { HP: 30, STR: 15, MAG: 5, SKL: 50, SPD: 10, DEF: 8, RES: 6, LCK: 99, MOV: 5 },
      currentHP: 30,
    });
    const enemy = makeEnemy({
      col: 1,
      row: 0,
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 7, DEF: 6, RES: 10, LCK: 99, MOV: 5 },
    });
    const skillCtx = makeSkillCtx(['divine_charge'], [], skillsData);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      enemy,
      enemy.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    expect(result.divineChargeHeals).toBeDefined();
    expect(result.divineChargeHeals.length).toBeGreaterThanOrEqual(1);
    const heal = result.divineChargeHeals[0];
    expect(heal.side).toBe('attacker');
    expect(heal.percent).toBe(50);
    expect(heal.range).toBe(3);
    expect(heal.damageDealt).toBeGreaterThan(0);
  });
});

// --- Seraph Strike ---

describe('Seraph Strike (seraph_strike)', () => {
  it('on proc, uses lower of DEF/RES for damage calc', () => {
    forceProc();
    // Target: DEF=20, RES=5, weapon is physical (Sword) → normally use DEF
    // Seraph Strike uses min(DEF, RES) = 5, so bonus = DEF - min = 15
    const attacker = makeUnit({
      skills: ['seraph_strike'],
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 30, SPD: 10, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
    });
    const enemy = makeEnemy({
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 7, DEF: 20, RES: 5, LCK: 50, MOV: 5 },
    });
    const baseDamage = 10;
    const result = rollStrikeSkills(attacker, baseDamage, enemy, skillsData);
    // modifiedDamage should be baseDamage + (DEF - min(DEF,RES)) = 10 + 15 = 25
    expect(result.modifiedDamage).toBe(25);
    expect(result.activated.some((a) => a.id === 'seraph_strike')).toBe(true);
  });

  it('no bonus when DEF equals RES', () => {
    forceProc();
    const attacker = makeUnit({
      skills: ['seraph_strike'],
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 30, SPD: 10, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
    });
    const enemy = makeEnemy({
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 7, DEF: 10, RES: 10, LCK: 50, MOV: 5 },
    });
    const result = rollStrikeSkills(attacker, 10, enemy, skillsData);
    expect(result.modifiedDamage).toBe(10); // no difference
  });

  it('magic user benefits when DEF < RES', () => {
    forceProc();
    // Magic weapon → normally uses RES. If DEF < RES, seraph_strike uses DEF instead → bonus
    const attacker = makeUnit({
      skills: ['seraph_strike'],
      weapon: {
        name: 'Fire',
        type: 'Tome',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 4,
        range: '1-2',
        tier: 'Iron',
      },
      stats: { HP: 30, STR: 5, MAG: 10, SKL: 30, SPD: 10, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
    });
    const enemy = makeEnemy({
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 7, DEF: 3, RES: 15, LCK: 50, MOV: 5 },
    });
    const baseDamage = 8;
    const result = rollStrikeSkills(attacker, baseDamage, enemy, skillsData);
    // RES=15, DEF=3, min=3, bonus = RES - min = 12
    expect(result.modifiedDamage).toBe(20);
  });

  it('no proc when roll fails', () => {
    forceNoProc();
    const attacker = makeUnit({
      skills: ['seraph_strike'],
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 30, SPD: 10, DEF: 8, RES: 6, LCK: 50, MOV: 5 },
    });
    const enemy = makeEnemy({
      stats: { HP: 25, STR: 8, MAG: 4, SKL: 6, SPD: 7, DEF: 20, RES: 5, LCK: 50, MOV: 5 },
    });
    const result = rollStrikeSkills(attacker, 10, enemy, skillsData);
    expect(result.modifiedDamage).toBe(10); // unchanged
  });
});

// --- All 6 Skills Exist in Data ---

describe('New lord skills exist in skills.json', () => {
  const expectedSkills = [
    { id: 'ride_down', trigger: 'on-combat-start' },
    { id: 'skyward', trigger: 'passive' },
    { id: 'intimidate', trigger: 'on-defend' },
    { id: 'divine_charge', trigger: 'on-attack' },
    { id: 'seraph_strike', trigger: 'on-attack' },
    { id: 'unyielding', trigger: 'passive' },
  ];

  for (const { id, trigger } of expectedSkills) {
    it(`${id} exists with trigger "${trigger}"`, () => {
      const skill = skillsData.find((s) => s.id === id);
      expect(skill).toBeTruthy();
      expect(skill.trigger).toBe(trigger);
      expect(skill.personal).toBe(true);
    });
  }
});
