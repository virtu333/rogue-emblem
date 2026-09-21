import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureBattleState, classifyBattleBoundary } from '../src/ui/BattleCheckpointAdapter.js';
import { validateBattleState, serializedBytes } from '../src/engine/BattleStateSnapshot.js';
import {
  registerBattleEntity,
  resetBattleIdentities,
  findBattleEntity,
} from '../src/engine/BattleEntityIdentity.js';
import { serializeBattleUnit, restoreEquippedReference } from '../src/engine/BattleUnitState.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { completeResolvedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { createUnit } from '../src/engine/UnitManager.js';
import classes from '../data/classes.json';
import weapons from '../data/weapons.json';

afterEach(() => vi.restoreAllMocks());

function fixture(count = 2) {
  const scene = {
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    battleState: 'PLAYER_IDLE',
    turnManager: { currentPhase: 'player', turnNumber: 3 },
    grid: { mapLayout: Array.from({ length: 16 }, () => Array(20).fill(0)), temporaryTerrains: [] },
    runManager: {
      convoy: { weapons: [], consumables: [] },
      accessories: [],
      gold: 123,
      visionChargesRemaining: 2,
    },
    addUnitGraphic() {},
    dimUnit() {},
  };
  resetBattleIdentities(scene);
  for (let i = 0; i < count; i++) {
    const unit = createUnit(
      classes.find((c) => c.name === 'Fighter'),
      10,
      weapons,
      { name: 'Fighter' },
    );
    Object.assign(unit, { col: i % 20, row: Math.floor(i / 20), hasActed: i % 2 === 0 });
    registerBattleEntity(scene, unit);
    scene.playerUnits.push(unit);
  }
  return scene;
}

describe('canonical battle state', () => {
  it('captures without RNG, mutation, random item IDs or nested history', () => {
    const scene = fixture();
    scene.visionSnapshot = { sentinel: true };
    scene._timeline = { cyclic: scene };
    scene.playerUnits[0].consumables.push({ name: 'Old item without UID', uses: 2 });
    scene.playerUnits[0].affixPips = [
      {
        destroy() {
          throw new Error('live display object');
        },
      },
    ];
    const before = JSON.stringify(scene.playerUnits);
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('capture consumed RNG');
    });
    const state = captureBattleState(scene, { rngSeed: 42 });
    expect(validateBattleState(state)).toBe(true);
    expect(JSON.stringify(scene.playerUnits)).toBe(before);
    expect(state).not.toHaveProperty('visionSnapshot');
    expect(state).not.toHaveProperty('timeline');
    expect(state.playerUnits[0].consumables.at(-1)).not.toHaveProperty('uid');
    expect(state.playerUnits[0].affixPips).toBeNull();
  });

  it('preserves live flags, convoy and the second identical equipped weapon across JSON', () => {
    const scene = fixture();
    const unit = scene.playerUnits[0];
    const axe = weapons.find((w) => w.name === 'Iron Axe');
    unit.inventory = [structuredClone(axe), structuredClone(axe)];
    unit.weapon = unit.inventory[1];
    Object.assign(unit, {
      _gambitUsedThisTurn: true,
      _movementSpent: 4,
      _battleWeaponArtUsage: { art: 1 },
    });
    scene.runManager.convoy.consumables.push({ name: 'Village reward', uid: 'reward' });
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 42 })));
    const restored = fixture(0);
    // Injection must not overwrite the non-rewindable charge ledger.
    state.runBattleState.visionChargesRemaining = 999;
    new BattleSuspendController(restored).applyUnits(state);
    const result = restored.playerUnits[0];
    expect(result.weapon).toBe(result.inventory[1]);
    expect(result).toMatchObject({
      _gambitUsedThisTurn: true,
      _movementSpent: 4,
      _battleWeaponArtUsage: { art: 1 },
      hasActed: true,
    });
    expect(restored.runManager.convoy).toEqual(scene.runManager.convoy);
    expect(restored.runManager.visionChargesRemaining).toBe(2);
    expect(result.battleEntityId).toBe(unit.battleEntityId);
    // A deliberately omitted convoy field must fail this domain invariant.
    const omitted = structuredClone(state);
    delete omitted.runBattleState.convoy;
    const broken = fixture(0);
    new BattleSuspendController(broken).applyUnits(omitted);
    expect(broken.runManager.convoy).not.toEqual(scene.runManager.convoy);
  });

  it('has unambiguous identity through rename, faction change and legacy duplicate names', () => {
    const scene = fixture();
    expect(findBattleEntity(scene, { unitName: 'Fighter' })).toBeNull();
    const unit = scene.playerUnits.pop();
    const id = unit.battleEntityId;
    unit.name = 'Warrior';
    scene.escapedUnits.push(unit);
    registerBattleEntity(scene, unit);
    expect(unit.battleEntityId).toBe(id);
    expect(findBattleEntity(scene, { unitId: id, unitName: 'Fighter' })).toBe(unit);
    const copy = structuredClone(unit);
    registerBattleEntity(scene, copy);
    expect(copy.battleEntityId).not.toBe(id);
  });

  it('keeps recovery-only points separate from playable destinations', () => {
    const scene = fixture();
    expect(classifyBattleBoundary(scene)).toBe('destination');
    for (const battleState of ['TRADING', 'CANTO_MOVING', 'COMBAT_RESOLVING', 'UNIT_ACTION_MENU']) {
      expect(classifyBattleBoundary({ ...scene, battleState })).toBe('recovery');
    }
    expect(classifyBattleBoundary({ ...scene, _pendingActionCompletion: { kind: 'finish' } })).toBe(
      'recovery',
    );
    expect(classifyBattleBoundary({ ...scene, _pendingLevelUpPopups: [{}] })).toBe('recovery');
    expect(classifyBattleBoundary({ ...scene, battleState: 'BATTLE_END' })).toBe('closed');
  });

  it('legacy player continuation still resolves when an enemy has the same name', () => {
    const scene = fixture(1);
    scene.enemyUnits.push({ ...scene.playerUnits[0], faction: 'enemy', battleEntityId: 'u99' });
    scene.finishUnitAction = vi.fn();
    completeResolvedAction(scene, { kind: 'finish', unitName: scene.playerUnits[0].name });
    expect(scene.finishUnitAction).toHaveBeenCalledWith(scene.playerUnits[0], { skipCanto: false });
  });

  it('rejects ambiguous IDs, nested history and malformed or oversized snapshots', () => {
    const state = captureBattleState(fixture(), { rngSeed: 42 });
    expect(validateBattleState(state)).toBe(true);
    for (const patch of [
      { version: 99 },
      { turnNumber: -1 },
      { timeline: {} },
      { mapLayout: null },
      { mapLayout: [[null]] },
      { nextEntityId: Infinity },
      { runBattleState: { ...state.runBattleState, gold: -1 } },
    ]) {
      expect(validateBattleState({ ...state, ...patch })).toBe(false);
    }
    for (const patch of [
      { stats: 'bad' },
      { inventory: [null] },
      { consumables: [null] },
      { equippedInventoryIndex: 999 },
      { col: -1 },
    ]) {
      const invalid = structuredClone(state);
      Object.assign(invalid.playerUnits[0], patch);
      expect(validateBattleState(invalid)).toBe(false);
    }
    const duplicate = structuredClone(state);
    duplicate.playerUnits[1].battleEntityId = duplicate.playerUnits[0].battleEntityId;
    expect(validateBattleState(duplicate)).toBe(false);
    expect(validateBattleState({ ...state, extra: 'x'.repeat(2 * 1024 * 1024) })).toBe(false);
    const cyclic = { ...state };
    cyclic.self = cyclic;
    expect(validateBattleState(cyclic)).toBe(false);
  });

  it.each([20, 40])(
    'measures a %i-unit snapshot without recursive Vision/history duplication',
    (count) => {
      const scene = fixture(count);
      for (const unit of scene.playerUnits) {
        unit.inventory = weapons.slice(0, 5).map((w) => structuredClone(w));
        unit.weapon = unit.inventory[0];
        unit.consumables = Array.from({ length: 3 }, (_, i) => ({
          name: 'Vulnerary',
          uid: `s${i}`,
          uses: 3,
        }));
      }
      const state = captureBattleState(scene, { rngSeed: 42 });
      const bytes = serializedBytes(state);
      console.info(
        `Timeline baseline: ${count} units, 5 weapons + 3 supplies each: ${bytes} bytes`,
      );
      expect(bytes).toBeLessThan(512 * 1024);
      expect(validateBattleState(state)).toBe(true);
    },
  );

  it('reserves existing off-field IDs before assigning missing legacy IDs', () => {
    const scene = fixture(1);
    const field = scene.playerUnits[0];
    delete field.battleEntityId;
    const bench = { battleEntityId: 'u1' };
    const escaped = { battleEntityId: 'u2' };
    resetBattleIdentities(scene, undefined, [field, bench, escaped]);
    [field, bench, escaped].forEach((unit) => registerBattleEntity(scene, unit));
    expect(new Set([field, bench, escaped].map((unit) => unit.battleEntityId)).size).toBe(3);
    expect(bench.battleEntityId).toBe('u1');
    expect(escaped.battleEntityId).toBe('u2');
    expect(scene._battleEntityOwners.size).toBe(3);
  });

  it('serializer retains exact equipment reference without mutating live state', () => {
    const unit = fixture().playerUnits[0];
    const data = JSON.parse(JSON.stringify(serializeBattleUnit(unit)));
    restoreEquippedReference(data);
    expect(data.weapon).toBe(data.inventory[0]);
    expect(unit).not.toHaveProperty('equippedInventoryIndex');
  });
});
