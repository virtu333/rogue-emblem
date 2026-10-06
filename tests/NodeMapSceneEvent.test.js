// The route map's event branch (NodeMapScene.onNodeClick -> EventController), with the real
// scene methods over a stub scene and the real engine commands (no canvas branches).
//
// Ways this can fail, a test each:
//   1. clicking an event node launches a battle, or never makes it the current node;
//   2. an event left open (ESC) cannot be re-entered, or re-entering re-picks the event;
//   3. a fight owed (revert, refresh) opens the choices again instead of the outcome with Fight;
//   4. any overlay (a church, the roster, a pause) lets a second node be entered over it;
//   5. the won fight's spoils are never taken on return, are taken twice, or open over the
//      loot screen's own choices, a story beat, or an overlay;
//   6. a completed, left event can be entered again;
//   7. ESC and the gamepad treat an open event page as no overlay (the map reacts behind it);
//   8. the route map's tooltip and flavour treat an event as a battle (or as nothing) when it
//      carries a fight, and the "Return to the event" label is missing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { nodeText } from './harness/EventDriver.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { NODE_TYPES } from '../src/utils/constants.js';
import { eventState, eventView } from '../src/engine/EventCommands.js';
import { saveRun } from '../src/engine/RunManager.js';
import { arriveAs, makeEvent, newRun } from './eventKit.js';

vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {}
  },
}));

const proto = NodeMapScene.prototype;

/** A route-map scene (real methods) over the run; the Phaser parts are stubs. */
function mapScene(run, overrides = {}) {
  const scene = Object.create(proto);
  Object.assign(scene, {
    runManager: run,
    gameData: run.gameData,
    registry: {
      get: (key) =>
        ({
          activeSlot: 1,
          hints: { hasSeen: () => true, markSeen: () => {} },
          settings: { getHints: () => true, getGuidance: () => 'full' },
          meta: { runsCompleted: 0 },
        })[key] ?? null,
    },
    events: { once() {}, off() {} },
    input: { enabled: true },
    isSceneReady: true,
    isTransitioning: false,
    battleLaunchInFlight: false,
    _sceneLifecycleGeneration: 1,
    sys: { isActive: () => true },
    dialogueOverlay: { visible: false },
    drawMap: vi.fn(),
    checkActComplete: vi.fn(),
    handleBattle: vi.fn(async () => true),
    showShopBanner: vi.fn(),
    showTransientMessage: vi.fn(),
    ...overrides,
  });
  return scene;
}

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A run whose event node holds `eventId`; the party stands on the node before it. */
function setup(eventId = 'drill_yard', options = {}) {
  const run = newRun(options);
  const node = arriveAs(run, eventId);
  delete run.eventStateByNodeId[node.id]; // not arrived yet: the click does that
  const prior = run.nodeMap.nodes.find((n) => n.edges.includes(node.id));
  prior.completed = true;
  run.currentNodeId = prior.id;
  saveRun(run, null, 1);
  // The event this node holds is the one the arrival picks: narrow the catalog to it.
  run.gameData = {
    ...run.gameData,
    events: {
      ...run.gameData.events,
      events: run.gameData.events.events.filter((e) => e.id === eventId || e.fallback),
    },
  };
  return { run, node, scene: mapScene(run) };
}

describe('clicking an event node', () => {
  it('arrives, makes it the current node, saves, and opens the page: never a battle', () => {
    const { run, node, scene } = setup();
    expect(run.getAvailableNodes().map((n) => n.id)).toContain(node.id);
    proto.onNodeClick.call(scene, node);
    expect(scene.handleBattle).not.toHaveBeenCalled();
    expect(scene.battleLaunchInFlight).toBe(false);
    expect(scene.isTransitioning).toBe(false);
    expect(run.currentNodeId).toBe(node.id);
    expect(eventState(run, node.id)).toMatchObject({ eventId: 'drill_yard' });
    expect(scene.eventOverlay).toBeTruthy();
    // Saved at arrival: a refresh now finds the same event on the node.
    expect(JSON.parse(storage.getItem('emblem_rogue_slot_1_run')).eventStateByNodeId[node.id]).toMatchObject({ eventId: 'drill_yard' }); // prettier-ignore
    expect(scene._eventController.nativeMenu.surface.body.all().map((n) => n.textContent).join(' ')).toContain('Drill until dark'); // prettier-ignore
  });

  it('ESC before choosing leaves the event current; clicking it again reopens the same event', () => {
    const { run, node, scene } = setup();
    proto.onNodeClick.call(scene, node);
    const picked = eventState(run, node.id).eventId;
    // The scene's own cancel (gamepad/pointer): routed to the page, which returns to the map.
    expect(proto.canRequestCancel.call(scene)).toBe(true);
    expect(proto.requestCancel.call(scene)).toBe(true);
    expect(scene.eventOverlay).toBeNull();
    expect(node.completed).toBe(false);
    expect(run.currentNodeId).toBe(node.id);
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([node.id]);
    proto.onNodeClick.call(scene, node);
    expect(scene.eventOverlay).toBeTruthy();
    expect(eventState(run, node.id).eventId).toBe(picked);
    expect(run.eventLog).toEqual([]);
  });

  it('a chosen event re-enters on its outcome page, never the choices', () => {
    const { run, node, scene } = setup();
    proto.onNodeClick.call(scene, node);
    const menu = scene._eventController.nativeMenu;
    const choice = menu.surface.body.all().find((n) => n.dataset?.choice === 'rest');
    choice.onclick();
    menu.child.options.apply(menu.child.options.choices[0]);
    menu.child.close();
    expect(eventView(run, node.id).phase).toBe('outcome');
    scene._eventController.closeToMap(); // left with the outcome unread (a refresh would do it too)
    expect(scene.eventOverlay).toBeNull();
    proto.onNodeClick.call(scene, node);
    const text = scene._eventController.nativeMenu.surface.body.all().map(nodeText).join(' ');
    expect(text).toContain('You chose: Rest in the barracks');
    expect(text).not.toContain('Drill until dark');
    expect(run.eventLog).toHaveLength(1);
  });

  it('a fight owed reopens the outcome with Fight, after a revert too', () => {
    const { run, node, scene } = setup('abandoned_armory');
    proto.onNodeClick.call(scene, node);
    const menu = scene._eventController.nativeMenu;
    menu.surface.body
      .all()
      .find((n) => n.dataset?.choice === 'door')
      .onclick();
    menu.child.options.apply(menu.child.options.choices[0]);
    menu.child.close();
    expect(eventState(run, node.id).battle).toBe('pending');
    scene._eventController.closeToMap();
    // The click re-enters the same node: Fight, not the choices.
    proto.onNodeClick.call(scene, node);
    const labels = scene._eventController.nativeMenu.surface.body.all().filter((n) => n.tag === 'button').map(nodeText); // prettier-ignore
    expect(labels).toContain('Fight');
    expect(labels).not.toContain('Continue');
    expect(labels).not.toContain('Take from the racks');
    // Fight goes through the normal battle path with the route map's locks.
    scene._eventController.nativeMenu.primary.onclick();
    expect(scene.handleBattle).toHaveBeenCalledWith(node, 1);
    expect(scene.battleLaunchInFlight).toBe(true);
    expect(scene.isTransitioning).toBe(true);
    expect(scene.isSceneReady).toBe(false);
  });

  it('is refused behind any overlay, mid-transition, or before the scene is ready', () => {
    for (const block of [
      { churchOverlay: [] },
      { shopOverlay: [] },
      { eventOverlay: [] },
      { rosterOverlay: { visible: true } },
      { pauseOverlay: { visible: true } },
      { isTransitioning: true },
      { battleLaunchInFlight: true },
      { isSceneReady: false },
    ]) {
      const { node, run, scene } = setup();
      Object.assign(scene, block);
      proto.onNodeClick.call(scene, node);
      expect(eventState(run, node.id), JSON.stringify(block)).toBeNull();
    }
  });

  it('a completed, left event cannot be entered again', () => {
    const { run, node, scene } = setup('quiet_road');
    proto.onNodeClick.call(scene, node);
    const menu = scene._eventController.nativeMenu;
    menu.surface.body
      .all()
      .find((n) => n.dataset?.choice === 'rest')
      .onclick();
    menu.child.options.apply(menu.child.options.choices[0]);
    menu.child.close();
    scene._eventController.continueEvent();
    expect(node.completed).toBe(true);
    expect(run.canReenterService(node.id)).toBe(false);
    proto.onNodeClick.call(scene, node);
    expect(scene.eventOverlay).toBeNull();
  });
});

describe('back from a won event battle', () => {
  function wonFight() {
    const ctx = setup('abandoned_armory');
    proto.onNodeClick.call(ctx.scene, ctx.node);
    const menu = ctx.scene._eventController.nativeMenu;
    menu.surface.body
      .all()
      .find((n) => n.dataset?.choice === 'door')
      .onclick();
    menu.child.options.apply(menu.child.options.choices[0]);
    menu.child.close();
    ctx.scene._eventController.closeEventOverlay();
    ctx.run.completeBattle(ctx.run.getRoster(), ctx.node.id, 100, { turnCount: 5, turnPar: 5 });
    saveRun(ctx.run, null, 1);
    // The map scene is created afresh on return.
    ctx.scene = mapScene(ctx.run);
    ctx.goldBefore = ctx.run.gold;
    return ctx;
  }

  it('opens the victory page once, taking the spoils exactly once', () => {
    const { run, node, scene, goldBefore } = wonFight();
    expect(proto._maybeOpenPendingEventSettlement.call(scene)).toBe(true);
    expect(run.gold).toBe(goldBefore + 200);
    expect(scene.eventOverlay).toBeTruthy();
    const text = scene._eventController.nativeMenu.surface.body.all().map(nodeText).join(' | ');
    expect(text).toContain('The fight is won.');
    expect(text).toContain('Gained 200 G');
    expect(run.pendingEventNodeId).toBeNull();
    // A second look (another scene start while it is open) takes nothing and opens nothing.
    expect(proto._maybeOpenPendingEventSettlement.call(scene)).toBe(false);
    expect(run.gold).toBe(goldBefore + 200);
    scene._eventController.continueEvent();
    expect(node.completed).toBe(true);
    expect(scene.checkActComplete).toHaveBeenCalledTimes(1);
    // Left: another scene start opens nothing.
    expect(proto._maybeOpenPendingEventSettlement.call(mapScene(run))).toBe(false);
  });

  it('waits for the loot screen, a story beat, a transition or an open overlay', () => {
    for (const hold of [
      (s) => (s.runManager.pendingBattleReward = { picks: 1 }),
      (s) => (s._storyDialogueActive = true),
      (s) => (s.isTransitioning = true),
      (s) => (s.isSceneReady = false),
      (s) => (s.shopOverlay = []),
      (s) => (s.rosterOverlay = { visible: true }),
      (s) => (s.runManager.pendingBossRecruit = { candidates: [] }),
    ]) {
      const ctx = wonFight();
      hold(ctx.scene);
      expect(proto._maybeOpenPendingEventSettlement.call(ctx.scene)).toBe(false);
      expect(ctx.run.gold).toBe(ctx.goldBefore);
      expect(ctx.scene.eventOverlay).toBeFalsy();
      expect(ctx.run.pendingEventNodeId).toBe(ctx.node.id);
    }
  });

  it('the route offers "Return to the event" while the spoils or the victory page are owed', () => {
    const { run, node } = wonFight();
    expect(run.canReenterService(node.id)).toBe(true);
    expect(run.getAvailableNodes().map((n) => n.id)).not.toContain(node.id); // completed: forward only
  });

  it('a refresh on the victory page reopens it until Continue', () => {
    const ctx = wonFight();
    proto._maybeOpenPendingEventSettlement.call(ctx.scene);
    ctx.scene._eventController.closeEventOverlay(); // the page is gone with the refresh
    saveRun(ctx.run, null, 1);
    const again = mapScene(ctx.run);
    expect(proto._maybeOpenPendingEventSettlement.call(again)).toBe(true);
    expect(ctx.run.gold).toBe(ctx.goldBefore + 200);
    again._eventController.continueEvent();
    expect(proto._maybeOpenPendingEventSettlement.call(mapScene(ctx.run))).toBe(false);
  });
});

describe('overlay awareness', () => {
  it('an open event page counts as an overlay for ESC, the gamepad and the roster', () => {
    const { node, scene } = setup();
    expect(proto._nodeMapOverlayOpen.call(scene)).toBe(false);
    proto.onNodeClick.call(scene, node);
    expect(proto._nodeMapOverlayOpen.call(scene)).toBe(true);
    expect(proto.canRequestCancel.call(scene, { allowPause: false })).toBe(true);
    // The route's own roster stays shut behind the page (the page has its own Roster).
    scene.rosterOverlay = null;
    proto._openRoster.call(scene);
    expect(scene.rosterOverlay).toBeFalsy();
  });
});

describe('what the route map says about an event', () => {
  const tip = (node) => {
    const texts = [];
    const scene = mapScene(newRun(), {
      hideNodeTooltip: vi.fn(),
      add: {
        text: (x, y, text) => {
          texts.push(text);
          const chain = { setOrigin: () => chain, setDepth: () => chain, width: 40, x };
          return chain;
        },
      },
      cameras: { main: { width: 640 } },
    });
    proto.showNodeTooltip.call(scene, node, { x: 100, y: 100 });
    return texts[0];
  };

  it('the tooltip says Event, and Encounter Locked only once its fight is locked', () => {
    const run = newRun();
    const node = makeEvent(run.nodeMap.nodes.find((n) => n.row >= 2));
    expect(tip(node)).toBe('Event — Something waits on the road');
    node.eventBattle = true;
    node.encounterLocked = true;
    expect(tip(node)).toBe('Event — Something waits on the road\nEncounter Locked');
    // A plain event is never "locked" (it has no encounter).
    node.eventBattle = false;
    expect(tip(node)).not.toContain('Locked');
  });

  it('flavour: an event speaks from its own lines on the road, like a battle once it fights', () => {
    const lines = (type) => ({ act1: [`${type} line`] });
    const scene = mapScene(newRun(), {
      gameData: { dialogue: { nodeFlavor: { event: lines('event'), battle: lines('battle') } } },
    });
    scene.runManager = { currentAct: 'act1', pickNarrativeLine: (l) => l[0] };
    proto._showNodeFlavor.call(scene, { type: NODE_TYPES.EVENT });
    expect(scene.showShopBanner).toHaveBeenLastCalledWith('event line', expect.any(String));
    proto._showNodeFlavor.call(scene, { type: NODE_TYPES.EVENT, eventBattle: true });
    expect(scene.showShopBanner).toHaveBeenLastCalledWith('battle line', expect.any(String));
  });
});
