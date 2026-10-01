import { createBattleTimeline } from '../src/engine/BattleTimeline.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
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
    _battleSession: 1,
    battleState: 'PLAYER_IDLE',
    runManager: {
      battleInProgress: { nodeId: 'n1', checkpoint: null },
      toJSON() {
        return { battleInProgress: this.battleInProgress };
      },
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
    _persistBattleRunState: vi.fn(() => ({ ok: true })),
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
    const source = makeScene({
      _battleSession: 1,
      playerUnits: [makeUnit()],
      enemyUnits: [],
      npcUnits: [],
    });
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
        _battleSession: 1,
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
    expect(scene.nonDeployedUnits).toEqual([expect.objectContaining({ name: 'Benched' })]);
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
        _battleSession: 1,
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
        _battleSession: 1,
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

  it('resumes an all-sleeping turn-start popup checkpoint directly into the enemy phase', () => {
    const scene = makeScene();
    scene.playerUnits = [
      {
        name: 'Sleeper',
        currentHP: 20,
        hasActed: false,
        _conditions: [{ id: 'sleep', turnsRemaining: 2 }],
      },
    ];
    new BattleSuspendController(scene).finalizeResume(makeCheckpoint());
    expect(scene.turnManager.endPlayerPhase).toHaveBeenCalledTimes(1);
    expect(scene.reseedBattleRng).toHaveBeenCalledExactlyOnceWith(4242);
  });

  it.each([
    true,
    [],
    { kind: 'unknown', unitName: 'A' },
    { kind: 'finish', unitName: {} },
    { kind: 'combat', unitName: 'A', gambitTriggered: 'yes' },
    { kind: 'finish', unitName: 'A', skipCanto: 1 },
  ])('rejects malformed pending continuation %j', (value) => {
    const scene = makeScene();
    scene.playerUnits = [{ name: 'A', currentHP: 20, hasActed: false }];
    scene.finishUnitAction = vi.fn();
    new BattleSuspendController(scene).finalizeResume(
      makeCheckpoint({ pendingActionCompletion: value }),
    );
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
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

it('migrates pre-commitment trade saves without spending the remaining action or overriding new flags', () => {
  const scene = makeScene();
  const units = [
    makeUnit({ name: 'Legacy trader', faction: 'player', hasMoved: true, hasActed: false }),
    makeUnit({ name: 'Unmoved', faction: 'player', hasMoved: false, hasActed: false }),
    makeUnit({
      name: 'New explicit',
      faction: 'player',
      hasMoved: true,
      hasActed: false,
      _movementCommitted: false,
    }),
  ];
  new BattleSuspendController(scene).applyUnits({
    _battleSession: 1,
    playerUnits: JSON.parse(JSON.stringify(units)),
    enemyUnits: [],
    npcUnits: [],
  });
  expect(scene.playerUnits.map((u) => u._movementCommitted)).toEqual([true, false, false]);
  expect(scene.playerUnits.every((u) => !u.hasActed)).toBe(true);
  expect(serializeSuspendUnit(scene.playerUnits[0])._movementCommitted).toBe(true);
});

describe('enemy action presentation checkpoints', () => {
  it('captures only a completed enemy boundary and resumes the remaining phase directly', () => {
    const scene = makeScene({ enemyUnits: [makeUnit({ faction: 'enemy', hasActed: true })] });
    scene.turnManager.currentPhase = 'enemy';
    const controller = new BattleSuspendController(scene);
    expect(controller.captureCheckpoint()).toBe(false);
    scene._enemyActionCheckpoint = true;
    expect(controller.captureCheckpoint()).toBe(true);
    const checkpoint = JSON.parse(JSON.stringify(scene.runManager.battleInProgress.checkpoint));
    expect(checkpoint.phase).toBe('enemy');
    expect(checkpoint.enemyUnits[0].hasActed).toBe(true);
    scene.startEnemyPhase = vi.fn();
    controller.finalizeResume(checkpoint);
    expect(scene.turnManager.currentPhase).toBe('enemy');
    expect(scene.battleState).toBe('ENEMY_PHASE');
    expect(scene.startEnemyPhase).toHaveBeenCalledWith({ resume: true });
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
  });
});

it('does not serialize live target references from an AI decision', () => {
  const target = makeUnit();
  target.graphic = { parent: target, destroy() {} };
  const enemy = makeUnit({ faction: 'enemy', _lastAiDecision: { target } });
  expect(() => structuredClone(serializeSuspendUnit(enemy))).not.toThrow();
  expect(serializeSuspendUnit(enemy)._lastAiDecision).toBeUndefined();
});

it('preserves the stable seed base across successive resume checkpoints', () => {
  const uninterrupted = makeScene();
  const live = new BattleSuspendController(uninterrupted);
  live.captureCheckpoint();
  const first = JSON.parse(JSON.stringify(uninterrupted.runManager.battleInProgress.checkpoint));
  live.captureCheckpoint();
  const expected = uninterrupted.runManager.battleInProgress.checkpoint.rngSeed;
  const resumed = makeScene({ visionBaseSeed: first.rngSeed });
  resumed.runManager.battleInProgress.checkpoint = first;
  const restored = new BattleSuspendController(resumed);
  restored.finalizeResume(first);
  restored.captureCheckpoint();
  expect(resumed.runManager.battleInProgress.checkpoint.rngSeed).toBe(expected);
});

describe('committed attack intent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('commit capture keeps the RNG stream and decision key and adds no timeline row', () => {
    const decision = { algorithm: 'mulberry32-v1', cursor: 11 };
    const scene = makeScene({
      _battleRewindPolicy: 'fixed-v1',
      _battleDecisionRngState: decision,
      _battleRng: { getState: () => ({ algorithm: 'mulberry32-v1', cursor: 99 }) },
      _pendingCommittedAction: { kind: 'attack', unitId: 'u1', unitName: 'A', targetId: 'u2' },
    });
    scene.runManager.rngSeed = 77;
    scene.runManager.battleInProgress.timeline = null;

    expect(new BattleSuspendController(scene).captureCheckpoint({ commitIntent: true })).toBe(true);

    expect(scene.reseedBattleRng).not.toHaveBeenCalled();
    expect(scene._battleDecisionRngState).toBe(decision);
    expect(scene.runManager.battleInProgress.timeline).toBeNull();
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.rngState).toEqual({ algorithm: 'mulberry32-v1', cursor: 99 });
    expect(cp.decisionRngState).toEqual(decision);
    expect(cp.pendingCommittedAction).toMatchObject({ kind: 'attack', targetId: 'u2' });
  });

  it('commit capture also leaves a legacy-policy stream unseeded', () => {
    const scene = makeScene();
    scene.runManager.rngSeed = 77;
    new BattleSuspendController(scene).captureCheckpoint({ commitIntent: true });
    expect(scene.reseedBattleRng).not.toHaveBeenCalled();
    expect(scene.runManager.battleInProgress.checkpoint.rngSeed).toBe(77);
  });

  it('finalizeResume replays a valid committed attack instead of returning to idle', () => {
    const scene = makeScene();
    scene.playerUnits = [{ name: 'A', hasActed: false }];
    scene.resumeCommittedAttack = vi.fn(() => true);
    new BattleSuspendController(scene).finalizeResume({
      checkpointIndex: 3,
      rngSeed: 1,
      turnNumber: 2,
      pendingCommittedAction: {
        kind: 'attack',
        unitId: 'u1',
        unitName: 'A',
        targetId: 'u4',
        weaponArt: { artId: 'sword_1', weaponIndex: 0 },
      },
    });
    expect(scene.resumeCommittedAttack).toHaveBeenCalledWith({
      kind: 'attack',
      unitId: 'u1',
      unitName: 'A',
      targetId: 'u4',
      weaponArt: { artId: 'sword_1', weaponIndex: 0 },
    });
  });

  it.each([
    true,
    { kind: 'move', unitId: 'u1', unitName: 'A', targetId: 'u2' },
    { kind: 'attack', unitId: 'x1', unitName: 'A', targetId: 'u2' },
    { kind: 'attack', unitId: 'u1', unitName: 'A', targetId: 'u1' },
    { kind: 'attack', unitId: 'u1', unitName: '', targetId: 'u2' },
    { kind: 'attack', unitId: 'u1', unitName: 'A', targetId: 'u2', weaponArt: { artId: 3 } },
  ])('ignores a malformed committed action %j', (value) => {
    const scene = makeScene();
    scene.playerUnits = [{ name: 'A', hasActed: false }];
    scene.resumeCommittedAttack = vi.fn(() => true);
    new BattleSuspendController(scene).finalizeResume({
      checkpointIndex: 3,
      rngSeed: 1,
      turnNumber: 2,
      pendingCommittedAction: value,
    });
    expect(scene.resumeCommittedAttack).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it('a fatal checkpoint takes precedence over any committed attack', () => {
    const scene = makeScene();
    scene.resumeCommittedAttack = vi.fn(() => true);
    scene.showLordDeathVisionPrompt = vi.fn(() => true);
    new BattleSuspendController(scene).finalizeResume({
      checkpointIndex: 3,
      rngSeed: 1,
      turnNumber: 2,
      recoveryKind: 'fatal_pending',
      pendingCommittedAction: { kind: 'attack', unitId: 'u1', unitName: 'A', targetId: 'u2' },
    });
    expect(scene.resumeCommittedAttack).not.toHaveBeenCalled();
    expect(scene.showLordDeathVisionPrompt).toHaveBeenCalled();
  });
});

it('restores legacy Gaspar checkpoint units with Measured Step and fixed traits in every group', () => {
  const scene = makeScene();
  const old = makeUnit({ specialCharId: 'old_knight', skills: ['canto', 'aegis'], traits: [] });
  const checkpoint = Object.fromEntries(
    ['playerUnits', 'enemyUnits', 'npcUnits', 'escapedUnits', 'nonDeployedUnits'].map((key) => [
      key,
      [serializeSuspendUnit(old)],
    ]),
  );
  new BattleSuspendController(scene).applyUnits(checkpoint);
  for (const key of Object.keys(checkpoint)) {
    expect(scene[key][0].skills).toEqual(['measured_step', 'aegis']);
    expect(scene[key][0].traits).toEqual(['old_campaigner', 'set_in_his_ways']);
    expect(scene[key][0].specialRulesVersion).toBe(1);
  }
  // Restored active and benched copies share the same policy without touching the source.
  expect(old.skills).toEqual(['canto', 'aegis']);
});

describe('checkpoint persistence retry ownership', () => {
  it('a retry writes the captured run candidate even if live state changed, and clears the failure status', () => {
    const scene = makeScene({ _battleSession: 1 });
    scene.runManager.gold = 7;
    scene.runManager.toJSON = function () {
      return { gold: this.gold, battleInProgress: this.battleInProgress };
    };
    let stored = null;
    let fail = true;
    scene._persistBattleRunState = (candidate) => {
      if (fail) return { ok: false, reason: 'write_error' };
      stored = JSON.parse(JSON.stringify(candidate || scene.runManager.toJSON()));
      return { ok: true };
    };
    const controller = new BattleSuspendController(scene);
    expect(controller.captureCheckpoint()).toBe(false);
    scene.runManager.gold = 999;
    scene.runManager.battleInProgress.checkpoint.goldEarned = 999;
    scene.runManager.battleInProgress.nodeId = 'mutated live node';
    fail = false;
    expect(controller.retryCheckpoint()).toEqual({ ok: true });
    expect(stored.gold).toBe(7);
    expect(stored.battleInProgress.nodeId).toBe('n1');
    expect(stored.battleInProgress.checkpoint.goldEarned).toBe(120);
    expect(stored.battleInProgress.checkpoint.checkpointIndex).toBe(1);
    expect(scene._checkpointPersistenceResult).toEqual({ ok: true });
  });
  it.each(['legacy', 'fixed-v1'])(
    're-persists the identical %s checkpoint and RNG instead of recapturing',
    (policy) => {
      const rng = createBattleRng(137);
      rng();
      rng();
      const scene = makeScene({ _battleSession: 1, _battleRewindPolicy: policy, _battleRng: rng });
      scene.runManager.rngSeed = 137;
      scene._persistBattleRunState.mockReturnValueOnce({ ok: false, reason: 'write_error' });
      const controller = new BattleSuspendController(scene);
      expect(controller.captureCheckpoint()).toBe(false);
      const checkpoint = structuredClone(scene.runManager.battleInProgress.checkpoint);
      const cursor = rng.getState();
      const reseeds = scene.reseedBattleRng.mock.calls.length;
      expect(controller.retryCheckpoint()).toEqual({ ok: true });
      expect(scene.runManager.battleInProgress.checkpoint).toEqual(checkpoint);
      expect(rng.getState()).toEqual(cursor);
      expect(scene.reseedBattleRng.mock.calls.length).toBe(reseeds);
      if (policy === 'fixed-v1') {
        expect(cursor).toEqual({
          algorithm: 'mulberry32-v1',
          cursor: (137 + 2 * 0x6d2b79f5) >>> 0,
        });
        expect(reseeds).toBe(0);
      }
      scene._battleSession = 2;
      expect(controller.retryCheckpoint()).toEqual({ ok: false, reason: 'stale_session' });
      expect(scene._persistBattleRunState).toHaveBeenCalledTimes(2);
    },
  );
});

describe('checkpoint retry snapshots', () => {
  it('does not clone the complete run on a successful save', () => {
    const scene = makeScene();
    const json = { battleInProgress: scene.runManager.battleInProgress };
    scene.runManager.toJSON = vi.fn(() => json);
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      expect(new BattleSuspendController(scene).captureCheckpoint()).toBe(true);
      expect(scene.runManager.toJSON).toHaveBeenCalledOnce();
      expect(clone.mock.calls.some(([arg]) => arg === json)).toBe(false);
    } finally {
      clone.mockRestore();
    }
  });
  it('keeps the most trimmed failed quota candidate and adopts it on retry success', () => {
    const scene = makeScene({ _battleSession: 1 });
    scene.runManager.battleInProgress.timeline = {
      ...createBattleTimeline(),
      entries: [],
      presentation: { nextId: 2, frames: ['large frame'] },
      currentTurn: 4,
      revision: 1,
    };
    scene._persistBattleRunState.mockReturnValue({ ok: false, reason: 'quota' });
    const ctrl = new BattleSuspendController(scene);
    expect(ctrl.captureCheckpoint()).toBe(false);
    expect(ctrl._retryCandidate.battleInProgress.timeline.presentation).toBeNull();
    expect(ctrl._retryCandidate.battleInProgress.timeline.earlierHistoryUnavailable).toBe(true);
    scene.runManager.battleInProgress.timeline.currentTurn = 999;
    scene._persistBattleRunState.mockReturnValue({ ok: true });
    expect(ctrl.retryCheckpoint()).toEqual({ ok: true });
    expect(scene._battleTimeline).toBe(scene.runManager.battleInProgress.timeline);
    expect(scene._battleTimeline.currentTurn).toBe(4);
    expect(scene._battleTimeline.earlierHistoryUnavailable).toBe(true);
  });
});

it('a newer capture serialization error cannot retry a previous failed candidate', () => {
  const scene = makeScene({ _battleSession: 1 });
  scene._persistBattleRunState.mockReturnValue({ ok: false, reason: 'write_error' });
  const ctrl = new BattleSuspendController(scene);
  expect(ctrl.captureCheckpoint()).toBe(false);
  expect(ctrl._retryCandidate).not.toBeNull();
  scene.runManager.toJSON = () => {
    throw Error('cannot serialize newer action');
  };
  expect(ctrl.captureCheckpoint()).toBe(false);
  const writes = scene._persistBattleRunState.mock.calls.length;
  expect(ctrl.retryCheckpoint()).toEqual({ ok: false, reason: 'checkpoint_replaced' });
  expect(scene._persistBattleRunState).toHaveBeenCalledTimes(writes);
});
