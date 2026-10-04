// BattleScene's anti-turtle clock is measured from the populated field. It used to be
// reset while the unit arrays were still empty (bestEnemyCount 0), so no kill ever
// counted as progress and the AI turned aggressive three enemy phases into every
// battle however fast the player was killing.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/Grid.js', () => ({
  Grid: class {
    constructor() {
      this.fogEnabled = false;
      this.gridToPixel = (col, row) => ({ x: col * 16, y: row * 16 });
      this.updateFogOfWar = vi.fn();
      this.clearHighlights = vi.fn();
    }
  },
  computeEffectivePath: vi.fn(),
}));

vi.mock('../src/engine/TurnManager.js', () => ({
  TurnManager: vi.fn(function () {
    this.init = vi.fn();
    this.startBattle = vi.fn();
  }),
}));

vi.mock('../src/engine/AIController.js', () => ({
  AIController: vi.fn(function () {
    this.setAggressiveMode = vi.fn((on) => {
      this.aggressiveMode = on;
    });
  }),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { ANTI_TURTLE_NO_PROGRESS_TURNS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

function makeDisplayObject() {
  const fns = new Map();
  const target = { visible: true, text: '' };
  const proxy = new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      if (key === 'then') return undefined;
      if (!fns.has(key))
        fns.set(
          key,
          vi.fn(() => proxy),
        );
      return fns.get(key);
    },
  });
  return proxy;
}

const ENEMY_SPAWNS = [
  { className: 'Fighter', level: 1, col: 5, row: 0 },
  { className: 'Fighter', level: 1, col: 5, row: 1 },
  { className: 'Soldier', level: 1, col: 5, row: 2 },
];

function startedScene() {
  const gameData = loadGameData();
  const runManager = new RunManager(gameData, null);
  runManager.startRun({ runSeed: 99, autoSelectBlessing: false });
  const deployed = runManager.roster.map((u) => structuredClone(u));
  const scene = new BattleScene();
  const battleConfig = {
    cols: 6,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => Array(6).fill(0)),
    playerSpawns: [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ],
    enemySpawns: ENEMY_SPAWNS,
    objective: 'rout',
  };
  runManager.getLockedBattleConfig = vi.fn(() => battleConfig);
  scene.gameData = gameData;
  scene.runManager = runManager;
  scene.battleParams = { act: 'act1', tutorialMode: false, fogEnabled: false };
  scene.nodeId = 'act1_0_0';
  scene.roster = deployed;
  scene.registry = {
    get: (key) => {
      if (key === 'startupFlags') return { isMobile: false };
      if (key === 'hints') return { shouldShow: () => false };
      return null;
    },
  };
  scene.events = { once: vi.fn() };
  scene.input = {
    mouse: { disableContextMenu: vi.fn() },
    on: vi.fn(),
    keyboard: { on: vi.fn(), addKey: vi.fn(() => ({ on: vi.fn() })) },
  };
  scene.cameras = { main: { width: 640, height: 480 } };
  scene.game = { events: { on: vi.fn(), off: vi.fn() } };
  scene.time = { delayedCall: vi.fn() };
  scene.tweens = { add: vi.fn() };
  scene.add = {
    rectangle: vi.fn(() => makeDisplayObject()),
    text: vi.fn(() => makeDisplayObject()),
  };
  for (const name of [
    'initializeVisionState',
    'installBattleRng',
    'addUnitGraphic',
    'updateObjectiveText',
    'updateTopLeftHudLayout',
    'updateEnemyVisibility',
    'updateVisionHud',
    'cancelTouchInspectHold',
    '_hideMenuTooltip',
    '_restoreBattleRng',
    '_onDangerClick',
    '_onRosterClick',
    'forceEndTurn',
    'requestCancel',
    'requestVisionRewind',
    'refreshEndTurnControl',
    'openUnitDetailOverlay',
    'showLootRoster',
    'hideLootRoster',
    '_cycleForecastWeapon',
    '_playBossEnrageFx',
  ])
    scene[name] = vi.fn();
  scene._reduceMotion = vi.fn(() => true);
  BattleScene.prototype.beginBattle.call(scene, deployed);
  scene.turnPar = 8;
  return scene;
}

describe('BattleScene · anti-turtle clock', () => {
  it('starts from the spawned army, so the first kill counts as progress', () => {
    const scene = startedScene();
    expect(scene.enemyUnits).toHaveLength(ENEMY_SPAWNS.length);
    expect(scene.antiTurtleState.bestEnemyCount).toBe(ENEMY_SPAWNS.length);

    scene.enemyUnits.pop(); // a kill during the player phase
    scene.updateAntiTurtlePressure(1);
    expect(scene.antiTurtleState.noProgressTurns).toBe(0);
  });

  it('a kill every turn keeps the AI patient; turns without one make it aggressive', () => {
    const scene = startedScene();
    for (let turn = 1; turn <= ENEMY_SPAWNS.length; turn++) {
      scene.enemyUnits.pop();
      scene.updateAntiTurtlePressure(turn);
      expect(scene.aiController.aggressiveMode).toBe(false);
    }
    const quiet = startedScene();
    for (let turn = 1; turn <= ANTI_TURTLE_NO_PROGRESS_TURNS; turn++)
      quiet.updateAntiTurtlePressure(turn);
    expect(quiet.aiController.aggressiveMode).toBe(true);
  });
});
