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

describe('Prologue coach: the free goal follows the board', () => {
  const idle = (overrides) =>
    free({
      state: 'PLAYER_IDLE',
      selected: null,
      units: [
        { name: 'Edric', col: 2, row: 6, acted: false, hp: 20, maxHp: 20 },
        { name: 'Gaspar', col: 4, row: 6, acted: false, hp: 30, maxHp: 30 },
      ],
      ...overrides,
    });

  it('nobody reaches the last foe, a guard: advance on it, pointing at its tile', () => {
    const state = idle({
      turn: 3,
      strikers: [],
      foes: [{ name: 'Soldier', col: 9, row: 0, waits: true }],
    });
    expect(state).toMatchObject({
      id: 'advance',
      chapter: 'win',
      goal: 'Advance on the last enemy',
      anchor: { kind: 'tile', col: 9, row: 0 },
    });
    // It holds only until someone enters its reach or hits it (HoldActivation): never "won't come".
    expect(state.detail).toContain(
      'The Soldier holds its post until someone steps into its red reach or strikes it; then it comes for you.',
    );
    expect(state.detail).not.toContain("won't come");
    expect(state.detail).not.toContain('Attack');
    expect(state.detail).not.toContain('starts over');
  });

  it('foes that will come: close in or take cover; the nearest is pointed at', () => {
    const state = idle({
      enemies: 2,
      strikers: [],
      foes: [
        { name: 'Fighter', col: 9, row: 9, waits: false },
        { name: 'Archer', col: 3, row: 1, waits: false },
      ],
    });
    expect(state).toMatchObject({ id: 'advance', goal: 'Advance on the enemy' });
    expect(state.anchor).toEqual({ kind: 'tile', col: 3, row: 1 });
    expect(state.detail).toContain('take cover and let them come');
  });

  it('names a unit that can strike this turn, not just the first in the roster', () => {
    const state = idle({
      turn: 2,
      strikers: ['Gaspar'],
      foes: [{ name: 'Fighter', col: 5, row: 5, waits: false }],
    });
    expect(state).toMatchObject({ id: 'fight', goal: 'Defeat the last enemy' });
    expect(state.detail).toMatch(/^Gaspar can reach an enemy this turn/);
    expect(state.detail).not.toContain('starts over');
  });

  it('the fall warning is turn 1 advice only', () => {
    const foes = [{ name: 'Fighter', col: 5, row: 5, waits: false }];
    expect(idle({ turn: 1, strikers: ['Edric'], foes }).detail).toContain('starts over');
    expect(idle({ turn: 2, strikers: ['Edric'], foes }).detail).not.toContain('starts over');
  });
});

describe('Prologue coach: protecting a hurt unit names what it can heal with', () => {
  const hurt = (units) =>
    free({ state: 'PLAYER_IDLE', selected: null, enemies: 1, turn: 2, units });
  const gaspar = (healItem) => ({ name: 'Gaspar', acted: false, hp: 9, maxHp: 30, healItem });
  const edric = (healItem) => ({ name: 'Edric', acted: false, hp: 20, maxHp: 20, healItem });

  it('its own Vulnerary: Item', () => {
    const state = hurt([edric(null), gaspar('Vulnerary')]);
    expect(state).toMatchObject({ id: 'protect', goal: 'Protect Gaspar' });
    expect(state.detail).toContain('Select Gaspar, then Item → Vulnerary');
  });

  it("none of its own but an ally's: Trade for it, then Item (never 'Item' it lacks)", () => {
    const state = hurt([edric('Vulnerary'), gaspar(null)]);
    expect(state.detail).toBe(
      'Gaspar is badly hurt and carries no Vulnerary, but Edric does. Move Gaspar next to Edric, choose Trade and take it, then Item → Vulnerary. Or pull back out of reach.',
    );
  });

  it('nothing anywhere: pull back', () => {
    const state = hurt([edric(null), gaspar(null)]);
    expect(state.detail).toBe(
      'Gaspar is badly hurt and has nothing to heal with. Pull back out of the red reach.',
    );
  });
});

describe('Prologue coach: which actions the open menu offers', () => {
  it('reads desktop canvas rows by their text', () => {
    const scene = { actionMenu: [panel, row('Attack'), row('Item'), row('Wait')] };
    expect(availableMenuLabels(scene)).toEqual(['Attack', 'Item', 'Wait']);
    expect(free({ menu: availableMenuLabels(scene) }).id).toBe('act-attack');
  });

  describe('a hurt ally and a selected healer: the heal goal holds through move and menu', () => {
    const sera = { name: 'Sera', hp: 18, maxHp: 18, healer: true };
    const tamsin = { name: 'Tamsin', hp: 6, maxHp: 17 };
    const edric = { name: 'Edric', hp: 20, maxHp: 20 };

    it('menu offers Attack and Heal: Heal the hurt ally, not the forecast advice', () => {
      const state = free({
        selected: 'Sera',
        units: [sera, tamsin],
        menu: ['Attack', 'Heal', 'Wait'],
      });
      expect(state).toMatchObject({ id: 'act-heal', goal: 'Heal Tamsin' });
      expect(state.detail).not.toContain('forecast');
    });

    it('the healer selected, before the move: walk next to the hurt ally', () => {
      const state = free({ state: 'UNIT_SELECTED', selected: 'Sera', units: [sera, tamsin] });
      expect(state).toMatchObject({
        id: 'heal',
        goal: 'Heal Tamsin',
        anchor: { kind: 'unit', name: 'Tamsin' },
      });
    });

    it('a non-healer selected, or nobody hurt: the ordinary advice', () => {
      expect(
        free({ selected: 'Edric', units: [edric, sera, tamsin], menu: ['Attack', 'Wait'] }).id,
      ).toBe('act-attack');
      expect(
        free({ state: 'UNIT_SELECTED', selected: 'Edric', units: [edric, sera, tamsin] }).id,
      ).toBe('move-free');
      const healthy = { ...tamsin, hp: 17 };
      expect(
        free({ selected: 'Sera', units: [sera, healthy], menu: ['Attack', 'Heal', 'Wait'] }).id,
      ).toBe('act-attack');
    });

    it('the hurt healer herself is not told to heal herself', () => {
      const hurtSera = { ...sera, hp: 5 };
      expect(
        free({ selected: 'Sera', units: [hurtSera, edric], menu: ['Attack', 'Heal', 'Wait'] }).id,
      ).toBe('act-attack');
    });
  });

  it('names Item only when the menu offers it (a unit with nothing to use has no Item row)', () => {
    const without = free({ menu: ['Trade', 'Wait'] });
    expect(without.id).toBe('act-wait');
    expect(without.detail).toBe('No enemy in reach. Wait ends this move.');
    expect(free({ menu: ['Item', 'Wait'] }).detail).toBe(
      'No enemy in reach. Wait ends this move; Item uses what it carries.',
    );
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
