import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateBossRecruitCandidates,
  getAvailableLords,
  createBossLordUnit,
} from '../src/engine/BossRecruitSystem.js';
import {
  BOSS_RECRUIT_LORD_CHANCE,
  BOSS_RECRUIT_COUNT,
  BASE_CLASS_LEVEL_CAP,
} from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

// Compute expected recruitable lord names from data (excluding starting lords Edric/Sera)
const STARTING_LORDS = new Set(['Edric', 'Sera']);
const RECRUITABLE_LORD_NAMES = gameData.lords
  .map((l) => l.name)
  .filter((n) => !STARTING_LORDS.has(n))
  .sort();

// Minimal roster with Edric + Sera at level 8
function makeBaseRoster() {
  return [
    { name: 'Edric', className: 'Lord', isLord: true, level: 8, faction: 'player' },
    { name: 'Sera', className: 'Light Sage', isLord: true, level: 7, faction: 'player' },
  ];
}

function makeRosterWithOnlyLordAvailable(lordName) {
  return [
    ...makeBaseRoster(),
    ...RECRUITABLE_LORD_NAMES.filter((name) => name !== lordName).map((name) => ({
      name,
      className: 'Lord',
      isLord: true,
      level: 5,
      faction: 'player',
    })),
  ];
}

function getPromotableRecruitLord(data) {
  return (
    data.lords.find((lord) => {
      if (STARTING_LORDS.has(lord.name)) return false;
      if (!lord.promotedClass) return false;
      const promotedClassData = data.classes.find((c) => c.name === lord.promotedClass);
      return Boolean(promotedClassData?.promotionBonuses);
    }) || null
  );
}

function getPromotableLordWithDistinctBonuses(data) {
  return (
    data.lords.find((lord) => {
      if (STARTING_LORDS.has(lord.name)) return false;
      if (!lord.promotedClass || !lord.promotionBonuses) return false;
      const promotedClassData = data.classes.find((c) => c.name === lord.promotedClass);
      if (!promotedClassData?.promotionBonuses) return false;
      return Object.keys(lord.promotionBonuses).some(
        (stat) =>
          (lord.promotionBonuses?.[stat] || 0) !==
          (promotedClassData.promotionBonuses?.[stat] || 0),
      );
    }) || null
  );
}

function getPoolClassNames(recruitsData, actKey) {
  const actData = recruitsData?.[actKey];
  if (!actData) return [];
  if (Array.isArray(actData.pool) && actData.pool.length > 0) {
    return actData.pool.map((r) => r.className);
  }
  if (Array.isArray(actData.classPool)) {
    return [...actData.classPool];
  }
  return [];
}

describe('BossRecruitSystem', () => {
  let mathRandomSpy;

  afterEach(() => {
    if (mathRandomSpy) mathRandomSpy.mockRestore();
  });

  describe('getAvailableLords', () => {
    it('returns all recruitable lords when none are in roster', () => {
      const lords = getAvailableLords(makeBaseRoster(), gameData.lords);
      const names = lords.map((l) => l.name).sort();
      expect(names).toEqual(RECRUITABLE_LORD_NAMES);
    });

    it('excludes a lord when she is in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        { name: 'Kira', className: 'Tactician', isLord: true, level: 5 },
      ];
      const lords = getAvailableLords(roster, gameData.lords);
      const names = lords.map((l) => l.name);
      expect(names).not.toContain('Kira');
      expect(names).toHaveLength(RECRUITABLE_LORD_NAMES.length - 1);
    });

    it('returns empty when all recruitable lords are in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        ...RECRUITABLE_LORD_NAMES.map((n) => ({
          name: n,
          className: 'Lord',
          isLord: true,
          level: 5,
        })),
      ];
      expect(getAvailableLords(roster, gameData.lords)).toHaveLength(0);
    });

    it('never includes Edric or Sera', () => {
      const lords = getAvailableLords([], gameData.lords);
      const names = lords.map((l) => l.name);
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

    it('supports actId input and returns candidates for act4', () => {
      const candidates = generateBossRecruitCandidates('act4', makeBaseRoster(), gameData, null);
      expect(candidates).not.toBeNull();
      expect(candidates).toHaveLength(BOSS_RECRUIT_COUNT);
      const validClassNames = new Set(getPoolClassNames(gameData.recruits, 'act4'));
      for (const className of [...validClassNames]) {
        const classData = gameData.classes.find((entry) => entry.name === className);
        if (classData?.promotesFrom) validClassNames.add(classData.promotesFrom);
      }
      for (const c of candidates) {
        if (!c.isLord) expect(validClassNames.has(c.className)).toBe(true);
      }
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

    it('Act 2 promoted-source candidates stay promoted on low roll', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(1, noLordRoster, gameData, null);
      for (const c of candidates) {
        expect(c.isLord).toBe(false);
        expect(c.unit.tier).toBe('promoted');
      }
    });

    it('Act 3 promoted-source candidates stay promoted on low roll', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(2, noLordRoster, gameData, null);
      for (const c of candidates) {
        expect(c.isLord).toBe(false);
        expect(c.unit.tier).toBe('promoted');
      }
    });

    it('Act 2 promoted-source candidates can downgrade to base on high roll', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, noLordRoster, gameData, null);
      expect(candidates.every((c) => c.unit.tier === 'base')).toBe(true);
    });

    it('recruitPromotionChanceBonus increases promoted outcome frequency for boss recruits', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.8);
      const withMeta = generateBossRecruitCandidates(1, noLordRoster, localData, {
        recruitPromotionChanceBonus: 0.24,
      });
      expect(withMeta).toHaveLength(1);
      expect(withMeta[0].className).toBe('Hero');
      expect(withMeta[0].unit.tier).toBe('promoted');
    });

    it('promoted outcome uses base chance when recruitPromotionChanceBonus is absent', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.8);
      const withoutMeta = generateBossRecruitCandidates(1, noLordRoster, localData, null);
      expect(withoutMeta).toHaveLength(1);
      expect(withoutMeta[0].className).toBe('Mercenary');
      expect(withoutMeta[0].unit.tier).toBe('base');
    });

    it('candidates have no duplicate classNames', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      const classNames = candidates.map((c) => c.className);
      expect(new Set(classNames).size).toBe(classNames.length);
    });

    it('revalidates class dedupe after fail resolution and keeps promoted source when fallback conflicts', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const roster = [
        ...makeRosterWithOnlyLordAvailable(null),
        { name: 'Rook', className: 'Mercenary', isLord: false, level: 8, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Hero');
      expect(candidates[0].unit.tier).toBe('promoted');
    });

    it('multi-entry promoted pool respects dedupe when roster has base fallback class', () => {
      const localData = structuredClone(gameData);
      // Pool has two promoted-source classes (actRef=1 → act2 → poolKey=act3)
      localData.recruits.act3.pool = [
        { className: 'Hero', name: 'Dante' },
        { className: 'Sage', name: 'Mira' },
      ];
      const roster = [
        ...makeRosterWithOnlyLordAvailable(null),
        { name: 'Rook', className: 'Mercenary', isLord: false, level: 8, faction: 'player' },
        { name: 'Wyn', className: 'Mage', isLord: false, level: 8, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      // Deterministic at 0.99: lord fails, both entries resolve → exactly 2
      expect(candidates.length).toBe(2);
      const classNames = candidates.map((c) => c.className);
      expect(new Set(classNames).size).toBe(classNames.length);
      // Mercenary+Mage in roster, so base fallbacks blocked → promoted classes used
      for (const name of classNames) {
        expect(['Hero', 'Sage']).toContain(name);
      }
    });

    it('skips candidate when both fallback and promoted outcomes conflict after dedupe recheck', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const roster = [
        ...makeRosterWithOnlyLordAvailable(null),
        { name: 'Rook', className: 'Mercenary', isLord: false, level: 8, faction: 'player' },
        { name: 'Dante', className: 'Hero', isLord: false, level: 8, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      expect(candidates).toBeNull();
    });

    it('allows promoted-source entries already in roster to resolve to unique fallback classes', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      const roster = [
        ...makeRosterWithOnlyLordAvailable(null),
        { name: 'Dante', className: 'Hero', isLord: false, level: 8, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Mercenary');
      expect(candidates[0].unit.tier).toBe('base');
    });

    it('avoids duplicate recruit names already present in roster', () => {
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Dante' }];
      localData.recruits.namePool.Hero = ['Dante'];
      const roster = [
        ...makeBaseRoster(),
        { name: 'Dante', className: 'Mercenary', isLord: false, level: 8 },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].displayName).toBe('Dante II');
    });

    it('excludes classes already in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        { name: 'Nyx', className: 'Thief', isLord: false, level: 5 },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      expect(candidates.every((c) => c.className !== 'Thief')).toBe(true);
    });

    it('candidate level uses Edric-anchored recruit target', () => {
      const roster = [
        { name: 'Edric', className: 'Lord', isLord: true, level: 12, faction: 'player' },
        { name: 'Sera', className: 'Light Sage', isLord: true, level: 19, faction: 'player' },
      ];
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      // Unpromoted recruits use Edric's base level target, not another lord's higher level.
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

    it('grants non-lord boss candidates a Lethal Armory extra weapon', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const meta = { lethalArmoryTier: 2 };
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, meta);
      expect(candidates.every((c) => c.unit.inventory.length > 1)).toBe(true);
    });

    it('does not grant Lethal Armory to lord candidates', () => {
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05;
        return 0.99;
      });
      const meta = { lethalArmoryTier: 3 };
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, meta);
      const lordCandidate = candidates.find((c) => c.isLord);
      const nonLordCandidates = candidates.filter((c) => !c.isLord);
      if (lordCandidate) {
        expect(lordCandidate.unit.inventory.length).toBe(1);
      }
      expect(nonLordCandidates.every((c) => c.unit.inventory.length > 1)).toBe(true);
    });

    it('grants non-lord boss candidates a Vulnerary when recruit field supplies is active', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const meta = { recruitStartingVulnerary: 1 };
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, meta);
      expect(
        candidates.every((c) => c.unit.consumables.some((item) => item.name === 'Vulnerary')),
      ).toBe(true);
    });
  });

  describe('lord slot', () => {
    it('uses tuned boss-recruit base lord chance', () => {
      expect(BOSS_RECRUIT_LORD_CHANCE).toBe(0.25);
    });

    it('act1 lord slot keeps lord candidates base-tier', () => {
      const promotableLord = getPromotableRecruitLord(gameData);
      expect(promotableLord).toBeTruthy();
      if (!promotableLord) return;

      const roster = makeRosterWithOnlyLordAvailable(promotableLord.name);
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05; // force lord slot
        return 0.5;
      });

      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      const lordCand = candidates.find((c) => c.isLord);
      expect(lordCand).toBeTruthy();
      expect(lordCand.displayName).toBe(promotableLord.name);
      expect(lordCand.unit.tier).toBe('base');
      expect(lordCand.unit.className).toBe(promotableLord.class);
    });

    it('act2+ lord slot promotes lords when promotion data exists', () => {
      const promotableLord = getPromotableRecruitLord(gameData);
      expect(promotableLord).toBeTruthy();
      if (!promotableLord) return;

      const roster = makeRosterWithOnlyLordAvailable(promotableLord.name);
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05; // force lord slot
        return 0.5;
      });

      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      const lordCand = candidates.find((c) => c.isLord);
      expect(lordCand).toBeTruthy();
      expect(lordCand.displayName).toBe(promotableLord.name);
      expect(lordCand.unit.tier).toBe('promoted');
      expect(lordCand.unit.className).toBe(promotableLord.promotedClass);
    });

    it('act2+ promoted lord level follows post-cap formula', () => {
      const promotableLord = getPromotableRecruitLord(gameData);
      expect(promotableLord).toBeTruthy();
      if (!promotableLord) return;

      const roster = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 5,
          tier: 'promoted',
          faction: 'player',
        },
        { name: 'Sera', className: 'Light Sage', isLord: true, level: 7, faction: 'player' },
        ...RECRUITABLE_LORD_NAMES.filter((name) => name !== promotableLord.name).map((name) => ({
          name,
          className: 'Lord',
          isLord: true,
          level: 5,
          faction: 'player',
        })),
      ];
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05; // force lord slot
        return 0.5;
      });

      const candidates = generateBossRecruitCandidates(1, roster, gameData, null);
      const lordCand = candidates.find((c) => c.isLord);
      expect(lordCand).toBeTruthy();
      expect(lordCand.unit.tier).toBe('promoted');
      expect(lordCand.unit.level).toBe(5);
    });

    it('includes a lord when RNG is below threshold', () => {
      // Math.random called: first for lord chance (0.05 < 0.25), then for lord pick, then for shuffles
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05; // lord chance check — triggers
        return 0.5; // subsequent calls
      });
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      expect(candidates.some((c) => c.isLord)).toBe(true);
    });

    it('does not include a lord when RNG is above threshold', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      expect(candidates.every((c) => !c.isLord)).toBe(true);
    });

    it('lord candidate has isLord true on unit', () => {
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05;
        return 0.5;
      });
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      const lordCand = candidates.find((c) => c.isLord);
      expect(lordCand).toBeTruthy();
      expect(lordCand.unit.isLord).toBe(true);
      expect(RECRUITABLE_LORD_NAMES).toContain(lordCand.displayName);
    });

    it('lord candidate has personal skill', () => {
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.05;
        return 0.5;
      });
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      const lordCand = candidates.find((c) => c.isLord);
      expect(lordCand.unit.skills.length).toBeGreaterThan(0);
    });

    it('lordRecruitChanceBonus increases effective lord chance', () => {
      // Math.random returns 0.40 — above 0.25 base, below 0.25+0.16=0.41
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.4);
      const metaEffects = { lordRecruitChanceBonus: 0.16 };
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, metaEffects);
      expect(candidates.some((c) => c.isLord)).toBe(true);
    });

    it('no lord bonus when lordRecruitChanceBonus is absent', () => {
      // Same random value 0.40 — should NOT trigger lord at base 0.25
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.4);
      const candidates = generateBossRecruitCandidates(0, makeBaseRoster(), gameData, null);
      expect(candidates.every((c) => !c.isLord)).toBe(true);
    });

    it('no lord when all recruitable lords already in roster', () => {
      const roster = [
        ...makeBaseRoster(),
        ...RECRUITABLE_LORD_NAMES.map((n) => ({
          name: n,
          className: 'Lord',
          isLord: true,
          level: 5,
        })),
      ];
      // Force low RNG that would trigger lord
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.01;
        return 0.5;
      });
      const candidates = generateBossRecruitCandidates(0, roster, gameData, null);
      expect(candidates.every((c) => !c.isLord)).toBe(true);
    });
  });

  describe('createBossLordUnit', () => {
    it('creates lord at target level', () => {
      const lordDef = gameData.lords.find((l) => l.name === 'Kira');
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 10, null);
      expect(unit.level).toBe(10);
      expect(unit.isLord).toBe(true);
      expect(unit.name).toBe('Kira');
    });

    it('remains backward-compatible without recruit context (base-tier behavior)', () => {
      const lordDef = getPromotableRecruitLord(gameData);
      expect(lordDef).toBeTruthy();
      if (!lordDef) return;
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      expect(classData).toBeTruthy();
      if (!classData) return;

      const unit = createBossLordUnit(
        lordDef,
        classData,
        gameData.weapons,
        BASE_CLASS_LEVEL_CAP + 5,
        null,
      );
      expect(unit.tier).toBe('base');
      expect(unit.className).toBe(lordDef.class);
      expect(unit.level).toBe(BASE_CLASS_LEVEL_CAP);
    });

    it('uses lord-specific promotion bonuses when recruit-context promotion is enabled', () => {
      const lordDef = getPromotableLordWithDistinctBonuses(gameData);
      expect(lordDef).toBeTruthy();
      if (!lordDef) return;
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      const promotedClassData = gameData.classes.find((c) => c.name === lordDef.promotedClass);
      expect(classData).toBeTruthy();
      expect(promotedClassData).toBeTruthy();
      if (!classData || !promotedClassData) return;

      const baseUnit = createBossLordUnit(lordDef, classData, gameData.weapons, 1, null);
      const promotedUnit = createBossLordUnit(lordDef, classData, gameData.weapons, 1, null, {
        promoteLord: true,
        classes: gameData.classes,
        skills: gameData.skills,
      });

      expect(promotedUnit.tier).toBe('promoted');
      expect(promotedUnit.className).toBe(lordDef.promotedClass);

      for (const stat of ['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']) {
        const expected = lordDef.promotionBonuses?.[stat] || 0;
        expect(promotedUnit.stats[stat] - baseUnit.stats[stat]).toBe(expected);
      }
      expect(promotedUnit.currentHP - baseUnit.currentHP).toBe(lordDef.promotionBonuses?.HP || 0);
    });

    it('applies lord meta stat bonuses', () => {
      const lordDef = gameData.lords.find((l) => l.name === 'Voss');
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      const meta = { lordStatBonuses: { STR: 3, DEF: 2 }, lordGrowthBonuses: {} };
      const unitWith = createBossLordUnit(lordDef, classData, gameData.weapons, 1, meta);
      const unitWithout = createBossLordUnit(lordDef, classData, gameData.weapons, 1, null);
      expect(unitWith.stats.STR).toBe(unitWithout.stats.STR + 3);
      expect(unitWith.stats.DEF).toBe(unitWithout.stats.DEF + 2);
    });

    it('gives a Vulnerary', () => {
      const lordDef = gameData.lords.find((l) => l.name === 'Kira');
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
      const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 5, null);
      expect(unit.consumables.some((c) => c.name === 'Vulnerary')).toBe(true);
    });

    it('has personalSkillL20 data preserved', () => {
      const lordDef = gameData.lords.find((l) => l.name === 'Kira');
      const classData = gameData.classes.find((c) => c.name === lordDef.class);
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
      const matchWith = withMeta.find((c) => c.className === className);
      const matchWithout = without.find((c) => c.className === className);
      if (matchWith && matchWithout) {
        expect(matchWith.unit.stats.STR).toBeGreaterThanOrEqual(matchWithout.unit.stats.STR);
      }
    });
  });

  describe('promoted recruit properties', () => {
    it('promoted candidates have class innate skills', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(1, noLordRoster, gameData, null);
      // Act3 pool has promoted classes like Hero, Sage, etc. which have innate skills
      const heroCandidate = candidates.find((c) => c.className === 'Hero');
      if (heroCandidate) {
        // Hero class should have 'vigilance' innate skill
        expect(heroCandidate.unit.skills).toContain('vigilance');
      }
      const sniperCandidate = candidates.find((c) => c.className === 'Sniper');
      if (sniperCandidate) {
        expect(sniperCandidate.unit.skills).toContain('sure_shot');
      }
    });

    it('promoted Wyvern Lord candidates learn draconic_aura at promoted level 10', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Wyvern Lord', name: 'Skarn' }];
      const roster = [
        {
          name: 'Edric',
          className: 'Great Lord',
          isLord: true,
          level: 10,
          tier: 'promoted',
          faction: 'player',
        },
        { name: 'Sera', className: 'Light Sage', isLord: true, level: 7, faction: 'player' },
        ...RECRUITABLE_LORD_NAMES.map((name) => ({
          name,
          className: 'Lord',
          isLord: true,
          level: 5,
          faction: 'player',
        })),
      ];
      const candidates = generateBossRecruitCandidates(1, roster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Wyvern Lord');
      expect(candidates[0].unit.level).toBe(10);
      expect(candidates[0].unit.skills).toContain('draconic_aura');
    });

    it('promoted candidates have correct promoted className', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(1, noLordRoster, gameData, null);
      const validClassNames = getPoolClassNames(gameData.recruits, 'act3');
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
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const localData = structuredClone(gameData);
      const bard = localData.classes.find((c) => c.name === 'Bard');
      if (!bard) return;
      localData.classes.push({ ...bard, name: 'Stage Bard' });
      localData.recruits.act3.pool = [{ className: 'Stage Bard', name: 'Cadence' }];
      const candidates = generateBossRecruitCandidates(1, noLordRoster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Stage Bard');
      expect(candidates[0].unit.skills).toContain('dance');
    });

    it('getRecruitPoolEntries falls back to base-class namePool for promoted classPool entries', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const localData = structuredClone(gameData);
      localData.recruits.act3 = { classPool: ['Hero'] };
      localData.recruits.namePool.Hero = [];
      localData.recruits.namePool.Mercenary = ['Gareth'];

      const candidates = generateBossRecruitCandidates(1, noLordRoster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].className).toBe('Hero');
      expect(candidates[0].displayName).toBe('Gareth');
    });

    it('pickUniqueRecruitNameForClass falls back to base-class namePool when promoted pool lacks names', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const localData = structuredClone(gameData);
      localData.recruits.act3.pool = [{ className: 'Hero', name: 'Hero' }];
      localData.recruits.namePool.Hero = [];
      localData.recruits.namePool.Mercenary = ['Gareth'];

      const candidates = generateBossRecruitCandidates(1, noLordRoster, localData, null);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].displayName).toBe('Gareth');
    });

    it('Bard is not generated as a boss recruit candidate', () => {
      const noLordRoster = makeRosterWithOnlyLordAvailable(null);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const candidates = generateBossRecruitCandidates(1, noLordRoster, gameData, null);
      expect(candidates.some((c) => c.className === 'Bard')).toBe(false);
    });
  });
});
