// Zombie remains in a battle: the Smash command on the unit menu (rows with a stable
// id, the phone rail and the desktop canvas alike), its tile-target state, the Rout it
// can win, the fall that leaves remains, the fog, and saves (suspend checkpoint and
// Vision rewind). Ways this can break:
//   - Smash is missing, or offered for remains the fog hides
//   - smashing leaves a record on the tile (two zombies that fell on one tile), takes
//     a record from another tile, rolls the RNG or lets Canto move on
//   - the last remains of a Rout do not win it (they blocked the win before Smash)
//   - the objective line keeps counting smashed remains
//   - a zombie that falls unseen is drawn, or a seen one is not
//   - a resume or a rewind loses the remains (or their marker)
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { InputController } from '../src/ui/InputController.js';
import { openMenuCommand } from '../src/ui/battleMenuModel.js';
import { ZombieRemainsController } from '../src/ui/ZombieRemainsController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { createRemains } from '../src/engine/ZombieRemains.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { resetBattleIdentities, registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

function displayObject(seed = {}) {
  const obj = {
    ...seed,
    destroy: vi.fn(),
  };
  for (const method of [
    'setOrigin',
    'setDepth',
    'setStrokeStyle',
    'setColor',
    'on',
    'fillStyle',
    'fillCircle',
    'fillRect',
    'lineStyle',
    'lineBetween',
    'strokeCircle',
  ])
    obj[method] = () => obj;
  return obj;
}

const zombieUnit = (col, row) => ({
  name: 'Zombie',
  className: 'Zombie',
  faction: 'enemy',
  level: 5,
  tier: 'base',
  col,
  row,
  currentHP: 0,
  moveType: 'Infantry',
  mov: 4,
  skills: [],
  stats: { HP: 24, STR: 7, MAG: 0, SKL: 2, SPD: 2, DEF: 3, RES: 0, LCK: 0, MOV: 4 },
  weapon: { name: 'Claws', type: 'Axe', might: 4 },
  inventory: [{ name: 'Claws', type: 'Axe', might: 4 }],
  proficiencies: [{ type: 'Axe', rank: 'Prof' }],
});
const remainsAt = (col, row, over = {}) => ({
  ...createRemains(zombieUnit(col, row), { col, row }, { seen: true }),
  ...over,
});

// Edric at (1,1) with an Iron Sword; remains next to him at (2,1).
function battle({ rail = true, enemies = [], remains = [remainsAt(2, 1)], visible = null } = {}) {
  const unit = {
    name: 'Edric',
    faction: 'player',
    isCommander: true,
    isLord: true,
    col: 1,
    row: 1,
    currentHP: 20,
    stats: { HP: 20, MOV: 5 },
    skills: ['canto'],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    consumables: [],
    graphic: { clearTint: vi.fn() },
  };
  unit.weapon = weapon('Iron Sword');
  unit.inventory = [unit.weapon];
  const scene = new BattleScene();
  const objective = { text: '', setText: vi.fn((t) => (objective.text = t)), setColor: vi.fn() };
  const random = vi.fn(() => {
    throw new Error('battle RNG drawn');
  });
  Object.assign(scene, {
    _battleSession: 1,
    selectedUnit: unit,
    playerUnits: [unit],
    enemyUnits: enemies,
    npcUnits: [],
    escapedUnits: [],
    _zombieTombstones: remains,
    _battleRng: { next: random, nextFloat: random, getState: () => 'rng-state' },
    runManager: null,
    battleState: 'UNIT_ACTION_MENU',
    turnManager: { currentPhase: 'player', turnNumber: 2 },
    battleConfig: { objective: 'rout', cols: 8, rows: 8 },
    gameData: { classes: [], lords: [], skills: [], affixes: { affixes: [] } },
    registry: { get: () => null },
    isMobileInput: rail,
    cameras: { main: { width: 640, height: 480 } },
    input: { on: vi.fn(), off: vi.fn() },
    objectiveText: objective,
    grid: {
      cols: 8,
      rows: 8,
      fogEnabled: visible !== null,
      isVisible: (c, r) => (visible ? visible(c, r) : true),
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
      showMovementRange: vi.fn(),
      showAttackRange: vi.fn(),
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
      clearPath: vi.fn(),
    },
    add: {
      rectangle: () => displayObject(),
      graphics: () => displayObject({ kind: 'graphics' }),
      text: (x, y, text) => displayObject({ kind: 'text', x, y, text }),
    },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    movementRange: new Map([['1,1', { cost: 0 }]]),
    getUnitAt: (col, row) => [unit, ...enemies].find((u) => u.col === col && u.row === row) || null,
    findAttackTargets: () => [],
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
    _isPrologueGateActive: () => false,
    _makeMenuTextButton: vi.fn((_x, _y, text, _style, color, action, options = {}) =>
      displayObject({ text, _action: action, _menuDisabled: !!options.disabled }),
    ),
    showMinorHintAt: vi.fn(),
    commitVisionSnapshotIfPending: vi.fn(),
    finishUnitAction: vi.fn(),
    onVictory: vi.fn(() => (scene.battleState = 'BATTLE_END')),
    refreshEndTurnControl: vi.fn(),
  });
  if (rail)
    scene._mobileBattleHud = { available: () => true, showMenu: vi.fn(), hideMenu: vi.fn() };
  scene._inputController = new InputController(scene);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Math.random drawn');
  });
  return { scene, unit, random };
}

const ids = (scene) => scene._actionMenuPublished.items.map((item) => item.id);

describe('the Smash command', () => {
  it('is a row with a stable id on the rail and on the desktop canvas', () => {
    for (const rail of [true, false]) {
      const { scene, unit } = battle({ rail });
      scene.showActionMenu(unit);
      expect(ids(scene)).toContain('smash');
      expect(openMenuCommand(scene, 'smash').label).toBe('Smash');
      if (!rail)
        expect(scene.actionMenu.some((o) => o._rowId === 'smash' && o.text === 'Smash')).toBe(true);
    }
  });

  it('is not offered for remains out of reach, or in the fog', () => {
    const far = battle({ remains: [remainsAt(5, 5)] });
    far.scene.showActionMenu(far.unit);
    expect(ids(far.scene)).not.toContain('smash');
    const fogged = battle({ visible: (c, r) => !(c === 2 && r === 1) });
    fogged.scene.showActionMenu(fogged.unit);
    expect(ids(fogged.scene)).not.toContain('smash');
  });

  it('chooses a tile like Break: the remains are highlighted, Back returns to the menu', () => {
    const { scene, unit } = battle();
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    expect(scene.battleState).toBe('SELECTING_REMAINS_TARGET');
    expect(scene.grid.showAttackRange).toHaveBeenCalledWith(
      [{ col: 2, row: 1 }],
      expect.any(Number),
      0.45,
    );
    expect(scene.isCancelableBattleState()).toBe(true);
    scene.requestCancel();
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
    expect(scene._zombieTombstones).toHaveLength(1);
    expect(openMenuCommand(scene, 'smash')).not.toBeNull();
  });

  it('smashing: the record goes, nothing is rolled, the action ends without Canto', () => {
    const foe = { name: 'Fighter', faction: 'enemy', col: 6, row: 6, currentHP: 20 };
    const { scene, unit, random } = battle({ enemies: [foe] });
    scene.updateObjectiveText();
    expect(scene.objectiveText.text).toBe('Rout: 1 enemy + 1 reviving');
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    scene.handleRemainsTargetClick({ col: 3, row: 1 }); // not a target: nothing happens
    expect(scene._zombieTombstones).toHaveLength(1);
    scene.handleRemainsTargetClick({ col: 2, row: 1 });
    expect(scene._zombieTombstones).toEqual([]);
    expect(scene.objectiveText.text).toBe('Rout: 1 enemy remaining');
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit, {
      skipCanto: true,
      session: scene._battleSession,
    });
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalled();
    expect(scene.onVictory).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(Math.random).not.toHaveBeenCalled();
    expect(unit.xp).toBeUndefined();
  });

  it('the last remains of a Rout: smashing them wins the battle', () => {
    const { scene, unit } = battle({ enemies: [] });
    expect(scene.checkBattleEnd()).toBe(false); // remains still block the win
    expect(scene.onVictory).not.toHaveBeenCalled();
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    scene.handleRemainsTargetClick({ col: 2, row: 1 });
    expect(scene.onVictory).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
  });

  it('two zombies fell on one tile: stamping on it clears both and wins the Rout', () => {
    // The pile under the smasher is hidden by its sprite and no one else can reach an
    // occupied tile, so a record left there would block the win and rise unseen.
    const { scene, unit } = battle({
      enemies: [],
      remains: [remainsAt(1, 1), remainsAt(1, 1, { turnsRemaining: 2 }), remainsAt(5, 5)],
    });
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    scene.handleRemainsTargetClick({ col: 1, row: 1 });
    expect(scene._zombieTombstones.map((r) => [r.col, r.row])).toEqual([[5, 5]]);
    expect(scene.onVictory).not.toHaveBeenCalled(); // the pile at (5,5) still stands
    scene._zombieTombstones = [remainsAt(1, 1), remainsAt(1, 1)];
    scene.battleState = 'UNIT_ACTION_MENU';
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    scene.handleRemainsTargetClick({ col: 1, row: 1 });
    expect(scene._zombieTombstones).toEqual([]);
    expect(scene.onVictory).toHaveBeenCalledTimes(1);
  });

  it('a tap on the board reaches the smash through the input controller', () => {
    const { scene, unit } = battle();
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    scene.isStoryInputLocked = () => false;
    scene.unitDetailOverlay = null;
    scene._inputController._screenToWorld = (x, y) => ({ x, y });
    scene.grid.pixelToGrid = (x, y) => ({ col: Math.floor(x / 32), row: Math.floor(y / 32) });
    scene.isMobileInput = false;
    scene.onClick(null, { x: 2 * 32 + 10, y: 32 + 10 });
    expect(scene._zombieTombstones).toEqual([]);
  });
});

describe('a zombie falls', () => {
  function fallScene(visible) {
    const { scene } = battle({ remains: [], visible });
    Object.assign(scene, {
      removeUnitGraphic: vi.fn(),
      _applyKillRewards: vi.fn(),
      battleParams: {},
      updateObjectiveText: vi.fn(),
      _inputController: null,
    });
    return scene;
  }

  it('leaves remains on its tile, seen when the tile is in sight', async () => {
    const scene = fallScene((c) => c < 4);
    const near = zombieUnit(3, 2);
    const far = zombieUnit(6, 2);
    scene.enemyUnits.push(near, far);
    await scene.removeUnit(near, { killer: scene.playerUnits[0] });
    await scene.removeUnit(far, null); // poison in the fog: no killer
    expect(scene._zombieTombstones.map((r) => [r.col, r.row, r.turnsRemaining, r.seen])).toEqual([
      [3, 2, 3, true],
      [6, 2, 3, false],
    ]);
    expect(scene.enemyUnits).toEqual([]);
  });

  it('Light leaves nothing', async () => {
    const scene = fallScene(null);
    const unit = zombieUnit(3, 2);
    scene.enemyUnits.push(unit);
    await scene.removeUnit(unit, { killer: { name: 'Sera', weapon: { type: 'Light' } } });
    expect(scene._zombieTombstones).toEqual([]);
  });
});

describe('rising where the player cannot see', () => {
  it('no "has risen!" banner in the fog; the risen unit is hidden and the objective updates', async () => {
    const { scene } = battle({
      remains: [remainsAt(6, 6, { turnsRemaining: 1 }), remainsAt(2, 1, { turnsRemaining: 1 })],
      visible: (c) => c < 4,
    });
    Object.assign(scene, {
      addUnitGraphic: vi.fn(),
      showBriefBanner: vi.fn(async () => {}),
      updateEnemyVisibility: vi.fn(),
      checkBattleEnd: vi.fn(),
      getUnitAt: () => null,
    });
    scene.grid.getTerrainAt = () => ({ moveCost: { Infantry: '1' } });
    await scene.processZombieRevival();
    expect(scene.enemyUnits.map((u) => [u.col, u.row])).toEqual([
      [6, 6],
      [2, 1],
    ]);
    expect(scene.showBriefBanner).toHaveBeenCalledTimes(1);
    expect(scene.showBriefBanner).toHaveBeenCalledWith('Zombie has risen!', expect.anything());
    expect(scene.updateEnemyVisibility).toHaveBeenCalled();
    expect(scene.objectiveText.text).toBe('Rout: 2 enemies remaining');
  });
});

describe('saves keep the remains', () => {
  function checkpointScene(remains, visible) {
    const scene = {
      _battleSession: 1,
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      nonDeployedUnits: [],
      battleState: 'PLAYER_IDLE',
      turnManager: { currentPhase: 'player', turnNumber: 3 },
      _zombieTombstones: remains,
      grid: {
        mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
        temporaryTerrains: [],
        fogEnabled: true,
        isVisible: visible,
        gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
      },
      runManager: { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 },
      add: {
        graphics: () => displayObject({ kind: 'graphics' }),
        text: (x, y, text) => displayObject({ kind: 'text', x, y, text }),
      },
      tweens: { add: vi.fn(), killTweensOf: vi.fn() },
      addUnitGraphic() {},
      dimUnit() {},
    };
    resetBattleIdentities(scene);
    const edric = createUnit(
      data.classes.find((c) => c.name === 'Fighter'),
      5,
      data.weapons,
      { name: 'Edric' },
    );
    Object.assign(edric, { col: 0, row: 0 });
    registerBattleEntity(scene, edric);
    scene.playerUnits.push(edric);
    return scene;
  }

  it('a suspend round trip restores every record and redraws the seen ones only', () => {
    const inSight = (c) => c < 4;
    const scene = checkpointScene(
      [remainsAt(2, 1, { turnsRemaining: 2 }), remainsAt(6, 6, { seen: false })],
      inSight,
    );
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(validateBattleState(state)).toBe(true);
    const restored = checkpointScene([], inSight);
    restored.playerUnits = [];
    new BattleSuspendController(restored).applyUnits(state);
    expect(restored._zombieTombstones).toEqual(scene._zombieTombstones);
    const ctrl = new ZombieRemainsController(restored).create();
    expect(ctrl.markers.shown.map((m) => [m.col, m.row, m.turnsRemaining])).toEqual([[2, 1, 2]]);
  });

  it('the save format: `seen` is an optional boolean; legacy records without it load', () => {
    const scene = checkpointScene([remainsAt(2, 1)], () => true);
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(validateBattleState(state)).toBe(true);
    const legacy = structuredClone(state);
    delete legacy.zombieTombstones[0].seen;
    expect(validateBattleState(legacy)).toBe(true);
    const bad = structuredClone(state);
    bad.zombieTombstones[0].seen = 'yes';
    expect(validateBattleState(bad)).toBe(false);
    // A legacy record is drawn (it counts as seen) even with its tile in fog.
    const restored = checkpointScene([], () => false);
    new BattleSuspendController(restored).applyUnits(legacy);
    const ctrl = new ZombieRemainsController(restored).create();
    expect(ctrl.markers.shown.map((m) => [m.col, m.row])).toEqual([[2, 1]]);
  });

  it('a Vision rewind after a smash brings the remains and their marker back', () => {
    const { scene, unit } = battle({ rail: true });
    scene.commitVisionSnapshotIfPending = BattleScene.prototype.commitVisionSnapshotIfPending;
    Object.assign(scene, {
      removeUnitGraphic: vi.fn(),
      addUnitGraphic: vi.fn(),
      hideForecast: vi.fn(),
      cleanupTradeUI: vi.fn(),
      updateEnemyVisibility: vi.fn(),
      reseedBattleRng: vi.fn(),
      updateTopLeftHudLayout: vi.fn(),
      isStoryInputLocked: () => false,
      getBestLordThroneDistance: () => 5,
      getTurnPressureSummary: () => '',
      aiController: { setAggressiveMode: vi.fn() },
      antiTurtleState: {},
      ballistas: [],
      showBriefBanner: vi.fn(async () => {}),
    });
    resetBattleIdentities(scene);
    registerBattleEntity(scene, unit);
    const vision = new VisionRewindController(scene, null);
    scene._visionController = vision;
    vision.captureSnapshot();
    const markers = new ZombieRemainsController(scene);
    scene._remainsCtrl = markers;
    markers.create();
    expect(markers.markers.shown).toHaveLength(1);
    scene.showActionMenu(unit);
    openMenuCommand(scene, 'smash').onActivate();
    scene.handleRemainsTargetClick({ col: 2, row: 1 });
    markers.sync();
    expect(scene._zombieTombstones).toEqual([]);
    expect(markers.markers.shown).toEqual([]);
    expect(vision._applySnapshot()).toBe(true);
    markers.sync();
    expect(scene._zombieTombstones.map((r) => [r.col, r.row, r.turnsRemaining])).toEqual([
      [2, 1, 3],
    ]);
    expect(markers.markers.shown.map((m) => [m.col, m.row])).toEqual([[2, 1]]);
  });
});
