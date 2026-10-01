// Phone battle rail (playtest 4): Wait is pinned in the fixed dock beside a compact
// Danger in a unit's action menu, so a long command list never pushes it below the fold.
// The canvas menu and the keyboard/gamepad order (scene._menuFocus) are untouched.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import {
  MobileBattleHUD,
  dockedEndTurn,
  pinnedRailCommand,
  unitFocusedRail,
  uprightBattleRail,
} from '../src/ui/MobileBattleHUD.js';

function fakeElement(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    listeners: {},
    dataset: {},
    hidden: false,
    disabled: false,
  };
  node.classList = {
    toggle: (name, on) => {
      const set = new Set(node.className.split(/\s+/).filter(Boolean));
      if (on ?? !set.has(name)) set.add(name);
      else set.delete(name);
      node.className = [...set].join(' ');
    },
    contains: (name) => node.className.split(/\s+/).includes(name),
  };
  node.append = (...kids) => node.children.push(...kids);
  node.prepend = (...kids) => node.children.unshift(...kids);
  node.replaceChildren = (...kids) => (node.children = [...kids]);
  node.setAttribute = (key, value) => (node.attributes[key] = String(value));
  node.addEventListener = (type, fn) => (node.listeners[type] ||= []).push(fn);
  return node;
}

function items(labels) {
  return labels.map((label) => ({
    // Root commands carry their row id (BattleScene.showActionMenu); pickers do not.
    id: ['Attack', 'Shove', 'Pull', 'Trade', 'Swap', 'Item', 'Wait'].includes(label)
      ? label.toLowerCase()
      : null,
    label,
    disabled: label === 'Attack',
    description: label === 'Attack' ? 'No target in range 1' : undefined,
    onActivate: vi.fn(),
  }));
}

function hudFor(state, labels) {
  vi.stubGlobal('document', { createElement: fakeElement });
  const scene = {
    _battleSession: 1,
    battleState: state,
    turnManager: { currentPhase: 'player' },
    dangerZone: { visible: false, tiles: [] },
    playerUnits: [],
    keepDangerVisible: false,
    _menuFocus: { items: [], index: 0 },
  };
  const hud = Object.create(MobileBattleHUD.prototype);
  hud.scene = scene;
  hud.dock = fakeElement('div');
  hud.available = () => true;
  const unit = { name: 'Support' };
  scene.selectedUnit = unit;
  scene.actionMenu = [];
  hud.menu = labels ? { items: items(labels), objects: scene.actionMenu, unit } : null;
  return { hud, scene };
}

const SIX = ['Attack', 'Shove', 'Pull', 'Trade', 'Swap', 'Wait'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pinnedRailCommand', () => {
  it('pins Wait from a unit action menu only', () => {
    const menu = { items: items(SIX) };
    expect(pinnedRailCommand(menu, { state: 'UNIT_ACTION_MENU' })).toBe(menu.items[5]);
    // Any length: a two-command menu pins it too, so Wait never moves between menus.
    const short = { items: items(['Item', 'Wait']) };
    expect(pinnedRailCommand(short, { state: 'UNIT_ACTION_MENU' })?.label).toBe('Wait');
  });

  it('pins Wait in the Canto confirm, the same as in an action menu', () => {
    const menu = { items: items(['Wait']) };
    expect(pinnedRailCommand(menu, { state: 'CANTO_CONFIRM' })).toBe(menu.items[0]);
    expect(pinnedRailCommand(menu, { state: 'CANTO_CONFIRM', endTurnPending: true })).toBeNull();
    // The pick-a-tile half of Canto has no menu to pin from.
    expect(pinnedRailCommand(menu, { state: 'CANTO_MOVING' })).toBeNull();
  });

  it('leaves submenus, other states and the end-turn prompt alone', () => {
    const menu = { items: items(SIX) };
    expect(pinnedRailCommand(menu, { state: 'UNIT_ACTION_MENU', submenu: true })).toBeNull();
    expect(pinnedRailCommand(menu, { state: 'UNIT_ACTION_MENU', endTurnPending: true })).toBe(null);
    for (const state of ['PLAYER_IDLE', 'UNIT_SELECTED', 'SELECTING_TARGET', 'CANTO_MOVING'])
      expect(pinnedRailCommand(menu, { state })).toBeNull();
    expect(pinnedRailCommand(null, { state: 'UNIT_ACTION_MENU' })).toBeNull();
    const picker = { items: items(['Iron Sword', 'Steel Sword', 'Back']) };
    expect(pinnedRailCommand(picker, { state: 'UNIT_ACTION_MENU' })).toBeNull();
  });
});

describe('the dock', () => {
  it('holds a pinned Wait beside Danger in the Canto confirm', () => {
    const { hud } = hudFor('CANTO_CONFIRM', ['Wait']);
    hud.syncDock('CANTO_CONFIRM', hud.menu.items[0]);
    expect(hud.dock.hidden).toBe(false);
    expect(hud.dock.classList.contains('has-pinned')).toBe(true);
    expect(hud.dock.children[0].textContent).toBe('Wait');
  });

  it('holds Wait and a compact Danger in one row in a six-command menu', () => {
    const { hud, scene } = hudFor('UNIT_ACTION_MENU', SIX);
    const wait = hud.menu.items[5];
    hud.syncDock('UNIT_ACTION_MENU', wait);
    expect(hud.dock.hidden).toBe(false);
    expect(hud.dock.classList.contains('has-pinned')).toBe(true);
    const [first, second] = hud.dock.children;
    expect(hud.dock.children).toHaveLength(2);
    expect(first.textContent).toBe('Wait');
    expect(first.className).toContain('mb-pinned-command');
    expect(first.className).not.toContain('mb-primary');
    expect(first.disabled).toBe(false);
    // It is the menu's own item: focus and activation go through the same entry.
    expect(wait.domButton).toBe(first);
    scene._menuFocus.items = hud.menu.items.filter((i) => !i.disabled);
    first.listeners.focus[0]();
    expect(scene._menuFocus.index).toBe(4);
    expect(first.className).toContain('mb-menu-focused');
    expect(second.className).toContain('mb-danger-toggle');
    expect(second.className).toContain('is-compact');
    expect(second.attributes['aria-label']).toBe('Danger');
  });

  it('compact Danger still reads allies in reach when shown', () => {
    const { hud, scene } = hudFor('UNIT_ACTION_MENU', SIX);
    scene.dangerZone = { visible: true, tiles: [{ col: 1, row: 1, tier: 1 }] };
    scene.playerUnits = [{ col: 1, row: 1, currentHP: 5 }];
    hud.syncDock('UNIT_ACTION_MENU', hud.menu.items[5]);
    const danger = hud.dock.children[1];
    const text = danger.children.find((c) => c.className === 'mb-danger-text');
    expect(text.children.map((c) => c.textContent)).toEqual(['Danger', '1 in reach']);
    expect(danger.attributes['aria-pressed']).toBe('true');
  });

  it('keeps the full-width Danger when nothing is pinned', () => {
    for (const state of ['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU']) {
      const { hud } = hudFor(state, state === 'UNIT_ACTION_MENU' ? SIX : null);
      hud.syncDock(state, null);
      expect(hud.dock.children).toHaveLength(1);
      expect(hud.dock.classList.contains('has-pinned')).toBe(false);
      expect(hud.dock.children[0].className).not.toContain('is-compact');
      const cue = hud.dock.children[0].children[1].children[1];
      expect(cue.textContent).toBe('Enemy reach · hold to pin');
    }
  });

  it('hides during the enemy phase and never pins there', () => {
    const { hud, scene } = hudFor('UNIT_ACTION_MENU', SIX);
    scene.turnManager.currentPhase = 'enemy';
    hud.syncDock('UNIT_ACTION_MENU', hud.menu.items[5]);
    expect(hud.dock.hidden).toBe(true);
    expect(hud.dock.children).toHaveLength(0);
    expect(hud.dock.classList.contains('has-pinned')).toBe(false);
  });
});

// Playtest 2026-09-26: on the upright rail at 375x667, terrain details pushed End turn
// under the fold. There End turn joins the dock whenever it is offered.
describe('End turn on the upright rail', () => {
  it('docks End turn only on the upright rail, idle or with a unit selected', () => {
    for (const state of ['PLAYER_IDLE', 'UNIT_SELECTED'])
      expect(dockedEndTurn({ state, uprightRail: true }), state).toBe(true);
    expect(dockedEndTurn({ state: 'PLAYER_IDLE', uprightRail: false })).toBe(false);
    // The end-turn prompt has its own End turn now; a unit's menu pins Wait instead.
    expect(dockedEndTurn({ state: 'PLAYER_IDLE', uprightRail: true, endTurnPending: true })).toBe(
      false,
    );
    for (const state of ['UNIT_ACTION_MENU', 'SELECTING_TARGET', 'ENEMY_PHASE'])
      expect(dockedEndTurn({ state, uprightRail: true }), state).toBe(false);
  });

  it('reads the rail as upright only for the capable touch layout held upright', () => {
    const env = (classes, portrait) => ({
      document: { documentElement: { classList: { contains: (c) => classes.includes(c) } } },
      matchMedia: (q) => ({ matches: q === '(orientation: portrait)' && portrait }),
    });
    expect(uprightBattleRail(env(['touch-ui', 'portrait-battle-capable'], true))).toBe(true);
    expect(uprightBattleRail(env(['touch-ui', 'portrait-battle-capable'], false))).toBe(false);
    expect(uprightBattleRail(env(['portrait-battle-capable'], true))).toBe(false);
    expect(uprightBattleRail(env(['touch-ui'], true))).toBe(false);
    expect(uprightBattleRail({})).toBe(false);
  });

  it('puts End turn beside a compact Danger in one dock row', () => {
    const { hud } = hudFor('PLAYER_IDLE', null);
    hud.syncDock('PLAYER_IDLE', null, true);
    expect(hud.dock.classList.contains('has-pinned')).toBe(true);
    const [endTurn, danger] = hud.dock.children;
    expect(hud.dock.children).toHaveLength(2);
    expect(endTurn.textContent).toBe('End turn…');
    expect(endTurn.className).toContain('mb-end-turn');
    expect(danger.className).toContain('is-compact');
  });

  it('never shows End turn beside a pinned Wait or in the enemy phase', () => {
    const { hud, scene } = hudFor('UNIT_ACTION_MENU', SIX);
    hud.syncDock('UNIT_ACTION_MENU', hud.menu.items[5], true);
    expect(hud.dock.children.map((c) => c.textContent)).toContain('Wait');
    expect(hud.dock.children.some((c) => c.textContent === 'End turn…')).toBe(false);
    scene.turnManager.currentPhase = 'enemy';
    hud.syncDock('PLAYER_IDLE', null, true);
    expect(hud.dock.hidden).toBe(true);
    expect(hud.dock.children).toHaveLength(0);
  });
});

describe('the upright header yields to a unit in action', () => {
  it('while a unit is chosen, moving, acting, targeting or reading its forecast', () => {
    for (const state of [
      'UNIT_SELECTED',
      'UNIT_MOVING',
      'CANTO_MOVING',
      'SELECTING_TARGET',
      'SELECTING_HEAL_TARGET',
      'SELECTING_TRADE_TARGET',
      'SHOWING_FORECAST',
      'CONFIRMING_ATTACK',
    ])
      expect(unitFocusedRail({ state, selected: true }), state).toBe(true);
    expect(unitFocusedRail({ state: 'UNIT_ACTION_MENU', selected: true, menu: true })).toBe(true);
    expect(unitFocusedRail({ state: 'CANTO_CONFIRM', selected: true, menu: true })).toBe(true);
  });

  it('never at idle, in the enemy phase, in Formation, or without a selected unit', () => {
    for (const state of [
      'PLAYER_IDLE',
      'ENEMY_PHASE',
      'COMBAT_RESOLVING',
      'TURN_START_RESOLVING',
      'DEPLOY_POSITIONING',
      'BATTLE_END',
    ])
      expect(unitFocusedRail({ state, selected: true, menu: true }), state).toBe(false);
    // An action menu still being built (no rail menu yet), or no unit selected.
    expect(unitFocusedRail({ state: 'UNIT_ACTION_MENU', selected: true, menu: false })).toBe(false);
    expect(unitFocusedRail({ state: 'CANTO_CONFIRM', selected: true, menu: false })).toBe(false);
    expect(unitFocusedRail({ state: 'SELECTING_TARGET', selected: false })).toBe(false);
  });
});
