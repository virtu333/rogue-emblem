import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateBossRecruitCandidates, getAvailableLords, createBossLordUnit } from '../src/engine/BossRecruitSystem.js';
import { BOSS_RECRUIT_LORD_CHANCE, BOSS_RECRUIT_COUNT } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

// Minimal roster with Edric + Sera at level 8
function makeBaseRoster() {
  return [
    { name: 'Edric', className: 'Lord', isLord: true, level: 8, faction: 'player' },
    { name: 'Sera', className: 'Light Sage', isLord: true, level: 7, faction: 'player' },
  ];
}

describe('BossRecruitSystem', () => {
  let mathRandomSpy;

  afterEach(() => {
    if (mathRandomSpy) mathRandomSpy.mockRestore();
  });

  describe('getAvailableLords', () => {
    it('returns Kira and Voss when neither is in roster', () => {
      const lords = getAvailableLords(makeBaseRoster(), gameData.lords);
      const names = lords.map(l => l.name);
      expect(names).toContain('Kira');
      expect(names).toContain('Voss');
      expect(names).toHaveLength(2);
    });

    it('excludes Kira when she is in roster', () => {
      const roster = [...makeBaseRoster(), { name: 'Kira', className: 'Tactician', isLord: true, level: 5 }];
      const lords = getAvailableLords(roster, gameData.lords);
      expect(lords.map(l => l.name)).toEqual(['Voss']);
    });

    it('returns empty when both Kira and Voss are in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        { name: 'Kira', className: 'Tactician', isLord: true, level: 5 },
        { name: 'Voss', className: 'Ranger', isLord: true, level: 5 },
      ];
      expect(getAvailableLords(roster, gameData.lords)).toHaveLength(0);
    });

    it('never includes Edric or Sera', () => {
      const lords = getAvailableLords([], gameData.lords);
      const names = lords.map(l => l.name);
      expect(names).not.toContain('Edric');
      expect(names).not.toContain('Sera');
    });
  });

  describe('generateBossRecruitCandidates', () => {
    it('returns null for final boss (actIndex 3)', () => {
      expect(generateBossRecruitCandidates(3, makeBaseRoster(), gameData, null)).toBeNull();
    });

    it('returns 3 candidates for Act 1 boss (actIndex 0)', () => {
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      expect(candidates).not.toBeNull();
      expect(candidates).toHaveLength(BOSS_RECRUIT_COUNT);
    });

    it('returns 3 candidates for Act 2 boss (actIndex 1)', () => {
      const candidates = generateBossRecruitCandidates(1, makeBaseRoster(), gameData, null);
      expect(candidates).not.toBeNull();
      expect(candidates).toHaveLength(BOSS_RECRUIT_COUNT);
    });

    it('returns 3 candidates for Act 3 boss (actIndex 2)', () => {
      const candidates = generateBossRecruitCandidates(2, makeBaseRoster(), gameData, null);
      expect(candidates).not.toBeNull();
      expect(candidates).toHaveLength(BOSS_RECRUIT_COUNT);
    });

    it('Act 1 boss candidates are unpromoted (base tier)', () => {
      // Force no lord slot
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      for (const c of candidates) {
        expect(c.isLord).toBe(false);
        expect(c.unit.tier).toBe('base');
      }
    });

    it('Act 2 boss candidates are promoted', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, makeBaseRoster(), gameData, null);
      for (const c of candidates) {
        expect(c.isLord).toBe(false);
        expect(c.unit.tier).toBe('promoted');
      }
    });

    it('Act 3 boss candidates are promoted', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(2, makeBaseRoster(), gameData, null);
      for (const c of candidates) {
        expect(c.isLord).toBe(false);
        expect(c.unit.tier).toBe('promoted');
      }
    });

    it('candidates have no duplicate classNames', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      const classNames = candidates.map(c => c.className);
      expect(new Set(classNames).size).toBe(classNames.length);
    });

    it('excludes classes already in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        { name: 'Nyx', className: 'Thief', isLord: false, level: 5 },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      expect(candidates.every(c => c.className !== 'Thief')).toBe(true);
    });

    it('candidate level matches highest lord level', () => {
      const roster = [
        { name: 'Edric', className: 'Lord', isLord: true, level: 12, faction: 'player' },
        { name: 'Sera', className: 'Light Sage', isLord: true, level: 9, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      // Unpromoted units should be at level 12 (highest lord level)
      for (const c of candidates) {
        expect(c.unit.level).toBe(12);
      }
    });

    it('all candidates have faction player', () => {
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      for (const c of candidates) {
        expect(c.unit.faction).toBe('player');
      }
    });

    it('all candidates are serialized (no Phaser fields)', () => {
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      for (const c of candidates) {
        expect(c.unit.graphic).toBeNull();
        expect(c.unit.label).toBeNull();
        expect(c.unit.hpBar).toBeNull();
        expect(c.unit.hasMoved).toBe(false);
        expect(c.unit.hasActed).toBe(false);
      }
    });

    it('candidate weapons are cloned (not shared references)', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      if (candidates.length >= 2 && candidates[0].unit.weapon && candidates[1].unit.weapon) {
        // Even if same weapon name, they should be different objects
        if (candidates[0].unit.weapon.name === candidates[1].unit.weapon.name) {
          expect(candidates[0].unit.weapon).not.toBe(candidates[1].unit.weapon);
        }
      }
    });
  });

  describe('lord slot', () => {
    it('includes a lord when RNG is below threshold', () => {
      // Math.random called: first for lord chance (0.05 < 0.12), then for lord pick, then for shuffles
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05;  // lord chance check — triggers
        return 0.5;  // subsequent calls
      });
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      expect(candidates.some(c => c.isLord)).toBe(true);
    });

    it('does not include a lord when RNG is above threshold', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      expect(candidates.every(c => !c.isLord)).toBe(true);
    });

    it('lord candidate has isLord true on unit', () => {
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05;
        return 0.5;
      });
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      const lordCand = candidates.find(c => c.isLord);
      expect(lordCand).toBeTruthy();
      expect(lordCand.unit.isLord).toBe(true);
      expect(['Kira', 'Voss']).toContain(lordCand.displayName);
    });

    it('lord candidate has personal skill', () => {
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05;
        return 0.5;
      });
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      const lordCand = candidates.find(c => c.isLord);
      expect(lordCand.unit.skills.length).toBeGreaterThan(0);
    });

    it('no lord when both already in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        { name: 'Kira', className: 'Tactician', isLord: true, level: 5 },
        { name: 'Voss', className: 'Ranger', isLord: true, level: 5 },
      ];
      // Force low RNG that would trigger lord
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.01;
        return 0.5;
      });
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      expect(candidates.every(c => !c.isLord)).toBe(true);
    });
  });

  describe('createBossLordUnit', () => {
    it('creates lord at target level', () => {
      const lordDef = gameData.lords.find(l => l.name === 'Kira');
      const classData = gameData.classes.find(c => c.name === lordDef.class);
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 10, null);
      expect(unit.level).toBe(10);
      expect(unit.isLord).toBe(true);
      expect(unit.name).toBe('Kira');
    });

    it('applies lord meta stat bonuses', () => {
      const lordDef = gameData.lords.find(l => l.name === 'Voss');
      const classData = gameData.classes.find(c => c.name === lordDef.class);
      const meta = { lordStatBonuses: { STR: 3, DEF: 2 }, lordGrowthBonuses: {} };
      const unitWith = createBossLordUnit(lordDef, classData, gameData.weapons, 1, meta);
      const unitWithout = createBossLordUnit(lordDef, classData, gameData.weapons, 1, null);
      expect(unitWith.stats.STR).toBe(unitWithout.stats.STR + 3);
      expect(unitWith.stats.DEF).toBe(unitWithout.stats.DEF + 2);
    });

    it('gives a Vulnerary', () => {
      const lordDef = gameData.lords.find(l => l.name === 'Kira');
      const classData = gameData.classes.find(c => c.name === lordDef.class);
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 5, null);
      expect(unit.consumables.some(c => c.name === 'Vulnerary')).toBe(true);
    });

    it('has personalSkillL20 data preserved', () => {
      const lordDef = gameData.lords.find(l => l.name === 'Kira');
      const classData = gameData.classes.find(c => c.name === lordDef.class);
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 5, null);
      expect(unit._personalSkillL20).toBeTruthy();
      expect(unit._personalSkillL20.skillId).toBe('tactical_advantage');
    });
  });

  describe('meta bonuses on recruits', () => {
    it('applies recruit stat bonuses to regular candidates', () => {
      const meta = { statBonuses: { STR: 2, SPD: 1 }, growthBonuses: {} };
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const withMeta = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, meta);
      // Reset for second call
      mathRandomSpy.mockRestore();
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const without = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);

      // Find matching class between both sets
      const className = withMeta[0].className;
      const matchWith = withMeta.find(c => c.className === className);
      const matchWithout = without.find(c => c.className === className);
      if (matchWith && matchWithout) {
        expect(matchWith.unit.stats.STR).toBeGreaterThanOrEqual(matchWithout.unit.stats.STR);
      }
    });
  });

  describe('promoted recruit properties', () => {
    it('promoted candidates have class innate skills', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, makeBaseRoster(), gameData, null);
      // Act3 pool has promoted classes like Hero, Sage, etc. which have innate skills
      const heroCandidate = candidates.find(c => c.className === 'Hero');
      if (heroCandidate) {
        // Hero class should have 'vigilance' innate skill
        expect(heroCandidate.unit.skills).toContain('vigilance');
      }
      const sniperCandidate = candidates.find(c => c.className === 'Sniper');
      if (sniperCandidate) {
        expect(sniperCandidate.unit.skills).toContain('sure_shot');
      }
    });

    it('promoted candidates have correct promoted className', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, makeBaseRoster(), gameData, null);
      const act3Pool = gameData.recruits.act3.pool;
      const validClassNames = act3Pool.map(r => r.className);
      for (const c of candidates) {
        expect(validClassNames).toContain(c.className);
      }
    });

    it('base-tier Dancer recruit has dance class-innate skill', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const localData = structuredClone(gameData);
      localData.recruits.act2.pool = [{ className: 'Dancer', name: 'Sylvie' }];
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Dancer');
      expect(candidates[0].unit.skills).toContain('dance');
    });

    it('promoted recruit from Dancer keeps base dance innate', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const localData = structuredClone(gameData);
      const bard = localData.classes.find(c => c.name === 'Bard');
      if (!bard) return;
      localData.classes.push({ ...bard, name: 'Stage Bard' });
      localData.recruits.act3.pool = [{ className: 'Stage Bard', name: 'Cadence' }];
      const candidates = generateBossRecruitCandidates(1, makeBaseRoster(), localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Stage Bard');
      expect(candidates[0].unit.skills).toContain('dance');
    });

    it('Bard is not generated as a boss recruit candidate', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, makeBaseRoster(), gameData, null);
      expect(candidates.some(c => c.className === 'Bard')).toBe(false);
    });
  });
});
