// Regression tests for promoted-class spawn safety and promotion skill-cap
// reporting:
// 1. createRecruitUnit used to crash on promoted class data (no baseStats /
//    growthRanges in classes.json) — exactly the "safety fallback" paths in
//    BattleScene that exist to avoid aborting battle load.
// 2. promoteUnit silently dropped class innates when the unit was at
//    MAX_SKILLS; it now reports learned/dropped skills so the UI can tell
//    the player.

import { describe, expect, it } from 'vitest';
import {
  createRecruitUnit,
  promoteUnit,
  formatDroppedSkillsNotice,
  getSkillDisplayNames,
} from '../src/engine/UnitManager.js';
import { MAX_SKILLS, XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('createRecruitUnit with promoted class data', () => {
  const promotedClass = gameData.classes.find(
    (c) => c.tier === 'promoted' && c.promotesFrom && c.growthBonuses,
  );
  const baseClass = gameData.classes.find((c) => c.name === promotedClass.promotesFrom);

  it('spawns a promoted-class recruit without crashing (fallback spawn path)', () => {
    const unit = createRecruitUnit(
      { name: 'Fallback', className: promotedClass.name, level: 8 },
      promotedClass,
      gameData.weapons,
      null,
      null,
      null,
      gameData.classes,
    );

    expect(unit.className).toBe(promotedClass.name);
    expect(unit.tier).toBe('promoted');
    // Effective base = promotesFrom.baseStats + promotionBonuses, then leveled.
    for (const stat of XP_STAT_NAMES) {
      expect(Number.isFinite(unit.stats[stat])).toBe(true);
      const promotedBase =
        (baseClass.baseStats[stat] || 0) + (promotedClass.promotionBonuses?.[stat] || 0);
      expect(unit.stats[stat]).toBeGreaterThanOrEqual(promotedBase);
    }
    expect(unit.stats.MOV).toBe(
      (baseClass.baseStats.MOV || 0) + (promotedClass.promotionBonuses?.MOV || 0),
    );
    expect(unit.currentHP).toBe(unit.stats.HP);
  });

  it('layers promoted growthBonuses on the base class growth ranges', () => {
    const unit = createRecruitUnit(
      { name: 'Fallback', className: promotedClass.name, level: 1 },
      promotedClass,
      gameData.weapons,
      null,
      null,
      null,
      gameData.classes,
    );

    for (const [stat, bonus] of Object.entries(promotedClass.growthBonuses)) {
      const range = baseClass.growthRanges[stat];
      if (!range) continue;
      const [min, max] = range.split('-').map(Number);
      expect(unit.growths[stat]).toBeGreaterThanOrEqual(min + bonus);
      expect(unit.growths[stat]).toBeLessThanOrEqual(max + bonus);
    }
  });

  it('throws a clear error when a promoted class cannot be resolved', () => {
    expect(() =>
      createRecruitUnit(
        { name: 'Broken', className: promotedClass.name, level: 5 },
        promotedClass,
        gameData.weapons,
        null,
        null,
        null,
        null, // no classesData → promotesFrom lookup impossible
      ),
    ).toThrow(/cannot resolve base stats/);
  });

  it('base-class spawns are unchanged', () => {
    const knight = gameData.classes.find((c) => c.name === 'Knight');
    const unit = createRecruitUnit(
      { name: 'Baseline', className: 'Knight', level: 5 },
      knight,
      gameData.weapons,
      null,
      null,
      null,
      gameData.classes,
    );
    expect(unit.className).toBe('Knight');
    expect(unit.tier).toBe('base');
    expect(unit.level).toBe(5);
    expect(unit.currentHP).toBe(unit.stats.HP);
  });
});

describe('promoteUnit skill-cap reporting', () => {
  // General innately learns Pavise (classInnate in skills.json).
  const general = gameData.classes.find((c) => c.name === 'General');
  const knight = gameData.classes.find((c) => c.name === 'Knight');

  function makeKnight(skills) {
    return {
      name: 'Test Knight',
      className: 'Knight',
      tier: 'base',
      level: 10,
      xp: 0,
      skills: [...skills],
      growths: { HP: 50, STR: 40, MAG: 5, SKL: 30, SPD: 20, DEF: 45, RES: 15, LCK: 25 },
      proficiencies: [{ type: 'Lance', rank: 'Prof' }],
      stats: { ...knight.baseStats },
      currentHP: knight.baseStats.HP,
      mov: knight.baseStats.MOV,
      moveType: knight.moveType,
      weapon: null,
      inventory: [],
      faction: 'player',
    };
  }

  it('reports innates learned normally when under the cap', () => {
    const unit = makeKnight([]);
    const result = promoteUnit(unit, general, general.promotionBonuses, gameData.skills);
    expect(result.learnedSkills).toContain('pavise');
    expect(result.droppedSkills).toEqual([]);
    expect(unit.skills).toContain('pavise');
  });

  it('reports innates dropped at MAX_SKILLS instead of losing them silently', () => {
    const filler = ['adept', 'vantage', 'sol', 'luna', 'astra'].slice(0, MAX_SKILLS);
    expect(filler).toHaveLength(MAX_SKILLS);
    const unit = makeKnight(filler);

    const result = promoteUnit(unit, general, general.promotionBonuses, gameData.skills);

    expect(unit.skills).not.toContain('pavise');
    expect(result.droppedSkills).toContain('pavise');
    expect(result.learnedSkills).toEqual([]);

    const notice = formatDroppedSkillsNotice(unit.name, result.droppedSkills, gameData.skills);
    expect(notice).toContain(unit.name);
    expect(notice).toContain('Pavise');
    expect(notice).toContain('skill limit');
  });

  it('formatDroppedSkillsNotice returns null when nothing was dropped', () => {
    expect(formatDroppedSkillsNotice('X', [], gameData.skills)).toBeNull();
    expect(formatDroppedSkillsNotice('X', null, gameData.skills)).toBeNull();
  });

  it('getSkillDisplayNames falls back to the raw id for unknown skills', () => {
    expect(getSkillDisplayNames(['pavise', 'not_a_skill'], gameData.skills)).toEqual([
      'Pavise',
      'not_a_skill',
    ]);
  });
});
