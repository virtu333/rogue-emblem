import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindHoldBattleSpeed, canHoldBattleSpeed } from '../src/ui/HoldBattleSpeed.js';
import { battleSpeed } from '../src/utils/combatTiming.js';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', new EventTarget());
  const control = new EventTarget();
  control.setAttribute = vi.fn();
  control.setPointerCapture = vi.fn();
  const scene = {
    turnManager: { currentPhase: 'enemy' },
    registry: { get: () => ({ getBattleSpeed: () => 'normal' }) },
  };
  const destroy = bindHoldBattleSpeed(control, scene);
  const fire = (type, props = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, props);
    control.dispatchEvent(event);
  };
  return { control, scene, destroy, fire };
}
describe('phase-level battle speed hold', () => {
  it('keeps one held gesture through exchange gaps, affecting only active exchanges', () => {
    const { scene, fire, destroy } = setup();
    expect(canHoldBattleSpeed(scene)).toBe(true);
    fire('pointerdown', { pointerId: 1 });
    expect(scene._holdBattleFast).toBe(true);
    expect(battleSpeed(scene)).toBe('normal');
    scene._combatSpeedSnapshot = 'normal';
    expect(battleSpeed(scene)).toBe('fast');
    delete scene._combatSpeedSnapshot;
    expect(canHoldBattleSpeed(scene)).toBe(true);
    expect(scene._holdBattleFast).toBe(true);
    scene._combatSpeedSnapshot = 'normal';
    expect(battleSpeed(scene)).toBe('fast');
    fire('pointerup');
    expect(battleSpeed(scene)).toBe('normal');
    destroy();
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur'])('%s releases the gesture', (event) => {
    const { scene, fire, destroy } = setup();
    fire('pointerdown');
    fire(event);
    expect(scene._holdBattleFast).toBe(false);
    destroy();
  });
  it('handles capture failure and keyboard release without leaving fast mode stuck', () => {
    const { control, scene, fire, destroy } = setup();
    control.setPointerCapture.mockImplementation(() => {
      throw new Error('stale pointer');
    });
    fire('pointerdown', { pointerId: 1 });
    expect(scene._holdBattleFast).toBe(false);
    fire('keydown', { key: ' ' });
    expect(scene._holdBattleFast).toBe(true);
    fire('keyup', { key: ' ' });
    expect(scene._holdBattleFast).toBe(false);
    fire('keydown', { key: 'Enter' });
    destroy();
    expect(scene._holdBattleFast).toBe(false);
    fire('keydown', { key: 'Enter' });
    expect(scene._holdBattleFast).toBe(false);
  });
});
