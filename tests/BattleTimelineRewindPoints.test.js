import { describe, expect, it, vi } from 'vitest';
import {
  appendBattleTimeline,
  branchBattleTimeline,
  canRewindToEntry,
  createBattleTimeline,
  DEFAULT_TIMELINE_LIMITS,
  describeEntrySnapshot,
  getEntryState,
  hydrateBattleTimeline,
  trimBattleTimelineToCurrentTurn,
} from '../src/engine/BattleTimeline.js';
import { persistWithTimelineFallback } from '../src/engine/BattleTimelinePersistence.js';
import { serializedBytes } from '../src/engine/BattleStateSnapshot.js';
import { packPreviewTiles, previewTiles } from '../src/engine/BattleTimelineFacts.js';
import { jsonEqual, toJsonValue } from '../src/engine/BattleStateDelta.js';
import { loadGameData } from './testData.js';
import { createRewindBattleSim } from './helpers/rewindBattleSim.js';

// Each scripted turn records ~20 rows with real late-game states; give CI room.
vi.setConfig({ testTimeout: 60000 });
const json = (value) => JSON.parse(JSON.stringify(value));
const data = loadGameData();

/**
 * Plays `turns` scripted turns (every player unit acts, every enemy acts) and
 * records exactly what the production recorder records. Returns the history
 * and the true state behind every destination, for exact comparisons.
 */
function playBattle({ turns = 4, limits, sim: options = {}, policy = 'fixed-v1' } = {}) {
  const sim = createRewindBattleSim(data, { policy, ...options });
  let history = createBattleTimeline({ policy, limits });
  const truth = new Map();
  const record = (kind, destination) => {
    const state = sim.state();
    history = appendBattleTimeline(history, {
      kind,
      turnNumber: state.turnNumber,
      phase: state.phase,
      facts: [kind],
      preview: packPreviewTiles(sim.preview(state)),
      snapshot: destination ? state : null,
      destination,
    });
    if (destination) truth.set(history.entries.at(-1).id, toJsonValue(state));
  };
  for (let turn = 1; turn <= turns; turn++) {
    sim.beginPlayerPhase(turn);
    record('turn_start', true);
    for (const unit of [...sim.scene.playerUnits]) {
      sim.playerAct(unit);
      record('player_action', true);
    }
    sim.beginEnemyPhase();
    for (const enemy of [...sim.scene.enemyUnits]) {
      sim.enemyAct(enemy);
      record('enemy_action', false);
    }
  }
  return { history, truth, sim };
}

function expectExact(history, truth) {
  for (const entry of history.entries.filter((e) => e.destination))
    expect(jsonEqual(getEntryState(history, entry.id), truth.get(entry.id))).toBe(true);
}

describe('rewind points: storage', () => {
  it('stores later points as patches and restores every one of them exactly, across reload', () => {
    const { history, truth } = playBattle({ turns: 2 });
    const forms = history.entries
      .filter((e) => e.destination)
      .map((e) => describeEntrySnapshot(history, e.id).form);
    expect(forms[0]).toBe('full');
    expect(forms.filter((f) => f === 'patch').length).toBeGreaterThan(forms.length - 3);
    expectExact(history, truth);
    const reloaded = hydrateBattleTimeline(json(history));
    expect(reloaded).toEqual(history);
    expectExact(reloaded, truth);
    // A patch is far smaller than the state it restores.
    const patch = history.entries.find(
      (e) => describeEntrySnapshot(history, e.id)?.form === 'patch',
    );
    expect(describeEntrySnapshot(history, patch.id).bytes).toBeLessThan(
      serializedBytes(truth.get(patch.id)) / 5,
    );
  });

  it('keeps every action of the current and three previous turns of a late-game battle in budget', () => {
    const { history, truth } = playBattle({ turns: 7 });
    expect(serializedBytes(history)).toBeLessThanOrEqual(DEFAULT_TIMELINE_LIMITS.maxBytes);
    const destinations = history.entries.filter((e) => e.destination);
    for (let turn = 4; turn <= 7; turn++) {
      // turn start + six player actions per turn
      expect(destinations.filter((e) => e.turnNumber === turn)).toHaveLength(7);
    }
    expect(history.entries.some((e) => e.turnNumber < 4)).toBe(false);
    expectExact(history, truth);
    expect(hydrateBattleTimeline(json(history))).toEqual(history);
  });

  it('re-bases patches when their full state leaves the retention window', () => {
    const { history, truth } = playBattle({ turns: 5, limits: { previousTurns: 1 } });
    const first = history.entries.find((e) => e.destination);
    expect(first.turnNumber).toBe(4);
    expect(describeEntrySnapshot(history, first.id).form).toBe('full');
    expectExact(history, truth);
    expect(Object.values(history.snapshots).every((s) => !s.base || history.snapshots[s.base]));
  });

  it('branches to a patched point, keeps its base, and continues recording patches', () => {
    const { history, truth, sim } = playBattle({ turns: 2 });
    const target = history.entries.filter(
      (e) => e.kind === 'player_action' && e.turnNumber === 2,
    )[2];
    expect(describeEntrySnapshot(history, target.id).form).toBe('patch');
    let branch = branchBattleTimeline(history, target.id);
    expect(jsonEqual(getEntryState(branch, target.id), truth.get(target.id))).toBe(true);
    expect(branch.entries.at(-1)).toMatchObject({ kind: 'rewind' });
    expect(branch.entries.filter((e) => e.id > target.id && e.kind !== 'rewind')).toEqual([]);
    const state = sim.state();
    branch = appendBattleTimeline(branch, {
      kind: 'player_action',
      turnNumber: 2,
      phase: 'player',
      facts: [],
      preview: null,
      snapshot: { ...state, phase: 'player', turnNumber: 2 },
      destination: true,
    });
    expect(describeEntrySnapshot(branch, branch.entries.at(-1).id).form).toBe('patch');
    expect(hydrateBattleTimeline(json(branch))).toEqual(branch);
  });

  it('trims to the current turn for storage pressure without touching limits', () => {
    const { history, truth } = playBattle({ turns: 3 });
    const trimmed = trimBattleTimelineToCurrentTurn(history);
    expect(new Set(trimmed.entries.map((e) => e.turnNumber))).toEqual(new Set([3]));
    expect(trimmed.limits).toEqual(history.limits);
    expect(trimmed.earlierHistoryUnavailable).toBe(true);
    expectExact(trimmed, truth);
    expect(hydrateBattleTimeline(json(trimmed))).toEqual(trimmed);
  });
});

describe('rewind points: byte pressure', () => {
  it('sheds review previews, then earlier turns, before this turn’s points', () => {
    const { history } = playBattle({ turns: 3 });
    const bytes = serializedBytes(history);
    const tight = hydrateBattleTimeline(json(history), {
      limits: { maxBytes: Math.floor(bytes * 0.55) },
    });
    expect(serializedBytes(tight)).toBeLessThanOrEqual(Math.floor(bytes * 0.55));
    const current = tight.entries.filter((e) => e.turnNumber === 3 && e.phase === 'player');
    expect(current.every((e) => e.destination)).toBe(true);
    // Review-only rows lose their board previews first; points keep theirs.
    expect(tight.entries.filter((e) => e.destination).every((e) => e.preview)).toBe(true);
    expect(tight.entries.some((e) => !e.destination && e.preview === null)).toBe(true);
  });

  it('under heavy pressure keeps turn starts over earlier actions and this turn over all', () => {
    const { history, truth } = playBattle({ turns: 3 });
    const destinationsOnly = (h) =>
      h.entries.filter((e) => e.destination).map((e) => `${e.turnNumber}${e.kind[0]}`);
    // Budget for roughly: every review row stripped, this turn plus a few more points.
    let limit = 140 * 1024;
    let tight = hydrateBattleTimeline(json(history), { limits: { maxBytes: limit } });
    while (tight.entries.filter((e) => e.destination && e.turnNumber < 3).length > 2) {
      limit -= 4096;
      tight = hydrateBattleTimeline(json(history), { limits: { maxBytes: limit } });
    }
    const kept = destinationsOnly(tight);
    const earlier = kept.filter((k) => !k.startsWith('3'));
    // Earlier survivors are turn starts: their actions went first.
    expect(earlier.every((k) => k.endsWith('t'))).toBe(true);
    expect(kept.filter((k) => k.startsWith('3'))).toHaveLength(7);
    expectExact(tight, truth);
  });
});

describe('rewind points: hydration rejects unsafe patches', () => {
  const base = () =>
    json(playBattle({ turns: 1, sim: { players: 2, enemies: 2, reserves: 0 } }).history);
  const patchId = (h) => Object.keys(h.snapshots).find((id) => h.snapshots[id].base);
  it.each([
    ['missing base', (h) => (h.snapshots[patchId(h)].base = 's999')],
    [
      'patch as base',
      (h) => {
        const ids = Object.keys(h.snapshots).filter((id) => h.snapshots[id].base);
        h.snapshots[ids[1]].base = ids[0];
      },
    ],
    ['later base', (h) => (h.snapshots.s1 = { base: patchId(h), patch: null })],
    ['malformed node', (h) => (h.snapshots[patchId(h)].patch = { q: 1 })],
    [
      'prototype key',
      (h) => (h.snapshots[patchId(h)].patch = JSON.parse('{"o":{"__proto__":{"$":1}}}')),
    ],
    [
      'state that fails validation',
      (h) => (h.snapshots[patchId(h)].patch = { o: { mapLayout: { $: [] } } }),
    ],
    ['patch in an older version', (h) => (h.version = 2)],
    ['wrong turn', (h) => (h.snapshots[patchId(h)].patch = { o: { turnNumber: { $: 9 } } })],
  ])('%s', (_, mutate) => {
    const history = base();
    expect(hydrateBattleTimeline(history)).not.toBeNull();
    mutate(history);
    expect(hydrateBattleTimeline(history)).toBeNull();
  });
});

describe('rewind points: rules', () => {
  it('legacy battles record and allow action points (with their reroll rule)', () => {
    const { history, truth } = playBattle({ turns: 1, policy: 'legacy-v1' });
    const action = history.entries.find((e) => e.kind === 'player_action');
    expect(canRewindToEntry(history, action.id, { allowPlayerActions: true })).toBe(true);
    expectExact(history, truth);
  });

  it('packs preview terrain losslessly', () => {
    const sim = createRewindBattleSim(data, { players: 1, enemies: 1, reserves: 0 });
    const preview = sim.preview(sim.state());
    const packed = packPreviewTiles(preview);
    expect(packed.tiles).toBeUndefined();
    expect(previewTiles(packed)).toEqual(preview.tiles);
    expect(serializedBytes(packed.terrain)).toBeLessThan(serializedBytes(preview.tiles) / 10);
    // Irregular tile lists are left alone.
    const odd = { ...preview, tiles: preview.tiles.slice(1) };
    expect(packPreviewTiles(odd)).toBe(odd);
    expect(previewTiles(null)).toEqual([]);
    expect(previewTiles({ cols: 2, terrain: { labels: ['A'], cells: 'AZ' } })).toEqual([]);
  });

  it('quota fallback keeps this turn’s points before wiping history', () => {
    const { history } = playBattle({ turns: 2 });
    const candidate = {
      battleInProgress: {
        rewindPolicy: 'fixed-v1',
        timeline: history,
        timelineCurrentEntryId: history.entries.at(-1).id,
      },
    };
    const write = vi.fn((value) =>
      value.battleInProgress.timeline.entries.some((e) => e.turnNumber < 2)
        ? { ok: false, reason: 'quota' }
        : { ok: true },
    );
    const result = persistWithTimelineFallback(candidate, write);
    expect(result.ok).toBe(true);
    const kept = result.candidate.battleInProgress.timeline;
    expect(kept.entries.length).toBeGreaterThan(0);
    expect(kept.entries.every((e) => e.turnNumber === 2)).toBe(true);
    expect(result.candidate.battleInProgress.timelineCurrentEntryId).toBe(
      history.entries.at(-1).id,
    );
    // Still over quota: the whole optional history goes, identities stay monotonic.
    const wipe = persistWithTimelineFallback(candidate, (value) =>
      value.battleInProgress.timeline.entries.length
        ? { ok: false, reason: 'quota' }
        : { ok: true },
    );
    expect(wipe.ok).toBe(true);
    expect(wipe.candidate.battleInProgress.timeline.entries).toEqual([]);
    expect(wipe.candidate.battleInProgress.timeline.nextEntryId).toBe(history.nextEntryId);
  });
});
