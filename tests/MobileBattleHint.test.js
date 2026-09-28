import { describe, expect, it } from 'vitest';
import { mobileBattleHint } from '../src/ui/HintDisplay.js';

// Ways the phone battle's camera lesson can go wrong: the upright lesson names a tool
// the upright rail no longer shows (Recenter), the sideways tip shows on a landscape
// phone or before the first lesson, or it repeats once read.
const seen =
  (...ids) =>
  (id) =>
    ids.includes(id);

describe('mobileBattleHint', () => {
  it('teaches pinch and pan first, naming the tool the rail shows', () => {
    expect(mobileBattleHint({ hasSeen: seen(), upright: true })).toMatchObject({
      id: 'battle_mobile_camera',
      message: expect.stringContaining('Overview'),
    });
    expect(mobileBattleHint({ hasSeen: seen(), upright: true }).message).not.toContain('Recenter');
    expect(mobileBattleHint({ hasSeen: seen(), upright: false }).message).toContain('Recenter');
  });

  it('on a later upright battle, says once that the phone can turn sideways', () => {
    const tip = mobileBattleHint({ hasSeen: seen('battle_mobile_camera'), upright: true });
    expect(tip.id).toBe('battle_turn_sideways');
    expect(tip.message).toMatch(/sideways/);
    expect(
      mobileBattleHint({
        hasSeen: seen('battle_mobile_camera', 'battle_turn_sideways'),
        upright: true,
      }),
    ).toBeNull();
  });

  it('never tells a landscape player to turn sideways', () => {
    expect(mobileBattleHint({ hasSeen: seen('battle_mobile_camera'), upright: false })).toBeNull();
  });
});
