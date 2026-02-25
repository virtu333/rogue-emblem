import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateBossRecruitCandidates,
  createBossLordUnit,
} from '../src/engine/BossRecruitSystem.js';
import { BASE_CLASS_LEVEL_CAP } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const STARTING_LORDS = new Set(['Edric', 'Sera']);
const RECRUITABLE_LORD_NAMES = gameData.lords
  .map((l) => l.name)
  .filter((n) => !STARTING_LORDS.has(n));

function withNoAvailableLords(roster) {
  return [
    ...roster,
    ...RECRUITABLE_LORD_NAMES.map((name) => ({
      name,
      className: 'Lord',
      isLord: true,
      level: 5,
      faction: 'player',
    })),
  ];
}

describe('Boss Recruit Level Scaling', () => {
  let mathRandomSpy;

  afterEach(() => {
    if (mathRandomSpy) mathRandomSpy.mockRestore();
  });

  describe('promoted-source roll outcomes', () => {
    it('low roll keeps promoted source and preserves promoted-level target behavior', () => {
      const roster = withNoAvailableLords([
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 5,
          tier: 'promoted',
          faction: 'player',
        },
      ]);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      expect(candidates).not.toBeNull();
      for (const c of candidates) {
        expect(c.unit.tier).toBe('promoted');
        expect(c.unit.level).toBe(5);
      }
    });

    it('high roll downgrades promoted source to base with fail-level formula', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const roster = withNoAvailableLords([
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 5,
          tier: 'promoted',
          faction: 'player',
        },
      ]);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Mercenary');
      expect(candidates[0].unit.tier).toBe('base');
      // failBaseLevel = min(target 15, dynamic 15, cap 20) - 1 = 14
      expect(candidates[0].unit.level).toBe(14);
    });

    it('uses class-tier gating instead of act gating for promotion eligibility', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act2.pool = [{ className: 'Hero', name: 'Dante' }];
      const roster = withNoAvailableLords([
        { name: 'Edric', className: 'Lord', isLord: true, level: 12, faction: 'player' },
      ]);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      // Act 1 boss normally pulls act2 pool; promoted class should still be eligible by class-tier.
      const candidates = generateBossRecruitCandidates(0, roster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Hero');
      expect(candidates[0].unit.tier).toBe('promoted');
    });
  });

  describe('level anchoring', () => {
    it('uses Edric promoted level target even when another lord has higher base level', () => {
      const roster = withNoAvailableLords([
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
      ]);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      expect(candidates).not.toBeNull();
      for (const c of candidates) {
        expect(c.unit.level).toBe(3);
      }
    });

    it('unpromoted Edric target remains unchanged in act1 base path', () => {
      const roster = withNoAvailableLords([
        { name: 'Edric', className: 'Lord', isLord: true, level: 12, faction: 'player' },
        { name: 'Sera', className: 'Light Sage', isLord: true, level: 9, faction: 'player' },
      ]);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      for (const c of candidates) {
        expect(c.unit.level).toBe(12);
      }
    });
  });

  describe('promoted vs base-scale sanity', () => {
    it('promoted-source success path is stronger than base-edric comparison case', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const promotedRoster = withNoAvailableLords([
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 3,
          tier: 'promoted',
          faction: 'player',
        },
      ]);
      const baseRoster = withNoAvailableLords([
        {
          name: 'Edric',
          className: 'Lord',
          isLord: true,
          level: 3,
          tier: 'base',
          faction: 'player',
        },
      ]);

      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const promotedCandidates = generateBossRecruitCandidates(1, promotedRoster, localData, null);
      mathRandomSpy.mockRestore();
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const baseCandidates = generateBossRecruitCandidates(1, baseRoster, localData, null);

      const promotedUnit = promotedCandidates[0].unit;
      const baseUnit = baseCandidates[0].unit;
      const promotedTotal =
        promotedUnit.stats.HP +
        promotedUnit.stats.STR +
        promotedUnit.stats.SKL +
        promotedUnit.stats.SPD +
        promotedUnit.stats.DEF;
      const baseTotal =
        baseUnit.stats.HP +
        baseUnit.stats.STR +
        baseUnit.stats.SKL +
        baseUnit.stats.SPD +
        baseUnit.stats.DEF;
      expect(promotedTotal).toBeGreaterThan(baseTotal + 10);
    });

    it('unpromoted recruits are still capped at BASE_CLASS_LEVEL_CAP', () => {
      const roster = withNoAvailableLords([
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 3,
          tier: 'promoted',
          faction: 'player',
        },
      ]);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
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
