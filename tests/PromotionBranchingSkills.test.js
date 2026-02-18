import { describe, it, expect, vi } from 'vitest';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  getTerrainCostReduction,
} from '../src/engine/SkillSystem.js';
import {
  createEnemyUnit,
  promoteUnit,
  levelUp,
} from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    col: 3, row: 3,
    stats: { HP: 30, STR: 12, MAG: 5, SKL: 10, SPD: 12, DEF: 8, RES: 5, LCK: 5, MOV: 5 },
    currentHP: 30,
    skills: [],
    moveType: 'Infantry',
    weapon: { type: 'Sword', range: '1', might: 5, hit: 90, crit: 0, weight: 5 },
    proficiencies: [{ type: 'Swords', rank: 'Prof' }],
    accessory: null,
    ...overrides,
  };
}

function makeOpponent(overrides = {}) {
  return makeUnit({ name: 'Opponent', col: 4, row: 3, ...overrides });
}

describe('Defending condition (Duelist Stance)', () => {
  it('grants bonuses when defending (not initiating)', () => {
    const unit = makeUnit({ skills: ['duelist_stance'] });
    const opp = makeOpponent();
    const mods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, false);
    expect(mods.avoidBonus).toBe(10);
    expect(mods.defBonus).toBe(1);
    expect(mods.resBonus).toBe(1);
  });

  it('does NOT grant bonuses when initiating', () => {
    const unit = makeUnit({ skills: ['duelist_stance'] });
    const opp = makeOpponent();
    const mods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(mods.avoidBonus).toBe(0);
    expect(mods.defBonus).toBe(0);
    expect(mods.resBonus).toBe(0);
  });
});

describe('Fury (critScalesWithMissingHP)', () => {
  it('grants 0 crit at full HP', () => {
    const unit = makeUnit({ skills: ['fury'], currentHP: 30, stats: { ...makeUnit().stats, HP: 30 } });
    const opp = makeOpponent();
    const mods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(mods.critBonus).toBe(0);
  });

  it('grants ~15 crit at 50% HP', () => {
    const unit = makeUnit({ skills: ['fury'], currentHP: 15, stats: { ...makeUnit().stats, HP: 30 } });
    const opp = makeOpponent();
    const mods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(mods.critBonus).toBe(15);
  });

  it('grants ~30 crit at 1 HP', () => {
    const unit = makeUnit({ skills: ['fury'], currentHP: 1, stats: { ...makeUnit().stats, HP: 30 } });
    const opp = makeOpponent();
    const mods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    // floor((1 - 1/30) * 30) = floor(29/30 * 30) = floor(29) = 29
    expect(mods.critBonus).toBe(29);
  });
});

describe('Drain (on-attack, deterministic)', () => {
  it('heals 25% of damage dealt', () => {
    const unit = makeUnit({ skills: ['drain'] });
    // Force all rolls to succeed
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = rollStrikeSkills(unit, 20, makeOpponent(), data.skills);
    vi.restoreAllMocks();
    expect(result.heal).toBe(5); // floor(20 * 0.25)
    expect(result.activated.some(a => a.id === 'drain')).toBe(true);
  });

  it('heals minimum 1 even on tiny damage', () => {
    const unit = makeUnit({ skills: ['drain'] });
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = rollStrikeSkills(unit, 2, makeOpponent(), data.skills);
    vi.restoreAllMocks();
    expect(result.heal).toBe(1); // max(1, floor(2*0.25)) = max(1, 0) = 1
  });
});

describe('Blow skills (initiate-only)', () => {
  it('armored_blow grants +4 DEF when initiating', () => {
    const unit = makeUnit({ skills: ['armored_blow'] });
    const opp = makeOpponent();
    const initMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(initMods.defBonus).toBe(4);
    const defMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, false);
    expect(defMods.defBonus).toBe(0);
  });

  it('fiendish_blow grants +4 ATK when initiating', () => {
    const unit = makeUnit({ skills: ['fiendish_blow'] });
    const opp = makeOpponent();
    const initMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(initMods.atkBonus).toBe(4);
    const defMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, false);
    expect(defMods.atkBonus).toBe(0);
  });

  it('darting_blow grants +6 SPD when initiating', () => {
    const unit = makeUnit({ skills: ['darting_blow'] });
    const opp = makeOpponent();
    const initMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(initMods.spdBonus).toBe(6);
    const defMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, false);
    expect(defMods.spdBonus).toBe(0);
  });

  it('skirmisher grants +10 hit +5 avoid when initiating', () => {
    const unit = makeUnit({ skills: ['skirmisher'] });
    const opp = makeOpponent();
    const initMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, true);
    expect(initMods.hitBonus).toBe(10);
    expect(initMods.avoidBonus).toBe(5);
    const defMods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Plain' }, false);
    expect(defMods.hitBonus).toBe(0);
    expect(defMods.avoidBonus).toBe(0);
  });
});

describe('Fortify Aura (+2 DEF/RES to adjacent allies)', () => {
  it('grants bonuses to adjacent ally', () => {
    const auraUnit = makeUnit({ name: 'Monk', col: 3, row: 3, skills: ['fortify_aura'] });
    const ally = makeUnit({ name: 'Ally', col: 4, row: 3, skills: [] });
    const opp = makeOpponent({ col: 5, row: 3 });

    const mods = getSkillCombatMods(ally, opp, [auraUnit, ally], [opp], data.skills, { name: 'Plain' }, true);
    expect(mods.defBonus).toBe(2);
    expect(mods.resBonus).toBe(2);
  });

  it('does NOT grant bonuses to non-adjacent ally', () => {
    const auraUnit = makeUnit({ name: 'Monk', col: 3, row: 3, skills: ['fortify_aura'] });
    const ally = makeUnit({ name: 'Ally', col: 6, row: 3, skills: [] });
    const opp = makeOpponent({ col: 7, row: 3 });

    const mods = getSkillCombatMods(ally, opp, [auraUnit, ally], [opp], data.skills, { name: 'Plain' }, true);
    expect(mods.defBonus).toBe(0);
    expect(mods.resBonus).toBe(0);
  });
});

describe('Pathfinder (getTerrainCostReduction)', () => {
  it('returns 1 for unit with pathfinder skill', () => {
    const unit = makeUnit({ skills: ['pathfinder'] });
    expect(getTerrainCostReduction(unit, data.skills)).toBe(1);
  });

  it('returns 0 for unit without pathfinder', () => {
    const unit = makeUnit({ skills: ['vantage'] });
    expect(getTerrainCostReduction(unit, data.skills)).toBe(0);
  });

  it('returns 0 for null/empty inputs', () => {
    expect(getTerrainCostReduction(null, data.skills)).toBe(0);
    expect(getTerrainCostReduction(makeUnit(), null)).toBe(0);
  });
});

describe('Growth Bonuses on Promotion', () => {
  it('promoteUnit applies growthBonuses to unit.growths', () => {
    const cls = data.classes.find(c => c.name === 'Myrmidon');
    const promoted = data.classes.find(c => c.name === 'Swordmaster');
    const unit = createEnemyUnit(cls, 10, data.weapons);
    // Give the unit explicit growths (createEnemyUnit may not set them)
    unit.growths = { HP: 50, STR: 40, MAG: 10, SKL: 50, SPD: 55, DEF: 25, RES: 20, LCK: 30 };
    const oldSPD = unit.growths.SPD;

    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);

    expect(unit.growths.SPD).toBe(oldSPD + 5); // Swordmaster: +5% SPD
    // Other stats unchanged
    expect(unit.growths.STR).toBe(40);
  });

  it('classes without growthBonuses: growths unchanged', () => {
    const cls = data.classes.find(c => c.name === 'Cavalier');
    const promoted = data.classes.find(c => c.name === 'Paladin');
    const unit = createEnemyUnit(cls, 10, data.weapons);
    unit.growths = { HP: 50, STR: 40, MAG: 10, SKL: 50, SPD: 45, DEF: 30, RES: 20, LCK: 30 };
    const snapshot = { ...unit.growths };

    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);

    // Paladin has no growthBonuses (mobility compensation)
    expect(unit.growths).toEqual(snapshot);
  });

  it('growth bonuses affect subsequent level-ups', () => {
    const cls = data.classes.find(c => c.name === 'Knight');
    const promoted = data.classes.find(c => c.name === 'General');
    const unit = createEnemyUnit(cls, 10, data.weapons);
    unit.growths = { HP: 60, STR: 45, MAG: 5, SKL: 30, SPD: 15, DEF: 50, RES: 15, LCK: 20 };

    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);
    // General: +10% DEF, +5% HP
    expect(unit.growths.DEF).toBe(60);
    expect(unit.growths.HP).toBe(65);

    // Level up with forced growth rolls — mock before calling levelUp
    const oldDEF = unit.stats.DEF;
    const oldHP = unit.stats.HP;
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // 0.01*100=1 < 60(DEF) → +1
    const gains = levelUp(unit);
    vi.restoreAllMocks();

    // Verify gains object shows DEF gained
    expect(gains).not.toBeNull();
    expect(gains.gains.DEF).toBe(1);
    expect(gains.gains.HP).toBe(1);
  });
});

describe('sure_shot now has critBonus', () => {
  it('sure_shot grants +10 crit and ignoreTerrainAvoid (passive)', () => {
    const unit = makeUnit({ skills: ['sure_shot'] });
    const opp = makeOpponent();
    const mods = getSkillCombatMods(unit, opp, [unit], [opp], data.skills, { name: 'Forest' }, true);
    expect(mods.critBonus).toBe(10);
    expect(mods.ignoreTerrainAvoid).toBe(true);
  });
});

describe('draconic_aura is classInnate for Wyvern Lord', () => {
  it('Wyvern Lord gains draconic_aura on promotion (not at L10)', () => {
    const base = data.classes.find(c => c.name === 'Wyvern Rider');
    const promoted = data.classes.find(c => c.name === 'Wyvern Lord');
    const unit = createEnemyUnit(base, 10, data.weapons);

    expect(unit.skills).not.toContain('draconic_aura');
    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);
    expect(unit.skills).toContain('draconic_aura');
  });

  it('Wyvern Lord has no learnableSkills for draconic_aura', () => {
    const wl = data.classes.find(c => c.name === 'Wyvern Lord');
    const hasDA = wl.learnableSkills?.some(ls => ls.skillId === 'draconic_aura');
    expect(hasDA).toBeFalsy();
  });
});
