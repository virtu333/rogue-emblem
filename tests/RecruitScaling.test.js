import { describe, it, expect } from 'vitest';
import { resolveRecruitScalingTargets } from '../src/engine/RecruitScaling.js';

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
