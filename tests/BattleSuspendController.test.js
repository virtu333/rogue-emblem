// BattleSuspendController: checkpoint capture (RNG reseed + persist), exact
// unit serialization for mid-turn state, and the resume restore path.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BattleSuspendController,
  serializeSuspendUnit,
} from '../src/ui/BattleSuspendController.js';
import { hashRewindSeed } from '../src/ui/VisionRewindController.js';

function makeUnit(overrides = {}) {
  const ironSword = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof', uid: 'w-1' };
  return {
    name: 'Galvin',
    className: 'Mercenary',
    faction: 'player',
    level: 4,
    col: 2,
    row: 3,
    stats: { HP: 24, STR: 8, MAG: 0, SKL: 6, SPD: 7, LCK: 3, DEF: 4, RES: 1, MOV: 5 },
    currentHP: 17,
    weapon: ironSword,
    inventory: [ironSword],
    consumables: [],
    skills: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    hasMoved: true,
    hasActed: true,
    _miracleUsed: true,
    _phoenixBroochUsed: true,
    _movementSpent: 3,
    _conditions: [{ id: 'poison', turnsRemaining: 2 }],
    _battleDeltas: { xp: 12 },
    graphic: { fake: 'phaser' },
    ...overrides,
  };
}

function makeScene(overrides = {}) {
  const scene = {
    battleState: 'PLAYER_IDLE',
    runManager: {
      battleInProgress: { nodeId: 'n1', checkpoint: null },
      setBattleCheckpoint: vi.fn(function (cp) {
        this.battleInProgress.checkpoint = cp;
      }),
    },
    turnManager: { currentPhase: 'player', turnNumber: 4, endPlayerPhase: vi.fn() },
    visionBaseSeed: 555,
    turnPar: 8,
    turnBonusConfig: null,
    turnCounterText: null,
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    nonDeployedUnits: [],
    visionSnapshot: { id: 'snap' },
    pendingVisionSnapshot: null,
    antiTurtleState: { aggressiveMode: true },
    grid: { fogEnabled: false },
    ballistas: [],
    _zombieTombstones: [],
    goldEarned: 120,
    _playerDeathsThisBattle: 1,
    appliedHybridOverrideTurns: new Set([2]),
    _latePressureWarningShown: true,
    _bossName: 'Varga',
    reseedBattleRng: vi.fn(),
    _persistBattleRunState: vi.fn(),
    addUnitGraphic: vi.fn(),
    dimUnit: vi.fn(),
    _addConditionIcon: vi.fn(),
    aiController: { setAggressiveMode: vi.fn() },
    updateEnemyVisibility: vi.fn(),
    updateObjectiveText: vi.fn(),
    updateVisionHud: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    getTurnPressureSummary: vi.fn(() => ''),
    dangerZoneStale: false,
  };
  return Object.assign(scene, overrides);
}

describe('serializeSuspendUnit', () => {
  it('preserves mid-battle state that serializeUnit deliberately resets', () => {
    const unit = makeUnit();
    const data = serializeSuspendUnit(unit);
    expect(data.hasMoved).toBe(true);
    expect(data.hasActed).toBe(true);
    expect(data._miracleUsed).toBe(true);
    expect(data._phoenixBroochUsed).toBe(true);
    expect(data._movementSpent).toBe(3);
    expect(data._conditions).toEqual([{ id: 'poison', turnsRemaining: 2 }]);
    expect(data._battleDeltas).toEqual({ xp: 12 });
    expect(data.currentHP).toBe(17);
    expect(data.stats).toEqual(unit.stats);
    expect(data.graphic).toBeNull(); // Phaser refs stripped
  });

  it('keeps live (buffed) stats rather than the unwound persistent form', () => {
    const unit = makeUnit({
      _battleTimedWeaponArtBuffs: [{ artId: 'surge' }],
      _battleTimedWeaponArtAppliedStats: { STR: 3 },
    });
    const data = serializeSuspendUnit(unit);
    expect(data.stats.STR).toBe(8); // live value, buff still applied
    expect(data._battleTimedWeaponArtAppliedStats).toEqual({ STR: 3 });
  });
});

describe('captureCheckpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reseeds the battle RNG, attaches the checkpoint, and persists', () => {
    const scene = makeScene();
    const ctrl = new BattleSuspendController(scene);

    expect(ctrl.captureCheckpoint()).toBe(true);

    const expectedSeed = hashRewindSeed(555, 1);
    expect(scene.reseedBattleRng).toHaveBeenCalledWith(expectedSeed);
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.rngSeed).toBe(expectedSeed >>> 0);
    expect(cp.checkpointIndex).toBe(1);
    expect(cp.turnNumber).toBe(4);
    expect(cp.goldEarned).toBe(120);
    expect(cp.playerDeathsThisBattle).toBe(1);
    expect(cp.appliedHybridOverrideTurns).toEqual([2]);
    expect(cp.bossName).toBe('Varga');
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
  });

  it('increments the checkpoint index from the previous checkpoint', () => {
    const scene = makeScene();
    scene.runManager.battleInProgress.checkpoint = { checkpointIndex: 6 };
    const ctrl = new BattleSuspendController(scene);
    ctrl.captureCheckpoint();
    expect(scene.runManager.battleInProgress.checkpoint.checkpointIndex).toBe(7);
    expect(scene.reseedBattleRng).toHaveBeenCalledWith(hashRewindSeed(555, 7));
  });

  it('serializes units with their mid-turn state', () => {
    const scene = makeScene();
    scene.playerUnits = [makeUnit()];
    new BattleSuspendController(scene).captureCheckpoint();
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.playerUnits).toHaveLength(1);
    expect(cp.playerUnits[0].hasActed).toBe(true);
    expect(cp.playerUnits[0]._conditions).toEqual([{ id: 'poison', turnsRemaining: 2 }]);
  });

  it.each([
    ['no battleInProgress flag (tutorial/standalone)', (s) => (s.runManager = null)],
    ['battle already ended', (s) => (s.battleState = 'BATTLE_END')],
    ['enemy phase', (s) => (s.turnManager.currentPhase = 'enemy')],
  ])('refuses to capture with %s', (_label, mutate) => {
    const scene = makeScene();
    mutate(scene);
    expect(new BattleSuspendController(scene).captureCheckpoint()).toBe(false);
    expect(scene._persistBattleRunState).not.toHaveBeenCalled();
  });

  it('never throws when capture fails (lock degrades, gameplay continues)', () => {
    const scene = makeScene();
    scene.playerUnits = null; // forces a TypeError inside the build
    expect(new BattleSuspendController(scene).captureCheckpoint()).toBe(false);
  });

  it('Merchant Caravan: captures isCaravan on npcUnits and the _caravanExited flag', () => {
    const scene = makeScene();
    scene.npcUnits = [
      makeUnit({ name: 'Merchant', faction: 'npc', isCaravan: true, weapon: null, inventory: [] }),
    ];
    scene._caravanExited = true;
    new BattleSuspendController(scene).captureCheckpoint();
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.npcUnits).toHaveLength(1);
    expect(cp.npcUnits[0].isCaravan).toBe(true);
    expect(cp.caravanExited).toBe(true);
  });

  it('Merchant Caravan: captures caravanExited=false when the caravan is still on the field', () => {
    const scene = makeScene();
    scene._caravanExited = false;
    new BattleSuspendController(scene).captureCheckpoint();
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.caravanExited).toBe(false);
  });

  it('Village: captures the village state and the bandit aiMode/aiTargetTile', () => {
    const scene = makeScene();
    scene._villageState = { col: 6, row: 2, status: 'intact' };
    scene.enemyUnits = [
      makeUnit({
        name: 'Bandit',
        faction: 'enemy',
        aiMode: 'seek_tile',
        aiTargetTile: { col: 6, row: 2 },
      }),
    ];
    new BattleSuspendController(scene).captureCheckpoint();
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.villageState).toEqual({ col: 6, row: 2, status: 'intact' });
    expect(cp.enemyUnits[0].aiMode).toBe('seek_tile');
    expect(cp.enemyUnits[0].aiTargetTile).toEqual({ col: 6, row: 2 });
  });

  it('Village: captures villageState=null when the battle has no village', () => {
    const scene = makeScene();
    new BattleSuspendController(scene).captureCheckpoint();
    expect(scene.runManager.battleInProgress.checkpoint.villageState).toBeNull();
  });
});

describe('applyUnits (resume restore)', () => {
  beforeEach(() => vi.clearAllMocks());

  function roundTrip(checkpoint) {
    // The checkpoint crosses a JSON boundary via localStorage
    return JSON.parse(JSON.stringify(checkpoint));
  }

  it('restores units with graphics, relinked weapons, dimming, and condition icons', () => {
    const scene = makeScene();
    const source = makeScene({ playerUnits: [makeUnit()], enemyUnits: [], npcUnits: [] });
    new BattleSuspendController(source).captureCheckpoint();
    const cp = roundTrip(source.runManager.battleInProgress.checkpoint);

    new BattleSuspendController(scene).applyUnits(cp);

    expect(scene.playerUnits).toHaveLength(1);
    const restored = scene.playerUnits[0];
    expect(restored.hasActed).toBe(true);
    // JSON breaks the weapon === inventory[i] identity — restore relinks it
    expect(restored.weapon).toBe(restored.inventory[0]);
    expect(scene.addUnitGraphic).toHaveBeenCalledWith(restored);
    expect(scene.dimUnit).toHaveBeenCalledWith(restored); // acted units re-dim
    expect(scene._addConditionIcon).toHaveBeenCalledWith(restored, 'poison');
  });

  it('restores scene-scoped battle state', () => {
    const scene = makeScene();
    new BattleSuspendController(scene).applyUnits(
      roundTrip({
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        nonDeployedUnits: [{ name: 'Benched' }],
        ballistas: [{ col: 1, row: 1 }],
        zombieTombstones: [{ col: 2, row: 2, turnsRemaining: 3 }],
        goldEarned: 300,
        playerDeathsThisBattle: 2,
        appliedHybridOverrideTurns: [3, 5],
        latePressureWarningShown: true,
      }),
    );
    expect(scene.nonDeployedUnits).toEqual([{ name: 'Benched' }]);
    expect(scene.ballistas).toEqual([{ col: 1, row: 1 }]);
    expect(scene._zombieTombstones).toHaveLength(1);
    expect(scene.goldEarned).toBe(300);
    expect(scene._playerDeathsThisBattle).toBe(2);
    expect(scene.appliedHybridOverrideTurns).toEqual(new Set([3, 5]));
    expect(scene._latePressureWarningShown).toBe(true);
  });

  it('Merchant Caravan: restores isCaravan npc units and the caravanExited flag', () => {
    const scene = makeScene();
    const source = makeScene({
      npcUnits: [
        makeUnit({
          name: 'Merchant',
          faction: 'npc',
          isCaravan: true,
          weapon: null,
          inventory: [],
        }),
      ],
    });
    source._caravanExited = true;
    new BattleSuspendController(source).captureCheckpoint();
    const cp = roundTrip(source.runManager.battleInProgress.checkpoint);

    new BattleSuspendController(scene).applyUnits(cp);

    expect(scene.npcUnits).toHaveLength(1);
    expect(scene.npcUnits[0].isCaravan).toBe(true);
    expect(scene._caravanExited).toBe(true);
  });

  it('Merchant Caravan: caravanExited defaults to false for pre-feature checkpoints', () => {
    const scene = makeScene();
    new BattleSuspendController(scene).applyUnits(
      roundTrip({
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        // no caravanExited field at all (older save shape)
      }),
    );
    expect(scene._caravanExited).toBe(false);
  });

  it('Village: restores villageState and the bandit seek fields through a JSON round-trip', () => {
    const scene = makeScene();
    const source = makeScene({
      enemyUnits: [
        makeUnit({
          name: 'Bandit',
          faction: 'enemy',
          aiMode: 'seek_tile',
          aiTargetTile: { col: 6, row: 2 },
        }),
      ],
    });
    source._villageState = { col: 6, row: 2, status: 'visited' };
    new BattleSuspendController(source).captureCheckpoint();
    const cp = roundTrip(source.runManager.battleInProgress.checkpoint);

    new BattleSuspendController(scene).applyUnits(cp);

    expect(scene._villageState).toEqual({ col: 6, row: 2, status: 'visited' });
    expect(scene.enemyUnits[0].aiMode).toBe('seek_tile');
    expect(scene.enemyUnits[0].aiTargetTile).toEqual({ col: 6, row: 2 });
  });

  it('Village: villageState defaults to null for pre-feature checkpoints', () => {
    const scene = makeScene();
    new BattleSuspendController(scene).applyUnits(
      roundTrip({
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        // no villageState field at all (older save shape)
      }),
    );
    expect(scene._villageState).toBeNull();
  });
});

describe('finalizeResume', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeCheckpoint(overrides = {}) {
    return {
      checkpointIndex: 2,
      rngSeed: 4242,
      turnNumber: 6,
      turnPar: 9,
      visionSnapshot: { id: 'turn-start' },
      pendingVisionSnapshot: null,
      antiTurtleState: { aggressiveMode: true },
      fog: null,
      ...overrides,
    };
  }

  it('restores turn position, Vision snapshot, RNG stream, and HUD state', () => {
    const scene = makeScene({ visionSnapshot: null, turnPar: null });
    scene.playerUnits = [{ name: 'A', hasActed: false }];
    new BattleSuspendController(scene).finalizeResume(makeCheckpoint());

    expect(scene.turnManager.currentPhase).toBe('player');
    expect(scene.turnManager.turnNumber).toBe(6);
    expect(scene.turnPar).toBe(9);
    expect(scene.visionSnapshot).toEqual({ id: 'turn-start' });
    expect(scene.aiController.setAggressiveMode).toHaveBeenCalledWith(true);
    expect(scene.reseedBattleRng).toHaveBeenCalledWith(4242);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.updateObjectiveText).toHaveBeenCalled();
    expect(scene.refreshEndTurnControl).toHaveBeenCalled();
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
  });

  it('hands an exhausted player phase straight to the enemy replay', () => {
    const scene = makeScene();
    scene.playerUnits = [
      { name: 'A', hasActed: true },
      { name: 'B', hasActed: true },
    ];
    new BattleSuspendController(scene).finalizeResume(makeCheckpoint());
    expect(scene.turnManager.endPlayerPhase).toHaveBeenCalledTimes(1);
  });
});
