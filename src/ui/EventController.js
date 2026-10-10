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
//   spoils fail       ─ openSettlement ─ the "could not be taken" page: Try again (retry),
//                       Back to map (everything stays owed), Give up the spoils (confirmed)
//
// A refresh at any point reopens the right page: the run is saved after arriving, after
// choosing and after the spoils; eventView() reads the saved state. The spoils are owed for
// as long as the saved state says so (EventCommands.eventSpoilsOwed), never only while a
// marker is set: a failed settlement keeps them owed, and only Try again or the confirmed
// Give up changes that. Back to map after a failure defers the AUTOMATIC reopen for this
// scene (the route map is usable at once); clicking the node, or a reload, tries again.

import { EventMenu } from './EventMenu.js';
import { showMinorHint } from './HintDisplay.js';
import { routeChangeModel } from './eventMenuModel.js';
import { saveServiceRun } from './serviceSave.js';
import {
  arriveAtEvent,
  completeEventBattle,
  eventSpoilsOwed,
  eventView,
  forfeitEventSpoils,
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
    /** The last failed settlement: { nodeId, reason } (not saved: a reload simply retries). */
    this.failure = null;
    /** Nodes whose failed spoils the player closed: the route map does not reopen them itself. */
    this.deferred = new Set();
  }

  /**
   * The node was clicked (or re-entered): arrive, save, open the page its state calls for.
   * `auto`: the route map opening an owed page by itself (scene start, after the loot
   * screen); a settlement the player has just walked away from is not reopened that way.
   */
  handleEvent(node, { auto = false } = {}) {
    const scene = this.scene;
    const rm = scene.runManager;
    if (!node || scene.eventOverlay) return false;
    // A won fight: its spoils owed (the player left before they were settled, or the last
    // attempt failed), or its victory page not yet closed with Continue (a refresh on it).
    if (node.completed) {
      if (eventSpoilsOwed(rm, node.id)) {
        if (auto && this.deferred.has(node.id)) return false;
        this.deferred.delete(node.id);
        return this.openSettlement(node);
      }
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
   * the victory page. Idempotent across a refresh (the engine guards the spoils). When the
   * spoils cannot be taken the engine has changed nothing: they stay owed, and the page
   * opens in its failure state (Try again / Back to map / Give up) instead of the victory.
   */
  openSettlement(node) {
    const scene = this.scene;
    const rm = scene.runManager;
    if (!node || scene.eventOverlay) return false;
    const result = completeEventBattle(rm, node.id);
    if (result.ok || result.already) {
      this.failure = null;
      this.save();
    } else {
      console.warn('[EventController] spoils not settled:', result.reason);
      this.failure = { nodeId: node.id, reason: result.reason || '' };
    }
    this.showEventOverlay(node);
    return true;
  }

  /** Why the owed spoils could not be taken, for the page ('' when they have not failed). */
  failureReason(nodeId) {
    return this.failure?.nodeId === nodeId ? this.failure.reason || 'Something went wrong.' : '';
  }

  /** Try again: the same settlement. { ok:true } once taken (saved), else { ok:false, reason }. */
  retrySettlement() {
    const node = this.scene._eventNode;
    if (!node || !this.scene.eventOverlay) return { ok: false, reason: 'Nothing to settle.' };
    const result = completeEventBattle(this.scene.runManager, node.id);
    if (result.ok || result.already) {
      this.failure = null;
      this.save();
      return { ok: true };
    }
    this.failure = { nodeId: node.id, reason: result.reason || '' };
    return { ok: false, reason: result.reason || 'Something went wrong.' };
  }

  /** Give up the owed spoils (the page confirmed it first): terminal, saved at once. */
  forfeitSpoils() {
    const node = this.scene._eventNode;
    if (!node || !this.scene.eventOverlay) return { ok: false, reason: 'Nothing to give up.' };
    const result = forfeitEventSpoils(this.scene.runManager, node.id);
    if (!result.ok) return result;
    this.failure = null;
    this.deferred.delete(node.id);
    this.save();
    return result;
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
    // ESC before choosing, or while a fight or its spoils are owed: the event stays current.
    // Owed spoils stay owed; the route map just does not reopen them on its own again.
    const node = this.scene._eventNode;
    if (node && eventSpoilsOwed(this.scene.runManager, node.id)) this.deferred.add(node.id);
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
    // A contract reward this fight earned and could not deliver waits behind the event's own page.
    scene._maybeOpenPendingContractSettlement?.();
    return true;
  }

  /** An event the build no longer knows: walk past it (the node completes, nothing applies). */
  continueUnknown() {
    const scene = this.scene;
    const node = scene._eventNode;
    if (!node || !scene.eventOverlay) return false;
    // The spoils of an event nobody can read cannot be settled: walking on gives them up
    // (the node would otherwise hold the party for good).
    if (eventSpoilsOwed(scene.runManager, node.id)) forfeitEventSpoils(scene.runManager, node.id);
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
