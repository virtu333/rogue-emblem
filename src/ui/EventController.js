// Event lifecycle only (docs/specs/event-nodes.md §4, §10). EventMenu owns rendering and
// input; EventCommands owns every rule. This controller opens the page for a node, saves
// at each commit, and carries the three exits: back to the route map (the event stays the
// current node), Fight (the normal handleBattle path) and Continue (leave, complete the
// node, check the act). Follows ChurchController's create/destroy pattern.
//
//   click an event node ─ handleEvent ─ arriveAtEvent ─ save ─ EventMenu (choosing)
//   choose            ─ EventMenu.commit ─ chooseEventOption ─ save ─ outcome page
//   outcome, no fight ─ continueEvent ─ leaveEvent ─ save ─ checkActComplete
//   outcome, a fight  ─ fight ─ handleBattle(node)  … battle … victory …
//   back on the map   ─ openSettlement ─ completeEventBattle ─ save ─ victory page ─ Continue
//
// A refresh at any point reopens the right page: the run is saved after arriving, after
// choosing and after the spoils; eventView() reads the saved state.

import { EventMenu } from './EventMenu.js';
import { showMinorHint } from './HintDisplay.js';
import { routeChangeModel } from './eventMenuModel.js';
import { saveServiceRun } from './serviceSave.js';
import {
  arriveAtEvent,
  completeEventBattle,
  eventView,
  getPendingEventSettlement,
  leaveEvent,
} from '../engine/EventCommands.js';

/**
 * A completed event node whose page is still owed: a won fight whose victory page was not
 * closed with Continue (the spoils are already taken). Read from the engine's view.
 */
export function eventPageOwed(run, nodeId) {
  const view = eventView(run, nodeId);
  return view?.phase === 'victory' && view.canLeave === true;
}

export class EventController {
  constructor(scene) {
    this.scene = scene;
  }

  /** The node was clicked (or re-entered): arrive, save, open the page its state calls for. */
  handleEvent(node) {
    const scene = this.scene;
    const rm = scene.runManager;
    if (!node || scene.eventOverlay) return false;
    // A won fight: its spoils owed (the player left before they were settled), or its
    // victory page not yet closed with Continue (a refresh on it).
    if (node.completed) {
      if (getPendingEventSettlement(rm) === node.id) return this.openSettlement(node);
      if (eventPageOwed(rm, node.id)) {
        this.showEventOverlay(node);
        return true;
      }
      return false;
    }
    const state = arriveAtEvent(rm, node.id);
    if (!state) {
      // No event could be picked (no catalog, a prologue map): never trap the route.
      rm.currentNodeId = node.id;
      rm.markNodeComplete(node.id);
      this.save();
      scene.checkActComplete();
      return false;
    }
    this.save();
    this.showEventOverlay(node);
    return true;
  }

  /**
   * Back on the route map after a won event battle: apply the spoils once, save, and open
   * the victory page. Idempotent across a refresh (the engine guards the spoils).
   */
  openSettlement(node) {
    const scene = this.scene;
    const rm = scene.runManager;
    if (!node || scene.eventOverlay) return false;
    const result = completeEventBattle(rm, node.id);
    if (!result.ok && !result.already) {
      // The spoils could not be taken: give them up rather than reopen on every load.
      console.warn('[EventController] spoils not settled:', result.reason);
      if (rm.pendingEventNodeId === node.id) rm.pendingEventNodeId = null;
      this.save();
      scene.drawMap();
      return false;
    }
    this.save();
    this.showEventOverlay(node);
    return true;
  }

  showEventOverlay(node) {
    const scene = this.scene;
    this.nativeMenu?.destroy();
    scene.eventOverlay = [];
    scene._eventNode = node;
    this.nativeMenu = new EventMenu(this);
  }

  /**
   * A choice edited the route (a road drawn, a place redrawn): hand the route map the places to
   * ring and the line to say, for when the page closes. The edit itself is already in the map.
   */
  noteRouteChange(results) {
    const change = routeChangeModel(results);
    if (change.nodeIds.length) this.scene.nodeView?.noteRouteChange?.(change);
  }

  /** The page's own exits. */
  closeToMap() {
    // ESC before choosing, or while a fight is owed: the event stays current.
    this.closeEventOverlay();
    this.scene.drawMap();
  }

  continueEvent() {
    const scene = this.scene;
    const node = scene._eventNode;
    if (!node || !scene.eventOverlay) return false;
    const left = leaveEvent(scene.runManager, node.id);
    if (!left.ok) {
      // Something is still owed (a fight): the page stays as it is.
      showMinorHint(scene, left.reason);
      return false;
    }
    this.closeEventOverlay();
    const warning = saveServiceRun(scene);
    if (warning) showMinorHint(scene, warning.trim());
    scene.checkActComplete();
    return true;
  }

  /** An event the build no longer knows: walk past it (the node completes, nothing applies). */
  continueUnknown() {
    const scene = this.scene;
    const node = scene._eventNode;
    if (!node || !scene.eventOverlay) return false;
    scene.runManager.markNodeComplete(node.id);
    this.closeEventOverlay();
    const warning = saveServiceRun(scene);
    if (warning) showMinorHint(scene, warning.trim());
    scene.checkActComplete();
    return true;
  }

  /** Fight: the outcome started a battle on this node. The normal battle launch. */
  fight() {
    const scene = this.scene;
    const node = scene._eventNode;
    if (!node || !scene.eventOverlay) return false;
    this.closeEventOverlay();
    try {
      scene._showNodeFlavor?.(node);
    } catch {
      /* best-effort flavor */
    }
    // The same locks onNodeClick takes before any battle (the route map goes quiet).
    scene.battleLaunchInFlight = true;
    scene.isTransitioning = true;
    scene.isSceneReady = false;
    if (scene.input) scene.input.enabled = false;
    void scene.handleBattle(node, scene._sceneLifecycleGeneration);
    return true;
  }

  save() {
    const warning = saveServiceRun(this.scene);
    if (warning) showMinorHint(this.scene, warning.trim());
  }

  closeEventOverlay() {
    const scene = this.scene;
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
    scene.eventOverlay = null;
    scene._eventNode = null;
  }

  refreshEventOverlay() {
    this.nativeMenu?.render();
  }

  destroy() {
    this.closeEventOverlay();
    this.scene = null;
  }
}
