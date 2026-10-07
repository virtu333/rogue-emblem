// Dark Omen (docs/specs/event-nodes-phase2.md §2B): when the Eclipse takes an event node nobody
// has chosen at, the node stays an event and wears the event's dark face, if an event with one is
// eligible there; otherwise it falls to a battle as in Phase 1.
//
// Ways this goes wrong:
//   - it falls at another shadow than before (the threshold moved), or the current node falls;
//   - it is not deterministic (the same run twice makes a different node or a different face);
//   - with no dark face to offer the node is lost (neither event nor battle) or stays an event
//     that only has a plain face;
//   - arrival picks a plain face on a Dark Omen, or a dark face on a plain node, or an event with
//     no dark face; the saved state forgets which face it is on;
//   - the node cannot be entered or left, or a dark choice strands the run;
//   - the toast, label or card still call it a Swallowed road.
import { describe, expect, it } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  completeEventBattle,
  eventState,
  eventView,
  leaveEvent,
} from '../src/engine/EventCommands.js';
import {
  eclipseNode,
  fallToastText,
  nodeFallExemption,
  nodeFallThreshold,
} from '../src/engine/EclipseSystem.js';
import {
  eventFace,
  findEvent,
  hasDarkOmen,
  isDarkEvent,
  pickEvent,
} from '../src/engine/EventSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import { describeLoomNode, loomShortLabel } from '../src/ui/loomModel.js';
import { nodeFrame, nodeLabel } from '../src/ui/RouteGraph.js';
import { addUnit, baseData, fallAlly, makeEvent, newRun, runWithEvents } from './eventKit.js';

const DARK_IDS = ['drill_yard', 'quiet_road', 'toll_bridge', 'twin_altar', 'wounded_courier'];
const roundTrip = (run) =>
  RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);
const rowsOf = (run) => Math.max(...run.nodeMap.nodes.map((n) => n.row)) + 1;

/** An unvisited event node on row 3 or later of a fresh run. */
function unvisitedEvent(run) {
  return makeEvent(
    run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.row >= 3),
  );
}
const thresholdOf = (run, node) =>
  nodeFallThreshold(node, {
    runSeed: run.runSeed,
    rows: rowsOf(run),
    config: run.getEclipseConfig(),
  });
const withShadow = (run, actShadow) => {
  run.eclipse = { ...run.eclipse, actShadow };
};
const withoutDark = (run) => {
  const catalog = run.gameData.events;
  run.gameData = {
    ...run.gameData,
    events: { ...catalog, events: catalog.events.map(({ dark: _dark, ...event }) => event) },
  };
};

describe('the shipped dark faces', () => {
  it('five events have one, each a full face with a way out', () => {
    const withDark = baseData.events.events.filter(isDarkEvent).map((e) => e.id);
    expect(withDark.sort()).toEqual(DARK_IDS);
    // The fallback has one, so a Dark Omen can always be drawn.
    expect(isDarkEvent(findEvent(baseData.events, 'quiet_road'))).toBe(true);
  });

  it('eventFace lays the dark face over the event and nothing else', () => {
    const altar = findEvent(baseData.events, 'twin_altar');
    const face = eventFace(altar, { dark: true });
    expect(face.intro).toBe(altar.dark.intro);
    expect(face.choices.map((c) => c.id)).toEqual(['kneel', 'offerings', 'leave']);
    expect(face.title).toBe(altar.title);
    expect(face.weight).toBe(altar.weight);
    // The plain face is the event itself, and an event with no dark face is its own face.
    expect(eventFace(altar, {})).toBe(altar);
    expect(eventFace(altar, { dark: false })).toBe(altar);
    const plain = findEvent(baseData.events, 'old_swordmaster');
    expect(eventFace(plain, { dark: true })).toBe(plain);
  });
});

describe('the fall', () => {
  it('keeps the node an event at exactly the shadow a Phase 1 fall came at', () => {
    const run = newRun({ seed: 31 });
    const node = unvisitedEvent(run);
    const threshold = thresholdOf(run, node);
    withShadow(run, threshold - 1);
    expect(run.applyEclipseNow().map((n) => n.id)).not.toContain(node.id);
    expect(node.eclipse).toBeUndefined();
    withShadow(run, threshold);
    expect(run.applyEclipseNow().map((n) => n.id)).toContain(node.id);
    expect(node).toMatchObject({
      type: 'event',
      darkOmen: true,
      battleParams: null,
      eclipse: { fromType: 'event', label: 'Dark Omen', seen: false },
    });
    expect(node.eclipse.fellAtShadow).toBe(run.eclipse.shadow);
  });

  it('is idempotent, and a second pass changes nothing', () => {
    const run = newRun({ seed: 31 });
    const node = unvisitedEvent(run);
    withShadow(run, 500);
    run.applyEclipseNow();
    const frozen = JSON.stringify(node);
    expect(run.applyEclipseNow().map((n) => n.id)).not.toContain(node.id);
    expect(JSON.stringify(node)).toBe(frozen);
  });

  it('is the same on two runs of one seed, and survives a reload', () => {
    const fall = (seed) => {
      const run = newRun({ seed });
      const node = unvisitedEvent(run);
      withShadow(run, 500);
      run.applyEclipseNow();
      return { run, node: JSON.parse(JSON.stringify(node)) };
    };
    expect(fall(44).node).toEqual(fall(44).node);
    const { run, node } = fall(44);
    const loaded = roundTrip(run);
    expect(loaded.nodeMap.nodes.find((n) => n.id === node.id)).toMatchObject({
      type: 'event',
      darkOmen: true,
    });
  });

  it('a fall that comes due at load is decided as in play: a Dark Omen, or a battle with no dark face', () => {
    // The save holds a shadow that has passed an event node's threshold but not the fall itself
    // (a save from before the node was taken); loading takes the node.
    for (const darkFaces of [true, false]) {
      const make = () => {
        const run = newRun({ seed: 31 });
        if (!darkFaces) withoutDark(run);
        const node = unvisitedEvent(run);
        withShadow(run, thresholdOf(run, node));
        expect(node.eclipse).toBeUndefined(); // due, not yet fallen
        return { run, node };
      };
      const live = make();
      live.run.applyEclipseNow();
      const saved = make();
      const loaded = roundTrip(saved.run);
      const loadedNode = loaded.nodeMap.nodes.find((n) => n.id === saved.node.id);
      expect(loadedNode, `dark faces ${darkFaces}`).toEqual(live.node);
      if (darkFaces) expect(loadedNode).toMatchObject({ type: 'event', darkOmen: true });
      else
        expect(loadedNode).toMatchObject({ type: 'battle', eclipse: { label: 'Swallowed road' } });
    }
  });

  it('never takes the current or the walked node', () => {
    const run = newRun({ seed: 31 });
    const node = unvisitedEvent(run);
    run.currentNodeId = node.id;
    withShadow(run, 500);
    run.applyEclipseNow();
    expect(node.eclipse).toBeUndefined();
    expect(node.darkOmen).toBeUndefined();
    expect(nodeFallExemption(node, { nodeMap: run.nodeMap, currentNodeId: node.id })).toBe(
      'current',
    );
  });

  it('falls to a battle when no event has a dark face, or none is eligible there', () => {
    // (1) no dark faces anywhere.
    const bare = newRun({ seed: 31 });
    withoutDark(bare);
    const a = unvisitedEvent(bare);
    withShadow(bare, 500);
    bare.applyEclipseNow();
    expect(a).toMatchObject({
      type: 'battle',
      eclipse: { fromType: 'event', label: 'Swallowed road' },
    });
    expect(a.darkOmen).toBeUndefined();
    // (2) every dark event already met (each is once-per-run): none is eligible.
    const met = newRun({ seed: 31 });
    met.eventLog = DARK_IDS.filter((id) => id !== 'quiet_road').map((eventId) => ({
      eventId,
      choiceId: 'x',
      outcomeId: 'y',
      act: 'act1',
    }));
    const b = unvisitedEvent(met);
    expect(hasDarkOmen(met, b)).toBe(false);
    withShadow(met, 500);
    met.applyEclipseNow();
    expect(b.type).toBe('battle');
    // (3) one still eligible (the Twin Altar not yet met): it stays an event.
    const partial = newRun({ seed: 31 });
    partial.eventLog = met.eventLog.filter((entry) => entry.eventId !== 'twin_altar');
    const c = unvisitedEvent(partial);
    expect(hasDarkOmen(partial, c)).toBe(true);
    withShadow(partial, 500);
    partial.applyEclipseNow();
    expect(c).toMatchObject({ type: 'event', darkOmen: true });
  });

  it('asks the run, not the data: a non-event node never becomes an Omen', () => {
    const run = newRun({ seed: 31 });
    const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.row >= 3);
    withShadow(run, 500);
    run.applyEclipseNow();
    expect(battle.darkOmen).toBeUndefined();
    expect(battle.type).toBe('battle');
  });

  it('eclipseNode without the question is the Phase 1 fall', () => {
    const node = { id: 'act2_4_1', row: 4, col: 1, type: 'event', edges: [], battleParams: null };
    eclipseNode(node, {
      runSeed: 42,
      config: baseData.eclipse,
      actId: 'act2',
      mapTemplates: baseData.mapTemplates,
      shadow: 30,
    });
    expect(node.type).toBe('battle');
    const omen = { ...node, type: 'event', eclipse: undefined, battleParams: null, id: 'act2_4_2' };
    eclipseNode(omen, {
      runSeed: 42,
      config: baseData.eclipse,
      actId: 'act2',
      shadow: 30,
      darkOmen: () => true,
    });
    expect(omen.type).toBe('event');
    // `true` exactly: a truthy callback result is not a yes.
    const odd = { ...omen, eclipse: undefined, darkOmen: undefined, type: 'event', id: 'act2_4_3' };
    eclipseNode(odd, {
      runSeed: 42,
      config: baseData.eclipse,
      actId: 'act2',
      mapTemplates: baseData.mapTemplates,
      shadow: 30,
      darkOmen: () => 'yes',
    });
    expect(odd.type).toBe('battle');
  });
});

describe('the Omen is an event: arrival, choices, leaving', () => {
  function omenRun(seed = 61, mutate = null) {
    const run = newRun({ seed, gold: 1000 });
    mutate?.(run);
    const node = unvisitedEvent(run);
    withShadow(run, 500);
    run.applyEclipseNow();
    expect(node.darkOmen).toBe(true);
    return { run, node };
  }

  it('draws only among events with a dark face, and plays that face', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { run, node } = omenRun(seed);
      const state = arriveAtEvent(run, node.id);
      expect(DARK_IDS, `seed ${seed}`).toContain(state.eventId);
      expect(state.dark).toBe(true);
      const view = eventView(run, node.id);
      const event = findEvent(run.gameData.events, state.eventId);
      expect(view.dark).toBe(true);
      expect(view.intro).toBe(event.dark.intro);
      expect(view.choices.map((c) => c.id)).toEqual(event.dark.choices.map((c) => c.id));
      expect(run.currentNodeId).toBe(node.id);
    }
  });

  it('a plain node never gets a dark face, whatever the seed', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = newRun({ seed });
      const node = unvisitedEvent(run);
      const state = arriveAtEvent(run, node.id);
      expect(state.dark).toBeUndefined();
      expect(eventView(run, node.id).dark).toBe(false);
      expect(eventView(run, node.id).intro).toBe(findEvent(baseData.events, state.eventId).intro);
    }
  });

  it('the pick is the plain pick restricted to dark faces, and seeded', () => {
    const { run, node } = omenRun(8);
    const first = pickEvent(run, node, run.gameData.events, { dark: true }).id;
    expect(pickEvent(run, node, run.gameData.events, { dark: true }).id).toBe(first);
    expect(arriveAtEvent(run, node.id).eventId).toBe(first);
    // Met already: that one is out, and the draw moves to another dark face.
    const other = omenRun(8);
    other.run.eventLog.push({ eventId: first, choiceId: 'x', outcomeId: 'y', act: 'act1' });
    expect(pickEvent(other.run, other.node, other.run.gameData.events, { dark: true }).id).not.toBe(
      first,
    );
  });

  it("when every dark event has been met, the fallback's dark face stands in", () => {
    const { run, node } = omenRun(9);
    run.eventLog = DARK_IDS.filter((id) => id !== 'quiet_road').map((eventId) => ({
      eventId,
      choiceId: 'x',
      outcomeId: 'y',
      act: 'act1',
    }));
    const state = arriveAtEvent(run, node.id);
    expect(state).toMatchObject({ eventId: 'quiet_road', dark: true });
    expect(eventView(run, node.id).intro).toBe(
      findEvent(run.gameData.events, 'quiet_road').dark.intro,
    );
  });

  it('an event whose face is missing is played plain, not dark', () => {
    const run = runWithEvents([]);
    // quiet_road without its dark face is the only event: the Omen has nothing to wear.
    run.gameData.events.events = run.gameData.events.events.map(({ dark: _d, ...e }) => e);
    const node = unvisitedEvent(run);
    node.darkOmen = true;
    node.eclipse = { fromType: 'event', label: 'Dark Omen', seen: false, fellAtShadow: 1 };
    expect(arriveAtEvent(run, node.id).dark).toBeUndefined();
  });

  it("the Twin Altar's dark face: gold and shadow by hand, then the blessing, vision and omen", () => {
    const altar = structuredClone(findEvent(baseData.events, 'twin_altar'));
    const make = () => {
      const run = runWithEvents([altar], { seed: 3, gold: 0 });
      const node = unvisitedEvent(run);
      node.darkOmen = true;
      node.eclipse = { fromType: 'event', label: 'Dark Omen', seen: false, fellAtShadow: 0 };
      arriveAtEvent(run, node.id);
      expect(eventState(run, node.id)).toMatchObject({ eventId: 'twin_altar', dark: true });
      return { run, node };
    };
    // Take the offerings: Act I = 300 + 150 x 1 = 450 gold, shadow +6.
    const taking = make();
    expect(chooseEventOption(taking.run, taking.node.id, 'offerings').ok).toBe(true);
    expect(taking.run.gold).toBe(450);
    expect(taking.run.eclipse.shadow).toBe(6);
    // Kneel: a tier 3 blessing, one Vision, the omen at +2 shadow a battle, and shadow +4.
    const kneeling = make();
    const visions = kneeling.run.visionChargesRemaining;
    const result = chooseEventOption(kneeling.run, kneeling.node.id, 'kneel');
    expect(result.ok, result.reason).toBe(true);
    expect(kneeling.run.visionChargesRemaining).toBe(visions + 1);
    expect(kneeling.run.burdens).toEqual([{ id: 'ill_omen', battles: 2, extraShadow: 2 }]);
    expect(kneeling.run.eclipse.shadow).toBe(4);
    expect(result.results.map((r) => r.kind)).toEqual(['blessing', 'vision', 'burden', 'shadow']);
    // The saved page reopens identically on the dark face.
    expect(eventView(roundTrip(kneeling.run), kneeling.node.id)).toEqual(
      eventView(kneeling.run, kneeling.node.id),
    );
  });

  it('a save from before Dark Omens, with the same event, opens its plain face', () => {
    const { run, node } = omenRun(12);
    arriveAtEvent(run, node.id);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.eventStateByNodeId[node.id].dark;
    delete saved.nodeMap.nodes.find((n) => n.id === node.id).darkOmen;
    const loaded = RunManager.fromJSON(saved, run.gameData);
    const state = eventState(loaded, node.id);
    expect(state.dark).toBeUndefined();
    const event = findEvent(loaded.gameData.events, state.eventId);
    expect(eventView(loaded, node.id).intro).toBe(event.intro);
  });

  it('can be entered from the map and left, and the route stays valid', () => {
    const { run, node } = omenRun(14);
    const parent = run.nodeMap.nodes.find((n) => n.edges.includes(node.id));
    parent.completed = true;
    run.currentNodeId = parent.id;
    expect(run.getAvailableNodes().map((n) => n.id)).toContain(node.id);
    expect(arriveAtEvent(run, node.id)).not.toBeNull();
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([node.id]);
    const view = eventView(run, node.id);
    const open = view.choices.find((c) => !c.block);
    expect(open).toBeTruthy();
    const result = chooseEventOption(run, node.id, open.id, {
      targetUid: open.target?.candidates.find((c) => c.ok)?.uid ?? null,
    });
    expect(result.ok, result.reason).toBe(true);
    if (!result.battle) {
      expect(leaveEvent(run, node.id).ok).toBe(true);
      expect(node.completed).toBe(true);
      expect(run.getAvailableNodes().map((n) => n.id)).toEqual(node.edges);
    }
    // The Eclipse's own view lists it as taken.
    expect(run.getEclipseView().nodes.get(node.id)).toMatchObject({ eclipsed: true });
  });
});

describe('every dark choice and outcome resolves on a real run', () => {
  const triples = baseData.events.events
    .filter(isDarkEvent)
    .flatMap((event) =>
      event.dark.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) => [event.id, choice.id, outcome.id]),
      ),
    );

  function darkRun(seed, eventId, difficulty = 'normal') {
    const run = newRun({ seed, difficulty, gold: 2000 });
    for (const [className, name] of [
      ['Archer', 'Hale'],
      ['Mage', 'Iona'],
      ['Cleric', 'Mara'],
    ])
      addUnit(run, className, { name, level: 3 });
    fallAlly(run, addUnit(run, 'Cavalier', { name: 'Rook', level: 5 }));
    const node = unvisitedEvent(run);
    arriveAtEvent(run, node.id);
    // Hold the pick to the event under test (the pick itself is tested above).
    run.eventStateByNodeId[node.id] = {
      eventId,
      arrivedAct: run.currentAct,
      dark: true,
      results: [],
      victoryResults: [],
      battle: null,
      afterVictory: [],
    };
    node.darkOmen = true;
    return { run, node };
  }

  it('lists the outcomes', () => {
    expect(triples.length).toBeGreaterThanOrEqual(12);
  });

  it.each(triples)('%s / %s / %s', (eventId, choiceId, outcomeId) => {
    for (let seed = 1; seed <= 300; seed++) {
      const { run, node } = darkRun(seed, eventId);
      const view = eventView(run, node.id);
      const choice = view.choices.find((c) => c.id === choiceId);
      expect(choice.block, `${eventId}.${choiceId} blocked`).toBe('');
      const result = chooseEventOption(run, node.id, choiceId, {
        targetUid: choice.target?.candidates.find((c) => c.ok)?.uid ?? null,
      });
      expect(result.ok, result.reason).toBe(true);
      if (result.outcomeId !== outcomeId) continue;
      expect(run.gold).toBeGreaterThanOrEqual(0);
      for (const unit of run.roster) expect(unit.currentHP).toBeGreaterThanOrEqual(1);
      expect(run.eclipse.shadow).toBeGreaterThanOrEqual(0);
      expect(run.eclipse.shadow).toBeLessThanOrEqual(100);
      expect(result.text).not.toMatch(/\{[a-z]+\}/);
      expect(eventView(roundTrip(run), node.id).outcome.text).toBe(result.text);
      if (result.battle) {
        expect(run.completeBattle(run.getRoster(), node.id, 80, { turnCount: 6, turnPar: 6 })).toBe(
          true,
        );
        expect(completeEventBattle(run, node.id).ok).toBe(true);
      }
      expect(leaveEvent(run, node.id).ok).toBe(true);
      return;
    }
    throw new Error(`${eventId}.${choiceId}.${outcomeId} never came up`);
  });

  it('every dark face has a choice a broke, full army can take', () => {
    for (const event of baseData.events.events.filter(isDarkEvent)) {
      const { run, node } = darkRun(5, event.id);
      run.gold = 0;
      for (const unit of run.roster) unit.consumables = [];
      const open = eventView(run, node.id).choices.find((c) => !c.block);
      expect(open, event.id).toBeTruthy();
    }
  });
});

describe('how the route map and the page read it', () => {
  const fallen = () => {
    const node = { id: 'act2_4_1', row: 4, col: 1, type: 'event', edges: [], battleParams: null };
    eclipseNode(node, {
      runSeed: 42,
      config: baseData.eclipse,
      actId: 'act2',
      mapTemplates: baseData.mapTemplates,
      shadow: 30,
      darkOmen: () => true,
    });
    return node;
  };

  it('is labelled Dark Omen, wears the Dark Omen medal and says the story stayed', () => {
    const node = fallen();
    expect(nodeLabel(node)).toBe('Dark Omen');
    expect(nodeFrame(node, 'act2')).toBe(10);
    expect(loomShortLabel(node)).toBe('OMEN');
    const card = describeLoomNode(node, { state: 'live', actId: 'act2' });
    expect(card.kind).toBe('DARK OMEN');
    expect(card.place).toBeNull();
    expect(card.objective).toBeNull();
    expect(card.text).toMatch(/^The dark took this road, but the story stayed\./);
    expect(card.tags.map((t) => t.text)).toContain('Eclipsed');
    // Walked, it keeps the line of the choice like any visited event.
    const walked = describeLoomNode(node, {
      state: 'done',
      actId: 'act2',
      eventChoice: 'Take the offerings',
    });
    expect(walked.text).toBe('You chose: Take the offerings');
    // It is still enterable as an event; a Swallowed road is not.
    expect(node.type).toBe('event');
  });

  it('the toast says twisted for an Omen and taken for a Swallowed road', () => {
    expect(fallToastText([fallen()], baseData.eclipse)).toBe('The dark twists the omen.');
    const battle = { ...fallen(), darkOmen: undefined };
    expect(fallToastText([battle], baseData.eclipse)).toBe('The dark takes the omen.');
  });
});
