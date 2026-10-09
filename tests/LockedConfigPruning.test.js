// A node's battle map is locked the first time it is entered (RunManager.lockBattleConfig) and
// saved with the run. Once an act is won its route map is replaced, and every one of its
// locked maps is dead weight in every later save (docs/specs/large-maps/02-encounters-and-
// pacing.md §2.6): advanceAct drops them, and a save from before that loads without them.
//
// Ways this goes wrong:
//   - the finished act's maps stay in the save (the save grows ~1-2 KB a battle all run);
//   - a map still needed is dropped: one of the current act (a node entered and left by
//     Continue from Map, an event's fight still pending, the battle in progress), so the
//     node is generated afresh, or its deploy cap and Hunted check read nothing;
//   - a pruned save loads to a different run than an unpruned one;
//   - a save with no route map (damaged) loses its maps on a guess;
//   - the pruning meets the rest of load or of the act change (the blessing-boon migration
//     that runs last in fromJSON, the act-start grants and Pilgrim's Road in advanceAct) and a
//     suspended event fight or the first battle of the new act is regenerated or lost
//     ("pruning never regenerates a current battle", the last two describes).
import { describe, expect, it } from 'vitest';
import { RunManager, pruneLockedBattleConfigs } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { chooseEventOption, pendingEventBattle } from '../src/engine/EventCommands.js';
import { arriveAs, newRun } from './eventKit.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const BATTLE_TYPES = ['battle', 'boss', 'recruit'];

function withSeed(seed, fn) {
  const previous = Math.random;
  Math.random = createSeededRng(seed >>> 0);
  try {
    return fn();
  } finally {
    Math.random = previous;
  }
}

/** Generate and lock a node's map the way BattleScene does on entering it. */
function enter(run, node) {
  const params = run.getBattleParams(node);
  params.deployCount = 4;
  params.isBoss = node.type === 'boss';
  const config = withSeed(params.battleSeed ?? 1, () => generateBattle(params, gameData));
  run.lockBattleConfig(node.id, config);
  return config;
}

const leftmost = (nodes) =>
  [...nodes].sort((a, b) => a.col - b.col || String(a.id).localeCompare(String(b.id)))[0];

/** Win the current act along its leftmost road; `lock` enters every battle node first. */
function winAct(run, { lock = true } = {}) {
  for (let guard = 0; guard < 80 && !run.isActComplete(); guard++) {
    const node = leftmost(run.getAvailableNodes());
    if (BATTLE_TYPES.includes(node.type)) {
      if (lock) enter(run, node);
      run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 6, turnPar: 7 });
    } else run.markNodeComplete(node.id);
  }
  expect(run.isActComplete()).toBe(true);
}

const save = (run) => JSON.parse(JSON.stringify(run.toJSON()));
const reload = (run) => RunManager.fromJSON(save(run), gameData);

function startRun(seed = 42, difficultyId = 'normal') {
  const run = new RunManager(gameData);
  run.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return run;
}

describe('advanceAct prunes the finished act', () => {
  it("drops every map of the act just won (its boss's too), in the save the advance writes", () => {
    const run = startRun();
    winAct(run);
    const act1Ids = Object.keys(run.battleConfigsByNodeId);
    expect(act1Ids.length).toBeGreaterThan(3);
    expect(act1Ids).toContain(run.nodeMap.bossNodeId);
    expect(act1Ids.every((id) => id.startsWith('act1_'))).toBe(true);

    run.advanceAct();
    expect(run.currentAct).toBe('act2');
    expect(run.battleConfigsByNodeId).toEqual({});
    expect(save(run).battleConfigsByNodeId).toEqual({});
    // No node of the new map is locked, so it is generated on entry as before.
    expect(run.nodeMap.nodes.some((node) => node.encounterLocked)).toBe(false);
    expect(run.getLockedBattleConfig(run.getAvailableNodes()[0].id)).toBeNull();
  });

  it('the act just won leaves no byte behind: the save equals a run that never locked a map', () => {
    const run = startRun(7);
    winAct(run);
    const won = save(run);
    // The same run at the same moment, as if no node had been entered with a map locked.
    const locked = RunManager.fromJSON(structuredClone(won), gameData);
    const unlocked = structuredClone(won);
    unlocked.battleConfigsByNodeId = {};
    for (const node of unlocked.nodeMap.nodes) delete node.encounterLocked;
    const plain = RunManager.fromJSON(unlocked, gameData);
    const staleBytes = JSON.stringify(locked.battleConfigsByNodeId).length;
    expect(staleBytes).toBeGreaterThan(5000); // real maps, one to two KB a battle
    const size = (r) => JSON.stringify(r.toJSON()).length;
    // Before the advance the maps are the whole difference between the two saves...
    expect(size(locked) - size(plain)).toBeGreaterThanOrEqual(staleBytes - 2);

    locked.advanceAct();
    plain.advanceAct();
    // ...and after it there is none.
    expect(JSON.stringify(locked.toJSON())).toBe(JSON.stringify(plain.toJSON()));
  });

  it("never touches the current act's maps while it is being played", () => {
    const run = startRun(11);
    winAct(run);
    run.advanceAct();
    const locked = {};
    for (let guard = 0; guard < 6; guard++) {
      const node = leftmost(run.getAvailableNodes());
      if (BATTLE_TYPES.includes(node.type)) {
        locked[node.id] = structuredClone(enter(run, node));
        run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 6, turnPar: 7 });
      } else run.markNodeComplete(node.id);
    }
    expect(Object.keys(locked).length).toBeGreaterThan(1);
    expect(run.battleConfigsByNodeId).toEqual(locked);
    expect(reload(run).battleConfigsByNodeId).toEqual(locked);
  });

  it('the last act has no next map: its maps stay until the run ends', () => {
    const run = startRun(5);
    while (run.actIndex < run.actSequence.length - 1) {
      winAct(run, { lock: false });
      run.advanceAct();
    }
    const node = leftmost(run.nodeMap.nodes.filter((n) => BATTLE_TYPES.includes(n.type)));
    enter(run, node);
    const kept = structuredClone(run.battleConfigsByNodeId);
    run.advanceAct(); // a no-op on the last act
    expect(run.battleConfigsByNodeId).toEqual(kept);
  });
});

describe('a reload across the act transition', () => {
  it('resumes a locked node of the new act with the map it was locked with', () => {
    const run = startRun(23);
    winAct(run);
    const preAdvance = save(run);
    run.advanceAct();
    const loaded = reload(run);
    expect(loaded.currentAct).toBe('act2');
    expect(loaded.battleConfigsByNodeId).toEqual({});

    // The save from before the advance (the boss's victory) still reloads on Act I whole:
    // the advance replays from it, and the act it finishes still has its maps.
    const beforeAdvance = RunManager.fromJSON(structuredClone(preAdvance), gameData);
    expect(beforeAdvance.currentAct).toBe('act1');
    expect(beforeAdvance.battleConfigsByNodeId).toEqual(preAdvance.battleConfigsByNodeId);
    beforeAdvance.advanceAct();
    expect(beforeAdvance.nodeMap).toEqual(run.nodeMap);
    expect(beforeAdvance.battleConfigsByNodeId).toEqual({});

    // Enter an Act II node, leave it (Continue from Map), reload, enter again.
    const node = leftmost(loaded.getAvailableNodes().filter((n) => n.type === 'battle'));
    const config = enter(loaded, node);
    loaded.beginBattleInProgress(node.id, { battleParams: loaded.getBattleParams(node) });
    expect(loaded.revertBattleInProgressToEntry()).toBe(true);
    const again = reload(loaded);
    expect(again.nodeMap.nodes.find((n) => n.id === node.id).encounterLocked).toBe(true);
    expect(again.getLockedSpawnCount(node.id)).toBe(config.playerSpawns.length);
    expect(again.getLockedBattleConfig(node.id)).toEqual(loaded.getLockedBattleConfig(node.id));
  });
});

describe('a save from before the pruning (every act still in it)', () => {
  /**
   * An Act II run with a map entered and left, an event's fight pending on a locked map and a
   * battle suspended on a third, saved the old way: every Act I map still beside them.
   */
  function oldActTwoSave() {
    const run = newRun({ seed: 31 });
    winAct(run);
    const stale = structuredClone(run.battleConfigsByNodeId);
    run.advanceAct();

    const left = leftmost(run.getAvailableNodes().filter((n) => n.type === 'battle'));
    enter(run, left);

    const eventAt = run.nodeMap.nodes.find(
      (n) => n.type === 'battle' && n.row >= 2 && n.id !== left.id,
    );
    const eventNode = arriveAs(run, 'abandoned_armory', eventAt);
    expect(chooseEventOption(run, eventNode.id, 'door').ok).toBe(true);
    enter(run, eventNode);
    run.beginBattleInProgress(eventNode.id, { battleParams: run.getBattleParams(eventNode) });
    run.setBattleCheckpoint({ version: 2, checkpointIndex: 3 });

    const current = structuredClone(run.battleConfigsByNodeId);
    expect(Object.keys(current).sort()).toEqual([left.id, eventNode.id].sort());
    const resumeMap = run.getLockedBattleConfig(eventNode.id);
    const pruned = save(run);
    const old = structuredClone(pruned);
    old.battleConfigsByNodeId = { ...stale, ...current };
    return { pruned, old, stale, current, left, eventNode, resumeMap };
  }

  it("loads without the earlier acts' maps, keeping every map the current act needs", () => {
    const { old, current, left, eventNode, resumeMap } = oldActTwoSave();
    const loaded = RunManager.fromJSON(structuredClone(old), gameData);
    expect(loaded.battleConfigsByNodeId).toEqual(current);
    // The event's fight is still pending, suspended on its locked map, and resumes on it.
    expect(pendingEventBattle(loaded, eventNode.id)).not.toBeNull();
    expect(loaded.battleInProgress?.nodeId).toBe(eventNode.id);
    expect(resumeMap).not.toBeNull();
    expect(loaded.getLockedBattleConfig(eventNode.id)).toEqual(resumeMap);
    expect(loaded.getLockedSpawnCount(eventNode.id)).toBe(
      current[eventNode.id].playerSpawns.length,
    );
    expect(loaded.getLockedBattleConfig(left.id)).not.toBeNull();
    for (const id of [left.id, eventNode.id])
      expect(loaded.nodeMap.nodes.find((n) => n.id === id).encounterLocked).toBe(true);
  });

  it('loads to exactly the run a pruned save loads to, and writes it smaller', () => {
    const { pruned, old, stale } = oldActTwoSave();
    const fromOld = RunManager.fromJSON(structuredClone(old), gameData).toJSON();
    const fromPruned = RunManager.fromJSON(structuredClone(pruned), gameData).toJSON();
    expect(JSON.stringify(fromOld)).toBe(JSON.stringify(fromPruned));
    const staleBytes = JSON.stringify(stale).length;
    expect(JSON.stringify(old).length - JSON.stringify(fromOld).length).toBeGreaterThanOrEqual(
      staleBytes,
    );
  });
});

describe('pruneLockedBattleConfigs', () => {
  const map = { nodes: [{ id: 'act2_0_1' }, { id: 'act2_1_1' }] };
  const configs = { act1_0_1: { a: 1 }, act2_0_1: { b: 2 }, act2_1_1: { c: 3 } };

  it('keeps the maps of nodes on the route map and of the battle in progress', () => {
    expect(pruneLockedBattleConfigs(configs, map)).toEqual({
      act2_0_1: { b: 2 },
      act2_1_1: { c: 3 },
    });
    expect(pruneLockedBattleConfigs(configs, map, { keepNodeId: 'act1_0_1' })).toEqual(configs);
    expect(configs).toHaveProperty('act1_0_1'); // never mutates its input
  });

  it('keeps everything when there is no route map to judge by, and drops junk', () => {
    for (const nodeMap of [null, undefined, {}, { nodes: [] }, { nodes: 'x' }])
      expect(pruneLockedBattleConfigs(configs, nodeMap)).toBe(configs);
    for (const junk of [null, undefined, 5, 'x', [], true])
      expect(pruneLockedBattleConfigs(junk, map)).toEqual({});
  });
});

// --- pruning beside a suspended event fight, the boon migration and the act-start grants ---

/** A run in Act II holding Advance Pay and Pilgrim's Road, an event's fight suspended on a map. */
function suspendedEventRun(seed = 31) {
  const run = newRun({ seed });
  winAct(run);
  const stale = structuredClone(run.battleConfigsByNodeId);
  run.advanceAct();
  const eventAt = run.nodeMap.nodes.find((n) => n.type === 'battle' && n.row >= 2);
  const node = arriveAs(run, 'abandoned_armory', eventAt);
  expect(chooseEventOption(run, node.id, 'door').ok).toBe(true);
  enter(run, node);
  run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
  run.setBattleCheckpoint({ version: 2, checkpointIndex: 3 });
  return { run, node, stale };
}

/** JSON with object keys sorted: a load may reorder the keys of a record it normalizes. */
function canon(value) {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}

/**
 * What the suspended fight reads. The locked map and the battle params are compared as the
 * exact bytes (the map is regenerated if it is lost, the params are what it is regenerated
 * from); the records a load normalizes are compared as data.
 */
function suspendedFacts(run, nodeId) {
  const node = run.nodeMap.nodes.find((n) => n.id === nodeId);
  return {
    lockedBytes: JSON.stringify(run.getLockedBattleConfig(nodeId)),
    paramsBytes: JSON.stringify(run.getBattleParams(node)),
    data: Object.fromEntries(
      Object.entries({
        spawnCount: run.getLockedSpawnCount(nodeId),
        eventBattle: node.eventBattle,
        encounterLocked: node.encounterLocked,
        event: run.eventStateByNodeId[nodeId],
        pending: run.pendingEventNodeId,
        // (the load adds an empty `timeline` to the flag, whatever the pruning does)
        inProgress: run.battleInProgress && {
          nodeId: run.battleInProgress.nodeId,
          battleParams: run.battleInProgress.battleParams,
          entryBattleState: run.battleInProgress.entryBattleState,
          checkpoint: run.battleInProgress.checkpoint,
        },
      }).map(([key, value]) => [key, canon(value)]),
    ),
  };
}

describe('a suspended event fight is never regenerated by the pruning', () => {
  it('reads byte for byte the same after a save and a load, from a pruned and from an old save', () => {
    const { run, node, stale } = suspendedEventRun();
    expect(node.type).toBe('event');
    expect(node.eventBattle).toBeTruthy();
    expect(run.pendingEventNodeId).toBeNull(); // set by the victory, not the fight
    expect(run.battleInProgress?.nodeId).toBe(node.id);
    const before = suspendedFacts(run, node.id);
    const lockedBefore = JSON.stringify(run.getLockedBattleConfig(node.id));
    expect(lockedBefore).not.toBe('null');

    const pruned = save(run);
    const old = structuredClone(pruned);
    old.battleConfigsByNodeId = { ...stale, ...pruned.battleConfigsByNodeId };
    expect(Object.keys(old.battleConfigsByNodeId).length).toBeGreaterThan(
      Object.keys(pruned.battleConfigsByNodeId).length,
    );

    for (const source of [pruned, old]) {
      const loaded = RunManager.fromJSON(structuredClone(source), gameData);
      expect(suspendedFacts(loaded, node.id)).toEqual(before);
      // The persisted copy of the map is the very bytes locked on entry, and a second round
      // trip changes nothing (the prune is idempotent).
      const written = JSON.parse(JSON.stringify(loaded.toJSON()));
      expect(JSON.stringify(written.battleConfigsByNodeId[node.id])).toBe(lockedBefore);
      expect(Object.keys(written.battleConfigsByNodeId).sort()).toEqual(
        Object.keys(pruned.battleConfigsByNodeId).sort(),
      );
      expect(suspendedFacts(reload(loaded), node.id)).toEqual(before);
    }
  });

  it('keeps the map of a won event fight whose spoils are still owed (pendingEventNodeId)', () => {
    const { run, node, stale } = suspendedEventRun(34);
    const lockedBefore = JSON.stringify(run.getLockedBattleConfig(node.id));
    run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 6, turnPar: 7 });
    expect(run.pendingEventNodeId).toBe(node.id);
    expect(run.battleInProgress ?? null).toBeNull();
    const won = save(run);
    won.battleConfigsByNodeId = { ...stale, ...won.battleConfigsByNodeId };
    for (const source of [won, save(run)]) {
      const loaded = RunManager.fromJSON(structuredClone(source), gameData);
      expect(loaded.pendingEventNodeId).toBe(node.id);
      expect(JSON.stringify(loaded.battleConfigsByNodeId[node.id])).toBe(lockedBefore);
      expect(Object.keys(loaded.battleConfigsByNodeId).every((id) => !id.startsWith('act1_'))).toBe(
        true,
      );
    }
  });

  it('holds its map even when the route map no longer lists the node (the in-progress keep)', () => {
    const { run, node, stale } = suspendedEventRun(32);
    const lockedBefore = JSON.stringify(run.getLockedBattleConfig(node.id));
    const saved = save(run);
    saved.battleConfigsByNodeId = { ...stale, ...saved.battleConfigsByNodeId };
    // A route map written without the node the battle was fought on (a damaged write).
    saved.nodeMap.nodes = saved.nodeMap.nodes.filter((n) => n.id !== node.id);
    for (const n of saved.nodeMap.nodes) n.edges = (n.edges || []).filter((id) => id !== node.id);
    expect(saved.battleInProgress.nodeId).toBe(node.id);
    const loaded = RunManager.fromJSON(saved, gameData);
    expect(JSON.stringify(loaded.battleConfigsByNodeId[node.id])).toBe(lockedBefore);
    // ...and nothing else of the dead acts' maps rides along.
    expect(Object.keys(loaded.battleConfigsByNodeId)).not.toEqual(
      expect.arrayContaining(Object.keys(stale)),
    );
    expect(Object.keys(loaded.battleConfigsByNodeId).every((id) => !id.startsWith('act1_'))).toBe(
      true,
    );
  });

  it('loads an old save through the boon migration (which runs last) to the same pruned run', () => {
    const { run, node, stale } = suspendedEventRun(33);
    run.activeBlessings = [{ id: 'pilgrim_coin', rolledCost: null }];
    const current = save(run);
    const old = structuredClone(current);
    old.battleConfigsByNodeId = { ...stale, ...current.battleConfigsByNodeId };
    delete old.blessingBoonRevision; // a save from before the v3 boons: the migration runs
    const fromOld = RunManager.fromJSON(structuredClone(old), gameData);
    const fromCurrent = RunManager.fromJSON(structuredClone(current), gameData);
    expect(fromOld.blessingBoonRevision).toBeGreaterThan(0);
    expect(fromCurrent.blessingBoonRevision).toBe(fromOld.blessingBoonRevision);
    expect(suspendedFacts(fromOld, node.id)).toEqual(suspendedFacts(fromCurrent, node.id));
    expect(JSON.stringify(fromOld.battleConfigsByNodeId)).toBe(
      JSON.stringify(current.battleConfigsByNodeId),
    );
    // Written again it is stamped: nothing migrates twice, nothing resurrects a pruned map.
    const again = reload(fromOld);
    expect(again.blessingBoonRevision).toBe(fromOld.blessingBoonRevision);
    expect(JSON.stringify(again.battleConfigsByNodeId)).toBe(
      JSON.stringify(current.battleConfigsByNodeId),
    );
  });
});

describe('a boss victory, the act change and the next act first battle', () => {
  function blessedRun(seed) {
    const run = startRun(seed);
    run.activeBlessings = [
      { id: 'coin_of_fate', rolledCost: null }, // Advance Pay: gold at each act start
      { id: 'pilgrim_coin', rolledCost: null }, // Pilgrim's Road: a shop stamped on each map
    ];
    run._runStartBlessingsApplied = false;
    run.applyRunStartBlessingEffects();
    return run;
  }

  /** Play act 1 to the boss, lock the boss's map, win it. Returns the boss's map as locked. */
  function winThroughBoss(run, { lock = true } = {}) {
    for (let guard = 0; guard < 80; guard++) {
      const node = leftmost(run.getAvailableNodes());
      if (node.type === 'boss') break;
      if (BATTLE_TYPES.includes(node.type)) {
        if (lock) enter(run, node);
        run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 6, turnPar: 7 });
      } else run.markNodeComplete(node.id);
    }
    const boss = run.nodeMap.nodes.find((n) => n.id === run.nodeMap.bossNodeId);
    if (lock) enter(run, boss);
    const bossMap = lock ? JSON.stringify(run.getLockedBattleConfig(boss.id)) : null;
    run.completeBattle(run.getRoster(), boss.id, 0, { turnCount: 6, turnPar: 7 });
    expect(run.isActComplete()).toBe(true);
    return bossMap;
  }

  it('leaves no stale map, pays the act-start grant once, and locks the new act normally', () => {
    const run = blessedRun(77);
    const bossMap = winThroughBoss(run);
    // The victory's own save (the window before the act change): Act I's maps are still in it,
    // the boss's byte for byte, and the grant is unpaid.
    const atVictory = save(run);
    expect(JSON.stringify(atVictory.battleConfigsByNodeId[run.nodeMap.bossNodeId])).toBe(bossMap);
    expect(atVictory.battleInProgress ?? null).toBeNull();
    expect(atVictory.blessingRuntimeModifiers.actStartGrants[0].paidActs).not.toContain('act2');
    const goldBefore = run.gold;

    const result = run.advanceAct();
    expect(run.currentAct).toBe('act2');
    expect(result.actStartGrants).toHaveLength(1);
    expect(result.actStartGrants[0]).toMatchObject({ kind: 'gold' });
    expect(run.gold).toBe(goldBefore + result.actStartGrants[0].value);
    expect(run.blessingRuntimeModifiers.actStartGrants[0].paidActs).toContain('act2');
    expect(run.nodeMap.nodes.filter((n) => n.pilgrimShop)).toHaveLength(1);
    expect(run.battleConfigsByNodeId).toEqual({});
    expect(save(run).battleConfigsByNodeId).toEqual({});
    expect(run.nodeMap.nodes.some((n) => n.encounterLocked)).toBe(false);

    // The same change replayed from the victory save lands on the very same run.
    const replay = RunManager.fromJSON(structuredClone(atVictory), gameData);
    expect(replay.advanceAct().actStartGrants).toHaveLength(1);
    // (Everything the change writes. The save's blessing bookkeeping is normalized by the
    // load itself, whatever the pruning does, so it is not part of this comparison.)
    const replayed = JSON.parse(JSON.stringify(replay.toJSON()));
    const direct = JSON.parse(JSON.stringify(run.toJSON()));
    for (const key of [
      'actIndex',
      'gold',
      'nodeMap',
      'battleConfigsByNodeId',
      'shopStateByNodeId',
      'eventStateByNodeId',
      'eclipse',
      'blessingRuntimeModifiers',
      'currentNodeId',
    ])
      expect(JSON.stringify(replayed[key]), key).toBe(JSON.stringify(direct[key]));

    // A load after the change pays nothing again, stamps no second shop, restores no map.
    const loaded = reload(run);
    expect(loaded.gold).toBe(run.gold);
    expect(loaded.nodeMap.nodes.filter((n) => n.pilgrimShop)).toHaveLength(1);
    expect(loaded.battleConfigsByNodeId).toEqual({});

    // The first battle of the new act is generated as it would be on a run whose Act I maps
    // were never locked, and is then locked, saved and read back as the same bytes.
    const first = leftmost(run.getAvailableNodes().filter((n) => BATTLE_TYPES.includes(n.type)));
    const twin = blessedRun(77);
    winThroughBoss(twin, { lock: false });
    twin.advanceAct();
    const twinFirst = leftmost(
      twin.getAvailableNodes().filter((n) => BATTLE_TYPES.includes(n.type)),
    );
    expect(twinFirst.id).toBe(first.id);
    const config = enter(run, first);
    expect(JSON.stringify(config)).toBe(JSON.stringify(enter(twin, twinFirst)));
    expect(Object.keys(run.battleConfigsByNodeId)).toEqual([first.id]);

    run.beginBattleInProgress(first.id, { battleParams: run.getBattleParams(first) });
    run.setBattleCheckpoint({ version: 2, checkpointIndex: 1 });
    const lockedBytes = JSON.stringify(run.getLockedBattleConfig(first.id));
    const paramsBytes = JSON.stringify(run.getBattleParams(first));
    const resumed = reload(run);
    expect(resumed.battleInProgress?.nodeId).toBe(first.id);
    expect(JSON.stringify(resumed.getLockedBattleConfig(first.id))).toBe(lockedBytes);
    expect(JSON.stringify(resumed.getBattleParams(first))).toBe(paramsBytes);
    expect(resumed.nodeMap.nodes.find((n) => n.id === first.id).encounterLocked).toBe(true);
  });

  it('on the last act the victory changes nothing: no act change, no pruned map', () => {
    const run = startRun(5);
    while (run.actIndex < run.actSequence.length - 1) {
      winAct(run, { lock: false });
      run.advanceAct();
    }
    const node = leftmost(run.nodeMap.nodes.filter((n) => BATTLE_TYPES.includes(n.type)));
    enter(run, node);
    const before = JSON.stringify(run.battleConfigsByNodeId);
    expect(run.advanceAct().actStartGrants).toEqual([]);
    expect(JSON.stringify(run.battleConfigsByNodeId)).toBe(before);
    expect(JSON.stringify(reload(run).battleConfigsByNodeId)).toBe(before);
  });
});
