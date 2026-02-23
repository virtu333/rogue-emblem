import { describe, it, expect } from 'vitest';
import {
  resolveRecruitScalingTargets,
  resolveTeamAverageLevel,
} from '../src/engine/RecruitScaling.js';

describe('RecruitScaling', () => {
  it('returns full recruit scaling targets for unpromoted Edric', () => {
    const result = resolveRecruitScalingTargets([
      { name: 'Edric', tier: 'base', level: 12 },
      { name: 'Sera', tier: 'base', level: 9 },
    ]);
    expect(result.edricPromotedLevel).toBe(0);
    expect(result.recruitTargetLevel).toBe(12);
    expect(result.dynamicPromotionLevel).toBe(10);
    expect(result.promotedLevelTarget).toBe(0);
  });

  it('returns promoted targets for promoted Edric level 1', () => {
    const result = resolveRecruitScalingTargets([{ name: 'Edric', tier: 'promoted', level: 1 }]);
    expect(result.edricPromotedLevel).toBe(1);
    expect(result.recruitTargetLevel).toBe(11);
    expect(result.dynamicPromotionLevel).toBe(11);
    expect(result.promotedLevelTarget).toBe(1);
  });

  it('returns promoted targets for promoted Edric level 5', () => {
    const result = resolveRecruitScalingTargets([{ name: 'Edric', tier: 'promoted', level: 5 }]);
    expect(result.edricPromotedLevel).toBe(5);
    expect(result.recruitTargetLevel).toBe(15);
    expect(result.dynamicPromotionLevel).toBe(15);
    expect(result.promotedLevelTarget).toBe(5);
  });

  it('falls back to base targets when Edric is missing', () => {
    const result = resolveRecruitScalingTargets([{ name: 'Sera', tier: 'base', level: 8 }]);
    expect(result.edricPromotedLevel).toBe(0);
    expect(result.recruitTargetLevel).toBe(1);
    expect(result.dynamicPromotionLevel).toBe(10);
    expect(result.promotedLevelTarget).toBe(0);
  });

  it('defaults promoted Edric missing level to 1', () => {
    const result = resolveRecruitScalingTargets([{ name: 'Edric', tier: 'promoted' }]);
    expect(result.edricPromotedLevel).toBe(1);
    expect(result.recruitTargetLevel).toBe(11);
    expect(result.dynamicPromotionLevel).toBe(11);
    expect(result.promotedLevelTarget).toBe(1);
  });

  it('handles null/undefined input', () => {
    const fromNull = resolveRecruitScalingTargets(null);
    const fromUndefined = resolveRecruitScalingTargets(undefined);
    expect(fromNull.edricPromotedLevel).toBe(0);
    expect(fromNull.recruitTargetLevel).toBe(1);
    expect(fromNull.dynamicPromotionLevel).toBe(10);
    expect(fromNull.promotedLevelTarget).toBe(0);
    expect(fromUndefined.edricPromotedLevel).toBe(0);
    expect(fromUndefined.recruitTargetLevel).toBe(1);
    expect(fromUndefined.dynamicPromotionLevel).toBe(10);
    expect(fromUndefined.promotedLevelTarget).toBe(0);
  });

  it('returns identical targets for serialized and live unit shapes', () => {
    const serialized = [{ name: 'Edric', tier: 'promoted', level: 4, className: 'Great Lord' }];
    const live = [
      {
        name: 'Edric',
        tier: 'promoted',
        level: 4,
        className: 'Great Lord',
        graphic: {},
        label: {},
      },
    ];
    expect(resolveRecruitScalingTargets(serialized)).toEqual(resolveRecruitScalingTargets(live));
  });
});

describe('resolveTeamAverageLevel', () => {
  it('returns single base unit level', () => {
    expect(resolveTeamAverageLevel([{ tier: 'base', level: 8 }])).toBe(8);
  });

  it('averages mixed base and promoted units', () => {
    // base 10 = 10, promoted 3 = 10+3 = 13, average = 11.5 → floor = 11
    const result = resolveTeamAverageLevel([
      { tier: 'base', level: 10 },
      { tier: 'promoted', level: 3 },
    ]);
    expect(result).toBe(11);
  });

  it('averages all promoted units', () => {
    // promoted 2 = 12, promoted 4 = 14, average = 13
    const result = resolveTeamAverageLevel([
      { tier: 'promoted', level: 2 },
      { tier: 'promoted', level: 4 },
    ]);
    expect(result).toBe(13);
  });

  it('returns 1 for empty input', () => {
    expect(resolveTeamAverageLevel([])).toBe(1);
  });

  it('returns 1 for null/undefined input', () => {
    expect(resolveTeamAverageLevel(null)).toBe(1);
    expect(resolveTeamAverageLevel(undefined)).toBe(1);
  });

  it('floors fractional averages', () => {
    // base 5 = 5, base 6 = 6, base 7 = 7 → average = 6.0
    expect(
      resolveTeamAverageLevel([
        { tier: 'base', level: 5 },
        { tier: 'base', level: 6 },
        { tier: 'base', level: 7 },
      ]),
    ).toBe(6);
    // base 5 = 5, base 8 = 8 → average = 6.5 → floor = 6
    expect(
      resolveTeamAverageLevel([
        { tier: 'base', level: 5 },
        { tier: 'base', level: 8 },
      ]),
    ).toBe(6);
  });
});
