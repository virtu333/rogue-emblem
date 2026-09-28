// A recruit that joins promoted levels its base class to the commander's promotion level
// (10), promotes, then levels to the commander's promoted level. Playtest (Sep 2026):
// with Edric a level-8 Great Lord, Rowan joined as a level-8 Holy Knight carrying 24
// level-ups (base class to 18, then 7 promoted) to Edric's 16 — the commander's
// promoted levels were counted twice.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createBossLordUnit,
  generateBossRecruitCandidates,
} from '../src/engine/BossRecruitSystem.js';
import { resolveRecruitScalingTargets } from '../src/engine/RecruitScaling.js';
import { getPromotionBaseLevel, getFailBaseLevel } from '../src/engine/RecruitPromotion.js';
import { createLordUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

// Record the base-class level every recruit promotes from.
const promotedFrom = [];
vi.mock('../src/engine/UnitManager.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promoteUnit: (unit, ...rest) => {
      promotedFrom.push(unit.level);
      return actual.promoteUnit(unit, ...rest);
    },
  };
});

const gameData = loadGameData();
const edricAt = (level) => [{ name: 'Edric', isLord: true, tier: 'promoted', level }];

afterEach(() => vi.restoreAllMocks());

describe('promoted recruits · level-ups', () => {
  it('Rowan beside a level-8 Great Lord gets 9 base + 7 promoted level-ups', () => {
    // Math.random() = 0: every stat with a positive growth gains +1 per level-up.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const rowanDef = gameData.lords.find((l) => l.name === 'Rowan');
    const rowanClass = gameData.classes.find((c) => c.name === rowanDef.class);
    const promoted = gameData.classes.find((c) => c.name === rowanDef.promotedClass);
    const bonuses = rowanDef.promotionBonuses || promoted.promotionBonuses;
    const fresh = createLordUnit(rowanDef, rowanClass, gameData.weapons);
    const targets = resolveRecruitScalingTargets(edricAt(8));
    const unit = createBossLordUnit(
      rowanDef,
      rowanClass,
      gameData.weapons,
      targets.recruitTargetLevel,
      null,
      {
        promoteLord: true,
        classes: gameData.classes,
        skills: gameData.skills,
        dynamicPromotionLevel: targets.dynamicPromotionLevel,
        promotedLevelTarget: targets.promotedLevelTarget,
      },
    );
    expect(unit.tier).toBe('promoted');
    expect(unit.className).toBe(rowanDef.promotedClass);
    expect(unit.level).toBe(8);
    // HP has a positive growth for every lord: 16 level-ups plus the promotion bonus.
    expect(fresh.growths.HP).toBeGreaterThan(0);
    expect(unit.stats.HP).toBe(fresh.stats.HP + 16 + (bonuses.HP || 0));
  });

  it('never levels the base class past 10 before promoting', () => {
    for (const target of [1, 7, 10, 11, 18, 25, 40])
      expect(getPromotionBaseLevel(target)).toBe(Math.max(1, Math.min(target, 10)));
  });

  it('a recruit that fails its promotion roll still joins near the commander’s strength', () => {
    // Unchanged: an unpromoted recruit next to a Great Lord 8 is base level 17.
    const { recruitTargetLevel, dynamicPromotionLevel } = resolveRecruitScalingTargets(edricAt(8));
    expect(getFailBaseLevel(recruitTargetLevel, dynamicPromotionLevel)).toBe(17);
  });

  it('every promoted boss recruit promotes from base level 10', () => {
    const roster = [
      { name: 'Edric', isLord: true, tier: 'promoted', level: 8, className: 'Great Lord' },
      { name: 'Sera', isLord: true, tier: 'promoted', level: 8, className: 'Light Sage' },
    ];
    let promotedSeen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let x = seed;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        x = (x * 16807) % 2147483647;
        return x / 2147483647;
      });
      promotedFrom.length = 0;
      const candidates = generateBossRecruitCandidates('act3', roster, gameData, null, []) || [];
      for (const c of candidates.filter((k) => k.unit.tier === 'promoted')) {
        promotedSeen++;
        expect(c.unit.level).toBe(8);
      }
      for (const level of promotedFrom) expect(level).toBe(10);
      vi.restoreAllMocks();
    }
    expect(promotedSeen).toBeGreaterThan(0);
  });
});
