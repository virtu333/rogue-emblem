import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindHoldBattleSpeed,
  bindShiftHoldBattleSpeed,
  canHoldBattleSpeed,
} from '../src/ui/HoldBattleSpeed.js';
import { battleSpeed, enemyPhaseSpeed } from '../src/utils/combatTiming.js';

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

// The desktop hold key (docs/specs/large-maps/02-encounters-and-pacing.md §2.5).
function fakeKeyboard() {
  const handlers = new Map();
  return {
    on(type, fn) {
      handlers.set(type, [...(handlers.get(type) || []), fn]);
    },
    off(type, fn) {
      handlers.set(
        type,
        (handlers.get(type) || []).filter((h) => h !== fn),
      );
    },
    emit(type, event) {
      for (const fn of handlers.get(type) || []) fn(event);
    },
    count: () => [...handlers.values()].reduce((n, list) => n + list.length, 0),
  };
}
function shiftSetup(battleState = 'ENEMY_PHASE') {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', new EventTarget());
  const keyboard = fakeKeyboard();
  const scene = {
    battleState,
    turnManager: { currentPhase: battleState === 'ENEMY_PHASE' ? 'enemy' : 'player' },
    registry: { get: () => ({ getBattleSpeed: () => 'normal' }) },
  };
  const hold = bindShiftHoldBattleSpeed(scene, keyboard);
  const key = (type, key, mods = {}) => keyboard.emit(type, { key, ...mods });
  return { scene, keyboard, hold, key };
}
describe('Shift held alone fast-forwards the enemy phase only', () => {
  it('in ENEMY_PHASE Shift sets the hold the beat and gauge read; releasing clears it', () => {
    const { scene, key } = shiftSetup();
    key('keydown', 'Shift');
    expect(scene._holdBattleFast).toBe(true);
    expect(enemyPhaseSpeed(scene)).toBe('fast');
    key('keyup', 'Shift');
    expect(scene._holdBattleFast).toBe(false);
    expect(enemyPhaseSpeed(scene)).toBe('normal');
  });
  it('in the player phase Shift (the Shift+N modifier) never touches the speed', () => {
    for (const state of ['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU', 'PAUSED']) {
      const { scene, key } = shiftSetup(state);
      key('keydown', 'Shift');
      expect(scene._holdBattleFast, state).toBeUndefined();
      key('keydown', 'N', { shiftKey: true });
      expect(scene._holdBattleFast, state).toBeUndefined();
    }
  });
  it('a chord is not Shift alone: Ctrl/Alt/Meta+Shift never hold, another key releases', () => {
    const { scene, key } = shiftSetup();
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
      key('keydown', 'Shift', { [mod]: true });
      expect(scene._holdBattleFast, mod).toBeUndefined();
    }
    key('keydown', 'Shift');
    expect(scene._holdBattleFast).toBe(true);
    key('keydown', 'N', { shiftKey: true });
    expect(scene._holdBattleFast).toBe(false);
  });
  it('the phase ending (release), a lost focus or destroy clears it; destroy unbinds', () => {
    const { scene, key, hold, keyboard } = shiftSetup();
    key('keydown', 'Shift');
    hold.release();
    expect(scene._holdBattleFast).toBe(false);
    key('keydown', 'Shift');
    window.dispatchEvent(new Event('blur'));
    expect(scene._holdBattleFast).toBe(false);
    key('keydown', 'Shift');
    hold.destroy();
    expect(scene._holdBattleFast).toBe(false);
    expect(keyboard.count()).toBe(0);
    key('keydown', 'Shift');
    expect(scene._holdBattleFast).toBe(false);
  });
  it('never clears a hold it did not set (the phone control owns its own press)', () => {
    const { scene, hold, key } = shiftSetup();
    scene._holdBattleFast = true;
    key('keyup', 'Shift');
    hold.release();
    expect(scene._holdBattleFast).toBe(true);
  });
});
