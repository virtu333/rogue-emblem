// Battles that an event starts (docs/specs/event-nodes.md §4 "Battles from an event").
//
// Ways this goes wrong:
//   - the node stops being an event (a church-style type flip), so the route map, the Eclipse
//     or the save forgets the choice;
//   - building the fight consumes or shifts the run's Math.random stream, or is not the same
//     fight after a refresh;
//   - the event battle pays no gold (the 0 multiplier trap), or the wrong amount;
//   - after-victory effects apply twice (a refresh, a double call), never (a lost marker), or are
//     lost to a bag that filled during the loot screen;
//   - Continue from Map / a revert loses the choice or lets it change;
//   - the current event node falls to the Eclipse while its fight is pending;
//   - the player can leave with the fight unwon.
// Gold is derived by hand: killGold 100 on an event node: floor((floor(100 x 1.0) + 80) x 1.3) = 234.
import { describe, expect, it } from 'vitest';
import {
  chooseEventOption,
  completeEventBattle,
  eventState,
  eventView,
  getPendingEventSettlement,
  leaveEvent,
  pendingEventBattle,
} from '../src/engine/EventCommands.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { nodeFallThreshold } from '../src/engine/EclipseSystem.js';
import { arriveAs, eventNode, makeEvent, newRun } from './eventKit.js';

const KILL_GOLD = 100;
const EXPECTED_BATTLE_GOLD = 234;

/** A run standing at an armory node that chose "Force the barred door". */
function doorRun(options = {}) {
  const run = newRun(options);
  const node = arriveAs(run, 'abandoned_armory');
  const chosen = chooseEventOption(run, node.id, 'door');
  expect(chosen.ok, chosen.reason).toBe(true);
  return { run, node, chosen };
}

function win(run, node, { gold = KILL_GOLD } = {}) {
  return run.completeBattle(run.getRoster(), node.id, gold, { turnCount: 5, turnPar: 5 });
}

const reload = (run) => RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

describe('choosing a fight', () => {
  it('builds rout battle params on the node and keeps it an event node', () => {
    const { run, node, chosen } = doorRun();
    expect(chosen.battle).toBe(true);
    expect(node.type).toBe('event');
    expect(node.eventBattle).toBe(true);
    expect(node.battleParams).toMatchObject({
      act: 'act1',
      objective: 'rout',
      row: node.row,
      isEventBattle: true,
      eventEnemyLevelBonus: 0,
    });
    // act1's level curve: row 2 [1,3], later rows [2,3]
    expect(node.battleParams.levelRange).toEqual(node.row === 2 ? [1, 3] : [2, 3]);
    expect(Number.isFinite(node.battleParams.battleSeed)).toBe(true);
    expect(node.templateId).toBeTruthy();
    expect(run.getBattleParams(node)).toMatchObject({ objective: 'rout', isEventBattle: true });
  });

  it('records the fight as pending and the node stays the only node to enter', () => {
    const { run, node } = doorRun();
    expect(eventState(run, node.id)).toMatchObject({ battle: 'pending', choiceId: 'door' });
    expect(pendingEventBattle(run, node.id)).toMatchObject({
      nodeId: node.id,
      eventId: 'abandoned_armory',
      choiceId: 'door',
      text: 'Someone was still home.',
    });
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([node.id]);
    expect(eventView(run, node.id)).toMatchObject({
      phase: 'outcome',
      canFight: true,
      canLeave: false,
    });
  });

  it('the same run seed, node and choice build the same fight (a refresh rebuilds it)', () => {
    const a = doorRun({ seed: 2024 });
    const b = doorRun({ seed: 2024 });
    expect(b.node.id).toBe(a.node.id);
    expect(b.node.battleParams).toEqual(a.node.battleParams);
    expect(b.node.fogEnabled).toBe(a.node.fogEnabled);
    expect(b.node.templateId).toBe(a.node.templateId);
    const loaded = reload(a.run);
    expect(loaded.nodeMap.nodes.find((n) => n.id === a.node.id).battleParams).toEqual(
      a.node.battleParams,
    );
  });

  it('a different seed builds a different fight', () => {
    const seeds = new Set();
    for (let seed = 1; seed <= 12; seed++)
      seeds.add(doorRun({ seed }).node.battleParams.battleSeed);
    expect(seeds.size).toBeGreaterThan(8);
  });

  it("does not consume or shift the run's Math.random stream", () => {
    const original = Math.random;
    try {
      const draws = (withEvent) => {
        const run = newRun({ seed: 99 });
        const node = arriveAs(run, 'abandoned_armory');
        Math.random = createSeededRng(5);
        if (withEvent) expect(chooseEventOption(run, node.id, 'door').ok).toBe(true);
        return [Math.random(), Math.random(), Math.random()];
      };
      expect(draws(true)).toEqual(draws(false));
    } finally {
      Math.random = original;
    }
  });

  it("carries the effect's enemy levels into the battle params (Rob the cart: +1)", () => {
    const run = newRun();
    const node = arriveAs(run, 'moneylender');
    expect(chooseEventOption(run, node.id, 'rob').ok).toBe(true);
    expect(node.battleParams.eventEnemyLevelBonus).toBe(1);
    // First Light adds no enemy levels of its own, Pale no phase bonus: exactly the event's +1.
    expect(run.getBattleParams(node).enemyLevelBonus).toBe(1);
    const plain = doorRun();
    expect(plain.run.getBattleParams(plain.node).enemyLevelBonus).toBe(0);
    // On Nightfall (+1 from the rung) the event's +1 comes on top.
    const hard = newRun({ difficulty: 'hard' });
    const hardNode = arriveAs(hard, 'moneylender');
    chooseEventOption(hard, hardNode.id, 'rob');
    expect(hard.getBattleParams(hardNode).enemyLevelBonus).toBe(2);
  });

  it('an encounter lock works for the event node like any battle', () => {
    const { run, node } = doorRun();
    run.lockBattleConfig(node.id, { cols: 8, rows: 8, playerSpawns: [{ col: 0, row: 0 }] });
    expect(node.encounterLocked).toBe(true);
    expect(run.getLockedSpawnCount(node.id)).toBe(1);
    const loaded = reload(run);
    const again = loaded.nodeMap.nodes.find((n) => n.id === node.id);
    expect(again.encounterLocked).toBe(true);
    expect(again.type).toBe('event');
    expect(pendingEventBattle(loaded, node.id)).not.toBeNull();
  });

  it('is saved before launch: a reload reopens the outcome page with only Fight', () => {
    const { run, node } = doorRun();
    const loaded = reload(run);
    expect(pendingEventBattle(loaded, node.id)).not.toBeNull();
    expect(eventView(loaded, node.id)).toMatchObject({
      phase: 'outcome',
      canFight: true,
      canLeave: false,
    });
    expect(chooseEventOption(loaded, node.id, 'racks')).toEqual({
      ok: false,
      reason: 'You have already chosen.',
    });
  });
});

describe('the Eclipse and the fight', () => {
  it('the current event node never falls, an unvisited one becomes a Swallowed road', () => {
    const { run, node } = doorRun();
    // The Phase 1 fall: with no dark face to offer, the dark takes the road for a battle.
    // (With one it stays an Omen: tests/EventDarkOmen.test.js.)
    const catalog = run.gameData.events;
    run.gameData = {
      ...run.gameData,
      events: { ...catalog, events: catalog.events.map(({ dark: _dark, ...event }) => event) },
    };
    const other = makeEvent(
      run.nodeMap.nodes.find(
        (n) => n.type === 'battle' && !n.completed && n.id !== node.id && n.row >= 3,
      ),
    );
    const rows = Math.max(...run.nodeMap.nodes.map((n) => n.row)) + 1;
    const config = run.getEclipseConfig();
    run.eclipse = { ...run.eclipse, actShadow: 500 };
    const fell = run.applyEclipseNow().map((n) => n.id);
    expect(fell).toContain(other.id);
    expect(fell).not.toContain(node.id);
    expect(node.type).toBe('event');
    expect(node.eclipse).toBeUndefined();
    expect(other.type).toBe('battle');
    expect(other.eclipse).toMatchObject({ fromType: 'event', label: 'Swallowed road' });
    expect(nodeFallThreshold(other, { runSeed: run.runSeed, rows, config })).toBeLessThanOrEqual(
      500,
    );
  });
});

describe('revert and resume', () => {
  it('Continue from Map keeps the choice and the pending fight', () => {
    const { run, node } = doorRun();
    const goldBefore = run.gold;
    run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
    run.gold += 40; // something changes during the battle
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(run.gold).toBe(goldBefore);
    expect(run.battleInProgress).toBeNull();
    expect(node.completed).toBeFalsy();
    expect(eventState(run, node.id)).toMatchObject({ battle: 'pending', choiceId: 'door' });
    expect(pendingEventBattle(run, node.id)).not.toBeNull();
    expect(chooseEventOption(run, node.id, 'racks').ok).toBe(false);
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([node.id]);
  });
});

describe('victory', () => {
  it('completes the node, pays gold with the event multiplier, and marks the spoils owed', () => {
    const { run, node } = doorRun();
    const before = run.gold;
    expect(win(run, node)).toBe(true);
    expect(node.completed).toBe(true);
    expect(run.currentNodeId).toBe(node.id);
    expect(run.gold - before).toBe(EXPECTED_BATTLE_GOLD);
    expect(run.pendingEventNodeId).toBe(node.id);
    expect(getPendingEventSettlement(run)).toBe(node.id);
    expect(run.getEventPendingNode()).toBe(node);
    expect(pendingEventBattle(run, node.id)).toBeNull(); // won: no more Fight
  });

  it('pays what a plain battle node pays for the same fight', () => {
    const { run, node } = doorRun();
    const plain = newRun();
    const battle = plain.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    const a = run.gold;
    const b = plain.gold;
    win(run, node);
    plain.completeBattle(plain.getRoster(), battle.id, KILL_GOLD, { turnCount: 5, turnPar: 5 });
    expect(run.gold - a).toBe(plain.gold - b);
    expect(plain.gold - b).toBeGreaterThan(0);
  });

  it('completeEventBattle applies the spoils once: gold, an item, and the victory text', () => {
    const { run, node } = doorRun();
    win(run, node);
    const gold = run.gold;
    const armyItems = () =>
      run.roster.reduce((n, u) => n + u.inventory.length, 0) + run.convoy.weapons.length;
    const itemsBefore = armyItems();
    const done = completeEventBattle(run, node.id);
    expect(done.ok).toBe(true);
    expect(done.text).toMatch(/cellar cache/);
    expect(done.results.map((r) => r.kind)).toEqual(['item', 'gold']);
    expect(run.gold - gold).toBe(200); // { base: 100, perAct: 100 } in act 1
    expect(armyItems()).toBe(itemsBefore + 1);
    expect(eventState(run, node.id).battle).toBe('won');
    expect(run.pendingEventNodeId).toBeNull();
    expect(getPendingEventSettlement(run)).toBeNull();
    // The Steel weapon of act1's tierOffset 1: never worn (afterVictory carries no wear).
    expect(done.results[0]).toMatchObject({ tier: 'Steel', worn: [] });
  });

  it('a second call, or one after a reload, changes nothing', () => {
    const { run, node } = doorRun();
    win(run, node);
    completeEventBattle(run, node.id);
    const gold = run.gold;
    expect(completeEventBattle(run, node.id)).toMatchObject({ ok: false, already: true });
    expect(run.gold).toBe(gold);
    const loaded = reload(run);
    expect(completeEventBattle(loaded, node.id)).toMatchObject({ ok: false, already: true });
    expect(loaded.gold).toBe(gold);
  });

  it('a refresh between the victory and the spoils still applies them, once', () => {
    const { run, node } = doorRun();
    win(run, node);
    const loaded = reload(run); // saved on the route map, before completeEventBattle
    expect(loaded.pendingEventNodeId).toBe(node.id);
    expect(getPendingEventSettlement(loaded)).toBe(node.id);
    const gold = loaded.gold;
    expect(completeEventBattle(loaded, node.id).ok).toBe(true);
    expect(loaded.gold - gold).toBe(200);
    expect(completeEventBattle(loaded, node.id).ok).toBe(false);
    expect(loaded.gold - gold).toBe(200);
  });

  it('refuses to settle before the fight is won, and to leave before it is settled', () => {
    const { run, node } = doorRun();
    expect(completeEventBattle(run, node.id)).toEqual({
      ok: false,
      reason: 'The fight is not won yet.',
    });
    expect(leaveEvent(run, node.id)).toEqual({ ok: false, reason: 'The fight is not over.' });
    win(run, node);
    expect(leaveEvent(run, node.id)).toEqual({ ok: false, reason: 'Settle the battle first.' });
    completeEventBattle(run, node.id);
    expect(leaveEvent(run, node.id)).toEqual({ ok: true, nodeId: node.id });
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual(node.edges);
  });

  it('spoils that find no room are skipped with a note, never a failed plan', () => {
    const { run, node } = doorRun();
    win(run, node);
    for (const unit of run.roster)
      while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
    run.convoy.weapons = Array.from({ length: run.getConvoyCapacities().weapons }, () =>
      structuredClone(run.roster[0].inventory[0]),
    );
    const gold = run.gold;
    const done = completeEventBattle(run, node.id);
    expect(done.ok).toBe(true);
    expect(done.results[0]).toMatchObject({ kind: 'note', of: 'item' });
    expect(run.gold - gold).toBe(200); // the gold still comes
  });

  it('a caught bluff (a fight whose spoils are only gold) settles and leaves cleanly', () => {
    for (let seed = 1; seed < 400; seed++) {
      const run = newRun({ seed });
      const node = arriveAs(run, 'toll_bridge');
      const result = chooseEventOption(run, node.id, 'bluff');
      if (!result.battle) continue;
      expect(result.outcomeId).toBe('fail');
      win(run, node);
      const gold = run.gold;
      const done = completeEventBattle(run, node.id);
      expect(done.results.map((x) => x.kind)).toEqual(['gold']);
      expect(run.gold - gold).toBe(250); // { base: 150, perAct: 100 } in act 1
      expect(leaveEvent(run, node.id).ok).toBe(true);
      return;
    }
    throw new Error('no seed made the bluff fail');
  });
});

describe('leaving an event without a fight', () => {
  it('marks the node complete and opens the forward edges; the choice stays recorded', () => {
    const run = newRun();
    const node = arriveAs(run, 'drill_yard');
    expect(leaveEvent(run, node.id)).toEqual({ ok: false, reason: 'Make a choice first.' });
    chooseEventOption(run, node.id, 'rest');
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([node.id]); // re-entry before leaving
    expect(eventView(run, node.id)).toMatchObject({
      phase: 'outcome',
      canLeave: true,
      canFight: false,
    });
    expect(leaveEvent(run, node.id)).toEqual({ ok: true, nodeId: node.id });
    expect(node.completed).toBe(true);
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual(node.edges);
    expect(leaveEvent(run, node.id).ok).toBe(true); // idempotent
    expect(eventState(run, node.id)).toMatchObject({ choiceId: 'rest', left: true });
  });

  it('re-entry works before and after the choice, across a reload', () => {
    const run = newRun();
    const node = eventNode(run);
    const first = arriveAs(run, 'drill_yard', node);
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([first.id]);
    const before = reload(run);
    expect(eventView(before, node.id).phase).toBe('choosing');
    chooseEventOption(run, node.id, 'rest');
    const after = reload(run);
    expect(after.getAvailableNodes().map((n) => n.id)).toEqual([node.id]);
    expect(eventView(after, node.id)).toMatchObject({ phase: 'outcome' });
    expect(eventView(after, node.id).outcome.text).toBe('Real beds. Lumpy, but real.');
  });
});
