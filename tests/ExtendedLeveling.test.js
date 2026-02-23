import { describe, it, expect } from 'vitest';
import {
  extendedLevelUp,
  applyLevelUpGains,
  gainExperience,
  getDisplayLevel,
  createUnit,
  promoteUnit,
} from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';
import { XP_STAT_NAMES, XP_PER_LEVEL, PROMOTED_CLASS_LEVEL_CAP } from '../src/utils/constants.js';

const data = loadGameData();

/** Create a promoted unit at the level cap for testing. */
function makePromotedCappedUnit() {
  const myrmidon = data.classes.find((c) => c.name === 'Myrmidon');
  const swordmaster = data.classes.find((c) => c.name === 'Swordmaster');
  const unit = createUnit(myrmidon, 10, data.weapons);
  promoteUnit(unit, swordmaster, swordmaster.promotionBonuses, data.skills);
  // Force to level cap
  unit.level = PROMOTED_CLASS_LEVEL_CAP;
  unit.xp = 0;
  return unit;
}

/** Create a base-class unit at the level cap for testing. */
function makeBaseCappedUnit() {
  const myrmidon = data.classes.find((c) => c.name === 'Myrmidon');
  const unit = createUnit(myrmidon, 10, data.weapons);
  unit.level = 20; // base class cap
  unit.xp = 0;
  return unit;
}

describe('extendedLevelUp', () => {
  it('returns exactly 1 total stat gain from XP_STAT_NAMES', () => {
    const unit = makePromotedCappedUnit();
    const result = extendedLevelUp(unit);
    const total = XP_STAT_NAMES.reduce((sum, stat) => sum + result.gains[stat], 0);
    expect(total).toBe(1);
    // All keys present
    for (const stat of XP_STAT_NAMES) {
      expect(result.gains).toHaveProperty(stat);
      expect(result.gains[stat] === 0 || result.gains[stat] === 1).toBe(true);
    }
  });

  it('returns isExtended: true and correct extendedLevel', () => {
    const unit = makePromotedCappedUnit();
    const result = extendedLevelUp(unit);
    expect(result.isExtended).toBe(true);
    expect(result.extendedLevel).toBe(1);
    expect(result.newLevel).toBe(PROMOTED_CLASS_LEVEL_CAP);
  });

  it('increments extendedLevel based on current unit.extendedLevels', () => {
    const unit = makePromotedCappedUnit();
    unit.extendedLevels = 5;
    const result = extendedLevelUp(unit);
    expect(result.extendedLevel).toBe(6);
  });
});

describe('applyLevelUpGains with isExtended', () => {
  it('sets unit.extendedLevels without touching unit.level', () => {
    const unit = makePromotedCappedUnit();
    const originalLevel = unit.level;
    const result = {
      gains: { HP: 1, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 },
      newLevel: unit.level,
      extendedLevel: 1,
      isExtended: true,
    };
    const hpBefore = unit.stats.HP;
    applyLevelUpGains(unit, result);
    expect(unit.level).toBe(originalLevel);
    expect(unit.extendedLevels).toBe(1);
    expect(unit.stats.HP).toBe(hpBefore + 1);
  });

  it('normal level-up still works (sets unit.level, no extendedLevels)', () => {
    const myrmidon = data.classes.find((c) => c.name === 'Myrmidon');
    const unit = createUnit(myrmidon, 1, data.weapons);
    const result = {
      gains: { HP: 1, STR: 1, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 },
      newLevel: 2,
    };
    applyLevelUpGains(unit, result);
    expect(unit.level).toBe(2);
    expect(unit.extendedLevels).toBeUndefined();
  });
});

describe('gainExperience with extended leveling', () => {
  it('at promoted cap + extendedLevelingEnabled: true → extended level-ups fire', () => {
    const unit = makePromotedCappedUnit();
    const result = gainExperience(unit, XP_PER_LEVEL, { extendedLevelingEnabled: true });
    expect(result.levelUps.length).toBe(1);
    expect(result.levelUps[0].isExtended).toBe(true);
    expect(unit.extendedLevels).toBe(1);
    expect(unit.level).toBe(PROMOTED_CLASS_LEVEL_CAP);
  });

  it('at promoted cap + extendedLevelingEnabled: false → no XP gain', () => {
    const unit = makePromotedCappedUnit();
    const result = gainExperience(unit, XP_PER_LEVEL, { extendedLevelingEnabled: false });
    expect(result.levelUps.length).toBe(0);
  });

  it('at promoted cap + no options → no XP gain (backward compatible)', () => {
    const unit = makePromotedCappedUnit();
    const result = gainExperience(unit, XP_PER_LEVEL);
    expect(result.levelUps.length).toBe(0);
  });

  it('at base class cap + extendedLevelingEnabled: true → still blocked', () => {
    const unit = makeBaseCappedUnit();
    const result = gainExperience(unit, XP_PER_LEVEL, { extendedLevelingEnabled: true });
    expect(result.levelUps.length).toBe(0);
  });

  it('extended level-ups do not change unit.level', () => {
    const unit = makePromotedCappedUnit();
    gainExperience(unit, XP_PER_LEVEL * 3, { extendedLevelingEnabled: true });
    expect(unit.level).toBe(PROMOTED_CLASS_LEVEL_CAP);
    expect(unit.extendedLevels).toBe(3);
  });

  it('multiple extended level-ups in sequence work correctly', () => {
    const unit = makePromotedCappedUnit();
    const statsBefore = { ...unit.stats };

    gainExperience(unit, XP_PER_LEVEL * 5, { extendedLevelingEnabled: true });

    expect(unit.level).toBe(PROMOTED_CLASS_LEVEL_CAP);
    expect(unit.extendedLevels).toBe(5);

    // Total stat gains should be exactly 5 (one per extended level-up)
    let totalGains = 0;
    for (const stat of XP_STAT_NAMES) {
      totalGains += unit.stats[stat] - statsBefore[stat];
    }
    expect(totalGains).toBe(5);
  });
});

describe('getDisplayLevel', () => {
  it('returns plain level string for normal unit', () => {
    const myrmidon = data.classes.find((c) => c.name === 'Myrmidon');
    const unit = createUnit(myrmidon, 5, data.weapons);
    expect(getDisplayLevel(unit)).toBe(String(unit.level));
  });

  it('returns "20+3" for unit with extendedLevels: 3', () => {
    const unit = makePromotedCappedUnit();
    unit.extendedLevels = 3;
    expect(getDisplayLevel(unit)).toBe('20+3');
  });

  it('returns "20" for promoted capped unit without extendedLevels', () => {
    const unit = makePromotedCappedUnit();
    expect(getDisplayLevel(unit)).toBe('20');
  });

  it('returns "20" when extendedLevels is 0', () => {
    const unit = makePromotedCappedUnit();
    unit.extendedLevels = 0;
    expect(getDisplayLevel(unit)).toBe('20');
  });
});
