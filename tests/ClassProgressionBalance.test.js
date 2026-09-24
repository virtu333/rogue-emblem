import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import {
  createRecruitUnit,
  createEnemyUnit,
  createPromotedEnemyUnit,
  checkLevelUpSkills,
  applyEnemyDifficultyModifiers,
  getClassInnateSkills,
  promoteUnit,
} from '../src/engine/UnitManager.js';
import {
  resolveDifficultyMode,
  validateDifficultyConfig,
  generateModifierSummary,
} from '../src/engine/DifficultyEngine.js';
import difficulty from '../data/difficulty.json';
const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
const recruit = (name, weapons = data.weapons) =>
  createRecruitUnit(
    { name: 'Recruit', level: 1 },
    cls(name),
    weapons,
    null,
    null,
    null,
    data.classes,
  );
afterEach(() => vi.restoreAllMocks());

describe('class progression curriculum', () => {
  it('exposes all proposed skills through player class progression', () => {
    const proposed = [
      'pavise',
      'sure_shot',
      'lethality',
      'fury',
      'crit_plus_15',
      'duelist_stance',
      'skyward',
      'draconic_aura',
      'renewal',
      'aegis',
      'intimidate',
      'colossus',
      'discipline',
      'vigilance',
      'spell_harmony',
      'ride_down',
      'armored_blow',
      'fiendish_blow',
      'skirmisher',
      'fortify_aura',
    ];
    for (const skillId of proposed) {
      const innateClass = data.classes.find((c) =>
        getClassInnateSkills(c.name, data.skills).includes(skillId),
      );
      if (innateClass) {
        const base = cls(innateClass.promotesFrom);
        expect(base, skillId).toBeTruthy();
        const unit = recruit(base.name);
        promoteUnit(unit, innateClass, innateClass.promotionBonuses, data.skills);
        expect(unit.skills).toContain(skillId);
      } else {
        const teacher = data.classes.find((c) =>
          c.learnableSkills?.some((s) => s.skillId === skillId),
        );
        expect(teacher, skillId).toBeTruthy();
        const unit = {
          className: teacher.name,
          tier: teacher.tier,
          level: 15,
          skills: [],
          faction: 'player',
        };
        expect(checkLevelUpSkills(unit, data.classes)).toContain(skillId);
      }
    }
  });
  it('teaches base skills before promotion and preserves later promoted milestones', () => {
    const unit = { className: 'Cavalier', tier: 'base', level: 9, skills: [], faction: 'player' };
    expect(checkLevelUpSkills(unit, data.classes)).toEqual([]);
    unit.level = 10;
    expect(checkLevelUpSkills(unit, data.classes)).toContain('sol');
    unit.className = 'Paladin';
    unit.tier = 'promoted';
    unit.level = 5;
    expect(checkLevelUpSkills(unit, data.classes)).toEqual([]);
    expect(unit.skills).not.toContain('ride_down');
    unit.level = 10;
    expect(checkLevelUpSkills(unit, data.classes)).toContain('ride_down');
  });
  it('never bypasses enemy assignment through player level-up curricula', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const unit = createPromotedEnemyUnit(
      cls('Paladin'),
      25,
      data.weapons,
      1,
      data.skills,
      'act3',
      data.classes,
    );
    expect(unit.skills).toContain('aegis');
    expect(unit.skills).not.toContain('ride_down');
    expect(unit.skills).not.toContain('sol');
    expect(checkLevelUpSkills(unit, data.classes)).toEqual([]);
  });
});

describe('recruit and enemy class balance', () => {
  it.each(['Fighter', 'Warrior'])('%s recruits receive a cloned Hand Axe', (name) => {
    const unit = recruit(name);
    const axe = unit.inventory.find((w) => w.name === 'Hand Axe');
    expect(axe).toBeTruthy();
    expect(axe).not.toBe(data.weapons.find((w) => w.name === 'Hand Axe'));
  });
  it('does not grant a Hand Axe to other axe classes or enemies and tolerates missing data', () => {
    expect(recruit('Wyvern Rider').inventory.some((w) => w.name === 'Hand Axe')).toBe(false);
    expect(
      createEnemyUnit(cls('Fighter'), 1, data.weapons).inventory.some((w) => w.name === 'Hand Axe'),
    ).toBe(false);
    expect(() =>
      recruit(
        'Fighter',
        data.weapons.filter((w) => w.name !== 'Hand Axe'),
      ),
    ).not.toThrow();
    expect(recruit('Archer').inventory.some((w) => w.name === 'Longbow')).toBe(true);
  });
  it.each(['normal', 'hard', 'lunatic'])(
    '%s applies only the configured class bonus and never MOV',
    (mode) => {
      const config = resolveDifficultyMode(difficulty, mode).modifiers;
      const delta = config.classStatBonuses.Fighter || 0;
      const unit = {
        className: 'Fighter',
        stats: { HP: 20, STR: 5, MAG: 1, SKL: 4, SPD: 4, DEF: 3, RES: 2, LCK: 2, MOV: 5 },
        currentHP: 20,
      };
      const control = structuredClone(unit);
      control.className = 'Mage';
      applyEnemyDifficultyModifiers(unit, config);
      applyEnemyDifficultyModifiers(control, config);
      expect(unit.stats.HP - control.stats.HP).toBe(delta * 2);
      expect(unit.stats.STR - control.stats.STR).toBe(delta);
      expect(unit.stats.MOV).toBe(5);
      expect(unit.currentHP).toBe(unit.stats.HP);
    },
  );
  it('validates and explains per-class difficulty bonuses', () => {
    expect(validateDifficultyConfig(difficulty).valid).toBe(true);
    expect(generateModifierSummary(difficulty.modes.hard)).toContain('Enemy Fighter stats +1');
    const invalid = structuredClone(difficulty);
    invalid.modes.normal.classStatBonuses = { Fighter: -1 };
    expect(validateDifficultyConfig(invalid).valid).toBe(false);
  });
  it('trims Dancer offense while preserving its survival growths', () => {
    const ranges = cls('Dancer').growthRanges;
    expect(ranges).toMatchObject({
      HP: '40-55',
      SPD: '60-75',
      LCK: '50-65',
      DEF: '10-20',
      RES: '30-45',
    });
    const total = Object.values(ranges).reduce(
      (sum, r) =>
        sum +
        r
          .split('-')
          .map(Number)
          .reduce((a, b) => a + b) /
          2,
      0,
    );
    expect(total).toBe(285);
  });
});
