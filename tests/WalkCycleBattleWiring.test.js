// BattleScene's hooks into the walk cycle (src/ui/WalkCycleController.js): the real moveUnit,
// handleCantoClick and animateEnemyMove report each drawn tile step and the move's end, never
// change what the move does, and leave the unit as it was however it ends.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {}, BlendModes: { ADD: 1, NORMAL: 0 } },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import WalkCycleController from '../src/ui/WalkCycleController.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const terrainIndex = (name) => data.terrain.findIndex((t) => t.name === name);

const spyCtrl = () => ({ step: vi.fn(), end: vi.fn(), destroy: vi.fn() });

function makeImage(scene) {
  const o = { visible: true, active: true, scene: {}, tint: null };
  for (const name of [
    'setVisible',
    'setDepth',
    'setOrigin',
    'setFrame',
    'setBlendMode',
    'setTint',
    'setAlpha',
    'setPosition',
  ])
    o[name] = vi.fn(() => o);
  o.destroy = vi.fn();
  scene.drawn.push(Math.random());
  return o;
}

function graphicFor(x = 16, y = 16) {
  return {
    x,
    y,
    scene: {},
    active: true,
    visible: true,
    texture: { key: 'traced-myrmidon-myrmidon_a' },
    frame: { name: 'idle2' },
    setFrame: vi.fn(function setFrame(name) {
      this.frame = { name };
    }),
    clearTint: vi.fn(),
    setTint: vi.fn(),
    setAlpha: vi.fn(),
    setVisible: vi.fn(function setVisible(v) {
      this.visible = v;
    }),
    setPosition: vi.fn(function setPosition(px, py) {
      this.x = px;
      this.y = py;
    }),
  };
}

// ---- player moveUnit ----------------------------------------------------------

function makeMoveScene({ ice = false } = {}) {
  const scene = new BattleScene();
  const unit = {
    name: 'Edric',
    col: 1,
    row: 1,
    faction: 'player',
    moveType: 'Infantry',
    mov: 5,
    currentHP: 20,
    hasMoved: false,
    hasActed: false,
    weapon: { range: '1' },
    inventory: [],
    consumables: [],
    skills: [],
    stats: { HP: 20, MOV: 5 },
    graphic: graphicFor(),
    label: null,
    hpBar: {
      bg: { setPosition: vi.fn() },
      fill: { setPosition: vi.fn(), setSize: vi.fn(), setFillStyle: vi.fn() },
    },
    affixPips: [],
  };
  const plain = terrainIndex('Plain');
  const iceIx = terrainIndex('Ice');
  const row = ice
    ? [plain, plain, plain, iceIx, plain, plain, plain]
    : [plain, plain, plain, plain, plain, plain, plain];
  const path = ice
    ? [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 4, row: 1 },
        { col: 5, row: 1 },
      ]
    : [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ];
  scene.scene = { isActive: () => true };
  scene.grid = {
    cols: 7,
    rows: 3,
    mapLayout: [row, row, row],
    terrainData: data.terrain,
    fogEnabled: false,
    findPath: vi.fn(() => path),
    reconstructIcePath: vi.fn(() => null),
    getMoveCost: vi.fn(() => 1),
    snapshotFogState: vi.fn(() => new Set(['1,1'])),
    restoreFogState: vi.fn(),
    updateFogOfWar: vi.fn(),
    gridToPixel: vi.fn((col, r) => ({ x: col * 32 + 16, y: r * 32 + 16 })),
    getTerrainAt: (c) => data.terrain[row[c]],
    biome: null,
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearPath: vi.fn(),
  };
  scene.time = { now: 0, delayedCall: vi.fn(() => ({})) };
  scene.drawn = [];
  scene.events = { on: vi.fn(), off: vi.fn(), once: vi.fn() };
  scene.textures = { exists: (k) => k === 'fx_atlas' };
  scene.add = { image: vi.fn(() => makeImage(scene)) };
  scene.tweens = {
    add: vi.fn((cfg) => {
      cfg.onComplete?.();
      return {};
    }),
  };
  scene.playerUnits = [unit];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.selectedUnit = unit;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.cantoRange = null;
  scene.battleState = 'UNIT_SELECTED';
  scene.movementRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
  scene.unitPositions = new Map();
  scene.turnManager = { unitActed: vi.fn() };
  scene.updateEnemyVisibility = vi.fn();
  scene.updateUnitPosition = vi.fn();
  scene.afterMove = vi.fn(async () => {
    scene.battleState = 'UNIT_ACTION_MENU';
  });
  scene.selectUnit = vi.fn(function selectUnit(u) {
    this.selectedUnit = u;
    this.battleState = 'UNIT_SELECTED';
    this.movementRange = new Map();
    this.unitPositions = new Map();
  });
  scene.deselectUnit = vi.fn(function deselectUnit() {
    this.selectedUnit = null;
    this.battleState = 'PLAYER_IDLE';
  });
  scene.dimUnit = vi.fn();
  scene._mobileBattleHud = { showMenu: vi.fn(), hideMenu: vi.fn() };
  return { scene, unit };
}

describe('moveUnit and the walk cycle', () => {
  let warn;
  let error;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it('reports each walked tile as a Normal step, then the end with the tile it landed on', () => {
    const { scene, unit } = makeMoveScene();
    const walk = (scene._walkCycleCtrl = spyCtrl());
    scene.updateUnitPosition = vi.fn(() => {
      // the walk is over before the scene writes the final position
      expect(walk.end).toHaveBeenCalledTimes(1);
    });
    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);
    expect(walk.step.mock.calls).toEqual([[unit, { ms: 80, slide: false }]]);
    expect(walk.end.mock.calls).toEqual([[unit, { col: 2, row: 1 }]]);
    expect(scene.updateUnitPosition).toHaveBeenCalled();
    expect([unit.col, unit.row]).toEqual([2, 1]);
  });

  it('reports a slid tile as a slide (60 ms) and the walked ones as steps', () => {
    const { scene, unit } = makeMoveScene({ ice: true });
    const walk = (scene._walkCycleCtrl = spyCtrl());
    BattleScene.prototype.moveUnit.call(scene, unit, 5, 1);
    const calls = walk.step.mock.calls.map(([, o]) => o);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some((o) => o.slide === true && o.ms === 60)).toBe(true);
    expect(calls.some((o) => o.slide === false && o.ms === 80)).toBe(true);
  });

  it('a move that fails ends the walk with no tile, so no puff is drawn', () => {
    const { scene, unit } = makeMoveScene();
    const walk = (scene._walkCycleCtrl = spyCtrl());
    scene.tweens.add = vi.fn(() => {
      throw new Error('tween boom');
    });
    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);
    expect(walk.end).toHaveBeenCalledTimes(1);
    expect(walk.end.mock.calls[0]).toEqual([unit]);
    expect(unit.col).toBe(1);
  });

  it('the real controller lands the unit in a puff and gives its frame and height back', () => {
    const { scene, unit } = makeMoveScene();
    const before = { y: unit.graphic.y, frame: unit.graphic.frame.name };
    const rng = vi.spyOn(Math, 'random');
    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);
    const walk = scene._walkCycleCtrl;
    expect(walk).toBeInstanceOf(WalkCycleController);
    expect(walk.walking).toBe(0);
    expect(walk.liveMotes).toBeGreaterThan(0);
    expect(unit.graphic.y).toBe(before.y);
    expect(unit.graphic.frame.name).toBe(before.frame);
    expect(unit.graphic._walkCycle).toBe(false);
    // its images were built on the presentation stream, the battle's was never drawn
    expect(scene.drawn.length).toBeGreaterThan(0);
    expect(rng).not.toHaveBeenCalled();
    rng.mockRestore();
  });

  it('a controller that fails still lets the move finish', () => {
    const { scene, unit } = makeMoveScene();
    scene.add.image = vi.fn(() => {
      throw new Error('no GL');
    });
    expect(() => BattleScene.prototype.moveUnit.call(scene, unit, 2, 1)).not.toThrow();
    expect([unit.col, unit.row]).toEqual([2, 1]);
    expect(scene.afterMove).toHaveBeenCalledWith(unit);
    expect(scene.grid.restoreFogState).not.toHaveBeenCalled(); // no recovery was triggered
  });

  it('draws no puff and cycles nothing under reduced motion', () => {
    const { scene, unit } = makeMoveScene();
    scene._reduceMotion = () => true;
    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);
    expect(scene.add.image).not.toHaveBeenCalled();
    expect(unit.graphic.setFrame).not.toHaveBeenCalled();
    expect(unit.graphic._walkCycle).toBeUndefined();
  });

  it('the scene frees the controller with the rest of its presentation', () => {
    const { scene, unit } = makeMoveScene();
    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);
    const walk = scene._walkCycleCtrl;
    expect(walk.liveMotes).toBeGreaterThan(0);
    const destroy = vi.spyOn(walk, 'destroy');
    BattleScene.prototype._walkCycle.call(scene); // the lazy accessor reuses it
    expect(scene._walkCycleCtrl).toBe(walk);
    walk.destroy();
    expect(destroy).toHaveBeenCalled();
    expect(walk.liveMotes).toBe(0);
  });
});

// ---- Canto ---------------------------------------------------------------------

describe('a Canto move and the walk cycle', () => {
  it('reports its steps and ends the walk on its destination before the position is written', () => {
    const plain = terrainIndex('Plain');
    const layout = Array.from({ length: 3 }, () => Array(12).fill(plain));
    const scene = new BattleScene();
    const grid = new Grid(
      {
        cameras: { main: { width: 640, height: 480 } },
        add: new Proxy(
          {},
          { get: () => () => new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => t) }) },
        ),
        textures: { exists: () => false },
      },
      12,
      3,
      data.terrain,
      layout,
      false,
    );
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const edric = {
      name: 'Edric',
      battleEntityId: 'edric-1',
      faction: 'player',
      col: 0,
      row: 1,
      moveType: 'Infantry',
      currentHP: 20,
      hasActed: true,
      stats: { MOV: 5, HP: 20 },
      mov: 5,
      _movementSpent: 1,
      weapon: sword,
      inventory: [sword],
      skills: ['canto'],
      graphic: graphicFor(),
    };
    const walk = (scene._walkCycleCtrl = spyCtrl());
    Object.assign(scene, {
      _battleSession: 1,
      grid,
      gameData: data,
      playerUnits: [edric],
      enemyUnits: [],
      npcUnits: [],
      battleParams: {},
      battleState: 'UNIT_MOVING',
      selectedUnit: edric,
      runManager: { battleInProgress: true },
      turnManager: { currentPhase: 'player', unitActed: vi.fn(), endPlayerPhase: vi.fn() },
      registry: { get: () => null },
      scene: { isActive: () => true },
      time: { delayedCall: vi.fn(() => ({})) },
      tweens: {
        add: vi.fn((cfg) => {
          cfg.onComplete?.();
          return {};
        }),
      },
      _villageController: { handleUnitActionEnd: vi.fn(), getWaitNote: () => null },
    });
    scene.updateUnitPosition = vi.fn(() => expect(walk.end).toHaveBeenCalledTimes(1));
    for (const name of [
      '_drawActionMenuRows',
      'refreshEndTurnControl',
      'dimUnit',
      'hideForecast',
      'cleanupTradeUI',
      '_clearSelectedWeaponArt',
      '_clearCombatRollSession',
      'commitVisionSnapshotIfPending',
      'updateObjectiveText',
      'refreshVisibleDangerZone',
      '_hideMenuTooltip',
      '_hideWeaponDetailTooltip',
    ])
      scene[name] = vi.fn();
    scene.isStoryInputLocked = () => false;
    scene._isPrologueGateActive = () => false;
    scene.checkBattleEnd = () => false;
    scene._captureSuspendCheckpoint = vi.fn();
    scene._mobileBattleHud = { showMenu: vi.fn(), hideMenu: vi.fn() };
    scene.startCantoMove(edric, 4);
    scene.handleCantoClick({ col: 3, row: 1 });
    expect(walk.step.mock.calls.length).toBe(3);
    for (const [u, o] of walk.step.mock.calls) {
      expect(u).toBe(edric);
      expect(o).toEqual({ ms: 80, slide: false });
    }
    expect(walk.end.mock.calls).toEqual([[edric, { col: 3, row: 1 }]]);
    expect([edric.col, edric.row]).toEqual([3, 1]);
  });
});

// ---- the enemy's walk -----------------------------------------------------------

const PX = 32;
function makeEnemyScene({ fog = false, seen = new Set(), speed = 'normal' } = {}) {
  const scene = new BattleScene();
  scene.registry = { get: (key) => (key === 'settings' ? { getBattleSpeed: () => speed } : null) };
  scene.turnManager = { currentPhase: 'enemy' };
  scene.grid = {
    cols: 8,
    rows: 1,
    mapLayout: [Array(8).fill(0)],
    terrainData: data.terrain,
    fogEnabled: fog,
    isVisible: (col, row) => !fog || seen.has(`${col},${row}`),
    gridToPixel: (col, row) => ({ x: col * PX, y: row * PX }),
    getTerrainAt: () => data.terrain[0],
    biome: null,
  };
  scene.runManager = { battleInProgress: {} };
  scene.buildOccupiedSet = () => new Set();
  scene._getCostModifier = () => null;
  scene._battleSession = 1;
  scene.steps = [];
  scene._awaitSceneTween = vi.fn(async (config) => {
    scene.steps.push({ duration: config.duration });
    for (const t of config.targets) t.setPosition(config.x, config.y);
  });
  scene._awaitSceneDelay = vi.fn(async () => {});
  scene.updateUnitPosition = vi.fn((u) => u.graphic.setPosition(u.col * PX, u.row * PX));
  scene.updateEnemyVisibility = vi.fn();
  const part = () => ({
    x: 0,
    y: 0,
    visible: true,
    setPosition(x, y) {
      this.x = x;
      this.y = y;
    },
    setVisible(v) {
      this.visible = v;
    },
  });
  const enemy = {
    name: 'Raider',
    faction: 'enemy',
    battleEntityId: 'e1',
    col: 0,
    row: 0,
    moveType: 'Infantry',
    graphic: part(),
    label: part(),
  };
  return { scene, enemy };
}

const rowPath = (n) => Array.from({ length: n }, (_, i) => ({ col: i, row: 0 }));

describe('the enemy walk and the walk cycle', () => {
  it('steps each drawn tile at the enemy-phase speed and ends on the destination', async () => {
    for (const [speed, ms] of [
      ['normal', 80],
      ['fast', 40],
    ]) {
      const { scene, enemy } = makeEnemyScene({ speed });
      const walk = (scene._walkCycleCtrl = spyCtrl());
      await scene.animateEnemyMove(enemy, rowPath(4));
      expect(walk.step.mock.calls.map(([, o]) => o)).toEqual(Array(3).fill({ ms, slide: false }));
      expect(scene.steps.map((s) => s.duration)).toEqual(Array(3).fill(ms));
      expect(walk.end.mock.calls).toEqual([[enemy, { col: 3, row: 0 }]]);
      // the walk was over before the scene wrote the unit's final position
      expect(walk.end.mock.invocationCallOrder[0]).toBeLessThan(
        scene.updateUnitPosition.mock.invocationCallOrder[0],
      );
    }
  });

  it('a walk through the fog steps only the tiles it draws', async () => {
    const { scene, enemy } = makeEnemyScene({ fog: true, seen: new Set(['2,0', '3,0']) });
    const walk = (scene._walkCycleCtrl = spyCtrl());
    await scene.animateEnemyMove(enemy, rowPath(6));
    // only the step between the two seen tiles is a tween
    expect(walk.step).toHaveBeenCalledTimes(1);
    expect(scene.steps).toHaveLength(1);
    expect(walk.end).toHaveBeenCalledTimes(1);
  });

  it('a walk cut off by a superseded phase ends with no tile and no puff', async () => {
    const { scene, enemy } = makeEnemyScene();
    const walk = (scene._walkCycleCtrl = spyCtrl());
    scene._awaitSceneTween = vi.fn(async (config) => {
      for (const t of config.targets) t.setPosition(config.x, config.y);
      scene._battleSession = 2; // a rewind or a restart took the battle
    });
    await scene.animateEnemyMove(enemy, rowPath(5));
    expect(walk.step).toHaveBeenCalledTimes(1);
    expect(walk.end).toHaveBeenCalledTimes(1);
    expect(walk.end.mock.calls[0][0]).toBe(enemy);
    expect(walk.end.mock.calls[0][1]).toBeUndefined(); // no landing tile: no puff
  });

  it('draws the landing puff for a seen foe and none for one that lands in the fog', async () => {
    const real = (options) => {
      const ctx = makeEnemyScene(options);
      ctx.scene.time = { now: 0 };
      ctx.scene.drawn = [];
      ctx.scene.events = { on: vi.fn(), off: vi.fn(), once: vi.fn() };
      ctx.scene.textures = { exists: (k) => k === 'fx_atlas' };
      ctx.scene.add = { image: vi.fn(() => makeImage(ctx.scene)) };
      Object.assign(ctx.enemy.graphic, {
        scene: {},
        active: true,
        texture: { key: 'traced-x' },
        frame: { name: 'idle1' },
        setFrame: vi.fn(),
      });
      return ctx;
    };
    const seenAll = real({ fog: true, seen: new Set(rowPath(4).map((t) => `${t.col},0`)) });
    await seenAll.scene.animateEnemyMove(seenAll.enemy, rowPath(4));
    expect(seenAll.scene.add.image).toHaveBeenCalled();
    const hidden = real({ fog: true, seen: new Set(['0,0', '1,0']) });
    await hidden.scene.animateEnemyMove(hidden.enemy, rowPath(4));
    expect(hidden.scene.add.image).not.toHaveBeenCalled();
  });
});
