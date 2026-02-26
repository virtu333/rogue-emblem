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
 * Build a minimal scene mock for onPhaseChange tutorial tests.
 * Stubs every method/property that onPhaseChange touches so the real
 * code path can run without throwing.
 */
function makeTutorialScene({ isActive, tutorialStep = 0, turn = 1 }) {
  const scene = new BattleScene();

  // Core state
  scene.battleState = 'PLAYER_IDLE';
  scene.battleParams = { tutorialMode: true };
  scene.tutorialStep = tutorialStep;
  scene.isMobileInput = false;
  scene._tutorialVisionIntroShown = false;
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
  scene._setTutorialGuideHighlight = vi.fn();
  scene.refreshEndTurnControl = vi.fn();

  // Fog disabled (skip fog path)
  scene.grid = { fogEnabled: false };

  // Danger zone
  scene.dangerZoneStale = false;
  scene.dangerZone = { hide: vi.fn() };

  // getTurnPressureState / getTurnPressureSummary
  scene.getTurnPressureState = vi.fn(() => ({ active: false }));
  scene.getTurnPressureSummary = vi.fn(() => '');

  // Registry (hints = null for tutorial mode)
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

describe('_applyEntitySplash short-circuits on battle end', () => {
  it('stops processing after first lethal splash kills Edric', async () => {
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

    // Edric was killed -> battle ended
    expect(scene.battleState).toBe('BATTLE_END');
    expect(scene.removeUnit).toHaveBeenCalledTimes(1);
    expect(scene.removeUnit).toHaveBeenCalledWith(edric, { killer: entity });

    // checkBattleEnd was called after the lethal splash (regression anchor)
    expect(scene.checkBattleEnd).toHaveBeenCalled();

    // Ally was NOT damaged - loop bailed out
    expect(ally.currentHP).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Delayed tutorial callback guards
// Calls real BattleScene.prototype.onPhaseChange, captures the 1500ms
// delayed callback, then invokes it under controlled isActive conditions.
// ---------------------------------------------------------------------------

describe('Tutorial delayed callback isActive guards', () => {
  it('first tutorial callback (tutorialStep=0) does nothing when scene is inactive', async () => {
    const scene = makeTutorialScene({ isActive: false, tutorialStep: 0, turn: 1 });

    // Call the REAL onPhaseChange - registers the 1500ms tutorial callback
    BattleScene.prototype.onPhaseChange.call(scene, 'player', 1);

    // Find the 1500ms callback (tutorial hint registration)
    const entry = scene._capturedCallbacks.find((c) => c.ms === 1500);
    expect(entry).toBeDefined();

    // Invoke the captured callback - scene is inactive
    await entry.cb();

    // Guard should have bailed - no mutations
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.tutorialStep).toBe(0);
    expect(showImportantHintMock).not.toHaveBeenCalled();
  });

  it('first tutorial callback runs normally when scene IS active', async () => {
    const scene = makeTutorialScene({ isActive: true, tutorialStep: 0, turn: 1 });

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 1);

    const entry = scene._capturedCallbacks.find((c) => c.ms === 1500);
    expect(entry).toBeDefined();

    await entry.cb();

    // Production restores prevState (PLAYER_IDLE) at the end of the callback
    expect(scene.battleState).toBe('PLAYER_IDLE');
    // tutorialStep advances to 2 (two showImportantHint calls: step 0->1->2)
    expect(scene.tutorialStep).toBe(2);
    expect(showImportantHintMock).toHaveBeenCalledTimes(2);
    expect(scene._setTutorialGuideHighlight).toHaveBeenCalledWith('edric');
  });

  it('turn-3 vision tutorial callback does nothing when scene is inactive', async () => {
    const scene = makeTutorialScene({ isActive: false, tutorialStep: 1, turn: 3 });
    // tutorialStep > 0 so we skip the step-0 branch; _tutorialVisionIntroShown = false
    // triggers the turn-3 branch

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 3);

    // _tutorialVisionIntroShown is set synchronously BEFORE the delayed callback
    // (line 10333), so the guard can't prevent that - only assert callback-side effects
    const entry = scene._capturedCallbacks.find((c) => c.ms === 1500);
    expect(entry).toBeDefined();

    await entry.cb();

    // Guard prevents callback-side effects: battleState unchanged, no hints shown
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(showImportantHintMock).not.toHaveBeenCalled();
  });

  it('turn-3 vision tutorial callback mutates state when scene IS active', async () => {
    const scene = makeTutorialScene({ isActive: true, tutorialStep: 1, turn: 3 });

    BattleScene.prototype.onPhaseChange.call(scene, 'player', 3);

    const entry = scene._capturedCallbacks.find((c) => c.ms === 1500);
    expect(entry).toBeDefined();

    await entry.cb();

    // Active: hint shown, battleState restored to prevState (PLAYER_IDLE)
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(showImportantHintMock).toHaveBeenCalledOnce();
  });
});
