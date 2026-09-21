import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendBattleTimeline,
  branchBattleTimeline,
  canRewindToEntry,
  createBattleTimeline,
  DEFAULT_TIMELINE_LIMITS,
  getEntryState,
  hydrateBattleTimeline,
} from '../src/engine/BattleTimeline.js';
import { serializedBytes } from '../src/engine/BattleStateSnapshot.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';

const json = (value) => JSON.parse(JSON.stringify(value));
function state(turn = 1, phase = 'player', extra = {}) {
  return {
    ...captureBattleState(
      {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        _battleRewindPolicy: 'fixed-v1',
        _battleRng: { getState: () => ({ algorithm: 'mulberry32-v1', cursor: 42 }) },
        turnManager: { currentPhase: phase, turnNumber: turn },
        grid: {
          mapLayout: [
            [0, 0],
            [0, 0],
          ],
          temporaryTerrains: [],
        },
      },
      { rngSeed: 42 },
    ),
    ...extra,
  };
}
function append(history, turn = 1, kind = 'player_action', options = {}) {
  const phase = kind === 'enemy_action' ? 'enemy' : 'player';
  return appendBattleTimeline(history, {
    kind,
    turnNumber: turn,
    phase,
    snapshot: state(turn, phase, { rewindPolicy: history.policy }),
    destination: ['player_action', 'turn_start'].includes(kind),
    facts: [{ type: 'wait', actor: { id: 'u1', name: 'Edric' } }],
    preview: { visibleUnits: [{ name: 'Edric', col: 0, row: 0 }] },
    ...options,
  });
}
afterEach(() => vi.restoreAllMocks());

describe('bounded battle timeline', () => {
  it('captures immutable facts, projections and canonical states without RNG', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('RNG read');
    });
    const initial = createBattleTimeline();
    const snapshot = state();
    const facts = [{ type: 'damage', amount: 5 }];
    const preview = { visibleUnits: [{ name: 'Before' }] };
    const result = append(initial, 1, 'turn_start', { snapshot, facts, preview });
    snapshot.goldEarned = 999;
    facts[0].amount = 99;
    preview.visibleUnits[0].name = 'After';
    expect(initial.entries).toEqual([]);
    expect(result.entries[0].facts[0].amount).toBe(5);
    expect(result.entries[0].preview.visibleUnits[0].name).toBe('Before');
    const restored = getEntryState(result, 1);
    restored.goldEarned = 5;
    expect(getEntryState(result, 1).goldEarned).toBe(0);
    expect(hydrateBattleTimeline(json(result))).toEqual(result);
  });

  it('keeps recovery/event entries separate from stable destinations', () => {
    let history = append(createBattleTimeline(), 1, 'turn_start');
    history = append(history, 1, 'recovery', {
      snapshot: state(1, 'player', { pendingActionCompletion: { unitId: 'u1' } }),
    });
    history = append(history, 1, 'enemy_action');
    expect(canRewindToEntry(history, 1)).toBe(true);
    expect(canRewindToEntry(history, 2, { allowPlayerActions: true })).toBe(false);
    expect(canRewindToEntry(history, 3, { allowPlayerActions: true })).toBe(false);
    expect(() =>
      append(history, 1, 'player_action', {
        snapshot: state(1, 'player', { pendingActionCompletion: {} }),
      }),
    ).toThrow('Unsettled');
    expect(() => append(history, 1, 'enemy_action', { destination: true })).toThrow('Unsettled');
    expect(() => append(history, 1, 'event', { destination: true })).toThrow('Unsettled');
    expect(() => append(history, 1, 'player_action', { snapshot: null })).toThrow('Unsettled');
  });

  it('enforces phase-one, difficulty and active-battle policy destination gates', () => {
    let history = append(createBattleTimeline(), 1, 'turn_start');
    history = append(history);
    expect(canRewindToEntry(history, 2)).toBe(false);
    for (const difficulty of ['normal', 'hard', 'Normal', 'Hard'])
      expect(canRewindToEntry(history, 2, { difficulty, allowPlayerActions: true })).toBe(true);
    expect(canRewindToEntry(history, 2, { difficulty: 'lunatic', allowPlayerActions: true })).toBe(
      false,
    );
    expect(canRewindToEntry(history, 1, { difficulty: 'lunatic' })).toBe(true);
    expect(canRewindToEntry(history, 1, { difficulty: 'unknown' })).toBe(false);
    const legacy = append(createBattleTimeline({ policy: 'legacy-v1' }), 1, 'turn_start');
    expect(canRewindToEntry(legacy, 1)).toBe(true);
    expect(() => append(legacy)).toThrow('Legacy');
    expect(() => append(legacy, 1, 'turn_start', { snapshot: state() })).toThrow(
      'Invalid timeline snapshot',
    );
  });

  it('truncates abandoned futures only in the detached branch and keeps IDs monotonic', () => {
    let history = append(createBattleTimeline(), 1, 'turn_start');
    history = append(history);
    history = append(history, 2, 'turn_start');
    const before = json(history);
    let branch = branchBattleTimeline(history, 2);
    expect(history).toEqual(before);
    expect(branch.revision).toBe(1);
    expect(branch.currentTurn).toBe(1);
    expect(branch.entries.map((e) => e.id)).toEqual([1, 2, 4]);
    expect(branch.snapshots.s3).toBeUndefined();
    expect(branch.entries.at(-1)).toMatchObject({
      kind: 'rewind',
      facts: [{ type: 'rewind', targetId: 2 }],
    });
    expect(getEntryState(branch, 2)).toEqual(getEntryState(history, 2));
    branch = append(branch);
    expect(branch.entries.at(-1).id).toBe(5);
    branch = branchBattleTimeline(branch, 1);
    expect(branch.entries.map((e) => e.id)).toEqual([1, 6]);
    expect(branch.revision).toBe(2);
    expect(hydrateBattleTimeline(json(branch))).toEqual(branch);
    expect(() => branchBattleTimeline(branch, 6)).toThrow('Unavailable');
  });

  it('retains the selected destination even if its rewind marker exceeds the row budget', () => {
    const history = append(createBattleTimeline({ limits: { maxEntries: 1 } }), 1, 'turn_start');
    const branch = branchBattleTimeline(history, 1);
    expect(branch.entries.map((e) => e.id)).toEqual([1]);
    expect(getEntryState(branch, 1)).not.toBeNull();
    expect(branch.nextEntryId).toBe(3);
    expect(hydrateBattleTimeline(json(branch))).toEqual(branch);
  });

  it.each([30, 100])(
    'retains current plus three turns after a %i-turn battle and JSON reload',
    (turns) => {
      let history = createBattleTimeline();
      for (let turn = 1; turn <= turns; turn++) {
        history = append(history, turn, 'turn_start');
        history = append(history, turn);
        history = append(history, turn, 'enemy_action');
      }
      expect(history.entries).toHaveLength(12);
      expect(history.entries[0].turnNumber).toBe(turns - 3);
      expect(Object.keys(history.snapshots)).toHaveLength(12);
      expect(history.earlierHistoryUnavailable).toBe(true);
      expect(hydrateBattleTimeline(json(history))).toEqual(history);
      expect(serializedBytes(history)).toBeLessThanOrEqual(DEFAULT_TIMELINE_LIMITS.maxBytes);
    },
  );

  it('bounds events independently of snapshots and removes orphaned references', () => {
    let history = createBattleTimeline({ limits: { maxEntries: 3 } });
    for (let i = 0; i < 8; i++) history = append(history);
    expect(history.entries.map((e) => e.id)).toEqual([6, 7, 8]);
    expect(Object.keys(history.snapshots)).toEqual(['s6', 's7', 's8']);
    expect(history.nextEntryId).toBe(9);
    expect(hydrateBattleTimeline(json(history))).toEqual(history);
  });

  it('evicts action snapshots before turn-start anchors under byte pressure', () => {
    let full = append(createBattleTimeline(), 1, 'turn_start');
    full = append(full);
    const limit = serializedBytes(full) - 100;
    const result = hydrateBattleTimeline(json(full), { limits: { maxBytes: limit } });
    expect(result.snapshots.s1).toBeDefined();
    expect(result.snapshots.s2).toBeUndefined();
    expect(result.entries[1]).toMatchObject({ snapshotId: null, destination: false });
    expect(canRewindToEntry(result, 2, { allowPlayerActions: true })).toBe(false);
    expect(serializedBytes(result)).toBeLessThanOrEqual(limit);
    expect(hydrateBattleTimeline(json(result))).toEqual(result);
  });

  it('never mutates required recovery when optional history is too large', () => {
    const recovery = state();
    const before = json(recovery);
    const result = append(createBattleTimeline({ limits: { maxBytes: 512 } }), 1, 'turn_start', {
      snapshot: recovery,
    });
    expect(recovery).toEqual(before);
    expect(result.earlierHistoryUnavailable).toBe(true);
    expect(serializedBytes(result)).toBeLessThanOrEqual(512);
    expect(getEntryState(result, 1)).toBeNull();
    expect(hydrateBattleTimeline(json(result))).toEqual(result);
  });

  it.each([
    [
      'injected entry recovery',
      (h) => {
        h.entries[0].battleInProgress = {};
      },
    ],
    [
      'injected limits field',
      (h) => {
        h.limits.surprise = true;
      },
    ],
    [
      'version',
      (h) => {
        h.version = 99;
      },
    ],
    [
      'policy',
      (h) => {
        h.policy = 'unknown';
      },
    ],
    [
      'missing snapshot',
      (h) => {
        delete h.snapshots.s1;
      },
    ],
    [
      'duplicate ID',
      (h) => {
        h.entries[1].id = 1;
      },
    ],
    [
      'shared reference',
      (h) => {
        h.entries[1].snapshotId = 's1';
      },
    ],
    [
      'orphan snapshot',
      (h) => {
        h.snapshots.s99 = state();
      },
    ],
    [
      'invalid canonical state',
      (h) => {
        h.snapshots.s1.mapLayout = [];
      },
    ],
    [
      'nested timeline',
      (h) => {
        h.snapshots.s1.timeline = {};
      },
    ],
    [
      'injected recovery envelope',
      (h) => {
        h.battleInProgress = {};
      },
    ],
    [
      'mixed policy',
      (h) => {
        h.snapshots.s1.rewindPolicy = 'legacy-v1';
      },
    ],
    [
      'continuation destination',
      (h) => {
        h.snapshots.s1.pendingActionCompletion = {};
      },
    ],
    [
      'future turn',
      (h) => {
        h.entries[0].turnNumber = 10;
      },
    ],
    [
      'future revision',
      (h) => {
        h.entries[0].revision = 99;
      },
    ],
    [
      'non-monotonic ID',
      (h) => {
        h.nextEntryId = 2;
      },
    ],
    [
      'unknown difficulty destination kind',
      (h) => {
        h.entries[0].kind = 'enemy_action';
      },
    ],
    [
      'oversized facts string',
      (h) => {
        h.entries[0].facts = ['a'.repeat(8193)];
      },
    ],
    [
      'cyclic facts',
      (h) => {
        h.entries[0].facts = [h];
      },
    ],
  ])('discards malformed optional history: %s', (_, mutate) => {
    const history = append(append(createBattleTimeline(), 1, 'turn_start'));
    mutate(history);
    expect(hydrateBattleTimeline(history)).toBeNull();
  });

  it.each([20, 40])(
    'bounds realistic %i-unit inventories while retaining recent anchors',
    (count) => {
      const units = Array.from({ length: count }, (_, index) => ({
        battleEntityId: `u${index + 1}`,
        name: `Fighter ${index}`,
        col: index % 20,
        row: Math.floor(index / 20),
        stats: { HP: 30, STR: 12, MAG: 4, SKL: 9, SPD: 10, DEF: 6, RES: 3, LCK: 7, MOV: 5 },
        currentHP: 25,
        equippedInventoryIndex: 0,
        inventory: Array.from({ length: 5 }, (_, i) => ({
          name: 'Iron Axe',
          uid: `${index}-${i}`,
          might: 8,
          hit: 85,
          weight: 8,
          crit: 0,
          range: [1, 1],
          weaponType: 'Axe',
        })),
        consumables: Array.from({ length: 3 }, (_, i) => ({
          name: 'Vulnerary',
          uid: `c${index}-${i}`,
          uses: 3,
        })),
      }));
      let history = createBattleTimeline();
      for (let turn = 1; turn <= 6; turn++) {
        for (let action = 0; action < 8; action++)
          history = append(history, turn, action ? 'player_action' : 'turn_start', {
            snapshot: state(turn, 'player', {
              playerUnits: units,
              nextEntityId: count + 1,
              mapLayout: Array.from({ length: 16 }, () => Array(20).fill(0)),
            }),
          });
      }
      expect(serializedBytes(history)).toBeLessThanOrEqual(DEFAULT_TIMELINE_LIMITS.maxBytes);
      expect(history.entries.some((entry) => entry.kind === 'turn_start' && entry.snapshotId)).toBe(
        true,
      );
      expect(hydrateBattleTimeline(json(history))).toEqual(history);
    },
  );

  it('rejects huge optional histories before canonical snapshot validation and allows tighter retention only', () => {
    const history = append(createBattleTimeline(), 1, 'turn_start');
    const oversized = json(history);
    oversized.entries[0].preview = { text: 'x'.repeat(600000) };
    expect(hydrateBattleTimeline(oversized)).toBeNull();
    const small = hydrateBattleTimeline(history, { limits: { previousTurns: 0, maxEntries: 1 } });
    expect(
      hydrateBattleTimeline(small, { limits: { previousTurns: 3, maxEntries: 500 } }).limits,
    ).toMatchObject({ previousTurns: 0, maxEntries: 1 });
  });
});
