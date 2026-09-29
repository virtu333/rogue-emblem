// The tutorial coach reads the open action menu to say "Attack" or "Wait". Desktop
// rows are Phaser Text objects (label in `.text`, no `.label`); the phone rail's
// items carry `label` and `disabled`. A greyed row is not an option either way.
import { describe, it, expect } from 'vitest';
import { availableMenuLabels, tutorialCoachState } from '../src/ui/tutorialCoachModel.js';

// Shaped like BattleScene._makeMenuTextButton's result, plus a background that is not a row.
const row = (text, { disabled = false } = {}) => ({
  text,
  _action: () => {},
  _menuDisabled: disabled,
});
const panel = { type: 'Rectangle' };

const coachAt = (menu) =>
  tutorialCoachState({
    step: 5,
    gateReleased: true,
    phase: 'player',
    state: 'UNIT_ACTION_MENU',
    touch: false,
    commanderName: 'Edric',
    units: [],
    enemies: 1,
    menu,
    selected: 'Edric',
  });

describe('Tutorial coach: which actions the open menu offers', () => {
  it('reads desktop canvas rows by their text', () => {
    const scene = { actionMenu: [panel, row('Attack'), row('Item'), row('Wait')] };
    expect(availableMenuLabels(scene)).toEqual(['Attack', 'Item', 'Wait']);
    expect(coachAt(availableMenuLabels(scene)).id).toBe('act-attack');
  });

  it('leaves out a greyed row on desktop and on the phone rail', () => {
    const desktop = { actionMenu: [row('Attack', { disabled: true }), row('Wait')] };
    expect(availableMenuLabels(desktop)).toEqual(['Wait']);
    expect(coachAt(availableMenuLabels(desktop)).id).toBe('act-wait');

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
