// A unit's action menu as rows (battleMenuModel). The desktop canvas and the phone
// rail render the same commands, each with a stable id; the rail builds no canvas
// menu at all, so anything that looks a command up (the post-move direct attack, the
// rail's Wait dock and Attack highlight) must find it by id, not by a canvas row.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { InputController } from '../src/ui/InputController.js';
import { openMenuCommand } from '../src/ui/battleMenuModel.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function displayObject(seed = {}) {
  return {
    ...seed,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setColor() {
      return this;
    },
    on() {
      return this;
    },
    destroy: vi.fn(),
  };
}

// Edric with two swords (Equip), a Vulnerary (Item) and a foe next to him (Attack).
function menuScene({ rail, attackable = true }) {
  const unit = {
    name: 'Edric',
    faction: 'player',
    col: 1,
    row: 1,
    currentHP: 20,
    stats: { HP: 20 },
    weapon: weapon('Iron Sword'),
    skills: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    consumables: [{ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 }],
    graphic: { clearTint: vi.fn() },
  };
  unit.inventory = [unit.weapon, weapon('Steel Sword')];
  const foe = { name: 'Fighter', faction: 'enemy', col: 2, row: 1, currentHP: 20 };
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    selectedUnit: unit,
    playerUnits: [unit],
    enemyUnits: [foe],
    npcUnits: [],
    runManager: null,
    battleConfig: { objective: 'rout' },
    gameData: { classes: [], lords: [], skills: [] },
    registry: { get: () => null },
    isMobileInput: rail,
    cameras: { main: { width: 640, height: 480 } },
    input: { on: vi.fn(), off: vi.fn() },
    grid: {
      cols: 10,
      gridToPixel: () => ({ x: 64, y: 64 }),
      showMovementRange: vi.fn(),
      clearHighlights: vi.fn(),
    },
    add: { rectangle: () => displayObject() },
    movementRange: new Map([['1,1', { cost: 0 }]]),
    getUnitAt: (col, row) => [unit, foe].find((u) => u.col === col && u.row === row) || null,
    findAttackTargets: () => (attackable ? [foe] : []),
    findHealTargets: () => [],
    findShoveTargets: () => [],
    findPullTargets: () => [],
    findTradeTargets: () => [],
    findSwapTargets: () => [],
    findDanceTargets: () => [],
    findBreakTargets: () => [],
    _hasUsableWeaponArtTargets: () => false,
    _hasAbilities: () => false,
    _clampMenuPosition: (x, y) => ({ x, y }),
    _pinToScreen: vi.fn(),
    _isTutorialStrictGateActive: () => false,
    _makeMenuTextButton: vi.fn((_x, _y, text, _style, color, action, options = {}) =>
      displayObject({
        text,
        _action: action,
        _menuColor: color,
        _menuDisabled: !!options.disabled,
      }),
    ),
    showEquipMenu: vi.fn(),
    showItemMenu: vi.fn(),
    finishUnitAction: vi.fn(),
  });
  const flow = { begin: vi.fn() };
  scene._attackFlow = () => flow;
  if (rail)
    scene._mobileBattleHud = { available: () => true, showMenu: vi.fn(), hideMenu: vi.fn() };
  scene._inputController = new InputController(scene);
  return { scene, unit, foe, flow };
}

const published = (scene) => scene._actionMenuPublished.items;
const canvasRows = (scene) => scene.actionMenu.filter((o) => typeof o._action === 'function');

describe('a unit’s action menu as rows', () => {
  it('on the phone rail: every command has an id and no canvas row is built', () => {
    const { scene, unit } = menuScene({ rail: true });
    scene.showActionMenu(unit);
    expect(scene._makeMenuTextButton).not.toHaveBeenCalled();
    expect(scene.actionMenu).toEqual([]);
    const items = scene._mobileBattleHud.showMenu.mock.calls.at(-1)[0];
    expect(items.map((item) => [item.id, item.label])).toEqual([
      ['attack', 'Attack'],
      ['equip', 'Equip'],
      ['item', 'Item'],
      ['wait', 'Wait'],
    ]);
    expect(items).toBe(published(scene));
  });

  it('on desktop: the same commands, each canvas row tagged with its id', () => {
    const { scene, unit } = menuScene({ rail: false });
    scene.showActionMenu(unit);
    const rows = canvasRows(scene);
    expect(rows.map((row) => [row._rowId, row.text])).toEqual([
      ['attack', 'Attack'],
      ['equip', 'Equip'],
      ['item', 'Item'],
      ['wait', 'Wait'],
    ]);
    // Each published command is backed by its own canvas row.
    for (const item of published(scene)) expect(item.button._rowId).toBe(item.id);
  });

  it('activating a rail command runs it: Equip opens the equip menu, Wait ends the action', () => {
    const { scene, unit } = menuScene({ rail: true });
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'equip').onActivate();
    expect(scene.showEquipMenu).toHaveBeenCalledWith(unit);

    scene.showActionMenu(unit);
    openMenuCommand(scene, 'wait').onActivate();
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit, {
      skipCanto: true,
      session: scene._battleSession,
    });
  });

  it('a silenced mage’s Attack is greyed with the reason and does nothing', () => {
    const { scene, unit, flow } = menuScene({ rail: true });
    const fire = weapon('Fire');
    Object.assign(unit, {
      weapon: fire,
      inventory: [fire],
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
    });
    applyCondition(unit, 'silence', 2);
    scene.showActionMenu(unit);
    const attack = openMenuCommand(scene, 'attack');
    expect(attack).toMatchObject({
      label: 'Attack',
      disabled: true,
      description: 'Silenced: cannot use magic attacks.',
    });
    attack.onActivate();
    expect(flow.begin).not.toHaveBeenCalled();
    expect(scene._menuFocus?.items?.map((item) => item.id) ?? []).not.toContain('attack');
  });

  it('after moving, tapping an enemy in reach opens its forecast although the rail drew no canvas rows', () => {
    const { scene, unit, foe, flow } = menuScene({ rail: true });
    unit.hasMoved = true;
    unit._movementCommitted = true;
    scene.showActionMenu(unit);
    expect(scene._inputController.tryDirectAttack({ col: foe.col, row: foe.row })).toBe(true);
    expect(flow.begin).toHaveBeenCalledWith(unit, { target: foe });
  });

  it('no direct attack once the menu is closed or when Attack is not offered', () => {
    const { scene, unit, foe, flow } = menuScene({ rail: true });
    unit.hasMoved = true;
    scene.showActionMenu(unit);
    scene.hideActionMenu();
    scene.battleState = 'UNIT_ACTION_MENU';
    expect(openMenuCommand(scene, 'attack')).toBeNull();
    expect(scene._inputController.tryDirectAttack({ col: foe.col, row: foe.row })).toBe(false);

    const noTarget = menuScene({ rail: true, attackable: false });
    noTarget.unit.hasMoved = true;
    noTarget.scene.showActionMenu(noTarget.unit);
    expect(openMenuCommand(noTarget.scene, 'attack')).toBeNull();
    expect(flow.begin).not.toHaveBeenCalled();
  });

  it('Wait carries the village note on both renderers', () => {
    for (const rail of [true, false]) {
      const { scene, unit } = menuScene({ rail });
      scene._villageController = { getWaitNote: () => 'Ending here visits the village' };
      scene.showActionMenu(unit);
      expect(openMenuCommand(scene, 'wait').note).toBe('Ending here visits the village');
    }
  });
});

// The Equip and Item submenus: the same model, the real menu code (not the stubs above).
function submenuScene({ rail }) {
  const ctx = menuScene({ rail });
  const { scene } = ctx;
  scene.showEquipMenu = BattleScene.prototype.showEquipMenu;
  scene.showItemMenu = BattleScene.prototype.showItemMenu;
  scene._getWeaponArtCatalog = () => [];
  scene._showWeaponDetailTooltip = vi.fn();
  scene._hideWeaponDetailTooltip = vi.fn();
  scene.useConsumable = vi.fn();
  scene.add.text = () => displayObject();
  return ctx;
}

describe('the Equip and Item submenus as rows', () => {
  it('Equip on the rail: a row per weapon and Back, no canvas; choosing one equips it', () => {
    const { scene, unit } = submenuScene({ rail: true });
    const steel = unit.inventory[1];
    scene.showEquipMenu(unit);
    expect(scene._makeMenuTextButton).not.toHaveBeenCalled();
    expect(published(scene).map((item) => [item.id, item.label, item.item?.name ?? null])).toEqual([
      ['weapon:0', 'E Iron Sword', 'Iron Sword'],
      ['weapon:1', '  Steel Sword', 'Steel Sword'],
      ['back', 'Back', null],
    ]);
    openMenuCommand(scene, 'weapon:1').onActivate();
    expect(unit.weapon).toBe(steel);
    // Back at the unit's own menu.
    expect(openMenuCommand(scene, 'wait')).not.toBeNull();
    expect(scene.inEquipMenu).toBe(false);
  });

  it('Equip Back returns to the unit menu without equipping', () => {
    const { scene, unit } = submenuScene({ rail: true });
    const iron = unit.weapon;
    scene.showEquipMenu(unit);
    openMenuCommand(scene, 'back').onActivate();
    expect(unit.weapon).toBe(iron);
    expect(scene.inEquipMenu).toBe(false);
    expect(openMenuCommand(scene, 'equip')).not.toBeNull();
  });

  it('Item on the rail: a Vulnerary at full HP is greyed with the reason and cannot be used', () => {
    const { scene, unit } = submenuScene({ rail: true });
    scene.showItemMenu(unit);
    expect(scene._makeMenuTextButton).not.toHaveBeenCalled();
    const vulnerary = openMenuCommand(scene, 'item:0');
    expect(vulnerary).toMatchObject({
      label: 'Vulnerary (3)',
      disabled: true,
      description: 'HP already full',
    });
    expect(vulnerary.item).toBe(unit.consumables[0]);
    vulnerary.onActivate();
    expect(scene.useConsumable).not.toHaveBeenCalled();
  });

  it('Item on the rail: a hurt but Wounded unit sees the Vulnerary greyed with the Wounded reason', () => {
    const { scene, unit } = submenuScene({ rail: true });
    unit.currentHP = 8;
    applyCondition(unit, 'wounded', 2);
    scene.showItemMenu(unit);
    const vulnerary = openMenuCommand(scene, 'item:0');
    expect(vulnerary).toMatchObject({
      disabled: true,
      description: 'Wounded: only a staff heals',
    });
    vulnerary.onActivate();
    expect(scene.useConsumable).not.toHaveBeenCalled();
  });

  it('Item on the rail: a hurt unit uses the Vulnerary', () => {
    const { scene, unit } = submenuScene({ rail: true });
    unit.currentHP = 8;
    scene.showItemMenu(unit);
    const vulnerary = openMenuCommand(scene, 'item:0');
    expect(vulnerary.disabled).toBe(false);
    vulnerary.onActivate();
    expect(scene.useConsumable).toHaveBeenCalledWith(unit, unit.consumables[0]);
  });

  it('on desktop both submenus tag each canvas row with its row id', () => {
    for (const open of ['showEquipMenu', 'showItemMenu']) {
      const { scene, unit } = submenuScene({ rail: false });
      scene[open](unit);
      const items = published(scene);
      expect(canvasRows(scene).map((row) => row._rowId)).toEqual(items.map((item) => item.id));
      for (const item of items) expect(item.button._rowId).toBe(item.id);
    }
  });
});
