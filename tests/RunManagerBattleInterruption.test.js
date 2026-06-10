// Anti-refresh exploit: a save carrying a battle-in-progress flag was
// interrupted mid-battle (refresh/crash), so its recorded casualties must be
// locked in on load — a reload may never revive a fallen unit. Edric mirrors
// the in-battle rules: an enemy-phase death auto-spends a banked Vision
// charge to keep him; a player-phase death or an empty pool fails the run.

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

function makeRecruit(name = 'Galvin') {
  return {
    name,
    className: 'Fighter',
    level: 3,
    tier: 'base',
    faction: 'player',
    stats: { HP: 22, STR: 6, MAG: 0, SKL: 4, SPD: 4, LCK: 2, DEF: 3, RES: 1 },
    growths: { HP: 60, STR: 40, MAG: 5, SKL: 35, SPD: 30, LCK: 25, DEF: 20, RES: 15 },
    currentHP: 22,
    weapon: null,
    inventory: [{ name: 'Iron Axe', type: 'Axe', might: 8, uses: 30 }],
    consumables: [{ name: 'Vulnerary', type: 'Consumable', heals: 10 }],
    accessory: { id: 'power_ring', name: 'Power Ring' },
    skills: [],
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
  };
}

describe('RunManager battle interruption (anti-refresh)', () => {
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
    it('beginBattleInProgress sets the flag with nodeId and empty casualties', () => {
      rm.beginBattleInProgress('node_3');
      expect(rm.battleInProgress).toEqual({ nodeId: 'node_3', casualties: [] });
    });

    it('beginBattleInProgress tolerates a missing nodeId', () => {
      rm.beginBattleInProgress(undefined);
      expect(rm.battleInProgress).toEqual({ nodeId: null, casualties: [] });
    });

    it('setBattleCasualties normalizes, dedupes, and defaults phase to player', () => {
      rm.beginBattleInProgress('node_3');
      rm.setBattleCasualties([
        { name: 'Galvin', phase: 'enemy' },
        { name: 'Galvin', phase: 'player' },
        { name: 'Mira' },
        { name: '', phase: 'enemy' },
        { phase: 'enemy' },
        null,
      ]);
      expect(rm.battleInProgress.casualties).toEqual([
        { name: 'Galvin', phase: 'enemy' },
        { name: 'Mira', phase: 'player' },
      ]);
    });

    it('setBattleCasualties is a no-op without an in-progress battle', () => {
      rm.setBattleCasualties([{ name: 'Galvin', phase: 'enemy' }]);
      expect(rm.battleInProgress).toBeNull();
    });

    it('clearBattleInProgress nulls the flag', () => {
      rm.beginBattleInProgress('node_3');
      rm.clearBattleInProgress();
      expect(rm.battleInProgress).toBeNull();
    });

    it('completeBattle clears the flag even when completion no-ops', () => {
      rm.beginBattleInProgress('node_3');
      const applied = rm.completeBattle([], 'nonexistent_node');
      expect(applied).toBe(false);
      expect(rm.battleInProgress).toBeNull();
    });

    it('failRun clears the flag', () => {
      rm.beginBattleInProgress('node_3');
      rm.failRun();
      expect(rm.battleInProgress).toBeNull();
    });

    it('startRun resets the flag and any prior interruption summary', () => {
      rm.beginBattleInProgress('node_3');
      rm.lastBattleInterruption = { fallenNames: ['Galvin'] };
      rm.startRun({ runSeed: 99, applyBlessingsAtStart: false });
      expect(rm.battleInProgress).toBeNull();
      expect(rm.lastBattleInterruption).toBeNull();
    });

    it('toJSON serializes the flag with its casualties', () => {
      rm.beginBattleInProgress('node_3');
      rm.setBattleCasualties([{ name: 'Galvin', phase: 'enemy' }]);
      const json = rm.toJSON();
      expect(json.battleInProgress).toEqual({
        nodeId: 'node_3',
        casualties: [{ name: 'Galvin', phase: 'enemy' }],
      });
    });

    it('toJSON serializes null when no battle is in progress', () => {
      expect(rm.toJSON().battleInProgress).toBeNull();
    });
  });

  describe('settleInterruptedBattle', () => {
    it('returns null when no battle was in progress', () => {
      expect(rm.settleInterruptedBattle()).toBeNull();
      expect(rm.lastBattleInterruption).toBeNull();
    });

    it('clears the flag and returns null when there are no casualties', () => {
      rm.beginBattleInProgress('node_3');
      expect(rm.settleInterruptedBattle()).toBeNull();
      expect(rm.battleInProgress).toBeNull();
    });

    it('ignores casualties that are not in the roster', () => {
      rm.beginBattleInProgress('node_3');
      rm.battleInProgress.casualties = [{ name: 'NotARosterUnit', phase: 'player' }];
      expect(rm.settleInterruptedBattle()).toBeNull();
      expect(rm.roster.length).toBeGreaterThan(0);
    });

    it('locks a regular casualty: roster -> fallenUnits, items to team storage', () => {
      rm.roster.push(makeRecruit('Galvin'));
      const rosterSizeBefore = rm.roster.length;
      rm.beginBattleInProgress('node_3');
      rm.battleInProgress.casualties = [{ name: 'Galvin', phase: 'player' }];

      const summary = rm.settleInterruptedBattle();

      expect(summary).toEqual({
        nodeId: 'node_3',
        fallenNames: ['Galvin'],
        edricFell: false,
        visionSpent: false,
        runFailed: false,
      });
      expect(rm.lastBattleInterruption).toBe(summary);
      expect(rm.roster).toHaveLength(rosterSizeBefore - 1);
      expect(rm.roster.some((u) => u.name === 'Galvin')).toBe(false);
      const fallen = rm.fallenUnits.find((u) => u.name === 'Galvin');
      expect(fallen).toBeTruthy();
      // Items transferred with the same semantics as completeBattle
      expect(rm.convoy.weapons.some((w) => w.name === 'Iron Axe')).toBe(true);
      expect(rm.convoy.consumables.some((c) => c.name === 'Vulnerary')).toBe(true);
      expect(rm.accessories.some((a) => a.id === 'power_ring')).toBe(true);
      expect(fallen.accessory).toBeNull();
      expect(rm.status).toBe('active');
    });

    it('dedupes repeated casualty entries (unit falls once)', () => {
      rm.roster.push(makeRecruit('Galvin'));
      rm.beginBattleInProgress('node_3');
      rm.battleInProgress.casualties = [
        { name: 'Galvin', phase: 'player' },
        { name: 'Galvin', phase: 'enemy' },
      ];
      const summary = rm.settleInterruptedBattle();
      expect(summary.fallenNames).toEqual(['Galvin']);
      expect(rm.fallenUnits.filter((u) => u.name === 'Galvin')).toHaveLength(1);
    });

    it('Edric enemy-phase death auto-spends a Vision charge (battle still forfeit)', () => {
      rm.roster.push(makeRecruit('Galvin'));
      rm.visionChargesRemaining = 2;
      rm.visionCount = 1;
      rm.beginBattleInProgress('node_3');
      rm.battleInProgress.casualties = [
        { name: 'Edric', phase: 'enemy' },
        { name: 'Galvin', phase: 'enemy' },
      ];

      const summary = rm.settleInterruptedBattle();

      expect(summary.edricFell).toBe(true);
      expect(summary.visionSpent).toBe(true);
      expect(summary.runFailed).toBe(false);
      expect(rm.visionChargesRemaining).toBe(1);
      expect(rm.visionCount).toBe(2);
      expect(rm.roster.some((u) => u.name === 'Edric')).toBe(true);
      // Other casualties still lock in — only Edric is Vision-saved
      expect(summary.fallenNames).toEqual(['Galvin']);
      expect(rm.fallenUnits.some((u) => u.name === 'Galvin')).toBe(true);
      expect(rm.status).toBe('active');
    });

    it('Edric enemy-phase death with no Vision charges fails the run', () => {
      rm.visionChargesRemaining = 0;
      rm.beginBattleInProgress('node_3');
      rm.battleInProgress.casualties = [{ name: 'Edric', phase: 'enemy' }];

      const summary = rm.settleInterruptedBattle();

      expect(summary.runFailed).toBe(true);
      expect(summary.visionSpent).toBe(false);
      expect(rm.status).toBe('defeat');
      // Roster untouched — RunComplete shows the final state and clears the save
      expect(rm.roster.some((u) => u.name === 'Edric')).toBe(true);
    });

    it('Edric player-phase death fails the run even with charges banked', () => {
      // In battle, a player-phase Edric death never offers the Vision prompt
      // (the player could have rewound their own turn before the blunder) —
      // a refresh must not grant an undo the game itself denies.
      rm.visionChargesRemaining = 3;
      rm.beginBattleInProgress('node_3');
      rm.battleInProgress.casualties = [{ name: 'Edric', phase: 'player' }];

      const summary = rm.settleInterruptedBattle();

      expect(summary.runFailed).toBe(true);
      expect(summary.visionSpent).toBe(false);
      expect(rm.visionChargesRemaining).toBe(3);
      expect(rm.status).toBe('defeat');
    });
  });

  describe('fromJSON settlement (the reload path)', () => {
    it('settles recorded casualties when loading an interrupted save', () => {
      rm.roster.push(makeRecruit('Galvin'));
      rm.beginBattleInProgress('node_3');
      rm.setBattleCasualties([{ name: 'Galvin', phase: 'player' }]);

      const loaded = RunManager.fromJSON(rm.toJSON(), gameData);

      expect(loaded.battleInProgress).toBeNull();
      expect(loaded.roster.some((u) => u.name === 'Galvin')).toBe(false);
      expect(loaded.fallenUnits.some((u) => u.name === 'Galvin')).toBe(true);
      expect(loaded.lastBattleInterruption?.fallenNames).toEqual(['Galvin']);
      expect(loaded.status).toBe('active');
    });

    it('settlement is deterministic across repeated loads of the same raw save', () => {
      rm.visionChargesRemaining = 1;
      rm.beginBattleInProgress('node_3');
      rm.setBattleCasualties([{ name: 'Edric', phase: 'enemy' }]);
      const json = rm.toJSON();

      const first = RunManager.fromJSON(json, gameData);
      const second = RunManager.fromJSON(json, gameData);

      // Each load settles from the same raw values — the charge spend never stacks
      expect(first.visionChargesRemaining).toBe(0);
      expect(second.visionChargesRemaining).toBe(0);
      expect(first.status).toBe('active');
      expect(second.status).toBe('active');
    });

    it('loads an Edric defeat as a failed run for the game-over route', () => {
      rm.visionChargesRemaining = 0;
      rm.beginBattleInProgress('node_3');
      rm.setBattleCasualties([{ name: 'Edric', phase: 'enemy' }]);

      const loaded = RunManager.fromJSON(rm.toJSON(), gameData);

      expect(loaded.status).toBe('defeat');
      expect(loaded.lastBattleInterruption?.runFailed).toBe(true);
    });

    it('loads a clean save (no flag) without side effects', () => {
      const loaded = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(loaded.battleInProgress).toBeNull();
      expect(loaded.lastBattleInterruption).toBeNull();
      expect(loaded.status).toBe('active');
    });
  });

  describe('clearBattleInProgressInSave (Save & Exit full revert)', () => {
    it('scrubs only the flag from the persisted save and bumps savedAt', () => {
      rm.beginBattleInProgress('node_3');
      rm.setBattleCasualties([{ name: 'Edric', phase: 'enemy' }]);
      expect(saveRun(rm, null, 1).ok).toBe(true);
      const before = JSON.parse(store[getRunKey(1)]);
      expect(before.battleInProgress).not.toBeNull();

      const result = clearBattleInProgressInSave(null, 1);

      expect(result.ok).toBe(true);
      const after = JSON.parse(store[getRunKey(1)]);
      expect(after.battleInProgress).toBeNull();
      expect(after.savedAt).toBeGreaterThan(before.savedAt);
      // Everything else byte-identical — Save & Exit reverts, never rewrites
      const stripVolatile = ({ battleInProgress: _b, savedAt: _s, ...rest }) => rest;
      expect(stripVolatile(after)).toEqual(stripVolatile(before));
    });

    it('invokes the cloud push callback with the scrubbed payload', () => {
      rm.beginBattleInProgress('node_3');
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
