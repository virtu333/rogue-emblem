// Suspended-battle flag (anti-refresh): set on battle entry with the entry
// snapshot needed to resume or fully revert, updated with a checkpoint as the
// battle progresses, cleared on completion. Loading a save with a usable
// checkpoint offers Resume-or-Revert; "Continue from map" scrubs the flag and
// refunds entry-time Vision/RNG values (the sanctioned FE-reset full revert).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunManager, saveRun, clearBattleInProgressInSave } from '../src/engine/RunManager.js';
import { getRunKey } from '../src/engine/SlotManager.js';
import { loadGameData } from './testData.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function makeCheckpoint(overrides = {}) {
  return {
    version: 1,
    checkpointIndex: 3,
    rngSeed: 12345,
    turnNumber: 4,
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    ...overrides,
  };
}

describe('RunManager suspended battle (anti-refresh)', () => {
  let gameData;
  let rm;

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
    gameData = loadGameData();
    rm = new RunManager(gameData);
    rm.startRun({ runSeed: 1234, applyBlessingsAtStart: false });
  });

  describe('flag lifecycle', () => {
    it('beginBattleInProgress records nodeId, entry info, and entry-time Vision/RNG values', () => {
      rm.visionChargesRemaining = 2;
      rm.visionCount = 1;
      rm.rngSeed = 777;
      const battleParams = { act: 'act1', objective: 'rout', battleSeed: 42 };
      rm.beginBattleInProgress('node_3', { battleParams, isBoss: true, isElite: false });

      const bip = rm.battleInProgress;
      expect(bip.nodeId).toBe('node_3');
      expect(bip.battleParams).toEqual(battleParams);
      expect(bip.battleParams).not.toBe(battleParams); // cloned, not shared
      expect(bip.isBoss).toBe(true);
      expect(bip.isElite).toBe(false);
      expect(bip.visionChargesAtEntry).toBe(2);
      expect(bip.visionCountAtEntry).toBe(1);
      expect(bip.rngSeedAtEntry).toBe(777);
      expect(bip.checkpoint).toBeNull();
    });

    it('setBattleCheckpoint attaches and replaces the checkpoint', () => {
      rm.beginBattleInProgress('node_3');
      rm.setBattleCheckpoint(makeCheckpoint({ checkpointIndex: 1 }));
      expect(rm.battleInProgress.checkpoint.checkpointIndex).toBe(1);
      rm.setBattleCheckpoint(makeCheckpoint({ checkpointIndex: 2 }));
      expect(rm.battleInProgress.checkpoint.checkpointIndex).toBe(2);
    });

    it('setBattleCheckpoint is a no-op without an in-progress battle', () => {
      rm.setBattleCheckpoint(makeCheckpoint());
      expect(rm.battleInProgress).toBeNull();
    });

    it('clearBattleInProgress nulls the flag', () => {
      rm.beginBattleInProgress('node_3');
      rm.clearBattleInProgress();
      expect(rm.battleInProgress).toBeNull();
    });

    it('completeBattle clears the flag even when completion no-ops', () => {
      rm.beginBattleInProgress('node_3');
      rm.setBattleCheckpoint(makeCheckpoint());
      const applied = rm.completeBattle([], 'nonexistent_node');
      expect(applied).toBe(false);
      expect(rm.battleInProgress).toBeNull();
    });

    it('failRun clears the flag', () => {
      rm.beginBattleInProgress('node_3');
      rm.failRun();
      expect(rm.battleInProgress).toBeNull();
    });

    it('startRun resets the flag', () => {
      rm.beginBattleInProgress('node_3');
      rm.startRun({ runSeed: 99, applyBlessingsAtStart: false });
      expect(rm.battleInProgress).toBeNull();
    });
  });

  describe('serialization round trip', () => {
    it('a flag with a checkpoint survives toJSON -> fromJSON for resume', () => {
      rm.beginBattleInProgress('node_3', {
        battleParams: { act: 'act1', objective: 'rout' },
        isBoss: false,
        isElite: true,
      });
      rm.setBattleCheckpoint(makeCheckpoint({ turnNumber: 5 }));

      const loaded = RunManager.fromJSON(rm.toJSON(), gameData);

      expect(loaded.battleInProgress).toBeTruthy();
      expect(loaded.battleInProgress.nodeId).toBe('node_3');
      expect(loaded.battleInProgress.isElite).toBe(true);
      expect(loaded.battleInProgress.checkpoint.turnNumber).toBe(5);
    });

    it('fromJSON drops a flag with no checkpoint (interrupted before first capture)', () => {
      rm.beginBattleInProgress('node_3');
      const loaded = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(loaded.battleInProgress).toBeNull();
    });

    it('fromJSON drops legacy casualty-list flags', () => {
      const json = rm.toJSON();
      json.battleInProgress = { nodeId: 'node_3', casualties: [{ name: 'Galvin' }] };
      const loaded = RunManager.fromJSON(json, gameData);
      expect(loaded.battleInProgress).toBeNull();
    });

    it('fromJSON tolerates a clean save (no flag)', () => {
      const loaded = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(loaded.battleInProgress).toBeNull();
      expect(loaded.status).toBe('active');
    });
  });

  describe('clearBattleInProgressInSave (Continue from map — full revert)', () => {
    it('scrubs the flag, refunds entry-time Vision/RNG values, and bumps savedAt', () => {
      rm.visionChargesRemaining = 2;
      rm.visionCount = 0;
      rm.rngSeed = 1111;
      rm.beginBattleInProgress('node_3');
      // Mid-battle: a Vision rewind spent a charge and checkpoints reseeded
      rm.visionChargesRemaining = 1;
      rm.visionCount = 1;
      rm.rngSeed = 999999;
      rm.setBattleCheckpoint(makeCheckpoint());
      expect(saveRun(rm, null, 1).ok).toBe(true);
      const before = JSON.parse(store[getRunKey(1)]);
      expect(before.battleInProgress).not.toBeNull();
      expect(before.visionChargesRemaining).toBe(1);

      const result = clearBattleInProgressInSave(null, 1);

      expect(result.ok).toBe(true);
      const after = JSON.parse(store[getRunKey(1)]);
      expect(after.battleInProgress).toBeNull();
      expect(after.visionChargesRemaining).toBe(2);
      expect(after.visionCount).toBe(0);
      expect(after.rngSeed).toBe(1111);
      expect(after.savedAt).toBeGreaterThan(before.savedAt);
      // Everything else byte-identical — a revert, never a rewrite
      const stripVolatile = ({
        battleInProgress: _b,
        savedAt: _s,
        visionChargesRemaining: _v,
        visionCount: _c,
        rngSeed: _r,
        ...rest
      }) => rest;
      expect(stripVolatile(after)).toEqual(stripVolatile(before));
    });

    it('invokes the cloud push callback with the scrubbed payload', () => {
      rm.beginBattleInProgress('node_3');
      rm.setBattleCheckpoint(makeCheckpoint());
      expect(saveRun(rm, null, 1).ok).toBe(true);
      const onSave = vi.fn();

      clearBattleInProgressInSave(onSave, 1);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][0].battleInProgress).toBeNull();
    });

    it('is a safe no-op when no save or no flag exists', () => {
      expect(clearBattleInProgressInSave(null, 1)).toEqual({ ok: true, reason: 'no_save' });
      expect(saveRun(rm, null, 1).ok).toBe(true);
      expect(clearBattleInProgressInSave(null, 1)).toEqual({ ok: true, reason: 'already_clear' });
    });

    it('rejects an invalid slot', () => {
      expect(clearBattleInProgressInSave(null, undefined).ok).toBe(false);
    });
  });
});
