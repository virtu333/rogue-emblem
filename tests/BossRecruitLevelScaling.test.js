import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateBossRecruitCandidates,
  createBossLordUnit,
} from '../src/engine/BossRecruitSystem.js';
import { BASE_CLASS_LEVEL_CAP } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('Boss Recruit Level Scaling', () => {
  let mathRandomSpy;

  afterEach(() => {
    if (mathRandomSpy) mathRandomSpy.mockRestore();
  });

  describe('promoted lord effective level', () => {
    it('promoted Edric at level 5 sets promoted recruit level target to 5', () => {
      const roster = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 5,
          tier: 'promoted',
          faction: 'player',
        },
        {
          name: 'Sera',
          className: 'Light Sage',
          isLord: true,
          level: 8,
          tier: 'base',
          faction: 'player',
        },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      // Act 2 boss → promoted recruits
      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      expect(candidates).not.toBeNull();
      // Promoted recruit should have post-promotion levels
      // targetLevel = 25 → base leveled to 20, promoted, then 5 more promoted levels
      for (const c of candidates) {
        expect(c.unit.tier).toBe('promoted');
        expect(c.unit.level).toBe(5);
      }
    });

    it('unpromoted lord at level 12 gives targetLevel = 12 (unchanged)', () => {
      const roster = [
        { name: 'Edric', className: 'Lord', isLord: true, level: 12, faction: 'player' },
        { name: 'Sera', className: 'Light Sage', isLord: true, level: 9, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      // Act 1 boss → unpromoted recruits
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      for (const c of candidates) {
        expect(c.unit.level).toBe(12);
      }
    });

    it('uses Edric promoted level target even when another lord has higher base level', () => {
      const roster = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 3,
          tier: 'promoted',
          faction: 'player',
        },
        {
          name: 'Sera',
          className: 'Light Sage',
          isLord: true,
          level: 18,
          tier: 'base',
          faction: 'player',
        },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      // Recruit target stays Edric-anchored (promoted level target = 3).
      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      expect(candidates).not.toBeNull();
      for (const c of candidates) {
        expect(c.unit.level).toBe(3);
      }
    });
  });

  describe('promoted recruit post-promotion leveling', () => {
    it('promoted recruit gets base + promotion + extra levels when targetLevel > cap', () => {
      const roster = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 5,
          tier: 'promoted',
          faction: 'player',
        },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      // targetLevel = 25, Act 2 → promoted recruits
      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      expect(candidates).not.toBeNull();
      for (const c of candidates) {
        // Should be promoted tier at level 5 (1 + 4 post-promotion level-ups)
        expect(c.unit.tier).toBe('promoted');
        expect(c.unit.level).toBe(5);
      }
    });

    it('promoted recruit at exactly BASE_CLASS_LEVEL_CAP gets no post-promotion levels', () => {
      const roster = [
        {
          name: 'Edric',
          className: 'Lord',
          isLord: true,
          level: 20,
          tier: 'base',
          faction: 'player',
        },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      // targetLevel = 20, Act 2 → promoted recruits leveled to 20 base, promoted, no extra
      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      expect(candidates).not.toBeNull();
      for (const c of candidates) {
        expect(c.unit.tier).toBe('promoted');
        expect(c.unit.level).toBe(1); // Just promoted, no additional levels
      }
    });

    it('promoted recruit has significantly higher stats than a level-3 recruit', () => {
      // Simulates the bug scenario: lord promoted at level 3
      // Old behavior: targetLevel=3, so recruit gets 2 level-ups total
      // New behavior: targetLevel=23, so recruit gets 19 base level-ups + promotion + 3 promoted levels
      const rosterFixed = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 3,
          tier: 'promoted',
          faction: 'player',
        },
      ];
      const rosterBugged = [
        {
          name: 'Edric',
          className: 'Lord',
          isLord: true,
          level: 3,
          tier: 'base',
          faction: 'player',
        },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const fixedCandidates = generateBossRecruitCandidates(1, rosterFixed, gameData, null);
      mathRandomSpy.mockRestore();
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const buggedCandidates = generateBossRecruitCandidates(1, rosterBugged, gameData, null);

      // Find matching class
      const fixedUnit = fixedCandidates[0].unit;
      const buggedUnit = buggedCandidates.find(
        (c) => c.className === fixedCandidates[0].className,
      )?.unit;
      if (buggedUnit) {
        // Fixed unit should have dramatically higher total stats
        const fixedTotal =
          fixedUnit.stats.HP +
          fixedUnit.stats.STR +
          fixedUnit.stats.SKL +
          fixedUnit.stats.SPD +
          fixedUnit.stats.DEF;
        const buggedTotal =
          buggedUnit.stats.HP +
          buggedUnit.stats.STR +
          buggedUnit.stats.SKL +
          buggedUnit.stats.SPD +
          buggedUnit.stats.DEF;
        expect(fixedTotal).toBeGreaterThan(buggedTotal + 10);
      }
    });
  });

  describe('unpromoted recruit capping', () => {
    it('unpromoted recruit is capped at BASE_CLASS_LEVEL_CAP even if targetLevel exceeds it', () => {
      // Promoted lord → high targetLevel, but Act 1 boss → unpromoted recruits
      const roster = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 3,
          tier: 'promoted',
          faction: 'player',
        },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      // targetLevel = 23, Act 1 → unpromoted recruits, capped at 20
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      expect(candidates).not.toBeNull();
      for (const c of candidates) {
        expect(c.unit.tier).toBe('base');
        expect(c.unit.level).toBeLessThanOrEqual(BASE_CLASS_LEVEL_CAP);
      }
    });
  });

  describe('lord recruit capping', () => {
    it('lord recruit is capped at BASE_CLASS_LEVEL_CAP', () => {
      const lordDef = gameData.lords.find((l) => l.name === 'Kira');
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      // targetLevel beyond cap
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 25, null);
      expect(unit.level).toBe(BASE_CLASS_LEVEL_CAP);
      expect(unit.isLord).toBe(true);
    });

    it('lord recruit at normal level is unchanged', () => {
      const lordDef = gameData.lords.find((l) => l.name === 'Kira');
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 10, null);
      expect(unit.level).toBe(10);
    });
  });

  describe('Mercenary/Hero stat buffs', () => {
    it('Mercenary has buffed STR growth range 45-60', () => {
      const merc = gameData.classes.find((c) => c.name === 'Mercenary');
      expect(merc.growthRanges.STR).toBe('45-60');
    });

    it('Mercenary has buffed SPD growth range 42-57', () => {
      const merc = gameData.classes.find((c) => c.name === 'Mercenary');
      expect(merc.growthRanges.SPD).toBe('42-57');
    });

    it('Hero has buffed STR promotion bonus of 3', () => {
      const hero = gameData.classes.find((c) => c.name === 'Hero');
      expect(hero.promotionBonuses.STR).toBe(3);
    });

    it('Hero has buffed SPD promotion bonus of 2', () => {
      const hero = gameData.classes.find((c) => c.name === 'Hero');
      expect(hero.promotionBonuses.SPD).toBe(2);
    });
  });
});
