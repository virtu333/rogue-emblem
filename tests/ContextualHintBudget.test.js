import { describe, expect, it, vi } from 'vitest';
import { claimContextualHint } from '../src/ui/HintDisplay.js';
function fixture() {
  const seen = new Set();
  const hints = { hasSeen: (id) => seen.has(id), markSeen: vi.fn((id) => seen.add(id)) };
  const settings = { getHints: () => true };
  const scene = {
    battleParams: { battleSeed: 42 },
    runManager: { currentNodeId: 'n1' },
    registry: { get: (key) => ({ hints, settings })[key] },
  };
  return { scene, hints, settings, seen };
}
describe('shared optional helper budget', () => {
  it('allows one actually displayed explanation per encounter across helper types', () => {
    const { scene, hints } = fixture();
    expect(claimContextualHint(scene, 'battle_triangle')).toBe(true);
    expect(claimContextualHint(scene, 'battle_staff_scope')).toBe(false);
    expect(hints.markSeen).not.toHaveBeenCalled();
    hints.markSeen('battle_triangle'); // Reading exposure, not the claim, acknowledges it.
    scene.runManager.currentNodeId = 'n2';
    expect(claimContextualHint(scene, 'battle_triangle')).toBe(false);
    expect(claimContextualHint(scene, 'battle_staff_scope')).toBe(true);
  });
  it('never consumes unseen lessons while disabled or in the scripted tutorial', () => {
    const { scene, hints, settings } = fixture();
    settings.getHints = () => false;
    expect(claimContextualHint(scene, 'battle_doubling')).toBe(false);
    settings.getHints = () => true;
    scene.battleParams.tutorialMode = true;
    expect(claimContextualHint(scene, 'battle_doubling')).toBe(false);
    expect(hints.markSeen).not.toHaveBeenCalled();
    scene.battleParams.tutorialMode = false;
    expect(claimContextualHint(scene, 'battle_doubling')).toBe(true);
  });
});
