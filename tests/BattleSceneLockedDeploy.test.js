// A battle's map is locked the first time it is entered, with one player spawn per unit
// deployed then; Continue from Map keeps the lock. Playtest (Sep 2026): a player deployed
// 5, reverted to the map, redeployed 6 — the sixth unit (Rowan) was never placed, and
// being on neither the field nor the bench he would have been recorded fallen at victory.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

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

vi.mock('../src/engine/AIController.js', () => ({ AIController: vi.fn(function () {}) }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
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

const spawns = (n) => Array.from({ length: n }, (_, i) => ({ col: i, row: 0 }));

function recruit(name) {
  return {
    name,
    className: 'Fighter',
    isLord: false,
    level: 5,
    stats: { HP: 20, MOV: 5 },
    currentHP: 20,
    inventory: [],
    skills: [],
  };
}

function realRun() {
  const rm = new RunManager(loadGameData(), null);
  rm.startRun({ runSeed: 4242, autoSelectBlessing: false });
  return rm;
}

function makeScene({ runManager, roster, lockedSpawns, act = 'act3' }) {
  const scene = new BattleScene();
  const battleConfig = {
    cols: 8,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => Array(8).fill(0)),
    playerSpawns: spawns(lockedSpawns),
    enemySpawns: [],
    objective: 'rout',
  };
  runManager.battleConfigsByNodeId = { act3_2_1: structuredClone(battleConfig) };
  scene.gameData = loadGameData();
  scene.runManager = runManager;
  scene.battleParams = { act, tutorialMode: false, fogEnabled: false };
  scene.nodeId = 'act3_2_1';
  scene.roster = roster;
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
    '_clearTutorialGuideHighlights',
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
    '_setupGamepadInput',
  ])
    scene[name] = vi.fn();
  scene._reduceMotion = vi.fn(() => true);
  return scene;
}

describe('BattleScene · re-entering a locked battle', () => {
  it('caps the deploy screen at the locked map’s spawn count', () => {
    const rm = realRun();
    // Act 3 allows 7; the lock was made with 5.
    const roster = [...rm.roster, ...['A', 'B', 'C', 'D', 'E', 'F'].map(recruit)];
    const scene = makeScene({ runManager: rm, roster, lockedSpawns: 5 });
    scene.showDeployScreen = vi.fn();
    scene.beginBattle = vi.fn();
    scene.create();
    expect(scene.beginBattle).not.toHaveBeenCalled();
    const limits = scene.showDeployScreen.mock.calls[0][1];
    expect(limits.max).toBe(5);
    expect(limits.lockedTo).toBe(5);
  });

  it('asks for a pick instead of auto-deploying a roster that no longer fits', () => {
    const rm = realRun();
    // Seven units fit act 3's cap of 7, so they would auto-deploy — into 5 spawns.
    const roster = [...rm.roster, ...['A', 'B', 'C', 'D', 'E'].map(recruit)];
    expect(roster).toHaveLength(8);
    const scene = makeScene({ runManager: rm, roster, lockedSpawns: 5 });
    scene.showDeployScreen = vi.fn();
    scene.beginBattle = vi.fn();
    scene.create();
    expect(scene.beginBattle).not.toHaveBeenCalled();
    expect(scene.showDeployScreen).toHaveBeenCalledTimes(1);
  });

  it('a first entry keeps the act’s full cap', () => {
    const rm = realRun();
    const roster = [...rm.roster, ...['A', 'B', 'C', 'D', 'E', 'F'].map(recruit)];
    const scene = makeScene({ runManager: rm, roster, lockedSpawns: 5 });
    rm.battleConfigsByNodeId = {};
    scene.showDeployScreen = vi.fn();
    scene.beginBattle = vi.fn();
    scene.create();
    expect(scene.showDeployScreen.mock.calls[0][1]).toMatchObject({ max: 7, lockedTo: null });
  });

  it('a deploy bonus opens Act IV to 10 slots but still requires only 5', () => {
    const rm = realRun();
    rm.getDeployBonus = () => 2; // Tactical Advantage + Scout Blessing
    const roster = [...rm.roster, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(recruit)];
    expect(roster).toHaveLength(12);
    const scene = makeScene({ runManager: rm, roster, lockedSpawns: 5, act: 'act4' });
    rm.battleConfigsByNodeId = {};
    scene.showDeployScreen = vi.fn();
    scene.beginBattle = vi.fn();
    scene.create();
    expect(scene.beginBattle).not.toHaveBeenCalled();
    expect(scene.showDeployScreen.mock.calls[0][1]).toEqual({ min: 5, max: 10, lockedTo: null });
  });

  it('benches a deployed unit that has no spawn instead of dropping it', () => {
    const rm = realRun();
    const deployed = [...rm.roster.map((u) => structuredClone(u)), recruit('Rowan')];
    const scene = makeScene({
      runManager: rm,
      roster: deployed,
      lockedSpawns: deployed.length - 1,
    });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    const accounted = [...scene.playerUnits, ...scene.nonDeployedUnits];
    for (const unit of deployed) expect(accounted).toContain(unit);
    expect(scene.nonDeployedUnits.map((u) => u.name)).toEqual(['Rowan']);
  });
});
