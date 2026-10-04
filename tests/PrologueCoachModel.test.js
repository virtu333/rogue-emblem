// The prologue coach reads the live guided step first, then the open action menu to say
// "Attack" or "Wait". Desktop rows are Phaser Text objects (label in `.text`, no `.label`);
// the phone rail's items carry `label` and `disabled`. A greyed row is not an option.
import { describe, it, expect } from 'vitest';
import { availableMenuLabels, prologueCoachState } from '../src/ui/prologueCoachModel.js';
import { prologueCoachGoal } from '../src/data/prologueContent.js';

// Shaped like BattleScene._makeMenuTextButton's result, plus a background that is not a row.
const row = (text, { disabled = false } = {}) => ({
  text,
  _action: () => {},
  _menuDisabled: disabled,
});
const panel = { type: 'Rectangle' };

const free = (overrides = {}) =>
  prologueCoachState({
    scripted: null,
    gated: false,
    phase: 'player',
    state: 'UNIT_ACTION_MENU',
    touch: false,
    commanderName: 'Edric',
    units: [],
    enemies: 1,
    menu: [],
    selected: 'Edric',
    ...overrides,
  });

describe('Prologue coach: the guided step', () => {
  it('shows the beat goal while its step is live, with its anchor and Skip step', () => {
    const scripted = prologueCoachGoal('p1_move_to_fort', {
      touch: true,
      lord: 'Edric',
      gateTile: { col: 3, row: 2 },
    });
    const state = free({ scripted, state: 'UNIT_SELECTED' });
    expect(state).toMatchObject({
      id: 'p1_move_to_fort',
      chapter: 'move',
      goal: 'Move onto the Fort',
      anchor: { kind: 'tile', col: 3, row: 2 },
      canSkip: true,
      scriptedStep: true,
    });
    expect(state.detail).toContain('Tap the gold-framed Fort');
    expect(prologueCoachGoal('p1_select_edric', { touch: false }).detail).toContain('Click Edric');
  });

  it('hides while a gate holds with no goal (its note is showing), then plays free', () => {
    expect(free({ gated: true })).toBeNull();
    expect(free({ state: 'PLAYER_IDLE', enemies: 0 })).toBeNull();
    const fight = free({
      state: 'PLAYER_IDLE',
      enemies: 2,
      units: [{ name: 'Edric', acted: false, hp: 20, maxHp: 20 }],
    });
    expect(fight).toMatchObject({ id: 'fight', chapter: 'fight', goal: 'Defeat all 2 enemies' });
    expect(fight.detail).toContain('this chapter starts over');
  });

  it('teaches a ranged unit its actual range', () => {
    const info = free({
      state: 'PLAYER_IDLE',
      enemies: 2,
      units: [{ name: 'Sera', hp: 20, maxHp: 20, attackRange: { min: 1, max: 2 } }],
      selected: null,
    });
    expect(info.detail).toContain('1–2 tiles');
    expect(info.detail).not.toContain('next to');
  });
});

describe('Prologue coach: which actions the open menu offers', () => {
  it('reads desktop canvas rows by their text', () => {
    const scene = { actionMenu: [panel, row('Attack'), row('Item'), row('Wait')] };
    expect(availableMenuLabels(scene)).toEqual(['Attack', 'Item', 'Wait']);
    expect(free({ menu: availableMenuLabels(scene) }).id).toBe('act-attack');
  });

  it('leaves out a greyed row on desktop and on the phone rail', () => {
    const desktop = { actionMenu: [row('Attack', { disabled: true }), row('Wait')] };
    expect(availableMenuLabels(desktop)).toEqual(['Wait']);
    expect(free({ menu: availableMenuLabels(desktop) }).id).toBe('act-wait');

    const phone = {
      actionMenu: [row('Attack'), row('Wait')],
      _mobileBattleHud: {
        menu: {
          items: [
            { label: 'Attack', disabled: true },
            { label: 'Wait', disabled: false },
          ],
        },
      },
    };
    expect(availableMenuLabels(phone)).toEqual(['Wait']);
  });

  it('offers nothing when no menu is open', () => {
    expect(availableMenuLabels({})).toEqual([]);
    expect(availableMenuLabels({ actionMenu: null })).toEqual([]);
  });
});
