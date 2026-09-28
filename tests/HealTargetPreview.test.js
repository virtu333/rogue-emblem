import { describe, it, expect } from 'vitest';
import { healTargetPreview } from '../src/ui/healTargetPreview.js';
const staff = { type: 'Staff', healBase: 5 };
const healer = { stats: { MAG: 5 } };
describe('heal target preview', () => {
  it('shows the capped gain and resulting HP without changing the target', () => {
    const target = { currentHP: 12, stats: { HP: 18 } };
    expect(healTargetPreview(staff, healer, target)).toMatchObject({
      from: 12,
      to: 18,
      max: 18,
      amount: 6,
      text: 'Heal +6 → 18/18 HP',
    });
    expect(target.currentHP).toBe(12);
  });
  it('applies the blessing multiplier before the missing-HP cap', () => {
    const target = { currentHP: 3, stats: { HP: 18 } };
    expect(healTargetPreview(staff, healer, target, { healingMultiplier: 0.5 }).to).toBe(8);
    expect(healTargetPreview(staff, healer, target, { healingMultiplier: 2 }).to).toBe(18);
  });
  it('describes Cure conditions instead of promising HP, and excludes relocation staves', () => {
    const target = { currentHP: 12, stats: { HP: 18 }, _conditions: [{ id: 'sleep' }] };
    const preview = healTargetPreview({ ...staff, cureConditions: true }, healer, target);
    expect(preview.amount).toBe(0);
    expect(preview.text).toMatch(/removes sleep/i);
    expect(target._conditions).toHaveLength(1);
    expect(healTargetPreview({ ...staff, relocate: 'warp' }, healer, target)).toBeNull();
  });
});
