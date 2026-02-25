import { describe, it, expect } from 'vitest';
import {
  isPromotedRecruitSource,
  getRecruitPromotionChance,
  rollRecruitPromotion,
  getFailBaseLevel,
  RECRUIT_PROMOTION_CONTEXT,
} from '../src/engine/RecruitPromotion.js';

const CLASSES = [
  { name: 'Mercenary', tier: 'base' },
  { name: 'Hero', tier: 'promoted', promotesFrom: 'Mercenary' },
];

describe('RecruitPromotion', () => {
  describe('isPromotedRecruitSource', () => {
    it('returns true for promoted tier with valid promotesFrom mapping', () => {
      const hero = CLASSES.find((entry) => entry.name === 'Hero');
      expect(isPromotedRecruitSource(hero, CLASSES)).toBe(true);
    });

    it('returns false for base-tier classes', () => {
      const mercenary = CLASSES.find((entry) => entry.name === 'Mercenary');
      expect(isPromotedRecruitSource(mercenary, CLASSES)).toBe(false);
    });

    it('returns false when promoted class is missing promotesFrom', () => {
      expect(isPromotedRecruitSource({ name: 'Hero', tier: 'promoted' }, CLASSES)).toBe(false);
    });

    it('returns false when promotesFrom does not exist in classesData', () => {
      expect(
        isPromotedRecruitSource(
          { name: 'Hero', tier: 'promoted', promotesFrom: 'MissingBase' },
          CLASSES,
        ),
      ).toBe(false);
    });
  });

  describe('getRecruitPromotionChance', () => {
    it('uses boss and recruit-node defaults', () => {
      expect(getRecruitPromotionChance(RECRUIT_PROMOTION_CONTEXT.BOSS, null)).toBe(0.7);
      expect(getRecruitPromotionChance(RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE, null)).toBe(0.4);
    });

    it('applies meta bonus and clamps to cap', () => {
      expect(
        getRecruitPromotionChance(RECRUIT_PROMOTION_CONTEXT.BOSS, {
          recruitPromotionChanceBonus: 0.16,
        }),
      ).toBe(0.86);
      expect(
        getRecruitPromotionChance(RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE, {
          recruitPromotionChanceBonus: 0.8,
        }),
      ).toBe(0.95);
    });

    it('clamps negative values at zero', () => {
      expect(
        getRecruitPromotionChance(RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE, {
          recruitPromotionChanceBonus: -5,
        }),
      ).toBe(0);
    });
  });

  describe('rollRecruitPromotion', () => {
    it('promotes on successful roll for eligible class', () => {
      const hero = CLASSES.find((entry) => entry.name === 'Hero');
      const outcome = rollRecruitPromotion(
        { type: RECRUIT_PROMOTION_CONTEXT.BOSS, classesData: CLASSES },
        hero,
        null,
        () => 0.5,
      );
      expect(outcome.eligible).toBe(true);
      expect(outcome.promote).toBe(true);
      expect(outcome.baseClassName).toBe('Mercenary');
      expect(outcome.effectiveChance).toBe(0.7);
    });

    it('fails promotion on high roll', () => {
      const hero = CLASSES.find((entry) => entry.name === 'Hero');
      const outcome = rollRecruitPromotion(
        { type: RECRUIT_PROMOTION_CONTEXT.BOSS, classesData: CLASSES },
        hero,
        null,
        () => 0.99,
      );
      expect(outcome.eligible).toBe(true);
      expect(outcome.promote).toBe(false);
      expect(outcome.roll).toBe(0.99);
    });

    it('does not roll for ineligible sources', () => {
      const mercenary = CLASSES.find((entry) => entry.name === 'Mercenary');
      const outcome = rollRecruitPromotion(
        { type: RECRUIT_PROMOTION_CONTEXT.BOSS, classesData: CLASSES },
        mercenary,
        null,
        () => {
          throw new Error('should not roll');
        },
      );
      expect(outcome.eligible).toBe(false);
      expect(outcome.promote).toBe(false);
      expect(outcome.roll).toBeNull();
    });
  });

  describe('getFailBaseLevel', () => {
    it('uses min(target, dynamicPromotion, cap) - 1', () => {
      expect(getFailBaseLevel(25, 14)).toBe(13);
      expect(getFailBaseLevel(50, 50)).toBe(19);
    });

    it('clamps to base range [1, 20]', () => {
      expect(getFailBaseLevel(1, 1)).toBe(1);
      expect(getFailBaseLevel(-10, -4)).toBe(1);
    });
  });
});
