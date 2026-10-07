// BattleScene applies the Wounded burden's stat delta (docs/specs/event-nodes-phase2.md §2B) at a
// fresh start only: the first forecast already shows it, a resume's units (restored from the
// checkpoint) are not debuffed twice, and a battle with no wound starts every unit whole.
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
  AIController: vi.fn(function () {}),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

// A permissive Phaser display object: every method exists and chains, so the HUD
// controllers beginBattle builds (Eclipse, beacon, objective) run to completion.
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
          vi.fn((...args) => {
            if (key === 'setText') obj.text = args[0];
            if (key === 'setVisible') obj.visible = args[0];
            return proxy;
          }),
        );
      return fns.get(key);
    },
  });
  return proxy;
}

function makeScene({ runManager, deployed, battleDebuffs }) {
  const gameData = loadGameData();
  const scene = new BattleScene();
  const battleConfig = {
    cols: 6,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => Array(6).fill(0)),
    // Ordered nearest-first to the recruit, as MapGenerator hands them over.
    playerSpawns: [
      { col: 1, row: 2 },
      { col: 0, row: 0 },
      { col: 0, row: 3 },
    ],
    enemySpawns: [],
    objective: 'rout',
  };
  runManager.getLockedBattleConfig = vi.fn(() => battleConfig);
  scene.gameData = gameData;
  scene.runManager = runManager;
  scene.battleParams = {
    act: 'act1',
    fogEnabled: false,
    ...(battleDebuffs ? { battleDebuffs } : {}),
  };
  scene.nodeId = 'act1_3_3';
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
    'initializeAntiTurtleState',
    'initializeVisionState',
    'installBattleRng',
    'addUnitGraphic',
    'addEnemyFromSpawn',
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
  ])
    scene[name] = vi.fn();
  scene._reduceMotion = vi.fn(() => true);
  return scene;
}

function realRun() {
  const rm = new RunManager(loadGameData(), null);
  rm.startRun({ runSeed: 4242, autoSelectBlessing: false });
  return rm;
}

const deployedOf = (rm) => rm.roster.map((u) => structuredClone(u));

describe('BattleScene · the Wounded burden', () => {
  it('lands on the wounded unit at a fresh start, and only on it', () => {
    const rm = realRun();
    const deployed = deployedOf(rm);
    const [first, second] = deployed;
    const before = { first: first.stats.STR, second: second.stats.SPD };
    const scene = makeScene({
      runManager: rm,
      deployed,
      battleDebuffs: [{ unitUid: first.unitUid, stat: 'STR', value: -2, source: 'wounded' }],
    });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    const fielded = scene.playerUnits.find((u) => u.unitUid === first.unitUid);
    expect(fielded.stats.STR).toBe(before.first - 2);
    expect(fielded._battleDeltas).toEqual({ STR: -2 });
    const other = scene.playerUnits.find((u) => u.unitUid === second.unitUid);
    expect(other.stats.SPD).toBe(before.second);
    expect(other._battleDeltas).toBeUndefined();
  });

  it('a battle with no wound starts everyone whole', () => {
    const rm = realRun();
    const deployed = deployedOf(rm);
    const scene = makeScene({ runManager: rm, deployed });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    for (const unit of scene.playerUnits) expect(unit._battleDeltas).toBeUndefined();
  });
});
