// Leaving the fork with Tamsin unarmed (engine/PrologueDeparture.js, ui/
// PrologueDepartureWarning.js, NodeMapScene.onNodeClick; docs/specs/prologue-chapter.md
// §6 "Route map, row 2"). The roster lesson can be skipped and never blocks travel, so
// a player could reach P3 with her bow still in the convoy. Travelling on from the node
// where she joined while she carries no combat weapon she can use asks once per Travel
// attempt: Open Roster (the roster, on her) or Continue anyway (travel). It never
// blocks: Continue anyway always travels, and without a DOM the road is simply open.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));
const { confirmPrologueDeparture } = vi.hoisted(() => ({ confirmPrologueDeparture: vi.fn() }));
vi.mock('../src/ui/PrologueDepartureWarning.js', async () => {
  const actual = await vi.importActual('../src/ui/PrologueDepartureWarning.js');
  return { ...actual, confirmPrologueDeparture };
});

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { hasUsableWeapon, unarmedDeparture } from '../src/engine/PrologueDeparture.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { PROLOGUE_UNARMED_DEPARTURE } from '../src/data/prologueContent.js';
import { readFileSync } from 'fs';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

/** The prologue run at a fork node, Tamsin joined there (her bow in the convoy). */
function atFork(nodeId = 'prologue_2a') {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  rm.completeBattle(rm.roster, 'prologue_0', 0);
  rm.completeBattle(rm.roster, 'prologue_1', 0);
  rm.addToConvoy(weapon('Iron Bow'));
  rm.currentNodeId = nodeId;
  rm.arriveAtPrologueNode(nodeId);
  rm.markNodeComplete(nodeId);
  return rm;
}
const node = (rm, id) => rm.nodeMap.nodes.find((n) => n.id === id);
const tamsin = (rm) => rm.roster.find((u) => u.name === 'Tamsin');

describe('when the departure asks (pure)', () => {
  it('leaving either fork node for P3 with Tamsin unarmed', () => {
    for (const id of ['prologue_2a', 'prologue_2b']) {
      const rm = atFork(id);
      expect(tamsin(rm).inventory).toEqual([]);
      expect(unarmedDeparture(rm, node(rm, 'prologue_3'))).toEqual({ unit: 'Tamsin' });
    }
  });

  it('never once she carries a weapon she can use', () => {
    const rm = atFork();
    tamsin(rm).inventory.push(weapon('Iron Bow'));
    expect(hasUsableWeapon(tamsin(rm))).toBe(true);
    expect(unarmedDeparture(rm, node(rm, 'prologue_3'))).toBeNull();
  });

  it('a weapon she cannot wield, or a staff or a Vulnerary, is still no weapon', () => {
    const rm = atFork();
    tamsin(rm).inventory.push(weapon('Iron Lance'));
    tamsin(rm).consumables = [structuredClone(data.consumables.find((c) => c.name === 'Vulnerary'))]; // prettier-ignore
    expect(hasUsableWeapon(tamsin(rm))).toBe(false);
    expect(unarmedDeparture(rm, node(rm, 'prologue_3'))).toEqual({ unit: 'Tamsin' });
  });

  it('not when re-entering the service she joined at, not from any other node, not in a real run', () => {
    const rm = atFork();
    expect(unarmedDeparture(rm, node(rm, 'prologue_2a'))).toBeNull();
    rm.currentNodeId = 'prologue_3';
    expect(unarmedDeparture(rm, node(rm, 'prologue_4'))).toBeNull();
    const standard = new RunManager(data, null);
    standard.startRun({ difficultyId: 'normal' });
    expect(unarmedDeparture(standard, standard.getAvailableNodes()[0])).toBeNull();
  });
});

/** NodeMapScene's travel entry (onNodeClick) on the fork, with the battle launch stubbed. */
function sceneAt(rm) {
  const s = Object.create(NodeMapScene.prototype);
  Object.assign(s, {
    runManager: rm,
    gameData: data,
    isTransitioning: false,
    battleLaunchInFlight: false,
    isSceneReady: true,
    _sceneShuttingDown: false,
    _sceneLifecycleGeneration: 1,
    sys: { isActive: () => true },
    input: { enabled: true },
    _showNodeFlavor: vi.fn(),
    handleBattle: vi.fn(async () => true),
    _openRoster: vi.fn(),
  });
  return s;
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => confirmPrologueDeparture.mockReset());

describe('the route map asks once per Travel attempt, and never blocks', () => {
  it('Continue anyway travels, without asking again in the same attempt', async () => {
    const rm = atFork();
    const s = sceneAt(rm);
    confirmPrologueDeparture.mockResolvedValueOnce('go');
    s.onNodeClick(node(rm, 'prologue_3'));
    expect(s.handleBattle).not.toHaveBeenCalled();
    expect(confirmPrologueDeparture).toHaveBeenCalledWith(s, { unit: 'Tamsin' });
    await settle();
    expect(confirmPrologueDeparture).toHaveBeenCalledTimes(1);
    expect(s.handleBattle).toHaveBeenCalledTimes(1);
    expect(s.handleBattle.mock.calls[0][0].id).toBe('prologue_3');
  });

  it('Open Roster opens the roster on her and stays; the next Travel asks again', async () => {
    const rm = atFork();
    const s = sceneAt(rm);
    confirmPrologueDeparture.mockResolvedValueOnce('roster');
    s.onNodeClick(node(rm, 'prologue_3'));
    await settle();
    expect(s._openRoster).toHaveBeenCalledWith(tamsin(rm));
    expect(s.handleBattle).not.toHaveBeenCalled();
    // She is handed the bow in the roster: the next Travel goes straight on.
    tamsin(rm).inventory.push(weapon('Iron Bow'));
    s.onNodeClick(node(rm, 'prologue_3'));
    expect(confirmPrologueDeparture).toHaveBeenCalledTimes(1);
    expect(s.handleBattle).toHaveBeenCalledTimes(1);
  });

  it('dismissed: the map stays as it was, and a second press while it is open does nothing', async () => {
    const rm = atFork();
    const s = sceneAt(rm);
    let answer;
    confirmPrologueDeparture.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    s.onNodeClick(node(rm, 'prologue_3'));
    s.onNodeClick(node(rm, 'prologue_3'));
    expect(confirmPrologueDeparture).toHaveBeenCalledTimes(1);
    answer('stay');
    await settle();
    expect(s.handleBattle).not.toHaveBeenCalled();
    expect(s._openRoster).not.toHaveBeenCalled();
    expect(s._prologueDepartureBusy).toBe(false);
  });

  it('armed: no question, the road is open', () => {
    const rm = atFork();
    tamsin(rm).inventory.push(weapon('Iron Bow'));
    const s = sceneAt(rm);
    s.onNodeClick(node(rm, 'prologue_3'));
    expect(confirmPrologueDeparture).not.toHaveBeenCalled();
    expect(s.handleBattle).toHaveBeenCalledTimes(1);
  });

  it('both route-map travel paths reach it: a click and a phone tap-tap on the node, and the Travel button', async () => {
    const rm = atFork();
    const s = sceneAt(rm);
    s.showNodeTooltip = vi.fn();
    s.hideNodeTooltip = vi.fn();
    const handlers = new Map();
    const nodeObj = { on: (event, fn) => handlers.set(event, fn) };
    s._bindNodeTouchHandlers(nodeObj, node(rm, 'prologue_3'), { x: 0, y: 0 }, true);
    confirmPrologueDeparture.mockResolvedValue('stay');
    // Desktop: a click.
    handlers.get('pointerdown')({ button: 0, pointerType: 'mouse' });
    await settle();
    expect(confirmPrologueDeparture).toHaveBeenCalledTimes(1);
    // A phone: the first tap previews, the second travels.
    handlers.get('pointerdown')({ button: 0, pointerType: 'touch' });
    expect(confirmPrologueDeparture).toHaveBeenCalledTimes(1);
    handlers.get('pointerdown')({ button: 0, pointerType: 'touch' });
    await settle();
    expect(confirmPrologueDeparture).toHaveBeenCalledTimes(2);
    expect(s.handleBattle).not.toHaveBeenCalled();
    // The loom's Travel button (desktop and phone) commits through the same entry.
    const menu = readFileSync(new URL('../src/ui/NodeMapMenu.js', import.meta.url), 'utf8');
    expect(menu).toMatch(/this\.travel = button\([\s\S]{0,400}s\.onNodeClick\(nodes\.find/);
  });

  it('without a DOM host the question is the road: Continue', async () => {
    const actual = await vi.importActual('../src/ui/PrologueDepartureWarning.js');
    expect(await actual.confirmPrologueDeparture({}, { unit: 'Tamsin' })).toBe('go');
  });

  it('the copy names her, says what it costs, and offers both ways', () => {
    expect(PROLOGUE_UNARMED_DEPARTURE.body('Tamsin')).toMatch(/^Tamsin has no usable weapon\./);
    expect(PROLOGUE_UNARMED_DEPARTURE.roster).toBe('Open Roster');
    expect(PROLOGUE_UNARMED_DEPARTURE.go).toBe('Continue anyway');
  });
});
