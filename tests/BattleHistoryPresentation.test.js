import { describe, it, expect, vi } from 'vitest';
import {
  appendHistoryPresentation,
  historyFrameAt,
  applyHistoryDelta,
  hydrateHistoryPresentation,
  retainHistoryPresentation,
  branchHistoryPresentation,
  historyDisplayEntries,
} from '../src/engine/BattleHistoryPresentation.js';
import {
  captureHistoryFrame,
  observeHistoryAction,
  historyRecordInfo,
} from '../src/ui/BattleHistoryRecorder.js';
import { serializedBytes } from '../src/engine/BattleStateSnapshot.js';

function frame(hp = 20, col = 0) {
  return {
    version: 2,
    cols: 3,
    rows: 2,
    biome: 'forest',
    tiles: Array.from({ length: 6 }, (_, i) => ({
      col: i % 3,
      row: Math.floor(i / 3),
      label: 'Plain',
      known: true,
      fog: 'visible',
    })),
    units: [
      {
        id: 'u1',
        name: 'A',
        className: 'Lord',
        faction: 'player',
        spriteKey: 'edric',
        size: 1,
        col,
        row: 0,
        hp,
        maxHP: 20,
        conditions: [],
      },
    ],
    summary: [],
    enemiesActNext: false,
  };
}
function info(id, extra = {}) {
  return {
    entryId: id,
    anchorId: id,
    revision: 0,
    turnNumber: 1,
    phase: 'player',
    kind: 'player_action',
    facts: [],
    parents: {},
    beats: [],
    ...extra,
  };
}
describe('historical battlefield data', () => {
  it('finishes outstanding trade parents at End Turn but preserves a Canto recovery parent', () => {
    const presentation = appendHistoryPresentation(
      null,
      frame(),
      info(1, { kind: 'recovery', parents: { u1: 1 } }),
    );
    const endpoint = frame();
    endpoint.units[0].acted = true;
    const recovery = historyRecordInfo(
      { _historyActor: 'u1' },
      { presentation },
      { ...info(2), id: 2, kind: 'recovery' },
      endpoint,
    );
    expect(recovery.parents).toEqual({ u1: 1 });
    const endTurn = historyRecordInfo(
      {},
      { presentation },
      { ...info(2), id: 2 },
      { ...endpoint, enemiesActNext: true },
    );
    expect(endTurn.parents).toEqual({});
  });

  it('reconstructs sequential, reverse and random endpoints without RNG', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw Error('RNG');
    });
    try {
      let a;
      for (let i = 0; i < 70; i++)
        a = appendHistoryPresentation(a, frame(20 - (i % 20), i % 3), info(i + 1));
      expect(hydrateHistoryPresentation(JSON.parse(JSON.stringify(a)))).toEqual(a);
      for (const i of [69, 0, 32, 31, 2, 67])
        expect(historyFrameAt(a, i)).toEqual(frame(20 - (i % 20), i % 3));
      expect(applyHistoryDelta(historyFrameAt(a, 2), a.records[2].delta, true)).toEqual(
        frame(19, 1),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves interleaved edges and restores unfinished parents when branching', () => {
    let a = appendHistoryPresentation(null, frame(), info(1, { kind: 'turn_start' }));
    a = appendHistoryPresentation(
      a,
      frame(20, 1),
      info(2, { kind: 'recovery', parentId: 2, parents: { u1: 2 } }),
    );
    a = appendHistoryPresentation(a, frame(15, 1), info(3, { parentId: 3, parents: { u1: 2 } }));
    a = appendHistoryPresentation(a, frame(10, 1), info(4, { parentId: 2 }));
    expect(applyHistoryDelta(historyFrameAt(a, 3), a.records[3].delta, true)).toEqual(frame(15, 1));
    const branch = branchHistoryPresentation(a, 3);
    expect(branch.records.at(-1).parents).toEqual({ u1: 2 });
    expect(branch.nextId).toBe(a.nextId);
    expect(historyFrameAt(branch, 2)).toEqual(frame(15, 1));
    expect(a.records).toHaveLength(4);
  });

  it('detaches an earlier continuation row from a reused canonical destination', () => {
    let a = appendHistoryPresentation(null, frame(), info(1));
    a = appendHistoryPresentation(a, frame(15), info(2, { kind: 'recovery' }));
    a = appendHistoryPresentation(a, frame(15, 1), info(2));
    const rows = historyDisplayEntries({
      presentation: a,
      entries: [
        { id: 1, revision: 0, turnNumber: 1 },
        { id: 2, revision: 0, turnNumber: 1, destination: true, snapshotId: 's2' },
      ],
    });
    expect(rows.map((r) => r.preview.units[0].col)).toEqual([0, 0, 1]);
    expect(rows.filter((r) => r.destination)).toHaveLength(1);
    expect(rows[1].id).toBe('history-2');
  });

  it('rebases retained frames and remains valid when the first keyframe is pruned', () => {
    let a;
    for (let i = 0; i < 20; i++)
      a = appendHistoryPresentation(a, frame(20 - i, i % 3), info(i + 1));
    const retained = retainHistoryPresentation(a, 2200);
    expect(serializedBytes(retained)).toBeLessThanOrEqual(2200);
    expect(retained.earlierUnavailable).toBe(true);
    expect(retained.records[0].frame).toBeTruthy();
    expect(hydrateHistoryPresentation(retained)).toEqual(retained);
    expect(historyFrameAt(retained, retained.records.length - 1)).toEqual(frame(1, 1));
  });

  it('rejects malformed deltas and frames independently', () => {
    let a = appendHistoryPresentation(null, frame(), info(1));
    a = appendHistoryPresentation(a, frame(12), info(2));
    a.records[1].delta.patches[0][2] = 999;
    expect(hydrateHistoryPresentation(a)).toBeNull();
    const b = appendHistoryPresentation(null, frame(), info(1));
    b.records[0].frame.units[0].col = 999;
    expect(hydrateHistoryPresentation(b)).toBeNull();
  });

  it('does not substitute hidden terrain after observation history is lost', () => {
    const state = {
      mapLayout: [[0, 1]],
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      fog: { visible: ['0,0'], everSeen: ['0,0', '1,0'] },
      phase: 'player',
      turnNumber: 1,
    };
    const scene = { gameData: { terrain: [{ name: 'Plain' }, { name: 'Ruins' }] } };
    const f = captureHistoryFrame(scene, state, null);
    expect(f.tiles[1]).toMatchObject({ label: 'Unknown', known: false, fog: 'explored' });
    state.fog.visible.push('1,0');
    const observed = captureHistoryFrame(scene, state, null);
    const archive = appendHistoryPresentation(null, observed, info(1));
    state.fog.visible.pop();
    state.mapLayout[0][1] = 0;
    expect(captureHistoryFrame(scene, state, archive).tiles[1].label).toBe('Ruins');
    expect(captureHistoryFrame(scene, state, null).tiles[1].label).toBe('Unknown');
  });

  it('filters hidden actors from structured facts, IDs and parent metadata', () => {
    const hidden = {
      battleEntityId: 'u9',
      name: 'Secret General',
      faction: 'enemy',
      col: 2,
      row: 1,
    };
    const ally = { battleEntityId: 'u1', name: 'A', faction: 'player', col: 0, row: 0 };
    const scene = {
      runManager: { battleInProgress: {} },
      grid: { fogEnabled: true, isVisible: () => false },
    };
    observeHistoryAction(scene, 'hit', hidden, ally, '5 damage');
    const r = historyRecordInfo(
      scene,
      {},
      { id: 1, revision: 0, kind: 'enemy_action', turnNumber: 1, phase: 'enemy', facts: [] },
      frame(),
    );
    expect(JSON.stringify(r)).not.toMatch(/Secret General|u9/);
    expect(r.beats[0].label).toContain('Unseen enemy hit A');
  });
});

describe('history hardening and retention', () => {
  it('remains reconstructible after repeatedly pruning a long single turn', () => {
    let archive;
    for (let i = 0; i < 140; i++) {
      archive = appendHistoryPresentation(archive, frame(20 - (i % 20), i % 3), info(i + 1));
      archive = retainHistoryPresentation(archive, 14500);
      expect(hydrateHistoryPresentation(archive)).toEqual(archive);
    }
    expect(archive.earlierUnavailable).toBe(true);
    expect(historyFrameAt(archive, archive.records.length - 1)).toEqual(frame(1, 1));
  });

  it('drops malformed optional history while preserving legacy destinations and cursor', async () => {
    const { createBattleTimeline, hydrateBattleTimeline, BATTLE_TIMELINE_VERSION } =
      await import('../src/engine/BattleTimeline.js');
    const timeline = createBattleTimeline();
    timeline.presentation = appendHistoryPresentation(null, frame(), info(1));
    timeline.presentation.records[0].frame.secret = 'unsupported payload';
    timeline.presentationNextId = 93;
    const recovered = hydrateBattleTimeline(timeline);
    expect(recovered.presentation).toBeNull();
    expect(recovered.presentationNextId).toBe(93);
    expect(recovered.entries).toEqual(timeline.entries);
    const legacy = { ...timeline, version: 1 };
    delete legacy.presentation;
    delete legacy.presentationNextId;
    expect(hydrateBattleTimeline(legacy).version).toBe(BATTLE_TIMELINE_VERSION);
  });

  it('quota fallback sheds art before core history and keeps identity monotonic', async () => {
    const { createBattleTimeline } = await import('../src/engine/BattleTimeline.js');
    const { persistWithTimelineFallback } =
      await import('../src/engine/BattleTimelinePersistence.js');
    const timeline = createBattleTimeline();
    timeline.presentation = appendHistoryPresentation(null, frame(), info(1));
    timeline.nextEntryId = 40;
    timeline.revision = 3;
    const candidate = {
      visionChargesRemaining: 2,
      battleInProgress: { rewindPolicy: 'fixed-v1', timeline, checkpoint: { exact: 'recovery' } },
    };
    const write = vi.fn((value) => ({
      ok: !value.battleInProgress.timeline.presentation,
      reason: 'quota',
    }));
    const result = persistWithTimelineFallback(candidate, write);
    expect(result.ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(result.candidate.battleInProgress.timeline.presentationNextId).toBe(2);
    expect(result.candidate.battleInProgress.timeline.nextEntryId).toBe(40);
    expect(result.candidate.battleInProgress.checkpoint).toEqual({ exact: 'recovery' });
    expect(candidate.battleInProgress.timeline.presentation).not.toBeNull();
  });
});

describe('continuity and filtered actions', () => {
  it('groups only contiguous fragments, never across another actor or a destination', async () => {
    const { groupHistoryEntries } = await import('../src/engine/BattleHistoryPresentation.js');
    const a = {
      id: 1,
      kind: 'recovery',
      actorId: 'u1',
      parentId: 1,
      revision: 0,
      beats: [{ type: 'moved' }],
      facts: ['A traded'],
    };
    const b = {
      id: 2,
      kind: 'player_action',
      actorId: 'u2',
      parentId: 2,
      revision: 0,
      beats: [],
      facts: ['B attacked'],
      destination: true,
    };
    const c = {
      id: 3,
      kind: 'player_action',
      actorId: 'u1',
      parentId: 1,
      revision: 0,
      beats: [{ type: 'hit' }],
      facts: ['A attacked'],
    };
    expect(groupHistoryEntries([a, b, c])).toHaveLength(3);
    const grouped = groupHistoryEntries([a, c]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe(3);
    expect(grouped[0].beats.map((b) => b.type)).toEqual(['moved', 'hit']);
    expect(groupHistoryEntries([{ ...a, destination: true }, c])).toHaveLength(2);
  });

  it('rejects an optional frame linked to a different canonical endpoint', async () => {
    const archive = appendHistoryPresentation(null, frame(), info(1));
    const entry = { ...info(1), id: 1, preview: { ...frame(), units: [{ id: 'u1', hp: 1 }] } };
    expect(hydrateHistoryPresentation(archive, [entry])).toBeNull();
    entry.preview.units = [{ id: 'u1', hp: 20 }];
    expect(hydrateHistoryPresentation(archive, [entry])).toEqual(archive);
  });

  it('canceled staged paths leave no committed route and hidden path coordinates are omitted', async () => {
    const { rememberHistoryPath, discardHistoryPath, commitHistoryPath } =
      await import('../src/ui/BattleHistoryRecorder.js');
    const scene = {
      runManager: { battleInProgress: {} },
      grid: { fogEnabled: true, isVisible: (col) => col === 0 },
    };
    const unit = { battleEntityId: 'u1', name: 'Ally', faction: 'player', col: 0, row: 0 };
    rememberHistoryPath(scene, unit, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    discardHistoryPath(scene, unit);
    commitHistoryPath(scene, unit);
    expect(scene._historyBeats || []).toEqual([]);
    const enemy = { ...unit, battleEntityId: 'u2', name: 'Enemy', faction: 'enemy' };
    rememberHistoryPath(
      scene,
      enemy,
      [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ],
      false,
    );
    expect(scene._historyBeats[0].path).toEqual([{ col: 0, row: 0 }, null, null]);
  });
});
