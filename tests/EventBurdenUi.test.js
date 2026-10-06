// Burdens and events on the route map's surfaces (docs/specs/event-nodes.md §7, §10):
// the chips under the Loom's header, the pause menu's list, the victory band's settled
// lines, the projection that includes an Ill Omen's shadow, and the "Return to the event"
// button. The numbers come from the engine (Burdens.js); the surfaces only say them.
//
// Ways this can fail, a test each:
//   1. a burden is on the run and no chip, or the chip says a number the run does not have;
//   2. a chip's line cannot be read (no tap/Enter target, no title), or closes on a redraw;
//   3. the pause menu hides the burden the player is carrying;
//   4. the victory band says nothing of the debt the victory just paid, or says it twice;
//   5. the battle HUD's shadow projection ignores an Ill Omen (it promises less than the commit);
//   6. an event the party stands in reads "Travel", not "Return to the event";
//   7. a visited event's card does not remember what was chosen, or an event whose fight is locked
//      shows as a battle.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { NodeMapMenu } from '../src/ui/NodeMapMenu.js';
import { pauseBurdenList } from '../src/ui/MobilePauseMenu.js';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import { projectedShadow } from '../src/ui/EclipseHudController.js';
import { describeLoomNode, loomShortLabel } from '../src/ui/loomModel.js';
import { nodeFrame, nodeLabel } from '../src/ui/RouteGraph.js';
import { addBurden, describeBurdens, settlementLines } from '../src/engine/Burdens.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { arriveAs, baseData, makeEvent, newRun } from './eventKit.js';

// The card itself is read in "the route map card" below; here only the button is.
vi.mock('../src/ui/LoomPanels.js', async (original) => ({
  ...(await original()),
  renderLoomCard: vi.fn(),
  appendLoomCardNote: vi.fn(),
}));

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

/** A run carrying an Ill Omen (3 battles on Nightfall, +1 shadow) and 450 G of Debt. */
function burdenedRun(difficulty = 'hard') {
  const run = newRun({ difficulty });
  expect(addBurden(run, 'ill_omen').ok).toBe(true);
  expect(addBurden(run, 'debt', { owed: 450 }).ok).toBe(true);
  return run;
}

const chipsOf = (row) => row.querySelectorAll('.re-burden');

describe('the burden chips', () => {
  // The menu's own state (the open line) rides on `this`, as in NodeMapMenu.
  const rowFor = (run, menu = { _burdenOpen: null }) =>
    NodeMapMenu.prototype._burdenRow.call(
      Object.assign(menu, { scene: { runManager: run, gameData: run.gameData } }),
    );

  it('no burden, no row', () => {
    expect(rowFor(newRun())).toBeNull();
  });

  it('one chip per burden, with the number the run holds', () => {
    const run = burdenedRun();
    const row = rowFor(run);
    const chips = chipsOf(row);
    expect(chips.map((c) => c.dataset.burden)).toEqual(['ill_omen', 'debt']);
    expect(chips[0].textContent).toBe('Ill Omen3 left');
    expect(chips[1].textContent).toBe('Debt450 G');
    // Derived from the data by hand: Nightfall's Ill Omen is 3 battles, +1 shadow each.
    expect(run.burdens.find((b) => b.id === 'ill_omen')).toMatchObject({
      battles: 3,
      extraShadow: 1,
    });
    expect(row.getAttribute('aria-label')).toBe('Burdens');
  });

  it('a chip answers a tap or Enter with its line, a second tap closes it, one at a time', () => {
    const run = burdenedRun();
    const menu = { _burdenOpen: null };
    const row = rowFor(run, menu);
    const [omen, debt] = chipsOf(row);
    const note = row.querySelector('.re-burden-note');
    expect(note.hidden).toBe(true);
    omen.onclick();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(
      'Each victory gathers more shadow until the omen passes. 3 battles left, +1 shadow each.',
    );
    expect(omen.getAttribute('aria-expanded')).toBe('true');
    debt.onclick();
    expect(omen.getAttribute('aria-expanded')).toBe('false');
    expect(note.textContent).toContain("The lender takes a share of each victory's gold");
    expect(note.textContent).toContain('450 G owed');
    debt.onclick();
    expect(note.hidden).toBe(true);
    // The line is also the chip's title (hover, long press) and its accessible description.
    expect(omen.title).toContain('Ill Omen: Each victory gathers more shadow');
  });

  it('an open line stays open through a redraw of the same map', () => {
    const run = burdenedRun();
    const menu = { _burdenOpen: null };
    const first = rowFor(run, menu);
    chipsOf(first)[1].onclick();
    const again = rowFor(run, menu);
    expect(again.querySelector('.re-burden-note').hidden).toBe(false);
    expect(chipsOf(again)[1].getAttribute('aria-expanded')).toBe('true');
    // A burden that has ended takes its open line with it.
    run.burdens = run.burdens.filter((b) => b.id !== 'debt');
    const ended = rowFor(run, menu);
    expect(ended.querySelector('.re-burden-note').hidden).toBe(true);
    expect(menu._burdenOpen).toBeNull();
  });
});

describe('the pause menu', () => {
  it('lists each burden with what is left and its line', () => {
    const list = pauseBurdenList(describeBurdens(burdenedRun()));
    expect(list.getAttribute('aria-label')).toBe('Burdens');
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('strong').textContent).toBe('Ill Omen · 3 left');
    expect(items[0].querySelector('span').textContent).toContain('3 battles left, +1 shadow each.');
    expect(items[1].querySelector('strong').textContent).toBe('Debt · 450 G');
    expect(pauseBurdenList([])).toBeNull();
    expect(pauseBurdenList(undefined)).toBeNull();
  });
});

describe('the victory band', () => {
  const sceneFor = () => ({
    gameData: baseData,
    textures: { exists: () => false },
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getReduceMotion: () => false, getBattleSpeed: () => 'normal' }
          : null,
    },
    events: { once() {}, off() {}, emit() {} },
  });

  it('adds what the victory settled to the line, once refitted, and ignores nothing', () => {
    const c = new CeremonyController(sceneFor());
    const band = c.showVictory({ objective: 'rout', turn: 4, par: 5, rating: 'A' });
    const layer = dom.doc.querySelectorAll('.ce-layer')[0];
    expect(layer.querySelector('.ce-band-sub').textContent).toBe('Turn 4 · Par 5 · Rank A');
    const run = burdenedRun();
    // A 400 G battle on Nightfall: Debt takes half (200), Ill Omen adds 1 shadow.
    const settlement = {
      debt: { paid: 200, remaining: 250, cleared: false },
      illOmen: { extraShadow: 1, remaining: 2, ended: false },
    };
    expect(settlementLines(settlement)).toEqual(['Debt −200 G', 'Ill Omen +1']);
    band.addParts(settlementLines(settlement));
    expect(layer.querySelector('.ce-band-sub').textContent).toBe(
      'Turn 4 · Par 5 · Rank A · Debt −200 G · Ill Omen +1',
    );
    band.addParts([]); // nothing settled: nothing added
    expect(layer.querySelector('.ce-band-sub').textContent).toContain('Ill Omen +1');
    expect(run.burdens).toHaveLength(2);
    band.destroy();
  });

  it('a band with no line of its own grows one', () => {
    const c = new CeremonyController(sceneFor());
    const band = c.showVictory({ objective: 'rout' });
    const layer = dom.doc.querySelectorAll('.ce-layer')[0];
    expect(layer.querySelector('.ce-band-sub')).toBeNull();
    band.addParts(['Debt paid off']);
    expect(layer.querySelector('.ce-band-sub').textContent).toBe('Debt paid off');
    band.destroy();
  });
});

describe('the shadow a victory promises', () => {
  it('counts an Ill Omen: the HUD and the band say what the commit will gather', () => {
    const base = newRun({ difficulty: 'hard' });
    const scene = (run) => ({
      runManager: run,
      battleParams: {},
      turnPar: 8,
      turnManager: { turnNumber: 9 },
    });
    const plain = projectedShadow(scene(base));
    const omen = newRun({ difficulty: 'hard' });
    addBurden(omen, 'ill_omen');
    expect(projectedShadow(scene(omen))).toBe(plain + 1);
    // Debt takes gold, never shadow.
    const debt = newRun({ difficulty: 'hard' });
    addBurden(debt, 'debt', { owed: 100 });
    expect(projectedShadow(scene(debt))).toBe(plain);
  });
});

describe('describeBurdens', () => {
  it('names the chip number: battles left for an Ill Omen, gold owed for Debt', () => {
    const rows = describeBurdens(burdenedRun());
    expect(rows.map((r) => [r.id, r.label, r.short])).toEqual([
      ['ill_omen', 'Ill Omen', '3 left'],
      ['debt', 'Debt', '450 G'],
    ]);
    expect(describeBurdens(newRun())).toEqual([]);
  });
});

describe('the travel button', () => {
  function menuOn(run, selected) {
    const travel = dom.doc.createElement('button');
    return {
      scene: {
        runManager: run,
        gameData: run.gameData,
        _openRoster() {},
        isStoryInputLocked: () => false,
      },
      selected: selected.id,
      eclipseView: null,
      routeGraph: { model: {} },
      detail: dom.doc.createElement('section'),
      travel,
      _available: () => new Set(run.getAvailableNodes().map((n) => n.id)),
    };
  }
  const labelOf = (menu) => menu.travel.children.map((c) => c.textContent).join('');

  it('says "Return to the event" for the event the party stands in, "Travel" before', () => {
    const Menu = NodeMapMenu;
    const run = newRun();
    const node = arriveAs(run, 'quiet_road');
    delete run.eventStateByNodeId[node.id]; // not arrived yet
    const before = run.nodeMap.nodes.find((n) => n.edges.includes(node.id));
    before.completed = true;
    run.currentNodeId = before.id;
    const menu = menuOn(run, node);
    Menu.prototype._renderSelection.call(menu);
    expect(labelOf(menu)).toBe('Travel');
    arriveAs(run, 'quiet_road', node); // the party walks in
    run.currentNodeId = node.id;
    Menu.prototype._renderSelection.call(menu);
    expect(labelOf(menu)).toBe('Return to the event');
    expect(menu.travel.disabled).toBe(false);
  });
});

describe('the route map card', () => {
  const eventNode = () => {
    const run = newRun();
    return { run, node: makeEvent(run.nodeMap.nodes.find((n) => n.row >= 2)) };
  };

  it('an event is an Event, distinct from the Ruins and wearing a medal of its own', () => {
    const { node } = eventNode();
    expect(nodeLabel(node)).toBe('Event');
    expect(loomShortLabel(node)).toBe('EVENT');
    const ruins = { type: 'ruins' };
    expect(nodeLabel(ruins)).toBe('Ruins');
    expect(loomShortLabel(ruins)).toBe('RUINS');
    expect(nodeFrame(node, 'act1')).not.toBe(nodeFrame(ruins, 'act1'));
  });

  it('an unvisited event promises nothing; a visited one remembers the choice', () => {
    const { node } = eventNode();
    const fresh = describeLoomNode(node, { state: 'live', actId: 'act1' });
    expect(fresh.kind).toBe('EVENT');
    expect(fresh.text).toBe('Something waits on the road.');
    expect(fresh.tags).toEqual([]);
    const done = describeLoomNode(node, {
      state: 'done',
      actId: 'act1',
      eventChoice: 'Lay them to rest',
    });
    expect(done.text).toBe('You chose: Lay them to rest');
    // The road's flavour is for the unvisited: the visited card stays short.
    const dialogue = { nodeFlavor: { event: { act1: ['road line'] } } };
    expect(describeLoomNode(node, { state: 'done', actId: 'act1', dialogue }).flavor).toBe(
      'road line',
    );
    expect(
      describeLoomNode(node, { state: 'done', actId: 'act1', dialogue, eventChoice: 'Walk on' })
        .flavor,
    ).toBeNull();
    expect(done.stateLine.text).toBe('Woven · already walked');
  });

  it('an event with a fight stays an Event, locked when its battle is', () => {
    const { node } = eventNode();
    node.eventBattle = true;
    node.encounterLocked = true;
    const card = describeLoomNode(node, { state: 'current', actId: 'act1' });
    expect(card.kind).toBe('EVENT');
    expect(card.objective).toBeNull();
    expect(card.tags).toEqual([
      {
        text: 'Map set',
        tone: 'plain',
        detail: 'Leaving and coming back brings the same map and foes.',
      },
    ]);
    // The owed spoils say so on the card of the won node.
    const owed = describeLoomNode(node, { state: 'done', actId: 'act1', shopOpen: true });
    expect(owed.stateLine.text).toBe('The fight is won · the spoils await');
  });

  it('the event pool speaks from the road before a fight and like a battle after', () => {
    const { node } = eventNode();
    const dialogue = {
      nodeFlavor: { event: { act1: ['road line'] }, battle: { act1: ['battle line'] } },
    };
    expect(describeLoomNode(node, { state: 'live', actId: 'act1', dialogue }).flavor).toBe(
      'road line',
    );
    node.eventBattle = true;
    expect(describeLoomNode(node, { state: 'live', actId: 'act1', dialogue }).flavor).toBe(
      'battle line',
    );
  });

  it('the shipped dialogue has event lines for every act', () => {
    const pool = JSON.parse(readFileSync('data/dialogue.json', 'utf8')).nodeFlavor.event;
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      expect(pool[act].length, act).toBeGreaterThanOrEqual(4);
      for (const line of pool[act]) {
        expect(line.length).toBeLessThanOrEqual(90);
        expect(line).not.toMatch(/"|\n/);
      }
    }
  });
});

describe('a chosen event leaves its burden on the run the chips read', () => {
  it("Take the dark face's blessing: the Ill Omen appears in describeBurdens", () => {
    const run = newRun({ difficulty: 'hard' });
    const node = arriveAs(run, 'twin_altar');
    expect(chooseEventOption(run, node.id, 'shadow').ok).toBe(true);
    expect(describeBurdens(run).map((b) => b.id)).toEqual(['ill_omen']);
  });
});
