// Contract settlement lifecycle only (docs/specs/event-nodes-phase2.md "Contract settlement
// recovery"). ContractSettlementMenu owns rendering and input; engine/ContractSettlement.js owns
// every rule. This controller opens the page for what the run owes, saves at each commit and
// carries the exits. Follows EventController's create/destroy pattern, and shares its route-map
// slot: while the page is open `scene.eventOverlay` is set (the route map's "a story page is
// open" flag, which keeps the loom, Travel and the other overlays quiet), so the scene guards
// that already read it cover this page too.
//
//   victory leaves a reward owed ─ route map ─ handle ─ the page (Claim / Roster / Give up)
//   Claim            ─ deliverContractSettlement ─ save ─ "what arrived" ─ Continue
//   Claim, no room   ─ the page stays, saying why ("Still waiting: No room for Steel Lance")
//   Roster           ─ make room; the page asks the engine again
//   Give up (confirmed) ─ forfeitContractReward ─ save ─ Continue
//   Back to map      ─ the page closes, everything stays owed and the party stays held; tapping the
//                      held node or the contract chip reopens it (the map never reopens it by
//                      itself again in this scene; a reload does)

import { ContractSettlementMenu } from './ContractSettlementMenu.js';
import { showMinorHint } from './HintDisplay.js';
import { saveServiceRun } from './serviceSave.js';
import { contractOwedOf } from '../engine/Contracts.js';
import { deliverContractSettlement, forfeitContractReward } from '../engine/ContractSettlement.js';

export class ContractSettlementController {
  constructor(scene) {
    this.scene = scene;
    /** The page's own last step once nothing is owed: { kind: 'paid'|'forfeited', settlement }. */
    this.outcome = null;
    /** The player closed the page with the reward still owed: the map does not reopen it itself. */
    this.deferred = false;
    this.menu = null;
  }

  /** Whether the run owes anything (a reward or a penalty). */
  owes() {
    return Boolean(contractOwedOf(this.scene.runManager));
  }

  /**
   * Open the page for what is owed. `auto`: the route map opening it by itself (scene start, after
   * the loot screen); a page the player has just walked away from is not forced back that way.
   * `manual`: a tap on the held node or the contract chip, always honoured.
   */
  handle({ auto = false } = {}) {
    const scene = this.scene;
    if (!scene?.runManager || scene.eventOverlay || this.menu) return false;
    if (!this.owes()) return false;
    if (auto && this.deferred) return false;
    this.deferred = false;
    this.outcome = null;
    this.show();
    return true;
  }

  show() {
    const scene = this.scene;
    this.menu?.destroy();
    scene.eventOverlay = [];
    this.menu = new ContractSettlementMenu(this);
  }

  /** Claim: the delivery again. { ok: true } once paid (saved), else { ok: false, reason }. */
  claim() {
    const rm = this.scene.runManager;
    const result = deliverContractSettlement(rm);
    if (!result) return { ok: false, reason: 'Nothing is owed.' };
    if (result.ok) {
      this.outcome = { kind: 'paid', settlement: result.settlement };
      this.save();
      return { ok: true };
    }
    // Still owed (no room, or the apply failed): the engine put the run back as it was, and the
    // record (with the newest reason) is saved so a reload says the same.
    this.save();
    return { ok: false, reason: result.reason || 'It is still waiting.' };
  }

  /** Give the owed reward up (the page confirmed it first): terminal, saved at once. */
  forfeit() {
    const rm = this.scene.runManager;
    const result = forfeitContractReward(rm);
    if (!result.ok) return result;
    this.outcome = { kind: 'forfeited', settlement: rm.lastContractSettlement };
    this.save();
    return result;
  }

  /** Back to map: close with everything still owed (the party stays held). */
  closeToMap() {
    if (this.owes()) this.deferred = true;
    this.closeOverlay();
    this.scene.drawMap();
  }

  /** Continue, once settled: close, save, and check the act (the held boss may now be left). */
  finish() {
    const scene = this.scene;
    this.outcome = null;
    this.closeOverlay();
    const warning = saveServiceRun(scene);
    if (warning) showMinorHint(scene, warning.trim());
    scene.checkActComplete();
    return true;
  }

  save() {
    const warning = saveServiceRun(this.scene);
    if (warning) showMinorHint(this.scene, warning.trim());
  }

  closeOverlay() {
    const scene = this.scene;
    if (!scene) return;
    this.menu?.destroy();
    this.menu = null;
    if (scene.eventOverlay && !scene._eventController?.nativeMenu) scene.eventOverlay = null;
  }

  destroy() {
    this.closeOverlay();
    this.scene = null;
  }
}
