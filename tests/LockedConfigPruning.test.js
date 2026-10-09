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
//   - a save with no route map (damaged) loses its maps on a guess.
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
