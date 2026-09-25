// Target-first attack flow (AttackFlowController + the BattleScene seams it
// drives): Attack → range-union targets → forecast on the default weapon →
// switch weapons/targets in the forecast → Cancel/Back → confirm.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
  claimContextualHint: vi.fn(() => false),
  observeContextualHint: vi.fn(() => () => {}),
  isHintTextVisible: vi.fn(() => false),
}));
const renders = [];
vi.mock('../src/ui/ForecastOverlay.js', () => ({
  ForecastOverlay: class {
    constructor(scene) {
      this.scene = scene;
      this.displayObjects = [];
      this.destroyed = false;
    }
    render(config) {
      renders.push(config);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { InputController } from '../src/ui/InputController.js';
import { restoreWeaponPreview } from '../src/ui/WeaponPreviewSession.js';
import { InputAction } from '../src/utils/InputActions.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name, uid) => ({
  ...structuredClone(data.weapons.find((w) => w.name === name)),
  uid,
});

function makeUnit(name, faction, col, row, inventory, extra = {}) {
  return {
    name,
    faction,
    col,
    row,
    className: faction === 'player' ? 'Lord' : 'Fighter',
    level: 5,
    skills: [],
    affixes: [],
    _conditions: [],
    stats: { HP: 22, STR: 7, MAG: 1, SKL: 7, SPD: 8, DEF: 5, RES: 2, LCK: 5, MOV: 5 },
    currentHP: 22,
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Bow', rank: 'Prof' },
    ],
    weaponRank: 'Prof',
    inventory,
    weapon: inventory[0] || null,
    battleEntityId: `u${name.length}${col}${row}`,
    ...extra,
  };
}

function makeScene() {
  const iron = weapon('Iron Sword', 'iron');
  const steel = weapon('Steel Sword', 'steel');
  const bow = weapon('Iron Bow', 'bow');
  const hero = makeUnit('Edric', 'player', 5, 5, [iron, steel, bow]);
  hero.battleEntityId = 'u1';
  const adjacent = makeUnit('Fighter', 'enemy', 6, 5, [weapon('Iron Axe', 'axe')]);
  adjacent.battleEntityId = 'u2';
  const ranged = makeUnit('Archer', 'enemy', 5, 7, [weapon('Iron Bow', 'ebow')]);
  ranged.battleEntityId = 'u3';
  const outOfReach = makeUnit('Knight', 'enemy', 12, 12, [weapon('Iron Lance', 'lance')]);
  outOfReach.battleEntityId = 'u4';
  const terrain = data.terrain[0];
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    gameData: data,
    battleParams: {},
    battleConfig: {},
    runManager: null,
    turnManager: { currentPhase: 'player', turnNumber: 1 },
    playerUnits: [hero],
    enemyUnits: [adjacent, ranged, outOfReach],
    npcUnits: [],
    selectedUnit: hero,
    battleState: 'UNIT_ACTION_MENU',
    attackTargets: [],
    _battleRewindPolicy: 'fixed-v1',
    visionBaseSeed: 7,
    grid: {
      fogEnabled: false,
      cols: 20,
      rows: 20,
      isVisible: () => true,
      getTerrainAt: () => terrain,
      clearAttackHighlights: vi.fn(),
      clearHighlights: vi.fn(),
      showAttackRange: vi.fn(),
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
    },
    registry: { get: () => null },
    _gridCursor: { snapTo: vi.fn() },
    _pinToScreen: vi.fn(),
    hideActionMenu: vi.fn(),
    showActionMenu: vi.fn(function (unit) {
      restoreWeaponPreview(this);
      this.battleState = 'UNIT_ACTION_MENU';
      this.selectedUnit = unit;
    }),
    isStoryInputLocked: () => false,
    commitVisionSnapshotIfPending: vi.fn(),
    executeCombat: vi.fn(),
    refreshEndTurnControl: vi.fn(),
  });
  return { scene, hero, iron, steel, bow, adjacent, ranged, outOfReach };
}

let random;
beforeEach(() => {
  renders.length = 0;
  random = vi.spyOn(Math, 'random');
});
afterEach(() => random.mockRestore());

describe('target selection (Attack)', () => {
  it('highlights every enemy any usable weapon reaches, nearest first, without equipping', () => {
    const { scene, hero, iron, adjacent, ranged } = makeScene();
    const order = [...hero.inventory];
    expect(scene._attackFlow().begin(hero)).toBe(true);
    expect(scene.battleState).toBe('SELECTING_TARGET');
    expect(scene.attackTargets).toEqual([adjacent, ranged]);
    expect(scene.grid.showAttackRange).toHaveBeenCalledWith([
      { col: 6, row: 5 },
      { col: 5, row: 7 },
    ]);
    expect(scene._attackFlowController.focusedTarget).toBe(adjacent);
    expect(scene._gridCursor.snapTo).toHaveBeenLastCalledWith(6, 5);
    expect(hero.weapon).toBe(iron);
    expect(hero.inventory).toEqual(order);
  });

  it('returns to the action menu when nothing is in reach', () => {
    const { scene, hero, adjacent, ranged } = makeScene();
    scene.enemyUnits = scene.enemyUnits.filter((e) => e !== adjacent && e !== ranged);
    expect(scene._attackFlow().begin(hero)).toBe(false);
    expect(scene.showActionMenu).toHaveBeenCalledWith(hero);
  });

  it('arrow keys / pad cycle targets; Enter opens the focused forecast', async () => {
    const { scene, hero, adjacent, ranged } = makeScene();
    const flow = scene._attackFlow();
    flow.begin(hero);
    const key = (k) => ({ key: k, preventDefault: vi.fn() });
    expect(flow.handleKey(key('ArrowRight'))).toBe(true);
    expect(flow.focusedTarget).toBe(ranged);
    flow.handleInputAction(InputAction.NAVIGATE, { dx: 1 }, InputAction);
    expect(flow.focusedTarget).toBe(adjacent);
    flow.handleInputAction(InputAction.PREV_UNIT, null, InputAction);
    expect(flow.focusedTarget).toBe(ranged);
    flow.handleKey(key('Enter'));
    await Promise.resolve();
    expect(scene.battleState).toBe('SHOWING_FORECAST');
    expect(scene.forecastTarget).toBe(ranged);
  });
});

describe('forecast', () => {
  it('defaults to the equipped weapon when it reaches the target', async () => {
    const { scene, hero, iron, steel, adjacent } = makeScene();
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, adjacent);
    expect(scene.battleState).toBe('SHOWING_FORECAST');
    expect(hero.weapon).toBe(iron);
    const config = renders.at(-1);
    expect(config.validWeapons).toEqual([iron, steel]);
    expect(config.equippedWeapon).toBe(iron);
    expect(config.targetIndex).toBe(0);
    expect(config.targetCount).toBe(2);
  });

  it('otherwise the first weapon in inventory order that can hit it (no reorder)', async () => {
    const { scene, hero, iron, bow, ranged } = makeScene();
    const order = [...hero.inventory];
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, ranged);
    expect(hero.weapon).toBe(bow);
    expect(renders.at(-1).validWeapons).toEqual([bow]);
    expect(renders.at(-1).equippedWeapon).toBe(iron);
    expect(hero.inventory).toEqual(order);
  });

  it('switching weapons updates the forecast numbers and never reorders the bag', async () => {
    const { scene, hero, iron, steel, adjacent } = makeScene();
    const order = [...hero.inventory];
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, adjacent);
    const before = renders.at(-1).forecast.attacker;
    expect(scene._cycleForecastWeapon(1)).toBe(true);
    await Promise.resolve();
    expect(hero.weapon).toBe(steel);
    const after = renders.at(-1).forecast.attacker;
    expect(after.damage).not.toBe(before.damage);
    expect(renders.at(-1).equippedWeapon).toBe(iron);
    scene._cycleForecastWeapon(1);
    expect(hero.weapon).toBe(iron);
    scene._cycleForecastWeapon(-1);
    expect(hero.weapon).toBe(steel);
    expect(hero.inventory).toEqual(order);
  });

  it('switching targets starts the new target on its default weapon', async () => {
    const { scene, hero, steel, bow, adjacent, ranged } = makeScene();
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, adjacent);
    scene._cycleForecastWeapon(1);
    expect(hero.weapon).toBe(steel);
    expect(scene._cycleForecastTarget(1)).toBe(true);
    expect(scene.forecastTarget).toBe(ranged);
    expect(hero.weapon).toBe(bow);
    scene._cycleForecastTarget(1);
    expect(scene.forecastTarget).toBe(adjacent);
    // Back on the first target: the equipped weapon again, not the preview.
    expect(hero.weapon.uid).toBe('iron');
  });

  it('Cancel returns to target selection on the same target with the equipped weapon', async () => {
    const { scene, hero, iron, ranged } = makeScene();
    const order = [...hero.inventory];
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, ranged);
    scene.handleCancel();
    expect(scene.battleState).toBe('SELECTING_TARGET');
    expect(scene.forecastTarget).toBeNull();
    expect(scene._attackFlowController.focusedTarget).toBe(ranged);
    expect(scene._gridCursor.snapTo).toHaveBeenLastCalledWith(5, 7);
    expect(hero.weapon).toBe(iron);
    expect(hero.inventory).toEqual(order);
    // Back from target selection returns to the action menu.
    scene.handleCancel();
    expect(scene.showActionMenu).toHaveBeenCalledWith(hero);
    expect(scene.attackTargets).toEqual([]);
    expect(scene._weaponPreviewSession).toBeNull();
    // Re-entering Attack remembers the last target for this unit.
    scene._attackFlow().begin(hero);
    expect(scene._attackFlowController.focusedTarget).toBe(ranged);
  });

  it('confirming with another weapon equips it and moves it to the top', async () => {
    const { scene, hero, iron, steel, bow, adjacent } = makeScene();
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, adjacent);
    scene._cycleForecastWeapon(1);
    scene.confirmForecastCombat();
    expect(scene.executeCombat).toHaveBeenCalledWith(hero, adjacent);
    expect(hero.weapon).toBe(steel);
    expect(hero.inventory).toEqual([steel, iron, bow]);
    expect(scene._weaponPreviewSession).toBeNull();
  });

  it('Enter confirms the canvas forecast; Up/Down switch its target', async () => {
    const { scene, hero, adjacent, ranged } = makeScene();
    const flow = scene._attackFlow();
    flow.begin(hero);
    await flow.openForecast(hero, adjacent);
    flow.handleKey({ key: 'ArrowDown', preventDefault: vi.fn() });
    expect(scene.forecastTarget).toBe(ranged);
    flow.handleKey({ key: 'Enter', preventDefault: vi.fn() });
    expect(scene.executeCombat).toHaveBeenCalledWith(hero, ranged);
  });

  it('a weapon art stays bound to its weapon across the confirm reorder', async () => {
    const { scene, hero, steel } = makeScene();
    const art = { id: 'test_art' };
    scene._selectedWeaponArt = { unitName: hero.name, artId: art.id, weaponIndex: 1 };
    scene._resolveSelectedWeaponArtEntry = () => ({ art, weapon: steel });
    scene.battleState = 'SHOWING_FORECAST';
    scene.forecastTarget = scene.enemyUnits[0];
    scene._weaponPreviewSession = { unit: hero, weapon: hero.weapon, order: [...hero.inventory] };
    hero.weapon = steel;
    scene.confirmForecastCombat();
    expect(hero.inventory[0]).toBe(steel);
    expect(scene._selectedWeaponArt).toEqual({
      unitName: hero.name,
      artId: art.id,
      weaponIndex: 0,
      weaponUid: 'steel',
    });
  });

  it('never draws battle RNG while planning, switching or cancelling', async () => {
    const { scene, hero, adjacent } = makeScene();
    const flow = scene._attackFlow();
    flow.begin(hero);
    await flow.openForecast(hero, adjacent);
    scene._cycleForecastWeapon(1);
    scene._cycleForecastTarget(1);
    scene.handleCancel();
    flow.cycleTarget(1);
    scene.handleCancel();
    expect(random).not.toHaveBeenCalled();
  });
});

describe('direct attack after moving', () => {
  it('tapping an enemy in reach from the post-move menu opens its forecast', async () => {
    const { scene, hero, ranged } = makeScene();
    hero.hasMoved = true;
    hero._movementCommitted = true;
    scene.actionMenu = [{ text: 'Attack', _action: vi.fn() }];
    scene.getUnitAt = BattleScene.prototype.getUnitAt;
    const input = new InputController(scene);
    scene._inputController = input;
    input.handleActionMenuClick({ col: ranged.col, row: ranged.row });
    await Promise.resolve();
    expect(scene.battleState).toBe('SHOWING_FORECAST');
    expect(scene.forecastTarget).toBe(ranged);
    // Cancel lands in target selection for the same enemy.
    scene.handleCancel();
    expect(scene.battleState).toBe('SELECTING_TARGET');
    expect(scene._attackFlowController.focusedTarget).toBe(ranged);
  });

  it('ignores the tap in a submenu, for unreachable enemies, or when Attack is blocked', () => {
    const { scene, hero, outOfReach, adjacent } = makeScene();
    hero.hasMoved = true;
    scene.getUnitAt = BattleScene.prototype.getUnitAt;
    const input = new InputController(scene);
    scene._inputController = input;
    scene.actionMenu = [{ text: 'Attack', _action: vi.fn() }];
    expect(input.tryDirectAttack({ col: outOfReach.col, row: outOfReach.row })).toBe(false);
    scene.inEquipMenu = true;
    expect(input.tryDirectAttack({ col: adjacent.col, row: adjacent.row })).toBe(false);
    scene.inEquipMenu = false;
    scene.actionMenu = [{ text: 'Attack', _action: vi.fn(), _menuDisabled: true }];
    expect(input.tryDirectAttack({ col: adjacent.col, row: adjacent.row })).toBe(false);
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
  });
});
