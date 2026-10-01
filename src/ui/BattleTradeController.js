import { battleSession } from './BattleSession.js';
// BattleTradeController -- the one write path for trading in battle
// (docs/specs/item-trade.md, "Battle"). The DOM menu (BattleTradeMenu over
// TradeMenu) and the headless canvas fallback both commit through here, so the
// guards, the movement commitment, the history beat and the checkpoint are the
// same whichever surface the player used. Reordering one of the two units' bags
// (which can change what it has equipped) goes through here too.
//
// Trading is a free, pre-action command: it never touches `hasActed`, and it
// never touches the partner's `hasActed`, `hasMoved` or `_movementCommitted`.

import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { applyReorder, applyTrade } from '../engine/ItemTrade.js';

/** The trade context in battle: player units only, no convoy, no accessories. */
export const BATTLE_TRADE_CTX = Object.freeze({ context: 'battle' });

/** The bags a battle trade offers (Weapons and Supplies tabs). */
export const BATTLE_TRADE_BAGS = Object.freeze(['inventory', 'consumables']);

/** Shown when the trade session no longer allows a commit (state moved on). */
export const TRADE_UNAVAILABLE = 'Trading is no longer available.';

function isAdjacent(a, b) {
  const dc = Number(a?.col) - Number(b?.col);
  const dr = Number(a?.row) - Number(b?.row);
  return Number.isFinite(dc) && Number.isFinite(dr) && Math.abs(dc) + Math.abs(dr) === 1;
}

function slotUnit(slot) {
  return slot?.holder?.kind === 'unit' ? slot.holder.unit || null : null;
}

export class BattleTradeController {
  constructor(scene) {
    this.scene = scene;
    this.destroyed = false;
  }

  /** No visuals of its own: the menu belongs to the scene (cleanupTradeUI). */
  create() {
    this.destroyed = false;
    return this;
  }

  destroy() {
    this.destroyed = true;
  }

  /**
   * True when `left` (the selected, acting unit) may still trade with `right`
   * using these two slots: the scene is in its trade session on the player
   * phase, left has not acted, both are fielded player units standing next to
   * each other, and the slots belong to exactly those two units.
   */
  canCommit(left, right, from, to) {
    if (!this.sessionOpen(left, right)) return false;
    const a = slotUnit(from);
    const b = slotUnit(to);
    return (a === left && b === right) || (a === right && b === left);
  }

  /** The trade session between `left` (acting) and `right` still allows a change. */
  sessionOpen(left, right) {
    const scene = this.scene;
    if (this.destroyed || !scene || !left || !right || left === right) return false;
    if (scene.battleState !== 'TRADING') return false;
    if (scene.turnManager?.currentPhase !== 'player') return false;
    if (scene.selectedUnit !== left || left.hasActed) return false;
    const fielded = Array.isArray(scene.playerUnits) ? scene.playerUnits : [];
    if (!fielded.includes(left) || !fielded.includes(right)) return false;
    return isAdjacent(left, right);
  }

  /**
   * True when one of the two units' own bags may be reordered with these slots: the
   * same session rules as canCommit, and both slots belong to one of the two units.
   */
  canReorder(left, right, from, to) {
    if (!this.sessionOpen(left, right)) return false;
    const unit = slotUnit(from);
    return !!unit && unit === slotUnit(to) && (unit === left || unit === right);
  }

  /** The first change of a trade session locks in the acting unit's move. */
  lockMove(left) {
    const scene = this.scene;
    if (scene.tradeMutatedThisSession) return;
    scene.tradeMutatedThisSession = true;
    left._movementCommitted = true;
    scene.preMoveLoc = null;
    scene.commitVisionSnapshotIfPending();
  }

  /**
   * Give or swap one item between `left` and `right`.
   * @returns the ItemTrade result ({ ok: true, kind, warnings, detail } |
   *   { ok: false, reason }). Nothing is committed unless it is ok.
   */
  commit(left, right, from, to) {
    if (!this.canCommit(left, right, from, to)) return { ok: false, reason: TRADE_UNAVAILABLE };
    const scene = this.scene;
    const session = battleSession(scene);
    const result = applyTrade(BATTLE_TRADE_CTX, from, to);
    if (!result.ok) return result;
    this.lockMove(left);
    observeHistoryAction(scene, 'traded with', left, right, result.detail);
    scene._captureSuspendCheckpoint?.({ session: session });
    return result;
  }

  /**
   * Swap two items in the acting unit's or the partner's own bag; a new first weapon
   * is equipped. Same session guards and move lock as commit; the history beat is
   * "changed equipment" (the acting unit is always its actor), then a checkpoint.
   * @returns the ItemTrade reorder result ({ ok: true, kind: 'reorder', equips,
   *   warnings, detail } | { ok: false, reason }). Nothing is committed unless ok.
   */
  reorder(left, right, from, to) {
    if (!this.canReorder(left, right, from, to)) return { ok: false, reason: TRADE_UNAVAILABLE };
    const scene = this.scene;
    const session = battleSession(scene);
    const result = applyReorder(BATTLE_TRADE_CTX, from, to);
    if (!result.ok) return result;
    this.lockMove(left);
    const unit = slotUnit(from);
    const detail = unit === left ? result.detail : `${result.detail} for ${unit.name}`;
    observeHistoryAction(scene, 'changed equipment', left, null, detail);
    scene._captureSuspendCheckpoint?.({ session: session });
    return result;
  }
}

/** The scene's controller, created on first use (fake scenes in tests included). */
export function battleTradeController(scene) {
  if (!scene._tradeController || scene._tradeController.destroyed)
    scene._tradeController = new BattleTradeController(scene).create();
  return scene._tradeController;
}
