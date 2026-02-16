import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { createBossLordUnit, getAvailableLords } from '../src/engine/BossRecruitSystem.js';

const gameData = loadGameData();

function getClassData(lord) {
  const cls = gameData.classes.find(c => c.name === lord.class);
  if (!cls) throw new Error(`Class "${lord.class}" not found in classes.json`);
  return cls;
}

const NEW_LORDS = ['Rowan', 'Astrid', 'Cael'];
const NEW_BASE_CLASSES = ['Chevalier', 'Sky Lancer', 'Sentinel'];
const NEW_PROMOTED_CLASSES = ['Holy Knight', 'Seraph Knight', 'Champion'];

describe('New Lords — Data Integrity', () => {
  it('all 3 lords exist in lords.json', () => {
    const lordNames = gameData.lords.map(l => l.name);
    for (const name of NEW_LORDS) {
      expect(lordNames).toContain(name);
    }
  });

  it('6 new classes exist in classes.json', () => {
    const classNames = gameData.classes.map(c => c.name);
    for (const name of [...NEW_BASE_CLASSES, ...NEW_PROMOTED_CLASSES]) {
      expect(classNames).toContain(name);
    }
  });

  it('base classes have correct tier and promotesTo', () => {
    const pairs = [
      ['Chevalier', 'Holy Knight'],
      ['Sky Lancer', 'Seraph Knight'],
      ['Sentinel', 'Champion'],
    ];
    for (const [base, promoted] of pairs) {
      const cls = gameData.classes.find(c => c.name === base);
      expect(cls.tier).toBe('base');
      expect(cls.promotesTo).toBe(promoted);
      expect(cls.moveType).toBeTruthy();
      expect(cls.weaponProficiencies).toBeTruthy();
    }
  });

  it('promoted classes have correct tier and promotesFrom', () => {
    const pairs = [
      ['Holy Knight', 'Chevalier'],
      ['Seraph Knight', 'Sky Lancer'],
      ['Champion', 'Sentinel'],
    ];
    for (const [promoted, base] of pairs) {
      const cls = gameData.classes.find(c => c.name === promoted);
      expect(cls.tier).toBe('promoted');
      expect(cls.promotesFrom).toBe(base);
      expect(cls.promotionBonuses).toBeTruthy();
    }
  });

  it('lord class matches base class', () => {
    const lordClassMap = { Rowan: 'Chevalier', Astrid: 'Sky Lancer', Cael: 'Sentinel' };
    for (const [name, cls] of Object.entries(lordClassMap)) {
      const lord = gameData.lords.find(l => l.name === name);
      expect(lord.class).toBe(cls);
    }
  });

  it('lord promotedClass matches promoted class', () => {
    const map = { Rowan: 'Holy Knight', Astrid: 'Seraph Knight', Cael: 'Champion' };
    for (const [name, promoted] of Object.entries(map)) {
      const lord = gameData.lords.find(l => l.name === name);
      expect(lord.promotedClass).toBe(promoted);
    }
  });

  it('Rowan moveType is Cavalry', () => {
    const lord = gameData.lords.find(l => l.name === 'Rowan');
    expect(lord.moveType).toBe('Cavalry');
  });

  it('Astrid moveType is Flying', () => {
    const lord = gameData.lords.find(l => l.name === 'Astrid');
    expect(lord.moveType).toBe('Flying');
  });

  it('Cael moveType is Infantry', () => {
    const lord = gameData.lords.find(l => l.name === 'Cael');
    expect(lord.moveType).toBe('Infantry');
  });

  it('Canto classInnate includes Holy Knight and Seraph Knight', () => {
    const canto = gameData.skills.find(s => s.id === 'canto');
    expect(canto.classInnate).toContain('Holy Knight');
    expect(canto.classInnate).toContain('Seraph Knight');
  });

  it('each lord has personalSkillL20', () => {
    const expected = {
      Rowan: 'divine_charge',
      Astrid: 'seraph_strike',
      Cael: 'unyielding',
    };
    for (const [name, skillId] of Object.entries(expected)) {
      const lord = gameData.lords.find(l => l.name === name);
      expect(lord.personalSkillL20).toBeTruthy();
      expect(lord.personalSkillL20.skillId).toBe(skillId);
    }
  });
});

describe('New Lords — Unit Creation', () => {
  it('createBossLordUnit works for Rowan', () => {
    const lord = gameData.lords.find(l => l.name === 'Rowan');
    const classData = getClassData(lord);
    expect(classData).toBeTruthy();
    const unit = createBossLordUnit(lord, classData, gameData.weapons, 5, null);
    expect(unit.name).toBe('Rowan');
    expect(unit.className).toBe('Chevalier');
    expect(unit.isLord).toBe(true);
    expect(unit.level).toBeGreaterThanOrEqual(1);
    expect(unit.weapon).toBeTruthy();
    expect(unit.weapon.type).toBe('Lance');
  });

  it('createBossLordUnit works for Astrid', () => {
    const lord = gameData.lords.find(l => l.name === 'Astrid');
    const classData = getClassData(lord);
    expect(classData).toBeTruthy();
    const unit = createBossLordUnit(lord, classData, gameData.weapons, 5, null);
    expect(unit.name).toBe('Astrid');
    expect(unit.className).toBe('Sky Lancer');
    expect(unit.isLord).toBe(true);
    expect(unit.weapon).toBeTruthy();
    expect(unit.weapon.type).toBe('Lance');
  });

  it('createBossLordUnit works for Cael', () => {
    const lord = gameData.lords.find(l => l.name === 'Cael');
    const classData = getClassData(lord);
    expect(classData).toBeTruthy();
    const unit = createBossLordUnit(lord, classData, gameData.weapons, 5, null);
    expect(unit.name).toBe('Cael');
    expect(unit.className).toBe('Sentinel');
    expect(unit.isLord).toBe(true);
    expect(unit.weapon).toBeTruthy();
    expect(unit.weapon.type).toBe('Axe');
  });

  it('personal skills are assigned on creation', () => {
    const expected = {
      Rowan: 'ride_down',
      Astrid: 'skyward',
      Cael: 'intimidate',
    };
    for (const [name, skillId] of Object.entries(expected)) {
      const lord = gameData.lords.find(l => l.name === name);
      const classData = getClassData(lord);
      expect(classData).toBeTruthy();
      const unit = createBossLordUnit(lord, classData, gameData.weapons, 1, null);
      expect(unit.skills).toContain(skillId);
    }
  });

  it('leveling works correctly', () => {
    const lord = gameData.lords.find(l => l.name === 'Rowan');
    const classData = getClassData(lord);
    expect(classData).toBeTruthy();
    const unit = createBossLordUnit(lord, classData, gameData.weapons, 10, null);
    expect(unit.level).toBeGreaterThanOrEqual(5);
    // HP should be higher than base after leveling
    expect(unit.stats.HP).toBeGreaterThanOrEqual(lord.baseStats.HP);
  });

  it('meta effects apply lord stat bonuses', () => {
    const lord = gameData.lords.find(l => l.name === 'Cael');
    const classData = getClassData(lord);
    expect(classData).toBeTruthy();
    const baseUnit = createBossLordUnit(lord, classData, gameData.weapons, 1, null);
    const metaUnit = createBossLordUnit(lord, classData, gameData.weapons, 1, {
      lordStatBonuses: { STR: 3, DEF: 2 },
    });
    expect(metaUnit.stats.STR).toBe(baseUnit.stats.STR + 3);
    expect(metaUnit.stats.DEF).toBe(baseUnit.stats.DEF + 2);
  });
});

describe('New Lords — Recruit Pool', () => {
  it('all 3 appear in getAvailableLords with empty recruit pool', () => {
    const baseRoster = [
      { name: 'Edric', isLord: true },
      { name: 'Sera', isLord: true },
    ];
    const available = getAvailableLords(baseRoster, gameData.lords);
    const names = available.map(l => l.name);
    for (const name of NEW_LORDS) {
      expect(names).toContain(name);
    }
  });

  it('recruited lord excluded from pool', () => {
    const roster = [
      { name: 'Edric', isLord: true },
      { name: 'Sera', isLord: true },
      { name: 'Rowan', isLord: true },
    ];
    const available = getAvailableLords(roster, gameData.lords);
    const names = available.map(l => l.name);
    expect(names).not.toContain('Rowan');
    expect(names).toContain('Astrid');
    expect(names).toContain('Cael');
  });

  it('fallen lord excluded from pool', () => {
    const roster = [
      { name: 'Edric', isLord: true },
      { name: 'Sera', isLord: true },
    ];
    const fallen = [{ name: 'Astrid' }];
    const available = getAvailableLords(roster, gameData.lords, fallen);
    const names = available.map(l => l.name);
    expect(names).not.toContain('Astrid');
    expect(names).toContain('Rowan');
    expect(names).toContain('Cael');
  });
});
