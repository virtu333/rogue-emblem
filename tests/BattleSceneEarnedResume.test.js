// BattleScene reads the earned blessings that act in battle (engine/BattleBlessings.js) once,
// at a fresh start, from the run; a resume restores what the suspended battle had spent from
// its checkpoint (BattleSuspendController.applyUnits → restoreBattleWorldState). The real
// beginBattle on a rendering adapter (the BattleSceneWounded pattern), a real RunManager.
//
// Each test names the realistic failure it catches.
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
import {
  BANNER,
  bannerReadyFor,
  blessingTurnStartEffects,
  lanternReady,
} from '../src/engine/BattleBlessings.js';
import { applyTimedBuffEntry } from '../src/engine/TimedWeaponArtBuffs.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
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

function makeScene({ runManager, deployed, resumeCheckpoint = null }) {
  const gameData = loadGameData();
  const scene = new BattleScene();
  const battleConfig = {
    cols: 6,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => Array(6).fill(0)),
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
  scene.battleParams = { act: 'act1', fogEnabled: false };
  scene.nodeId = 'act1_3_3';
  scene.roster = deployed;
  scene._resumeCheckpoint = resumeCheckpoint;
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
    'dimUnit',
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
    '_persistBattleRunState',
  ])
    scene[name] = vi.fn();
  scene._reduceMotion = vi.fn(() => true);
  return scene;
}

/** A real run holding the Unbroken Banner and the Ember Lantern (and any `more`). */
function bannerRun(more = []) {
  const rm = new RunManager(loadGameData(), null);
  rm.startRun({ runSeed: 4242, autoSelectBlessing: false });
  for (const id of ['unbroken_banner', 'ember_lantern', ...more])
    expect(rm.addBlessingMidRun(id, { earned: true })).toBeTruthy();
  return rm;
}

const deployedOf = (rm) => rm.roster.map((u) => structuredClone(u));

/** The checkpoint a suspended battle left: its units (across JSON) and its world state. */
function checkpointFrom(scene, extra = {}) {
  return JSON.parse(
    JSON.stringify({
      playerUnits: scene.playerUnits,
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      nonDeployedUnits: [],
      nextEntityId: 100,
      ...extra,
    }),
  );
}

describe('BattleScene · the earned blessings at the start of a battle', () => {
  it("a fresh start reads the banner and the lantern from the run's held blessings", () => {
    // Failure: the scene never reads the run (no banner in any real battle), or reads a stale
    // state from an earlier battle.
    const rm = bannerRun();
    const deployed = deployedOf(rm);
    const scene = makeScene({ runManager: rm, deployed });
    scene._battleBlessings = { lastStand: 1, firstKillHeal: 0, firstTurnMov: 0, spent: [BANNER] };
    BattleScene.prototype.beginBattle.call(scene, deployed);
    expect(scene._battleBlessings).toMatchObject({
      lastStand: 1,
      firstKillHeal: 10,
      firstTurnMov: 0,
      spent: [],
    });
    expect(bannerReadyFor(scene._battleBlessings, scene.playerUnits[0])).toBe(true);
    expect(lanternReady(scene._battleBlessings)).toBe(true);
  });

  it('a run holding none of them starts the battle with no state at all', () => {
    // Failure: an empty state object makes every strike event and checkpoint gain keys.
    const rm = new RunManager(loadGameData(), null);
    rm.startRun({ runSeed: 4242, autoSelectBlessing: false });
    const deployed = deployedOf(rm);
    const scene = makeScene({ runManager: rm, deployed });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    expect(scene._battleBlessings).toBeNull();
  });

  it('a resume keeps the banner spent: the checkpoint, not the run, says what was used', () => {
    // Failure: the resume rebuilds the state from the run after the checkpoint's units are
    // restored, so a refresh after the hold readies the banner for a second ally.
    const rm = bannerRun();
    const deployed = deployedOf(rm);
    const fresh = makeScene({ runManager: rm, deployed });
    BattleScene.prototype.beginBattle.call(fresh, deployed);
    const checkpoint = checkpointFrom(fresh, { battleBlessingsSpent: [BANNER, 'lantern'] });

    const resumed = makeScene({ runManager: rm, deployed: null, resumeCheckpoint: checkpoint });
    BattleScene.prototype.beginBattle.call(resumed, null);
    expect(resumed.playerUnits.map((u) => u.name)).toEqual(fresh.playerUnits.map((u) => u.name));
    expect(resumed._battleBlessings).toMatchObject({ lastStand: 1, firstKillHeal: 10 });
    expect(resumed._battleBlessings.spent).toEqual([BANNER, 'lantern']);
    for (const unit of resumed.playerUnits)
      expect(bannerReadyFor(resumed._battleBlessings, unit)).toBe(false);
    expect(lanternReady(resumed._battleBlessings)).toBe(false);
  });

  it('a resume of a battle that had spent nothing keeps both ready', () => {
    // Failure: the resume marks the banner spent (or drops the state) without a hold.
    const rm = bannerRun();
    const deployed = deployedOf(rm);
    const fresh = makeScene({ runManager: rm, deployed });
    BattleScene.prototype.beginBattle.call(fresh, deployed);
    const checkpoint = checkpointFrom(fresh, { battleBlessingsSpent: [] });
    const resumed = makeScene({ runManager: rm, deployed: null, resumeCheckpoint: checkpoint });
    BattleScene.prototype.beginBattle.call(resumed, null);
    expect(bannerReadyFor(resumed._battleBlessings, resumed.playerUnits[0])).toBe(true);
    expect(lanternReady(resumed._battleBlessings)).toBe(true);
  });

  it("a turn-1 resume keeps Captain's Whistle as the checkpoint held it: never doubled", () => {
    // Failure: the resume path applies the whistle again (or rebuilds the unit's MOV from the
    // run), so a refresh on turn 1 gives +2 Move or a buff that outlives the turn.
    const rm = bannerRun(['captains_whistle']);
    const deployed = deployedOf(rm);
    const fresh = makeScene({ runManager: rm, deployed });
    BattleScene.prototype.beginBattle.call(fresh, deployed);
    const baseMov = fresh.playerUnits.map((u) => u.stats.MOV);
    for (const e of blessingTurnStartEffects(fresh.playerUnits, fresh._battleBlessings, 1))
      applyTimedBuffEntry(e.target, e.entry);
    const checkpoint = checkpointFrom(
      { playerUnits: fresh.playerUnits.map((u) => serializeBattleUnit(u)) },
      { battleBlessingsSpent: [], turnNumber: 1, phase: 'enemy' },
    );
    const resumed = makeScene({ runManager: rm, deployed: null, resumeCheckpoint: checkpoint });
    BattleScene.prototype.beginBattle.call(resumed, null);
    expect(resumed.playerUnits.map((u) => u.stats.MOV)).toEqual(baseMov.map((m) => m + 1));
    for (const unit of resumed.playerUnits) {
      const whistles = (unit._battleTimedWeaponArtBuffs || []).filter(
        (b) => b.sourceName === "Captain's Whistle",
      );
      expect(whistles).toHaveLength(1);
      expect(whistles[0]).toMatchObject({ expiryPhase: 'enemy', expiryTurn: 1 });
    }
  });
});
