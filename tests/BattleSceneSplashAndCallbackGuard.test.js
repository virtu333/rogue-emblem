import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (must precede vi.mock calls)
// ---------------------------------------------------------------------------

const { showImportantHintMock, showMinorHintMock, rollSplashTilesMock, rollSplashDamageMock } =
  vi.hoisted(() => ({
    showImportantHintMock: vi.fn(async () => {}),
    showMinorHintMock: vi.fn(() => Promise.resolve()),
    rollSplashTilesMock: vi.fn(() => []),
    rollSplashDamageMock: vi.fn(() => 10),
  }));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: showImportantHintMock,
  showMinorHint: showMinorHintMock,
}));

// Partial mock: keep real exports, override only rollSplashTiles/rollSplashDamage
vi.mock('../src/engine/EntitySystem.js', async () => {
  const actual = await vi.importActual('../src/engine/EntitySystem.js');
  return {
    ...actual,
    rollSplashTiles: rollSplashTilesMock,
    rollSplashDamage: rollSplashDamageMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUnit(name, col, row, faction = 'player') {
  return {
    name,
    col,
    row,
    faction,
    currentHP: 30,
    stats: { HP: 30 },
    isEntity: false,
    _removing: false,
    graphic: null,
    label: null,
    hpBar: {
      bg: { setPosition: vi.fn() },
      fill: { setPosition: vi.fn(), setSize: vi.fn(), setFillStyle: vi.fn() },
    },
  };
}

/**
 * Build a minimal scene mock for _applyEntitySplash.
 * rollSplashTiles and rollSplashDamage are mocked at module level;
 * getUnitAt routes tile coords -> victim units.
 */
function makeSplashScene({ victims }) {
  const scene = new BattleScene();
  scene.scene = { isActive: () => true };
  scene.playerUnits = victims.filter((v) => v.faction === 'player');
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.battleState = 'ENEMY_PHASE';
  scene.battleConfig = { objective: 'rout' };

  scene.grid = {
    cols: 10,
    rows: 10,
    gridToPixel: () => ({ x: 64, y: 64 }),
  };

  scene.removeUnit = vi.fn(async (unit) => {
    const idx = scene.playerUnits.indexOf(unit);
    if (idx !== -1) scene.playerUnits.splice(idx, 1);
  });

  scene.updateHPBar = vi.fn();
  scene.showMinorHintAt = vi.fn();

  // checkBattleEnd: detect Edric death -> set BATTLE_END
  scene.checkBattleEnd = vi.fn(() => {
    const edricAlive = scene.playerUnits.some((u) => u.name === 'Edric');
    if (!edricAlive) {
      scene.battleState = 'BATTLE_END';
      return true;
    }
    return false;
  });

  // Execute delayed callbacks synchronously
  scene.time = { delayedCall: (_ms, cb) => cb() };

  // Position map: route tile coords to victim units
  const posMap = new Map();
  for (const v of victims) posMap.set(`${v.col},${v.row}`, v);
  scene.getUnitAt = vi.fn((col, row) => posMap.get(`${col},${row}`) || null);

  return scene;
}

/**
 * Build a minimal scene mock for onPhaseChange prologue tests.
 * Stubs every method/property that onPhaseChange touches so the real
 * code path can run without throwing.
 */
function makeTutorialScene({ isActive, turn = 1 }) {
  const scene = new BattleScene();

  // Core state
  scene.battleState = 'PLAYER_IDLE';
  scene.battleParams = {};
  scene.turnManager = { currentPhase: 'player', turnNumber: turn, endPlayerPhase: vi.fn() };
  scene.processTurnStartEffects = vi.fn(async () => {});
  scene.processBallistaFire = vi.fn(async () => {});
  scene.isMobileInput = false;
  scene._latePressureWarningShown = false;
  scene.turnPar = null;
  scene.turnCounterText = null;
  scene.inspectionPanel = null;
  scene.inspectMode = false;

  // Scene active guard
  scene.scene = { isActive: () => isActive };

  // Player units (one non-sleeping unit so we don't hit all-sleeping auto-advance)
  const unit = makeUnit('Edric', 2, 2);
  unit.hasMoved = false;
  unit.hasActed = false;
  unit._movementSpent = 0;
  unit._gambitUsedThisTurn = false;
  unit._conditions = undefined;
  scene.playerUnits = [unit];
  scene.enemyUnits = [];
  scene.npcUnits = [];

  // Method stubs (no-ops)
  scene._clearCombatRollSession = vi.fn();
  scene.showPhaseBanner = vi.fn();
  scene.undimUnit = vi.fn();
  scene.dimUnit = vi.fn();
  scene._expireTimedWeaponArtBuffs = vi.fn();
  scene.captureVisionSnapshot = vi.fn();
  scene.updateVisionHud = vi.fn();
  scene.showBriefBanner = vi.fn();
  scene._removeConditionIcon = vi.fn();
  scene.refreshEndTurnControl = vi.fn();

  // Fog disabled (skip fog path)
  scene.grid = { fogEnabled: false };

  // Danger zone
  scene.dangerZoneStale = false;
  scene.dangerZone = { hide: vi.fn() };

  // getTurnPressureState / getTurnPressureSummary
  scene.getTurnPressureState = vi.fn(() => ({ active: false }));
  scene.getTurnPressureSummary = vi.fn(() => '');

  // Registry (hints = null: no slot)
  scene.registry = { get: vi.fn(() => null) };

  // Capture delayed callbacks by delay time
  const capturedCallbacks = [];
  scene.time = {
    delayedCall: (ms, cb) => {
      capturedCallbacks.push({ ms, cb });
    },
  };
  scene._capturedCallbacks = capturedCallbacks;

  return scene;
}

// ---------------------------------------------------------------------------
// Fix 1: Entity splash bail-out on battle end
// Calls real BattleScene.prototype._applyEntitySplash via module-level mock
// of rollSplashTiles/rollSplashDamage.
// ---------------------------------------------------------------------------

describe('_applyEntitySplash resolves before terminal decision', () => {
  it('resolves every splash victim before the caller checks commander death', async () => {
    const edric = makeUnit('Edric', 4, 5);
    edric.currentHP = 1; // will die from splash
    const ally = makeUnit('Ally', 5, 5);
    ally.currentHP = 10;

    const entity = {
      isEntity: true,
      col: 3,
      row: 4,
      faction: 'enemy',
      currentHP: 100,
      stats: { HP: 100 },
      _entityData: { width: 2, height: 2 },
    };
    const primaryTarget = makeUnit('Primary', 3, 5);

    const scene = makeSplashScene({ victims: [edric, ally] });

    // Return Edric's tile first, then Ally's tile
    rollSplashTilesMock.mockReturnValue([
      { col: edric.col, row: edric.row },
      { col: ally.col, row: ally.row },
    ]);
    // Splash damage = 10 (enough to kill 1 HP Edric)
    rollSplashDamageMock.mockReturnValue(10);

    // Call the REAL production method
    await BattleScene.prototype._applyEntitySplash.call(scene, entity, primaryTarget);

    // The decision must describe the fully resolved attack, not a partial
    // splash roll that would continue changing the board behind its modal.
    expect(scene.battleState).toBe('ENEMY_PHASE');
    expect(scene.removeUnit).toHaveBeenCalledTimes(2);
    expect(scene.removeUnit).toHaveBeenCalledWith(edric, { killer: entity });
    expect(scene.checkBattleEnd).not.toHaveBeenCalled();
    expect(ally.currentHP).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Delayed prologue callback guards
// Calls real BattleScene.prototype.onPhaseChange with a real PrologueController: the
// first player phase gates the first select at once and schedules the coach's reveal
// (1500ms) through the guarded runner; the reveal is harmless on a dead scene.
// ---------------------------------------------------------------------------

describe('Prologue delayed callback isActive guards', () => {
  function makePrologueScene({ isActive, turn = 1 }) {
    const scene = makeTutorialScene({ isActive, turn });
    scene.gameData = gameData;
    scene.battleParams = { prologueChapter: 'p1_banner_at_dawn' };
    scene.playerUnits[0].name = 'Edric';
    scene.playerUnits[0].faction = 'player';
    scene.enemyUnits = [];
    scene._prologue = new PrologueController(scene).create();
    return scene;
  }

  it('the first player phase gates the first select at once and schedules the coach reveal', async () => {
    const scene = makePrologueScene({ isActive: true, turn: 1 });

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 1);

    expect(scene._prologue.gate).toEqual({ kind: 'select', unit: 'Edric' });
    expect(scene._prologue.allowsSelect({ name: 'Sera' })).toBe(false);
    const entry = scene._capturedCallbacks.find((c) => c.ms === 1500);
    expect(entry).toBeDefined();
    await scene._capturedCallbacks.find((c) => c.ms === 1200).cb();
    await entry.cb();
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(showImportantHintMock).not.toHaveBeenCalled(); // teach by doing: no welcome wall
  });

  it('the scheduled reveal does nothing on a scene that shut down meanwhile', async () => {
    const scene = makePrologueScene({ isActive: true, turn: 1 });
    BattleScene.prototype.onPhaseChange.call(scene, 'player', 1);
    const entry = scene._capturedCallbacks.find((c) => c.ms === 1500);
    scene._sceneShutdownCleanedUp = true;
    scene.scene.isActive = () => false;
    scene._prologue.destroy();

    await entry.cb();

    expect(scene.battleState).toBe('TURN_START_RESOLVING');
    expect(showImportantHintMock).not.toHaveBeenCalled();
  });

  it('a later player phase schedules no prologue callback and no run hints', async () => {
    const scene = makePrologueScene({ isActive: true, turn: 1 });
    scene.registry = { get: vi.fn(() => ({ hasSeen: () => false, shouldShow: () => true })) };
    BattleScene.prototype.onPhaseChange.call(scene, 'player', 1);
    scene._prologue.skipStep();
    scene._capturedCallbacks.length = 0;
    scene.turnManager.turnNumber = 3;

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 3);

    expect(scene._capturedCallbacks.find((c) => c.ms === 1500)).toBeUndefined();
    expect(scene._prologue.gate).toBeNull();
  });
});
